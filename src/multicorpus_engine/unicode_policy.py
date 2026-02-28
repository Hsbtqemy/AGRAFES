"""Encoding & Unicode Policy — multicorpus_engine.

All transformations applied to produce text_norm from text_raw.
See docs/DECISIONS.md ADR-003 for the full policy rationale.
"""

from __future__ import annotations

import unicodedata

# Characters to remove from text_norm (invisibles)
_REMOVE_CHARS = frozenset(
    [
        "\u200b",  # ZERO WIDTH SPACE
        "\u200c",  # ZERO WIDTH NON-JOINER
        "\u200d",  # ZERO WIDTH JOINER
        "\u2060",  # WORD JOINER
        "\ufeff",  # BOM / ZERO WIDTH NO-BREAK SPACE
        "\u00ad",  # SOFT HYPHEN
    ]
)

# Characters normalized to ASCII space in text_norm
_NORMALIZE_TO_SPACE = frozenset(
    [
        "\u00a0",  # NON-BREAKING SPACE
        "\u202f",  # NARROW NO-BREAK SPACE
        "\u2007",  # FIGURE SPACE
        "\u2009",  # THIN SPACE
        "\u00a4",  # CURRENCY SIGN (¤) — per ADR-002
    ]
)

# ASCII control characters to strip (except TAB=0x09, LF=0x0A, CR=0x0D)
_STRIP_CONTROLS = frozenset(
    chr(c)
    for c in range(0x00, 0x20)
    if c not in (0x09, 0x0A, 0x0D)
)


def normalize(text: str) -> str:
    """Apply the full Unicode normalization policy to produce text_norm.

    Steps:
    1. Unicode NFC normalization.
    2. Normalize line breaks to \\n.
    3. Remove invisible characters (ZWSP, soft hyphen, BOM, etc.).
    4. Normalize NBSP/NNBSP/¤ → ASCII space.
    5. Strip ASCII control characters (except TAB and LF).

    The result is suitable for FTS indexing and downstream processing.
    """
    if not text:
        return text

    # 1. NFC
    text = unicodedata.normalize("NFC", text)

    # 2. Normalize line breaks
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # 3 & 4 & 5. Character-by-character pass
    result: list[str] = []
    for ch in text:
        if ch in _REMOVE_CHARS:
            continue  # drop completely
        if ch in _NORMALIZE_TO_SPACE:
            result.append(" ")  # replace with space
            continue
        if ch in _STRIP_CONTROLS:
            continue  # drop control chars
        result.append(ch)

    return "".join(result)


def text_display(text_raw: str) -> str:
    """Return a display-friendly version of text_raw for UI rendering.

    NOT stored in DB. Replaces ¤ with ' | ' to show segment boundaries visibly.
    See ADR-002.
    """
    return text_raw.replace("\u00a4", " | ")


def count_sep(text_raw: str) -> int:
    """Count ¤ separators in text_raw (for meta_json sep_count)."""
    return text_raw.count("\u00a4")


def sha256_of_bytes(data: bytes) -> str:
    """Return hex SHA-256 of raw bytes (for source_hash)."""
    import hashlib
    return hashlib.sha256(data).hexdigest()
