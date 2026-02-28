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
    assert "runs" in tables, "runs table missing"
    assert "schema_migrations" in tables, "schema_migrations table missing"

    # Verify FTS virtual table exists
    assert "fts_units" in tables, "fts_units FTS table missing"

    # Verify idempotency: applying again should apply 0 additional migrations
    count2 = apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    assert count2 == 0, "Re-running migrations should be a no-op"
