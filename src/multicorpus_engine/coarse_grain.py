"""R2.2 (refonte deux-grains) — derive the coarse grain from pluggable indices.

**Voie A** (ROADMAP_REFONTE §R2, tranché 2026-07): the coarse grain *is*
``meta_json.parent_n`` — the paragraph anchor that ``resegment_document`` persists
on every sentence (R2.1, [segmenter.py]). This module *derives / repairs* that
grouping for documents where fine resegmentation never ran, so the canvas (R2.3)
and the bounded aligner (R3) can always group by a **single coarse key**, whatever
the import shape. Output stays strictly **2-grain** (paragraph ⊃ sentence).

Design point resolved before coding (see ROADMAP §R2.2): the only in-DB signal that
*groups* sub-units into a paragraph is ``parent_n``. Intertitres and
``unit_type='structure'`` units delimit **sections**, not paragraphs — treating them
as coarse borders would fold several ¶ into one block (a hidden 3rd grain). So they
are *classified* (heading blocks), never used to merge content lines. ``¤`` (ADR-002)
is an **intra-paragraph** separator: a line carrying it is one *composite* coarse
block whose fine cardinality is already known (``sep_count + 1``) without
resegmentation. Reconstructing ¶ boundaries for one-sentence-per-line imports (TEI
``<s>``) needs re-reading ``source_path`` — the costly last-resort index — and lives
in the importer layer, **not here** (deliberately deferred).

Pure: :func:`derive_coarse_blocks` takes plain unit dicts (no DB, no IO).
:func:`coarse_blocks_for_doc` is the thin ``conn`` round-trip for callers.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Iterable

from .unicode_policy import count_sep

# Roles that mark a *heading* line (its own coarse block), as opposed to péritext
# content roles (T/Ch/…) which are not structural. Kept minimal + explicit; a caller
# may pass its own set. ``unit_type='structure'`` units are always headings.
STRUCTURAL_ROLES: frozenset[str] = frozenset({"intertitre"})


def _parse_meta(meta_json: Any) -> dict:
    """Best-effort parse of a unit's ``meta_json`` column into a dict (never raises)."""
    if not meta_json:
        return {}
    if isinstance(meta_json, dict):
        return meta_json
    try:
        parsed = json.loads(meta_json)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def derive_coarse_blocks(
    units: Iterable[dict[str, Any]],
    *,
    structural_roles: frozenset[str] = STRUCTURAL_ROLES,
) -> list[dict[str, Any]]:
    """Group a document's units into ordered coarse-grain blocks (paragraphs).

    ``units`` are dicts with keys ``n`` (int), ``unit_type`` ('line'|'structure'),
    ``unit_role`` (str|None), ``meta_json`` (str|dict|None), ``text_raw`` (str|None).
    Order is normalised by ``n`` — callers need not pre-sort.

    Returns blocks in reading order, each::

        {"anchor_n": int,          # coarse key (parent_n if segmented, else the line's n)
         "member_ns": [int, ...],   # unit_type='line' ns in this block, in order
         "fine_count": int,         # fine units this block resolves to (sentences / ¤ pieces / 1)
         "kind": str,               # 'sentence-grouped' | 'composite' | 'line' | 'heading'
         "role": str | None}        # structural role if the block is a heading

    Two regimes:

    * **anchored** — at least one line carries ``meta_json.parent_n``: the document is
      fine-segmented, so blocks are ``groupby(parent_n)`` (a line without ``parent_n``
      falls back to its own ``n`` as a singleton). This is the reliable path.
    * **derived** — no ``parent_n`` anywhere: one line is one coarse block. Heading
      lines/structure units become ``kind='heading'``; a line with ``¤`` becomes
      ``kind='composite'`` with ``fine_count = sep_count + 1``.
    """
    rows = sorted(units, key=lambda u: u["n"])
    lines = [u for u in rows if u.get("unit_type") == "line"]
    anchored = any("parent_n" in _parse_meta(u.get("meta_json")) for u in lines)

    if anchored:
        return _blocks_anchored(rows, structural_roles)
    return _blocks_derived(rows, structural_roles)


def _blocks_anchored(
    rows: list[dict[str, Any]], structural_roles: frozenset[str]
) -> list[dict[str, Any]]:
    """Fine-segmented doc: group line units by ``parent_n`` (fallback: own ``n``)."""
    blocks: dict[int, dict[str, Any]] = {}
    order: list[int] = []
    for u in rows:
        if u.get("unit_type") != "line":
            continue  # structure units carry no fine content in the anchored regime
        meta = _parse_meta(u.get("meta_json"))
        anchor = meta.get("parent_n", u["n"])
        block = blocks.get(anchor)
        if block is None:
            role = u.get("unit_role")
            block = {
                "anchor_n": anchor,
                "member_ns": [],
                "fine_count": 0,
                "kind": "heading" if role in structural_roles else "sentence-grouped",
                "role": role if role in structural_roles else None,
            }
            blocks[anchor] = block
            order.append(anchor)
        block["member_ns"].append(u["n"])
        block["fine_count"] += 1
    # A "grouped" block that turned out to hold a single line is just a plain line.
    for block in blocks.values():
        if block["kind"] == "sentence-grouped" and block["fine_count"] == 1:
            block["kind"] = "line"
    return [blocks[a] for a in order]


def _blocks_derived(
    rows: list[dict[str, Any]], structural_roles: frozenset[str]
) -> list[dict[str, Any]]:
    """Not fine-segmented: one line is one coarse block; classify headings + ¤."""
    blocks: list[dict[str, Any]] = []
    for u in rows:
        n = u["n"]
        role = u.get("unit_role")
        if u.get("unit_type") == "structure":
            blocks.append({
                "anchor_n": n, "member_ns": [], "fine_count": 1,
                "kind": "heading", "role": role,
            })
            continue
        if role in structural_roles:
            blocks.append({
                "anchor_n": n, "member_ns": [n], "fine_count": 1,
                "kind": "heading", "role": role,
            })
            continue
        seps = count_sep(u.get("text_raw") or "")
        blocks.append({
            "anchor_n": n,
            "member_ns": [n],
            "fine_count": seps + 1,
            "kind": "composite" if seps > 0 else "line",
            "role": None,
        })
    return blocks


def coarse_blocks_for_doc(
    conn: sqlite3.Connection, doc_id: int
) -> list[dict[str, Any]]:
    """Fetch a document's units and derive its coarse blocks (thin ``conn`` wrapper).

    Read-only. Reuses the existing schema — no migration, no new endpoint (the
    derivation is exposed on demand by whichever route needs it; today none).
    """
    rows = conn.execute(
        "SELECT n, unit_type, unit_role, meta_json, text_raw FROM units"
        " WHERE doc_id = ? ORDER BY n",
        (doc_id,),
    ).fetchall()
    units = [
        {
            "n": r["n"], "unit_type": r["unit_type"], "unit_role": r["unit_role"],
            "meta_json": r["meta_json"], "text_raw": r["text_raw"],
        }
        for r in rows
    ]
    return derive_coarse_blocks(units)
