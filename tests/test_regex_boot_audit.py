"""Tests for multicorpus_engine.regex_boot_audit.

Couverture des invariants F5 (cf. HANDOFF_PREP § 7) :
  1. extract_patterns_from_meta : trouve les rules nestées (presets[*].rules[*])
  2. extract_patterns_from_meta : ignore les dicts sans 'pattern' OR 'replacement'
  3. audit_pattern : status='OK' si pattern compile dans les deux ET pas de POSIX
  4. audit_pattern : status='POSIX_USAGE' si tokens POSIX/Unicode présents
  5. audit_pattern : status='BOTH_FAIL' si pattern bidon
  6. audit_pattern : status='RE_ONLY_FAIL' pour [[:alpha:]] (re fail, regex OK)
  7. audit_pattern : never raises sur input malformé
  8. audit_persisted_patterns : retourne [] si DB inexistante (pas d'exception)
  9. audit_persisted_patterns : retourne [] si meta_json malformé
 10. audit_persisted_patterns : ne retourne que les audits non-clean
 11. format_audit_warning : retourne '' si liste vide
 12. format_audit_warning : multi-ligne avec status + pattern + flags
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.regex_boot_audit import (
    PatternAudit,
    audit_pattern,
    audit_persisted_patterns,
    extract_patterns_from_meta,
    format_audit_warning,
)


# ─── extract_patterns_from_meta ─────────────────────────────────────────────

def test_extract_finds_nested_rule():
    meta = {
        "presets": [
            {"rules": [{"pattern": r"\s+", "replacement": " ", "flags": "g"}]},
        ],
    }
    out = extract_patterns_from_meta(meta)
    assert len(out) == 1
    assert out[0]["pattern"] == r"\s+"
    assert out[0]["path"].endswith("[0]")


def test_extract_ignores_dicts_without_both_keys():
    meta = {
        "incomplete": {"pattern": "x"},  # no replacement
        "other": {"replacement": "y"},   # no pattern
        "valid": {"pattern": "x", "replacement": "y"},
    }
    out = extract_patterns_from_meta(meta)
    assert len(out) == 1
    assert out[0]["pattern"] == "x"


def test_extract_handles_empty_meta():
    assert extract_patterns_from_meta({}) == []
    assert extract_patterns_from_meta([]) == []
    assert extract_patterns_from_meta(None) == []


def test_extract_records_path_for_debugging():
    meta = {"a": {"b": [{"pattern": "x", "replacement": "y"}]}}
    out = extract_patterns_from_meta(meta)
    assert out[0]["path"] == "meta.a.b[0]"


# ─── audit_pattern ───────────────────────────────────────────────────────────

def test_audit_clean_pattern():
    rule = {"pattern": r"\s+", "replacement": " ", "flags": "g", "description": "spaces"}
    a = audit_pattern(rule)
    assert a.status == "OK"
    assert a.is_clean
    assert a.posix_signals == ()
    assert a.re_compile_error is None
    assert a.regex_compile_error is None


def test_audit_posix_class_flagged():
    # [[:alpha:]] compile dans re (avec FutureWarning, parse comme nested set
    # littéral) ET dans regex (POSIX class). La sémantique diffère silencieusement
    # → status POSIX_USAGE est le bon flag (justement pour signaler la divergence).
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FutureWarning)
        rule = {"pattern": r"[[:alpha:]]+", "replacement": "X", "flags": ""}
        a = audit_pattern(rule)
    assert a.status == "POSIX_USAGE"
    assert "[[:" in a.posix_signals
    assert not a.is_clean


def test_audit_unicode_property_flagged():
    rule = {"pattern": r"\p{L}+", "replacement": "X", "flags": ""}
    a = audit_pattern(rule)
    assert not a.is_clean
    assert r"\p{" in a.posix_signals


def test_audit_both_fail_on_garbage():
    rule = {"pattern": "[unclosed", "replacement": "y", "flags": ""}
    a = audit_pattern(rule)
    assert a.status == "BOTH_FAIL"
    assert a.re_compile_error is not None
    assert a.regex_compile_error is not None


def test_audit_re_only_fail_on_genuine_regex_only_syntax():
    # \X (extended grapheme cluster) — supporté par regex, pas par re.
    rule = {"pattern": r"\X", "replacement": "_", "flags": ""}
    a = audit_pattern(rule)
    # \X est une POSIX/Unicode signal aussi, mais comme re fail vraiment
    # ici, RE_ONLY_FAIL prend la priorité dans la cascade if/elif.
    assert a.status == "RE_ONLY_FAIL"
    assert a.re_compile_error is not None
    assert a.regex_compile_error is None


def test_audit_never_raises_on_missing_keys():
    # input minimal → ne doit pas exploser
    a = audit_pattern({})
    assert isinstance(a, PatternAudit)
    # pattern vide compile OK des deux côtés
    assert a.status == "OK"


def test_audit_flags_parsed():
    rule = {"pattern": "abc", "replacement": "X", "flags": "i"}
    a = audit_pattern(rule)
    assert a.flags == "i"
    assert a.status == "OK"


# ─── audit_persisted_patterns ────────────────────────────────────────────────

def test_audit_persisted_db_not_found():
    assert audit_persisted_patterns("/nonexistent/path.db") == []


def test_audit_persisted_returns_only_non_clean(tmp_path: Path):
    import warnings
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE corpus_info (meta_json TEXT)")
    meta = {
        "presets": [
            {"rules": [
                {"pattern": r"\s+", "replacement": " "},           # OK
                {"pattern": r"[[:alpha:]]+", "replacement": "X"},   # POSIX_USAGE
            ]}
        ]
    }
    conn.execute("INSERT INTO corpus_info VALUES (?)", (json.dumps(meta),))
    conn.commit()
    conn.close()

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FutureWarning)
        issues = audit_persisted_patterns(db)
    assert len(issues) == 1
    assert issues[0].status == "POSIX_USAGE"


def test_audit_persisted_handles_malformed_json(tmp_path: Path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE corpus_info (meta_json TEXT)")
    conn.execute("INSERT INTO corpus_info VALUES (?)", ("not valid json {",))
    conn.commit()
    conn.close()

    # Doit retourner [] sans raise
    assert audit_persisted_patterns(db) == []


def test_audit_persisted_handles_missing_table(tmp_path: Path):
    db = tmp_path / "empty.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE other (x INTEGER)")
    conn.commit()
    conn.close()

    # corpus_info absent → [] sans raise
    assert audit_persisted_patterns(db) == []


def test_audit_persisted_handles_null_meta(tmp_path: Path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE corpus_info (meta_json TEXT)")
    conn.execute("INSERT INTO corpus_info VALUES (NULL)")
    conn.commit()
    conn.close()

    assert audit_persisted_patterns(db) == []


# ─── format_audit_warning ────────────────────────────────────────────────────

def test_format_empty_returns_empty_string():
    assert format_audit_warning([]) == ""


def test_format_includes_status_and_pattern():
    a = PatternAudit(
        pattern=r"[[:alpha:]]",
        description="latin letters",
        path="meta.presets[0].rules[1]",
        flags="g",
        status="RE_ONLY_FAIL",
        posix_signals=("[[:",),
        re_compile_error="bad set",
        regex_compile_error=None,
    )
    msg = format_audit_warning([a])
    assert "RE_ONLY_FAIL" in msg
    assert "latin letters" in msg
    assert "[[:alpha:]]" in msg
    assert "POSIX/Unicode tokens" in msg
    assert "bad set" in msg
    assert "validate_regex_migration.py" in msg


def test_format_count_in_header():
    audits = [
        PatternAudit(pattern="x", description="", path="m", flags="", status="POSIX_USAGE"),
        PatternAudit(pattern="y", description="", path="m", flags="", status="POSIX_USAGE"),
    ]
    msg = format_audit_warning(audits)
    assert "2 pattern(s)" in msg
