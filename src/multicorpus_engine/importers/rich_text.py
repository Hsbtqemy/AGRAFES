"""Rich text encoding helpers for inline style preservation.

Converts python-docx paragraph runs or ODT text:span elements into TEI-style
``<hi rend="…">…</hi>`` markup stored in ``text_raw``.  ``text_norm`` should
always receive the plain-text version produced by stripping those tags via
:func:`multicorpus_engine.unicode_policy.normalize`.

Styles supported (mapped to ``rend`` token names):
  - italic
  - bold
  - underline
  - strikethrough
  - superscript
  - subscript

Encoding contract
-----------------
* A run/span with no active style → bare text, no ``<hi>`` wrapper.
* A run/span with ≥1 active styles → ``<hi rend="TOKEN …">text</hi>`` where
  tokens are sorted alphabetically for determinism.
* Adjacent runs/spans with exactly the same style set are merged (greedy).
* Text content inside ``<hi>`` and bare text is XML-escaped
  (``&`` → ``&amp;``, ``<`` → ``&lt;``, ``>`` → ``&gt;``; quotes are *not*
  escaped since this text appears as element content, not attribute value).

This module is standalone — it does not import from other importers.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Iterator

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _esc(text: str) -> str:
    """XML-escape text content (not attribute values — no quote escaping)."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _rend_attr(styles: frozenset[str]) -> str:
    """Return alphabetically-sorted, space-joined rend attribute value."""
    return " ".join(sorted(styles))


def _render_segments(
    segments: list[tuple[frozenset[str], str]]
) -> str:
    """Render (styles, text) pairs into the final marked-up string.

    Consecutive pairs with identical style sets are merged before rendering.
    """
    if not segments:
        return ""

    # Merge consecutive segments with the same style set
    merged: list[tuple[frozenset[str], str]] = []
    for styles, text in segments:
        if merged and merged[-1][0] == styles:
            merged[-1] = (styles, merged[-1][1] + text)
        else:
            merged.append((styles, text))

    parts: list[str] = []
    for styles, text in merged:
        escaped = _esc(text)
        if not styles:
            parts.append(escaped)
        else:
            rend = _rend_attr(styles)
            parts.append(f'<hi rend="{rend}">{escaped}</hi>')

    return "".join(parts)


# ---------------------------------------------------------------------------
# python-docx support
# ---------------------------------------------------------------------------

# Depth guard for the character-style chain walk (a malformed styles.xml could
# otherwise loop; Word's own chains are two or three levels deep at most).
_MAX_STYLE_DEPTH = 8


def _run_has_char_style(run: object) -> bool:
    """Cheap test for "does this run apply a character style at all?".

    ``run.style`` triggers a full style resolution in python-docx (~0.3 ms per call
    measured on a 6 200-run document) — ruinous when asked for six flags on every
    run, and pointless for the ~99 % of runs that apply no character style: the
    underlying ``<w:rPr><w:rStyle>`` answers ~500x faster.  Objects that are not
    real python-docx Runs (test doubles) fall back to the duck-typed attribute.
    """
    element = getattr(run, "_element", None)
    if element is None:
        return getattr(run, "style", None) is not None
    rpr = getattr(element, "rPr", None)
    return rpr is not None and getattr(rpr, "style", None) is not None


def _style_flag(run: object, attr: str) -> object:
    """Resolve one formatting flag through the run's *character style* chain.

    python-docx only reports **direct** formatting on the run: ``run.italic`` is
    ``None`` when the italic comes from the applied character style — which is how
    Word applies its built-in *Emphasis* style (``Accentuation`` in a French UI),
    and *Strong* for bold.  Such a run carries ``<w:rStyle w:val="Accentuation"/>``
    and no ``<w:i/>``, so reading the run alone silently drops the styling.

    Walks ``style.base_style`` until a style sets the flag explicitly and returns
    that value (``None`` when no style in the chain sets it).  The caller decides
    what counts as active, so a style-resolved value is judged exactly like a
    direct one.
    """
    style = getattr(run, "style", None)
    depth = 0
    while style is not None and depth < _MAX_STYLE_DEPTH:
        font = getattr(style, "font", None)
        value = getattr(font, attr, None) if font is not None else None
        if value is not None:
            return value
        style = getattr(style, "base_style", None)
        depth += 1
    return None


def _docx_run_styles(run: object) -> frozenset[str]:
    """Extract active inline styles from a python-docx Run object.

    Direct formatting wins; a flag left unset on the run (``None``) is resolved
    against the character-style chain via :func:`_style_flag`.  A run that switches
    a style off explicitly (``run.italic is False``) is therefore never promoted.
    """
    font = getattr(run, "font", None)
    styled = _run_has_char_style(run)

    def _flag(direct: object, attr: str) -> bool:
        if direct is not None:
            return direct is True
        return styled and _style_flag(run, attr) is True

    def _font_flag(attr: str) -> bool:
        return _flag(getattr(font, attr, None) if font is not None else None, attr)

    active: set[str] = set()
    if _flag(getattr(run, "italic", None), "italic"):
        active.add("italic")
    if _flag(getattr(run, "bold", None), "bold"):
        active.add("bold")
    if _flag(getattr(run, "underline", None), "underline"):
        active.add("underline")
    if _font_flag("strike"):
        active.add("strikethrough")
    if _font_flag("superscript"):
        active.add("superscript")
    if _font_flag("subscript"):
        active.add("subscript")
    return frozenset(active)


def para_to_rich_text(para: object) -> str:
    """Convert a python-docx ``Paragraph`` to a rich-text string.

    Runs are inspected for inline styles (italic, bold, underline,
    strikethrough, superscript, subscript).  Active styles are encoded as
    ``<hi rend="…">…</hi>``.  Consecutive runs sharing the same style set are
    merged before serialisation.

    Parameters
    ----------
    para:
        A ``docx.text.paragraph.Paragraph`` instance.

    Returns
    -------
    str
        Markup string — may mix bare text and ``<hi>`` elements.
    """
    runs = getattr(para, "runs", [])
    segments: list[tuple[frozenset[str], str]] = []
    for run in runs:
        text: str = getattr(run, "text", "") or ""
        if not text:
            continue
        styles = _docx_run_styles(run)
        segments.append((styles, text))
    return _render_segments(segments)


# ---------------------------------------------------------------------------
# ODT support
# ---------------------------------------------------------------------------

# ODF 1.2 namespace URIs
_NS: dict[str, str] = {
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "style": "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
    "fo": "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
}

_TAG_S = f"{{{_NS['text']}}}s"
_TAG_TAB = f"{{{_NS['text']}}}tab"
_TAG_LINE_BREAK = f"{{{_NS['text']}}}line-break"
_TAG_SPAN = f"{{{_NS['text']}}}span"
_ATTR_C = f"{{{_NS['text']}}}c"
_ATTR_STYLE_NAME = f"{{{_NS['text']}}}style-name"
_TAG_AUTO_STYLES = f"{{{_NS['office']}}}automatic-styles"
_TAG_STYLE = f"{{{_NS['style']}}}style"
_TAG_TEXT_PROPS = f"{{{_NS['style']}}}text-properties"
_ATTR_STYLE_ATTR_NAME = f"{{{_NS['style']}}}name"
_ATTR_FO_FONT_STYLE = f"{{{_NS['fo']}}}font-style"
_ATTR_FO_FONT_WEIGHT = f"{{{_NS['fo']}}}font-weight"
_ATTR_UNDERLINE_STYLE = f"{{{_NS['style']}}}text-underline-style"
_ATTR_LINE_THROUGH = f"{{{_NS['style']}}}text-line-through-style"
_ATTR_TEXT_POSITION = f"{{{_NS['style']}}}text-position"


def odt_extract_style_map(root: ET.Element) -> dict[str, frozenset[str]]:
    """Build a ``{style_name: frozenset_of_tokens}`` mapping from ODT automatic-styles.

    Reads ``<office:automatic-styles>`` from the root of ``content.xml`` and
    inspects ``<style:text-properties>`` children to detect:
    - ``fo:font-style="italic"`` → ``"italic"``
    - ``fo:font-weight="bold"`` → ``"bold"``
    - ``style:text-underline-style`` ≠ ``"none"`` → ``"underline"``
    - ``style:text-line-through-style`` ≠ ``"none"`` → ``"strikethrough"``
    - ``style:text-position`` starts with ``"super"`` → ``"superscript"``
    - ``style:text-position`` starts with ``"sub"`` → ``"subscript"``

    Parameters
    ----------
    root:
        Root ``Element`` of the parsed ``content.xml`` document.

    Returns
    -------
    dict[str, frozenset[str]]
        Keys are style names; values are frozen sets of active style tokens.
        Only styles with at least one recognised property are included.
    """
    style_map: dict[str, frozenset[str]] = {}

    # Find office:automatic-styles (may be direct child or deeper)
    auto_styles: ET.Element | None = None
    for el in root.iter(_TAG_AUTO_STYLES):
        auto_styles = el
        break
    if auto_styles is None:
        return style_map

    for style_el in auto_styles:
        if style_el.tag != _TAG_STYLE:
            continue
        name = style_el.get(_ATTR_STYLE_ATTR_NAME)
        if not name:
            continue

        active: set[str] = set()
        for child in style_el:
            if child.tag != _TAG_TEXT_PROPS:
                continue
            fs = child.get(_ATTR_FO_FONT_STYLE, "")
            if fs.lower() == "italic":
                active.add("italic")
            fw = child.get(_ATTR_FO_FONT_WEIGHT, "")
            if fw.lower() == "bold":
                active.add("bold")
            ul = child.get(_ATTR_UNDERLINE_STYLE, "none")
            if ul.lower() not in ("none", ""):
                active.add("underline")
            lt = child.get(_ATTR_LINE_THROUGH, "none")
            if lt.lower() not in ("none", ""):
                active.add("strikethrough")
            tp = child.get(_ATTR_TEXT_POSITION, "").lower()
            if tp.startswith("super"):
                active.add("superscript")
            elif tp.startswith("sub"):
                active.add("subscript")

        if active:
            style_map[name] = frozenset(active)

    return style_map


def _walk_odt_elem(
    elem: ET.Element,
    style_map: dict[str, frozenset[str]],
    inherited_styles: frozenset[str],
) -> Iterator[tuple[frozenset[str], str]]:
    """Yield (styles, text) pairs by walking an ODT element tree recursively.

    Parameters
    ----------
    elem:
        The current ODT element.
    style_map:
        Mapping from style names to active style token sets, as produced by
        :func:`odt_extract_style_map`.
    inherited_styles:
        Style tokens inherited from ancestor ``text:span`` elements.
    """
    # Direct text of this element (before first child)
    if elem.text:
        yield (inherited_styles, elem.text)

    for child in elem:
        tag = child.tag

        if tag == _TAG_S:
            # text:s — multiple spaces
            try:
                count = int(child.get(_ATTR_C) or "1")
            except ValueError:
                count = 1
            yield (inherited_styles, " " * max(count, 1))

        elif tag == _TAG_TAB:
            yield (inherited_styles, "\t")

        elif tag == _TAG_LINE_BREAK:
            yield (inherited_styles, "\n")

        elif tag == _TAG_SPAN:
            # Resolve this span's style, union with inherited
            span_style_name = child.get(_ATTR_STYLE_NAME, "")
            span_styles = style_map.get(span_style_name, frozenset())
            combined = inherited_styles | span_styles
            yield from _walk_odt_elem(child, style_map, combined)

        else:
            # Unknown element — recurse with same inherited styles
            yield from _walk_odt_elem(child, style_map, inherited_styles)

        # Tail text follows the child element (still at parent level)
        if child.tail:
            yield (inherited_styles, child.tail)


def odt_para_to_rich_text(
    elem: ET.Element,
    style_map: dict[str, frozenset[str]] | None = None,
) -> str:
    """Convert an ODT ``text:p`` or ``text:h`` element to a rich-text string.

    ``text:span`` elements are resolved against *style_map* (built by
    :func:`odt_extract_style_map`) to produce ``<hi rend="…">…</hi>`` markup.

    Parameters
    ----------
    elem:
        The ``text:p`` / ``text:h`` ``Element``.
    style_map:
        Optional pre-built style map.  If ``None``, an empty mapping is used
        (all spans treated as unstyled).

    Returns
    -------
    str
        Rich-text string with ``<hi>`` markup for styled runs.
    """
    if style_map is None:
        style_map = {}

    segments: list[tuple[frozenset[str], str]] = list(
        _walk_odt_elem(elem, style_map, frozenset())
    )
    return _render_segments(segments)
