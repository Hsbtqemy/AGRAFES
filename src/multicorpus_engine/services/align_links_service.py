"""Alignment-links domain service — source-anchored "couper" (A-01 / R3.3).

The ``couper`` gesture (docs/DESIGN_source_anchored_alignment.md §7-D9) records a
character sub-span of a link's *target* unit so a translation sentence can be sliced
to match the source's segmentation **without mutating the translation document**
(Ontology 1, non-destructive — unlike ``/units/split`` which renumbers + drops
alignment + reindexes FTS). The span lives on ``alignment_links`` as
``target_char_start`` / ``target_char_end`` (migration 027); NULL/NULL = the whole
target unit.

Pure w.r.t. transport: takes a ``sqlite3.Connection``, raises ``ServiceError``
subclasses, and does **not** commit — the batch adapter owns the write-lock and the
single commit, exactly like the inline ``set_status`` / ``delete`` actions it sits
beside.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from .errors import ConflictError, NotFoundError, ValidationError


def _coerce_offset(name: str, value: Any) -> int:
    """A char offset must be a real int (JSON ``true`` is an int in Python — reject it)."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{name} must be an integer")
    return value


def set_target_span(
    conn: sqlite3.Connection, link_id: int, char_start: Any, char_end: Any
) -> None:
    """Set the target sub-span ``text_raw[char_start:char_end]`` on ``link_id``.

    Offsets index the target unit's verbatim ``text_raw`` (immutable → stable). The
    span must satisfy ``0 <= char_start <= char_end <= len(text_raw)``.

    Raises:
        ValidationError: malformed or out-of-range span.
        NotFoundError:   the link (or its target unit) does not exist.
    """
    cs = _coerce_offset("char_start", char_start)
    ce = _coerce_offset("char_end", char_end)
    if cs < 0 or ce < cs:
        raise ValidationError("span must satisfy 0 <= char_start <= char_end")
    row = conn.execute(
        "SELECT length(u.text_raw) FROM alignment_links al"
        " JOIN units u ON u.unit_id = al.target_unit_id WHERE al.link_id = ?",
        (link_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"link_id={link_id} not found")
    target_len = int(row[0] or 0)
    if ce > target_len:
        raise ValidationError(
            f"char_end={ce} exceeds target text length {target_len}"
        )
    conn.execute(
        "UPDATE alignment_links SET target_char_start=?, target_char_end=? WHERE link_id=?",
        (cs, ce, link_id),
    )


def clear_target_span(conn: sqlite3.Connection, link_id: int) -> None:
    """Reset ``link_id`` to the whole target unit (both offsets NULL).

    Raises:
        NotFoundError: the link does not exist.
    """
    cur = conn.execute(
        "UPDATE alignment_links SET target_char_start=NULL, target_char_end=NULL"
        " WHERE link_id=?",
        (link_id,),
    )
    if cur.rowcount == 0:
        raise NotFoundError(f"link_id={link_id} not found")


def cell_bead_uid(pivot_unit_id: int, target_doc_id: int) -> str:
    """The bead identity of a hand-curated cell = the cell itself (D-W16).

    A matrix cell is (hub unit × target document); when it holds several links it is
    ONE bead (1 hub segment ↔ N target sentences), not a collision. Deriving the uid
    from the pair — instead of letting the client invent one — makes the grouping
    idempotent, keeps identifiers out of the wire, and can never merge two distinct
    cells. Namespaced ``cell#`` so it cannot clash with the aligner's backfilled
    ``<run_id>#<bead_id>`` (migration 026).
    """
    return f"cell#{pivot_unit_id}#{target_doc_id}"


def set_bead(conn: sqlite3.Connection, link_id: int) -> None:
    """Group ``link_id`` into its cell's bead (D-W16, socle K3 ``bead_uid``).

    The uid is derived from the link's own (pivot_unit_id, target_doc_id) — every link
    of the cell therefore lands in the same bead, so the collision detector
    (``COUNT(DISTINCT COALESCE(bead_uid, 'L'||link_id)) > 1``) reads the cell as one
    bead instead of flagging the gesture-created links as a collision.

    Raises:
        NotFoundError: the link does not exist.
    """
    row = conn.execute(
        "SELECT pivot_unit_id, target_doc_id FROM alignment_links WHERE link_id = ?",
        (link_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"link_id={link_id} not found")
    conn.execute(
        "UPDATE alignment_links SET bead_uid = ? WHERE link_id = ?",
        (cell_bead_uid(int(row[0]), int(row[1])), link_id),
    )


def clear_bead(conn: sqlite3.Connection, link_id: int) -> None:
    """Ungroup ``link_id`` (bead_uid NULL → its own singleton bead again).

    Raises:
        NotFoundError: the link does not exist.
    """
    cur = conn.execute(
        "UPDATE alignment_links SET bead_uid = NULL WHERE link_id = ?", (link_id,)
    )
    if cur.rowcount == 0:
        raise NotFoundError(f"link_id={link_id} not found")


def set_pivot(
    conn: sqlite3.Connection, link_id: int, new_pivot_unit_id: Any
) -> None:
    """Re-anchor ``link_id`` onto a different hub/pivot segment — the 5th verb.

    ``retarget`` moves a link's *target*; ``set_pivot`` moves its *pivot* (the
    hub/moyeu anchor) — the symmetric gesture the source-anchored model was missing
    (docs/DESIGN_alignment_curation_model.md §10, RA-D1). Only ``pivot_unit_id``
    changes; ``status``, ``target_unit_id`` and the cut span
    (``target_char_start``/``target_char_end``) are **preserved** (RA-D3). The
    derived ``bead_uid`` (``cell#<pivot>#<doc>``) is cleared to NULL in the SAME
    UPDATE (RA-D2) — the old cell's bead no longer owns this link, so it becomes a
    singleton on its new row (regroup with ``set_bead`` if wanted).

    The new pivot must (a) **exist**, (b) be a ``line`` unit, and (c) belong to the
    link's own ``pivot_doc_id`` — re-anchoring stays *inside the hub document*
    (RA-D4). Re-anchoring onto a pivot that already links the same target unit is
    rejected — that would duplicate the cell entry (RA-D4).

    Raises:
        ValidationError: ``new_pivot_unit_id`` is not an int, is missing, is not a
            line unit, or belongs to a different hub document.
        NotFoundError:   the link does not exist.
        ConflictError:   an identical (new pivot, target unit) link already exists.
    """
    if isinstance(new_pivot_unit_id, bool) or not isinstance(new_pivot_unit_id, int):
        raise ValidationError("new_pivot_unit_id must be an integer")
    link = conn.execute(
        "SELECT pivot_doc_id, target_unit_id, pivot_unit_id"
        " FROM alignment_links WHERE link_id = ?",
        (link_id,),
    ).fetchone()
    if link is None:
        raise NotFoundError(f"link_id={link_id} not found")
    pivot_doc_id, target_unit_id, cur_pivot = int(link[0]), int(link[1]), int(link[2])
    if new_pivot_unit_id == cur_pivot:
        return  # no-op (RA-D4): the front never offers this, but stay idempotent.
    new_pivot = conn.execute(
        "SELECT doc_id, unit_type FROM units WHERE unit_id = ?",
        (new_pivot_unit_id,),
    ).fetchone()
    if new_pivot is None:
        raise ValidationError(f"new_pivot_unit_id={new_pivot_unit_id} not found")
    if new_pivot[1] != "line":
        raise ValidationError("new pivot must be a line unit")
    if int(new_pivot[0]) != pivot_doc_id:
        raise ValidationError("new pivot must belong to the link's hub document")
    dup = conn.execute(
        "SELECT 1 FROM alignment_links"
        " WHERE pivot_unit_id = ? AND target_unit_id = ? AND link_id <> ?",
        (new_pivot_unit_id, target_unit_id, link_id),
    ).fetchone()
    if dup is not None:
        raise ConflictError(
            f"a link from pivot {new_pivot_unit_id} to target {target_unit_id}"
            " already exists"
        )
    conn.execute(
        "UPDATE alignment_links SET pivot_unit_id = ?, bead_uid = NULL WHERE link_id = ?",
        (new_pivot_unit_id, link_id),
    )


def build_retarget_candidates(
    conn: sqlite3.Connection,
    pivot_unit_id: int,
    target_doc_id: int,
    limit: int = 10,
    window: int = 5,
) -> dict:
    """Suggest candidate target units for retargeting (« ré-ancrer ») a pivot's link.

    Priority: (1) ``external_id`` match between pivot and target → score 1.0 ;
    (2) ``external_id`` neighbours within ``window`` of the anchor (the current link's
    target ext_id, else the pivot's) → score ``1/(1+Δ)``.

    **Positional fallback** (R3.3 tranche 1, DESIGN_alignment_workspace §7 D-W3) — when
    the ``external_id`` pass yields *nothing*, which is the norm for a length/DP-aligned
    corpus that carries **no ``[N]`` markers** (the units simply have no ``external_id``),
    propose the order-``n`` neighbours around an anchor position: the current link's
    target position if a link exists, else the pivot's position mapped proportionally onto
    the target doc. This keeps « ré-ancrer » usable even where the aligner produced nothing
    (an orphan pivot). Read-only; raises :class:`NotFoundError` if the pivot is missing.
    """
    pivot_row = conn.execute(
        "SELECT unit_id, external_id, text_norm, doc_id, n FROM units WHERE unit_id = ?",
        (pivot_unit_id,),
    ).fetchone()
    if pivot_row is None:
        raise NotFoundError(f"pivot_unit_id={pivot_unit_id} not found")
    pivot_ext_id = pivot_row[1]

    current_link = conn.execute(
        "SELECT al.target_unit_id, u.external_id"
        " FROM alignment_links al JOIN units u ON u.unit_id = al.target_unit_id"
        " WHERE al.pivot_unit_id = ? AND al.target_doc_id = ? LIMIT 1",
        (pivot_unit_id, target_doc_id),
    ).fetchone()
    anchor_ext_id = current_link[1] if current_link else pivot_ext_id

    # Reading order (position n); the ext_id pass is order-independent (re-sorted below).
    target_units = conn.execute(
        "SELECT unit_id, external_id, text_norm FROM units"
        " WHERE doc_id = ? ORDER BY COALESCE(n, unit_id)",
        (target_doc_id,),
    ).fetchall()

    candidates: list[dict] = []
    for u_uid, u_ext, u_text in target_units:
        score: float | None = None
        reason = ""
        if u_ext is not None and pivot_ext_id is not None and u_ext == pivot_ext_id:
            score, reason = 1.0, "external_id_match"
        elif anchor_ext_id is not None and u_ext is not None:
            dist = abs(u_ext - anchor_ext_id)
            if dist <= window:
                score, reason = round(1.0 / (1 + dist), 4), f"neighbor (Δ{dist})"
        if score is not None:
            candidates.append({
                "target_unit_id": u_uid, "external_id": u_ext,
                "target_text": u_text or "", "score": score, "reason": reason,
            })

    # Positional fallback — only when external_id anchoring found nothing.
    if not candidates and target_units:
        target_ids = [u[0] for u in target_units]
        anchor_ord: int | None = None
        if current_link is not None:
            try:
                anchor_ord = target_ids.index(current_link[0])
            except ValueError:
                anchor_ord = None
        if anchor_ord is None:
            # No current link (orphan pivot) → map the pivot's position proportionally.
            pivot_doc_id, pivot_n = pivot_row[3], pivot_row[4]
            pivot_ord = conn.execute(
                "SELECT COUNT(*) FROM units WHERE doc_id=? AND n < ?",
                (pivot_doc_id, pivot_n),
            ).fetchone()[0]
            pivot_cnt = conn.execute(
                "SELECT COUNT(*) FROM units WHERE doc_id=?", (pivot_doc_id,)
            ).fetchone()[0]
            n_targets = len(target_units)
            anchor_ord = (
                round(pivot_ord / (pivot_cnt - 1) * (n_targets - 1))
                if pivot_cnt > 1 and n_targets > 1 else 0
            )
        for i, (u_uid, u_ext, u_text) in enumerate(target_units):
            d = abs(i - anchor_ord)
            if d <= window:
                candidates.append({
                    "target_unit_id": u_uid, "external_id": u_ext,
                    "target_text": u_text or "", "score": round(1.0 / (1 + d), 4),
                    "reason": f"position (Δ{d})",
                })

    candidates.sort(key=lambda c: (-c["score"], c["target_unit_id"]))
    candidates = candidates[:limit]

    return {
        "pivot": {
            "unit_id": pivot_unit_id, "external_id": pivot_ext_id,
            "text": pivot_row[2] or "",
        },
        "candidates": candidates,
    }
