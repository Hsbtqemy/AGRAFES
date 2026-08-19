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
ACTION_UPDATE_TEXT    = "update_text"
ACTION_SET_ROLE       = "set_role"
ACTION_SET_PARAGRAPH  = "set_paragraph"
ACTION_UNDO           = "undo"

ALLOWED_ACTION_TYPES = frozenset({
    ACTION_CURATION_APPLY,
    ACTION_MERGE_UNITS,
    ACTION_SPLIT_UNIT,
    ACTION_RESEGMENT,
    ACTION_UPDATE_TEXT,
    ACTION_SET_ROLE,
    ACTION_SET_PARAGRAPH,
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
      - text_source_before (str | None, optional — pass when the action mutates
        text_source, e.g. merge/split; migration 021, ADR-043 P2b)
    """
    rows = [
        (
            int(action_id),
            int(s["unit_id"]),
            s.get("text_raw_before"),
            s["text_norm_before"],
            s.get("unit_role_before"),
            s.get("meta_json_before"),
            s.get("text_source_before"),
        )
        for s in snapshots
    ]
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT INTO prep_action_unit_snapshots
          (action_id, unit_id, text_raw_before, text_norm_before,
           unit_role_before, meta_json_before, text_source_before)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)


# ── Alignment link snapshots (migration 035) ─────────────────────────────────
#
# The columns of alignment_links, in the order they are archived and restored.
# Kept as one list so the SELECT, the INSERT and the restore can never drift
# apart — a column added to alignment_links must be added here, or it is lost
# on every undo without anything failing.
LINK_SNAPSHOT_COLUMNS: tuple[str, ...] = (
    "link_id", "run_id", "pivot_unit_id", "target_unit_id", "external_id",
    "pivot_doc_id", "target_doc_id", "created_at", "status", "source_changed_at",
    "bead_id", "bead_uid", "target_char_start", "target_char_end",
)


def snapshot_links_for_units(
    conn: sqlite3.Connection,
    action_id: int,
    unit_ids: Iterable[int],
) -> int:
    """Archive every alignment link touching ``unit_ids``, on either side. No commit.

    Call this **before** deleting the links, inside the caller's transaction and
    with ``action_id`` already recorded — that is the whole contract. Returns the
    number of links archived.

    Links are matched on pivot *or* target: a merge destroys both directions, and
    an archive that kept only one would restore a half-alignment.
    """
    return insert_link_snapshots(action_id, collect_links_for_units(conn, unit_ids), conn=conn)


def collect_links_for_units(
    conn: sqlite3.Connection, unit_ids: Iterable[int]
) -> list[tuple]:
    """Read the links touching ``unit_ids`` (either side) as plain tuples. No write.

    Split out so a caller whose ``record_prep_action`` comes *after* its DELETE can
    still archive: read here, delete, then :func:`insert_link_snapshots` once the
    action exists. ``_handle_units_split`` is exactly that shape.
    """
    ids = [int(u) for u in unit_ids]
    if not ids:
        return []
    ph = ",".join("?" * len(ids))
    cols = ", ".join(LINK_SNAPSHOT_COLUMNS)
    return [
        tuple(r) for r in conn.execute(
            f"SELECT {cols} FROM alignment_links"
            f" WHERE pivot_unit_id IN ({ph}) OR target_unit_id IN ({ph})",
            ids * 2,
        )
    ]


def insert_link_snapshots(
    action_id: int, rows: list[tuple], *, conn: sqlite3.Connection
) -> int:
    """Write link snapshot rows (as returned by :func:`collect_links_for_units`). No commit."""
    if not rows:
        return 0
    cols = ", ".join(LINK_SNAPSHOT_COLUMNS)
    conn.executemany(
        f"INSERT OR IGNORE INTO prep_action_link_snapshots (action_id, {cols})"
        f" VALUES (?, {', '.join('?' * len(LINK_SNAPSHOT_COLUMNS))})",
        [(int(action_id), *r) for r in rows],
    )
    return len(rows)


def restore_link_snapshots(conn: sqlite3.Connection, action_id: int) -> dict[str, int]:
    """Re-insert the links archived for ``action_id``. No commit.

    Returns ``{"restored": n, "skipped": m}``. A link is skipped for either of two
    reasons, and both are counted, never swallowed:

    * its ``(pivot_unit_id, target_unit_id)`` pair is occupied again — a re-align
      between the action and its undo does that, and migration 008 makes the pair
      unique. ``INSERT OR IGNORE`` steps over it, leaving the newer link alone;
    * one of its two units no longer exists — the other document was deleted or
      resegmented in the meantime. This one **must be filtered out before the
      insert**: ``OR IGNORE`` steps over a UNIQUE violation but a FOREIGN KEY
      violation still raises, which would abort the whole undo instead of skipping
      one link (verified 2026-08-19, sqlite3.IntegrityError).

    ``link_id`` is restored verbatim: AUTOINCREMENT never reuses a freed rowid, so
    the archived id is still free and the restitution is identical, not approximate.
    """
    cols = ", ".join(LINK_SNAPSHOT_COLUMNS)
    total = conn.execute(
        "SELECT COUNT(*) FROM prep_action_link_snapshots WHERE action_id = ?",
        (int(action_id),),
    ).fetchone()[0]
    if not total:
        return {"restored": 0, "skipped": 0}
    qualified = ", ".join(f"s.{c}" for c in LINK_SNAPSHOT_COLUMNS)
    rows = conn.execute(
        f"SELECT {qualified} FROM prep_action_link_snapshots s"
        f" WHERE s.action_id = ?"
        f"   AND EXISTS (SELECT 1 FROM units u WHERE u.unit_id = s.pivot_unit_id)"
        f"   AND EXISTS (SELECT 1 FROM units u WHERE u.unit_id = s.target_unit_id)",
        (int(action_id),),
    ).fetchall()
    if not rows:
        return {"restored": 0, "skipped": total}
    before = conn.execute("SELECT COUNT(*) FROM alignment_links").fetchone()[0]
    conn.executemany(
        f"INSERT OR IGNORE INTO alignment_links ({cols})"
        f" VALUES ({', '.join('?' * len(LINK_SNAPSHOT_COLUMNS))})",
        [tuple(r) for r in rows],
    )
    after = conn.execute("SELECT COUNT(*) FROM alignment_links").fetchone()[0]
    restored = after - before
    return {"restored": restored, "skipped": total - restored}
