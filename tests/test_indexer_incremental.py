from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from multicorpus_engine.indexer import build_index, update_index


def _insert_doc(conn: sqlite3.Connection, title: str = "Doc") -> int:
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cur = conn.execute(
        """
        INSERT INTO documents (
            title, language, doc_role, resource_type, meta_json, source_path, source_hash, created_at
        )
        VALUES (?, 'fr', 'standalone', 'literary', NULL, NULL, NULL, ?)
        """,
        (title, created_at),
    )
    return int(cur.lastrowid)


def _insert_line(conn: sqlite3.Connection, doc_id: int, n: int, text: str) -> int:
    cur = conn.execute(
        """
        INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)
        VALUES (?, 'line', ?, ?, ?, ?, NULL)
        """,
        (doc_id, n, n, text, text),
    )
    return int(cur.lastrowid)


def _fts_count(conn: sqlite3.Connection, query: str) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM fts_units WHERE fts_units MATCH ?", (query,)).fetchone()[0])


def test_incremental_update_syncs_insert_refresh_delete(db_conn: sqlite3.Connection) -> None:
    doc_id = _insert_doc(db_conn, "Incremental")
    u1 = _insert_line(db_conn, doc_id, 1, "alpha one")
    u2 = _insert_line(db_conn, doc_id, 2, "beta two")
    _insert_line(db_conn, doc_id, 3, "gamma three")
    db_conn.commit()

    assert build_index(db_conn) == 3
    assert _fts_count(db_conn, "alpha") == 1
    assert _fts_count(db_conn, "beta") == 1

    # One refresh (u1 text changed), one deletion (u2 removed), one insertion (new row).
    db_conn.execute("UPDATE units SET text_norm = 'delta one', text_raw = 'delta one' WHERE unit_id = ?", (u1,))
    db_conn.execute("DELETE FROM units WHERE unit_id = ?", (u2,))
    _insert_line(db_conn, doc_id, 4, "epsilon four")
    db_conn.commit()

    stats = update_index(db_conn, prune_deleted=True)

    assert stats["units_indexed"] == 3
    assert stats["inserted"] == 1
    assert stats["refreshed"] == 1
    assert stats["deleted"] == 1
    assert _fts_count(db_conn, "delta") == 1
    assert _fts_count(db_conn, "epsilon") == 1
    assert _fts_count(db_conn, "beta") == 0


def test_incremental_update_can_skip_prune_deleted(db_conn: sqlite3.Connection) -> None:
    doc_id = _insert_doc(db_conn, "No prune")
    _insert_line(db_conn, doc_id, 1, "alpha keep")
    to_delete = _insert_line(db_conn, doc_id, 2, "beta stale")
    db_conn.commit()

    assert build_index(db_conn) == 2
    db_conn.execute("DELETE FROM units WHERE unit_id = ?", (to_delete,))
    db_conn.commit()

    stats = update_index(db_conn, prune_deleted=False)
    assert stats["units_indexed"] == 1
    assert stats["deleted"] == 0

    # stale row remains in FTS when prune_deleted=False
    stale_rows = int(
        db_conn.execute(
            """
            SELECT COUNT(*)
            FROM fts_units f
            LEFT JOIN units u ON u.unit_id = f.rowid
            WHERE u.unit_id IS NULL
            """
        ).fetchone()[0]
    )
    assert stale_rows >= 1
