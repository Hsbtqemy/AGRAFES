"""Tokens domain service — audit P0-1 / A-01.

Token listing (paginated, for manual annotation review) and single-token edits,
extracted verbatim from the sidecar ``_handle_tokens_*`` handlers. Pure w.r.t.
transport: each function takes a connection + request inputs and returns response
*data*. The adapter owns the write-lock (writes only — ``list_tokens`` is a
lock-free read like the original), the schema backfill (``_ensure_tokens_table``)
and the HTTP envelope, mapping BadRequestError -> ERR_BAD_REQUEST and
NotFoundError -> ERR_NOT_FOUND.
"""

from __future__ import annotations

import sqlite3
from typing import Any, Optional

from .errors import BadRequestError, NotFoundError
from .validation import Field, validate

# Token projection shared by list + update (JOIN units for doc_id / unit_n / external_id).
_TOKEN_SELECT = """
    SELECT t.token_id, u.doc_id, t.unit_id, u.n AS unit_n, u.external_id,
           t.sent_id, t.position, t.word, t.lemma, t.upos, t.xpos, t.feats, t.misc
    FROM tokens t
    JOIN units u ON u.unit_id = t.unit_id
"""

_TOKEN_UPDATABLE = ("word", "lemma", "upos", "xpos", "feats", "misc")


def _token_row(r: tuple) -> dict[str, Any]:
    return {
        "token_id": r[0], "doc_id": r[1], "unit_id": r[2], "unit_n": r[3],
        "external_id": r[4], "sent_id": r[5], "position": r[6], "word": r[7],
        "lemma": r[8], "upos": r[9], "xpos": r[10], "feats": r[11], "misc": r[12],
    }


def list_tokens(
    conn: sqlite3.Connection,
    doc_id_raw: Optional[str],
    unit_id_raw: Optional[str] = None,
    limit_raw: object = "200",
    offset_raw: object = "0",
) -> dict[str, Any]:
    """Paginated token rows for a document (GET /tokens). Raises BadRequestError.

    ``*_raw`` are the raw query-param values; the adapter extracts them.
    """
    if doc_id_raw is None:
        raise BadRequestError("doc_id query param is required")
    try:
        doc_id = int(doc_id_raw)
    except (TypeError, ValueError):
        raise BadRequestError("doc_id must be an integer")
    if doc_id <= 0:
        raise BadRequestError("doc_id must be a positive integer")

    unit_id: Optional[int] = None
    if unit_id_raw is not None:
        try:
            unit_id = int(unit_id_raw)
        except (TypeError, ValueError):
            raise BadRequestError("unit_id must be an integer")
        if unit_id <= 0:
            raise BadRequestError("unit_id must be a positive integer")

    try:
        limit = int(limit_raw)
        offset = int(offset_raw)
    except (TypeError, ValueError):
        raise BadRequestError("limit and offset must be integers")
    if limit < 1 or limit > 1000:
        raise BadRequestError("limit must be between 1 and 1000")
    if offset < 0:
        raise BadRequestError("offset must be >= 0")

    filters = ["u.doc_id = ?"]
    params: list[object] = [doc_id]
    if unit_id is not None:
        filters.append("t.unit_id = ?")
        params.append(unit_id)
    where_sql = " AND ".join(filters)

    total = int(
        conn.execute(
            f"SELECT COUNT(*) FROM tokens t JOIN units u ON u.unit_id = t.unit_id WHERE {where_sql}",
            params,
        ).fetchone()[0]
        or 0
    )
    rows = conn.execute(
        f"{_TOKEN_SELECT} WHERE {where_sql} ORDER BY u.n, t.sent_id, t.position LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()
    tokens = [_token_row(r) for r in rows]
    count = len(tokens)
    has_more = (offset + count) < total
    next_offset = offset + limit if has_more else None
    return {
        "doc_id": doc_id, "unit_id": unit_id, "tokens": tokens, "count": count,
        "total": total, "limit": limit, "offset": offset,
        "next_offset": next_offset, "has_more": has_more,
    }


_TOKEN_UPDATE_SCHEMA = (
    Field("token_id", int, coerce=True, min=1, error=BadRequestError),
    *(Field(k, str, required=False, nullable=True, error=BadRequestError) for k in _TOKEN_UPDATABLE),
)


def update_token(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Update annotation fields of one token (POST /tokens/update).

    Raises BadRequestError (bad token_id, non-string field, no fields) or
    NotFoundError (unknown token_id).
    """
    clean = validate(body, _TOKEN_UPDATE_SCHEMA)
    token_id = clean["token_id"]
    updates: dict[str, object] = {k: clean[k] for k in _TOKEN_UPDATABLE if k in clean}
    if not updates:
        raise BadRequestError(
            "No updatable token fields provided (allowed: word, lemma, upos, xpos, feats, misc)"
        )

    set_clause = ", ".join(f"{field} = ?" for field in updates)
    params = [*updates.values(), token_id]
    cur = conn.execute(f"UPDATE tokens SET {set_clause} WHERE token_id = ?", params)
    conn.commit()
    if cur.rowcount == 0:
        raise NotFoundError(f"Unknown token_id: {token_id}")

    row = conn.execute(f"{_TOKEN_SELECT} WHERE t.token_id = ?", (token_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"Unknown token_id: {token_id}")
    return {"updated": 1, "token": _token_row(row)}
