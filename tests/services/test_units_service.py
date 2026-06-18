"""Direct unit tests for the units service (audit P0-1 / A-01).

Role assignment, text edits and listing — exercised without an HTTP server.
The adapters are covered over HTTP by tests/test_sidecar_conventions.py
(set_role/bulk_set_role), tests/test_sidecar_units.py (update_text/list) and the
binary smoke (GET /units).
"""

from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.errors import BadRequestError, NotFoundError
from multicorpus_engine.services.units_service import (
    bulk_set_unit_role,
    list_units,
    set_unit_role,
    update_unit_text,
)


def _mk_doc_units(conn: sqlite3.Connection, n_units: int = 2) -> tuple[int, list[int]]:
    cur = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('D', 'fr', 'standalone', datetime('now'))"
    )
    doc_id = cur.lastrowid
    unit_ids = []
    for i in range(1, n_units + 1):
        c = conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?, 'line', ?, ?, ?)",
            (doc_id, i, f"t{i}", f"t{i}"),
        )
        unit_ids.append(c.lastrowid)
    conn.commit()
    return doc_id, unit_ids


def _mk_role(conn: sqlite3.Connection, name: str = "itr") -> None:
    conn.execute(
        "INSERT INTO unit_roles (name, label, color, sort_order) VALUES (?, ?, '#fff', 0)",
        (name, name),
    )
    conn.commit()


# --- list_units -----------------------------------------------------------------
def test_list_units(db_conn: sqlite3.Connection) -> None:
    doc_id, _ = _mk_doc_units(db_conn, 3)
    out = list_units(db_conn, str(doc_id), None)
    assert out["doc_id"] == doc_id and out["count"] == 3
    assert {u["n"] for u in out["units"]} == {1, 2, 3}
    # unit_type filter (no 'structure' units -> empty)
    assert list_units(db_conn, str(doc_id), "structure")["count"] == 0


@pytest.mark.parametrize("raw", [None, "", "abc"])
def test_list_units_bad_doc_id(db_conn: sqlite3.Connection, raw) -> None:
    with pytest.raises(BadRequestError):
        list_units(db_conn, raw, None)


# --- set_unit_role --------------------------------------------------------------
def test_set_unit_role_set_and_clear(db_conn: sqlite3.Connection) -> None:
    doc_id, _ = _mk_doc_units(db_conn, 2)
    _mk_role(db_conn, "itr")
    out = set_unit_role(db_conn, {"doc_id": doc_id, "unit_n": 1, "role": "itr"})
    assert out == {"doc_id": doc_id, "unit_n": 1, "unit_role": "itr"}
    # clear (empty string -> None)
    out2 = set_unit_role(db_conn, {"doc_id": doc_id, "unit_n": 1, "role": ""})
    assert out2["unit_role"] is None


@pytest.mark.parametrize("body", [
    {"unit_n": 1},                                  # missing doc_id
    {"doc_id": "x", "unit_n": 1},                   # non-int doc_id
])
def test_set_unit_role_bad_request(db_conn: sqlite3.Connection, body: dict) -> None:
    with pytest.raises(BadRequestError):
        set_unit_role(db_conn, body)


def test_set_unit_role_not_found(db_conn: sqlite3.Connection) -> None:
    doc_id, _ = _mk_doc_units(db_conn, 1)
    # role not found
    with pytest.raises(NotFoundError):
        set_unit_role(db_conn, {"doc_id": doc_id, "unit_n": 1, "role": "ghost"})
    # unit not found
    _mk_role(db_conn, "itr")
    with pytest.raises(NotFoundError):
        set_unit_role(db_conn, {"doc_id": doc_id, "unit_n": 99, "role": "itr"})


# --- bulk_set_unit_role ---------------------------------------------------------
def test_bulk_set_format_a(db_conn: sqlite3.Connection) -> None:
    _, unit_ids = _mk_doc_units(db_conn, 3)
    _mk_role(db_conn, "itr")
    out = bulk_set_unit_role(db_conn, {"unit_ids": unit_ids, "role_name": "itr"})
    assert out == {"updated": 3}


def test_bulk_set_format_b_legacy(db_conn: sqlite3.Connection) -> None:
    doc_id, _ = _mk_doc_units(db_conn, 2)
    out = bulk_set_unit_role(db_conn, {"doc_id": doc_id, "unit_ns": [1, 2], "role": None})
    assert out == {"updated": 2}


def test_bulk_set_empty_is_noop(db_conn: sqlite3.Connection) -> None:
    assert bulk_set_unit_role(db_conn, {"unit_ids": []}) == {"updated": 0}
    assert bulk_set_unit_role(db_conn, {"doc_id": 1, "unit_ns": []}) == {"updated": 0}


def test_bulk_set_bad_request(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        bulk_set_unit_role(db_conn, {"unit_ids": "nope"})
    with pytest.raises(BadRequestError):
        bulk_set_unit_role(db_conn, {})  # neither format


def test_bulk_set_role_not_found(db_conn: sqlite3.Connection) -> None:
    _, unit_ids = _mk_doc_units(db_conn, 1)
    with pytest.raises(NotFoundError):
        bulk_set_unit_role(db_conn, {"unit_ids": unit_ids, "role_name": "ghost"})


# --- update_unit_text -----------------------------------------------------------
def test_update_text_mirrors_raw_to_norm(db_conn: sqlite3.Connection) -> None:
    _, unit_ids = _mk_doc_units(db_conn, 1)
    out = update_unit_text(db_conn, {"unit_id": unit_ids[0], "text_raw": "Nouveau"})
    assert out["text_raw"] == "Nouveau" and out["text_norm"] == "Nouveau"


def test_update_text_both_fields(db_conn: sqlite3.Connection) -> None:
    _, unit_ids = _mk_doc_units(db_conn, 1)
    out = update_unit_text(db_conn, {"unit_id": unit_ids[0], "text_raw": "R", "text_norm": "n"})
    assert out["text_raw"] == "R" and out["text_norm"] == "n"


@pytest.mark.parametrize("body", [
    {},                                             # missing unit_id
    {"unit_id": "x", "text_raw": "a"},              # non-int unit_id
    {"unit_id": 1},                                 # no text fields
    {"unit_id": 1, "text_raw": 123},                # non-string
])
def test_update_text_bad_request(db_conn: sqlite3.Connection, body: dict) -> None:
    with pytest.raises(BadRequestError):
        update_unit_text(db_conn, body)


def test_update_text_unknown_unit(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        update_unit_text(db_conn, {"unit_id": 99999, "text_raw": "x"})
