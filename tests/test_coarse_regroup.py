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


def _doc(conn: sqlite3.Connection, *, text_start_n: int | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, source_path, source_hash, created_at,"
        " text_start_n) VALUES ('Doc', 'fr', 'x.txt', 'abc', '2024-01-01T00:00:00', ?)",
        (text_start_n,),
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
    assert report == {"doc_id": doc, "blocks": 2, "units_grouped": 4, "units_changed": 4,
                      "action_id": None}  # None: no record_action passed (QA-06)
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


# --- Mode A undo (QA-06) --------------------------------------------------------
#
# A "Pré-remplir" rewrites parent_n on the WHOLE document. Before this, it recorded
# nothing at all: not undoable, and — worse on an audit-trail tool — not attributable
# either (the history jumped straight from the previous action to the next one).

def _recorder_for(conn: sqlite3.Connection, seen: list[int]):
    """Mirror of the sidecar adapter: snapshot meta_json, keep no text."""
    from multicorpus_engine.action_history import (
        ACTION_SET_PARAGRAPH,
        insert_unit_snapshots,
        record_prep_action,
    )

    def _recorder(d_id: int, snaps: list[dict]) -> int | None:
        if not snaps:
            return None
        seen.append(len(snaps))
        action_id = record_prep_action(
            conn, doc_id=d_id, action_type=ACTION_SET_PARAGRAPH,
            description=f"Pré-remplir (tours) · {len(snaps)} segments regroupés",
            context={"gesture": "regroup_coarse", "preset": "tours"},
        )
        insert_unit_snapshots(
            conn, action_id,
            [{"unit_id": s["unit_id"], "text_norm_before": "",
              "meta_json_before": s["meta_json_before"]} for s in snaps],
        )
        return action_id

    return _recorder


def test_regroup_records_an_undoable_action(db: sqlite3.Connection) -> None:
    """RED before the fix: regroup_document_coarse had no record_action at all."""
    from multicorpus_engine.undo import execute_undo

    doc = _doc(db)
    _insert_lines(db, doc, ["— Bonjour.", "Comment vas-tu ?", "— Bien.", "Et toi ?"])
    seen: list[int] = []

    report = regroup_document_coarse(
        db, doc, preset="tours", record_action=_recorder_for(db, seen)
    )
    assert report["action_id"] is not None
    assert seen == [4]  # snapshot taken for exactly the units that move

    outcome = execute_undo(db, doc)
    db.commit()
    assert outcome["reverted_action_type"] == "set_paragraph"
    assert outcome["fts_stale"] is False
    # every parent_n back to its pre-regroup state (null)
    rows = db.execute(
        "SELECT json_extract(meta_json, '$.parent_n') AS pn FROM units"
        " WHERE doc_id = ? ORDER BY n", (doc,),
    ).fetchall()
    assert [r["pn"] for r in rows] == [None, None, None, None]


def test_regroup_undo_restores_a_manual_grouping(db: sqlite3.Connection) -> None:
    """The real QA-06 damage: a mass regroup silently overwriting hand-made boundaries."""
    from multicorpus_engine.undo import execute_undo

    doc = _doc(db)
    _insert_lines(db, doc, ["— A", "suite", "— B", "fin"])
    # hand-made structure: everything under one paragraph, as a manual ¶ would leave it
    for n in (1, 2, 3, 4):
        db.execute(
            "UPDATE units SET meta_json = ? WHERE doc_id = ? AND n = ?",
            (json.dumps({"parent_n": 1}), doc, n),
        )
    db.commit()

    regroup_document_coarse(db, doc, preset="tours", record_action=_recorder_for(db, []))
    after = [r["pn"] for r in db.execute(
        "SELECT json_extract(meta_json, '$.parent_n') AS pn FROM units"
        " WHERE doc_id = ? ORDER BY n", (doc,))]
    assert after == [1, 1, 3, 3]  # the manual grouping was overwritten

    execute_undo(db, doc)
    db.commit()
    restored = [r["pn"] for r in db.execute(
        "SELECT json_extract(meta_json, '$.parent_n') AS pn FROM units"
        " WHERE doc_id = ? ORDER BY n", (doc,))]
    assert restored == [1, 1, 1, 1]  # hand-made structure given back


def test_regroup_without_changes_records_nothing(db: sqlite3.Connection) -> None:
    """Idempotence must not litter the history with empty actions."""
    doc = _doc(db)
    _insert_lines(db, doc, ["— A", "suite"])
    regroup_document_coarse(db, doc, preset="tours", record_action=_recorder_for(db, []))
    before = db.execute("SELECT count(*) FROM prep_action_history").fetchone()[0]

    again = regroup_document_coarse(
        db, doc, preset="tours", record_action=_recorder_for(db, [])
    )
    assert again["units_changed"] == 0
    assert again["action_id"] is None
    after = db.execute("SELECT count(*) FROM prep_action_history").fetchone()[0]
    assert after == before


# --- borne de paratexte (R2) ----------------------------------------------------
#
# Les deux gestes qui écrivent `meta_json.parent_n` ne s'accordaient pas sur la borne :
# `POST /segment/paragraph_boundary` (¶ par segment) refuse le paratexte en 400, quand
# « Pré-remplir » descendait jusqu'à n=1. Le moteur énonce pourtant la règle — le grain
# de paragraphe s'arrête au texte — et l'un des deux écrivains l'ignorait
# (audit alignement §11.9, troisième occurrence du motif « aperçu↔apply et bornes
# text_start_n »). Mesuré avant de corriger : la base vive n'en portait aucune trace,
# la copie de travail deux unités sur le seul doc 416.


def test_paratext_keeps_no_parent_n(db: sqlite3.Connection) -> None:
    """RED avant le correctif : les trois lignes de paratexte repartaient avec parent_n=1."""
    doc = _doc(db, text_start_n=4)
    _insert_lines(db, doc, ["Titre", "Auteur", "1975", "— Bonjour.", "Et toi ?"])
    report = regroup_document_coarse(db, doc, preset="tours")

    rows = db.execute(
        "SELECT n, json_extract(meta_json, '$.parent_n') AS pn FROM units"
        " WHERE doc_id = ? AND n < 4 ORDER BY n", (doc,),
    ).fetchall()
    assert [(r["n"], r["pn"]) for r in rows] == [(1, None), (2, None), (3, None)]
    assert report["units_grouped"] == 2  # le texte seul, pas les cinq lignes


def test_text_unit_is_never_anchored_in_the_paratext(db: sqlite3.Connection) -> None:
    """RED : c'est le résidu observé en base — doc 416, n=4 ancré sur parent_n=1.

    La première ligne de texte ne porte pas la frontière ; sans borne, elle héritait donc
    de l'ancre du paratexte au lieu d'ouvrir son propre paragraphe.
    """
    doc = _doc(db, text_start_n=4)
    _insert_lines(db, doc, ["Titre", "Auteur", "1975", "Il était une fois.", "— Bonjour.", "Suite"])
    regroup_document_coarse(db, doc, preset="tours")

    rows = db.execute(
        "SELECT n, json_extract(meta_json, '$.parent_n') AS pn FROM units"
        " WHERE doc_id = ? AND n >= 4 ORDER BY n", (doc,),
    ).fetchall()
    assert [(r["n"], r["pn"]) for r in rows] == [(4, 4), (5, 5), (6, 5)]


def test_absent_text_start_n_still_groups_everything(db: sqlite3.Connection) -> None:
    """La borne est facultative : sans elle (colonne NULL), rien ne change."""
    doc = _doc(db)  # text_start_n NULL
    _insert_lines(db, doc, ["— A", "suite", "— B"])
    report = regroup_document_coarse(db, doc, preset="tours")
    assert report["units_grouped"] == 3
