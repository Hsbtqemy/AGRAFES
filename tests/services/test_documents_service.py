"""Direct unit tests for the documents service (audit P0-1 / A-01).

Exercises the extracted documents CRUD without any HTTP server. The migrated
schema already has the workflow columns + tokens table, so list_documents works
without the adapter's legacy backfill. HTTP adapters stay covered by
tests/contracts/test_sidecar_v04.py / test_sidecar_api_contract.py + the binary smoke
(GET /documents).
"""

from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.documents_service import (
    bulk_update_documents,
    delete_documents,
    list_documents,
    update_document,
)
from multicorpus_engine.services.errors import (
    BadRequestError,
    NotFoundError,
    ValidationError,
)


def _mk_doc(conn: sqlite3.Connection, title: str = "D") -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES (?, 'fr', 'standalone', datetime('now'))",
        (title,),
    )
    conn.commit()
    return cur.lastrowid


# --- list -----------------------------------------------------------------------
def test_list_empty(db_conn: sqlite3.Connection) -> None:
    assert list_documents(db_conn) == {"documents": [], "count": 0}


def test_list_shapes_each_row(db_conn: sqlite3.Connection) -> None:
    _mk_doc(db_conn, "Doc A")
    out = list_documents(db_conn)
    assert out["count"] == 1
    doc = out["documents"][0]
    assert doc["title"] == "Doc A"
    assert doc["workflow_status"] == "draft"          # column default
    assert doc["unit_count"] == 0 and doc["token_count"] == 0
    assert doc["annotation_status"] == "missing"
    assert doc["fts_stale"] is False
    for key in ("doc_id", "source_path", "source_hash", "text_start_n", "publisher"):
        assert key in doc


# --- update ---------------------------------------------------------------------
def test_update_title(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn, "Old")
    out = update_document(db_conn, {"doc_id": d, "title": "New"})
    assert out == {"updated": 1, "doc": out["doc"]}
    assert out["doc"]["title"] == "New"


def test_update_requires_doc_id(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        update_document(db_conn, {"title": "x"})


def test_update_requires_a_field(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn)
    with pytest.raises(BadRequestError):
        update_document(db_conn, {"doc_id": d, "not_allowed": 1})


def test_update_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        update_document(db_conn, {"doc_id": 99999, "title": "x"})


def test_update_bad_workflow_status_has_details(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn)
    with pytest.raises(ValidationError) as ei:
        update_document(db_conn, {"doc_id": d, "workflow_status": "nope"})
    assert ei.value.details == {"supported_values": ["draft", "review", "validated"]}


def test_update_validated_sets_validated_at(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn)
    out = update_document(db_conn, {"doc_id": d, "workflow_status": "validated"})
    assert out["doc"]["workflow_status"] == "validated"
    assert out["doc"]["validated_at"]  # non-null timestamp set


def test_update_leaving_validated_clears_metadata(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn)
    update_document(db_conn, {"doc_id": d, "workflow_status": "validated", "validated_run_id": "r1"})
    out = update_document(db_conn, {"doc_id": d, "workflow_status": "draft"})
    assert out["doc"]["validated_at"] is None
    assert out["doc"]["validated_run_id"] is None


def test_update_validated_run_id_requires_validated(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn)
    with pytest.raises(ValidationError):
        update_document(db_conn, {"doc_id": d, "validated_run_id": "r1"})


# --- bulk update ----------------------------------------------------------------
def test_bulk_update(db_conn: sqlite3.Connection) -> None:
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    out = bulk_update_documents(db_conn, {"updates": [
        {"doc_id": a, "title": "A2"},
        {"doc_id": b, "language": "en"},
        {"doc_id": None, "title": "skip"},      # skipped (no doc_id)
        {"doc_id": a, "irrelevant": 1},         # skipped (no updatable field)
    ]})
    assert out["updated"] == 2


def test_bulk_update_bad_list(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        bulk_update_documents(db_conn, {"updates": []})


def test_bulk_update_bad_workflow_status(db_conn: sqlite3.Connection) -> None:
    a = _mk_doc(db_conn, "A")
    with pytest.raises(ValidationError):
        bulk_update_documents(db_conn, {"updates": [{"doc_id": a, "workflow_status": "bogus"}]})


def test_bulk_update_is_atomic_on_midbatch_failure(db_conn: sqlite3.Connection) -> None:
    """A failure mid-batch rolls back the earlier UPDATEs (audit SID-03)."""
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    with pytest.raises(ValidationError):
        bulk_update_documents(db_conn, {"updates": [
            {"doc_id": a, "title": "CHANGED"},           # applied first…
            {"doc_id": b, "workflow_status": "bogus"},   # …then this fails → rollback all
        ]})
    # The first UPDATE must not have persisted (would read "CHANGED" without the fix).
    title = db_conn.execute("SELECT title FROM documents WHERE doc_id = ?", (a,)).fetchone()[0]
    assert title == "A"


# --- delete ---------------------------------------------------------------------
def test_delete_removes_doc_units_relations(db_conn: sqlite3.Connection) -> None:
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?, 'line', 1, 'x', 'x')",
        (a,),
    )
    db_conn.execute(
        "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at)"
        " VALUES (?, 'translation_of', ?, datetime('now'))",
        (a, b),
    )
    db_conn.commit()

    data, telemetry = delete_documents(db_conn, {"doc_ids": [a]})
    assert data == {"deleted": 1, "doc_ids": [a]}
    assert db_conn.execute("SELECT 1 FROM documents WHERE doc_id=?", (a,)).fetchone() is None
    assert db_conn.execute("SELECT COUNT(*) FROM units WHERE doc_id=?", (a,)).fetchone()[0] == 0
    assert db_conn.execute("SELECT COUNT(*) FROM doc_relations WHERE doc_id=?", (a,)).fetchone()[0] == 0
    # telemetry: one entry per doc, with the expected keys
    assert telemetry == [{"doc_id": a, "had_curation": False, "had_alignment": False}]


def test_delete_bad_payload(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        delete_documents(db_conn, {"doc_ids": []})
    with pytest.raises(BadRequestError):
        delete_documents(db_conn, {"doc_ids": ["not-int"]})
