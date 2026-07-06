"""R6.3 — type-specific / ad-hoc document metadata merged into documents.meta_json.fields."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.services.documents_service import list_documents, update_document
from multicorpus_engine.services.errors import BadRequestError, NotFoundError

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "test.db")
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _doc(conn: sqlite3.Connection, meta_json: str | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, meta_json, source_path, source_hash, created_at)"
        " VALUES ('Doc', 'fr', ?, 'x.txt', 'abc', '2024-01-01T00:00:00')",
        (meta_json,),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def _raw_meta(conn: sqlite3.Connection, doc_id: int) -> dict | None:
    raw = conn.execute("SELECT meta_json FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()[0]
    return json.loads(raw) if raw else None


def test_meta_fields_stored_under_fields_key_and_returned(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    res = update_document(db, {"doc_id": doc, "meta": {"rubrique": "Culture", "url": "http://x"}})
    assert res["updated"] == 1
    assert res["doc"]["meta_json"] == {"fields": {"rubrique": "Culture", "url": "http://x"}}
    assert _raw_meta(db, doc) == {"fields": {"rubrique": "Culture", "url": "http://x"}}


def test_meta_merge_preserves_importer_provenance_keys(db: sqlite3.Connection) -> None:
    # TXT/CoNLL-U importers write provenance keys at INSERT; a metadata save must not clobber them.
    doc = _doc(db, json.dumps({"encoding": "utf-8", "enc_method": "bom"}))
    res = update_document(db, {"doc_id": doc, "meta": {"rubrique": "Culture"}})
    meta = res["doc"]["meta_json"]
    assert meta["encoding"] == "utf-8"
    assert meta["enc_method"] == "bom"
    assert meta["fields"] == {"rubrique": "Culture"}


def test_meta_replaces_fields_namespace_not_accumulates(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    update_document(db, {"doc_id": doc, "meta": {"a": "1", "b": "2"}})
    res = update_document(db, {"doc_id": doc, "meta": {"a": "9"}})
    # 'b' is gone — the fields sub-object is replaced wholesale by the new payload.
    assert res["doc"]["meta_json"]["fields"] == {"a": "9"}


def test_null_value_clears_field_not_stringified(db: sqlite3.Connection) -> None:
    # A JSON null is an explicit "clear this field" — it must be dropped, never stored as "None".
    doc = _doc(db)
    update_document(db, {"doc_id": doc, "meta": {"rubrique": "Culture", "url": "http://x"}})
    res = update_document(db, {"doc_id": doc, "meta": {"rubrique": "Culture", "url": None}})
    assert res["doc"]["meta_json"]["fields"] == {"rubrique": "Culture"}
    assert "None" not in json.dumps(res["doc"]["meta_json"])


def test_non_scalar_and_bool_values_dropped(db: sqlite3.Connection) -> None:
    # Fields are text-like: bool (false→"False" trap), list/dict (garbled repr) are dropped,
    # not stringified. Numbers are stringified. Empty result → NULL.
    doc = _doc(db)
    res = update_document(
        db,
        {"doc_id": doc, "meta": {"active": False, "tags": ["a", "b"], "nested": {"x": 1}, "year": 1862}},
    )
    assert res["doc"]["meta_json"] == {"fields": {"year": "1862"}}


def test_empty_value_drops_the_field(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    update_document(db, {"doc_id": doc, "meta": {"rubrique": "Culture", "url": "http://x"}})
    res = update_document(db, {"doc_id": doc, "meta": {"rubrique": "Culture", "url": "   "}})
    assert res["doc"]["meta_json"]["fields"] == {"rubrique": "Culture"}


def test_empty_meta_clears_fields_but_keeps_provenance(db: sqlite3.Connection) -> None:
    doc = _doc(db, json.dumps({"encoding": "utf-8"}))
    update_document(db, {"doc_id": doc, "meta": {"rubrique": "Culture"}})
    res = update_document(db, {"doc_id": doc, "meta": {}})
    meta = res["doc"]["meta_json"]
    assert "fields" not in meta
    assert meta == {"encoding": "utf-8"}


def test_empty_meta_on_pristine_doc_leaves_null(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    res = update_document(db, {"doc_id": doc, "meta": {}})
    assert res["doc"]["meta_json"] is None
    assert _raw_meta(db, doc) is None


def test_meta_alone_is_accepted_no_no_fields_error(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    # meta is the only field — must not raise the "no updatable fields" BadRequestError.
    res = update_document(db, {"doc_id": doc, "meta": {"x": "1"}})
    assert res["updated"] == 1


def test_meta_alongside_columns(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    res = update_document(
        db, {"doc_id": doc, "resource_type": "article", "meta": {"rubrique": "Culture"}}
    )
    assert res["doc"]["resource_type"] == "article"
    assert res["doc"]["meta_json"]["fields"] == {"rubrique": "Culture"}


def test_non_dict_meta_rejected(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    with pytest.raises(BadRequestError):
        update_document(db, {"doc_id": doc, "meta": ["not", "a", "dict"]})


def test_meta_on_unknown_doc_raises_not_found(db: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        update_document(db, {"doc_id": 99999, "meta": {"x": "1"}})


def test_list_returns_parsed_meta_json(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    update_document(db, {"doc_id": doc, "meta": {"rubrique": "Culture"}})
    listed = list_documents(db)
    row = next(d for d in listed["documents"] if d["doc_id"] == doc)
    assert row["meta_json"] == {"fields": {"rubrique": "Culture"}}


def test_list_meta_json_null_when_absent(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    listed = list_documents(db)
    row = next(d for d in listed["documents"] if d["doc_id"] == doc)
    assert row["meta_json"] is None


def test_meta_is_committed(tmp_path: Path) -> None:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    db_path = tmp_path / "commit.db"
    c1 = get_connection(db_path)
    apply_migrations(c1, migrations_dir=_MIGRATIONS_DIR)
    doc = _doc(c1)
    update_document(c1, {"doc_id": doc, "meta": {"durable": "yes"}})

    c2 = get_connection(db_path)  # only committed data is visible
    raw = c2.execute("SELECT meta_json FROM documents WHERE doc_id = ?", (doc,)).fetchone()[0]
    assert json.loads(raw) == {"fields": {"durable": "yes"}}
