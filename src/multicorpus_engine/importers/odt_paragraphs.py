"""ODT paragraphs importer — same unit model as ``docx_paragraphs``."""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

from ..unicode_policy import count_sep, normalize
from .docx_numbered_lines import ImportReport
from .import_guard import assert_not_duplicate_import
from .odt_common import read_odt_paragraph_rich_lines
from .parsed import ParsedDoc, ParsedUnit, file_sha256, insert_units

logger = logging.getLogger(__name__)


def parse_odt_paragraphs(
    path: str | Path,
    run_logger: Optional[logging.Logger] = None,
) -> ParsedDoc:
    """Parse an ODT into one line unit per non-empty paragraph, WITHOUT touching
    the DB. Shared by ``import_odt_paragraphs`` and ``/import/preview`` (A-02).
    Sequential position (1-based) is both n and external_id; ``text:h`` headings
    get unit_role="intertitre" + meta heading_level.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"ODT file not found: {path}")

    _MAX_FILE_BYTES = 512 * 1024 * 1024  # 512 MiB
    if path.stat().st_size > _MAX_FILE_BYTES:
        raise ValueError(f"ODT file too large (max {_MAX_FILE_BYTES // (1024 * 1024)} MiB)")

    source_hash = file_sha256(path)

    units: list[ParsedUnit] = []
    n = 0
    for text_raw, heading_level in read_odt_paragraph_rich_lines(path):
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
        units.append(ParsedUnit(
            n=n, unit_type="line", text_raw=text_raw, text_norm=text_norm,
            external_id=n, meta_json=meta, unit_role=unit_role,
        ))

    return ParsedDoc(units=units, doc_meta={}, source_hash=source_hash)


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
    source_path: Optional[str] = None,
) -> ImportReport:
    """Import an ODT file — every non-empty ``text:p`` / ``text:h`` becomes a line unit."""
    path = Path(path)
    log = run_logger or logger
    log.info("Starting import of %s (mode=odt_paragraphs)", path)

    parsed = parse_odt_paragraphs(path, run_logger=run_logger)
    assert_not_duplicate_import(conn, path, parsed.source_hash, check_filename=check_filename)
    doc_title = title or path.stem
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    has_headings = any(u.unit_role == "intertitre" for u in parsed.units)
    n_headings = sum(1 for u in parsed.units if u.unit_role == "intertitre")

    try:
        cur = conn.execute(
            """
            INSERT INTO documents
                (title, language, doc_role, resource_type, meta_json, source_path, source_hash, created_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
            """,
            (doc_title, language, doc_role, resource_type, (source_path if source_path is not None else str(path)), parsed.source_hash, utcnow),
        )
        doc_id = cur.lastrowid
        log.info("Created document doc_id=%d title=%r", doc_id, doc_title)

        if has_headings:
            conn.execute(
                """
                INSERT OR IGNORE INTO unit_roles (name, label, color, icon, sort_order, category)
                VALUES ('intertitre', 'Intertitre', '#9333ea', '§', 0, 'structure')
                """
            )
        insert_units(conn, doc_id, parsed.units)
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    report = ImportReport(
        doc_id=doc_id,
        units_total=len(parsed.units),
        units_line=len(parsed.units),
        units_structure=0,
        duplicates=[],
        holes=[],
        non_monotonic=[],
    )
    log.info("Import complete: %d paragraph units (%d headings)", report.units_total, n_headings)
    return report
