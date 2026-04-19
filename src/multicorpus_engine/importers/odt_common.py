"""Read paragraph-level text from OpenDocument Text (.odt) files.

ODT is a ZIP archive; body text lives in ``content.xml`` as ``text:p`` and
``text:h`` elements (OASIS OpenDocument 1.2).
"""

from __future__ import annotations

import zipfile
import xml.etree.ElementTree as ET
import defusedxml.ElementTree as DefET
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
        return DefET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid ODT: content.xml is not valid XML: {exc}") from exc


_ATTR_OUTLINE_LEVEL = f"{{{_TEXT_NS}}}outline-level"


def read_odt_paragraph_rich_lines(path: str | Path) -> list[tuple[str, int | None]]:
    """Return non-empty paragraph rich-text strings with optional heading level.

    Each element is ``(rich_text, heading_level_or_None)``:
    - ``heading_level`` is 1, 2, 3… for ``text:h`` elements (from ``text:outline-level``).
    - ``None`` for ordinary ``text:p`` paragraphs.

    Preserves inline style markup as ``<hi rend="…">`` tags. Plain text is
    returned unchanged when no styling is present. ``text_norm`` should be
    produced via ``normalize()``, which strips the ``<hi>`` tags.
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

    out: list[tuple[str, int | None]] = []
    for elem in tree.iter():
        if elem.tag not in (_TAG_P, _TAG_H):
            continue
        rich = odt_para_to_rich_text(elem, style_map)
        plain = _walk_text_content(elem).strip()
        if not plain:
            continue
        heading_level: int | None = None
        if elem.tag == _TAG_H:
            try:
                heading_level = int(elem.get(_ATTR_OUTLINE_LEVEL) or "1")
            except ValueError:
                heading_level = 1
        out.append((rich, heading_level))
    return out
