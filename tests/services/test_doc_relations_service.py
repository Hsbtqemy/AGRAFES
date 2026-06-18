"""Direct unit tests for the doc_relations service (audit P0-1 / A-01).

Exercises the extracted doc_relations CRUD without any HTTP server. The sidecar
HTTP adapters are covered end-to-end by tests/test_sidecar_v04.py (set/get/delete)
and the binary smoke (/doc_relations/all) in CI.
"""

from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.doc_relations_service import (
    delete_doc_relation,
    get_doc_relations,
    list_all_doc_relations,
    set_doc_relation,
)
from multicorpus_engine.services.errors import ValidationError


def _mk_doc(conn: sqlite3.Connection, title: str = "D") -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES (?, 'fr', 'standalone', datetime('now'))",
        (title,),
    )
    conn.commit()
    return cur.lastrowid


# --- set (upsert) ---------------------------------------------------------------
def test_set_creates_then_updates(db_conn: sqlite3.Connection) -> None:
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    r1 = set_doc_relation(
        db_conn, {"doc_id": a, "relation_type": "translation_of", "target_doc_id": b}
    )
    assert r1["action"] == "created"
    assert r1["doc_id"] == a and r1["relation_type"] == "translation_of" and r1["target_doc_id"] == b
    assert isinstance(r1["id"], int)

    # same (doc_id, relation_type, target) -> update note only, same id
    r2 = set_doc_relation(
        db_conn,
        {"doc_id": a, "relation_type": "translation_of", "target_doc_id": b, "note": "hi"},
    )
    assert r2["action"] == "updated"
    assert r2["id"] == r1["id"]

    got = get_doc_relations(db_conn, str(a))
    assert got["count"] == 1
    assert got["relations"][0]["note"] == "hi"
    assert got["relations"][0]["id"] == r1["id"]


@pytest.mark.parametrize("body", [
    {"relation_type": "translation_of", "target_doc_id": 2},  # missing doc_id
    {"doc_id": 1, "target_doc_id": 2},                        # missing relation_type
    {"doc_id": 1, "relation_type": "translation_of"},         # missing target_doc_id
    {"doc_id": 1, "relation_type": "", "target_doc_id": 2},   # empty relation_type
])
def test_set_validation(db_conn: sqlite3.Connection, body: dict) -> None:
    with pytest.raises(ValidationError):
        set_doc_relation(db_conn, body)


# --- get ------------------------------------------------------------------------
def test_get_returns_relations(db_conn: sqlite3.Connection) -> None:
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    set_doc_relation(db_conn, {"doc_id": a, "relation_type": "translation_of", "target_doc_id": b})
    out = get_doc_relations(db_conn, str(a))
    assert out["doc_id"] == a
    assert out["count"] == 1
    rel = out["relations"][0]
    assert set(rel) == {"id", "doc_id", "relation_type", "target_doc_id", "note", "created_at"}


def test_get_empty_for_unknown_doc(db_conn: sqlite3.Connection) -> None:
    assert get_doc_relations(db_conn, "999") == {"doc_id": 999, "relations": [], "count": 0}


@pytest.mark.parametrize("raw", [None, "abc", ""])
def test_get_validation(db_conn: sqlite3.Connection, raw) -> None:
    with pytest.raises(ValidationError):
        get_doc_relations(db_conn, raw)


# --- list all -------------------------------------------------------------------
def test_list_all(db_conn: sqlite3.Connection) -> None:
    a, b, c = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B"), _mk_doc(db_conn, "C")
    set_doc_relation(db_conn, {"doc_id": a, "relation_type": "translation_of", "target_doc_id": b})
    set_doc_relation(db_conn, {"doc_id": a, "relation_type": "excerpt_of", "target_doc_id": c})
    out = list_all_doc_relations(db_conn)
    assert out["count"] == 2
    assert {r["relation_type"] for r in out["relations"]} == {"translation_of", "excerpt_of"}


# --- delete ---------------------------------------------------------------------
def test_delete(db_conn: sqlite3.Connection) -> None:
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    r = set_doc_relation(db_conn, {"doc_id": a, "relation_type": "translation_of", "target_doc_id": b})
    assert delete_doc_relation(db_conn, {"id": r["id"]}) == {"deleted": 1}
    assert get_doc_relations(db_conn, str(a))["count"] == 0
    # deleting again is a no-op (0 rows)
    assert delete_doc_relation(db_conn, {"id": r["id"]}) == {"deleted": 0}


def test_delete_validation(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(ValidationError):
        delete_doc_relation(db_conn, {})
