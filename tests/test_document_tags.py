"""R6.2 — document_tags (filterable namespaced labels) + the /query `tags` filter."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.query import run_query_facets, run_query_page
from multicorpus_engine.services.errors import NotFoundError, ValidationError
from multicorpus_engine.services.tags_service import add_tag, list_tags, remove_tag

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "test.db")
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _doc(conn: sqlite3.Connection, title: str = "Doc") -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, source_path, source_hash, created_at)"
        " VALUES (?, 'fr', ?, ?, '2024-01-01T00:00:00')",
        (title, f"{title}.txt", title),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


# --- service ---------------------------------------------------------------

def test_add_list_remove(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    assert add_tag(db, {"doc_id": doc, "kind": "genre", "value": "roman"}) == {
        "doc_id": doc, "kind": "genre", "value": "roman", "added": 1,
    }
    assert list_tags(db, doc) == [{"kind": "genre", "value": "roman"}]
    assert remove_tag(db, {"doc_id": doc, "kind": "genre", "value": "roman"}) == {"deleted": 1}
    assert list_tags(db, doc) == []


def test_add_is_idempotent(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    add_tag(db, {"doc_id": doc, "kind": "genre", "value": "roman"})
    assert add_tag(db, {"doc_id": doc, "kind": "genre", "value": "roman"})["added"] == 0
    assert list_tags(db, doc) == [{"kind": "genre", "value": "roman"}]


def test_list_distinct_across_corpus(db: sqlite3.Connection) -> None:
    a, b = _doc(db, "A"), _doc(db, "B")
    add_tag(db, {"doc_id": a, "kind": "genre", "value": "roman"})
    add_tag(db, {"doc_id": b, "kind": "genre", "value": "roman"})  # same value, other doc
    add_tag(db, {"doc_id": b, "kind": "theme", "value": "exil"})
    assert list_tags(db) == [
        {"kind": "genre", "value": "roman"},
        {"kind": "theme", "value": "exil"},
    ]


def test_add_unknown_doc_raises(db: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        add_tag(db, {"doc_id": 999, "kind": "genre", "value": "roman"})


def test_blank_kind_or_value_rejected(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    with pytest.raises(ValidationError):
        add_tag(db, {"doc_id": doc, "kind": "  ", "value": "roman"})
    with pytest.raises(ValidationError):
        add_tag(db, {"doc_id": doc, "kind": "genre", "value": ""})


def test_remove_absent_is_zero(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    assert remove_tag(db, {"doc_id": doc, "kind": "x", "value": "y"}) == {"deleted": 0}


def test_committed(tmp_path: Path) -> None:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    p = tmp_path / "c.db"
    c1 = get_connection(p)
    apply_migrations(c1, migrations_dir=_MIGRATIONS_DIR)
    doc = _doc(c1)
    add_tag(c1, {"doc_id": doc, "kind": "genre", "value": "roman"})
    c2 = get_connection(p)  # only committed data visible
    assert list_tags(c2, doc) == [{"kind": "genre", "value": "roman"}]


# --- filter (run_query_page) -----------------------------------------------

def _fts_line(conn: sqlite3.Connection, doc_id: int, n: int, text: str) -> None:
    cur = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?, 'line', ?, ?, ?)",
        (doc_id, n, text, text),
    )
    conn.execute("INSERT INTO fts_units (rowid, text_norm) VALUES (?, ?)", (cur.lastrowid, text))
    conn.commit()


def test_tags_filter_restricts_query(db: sqlite3.Connection) -> None:
    a, b = _doc(db, "A"), _doc(db, "B")
    _fts_line(db, a, 1, "le chat dort")
    _fts_line(db, b, 1, "le chat dort")
    add_tag(db, {"doc_id": a, "kind": "genre", "value": "roman"})

    both = run_query_page(conn=db, q="chat", mode="segment")
    assert {h["doc_id"] for h in both["hits"]} == {a, b}

    filtered = run_query_page(
        conn=db, q="chat", mode="segment", tags=[{"kind": "genre", "value": "roman"}],
    )
    assert {h["doc_id"] for h in filtered["hits"]} == {a}


def test_tags_filter_or_semantics(db: sqlite3.Connection) -> None:
    a, b, c = _doc(db, "A"), _doc(db, "B"), _doc(db, "C")
    for d in (a, b, c):
        _fts_line(db, d, 1, "le chat")
    add_tag(db, {"doc_id": a, "kind": "genre", "value": "roman"})
    add_tag(db, {"doc_id": b, "kind": "theme", "value": "exil"})

    res = run_query_page(
        conn=db, q="chat", mode="segment",
        tags=[{"kind": "genre", "value": "roman"}, {"kind": "theme", "value": "exil"}],
    )
    assert {h["doc_id"] for h in res["hits"]} == {a, b}  # OR over the pairs, not c


def test_tags_filter_on_facets(db: sqlite3.Connection) -> None:
    a, b = _doc(db, "A"), _doc(db, "B")
    _fts_line(db, a, 1, "le chat")
    _fts_line(db, b, 1, "le chat")
    add_tag(db, {"doc_id": a, "kind": "genre", "value": "roman"})

    assert run_query_facets(conn=db, q="chat")["distinct_docs"] == 2  # unfiltered
    filtered = run_query_facets(conn=db, q="chat", tags=[{"kind": "genre", "value": "roman"}])
    assert filtered["distinct_docs"] == 1  # the tags filter reaches the facet counters too
