"""Shared XML 1.0 text helpers (stdlib-only) — single source of truth.

Hand-built XML output (TEI export, ODT readable export, TMX builder) must keep two
guarantees: special characters are escaped, and characters **illegal in XML 1.0** are
removed (verbatim ``text_raw`` can carry control chars that would otherwise produce a
malformed document — silent corruption, since nothing re-validates the bytes).

These helpers were duplicated across exporters; centralised here so the XML 1.0 char
range is defined once. ``strip_xml10_invalid`` is built from explicit code points
(no ``\\x``/``\\u`` literals) on purpose, to stay robust to source-encoding pitfalls.
"""

from __future__ import annotations


def _is_xml10_char(cp: int) -> bool:
    # Valid XML 1.0 chars: tab, LF, CR, then 0x20-0xD7FF, 0xE000-0xFFFD, 0x10000-0x10FFFF.
    return (
        cp in (0x09, 0x0A, 0x0D)
        or 0x20 <= cp <= 0xD7FF
        or 0xE000 <= cp <= 0xFFFD
        or 0x10000 <= cp <= 0x10FFFF
    )


def strip_xml10_invalid(text: str) -> str:
    """Remove characters that are illegal in XML 1.0 (control chars except tab/LF/CR)."""
    if not text:
        return text
    return "".join(ch for ch in text if _is_xml10_char(ord(ch)))


def xml_escape(text: str) -> str:
    """Strip XML 1.0 invalid chars, then escape ``& < > " '`` — safe for content and
    double/single-quoted attribute values."""
    text = strip_xml10_invalid(text)
    text = text.replace("&", "&amp;")
    text = text.replace("<", "&lt;")
    text = text.replace(">", "&gt;")
    text = text.replace('"', "&quot;")
    text = text.replace("'", "&apos;")
    return text
