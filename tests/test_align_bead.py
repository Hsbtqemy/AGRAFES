"""Cell bead — set_bead / clear_bead + the gesture backfill (R3.3, D-W16).

A matrix cell holding several links is ONE bead (1 hub segment ↔ N target sentences),
not a collision: the « couper à cheval » gesture used to add a manual link with no
bead_uid next to the aligner's link, which the collision detector read as 2 distinct
beads → phantom alert in Qualité / Révision fine. The bead_uid is derived from the cell
(pivot_unit_id, target_doc_id), so the gestures and the backfill agree; the backfill is
deliberately narrow — a LEGITIMATE aligner collision must never be silenced.
"""
from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.align_links_service import (
    cell_bead_uid,
    clear_bead,
    set_bead,
)
from multicorpus_engine.services.errors import NotFoundError

# The detector's own predicate (sidecar.py / qa_report.py) — a collision is a pivot with
# more than one DISTINCT bead where not every link is accepted.
_COLLISION_SQL = """
    SELECT pivot_unit_id FROM alignment_links
     WHERE pivot_doc_id=1 AND target_doc_id=2
     GROUP BY pivot_unit_id
    HAVING COUNT(DISTINCT COALESCE(bead_uid, 'L' || link_id)) > 1
       AND COUNT(CASE WHEN status = 'accepted' THEN 1 END) < COUNT(*)
"""


def _collisions(conn: sqlite3.Connection) -> list[int]:
    return [int(r[0]) for r in conn.execute(_COLLISION_SQL)]


def _setup_family(conn: sqlite3.Connection) -> None:
    for title, lang, role in (("FR", "fr", "original"), ("EN", "en", "translation")):
        conn.execute(
            "INSERT INTO documents (title, language, doc_role, created_at) VALUES (?,?,?,datetime('now'))",
            (title, lang, role),
        )
    conn.execute(
        "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at)"
        " VALUES (2,'translation_of',1,datetime('now'))"
    )
    for n, t in ((1, "FR1"), (2, "FR2")):
        conn.execute(
            "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (1,'line',?,?,?)",
            (n, t, t.lower()),
        )
    for n, t in ((1, "EN1"), (2, "EN2")):
        conn.execute(
            "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (2,'line',?,?,?)",
            (n, t, t.lower()),
        )
    conn.commit()


def _straddle_shape(conn: sqlite3.Connection) -> None:
    """What a « couper à cheval » leaves on hub unit 2's cell: the aligner's link (with a
    bead_uid, sliced) + the manual link this tool created and sliced."""
    conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at,bead_id,bead_uid,target_char_start,target_char_end)"
        " VALUES ('run1',2,4,0,1,2,datetime('now'),7,'run1#7',0,3)"
    )
    conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at,target_char_start,target_char_end)"
        " VALUES ('manual',2,3,0,1,2,datetime('now'),1,3)"
    )
    conn.commit()


def test_set_bead_groups_the_cell_and_kills_the_phantom_collision(db_conn: sqlite3.Connection) -> None:
    _setup_family(db_conn)
    _straddle_shape(db_conn)
    # Before: the two links of hub unit 2's cell read as two beads → collision.
    assert _collisions(db_conn) == [2]

    for (link_id,) in db_conn.execute("SELECT link_id FROM alignment_links WHERE pivot_unit_id=2"):
        set_bead(db_conn, link_id)
    db_conn.commit()

    # After: one derived bead for the whole cell → no collision, and the uid is the cell's.
    assert _collisions(db_conn) == []
    uids = {r[0] for r in db_conn.execute("SELECT bead_uid FROM alignment_links WHERE pivot_unit_id=2")}
    assert uids == {cell_bead_uid(2, 2)} == {"cell#2#2"}


def test_clear_bead_ungroups(db_conn: sqlite3.Connection) -> None:
    _setup_family(db_conn)
    _straddle_shape(db_conn)
    for (link_id,) in db_conn.execute("SELECT link_id FROM alignment_links WHERE pivot_unit_id=2"):
        set_bead(db_conn, link_id)
    db_conn.commit()
    assert _collisions(db_conn) == []

    # Ungrouping restores the singleton beads (the cell is a collision again).
    for (link_id,) in db_conn.execute("SELECT link_id FROM alignment_links WHERE pivot_unit_id=2"):
        clear_bead(db_conn, link_id)
    db_conn.commit()
    assert _collisions(db_conn) == [2]
    assert all(
        r[0] is None
        for r in db_conn.execute("SELECT bead_uid FROM alignment_links WHERE pivot_unit_id=2")
    )


def test_set_and_clear_bead_not_found(db_conn: sqlite3.Connection) -> None:
    _setup_family(db_conn)
    with pytest.raises(NotFoundError):
        set_bead(db_conn, 999)
    with pytest.raises(NotFoundError):
        clear_bead(db_conn, 999)


def test_backfill_030_groups_gesture_cells_only(db_conn: sqlite3.Connection) -> None:
    """The migration catches up the cells the gestures already produced — and must NOT
    silence a legitimate aligner collision (a real ambiguity for the human to arbitrate).

    db_conn already ran every migration, so 030 is replayed here on data inserted after
    the fact — exactly what it does on a QA database at startup.
    """
    from pathlib import Path

    _setup_family(db_conn)
    _straddle_shape(db_conn)  # hub unit 2 = gesture cell (manual + cut)
    # Hub unit 1 = a LEGITIMATE aligner collision: two links from the same run, no bead,
    # no cut, nothing manual. It must stay flagged.
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at) VALUES ('run1',1,3,0,1,2,datetime('now'))"
    )
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at) VALUES ('run1',1,4,0,1,2,datetime('now'))"
    )
    db_conn.commit()
    assert sorted(_collisions(db_conn)) == [1, 2]

    sql = (Path(__file__).resolve().parent.parent / "migrations"
           / "030_alignment_gesture_bead_backfill.sql").read_text(encoding="utf-8")
    db_conn.executescript(sql)
    db_conn.commit()

    # The gesture cell is grouped; the aligner's genuine ambiguity is untouched.
    assert _collisions(db_conn) == [1]
    assert {r[0] for r in db_conn.execute(
        "SELECT bead_uid FROM alignment_links WHERE pivot_unit_id=2")} == {"cell#2#2"}
    assert {r[0] for r in db_conn.execute(
        "SELECT bead_uid FROM alignment_links WHERE pivot_unit_id=1")} == {None}


def test_backfill_030_ignores_a_lone_gesture_link(db_conn: sqlite3.Connection) -> None:
    """A cell with a single link is already one bead — the backfill leaves it alone
    (grouping it would be a no-op write, and a 1-link cell is never a collision)."""
    from pathlib import Path

    _setup_family(db_conn)
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at,target_char_start,target_char_end)"
        " VALUES ('manual',2,3,0,1,2,datetime('now'),0,3)"
    )
    db_conn.commit()
    sql = (Path(__file__).resolve().parent.parent / "migrations"
           / "030_alignment_gesture_bead_backfill.sql").read_text(encoding="utf-8")
    db_conn.executescript(sql)
    db_conn.commit()

    assert [r[0] for r in db_conn.execute("SELECT bead_uid FROM alignment_links")] == [None]
    assert _collisions(db_conn) == []
