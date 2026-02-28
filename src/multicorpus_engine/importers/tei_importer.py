"""TEI basic importer.

Extracts `<p>` (paragraph) or `<s>` (sentence) elements from a TEI XML file
and stores them as line units.

Design decisions (ADR-014):
- Unit element: configurable — 'p' (default) or 's'.
- xml:id → external_id: trailing integer extracted from the xml:id value
  (e.g. "s1" → 1, "p42" → 42, "seg_001" → 1). Falls back to sequential n.
- Language: from xml:lang on <text> or <TEI>; overridden by --language if given.
- Title: from teiHeader//title[0]; fallback to filename stem.
- Namespace-aware: handles both `xmlns="http://www.tei-c.org/ns/1.0"` and no-NS TEI.
- No structure units — all extracted elements are line units.
"""

from __future__ import annotations

import hashlib
import logging
import re
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

from ..unicode_policy import count_sep, normalize
import json
from .docx_numbered_lines import ImportReport, _analyze_external_ids

_TEI_NS = "http://www.tei-c.org/ns/1.0"
_XML_NS = "http://www.w3.org/XML/1998/namespace"

# xml:lang and xml:id attribute keys
_ATTR_LANG = f"{{{_XML_NS}}}lang"
_ATTR_ID = f"{{{_XML_NS}}}id"

logger = logging.getLogger(__name__)


def _compute_file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _xmlid_to_int(xmlid: str) -> Optional[int]:
    """Extract trailing integer from an xml:id string.

    "s1" → 1, "p42" → 42, "seg_001" → 1, "abc" → None.
    """
    m = re.search(r"(\d+)$", xmlid)
    return int(m.group(1)) if m else None


def _resolve_tag(local: str, root_tag: str) -> str:
    """Return the fully-qualified tag, using the namespace of root_tag if present."""
    if root_tag.startswith("{"):
        ns = root_tag[1: root_tag.index("}")]
        return f"{{{ns}}}{local}"
    return local  # no namespace


def _iter_body_elements(root: ET.Element, unit_tag_local: str) -> list[ET.Element]:
    """Walk <body> and return all elements matching unit_tag_local (by local name)."""
    # Determine whether we have a namespace
    root_tag = root.tag  # e.g. "{http://...}TEI" or "TEI"

    def local(tag: str) -> str:
        return tag.split("}")[1] if "}" in tag else tag

    body_tag = _resolve_tag("body", root_tag)
    text_tag = _resolve_tag("text", root_tag)

    # Find <text> first, then <body>
    text_el = root.find(f".//{text_tag}")
    if text_el is None:
        text_el = root

    body_el = text_el.find(f".//{body_tag}")
    search_root = body_el if body_el is not None else text_el

    # Collect all matching elements anywhere in the body
    return [
        el for el in search_root.iter()
        if local(el.tag) == unit_tag_local
    ]


def _get_title(root: ET.Element) -> Optional[str]:
    """Extract first <title> text from teiHeader."""
    def local(tag: str) -> str:
        return tag.split("}")[1] if "}" in tag else tag

    for el in root.iter():
        if local(el.tag) == "title":
            text = (el.text or "").strip()
            if text:
                return text
    return None


def _get_lang(root: ET.Element) -> Optional[str]:
    """Get xml:lang from <text> or <TEI> root."""
    def local(tag: str) -> str:
        return tag.split("}")[1] if "}" in tag else tag

    # Check <text> element first
    for el in root.iter():
        if local(el.tag) == "text":
            lang = el.get(_ATTR_LANG) or el.get("lang")
            if lang:
                return lang
    # Fallback: root element
    lang = root.get(_ATTR_LANG) or root.get("lang")
    return lang or None


def import_tei(
    conn: sqlite3.Connection,
    path: str | Path,
    language: Optional[str] = None,
    title: Optional[str] = None,
    doc_role: str = "standalone",
    resource_type: Optional[str] = None,
    unit_element: str = "p",
    run_id: Optional[str] = None,
    run_logger: Optional[logging.Logger] = None,
) -> ImportReport:
    """Import a TEI XML file, extracting <p> or <s> elements as line units.

    Args:
        conn: SQLite connection.
        path: Path to .xml TEI file.
        language: ISO language code. If None, inferred from xml:lang.
        title: Document title. If None, inferred from teiHeader//title.
        doc_role: One of the valid doc_role values.
        resource_type: Optional resource type tag.
        unit_element: 'p' (paragraphs, default) or 's' (sentences).
        run_id: Caller-supplied run UUID.
        run_logger: Logger from the run context.

    Returns:
        ImportReport with diagnostics.
    """
    if unit_element not in ("p", "s"):
        raise ValueError(f"unit_element must be 'p' or 's', got {unit_element!r}")

    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"TEI file not found: {path}")

    log = run_logger or logger
    log.info("Starting import of %s (mode=tei, unit=%s)", path, unit_element)

    source_hash = _compute_file_hash(path)

    try:
        tree = ET.parse(str(path))
    except ET.ParseError as exc:
        raise ValueError(f"TEI file is not valid XML: {exc}") from exc

    root = tree.getroot()

    # Resolve title and language from TEI header if not supplied
    tei_title = title or _get_title(root) or path.stem
    tei_lang = language or _get_lang(root) or "und"  # und = undetermined

    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    cur = conn.execute(
        """
        INSERT INTO documents
            (title, language, doc_role, resource_type, meta_json, source_path, source_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            tei_title, tei_lang, doc_role, resource_type,
            json.dumps({"tei_unit": unit_element}),
            str(path), source_hash, utcnow,
        ),
    )
    doc_id = cur.lastrowid
    conn.commit()
    log.info("Created document doc_id=%d title=%r lang=%r", doc_id, tei_title, tei_lang)

    # Extract elements
    elements = _iter_body_elements(root, unit_element)
    external_ids: list[int] = []
    units_to_insert: list[tuple] = []
    n = 0

    for el in elements:
        # Get all text content (including tail text of children)
        raw_text = "".join(el.itertext()).strip()
        if not raw_text:
            continue  # skip empty elements

        n += 1
        text_raw = raw_text
        text_norm = normalize(text_raw)
        sep_count = count_sep(text_raw)
        meta = json.dumps({"sep_count": sep_count}) if sep_count > 0 else None

        # external_id from xml:id numeric suffix
        xmlid = el.get(_ATTR_ID) or el.get("id")
        ext_id: Optional[int] = None
        if xmlid:
            ext_id = _xmlid_to_int(xmlid)
        if ext_id is None:
            ext_id = n  # fallback to sequential position

        external_ids.append(ext_id)
        units_to_insert.append(
            (doc_id, "line", n, ext_id, text_raw, text_norm, meta)
        )
        log.debug("TEI %s n=%d ext_id=%d", unit_element, n, ext_id)

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
        units_line=len(units_to_insert),
        units_structure=0,
        duplicates=duplicates,
        holes=holes,
        non_monotonic=non_monotonic,
    )

    if duplicates:
        msg = f"Duplicate external_id(s) from xml:id: {duplicates}"
        report.warnings.append(msg)
        log.warning(msg)
    if holes:
        msg = f"Holes in external_id sequence: {holes}"
        report.warnings.append(msg)
        log.warning(msg)

    log.info("TEI import complete: %d %s units", report.units_total, unit_element)
    return report
