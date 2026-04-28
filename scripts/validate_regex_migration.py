"""Validate persisted regex patterns before migrating curation.py from `re` to `regex` (PyPI).

Walks every `corpus_info.meta_json` in the given DB(s), extracts custom curation
rules' patterns, and compares behavior between Python `re` and `regex.V0` (forced)
on a sample of `text_norm` from the same DB. Flags any divergence for human audit.

Per the design discussion :

- `re.compile()` failures are NOT errors — patterns that compile in `regex` but
  fail in `re` are flagged for review (probably patterns that were silently
  broken and will start matching meaningfully after migration).
- POSIX classes (`[[:alpha:]]`) and Unicode property classes (`\\p{L}`, `\\X`)
  are flagged independently of sample diff — they CHANGE semantics between
  modules even when sample diff happens to be empty.
- `regex.V0` is forced to avoid the auto-V1 silent switch trap when patterns
  contain V1-only features.

Usage:
    python scripts/validate_regex_migration.py <path/to/agrafes.db> [<another.db> ...]

Exit code 0 = clean (safe to migrate).
Exit code 1 = at least one pattern needs human review.
"""
from __future__ import annotations

import io
import json
import re as stdlib_re
import sqlite3
import sys
from pathlib import Path
from typing import Any

# Force UTF-8 stdout (Windows cp1252 console choke-fix).
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

try:
    import regex as third_party_regex
except ImportError:
    print("ERROR: `regex` PyPI package required. Install with: pip install regex")
    sys.exit(2)


_POSIX_OR_UNICODE_SIGNALS = ("[[:", r"\p{", r"\P{", r"\X")
_SAMPLE_PER_DOC = 200  # text_norm samples per affected doc


def _has_posix_or_unicode_class(pattern: str) -> list[str]:
    """Return the list of suspect tokens found in pattern (empty if none)."""
    return [s for s in _POSIX_OR_UNICODE_SIGNALS if s in pattern]


def _flags_from_str(flags_str: str) -> tuple[int, int]:
    """Convert flag string ('i', 'm', 's', etc.) → (re_flags, regex_flags).
    `regex` accepts the same constants as `re` for the basic ones."""
    re_flags = 0
    rx_flags = third_party_regex.V0  # FORCE V0 — avoids silent V1 auto-switch
    if "i" in flags_str:
        re_flags |= stdlib_re.IGNORECASE
        rx_flags |= third_party_regex.IGNORECASE
    if "m" in flags_str:
        re_flags |= stdlib_re.MULTILINE
        rx_flags |= third_party_regex.MULTILINE
    if "s" in flags_str:
        re_flags |= stdlib_re.DOTALL
        rx_flags |= third_party_regex.DOTALL
    return re_flags, rx_flags


def _extract_patterns_from_meta(meta: Any) -> list[dict]:
    """Walk a corpus_info.meta_json structure looking for curation rules.

    Heuristic: any dict that has both 'pattern' and 'replacement' keys is a rule.
    Project presets typically nest rules under meta.presets[*].rules[*].
    """
    patterns: list[dict] = []

    def _walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            if "pattern" in node and "replacement" in node:
                patterns.append({
                    "pattern": str(node["pattern"]),
                    "replacement": str(node["replacement"]),
                    "flags": str(node.get("flags") or ""),
                    "description": str(node.get("description") or ""),
                    "path": path,
                })
            for k, v in node.items():
                _walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, item in enumerate(node):
                _walk(item, f"{path}[{i}]")

    _walk(meta, "meta")
    return patterns


def _sample_text_norm(conn: sqlite3.Connection, limit: int) -> list[str]:
    """Return up to `limit` text_norm strings sampled randomly from line units."""
    rows = conn.execute(
        "SELECT text_norm FROM units WHERE unit_type = 'line' "
        "AND text_norm IS NOT NULL AND length(text_norm) > 0 "
        f"ORDER BY random() LIMIT {limit}"
    ).fetchall()
    return [r[0] for r in rows]


def _diff_pattern(rule: dict, samples: list[str]) -> dict:
    """Compile pattern in re and regex.V0, compare match spans on samples.
    Return a dict describing the diff status."""
    p = rule["pattern"]
    flags_str = rule["flags"]
    re_flags, rx_flags = _flags_from_str(flags_str)

    # Detect POSIX/Unicode-property syntax independently of match diff
    posix_signals = _has_posix_or_unicode_class(p)

    # Step 1: compile in re — failure is informative, not fatal
    try:
        re_compiled = stdlib_re.compile(p, re_flags)
        re_compile_error: str | None = None
    except stdlib_re.error as e:
        re_compiled = None
        re_compile_error = str(e)

    # Step 2: compile in regex (V0 forced)
    try:
        rx_compiled = third_party_regex.compile(p, rx_flags)
        rx_compile_error: str | None = None
    except third_party_regex.error as e:
        rx_compiled = None
        rx_compile_error = str(e)

    result: dict = {
        "pattern": p,
        "description": rule.get("description", ""),
        "path": rule.get("path", ""),
        "flags": flags_str,
        "uses_posix_or_unicode_class": posix_signals,
        "re_compile_error": re_compile_error,
        "regex_compile_error": rx_compile_error,
        "differs_on_samples": [],
        "needs_human_review": False,
    }

    # Both fail → broken pattern, unrelated to migration
    if re_compile_error and rx_compile_error:
        result["status"] = "BOTH_FAIL"
        result["needs_human_review"] = True
        return result

    # Only re fails, regex succeeds → pattern was silently broken in re,
    # will start matching meaningfully after migration. Audit required.
    if re_compile_error and not rx_compile_error:
        result["status"] = "RE_ONLY_FAIL"
        result["needs_human_review"] = True
        return result

    # Only regex fails — unusual; flag it
    if rx_compile_error and not re_compile_error:
        result["status"] = "REGEX_ONLY_FAIL"
        result["needs_human_review"] = True
        return result

    # Both compile — diff matches on samples
    diffs: list[str] = []
    for s in samples:
        re_spans = [(m.start(), m.end()) for m in re_compiled.finditer(s)]
        rx_spans = [(m.start(), m.end()) for m in rx_compiled.finditer(s)]
        if re_spans != rx_spans:
            snippet = s[:80].replace("\n", " | ")
            diffs.append(f"{snippet!r} re={re_spans} regex={rx_spans}")
            if len(diffs) >= 5:
                break

    result["differs_on_samples"] = diffs
    if diffs or posix_signals:
        result["status"] = "BEHAVIOR_DIFFERS" if diffs else "POSIX_USAGE"
        result["needs_human_review"] = True
    else:
        result["status"] = "OK"

    return result


def _audit_db(db_path: Path) -> tuple[list[dict], int]:
    """Return (review_items, total_patterns_audited) for one DB."""
    if not db_path.exists():
        print(f"  ⚠ DB not found: {db_path}")
        return [], 0

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    # corpus_info table is singleton (single row, id=1 typically)
    try:
        rows = conn.execute(
            "SELECT meta_json FROM corpus_info WHERE meta_json IS NOT NULL"
        ).fetchall()
    except sqlite3.OperationalError as e:
        print(f"  ⚠ {db_path.name}: cannot read corpus_info — {e}")
        return [], 0

    all_patterns: list[dict] = []
    for row in rows:
        if not row["meta_json"]:
            continue
        try:
            meta = json.loads(row["meta_json"])
        except json.JSONDecodeError:
            continue
        all_patterns.extend(_extract_patterns_from_meta(meta))

    if not all_patterns:
        print(f"  {db_path.name}: aucun pattern custom dans corpus_info.meta_json — RAS")
        return [], 0

    print(f"  {db_path.name}: {len(all_patterns)} pattern(s) à valider")
    samples = _sample_text_norm(conn, _SAMPLE_PER_DOC)
    if not samples:
        print(f"  ⚠ {db_path.name}: aucun text_norm pour sampler")
        return [], len(all_patterns)

    review = []
    for rule in all_patterns:
        result = _diff_pattern(rule, samples)
        if result["needs_human_review"]:
            review.append({**result, "db": str(db_path)})
    return review, len(all_patterns)


def main(db_paths: list[str]) -> int:
    print(f"\n=== Validation regex migration sur {len(db_paths)} DB(s) ===\n")
    all_review: list[dict] = []
    total_audited = 0

    for db in db_paths:
        review, audited = _audit_db(Path(db))
        all_review.extend(review)
        total_audited += audited

    print()
    print("=" * 60)
    if not all_review:
        print(f"✓ {total_audited} pattern(s) audité(s), aucun ne nécessite de review.")
        print("  Migration re → regex peut être effectuée sans risque sur ces DBs.")
        return 0

    print(f"⚠ {len(all_review)} pattern(s) sur {total_audited} nécessitent une review humaine :")
    print()
    for r in all_review:
        print(f"  [{r['status']}] {r['path']}")
        print(f"    pattern: {r['pattern']!r}")
        if r.get("description"):
            print(f"    description: {r['description']}")
        if r["uses_posix_or_unicode_class"]:
            print(f"    syntaxe POSIX/Unicode détectée: {r['uses_posix_or_unicode_class']}")
        if r["re_compile_error"]:
            print(f"    re.compile() FAIL: {r['re_compile_error']}")
        if r["regex_compile_error"]:
            print(f"    regex.compile() FAIL: {r['regex_compile_error']}")
        for d in r["differs_on_samples"][:3]:
            print(f"    diff: {d}")
        print()

    print("Action : auditer chaque pattern flaggé. Pour chacun, décider si :")
    print("  • le comportement post-migration est correct (validation OK, OK to migrate)")
    print("  • le pattern doit être réécrit avant migration")
    print("  • le pattern doit être supprimé (était silencieusement cassé)")
    return 1


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
