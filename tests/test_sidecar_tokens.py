"""HTTP tests for the tokens list/update adapters (A-01).

v04 only covered the /tokens/update auth gate (401); this adds the functional
behaviour (GET pagination + validation, update 200/400/404). Runs in CI; the
service logic is unit-tested in tests/services/test_tokens_service.py.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


def _http(method: str, url: str, payload: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    if token:
        headers["X-Agrafes-Token"] = token
    req = Request(url, method=method, data=data, headers=headers)
    try:
        with urlopen(req, timeout=10.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _wait_health(base_url: str, tries: int = 50) -> None:
    for _ in range(tries):
        try:
            code, body = _http("GET", f"{base_url}/health")
            if code == 200 and body.get("ok") is True:
                return
        except Exception:
            pass
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


@pytest.fixture()
def tokens_env(tmp_path: Path):
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "tokens.db"
    conn = get_connection(db_path)
    apply_migrations(conn)
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
    tc = conn.execute(
        "INSERT INTO tokens (unit_id, sent_id, position, word, lemma, upos)"
        " VALUES (?, 1, 1, 'w', 'l', 'NOUN')",
        (unit_id,),
    )
    token_id = tc.lastrowid
    conn.commit()
    conn.close()

    token = "tokens-token"
    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0, token=token)
    server.start()
    base = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base)
    try:
        yield {"base": base, "token": token, "doc_id": doc_id, "token_id": token_id}
    finally:
        server.shutdown()


def test_tokens_list_get(tokens_env: dict) -> None:
    base, doc_id = tokens_env["base"], tokens_env["doc_id"]
    code, body = _http("GET", f"{base}/tokens?doc_id={doc_id}")
    assert code == 200, body
    assert body["doc_id"] == doc_id and body["total"] == 1 and body["count"] == 1
    assert body["has_more"] is False
    assert body["tokens"][0]["lemma"] == "l"


def test_tokens_list_requires_doc_id(tokens_env: dict) -> None:
    code, body = _http("GET", f"{tokens_env['base']}/tokens")
    assert code == 400, body


def test_tokens_list_bad_limit(tokens_env: dict) -> None:
    base, doc_id = tokens_env["base"], tokens_env["doc_id"]
    code, body = _http("GET", f"{base}/tokens?doc_id={doc_id}&limit=5000")
    assert code == 400, body


def test_tokens_update_success(tokens_env: dict) -> None:
    base, token, token_id = tokens_env["base"], tokens_env["token"], tokens_env["token_id"]
    code, body = _http(
        "POST", f"{base}/tokens/update",
        {"token_id": token_id, "lemma": "nouveau"}, token=token,
    )
    assert code == 200, body
    assert body["updated"] == 1 and body["token"]["lemma"] == "nouveau"


def test_tokens_update_unknown_404(tokens_env: dict) -> None:
    base, token = tokens_env["base"], tokens_env["token"]
    code, body = _http(
        "POST", f"{base}/tokens/update", {"token_id": 99999, "lemma": "x"}, token=token,
    )
    assert code == 404, body


def test_tokens_update_no_fields_400(tokens_env: dict) -> None:
    base, token, token_id = tokens_env["base"], tokens_env["token"], tokens_env["token_id"]
    code, body = _http(
        "POST", f"{base}/tokens/update", {"token_id": token_id}, token=token,
    )
    assert code == 400, body
