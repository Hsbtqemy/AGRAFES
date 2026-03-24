"""Guard against importing the same file twice (same path or same content hash)."""

from __future__ import annotations

import sqlite3
from pathlib import Path


def find_duplicate_doc_id(
    conn: sqlite3.Connection,
    path: Path,
    source_hash: str,
) -> int | None:
    """Return an existing doc_id if this file is already in the corpus.

    Matches on ``source_hash`` (same bytes) or ``source_path`` (canonical and
    resolved path strings as stored at first import).
    """
    paths: set[str] = {str(path)}
    try:
        paths.add(str(path.resolve()))
    except (OSError, RuntimeError):
        pass
    placeholders = ",".join("?" * len(paths))
    sql = (
        f"SELECT doc_id FROM documents WHERE source_hash = ? "
        f"OR source_path IN ({placeholders}) LIMIT 1"
    )
    row = conn.execute(sql, (source_hash, *paths)).fetchone()
    return int(row[0]) if row else None


def assert_not_duplicate_import(
    conn: sqlite3.Connection,
    path: Path,
    source_hash: str,
) -> None:
    """Raise ValueError if the file is already imported."""
    dup = find_duplicate_doc_id(conn, path, source_hash)
    if dup is not None:
        raise ValueError(
            f"Fichier déjà présent dans le corpus (doc_id={dup})."
        )
