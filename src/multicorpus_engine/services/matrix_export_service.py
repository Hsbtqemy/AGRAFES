"""Aligned-matrix projection — source-anchored export (R3.3, DESIGN_source_anchored_alignment §5/§D7).

Projects the *aligned form* of a family into the multilingual matrix (the prototype
`Test-Alignement(Hugo).csv`): one row per **hub** (parent/original) segment, one column
per language, each translation cell being the text aligned to that hub segment —
source-anchored **cut slices** applied (`text_raw[cs:ce]`, code-point native in Python),
N-M **bead** targets concatenated, empty on omission. The matrix is a *projection*
(never stored, cf. D4): it is recomputed from documents + alignment_links on each call.

Rejected links are **excluded** from the projection (revue 3b F8) — coherent with the
QA report's notion of a dead link (ALN-03) and with the grid's cell→links resolution,
which must see exactly what the cell displays.

Statuses (D8/D10, D-W8/D-W14 — 2026-07-10): an omitted cell displays the
``[non traduit]`` token (never empty, D10), read from BOTH axes — the global
``units.unit_status`` on the hub unit (marker-lift: untranslated everywhere)
and the per-cell ``alignment_cell_statuses`` table (mig 028: EN omits, RO does
not). Translation units with ``unit_status='ajout'`` are woven into ``rows``
as **flux addition rows** at their reading position (D8 projection (a)) — the
CSV export writes ``rows`` verbatim, so it inherits them. Translation units
with **no active link and no status** are surfaced per column (``uncovered``,
D-W14) so the « ＋ Ajout » gesture has something to act on.

Pure w.r.t. transport: takes a ``sqlite3.Connection``, returns plain data, raises
``ServiceError`` subclasses.
"""

from __future__ import annotations

import json as _json
import sqlite3
from typing import Any, Optional

from ..anchoring import anchor_status_for_doc
from .errors import NotFoundError

#: D10 — the omission token; a deliberately untranslated cell is never empty
#: (empty is ambiguous with "not aligned yet").
NON_TRADUIT_TOKEN = "[non traduit]"
#: D8 — hub-column token of a flux addition row (translator-added content).
AJOUT_TOKEN = "[ajout]"


def _parent_n(meta_json: Optional[str]) -> Any:
    if not meta_json:
        return ""
    try:
        pn = _json.loads(meta_json).get("parent_n")
        return pn if pn is not None else ""
    except Exception:
        return ""


def _cell(links: list[dict[str, Any]]) -> str:
    """One translation cell: cut slices applied, bead targets concatenated, trimmed."""
    if not links:
        return ""
    parts: list[str] = []
    for lk in links:
        raw = lk["target_text_raw"] or ""
        cs, ce = lk["char_start"], lk["char_end"]
        # cs/ce are code-point offsets (the cut); Python str slicing is code-point native.
        parts.append(raw[cs:ce] if cs is not None and ce is not None else raw)
    return " ".join(p.strip() for p in parts if p.strip()).strip()


def build_alignment_matrix(conn: sqlite3.Connection, family_root_id: int) -> dict:
    """Project the family's aligned form into a hub-anchored multilingual matrix.

    Returns ``{"headers": [...], "rows": [[...], ...], "languages": [...],
    "hub_doc_id": int, "hub_unit_ids": [...], "language_doc_ids": [...],
    "cell_links": [...], "hub_unit_statuses": [...], "cell_statuses": [...],
    "addition_rows": [...], "uncovered": [...]}``.

    ``rows`` / ``headers`` are the flat text projection (also fed verbatim to the CSV
    export). The additive identifier fields let the grid map cells → links for the
    editable gestures without any extra round-trip:

    - ``hub_unit_ids`` (∥ ``rows``) / ``language_doc_ids`` (∥ ``languages``) — tranche 3a.
      On a flux **addition row** ``hub_unit_ids[i]`` is ``None`` (no hub unit).
    - ``cell_links`` (A2, revue 3b) — ``cell_links[i][j]`` is the list of links behind
      row ``i`` × translation column ``j`` (``languages[j+1]``), in the cell's
      concatenation order; each link is ``{"link_id", "target_unit_id", "char_start",
      "char_end", "target_text_raw"}`` (offsets null = whole unit; ``target_text_raw``
      is the verbatim string the cut offsets index). Built from the same query as the
      cells, so it can never diverge from what the cell displays.
    - ``hub_unit_statuses`` (∥ ``rows``) — the hub unit's **global** ``unit_status``
      (marker-lift axis; ``non_traduit`` ⇒ the whole row shows the token). ``None``
      on addition rows.
    - ``cell_statuses`` (∥ ``rows`` × translations) — the **per-cell** axis
      (``alignment_cell_statuses``, D-W8): ``'non_traduit'`` or ``None``.
    - ``addition_rows`` — ``[{"row", "doc_id", "unit_id", "n"}]`` descriptors of the
      flux rows woven into ``rows`` (D8): hub column = ``[ajout]``, the unit's text in
      its own language column, anchored after the last hub row displaying a covered
      target unit at or before it in reading order. Only **unlinked** ajout units are
      woven — one that carries an active link is already projected by its cell.
    - ``uncovered`` (∥ translations, D-W14) — per column, the ``line`` units with no
      active link in this family and no ``unit_status``: invisible in the grid, the
      « ＋ Ajout » panel lists them. ``[{"unit_id", "n", "text_raw"}]``.
    - ``anchor_status`` (∥ ``languages``, 1.6.59 — DESIGN_upstream_anchoring §4) — per
      language ``{"anchored": bool, "kind": "value"|"paragraph"|"position"|None,
      "line_count": int}``: whether that document carries an alignment anchor. Index 0 is
      the hub; an unanchored text (``kind=None``) makes the aligner drift, so the barre
      « Aligner » warns before running. Read-only, derived (``anchoring.anchor_status_for_doc``).

    Raises :class:`NotFoundError` when the hub doc is missing.
    """
    hub = conn.execute(
        "SELECT doc_id, language FROM documents WHERE doc_id=?", (family_root_id,)
    ).fetchone()
    if hub is None:
        raise NotFoundError(f"family_root_id={family_root_id} not found")
    hub_lang = hub[1]

    translations = [
        (int(r[0]), r[1])
        for r in conn.execute(
            "SELECT d.doc_id, d.language FROM doc_relations r"
            " JOIN documents d ON d.doc_id = r.doc_id"
            " WHERE r.target_doc_id = ? AND r.relation_type IN ('translation_of', 'excerpt_of')"
            " ORDER BY d.doc_id",
            (family_root_id,),
        ).fetchall()
    ]

    hub_units = conn.execute(
        "SELECT unit_id, text_raw, meta_json, unit_status FROM units"
        " WHERE doc_id=? AND unit_type='line' ORDER BY n",
        (family_root_id,),
    ).fetchall()

    # Per-cell « non traduit » (D-W8, mig 028): (pivot_unit_id, target_doc_id) -> status.
    cell_status_map: dict[tuple[int, int], str] = {
        (int(r[0]), int(r[1])): r[2]
        for r in conn.execute(
            "SELECT acs.pivot_unit_id, acs.target_doc_id, acs.status"
            " FROM alignment_cell_statuses acs"
            " JOIN units u ON u.unit_id = acs.pivot_unit_id WHERE u.doc_id=?",
            (family_root_id,),
        )
    }

    # Hub reading order: unit_id -> row index (anchors the flux addition rows, D8).
    hub_row_idx: dict[int, int] = {int(u[0]): i for i, u in enumerate(hub_units)}

    # Per-translation: hub_unit_id -> ordered list of link dicts (id, target, cut, raw).
    # Rejected links are dead (ALN-03) — excluded from projection AND cell_links (F8).
    links_by_t: dict[int, dict[int, list[dict[str, Any]]]] = {}
    # Per-translation: covered target position n -> LAST hub row that shows it (the
    # addition-row anchor: an ajout at n_a lands after the row of the nearest covered
    # target unit with n <= n_a).
    anchor_by_n_t: dict[int, dict[int, int]] = {}
    for tdoc, _lang in translations:
        by_hub: dict[int, list[dict[str, Any]]] = {}
        anchor_by_n: dict[int, int] = {}
        # Cell concatenation order = READING order of the target document (unit n,
        # then cut offset within the unit) — not link creation order, so a link
        # added later by a gesture (D-W12 straddle cut) still lands where it reads.
        for link_id, tuid, pivot_id, cs, ce, traw, ext_id, run_id, t_n in conn.execute(
            "SELECT al.link_id, al.target_unit_id, al.pivot_unit_id,"
            "       al.target_char_start, al.target_char_end, tu.text_raw,"
            "       al.external_id, al.run_id, tu.n"
            " FROM alignment_links al JOIN units tu ON tu.unit_id = al.target_unit_id"
            " WHERE al.pivot_doc_id=? AND al.target_doc_id=?"
            "   AND (al.status IS NULL OR al.status <> 'rejected')"
            " ORDER BY al.pivot_unit_id, tu.n, COALESCE(al.target_char_start, -1), al.link_id",
            (family_root_id, tdoc),
        ):
            by_hub.setdefault(int(pivot_id), []).append({
                "link_id": int(link_id),
                "target_unit_id": int(tuid),
                "char_start": cs,
                "char_end": ce,
                "target_text_raw": traw,
                # D-W13 : the gestures need to place (external_id inheritance) and
                # undo (manual links are deleted by the cell ↺) what they created.
                "external_id": ext_id,
                "manual": run_id == "manual",
            })
            hub_i = hub_row_idx.get(int(pivot_id))
            if hub_i is not None and t_n is not None:
                prev = anchor_by_n.get(int(t_n))
                anchor_by_n[int(t_n)] = hub_i if prev is None else max(prev, hub_i)
        links_by_t[tdoc] = by_hub
        anchor_by_n_t[tdoc] = anchor_by_n

    # Flux addition rows (D8) + uncovered units (D-W14), per translation column.
    # An ajout at position n_a anchors after the LAST hub row that displays a covered
    # target unit with n <= n_a (reading order), before the first row when none.
    additions_pending: list[tuple[int, int, int, int, int, str]] = []
    uncovered: list[list[dict[str, Any]]] = []
    for j, (tdoc, _lang) in enumerate(translations):
        anchor_by_n = anchor_by_n_t[tdoc]
        for uid_a, n_a, text_a in conn.execute(
            # An ajout is a 0-1 (D8): content with NO hub source. A unit that carries
            # an active link in this family is projected by its cell — weaving it as a
            # flux row too would print the same sentence twice (grid AND CSV export).
            # Same NOT EXISTS as the `uncovered` query below (revue 2026-07-13, R2).
            "SELECT u.unit_id, u.n, u.text_raw FROM units u"
            " WHERE u.doc_id=? AND u.unit_type='line' AND u.unit_status='ajout'"
            "   AND NOT EXISTS (SELECT 1 FROM alignment_links al"
            "                   WHERE al.target_unit_id = u.unit_id"
            "                     AND al.pivot_doc_id = ?"
            "                     AND (al.status IS NULL OR al.status <> 'rejected'))"
            " ORDER BY u.n",
            (tdoc, family_root_id),
        ):
            # Anchor on the last ROW showing a covered unit at or before n_a — not on
            # the row of the largest such n: a re-anchored (⇲) target makes the two
            # differ, and only the row order is the matrix's reading order (R5).
            prev_rows = [row for n, row in anchor_by_n.items() if n_a is None or n <= n_a]
            anchor_row = max(prev_rows) if prev_rows else -1
            additions_pending.append(
                (anchor_row, j, int(n_a or 0), int(uid_a), tdoc, (text_a or "").strip())
            )
        # Uncovered = no active link in THIS family and no status: invisible in the
        # grid (nothing projects it), so the « ＋ Ajout » panel must list it.
        uncovered.append([
            {"unit_id": int(r[0]), "n": r[1], "text_raw": r[2] or ""}
            for r in conn.execute(
                "SELECT u.unit_id, u.n, u.text_raw FROM units u"
                " WHERE u.doc_id=? AND u.unit_type='line' AND u.unit_status IS NULL"
                "   AND NOT EXISTS (SELECT 1 FROM alignment_links al"
                "                   WHERE al.target_unit_id = u.unit_id"
                "                     AND al.pivot_doc_id = ?"
                "                     AND (al.status IS NULL OR al.status <> 'rejected'))"
                " ORDER BY u.n",
                (tdoc, family_root_id),
            )
        ])
    additions_by_anchor: dict[int, list[tuple[int, int, int, int, int, str]]] = {}
    for add in sorted(additions_pending, key=lambda a: (a[1], a[2])):
        additions_by_anchor.setdefault(add[0], []).append(add)

    headers = ["paragraphe", "segment", hub_lang, *[lang for _t, lang in translations]]
    n_trans = len(translations)
    rows: list[list[Any]] = []
    cell_links: list[list[list[dict[str, Any]]]] = []
    hub_unit_ids: list[Any] = []
    hub_unit_statuses: list[Any] = []
    cell_statuses: list[list[Any]] = []
    addition_rows: list[dict[str, Any]] = []

    def _append_addition(add: tuple[int, int, int, int, int, str]) -> None:
        _anchor, j, n_a, uid_a, tdoc_a, text_a = add
        row: list[Any] = ["", "", AJOUT_TOKEN, *[""] * n_trans]
        row[3 + j] = text_a
        rows.append(row)
        cell_links.append([[] for _ in range(n_trans)])
        hub_unit_ids.append(None)
        hub_unit_statuses.append(None)
        cell_statuses.append([None] * n_trans)
        addition_rows.append(
            {"row": len(rows) - 1, "doc_id": tdoc_a, "unit_id": uid_a, "n": n_a}
        )

    for add in additions_by_anchor.get(-1, []):
        _append_addition(add)
    for i, (uid, text_raw, meta_json, hub_status) in enumerate(hub_units):
        row = [_parent_n(meta_json), i + 1, (text_raw or "").strip()]
        row_links: list[list[dict[str, Any]]] = []
        row_statuses: list[Any] = []
        for tdoc, _lang in translations:
            links = links_by_t[tdoc].get(int(uid), [])
            # A mark contradicted by active links is not reported: link writers purge
            # such marks (R4), so this only shields the projection from a legacy row
            # (or a third-party writer) — rows and cell_statuses can never disagree.
            per_cell = None if links else cell_status_map.get((int(uid), tdoc))
            row_statuses.append(per_cell)
            if links:
                # Real text always wins over a contradictory status (the hub-global
                # axis can legitimately carry one: untranslated in DE, not in EN).
                row.append(_cell(links))
            elif per_cell == "non_traduit" or hub_status == "non_traduit":
                row.append(NON_TRADUIT_TOKEN)
            else:
                row.append("")
            row_links.append(links)
        rows.append(row)
        cell_links.append(row_links)
        hub_unit_ids.append(int(uid))
        hub_unit_statuses.append(hub_status)
        cell_statuses.append(row_statuses)
        for add in additions_by_anchor.get(i, []):
            _append_addition(add)

    # Every link of the family, REJECTED ONES INCLUDED (1.6.58). The projection excludes
    # them (F8) — but the aligner does not: its INSERT OR IGNORE dedupes on the unique
    # (pivot_unit_id, target_unit_id) index, which a rejected row still occupies. So a
    # family whose links were all rejected would re-align to NOTHING, and a « links > 0 »
    # test based on the projection would miss it (revue tranche 5). This is the count the
    # « Aligner » bar must gate its re-run confirm on.
    link_count = conn.execute(
        "SELECT COUNT(*) FROM alignment_links WHERE pivot_doc_id=?", (family_root_id,)
    ).fetchone()[0]

    # Upstream anchoring (1.6.59, DESIGN_upstream_anchoring §4) — per-language anchor status,
    # PARALLEL to `languages` (index 0 = hub). The barre « Aligner » warns before firing a run
    # that would drift because a text carries no anchor (Beigbeder EN). Read-only, derived on
    # the fly (like coarse_blocks_for_doc); the field is additive to this non-schematized payload.
    anchor_status = [
        anchor_status_for_doc(conn, family_root_id),
        *[anchor_status_for_doc(conn, tdoc) for tdoc, _lang in translations],
    ]

    return {
        "headers": headers,
        "rows": rows,
        "languages": [hub_lang, *[lang for _t, lang in translations]],
        "hub_doc_id": int(family_root_id),
        "link_count": int(link_count or 0),
        # Tranche 3a — identifiers for editable grid gestures. Parallel arrays:
        # hub_unit_ids[i] is the hub unit behind rows[i] (None on an addition row);
        # language_doc_ids[j] is the doc_id behind languages[j] (0 = hub).
        "hub_unit_ids": hub_unit_ids,
        "language_doc_ids": [int(family_root_id), *[tdoc for tdoc, _lang in translations]],
        # A2 (revue 3b) — cell_links[i][j]: links behind rows[i] × translation j.
        "cell_links": cell_links,
        # D-W8/D8/D-W14 (2026-07-10) — status axes + flux additions + orphans.
        "hub_unit_statuses": hub_unit_statuses,
        "cell_statuses": cell_statuses,
        "addition_rows": addition_rows,
        "uncovered": uncovered,
        # 1.6.59 — {anchored, kind: value|paragraph|position|null, line_count} ∥ languages.
        "anchor_status": anchor_status,
    }
