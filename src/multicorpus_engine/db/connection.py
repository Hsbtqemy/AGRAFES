"""SQLite connection factory."""

import sqlite3
from pathlib import Path


def get_connection(db_path: str | Path) -> sqlite3.Connection:
    """Open a SQLite connection with sensible defaults.

    WAL mode for concurrent readers. Row factory so rows behave like dicts.
    Foreign keys enforced.
    """
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
