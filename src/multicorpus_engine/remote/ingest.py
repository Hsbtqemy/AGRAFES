"""Batch ingestion of a remote WebDAV folder into the local corpus.

Browse a collection, then for each matching file: download to a temp file,
dedup by content hash, import via the shared :func:`dispatch_import`, and attach
the remote URL as provenance. Returns a structured batch report.

This orchestration is intentionally UI-agnostic so the sidecar's
``POST /import-remote`` handler (Phase 2) can reuse it verbatim.
See docs/DESIGN_sharedocs_ingestion.md §4.
"""

from __future__ import annotations

import fnmatch
import hashlib
import logging
import os
import shutil
import sqlite3
import tempfile
from contextlib import AbstractContextManager, nullcontext
from pathlib import Path
from typing import Callable, Optional

from ..importers.dispatch import dispatch_import
from ..runs import create_run, setup_run_logger, update_run_stats
from . import webdav

#: Per-file progress callback signature. Invoked once per file with a small dict
#: ``{index, total, name, status}`` (1-based index). UI-agnostic — the sidecar
#: maps it onto ``JobManager`` progress, the CLI leaves it ``None``.
ProgressCb = Callable[[dict], None]

# Filename extension(s) implied by each import mode (used when no --include glob
# is given). Anything not matching is reported as ``skipped-filtered``.
_MODE_EXTENSIONS = {
    "docx_numbered_lines": (".docx",),
    "docx_paragraphs": (".docx",),
    "odt_numbered_lines": (".odt",),
    "odt_paragraphs": (".odt",),
    "txt_numbered_lines": (".txt",),
    "tei": (".xml",),
    "conllu": (".conllu",),
}


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _matches(name: str, mode: str, include: Optional[str]) -> bool:
    if include:
        return fnmatch.fnmatch(name.lower(), include.lower())
    exts = _MODE_EXTENSIONS.get(mode, ())
    return name.lower().endswith(exts) if exts else True


def ingest_remote_folder(
    conn: sqlite3.Connection,
    db_path: str | Path,
    *,
    url: str,
    mode: str,
    language: Optional[str] = None,
    include: Optional[str] = None,
    only_hrefs: Optional[set[str]] = None,
    doc_role: str = "standalone",
    resource_type: Optional[str] = None,
    auth_header: dict,
    max_file_mb: Optional[float] = 200.0,
    logger: Optional[logging.Logger] = None,
    progress: Optional[ProgressCb] = None,
    critical_section: Optional[AbstractContextManager] = None,
) -> dict:
    """Import every matching file in the WebDAV folder at *url*. Returns a report.

    Raises ``webdav.WebdavError`` (or a subclass) only for *blocking* failures
    (e.g. the folder PROPFIND itself fails). Per-file failures are captured in the
    report and never abort the batch.

    *only_hrefs* (optional, P4C explicit selection) restricts the batch to the
    given file hrefs, **intersected with the PROPFIND listing** — an href the
    server did not list is ignored (never fetched). The glob/extension filter is
    bypassed for the selection (the user picked these files deliberately).

    *progress* (optional) is invoked once per file with ``{index, total, name,
    status}`` so a caller (the sidecar job runner) can surface live per-file
    progress; the CLI leaves it ``None``.

    *critical_section* (optional) is an ``AbstractContextManager`` wrapped around
    **only** the DB section of each file (dedup + import + provenance UPDATE). The
    download stays *outside* it so a long batch never holds the lock during
    network I/O (sidecar passes its write-lock, R-01b; the CLI passes ``None`` →
    no-op). See docs/TICKET_SHAREDOCS_INGESTION_P2_SIDECAR.md §D3.
    """
    db_path = Path(db_path)
    max_bytes = int(max_file_mb * 1024 * 1024) if max_file_mb else None

    entries = webdav.propfind(url, auth_header=auth_header)
    files = [e for e in entries if not e.is_dir]
    # Explicit selection (P4C): keep only the chosen files, **intersected with the
    # trusted PROPFIND listing** — we never download a client-supplied href the
    # server did not list, so the same-origin / SSRF guard of webdav.propfind stays
    # intact. The glob/extension filter is then bypassed (the user picked these
    # files deliberately); an incompatible file simply errors per-file at import.
    explicit = only_hrefs is not None
    if explicit:
        files = [e for e in files if e.href in only_hrefs]
    total = len(files)

    results: list[dict] = []
    tmpdir = Path(tempfile.mkdtemp(prefix="agrafes_webdav_"))
    try:
        for index, entry in enumerate(files, start=1):
            res = _process_one(
                conn, db_path, entry,
                mode=mode, language=language, include=include,
                doc_role=doc_role, resource_type=resource_type,
                auth_header=auth_header, max_bytes=max_bytes, tmpdir=tmpdir,
                critical_section=critical_section,
                explicit=explicit,
            )
            results.append(res)
            if logger is not None:
                logger.info("import-remote %s -> %s", entry.name, res["status"])
            if progress is not None:
                progress({"index": index, "total": total, "name": entry.name, "status": res["status"]})
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    return _summarize(url, mode, results)


def _process_one(
    conn: sqlite3.Connection,
    db_path: Path,
    entry: webdav.RemoteEntry,
    *,
    mode: str,
    language: Optional[str],
    include: Optional[str],
    doc_role: str,
    resource_type: Optional[str],
    auth_header: dict,
    max_bytes: Optional[int],
    tmpdir: Path,
    critical_section: Optional[AbstractContextManager] = None,
    explicit: bool = False,
) -> dict:
    base = {"source_url": entry.href, "name": entry.name, "doc_id": None}

    # 1. Extension / glob filter — skipped for an explicit P4C selection (the user
    #    chose this file; a mode-incompatible file errors per-file at import below).
    if not explicit and not _matches(entry.name, mode, include):
        return {**base, "status": "skipped-filtered"}

    # 2. Oversize pre-check (when the server declared a size).
    if max_bytes is not None and entry.size is not None and entry.size > max_bytes:
        return {**base, "status": "skipped-oversize", "size": entry.size}

    # 3. Download to a generated temp name (never trust the server name for the
    #    local path — path-traversal guard). Network I/O — stays OUTSIDE the
    #    critical section so a batch never holds the DB lock during a download.
    fd, tmp_name = tempfile.mkstemp(suffix=Path(entry.name).suffix, dir=str(tmpdir))
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        webdav.download(entry.href, tmp_path, auth_header=auth_header, max_bytes=max_bytes)
    except webdav.WebdavTooLarge:
        return {**base, "status": "skipped-oversize", "size": entry.size}
    except webdav.WebdavError as exc:
        return {**base, "status": "error", "error": str(exc)}

    # 4. Hash the downloaded bytes (file I/O / CPU, no DB) — also outside the lock.
    digest = _sha256(tmp_path)

    # 5. DB section: dedup + import + provenance UPDATE. Serialized under the
    #    caller's critical section (sidecar write-lock; CLI = no-op).
    cm = critical_section if critical_section is not None else nullcontext()
    with cm:
        row = conn.execute(
            "SELECT doc_id FROM documents WHERE source_hash = ? LIMIT 1", (digest,)
        ).fetchone()
        if row is not None:
            return {**base, "status": "skipped-duplicate", "doc_id": row["doc_id"], "source_hash": digest}

        # Import — one run per file (1-file-1-run model, unchanged).
        run_id = create_run(conn, "import-remote", {"url": entry.href, "mode": mode})
        log, _ = setup_run_logger(db_path, run_id)
        try:
            report = dispatch_import(
                conn, mode=mode, path=str(tmp_path), language=language,
                # Title from the ORIGINAL remote name, not the generated temp file
                # (the local path is a mkstemp `tmpXXXX` for the path-traversal guard;
                # without this the doc would be titled `tmpXXXX`). Matches a local
                # import of the same filename (importers default to `path.stem`).
                title=Path(entry.name).stem,
                doc_role=doc_role, resource_type=resource_type,
                run_id=run_id, run_logger=log,
            )
            stats = report.to_dict()
            doc_id = stats.get("doc_id")
            # Provenance: replace the temp path with the remote URL (source_hash stays).
            if doc_id:
                conn.execute(
                    "UPDATE documents SET source_path = ? WHERE doc_id = ?", (entry.href, doc_id)
                )
                conn.commit()
            update_run_stats(conn, run_id, {**stats, "source_url": entry.href})
            return {
                **base,
                "status": "imported",
                "doc_id": doc_id,
                "run_id": run_id,
                "source_hash": digest,
                "units_total": stats.get("units_total"),
                "units_line": stats.get("units_line"),
            }
        except Exception as exc:  # per-file import failure — report and continue
            if log is not None:
                log.error("import-remote failed for %s: %s", entry.href, exc)
            return {**base, "status": "error", "run_id": run_id, "error": str(exc)}


def _summarize(url: str, mode: str, results: list[dict]) -> dict:
    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {
        "url": url,
        "mode": mode,
        "total": len(results),
        "imported": counts.get("imported", 0),
        "skipped_duplicate": counts.get("skipped-duplicate", 0),
        "skipped_filtered": counts.get("skipped-filtered", 0),
        "skipped_oversize": counts.get("skipped-oversize", 0),
        "errors": counts.get("error", 0),
        "files": results,
    }
