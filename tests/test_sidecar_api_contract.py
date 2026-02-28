"""Contract tests for sidecar API payload shape and error semantics."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


def _http_json(method: str, url: str, payload: dict | None = None) -> tuple[int, dict]:
    data: bytes | None = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = Request(url, method=method, data=data, headers=headers)
    try:
        with urlopen(req, timeout=10.0) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body)
    except HTTPError as exc:
        body = exc.read().decode("utf-8")
        return exc.code, json.loads(body)


def _http_invalid_json(url: str) -> tuple[int, dict]:
    req = Request(
        url,
        method="POST",
        data=b"{bad json",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    try:
        with urlopen(req, timeout=10.0) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body)
    except HTTPError as exc:
        body = exc.read().decode("utf-8")
        return exc.code, json.loads(body)


def _wait_health(base_url: str, tries: int = 50) -> None:
    import time

    for _ in range(tries):
        code, payload = _http_json("GET", f"{base_url}/health")
        if code == 200 and payload.get("status") == "ok":
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


@pytest.fixture()
def sidecar_base_url(tmp_path: Path) -> str:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "sidecar_contract.db"
    conn = get_connection(db_path)
    apply_migrations(conn)

    txt_path = tmp_path / "doc.txt"
    txt_path.write_text("[1] Bonjour needle.\n[2] Salut.\n", encoding="utf-8")
    import_txt_numbered_lines(conn=conn, path=txt_path, language="fr", title="T")
    build_index(conn)
    conn.close()

    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0)
    server.start()
    base_url = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base_url)
    try:
        yield base_url
    finally:
        server.shutdown()


def test_contract_payload_builders() -> None:
    from multicorpus_engine.sidecar_contract import (
        API_VERSION,
        ERR_BAD_REQUEST,
        error_payload,
        success_payload,
    )

    ok = success_payload({"count": 1})
    assert ok["status"] == "ok"
    assert ok["api_version"] == API_VERSION
    assert ok["count"] == 1

    err = error_payload("bad input", code=ERR_BAD_REQUEST)
    assert err["status"] == "error"
    assert err["api_version"] == API_VERSION
    assert err["error"] == "bad input"
    assert err["error_code"] == ERR_BAD_REQUEST


def test_openapi_spec_has_core_routes() -> None:
    from multicorpus_engine.sidecar_contract import API_VERSION, openapi_spec

    spec = openapi_spec()
    assert spec["openapi"] == "3.0.3"
    assert spec["info"]["version"] == API_VERSION
    for route in ("/health", "/openapi.json", "/query", "/index", "/curate", "/validate-meta", "/segment"):
        assert route in spec["paths"]


def test_health_includes_api_version(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import API_VERSION

    code, payload = _http_json("GET", f"{sidecar_base_url}/health")
    assert code == 200
    assert payload["status"] == "ok"
    assert payload["api_version"] == API_VERSION


def test_openapi_endpoint_contract(sidecar_base_url: str) -> None:
    code, payload = _http_json("GET", f"{sidecar_base_url}/openapi.json")
    assert code == 200
    assert payload["openapi"] == "3.0.3"
    assert "/query" in payload["paths"]


def test_unknown_route_returns_not_found_code(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_NOT_FOUND

    code, payload = _http_json("GET", f"{sidecar_base_url}/does-not-exist")
    assert code == 404
    assert payload["status"] == "error"
    assert payload["error_code"] == ERR_NOT_FOUND


def test_invalid_json_returns_bad_request(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code, payload = _http_invalid_json(f"{sidecar_base_url}/query")
    assert code == 400
    assert payload["status"] == "error"
    assert payload["error_code"] == ERR_BAD_REQUEST


def test_query_success_contract(sidecar_base_url: str) -> None:
    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {"q": "needle", "mode": "segment"},
    )
    assert code == 200
    assert payload["status"] == "ok"
    assert isinstance(payload["count"], int)
    assert isinstance(payload["hits"], list)
    assert payload["count"] >= 1


def test_segment_missing_doc_id_is_bad_request(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code, payload = _http_json("POST", f"{sidecar_base_url}/segment", {})
    assert code == 400
    assert payload["status"] == "error"
    assert payload["error_code"] == ERR_BAD_REQUEST


def test_validate_meta_keeps_contract_shape(sidecar_base_url: str) -> None:
    code, payload = _http_json("POST", f"{sidecar_base_url}/validate-meta", {})
    assert code == 200
    assert payload["status"] in ("ok", "warnings")
    assert "docs_validated" in payload
    assert isinstance(payload["results"], list)
