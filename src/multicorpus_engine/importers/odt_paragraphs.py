"""ODT paragraphs importer — same unit model as ``docx_paragraphs``."""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

from ..unicode_policy import count_sep, normalize
from .docx_numbered_lines import ImportReport
from .docx_paragraphs import _compute_file_hash
from .import_guard import assert_not_duplicate_import
from .odt_common import read_odt_paragraph_lines

logger = logging.getLogger(__name__)


def import_odt_paragraphs(
    conn: sqlite3.Connection,
    path: str | Path,
    language: str,
    title: Optional[str] = None,
    doc_role: str = "standalone",
    resource_type: Optional[str] = None,
    run_id: Optional[str] = None,
    run_logger: Optional[logging.Logger] = None,
) -> ImportReport:
    """Import an ODT file — every non-empty ``text:p`` / ``text:h`` becomes a line unit."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"ODT file not found: {path}")

    log = run_logger or logger
    log.info("Starting import of %s (mode=odt_paragraphs)", path)

    source_hash = _compute_file_hash(path)
    assert_not_duplicate_import(conn, path, source_hash)
    doc_title = title or path.stem
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    cur = conn.execute(
        """
        INSERT INTO documents
            (title, language, doc_role, resource_type, meta_json, source_path, source_hash, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
        """,
        (doc_title, language, doc_role, resource_type, str(path), source_hash, utcnow),
    )
    doc_id = cur.lastrowid
    conn.commit()

    log.info("Created document doc_id=%d title=%r", doc_id, doc_title)

    try:
        para_texts = read_odt_paragraph_lines(path)
    except (FileNotFoundError, ValueError) as exc:
        conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
        conn.commit()
        raise exc

    units_to_insert: list[tuple] = []
    n = 0
    for text in para_texts:
        n += 1
        text_raw = text
        text_norm = normalize(text_raw)
        sep_count = count_sep(text_raw)
        meta = json.dumps({"sep_count": sep_count}) if sep_count > 0 else None
        units_to_insert.append((doc_id, "line", n, n, text_raw, text_norm, meta))

    conn.executemany(
        """
        INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        units_to_insert,
    )
    conn.commit()

    report = ImportReport(
        doc_id=doc_id,
        units_total=len(units_to_insert),
        units_line=len(units_to_insert),
        units_structure=0,
        duplicates=[],
        holes=[],
        non_monotonic=[],
    )
    log.info("Import complete: %d paragraph units", report.units_total)
    return report
