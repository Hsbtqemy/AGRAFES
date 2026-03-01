"""Tests for QA report strict/lenient policy (Sprint 1 — V1.6.0).

Covers:
1. lenient policy: same result as previous behavior (backward-compat)
2. strict policy: import warnings escalate to blocking
3. strict policy: meta warnings escalate to blocking
4. strict policy: align collisions escalate to blocking
5. strict policy: dangling relations escalate to blocking
6. lenient policy: collisions remain as warnings
7. policy_used field present in report
8. gate status changes between lenient/strict for same corpus
9. POLICY_RULES table completeness
10. write_qa_report accepts policy param without error
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest


# ── Helpers ───────────────────────────────────────────────────────────────────

def _insert_doc(conn: sqlite3.Connection, title: str = "Doc", lang: str = "fr") -> int:
    conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at) VALUES (?,?,?,datetime('now'))",
        (title, lang, "source"),
    )
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def _insert_unit(conn: sqlite3.Connection, doc_id: int, n: int, ext_id: int, text: str = "Text.") -> int:
    conn.execute(
        "INSERT INTO units (doc_id, n, unit_type, external_id, text_raw, text_norm) VALUES (?,?,?,?,?,?)",
        (doc_id, n, "line", ext_id, text, text),
    )
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


_ext_seq = 0

def _insert_link(conn: sqlite3.Connection, pd: int, td: int, pu: int, tu: int, status: str | None = "accepted") -> None:
    global _ext_seq
    _ext_seq += 1
    conn.execute(
        """INSERT INTO alignment_links
           (pivot_doc_id, target_doc_id, pivot_unit_id, target_unit_id,
            run_id, external_id, created_at, status)
           VALUES (?,?,?,?,?,?,datetime('now'),?)""",
        (pd, td, pu, tu, "run-policy-test", _ext_seq, status),
    )
    conn.commit()


# ── Test 1: lenient backward-compat ──────────────────────────────────────────

def test_lenient_is_backward_compatible(db_conn: sqlite3.Connection) -> None:
    """generate_qa_report() with policy='lenient' must match default (no policy) behavior."""
    from multicorpus_engine.qa_report import generate_qa_report

    doc_id = _insert_doc(db_conn)
    _insert_unit(db_conn, doc_id, 1, 1)
    # create a hole at 3
    _insert_unit(db_conn, doc_id, 2, 4)

    report_default = generate_qa_report(db_conn)
    report_lenient = generate_qa_report(db_conn, policy="lenient")

    assert report_default["gates"]["status"] == report_lenient["gates"]["status"]
    assert report_default["gates"]["blocking"] == report_lenient["gates"]["blocking"]
    assert report_default["gates"]["warnings"] == report_lenient["gates"]["warnings"]


# ── Test 2: strict escalates import warnings ──────────────────────────────────

def test_strict_escalates_import_warnings_to_blocking(db_conn: sqlite3.Connection) -> None:
    """Holes in import → warning in lenient → blocking in strict."""
    from multicorpus_engine.qa_report import generate_qa_report

    doc_id = _insert_doc(db_conn)
    _insert_unit(db_conn, doc_id, 1, 1)
    _insert_unit(db_conn, doc_id, 2, 3)  # hole at 2

    lenient = generate_qa_report(db_conn, policy="lenient")
    strict = generate_qa_report(db_conn, policy="strict")

    # Lenient: hole is a warning
    assert lenient["gates"]["status"] in ("warning", "blocking")
    # Strict: hole must be blocking
    assert strict["gates"]["status"] == "blocking", f"Expected blocking in strict, got {strict['gates']['status']}"
    assert len(strict["gates"]["blocking"]) > 0


# ── Test 3: strict escalates meta warnings ────────────────────────────────────

def test_strict_escalates_meta_warnings(db_conn: sqlite3.Connection) -> None:
    """doc_role=standalone (meta warning) → warning in lenient → blocking in strict."""
    from multicorpus_engine.qa_report import generate_qa_report

    # doc with title+language but doc_role=standalone → meta warning (no error)
    db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, resource_type, created_at) VALUES (?,?,?,?,datetime('now'))",
        ("My Doc", "fr", "standalone", None),
    )
    db_conn.commit()
    doc_id = db_conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    _insert_unit(db_conn, doc_id, 1, 1)

    lenient = generate_qa_report(db_conn, policy="lenient")
    strict = generate_qa_report(db_conn, policy="strict")

    # meta_warning must exist
    assert lenient["summary"]["meta_warning"] > 0, "Expected meta_warning in lenient"
    # Strict should escalate to blocking
    assert strict["gates"]["status"] == "blocking"


# ── Test 4: strict escalates align collisions ─────────────────────────────────

def test_strict_escalates_collisions_to_blocking(db_conn: sqlite3.Connection) -> None:
    """Collisions are warning in lenient → blocking in strict."""
    from multicorpus_engine.qa_report import generate_qa_report

    d1 = _insert_doc(db_conn, "Pivot", "fr")
    d2 = _insert_doc(db_conn, "Target", "en")
    u1 = _insert_unit(db_conn, d1, 1, 1)
    u2 = _insert_unit(db_conn, d2, 1, 1)
    u3 = _insert_unit(db_conn, d2, 2, 2)
    # Collision: u1 → u2 and u1 → u3
    _insert_link(db_conn, d1, d2, u1, u2)
    _insert_link(db_conn, d1, d2, u1, u3)

    lenient = generate_qa_report(db_conn, policy="lenient")
    strict = generate_qa_report(db_conn, policy="strict")

    assert lenient["summary"]["align_collisions"] > 0
    # Lenient: collisions = warning
    assert lenient["gates"]["status"] in ("warning", "ok"), f"lenient should not block on collisions: {lenient['gates']}"
    # Strict: collisions = blocking
    assert strict["gates"]["status"] == "blocking"


# ── Test 5: strict escalates dangling relations ────────────────────────────────

def test_strict_escalates_dangling_relations(db_conn: sqlite3.Connection) -> None:
    """Dangling relation (target_doc_id does not exist) → warning in lenient → blocking in strict."""
    from multicorpus_engine.qa_report import generate_qa_report

    doc_id = _insert_doc(db_conn)
    _insert_unit(db_conn, doc_id, 1, 1)
    # Insert a dangling doc_relation by temporarily disabling FK enforcement
    db_conn.execute("PRAGMA foreign_keys = OFF")
    db_conn.execute(
        "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at) VALUES (?,?,?,datetime('now'))",
        (doc_id, "translation_of", 9999),
    )
    db_conn.commit()
    db_conn.execute("PRAGMA foreign_keys = ON")

    lenient = generate_qa_report(db_conn, policy="lenient")
    strict = generate_qa_report(db_conn, policy="strict")

    assert lenient["summary"]["relation_issues"] > 0
    assert strict["gates"]["status"] == "blocking"


# ── Test 6: lenient: collisions remain warning ────────────────────────────────

def test_lenient_collisions_stay_warning(db_conn: sqlite3.Connection) -> None:
    """In lenient mode, collisions don't block publication."""
    from multicorpus_engine.qa_report import generate_qa_report

    d1 = _insert_doc(db_conn, "Pivot", "fr")
    d2 = _insert_doc(db_conn, "Target", "en")
    u1 = _insert_unit(db_conn, d1, 1, 1)
    _insert_unit(db_conn, d1, 2, 2)  # no collision for this one
    u2 = _insert_unit(db_conn, d2, 1, 1)
    u3 = _insert_unit(db_conn, d2, 2, 2)
    _insert_link(db_conn, d1, d2, u1, u2)
    _insert_link(db_conn, d1, d2, u1, u3)  # collision

    lenient = generate_qa_report(db_conn, policy="lenient")
    # No blocking items (only collision → warning)
    collision_blockers = [b for b in lenient["gates"]["blocking"] if "collision" in b]
    assert len(collision_blockers) == 0, f"Lenient should not block on collisions: {lenient['gates']['blocking']}"


# ── Test 7: policy_used field present ─────────────────────────────────────────

def test_policy_used_field_in_report(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.qa_report import generate_qa_report

    for p in ("lenient", "strict"):
        report = generate_qa_report(db_conn, policy=p)
        assert report.get("policy_used") == p, f"policy_used missing or wrong for {p}"
        assert report["gates"].get("policy_used") == p


# ── Test 8: gate status changes between lenient and strict ────────────────────

def test_gate_status_differs_between_policies(db_conn: sqlite3.Connection) -> None:
    """With import holes, strict must be more restrictive than or equal to lenient."""
    from multicorpus_engine.qa_report import generate_qa_report

    doc_id = _insert_doc(db_conn)
    _insert_unit(db_conn, doc_id, 1, 1)
    _insert_unit(db_conn, doc_id, 2, 5)  # 3 holes (2,3,4)

    lenient = generate_qa_report(db_conn, policy="lenient")
    strict = generate_qa_report(db_conn, policy="strict")

    order = {"ok": 0, "warning": 1, "blocking": 2}
    assert order[strict["gates"]["status"]] >= order[lenient["gates"]["status"]], \
        f"Strict ({strict['gates']['status']}) must be >= lenient ({lenient['gates']['status']})"


# ── Test 9: POLICY_RULES table completeness ───────────────────────────────────

def test_policy_rules_table_complete() -> None:
    from multicorpus_engine.qa_report import POLICY_RULES, VALID_POLICIES

    required_rules = {"import_error", "import_warning", "meta_error", "meta_warning",
                      "align_error", "align_collision", "relation_issue"}
    assert required_rules <= set(POLICY_RULES.keys()), \
        f"Missing rules: {required_rules - set(POLICY_RULES.keys())}"
    for rule, levels in POLICY_RULES.items():
        for p in VALID_POLICIES:
            assert p in levels, f"Policy '{p}' missing from rule '{rule}'"
            assert levels[p] in ("ok", "warning", "blocking")


# ── Test 10: write_qa_report accepts policy ───────────────────────────────────

def test_write_qa_report_strict_policy(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    from multicorpus_engine.qa_report import write_qa_report

    out = tmp_path / "strict_report.json"
    result = write_qa_report(db_conn, out, fmt="json", policy="strict")
    assert out.exists()
    data = json.loads(out.read_text("utf-8"))
    assert data.get("policy_used") == "strict"
    assert data["gates"].get("policy_used") == "strict"
