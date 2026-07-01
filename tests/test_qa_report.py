"""Tests for the Corpus QA Report (Sprint 2 — V1.5.1).

Covers:
1. External-id holes/duplicates detection (import integrity)
2. Empty unit detection
3. Alignment coverage + orphan counts
4. Collision detection
5. Metadata readiness (missing fields)
6. Gate status (ok / warning / blocking)
7. HTML report contains section headings
8. JSON report keys schema
9. Regression: generate_qa_report returns stable keys on empty corpus
10. write_qa_report writes file + returns dict
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path



# ── Fixtures ──────────────────────────────────────────────────────────────────

def _populate_doc(conn: sqlite3.Connection, title: str = "Test doc", lang: str = "fr") -> int:
    """Insert one document and return its doc_id."""
    conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at) VALUES (?,?,?,datetime('now'))",
        (title, lang, "source"),
    )
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def _insert_unit(conn: sqlite3.Connection, doc_id: int, n: int, ext_id: int, text: str = "Bonjour.") -> int:
    conn.execute(
        "INSERT INTO units (doc_id, n, unit_type, external_id, text_raw, text_norm) VALUES (?,?,?,?,?,?)",
        (doc_id, n, "line", ext_id, text, text),
    )
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


_link_ext_id_seq = 0

def _insert_align_link(
    conn: sqlite3.Connection,
    pivot_doc: int, target_doc: int,
    pivot_unit: int, target_unit: int,
    status: str | None = None,
    run_id: str = "run-test",
) -> None:
    global _link_ext_id_seq
    _link_ext_id_seq += 1
    conn.execute(
        """INSERT INTO alignment_links
           (pivot_doc_id, target_doc_id, pivot_unit_id, target_unit_id,
            run_id, external_id, created_at, status)
           VALUES (?,?,?,?,?,?,datetime('now'),?)""",
        (pivot_doc, target_doc, pivot_unit, target_unit, run_id, _link_ext_id_seq, status),
    )
    conn.commit()


# ── Test 1: external_id holes detected ────────────────────────────────────────

def test_import_integrity_detects_holes(db_conn: sqlite3.Connection) -> None:
    doc_id = _populate_doc(db_conn)
    _insert_unit(db_conn, doc_id, 1, 1)
    _insert_unit(db_conn, doc_id, 2, 2)
    # ext_id 3 missing (hole) → 4 directly
    _insert_unit(db_conn, doc_id, 3, 4)

    from multicorpus_engine.qa_report import _check_import_integrity
    result = _check_import_integrity(db_conn, doc_id)
    assert 3 in result["external_id_holes"], f"Expected hole at 3, got {result['external_id_holes']}"


# ── Test 2: external_id duplicates detected ────────────────────────────────────

def test_import_integrity_detects_duplicates(db_conn: sqlite3.Connection) -> None:
    doc_id = _populate_doc(db_conn)
    _insert_unit(db_conn, doc_id, 1, 10)
    _insert_unit(db_conn, doc_id, 2, 10)   # duplicate!
    _insert_unit(db_conn, doc_id, 3, 11)

    from multicorpus_engine.qa_report import _check_import_integrity
    result = _check_import_integrity(db_conn, doc_id)
    assert 10 in result["external_id_duplicates"]


# ── Test 3: empty unit flagged ─────────────────────────────────────────────────

def test_import_integrity_detects_empty_units(db_conn: sqlite3.Connection) -> None:
    doc_id = _populate_doc(db_conn)
    _insert_unit(db_conn, doc_id, 1, 1, "   ")  # whitespace-only = empty
    _insert_unit(db_conn, doc_id, 2, 2, "Normal text.")

    from multicorpus_engine.qa_report import _check_import_integrity
    result = _check_import_integrity(db_conn, doc_id)
    assert 1 in result["empty_unit_ext_ids"]
    assert 2 not in result["empty_unit_ext_ids"]


# ── Test 4: alignment coverage + orphan counts ─────────────────────────────────

def test_alignment_qa_coverage_and_orphans(db_conn: sqlite3.Connection) -> None:
    """50% pivot coverage should yield a non-empty orphan count."""
    d1 = _populate_doc(db_conn, "Pivot", "fr")
    d2 = _populate_doc(db_conn, "Target", "en")

    u1 = _insert_unit(db_conn, d1, 1, 1)
    u2 = _insert_unit(db_conn, d1, 2, 2)  # orphan pivot unit (no link)
    u3 = _insert_unit(db_conn, d2, 1, 1)
    _insert_unit(db_conn, d2, 2, 2)       # orphan target

    _insert_align_link(db_conn, d1, d2, u1, u3, status="accepted")

    from multicorpus_engine.qa_report import _check_alignment_pairs
    pairs = _check_alignment_pairs(db_conn)
    assert len(pairs) == 1
    pair = pairs[0]
    assert pair["covered_pivot"] == 1
    assert pair["orphan_pivot_units"] == 1   # u2 not linked
    assert pair["coverage_pivot_pct"] == 50.0
    _ = u2  # suppress unused warning


# ── Test 5: collision detection ────────────────────────────────────────────────

def test_alignment_qa_collision(db_conn: sqlite3.Connection) -> None:
    """A pivot unit linked to two target units = 1 collision."""
    d1 = _populate_doc(db_conn, "Pivot", "fr")
    d2 = _populate_doc(db_conn, "Target", "en")

    u1 = _insert_unit(db_conn, d1, 1, 1)
    u3 = _insert_unit(db_conn, d2, 1, 1)
    u4 = _insert_unit(db_conn, d2, 2, 2)

    _insert_align_link(db_conn, d1, d2, u1, u3, status="accepted")
    _insert_align_link(db_conn, d1, d2, u1, u4, status="accepted")  # collision!

    from multicorpus_engine.qa_report import _check_alignment_pairs
    pairs = _check_alignment_pairs(db_conn)
    assert pairs[0]["collisions"] == 1
    assert pairs[0]["severity"] == "warning"


# ── Test 6: metadata readiness — missing title → blocking ─────────────────────

def test_metadata_readiness_missing_title(db_conn: sqlite3.Connection) -> None:
    db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at) VALUES (?,?,?,datetime('now'))",
        ("", "fr", "source"),
    )
    db_conn.commit()
    doc_id = db_conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    from multicorpus_engine.qa_report import _check_metadata_readiness
    result = _check_metadata_readiness(db_conn, doc_id)
    assert "title" in result["missing_fields"]
    assert result["severity"] == "error"


# ── Test 7: gate status propagation ───────────────────────────────────────────

def test_gate_status_no_blocking_on_clean_corpus(db_conn: sqlite3.Connection) -> None:
    """A clean doc (title, language, contiguous IDs) should have no blocking issues."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    import tempfile
    import os

    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False, mode="w", encoding="utf-8") as f:
        f.write("[1] Bonjour.\n[2] Au revoir.\n")
        tmpf = f.name

    try:
        import_txt_numbered_lines(db_conn, tmpf, language="fr", title="Clean doc")
    finally:
        os.unlink(tmpf)

    from multicorpus_engine.qa_report import generate_qa_report
    report = generate_qa_report(db_conn)
    # No blocking issues (doc_role warnings are acceptable/expected)
    assert len(report["gates"]["blocking"]) == 0
    assert report["gates"]["status"] in ("ok", "warning")


# ── Test 8: HTML report contains section headings ─────────────────────────────

def test_html_report_contains_headings(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.qa_report import generate_qa_report, render_qa_report_html

    report = generate_qa_report(db_conn)
    html = render_qa_report_html(report)
    assert "Intégrité import" in html or "int" in html.lower()


def test_html_report_escapes_malicious_metadata(db_conn: sqlite3.Connection) -> None:
    """Doc title is HTML-escaped in the QA report (audit QRY-03 — XSS)."""
    from multicorpus_engine.qa_report import generate_qa_report, render_qa_report_html

    _populate_doc(db_conn, title="<script>alert(1)</script>", lang="fr")
    report = generate_qa_report(db_conn)
    html = render_qa_report_html(report)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
    assert "alignement" in html.lower() or "Alignement" in html
    assert "<!DOCTYPE html>" in html
    assert "<table" in html


# ── Test 9: JSON report schema keys present ───────────────────────────────────

def test_json_report_schema_keys(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.qa_report import generate_qa_report

    report = generate_qa_report(db_conn)
    required_keys = {"generated_at", "doc_count", "summary", "gates",
                     "import_integrity", "metadata_readiness", "alignment_qa"}
    assert required_keys <= set(report.keys()), f"Missing keys: {required_keys - set(report.keys())}"
    gate_keys = {"status", "blocking", "warnings"}
    assert gate_keys <= set(report["gates"].keys())
    summary_keys = {"import_ok", "import_warning", "import_error",
                    "meta_ok", "meta_warning", "meta_error",
                    "align_pairs_checked"}
    assert summary_keys <= set(report["summary"].keys())


# ── Test 10: write_qa_report writes file ──────────────────────────────────────

def test_write_qa_report_json(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    from multicorpus_engine.qa_report import write_qa_report

    out = tmp_path / "report.json"
    result = write_qa_report(db_conn, out, fmt="json")
    assert out.exists()
    data = json.loads(out.read_text("utf-8"))
    assert "gates" in data
    assert isinstance(result, dict)
    assert result["gates"]["status"] in ("ok", "warning", "blocking")


def test_write_qa_report_html(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    from multicorpus_engine.qa_report import write_qa_report

    out = tmp_path / "report.html"
    write_qa_report(db_conn, out, fmt="html")
    assert out.exists()
    content = out.read_text("utf-8")
    assert "<!DOCTYPE html>" in content
    assert "<table" in content


# ── R3.1: anchor consistency (structural role drift on links) ─────────────────

def _insert_role(conn: sqlite3.Connection, name: str, category: str = "structure") -> None:
    conn.execute(
        "INSERT OR IGNORE INTO unit_roles (name, label, category) VALUES (?,?,?)",
        (name, name.title(), category),
    )
    conn.commit()


def _insert_unit_role(
    conn: sqlite3.Connection, doc_id: int, n: int, ext_id: int, role: str, text: str = "Titre.",
) -> int:
    conn.execute(
        "INSERT INTO units (doc_id, n, unit_type, external_id, text_raw, text_norm, unit_role)"
        " VALUES (?,?,?,?,?,?,?)",
        (doc_id, n, "line", ext_id, text, text, role),
    )
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def test_anchor_consistency_flags_structural_role_mismatch(db_conn: sqlite3.Connection) -> None:
    """A structural heading linked to a body line (no role) = anchor drift."""
    from multicorpus_engine.qa_report import _check_anchor_consistency

    _insert_role(db_conn, "intertitre", "structure")
    d1 = _populate_doc(db_conn, "Pivot", "fr")
    d2 = _populate_doc(db_conn, "Target", "en")
    p = _insert_unit_role(db_conn, d1, 1, 1, "intertitre")
    t = _insert_unit(db_conn, d2, 1, 1)  # no role → drift
    _insert_align_link(db_conn, d1, d2, p, t)

    res = _check_anchor_consistency(db_conn)
    assert len(res) == 1
    assert res[0]["links_checked"] == 1
    assert res[0]["inconsistency_count"] == 1
    assert res[0]["severity"] == "warning"
    inc = res[0]["inconsistencies"][0]
    assert inc["pivot_role"] == "intertitre"
    assert inc["target_role"] is None


def test_anchor_consistency_ignores_matching_and_text_roles(db_conn: sqlite3.Connection) -> None:
    """Matching structural roles are consistent; a *text*-category role mismatch is
    legitimate (not an anchor) and must NOT be flagged."""
    from multicorpus_engine.qa_report import _check_anchor_consistency

    _insert_role(db_conn, "intertitre", "structure")
    _insert_role(db_conn, "vers", "text")
    d1 = _populate_doc(db_conn, "Pivot", "fr")
    d2 = _populate_doc(db_conn, "Target", "en")
    # matching structural role → consistent
    p1 = _insert_unit_role(db_conn, d1, 1, 1, "intertitre")
    t1 = _insert_unit_role(db_conn, d2, 1, 1, "intertitre")
    _insert_align_link(db_conn, d1, d2, p1, t1)
    # text-category role vs no role → legitimate, not flagged
    p2 = _insert_unit_role(db_conn, d1, 2, 2, "vers")
    t2 = _insert_unit(db_conn, d2, 2, 2)
    _insert_align_link(db_conn, d1, d2, p2, t2)

    res = _check_anchor_consistency(db_conn)
    assert len(res) == 1
    assert res[0]["links_checked"] == 2
    assert res[0]["inconsistency_count"] == 0
    assert res[0]["severity"] == "ok"


def test_anchor_consistency_in_report_and_strict_gate(db_conn: sqlite3.Connection) -> None:
    """The drift surfaces in the report summary and escalates to blocking under strict."""
    from multicorpus_engine.qa_report import generate_qa_report

    _insert_role(db_conn, "intertitre", "structure")
    d1 = _populate_doc(db_conn, "Pivot", "fr")
    d2 = _populate_doc(db_conn, "Target", "en")
    p = _insert_unit_role(db_conn, d1, 1, 1, "intertitre")
    t = _insert_unit(db_conn, d2, 1, 1)
    _insert_align_link(db_conn, d1, d2, p, t)

    lenient = generate_qa_report(db_conn, policy="lenient")
    assert "anchor_consistency" in lenient
    assert lenient["summary"]["anchor_inconsistencies"] == 1
    assert not lenient["gates"]["blocking"]  # drift is only a warning in lenient

    strict = generate_qa_report(db_conn, policy="strict")
    assert strict["gates"]["status"] == "blocking"
    assert any("anchor drift" in b for b in strict["gates"]["blocking"])
