"""Tests for rich_text module (RICH-1) and unicode_policy <hi> stripping (RICH-2)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from multicorpus_engine.importers.rich_text import (
    _NS,
    odt_extract_style_map,
    odt_para_to_rich_text,
    para_to_rich_text,
)
from multicorpus_engine.unicode_policy import normalize


# ---------------------------------------------------------------------------
# Helpers to build fake python-docx objects
# ---------------------------------------------------------------------------

def _make_run(text: str, bold=None, italic=None, underline=None,
              strike=None, superscript=None, subscript=None) -> object:
    """Build a mock python-docx Run object."""
    font = SimpleNamespace(
        strike=strike,
        superscript=superscript,
        subscript=subscript,
    )
    return SimpleNamespace(
        text=text,
        bold=bold,
        italic=italic,
        underline=underline,
        font=font,
    )


def _make_para(*runs) -> object:
    """Build a mock python-docx Paragraph object."""
    return SimpleNamespace(runs=list(runs))


# ---------------------------------------------------------------------------
# para_to_rich_text — python-docx
# ---------------------------------------------------------------------------

class TestParaToRichText:
    def test_plain_run_no_markup(self):
        """A run with no style → plain text, no <hi> tag."""
        para = _make_para(_make_run("hello"))
        assert para_to_rich_text(para) == "hello"

    def test_italic_run(self):
        """A run with italic=True → <hi rend="italic">."""
        para = _make_para(_make_run("world", italic=True))
        assert para_to_rich_text(para) == '<hi rend="italic">world</hi>'

    def test_bold_italic_alphabetical_order(self):
        """Bold+italic → rend="bold italic" (alphabetical order)."""
        para = _make_para(_make_run("text", bold=True, italic=True))
        assert para_to_rich_text(para) == '<hi rend="bold italic">text</hi>'

    def test_bold_only(self):
        para = _make_para(_make_run("strong", bold=True))
        assert para_to_rich_text(para) == '<hi rend="bold">strong</hi>'

    def test_underline(self):
        para = _make_para(_make_run("link", underline=True))
        assert para_to_rich_text(para) == '<hi rend="underline">link</hi>'

    def test_strikethrough(self):
        para = _make_para(_make_run("deleted", strike=True))
        assert para_to_rich_text(para) == '<hi rend="strikethrough">deleted</hi>'

    def test_superscript(self):
        para = _make_para(_make_run("2", superscript=True))
        assert para_to_rich_text(para) == '<hi rend="superscript">2</hi>'

    def test_subscript(self):
        para = _make_para(_make_run("2", subscript=True))
        assert para_to_rich_text(para) == '<hi rend="subscript">2</hi>'

    def test_none_style_ignored(self):
        """italic=None (not set) must not produce a tag."""
        para = _make_para(_make_run("plain", italic=None, bold=None))
        assert para_to_rich_text(para) == "plain"

    def test_false_style_ignored(self):
        """italic=False (explicitly off) must not produce a tag."""
        para = _make_para(_make_run("plain", italic=False))
        assert para_to_rich_text(para) == "plain"

    def test_consecutive_same_style_merged(self):
        """Consecutive runs with the same style are merged into one <hi>."""
        para = _make_para(
            _make_run("a", italic=True),
            _make_run("b", italic=True),
        )
        assert para_to_rich_text(para) == '<hi rend="italic">ab</hi>'

    def test_no_merge_different_styles(self):
        """Runs with different styles are NOT merged."""
        para = _make_para(
            _make_run("a", italic=True),
            _make_run("b", bold=True),
        )
        result = para_to_rich_text(para)
        assert result == '<hi rend="italic">a</hi><hi rend="bold">b</hi>'

    def test_mixed_plain_and_styled(self):
        """Plain run followed by italic run → correct mixed output."""
        para = _make_para(
            _make_run("prefix "),
            _make_run("em", italic=True),
            _make_run(" suffix"),
        )
        assert para_to_rich_text(para) == 'prefix <hi rend="italic">em</hi> suffix'

    def test_xml_escape_ampersand(self):
        """& in plain text → &amp;."""
        para = _make_para(_make_run("rock & roll"))
        assert para_to_rich_text(para) == "rock &amp; roll"

    def test_xml_escape_lt_gt(self):
        """< and > in text → &lt; and &gt;."""
        para = _make_para(_make_run("a < b > c"))
        assert para_to_rich_text(para) == "a &lt; b &gt; c"

    def test_xml_escape_inside_hi(self):
        """Escaping applies inside <hi> tags too."""
        para = _make_para(_make_run("x & y", bold=True))
        assert para_to_rich_text(para) == '<hi rend="bold">x &amp; y</hi>'

    def test_empty_para(self):
        """Empty paragraph (no runs) → empty string."""
        para = _make_para()
        assert para_to_rich_text(para) == ""

    def test_empty_run_text_skipped(self):
        """Runs with empty text are ignored (don't produce stray tags)."""
        para = _make_para(
            _make_run("", italic=True),
            _make_run("visible"),
        )
        assert para_to_rich_text(para) == "visible"


# ---------------------------------------------------------------------------
# ODT helpers
# ---------------------------------------------------------------------------

def _build_odt_content_xml(styles_xml: str, body_xml: str) -> ET.Element:
    """Build a minimal content.xml root element for testing."""
    xml = f"""<?xml version="1.0"?>
<office:document-content
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0">
  <office:automatic-styles>
    {styles_xml}
  </office:automatic-styles>
  <office:body>
    <office:text>
      {body_xml}
    </office:text>
  </office:body>
</office:document-content>"""
    return ET.fromstring(xml)


def _get_para(root: ET.Element) -> ET.Element:
    """Return the first text:p element in the document."""
    tag_p = f"{{{_NS['text']}}}p"
    for el in root.iter(tag_p):
        return el
    raise AssertionError("No text:p found")


# ---------------------------------------------------------------------------
# odt_extract_style_map
# ---------------------------------------------------------------------------

class TestOdtExtractStyleMap:
    def test_empty_auto_styles(self):
        root = _build_odt_content_xml("", "<text:p/>")
        style_map = odt_extract_style_map(root)
        assert style_map == {}

    def test_italic_style(self):
        styles = """
        <style:style style:name="T1" style:family="text">
          <style:text-properties fo:font-style="italic"/>
        </style:style>
        """
        root = _build_odt_content_xml(styles, "<text:p/>")
        style_map = odt_extract_style_map(root)
        assert "T1" in style_map
        assert "italic" in style_map["T1"]
        assert "bold" not in style_map["T1"]

    def test_bold_style(self):
        styles = """
        <style:style style:name="T2" style:family="text">
          <style:text-properties fo:font-weight="bold"/>
        </style:style>
        """
        root = _build_odt_content_xml(styles, "<text:p/>")
        style_map = odt_extract_style_map(root)
        assert style_map["T2"] == frozenset({"bold"})

    def test_bold_italic_style(self):
        styles = """
        <style:style style:name="T3" style:family="text">
          <style:text-properties fo:font-style="italic" fo:font-weight="bold"/>
        </style:style>
        """
        root = _build_odt_content_xml(styles, "<text:p/>")
        style_map = odt_extract_style_map(root)
        assert style_map["T3"] == frozenset({"italic", "bold"})

    def test_underline_style(self):
        styles = """
        <style:style style:name="T4" style:family="text">
          <style:text-properties style:text-underline-style="solid"/>
        </style:style>
        """
        root = _build_odt_content_xml(styles, "<text:p/>")
        style_map = odt_extract_style_map(root)
        assert "underline" in style_map["T4"]

    def test_underline_none_not_included(self):
        styles = """
        <style:style style:name="T5" style:family="text">
          <style:text-properties style:text-underline-style="none"/>
        </style:style>
        """
        root = _build_odt_content_xml(styles, "<text:p/>")
        style_map = odt_extract_style_map(root)
        # style with only "none" underline has no active tokens → not in map
        assert "T5" not in style_map

    def test_strikethrough(self):
        styles = """
        <style:style style:name="T6" style:family="text">
          <style:text-properties style:text-line-through-style="solid"/>
        </style:style>
        """
        root = _build_odt_content_xml(styles, "<text:p/>")
        style_map = odt_extract_style_map(root)
        assert "strikethrough" in style_map["T6"]

    def test_superscript(self):
        styles = """
        <style:style style:name="T7" style:family="text">
          <style:text-properties style:text-position="super 58%"/>
        </style:style>
        """
        root = _build_odt_content_xml(styles, "<text:p/>")
        style_map = odt_extract_style_map(root)
        assert "superscript" in style_map["T7"]

    def test_subscript(self):
        styles = """
        <style:style style:name="T8" style:family="text">
          <style:text-properties style:text-position="sub 58%"/>
        </style:style>
        """
        root = _build_odt_content_xml(styles, "<text:p/>")
        style_map = odt_extract_style_map(root)
        assert "subscript" in style_map["T8"]


# ---------------------------------------------------------------------------
# odt_para_to_rich_text
# ---------------------------------------------------------------------------

class TestOdtParaToRichText:
    def test_plain_para_no_span(self):
        """A paragraph with no text:span → plain text, no markup."""
        root = _build_odt_content_xml("", "<text:p>hello world</text:p>")
        para = _get_para(root)
        result = odt_para_to_rich_text(para, _NS, {})
        assert result == "hello world"

    def test_span_italic(self):
        """A text:span with italic style → <hi rend="italic">."""
        styles = """
        <style:style style:name="I1" style:family="text">
          <style:text-properties fo:font-style="italic"/>
        </style:style>
        """
        body = '<text:p>before <text:span text:style-name="I1">em</text:span> after</text:p>'
        root = _build_odt_content_xml(styles, body)
        para = _get_para(root)
        style_map = odt_extract_style_map(root)
        result = odt_para_to_rich_text(para, _NS, style_map)
        assert result == 'before <hi rend="italic">em</hi> after'

    def test_span_bold(self):
        styles = """
        <style:style style:name="B1" style:family="text">
          <style:text-properties fo:font-weight="bold"/>
        </style:style>
        """
        body = '<text:p><text:span text:style-name="B1">strong</text:span></text:p>'
        root = _build_odt_content_xml(styles, body)
        para = _get_para(root)
        style_map = odt_extract_style_map(root)
        result = odt_para_to_rich_text(para, _NS, style_map)
        assert result == '<hi rend="bold">strong</hi>'

    def test_span_unknown_style_plain(self):
        """A text:span whose style name is not in style_map → plain text."""
        body = '<text:p><text:span text:style-name="Unknown">text</text:span></text:p>'
        root = _build_odt_content_xml("", body)
        para = _get_para(root)
        result = odt_para_to_rich_text(para, _NS, {})
        assert result == "text"

    def test_text_s_spaces(self):
        """text:s elements → multiple spaces."""
        body = '<text:p>a<text:s text:c="3"/>b</text:p>'
        root = _build_odt_content_xml("", body)
        para = _get_para(root)
        result = odt_para_to_rich_text(para, _NS, {})
        assert result == "a   b"

    def test_text_tab(self):
        body = '<text:p>a<text:tab/>b</text:p>'
        root = _build_odt_content_xml("", body)
        para = _get_para(root)
        result = odt_para_to_rich_text(para, _NS, {})
        assert result == "a\tb"

    def test_text_line_break(self):
        body = '<text:p>a<text:line-break/>b</text:p>'
        root = _build_odt_content_xml("", body)
        para = _get_para(root)
        result = odt_para_to_rich_text(para, _NS, {})
        assert result == "a\nb"

    def test_xml_escape_in_plain(self):
        """& and < in plain ODT text → escaped in output."""
        body = '<text:p>rock &amp; roll</text:p>'
        root = _build_odt_content_xml("", body)
        para = _get_para(root)
        result = odt_para_to_rich_text(para, _NS, {})
        # ET parses &amp; back to &; our code re-escapes it
        assert result == "rock &amp; roll"

    def test_none_style_map_treated_as_empty(self):
        """Passing style_map=None → no crash, spans rendered as plain text."""
        body = '<text:p><text:span text:style-name="X">text</text:span></text:p>'
        root = _build_odt_content_xml("", body)
        para = _get_para(root)
        result = odt_para_to_rich_text(para, _NS, None)
        assert result == "text"

    def test_consecutive_same_style_merged_odt(self):
        """Two consecutive spans with the same style → merged into one <hi>."""
        styles = """
        <style:style style:name="I1" style:family="text">
          <style:text-properties fo:font-style="italic"/>
        </style:style>
        """
        body = (
            '<text:p>'
            '<text:span text:style-name="I1">a</text:span>'
            '<text:span text:style-name="I1">b</text:span>'
            '</text:p>'
        )
        root = _build_odt_content_xml(styles, body)
        para = _get_para(root)
        style_map = odt_extract_style_map(root)
        result = odt_para_to_rich_text(para, _NS, style_map)
        assert result == '<hi rend="italic">ab</hi>'


# ---------------------------------------------------------------------------
# unicode_policy.normalize — <hi> stripping (RICH-2)
# ---------------------------------------------------------------------------

class TestNormalizeHiStripping:
    def test_italic_hi_stripped(self):
        assert normalize('<hi rend="italic">bonjour</hi> monde') == "bonjour monde"

    def test_bold_italic_hi_stripped(self):
        assert normalize('texte <hi rend="bold italic">enrichi</hi> fin') == "texte enrichi fin"

    def test_plain_text_unaffected(self):
        assert normalize("plain text") == "plain text"

    def test_no_text_returns_empty(self):
        assert normalize("") == ""

    def test_multiple_hi_tags(self):
        result = normalize('<hi rend="bold">A</hi> and <hi rend="italic">B</hi>')
        assert result == "A and B"

    def test_hi_with_attributes_stripped(self):
        """Opening tag with any attributes must be stripped."""
        result = normalize('<hi rend="underline strikethrough">x</hi>')
        assert result == "x"

    def test_normalize_still_applies(self):
        """After <hi> stripping, normal Unicode normalization still applies."""
        # Non-breaking space should be normalized to regular space
        result = normalize('<hi rend="bold">café\u00a0fin</hi>')
        assert result == "café fin"
