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
from pathlib import Path
from typing import Optional

from ..importers.dispatch import dispatch_import
from ..runs import create_run, setup_run_logger, update_run_stats
from . import webdav

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
    doc_role: str = "standalone",
    resource_type: Optional[str] = None,
    auth_header: dict,
    max_file_mb: Optional[float] = 200.0,
    logger: Optional[logging.Logger] = None,
) -> dict:
    """Import every matching file in the WebDAV folder at *url*. Returns a report.

    Raises ``webdav.WebdavError`` (or a subclass) only for *blocking* failures
    (e.g. the folder PROPFIND itself fails). Per-file failures are captured in the
    report and never abort the batch.
    """
    db_path = Path(db_path)
    max_bytes = int(max_file_mb * 1024 * 1024) if max_file_mb else None

    entries = webdav.propfind(url, auth_header=auth_header)
    files = [e for e in entries if not e.is_dir]

    results: list[dict] = []
    tmpdir = Path(tempfile.mkdtemp(prefix="agrafes_webdav_"))
    try:
        for entry in files:
            res = _process_one(
                conn, db_path, entry,
                mode=mode, language=language, include=include,
                doc_role=doc_role, resource_type=resource_type,
                auth_header=auth_header, max_bytes=max_bytes, tmpdir=tmpdir,
            )
            results.append(res)
            if logger is not None:
                logger.info("import-remote %s -> %s", entry.name, res["status"])
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
) -> dict:
    base = {"source_url": entry.href, "name": entry.name, "doc_id": None}

    # 1. Extension / glob filter.
    if not _matches(entry.name, mode, include):
        return {**base, "status": "skipped-filtered"}

    # 2. Oversize pre-check (when the server declared a size).
    if max_bytes is not None and entry.size is not None and entry.size > max_bytes:
        return {**base, "status": "skipped-oversize", "size": entry.size}

    # 3. Download to a generated temp name (never trust the server name for the
    #    local path — path-traversal guard).
    fd, tmp_name = tempfile.mkstemp(suffix=Path(entry.name).suffix, dir=str(tmpdir))
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        webdav.download(entry.href, tmp_path, auth_header=auth_header, max_bytes=max_bytes)
    except webdav.WebdavTooLarge:
        return {**base, "status": "skipped-oversize", "size": entry.size}
    except webdav.WebdavError as exc:
        return {**base, "status": "error", "error": str(exc)}

    # 4. Dedup by content hash (same hash the importers persist as source_hash).
    digest = _sha256(tmp_path)
    row = conn.execute(
        "SELECT doc_id FROM documents WHERE source_hash = ? LIMIT 1", (digest,)
    ).fetchone()
    if row is not None:
        return {**base, "status": "skipped-duplicate", "doc_id": row["doc_id"], "source_hash": digest}

    # 5. Import — one run per file (1-file-1-run model, unchanged).
    run_id = create_run(conn, "import-remote", {"url": entry.href, "mode": mode})
    log, _ = setup_run_logger(db_path, run_id)
    try:
        report = dispatch_import(
            conn, mode=mode, path=str(tmp_path), language=language,
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
