"""TXT numbered-lines importer.

Reads a plain-text file where numbered lines follow the pattern:
    [n] text content here

Encoding detection strategy (ADR-003 / ADR-011):
1. BOM detection (UTF-8 BOM → utf-8-sig, UTF-16 BOM → utf-16).
2. charset-normalizer, if installed (optional dependency).
3. Fallback: try cp1252, then latin-1 (logs a warning).

Same [n] pattern and ImportReport as docx_numbered_lines.
Non-numbered, non-blank lines → unit_type="structure".
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
from .docx_numbered_lines import ImportReport, _analyze_external_ids

_NUMBERED_RE = re.compile(r"^\[\s*(\d+)\s*\]\s*(.+)$")

logger = logging.getLogger(__name__)


def _compute_file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _detect_encoding(data: bytes) -> tuple[str, str]:
    """Detect text encoding from BOM or charset-normalizer.

    Returns (encoding, method) where method is one of:
      'bom', 'charset-normalizer', 'cp1252-fallback', 'latin-1-fallback'.
    """
    # BOM detection
    if data.startswith(b"\xef\xbb\xbf"):
        return ("utf-8-sig", "bom")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return ("utf-16", "bom")

    # charset-normalizer (optional)
    try:
        from charset_normalizer import from_bytes  # type: ignore[import]
        result = from_bytes(data)
        best = result.best()
        if best is not None:
            return (str(best.encoding), "charset-normalizer")
    except ImportError:
        pass

    # Fallback: cp1252 first, then latin-1
    try:
        data.decode("cp1252")
        return ("cp1252", "cp1252-fallback")
    except UnicodeDecodeError:
        return ("latin-1", "latin-1-fallback")


def import_txt_numbered_lines(
    conn: sqlite3.Connection,
    path: str | Path,
    language: str,
    title: Optional[str] = None,
    doc_role: str = "standalone",
    resource_type: Optional[str] = None,
    run_id: Optional[str] = None,
    run_logger: Optional[logging.Logger] = None,
) -> ImportReport:
    """Import a plain-text file using the numbered-lines convention.

    Lines matching r'^\\[\\s*(\\d+)\\s*\\]\\s*(.+)$' → unit_type="line".
    Non-empty, non-matching lines → unit_type="structure".
    Blank lines are skipped.

    Returns an ImportReport with diagnostics (same as docx_numbered_lines).
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"TXT file not found: {path}")

    log = run_logger or logger
    log.info("Starting import of %s (mode=txt_numbered_lines)", path)

    raw_bytes = path.read_bytes()
    source_hash = hashlib.sha256(raw_bytes).hexdigest()
    encoding, enc_method = _detect_encoding(raw_bytes)

    if enc_method in ("cp1252-fallback", "latin-1-fallback"):
        msg = f"Encoding detection fell back to {encoding} for {path.name}"
        log.warning(msg)

    text = raw_bytes.decode(encoding, errors="replace")
    log.info("Decoded %s as %s (method=%s)", path.name, encoding, enc_method)

    doc_title = title or path.stem
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Insert document record
    cur = conn.execute(
        """
        INSERT INTO documents
            (title, language, doc_role, resource_type, meta_json, source_path, source_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            doc_title, language, doc_role, resource_type,
            json.dumps({"encoding": encoding, "enc_method": enc_method}),
            str(path), source_hash, utcnow,
        ),
    )
    doc_id = cur.lastrowid
    conn.commit()

    log.info("Created document doc_id=%d title=%r", doc_id, doc_title)

    # Parse lines
    lines = text.splitlines()
    external_ids: list[int] = []
    units_to_insert: list[tuple] = []
    n = 0

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue  # skip blank lines

        n += 1
        m = _NUMBERED_RE.match(line)
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
            log.debug("Line n=%d ext_id=%d type=line", n, ext_id)
        else:
            text_raw = line
            text_norm = normalize(text_raw)
            unit_type = "structure"
            units_to_insert.append(
                (doc_id, unit_type, n, None, text_raw, text_norm, None)
            )
            log.debug("Line n=%d type=structure", n)

    # Bulk insert
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
        report.units_total, report.units_line, report.units_structure,
    )
    return report
