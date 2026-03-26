"""Query engine — Segment and KWIC modes.

Searches the FTS5 index and returns structured hit objects.
See docs/DECISIONS.md ADR-005 and ADR-006.

Segment mode: returns full unit text with match highlighted using << >> markers.
KWIC mode: returns left/match/right windows of N words around the first match.
  With all_occurrences=True (ADR-006 extension): one hit per match occurrence.
Parallel view (--include-aligned): appends aligned units from other docs to each hit.

Advanced FTS5 query helpers:
  proximity_query(terms, distance) → NEAR(t1 t2, N) string for FTS5 proximity search.
  FTS5 natively supports: AND, OR, NOT, "phrase", NEAR(...), word*, ^anchored.
"""

from __future__ import annotations

import logging
import re
import sqlite3
from typing import Any, Optional

logger = logging.getLogger(__name__)

_HIGHLIGHT_OPEN = "<<"


def _extract_literal_terms(q: str) -> list[str]:
    """Extract plain text terms from an FTS5 query for case-sensitive post-filtering.

    Strips NEAR(...) clauses, boolean operators (AND/OR/NOT), anchors (^), and
    wildcards (*), then returns quoted phrases and remaining plain word tokens.
    The caller uses these terms to check whether ``text_raw`` contains them all
    with the exact casing the user typed.
    """
    # Remove NEAR(...) constructs
    clean = re.sub(r"\bNEAR\s*\([^)]*\)", " ", q, flags=re.IGNORECASE)
    # Remove boolean keywords
    clean = re.sub(r"\b(AND|OR|NOT)\b", " ", clean, flags=re.IGNORECASE)
    # Remove FTS5 special chars
    clean = clean.replace("^", "").replace("*", "")
    # Collect quoted phrases first (they count as single terms)
    phrases = re.findall(r'"([^"]+)"', clean)
    clean = re.sub(r'"[^"]+"', " ", clean)
    # Remaining plain word tokens
    words = [w for w in re.findall(r"\w+", clean) if w]
    return phrases + words


def proximity_query(terms: list[str], distance: int = 5) -> str:
    """Build an FTS5 NEAR() proximity query string.

    FTS5 NEAR(term1 term2, N) matches documents where term1 and term2
    appear within N tokens of each other (in either order).

    Example:
        proximity_query(["chat", "chien"], 3) → 'NEAR(chat chien, 3)'

    Args:
        terms: List of query terms (plain words, no quotes needed).
        distance: Maximum token distance between any two adjacent terms.

    Returns:
        FTS5-compatible NEAR() query string.

    Raises:
        ValueError if fewer than 2 terms are provided.
    """
    if len(terms) < 2:
        raise ValueError("proximity_query requires at least 2 terms")
    joined = " ".join(terms)
    return f"NEAR({joined}, {distance})"
_HIGHLIGHT_CLOSE = ">>"


def _highlight_segment(text: str, query: str) -> str:
    """Wrap occurrences of query terms with << >> markers.

    Simple case-insensitive substring approach for Increment 1.
    """
    terms = [re.escape(t.strip('"')) for t in query.split() if t.strip('"')]
    if not terms:
        return text
    pattern = re.compile(
        r"(" + "|".join(terms) + r")",
        re.IGNORECASE | re.UNICODE,
    )
    return pattern.sub(
        lambda m: f"{_HIGHLIGHT_OPEN}{m.group(0)}{_HIGHLIGHT_CLOSE}", text
    )


def _kwic_windows(text: str, query: str, window: int) -> tuple[str, str, str]:
    """Extract left/match/right context around the first query match.

    Tokenizes on whitespace. Returns (left, match, right) strings.
    Per ADR-006: only the first match per unit is returned in Increment 1.
    """
    terms = [t.strip('"') for t in query.split() if t.strip('"')]
    if not terms:
        return ("", text, "")

    pattern = re.compile("|".join(re.escape(t) for t in terms), re.IGNORECASE)
    m = pattern.search(text)
    if not m:
        return (text, "", "")

    match_str = m.group(0)
    match_start = m.start()

    tokens: list[tuple[int, int, str]] = []
    for tok_m in re.finditer(r"\S+", text):
        tokens.append((tok_m.start(), tok_m.end(), tok_m.group(0)))

    if not tokens:
        return ("", match_str, "")

    pivot_idx = 0
    for i, (ts, te, _) in enumerate(tokens):
        if ts <= match_start < te:
            pivot_idx = i
            break

    left_tokens = tokens[max(0, pivot_idx - window): pivot_idx]
    right_tokens = tokens[pivot_idx + 1: pivot_idx + 1 + window]

    return (
        " ".join(t for _, _, t in left_tokens),
        match_str,
        " ".join(t for _, _, t in right_tokens),
    )


def _all_kwic_windows(
    text: str, query: str, window: int
) -> list[tuple[str, str, str]]:
    """Extract left/match/right context around ALL query match occurrences.

    Returns a list of (left, match, right) tuples — one per occurrence.
    Used when all_occurrences=True (ADR-006 extension in V2.0).
    """
    terms = [t.strip('"') for t in query.split() if t.strip('"')]
    if not terms:
        return [("", text, "")]

    pattern = re.compile("|".join(re.escape(t) for t in terms), re.IGNORECASE)
    tokens: list[tuple[int, int, str]] = [
        (m.start(), m.end(), m.group(0)) for m in re.finditer(r"\S+", text)
    ]

    results: list[tuple[str, str, str]] = []
    for match in pattern.finditer(text):
        match_str = match.group(0)
        match_start = match.start()

        pivot_idx = 0
        for i, (ts, te, _) in enumerate(tokens):
            if ts <= match_start < te:
                pivot_idx = i
                break

        left_tokens = tokens[max(0, pivot_idx - window): pivot_idx]
        right_tokens = tokens[pivot_idx + 1: pivot_idx + 1 + window]

        results.append((
            " ".join(t for _, _, t in left_tokens),
            match_str,
            " ".join(t for _, _, t in right_tokens),
        ))

    return results


def _fetch_aligned_units(
    conn: sqlite3.Connection,
    unit_id: int,
    aligned_limit: Optional[int] = None,
) -> list[dict]:
    """Return all units aligned to the given unit_id, in both directions.

    Strategy:
    1. Forward: unit_id is a pivot  → return all its targets.
    2. Reverse: unit_id is a target → find its pivot, then return the pivot
       plus all other targets of that pivot (excluding the original unit_id
       itself, since it is the hit being displayed).

    This makes the view work regardless of which language was searched.
    """
    # ── Forward lookup (unit is pivot) ──────────────────────────────────────
    forward_sql = """
        SELECT
            al.link_id,
            al.target_unit_id  AS matched_unit_id,
            al.external_id,
            al.source_changed_at,
            u.text_norm,
            u.doc_id,
            d.language,
            d.title
        FROM alignment_links al
        JOIN units u ON u.unit_id = al.target_unit_id
        JOIN documents d ON d.doc_id = u.doc_id
        WHERE al.pivot_unit_id = ?
          AND al.target_unit_id != al.pivot_unit_id
        ORDER BY d.language, al.target_doc_id
    """
    forward_rows = conn.execute(forward_sql, [unit_id]).fetchall()

    if forward_rows:
        seen: set[int] = set()
        result = []
        for row in forward_rows:
            uid = row["matched_unit_id"]
            if uid not in seen:
                seen.add(uid)
                result.append({
                    "unit_id": uid,
                    "link_id": row["link_id"],
                    "doc_id": row["doc_id"],
                    "external_id": row["external_id"],
                    "language": row["language"],
                    "title": row["title"],
                    "text": row["text_norm"],
                    "text_norm": row["text_norm"],
                    "source_changed_at": row["source_changed_at"],
                })
        if aligned_limit is not None:
            result = result[:aligned_limit]
        return result

    # ── Reverse lookup (unit is a target — find its pivot then siblings) ────
    pivot_sql = """
        SELECT al.pivot_unit_id
        FROM alignment_links al
        WHERE al.target_unit_id = ?
        LIMIT 1
    """
    pivot_row = conn.execute(pivot_sql, [unit_id]).fetchone()
    if pivot_row is None:
        return []

    pivot_unit_id = pivot_row["pivot_unit_id"]

    # Return the pivot unit itself + all other targets (excluding the hit unit and self-links)
    siblings_sql = """
        SELECT
            NULL AS link_id,
            u.unit_id AS matched_unit_id,
            u.external_id,
            u.text_norm,
            u.doc_id,
            d.language,
            d.title,
            NULL AS source_changed_at
        FROM units u
        JOIN documents d ON d.doc_id = u.doc_id
        WHERE u.unit_id = ?
        UNION ALL
        SELECT
            al.link_id,
            al.target_unit_id AS matched_unit_id,
            al.external_id,
            u2.text_norm,
            u2.doc_id,
            d2.language,
            d2.title,
            al.source_changed_at
        FROM alignment_links al
        JOIN units u2 ON u2.unit_id = al.target_unit_id
        JOIN documents d2 ON d2.doc_id = u2.doc_id
        WHERE al.pivot_unit_id = ?
          AND al.target_unit_id != ?
          AND al.target_unit_id != al.pivot_unit_id
        ORDER BY language
    """
    sibling_rows = conn.execute(siblings_sql, [pivot_unit_id, pivot_unit_id, unit_id]).fetchall()

    seen: set[int] = set()
    result = []
    for row in sibling_rows:
        uid = row["matched_unit_id"]
        if uid not in seen:
            seen.add(uid)
            result.append({
                "unit_id": uid,
                "link_id": row["link_id"],
                "doc_id": row["doc_id"],
                "external_id": row["external_id"],
                "language": row["language"],
                "title": row["title"],
                "text": row["text_norm"],
                "text_norm": row["text_norm"],
                "source_changed_at": row["source_changed_at"],
            })

    if aligned_limit is not None:
        result = result[:aligned_limit]
    return result


def _build_hits(
    conn: sqlite3.Connection,
    rows: list[sqlite3.Row],
    *,
    q: str,
    mode: str,
    window: int,
    include_aligned: bool,
    aligned_limit: Optional[int],
    all_occurrences: bool,
) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for row in rows:
        unit_id = row["unit_id"]
        d_id = row["doc_id"]
        ext_id = row["external_id"]
        text_norm = row["text_norm"]
        lang = row["language"]
        title = row["title"]

        if mode == "segment":
            hit: dict[str, Any] = {
                "doc_id": d_id,
                "unit_id": unit_id,
                "external_id": ext_id,
                "language": lang,
                "title": title,
                "text": _highlight_segment(text_norm, q),
                "text_norm": text_norm,
            }
            if include_aligned:
                hit["aligned"] = _fetch_aligned_units(
                    conn,
                    unit_id,
                    aligned_limit=aligned_limit,
                )
            hits.append(hit)
            logger.debug("Hit: unit_id=%d ext_id=%s", unit_id, ext_id)
            continue

        if mode == "kwic":
            if all_occurrences:
                occurrences = _all_kwic_windows(text_norm, q, window)
            else:
                occurrences = [_kwic_windows(text_norm, q, window)]

            for left, match, right in occurrences:
                occ_hit: dict[str, Any] = {
                    "doc_id": d_id,
                    "unit_id": unit_id,
                    "external_id": ext_id,
                    "language": lang,
                    "title": title,
                    "left": left,
                    "match": match,
                    "right": right,
                    "text_norm": text_norm,
                }
                if include_aligned:
                    occ_hit["aligned"] = _fetch_aligned_units(
                        conn,
                        unit_id,
                        aligned_limit=aligned_limit,
                    )
                hits.append(occ_hit)
                logger.debug("Hit (occurrence): unit_id=%d match=%r", unit_id, match)
            continue

        raise ValueError(f"Unknown query mode: {mode!r}. Expected 'segment' or 'kwic'.")

    return hits


def run_query_page(
    conn: sqlite3.Connection,
    q: str,
    mode: str = "segment",
    window: int = 10,
    language: Optional[str] = None,
    doc_id: Optional[int] = None,
    doc_ids: Optional[list[int]] = None,
    resource_type: Optional[str] = None,
    doc_role: Optional[str] = None,
    include_aligned: bool = False,
    aligned_limit: Optional[int] = None,
    all_occurrences: bool = False,
    limit: Optional[int] = None,
    offset: int = 0,
    case_sensitive: bool = False,
) -> dict[str, Any]:
    """Run an FTS query and return a paginated payload.

    Pagination strategy:
    - If ``limit`` is provided, fetch ``limit + 1`` rows to compute ``has_more``
      without an extra count query.
    - ``total`` is intentionally ``None`` in V0.2 to avoid expensive COUNT(*) on
      larger corpora.
    """
    if offset < 0:
        raise ValueError("offset must be >= 0")
    if limit is not None and limit <= 0:
        raise ValueError("limit must be >= 1 when provided")
    if aligned_limit is not None and aligned_limit <= 0:
        raise ValueError("aligned_limit must be >= 1 when provided")

    if not q.strip():
        return {
            "hits": [],
            "limit": limit,
            "offset": offset,
            "next_offset": None,
            "has_more": False,
            "total": None,
        }

    filters: list[str] = ["u.unit_type = 'line'"]
    params: list[Any] = [q]

    if language:
        filters.append("d.language = ?")
        params.append(language)
    if doc_ids is not None and len(doc_ids) > 0:
        placeholders = ",".join("?" * len(doc_ids))
        filters.append(f"u.doc_id IN ({placeholders})")
        params.extend(doc_ids)
    elif doc_id is not None:
        filters.append("u.doc_id = ?")
        params.append(doc_id)
    if resource_type:
        filters.append("d.resource_type = ?")
        params.append(resource_type)
    if doc_role:
        filters.append("d.doc_role = ?")
        params.append(doc_role)

    where_clause = " AND ".join(filters)
    base_sql = f"""
        SELECT
            u.unit_id,
            u.doc_id,
            u.external_id,
            u.text_norm,
            u.text_raw,
            d.language,
            d.title
        FROM fts_units f
        JOIN units u ON u.unit_id = f.rowid
        JOIN documents d ON d.doc_id = u.doc_id
        WHERE fts_units MATCH ?
          AND {where_clause}
        ORDER BY u.doc_id, u.n
    """

    sql = base_sql
    query_params: list[Any] = list(params)
    if limit is not None:
        sql += "\nLIMIT ? OFFSET ?"
        query_params.extend([limit + 1, offset])
    elif offset > 0:
        sql += "\nLIMIT -1 OFFSET ?"
        query_params.append(offset)

    logger.debug("Query SQL: %s | params: %s", sql, query_params)

    try:
        rows = conn.execute(sql, query_params).fetchall()
    except sqlite3.OperationalError as exc:
        logger.error("FTS query error: %s", exc)
        raise

    # Case-sensitive post-filter: FTS5 is always case-insensitive (unicode61
    # tokenizer folds to lowercase).  When requested, we re-check each row
    # against text_raw so only units whose raw text contains every query term
    # with the exact casing are kept.
    if case_sensitive:
        terms = _extract_literal_terms(q)
        if terms:
            rows = [
                row for row in rows
                if all(t in (row["text_raw"] or "") for t in terms)
            ]
            logger.debug("Case-sensitive filter kept %d rows for terms %r", len(rows), terms)

    has_more = False
    next_offset: int | None = None
    page_rows = rows
    if limit is not None and len(rows) > limit:
        page_rows = rows[:limit]
        has_more = True
        next_offset = offset + limit

    hits = _build_hits(
        conn,
        page_rows,
        q=q,
        mode=mode,
        window=window,
        include_aligned=include_aligned,
        aligned_limit=aligned_limit,
        all_occurrences=all_occurrences,
    )

    logger.info("Query %r mode=%s returned %d hits (offset=%d, limit=%s)", q, mode, len(hits), offset, limit)
    return {
        "hits": hits,
        "limit": limit,
        "offset": offset,
        "next_offset": next_offset,
        "has_more": has_more,
        "total": None,
    }


def run_query_facets(
    conn: sqlite3.Connection,
    q: str,
    language: Optional[str] = None,
    doc_id: Optional[int] = None,
    doc_ids: Optional[list[int]] = None,
    resource_type: Optional[str] = None,
    doc_role: Optional[str] = None,
    top_docs_limit: int = 10,
) -> dict[str, Any]:
    """Compute lightweight facet summary for a query without fetching hit content.

    Executes a single GROUP BY over the FTS index — no hit-level processing.
    Significantly cheaper than loading all hits to compute front-side facets.

    Returns:
        total_hits:    Number of matching units across all documents.
        distinct_docs: Number of distinct documents containing at least one match.
        distinct_langs: Number of distinct languages among matching documents.
        top_docs:      Top ``top_docs_limit`` documents by hit count, descending.

    Note: ``total_hits`` counts matching *units*, not KWIC occurrences (which can be
    higher when all_occurrences=True). This is consistent with segment mode counts.
    """
    if not q.strip():
        return {
            "total_hits": 0,
            "distinct_docs": 0,
            "distinct_langs": 0,
            "top_docs": [],
        }

    filters: list[str] = ["u.unit_type = 'line'"]
    params: list[Any] = [q]

    if language:
        filters.append("d.language = ?")
        params.append(language)
    if doc_ids is not None and len(doc_ids) > 0:
        placeholders = ",".join("?" * len(doc_ids))
        filters.append(f"u.doc_id IN ({placeholders})")
        params.extend(doc_ids)
    elif doc_id is not None:
        filters.append("u.doc_id = ?")
        params.append(doc_id)
    if resource_type:
        filters.append("d.resource_type = ?")
        params.append(resource_type)
    if doc_role:
        filters.append("d.doc_role = ?")
        params.append(doc_role)

    where_clause = " AND ".join(filters)
    sql = f"""
        SELECT
            d.doc_id,
            d.title,
            d.language,
            COUNT(*) AS hit_count
        FROM fts_units f
        JOIN units u ON u.unit_id = f.rowid
        JOIN documents d ON d.doc_id = u.doc_id
        WHERE fts_units MATCH ?
          AND {where_clause}
        GROUP BY d.doc_id
        ORDER BY hit_count DESC
    """

    try:
        rows = conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError as exc:
        logger.error("Facets query error: %s", exc)
        raise

    total_hits = sum(row["hit_count"] for row in rows)
    distinct_docs = len(rows)
    lang_set = {row["language"] for row in rows if row["language"]}
    distinct_langs = len(lang_set)

    top_docs = [
        {
            "doc_id": row["doc_id"],
            "title": row["title"] or f"Doc #{row['doc_id']}",
            "language": row["language"],
            "count": row["hit_count"],
        }
        for row in rows[:top_docs_limit]
    ]

    logger.info(
        "Facets %r → %d total hits, %d docs, %d langs",
        q, total_hits, distinct_docs, distinct_langs,
    )
    return {
        "total_hits": total_hits,
        "distinct_docs": distinct_docs,
        "distinct_langs": distinct_langs,
        "top_docs": top_docs,
    }


def run_query(
    conn: sqlite3.Connection,
    q: str,
    mode: str = "segment",
    window: int = 10,
    language: Optional[str] = None,
    doc_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    doc_role: Optional[str] = None,
    include_aligned: bool = False,
    aligned_limit: Optional[int] = None,
    all_occurrences: bool = False,
) -> list[dict]:
    """Run an FTS query and return a list of hit dicts.

    Args:
        conn: SQLite connection.
        q: Query string (FTS5 syntax).
        mode: 'segment' or 'kwic'.
        window: Number of tokens for KWIC context (each side).
        language: Filter by document language.
        doc_id: Filter by specific document.
        resource_type: Filter by resource_type.
        doc_role: Filter by doc_role.
        include_aligned: If True, attach aligned units from other docs to each hit.
        aligned_limit: Optional per-hit cap for attached aligned units.
        all_occurrences: KWIC only. If True, return one hit per match occurrence
            instead of one hit per unit (ADR-006 extension).

    Returns:
        List of hit dicts shaped per docs/INTEGRATION_TAURI.md.
    """
    page = run_query_page(
        conn=conn,
        q=q,
        mode=mode,
        window=window,
        language=language,
        doc_id=doc_id,
        resource_type=resource_type,
        doc_role=doc_role,
        include_aligned=include_aligned,
        aligned_limit=aligned_limit,
        all_occurrences=all_occurrences,
        limit=None,
        offset=0,
    )
    return page["hits"]
