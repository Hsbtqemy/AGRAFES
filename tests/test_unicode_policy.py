"""Tests for the Unicode normalization policy."""

from __future__ import annotations

import pytest
from multicorpus_engine.unicode_policy import normalize, text_display, count_sep


def test_nfc_normalization() -> None:
    """normalize() must apply NFC Unicode normalization."""
    # é as decomposed (e + combining acute) → composed é
    decomposed = "e\u0301"  # NFD form
    result = normalize(decomposed)
    assert result == "\u00e9"  # NFC form: é


def test_sep_removed_from_norm() -> None:
    """¤ (U+00A4) must be replaced by a space in text_norm."""
    text = "hello\u00a4world"
    result = normalize(text)
    assert "\u00a4" not in result
    assert "hello world" == result


def test_nbsp_normalized_to_space() -> None:
    """Non-breaking spaces must be normalized to ASCII space in text_norm."""
    text = "word1\u00a0word2"  # NBSP
    result = normalize(text)
    assert "\u00a0" not in result
    assert result == "word1 word2"


def test_zwsp_removed() -> None:
    """Zero-width space must be removed from text_norm."""
    text = "hel\u200blo"
    result = normalize(text)
    assert "\u200b" not in result
    assert result == "hello"


def test_control_chars_stripped() -> None:
    """ASCII control characters (except TAB and LF) must be stripped."""
    text = "ab\x00cd\x01ef"  # NUL and SOH chars
    result = normalize(text)
    assert "\x00" not in result
    assert "\x01" not in result
    assert result == "abcdef"


def test_tab_and_lf_preserved() -> None:
    """TAB and LF must NOT be stripped by normalize()."""
    text = "line1\nline2\ttabbed"
    result = normalize(text)
    assert "\n" in result
    assert "\t" in result


def test_crlf_normalized_to_lf() -> None:
    """CR+LF and bare CR must be normalized to LF."""
    text = "line1\r\nline2\rline3"
    result = normalize(text)
    assert "\r" not in result
    assert result == "line1\nline2\nline3"


def test_text_display_replaces_sep() -> None:
    """text_display() must replace ¤ with ' | '."""
    text = "hello\u00a4world"
    result = text_display(text)
    assert result == "hello | world"


def test_count_sep() -> None:
    """count_sep() must count ¤ occurrences correctly."""
    assert count_sep("a\u00a4b\u00a4c") == 2
    assert count_sep("no separator here") == 0
    assert count_sep("\u00a4") == 1
