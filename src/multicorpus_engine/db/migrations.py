"""Versioned migration runner for SQLite.

Migrations are SQL files in the `migrations/` directory adjacent to this package,
named `NNN_description.sql` where NNN is the version number (zero-padded, e.g. 001).

The runner tracks applied migrations in the `schema_migrations` table (created
by migration 001 itself, so migration 001 bootstraps the tracker).
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path


# Default migrations directory: repo_root/migrations/
_MIGRATIONS_DIR = Path(__file__).parent.parent.parent.parent / "migrations"


def _find_migrations(migrations_dir: Path) -> list[tuple[int, Path]]:
    """Return sorted list of (version, path) for all .sql migration files."""
    result: list[tuple[int, Path]] = []
    for path in migrations_dir.glob("*.sql"):
        m = re.match(r"^(\d+)_", path.name)
        if m:
            result.append((int(m.group(1)), path))
    return sorted(result, key=lambda t: t[0])


def apply_migrations(
    conn: sqlite3.Connection,
    migrations_dir: Path | None = None,
) -> int:
    """Apply any pending migrations and return the count applied."""
    if migrations_dir is None:
        migrations_dir = _MIGRATIONS_DIR

    migrations = _find_migrations(migrations_dir)
    if not migrations:
        return 0

    # Bootstrap: create schema_migrations table if it doesn't exist yet
    # (migration 001 also creates it, but we need it before we can check versions)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     INTEGER PRIMARY KEY,
            applied_at  TEXT NOT NULL
        )
        """
    )
    conn.commit()

    applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}

    count = 0
    for version, path in migrations:
        if version in applied:
            continue
        sql = path.read_text(encoding="utf-8")
        conn.executescript(sql)
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))",
            (version,),
        )
        conn.commit()
        count += 1

    return count
