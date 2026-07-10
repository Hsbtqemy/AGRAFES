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

Pure w.r.t. transport: takes a ``sqlite3.Connection``, returns plain data, raises
``ServiceError`` subclasses. v1 scope — defers additions (translation text with no hub
source) and the ``[non traduit]`` omission token (empty cell for now).
"""

from __future__ import annotations

import json as _json
import sqlite3
from typing import Any, Optional

from .errors import NotFoundError


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
    "cell_links": [...]}``.

    ``rows`` / ``headers`` are the flat text projection (also fed verbatim to the CSV
    export). The additive identifier fields let the grid map cells → links for the
    editable gestures without any extra round-trip:

    - ``hub_unit_ids`` (∥ ``rows``) / ``language_doc_ids`` (∥ ``languages``) — tranche 3a.
    - ``cell_links`` (A2, revue 3b) — ``cell_links[i][j]`` is the list of links behind
      row ``i`` × translation column ``j`` (``languages[j+1]``), in the cell's
      concatenation order; each link is ``{"link_id", "target_unit_id", "char_start",
      "char_end", "target_text_raw"}`` (offsets null = whole unit; ``target_text_raw``
      is the verbatim string the cut offsets index). Built from the same query as the
      cells, so it can never diverge from what the cell displays.

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
        "SELECT unit_id, text_raw, meta_json FROM units"
        " WHERE doc_id=? AND unit_type='line' ORDER BY n",
        (family_root_id,),
    ).fetchall()

    # Per-translation: hub_unit_id -> ordered list of link dicts (id, target, cut, raw).
    # Rejected links are dead (ALN-03) — excluded from projection AND cell_links (F8).
    links_by_t: dict[int, dict[int, list[dict[str, Any]]]] = {}
    for tdoc, _lang in translations:
        by_hub: dict[int, list[dict[str, Any]]] = {}
        # Cell concatenation order = READING order of the target document (unit n,
        # then cut offset within the unit) — not link creation order, so a link
        # added later by a gesture (D-W12 straddle cut) still lands where it reads.
        for link_id, tuid, pivot_id, cs, ce, traw in conn.execute(
            "SELECT al.link_id, al.target_unit_id, al.pivot_unit_id,"
            "       al.target_char_start, al.target_char_end, tu.text_raw"
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
            })
        links_by_t[tdoc] = by_hub

    headers = ["paragraphe", "segment", hub_lang, *[lang for _t, lang in translations]]
    rows: list[list[Any]] = []
    cell_links: list[list[list[dict[str, Any]]]] = []
    for idx, (uid, text_raw, meta_json) in enumerate(hub_units, start=1):
        row: list[Any] = [_parent_n(meta_json), idx, (text_raw or "").strip()]
        row_links: list[list[dict[str, Any]]] = []
        for tdoc, _lang in translations:
            links = links_by_t[tdoc].get(int(uid), [])
            row.append(_cell(links))
            row_links.append(links)
        rows.append(row)
        cell_links.append(row_links)

    return {
        "headers": headers,
        "rows": rows,
        "languages": [hub_lang, *[lang for _t, lang in translations]],
        "hub_doc_id": int(family_root_id),
        # Tranche 3a — identifiers for editable grid gestures. Parallel arrays:
        # hub_unit_ids[i] is the hub unit behind rows[i]; language_doc_ids[j] is the
        # doc_id behind languages[j] (index 0 = hub, then translations).
        "hub_unit_ids": [int(u[0]) for u in hub_units],
        "language_doc_ids": [int(family_root_id), *[tdoc for tdoc, _lang in translations]],
        # A2 (revue 3b) — cell_links[i][j]: links behind rows[i] × translation j.
        "cell_links": cell_links,
    }
