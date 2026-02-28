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

    document = docx.Document(str(path))
    units_to_insert: list[tuple] = []
    n = 0

    for para in document.paragraphs:
        text = para.text.strip()
        if not text:
            continue  # skip blank paragraphs

        n += 1
        text_raw = text
        text_norm = normalize(text_raw)
        sep_count = count_sep(text_raw)
        meta = json.dumps({"sep_count": sep_count}) if sep_count > 0 else None

        # external_id = n (sequential, always monotone)
        units_to_insert.append(
            (doc_id, "line", n, n, text_raw, text_norm, meta)
        )
        log.debug("Para n=%d type=line", n)

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
