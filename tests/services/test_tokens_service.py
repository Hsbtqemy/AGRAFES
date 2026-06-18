"""Direct unit tests for the tokens service (audit P0-1 / A-01).

Pagination, filtering and single-token edits, without an HTTP server. The adapters
are covered over HTTP by tests/test_sidecar_tokens.py + the binary smoke
(GET /tokens).
"""

from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.errors import BadRequestError, NotFoundError
from multicorpus_engine.services.tokens_service import list_tokens, update_token


def _mk_tokens(conn: sqlite3.Connection, n_tokens: int = 3) -> tuple[int, int, list[int]]:
    dc = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('D', 'fr', 'standalone', datetime('now'))"
    )
    doc_id = dc.lastrowid
    uc = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?, 'line', 1, 'x', 'x')",
        (doc_id,),
    )
    unit_id = uc.lastrowid
    token_ids = []
    for i in range(1, n_tokens + 1):
        tc = conn.execute(
            "INSERT INTO tokens (unit_id, sent_id, position, word, lemma, upos)"
            " VALUES (?, 1, ?, ?, ?, 'NOUN')",
            (unit_id, i, f"w{i}", f"l{i}"),
        )
        token_ids.append(tc.lastrowid)
    conn.commit()
    return doc_id, unit_id, token_ids


# --- list_tokens ----------------------------------------------------------------
def test_list_tokens_pagination(db_conn: sqlite3.Connection) -> None:
    doc_id, _, _ = _mk_tokens(db_conn, 3)
    page1 = list_tokens(db_conn, str(doc_id), None, "2", "0")
    assert page1["total"] == 3 and page1["count"] == 2
    assert page1["has_more"] is True and page1["next_offset"] == 2
    page2 = list_tokens(db_conn, str(doc_id), None, "2", "2")
    assert page2["count"] == 1 and page2["has_more"] is False and page2["next_offset"] is None
    # token rows are fully shaped
    assert set(page1["tokens"][0]) == {
        "token_id", "doc_id", "unit_id", "unit_n", "external_id",
        "sent_id", "position", "word", "lemma", "upos", "xpos", "feats", "misc",
    }


def test_list_tokens_unit_filter_and_empty(db_conn: sqlite3.Connection) -> None:
    doc_id, unit_id, _ = _mk_tokens(db_conn, 2)
    assert list_tokens(db_conn, str(doc_id), str(unit_id))["count"] == 2
    assert list_tokens(db_conn, str(doc_id), str(unit_id + 999))["count"] == 0


@pytest.mark.parametrize("args", [
    (None, None, "200", "0"),          # missing doc_id
    ("abc", None, "200", "0"),         # non-int doc_id
    ("0", None, "200", "0"),           # doc_id <= 0
    ("1", "x", "200", "0"),            # non-int unit_id
    ("1", "0", "200", "0"),            # unit_id <= 0
    ("1", None, "x", "0"),             # non-int limit
    ("1", None, "0", "0"),             # limit < 1
    ("1", None, "1001", "0"),          # limit > 1000
    ("1", None, "200", "-1"),          # offset < 0
])
def test_list_tokens_validation(db_conn: sqlite3.Connection, args) -> None:
    with pytest.raises(BadRequestError):
        list_tokens(db_conn, *args)


# --- update_token ---------------------------------------------------------------
def test_update_token_success(db_conn: sqlite3.Connection) -> None:
    _, _, token_ids = _mk_tokens(db_conn, 1)
    out = update_token(db_conn, {"token_id": token_ids[0], "lemma": "nouveau", "upos": None})
    assert out["updated"] == 1
    assert out["token"]["lemma"] == "nouveau"
    assert out["token"]["upos"] is None
    assert out["token"]["token_id"] == token_ids[0]


@pytest.mark.parametrize("body", [
    {},                                          # missing token_id
    {"token_id": "x", "lemma": "a"},             # non-int
    {"token_id": 0, "lemma": "a"},               # <= 0
    {"token_id": 1, "lemma": 123},               # non-string field
    {"token_id": 1},                             # no updatable field
])
def test_update_token_bad_request(db_conn: sqlite3.Connection, body: dict) -> None:
    with pytest.raises(BadRequestError):
        update_token(db_conn, body)


def test_update_token_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        update_token(db_conn, {"token_id": 99999, "lemma": "x"})
