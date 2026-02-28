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


def build_index(conn: sqlite3.Connection) -> int:
    """Rebuild the FTS5 index from scratch.

    Clears all FTS rows and repopulates from line units.
    fts_units is a regular FTS5 table so DELETE FROM is supported.
    Returns the count of units indexed.
    """
    logger.info("Rebuilding FTS5 index...")

    # Clear all existing FTS content.
    # For a regular (non-contentless) FTS5 table, DELETE FROM is correct.
    conn.execute("DELETE FROM fts_units")

    # Insert only line units; use unit_id as the FTS rowid for JOIN capability
    conn.execute(
        """
        INSERT INTO fts_units(rowid, text_norm)
        SELECT unit_id, text_norm
        FROM units
        WHERE unit_type = 'line'
        """
    )
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
