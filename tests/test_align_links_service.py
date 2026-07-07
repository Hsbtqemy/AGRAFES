"""Service tests for align_links_service — source-anchored "couper" (R3.3, §7-D9).

Records a non-destructive char sub-span (target_char_start/end, migration 027) on an
alignment link; the target document's unit (text + position) and FTS stay untouched.
Local (db_conn), no sidecar.
"""
from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services import align_links_service
from multicorpus_engine.services.errors import NotFoundError, ValidationError


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
