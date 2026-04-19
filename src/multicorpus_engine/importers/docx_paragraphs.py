"""DOCX paragraphs importer.

Imports every non-empty paragraph as a line unit — no [n] numbering required.
The sequential paragraph position (1-based) is used as both n and external_id.

This makes all paragraphs alignable by position (monotone fallback alignment),
even when the source document has no explicit numbering convention.

See docs/DECISIONS.md ADR-012.
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

from ..unicode_policy import count_sep, normalize
from .docx_numbered_lines import ImportReport
from .import_guard import assert_not_duplicate_import
from .rich_text import para_to_rich_text

logger = logging.getLogger(__name__)


def _compute_file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def import_docx_paragraphs(
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
    """Import a DOCX file — every non-empty paragraph becomes a line unit.

    Unlike docx_numbered_lines, no [n] prefix is required. The sequential
    position (1-based) is stored as both n and external_id, so paragraphs
    are always monotone and gap-free.

    Returns an ImportReport. units_structure is always 0 (all units are lines).
    """
    try:
        import docx  # python-docx
    except ImportError as exc:
        raise ImportError("python-docx is required: pip install python-docx") from exc

    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"DOCX file not found: {path}")

    log = run_logger or logger
    log.info("Starting import of %s (mode=docx_paragraphs)", path)

    source_hash = _compute_file_hash(path)
    assert_not_duplicate_import(conn, path, source_hash, check_filename=check_filename)
    doc_title = title or path.stem
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Parse DOCX before opening the transaction (pure I/O, no DB writes yet)
    document = docx.Document(str(path))

    # First pass: collect paragraphs and detect headings
    para_data: list[tuple[str, int | None]] = []
    for para in document.paragraphs:
        text_raw = para_to_rich_text(para)
        if not normalize(text_raw).strip():
            continue
        heading_level: int | None = None
        style_name = (para.style.name or "") if para.style else ""
        if style_name.startswith("Heading"):
            try:
                heading_level = int(style_name.split()[-1])
            except ValueError:
                heading_level = 1
        para_data.append((text_raw, heading_level))

    # (unit_type, n, ext_id, text_raw, text_norm, meta, unit_role) — doc_id added after INSERT
    units_parsed: list[tuple] = []
    n = 0
    for text_raw, heading_level in para_data:
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
        units_parsed.append(("line", n, n, text_raw, text_norm, meta, unit_role))
        log.debug("Para n=%d type=line role=%s", n, unit_role)

    # Single transaction: document record + units
    try:
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
        has_headings = any(level is not None for _, level in para_data)
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
            [(doc_id, *row) for row in units_parsed],
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    n_headings = sum(1 for _, level in para_data if level is not None)
    report = ImportReport(
        doc_id=doc_id,
        units_total=len(units_parsed),
        units_line=len(units_parsed),
        units_structure=0,
        duplicates=[],
        holes=[],
        non_monotonic=[],
    )

    log.info("Import complete: %d paragraph units (%d headings)", report.units_total, n_headings)
    return report
