"""In-process sidecar tests for the ShareDocs / WebDAV ingestion endpoints (P2).

Run the real ``CorpusServer`` in-process (no subprocess — like
``test_sidecar_threading.py``), so they avoid the flaky real-sidecar-subprocess
path. The WebDAV layer (``propfind``/``download``) is mocked at the module level;
the import pipeline + a real temp SQLite DB run for real.

Covers the Phase 2 contract:
- ``POST /webdav/list`` is read-only (entries / 401 / 502), dispatched lock-free.
- ``POST /import-remote`` enqueues an async job and returns ``{job}``; the batch
  runs on a worker thread and the report is polled via ``/jobs/<id>``.
- **Credential isolation (§D2):** no ``auth`` value ever appears in the job
  params exposed by ``/jobs/<id>`` nor in ``runs.params_json``.
"""

from __future__ import annotations

import io
import json
import time
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from multicorpus_engine.remote import webdav
from multicorpus_engine.sidecar import CorpusServer

_BASE = "https://dav.example/folder/"
_SECRET_USER = "alice"
_SECRET_PASSWORD = "s3cr3t-passphrase"


def _make_docx_bytes(paragraphs: list[str]) -> bytes:
    import docx

    d = docx.Document()
    for p in paragraphs:
        d.add_paragraph(p)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _entry(name: str, size: int = 1000, is_dir: bool = False) -> webdav.RemoteEntry:
    return webdav.RemoteEntry(
        name=name, href=_BASE + name, is_dir=is_dir,
        size=size, modified="Mon, 01 Jan 2026 00:00:00 GMT", content_type=None,
    )


def _download_from(payloads: dict[str, bytes]):
    def _fake(url, dest_path, *, auth_header, max_bytes=None, timeout=30):
        data = payloads[url]
        if max_bytes is not None and len(data) > max_bytes:
            raise webdav.WebdavTooLarge(url)
        Path(dest_path).write_bytes(data)
        return len(data)
    return _fake


def _post(base_url: str, path: str, body: dict) -> tuple[int, dict]:
    req = Request(
        f"{base_url}{path}",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=10.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _get(base_url: str, path: str) -> tuple[int, dict]:
    try:
        with urlopen(f"{base_url}{path}", timeout=10.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _server(tmp_path: Path) -> CorpusServer:
    server = CorpusServer(str(tmp_path / "sharedocs.db"), host="127.0.0.1", port=0)
    server.start()
    return server


# --- /webdav/list --------------------------------------------------------------


def test_webdav_list_returns_entries(tmp_path: Path) -> None:
    server = _server(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    entries = [_entry("a.docx"), _entry("sub", is_dir=True)]
    try:
        with mock.patch.object(webdav, "propfind", return_value=entries):
            status, payload = _post(base, "/webdav/list", {"url": _BASE})
    finally:
        server.shutdown()

    assert status == 200
    assert payload["ok"] is True
    names = {e["name"]: e for e in payload["entries"]}
    assert names["a.docx"]["is_dir"] is False
    assert names["sub"]["is_dir"] is True


def test_webdav_list_missing_url_returns_400(tmp_path: Path) -> None:
    server = _server(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    try:
        status, payload = _post(base, "/webdav/list", {})
    finally:
        server.shutdown()
    assert status == 400
    assert payload["ok"] is False


def test_webdav_list_auth_error_maps_to_401(tmp_path: Path) -> None:
    server = _server(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    try:
        with mock.patch.object(webdav, "propfind", side_effect=webdav.WebdavAuthError("401 bad creds")):
            status, payload = _post(base, "/webdav/list", {"url": _BASE, "auth": {"mode": "basic", "user": "x", "password": "y"}})
    finally:
        server.shutdown()
    assert status == 401
    assert payload["ok"] is False


def test_webdav_list_network_error_maps_to_502(tmp_path: Path) -> None:
    server = _server(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    try:
        with mock.patch.object(webdav, "propfind", side_effect=webdav.WebdavError("connection reset")):
            status, payload = _post(base, "/webdav/list", {"url": _BASE})
    finally:
        server.shutdown()
    assert status == 502
    assert payload["ok"] is False


def test_webdav_list_rejects_non_http_scheme(tmp_path: Path) -> None:
    """A file:// (or any non-http) URL is refused with 400, before any fetch —
    the WebDAV opener wires urllib's FileHandler, so this blocks local-file read."""
    server = _server(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    sentinel = mock.Mock(side_effect=AssertionError("propfind must not run for a bad scheme"))
    try:
        with mock.patch.object(webdav, "propfind", sentinel):
            status, payload = _post(base, "/webdav/list", {"url": "file:///etc/passwd"})
    finally:
        server.shutdown()
    assert status == 400
    assert payload["ok"] is False
    sentinel.assert_not_called()


# --- /import-remote ------------------------------------------------------------


def _poll_job(base_url: str, job_id: str, *, timeout: float = 15.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, payload = _get(base_url, f"/jobs/{job_id}")
        assert status == 200, payload
        job = payload["job"]
        if job["status"] in ("done", "error", "canceled"):
            return job
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish in {timeout}s")


def test_import_remote_enqueues_job_and_imports(tmp_path: Path) -> None:
    server = _server(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    a = _make_docx_bytes(["[1] Bonjour.", "[2] Monde."])
    entries = [_entry("a.docx", len(a)), _entry("note.pdf", 10)]
    payloads = {_BASE + "a.docx": a}

    try:
        with mock.patch.object(webdav, "propfind", return_value=entries), \
             mock.patch.object(webdav, "download", _download_from(payloads)):
            status, payload = _post(base, "/import-remote", {
                "url": _BASE,
                "mode": "docx_numbered_lines",
                "language": "fr",
                "auth": {"mode": "basic", "user": _SECRET_USER, "password": _SECRET_PASSWORD},
            })
            assert status == 202, payload
            job_id = payload["job"]["job_id"]
            job = _poll_job(base, job_id)

        assert job["status"] == "done", job
        report = job["result"]
        assert report["imported"] == 1
        assert report["skipped_filtered"] == 1  # the .pdf

        # The document landed with the remote URL as provenance.
        docs = server._conn.execute(
            "SELECT source_path FROM documents"
        ).fetchall()
        assert [d[0] for d in docs] == [_BASE + "a.docx"]
    finally:
        server.shutdown()


def test_import_remote_never_leaks_credentials(tmp_path: Path) -> None:
    """Neither the job status (/jobs/<id> → params) nor runs.params_json may
    contain the WebDAV credentials (P2 §D2)."""
    server = _server(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    a = _make_docx_bytes(["[1] Bonjour."])
    entries = [_entry("a.docx", len(a))]
    payloads = {_BASE + "a.docx": a}

    try:
        with mock.patch.object(webdav, "propfind", return_value=entries), \
             mock.patch.object(webdav, "download", _download_from(payloads)):
            status, payload = _post(base, "/import-remote", {
                "url": _BASE,
                "mode": "docx_numbered_lines",
                "language": "fr",
                "auth": {"mode": "basic", "user": _SECRET_USER, "password": _SECRET_PASSWORD},
            })
            assert status == 202, payload
            job_id = payload["job"]["job_id"]
            _poll_job(base, job_id)

            # Full /jobs/<id> payload must not carry any credential.
            _, status_payload = _get(base, f"/jobs/{job_id}")
        blob = json.dumps(status_payload)
        assert _SECRET_PASSWORD not in blob
        assert _SECRET_USER not in blob
        assert "Authorization" not in blob
        # params are exposed but carry only url + mode + non-secret options.
        params = status_payload["job"]["params"]
        assert params["url"] == _BASE
        assert params["mode"] == "docx_numbered_lines"
        assert "auth" not in params

        # runs.params_json must likewise be credential-free.
        rows = server._conn.execute(
            "SELECT params_json FROM runs WHERE kind = 'import-remote'"
        ).fetchall()
        assert rows
        for (params_json,) in rows:
            assert _SECRET_PASSWORD not in (params_json or "")
            assert "Authorization" not in (params_json or "")
    finally:
        server.shutdown()


def test_import_remote_unknown_mode_returns_400(tmp_path: Path) -> None:
    server = _server(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    try:
        status, payload = _post(base, "/import-remote", {"url": _BASE, "mode": "bogus_mode"})
    finally:
        server.shutdown()
    assert status == 400
    assert payload["ok"] is False


def test_import_remote_rejects_non_http_scheme(tmp_path: Path) -> None:
    """A bad URL scheme is refused synchronously with 400 — never enqueued as a
    job (so it can't surface late as a job error)."""
    server = _server(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    try:
        status, payload = _post(base, "/import-remote", {
            "url": "file:///etc/passwd", "mode": "docx_numbered_lines", "language": "fr",
        })
    finally:
        server.shutdown()
    assert status == 400
    assert payload["ok"] is False


def test_import_remote_job_errors_when_listing_fails(tmp_path: Path) -> None:
    """A blocking failure inside the job (PROPFIND raises) surfaces as a job with
    status=error via /jobs/<id> — the enqueue itself still succeeds (202)."""
    server = _server(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    try:
        with mock.patch.object(webdav, "propfind", side_effect=webdav.WebdavError("listing boom")):
            status, payload = _post(base, "/import-remote", {
                "url": _BASE, "mode": "docx_numbered_lines", "language": "fr",
            })
            assert status == 202, payload
            job_id = payload["job"]["job_id"]
            job = _poll_job(base, job_id)
        assert job["status"] == "error", job
        assert job["error"]  # message captured, not silently swallowed
    finally:
        server.shutdown()
