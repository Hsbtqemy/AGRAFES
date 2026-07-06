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
import re
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
    # FE-02: detect the anchored regime by a *non-null* parent_n (value-based), mirroring
    # coarseGrain.ts. Key-presence would treat an explicit {"parent_n": null} as anchored
    # and fold every such line into one None-keyed mega-block — the TS side (saner) makes
    # it a derived singleton. Keep the two implementations byte-for-byte equivalent.
    anchored = any(_parse_meta(u.get("meta_json")).get("parent_n") is not None for u in lines)

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
        # FE-02: a null (or absent) parent_n falls back to the line's own n — value-based,
        # matching coarseGrain.ts. ALN-04 (documented limit): that fallback n shares the
        # domain of parent_n values, so a unit *inserted after* resegmentation (no meta)
        # could land in another paragraph's block by n-collision. Not reachable today
        # (fine-segmentation stamps parent_n on every line); revisit if a post-resegment
        # insert path is added.
        pn = meta.get("parent_n")
        anchor = pn if pn is not None else u["n"]
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


# --- R5.4c: ascendant coarse regrouping (non-destructive) -------------------
#
# The *ascendant* path (DESIGN_prep_text_canvas §147 "regrouper des phrases déjà
# là"): set the coarse grain by relabelling parent_n on the *existing* fine units,
# grouping consecutive lines under a boundary they carry in their own text — no
# resegmentation, so the fine units, alignment_links and FTS are all untouched
# (parent_n does not affect text_norm). This sidesteps the "line structure destroyed
# at import" limit that blocks the *descendant* pattern kind (that stays R5.4c/A).

# Cap custom pattern length to bound catastrophic-backtracking risk on the (locked)
# sidecar, mirroring the curation/query regex guard (audit QRY-06, _MAX_REGEX_LEN=500).
_MAX_PATTERN_LEN = 500

# Built-in coarse boundary presets. "tours" = a dialogue turn opens with an em/en
# dash — a robust in-DB cue (the dash survives normalize(), unlike blank-line ¶).
# Speaker labels ("NOM :") are too false-positive-prone to hardcode (e.g. "Note :")
# → supply a custom pattern for those.
_COARSE_PRESETS: dict[str, str] = {
    "tours": r"^\s*[—–]",
}


def resolve_coarse_boundary(
    preset: str | None = None, pattern: str | None = None
) -> re.Pattern[str]:
    """Resolve a coarse-grain boundary regex from a built-in ``preset`` name or a custom
    ``pattern``. A non-empty ``pattern`` wins over ``preset`` (default ``tours``). Raises
    ``ValueError`` on an unknown preset or an invalid regex."""
    if pattern is not None and str(pattern).strip():
        raw = str(pattern)
        if len(raw) > _MAX_PATTERN_LEN:
            raise ValueError(
                f"Boundary pattern too long ({len(raw)} chars, max {_MAX_PATTERN_LEN})."
            )
        try:
            return re.compile(raw)
        except re.error as exc:
            raise ValueError(f"Invalid boundary pattern: {exc}") from exc
    name = (preset or "tours").strip().lower()
    if name not in _COARSE_PRESETS:
        raise ValueError(
            f"Unknown coarse preset: {name!r}. Use one of: {', '.join(sorted(_COARSE_PRESETS))}."
        )
    return re.compile(_COARSE_PRESETS[name])


def regroup_by_boundary(
    units: Iterable[dict[str, Any]], boundary: re.Pattern[str]
) -> dict[int, int]:
    """Ascendant coarse regrouping (R5.4c): assign each line unit a coarse ``parent_n``.

    A line whose ``text_norm`` matches ``boundary`` *opens* a new coarse block; every
    line's ``parent_n`` is the ``n`` of its block's first line. The very first line always
    opens a block (so anything before the first marker forms a leading block). Structure
    units are ignored. Pure — the caller persists the result. Returns ``{line_n: parent_n}``.
    """
    lines = sorted(
        (u for u in units if u.get("unit_type") == "line"), key=lambda u: u["n"]
    )
    assignments: dict[int, int] = {}
    anchor: int | None = None
    for i, u in enumerate(lines):
        text = u.get("text_norm") or ""
        if i == 0 or anchor is None or boundary.match(text):
            anchor = u["n"]
        assignments[u["n"]] = anchor
    return assignments


def regroup_document_coarse(
    conn: sqlite3.Connection,
    doc_id: int,
    *,
    preset: str | None = None,
    pattern: str | None = None,
) -> dict[str, Any]:
    """Persist an ascendant coarse regrouping onto a document's line units (R5.4c).

    Non-destructive: only ``meta_json.parent_n`` is rewritten (other meta keys are kept);
    the fine units, their text, ``alignment_links`` and FTS are all untouched (parent_n
    does not feed text_norm). Idempotent — a line already carrying the target ``parent_n``
    is skipped, so re-running with the same boundary writes nothing.

    Raises ``ValueError`` (→ 400) on a bad preset/pattern.
    """
    boundary = resolve_coarse_boundary(preset, pattern)
    rows = conn.execute(
        "SELECT n, text_norm, meta_json FROM units"
        " WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
        (doc_id,),
    ).fetchall()
    units = [{"n": r["n"], "unit_type": "line", "text_norm": r["text_norm"]} for r in rows]
    assignments = regroup_by_boundary(units, boundary)
    changed = 0
    for r in rows:
        parent_n = assignments.get(r["n"])
        if parent_n is None:
            continue
        meta = _parse_meta(r["meta_json"])
        if meta.get("parent_n") == parent_n:
            continue  # idempotent — no write when the anchor is unchanged
        meta["parent_n"] = parent_n
        conn.execute(
            "UPDATE units SET meta_json = ? WHERE doc_id = ? AND n = ?",
            (json.dumps(meta), doc_id, r["n"]),
        )
        changed += 1
    conn.commit()  # every sibling write persists explicitly (the conn is not autocommit)
    return {
        "doc_id": doc_id,
        "blocks": len(set(assignments.values())),
        "units_grouped": len(assignments),
        "units_changed": changed,
    }
