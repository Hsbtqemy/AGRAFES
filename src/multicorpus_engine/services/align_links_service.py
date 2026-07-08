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

from .errors import NotFoundError, ValidationError


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
