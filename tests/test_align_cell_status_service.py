"""Service tests for align_cell_status_service — per-cell « non traduit » (R3.3, D-W8).

The « ∅ Non traduit » matrix gesture marks the (hub unit × target document) pair
in alignment_cell_statuses (migration 028); status null clears. Guards: the pivot
must be a line unit, the target doc a translation of the pivot's document, and a
cell with active links refuses the mark (un-align first). Local (db_conn), no
sidecar — the HTTP adapter is exercised by the contract suite.
"""
from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.align_cell_status_service import (
    purge_contradicted_cell_statuses,
    set_cell_status,
)
from multicorpus_engine.services.errors import (
    ConflictError,
    NotFoundError,
    ValidationError,
)


def _setup_family(conn: sqlite3.Connection) -> None:
    # docs: 1 = FR hub, 2 = EN translation; units: 1-2 FR lines, 3 EN line, 4 FR structure
    for title, lang, role in (("FR", "fr", "original"), ("EN", "en", "translation")):
        conn.execute(
            "INSERT INTO documents (title, language, doc_role, created_at) VALUES (?,?,?,datetime('now'))",
            (title, lang, role),
        )
    conn.execute(
        "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at)"
        " VALUES (2,'translation_of',1,datetime('now'))"
    )
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (1,'line',1,'A.','a.')")
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (1,'line',2,'B.','b.')")
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (2,'line',1,'a.','a.')")
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (1,'structure',3,'','')")
    conn.commit()


def _cell_rows(conn: sqlite3.Connection) -> list[tuple]:
    return [
        tuple(r)
        for r in conn.execute(
            "SELECT pivot_unit_id, target_doc_id, status FROM alignment_cell_statuses"
            " ORDER BY pivot_unit_id, target_doc_id"
        )
    ]


def test_set_and_clear_cell_status(db_conn: sqlite3.Connection) -> None:
    _setup_family(db_conn)
    out = set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2, "status": "non_traduit"})
    assert out == {"pivot_unit_id": 1, "target_doc_id": 2, "cell_status": "non_traduit"}
    assert _cell_rows(db_conn) == [(1, 2, "non_traduit")]

    # Upsert is idempotent (re-marking the same cell keeps a single row)…
    set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2, "status": "non_traduit"})
    assert _cell_rows(db_conn) == [(1, 2, "non_traduit")]

    # …and status null (or '', or absent) clears the mark.
    out = set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2, "status": None})
    assert out["cell_status"] is None
    assert _cell_rows(db_conn) == []
    # Clearing an unmarked cell is a no-op, not an error.
    set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2})
    assert _cell_rows(db_conn) == []


def test_cell_with_active_links_refuses_mark(db_conn: sqlite3.Connection) -> None:
    """« non traduit » on a translated cell is contradictory — un-align first (↺).
    Rejected links are dead (ALN-03): they do not block the mark."""
    _setup_family(db_conn)
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at) VALUES ('r',1,3,0,1,2,datetime('now'))"
    )
    db_conn.commit()
    with pytest.raises(ConflictError):
        set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2, "status": "non_traduit"})

    db_conn.execute("UPDATE alignment_links SET status='rejected'")
    db_conn.commit()
    out = set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2, "status": "non_traduit"})
    assert out["cell_status"] == "non_traduit"


def test_validation_and_not_found(db_conn: sqlite3.Connection) -> None:
    _setup_family(db_conn)
    with pytest.raises(NotFoundError):
        set_cell_status(db_conn, {"pivot_unit_id": 999, "target_doc_id": 2, "status": "non_traduit"})
    with pytest.raises(NotFoundError):
        set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 999, "status": "non_traduit"})
    # The hub doc itself is not a translation of the pivot's document.
    with pytest.raises(ValidationError):
        set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 1, "status": "non_traduit"})
    # Only line units appear in the matrix (unit 4 is 'structure').
    with pytest.raises(ValidationError):
        set_cell_status(db_conn, {"pivot_unit_id": 4, "target_doc_id": 2, "status": "non_traduit"})
    # Unknown enum value / wrong type / missing ids.
    with pytest.raises(ValidationError):
        set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2, "status": "ajout"})
    with pytest.raises(ValidationError):
        set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2, "status": 7})
    with pytest.raises(ValidationError):
        set_cell_status(db_conn, {"target_doc_id": 2, "status": "non_traduit"})


def test_cascade_on_unit_and_document_delete(db_conn: sqlite3.Connection) -> None:
    """R1 (revue 2026-07-13) — the FKs cascade (migration 029).

    Without it, PRAGMA foreign_keys=ON turned a single mark into an IntegrityError on
    every pre-existing delete path (/documents/delete, /segment, /units/merge,
    /prep/undo) — and those delete the family's alignment_links BEFORE the units, with
    no rollback, so the pending deletion got committed by the next write.
    """
    _setup_family(db_conn)
    set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2, "status": "non_traduit"})
    set_cell_status(db_conn, {"pivot_unit_id": 2, "target_doc_id": 2, "status": "non_traduit"})
    assert len(_cell_rows(db_conn)) == 2

    # Deleting the marked hub unit (segment/merge/undo do exactly this) drops its mark.
    db_conn.execute("DELETE FROM units WHERE unit_id=1")
    db_conn.commit()
    assert _cell_rows(db_conn) == [(2, 2, "non_traduit")]

    # Deleting the target document (documents/delete, whose cascade order is links →
    # units → doc_relations → documents) drops the remaining ones. Re-mark first: the
    # unit delete above already took unit 1's.
    set_cell_status(db_conn, {"pivot_unit_id": 2, "target_doc_id": 2, "status": "non_traduit"})
    db_conn.execute("DELETE FROM units WHERE doc_id=2")
    db_conn.execute("DELETE FROM doc_relations WHERE doc_id=2 OR target_doc_id=2")
    db_conn.execute("DELETE FROM documents WHERE doc_id=2")
    db_conn.commit()
    assert _cell_rows(db_conn) == []


def test_purge_contradicted_marks(db_conn: sqlite3.Connection) -> None:
    """R4 — a link created over a marked cell supersedes the mark (never resurrects).

    The link writers (aligner.align_pair_*, /align/link/create) call the purge; a
    REJECTED link is dead (ALN-03) and must NOT purge anything.
    """
    _setup_family(db_conn)
    set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2, "status": "non_traduit"})
    set_cell_status(db_conn, {"pivot_unit_id": 2, "target_doc_id": 2, "status": "non_traduit"})

    # A rejected link does not contradict anything → nothing purged.
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at,status)"
        " VALUES ('r',2,3,0,1,2,datetime('now'),'rejected')"
    )
    assert purge_contradicted_cell_statuses(db_conn) == 0
    assert len(_cell_rows(db_conn)) == 2

    # An active link on unit 1's cell purges that mark only.
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at) VALUES ('r',1,3,0,1,2,datetime('now'))"
    )
    assert purge_contradicted_cell_statuses(db_conn) == 1
    db_conn.commit()
    assert _cell_rows(db_conn) == [(2, 2, "non_traduit")]


def test_aligner_run_purges_contradicted_marks(db_conn: sqlite3.Connection) -> None:
    """R4, end-to-end: an align run over a marked cell clears the mark (no resurrection)."""
    from multicorpus_engine.aligner import align_pair_by_position

    _setup_family(db_conn)
    # Give the translation a second line so position alignment has something to match.
    db_conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (2,'line',2,'b.','b.')")
    set_cell_status(db_conn, {"pivot_unit_id": 1, "target_doc_id": 2, "status": "non_traduit"})
    db_conn.commit()

    align_pair_by_position(db_conn, pivot_doc_id=1, target_doc_id=2, run_id="test-run")

    # The aligner linked hub unit 1 → its mark is gone (it would otherwise resurface
    # as [non traduit], counted as done, the day the link is removed).
    assert db_conn.execute(
        "SELECT COUNT(*) FROM alignment_cell_statuses WHERE pivot_unit_id=1"
    ).fetchone()[0] == 0
