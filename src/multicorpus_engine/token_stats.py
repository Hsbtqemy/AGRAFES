"""Token-level distribution statistics.

``POST /token_stats`` — compute frequency distribution of a token attribute
(lemma, upos, xpos, word) over all hits returned by a CQL query.

This module intentionally does no I/O beyond the single SQL fetch: everything
is computed in-process from the query result set so it stays fast for corpora
up to a few hundred thousand tokens.
"""

from __future__ import annotations

from typing import Any, Optional
import sqlite3

from .cql_parser import parse_cql_query
from .token_query import _compile_specs, _find_matches, _stream_groups


_ALLOWED_GROUP_BY = ("lemma", "upos", "xpos", "word", "feats")


def run_token_stats(
    conn: sqlite3.Connection,
    *,
    cql: str,
    group_by: str = "lemma",
    language: Optional[str] = None,
    doc_ids: Optional[list[int]] = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Return frequency distribution of *group_by* attribute over CQL hits.

    Parameters
    ----------
    conn:
        Open SQLite connection (read-only queries only).
    cql:
        CQL query string — same syntax as ``/token_query``.
    group_by:
        Token attribute to group by.  One of ``lemma``, ``upos``, ``xpos``,
        ``word``, ``feats``.
    language:
        Restrict to documents with this language code (optional).
    doc_ids:
        Restrict to these document IDs (optional).
    limit:
        Maximum number of rows to return (1–200).

    Returns
    -------
    dict with keys:
        - ``total_hits``  – total number of matched token sequences
        - ``total_pivot_tokens`` – total tokens in all pivot spans
        - ``group_by``    – echoed back
        - ``rows``        – list of ``{value, count, pct}`` sorted by count desc
    """
    if group_by not in _ALLOWED_GROUP_BY:
        raise ValueError(
            f"group_by must be one of {_ALLOWED_GROUP_BY!r}, got {group_by!r}"
        )
    if limit < 1 or limit > 200:
        raise ValueError("limit must be in [1, 200]")

    query = parse_cql_query(cql)
    compiled_specs = _compile_specs(query)

    grouped_streams = _stream_groups(
        conn,
        within_sentence=query.within_sentence,
        language=language,
        doc_ids=doc_ids,
    )

    counts: dict[str, int] = {}
    total_hits = 0
    total_pivot_tokens = 0

    for meta, stream_tokens in grouped_streams:
        if not stream_tokens:
            continue
        matches = _find_matches(stream_tokens, compiled_specs)
        for m in matches:
            total_hits += 1
            # Collect the attribute value for each token in the matched span
            for idx in m.indices:
                tok = stream_tokens[idx]
                raw: Any = tok.get(group_by)
                value: str = raw if isinstance(raw, str) and raw else "(vide)"
                counts[value] = counts.get(value, 0) + 1
                total_pivot_tokens += 1

    sorted_rows = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    top = sorted_rows[:limit]

    rows = [
        {
            "value": val,
            "count": cnt,
            "pct": round(cnt / total_pivot_tokens * 100, 2) if total_pivot_tokens else 0.0,
        }
        for val, cnt in top
    ]

    return {
        "total_hits": total_hits,
        "total_pivot_tokens": total_pivot_tokens,
        "group_by": group_by,
        "rows": rows,
    }
