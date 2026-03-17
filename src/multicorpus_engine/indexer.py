"""FTS5 index management.

Builds or rebuilds the fts_units FTS5 index from the units table.
Only unit_type='line' units are indexed (structure units excluded).

fts_units is a regular (non-content) FTS5 table. Its rowid equals unit_id,
enabling efficient JOINs back to units and documents.

See docs/DECISIONS.md ADR-005.
"""

from __future__ import annotations

import logging
import sqlite3

logger = logging.getLogger(__name__)

_FTS5_CREATE_SQL = """CREATE VIRTUAL TABLE fts_units USING fts5(
    text_norm,
    tokenize='unicode61'
)"""


def _is_fts_error(e: BaseException) -> bool:
    """True if the exception suggests fts_units is missing or broken (recreate will help)."""
    msg = str(e).lower()
    return (
        "no such table" in msg
        or "vtable" in msg
        or "fts_units" in msg
        or "constructor failed" in msg
    )


# FTS5 shadow tables (real tables); dropping them first can allow DROP of corrupted fts_units
_FTS5_SHADOW_SUFFIXES = ("_data", "_idx", "_content", "_docsize", "_config")


def _recreate_fts_table(conn: sqlite3.Connection) -> None:
    """Drop and recreate fts_units. If DROP fails (e.g. corrupted vtable), drop shadow tables then retry."""
    try:
        conn.execute("DROP TABLE IF EXISTS fts_units")
        conn.commit()
    except sqlite3.Error as e:
        if not _is_fts_error(e):
            raise
        logger.warning("DROP fts_units failed (%s), dropping FTS5 shadow tables", e)
        for suffix in _FTS5_SHADOW_SUFFIXES:
            try:
                conn.execute(f"DROP TABLE IF EXISTS fts_units{suffix}")
            except sqlite3.Error:
                pass
        conn.commit()
        try:
            conn.execute("DROP TABLE IF EXISTS fts_units")
            conn.commit()
        except sqlite3.Error as e2:
            if _is_fts_error(e2):
                logger.warning("DROP fts_units still failed after shadow drop (%s), removing from sqlite_master", e2)
                conn.execute("PRAGMA writable_schema = 1")
                try:
                    conn.execute("DELETE FROM sqlite_master WHERE type = 'table' AND name = 'fts_units'")
                    conn.commit()
                    cur = conn.execute("PRAGMA schema_version").fetchone()
                    if cur:
                        conn.execute(f"PRAGMA schema_version = {cur[0] + 1}")
                finally:
                    conn.execute("PRAGMA writable_schema = 0")
            else:
                raise

    conn.execute(_FTS5_CREATE_SQL)
    conn.commit()
    logger.info("Recreated fts_units virtual table")


def build_index(conn: sqlite3.Connection) -> int:
    """Rebuild the FTS5 index from scratch.

    Clears all FTS rows and repopulates from line units.
    fts_units is a regular FTS5 table so DELETE FROM is supported.
    On "vtable constructor failed" (e.g. corrupted FTS data), recreates the table then repopulates.
    Returns the count of units indexed.
    """
    logger.info("Rebuilding FTS5 index...")

    try:
        conn.execute("DELETE FROM fts_units")
    except sqlite3.Error as e:
        if _is_fts_error(e):
            logger.warning("FTS table unusable (%s), recreating fts_units", e)
            _recreate_fts_table(conn)
        else:
            raise

    try:
        conn.execute(
            """
            INSERT INTO fts_units(rowid, text_norm)
            SELECT unit_id, text_norm
            FROM units
            WHERE unit_type = 'line'
            """
        )
    except sqlite3.Error as e:
        if _is_fts_error(e):
            logger.warning("FTS insert failed (%s), recreating fts_units and retrying", e)
            _recreate_fts_table(conn)
            conn.execute(
                """
                INSERT INTO fts_units(rowid, text_norm)
                SELECT unit_id, text_norm
                FROM units
                WHERE unit_type = 'line'
                """
            )
        else:
            raise

    conn.commit()

    count = conn.execute(
        "SELECT COUNT(*) FROM units WHERE unit_type = 'line'"
    ).fetchone()[0]

    logger.info("FTS5 index rebuilt: %d units indexed", count)
    return count


def update_index(conn: sqlite3.Connection) -> int:
    """Update FTS index for units not yet indexed.

    For Increment 1, this is equivalent to a full rebuild since we don't
    track incremental state. Future: track last indexed unit_id.
    """
    return build_index(conn)
