"""Unit tests for the stdlib WebDAV client (multicorpus_engine.remote.webdav).

Network is mocked at ``urlopen``; no real server is contacted.
"""

from __future__ import annotations

import email.message
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError, URLError
from urllib.request import Request

import pytest

from multicorpus_engine.remote import webdav


# A SabreDAV/Nextcloud-style 207 multistatus: the collection itself (self),
# one file, and one subfolder. hrefs are server-absolute and percent-encoded.
_MULTISTATUS = b"""<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/user/folder/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/user/folder/Le%20texte.docx</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getcontentlength>1234</d:getcontentlength>
        <d:getlastmodified>Mon, 01 Jun 2026 10:00:00 GMT</d:getlastmodified>
        <d:getcontenttype>application/vnd.openxmlformats</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/user/folder/sub/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>
"""

_URL = "https://dav.example/remote.php/dav/files/user/folder/"


class _FakeResp:
    """Minimal context-manager response with chunked read + headers."""

    def __init__(self, body: bytes = b"", headers: dict | None = None):
        self._body = body
        self.headers = headers or {}

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            data, self._body = self._body, b""
            return data
        data, self._body = self._body[:n], self._body[n:]
        return data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


# --- auth header construction ---------------------------------------------------

def test_build_auth_header_basic():
    h = webdav.build_auth_header("basic", user="alice", password="secret")
    assert h["Authorization"].startswith("Basic ")


def test_build_auth_header_bearer():
    assert webdav.build_auth_header("bearer", token="tok") == {"Authorization": "Bearer tok"}


def test_build_auth_header_anonymous():
    assert webdav.build_auth_header("anonymous") == {}


@pytest.mark.parametrize("kwargs", [
    {"user": "alice"},          # basic without password
    {"password": "x"},          # basic without user
])
def test_build_auth_header_basic_incomplete(kwargs):
    with pytest.raises(ValueError):
        webdav.build_auth_header("basic", **kwargs)


def test_build_auth_header_bearer_missing_token():
    with pytest.raises(ValueError):
        webdav.build_auth_header("bearer")


# --- URL scheme guard -----------------------------------------------------------

@pytest.mark.parametrize("url", [
    "https://dav.example/folder/",
    "http://dav.example:8080/folder/",
    "HTTPS://DAV.EXAMPLE/Folder/",  # scheme is case-insensitive
])
def test_validate_remote_url_accepts_http_https(url):
    webdav.validate_remote_url(url)  # must not raise


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "file://C:/Windows/secret.txt",
    "ftp://dav.example/folder/",
    "gopher://dav.example/",
    "https:///no-host/path",   # scheme ok but no host
    "dav.example/folder",      # no scheme
    "",
    "   ",
    None,
])
def test_validate_remote_url_rejects_unsupported(url):
    with pytest.raises(ValueError):
        webdav.validate_remote_url(url)


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/dav",
    "http://10.0.0.5/dav",
    "http://192.168.1.10/dav",
    "http://172.16.5.4/dav",
    "http://169.254.169.254/latest/meta-data/",  # cloud metadata endpoint
    "http://[::1]/dav",
    "http://localhost/dav",
    "http://0.0.0.0/",
])
def test_validate_remote_url_blocks_internal_targets(url):
    """SSRF guard: loopback / private / link-local IP literals + localhost (audit SID-04)."""
    with pytest.raises(ValueError):
        webdav.validate_remote_url(url)


@pytest.mark.parametrize("url", [
    "http://8.8.8.8/dav",
    "https://93.184.216.34/remote.php/dav",  # public IP literals → no DNS, no raise
])
def test_validate_remote_url_allows_public_ip_literals(url):
    webdav.validate_remote_url(url)  # must not raise


def test_propfind_rejects_file_scheme_before_opening():
    # The guard must fire before any urlopen — a bad scheme never reaches the opener.
    called = {"n": 0}

    def _should_not_be_called(req, timeout=None):
        called["n"] += 1
        return _FakeResp(b"")

    with mock.patch.object(webdav, "urlopen", _should_not_be_called):
        with pytest.raises(ValueError):
            webdav.propfind("file:///etc/passwd", auth_header={})
    assert called["n"] == 0


def test_download_rejects_file_scheme_before_opening(tmp_path: Path):
    dest = tmp_path / "out.bin"
    called = {"n": 0}

    def _should_not_be_called(req, timeout=None):
        called["n"] += 1
        return _FakeResp(b"")

    with mock.patch.object(webdav, "urlopen", _should_not_be_called):
        with pytest.raises(ValueError):
            webdav.download("file:///etc/passwd", dest, auth_header={})
    assert called["n"] == 0
    assert not dest.exists()


# --- propfind -------------------------------------------------------------------

def test_propfind_lists_children_excluding_self():
    captured = {}

    def _fake_urlopen(req, timeout=None):
        captured["method"] = req.method
        return _FakeResp(_MULTISTATUS)

    with mock.patch.object(webdav, "urlopen", _fake_urlopen):
        entries = webdav.propfind(_URL, auth_header={})

    assert captured["method"] == "PROPFIND"
    # self collection excluded → file + subfolder remain
    assert len(entries) == 2
    by_name = {e.name: e for e in entries}

    docx = by_name["Le texte.docx"]  # percent-decoded name
    assert docx.is_dir is False
    assert docx.size == 1234
    assert docx.content_type == "application/vnd.openxmlformats"
    # href resolved to an absolute URL against the request
    assert docx.href == "https://dav.example/remote.php/dav/files/user/folder/Le%20texte.docx"

    assert by_name["sub"].is_dir is True


def test_propfind_excludes_off_origin_hrefs():
    # A malicious/compromised server returns an off-host href. It must NOT become
    # a downloadable entry — otherwise download() would send the Authorization
    # header to attacker.example (credential exfiltration) / SSRF.
    body = b"""<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/user/folder/safe.docx</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>https://attacker.example/steal.docx</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>http://dav.example/remote.php/dav/files/user/folder/downgrade.docx</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>"""
    with mock.patch.object(webdav, "urlopen", lambda req, timeout=None: _FakeResp(body)):
        entries = webdav.propfind(_URL, auth_header={"Authorization": "Basic x"})

    # Only the same-origin (https://dav.example) file survives; the off-host and
    # the scheme-downgraded (http) entries are dropped.
    assert [e.name for e in entries] == ["safe.docx"]
    assert all(webdav.urlsplit(e.href).hostname == "dav.example" for e in entries)
    assert all(webdav.urlsplit(e.href).scheme == "https" for e in entries)


def test_propfind_on_a_file_raises():
    # A PROPFIND whose only (self) entry is not a collection → url is a file.
    body = b"""<?xml version="1.0"?>
    <d:multistatus xmlns:d="DAV:">
      <d:response>
        <d:href>/remote.php/dav/files/user/folder/a.docx</d:href>
        <d:propstat>
          <d:prop><d:resourcetype/><d:getcontentlength>10</d:getcontentlength></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>
    </d:multistatus>"""
    url = "https://dav.example/remote.php/dav/files/user/folder/a.docx"
    with mock.patch.object(webdav, "urlopen", lambda req, timeout=None: _FakeResp(body)):
        with pytest.raises(webdav.WebdavError):
            webdav.propfind(url, auth_header={})


# --- error mapping --------------------------------------------------------------

@pytest.mark.parametrize("code,exc_type", [
    (401, webdav.WebdavAuthError),
    (403, webdav.WebdavAuthError),
    (404, webdav.WebdavNotFound),
    (500, webdav.WebdavError),
])
def test_http_errors_are_mapped(code, exc_type):
    def _raise(req, timeout=None):
        raise HTTPError(req.full_url, code, "boom", {}, None)

    with mock.patch.object(webdav, "urlopen", _raise):
        with pytest.raises(exc_type):
            webdav.propfind(_URL, auth_header={})


def test_network_error_is_mapped():
    def _raise(req, timeout=None):
        raise URLError("no route")

    with mock.patch.object(webdav, "urlopen", _raise):
        with pytest.raises(webdav.WebdavError):
            webdav.propfind(_URL, auth_header={})


# --- download -------------------------------------------------------------------

def test_download_writes_file(tmp_path: Path):
    dest = tmp_path / "out.bin"
    payload = b"hello world"
    with mock.patch.object(webdav, "urlopen", lambda req, timeout=None: _FakeResp(payload, {"Content-Length": str(len(payload))})):
        written = webdav.download("https://dav.example/f", dest, auth_header={})
    assert written == len(payload)
    assert dest.read_bytes() == payload


def test_download_rejects_oversize_declared(tmp_path: Path):
    dest = tmp_path / "out.bin"
    with mock.patch.object(webdav, "urlopen", lambda req, timeout=None: _FakeResp(b"x" * 100, {"Content-Length": "100"})):
        with pytest.raises(webdav.WebdavTooLarge):
            webdav.download("https://dav.example/f", dest, auth_header={}, max_bytes=10)
    assert not dest.exists()


def test_download_rejects_oversize_streamed_without_header(tmp_path: Path):
    dest = tmp_path / "out.bin"
    # No Content-Length → the streaming guard must catch it and remove the partial.
    with mock.patch.object(webdav, "urlopen", lambda req, timeout=None: _FakeResp(b"x" * 100, {})):
        with pytest.raises(webdav.WebdavTooLarge):
            webdav.download("https://dav.example/f", dest, auth_header={}, max_bytes=10)
    assert not dest.exists()


# --- redirect credential stripping ----------------------------------------------
# urllib's default redirect handler re-sends Authorization to the redirect target,
# even cross-host. _AuthStrippingRedirectHandler must drop it on any non-same-origin
# hop so a malicious 30x cannot exfiltrate the WebDAV credentials.

_SRC = "https://dav.example/folder/a.docx"


def _do_redirect(new_url: str, *, method: str = "GET", code: int = 302):
    handler = webdav._AuthStrippingRedirectHandler()
    req = Request(_SRC, method=method, headers={"Authorization": "Basic SECRET", "Depth": "1"})
    return handler.redirect_request(req, None, code, "Found", email.message.Message(), new_url)


def _has_auth(req) -> bool:
    return any(k.lower() == "authorization" for k in req.headers) or any(
        k.lower() == "authorization" for k in req.unredirected_hdrs
    )


@pytest.mark.parametrize("new_url", [
    "https://attacker.example/steal",          # different host
    "http://dav.example/folder/a.docx",        # scheme downgrade https -> http
    "https://dav.example:8443/folder/a.docx",  # different port
])
def test_redirect_strips_auth_cross_origin(new_url):
    new = _do_redirect(new_url)
    assert new is not None
    assert not _has_auth(new), f"Authorization leaked to {new_url}"


def test_redirect_keeps_auth_same_origin():
    # A legitimate same-origin redirect (e.g. trailing-slash 301) keeps credentials.
    new = _do_redirect("https://dav.example/folder/other.docx")
    assert _has_auth(new)


def test_redirect_strips_only_auth_not_other_headers():
    new = _do_redirect("https://attacker.example/x")
    assert not _has_auth(new)
    assert any(k.lower() == "depth" for k in new.headers)  # non-sensitive header survives


def test_module_opener_wires_the_auth_stripping_handler():
    # Guards that production requests actually go through the hardened handler.
    assert any(
        isinstance(h, webdav._AuthStrippingRedirectHandler) for h in webdav._OPENER.handlers
    )
