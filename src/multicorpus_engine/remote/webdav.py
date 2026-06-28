"""Minimal WebDAV client (stdlib only) for remote ingestion.

Implements only the two operations the ingestion pipeline needs — list a
collection (PROPFIND, ``Depth: 1``) and download a file (GET) — plus
Authorization header construction. No third-party dependency: ``urllib`` for
HTTP, ``defusedxml`` for parsing the multistatus body (XXE-safe).

Validated target: ShareDocs Huma-Num (Nextcloud / SabreDAV). See
docs/DESIGN_sharedocs_ingestion.md §3.
"""

from __future__ import annotations

import base64
import ipaddress
import logging
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import defusedxml.ElementTree as ET

_DAV = "DAV:"
_CHUNK = 4 * 1024 * 1024  # 4 MiB — mirrors the importers' streaming reads
DEFAULT_TIMEOUT = 30

log = logging.getLogger(__name__)

# Minimal PROPFIND body: request only the props we surface.
_PROPFIND_BODY = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<d:propfind xmlns:d="DAV:"><d:prop>'
    "<d:resourcetype/><d:getcontentlength/><d:getlastmodified/>"
    "<d:getcontenttype/><d:getetag/>"
    "</d:prop></d:propfind>"
).encode("utf-8")


class WebdavError(RuntimeError):
    """Base error for WebDAV operations."""


class WebdavAuthError(WebdavError):
    """Authentication / authorization failure (HTTP 401 / 403)."""


class WebdavNotFound(WebdavError):
    """Resource not found (HTTP 404)."""


class WebdavTooLarge(WebdavError):
    """A file exceeds the configured size limit."""


@dataclass
class RemoteEntry:
    """One child of a WebDAV collection."""

    name: str
    href: str  # absolute URL, resolved against the request URL
    is_dir: bool
    size: Optional[int]
    modified: Optional[str]
    content_type: Optional[str]


_ALLOWED_SCHEMES = ("http", "https")


def _ip_is_internal(ip: ipaddress._BaseAddress) -> bool:
    return bool(
        ip.is_loopback or ip.is_private or ip.is_link_local
        or ip.is_reserved or ip.is_multicast or ip.is_unspecified
    )


def _host_is_internal(hostname: str) -> bool:
    """True if *hostname* is a loopback name or an internal IP **literal**.

    Blocks the direct-target SSRF vector — loopback / private / link-local IPs,
    incl. the cloud metadata endpoint ``169.254.169.254`` — **without resolving
    DNS**, keeping this a pure, network-free check (it runs at the top of every
    propfind/download). A DNS name that *resolves* to an internal address is not
    caught here: that is defence-in-depth out of scope (the sidecar is
    loopback-only and the client carries no ambient credentials), and resolving
    here would add a network round-trip + DNS-rebinding TOCTOU to a validator.
    """
    h = hostname.strip().strip("[]").lower()
    if h == "localhost" or h.endswith(".localhost"):
        return True
    try:
        return _ip_is_internal(ipaddress.ip_address(h))
    except ValueError:
        return False  # DNS name — not resolved (see docstring)


def validate_remote_url(url: str) -> None:
    """Reject any URL the WebDAV client must never fetch.

    Only ``http`` / ``https`` URLs **with a host** are allowed. This blocks
    ``file://``, ``ftp://`` and similar schemes: urllib's default opener (used by
    :data:`_OPENER`) wires ``FileHandler`` / ``FTPHandler``, so an unchecked
    ``file:///…`` GET in :func:`download` would read a local file
    (local-file-read / SSRF). Called at the top of :func:`propfind` and
    :func:`download` so **every** caller — CLI ``import-remote`` and the sidecar
    routes — is covered before any network or filesystem access.

    Raises ``ValueError`` on an unsupported URL (mapped to a 400 by the sidecar).
    """
    if not isinstance(url, str) or not url.strip():
        raise ValueError("url is required")
    parts = urlsplit(url.strip())
    if parts.scheme.lower() not in _ALLOWED_SCHEMES:
        raise ValueError(
            f"Unsupported URL scheme {(parts.scheme or '(none)')!r}: only http/https are allowed"
        )
    if not parts.hostname:
        raise ValueError("url must include a host")
    if _host_is_internal(parts.hostname):
        raise ValueError(
            "url host points to a loopback / private / link-local address (blocked "
            "to prevent SSRF to internal services)"
        )


def build_auth_header(
    mode: str,
    *,
    user: Optional[str] = None,
    password: Optional[str] = None,
    token: Optional[str] = None,
) -> dict:
    """Build the Authorization header for *mode*.

    ``mode`` ∈ {``"basic"``, ``"bearer"``, ``"anonymous"``}. Returns ``{}`` for
    anonymous. Raises ``ValueError`` on missing credentials.
    """
    if mode == "anonymous":
        return {}
    if mode == "basic":
        if not user or password is None:
            raise ValueError("basic auth requires both a username and a password")
        raw = f"{user}:{password}".encode("utf-8")
        return {"Authorization": "Basic " + base64.b64encode(raw).decode("ascii")}
    if mode == "bearer":
        if not token:
            raise ValueError("bearer auth requires a token")
        return {"Authorization": f"Bearer {token}"}
    raise ValueError(f"Unknown auth mode: {mode!r}")


def _open(req: Request, timeout: int):
    try:
        return urlopen(req, timeout=timeout)
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise WebdavAuthError(
                f"WebDAV authentication failed (HTTP {exc.code}) for {req.full_url}"
            ) from exc
        if exc.code == 404:
            raise WebdavNotFound(f"WebDAV resource not found: {req.full_url}") from exc
        raise WebdavError(f"WebDAV HTTP error {exc.code} for {req.full_url}") from exc
    except (URLError, socket.timeout, TimeoutError) as exc:
        raise WebdavError(f"WebDAV network error for {req.full_url}: {exc}") from exc


def _same_origin(base: str, other: str) -> bool:
    """True if *other* shares *base*'s scheme/host/port (default ports normalized).

    Used to refuse off-host hrefs before issuing any auth-bearing request, so a
    malicious/compromised server cannot redirect the client (and its credentials)
    to an arbitrary host.
    """
    b, o = urlsplit(base), urlsplit(other)

    def _port(p) -> Optional[int]:
        if p.port is not None:
            return p.port
        return {"https": 443, "http": 80}.get(p.scheme)

    return (
        b.scheme == o.scheme
        and (b.hostname or "").lower() == (o.hostname or "").lower()
        and _port(b) == _port(o)
    )


class _AuthStrippingRedirectHandler(HTTPRedirectHandler):
    """Follow redirects, but drop the ``Authorization`` header on cross-origin hops.

    urllib's default handler re-sends every request header — including
    ``Authorization`` — to the redirect target, even when it points to a
    different host. A malicious/compromised WebDAV server could thus 30x the
    download GET to an attacker host and harvest the credentials. We strip
    ``Authorization`` whenever the next URL is not same-origin with the request
    being redirected; legitimate same-origin redirects (e.g. a Nextcloud
    trailing-slash 301) keep it and still work.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and not _same_origin(req.full_url, newurl):
            new.headers = {
                k: v for k, v in new.headers.items() if k.lower() != "authorization"
            }
            new.unredirected_hdrs = {
                k: v for k, v in new.unredirected_hdrs.items() if k.lower() != "authorization"
            }
            log.warning(
                "WebDAV: stripped Authorization on cross-origin redirect %s -> %s",
                req.full_url, newurl,
            )
        return new


# Module HTTP opener: follows redirects but strips credentials on cross-origin
# hops (see _AuthStrippingRedirectHandler). Every WebDAV request goes through it
# via the urlopen() wrapper below (which is also the test seam).
_OPENER = build_opener(_AuthStrippingRedirectHandler())


def urlopen(req: Request, timeout: int):
    """Open *req* through the credential-stripping opener (test seam)."""
    return _OPENER.open(req, timeout=timeout)


def propfind(url: str, *, auth_header: dict, timeout: int = DEFAULT_TIMEOUT) -> list[RemoteEntry]:
    """List the immediate children of the collection at *url* (``Depth: 1``).

    The collection's own entry (the *self* entry) is excluded from the result.
    Raises ``WebdavError`` (or a subclass) on failure, including when *url* points
    to a file rather than a collection; ``ValueError`` for an unsupported URL.
    """
    validate_remote_url(url)
    headers = {"Depth": "1", "Content-Type": "application/xml", **auth_header}
    req = Request(url, method="PROPFIND", data=_PROPFIND_BODY, headers=headers)
    with _open(req, timeout) as resp:
        body = resp.read()
    try:
        root = ET.fromstring(body)
    except Exception as exc:  # defusedxml raises various parse/entity errors
        raise WebdavError(f"Invalid PROPFIND response from {url}: {exc}") from exc

    self_path = urlsplit(url).path.rstrip("/")
    self_is_dir: Optional[bool] = None
    entries: list[RemoteEntry] = []

    for resp_el in root.findall(f"{{{_DAV}}}response"):
        href_el = resp_el.find(f"{{{_DAV}}}href")
        if href_el is None or not href_el.text:
            continue
        href_raw = href_el.text.strip()
        abs_url = urljoin(url, href_raw)
        # Security: only ever follow same-origin hrefs. A malicious/compromised
        # server could return an off-host href; downloading it would send the
        # Authorization header to an arbitrary host (credential exfiltration) and
        # could SSRF the client into internal networks. Off-origin entries are
        # dropped here, before any auth-bearing GET in download().
        if not _same_origin(url, abs_url):
            log.warning("WebDAV: skipping off-origin href %r (base %s)", abs_url, url)
            continue
        prop = _first_prop(resp_el)
        is_dir = _is_collection(prop)

        if urlsplit(abs_url).path.rstrip("/") == self_path:
            self_is_dir = is_dir
            continue

        entries.append(
            RemoteEntry(
                name=_basename_from_href(href_raw),
                href=abs_url,
                is_dir=is_dir,
                size=_int_or_none(_prop_text(prop, "getcontentlength")),
                modified=_prop_text(prop, "getlastmodified"),
                content_type=_prop_text(prop, "getcontenttype"),
            )
        )

    if self_is_dir is False:
        raise WebdavError(f"--url must point to a WebDAV collection (folder), not a file: {url}")
    return entries


def download(
    url: str,
    dest_path: str | Path,
    *,
    auth_header: dict,
    max_bytes: Optional[int] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> int:
    """Stream the file at *url* into *dest_path*. Returns the number of bytes written.

    Raises ``WebdavTooLarge`` (without leaving a partial file) when the declared
    or streamed size exceeds *max_bytes*; ``ValueError`` for an unsupported URL.
    """
    validate_remote_url(url)
    dest_path = Path(dest_path)
    req = Request(url, method="GET", headers=dict(auth_header))
    with _open(req, timeout) as resp:
        if max_bytes is not None:
            declared = resp.headers.get("Content-Length")
            if declared is not None:
                try:
                    if int(declared) > max_bytes:
                        raise WebdavTooLarge(f"{url} is {declared} bytes (> {max_bytes})")
                except ValueError:
                    pass  # unparsable header — fall back to the streaming guard
        written = 0
        with open(dest_path, "wb") as fh:
            while True:
                chunk = resp.read(_CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if max_bytes is not None and written > max_bytes:
                    fh.close()
                    dest_path.unlink(missing_ok=True)
                    raise WebdavTooLarge(f"{url} exceeds {max_bytes} bytes")
                fh.write(chunk)
    return written


# --- multistatus parsing helpers ------------------------------------------------

def _first_prop(resp_el):
    """Return the ``<prop>`` of the 200 propstat, else the first available one."""
    fallback = None
    for ps in resp_el.findall(f"{{{_DAV}}}propstat"):
        prop = ps.find(f"{{{_DAV}}}prop")
        if prop is None:
            continue
        status = ps.find(f"{{{_DAV}}}status")
        if status is not None and status.text and " 200 " in status.text:
            return prop
        if fallback is None:
            fallback = prop
    return fallback


def _is_collection(prop) -> bool:
    if prop is None:
        return False
    rt = prop.find(f"{{{_DAV}}}resourcetype")
    return rt is not None and rt.find(f"{{{_DAV}}}collection") is not None


def _prop_text(prop, name: str) -> Optional[str]:
    if prop is None:
        return None
    el = prop.find(f"{{{_DAV}}}{name}")
    if el is None or el.text is None:
        return None
    return el.text.strip()


def _int_or_none(s: Optional[str]) -> Optional[int]:
    if s is None:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def _basename_from_href(href: str) -> str:
    path = unquote(urlsplit(href).path).rstrip("/")
    return path.rsplit("/", 1)[-1] if path else ""
