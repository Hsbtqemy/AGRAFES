"""Guard against importing the same file twice (same path or same content hash)."""

from __future__ import annotations

import sqlite3
from pathlib import Path


def normalize_import_path_str(s: str) -> str:
    """Align with Prep UI `normalizeImportPath`: separators, case, trailing slash.

    Also strips Windows long-path prefix ``\\\\?\\`` so ``\\\\?\\C:\\a.doc`` and
    ``C:\\a.doc`` compare equal.
    """
    x = s.replace("\\", "/").strip().rstrip("/").lower()
    if x.startswith("//?/"):
        x = x[4:]
    return x


def _path_raw_variants(path: Path) -> set[str]:
    """Exact strings the importer may have stored as ``source_path``."""
    raw: set[str] = {str(path)}
    try:
        raw.add(str(path.resolve()))
    except (OSError, RuntimeError):
        pass
    return raw


def find_duplicate_doc_id(
    conn: sqlite3.Connection,
    path: Path,
    source_hash: str,
) -> int | None:
    """Return an existing doc_id if this file is already in the corpus.

    Matches on ``source_hash`` (same bytes) or ``source_path`` (same logical path
    after normalization — handles ``\\\\?\\``, slash style, case on Windows).
    """
    row = conn.execute(
        "SELECT doc_id FROM documents WHERE source_hash = ? LIMIT 1",
        (source_hash,),
    ).fetchone()
    if row:
        return int(row[0])

    raw_paths = _path_raw_variants(path)
    placeholders = ",".join("?" * len(raw_paths))
    sql = f"SELECT doc_id FROM documents WHERE source_path IN ({placeholders}) LIMIT 1"
    row = conn.execute(sql, tuple(raw_paths)).fetchone()
    if row:
        return int(row[0])

    candidates = {normalize_import_path_str(p) for p in raw_paths}
    for doc_id, stored in conn.execute(
        "SELECT doc_id, source_path FROM documents WHERE source_path IS NOT NULL"
    ):
        if stored and normalize_import_path_str(stored) in candidates:
            return int(doc_id)
    return None


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
