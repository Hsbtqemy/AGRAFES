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
from typing import Optional

logger = logging.getLogger(__name__)

_HIGHLIGHT_OPEN = "<<"


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
) -> list[dict]:
    """Return all units aligned to the given pivot unit_id.

    Looks up alignment_links where pivot_unit_id = unit_id,
    returns target unit data (text_norm, language, title, external_id).
    """
    rows = conn.execute(
        """
        SELECT
            al.target_unit_id,
            al.external_id,
            u.text_norm,
            u.text_raw,
            u.doc_id,
            d.language,
            d.title
        FROM alignment_links al
        JOIN units u ON u.unit_id = al.target_unit_id
        JOIN documents d ON d.doc_id = u.doc_id
        WHERE al.pivot_unit_id = ?
        ORDER BY d.language, al.target_doc_id
        """,
        (unit_id,),
    ).fetchall()

    return [
        {
            "unit_id": row["target_unit_id"],
            "doc_id": row["doc_id"],
            "external_id": row["external_id"],
            "language": row["language"],
            "title": row["title"],
            "text_norm": row["text_norm"],
        }
        for row in rows
    ]


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
        all_occurrences: KWIC only. If True, return one hit per match occurrence
            instead of one hit per unit (ADR-006 extension).

    Returns:
        List of hit dicts shaped per docs/INTEGRATION_TAURI.md.
    """
    if not q.strip():
        return []

    filters: list[str] = ["u.unit_type = 'line'"]
    params: list = [q]

    if language:
        filters.append("d.language = ?")
        params.append(language)
    if doc_id is not None:
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

    logger.debug("Query SQL: %s | params: %s", sql, params)

    try:
        rows = conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError as exc:
        logger.error("FTS query error: %s", exc)
        raise

    hits: list[dict] = []
    for row in rows:
        unit_id = row["unit_id"]
        d_id = row["doc_id"]
        ext_id = row["external_id"]
        text_norm = row["text_norm"]
        lang = row["language"]
        title = row["title"]

        if mode == "segment":
            hit = {
                "doc_id": d_id,
                "unit_id": unit_id,
                "external_id": ext_id,
                "language": lang,
                "title": title,
                "text": _highlight_segment(text_norm, q),
                "text_norm": text_norm,
            }
        elif mode == "kwic":
            if all_occurrences:
                occurrences = _all_kwic_windows(text_norm, q, window)
            else:
                occurrences = [_kwic_windows(text_norm, q, window)]

            for left, match, right in occurrences:
                occ_hit = {
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
                    occ_hit["aligned"] = _fetch_aligned_units(conn, unit_id)
                hits.append(occ_hit)
                logger.debug("Hit (occurrence): unit_id=%d match=%r", unit_id, match)
            continue  # already appended; skip the generic append below
        else:
            raise ValueError(f"Unknown query mode: {mode!r}. Expected 'segment' or 'kwic'.")

        if include_aligned:
            hit["aligned"] = _fetch_aligned_units(conn, unit_id)

        hits.append(hit)
        logger.debug("Hit: unit_id=%d ext_id=%s", unit_id, ext_id)

    logger.info("Query %r mode=%s returned %d hits", q, mode, len(hits))
    return hits
