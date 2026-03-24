"""Tests for corpus_info storage and patch semantics."""

from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path

import pytest

from multicorpus_engine.corpus_info import apply_corpus_info_patch, get_corpus_info
from multicorpus_engine.db.migrations import apply_migrations


@pytest.fixture()
def migrated_conn() -> sqlite3.Connection:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "t.db"
        conn = sqlite3.connect(str(db))
        apply_migrations(conn, migrations_dir=Path(__file__).resolve().parent.parent / "migrations")
        yield conn
        conn.close()


def test_corpus_info_roundtrip(migrated_conn: sqlite3.Connection) -> None:
    assert get_corpus_info(migrated_conn)["title"] is None

    apply_corpus_info_patch(
        migrated_conn,
        {"title": "Mon projet", "description": "Note", "meta": {"qualifier": "test", "tags": ["a"]}},
    )
    got = get_corpus_info(migrated_conn)
    assert got["title"] == "Mon projet"
    assert got["description"] == "Note"
    assert got["meta"]["qualifier"] == "test"
    assert got["meta"]["tags"] == ["a"]
    assert got["updated_at"]


def test_corpus_info_partial_patch(migrated_conn: sqlite3.Connection) -> None:
    apply_corpus_info_patch(migrated_conn, {"title": "A", "description": "B", "meta": {"k": 1}})
    apply_corpus_info_patch(migrated_conn, {"title": "C"})
    got = get_corpus_info(migrated_conn)
    assert got["title"] == "C"
    assert got["description"] == "B"
    assert got["meta"]["k"] == 1


def test_corpus_info_meta_replace(migrated_conn: sqlite3.Connection) -> None:
    apply_corpus_info_patch(migrated_conn, {"meta": {"a": 1}})
    apply_corpus_info_patch(migrated_conn, {"meta": {"b": 2}})
    got = get_corpus_info(migrated_conn)
    assert got["meta"] == {"b": 2}
    assert "a" not in got["meta"]


def test_corpus_info_meta_clear(migrated_conn: sqlite3.Connection) -> None:
    apply_corpus_info_patch(migrated_conn, {"meta": {"x": 1}})
    apply_corpus_info_patch(migrated_conn, {"meta": None})
    got = get_corpus_info(migrated_conn)
    assert got["meta"] == {}


def test_corpus_info_row_persists_json(migrated_conn: sqlite3.Connection) -> None:
    apply_corpus_info_patch(migrated_conn, {"meta": {"nested": {"y": True}}})
    raw = migrated_conn.execute("SELECT meta_json FROM corpus_info WHERE id = 1").fetchone()[0]
    assert json.loads(raw)["nested"]["y"] is True
