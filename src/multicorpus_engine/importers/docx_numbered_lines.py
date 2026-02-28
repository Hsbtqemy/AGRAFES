"""DOCX numbered-lines importer.

Reads a DOCX file where numbered paragraphs follow the pattern:
    [n] text content here

Rules (see docs/DECISIONS.md ADR-001, ADR-002, ADR-003):
- Paragraphs matching r'^\\[\\s*(\\d+)\\s*\\]\\s*(.+)$' → unit_type="line"
  - external_id = int(match.group(1))
  - text_raw = match.group(2) (prefix stripped, ¤ kept)
  - text_norm = normalize(text_raw)
- Non-matching paragraphs → unit_type="structure", external_id=NULL, NOT indexed
- Diagnostics: duplicates, holes, non-monotonic sequence
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ..unicode_policy import count_sep, normalize

_NUMBERED_RE = re.compile(r"^\[\s*(\d+)\s*\]\s*(.+)$", re.DOTALL)

logger = logging.getLogger(__name__)


@dataclass
class ImportReport:
    doc_id: int = 0
    units_total: int = 0
    units_line: int = 0
    units_structure: int = 0
    duplicates: list[int] = field(default_factory=list)
    holes: list[int] = field(default_factory=list)
    non_monotonic: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "units_total": self.units_total,
            "units_line": self.units_line,
            "units_structure": self.units_structure,
            "duplicates": self.duplicates,
            "holes": self.holes,
            "non_monotonic": self.non_monotonic,
            "warnings": self.warnings,
        }


def _compute_file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _analyze_external_ids(external_ids: list[int]) -> tuple[list[int], list[int], list[int]]:
    """Return (duplicates, holes, non_monotonic) from a sequence of external_ids."""
    seen: dict[int, int] = {}
    duplicates: list[int] = []
    non_monotonic: list[int] = []

    for i, eid in enumerate(external_ids):
        if eid in seen:
            if eid not in duplicates:
                duplicates.append(eid)
        seen[eid] = i
        if i > 0 and eid <= external_ids[i - 1]:
            non_monotonic.append(eid)

    # Holes: integers between min and max not present in the set
    unique = sorted(set(external_ids))
    holes: list[int] = []
    if unique:
        for expected in range(unique[0], unique[-1] + 1):
            if expected not in set(external_ids):
                holes.append(expected)

    return duplicates, holes, non_monotonic


def import_docx_numbered_lines(
    conn: sqlite3.Connection,
    path: str | Path,
    language: str,
    title: Optional[str] = None,
    doc_role: str = "standalone",
    resource_type: Optional[str] = None,
    run_id: Optional[str] = None,
    run_logger: Optional[logging.Logger] = None,
) -> ImportReport:
    """Import a DOCX file using the numbered-lines convention.

    Creates one row in `documents` and one row per paragraph in `units`.
    Returns an ImportReport with diagnostics.
    """
    try:
        import docx  # python-docx
    except ImportError as exc:
        raise ImportError("python-docx is required: pip install python-docx") from exc

    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"DOCX file not found: {path}")

    log = run_logger or logger
    log.info("Starting import of %s (mode=docx_numbered_lines)", path)

    source_hash = _compute_file_hash(path)
    doc_title = title or path.stem
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Insert document record
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

    # Parse DOCX
    document = docx.Document(str(path))
    paragraphs = [p.text for p in document.paragraphs]

    external_ids: list[int] = []
    units_to_insert: list[tuple] = []

    n = 0
    for raw_para in paragraphs:
        para = raw_para.strip()
        if not para:
            continue  # skip blank paragraphs

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

    # Bulk insert units
    conn.executemany(
        """
        INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        units_to_insert,
    )
    conn.commit()

    # Build diagnostics
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
