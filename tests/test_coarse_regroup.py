"""R5.4c/B — ascendant coarse regrouping (non-destructive parent_n relabel).

Sets the coarse grain by relabelling ``meta_json.parent_n`` on the *existing* line
units, grouping consecutive lines under a boundary they carry in their own text
(``tours`` = a leading dialogue dash). No resegmentation → alignment + FTS untouched.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.coarse_grain import (
    regroup_by_boundary,
    regroup_document_coarse,
    resolve_coarse_boundary,
)

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


def _line(n: int, text: str, *, unit_type: str = "line") -> dict:
    return {"n": n, "unit_type": unit_type, "text_norm": text}


# --- resolve_coarse_boundary ----------------------------------------------------

def test_tours_preset_matches_dialogue_dashes_only() -> None:
    b = resolve_coarse_boundary("tours")
    assert b.match("— Bonjour")        # em dash
    assert b.match("– Salut")          # en dash
    assert b.match("   — indenté")     # leading whitespace tolerated
    assert not b.match("Bonjour")
    assert not b.match("- ascii hyphen")  # ASCII hyphen is not a dialogue dash


def test_default_is_tours() -> None:
    assert resolve_coarse_boundary().match("— x")


def test_unknown_preset_raises() -> None:
    with pytest.raises(ValueError, match="Unknown coarse preset"):
        resolve_coarse_boundary("nope")


def test_custom_pattern_wins_over_preset() -> None:
    b = resolve_coarse_boundary(preset="tours", pattern=r"^[A-Z]+:")
    assert b.match("BOB: salut")
    assert not b.match("— salut")  # the custom pattern replaced tours


def test_bad_regex_raises() -> None:
    with pytest.raises(ValueError, match="Invalid boundary pattern"):
        resolve_coarse_boundary(pattern="(")


# --- regroup_by_boundary (pure) -------------------------------------------------

def test_groups_dialogue_turns() -> None:
    b = resolve_coarse_boundary("tours")
    units = [
        _line(1, "— Bonjour, dit-il."),
        _line(2, "Comment vas-tu ?"),
        _line(3, "— Bien, merci."),
        _line(4, "Et toi ?"),
    ]
    assert regroup_by_boundary(units, b) == {1: 1, 2: 1, 3: 3, 4: 3}


def test_first_unit_always_anchors_even_without_marker() -> None:
    b = resolve_coarse_boundary("tours")
    units = [_line(1, "Préambule sans tiret."), _line(2, "— Un tour."), _line(3, "sa suite")]
    assert regroup_by_boundary(units, b) == {1: 1, 2: 2, 3: 2}


def test_structure_units_are_ignored() -> None:
    b = resolve_coarse_boundary("tours")
    units = [_line(1, "— A"), _line(2, "Titre", unit_type="structure"), _line(3, "— B")]
    assert regroup_by_boundary(units, b) == {1: 1, 3: 3}  # only line units


def test_no_match_is_a_single_block() -> None:
    b = resolve_coarse_boundary("tours")
    units = [_line(1, "a"), _line(2, "b"), _line(3, "c")]
    assert regroup_by_boundary(units, b) == {1: 1, 2: 1, 3: 1}


# --- regroup_document_coarse (DB) ----------------------------------------------

@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "test.db")
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _doc(conn: sqlite3.Connection) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, source_path, source_hash, created_at)"
        " VALUES ('Doc', 'fr', 'x.txt', 'abc', '2024-01-01T00:00:00')",
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def _insert_lines(conn: sqlite3.Connection, doc: int, texts: list[str], *, meta=None) -> None:
    for i, text in enumerate(texts, start=1):
        conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm, meta_json)"
            " VALUES (?, 'line', ?, ?, ?, ?)",
            (doc, i, text, text, json.dumps(meta) if meta else None),
        )
    conn.commit()


def test_persists_parent_n_by_tours(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    _insert_lines(db, doc, ["— Bonjour.", "Comment vas-tu ?", "— Bien.", "Et toi ?"])
    report = regroup_document_coarse(db, doc, preset="tours")
    assert report == {"doc_id": doc, "blocks": 2, "units_grouped": 4, "units_changed": 4}
    rows = db.execute(
        "SELECT n, json_extract(meta_json, '$.parent_n') AS pn FROM units"
        " WHERE doc_id = ? ORDER BY n", (doc,),
    ).fetchall()
    assert [(r["n"], r["pn"]) for r in rows] == [(1, 1), (2, 1), (3, 3), (4, 3)]


def test_is_idempotent(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    _insert_lines(db, doc, ["— A", "suite", "— B"])
    regroup_document_coarse(db, doc, preset="tours")
    again = regroup_document_coarse(db, doc, preset="tours")
    assert again["units_changed"] == 0


def test_preserves_other_meta_keys(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    _insert_lines(db, doc, ["— A"], meta={"parent_n": 99, "sep_count": 2})
    regroup_document_coarse(db, doc, preset="tours")
    meta = json.loads(db.execute(
        "SELECT meta_json FROM units WHERE doc_id = ? AND n = 1", (doc,)
    ).fetchone()["meta_json"])
    assert meta["parent_n"] == 1   # relabelled to its block anchor
    assert meta["sep_count"] == 2  # unrelated keys preserved


def test_non_destructive_keeps_alignment_and_text(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    _insert_lines(db, doc, ["— A", "suite", "— B"])
    uids = [r["unit_id"] for r in db.execute(
        "SELECT unit_id FROM units WHERE doc_id = ? ORDER BY n", (doc,)
    ).fetchall()]
    db.execute(
        "INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id,"
        " pivot_doc_id, target_doc_id, created_at)"
        " VALUES ('r', ?, ?, 1, ?, ?, '2024-01-01T00:00:00')",
        (uids[0], uids[2], doc, doc),
    )
    db.commit()
    before = [r["text_norm"] for r in db.execute(
        "SELECT text_norm FROM units WHERE doc_id=? ORDER BY n", (doc,)).fetchall()]

    regroup_document_coarse(db, doc, preset="tours")

    # The alignment link survives (unlike a resegmentation, which deletes it).
    assert db.execute(
        "SELECT COUNT(*) c FROM alignment_links WHERE pivot_doc_id=?", (doc,)
    ).fetchone()["c"] == 1
    # Only meta_json was touched — unit text (and count) unchanged.
    after = [r["text_norm"] for r in db.execute(
        "SELECT text_norm FROM units WHERE doc_id=? ORDER BY n", (doc,)).fetchall()]
    assert after == before


def test_bad_preset_raises(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    _insert_lines(db, doc, ["— A"])
    with pytest.raises(ValueError):
        regroup_document_coarse(db, doc, preset="bogus")


def test_writes_are_committed(tmp_path: Path) -> None:
    """The relabel must be durable (conn is not autocommit) — visible from a *fresh*
    connection, not just the writing one."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    db_path = tmp_path / "commit.db"
    conn1 = get_connection(db_path)
    apply_migrations(conn1, migrations_dir=_MIGRATIONS_DIR)
    doc = _doc(conn1)
    _insert_lines(conn1, doc, ["— A", "suite", "— B"])
    regroup_document_coarse(conn1, doc, preset="tours")

    conn2 = get_connection(db_path)  # a second connection sees only committed data
    rows = conn2.execute(
        "SELECT n, json_extract(meta_json, '$.parent_n') AS pn FROM units"
        " WHERE doc_id = ? ORDER BY n", (doc,),
    ).fetchall()
    assert [(r["n"], r["pn"]) for r in rows] == [(1, 1), (2, 1), (3, 3)]


def test_overlong_pattern_rejected() -> None:
    with pytest.raises(ValueError, match="too long"):
        resolve_coarse_boundary(pattern="a" * 501)
