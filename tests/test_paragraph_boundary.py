"""R6 — manual paragraph boundaries (per-unit toggle).

The user designates one segment as a paragraph start (or removes an existing
boundary) in the matrix / Tours canvas; the coarse grain (``meta_json.parent_n``)
updates a block at a time. Non-destructive, idempotent, undoable (Mode A).
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.coarse_grain import (
    set_paragraph_boundary_document,
    toggle_paragraph_boundary,
)

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


def _u(n: int, parent_n: int | None = None, *, divider: bool = False) -> dict:
    return {"n": n, "parent_n": parent_n, "divider": divider}


# --- toggle_paragraph_boundary (pure) ------------------------------------------

def test_designate_groups_run_before_and_absorbs_tail() -> None:
    """The Beigbeder baseline: eight singletons, désigner segment 4 → [1..3] become
    one ¶ anchored at 1, [4..8] one ¶ anchored at 4 (the whole gesture in one click)."""
    units = [_u(n) for n in range(1, 9)]  # all singletons (parent_n=None)
    assert toggle_paragraph_boundary(units, 4) == {
        1: 1, 2: 1, 3: 1, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4
    }


def test_second_designation_splits_the_tail_block() -> None:
    """From {1..3→1, 4..8→4}, désigner 6 splits the tail: [4,5] stay ¶4, [6..8] → ¶6."""
    units = [_u(1, 1), _u(2, 1), _u(3, 1), _u(4, 4), _u(5, 4), _u(6, 4), _u(7, 4), _u(8, 4)]
    assert toggle_paragraph_boundary(units, 6) == {
        1: 1, 2: 1, 3: 1, 4: 4, 5: 4, 6: 6, 7: 6, 8: 6
    }


def test_retoggle_real_boundary_merges_upward() -> None:
    """Re-clicking a segment that already heads a multi-block removes the boundary:
    its block folds into the preceding paragraph."""
    units = [_u(1, 1), _u(2, 1), _u(3, 1), _u(4, 4), _u(5, 4), _u(6, 6), _u(7, 6), _u(8, 6)]
    # 4 heads [4,5] (size 2) → REMOVE → merge into the block ending at 3 (anchor 1).
    assert toggle_paragraph_boundary(units, 4) == {
        1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 6, 7: 6, 8: 6
    }


def test_designate_inside_existing_block_splits_it() -> None:
    units = [_u(n, 1) for n in range(1, 6)]  # one block 1..5 anchored at 1
    # Désigner 3 → [1,2] stay ¶1, [3,4,5] → ¶3.
    assert toggle_paragraph_boundary(units, 3) == {1: 1, 2: 1, 3: 3, 4: 3, 5: 3}


def test_remove_section_opening_boundary_is_noop() -> None:
    units = [_u(n, 1) for n in range(1, 6)]  # block 1..5 anchored at 1 (size 5)
    # 1 opens the section — nothing before to merge into → unchanged.
    assert toggle_paragraph_boundary(units, 1) == {1: 1, 2: 1, 3: 1, 4: 1, 5: 1}


def test_divider_is_a_section_wall() -> None:
    """A paragraph never crosses an intertitre/structure unit. Désigner 5 groups only
    within the section [4..6]; n=1,2 (before the divider at 3) are untouched."""
    units = [_u(1), _u(2), _u(3, divider=True), _u(4), _u(5), _u(6)]
    assert toggle_paragraph_boundary(units, 5) == {1: 1, 2: 2, 4: 4, 5: 5, 6: 5}


def test_designate_stops_at_next_divider() -> None:
    """The absorbed tail stops at the next section wall, not the doc end."""
    units = [_u(1), _u(2), _u(3), _u(4, divider=True), _u(5), _u(6)]
    # Désigner 2 → [1] → ¶1, [2,3] → ¶2 (stops before the divider at 4); 5,6 untouched.
    assert toggle_paragraph_boundary(units, 2) == {1: 1, 2: 2, 3: 2, 5: 5, 6: 6}


def test_target_on_divider_is_noop() -> None:
    units = [_u(1), _u(2, divider=True), _u(3)]
    assert toggle_paragraph_boundary(units, 2) == {1: 1, 3: 3}


def test_unknown_target_is_noop() -> None:
    units = [_u(1), _u(2), _u(3)]
    assert toggle_paragraph_boundary(units, 99) == {1: 1, 2: 2, 3: 3}


# --- set_paragraph_boundary_document (DB) --------------------------------------

@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "test.db")
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _doc(conn: sqlite3.Connection, *, text_start_n: int = 1) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, source_path, source_hash, created_at, text_start_n)"
        " VALUES ('Doc', 'fr', 'x.txt', 'abc', '2024-01-01T00:00:00', ?)",
        (text_start_n,),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def _insert_lines(conn: sqlite3.Connection, doc: int, count: int) -> None:
    for i in range(1, count + 1):
        conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
            " VALUES (?, 'line', ?, ?, ?)",
            (doc, i, f"seg {i}", f"seg {i}"),
        )
    conn.commit()


def _parent_ns(conn: sqlite3.Connection, doc: int) -> list[tuple[int, int | None]]:
    rows = conn.execute(
        "SELECT n, json_extract(meta_json, '$.parent_n') AS pn FROM units"
        " WHERE doc_id = ? ORDER BY n", (doc,),
    ).fetchall()
    return [(r["n"], r["pn"]) for r in rows]


def _anchors(conn: sqlite3.Connection, doc: int) -> list[int]:
    """Effective coarse anchor per unit (parent_n, or own n when null) — the grouping the
    readers see, independent of whether a block start stores null or an explicit own-n."""
    rows = conn.execute(
        "SELECT n, json_extract(meta_json, '$.parent_n') AS pn FROM units"
        " WHERE doc_id = ? ORDER BY n", (doc,),
    ).fetchall()
    return [r["pn"] if r["pn"] is not None else r["n"] for r in rows]


def _uid(conn: sqlite3.Connection, doc: int, n: int) -> int:
    return conn.execute(
        "SELECT unit_id FROM units WHERE doc_id = ? AND n = ?", (doc, n)
    ).fetchone()["unit_id"]


def test_persists_parent_n(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    _insert_lines(db, doc, 6)
    report = set_paragraph_boundary_document(db, doc, _uid(db, doc, 4))
    assert report["doc_id"] == doc
    assert report["unit_n"] == 4
    # Only segments whose EFFECTIVE anchor moves are written: 2,3 join ¶1, 5,6 join ¶4. The
    # two block starts (1, 4) keep null — own n is already their anchor (equivalent).
    assert report["units_changed"] == 4
    assert report["action_id"] is None   # no recorder passed
    assert _parent_ns(db, doc) == [(1, None), (2, 1), (3, 1), (4, None), (5, 4), (6, 4)]
    assert _anchors(db, doc) == [1, 1, 1, 4, 4, 4]  # ¶1=[1,2,3], ¶2=[4,5,6]


def test_paratext_untouched(db: sqlite3.Connection) -> None:
    doc = _doc(db, text_start_n=3)  # n=1,2 are paratext
    _insert_lines(db, doc, 6)
    set_paragraph_boundary_document(db, doc, _uid(db, doc, 5))
    # Only text-scope units (n>=3) grouped; paratext keeps null; block starts (3,5) keep null.
    assert _parent_ns(db, doc) == [(1, None), (2, None), (3, None), (4, 3), (5, None), (6, 5)]
    assert _anchors(db, doc)[2:] == [3, 3, 5, 5]  # ¶=[3,4] then [5,6]


def test_toggle_leaves_untouched_singletons_in_other_sections(db: sqlite3.Connection) -> None:
    """A toggle's write set (hence its undo snapshot) is limited to segments it regroups: an
    ungrouped singleton in ANOTHER section (past an intertitre wall) is left null, not flipped
    to its own n. Regression for the over-write that snapshotted the whole doc on every click."""
    doc = _doc(db)
    _insert_lines(db, doc, 6)
    db.execute("INSERT INTO unit_roles (name,label) VALUES ('intertitre','Intertitre')")
    # n=3 is a section wall → section A = [1,2], section B = [4,5,6] (all ungrouped/null).
    db.execute("UPDATE units SET unit_role='intertitre' WHERE doc_id=? AND n=3", (doc,))
    db.commit()
    report = set_paragraph_boundary_document(db, doc, _uid(db, doc, 5))  # designate in section B
    # Section A singletons are untouched (still null) — not flipped to own-n.
    assert _parent_ns(db, doc)[:2] == [(1, None), (2, None)]
    # Only unit 6 actually moves (into ¶ anchored at 5); 4 and 5 are block starts (stay null).
    assert report["units_changed"] == 1
    assert _anchors(db, doc) == [1, 2, 3, 4, 5, 5]


def test_idempotent_second_call_same_target(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    _insert_lines(db, doc, 6)
    uid4 = _uid(db, doc, 4)
    set_paragraph_boundary_document(db, doc, uid4)
    again = set_paragraph_boundary_document(db, doc, uid4)
    # Re-designating 4 is now a REMOVE (it heads a multi-block) — merges back to one ¶.
    assert again["units_changed"] == 3  # 4,5,6 fold back to anchor 1
    assert _anchors(db, doc) == [1, 1, 1, 1, 1, 1]  # a single paragraph again


def test_rejects_paratext_target(db: sqlite3.Connection) -> None:
    doc = _doc(db, text_start_n=3)
    _insert_lines(db, doc, 6)
    with pytest.raises(ValueError, match="not an editable text segment"):
        set_paragraph_boundary_document(db, doc, _uid(db, doc, 2))  # n=2 is paratext


def test_rejects_intertitre_target(db: sqlite3.Connection) -> None:
    """A section heading (intertitre-role line) is a divider, not a paragraph — the toggle
    refuses it (symmetric with the front hiding the ¶ on it)."""
    doc = _doc(db)
    _insert_lines(db, doc, 4)
    # units.unit_role is an FK to unit_roles(name) — seed the convention first.
    db.execute("INSERT INTO unit_roles (name,label) VALUES ('intertitre','Intertitre')")
    db.execute("UPDATE units SET unit_role='intertitre' WHERE doc_id=? AND n=2", (doc,))
    db.commit()
    with pytest.raises(ValueError, match="not an editable text segment"):
        set_paragraph_boundary_document(db, doc, _uid(db, doc, 2))


def test_records_and_undoes(db: sqlite3.Connection) -> None:
    """End-to-end Mode A: designate → snapshot → execute_undo restores parent_n."""
    from multicorpus_engine.action_history import (
        ACTION_SET_PARAGRAPH,
        insert_unit_snapshots,
        record_prep_action,
    )
    from multicorpus_engine.undo import execute_undo

    doc = _doc(db)
    _insert_lines(db, doc, 6)

    def _recorder(d_id: int, snaps: list[dict]) -> int:
        action_id = record_prep_action(
            db, doc_id=d_id, action_type=ACTION_SET_PARAGRAPH,
            description="Paragraphe", context={"unit_id": _uid(db, doc, 4)},
        )
        insert_unit_snapshots(
            db, action_id,
            [{"unit_id": s["unit_id"], "text_norm_before": "",
              "meta_json_before": s["meta_json_before"]} for s in snaps],
        )
        return action_id

    report = set_paragraph_boundary_document(db, doc, _uid(db, doc, 4), record_action=_recorder)
    assert report["action_id"] is not None
    assert _anchors(db, doc) == [1, 1, 1, 4, 4, 4]  # ¶1=[1,2,3], ¶2=[4,5,6]
    assert report["units_changed"] == 4  # only 2,3,5,6 written (block starts kept null)

    outcome = execute_undo(db, doc)
    db.commit()
    assert outcome["reverted_action_type"] == ACTION_SET_PARAGRAPH
    assert outcome["fts_stale"] is False
    # meta_json restored → all parent_n back to null (the pre-designation state).
    assert _parent_ns(db, doc) == [(1, None), (2, None), (3, None),
                                   (4, None), (5, None), (6, None)]
