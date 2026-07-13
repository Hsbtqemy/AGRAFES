"""Per-cell alignment status service (R3.3, D-W8 résolu — matrix workspace).

« ∅ Non traduit » on a matrix cell marks the pair (hub unit × target document)
as deliberately untranslated in THAT language (docs/DESIGN_alignment_workspace.md
§3.3). The existing ``units.unit_status`` axis (023) is global to the unit —
right for a source unit untranslated everywhere (marker-lift), wrong when EN
omits and RO does not — so the cell mark lives in its own table,
``alignment_cell_statuses`` (migration 028). The matrix projection reads BOTH
axes; a marked cell displays the ``[non traduit]`` token (D10) and counts as
done (D-W5).

Pure w.r.t. transport: takes a ``sqlite3.Connection``, raises ``ServiceError``
subclasses (ValidationError → ERR_VALIDATION, NotFoundError → ERR_NOT_FOUND,
ConflictError → ERR_CONFLICT), commits on success like the other setters
(``units_service.set_unit_status``).
"""

from __future__ import annotations

import sqlite3
from typing import Any, Optional

from .errors import ConflictError, NotFoundError, ValidationError
from .validation import Field, validate

# v1 has a single value; validated here (migration 028 has no CHECK) so adding
# a value later stays a service-only change — same discipline as unit_status.
_VALID_CELL_STATUS = frozenset({"non_traduit"})

_SET_SCHEMA = (
    Field("pivot_unit_id", int, coerce=True),
    Field("target_doc_id", int, coerce=True),
)


def _norm_status(raw: Any) -> Optional[str]:
    """Normalise the status input: empty/None -> None (clear); else validate the enum."""
    if raw is not None and not isinstance(raw, str):
        raise ValidationError("status must be a string or null")
    status = (raw or "").strip() or None
    if status is not None and status not in _VALID_CELL_STATUS:
        raise ValidationError(
            f"invalid status '{status}' (expected one of {sorted(_VALID_CELL_STATUS)} or null)"
        )
    return status


def purge_contradicted_cell_statuses(conn: sqlite3.Connection) -> int:
    """Drop every « non traduit » mark that an active link now contradicts.

    The setter refuses to mark a cell that has active links (409), but the guard is
    only one-directional: an aligner run or a manual link creation can cover a cell
    that was marked earlier. Left alone, the mark is invisible while the link lives
    (the grid shows the text) and **resurrects** when the link dies — the cell would
    silently read « non traduit » and count as done (D-W5) instead of returning to
    the to-do state (revue 2026-07-13, R4).

    Aligning a cell IS the statement « this cell is translated », so it supersedes an
    earlier « non traduit »: we clear, we never refuse the link. Called by the link
    writers (the five ``aligner.align_pair_*`` and ``/align/link/create``) inside their
    own transaction — this does not commit. Returns the number of marks dropped.
    """
    cur = conn.execute(
        "DELETE FROM alignment_cell_statuses WHERE EXISTS ("
        "  SELECT 1 FROM alignment_links al"
        "  WHERE al.pivot_unit_id = alignment_cell_statuses.pivot_unit_id"
        "    AND al.target_doc_id = alignment_cell_statuses.target_doc_id"
        "    AND (al.status IS NULL OR al.status <> 'rejected'))"
    )
    return int(cur.rowcount or 0)


def set_cell_status(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Set (or clear, with ``status: null``) the per-cell status (POST /align/cell_status).

    Guards:
      - the pivot must be an existing ``line`` unit (the matrix only projects lines);
      - the target doc must be a translation/excerpt of the pivot's document
        (same relation the matrix projection joins on);
      - marking refuses a cell that still has active (non-rejected) links —
        « non traduit » on a translated cell is contradictory; un-align first
        (↺ cellule) so the projection never has to arbitrate token vs text.

    Raises ValidationError / NotFoundError / ConflictError.
    """
    ids = validate(body, _SET_SCHEMA)
    pivot_unit_id = ids["pivot_unit_id"]
    target_doc_id = ids["target_doc_id"]
    status = _norm_status(body.get("status"))

    pivot = conn.execute(
        "SELECT doc_id, unit_type FROM units WHERE unit_id=?", (pivot_unit_id,)
    ).fetchone()
    if pivot is None:
        raise NotFoundError(f"pivot_unit_id={pivot_unit_id} not found")
    pivot_doc_id = int(pivot[0])
    if pivot[1] != "line":
        raise ValidationError(
            f"pivot_unit_id={pivot_unit_id} is a '{pivot[1]}' unit — only 'line' units appear in the matrix"
        )

    if conn.execute(
        "SELECT 1 FROM documents WHERE doc_id=?", (target_doc_id,)
    ).fetchone() is None:
        raise NotFoundError(f"target_doc_id={target_doc_id} not found")
    relation = conn.execute(
        "SELECT 1 FROM doc_relations WHERE doc_id=? AND target_doc_id=?"
        " AND relation_type IN ('translation_of', 'excerpt_of')",
        (target_doc_id, pivot_doc_id),
    ).fetchone()
    if relation is None:
        raise ValidationError(
            f"target_doc_id={target_doc_id} is not a translation of the pivot's document"
            f" (doc_id={pivot_doc_id})"
        )

    if status is None:
        conn.execute(
            "DELETE FROM alignment_cell_statuses WHERE pivot_unit_id=? AND target_doc_id=?",
            (pivot_unit_id, target_doc_id),
        )
    else:
        active_links = conn.execute(
            "SELECT COUNT(*) FROM alignment_links"
            " WHERE pivot_unit_id=? AND target_doc_id=?"
            "   AND (status IS NULL OR status <> 'rejected')",
            (pivot_unit_id, target_doc_id),
        ).fetchone()[0]
        if active_links:
            raise ConflictError(
                f"cell has {active_links} active link(s) — un-align it (↺) before marking non_traduit"
            )
        conn.execute(
            "INSERT INTO alignment_cell_statuses (pivot_unit_id, target_doc_id, status, created_at)"
            " VALUES (?, ?, ?, datetime('now'))"
            " ON CONFLICT(pivot_unit_id, target_doc_id) DO UPDATE SET status=excluded.status",
            (pivot_unit_id, target_doc_id, status),
        )
    conn.commit()
    # "cell_status", not "status": success_payload() merges data into the envelope,
    # whose own "status" is the transport state ("ok") — same reason set_unit_status
    # answers with "unit_status".
    return {
        "pivot_unit_id": pivot_unit_id,
        "target_doc_id": target_doc_id,
        "cell_status": status,
    }
