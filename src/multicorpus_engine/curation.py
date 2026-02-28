"""Curation engine — rule-based text_norm post-processing.

Allows corpus managers to apply regex substitution rules to the stored
text_norm column of units, correcting OCR errors, normalising spelling
variants, expanding abbreviations, etc., without re-importing the source file.

After curation, the FTS5 index is stale and must be rebuilt via `index`.

See docs/DECISIONS.md ADR-015.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class CurationRule:
    """A single regex substitution rule."""

    pattern: str          # Python regex pattern
    replacement: str      # Replacement string (supports \\1 backreferences)
    flags: int = 0        # re flags: re.IGNORECASE, re.MULTILINE, re.DOTALL
    description: str = "" # Human-readable label (optional, for reporting)

    def compiled(self) -> re.Pattern:
        return re.compile(self.pattern, self.flags)


@dataclass
class CurationReport:
    """Result of curating one document."""

    doc_id: int
    units_total: int
    units_modified: int
    rules_matched: list[str] = field(default_factory=list)  # descriptions of rules that fired
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "units_total": self.units_total,
            "units_modified": self.units_modified,
            "rules_matched": self.rules_matched,
            "warnings": self.warnings,
        }


def apply_rules(text: str, rules: list[CurationRule]) -> str:
    """Apply all curation rules sequentially to text. Returns the modified text."""
    for rule in rules:
        text = re.sub(rule.pattern, rule.replacement, text, flags=rule.flags)
    return text


def rules_from_list(data: list[dict]) -> list[CurationRule]:
    """Build CurationRule list from a JSON-deserialized list of dicts.

    Each dict must have 'pattern' and 'replacement'; 'flags' (string of
    letters: 'i' = IGNORECASE, 'm' = MULTILINE, 's' = DOTALL) and
    'description' are optional.

    Raises ValueError for invalid patterns.
    """
    rules: list[CurationRule] = []
    for item in data:
        flags_str = item.get("flags", "")
        flags = 0
        if "i" in flags_str:
            flags |= re.IGNORECASE
        if "m" in flags_str:
            flags |= re.MULTILINE
        if "s" in flags_str:
            flags |= re.DOTALL

        pattern = item["pattern"]
        # Validate the pattern early to give a clear error
        try:
            re.compile(pattern, flags)
        except re.error as exc:
            raise ValueError(f"Invalid regex pattern {pattern!r}: {exc}") from exc

        rules.append(CurationRule(
            pattern=pattern,
            replacement=item["replacement"],
            flags=flags,
            description=item.get("description", ""),
        ))
    return rules


def curate_document(
    conn: sqlite3.Connection,
    doc_id: int,
    rules: list[CurationRule],
    run_logger: Optional[logging.Logger] = None,
) -> CurationReport:
    """Apply curation rules to all units of doc_id.

    Updates text_norm in-place in the DB. Only modified units are written.
    The FTS index is NOT rebuilt here — caller must run build_index() afterwards.

    Returns a CurationReport with counts.
    """
    log = run_logger or logger

    rows = conn.execute(
        "SELECT unit_id, text_norm FROM units WHERE doc_id = ? ORDER BY n",
        (doc_id,),
    ).fetchall()

    if not rows:
        log.warning("curate_document: no units for doc_id=%d", doc_id)
        return CurationReport(doc_id=doc_id, units_total=0, units_modified=0,
                              warnings=[f"No units found for doc_id={doc_id}"])

    modified = 0
    rules_fired: set[str] = set()
    updates: list[tuple] = []

    for row in rows:
        unit_id = row["unit_id"]
        original = row["text_norm"] or ""
        curated = apply_rules(original, rules)

        if curated != original:
            updates.append((curated, unit_id))
            modified += 1
            # Track which rules actually fired on this unit
            for rule in rules:
                if re.search(rule.pattern, original, flags=rule.flags):
                    rules_fired.add(rule.description or rule.pattern)
            log.debug("Curated unit_id=%d", unit_id)

    if updates:
        conn.executemany(
            "UPDATE units SET text_norm = ? WHERE unit_id = ?",
            updates,
        )
        conn.commit()

    log.info(
        "Curation doc_id=%d: %d/%d units modified",
        doc_id, modified, len(rows),
    )
    return CurationReport(
        doc_id=doc_id,
        units_total=len(rows),
        units_modified=modified,
        rules_matched=sorted(rules_fired),
    )


def curate_all_documents(
    conn: sqlite3.Connection,
    rules: list[CurationRule],
    run_logger: Optional[logging.Logger] = None,
) -> list[CurationReport]:
    """Apply curation rules to every document in the DB.

    Returns one CurationReport per document.
    """
    doc_ids = [
        row[0] for row in conn.execute("SELECT doc_id FROM documents ORDER BY doc_id")
    ]
    return [
        curate_document(conn, doc_id, rules, run_logger=run_logger)
        for doc_id in doc_ids
    ]
