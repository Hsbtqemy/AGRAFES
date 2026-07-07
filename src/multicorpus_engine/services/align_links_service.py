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
