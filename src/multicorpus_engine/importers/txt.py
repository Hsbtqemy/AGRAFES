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
from pathlib import Path
from typing import Optional

from ..unicode_policy import count_sep, normalize
from .import_guard import assert_not_duplicate_import
from .docx_numbered_lines import ImportReport, _analyze_external_ids
from .parsed import ParsedDoc, ParsedUnit, insert_units

_NUMBERED_RE = re.compile(r"^\[\s*(\d+)\s*\]\s*(.+)$")

logger = logging.getLogger(__name__)


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


def parse_txt_numbered_lines(
    path: str | Path,
    run_logger: Optional[logging.Logger] = None,
) -> ParsedDoc:
    """Parse a numbered-lines TXT file into units WITHOUT touching the DB.

    Shared by ``import_txt_numbered_lines`` (write path) and the sidecar
    ``/import/preview`` so the parsing logic lives in exactly one place (A-02).
    Raises ``FileNotFoundError`` / ``ValueError`` like the importer did.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"TXT file not found: {path}")

    _MAX_FILE_BYTES = 512 * 1024 * 1024  # 512 MiB
    if path.stat().st_size > _MAX_FILE_BYTES:
        raise ValueError(f"TXT file too large (max {_MAX_FILE_BYTES // (1024 * 1024)} MiB)")
    raw_bytes = path.read_bytes()
    source_hash = hashlib.sha256(raw_bytes).hexdigest()
    encoding, enc_method = _detect_encoding(raw_bytes)

    # Encoding fallback: only the run_logger (CLI run log) — never the module
    # logger (would hit stderr in the sidecar).
    if enc_method in ("cp1252-fallback", "latin-1-fallback") and run_logger is not None:
        run_logger.warning("Encoding detection fell back to %s for %s", encoding, path.name)

    text = raw_bytes.decode(encoding, errors="replace")

    units: list[ParsedUnit] = []
    n = 0
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue  # skip blank lines
        n += 1
        m = _NUMBERED_RE.match(line)
        if m:
            ext_id = int(m.group(1))
            text_raw = m.group(2)
            sep_count = count_sep(text_raw)
            meta = json.dumps({"sep_count": sep_count}) if sep_count > 0 else None
            units.append(ParsedUnit(
                n=n, unit_type="line", text_raw=text_raw, text_norm=normalize(text_raw),
                external_id=ext_id, meta_json=meta,
            ))
        else:
            units.append(ParsedUnit(
                n=n, unit_type="structure", text_raw=line, text_norm=normalize(line),
                unit_role="intertitre",
            ))

    return ParsedDoc(
        units=units,
        doc_meta={"encoding": encoding, "enc_method": enc_method},
        source_hash=source_hash,
    )


def import_txt_numbered_lines(
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
    """Import a plain-text file using the numbered-lines convention.

    Lines matching r'^\\[\\s*(\\d+)\\s*\\]\\s*(.+)$' → unit_type="line".
    Non-empty, non-matching lines → unit_type="structure".
    Blank lines are skipped.

    Returns an ImportReport with diagnostics (same as docx_numbered_lines).
    """
    path = Path(path)
    log = run_logger or logger
    log.info("Starting import of %s (mode=txt_numbered_lines)", path)

    parsed = parse_txt_numbered_lines(path, run_logger=run_logger)
    assert_not_duplicate_import(conn, path, parsed.source_hash, check_filename=check_filename)
    encoding = parsed.doc_meta["encoding"]
    enc_method = parsed.doc_meta["enc_method"]
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
            json.dumps(parsed.doc_meta),
            str(path), parsed.source_hash, utcnow,
        ),
    )
    doc_id = cur.lastrowid

    log.info("Created document doc_id=%d title=%r", doc_id, doc_title)

    # Project parsed units onto DB rows (doc_id assigned now).
    external_ids: list[int] = [
        u.external_id for u in parsed.units
        if u.unit_type == "line" and u.external_id is not None
    ]
    has_structure = any(u.unit_type == "structure" for u in parsed.units)

    try:
        # Auto-create intertitre convention if structure lines are present
        if has_structure:
            conn.execute(
                """
                INSERT OR IGNORE INTO unit_roles (name, label, color, icon, sort_order, category)
                VALUES ('intertitre', 'Intertitre', '#9333ea', '\u00a7', 0, 'structure')
                """
            )

        # Bulk insert (units write path centralised in parsed.insert_units)
        insert_units(conn, doc_id, parsed.units)
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    duplicates, holes, non_monotonic = _analyze_external_ids(external_ids)

    report = ImportReport(
        doc_id=doc_id,
        units_total=len(parsed.units),
        units_line=len(external_ids),
        units_structure=len(parsed.units) - len(external_ids),
        duplicates=duplicates,
        holes=holes,
        non_monotonic=non_monotonic,
    )

    if enc_method in ("cp1252-fallback", "latin-1-fallback"):
        report.warnings.append(
            {"type": "encoding_fallback", "path": str(path), "chosen": encoding}
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
