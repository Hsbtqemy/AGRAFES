"""Aligned-matrix projection — source-anchored export (R3.3, DESIGN_source_anchored_alignment §5/§D7).

Projects the *aligned form* of a family into the multilingual matrix (the prototype
`Test-Alignement(Hugo).csv`): one row per **hub** (parent/original) segment, one column
per language, each translation cell being the text aligned to that hub segment —
source-anchored **cut slices** applied (`text_raw[cs:ce]`, code-point native in Python),
N-M **bead** targets concatenated, empty on omission. The matrix is a *projection*
(never stored, cf. D4): it is recomputed from documents + alignment_links on each call.

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


def _cell(links: list[tuple[str, Optional[int], Optional[int]]]) -> str:
    """One translation cell: cut slices applied, bead targets concatenated, trimmed."""
    if not links:
        return ""
    parts: list[str] = []
    for raw, cs, ce in links:
        raw = raw or ""
        # cs/ce are code-point offsets (the cut); Python str slicing is code-point native.
        parts.append(raw[cs:ce] if cs is not None and ce is not None else raw)
    return " ".join(p.strip() for p in parts if p.strip()).strip()


def build_alignment_matrix(conn: sqlite3.Connection, family_root_id: int) -> dict:
    """Project the family's aligned form into a hub-anchored multilingual matrix.

    Returns ``{"headers": [...], "rows": [[...], ...], "languages": [...],
    "hub_doc_id": int, "hub_unit_ids": [...], "language_doc_ids": [...]}``.

    ``rows`` / ``headers`` are the flat text projection (also fed verbatim to the CSV
    export). ``hub_unit_ids`` (parallel to ``rows``) and ``language_doc_ids`` (parallel to
    ``languages``) are additive identifiers (R3.3 tranche 3a) that let the grid map a cell
    → its hub unit and target doc, so the editable gestures (couper/ré-ancrer…) can resolve
    the underlying ``alignment_links`` (e.g. via ``/align/audit``). Raises
    :class:`NotFoundError` when the hub doc is missing.
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

    # Per-translation: hub_unit_id -> ordered list of (target text_raw, cut_start, cut_end).
    links_by_t: dict[int, dict[int, list[tuple[str, Optional[int], Optional[int]]]]] = {}
    for tdoc, _lang in translations:
        by_hub: dict[int, list[tuple[str, Optional[int], Optional[int]]]] = {}
        for pivot_id, cs, ce, traw in conn.execute(
            "SELECT al.pivot_unit_id, al.target_char_start, al.target_char_end, tu.text_raw"
            " FROM alignment_links al JOIN units tu ON tu.unit_id = al.target_unit_id"
            " WHERE al.pivot_doc_id=? AND al.target_doc_id=?"
            " ORDER BY al.pivot_unit_id, al.external_id, al.link_id",
            (family_root_id, tdoc),
        ):
            by_hub.setdefault(int(pivot_id), []).append((traw, cs, ce))
        links_by_t[tdoc] = by_hub

    headers = ["paragraphe", "segment", hub_lang, *[lang for _t, lang in translations]]
    rows: list[list[Any]] = []
    for idx, (uid, text_raw, meta_json) in enumerate(hub_units, start=1):
        row: list[Any] = [_parent_n(meta_json), idx, (text_raw or "").strip()]
        for tdoc, _lang in translations:
            row.append(_cell(links_by_t[tdoc].get(int(uid), [])))
        rows.append(row)

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
    }
