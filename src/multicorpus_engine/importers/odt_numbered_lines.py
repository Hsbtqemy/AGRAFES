"""ODT numbered-lines importer — same ``[n]`` convention as ``docx_numbered_lines``."""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from pathlib import Path
from typing import Optional

from ..unicode_policy import count_sep, normalize
from .docx_numbered_lines import (
    ImportReport,
    _analyze_external_ids,
    _compute_file_hash,
)
from .import_guard import assert_not_duplicate_import
from .odt_common import read_odt_paragraph_lines

_NUMBERED_RE = re.compile(r"^\[\s*(\d+)\s*\]\s*(.+)$", re.DOTALL)

logger = logging.getLogger(__name__)


def import_odt_numbered_lines(
    conn: sqlite3.Connection,
    path: str | Path,
    language: str,
    title: Optional[str] = None,
    doc_role: str = "standalone",
    resource_type: Optional[str] = None,
    run_id: Optional[str] = None,
    run_logger: Optional[logging.Logger] = None,
) -> ImportReport:
    """Import an ODT file using the numbered-lines ``[n]`` convention (see ADR-001)."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"ODT file not found: {path}")

    log = run_logger or logger
    log.info("Starting import of %s (mode=odt_numbered_lines)", path)

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
        paragraphs = read_odt_paragraph_lines(path)
    except (FileNotFoundError, ValueError) as exc:
        conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
        conn.commit()
        raise exc

    external_ids: list[int] = []
    units_to_insert: list[tuple] = []

    n = 0
    for raw_para in paragraphs:
        para = raw_para.strip()
        if not para:
            continue

        n += 1
        m = _NUMBERED_RE.match(para)
        if m:
            ext_id = int(m.group(1))
            text_raw = m.group(2)
            text_norm = normalize(text_raw)
            sep_count = count_sep(text_raw)
            meta = json.dumps({"sep_count": sep_count}) if sep_count > 0 else None
            unit_type = "line"
            external_ids.append(ext_id)
            units_to_insert.append(
                (doc_id, unit_type, n, ext_id, text_raw, text_norm, meta)
            )
            log.debug("Para n=%d ext_id=%d type=line", n, ext_id)
        else:
            text_raw = para
            text_norm = normalize(text_raw)
            unit_type = "structure"
            units_to_insert.append(
                (doc_id, unit_type, n, None, text_raw, text_norm, None)
            )
            log.debug("Para n=%d type=structure", n)

    conn.executemany(
        """
        INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        units_to_insert,
    )
    conn.commit()

    duplicates, holes, non_monotonic = _analyze_external_ids(external_ids)

    report = ImportReport(
        doc_id=doc_id,
        units_total=len(units_to_insert),
        units_line=len(external_ids),
        units_structure=len(units_to_insert) - len(external_ids),
        duplicates=duplicates,
        holes=holes,
        non_monotonic=non_monotonic,
    )

    if duplicates:
        msg = f"Duplicate external_id(s) found: {duplicates}"
        report.warnings.append(msg)
        log.warning(msg)
    if holes:
        msg = f"Holes in external_id sequence: {holes}"
        report.warnings.append(msg)
        log.warning(msg)
    if non_monotonic:
        msg = f"Non-monotonic external_id(s): {non_monotonic}"
        report.warnings.append(msg)
        log.warning(msg)

    log.info(
        "Import complete: %d units (%d line, %d structure)",
        report.units_total,
        report.units_line,
        report.units_structure,
    )
    return report
