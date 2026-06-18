"""Direct unit tests for curation.py (audit T-02).

`rules_from_list` had some coverage in test_v21.py; the rest of the engine did
not. These tests cover the pure helpers (ReDoS/length guard, JS→Python
replacement translation, apply_rules) and — the real core — curate_document's
5-level priority logic, paratextual exclusion, the Mode-A undo recorder
callback, and the alignment source-change propagation.
"""

from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine import curation
from multicorpus_engine.curation import (
    CurationReport,
    CurationRule,
    apply_rules,
    curate_all_documents,
    curate_document,
    rules_from_list,
)


# ── DB helpers ────────────────────────────────────────────────────────────────


def _add_doc(conn: sqlite3.Connection, title: str = "Doc", text_start_n: int | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, created_at, text_start_n) VALUES (?, ?, ?, ?)",
        (title, "fr", "2026-01-01T00:00:00Z", text_start_n),
    )
    conn.commit()
    return int(cur.lastrowid)


def _add_unit(conn: sqlite3.Connection, doc_id: int, n: int, text_norm: str) -> int:
    cur = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?, ?, ?, ?, ?)",
        (doc_id, "line", n, text_norm, text_norm),
    )
    conn.commit()
    return int(cur.lastrowid)


def _add_link(conn: sqlite3.Connection, pivot_unit_id: int, target_unit_id: int, doc_id: int) -> None:
    conn.execute(
        "INSERT INTO alignment_links "
        "(run_id, pivot_unit_id, target_unit_id, external_id, pivot_doc_id, target_doc_id, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("run1", pivot_unit_id, target_unit_id, 1, doc_id, doc_id, "2026-01-01T00:00:00Z"),
    )
    conn.commit()


def _text(conn: sqlite3.Connection, unit_id: int) -> str:
    return conn.execute("SELECT text_norm FROM units WHERE unit_id = ?", (unit_id,)).fetchone()[0]


# ── _validate_user_regex (ReDoS / length guards) ──────────────────────────────


def test_validate_user_regex_accepts_normal() -> None:
    curation._validate_user_regex("ab+c[a-z]*")  # must not raise


def test_validate_user_regex_rejects_too_long() -> None:
    with pytest.raises(ValueError, match="too long"):
        curation._validate_user_regex("a" * 501)


def test_validate_user_regex_rejects_nested_quantifier() -> None:
    with pytest.raises(ValueError, match="nested quantifiers"):
        curation._validate_user_regex("(a+)+")


def test_validate_user_regex_allows_simple_group_quantifier() -> None:
    curation._validate_user_regex("(ab)+")  # not a nested quantifier → ok


# ── _translate_js_replacement ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "repl,expected",
    [
        ("$1", r"\g<1>"),
        ("$&", r"\g<0>"),
        ("$$", "$"),
        ("foo$1bar", r"foo\g<1>bar"),
        ("$12", r"\g<12>"),
        (r"\1", r"\1"),            # Python-style backref left untouched
        ("plain text", "plain text"),
    ],
)
def test_translate_js_replacement(repl: str, expected: str) -> None:
    assert curation._translate_js_replacement(repl) == expected


# ── apply_rules / CurationRule / CurationReport ───────────────────────────────


def test_apply_rules_applies_sequentially() -> None:
    rules = [CurationRule(pattern="a", replacement="b"), CurationRule(pattern="b", replacement="c")]
    assert apply_rules("a", rules) == "c"


def test_apply_rules_empty_returns_input() -> None:
    assert apply_rules("abc", []) == "abc"


def test_curation_rule_compiled_respects_ignorecase() -> None:
    rule = CurationRule(pattern="abc", replacement="X", flags=curation.re.IGNORECASE)
    assert rule.compiled().sub(rule.replacement, "ABC") == "X"


def test_curation_report_to_dict() -> None:
    rep = CurationReport(
        doc_id=5, units_total=10, units_modified=3, units_skipped=2,
        rules_matched=["r1"], warnings=["w"], action_id=7,
    )
    assert rep.to_dict() == {
        "doc_id": 5, "units_total": 10, "units_modified": 3, "units_skipped": 2,
        "rules_matched": ["r1"], "warnings": ["w"], "action_id": 7,
    }


# ── rules_from_list (gaps not covered by test_v21) ────────────────────────────


def test_rules_from_list_parses_flag_letters() -> None:
    rule = rules_from_list([{"pattern": "a", "replacement": "b", "flags": "ims"}])[0]
    assert rule.flags == (curation.re.IGNORECASE | curation.re.MULTILINE | curation.re.DOTALL)


def test_rules_from_list_translates_js_replacement() -> None:
    rule = rules_from_list([{"pattern": "(a)", "replacement": "$1$1"}])[0]
    assert rule.replacement == r"\g<1>\g<1>"


def test_rules_from_list_rejects_invalid_regex() -> None:
    with pytest.raises(ValueError, match="Invalid regex"):
        rules_from_list([{"pattern": "(", "replacement": ""}])


def test_rules_from_list_rejects_too_long_pattern() -> None:
    with pytest.raises(ValueError, match="too long"):
        rules_from_list([{"pattern": "a" * 501, "replacement": ""}])


# ── curate_document: basic apply ──────────────────────────────────────────────


def test_curate_document_applies_rules(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    u1 = _add_unit(db_conn, doc, 1, "aaa")
    u2 = _add_unit(db_conn, doc, 2, "zzz")
    report = curate_document(db_conn, doc, [CurationRule(pattern="a", replacement="x")])
    assert report.units_total == 2
    assert report.units_modified == 1
    assert _text(db_conn, u1) == "xxx"
    assert _text(db_conn, u2) == "zzz"


def test_curate_document_no_units_warns(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    report = curate_document(db_conn, doc, [CurationRule(pattern="a", replacement="x")])
    assert report.units_total == 0
    assert report.units_modified == 0
    assert any("No units" in w for w in report.warnings)


def test_curate_document_no_write_when_unchanged(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    _add_unit(db_conn, doc, 1, "hello")
    # rule matches but replaces with identical text → curated == original
    report = curate_document(db_conn, doc, [CurationRule(pattern="l", replacement="l")])
    assert report.units_modified == 0


def test_curate_document_excludes_paratextual_units(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn, text_start_n=3)
    u1 = _add_unit(db_conn, doc, 1, "aaa")  # paratext (n < 3)
    u3 = _add_unit(db_conn, doc, 3, "aaa")  # translational text
    report = curate_document(db_conn, doc, [CurationRule(pattern="a", replacement="x")])
    assert report.units_total == 1            # only n >= text_start_n considered
    assert report.units_modified == 1
    assert _text(db_conn, u1) == "aaa"        # paratext untouched
    assert _text(db_conn, u3) == "xxx"


def test_curate_document_reports_fired_rules_sorted(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    _add_unit(db_conn, doc, 1, "cat dog")
    rules = [
        CurationRule(pattern="cat", replacement="CAT", description="zeta-rule"),
        CurationRule(pattern="dog", replacement="DOG", description="alpha-rule"),
        CurationRule(pattern="fish", replacement="FISH", description="never-fires"),
    ]
    report = curate_document(db_conn, doc, rules)
    assert report.rules_matched == ["alpha-rule", "zeta-rule"]  # sorted, only fired


# ── curate_document: priority levels ──────────────────────────────────────────


def test_curate_document_persistent_override_wins(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    u1 = _add_unit(db_conn, doc, 1, "aaa")
    db_conn.execute(
        "INSERT INTO curation_exceptions (unit_id, kind, override_text) VALUES (?, 'override', ?)",
        (u1, "OVERRIDDEN"),
    )
    db_conn.commit()
    report = curate_document(db_conn, doc, [CurationRule(pattern="a", replacement="x")])
    assert report.units_modified == 1
    assert _text(db_conn, u1) == "OVERRIDDEN"  # override, not rule output "xxx"


def test_curate_document_persistent_override_identical_no_write(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    u1 = _add_unit(db_conn, doc, 1, "same")
    db_conn.execute(
        "INSERT INTO curation_exceptions (unit_id, kind, override_text) VALUES (?, 'override', ?)",
        (u1, "same"),
    )
    db_conn.commit()
    report = curate_document(db_conn, doc, [CurationRule(pattern="x", replacement="y")])
    assert report.units_modified == 0


def test_curate_document_manual_override(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    u1 = _add_unit(db_conn, doc, 1, "aaa")
    report = curate_document(
        db_conn, doc, [CurationRule(pattern="a", replacement="x")],
        manual_overrides={u1: "MANUAL"},
    )
    assert report.units_modified == 1
    assert _text(db_conn, u1) == "MANUAL"


def test_curate_document_persistent_ignore_skips(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    u1 = _add_unit(db_conn, doc, 1, "aaa")
    db_conn.execute("INSERT INTO curation_exceptions (unit_id, kind) VALUES (?, 'ignore')", (u1,))
    db_conn.commit()
    report = curate_document(db_conn, doc, [CurationRule(pattern="a", replacement="x")])
    assert report.units_skipped == 1
    assert report.units_modified == 0
    assert _text(db_conn, u1) == "aaa"


def test_curate_document_skip_unit_ids(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    u1 = _add_unit(db_conn, doc, 1, "aaa")
    u2 = _add_unit(db_conn, doc, 2, "aaa")
    report = curate_document(
        db_conn, doc, [CurationRule(pattern="a", replacement="x")], skip_unit_ids={u1},
    )
    assert report.units_skipped == 1
    assert report.units_modified == 1
    assert _text(db_conn, u1) == "aaa"
    assert _text(db_conn, u2) == "xxx"


def test_curate_document_override_beats_skip(db_conn: sqlite3.Connection) -> None:
    """Priority 1 (persistent override) wins over priority 4 (session skip)."""
    doc = _add_doc(db_conn)
    u1 = _add_unit(db_conn, doc, 1, "aaa")
    db_conn.execute(
        "INSERT INTO curation_exceptions (unit_id, kind, override_text) VALUES (?, 'override', ?)",
        (u1, "OVR"),
    )
    db_conn.commit()
    report = curate_document(
        db_conn, doc, [CurationRule(pattern="a", replacement="x")], skip_unit_ids={u1},
    )
    assert report.units_modified == 1
    assert report.units_skipped == 0
    assert _text(db_conn, u1) == "OVR"


# ── curate_document: Mode-A undo recorder ─────────────────────────────────────


def test_curate_document_record_action_receives_triples(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    u1 = _add_unit(db_conn, doc, 1, "aaa")
    _add_unit(db_conn, doc, 2, "zzz")  # untouched by the rule
    captured: dict = {}

    def recorder(doc_id: int, triples: list[tuple[int, str, str]]) -> int:
        captured["doc_id"] = doc_id
        captured["triples"] = triples
        return 99

    report = curate_document(
        db_conn, doc, [CurationRule(pattern="a", replacement="x")], record_action=recorder,
    )
    assert report.action_id == 99
    assert captured["doc_id"] == doc
    assert captured["triples"] == [(u1, "aaa", "xxx")]  # only the modified unit


def test_curate_document_record_action_not_called_when_no_updates(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    _add_unit(db_conn, doc, 1, "aaa")
    calls: list[int] = []

    def recorder(doc_id: int, triples: list[tuple[int, str, str]]) -> int:
        calls.append(doc_id)
        return 1

    report = curate_document(
        db_conn, doc, [CurationRule(pattern="zzz", replacement="x")], record_action=recorder,
    )
    assert report.units_modified == 0
    assert report.action_id is None
    assert calls == []


# ── curate_document: alignment source-change propagation ──────────────────────


def test_curate_document_flags_source_changed_on_modified_pivots(db_conn: sqlite3.Connection) -> None:
    doc = _add_doc(db_conn)
    u1 = _add_unit(db_conn, doc, 1, "aaa")  # will be curated
    u2 = _add_unit(db_conn, doc, 2, "zzz")  # untouched
    _add_link(db_conn, u1, u2, doc)  # pivot = u1 (modified)
    _add_link(db_conn, u2, u1, doc)  # pivot = u2 (not modified)

    curate_document(db_conn, doc, [CurationRule(pattern="a", replacement="x")])

    rows = db_conn.execute(
        "SELECT pivot_unit_id, source_changed_at FROM alignment_links"
    ).fetchall()
    by_pivot = {r["pivot_unit_id"]: r["source_changed_at"] for r in rows}
    assert by_pivot[u1] is not None  # modified pivot → flagged
    assert by_pivot[u2] is None      # untouched pivot → not flagged


# ── curate_all_documents ──────────────────────────────────────────────────────


def test_curate_all_documents_one_report_per_doc(db_conn: sqlite3.Connection) -> None:
    d1 = _add_doc(db_conn, title="D1")
    d2 = _add_doc(db_conn, title="D2")
    _add_unit(db_conn, d1, 1, "aaa")
    _add_unit(db_conn, d2, 1, "bbb")  # no "a" → unchanged
    reports = curate_all_documents(db_conn, [CurationRule(pattern="a", replacement="x")])
    assert len(reports) == 2
    by_doc = {r.doc_id: r for r in reports}
    assert by_doc[d1].units_modified == 1
    assert by_doc[d2].units_modified == 0
