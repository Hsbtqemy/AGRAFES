"""Tests for metadata validation (D1 — field classification and rules)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).parent.parent
_MIGRATIONS_DIR = _REPO_ROOT / "migrations"


def _make_conn() -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _insert_doc(conn: sqlite3.Connection, **kwargs) -> int:
    """Insert a document with defaults; return doc_id."""
    defaults = {
        "title": "Test Document",
        "language": "fr",
        "doc_role": "standalone",
        "resource_type": "text",
        "source_hash": "abc123",
        "workflow_status": "draft",
        "created_at": "2026-01-01",
        "author_lastname": "Dupont",
        "author_firstname": "Jean",
        "doc_date": "2024",
    }
    defaults.update(kwargs)
    cols = ", ".join(defaults.keys())
    placeholders = ", ".join("?" * len(defaults))
    cur = conn.execute(
        f"INSERT INTO documents ({cols}) VALUES ({placeholders})",
        list(defaults.values()),
    )
    conn.commit()
    # Also add a line unit so unit-count check passes
    doc_id = cur.lastrowid
    conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_norm, text_raw) VALUES (?, 'line', 1, 'test', 'test')",
        (doc_id,),
    )
    conn.commit()
    return doc_id


class TestValidateDocument:

    def test_valid_document_no_warnings(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        doc_id = _insert_doc(conn)
        result = validate_document(conn, doc_id)
        assert result.is_valid
        assert result.warnings == []

    def test_missing_title_is_invalid(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        doc_id = _insert_doc(conn, title="")
        result = validate_document(conn, doc_id)
        assert not result.is_valid
        assert any("Titre" in w for w in result.warnings)

    def test_missing_language_is_invalid(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        # language is NOT NULL in schema, so we insert a placeholder and then update
        doc_id = _insert_doc(conn)
        conn.execute("UPDATE documents SET language = '' WHERE doc_id = ?", (doc_id,))
        conn.commit()
        result = validate_document(conn, doc_id)
        assert not result.is_valid
        assert any("Langue" in w for w in result.warnings)

    def test_invalid_language_code(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        doc_id = _insert_doc(conn)
        conn.execute("UPDATE documents SET language = 'français' WHERE doc_id = ?", (doc_id,))
        conn.commit()
        result = validate_document(conn, doc_id)
        assert not result.is_valid
        assert any("BCP-47" in w for w in result.warnings)

    def test_valid_language_subtag(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        doc_id = _insert_doc(conn)
        conn.execute("UPDATE documents SET language = 'fr-CA' WHERE doc_id = ?", (doc_id,))
        conn.commit()
        result = validate_document(conn, doc_id)
        assert result.is_valid

    def test_missing_resource_type_warns(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        doc_id = _insert_doc(conn, resource_type=None)
        result = validate_document(conn, doc_id)
        assert result.is_valid  # still valid
        assert any("ressource" in w.lower() for w in result.warnings)

    def test_unknown_resource_type_warns(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        doc_id = _insert_doc(conn, resource_type="tweet")
        result = validate_document(conn, doc_id)
        assert result.is_valid
        assert any("ressource" in w.lower() for w in result.warnings)

    def test_missing_author_lastname_warns(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        doc_id = _insert_doc(conn, author_lastname=None)
        result = validate_document(conn, doc_id)
        assert result.is_valid
        assert any("auteur" in w.lower() for w in result.warnings)

    def test_bad_doc_date_format_warns(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        doc_id = _insert_doc(conn, doc_date="15/03/2024")
        result = validate_document(conn, doc_id)
        assert result.is_valid
        assert any("date" in w.lower() for w in result.warnings)

    def test_valid_doc_date_formats(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        for date in ("2024", "2024-03", "2024-03-15"):
            doc_id = _insert_doc(conn, doc_date=date)
            result = validate_document(conn, doc_id)
            assert not any("date" in w.lower() for w in result.warnings), f"Unexpected warning for date={date!r}"

    def test_no_units_warns(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        # Insert doc without the line unit that _insert_doc normally adds
        conn.execute(
            "INSERT INTO documents (title, language, doc_role, resource_type, source_hash, "
            "workflow_status, created_at, author_lastname) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("No units", "fr", "standalone", "text", "hash", "draft", "2026-01-01", "Smith"),
        )
        conn.commit()
        doc_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        result = validate_document(conn, doc_id)
        assert any("unité" in w.lower() or "indexée" in w.lower() for w in result.warnings)

    def test_unknown_doc_role_warns(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        doc_id = _insert_doc(conn, doc_role="unknown_role")
        conn.execute("UPDATE documents SET doc_role = 'bad_role' WHERE doc_id = ?", (doc_id,))
        conn.commit()
        result = validate_document(conn, doc_id)
        assert result.is_valid
        assert any("ôle" in w for w in result.warnings)

    def test_nonexistent_doc(self) -> None:
        from multicorpus_engine.metadata import validate_document
        conn = _make_conn()
        result = validate_document(conn, 9999)
        assert not result.is_valid

    def test_validate_all_documents(self) -> None:
        from multicorpus_engine.metadata import validate_all_documents
        conn = _make_conn()
        _insert_doc(conn, title="Doc 1")
        _insert_doc(conn, title="Doc 2", resource_type=None)
        results = validate_all_documents(conn)
        assert len(results) == 2
        assert results[0].title == "Doc 1"
        # Doc 2 has a warning for missing resource_type
        assert any("ressource" in w.lower() for w in results[1].warnings)
