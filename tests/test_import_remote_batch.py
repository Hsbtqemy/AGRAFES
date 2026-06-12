"""Integration tests for the WebDAV batch ingestion orchestration.

The WebDAV layer (propfind/download) is mocked; the import pipeline and a real
temp SQLite DB run for real, so provenance and dedup are exercised end to end.
"""

from __future__ import annotations

import io
from pathlib import Path
from unittest import mock

import pytest

from multicorpus_engine.db.connection import get_connection
from multicorpus_engine.db.migrations import apply_migrations
from multicorpus_engine.remote import ingest, webdav

_MIGRATIONS = Path(__file__).parent.parent / "migrations"
_BASE = "https://dav.example/folder/"


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
        size=size, modified=None, content_type=None,
    )


def _download_from(payloads: dict[str, bytes]):
    def _fake(url, dest_path, *, auth_header, max_bytes=None, timeout=30):
        data = payloads[url]
        if max_bytes is not None and len(data) > max_bytes:
            raise webdav.WebdavTooLarge(url)
        Path(dest_path).write_bytes(data)
        return len(data)
    return _fake


@pytest.fixture()
def db(tmp_path: Path):
    db_path = tmp_path / "corpus.db"
    conn = get_connection(db_path)
    apply_migrations(conn, migrations_dir=_MIGRATIONS)
    return conn, db_path


def _run(conn, db_path, entries, payloads, **kwargs):
    with mock.patch.object(ingest.webdav, "propfind", return_value=entries), \
         mock.patch.object(ingest.webdav, "download", _download_from(payloads)):
        return ingest.ingest_remote_folder(
            conn, db_path, url=_BASE, mode="docx_numbered_lines",
            language="fr", auth_header={}, **kwargs,
        )


def test_filters_non_matching_and_imports(db):
    conn, db_path = db
    a = _make_docx_bytes(["[1] Bonjour.", "[2] Monde."])
    b = _make_docx_bytes(["[1] Autre texte."])
    entries = [_entry("a.docx", len(a)), _entry("b.docx", len(b)), _entry("note.pdf", 10)]
    payloads = {_BASE + "a.docx": a, _BASE + "b.docx": b}

    report = _run(conn, db_path, entries, payloads)

    assert report["total"] == 3
    assert report["imported"] == 2
    assert report["skipped_filtered"] == 1  # the .pdf
    assert report["errors"] == 0

    # Provenance: source_path is the remote URL, not the temp path.
    paths = [r["source_path"] for r in conn.execute("SELECT source_path FROM documents").fetchall()]
    assert sorted(paths) == [_BASE + "a.docx", _BASE + "b.docx"]


def test_rerun_is_idempotent_via_dedup(db):
    conn, db_path = db
    a = _make_docx_bytes(["[1] Bonjour.", "[2] Monde."])
    entries = [_entry("a.docx", len(a))]
    payloads = {_BASE + "a.docx": a}

    first = _run(conn, db_path, entries, payloads)
    assert first["imported"] == 1

    second = _run(conn, db_path, entries, payloads)
    assert second["imported"] == 0
    assert second["skipped_duplicate"] == 1
    # No second document created.
    assert conn.execute("SELECT COUNT(*) AS c FROM documents").fetchone()["c"] == 1


def test_per_file_download_error_does_not_abort_batch(db):
    conn, db_path = db
    good = _make_docx_bytes(["[1] Bonjour."])
    entries = [_entry("bad.docx", 500), _entry("good.docx", len(good))]
    payloads = {_BASE + "good.docx": good}  # bad.docx absent → KeyError-free explicit raise

    def _dl(url, dest_path, *, auth_header, max_bytes=None, timeout=30):
        if url.endswith("bad.docx"):
            raise webdav.WebdavError("simulated download failure")
        Path(dest_path).write_bytes(payloads[url])
        return len(payloads[url])

    with mock.patch.object(ingest.webdav, "propfind", return_value=entries), \
         mock.patch.object(ingest.webdav, "download", _dl):
        report = ingest.ingest_remote_folder(
            conn, db_path, url=_BASE, mode="docx_numbered_lines",
            language="fr", auth_header={},
        )

    assert report["imported"] == 1
    assert report["errors"] == 1
    statuses = {r["name"]: r["status"] for r in report["files"]}
    assert statuses["bad.docx"] == "error"
    assert statuses["good.docx"] == "imported"


def test_oversize_is_skipped_without_download(db):
    conn, db_path = db
    entries = [_entry("big.docx", size=10 * 1024 * 1024)]  # 10 MiB declared

    download = mock.Mock(side_effect=AssertionError("download must not be called for oversize"))
    with mock.patch.object(ingest.webdav, "propfind", return_value=entries), \
         mock.patch.object(ingest.webdav, "download", download):
        report = ingest.ingest_remote_folder(
            conn, db_path, url=_BASE, mode="docx_numbered_lines",
            language="fr", auth_header={}, max_file_mb=1,
        )

    assert report["skipped_oversize"] == 1
    assert report["imported"] == 0
    download.assert_not_called()


def test_blocking_propfind_error_propagates(db):
    conn, db_path = db
    with mock.patch.object(ingest.webdav, "propfind", side_effect=webdav.WebdavAuthError("401")):
        with pytest.raises(webdav.WebdavAuthError):
            ingest.ingest_remote_folder(
                conn, db_path, url=_BASE, mode="docx_numbered_lines",
                language="fr", auth_header={},
            )
