"""Curation engine — rule-based text_norm post-processing.

Allows corpus managers to apply regex substitution rules to the stored
text_norm column of units, correcting OCR errors, normalising spelling
variants, expanding abbreviations, etc., without re-importing the source file.

After curation, the FTS5 index is stale and must be rebuilt via `index`.

Uses the third-party `regex` PyPI package (NOT the stdlib `re`) so user-supplied
patterns can rely on:
  - Unicode property classes : \\p{L}, \\p{Lu}, etc.
  - Grapheme cluster matching : \\X
  - POSIX character classes  : [[:alpha:]]
The `regex` module is API-compatible with `re` for the basic forms used
historically (compile, sub, search, finditer, IGNORECASE/MULTILINE/DOTALL).

`regex.V0` is forced when compiling user patterns to avoid the implicit V1
auto-switch (V1 changes semantics for set operations in char classes etc. —
we want behavior consistent with the documented basic regex grammar).

See docs/DECISIONS.md ADR-015 (curation engine), and the validation script
scripts/validate_regex_migration.py used before this migration.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass, field
from typing import Callable, Optional

import regex as re  # third-party `regex` PyPI — drop-in superset of stdlib `re`

logger = logging.getLogger(__name__)

# M-05: ReDoS guards for user-supplied regex patterns
_MAX_REGEX_LEN = 500
_REDOS_NESTED_RE = re.compile(r"\([^()]*[+*?][^()]*\)[+*{]")

# Force V0 mode to avoid silent V1 auto-switch on patterns using V1 features
# (e.g. set operations in char classes). See validation script docstring.
_USER_REGEX_FLAGS = re.V0


def _validate_user_regex(pattern: str) -> None:
    """Raise ValueError if *pattern* is too long or contains nested quantifiers."""
    if len(pattern) > _MAX_REGEX_LEN:
        raise ValueError(
            f"Regex pattern too long ({len(pattern)} chars, max {_MAX_REGEX_LEN})"
        )
    if _REDOS_NESTED_RE.search(pattern):
        raise ValueError(
            "Regex pattern contains nested quantifiers which could cause catastrophic "
            "backtracking. Simplify the pattern."
        )


# Frontend presets and Find/Replace emit JS-style replacement syntax ($1, $&, $$).
# Python's re.sub uses backslash refs, so without translation those tokens are
# written literally into the curated text. _translate_js_replacement rewrites
# $-prefixed forms while leaving Python-style refs (\1, \g<name>) untouched.
_JS_BACKREF_RE = re.compile(r"\$(\$|&|\d{1,2})")


def _translate_js_replacement(repl: str) -> str:
    def _sub(m: re.Match[str]) -> str:
        token = m.group(1)
        if token == "$":
            return "$"
        if token == "&":
            return r"\g<0>"
        return rf"\g<{int(token)}>"
    return _JS_BACKREF_RE.sub(_sub, repl)


@dataclass
class CurationRule:
    """A single regex substitution rule."""

    pattern: str          # Python regex pattern
    replacement: str      # Replacement string (supports \\1 backreferences)
    flags: int = 0        # re flags: re.IGNORECASE, re.MULTILINE, re.DOTALL
    description: str = "" # Human-readable label (optional, for reporting)

    def compiled(self) -> re.Pattern:
        # OR-in V0 to lock semantics — avoids the regex module's silent V1 switch
        # when the pattern contains V1-specific syntax (set ops in char classes,
        # etc.). See module docstring + scripts/validate_regex_migration.py.
        return re.compile(self.pattern, self.flags | _USER_REGEX_FLAGS)


@dataclass
class CurationReport:
    """Result of curating one document."""

    doc_id: int
    units_total: int
    units_modified: int
    units_skipped: int = 0   # units excluded by selective apply (ignored_unit_ids)
    rules_matched: list[str] = field(default_factory=list)  # descriptions of rules that fired
    warnings: list[str] = field(default_factory=list)
    action_id: Optional[int] = None  # set when a Mode-A undo recorder ran

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "units_total": self.units_total,
            "units_modified": self.units_modified,
            "units_skipped": self.units_skipped,
            "rules_matched": self.rules_matched,
            "warnings": self.warnings,
            "action_id": self.action_id,
        }


# Callback signature for the Mode-A undo recorder.
# Called inside curate_document's transaction, *before* the UPDATE, with the
# list of units about to change. Each tuple is (unit_id, text_norm_before,
# text_norm_after). The callback must INSERT prep_action_history +
# prep_action_unit_snapshots (no commit) and return action_id, or None to
# skip recording for this doc.
CurationActionRecorder = Callable[
    [int, list[tuple[int, str, str]]], Optional[int]
]


def apply_rules(text: str, rules: list[CurationRule]) -> str:
    """Apply all curation rules sequentially to text. Returns the modified text."""
    for rule in rules:
        text = rule.compiled().sub(rule.replacement, text)
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
        _validate_user_regex(pattern)
        try:
            re.compile(pattern, flags)
        except re.error as exc:
            raise ValueError(f"Invalid regex pattern {pattern!r}: {exc}") from exc

        rules.append(CurationRule(
            pattern=pattern,
            replacement=_translate_js_replacement(item["replacement"]),
            flags=flags,
            description=item.get("description", ""),
        ))
    return rules


def curate_document(
    conn: sqlite3.Connection,
    doc_id: int,
    rules: list[CurationRule],
    skip_unit_ids: Optional[set[int]] = None,
    manual_overrides: Optional[dict[int, str]] = None,
    run_logger: Optional[logging.Logger] = None,
    record_action: Optional[CurationActionRecorder] = None,
) -> CurationReport:
    """Apply curation rules to all units of doc_id.

    Updates text_norm in-place in the DB. Only modified units are written.
    The FTS index is NOT rebuilt here — caller must run build_index() afterwards.

    Priority order for each unit (highest first):
      1. Persistent override exception (curation_exceptions.kind = 'override')
      2. manual_overrides session value
      3. Persistent ignore exception (curation_exceptions.kind = 'ignore')
      4. skip_unit_ids session set
      5. Automatic rule application

    skip_unit_ids: optional set of unit_id values to exclude from the apply.
        Used for selective curation based on a local review session (Strategy B:
        apply all *except* the units the user explicitly marked as "ignored").
        Units not present in skip_unit_ids are always processed, including units
        that were not part of the preview sample.

    manual_overrides: optional dict mapping unit_id → user-supplied replacement text.
        When a unit_id is present here, the user's text is written directly instead
        of applying the automatic rules.  Applied before skip_unit_ids so an override
        always wins even if the unit was also marked ignored (override implies acceptance).

    Returns a CurationReport with counts including units_skipped.
    """
    log = run_logger or logger

    # Exclude paratextual units (n < text_start_n) — they are not part of the
    # translational text and should not be modified by curation rules.
    tsn_row = conn.execute(
        "SELECT text_start_n FROM documents WHERE doc_id = ?", (doc_id,)
    ).fetchone()
    tsn = int(tsn_row[0]) if tsn_row and tsn_row[0] is not None else 1
    rows = conn.execute(
        "SELECT unit_id, text_norm FROM units WHERE doc_id = ? AND n >= ? ORDER BY n",
        (doc_id, tsn),
    ).fetchall()

    if not rows:
        log.warning("curate_document: no units for doc_id=%d", doc_id)
        return CurationReport(doc_id=doc_id, units_total=0, units_modified=0,
                              warnings=[f"No units found for doc_id={doc_id}"])

    # Load persistent exceptions for this document (Level 7B).
    unit_ids = [row["unit_id"] for row in rows]
    persistent_exceptions: dict[int, dict] = {}
    if unit_ids:
        placeholders = ",".join("?" * len(unit_ids))
        exc_rows = conn.execute(
            f"SELECT unit_id, kind, override_text FROM curation_exceptions "
            f"WHERE unit_id IN ({placeholders})",
            unit_ids,
        ).fetchall()
        for er in exc_rows:
            persistent_exceptions[er[0]] = {"kind": er[1], "override_text": er[2]}

    modified = 0
    skipped = 0
    rules_fired: set[str] = set()
    updates: list[tuple] = []

    for row in rows:
        unit_id = row["unit_id"]
        original = row["text_norm"] or ""

        # Priority 1: Persistent override exception → always use the stored text.
        exc = persistent_exceptions.get(unit_id)
        if exc and exc["kind"] == "override":
            overridden = exc["override_text"] or ""
            if overridden != original:
                updates.append((overridden, unit_id))
                modified += 1
                log.debug("Persistent override exception applied unit_id=%d", unit_id)
            else:
                log.debug("Persistent override identical to original unit_id=%d", unit_id)
            continue

        # Priority 2: Session manual override → user-supplied text for this run.
        if manual_overrides and unit_id in manual_overrides:
            overridden = manual_overrides[unit_id]
            if overridden != original:
                updates.append((overridden, unit_id))
                modified += 1
                log.debug("Manual override applied unit_id=%d", unit_id)
            else:
                log.debug("Manual override identical to original, no write unit_id=%d", unit_id)
            continue

        # Priority 3: Persistent ignore exception → never curate this unit.
        if exc and exc["kind"] == "ignore":
            skipped += 1
            log.debug("Persistent ignore exception — skipped unit_id=%d", unit_id)
            continue

        # Priority 4: Session skip (user marked ignored in the current review session).
        # Units outside the preview sample are NOT in skip_unit_ids and are always curated.
        if skip_unit_ids and unit_id in skip_unit_ids:
            skipped += 1
            log.debug("Skipped (ignored in review) unit_id=%d", unit_id)
            continue

        # Priority 5: Apply rules normally.
        curated = apply_rules(original, rules)

        if curated != original:
            updates.append((curated, unit_id))
            modified += 1
            for rule in rules:
                if re.search(rule.pattern, original, flags=rule.flags):
                    rules_fired.add(rule.description or rule.pattern)
            log.debug("Curated unit_id=%d", unit_id)

    action_id: Optional[int] = None
    if updates:
        # Mode A undo recorder: called *before* the UPDATE, in the same tx.
        # Builds (unit_id, text_norm_before, text_norm_after) triples from the
        # rows we already loaded — no extra DB round-trip.
        if record_action is not None:
            unit_to_before = {
                int(row["unit_id"]): (row["text_norm"] or "") for row in rows
            }
            triples = [
                (int(unit_id), unit_to_before[int(unit_id)], curated)
                for curated, unit_id in updates
            ]
            action_id = record_action(doc_id, triples)

        conn.executemany(
            "UPDATE units SET text_norm = ? WHERE unit_id = ?",
            updates,
        )
        # Propagate change signal to aligned translations.
        # Every alignment_link whose pivot_unit_id was just modified gets
        # source_changed_at = now so that translators know the source changed.
        modified_unit_ids = [uid for _, uid in updates]
        if modified_unit_ids:
            ph = ",".join("?" * len(modified_unit_ids))
            conn.execute(
                f"UPDATE alignment_links SET source_changed_at = datetime('now')"
                f" WHERE pivot_unit_id IN ({ph})",
                modified_unit_ids,
            )
        conn.commit()

    log.info(
        "Curation doc_id=%d: %d/%d units modified, %d skipped",
        doc_id, modified, len(rows), skipped,
    )
    return CurationReport(
        doc_id=doc_id,
        units_total=len(rows),
        units_modified=modified,
        units_skipped=skipped,
        rules_matched=sorted(rules_fired),
        action_id=action_id,
    )


def curate_all_documents(
    conn: sqlite3.Connection,
    rules: list[CurationRule],
    skip_unit_ids: Optional[set[int]] = None,
    manual_overrides: Optional[dict[int, str]] = None,
    run_logger: Optional[logging.Logger] = None,
    record_action: Optional[CurationActionRecorder] = None,
) -> list[CurationReport]:
    """Apply curation rules to every document in the DB.

    skip_unit_ids:    forwarded to curate_document — see its docstring.
    manual_overrides: forwarded to curate_document — see its docstring.
    record_action:    forwarded to curate_document. The same callback is reused
                      across all docs; it is responsible for emitting one
                      prep_action_history entry per doc that had modifications.
                      No-op docs do not get an entry (see CurationReport.action_id
                      remaining None).

    Returns one CurationReport per document.
    """
    doc_ids = [
        row[0] for row in conn.execute("SELECT doc_id FROM documents ORDER BY doc_id")
    ]
    return [
        curate_document(conn, doc_id, rules, skip_unit_ids=skip_unit_ids,
                        manual_overrides=manual_overrides, run_logger=run_logger,
                        record_action=record_action)
        for doc_id in doc_ids
    ]
