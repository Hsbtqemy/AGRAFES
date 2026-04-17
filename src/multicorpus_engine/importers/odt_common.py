"""Read paragraph-level text from OpenDocument Text (.odt) files.

ODT is a ZIP archive; body text lives in ``content.xml`` as ``text:p`` and
``text:h`` elements (OASIS OpenDocument 1.2).
"""

from __future__ import annotations

import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from .rich_text import odt_extract_style_map, odt_para_to_rich_text

# ODF 1.2 namespaces
_TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
_OFFICE_NS = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"

_TAG_P = f"{{{_TEXT_NS}}}p"
_TAG_H = f"{{{_TEXT_NS}}}h"
_TAG_S = f"{{{_TEXT_NS}}}s"
_TAG_TAB = f"{{{_TEXT_NS}}}tab"
_TAG_LINE_BREAK = f"{{{_TEXT_NS}}}line-break"
_ATTR_C = f"{{{_TEXT_NS}}}c"


def _walk_text_content(elem: ET.Element) -> str:
    """Concatenate all character data under ``elem`` (spans, soft breaks, etc.)."""
    parts: list[str] = []
    if elem.text:
        parts.append(elem.text)
    for child in elem:
        tag = child.tag
        if tag == _TAG_S:
            try:
                count = int(child.get(_ATTR_C) or child.get("c") or "1")
            except ValueError:
                count = 1
            parts.append(" " * max(count, 1))
        elif tag == _TAG_TAB:
            parts.append("\t")
        elif tag == _TAG_LINE_BREAK:
            parts.append("\n")
        else:
            parts.append(_walk_text_content(child))
        if child.tail:
            parts.append(child.tail)
    return "".join(parts)


def read_odt_paragraph_lines(path: str | Path) -> list[str]:
    """Return non-empty paragraph strings in document order (same rules as DOCX importers).

    Blank paragraphs are skipped; ``n`` / external_id numbering matches
    ``docx_numbered_lines`` / ``docx_paragraphs`` behaviour.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"ODT file not found: {path}")
    if path.suffix.lower() != ".odt":
        raise ValueError(f"Expected .odt file, got: {path}")

    root = _load_odt_xml(path)

    body: ET.Element | None = None
    for el in root.iter(f"{{{_OFFICE_NS}}}body"):
        body = el
        break
    tree = body if body is not None else root

    out: list[str] = []
    for elem in tree.iter():
        if elem.tag not in (_TAG_P, _TAG_H):
            continue
        raw = _walk_text_content(elem)
        para = raw.strip()
        if not para:
            continue
        out.append(para)
    return out


def _load_odt_xml(path: Path) -> ET.Element:
    """Load and parse content.xml from an ODT archive."""
    try:
        with zipfile.ZipFile(path, "r") as zf:
            try:
                xml_bytes = zf.read("content.xml")
            except KeyError as exc:
                raise ValueError("Invalid ODT: missing content.xml") from exc
    except zipfile.BadZipFile as exc:
        raise ValueError(f"Not a valid ZIP/ODT archive: {path}") from exc
    try:
        return ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid ODT: content.xml is not valid XML: {exc}") from exc


def read_odt_paragraph_rich_lines(path: str | Path) -> list[str]:
    """Return non-empty paragraph rich-text strings in document order.

    Like ``read_odt_paragraph_lines`` but preserves inline style markup
    (italic, bold, underline, etc.) as ``<hi rend="…">`` tags in the
    returned strings. Plain text is returned unchanged when no styling is
    present. ``text_norm`` should be produced by passing these strings
    through ``normalize()``, which strips the ``<hi>`` tags.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"ODT file not found: {path}")
    if path.suffix.lower() != ".odt":
        raise ValueError(f"Expected .odt file, got: {path}")

    root = _load_odt_xml(path)
    style_map = odt_extract_style_map(root)

    body: ET.Element | None = None
    for el in root.iter(f"{{{_OFFICE_NS}}}body"):
        body = el
        break
    tree = body if body is not None else root

    out: list[str] = []
    for elem in tree.iter():
        if elem.tag not in (_TAG_P, _TAG_H):
            continue
        rich = odt_para_to_rich_text(elem, style_map)
        # blank check on plain text (strip <hi> tags via a simple replacement)
        plain = _walk_text_content(elem).strip()
        if not plain:
            continue
        out.append(rich)
    return out
