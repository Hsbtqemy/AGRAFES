"""Sentence segmenter — rule-based block → sentence-level units.

Splits a document's stored line units into sentence-level units using regex
rules. Protects known abbreviations and decimal numbers from false boundary
detection. After resegmentation the FTS index is stale (rebuild via `index`).
Stale alignment_links for the document are deleted automatically.

See docs/DECISIONS.md ADR-017.
"""

from __future__ import annotations

import logging
import re
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Abbreviation protection
# ---------------------------------------------------------------------------

# Pattern that matches tokens that should NOT be treated as sentence ends.
_ABBREV_RE = re.compile(
    r"\b(?:M|Mme|Mmes|Dr|Prof|St|Sgt|Cdt|Lt|Cpt|Mlle|Mlles|No|Nos|Mr|Mrs|Ms)\."
    r"|\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\."
    r"|\b(?:p|pp|vol|ed|eds|fig|tab|art|sect|cf|vs|ibid|loc|op|cit)\."
    r"|\d+\.\d+"  # decimal numbers: 3.14, 1.000
)

# Split on sentence-ending punctuation followed by whitespace then a capital
# letter or opening quote/parenthesis. Does not split mid-abbreviation because
# abbreviations are protected before this regex is applied.
_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-ZÀ-Ÿ\"\u2018\u2019\u201C\u201D(])")


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def segment_text(text: str, lang: str = "und") -> list[str]:
    """Split *text* into sentence strings using rule-based regex.

    Strategy:
    1. Replace known abbreviations with null-byte placeholders so their
       terminal periods are invisible to the sentence-split regex.
    2. Split on `(?<=[.!?])\\s+(?=[A-ZÀ-Ÿ…])` — end-punct then whitespace
       then a capital letter (handles FR and EN text well).
    3. Restore placeholders.

    Returns a non-empty list of stripped sentence strings. If no split is
    found the original text is returned as a single-element list.

    Args:
        text: Text to segment (already normalized, e.g. text_norm).
        lang: ISO language code (reserved for future language-specific rules).
    """
    if not text or not text.strip():
        return [text] if text else []

    # Step 1: protect abbreviations
    counter = 0
    placeholders: dict[str, str] = {}

    def _protect(m: re.Match) -> str:
        nonlocal counter
        ph = f"\x00A{counter}\x00"
        placeholders[ph] = m.group(0)
        counter += 1
        return ph

    protected = _ABBREV_RE.sub(_protect, text)

    # Step 2: split on sentence boundaries
    raw_sentences = _SPLIT_RE.split(protected)

    # Step 3: restore abbreviations in each fragment
    result: list[str] = []
    for fragment in raw_sentences:
        restored = fragment
        for ph, original in placeholders.items():
            restored = restored.replace(ph, original)
        stripped = restored.strip()
        if stripped:
            result.append(stripped)

    return result if result else [text.strip()]


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


@dataclass
class SegmentationReport:
    """Result of segmenting one document."""

    doc_id: int
    units_input: int    # Line units before segmentation
    units_output: int   # Sentence-level units after segmentation
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "units_input": self.units_input,
            "units_output": self.units_output,
            "warnings": self.warnings,
        }


# ---------------------------------------------------------------------------
# DB operation
# ---------------------------------------------------------------------------


def resegment_document(
    conn: sqlite3.Connection,
    doc_id: int,
    lang: str = "und",
    run_logger: Optional[logging.Logger] = None,
) -> SegmentationReport:
    """Replace line units in *doc_id* with sentence-segmented units.

    Steps:
    1. Load all line units (text_norm) ordered by n.
    2. Segment each unit into sentences via segment_text().
    3. Delete stale alignment_links that referenced this document.
    4. Delete old line units.
    5. Insert new sentence-level line units (n = 1, 2, 3, … globally).
    6. Commit.

    **FTS index is NOT rebuilt** — caller must run build_index() afterwards.
    alignment_links are deleted automatically with a warning.

    Returns SegmentationReport with unit counts.
    """
    log = run_logger or logger

    rows = conn.execute(
        "SELECT unit_id, n, text_raw, text_norm FROM units"
        " WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
        (doc_id,),
    ).fetchall()

    if not rows:
        log.warning("resegment_document: no line units for doc_id=%d", doc_id)
        return SegmentationReport(
            doc_id=doc_id,
            units_input=0,
            units_output=0,
            warnings=[f"No line units found for doc_id={doc_id}"],
        )

    # Collect new sentence-level unit tuples
    new_units: list[tuple] = []  # (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)
    global_n = 1

    for row in rows:
        text_norm = row["text_norm"] or ""
        sentences = segment_text(text_norm, lang)
        for sent in sentences:
            new_units.append((doc_id, "line", global_n, None, sent, sent, None))
            global_n += 1

    # Delete stale alignment_links
    deleted_links = conn.execute(
        "DELETE FROM alignment_links WHERE pivot_doc_id = ? OR target_doc_id = ?",
        (doc_id, doc_id),
    ).rowcount
    warn = (
        f"Deleted {deleted_links} alignment_link(s) for doc_id={doc_id}"
        " (stale after resegmentation)"
    )
    log.warning(warn)

    # Delete old line units
    conn.execute("DELETE FROM units WHERE doc_id = ? AND unit_type = 'line'", (doc_id,))

    # Insert new units
    conn.executemany(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        new_units,
    )
    conn.commit()

    log.info(
        "Resegmented doc_id=%d: %d line units → %d sentence units",
        doc_id, len(rows), len(new_units),
    )
    return SegmentationReport(
        doc_id=doc_id,
        units_input=len(rows),
        units_output=len(new_units),
        warnings=[warn] if deleted_links > 0 else [],
    )
