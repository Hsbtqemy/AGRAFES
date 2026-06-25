"""Token-level distribution statistics.

``POST /token_stats`` — compute frequency distribution of a token attribute
(lemma, upos, xpos, word) over all hits returned by a CQL query.

This module intentionally does no I/O beyond the single SQL fetch: everything
is computed in-process from the query result set so it stays fast for corpora
up to a few hundred thousand tokens.
"""

from __future__ import annotations

import re
from typing import Any, Optional
import sqlite3

from .cql_parser import parse_cql_query
from .token_query import _compile_specs, _find_matches, _stream_groups


# Token attributes group per-token; "year" groups per-hit by the matched
# document's date (ADR-043-adjacent F2 — diachronic distribution).
_ALLOWED_GROUP_BY = ("lemma", "upos", "xpos", "word", "feats", "year")

# documents.doc_date is free text (migration 010): "2024" / "2024-03" /
# "2024-03-15" / NULL / arbitrary. Bucket by the leading 4-digit year, which
# the documented convention always front-loads; anything else is undated.
_NO_DATE_BUCKET = "(sans date)"
_YEAR_RE = re.compile(r"^\s*(\d{4})")


def _year_bucket(doc_date: Any) -> str:
    if not doc_date:
        return _NO_DATE_BUCKET
    m = _YEAR_RE.match(str(doc_date))
    return m.group(1) if m else _NO_DATE_BUCKET


def _year_sort_key(year: str) -> tuple[int, str]:
    # Chronological; the undated bucket sorts last.
    return (1, "") if year == _NO_DATE_BUCKET else (0, year)


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
        Token attribute to group by — ``lemma``, ``upos``, ``xpos``, ``word``,
        ``feats`` (counted per token) — or ``year`` (diachronic: counted per
        *hit*, bucketed by the matched document's leading-4-digit ``doc_date``;
        undated docs fall in the ``(sans date)`` bucket, sorted chronologically).
        ``year`` rows additionally carry ``tokens_in_period`` (denominator) and
        ``freq_per_10k`` (normalised occurrences per 10 000 tokens of that year).
    language:
        Restrict to documents with this language code (optional).
    doc_ids:
        Restrict to these document IDs (optional).
    limit:
        Maximum number of rows to return (1–200). **Not applied to**
        ``group_by="year"``, which returns the complete chronological series.

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

    if group_by == "year":
        # Diachronic distribution: count one occurrence per *hit* (not per token),
        # attributed to the matched document's year. The per-year denominator
        # (all tokens in scope for that year) comes free from the same streams,
        # so each row carries both the raw count and a normalised freq/10k.
        year_hits: dict[str, int] = {}
        year_tokens: dict[str, int] = {}
        total_hits = 0
        total_pivot_tokens = 0
        for meta, stream_tokens in grouped_streams:
            if not stream_tokens:
                continue
            year = _year_bucket(meta.get("doc_date"))
            year_tokens[year] = year_tokens.get(year, 0) + len(stream_tokens)
            for m in _find_matches(stream_tokens, compiled_specs):
                total_hits += 1
                total_pivot_tokens += len(m.indices)
                year_hits[year] = year_hits.get(year, 0) + 1

        # The temporal series is returned in FULL: `limit` does not truncate it.
        # A diachronic corpus often spans more years than the default cap, and the
        # chronological sort means [:limit] would silently drop the most recent
        # years — a misleading histogram. Year buckets are naturally bounded by the
        # corpus date range, so completeness is safe.
        ordered = sorted(year_hits, key=_year_sort_key)
        rows = [
            {
                "value": year,
                "count": year_hits[year],
                "pct": round(year_hits[year] / total_hits * 100, 2) if total_hits else 0.0,
                "tokens_in_period": year_tokens.get(year, 0),
                "freq_per_10k": (
                    round(year_hits[year] / year_tokens[year] * 10000, 2)
                    if year_tokens.get(year) else 0.0
                ),
            }
            for year in ordered
        ]
        return {
            "total_hits": total_hits,
            "total_pivot_tokens": total_pivot_tokens,
            "group_by": group_by,
            "rows": rows,
        }

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
