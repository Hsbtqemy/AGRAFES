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
from .odt_common import read_odt_paragraph_rich_lines

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
    check_filename: bool = False,
) -> ImportReport:
    """Import an ODT file — every non-empty ``text:p`` / ``text:h`` becomes a line unit."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"ODT file not found: {path}")

    _MAX_FILE_BYTES = 512 * 1024 * 1024  # 512 MiB
    if path.stat().st_size > _MAX_FILE_BYTES:
        raise ValueError(f"ODT file too large (max {_MAX_FILE_BYTES // (1024 * 1024)} MiB)")

    log = run_logger or logger
    log.info("Starting import of %s (mode=odt_paragraphs)", path)

    source_hash = _compute_file_hash(path)
    assert_not_duplicate_import(conn, path, source_hash, check_filename=check_filename)
    doc_title = title or path.stem
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        para_texts = read_odt_paragraph_rich_lines(path)

        cur = conn.execute(
            """
            INSERT INTO documents
                (title, language, doc_role, resource_type, meta_json, source_path, source_hash, created_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
            """,
            (doc_title, language, doc_role, resource_type, str(path), source_hash, utcnow),
        )
        doc_id = cur.lastrowid
        log.info("Created document doc_id=%d title=%r", doc_id, doc_title)

        units_to_insert: list[tuple] = []
        n = 0

        for text_raw, heading_level in para_texts:
            n += 1
            text_norm = normalize(text_raw)
            sep_count = count_sep(text_raw)
            meta_dict: dict = {}
            if sep_count > 0:
                meta_dict["sep_count"] = sep_count
            if heading_level is not None:
                meta_dict["heading_level"] = heading_level
            meta = json.dumps(meta_dict) if meta_dict else None
            unit_role = "intertitre" if heading_level is not None else None
            units_to_insert.append((doc_id, "line", n, n, text_raw, text_norm, meta, unit_role))

        has_headings = any(level is not None for _, level in para_texts)
        if has_headings:
            conn.execute(
                """
                INSERT OR IGNORE INTO unit_roles (name, label, color, icon, sort_order, category)
                VALUES ('intertitre', 'Intertitre', '#9333ea', '§', 0, 'structure')
                """
            )
        conn.executemany(
            """
            INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json, unit_role)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            units_to_insert,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    n_headings = sum(1 for _, level in para_texts if level is not None)
    report = ImportReport(
        doc_id=doc_id,
        units_total=len(units_to_insert),
        units_line=len(units_to_insert),
        units_structure=0,
        duplicates=[],
        holes=[],
        non_monotonic=[],
    )
    log.info("Import complete: %d paragraph units (%d headings)", report.units_total, n_headings)
    return report
