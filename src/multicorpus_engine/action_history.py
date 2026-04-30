"""Helpers to record destructive prep actions (Mode A undo backbone).

Writes into ``prep_action_history`` and ``prep_action_unit_snapshots``
(migration 019). None of these helpers call ``conn.commit()``: they
participate in the caller's transaction. Pair them with the mutation in
the same ``with self._lock():`` block so snapshot + mutation either both
land or both roll back.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Iterable

ACTION_CURATION_APPLY = "curation_apply"
ACTION_MERGE_UNITS    = "merge_units"
ACTION_SPLIT_UNIT     = "split_unit"
ACTION_RESEGMENT      = "resegment"
ACTION_UNDO           = "undo"

ALLOWED_ACTION_TYPES = frozenset({
    ACTION_CURATION_APPLY,
    ACTION_MERGE_UNITS,
    ACTION_SPLIT_UNIT,
    ACTION_RESEGMENT,
    ACTION_UNDO,
})


def utc_now_iso() -> str:
    """ISO 8601 UTC timestamp with 'Z' suffix, second precision."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def record_prep_action(
    conn: sqlite3.Connection,
    *,
    doc_id: int,
    action_type: str,
    description: str,
    context: dict[str, Any] | None = None,
    performed_at: str | None = None,
) -> int:
    """Insert a prep_action_history row. Returns ``action_id``. Does not commit.

    ``context`` is JSON-encoded and stored in ``context_json``. The exact
    shape per ``action_type`` is documented authoritatively in
    ``tauri-prep/src/lib/prepUndo.ts`` and informally in migration 019.
    """
    if action_type not in ALLOWED_ACTION_TYPES:
        raise ValueError(f"Unknown action_type: {action_type!r}")
    cur = conn.execute(
        """
        INSERT INTO prep_action_history
          (doc_id, action_type, performed_at, description, context_json)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            int(doc_id),
            action_type,
            performed_at or utc_now_iso(),
            description,
            json.dumps(context, ensure_ascii=False) if context is not None else None,
        ),
    )
    return int(cur.lastrowid)


def insert_unit_snapshots(
    conn: sqlite3.Connection,
    action_id: int,
    snapshots: Iterable[dict[str, Any]],
) -> int:
    """Insert prep_action_unit_snapshots rows. Returns count inserted. No commit.

    Each snapshot dict accepts:
      - unit_id (int, required)
      - text_norm_before (str, required)
      - text_raw_before (str | None, optional — pass when the action mutates text_raw)
      - unit_role_before (str | None, optional)
      - meta_json_before (str | None, optional — already serialized JSON or None)
    """
    rows = [
        (
            int(action_id),
            int(s["unit_id"]),
            s.get("text_raw_before"),
            s["text_norm_before"],
            s.get("unit_role_before"),
            s.get("meta_json_before"),
        )
        for s in snapshots
    ]
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT INTO prep_action_unit_snapshots
          (action_id, unit_id, text_raw_before, text_norm_before,
           unit_role_before, meta_json_before)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)
