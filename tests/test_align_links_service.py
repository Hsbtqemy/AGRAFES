"""Service tests for align_links_service — source-anchored "couper" (R3.3, §7-D9).

Records a non-destructive char sub-span (target_char_start/end, migration 027) on an
alignment link; the target document's unit (text + position) and FTS stay untouched.
Local (db_conn), no sidecar.
"""
from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services import align_links_service
from multicorpus_engine.services.errors import (
    ConflictError,
    NotFoundError,
    ValidationError,
)


def _setup_link(
    conn: sqlite3.Connection, target_text: str = "I can hear it now: the sound of the sea."
) -> tuple[int, int]:
    """One FR pivot unit + one EN target unit + a link between them → (link_id, target_unit_id)."""
    conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('P','fr','original',datetime('now'))"
    )
    conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('T','en','translation',datetime('now'))"
    )
    conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (1,'line',1,'Je l''entends.','je l entends')"
    )
    conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (2,'line',1,?,?)",
        (target_text, target_text.lower()),
    )
    conn.commit()
    piv = conn.execute("SELECT unit_id FROM units WHERE doc_id=1").fetchone()[0]
    tgt = conn.execute("SELECT unit_id FROM units WHERE doc_id=2").fetchone()[0]
    cur = conn.execute(
        "INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id,"
        " pivot_doc_id, target_doc_id, created_at) VALUES ('r', ?, ?, 1, 1, 2, datetime('now'))",
        (piv, tgt),
    )
    conn.commit()
    return int(cur.lastrowid), int(tgt)


def test_set_target_span_records_offsets(db_conn: sqlite3.Connection) -> None:
    link_id, _ = _setup_link(db_conn)
    align_links_service.set_target_span(db_conn, link_id, 0, 18)
    db_conn.commit()
    row = db_conn.execute(
        "SELECT target_char_start, target_char_end FROM alignment_links WHERE link_id=?", (link_id,)
    ).fetchone()
    assert (row[0], row[1]) == (0, 18)


def test_set_target_span_out_of_bounds_rejected(db_conn: sqlite3.Connection) -> None:
    link_id, _ = _setup_link(db_conn, "short")  # len 5
    with pytest.raises(ValidationError):
        align_links_service.set_target_span(db_conn, link_id, 0, 99)


def test_set_target_span_bad_order_rejected(db_conn: sqlite3.Connection) -> None:
    link_id, _ = _setup_link(db_conn)
    with pytest.raises(ValidationError):
        align_links_service.set_target_span(db_conn, link_id, 10, 3)  # end < start
    with pytest.raises(ValidationError):
        align_links_service.set_target_span(db_conn, link_id, -1, 4)  # negative start


def test_set_target_span_non_int_rejected(db_conn: sqlite3.Connection) -> None:
    link_id, _ = _setup_link(db_conn)
    with pytest.raises(ValidationError):
        align_links_service.set_target_span(db_conn, link_id, 0, True)  # bool is not an offset
    with pytest.raises(ValidationError):
        align_links_service.set_target_span(db_conn, link_id, "0", 4)  # str is not an offset


def test_set_target_span_link_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        align_links_service.set_target_span(db_conn, 999, 0, 4)


def test_clear_target_span_resets_to_whole_unit(db_conn: sqlite3.Connection) -> None:
    link_id, _ = _setup_link(db_conn)
    align_links_service.set_target_span(db_conn, link_id, 0, 5)
    align_links_service.clear_target_span(db_conn, link_id)
    db_conn.commit()
    row = db_conn.execute(
        "SELECT target_char_start, target_char_end FROM alignment_links WHERE link_id=?", (link_id,)
    ).fetchone()
    assert (row[0], row[1]) == (None, None)


def test_clear_target_span_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        align_links_service.clear_target_span(db_conn, 999)


def test_set_target_span_is_non_destructive(db_conn: sqlite3.Connection) -> None:
    link_id, tgt = _setup_link(db_conn)
    before = db_conn.execute(
        "SELECT text_raw, text_norm, n FROM units WHERE unit_id=?", (tgt,)
    ).fetchone()
    align_links_service.set_target_span(db_conn, link_id, 0, 18)
    db_conn.commit()
    after = db_conn.execute(
        "SELECT text_raw, text_norm, n FROM units WHERE unit_id=?", (tgt,)
    ).fetchone()
    assert tuple(after) == tuple(before)  # the target unit (text + position) untouched
    # no split happened — the target doc still has exactly one unit
    assert db_conn.execute("SELECT COUNT(*) FROM units WHERE doc_id=2").fetchone()[0] == 1


# ── set_pivot (re-anchor — the 5th verb, RA-D1) ──────────────────────────────────

def _add_pivot(conn: sqlite3.Connection, n: int, unit_type: str = "line") -> int:
    """Add a second unit to the hub doc (id 1) → its unit_id, for re-anchoring."""
    cur = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (1, ?, ?, 'Autre.', 'autre')",
        (unit_type, n),
    )
    conn.commit()
    return int(cur.lastrowid)


def test_set_pivot_moves_anchor_and_preserves_state(db_conn: sqlite3.Connection) -> None:
    # A curated link: accepted, cut to a target sub-span, grouped into its cell's bead.
    link_id, tgt = _setup_link(db_conn)
    old_pivot = db_conn.execute(
        "SELECT pivot_unit_id FROM alignment_links WHERE link_id=?", (link_id,)
    ).fetchone()[0]
    align_links_service.set_target_span(db_conn, link_id, 0, 5)
    align_links_service.set_bead(db_conn, link_id)
    db_conn.execute(
        "UPDATE alignment_links SET status='accepted' WHERE link_id=?", (link_id,)
    )
    db_conn.commit()
    new_pivot = _add_pivot(db_conn, n=2)

    align_links_service.set_pivot(db_conn, link_id, new_pivot)
    db_conn.commit()

    row = db_conn.execute(
        "SELECT pivot_unit_id, target_unit_id, status, target_char_start,"
        " target_char_end, bead_uid FROM alignment_links WHERE link_id=?",
        (link_id,),
    ).fetchone()
    assert row[0] == new_pivot and new_pivot != old_pivot  # pivot moved (RA-D1)
    assert row[1] == tgt                                    # target preserved (RA-D3)
    assert row[2] == "accepted"                             # status preserved (RA-D3)
    assert (row[3], row[4]) == (0, 5)                       # cut span preserved (RA-D3)
    assert row[5] is None                                   # stale bead_uid cleared (RA-D2)


def test_set_pivot_same_pivot_is_noop(db_conn: sqlite3.Connection) -> None:
    # No-op when the new pivot equals the current one — and it must NOT touch the bead
    # (the early return precedes the bead-clear).
    link_id, _ = _setup_link(db_conn)
    cur_pivot = db_conn.execute(
        "SELECT pivot_unit_id FROM alignment_links WHERE link_id=?", (link_id,)
    ).fetchone()[0]
    align_links_service.set_bead(db_conn, link_id)
    db_conn.commit()
    align_links_service.set_pivot(db_conn, link_id, cur_pivot)  # no raise
    row = db_conn.execute(
        "SELECT pivot_unit_id, bead_uid FROM alignment_links WHERE link_id=?", (link_id,)
    ).fetchone()
    assert row[0] == cur_pivot and row[1] is not None  # unchanged, bead intact


def test_set_pivot_rejects_structure_unit(db_conn: sqlite3.Connection) -> None:
    link_id, _ = _setup_link(db_conn)
    structure = _add_pivot(db_conn, n=2, unit_type="structure")
    with pytest.raises(ValidationError):
        align_links_service.set_pivot(db_conn, link_id, structure)


def test_set_pivot_rejects_foreign_doc(db_conn: sqlite3.Connection) -> None:
    # The target unit lives in the translation doc (id 2) → not a valid hub pivot (RA-D4).
    link_id, tgt = _setup_link(db_conn)
    with pytest.raises(ValidationError):
        align_links_service.set_pivot(db_conn, link_id, tgt)


def test_set_pivot_rejects_nonexistent_pivot(db_conn: sqlite3.Connection) -> None:
    link_id, _ = _setup_link(db_conn)
    with pytest.raises(ValidationError):
        align_links_service.set_pivot(db_conn, link_id, 999999)


def test_set_pivot_rejects_non_int(db_conn: sqlite3.Connection) -> None:
    link_id, _ = _setup_link(db_conn)
    with pytest.raises(ValidationError):
        align_links_service.set_pivot(db_conn, link_id, True)  # bool is not an id
    with pytest.raises(ValidationError):
        align_links_service.set_pivot(db_conn, link_id, "2")  # str is not an id


def test_set_pivot_link_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        align_links_service.set_pivot(db_conn, 999, 1)


def test_set_pivot_duplicate_rejected(db_conn: sqlite3.Connection) -> None:
    # A second link already anchors the SAME target on the pivot we want to move onto →
    # re-anchoring there would duplicate the cell entry (RA-D4 → ConflictError).
    link_id, tgt = _setup_link(db_conn)
    new_pivot = _add_pivot(db_conn, n=2)
    db_conn.execute(
        "INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id,"
        " pivot_doc_id, target_doc_id, created_at) VALUES ('r', ?, ?, 1, 1, 2, datetime('now'))",
        (new_pivot, tgt),
    )
    db_conn.commit()
    with pytest.raises(ConflictError):
        align_links_service.set_pivot(db_conn, link_id, new_pivot)


# ── build_retarget_candidates (ré-ancrer — R3.3 tranche 1) ───────────────────────

def _setup_corpus(
    conn: sqlite3.Connection, n_pivot: int, n_target: int, ext_ids: bool
) -> None:
    """Pivot doc (id 1, FR) + target doc (id 2, EN), each with N line units in order n."""
    conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('P','fr','original',datetime('now'))"
    )
    conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('T','en','translation',datetime('now'))"
    )
    for doc_id, count in ((1, n_pivot), (2, n_target)):
        for i in range(1, count + 1):
            conn.execute(
                "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm)"
                " VALUES (?,'line',?,?,?,?)",
                (doc_id, i, i if ext_ids else None, f"S{i}.", f"s{i}"),
            )
    conn.commit()


def _uid(conn: sqlite3.Connection, doc_id: int, n: int) -> int:
    return int(conn.execute(
        "SELECT unit_id FROM units WHERE doc_id=? AND n=?", (doc_id, n)
    ).fetchone()[0])


def test_retarget_candidates_external_id_match(db_conn: sqlite3.Connection) -> None:
    _setup_corpus(db_conn, 3, 3, ext_ids=True)
    piv = _uid(db_conn, 1, 2)
    res = align_links_service.build_retarget_candidates(db_conn, piv, 2)
    top = res["candidates"][0]
    assert top["reason"] == "external_id_match" and top["score"] == 1.0 and top["external_id"] == 2
    # ext_id anchoring succeeded → the positional fallback must NOT fire (byte-identical path)
    assert not any(c["reason"].startswith("position") for c in res["candidates"])


def test_retarget_candidates_positional_fallback_no_external_ids(db_conn: sqlite3.Connection) -> None:
    # The Le Clézio case: length/DP-aligned corpus, no external_ids on any unit.
    _setup_corpus(db_conn, 3, 5, ext_ids=False)
    piv = _uid(db_conn, 1, 2)
    tgt = _uid(db_conn, 2, 3)  # current link anchors on target n=3
    # The link carries a pair external_id (NOT NULL), even though the *units* have none —
    # exactly the Le Clézio shape that makes the ext_id candidate finder come up empty.
    db_conn.execute(
        "INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id,"
        " pivot_doc_id, target_doc_id, created_at) VALUES ('r', ?, ?, 1, 1, 2, datetime('now'))",
        (piv, tgt),
    )
    db_conn.commit()
    res = align_links_service.build_retarget_candidates(db_conn, piv, 2, window=2)
    assert res["candidates"], "positional fallback must yield candidates when markers are absent"
    assert all(c["reason"].startswith("position") for c in res["candidates"])
    top = res["candidates"][0]
    assert top["target_unit_id"] == tgt and top["score"] == 1.0  # anchored on the current target
    ids = {c["target_unit_id"] for c in res["candidates"]}
    assert {_uid(db_conn, 2, 2), _uid(db_conn, 2, 3), _uid(db_conn, 2, 4)} <= ids


def test_retarget_candidates_positional_orphan_pivot(db_conn: sqlite3.Connection) -> None:
    # No link at all (orphan pivot) + no external_ids → anchored on pivot's proportional position.
    _setup_corpus(db_conn, 4, 4, ext_ids=False)
    piv = _uid(db_conn, 1, 1)
    res = align_links_service.build_retarget_candidates(db_conn, piv, 2, window=1)
    assert res["candidates"], "orphan pivot still gets positional candidates"
    assert all(c["reason"].startswith("position") for c in res["candidates"])
    assert res["candidates"][0]["target_unit_id"] == _uid(db_conn, 2, 1)  # pivot n=1 → target n=1


def test_retarget_candidates_pivot_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        align_links_service.build_retarget_candidates(db_conn, 999, 2)
