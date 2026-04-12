"""Collocation analysis for CQL token queries.

``POST /token_collocates`` — for each hit returned by a CQL query, collect
tokens within a ±N window around the matched span and compute association
measures (PMI and log-likelihood G²) against the corpus baseline.

Algorithm
---------
1. Stream all unit groups (same as token_stats/token_query).
2. For each CQL match, collect tokens in [start-window, start) ∪ (end-1, end+window]
   within the same unit, excluding the matched span itself.
3. Aggregate per-collocate observed frequency ``O`` (split left/right for display).
4. Fetch corpus-wide frequency for every candidate collocate via a single
   ``SELECT … GROUP BY`` query.
5. Compute PMI and G² for each collocate.  Filter by min_freq.
6. Return top-K sorted by the requested score.

PMI formula
-----------
    PMI = log2(O × N / (T × F_w))

where
    O    = observed collocate count in all windows
    N    = total tokens in corpus
    T    = total tokens across all windows (= Σ window sizes)
    F_w  = corpus-wide frequency of the collocate

Log-likelihood G²
-----------------
Observed and expected contingency table:
    O11 = O (collocate in window)
    O12 ≈ F_w - O  (collocate elsewhere in corpus)
    O21 = T - O    (other tokens in window)
    O22 = N - F_w - T + O
    Eij = (row_total × col_total) / N
    G² = 2 × Σ Oij × ln(Oij / Eij)   for Oij > 0
"""

from __future__ import annotations

import math
import sqlite3
from typing import Any, Optional

from .cql_parser import parse_cql_query
from .token_query import _compile_specs, _find_matches, _stream_groups


_ALLOWED_BY = ("lemma", "word", "upos", "xpos")


def _ll_cell(o: float, e: float) -> float:
    """Contribution of one cell to G² (0 when O=0)."""
    if o <= 0.0 or e <= 0.0:
        return 0.0
    return o * math.log(o / e)


def run_token_collocates(
    conn: sqlite3.Connection,
    *,
    cql: str,
    window: int = 5,
    by: str = "lemma",
    language: Optional[str] = None,
    doc_ids: Optional[list[int]] = None,
    limit: int = 50,
    min_freq: int = 2,
    sort_by: str = "pmi",
) -> dict[str, Any]:
    """Return ranked collocates for *cql* with PMI and log-likelihood scores.

    Parameters
    ----------
    conn:
        Open SQLite connection (read-only queries).
    cql:
        CQL query string.
    window:
        Number of tokens to collect on each side of the pivot span (1–20).
    by:
        Token attribute used to identify collocates. One of ``lemma``,
        ``word``, ``upos``, ``xpos``.
    language:
        Restrict to documents with this language code.
    doc_ids:
        Restrict to these document IDs.
    limit:
        Maximum collocate rows to return (1–200).
    min_freq:
        Minimum observed frequency to include a collocate (filters hapaxes).
    sort_by:
        Ranking criterion: ``pmi``, ``ll``, or ``freq``.

    Returns
    -------
    dict with keys:
        - ``total_hits``       — number of CQL matches processed
        - ``total_window_tokens`` — total tokens examined across all windows
        - ``corpus_size``      — total tokens in corpus (baseline)
        - ``window``           — echoed back
        - ``by``               — echoed back
        - ``rows``             — list of collocate rows (see below)

    Each row:
        ``value``, ``freq``, ``left_freq``, ``right_freq``, ``pmi``, ``ll``
    """
    # ── validate inputs ──────────────────────────────────────────────────────
    if by not in _ALLOWED_BY:
        raise ValueError(f"by must be one of {_ALLOWED_BY!r}, got {by!r}")
    if not 1 <= window <= 20:
        raise ValueError("window must be in [1, 20]")
    if not 1 <= limit <= 200:
        raise ValueError("limit must be in [1, 200]")
    if min_freq < 1:
        raise ValueError("min_freq must be >= 1")
    if sort_by not in ("pmi", "ll", "freq"):
        raise ValueError("sort_by must be one of 'pmi', 'll', 'freq'")

    # ── 1. stream groups & find matches ──────────────────────────────────────
    query = parse_cql_query(cql)
    compiled_specs = _compile_specs(query)
    grouped_streams = _stream_groups(
        conn,
        within_sentence=query.within_sentence,
        language=language,
        doc_ids=doc_ids,
    )

    # collocate_counts[value] = [left_count, right_count]
    collocate_counts: dict[str, list[int]] = {}
    total_hits = 0
    total_window_tokens = 0

    for _meta, stream_tokens in grouped_streams:
        if not stream_tokens:
            continue
        matches = _find_matches(stream_tokens, compiled_specs)
        for m in matches:
            total_hits += 1
            left_start = max(0, m.start - window)
            right_end = min(len(stream_tokens), m.end + window)

            # left window (positions before pivot span)
            for tok in stream_tokens[left_start:m.start]:
                raw = tok.get(by)
                val: str = raw if isinstance(raw, str) and raw else "(vide)"
                entry = collocate_counts.setdefault(val, [0, 0])
                entry[0] += 1
                total_window_tokens += 1

            # right window (positions after pivot span)
            for tok in stream_tokens[m.end:right_end]:
                raw = tok.get(by)
                val = raw if isinstance(raw, str) and raw else "(vide)"
                entry = collocate_counts.setdefault(val, [0, 0])
                entry[1] += 1
                total_window_tokens += 1

    if total_hits == 0 or not collocate_counts:
        return {
            "total_hits": 0,
            "total_window_tokens": 0,
            "corpus_size": _corpus_size(conn),
            "window": window,
            "by": by,
            "rows": [],
        }

    # ── 2. corpus baseline ────────────────────────────────────────────────────
    N = _corpus_size(conn)
    T = total_window_tokens

    # Fetch corpus freq for all candidate values in one query
    corpus_freq = _corpus_freq_for(conn, by=by, values=set(collocate_counts.keys()))

    # ── 3. compute scores ─────────────────────────────────────────────────────
    rows: list[dict[str, Any]] = []
    for val, (left_cnt, right_cnt) in collocate_counts.items():
        O = left_cnt + right_cnt
        if O < min_freq:
            continue

        F_w = corpus_freq.get(val, O)  # fall back to observed if missing

        # PMI (clamp denominator to avoid log(0))
        denom = T * F_w
        if N > 0 and denom > 0:
            pmi = round(math.log2(O * N / denom), 4)
        else:
            pmi = 0.0

        # Log-likelihood G²
        if N > 0 and T > 0 and F_w > 0:
            O11 = float(O)
            O12 = max(float(F_w) - O11, 0.0)
            O21 = max(float(T) - O11, 0.0)
            O22 = max(float(N) - float(F_w) - float(T) + O11, 0.0)
            row_1 = O11 + O12
            row_2 = O21 + O22
            col_1 = O11 + O21
            col_2 = O12 + O22
            E11 = row_1 * col_1 / N
            E12 = row_1 * col_2 / N
            E21 = row_2 * col_1 / N
            E22 = row_2 * col_2 / N
            ll = round(
                2.0 * (
                    _ll_cell(O11, E11)
                    + _ll_cell(O12, E12)
                    + _ll_cell(O21, E21)
                    + _ll_cell(O22, E22)
                ),
                4,
            )
        else:
            ll = 0.0

        rows.append({
            "value": val,
            "freq": O,
            "left_freq": left_cnt,
            "right_freq": right_cnt,
            "corpus_freq": F_w,
            "pmi": pmi,
            "ll": ll,
        })

    # ── 4. sort & truncate ────────────────────────────────────────────────────
    if sort_by == "ll":
        rows.sort(key=lambda r: (-r["ll"], -r["freq"], r["value"]))
    elif sort_by == "freq":
        rows.sort(key=lambda r: (-r["freq"], -r["pmi"], r["value"]))
    else:  # pmi (default)
        rows.sort(key=lambda r: (-r["pmi"], -r["freq"], r["value"]))

    return {
        "total_hits": total_hits,
        "total_window_tokens": T,
        "corpus_size": N,
        "window": window,
        "by": by,
        "rows": rows[:limit],
    }


# ── helpers ───────────────────────────────────────────────────────────────────

def _corpus_size(conn: sqlite3.Connection) -> int:
    """Total token count in the database."""
    row = conn.execute("SELECT COUNT(*) FROM tokens").fetchone()
    return int(row[0]) if row else 0


def _corpus_freq_for(
    conn: sqlite3.Connection,
    *,
    by: str,
    values: set[str],
) -> dict[str, int]:
    """Return corpus-wide frequency for each value in *values* for attribute *by*.

    Uses a single GROUP BY query limited to the candidate set, which is
    efficient for the typically small collocate vocabulary.
    """
    if not values:
        return {}

    # Map by-attribute to the column name in tokens table
    col = by  # column name matches the attribute (lemma, word, upos, xpos)

    # Use a single query with IN clause — SQLite handles large IN lists fine
    # for the collocate set sizes we expect (< 10 000 distinct values)
    placeholders = ",".join("?" * len(values))
    sql = f"""
        SELECT {col}, COUNT(*) AS cnt
        FROM tokens
        WHERE {col} IN ({placeholders})
        GROUP BY {col}
    """
    rows = conn.execute(sql, list(values)).fetchall()
    return {str(row[0]): int(row[1]) for row in rows if row[0] is not None}
