"""R6.1 — documents.notes (document-level free-text notes-to-self)."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.services.documents_service import list_documents, update_document

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "test.db")
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _doc(conn: sqlite3.Connection) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, source_path, source_hash, created_at)"
        " VALUES ('Doc', 'fr', 'x.txt', 'abc', '2024-01-01T00:00:00')",
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def test_update_sets_notes_and_returns_it(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    res = update_document(db, {"doc_id": doc, "notes": "à revoir : dates incertaines"})
    assert res["updated"] == 1
    assert res["doc"]["notes"] == "à revoir : dates incertaines"


def test_list_returns_notes(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    update_document(db, {"doc_id": doc, "notes": "mémo"})
    listed = list_documents(db)
    row = next(d for d in listed["documents"] if d["doc_id"] == doc)
    assert row["notes"] == "mémo"


def test_notes_can_be_cleared(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    update_document(db, {"doc_id": doc, "notes": "temp"})
    res = update_document(db, {"doc_id": doc, "notes": None})
    assert res["doc"]["notes"] is None


def test_notes_is_committed(tmp_path: Path) -> None:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    db_path = tmp_path / "commit.db"
    c1 = get_connection(db_path)
    apply_migrations(c1, migrations_dir=_MIGRATIONS_DIR)
    doc = _doc(c1)
    update_document(c1, {"doc_id": doc, "notes": "durable"})

    c2 = get_connection(db_path)  # only committed data is visible
    row = c2.execute("SELECT notes FROM documents WHERE doc_id = ?", (doc,)).fetchone()
    assert row["notes"] == "durable"
