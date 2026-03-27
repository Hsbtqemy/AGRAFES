"""Execute CQL queries against the ``tokens`` table.

Strategy (Sprint C — fixed-length sequences)
--------------------------------------------
For a query with N concrete, non-repeating token constraints and no wildcards,
the query builds N-1 self-joins on the ``tokens`` table (t1 … tN), anchored by
position continuity within the same ``(unit_id, sent_id)`` window.  This is fast
because positions are stored as consecutive integers.

Strategy (Sprint D — variable-length / wildcard / repetition)
--------------------------------------------------------------
When the query contains at least one :class:`~cql_parser.WildcardToken` or
:class:`~cql_parser.RepeatToken`, we fall back to a Python sliding-window
matcher:

1. For each ``(unit_id, sent_id)`` pair that potentially contains a match
   (pre-filtered via SQL using the first concrete constraint), fetch the full
   ordered list of tokens in that sentence.
2. Run a backtracking ``_match`` recursive function over the flattened
   pattern elements and the token list.
3. Collect all non-overlapping (or all overlapping, as we return all) matches.

``within s`` constraint
------------------------
When ``CQLQuery.within_s`` is True, all matched tokens must share the same
``sent_id``.  For the SQL path this is already guaranteed by the join anchor.
For the sliding-window path the candidate sentences are already scoped to a
single ``sent_id``, so no extra work is needed.

Regex support
-------------
SQLite does not enable REGEXP by default.  This module registers a Python
``REGEXP(pattern, value)`` function on the connection before executing any
query.  The function delegates to ``re.search`` so all Python regex syntax is
available.

Usage
-----
::

    from multicorpus_engine.cql_parser import parse_cql
    from multicorpus_engine.token_query import run_token_query

    query = parse_cql('[lemma="it" %c][]{0,3}[word="that" %c] within s')
    hits, total = run_token_query(conn, query, window=5, limit=100, offset=0)
    for h in hits:
        print(h.left, "**", h.node, "**", h.right)
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

from .cql_parser import (
    AttrTest, AndExpr, OrExpr, BoolExpr,
    TokenConstraint, WildcardToken, RepeatToken, PatternElement,
    CQLQuery,
)


# ─── Result type ──────────────────────────────────────────────────────────────

@dataclass
class KwicHit:
    doc_id: int
    doc_title: str
    unit_id: int
    unit_position: int   # ordinal position of the unit within its document
    sent_id: int
    match_start: int     # position of first matched token (within sentence)
    match_end: int       # position of last matched token (inclusive)
    left: list[str]      # surface forms left of the match
    node: list[str]      # surface forms of the match itself
    right: list[str]     # surface forms right of the match

    def to_dict(self) -> dict:
        return {
            "doc_id":        self.doc_id,
            "doc_title":     self.doc_title,
            "unit_id":       self.unit_id,
            "unit_position": self.unit_position,
            "sent_id":       self.sent_id,
            "match_start":   self.match_start,
            "match_end":     self.match_end,
            "left":          self.left,
            "node":          self.node,
            "right":         self.right,
        }


# ─── Token row (for sliding window) ──────────────────────────────────────────

@dataclass
class _TRow:
    """One token fetched from the DB, ready for matching."""
    position: int
    word:     Optional[str]
    lemma:    Optional[str]
    upos:     Optional[str]
    xpos:     Optional[str]
    feats:    Optional[str]
    misc:     Optional[str]

    def get(self, attr: str) -> Optional[str]:
        return getattr(self, attr, None)


# ─── REGEXP registration ──────────────────────────────────────────────────────

def _register_regexp(conn: sqlite3.Connection) -> None:
    """Register a Python-backed REGEXP(pattern, value) function."""
    def _regexp(pattern: str, value: str | None) -> int:
        if value is None:
            return 0
        try:
            return 1 if re.search(pattern, value) else 0
        except re.error:
            return 0
    conn.create_function("REGEXP", 2, _regexp, deterministic=True)


# ─── SQL condition builder (Sprint C path) ────────────────────────────────────

def _is_plain(value: str) -> bool:
    """Return True if *value* contains no regex metacharacters."""
    return not re.search(r'[.+*?^${}()\[\]|\\]', value)


def _expr_to_sql(expr: BoolExpr, alias: str) -> tuple[str, list]:
    """Recursively convert a BoolExpr into (sql_fragment, params)."""
    if isinstance(expr, AttrTest):
        col = f"{alias}.{expr.attr}"
        val = expr.value
        if expr.case_insensitive:
            if _is_plain(val):
                return f"LOWER({col}) = LOWER(?)", [val]
            else:
                return f"LOWER({col}) REGEXP LOWER(?)", [val]
        else:
            if _is_plain(val):
                return f"{col} = ?", [val]
            else:
                return f"{col} REGEXP ?", [val]
    elif isinstance(expr, AndExpr):
        l_sql, l_p = _expr_to_sql(expr.left,  alias)
        r_sql, r_p = _expr_to_sql(expr.right, alias)
        return f"({l_sql} AND {r_sql})", l_p + r_p
    elif isinstance(expr, OrExpr):
        l_sql, l_p = _expr_to_sql(expr.left,  alias)
        r_sql, r_p = _expr_to_sql(expr.right, alias)
        return f"({l_sql} OR {r_sql})", l_p + r_p
    else:
        raise TypeError(f"Unknown BoolExpr type: {type(expr)}")


# ─── Python-side single-token matcher ─────────────────────────────────────────

def _match_expr(expr: BoolExpr, tok: _TRow) -> bool:
    """Evaluate a BoolExpr against a token row."""
    if isinstance(expr, AttrTest):
        val = tok.get(expr.attr)
        if val is None:
            return False
        pattern = expr.value
        if expr.case_insensitive:
            if _is_plain(pattern):
                return val.lower() == pattern.lower()
            else:
                return bool(re.search(pattern, val, re.IGNORECASE))
        else:
            if _is_plain(pattern):
                return val == pattern
            else:
                return bool(re.search(pattern, val))
    elif isinstance(expr, AndExpr):
        return _match_expr(expr.left, tok) and _match_expr(expr.right, tok)
    elif isinstance(expr, OrExpr):
        return _match_expr(expr.left, tok) or _match_expr(expr.right, tok)
    else:
        raise TypeError(f"Unknown BoolExpr type: {type(expr)}")


def _match_element(elem: PatternElement, tok: _TRow) -> bool:
    """Test if a single token satisfies a non-repeat pattern element."""
    if isinstance(elem, WildcardToken):
        return True
    if isinstance(elem, TokenConstraint):
        return _match_expr(elem.expr, tok)
    raise TypeError(f"Expected TokenConstraint or WildcardToken, got {type(elem)}")


# ─── Sliding-window matcher ────────────────────────────────────────────────────

@dataclass
class _Match:
    start: int   # position of first matched token
    end:   int   # position of last matched token (inclusive)


def _find_matches(
    pattern: list[PatternElement],
    tokens: list[_TRow],
) -> list[_Match]:
    """Return all non-overlapping matches of *pattern* in *tokens* (left-to-right).

    Uses backtracking recursion.  Pattern elements are consumed one at a time;
    :class:`RepeatToken` elements expand greedily then backtrack.
    """
    results: list[_Match] = []
    n = len(tokens)
    if not pattern or n == 0:
        return results

    def match(pat_idx: int, tok_idx: int, span_start: int) -> bool:
        """Return True and record match if the remaining pattern matches from tok_idx."""
        if pat_idx == len(pattern):
            results.append(_Match(start=span_start, end=tokens[tok_idx - 1].position))
            return True

        elem = pattern[pat_idx]

        if isinstance(elem, (TokenConstraint, WildcardToken)):
            if tok_idx >= n:
                return False
            tok = tokens[tok_idx]
            if not _match_element(elem, tok):
                return False
            return match(pat_idx + 1, tok_idx + 1, span_start)

        elif isinstance(elem, RepeatToken):
            inner = elem.inner
            lo, hi = elem.min, elem.max
            # Try all lengths from hi down to lo (greedy, then backtrack)
            for count in range(hi, lo - 1, -1):
                if tok_idx + count > n:
                    continue
                # Check that all `count` tokens satisfy inner
                ok = True
                for k in range(count):
                    if not _match_element(inner, tokens[tok_idx + k]):
                        ok = False
                        break
                if not ok:
                    continue
                # Recurse on the rest of the pattern
                saved = len(results)
                if match(pat_idx + 1, tok_idx + count, span_start):
                    return True
                # Discard any partial matches pushed during failed recursion
                del results[saved:]
            return False

        return False

    start_idx = 0
    while start_idx < n:
        if match(0, start_idx, tokens[start_idx].position):
            # Advance past the end of this match to avoid full overlap
            last = results[-1]
            # Find the token index just after the match end
            while start_idx < n and tokens[start_idx].position <= last.end:
                start_idx += 1
        else:
            start_idx += 1

    return results


# ─── Query complexity detection ───────────────────────────────────────────────

def _needs_sliding_window(query: CQLQuery) -> bool:
    """Return True if the query contains wildcards or repetitions."""
    for elem in query.tokens:
        if isinstance(elem, (WildcardToken, RepeatToken)):
            return True
    return False


def _first_concrete(query: CQLQuery) -> Optional[TokenConstraint]:
    """Return the first TokenConstraint in the query, or None."""
    for elem in query.tokens:
        if isinstance(elem, TokenConstraint):
            return elem
        if isinstance(elem, RepeatToken) and isinstance(elem.inner, TokenConstraint):
            return elem.inner
    return None


# ─── SQL path (Sprint C — fixed sequences) ───────────────────────────────────

def _run_sql_path(
    conn: sqlite3.Connection,
    query: CQLQuery,
    window: int,
    doc_ids: Optional[list[int]],
    limit: int,
    offset: int,
) -> tuple[list[KwicHit], int]:
    """Execute a fixed-length CQL query via SQL self-joins."""
    n = len(query.tokens)
    elems = query.tokens  # all TokenConstraint at this point

    from_parts = ["FROM tokens t1"]
    for i in range(2, n + 1):
        join = (
            f"JOIN tokens t{i}"
            f" ON t{i}.unit_id = t1.unit_id"
            f" AND t{i}.sent_id = t1.sent_id"
            f" AND t{i}.position = t{i - 1}.position + 1"
        )
        from_parts.append(join)

    where_parts: list[str] = []
    params: list = []

    for i, tc in enumerate(elems, start=1):
        assert isinstance(tc, TokenConstraint)
        sql_cond, cond_params = _expr_to_sql(tc.expr, f"t{i}")
        where_parts.append(sql_cond)
        params.extend(cond_params)

    if doc_ids:
        ph = ",".join("?" * len(doc_ids))
        where_parts.append(
            f"t1.unit_id IN (SELECT unit_id FROM units WHERE doc_id IN ({ph}))"
        )
        params.extend(doc_ids)

    from_clause  = "\n".join(from_parts)
    where_clause = " AND ".join(where_parts) if where_parts else "1=1"

    count_sql = f"SELECT COUNT(*) {from_clause} WHERE {where_clause}"
    total: int = conn.execute(count_sql, params).fetchone()[0]
    if total == 0 or offset >= total:
        return [], total

    match_sql = f"""
        SELECT t1.unit_id, t1.sent_id,
               t1.position        AS match_start,
               t{n}.position      AS match_end
        {from_clause}
        WHERE {where_clause}
        ORDER BY t1.unit_id, t1.sent_id, t1.position
        LIMIT ? OFFSET ?
    """
    match_rows = conn.execute(match_sql, params + [limit, offset]).fetchall()

    return _build_hits(conn, match_rows, window), total


# ─── Sliding-window path (Sprint D — wildcards / repetitions) ─────────────────

def _run_sliding_path(
    conn: sqlite3.Connection,
    query: CQLQuery,
    window: int,
    doc_ids: Optional[list[int]],
    limit: int,
    offset: int,
) -> tuple[list[KwicHit], int]:
    """Execute a variable-length CQL query via Python sliding window."""

    # Step 1 — collect candidate (unit_id, sent_id) pairs.
    # If the query has a concrete constraint somewhere, use it as a pre-filter.
    anchor = _first_concrete(query)
    candidate_params: list = []
    candidate_where = "1=1"

    if anchor:
        cond_sql, cond_p = _expr_to_sql(anchor.expr, "t")
        candidate_where = cond_sql
        candidate_params = cond_p

    doc_filter = ""
    if doc_ids:
        ph = ",".join("?" * len(doc_ids))
        doc_filter = f" AND t.unit_id IN (SELECT unit_id FROM units WHERE doc_id IN ({ph}))"
        candidate_params.extend(doc_ids)

    # Candidate sentences are always scoped at (unit_id, sent_id) level.
    # within_s is enforced implicitly: each candidate is a single sentence,
    # so all matched tokens in a sentence already share the same sent_id.
    candidate_sql = f"""
        SELECT DISTINCT t.unit_id, t.sent_id
        FROM tokens t
        WHERE {candidate_where}{doc_filter}
        ORDER BY t.unit_id, t.sent_id
    """

    candidates = conn.execute(candidate_sql, candidate_params).fetchall()

    # Step 2 — for each (unit_id, sent_id), fetch tokens and run the matcher.
    all_match_rows: list[tuple[int, int, int, int]] = []   # (unit_id, sent_id, start_pos, end_pos)

    for unit_id, sent_id in candidates:
        tok_rows = conn.execute(
            """
            SELECT position, word, lemma, upos, xpos, feats, misc
            FROM   tokens
            WHERE  unit_id = ? AND sent_id = ?
            ORDER  BY position
            """,
            (unit_id, sent_id),
        ).fetchall()

        tokens_in_sent = [
            _TRow(position=r[0], word=r[1], lemma=r[2],
                  upos=r[3], xpos=r[4], feats=r[5], misc=r[6])
            for r in tok_rows
        ]
        matches = _find_matches(query.tokens, tokens_in_sent)
        for m in matches:
            all_match_rows.append((unit_id, sent_id, m.start, m.end))

    total = len(all_match_rows)
    page  = all_match_rows[offset: offset + limit]

    return _build_hits(conn, page, window), total


# ─── Shared hit assembly ──────────────────────────────────────────────────────

def _build_hits(
    conn: sqlite3.Connection,
    match_rows: list[tuple],   # (unit_id, sent_id, match_start, match_end)
    window: int,
) -> list[KwicHit]:
    if not match_rows:
        return []

    unit_ids = list({row[0] for row in match_rows})
    ph = ",".join("?" * len(unit_ids))
    meta_rows = conn.execute(
        f"""
        SELECT u.unit_id, u.doc_id, u.position, d.title
        FROM   units u
        JOIN   documents d ON d.doc_id = u.doc_id
        WHERE  u.unit_id IN ({ph})
        """,
        unit_ids,
    ).fetchall()
    unit_meta: dict[int, tuple[int, int, str]] = {
        r[0]: (r[1], r[2], r[3] or "") for r in meta_rows
    }

    hits: list[KwicHit] = []
    for unit_id, sent_id, match_start, match_end in match_rows:
        doc_id, unit_pos, doc_title = unit_meta.get(unit_id, (0, 0, "?"))

        ctx_start = match_start - window
        ctx_end   = match_end   + window

        ctx_rows = conn.execute(
            """
            SELECT position, word
            FROM   tokens
            WHERE  unit_id = ? AND sent_id = ?
              AND  position BETWEEN ? AND ?
            ORDER  BY position
            """,
            (unit_id, sent_id, ctx_start, ctx_end),
        ).fetchall()

        pos_word: dict[int, str] = {r[0]: r[1] or "" for r in ctx_rows}

        left  = [pos_word[p] for p in range(ctx_start,     match_start) if p in pos_word]
        node  = [pos_word[p] for p in range(match_start,   match_end + 1) if p in pos_word]
        right = [pos_word[p] for p in range(match_end + 1, ctx_end + 1)  if p in pos_word]

        hits.append(KwicHit(
            doc_id=doc_id,
            doc_title=doc_title,
            unit_id=unit_id,
            unit_position=unit_pos,
            sent_id=sent_id,
            match_start=match_start,
            match_end=match_end,
            left=left,
            node=node,
            right=right,
        ))

    return hits


# ─── Public API ───────────────────────────────────────────────────────────────

def run_token_query(
    conn: sqlite3.Connection,
    query: CQLQuery,
    window: int = 5,
    doc_ids: Optional[list[int]] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[KwicHit], int]:
    """Execute *query* and return ``(hits, total_count)``.

    Automatically selects between the fast SQL join path (Sprint C, fixed
    sequences) and the Python sliding-window path (Sprint D, wildcards /
    repetitions).

    Parameters
    ----------
    conn:
        Open SQLite connection.  A Python REGEXP function will be registered.
    query:
        Parsed :class:`~cql_parser.CQLQuery`.
    window:
        Number of context tokens to return on each side of the match.
    doc_ids:
        Restrict the search to these document IDs.  ``None`` → whole corpus.
    limit / offset:
        Pagination parameters.
    """
    _register_regexp(conn)

    if _needs_sliding_window(query):
        return _run_sliding_path(conn, query, window, doc_ids, limit, offset)
    else:
        return _run_sql_path(conn, query, window, doc_ids, limit, offset)
