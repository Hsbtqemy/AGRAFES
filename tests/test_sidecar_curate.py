"""HTTP tests for the curate-exceptions / apply-history endpoints (A-01 adapters).

These cover the thin adapters end-to-end (wire codes + shapes) — there was no
prior HTTP test for these routes. Runs in CI (the in-process server path); the
service logic itself is unit-tested in tests/services/test_curate_service.py.
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
def curate_env(tmp_path: Path):
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "curate.db"
    conn = get_connection(db_path)
    apply_migrations(conn)
    cur = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('D', 'fr', 'standalone', datetime('now'))"
    )
    doc_id = cur.lastrowid
    cur2 = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?, 'line', 1, 'x', 'x')",
        (doc_id,),
    )
    unit_id = cur2.lastrowid
    conn.commit()
    conn.close()

    token = "curate-token"
    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0, token=token)
    server.start()
    base = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base)
    try:
        yield {"base": base, "token": token, "doc_id": doc_id, "unit_id": unit_id}
    finally:
        server.shutdown()


def test_exceptions_get_empty(curate_env: dict) -> None:
    code, body = _http("GET", f"{curate_env['base']}/curate/exceptions")
    assert code == 200, body
    assert body["exceptions"] == [] and body["count"] == 0


def test_exceptions_set_validation_400(curate_env: dict) -> None:
    code, body = _http(
        "POST", f"{curate_env['base']}/curate/exceptions/set",
        {"kind": "ignore"}, token=curate_env["token"],
    )
    assert code == 400, body
    assert body["ok"] is False


def test_exceptions_set_unit_not_found_404(curate_env: dict) -> None:
    code, body = _http(
        "POST", f"{curate_env['base']}/curate/exceptions/set",
        {"unit_id": 99999, "kind": "ignore"}, token=curate_env["token"],
    )
    assert code == 404, body


def test_exceptions_set_then_list_then_delete(curate_env: dict) -> None:
    base, token, unit_id = curate_env["base"], curate_env["token"], curate_env["unit_id"]
    code, body = _http(
        "POST", f"{base}/curate/exceptions/set",
        {"unit_id": unit_id, "kind": "override", "override_text": "Y"}, token=token,
    )
    assert code == 200, body
    assert body["action"] == "set" and body["override_text"] == "Y"

    code, body = _http("GET", f"{base}/curate/exceptions")
    assert code == 200
    assert body["count"] == 1 and body["exceptions"][0]["unit_id"] == unit_id

    code, body = _http("POST", f"{base}/curate/exceptions/delete", {"unit_id": unit_id}, token=token)
    assert code == 200
    assert body["deleted"] is True


def test_apply_history_record_then_list(curate_env: dict) -> None:
    base, token = curate_env["base"], curate_env["token"]
    code, body = _http(
        "POST", f"{base}/curate/apply-history/record",
        {"scope": "all", "docs_curated": 2}, token=token,
    )
    assert code == 200, body
    assert isinstance(body["id"], int)

    code, body = _http("GET", f"{base}/curate/apply-history")
    assert code == 200
    assert body["count"] == 1
    assert body["events"][0]["docs_curated"] == 2
