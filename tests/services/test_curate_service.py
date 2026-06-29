"""Direct unit tests for the curate service CRUD (audit P0-1 / A-01).

Covers the curation-exceptions + apply-history CRUD without an HTTP server. The
adapters are covered over HTTP by tests/test_sidecar_curate.py + the binary smoke
(GET /curate/exceptions) in CI.
"""

from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.curate_service import (
    delete_exception,
    list_apply_history,
    list_exceptions,
    record_apply_history,
    set_exception,
)
from multicorpus_engine.services.errors import BadRequestError, NotFoundError


def _mk_unit(conn: sqlite3.Connection, text: str = "hello") -> tuple[int, int]:
    cur = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('D', 'fr', 'standalone', datetime('now'))"
    )
    doc_id = cur.lastrowid
    cur2 = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?, 'line', 1, ?, ?)",
        (doc_id, text, text),
    )
    conn.commit()
    return doc_id, cur2.lastrowid


# --- exceptions: set / list / delete --------------------------------------------
def test_set_exception_creates_then_upserts(db_conn: sqlite3.Connection) -> None:
    _, unit_id = _mk_unit(db_conn)
    out = set_exception(db_conn, {"unit_id": unit_id, "kind": "ignore"})
    assert out == {
        "unit_id": unit_id, "kind": "ignore", "override_text": None,
        "note": None, "action": "set",
    }
    # upsert to override
    out2 = set_exception(
        db_conn, {"unit_id": unit_id, "kind": "override", "override_text": "X", "note": "n"}
    )
    assert out2["kind"] == "override" and out2["override_text"] == "X"
    # exactly one row (upsert, not insert)
    assert list_exceptions(db_conn, {})["count"] == 1


@pytest.mark.parametrize("body", [
    {"kind": "ignore"},                        # missing unit_id
    {"unit_id": 1, "kind": "bogus"},           # invalid kind
])
def test_set_exception_bad_request(db_conn: sqlite3.Connection, body: dict) -> None:
    with pytest.raises(BadRequestError):
        set_exception(db_conn, body)


def test_set_exception_override_needs_text(db_conn: sqlite3.Connection) -> None:
    _, unit_id = _mk_unit(db_conn)
    with pytest.raises(BadRequestError):
        set_exception(db_conn, {"unit_id": unit_id, "kind": "override"})


def test_set_exception_unit_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        set_exception(db_conn, {"unit_id": 99999, "kind": "ignore"})


# --- SID-12: non-int integer fields raise BadRequestError (400), not a bare
#     ValueError/TypeError (which the adapter would surface as a 500). ---
def test_set_exception_non_int_unit_id_is_bad_request(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        set_exception(db_conn, {"unit_id": "abc", "kind": "ignore"})


def test_delete_exception_non_int_unit_id_is_bad_request(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        delete_exception(db_conn, {"unit_id": "x"})


def test_list_exceptions_non_int_doc_id_is_bad_request(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        list_exceptions(db_conn, {"doc_id": "nope"})


def test_list_apply_history_non_int_doc_id_is_bad_request(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        list_apply_history(db_conn, {"doc_id": "nope"})


def test_record_apply_history_non_int_doc_id_is_bad_request(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        record_apply_history(db_conn, {"scope": "doc", "doc_id": "nope"})


def test_list_exceptions_enriched_and_filtered(db_conn: sqlite3.Connection) -> None:
    doc_id, unit_id = _mk_unit(db_conn, text="bonjour")
    set_exception(db_conn, {"unit_id": unit_id, "kind": "ignore"})
    out = list_exceptions(db_conn, {})
    assert out["count"] == 1
    row = out["exceptions"][0]
    assert row["unit_id"] == unit_id and row["doc_id"] == doc_id
    assert row["doc_title"] == "D" and row["unit_text"] == "bonjour"
    # doc_id filter
    assert list_exceptions(db_conn, {"doc_id": doc_id})["count"] == 1
    assert list_exceptions(db_conn, {"doc_id": doc_id + 999})["count"] == 0


def test_delete_exception(db_conn: sqlite3.Connection) -> None:
    _, unit_id = _mk_unit(db_conn)
    set_exception(db_conn, {"unit_id": unit_id, "kind": "ignore"})
    assert delete_exception(db_conn, {"unit_id": unit_id}) == {"unit_id": unit_id, "deleted": True}
    # deleting again -> deleted False
    assert delete_exception(db_conn, {"unit_id": unit_id}) == {"unit_id": unit_id, "deleted": False}


def test_delete_exception_requires_unit_id(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        delete_exception(db_conn, {})


# --- apply history: record / list -----------------------------------------------
def test_record_and_list_apply_history(db_conn: sqlite3.Connection) -> None:
    out = record_apply_history(db_conn, {
        "applied_at": "2026-06-18T00:00:00Z", "scope": "doc", "doc_id": 5,
        "doc_title": "T", "docs_curated": 1, "units_modified": 3,
        "preview_truncated": True,
    })
    assert isinstance(out["id"], int)
    events = list_apply_history(db_conn, {})["events"]
    assert len(events) == 1
    ev = events[0]
    assert ev["scope"] == "doc" and ev["doc_id"] == 5 and ev["units_modified"] == 3
    assert ev["preview_truncated"] is True           # stored 1 -> bool True
    assert ev["ignored_count"] is None               # absent -> default None


def test_record_apply_history_coerces_and_defaults(db_conn: sqlite3.Connection) -> None:
    # bad scope -> 'all'; non-int docs_curated -> 0; missing applied_at -> 'unknown'
    record_apply_history(db_conn, {"scope": "weird", "docs_curated": "NaN"})
    ev = list_apply_history(db_conn, {})["events"][0]
    assert ev["scope"] == "all"
    assert ev["docs_curated"] == 0
    assert ev["applied_at"] == "unknown"


def test_list_apply_history_filters_and_limit(db_conn: sqlite3.Connection) -> None:
    for i in range(3):
        record_apply_history(db_conn, {"scope": "doc", "doc_id": 1, "applied_at": f"t{i}"})
    record_apply_history(db_conn, {"scope": "all", "doc_id": 2, "applied_at": "tx"})
    assert list_apply_history(db_conn, {"scope": "doc"})["count"] == 3
    assert list_apply_history(db_conn, {"doc_id": 2})["count"] == 1
    assert list_apply_history(db_conn, {"limit": 2})["count"] == 2
    # limit is capped at 200 (huge request returns all 4, not an error)
    assert list_apply_history(db_conn, {"limit": 10_000})["count"] == 4
