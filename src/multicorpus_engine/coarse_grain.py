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


def is_anchored_regime(units: Iterable[dict[str, Any]]) -> bool:
    """True iff the two-grain **anchored** regime applies to ``units``: at least one
    *line* unit carries a **non-null** ``meta_json.parent_n``.

    FE-02: value-based (not key-presence), mirroring ``coarseGrain.ts`` — an explicit
    ``{"parent_n": null}`` is *not* anchored (the TS side, saner, makes it a derived
    singleton; key-presence would fold every such line into one None-keyed mega-block).
    Single source of truth for the anchored predicate, shared by
    :func:`derive_coarse_blocks` (grouping) and :func:`multicorpus_engine.anchoring.anchor_status`
    (the ¶ anchor of the upstream anchoring check, DESIGN_upstream_anchoring §2/§4).
    """
    return any(
        _parse_meta(u.get("meta_json")).get("parent_n") is not None
        for u in units
        if u.get("unit_type") == "line"
    )


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
    # FE-02: the anchored regime is a *non-null* parent_n on any line (value-based, mirroring
    # coarseGrain.ts) — extracted to is_anchored_regime so the upstream anchoring check reuses
    # the exact same predicate. Keep the two implementations byte-for-byte equivalent.
    if is_anchored_regime(rows):
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


# --- R6: manual paragraph boundaries (per-unit toggle) ----------------------
#
# The ascendant regroup above is *pattern-driven* (Tours). This is its manual
# sibling: the user designates one segment as a paragraph start (or removes an
# existing one) in the matrix / Tours canvas, and the coarse grain updates a
# block at a time. Same non-destructive contract (only parent_n moves), same
# 2-grain output. The gesture is a **toggle** with a deliberate asymmetry so a
# single click does the whole job ("désigner le début du suivant" → regroupe le
# run précédent ET absorbe la queue). See DESIGN_prep_text_canvas §R6.


def toggle_paragraph_boundary(
    units: Iterable[dict[str, Any]], target_n: int
) -> dict[int, int]:
    """Toggle the paragraph boundary at ``target_n`` (manual coarse grouping, R6).

    ``units`` are the document's units in **text scope** (paratext ``n < text_start_n``
    already excluded by the caller), each a dict with ``n`` (int), ``parent_n``
    (int|None — the current coarse anchor) and ``divider`` (bool — a section wall:
    ``unit_type='structure'`` or an intertitre-role line). Order is normalised by ``n``.

    A *paragraph boundary* is the start of a **multi-segment** block or a section wall;
    a lone (singleton) segment is **not** one. That single rule makes the toggle
    unambiguous even from the all-singletons baseline:

    * ``target_n`` currently **heads a multi-segment block** → REMOVE it: its block folds
      into the preceding paragraph of the same section (merge upward).
    * otherwise → DESIGNATE it: the run ``[P, target)`` — back to the previous real
      boundary or the section start — becomes one paragraph anchored at ``P``, and
      ``[target, Q)`` — up to the next real boundary or the section end — becomes one
      paragraph anchored at ``target``. So one click regroups the preceding segments
      *and* absorbs the tail; designating a segment *inside* an existing block splits it.

    Pure — the caller persists ``parent_n``. Returns ``{n: parent_n}`` for **every**
    non-divider line unit (its anchor after the toggle); the caller diffs against the
    stored value and writes only what changed (idempotent). Dividers are never
    reassigned. A no-op (``target_n`` is a divider, is unknown, or is the section's
    opening boundary being removed) returns the *current* assignment unchanged.

    Known v1 limit: because "boundary" requires ``size > 1``, a legitimate one-segment
    paragraph reads as an ungrouped singleton, so re-toggling it re-designates instead
    of removing. It still *displays* as its own paragraph — only the toggle direction
    is affected. Acceptable until a distinct marker is warranted.
    """
    rows = sorted(units, key=lambda u: u["n"])
    n_list = [u["n"] for u in rows]
    is_div = {u["n"]: bool(u.get("divider")) for u in rows}
    # Current effective anchor: parent_n when set, else the unit's own n.
    anchor: dict[int, int] = {}
    for u in rows:
        pn = u.get("parent_n")
        anchor[u["n"]] = pn if pn is not None else u["n"]
    # Block size per anchor (non-divider units only).
    size: dict[int, int] = {}
    for u in rows:
        if not is_div[u["n"]]:
            a = anchor[u["n"]]
            size[a] = size.get(a, 0) + 1

    def current() -> dict[int, int]:
        return {u["n"]: anchor[u["n"]] for u in rows if not is_div[u["n"]]}

    if target_n not in anchor or is_div.get(target_n):
        return current()  # no-op: unknown n or a section wall

    idx = n_list.index(target_n)
    # Section bounds = nearest dividers on each side (exclusive). The region
    # (left_wall, right_wall) is divider-free by construction.
    left_wall = -1
    for j in range(idx - 1, -1, -1):
        if is_div[n_list[j]]:
            left_wall = j
            break
    right_wall = len(rows)
    for k in range(idx + 1, len(rows)):
        if is_div[n_list[k]]:
            right_wall = k
            break

    def is_real_boundary(j: int) -> bool:
        n = n_list[j]
        return (not is_div[n]) and anchor[n] == n and size.get(n, 0) > 1

    result = current()
    target_is_boundary = anchor[target_n] == target_n and size.get(target_n, 0) > 1

    if target_is_boundary:
        # REMOVE — fold target's block into the preceding paragraph of the section.
        if idx - 1 <= left_wall:
            return result  # target opens the section — nothing before to merge into
        prev_anchor = anchor[n_list[idx - 1]]
        for u in rows:
            n = u["n"]
            if not is_div[n] and anchor[n] == target_n:
                result[n] = prev_anchor
        return result

    # DESIGNATE — [P, target) → P ; [target, Q) → target.
    # P = last real boundary before target in the section, else the section start.
    p_index = left_wall + 1
    for j in range(idx - 1, left_wall, -1):
        if is_real_boundary(j):
            p_index = j
            break
    p_anchor = n_list[p_index]
    # Q = next real boundary after target in the section, else the section end.
    q_index = right_wall
    for k in range(idx + 1, right_wall):
        if is_real_boundary(k):
            q_index = k
            break
    for j in range(p_index, idx):
        n = n_list[j]
        if not is_div[n]:
            result[n] = p_anchor
    for j in range(idx, q_index):
        n = n_list[j]
        if not is_div[n]:
            result[n] = target_n
    return result


def set_paragraph_boundary_document(
    conn: sqlite3.Connection,
    doc_id: int,
    unit_id: int,
    *,
    record_action: Any = None,
) -> dict[str, Any]:
    """Persist a manual paragraph-boundary toggle at ``(doc_id, unit_id)`` (R6).

    ``unit_id`` (not the position-based ``n``) identifies the target segment — both front
    surfaces (matrix ``hubUnitId``, canvas unit list) carry it, and it is unambiguous even
    when paratext exclusion makes position ≠ ``n``.

    Non-destructive: only ``meta_json.parent_n`` is rewritten, on line units in **text
    scope** (``n >= documents.text_start_n``); paratext, fine text, ``alignment_links``
    and FTS are untouched. Idempotent per unit (a line already carrying the target
    ``parent_n`` is skipped). Structure / intertitre units act as section walls and are
    never reassigned.

    Mode A undo: if ``record_action`` is given it is called *before* the writes with
    ``(doc_id, [{unit_id, meta_json_before}, ...])`` for the units about to change, and
    may return an ``action_id`` (or ``None`` when there is nothing to record). Raises
    ``ValueError`` (→ 400) if ``unit_id`` is not a line segment of this doc in text scope.
    """
    row = conn.execute(
        "SELECT text_start_n FROM documents WHERE doc_id = ?", (doc_id,)
    ).fetchone()
    text_start_n = (row["text_start_n"] if row is not None else None) or 0

    urows = conn.execute(
        "SELECT unit_id, n, unit_type, unit_role, meta_json FROM units"
        " WHERE doc_id = ? AND n >= ? ORDER BY n",
        (doc_id, text_start_n),
    ).fetchall()

    units: list[dict[str, Any]] = []
    by_n: dict[int, sqlite3.Row] = {}
    target: sqlite3.Row | None = None
    for r in urows:
        is_line = r["unit_type"] == "line"
        divider = (not is_line) or (r["unit_role"] in STRUCTURAL_ROLES)
        pn = _parse_meta(r["meta_json"]).get("parent_n") if is_line else None
        units.append({"n": r["n"], "parent_n": pn, "divider": divider})
        by_n[r["n"]] = r
        if r["unit_id"] == unit_id:
            target = r

    # Reject a target that is not an editable text segment — paratext, a structure unit, an
    # intertitre-role heading (all section walls), or a foreign doc — rather than silently
    # no-op, so the UI never claims a phantom change on a segment it should not offer.
    if target is None or target["unit_type"] != "line" or target["unit_role"] in STRUCTURAL_ROLES:
        raise ValueError(
            f"unit_id={unit_id} is not an editable text segment "
            f"(paratext or section heading) for doc_id={doc_id}"
        )
    unit_n = target["n"]

    assignments = toggle_paragraph_boundary(units, unit_n)

    # Diff by EFFECTIVE anchor (a null parent_n and an explicit parent_n == n both mean "this
    # segment is its own paragraph"): only a unit whose effective anchor genuinely moves is
    # written. This keeps a toggle's write set — and its undo snapshot — to the segments it
    # actually regroups, instead of also flipping every still-ungrouped singleton elsewhere in
    # the doc from null → own-n (an equivalent no-op that would only bloat the snapshot). A
    # block start therefore keeps its null (own n = anchor); every reader normalises null↔own-n.
    changes: list[tuple[sqlite3.Row, int, Any]] = []  # (row, new_parent_n, meta_before)
    for n, new_pn in assignments.items():
        r = by_n[n]
        stored_pn = _parse_meta(r["meta_json"]).get("parent_n")
        stored_anchor = stored_pn if stored_pn is not None else n
        if stored_anchor == new_pn:
            continue  # effective paragraph anchor unchanged
        changes.append((r, new_pn, r["meta_json"]))

    action_id: int | None = None
    if changes and record_action is not None:
        action_id = record_action(
            doc_id,
            [
                {"unit_id": int(r["unit_id"]), "meta_json_before": meta_before}
                for (r, _pn, meta_before) in changes
            ],
        )

    for r, new_pn, _meta_before in changes:
        meta = _parse_meta(r["meta_json"])
        meta["parent_n"] = new_pn
        conn.execute(
            "UPDATE units SET meta_json = ? WHERE unit_id = ?",
            (json.dumps(meta), int(r["unit_id"])),
        )
    conn.commit()

    return {
        "doc_id": doc_id,
        "unit_id": unit_id,
        "unit_n": unit_n,
        "units_changed": len(changes),
        "blocks": len(set(assignments.values())),
        "action_id": action_id,
    }
