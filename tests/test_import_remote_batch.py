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
from multicorpus_engine.importers.dispatch import dispatch_import
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


def test_doc_title_uses_original_remote_name_not_temp(db):
    """The imported doc is titled from the ORIGINAL remote filename, not the
    generated mkstemp temp path. Regression: WebDAV imports showed up titled
    `tmpXXXX` because the importer derived the title from the local temp file."""
    conn, db_path = db
    a = _make_docx_bytes(["[1] Bonjour.", "[2] Monde."])
    entries = [_entry("Mon Roman.docx", len(a))]
    payloads = {_BASE + "Mon Roman.docx": a}

    report = _run(conn, db_path, entries, payloads)
    assert report["imported"] == 1

    titles = [r["title"] for r in conn.execute("SELECT title FROM documents").fetchall()]
    assert titles == ["Mon Roman"]  # original stem, identical to a local import
    assert not titles[0].startswith("tmp")


# --- SID-05: atomic provenance (source_path written in the import transaction) ---


def test_dispatch_source_path_override_is_stored_else_local_path(db):
    """SID-05 mechanism: ``dispatch_import(..., source_path=URL)`` stores the
    override in ``documents.source_path`` (written in the importer's own INSERT),
    while the default ``None`` keeps the local path — local imports unchanged."""
    conn, db_path = db
    local = db_path.parent / "Mon Doc.txt"
    local.write_text("[1] Bonjour.\n[2] Monde.\n", encoding="utf-8")
    dispatch_import(
        conn, mode="txt_numbered_lines", path=str(local), language="fr",
        source_path="https://dav.example/folder/Mon Doc.txt",
    )

    # Default (no override) keeps the local path — different bytes so the
    # content-hash dedup guard does not fire.
    other = db_path.parent / "Autre.txt"
    other.write_text("[1] Un autre contenu entierement.\n", encoding="utf-8")
    dispatch_import(
        conn, mode="txt_numbered_lines", path=str(other), language="fr",
    )

    rows = {r["title"]: r["source_path"]
            for r in conn.execute("SELECT title, source_path FROM documents")}
    assert rows["Mon Doc"] == "https://dav.example/folder/Mon Doc.txt"
    assert rows["Autre"] == str(other)


class _CrashAfterImportCommit:
    """Connection proxy that simulates a process crash on the first commit AFTER
    a document row has been committed: it discards the still-open transaction
    (as a real crash loses uncommitted work) and raises. Proves SID-05 — the
    provenance must already be durable at that point, not pending a 2nd commit."""

    def __init__(self, real):
        self._real = real
        self._doc_committed = False

    def commit(self):
        if self._doc_committed:
            self._real.rollback()  # lose the uncommitted txn, as a crash would
            raise RuntimeError("simulated crash right after the import commit")
        self._real.commit()
        if self._real.execute("SELECT COUNT(*) FROM documents").fetchone()[0] > 0:
            self._doc_committed = True

    def __getattr__(self, name):
        return getattr(self._real, name)


def test_provenance_survives_crash_after_import_commit(db):
    """SID-05: the remote URL is written inside the importer's transaction, so a
    crash on the NEXT commit can never leave ``source_path`` = the throwaway temp
    path. The old two-phase code (import-commit, then a separate UPDATE + commit)
    left the temp path here; the atomic version keeps the remote URL."""
    conn, db_path = db
    a = _make_docx_bytes(["[1] Bonjour.", "[2] Monde."])
    entries = [_entry("Mon Roman.docx", len(a))]
    payloads = {_BASE + "Mon Roman.docx": a}
    crashy = _CrashAfterImportCommit(conn)

    with mock.patch.object(ingest.webdav, "propfind", return_value=entries), \
         mock.patch.object(ingest.webdav, "download", _download_from(payloads)):
        report = ingest.ingest_remote_folder(
            crashy, db_path, url=_BASE, mode="docx_numbered_lines",
            language="fr", auth_header={},
        )

    # The post-import commit crashed -> the file is reported as an error...
    assert report["errors"] == 1
    # ...but the document the importer already committed must carry the REMOTE
    # URL as provenance, never the temp path.
    rows = conn.execute("SELECT source_path FROM documents").fetchall()
    assert len(rows) == 1
    assert rows[0]["source_path"] == _BASE + "Mon Roman.docx"
    assert "agrafes_webdav_" not in rows[0]["source_path"]


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


# --- Phase 2 additive params: progress + critical_section ----------------------


def test_progress_called_once_per_file(db):
    conn, db_path = db
    a = _make_docx_bytes(["[1] Bonjour."])
    entries = [_entry("a.docx", len(a)), _entry("note.pdf", 10)]
    payloads = {_BASE + "a.docx": a}

    events: list[dict] = []
    report = _run(conn, db_path, entries, payloads, progress=events.append)

    assert report["imported"] == 1
    assert [e["index"] for e in events] == [1, 2]  # one call per file, 1-based
    assert all(e["total"] == 2 for e in events)
    statuses = {e["name"]: e["status"] for e in events}
    assert statuses == {"a.docx": "imported", "note.pdf": "skipped-filtered"}


def test_critical_section_wraps_db_section_after_download(db):
    """The DB section runs under the critical section; the download stays outside
    it (P2 §D3 — never hold the write-lock during network I/O)."""
    conn, db_path = db
    a = _make_docx_bytes(["[1] Bonjour."])
    entries = [_entry("a.docx", len(a))]
    payloads = {_BASE + "a.docx": a}

    log: list[str] = []

    class _TrackingCM:
        def __enter__(self):
            log.append("cm_enter")
            return self

        def __exit__(self, *exc):
            log.append("cm_exit")
            return False

    def _dl(url, dest_path, *, auth_header, max_bytes=None, timeout=30):
        log.append("download")
        Path(dest_path).write_bytes(payloads[url])
        return len(payloads[url])

    with mock.patch.object(ingest.webdav, "propfind", return_value=entries), \
         mock.patch.object(ingest.webdav, "download", _dl):
        report = ingest.ingest_remote_folder(
            conn, db_path, url=_BASE, mode="docx_numbered_lines",
            language="fr", auth_header={}, critical_section=_TrackingCM(),
        )

    assert report["imported"] == 1
    # Download completes BEFORE the DB critical section is entered, and the
    # section is closed before the file is done.
    assert log == ["download", "cm_enter", "cm_exit"]


def test_runs_params_never_contain_credentials(db):
    """The Authorization header is used to fetch but is never written to
    runs.params_json (§D2/§6) — only url + mode are persisted."""
    conn, db_path = db
    a = _make_docx_bytes(["[1] Bonjour."])
    entries = [_entry("a.docx", len(a))]
    payloads = {_BASE + "a.docx": a}
    secret_auth = {"Authorization": "Basic c2VjcmV0OnBhc3N3b3Jk"}  # secret:password

    with mock.patch.object(ingest.webdav, "propfind", return_value=entries), \
         mock.patch.object(ingest.webdav, "download", _download_from(payloads)):
        report = ingest.ingest_remote_folder(
            conn, db_path, url=_BASE, mode="docx_numbered_lines",
            language="fr", auth_header=secret_auth,
        )

    assert report["imported"] == 1
    rows = conn.execute(
        "SELECT params_json FROM runs WHERE kind = 'import-remote'"
    ).fetchall()
    assert rows
    for (params_json,) in rows:
        blob = params_json or ""
        assert "Authorization" not in blob
        assert "Basic" not in blob
        assert "c2VjcmV0" not in blob  # base64 of the secret


# --- Phase 4C: explicit file selection (only_hrefs) ----------------------------


def test_only_hrefs_restricts_batch_to_selection(db):
    conn, db_path = db
    a = _make_docx_bytes(["[1] A."])
    b = _make_docx_bytes(["[1] B."])
    c = _make_docx_bytes(["[1] C."])
    entries = [_entry("a.docx", len(a)), _entry("b.docx", len(b)), _entry("c.docx", len(c))]
    payloads = {_BASE + "a.docx": a, _BASE + "b.docx": b, _BASE + "c.docx": c}

    report = _run(conn, db_path, entries, payloads,
                  only_hrefs={_BASE + "a.docx", _BASE + "c.docx"})

    assert report["total"] == 2  # b.docx is not even in the batch
    assert report["imported"] == 2
    assert {r["name"] for r in report["files"]} == {"a.docx", "c.docx"}


def test_only_hrefs_unknown_href_is_ignored_and_never_fetched(db):
    """An href not present in the PROPFIND listing is dropped — never downloaded
    (same-origin / SSRF guard: only_hrefs filters the trusted listing, P4C §9.4)."""
    conn, db_path = db
    a = _make_docx_bytes(["[1] A."])
    entries = [_entry("a.docx", len(a))]
    payloads = {_BASE + "a.docx": a}
    fetched: list[str] = []

    def _dl(url, dest_path, *, auth_header, max_bytes=None, timeout=30):
        fetched.append(url)
        Path(dest_path).write_bytes(payloads[url])
        return len(payloads[url])

    ghost = _BASE + "ghost.docx"
    with mock.patch.object(ingest.webdav, "propfind", return_value=entries), \
         mock.patch.object(ingest.webdav, "download", _dl):
        report = ingest.ingest_remote_folder(
            conn, db_path, url=_BASE, mode="docx_numbered_lines",
            language="fr", auth_header={}, only_hrefs={_BASE + "a.docx", ghost},
        )

    assert report["total"] == 1
    assert report["imported"] == 1
    assert fetched == [_BASE + "a.docx"]  # ghost never fetched


def test_only_hrefs_bypasses_extension_filter(db):
    """An explicit selection imports the chosen file even if its name does not match
    the mode's extension (the user picked it deliberately); the same file is
    skipped-filtered without an explicit selection."""
    conn, db_path = db
    data = _make_docx_bytes(["[1] Bonjour."])  # real docx bytes, non-.docx name
    entries = [_entry("note.pdf", len(data))]
    payloads = {_BASE + "note.pdf": data}

    # Sanity: without a selection, the glob/extension filter drops it.
    base = _run(conn, db_path, entries, payloads)
    assert base["skipped_filtered"] == 1
    assert base["imported"] == 0

    # With an explicit selection, the glob is bypassed → it is imported.
    report = _run(conn, db_path, entries, payloads, only_hrefs={_BASE + "note.pdf"})
    assert report["imported"] == 1
    assert report["skipped_filtered"] == 0


# --- SID-15: per-file temp purge keeps disk ~1 file, not the whole batch ---
def test_temp_freed_per_file_so_disk_does_not_grow(db):
    conn, db_path = db
    payloads = {_BASE + f"d{i}.docx": _make_docx_bytes([f"[1] line {i}"]) for i in range(1, 4)}
    entries = [_entry(f"d{i}.docx", len(payloads[_BASE + f"d{i}.docx"])) for i in range(1, 4)]
    counts: list[int] = []

    def _recording_download(url, dest_path, *, auth_header, max_bytes=None, timeout=30):
        # At download time only the CURRENT file's freshly-mkstemp'd temp should be
        # present; previous files' temps must already be purged (SID-15). Without the
        # per-file cleanup this count would grow 1 → 2 → 3 across the batch.
        counts.append(len(list(Path(dest_path).parent.iterdir())))
        Path(dest_path).write_bytes(payloads[url])
        return len(payloads[url])

    with mock.patch.object(ingest.webdav, "propfind", return_value=entries), \
         mock.patch.object(ingest.webdav, "download", _recording_download):
        report = ingest.ingest_remote_folder(
            conn, db_path, url=_BASE, mode="docx_numbered_lines",
            language="fr", auth_header={},
        )

    assert report["imported"] == 3
    assert counts == [1, 1, 1]
