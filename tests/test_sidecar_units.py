"""HTTP tests for the units update_text / list adapters (A-01).

set_role / bulk_set_role are already covered by tests/test_sidecar_conventions.py;
this fills the gap for update_text (write) and GET /units (read). Runs in CI; the
service logic is unit-tested in tests/services/test_units_service.py.
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
def units_env(tmp_path: Path):
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "units.db"
    conn = get_connection(db_path)
    apply_migrations(conn)
    cur = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('D', 'fr', 'standalone', datetime('now'))"
    )
    doc_id = cur.lastrowid
    c = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?, 'line', 1, 'orig', 'orig')",
        (doc_id,),
    )
    unit_id = c.lastrowid
    conn.commit()
    conn.close()

    token = "units-token"
    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0, token=token)
    server.start()
    base = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base)
    try:
        yield {"base": base, "token": token, "doc_id": doc_id, "unit_id": unit_id}
    finally:
        server.shutdown()


def test_units_list_get(units_env: dict) -> None:
    base, doc_id = units_env["base"], units_env["doc_id"]
    code, body = _http("GET", f"{base}/units?doc_id={doc_id}")
    assert code == 200, body
    assert body["doc_id"] == doc_id and body["count"] == 1
    assert body["units"][0]["n"] == 1


def test_units_list_requires_doc_id(units_env: dict) -> None:
    code, body = _http("GET", f"{units_env['base']}/units")
    assert code == 400, body
    assert body["ok"] is False


def test_update_text_success(units_env: dict) -> None:
    base, token, unit_id = units_env["base"], units_env["token"], units_env["unit_id"]
    code, body = _http(
        "POST", f"{base}/units/update_text",
        {"unit_id": unit_id, "text_raw": "Modifié"}, token=token,
    )
    assert code == 200, body
    assert body["text_raw"] == "Modifié" and body["text_norm"] == "Modifié"
    assert body["unit_id"] == unit_id


def test_update_text_unknown_unit_404(units_env: dict) -> None:
    base, token = units_env["base"], units_env["token"]
    code, body = _http(
        "POST", f"{base}/units/update_text",
        {"unit_id": 99999, "text_raw": "x"}, token=token,
    )
    assert code == 404, body


def test_update_text_missing_fields_400(units_env: dict) -> None:
    base, token, unit_id = units_env["base"], units_env["token"], units_env["unit_id"]
    code, body = _http(
        "POST", f"{base}/units/update_text", {"unit_id": unit_id}, token=token,
    )
    assert code == 400, body
