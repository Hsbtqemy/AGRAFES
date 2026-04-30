"""Mode A undo executor.

Reads the action recorded in ``prep_action_history`` (cf. migration 019 +
:mod:`action_history`) and replays it backwards: restores ``text_norm``
from snapshots, recreates deleted rows, deletes rows that the action
created, and restores ``n`` ordering.

All public entry points run in a single transaction. The caller is
responsible for ``conn.commit()`` semantics — handlers commit at the end
of the lock block, like the recording side.

Eligibility rules (V1 / Mode A):
- Only the *latest* non-undo, non-reverted action of a doc is undo-able.
- Actions of type ``undo`` are themselves never returned as undo-able
  (no undo-of-undo in V1).
- An entry with no per-unit snapshot is not undo-able (legacy entries
  predating migration 019, or actions that produced zero changes).
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from multicorpus_engine.action_history import (
    ACTION_CURATION_APPLY,
    ACTION_MERGE_UNITS,
    ACTION_RESEGMENT,
    ACTION_SPLIT_UNIT,
    ACTION_UNDO,
    insert_unit_snapshots,
    record_prep_action,
)


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------


def _latest_undoable_row(conn: sqlite3.Connection, doc_id: int) -> sqlite3.Row | None:
    """Return the most recent non-undo, non-reverted action for ``doc_id``."""
    return conn.execute(
        """
        SELECT action_id, doc_id, action_type, performed_at, description, context_json
        FROM prep_action_history
        WHERE doc_id = ?
          AND action_type != ?
          AND reverted = 0
        ORDER BY performed_at DESC, action_id DESC
        LIMIT 1
        """,
        (int(doc_id), ACTION_UNDO),
    ).fetchone()


def _has_snapshot(conn: sqlite3.Connection, action_id: int) -> bool:
    n = conn.execute(
        "SELECT COUNT(*) FROM prep_action_unit_snapshots WHERE action_id = ?",
        (int(action_id),),
    ).fetchone()[0]
    return int(n) > 0


def compute_eligibility(
    conn: sqlite3.Connection, doc_id: int
) -> dict[str, Any]:
    """Inspect the doc's action history and return an eligibility payload.

    Read-only; no mutations.
    """
    row = _latest_undoable_row(conn, doc_id)
    if row is None:
        return {"eligible": False, "reason": "no_action"}

    action_id = int(row["action_id"])
    if not _has_snapshot(conn, action_id):
        # Legacy entry from migration 007's curation_apply_history, or an
        # action that recorded an entry but no per-unit snapshot. Cannot undo.
        return {
            "eligible":    False,
            "reason":      "no_snapshots",
            "action_id":   action_id,
            "action_type": row["action_type"],
            "description": row["description"],
        }

    return {
        "eligible":     True,
        "action_id":    action_id,
        "action_type":  row["action_type"],
        "description":  row["description"],
        "performed_at": row["performed_at"],
        "warnings":     [],
    }


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------


class UndoError(Exception):
    """Raised when undo cannot proceed (eligibility failure inside the tx)."""

    def __init__(self, reason: str, message: str = ""):
        super().__init__(message or reason)
        self.reason = reason


def _load_snapshots(
    conn: sqlite3.Connection, action_id: int
) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT unit_id, text_raw_before, text_norm_before,
               unit_role_before, meta_json_before
        FROM prep_action_unit_snapshots
        WHERE action_id = ?
        """,
        (int(action_id),),
    ).fetchall()
    return [
        {
            "unit_id":          int(r["unit_id"]),
            "text_raw_before":  r["text_raw_before"],
            "text_norm_before": r["text_norm_before"],
            "unit_role_before": r["unit_role_before"],
            "meta_json_before": r["meta_json_before"],
        }
        for r in rows
    ]


def _reflag_alignment_links(conn: sqlite3.Connection, unit_ids: list[int]) -> int:
    if not unit_ids:
        return 0
    ph = ",".join("?" * len(unit_ids))
    cur = conn.execute(
        f"UPDATE alignment_links SET source_changed_at = datetime('now')"
        f" WHERE pivot_unit_id IN ({ph}) OR target_unit_id IN ({ph})",
        unit_ids + unit_ids,
    )
    return int(cur.rowcount or 0)


def _undo_curation_apply(
    conn: sqlite3.Connection, snapshots: list[dict[str, Any]]
) -> dict[str, Any]:
    for s in snapshots:
        conn.execute(
            "UPDATE units SET text_norm = ? WHERE unit_id = ?",
            (s["text_norm_before"], s["unit_id"]),
        )
    unit_ids = [s["unit_id"] for s in snapshots]
    reflagged = _reflag_alignment_links(conn, unit_ids)
    return {
        "units_restored":       len(snapshots),
        "alignments_reflagged": reflagged,
        "fts_stale":            len(snapshots) > 0,
    }


def _undo_merge_units(
    conn: sqlite3.Connection,
    snapshots: list[dict[str, Any]],
    context: dict[str, Any],
    doc_id: int,
) -> dict[str, Any]:
    n1 = int(context["n1"])
    n2 = int(context["n2"])
    kept_uid    = int(context["kept_unit_id"])
    deleted_uid = int(context["deleted_unit_id"])
    kept_ext    = context.get("kept_external_id_before")
    deleted_ext = context.get("deleted_external_id_before")

    snap_kept    = next((s for s in snapshots if s["unit_id"] == kept_uid), None)
    snap_deleted = next((s for s in snapshots if s["unit_id"] == deleted_uid), None)
    if snap_kept is None or snap_deleted is None:
        raise UndoError(
            "snapshot_missing",
            f"merge undo: missing snapshot for kept={kept_uid} or deleted={deleted_uid}",
        )

    # Make room: shift units with n > n1 up by +1 (re-creating the n2 slot).
    conn.execute(
        "UPDATE units SET n = n + 1 WHERE doc_id=? AND n > ?",
        (doc_id, n1),
    )
    # Re-insert the deleted unit at n2 with its original unit_id.
    conn.execute(
        """
        INSERT INTO units
          (unit_id, doc_id, unit_type, n, external_id,
           text_raw, text_norm, meta_json, unit_role)
        VALUES (?, ?, 'line', ?, ?, ?, ?, ?, ?)
        """,
        (
            deleted_uid, doc_id, n2, deleted_ext,
            snap_deleted["text_raw_before"],
            snap_deleted["text_norm_before"],
            snap_deleted["meta_json_before"],
            snap_deleted["unit_role_before"],
        ),
    )
    # Restore the kept unit's text + role + meta. external_id was unchanged
    # by merge but we restore it explicitly to handle quirky pre-action states.
    conn.execute(
        """
        UPDATE units SET text_raw=?, text_norm=?, external_id=?,
                         unit_role=?, meta_json=?
         WHERE unit_id=?
        """,
        (
            snap_kept["text_raw_before"],
            snap_kept["text_norm_before"],
            kept_ext,
            snap_kept["unit_role_before"],
            snap_kept["meta_json_before"],
            kept_uid,
        ),
    )
    return {"units_restored": 2, "alignments_reflagged": 0, "fts_stale": True}


def _undo_split_unit(
    conn: sqlite3.Connection,
    snapshots: list[dict[str, Any]],
    context: dict[str, Any],
    doc_id: int,
) -> dict[str, Any]:
    split_uid       = int(context["split_unit_id"])
    split_n         = int(context["split_unit_n"])
    created_uid     = int(context["created_unit_id"])
    ext_id_before   = context.get("external_id_before")

    snap = next((s for s in snapshots if s["unit_id"] == split_uid), None)
    if snap is None:
        raise UndoError(
            "snapshot_missing",
            f"split undo: missing snapshot for split unit {split_uid}",
        )

    # Restore the kept (split) unit from snapshot, including external_id.
    conn.execute(
        """
        UPDATE units SET text_raw=?, text_norm=?, external_id=?,
                         unit_role=?, meta_json=?
         WHERE unit_id=?
        """,
        (
            snap["text_raw_before"],
            snap["text_norm_before"],
            ext_id_before,
            snap["unit_role_before"],
            snap["meta_json_before"],
            split_uid,
        ),
    )
    # Delete the unit created by the split (was inserted at split_n+1).
    conn.execute("DELETE FROM units WHERE unit_id=?", (created_uid,))
    # Shift everything with n >= split_n + 2 down by 1 to close the gap.
    conn.execute(
        "UPDATE units SET n = n - 1 WHERE doc_id=? AND n >= ?",
        (doc_id, split_n + 2),
    )
    return {"units_restored": 1, "alignments_reflagged": 0, "fts_stale": True}


def _undo_resegment(
    conn: sqlite3.Connection,
    snapshots: list[dict[str, Any]],
    context: dict[str, Any],
    doc_id: int,
) -> dict[str, Any]:
    units_before = context.get("units_before") or []
    created      = context.get("units_created_after_json") or []

    # Index snapshots by unit_id for quick lookup.
    snap_by_uid = {s["unit_id"]: s for s in snapshots}

    # 1. Delete units created by the resegment.
    if created:
        ph = ",".join("?" * len(created))
        ids = [int(c["unit_id"]) for c in created]
        conn.execute(
            f"DELETE FROM units WHERE unit_id IN ({ph})",
            ids,
        )

    # 2. Re-insert each pre-action unit with its original unit_id, n,
    #    external_id, and full payload. Snapshot table provides text+role+meta;
    #    context_json provides n + external_id.
    for u in units_before:
        uid = int(u["unit_id"])
        s = snap_by_uid.get(uid)
        if s is None:
            # Defensive: snapshot row missing for this uid. Use context payload.
            text_raw  = u.get("text_raw")
            text_norm = u.get("text_norm") or ""
            unit_role = u.get("unit_role")
            meta_json = u.get("meta_json")
        else:
            text_raw  = s["text_raw_before"]
            text_norm = s["text_norm_before"]
            unit_role = s["unit_role_before"]
            meta_json = s["meta_json_before"]
        conn.execute(
            """
            INSERT INTO units
              (unit_id, doc_id, unit_type, n, external_id,
               text_raw, text_norm, meta_json, unit_role)
            VALUES (?, ?, 'line', ?, ?, ?, ?, ?, ?)
            """,
            (
                uid,
                doc_id,
                int(u["n"]),
                u.get("external_id"),
                text_raw,
                text_norm or "",
                meta_json,
                unit_role,
            ),
        )

    return {
        "units_restored":       len(units_before),
        "alignments_reflagged": 0,
        "fts_stale":            True,
    }


def execute_undo(
    conn: sqlite3.Connection, doc_id: int
) -> dict[str, Any]:
    """Run the eligibility check, then revert the latest action atomically.

    Caller is expected to wrap this in its own ``with self._lock():`` block
    and commit at the end. This function does not commit.

    Returns a payload describing the undo outcome.
    Raises ``UndoError(reason=...)`` if not eligible at execution time.
    """
    elig = compute_eligibility(conn, doc_id)
    if not elig.get("eligible"):
        raise UndoError(elig.get("reason", "no_action"))

    action_id   = int(elig["action_id"])
    action_type = elig["action_type"]

    # Re-fetch the row inside the same tx — context_json is essential.
    row = conn.execute(
        "SELECT context_json FROM prep_action_history WHERE action_id = ?",
        (action_id,),
    ).fetchone()
    if row is None:
        raise UndoError("action_vanished")
    context = json.loads(row["context_json"]) if row["context_json"] else {}
    snapshots = _load_snapshots(conn, action_id)

    if action_type == ACTION_CURATION_APPLY:
        outcome = _undo_curation_apply(conn, snapshots)
    elif action_type == ACTION_MERGE_UNITS:
        outcome = _undo_merge_units(conn, snapshots, context, doc_id)
    elif action_type == ACTION_SPLIT_UNIT:
        outcome = _undo_split_unit(conn, snapshots, context, doc_id)
    elif action_type == ACTION_RESEGMENT:
        outcome = _undo_resegment(conn, snapshots, context, doc_id)
    else:
        raise UndoError(
            "unsupported_action_type",
            f"Cannot undo action_type={action_type!r}",
        )

    # Record the undo itself + flip the original's reverted flag.
    undo_action_id = record_prep_action(
        conn,
        doc_id=doc_id,
        action_type=ACTION_UNDO,
        description=f"Annulation : {elig.get('description') or action_type}",
        context={
            "reverted_action_id":   action_id,
            "reverted_action_type": action_type,
        },
    )
    conn.execute(
        """
        UPDATE prep_action_history
           SET reverted = 1, reverted_by_id = ?
         WHERE action_id = ?
        """,
        (undo_action_id, action_id),
    )

    return {
        "undo_action_id":       undo_action_id,
        "reverted_action_id":   action_id,
        "reverted_action_type": action_type,
        **outcome,
    }
