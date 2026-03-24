"""Corpus-level metadata stored in SQLite (single row, id=1)."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ensure_corpus_info_row(conn: sqlite3.Connection) -> None:
    """Ensure the singleton row exists (migration 009 should already insert it)."""
    conn.execute(
        """
        INSERT OR IGNORE INTO corpus_info (id, title, description, meta_json, updated_at)
        VALUES (1, NULL, NULL, NULL, ?)
        """,
        (_utc_now(),),
    )


def get_corpus_info(conn: sqlite3.Connection) -> dict[str, Any]:
    """Return title, description, meta (dict), updated_at."""
    ensure_corpus_info_row(conn)
    row = conn.execute(
        "SELECT title, description, meta_json, updated_at FROM corpus_info WHERE id = 1"
    ).fetchone()
    if not row:
        return {
            "title": None,
            "description": None,
            "meta": {},
            "updated_at": None,
        }
    title, description, meta_json, updated_at = row[0], row[1], row[2], row[3]
    meta: dict[str, Any] = {}
    if meta_json:
        try:
            parsed = json.loads(meta_json)
            if isinstance(parsed, dict):
                meta = parsed
        except json.JSONDecodeError:
            meta = {}
    return {
        "title": title,
        "description": description,
        "meta": meta,
        "updated_at": updated_at,
    }


def apply_corpus_info_patch(conn: sqlite3.Connection, body: dict[str, Any]) -> dict[str, Any]:
    """Apply a partial update from JSON. Only keys present in ``body`` are updated.

    - ``title`` / ``description``: string or null to clear.
    - ``meta``: object replaces the entire meta dict; null clears to ``{}``.
    """
    ensure_corpus_info_row(conn)
    current = get_corpus_info(conn)
    new_title = current["title"]
    if "title" in body:
        t = body["title"]
        if t is not None and not isinstance(t, str):
            raise ValueError("title must be a string or null")
        new_title = t
    new_desc = current["description"]
    if "description" in body:
        d = body["description"]
        if d is not None and not isinstance(d, str):
            raise ValueError("description must be a string or null")
        new_desc = d
    new_meta = current["meta"]
    if "meta" in body:
        m = body["meta"]
        if m is None:
            new_meta = {}
        elif isinstance(m, dict):
            new_meta = m
        else:
            raise ValueError("meta must be an object or null")
    meta_json = json.dumps(new_meta, ensure_ascii=False) if new_meta else None
    now = _utc_now()
    conn.execute(
        """
        UPDATE corpus_info
        SET title = ?, description = ?, meta_json = ?, updated_at = ?
        WHERE id = 1
        """,
        (new_title, new_desc, meta_json, now),
    )
    conn.commit()
    return get_corpus_info(conn)
