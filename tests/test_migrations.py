"""Tests for database migrations."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).parent.parent
_MIGRATIONS_DIR = _REPO_ROOT / "migrations"


def test_migrations_apply_clean_db(tmp_path: Path) -> None:
    """Migrations must create all required tables on a fresh DB."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    db_path = tmp_path / "clean.db"
    conn = get_connection(db_path)
    count = apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)

    # At least 2 migrations should have been applied (001 and 002)
    assert count >= 2

    # Verify core tables exist
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    assert "documents" in tables, "documents table missing"
    assert "units" in tables, "units table missing"
    assert "tokens" in tables, "tokens table missing"
    assert "runs" in tables, "runs table missing"
    assert "schema_migrations" in tables, "schema_migrations table missing"

    doc_cols = {
        row[1]
        for row in conn.execute("PRAGMA table_info(documents)")
    }
    assert "workflow_status" in doc_cols, "documents.workflow_status missing"
    assert "validated_at" in doc_cols, "documents.validated_at missing"
    assert "validated_run_id" in doc_cols, "documents.validated_run_id missing"

    token_cols = {
        row[1]
        for row in conn.execute("PRAGMA table_info(tokens)")
    }
    for col in ("token_id", "unit_id", "sent_id", "position", "word", "lemma", "upos"):
        assert col in token_cols, f"tokens.{col} missing"

    # Verify FTS virtual table exists
    assert "fts_units" in tables, "fts_units FTS table missing"

    # Verify idempotency: applying again should apply 0 additional migrations
    count2 = apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    assert count2 == 0, "Re-running migrations should be a no-op"


def test_migration_019_prep_action_history(tmp_path: Path) -> None:
    """Migration 019 must create prep_action_history and snapshot tables."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    db_path = tmp_path / "m019.db"
    conn = get_connection(db_path)
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)

    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    assert "prep_action_history" in tables
    assert "prep_action_unit_snapshots" in tables
    # Legacy table coexists.
    assert "curation_apply_history" in tables

    history_cols = {
        row[1] for row in conn.execute("PRAGMA table_info(prep_action_history)")
    }
    for col in (
        "action_id", "doc_id", "action_type", "performed_at",
        "description", "context_json", "reverted", "reverted_by_id",
    ):
        assert col in history_cols, f"prep_action_history.{col} missing"

    snap_cols = {
        row[1] for row in conn.execute("PRAGMA table_info(prep_action_unit_snapshots)")
    }
    for col in (
        "action_id", "unit_id",
        "text_raw_before", "text_norm_before",
        "unit_role_before", "meta_json_before",
    ):
        assert col in snap_cols, f"prep_action_unit_snapshots.{col} missing"

    # CHECK constraint on action_type rejects unknown values.
    conn.execute(
        "INSERT INTO documents (doc_id, title, language, created_at) VALUES (?, ?, ?, ?)",
        (1, "doc", "fr", "2026-04-30T00:00:00Z"),
    )
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            """
            INSERT INTO prep_action_history
              (doc_id, action_type, performed_at, description)
            VALUES (?, ?, ?, ?)
            """,
            (1, "not_a_real_action", "2026-04-30T00:00:00Z", "x"),
        )
    conn.rollback()

    # Valid insert + snapshot link works.
    cur = conn.execute(
        """
        INSERT INTO prep_action_history
          (doc_id, action_type, performed_at, description, context_json)
        VALUES (?, ?, ?, ?, ?)
        """,
        (1, "curation_apply", "2026-04-30T00:00:00Z", "Apply test", "{}"),
    )
    action_id = cur.lastrowid
    conn.execute(
        """
        INSERT INTO prep_action_unit_snapshots
          (action_id, unit_id, text_norm_before)
        VALUES (?, ?, ?)
        """,
        (action_id, 42, "before"),
    )
    conn.commit()

    rows = [
        row["text_norm_before"]
        for row in conn.execute(
            "SELECT text_norm_before FROM prep_action_unit_snapshots WHERE action_id=?",
            (action_id,),
        )
    ]
    assert rows == ["before"]

    # ON DELETE CASCADE from prep_action_history → snapshots.
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("DELETE FROM prep_action_history WHERE action_id=?", (action_id,))
    conn.commit()
    remaining = conn.execute(
        "SELECT COUNT(*) FROM prep_action_unit_snapshots WHERE action_id=?",
        (action_id,),
    ).fetchone()[0]
    assert remaining == 0

    # Re-running migrations remains a no-op.
    count2 = apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    assert count2 == 0
