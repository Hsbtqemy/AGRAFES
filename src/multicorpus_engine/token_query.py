"""Execute CQL queries against the ``tokens`` table.

Strategy
--------
For a sequence of N token constraints, the query builds N-1 self-joins on the
``tokens`` table (t1 … tN), anchored by position continuity within the same
``(unit_id, sent_id)`` window.  The WHERE clause injects one SQL condition per
token constraint.

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

    query = parse_cql('[lemma="manger" & upos="VERB"][upos="ADV" %c]')
    hits, total = run_token_query(conn, query, window=5, limit=100, offset=0)
    for h in hits:
        print(h.left, "**", h.node, "**", h.right)
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

from .cql_parser import AttrTest, AndExpr, OrExpr, BoolExpr, CQLQuery


# ─── Result type ──────────────────────────────────────────────────────────────

@dataclass
class KwicHit:
    doc_id: int
    doc_title: str
    unit_id: int
    unit_position: int   # ordinal position of the unit within its document
    sent_id: int
    match_start: int     # position of first matched token (within unit/sent)
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


# ─── SQL condition builder ────────────────────────────────────────────────────

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


# ─── Main function ────────────────────────────────────────────────────────────

def run_token_query(
    conn: sqlite3.Connection,
    query: CQLQuery,
    window: int = 5,
    doc_ids: Optional[list[int]] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[KwicHit], int]:
    """Execute *query* and return ``(hits, total_count)``.

    Parameters
    ----------
    conn:
        Open SQLite connection (read-only access is sufficient).
        A Python REGEXP function will be registered on it.
    query:
        Parsed :class:`~cql_parser.CQLQuery`.
    window:
        Number of context tokens to return on each side of the match.
    doc_ids:
        Restrict the search to these document IDs.  ``None`` searches
        the entire corpus.
    limit / offset:
        Pagination parameters.

    Returns
    -------
    tuple[list[KwicHit], int]
        A page of KWIC hits and the total number of matches (before pagination).
    """
    _register_regexp(conn)
    n = len(query.tokens)

    # ── Build FROM / JOIN ────────────────────────────────────────────────────
    from_parts = ["FROM tokens t1"]
    for i in range(2, n + 1):
        from_parts.append(
            f"JOIN tokens t{i}"
            f" ON t{i}.unit_id = t1.unit_id"
            f" AND t{i}.sent_id = t1.sent_id"
            f" AND t{i}.position = t{i - 1}.position + 1"
        )

    # ── Build WHERE conditions ────────────────────────────────────────────────
    where_parts: list[str] = []
    params: list = []

    for i, tc in enumerate(query.tokens, start=1):
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

    # ── Count ────────────────────────────────────────────────────────────────
    count_sql = f"SELECT COUNT(*) {from_clause} WHERE {where_clause}"
    total: int = conn.execute(count_sql, params).fetchone()[0]

    if total == 0 or offset >= total:
        return [], total

    # ── Fetch match positions (paginated) ─────────────────────────────────────
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

    if not match_rows:
        return [], total

    # ── Fetch unit / document metadata ───────────────────────────────────────
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
    # unit_id → (doc_id, unit_position, doc_title)
    unit_meta: dict[int, tuple[int, int, str]] = {
        r[0]: (r[1], r[2], r[3]) for r in meta_rows
    }

    # ── Assemble KWIC hits ────────────────────────────────────────────────────
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

    return hits, total
