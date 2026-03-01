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
        if code == 200 and payload.get("status") == "ok" and payload.get("ok") is True:
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


@pytest.fixture()
def sidecar_base_url(tmp_path: Path) -> str:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "sidecar_contract.db"
    conn = get_connection(db_path)
    apply_migrations(conn)

    txt_path = tmp_path / "doc.txt"
    txt_path.write_text(
        "".join(f"[{i}] Bonjour needle {i}.\n" for i in range(1, 13)),
        encoding="utf-8",
    )
    pivot = import_txt_numbered_lines(conn=conn, path=txt_path, language="fr", title="Pivot")

    txt_target = tmp_path / "target.txt"
    txt_target.write_text(
        "".join(f"[{i}] Hello needle target {i}.\n" for i in range(1, 13)),
        encoding="utf-8",
    )
    target = import_txt_numbered_lines(
        conn=conn,
        path=txt_target,
        language="en",
        title="Target",
    )
    align_by_external_id(
        conn=conn,
        pivot_doc_id=pivot.doc_id,
        target_doc_ids=[target.doc_id],
        run_id="test-sidecar-query-align",
    )
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
    assert ok["ok"] is True
    assert ok["status"] == "ok"
    assert ok["api_version"] == API_VERSION
    assert ok["count"] == 1

    err = error_payload("bad input", code=ERR_BAD_REQUEST)
    assert err["ok"] is False
    assert err["status"] == "error"
    assert err["api_version"] == API_VERSION
    assert err["error"]["message"] == "bad input"
    assert err["error"]["type"] == ERR_BAD_REQUEST
    assert err["error_code"] == ERR_BAD_REQUEST


def test_openapi_spec_has_core_routes() -> None:
    from multicorpus_engine.sidecar_contract import API_VERSION, openapi_spec

    spec = openapi_spec()
    assert spec["openapi"] == "3.0.3"
    assert spec["info"]["version"] == API_VERSION
    for route in (
        "/health",
        "/openapi.json",
        "/query",
        "/index",
        "/import",
        "/shutdown",
        "/curate",
        "/validate-meta",
        "/segment",
    ):
        assert route in spec["paths"]


def test_health_includes_api_version(sidecar_base_url: str) -> None:
    code, payload = _http_json("GET", f"{sidecar_base_url}/health")
    assert code == 200
    assert payload["ok"] is True
    assert payload["status"] == "ok"
    assert "api_version" in payload
    assert "version" in payload
    assert isinstance(payload["pid"], int)
    assert isinstance(payload["started_at"], str)


def test_openapi_endpoint_contract(sidecar_base_url: str) -> None:
    code, payload = _http_json("GET", f"{sidecar_base_url}/openapi.json")
    assert code == 200
    assert payload["openapi"] == "3.0.3"
    assert "/query" in payload["paths"]


def test_unknown_route_returns_not_found_code(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_NOT_FOUND

    code, payload = _http_json("GET", f"{sidecar_base_url}/does-not-exist")
    assert code == 404
    assert payload["ok"] is False
    assert payload["status"] == "error"
    assert payload["error"]["type"] == ERR_NOT_FOUND
    assert payload["error_code"] == ERR_NOT_FOUND


def test_invalid_json_returns_bad_request(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code, payload = _http_invalid_json(f"{sidecar_base_url}/query")
    assert code == 400
    assert payload["ok"] is False
    assert payload["status"] == "error"
    assert payload["error"]["type"] == ERR_BAD_REQUEST
    assert payload["error_code"] == ERR_BAD_REQUEST


def test_query_success_contract(sidecar_base_url: str) -> None:
    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {"q": "needle", "mode": "segment"},
    )
    assert code == 200
    assert payload["ok"] is True
    assert payload["status"] == "ok"
    assert isinstance(payload["run_id"], str)
    assert isinstance(payload["count"], int)
    assert isinstance(payload["hits"], list)
    assert payload["count"] >= 1
    assert "aligned" not in payload["hits"][0]
    assert payload["limit"] == 50
    assert payload["offset"] == 0
    assert isinstance(payload["has_more"], bool)
    assert "next_offset" in payload
    assert "total" in payload


def test_query_pagination_page_flow(sidecar_base_url: str) -> None:
    code1, page1 = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {"q": "needle", "mode": "segment", "language": "fr", "limit": 5, "offset": 0},
    )
    assert code1 == 200
    assert page1["ok"] is True
    assert page1["count"] == 5
    assert page1["limit"] == 5
    assert page1["offset"] == 0
    assert page1["has_more"] is True
    assert page1["next_offset"] == 5

    code2, page2 = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {"q": "needle", "mode": "segment", "language": "fr", "limit": 5, "offset": 5},
    )
    assert code2 == 200
    assert page2["count"] == 5
    assert page2["offset"] == 5
    assert page2["has_more"] is True
    assert page2["next_offset"] == 10

    code3, page3 = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {"q": "needle", "mode": "segment", "language": "fr", "limit": 5, "offset": 10},
    )
    assert code3 == 200
    assert page3["count"] == 2
    assert page3["offset"] == 10
    assert page3["has_more"] is False
    assert page3["next_offset"] is None


def test_query_pagination_include_aligned(sidecar_base_url: str) -> None:
    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {
            "q": "needle",
            "mode": "segment",
            "language": "fr",
            "limit": 3,
            "offset": 0,
            "include_aligned": True,
            "aligned_limit": 1,
        },
    )
    assert code == 200
    assert payload["ok"] is True
    assert payload["count"] == 3
    assert payload["has_more"] is True
    assert payload["next_offset"] == 3
    for hit in payload["hits"]:
        assert "aligned" in hit
        assert isinstance(hit["aligned"], list)
        assert len(hit["aligned"]) <= 1


def test_query_pagination_invalid_values_return_400(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code1, payload1 = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {"q": "needle", "limit": 0},
    )
    assert code1 == 400
    assert payload1["ok"] is False
    assert payload1["error"]["type"] == ERR_BAD_REQUEST

    code2, payload2 = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {"q": "needle", "limit": 201},
    )
    assert code2 == 400
    assert payload2["ok"] is False
    assert payload2["error"]["type"] == ERR_BAD_REQUEST

    code3, payload3 = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {"q": "needle", "offset": -1},
    )
    assert code3 == 400
    assert payload3["ok"] is False
    assert payload3["error"]["type"] == ERR_BAD_REQUEST


def test_query_include_aligned_contract(sidecar_base_url: str) -> None:
    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {"q": "needle", "mode": "segment", "include_aligned": True, "aligned_limit": 1},
    )
    assert code == 200
    assert payload["ok"] is True
    assert isinstance(payload["hits"], list)
    assert payload["count"] >= 1

    for hit in payload["hits"]:
        assert "aligned" in hit
        assert isinstance(hit["aligned"], list)
        assert len(hit["aligned"]) <= 1
        for item in hit["aligned"]:
            assert {"doc_id", "unit_id", "language", "title", "external_id", "text_norm", "text"} <= set(
                item.keys()
            )


def test_segment_missing_doc_id_is_bad_request(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code, payload = _http_json("POST", f"{sidecar_base_url}/segment", {})
    assert code == 400
    assert payload["ok"] is False
    assert payload["status"] == "error"
    assert payload["error_code"] == ERR_BAD_REQUEST


def test_segment_accepts_pack_and_returns_resolved_pack(sidecar_base_url: str) -> None:
    docs_code, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    assert docs_code == 200
    doc_id = docs_payload["documents"][0]["doc_id"]

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/segment",
        {"doc_id": doc_id, "lang": "fr", "pack": "fr_strict"},
    )
    assert code == 200
    assert payload["ok"] is True
    assert payload["doc_id"] == doc_id
    assert payload["segment_pack"] == "fr_strict"


def test_segment_invalid_pack_is_bad_request(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    docs_code, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    assert docs_code == 200
    doc_id = docs_payload["documents"][0]["doc_id"]

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/segment",
        {"doc_id": doc_id, "pack": "unknown_pack"},
    )
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_validate_meta_keeps_contract_shape(sidecar_base_url: str) -> None:
    code, payload = _http_json("POST", f"{sidecar_base_url}/validate-meta", {})
    assert code == 200
    assert payload["ok"] is True
    assert payload["status"] in ("ok", "warnings")
    assert "docs_validated" in payload
    assert isinstance(payload["results"], list)


def test_documents_returns_list(sidecar_base_url: str) -> None:
    code, payload = _http_json("GET", f"{sidecar_base_url}/documents")
    assert code == 200
    assert payload["ok"] is True
    assert payload["status"] == "ok"
    assert isinstance(payload["documents"], list)
    assert isinstance(payload["count"], int)
    assert payload["count"] >= 2  # fixture imports pivot + target
    doc = payload["documents"][0]
    for key in ("doc_id", "title", "language", "unit_count"):
        assert key in doc
    assert isinstance(doc["doc_id"], int)
    assert isinstance(doc["unit_count"], int)


def test_align_external_id_via_sidecar(sidecar_base_url: str, tmp_path: Path) -> None:
    # First get the doc_ids from /documents
    _, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    docs = docs_payload["documents"]
    assert len(docs) >= 2
    pivot_id = docs[0]["doc_id"]
    target_id = docs[1]["doc_id"]

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/align",
        {
            "pivot_doc_id": pivot_id,
            "target_doc_ids": [target_id],
            "strategy": "external_id",
            "run_id": "sidecar-test-align",
        },
    )
    assert code == 200
    assert payload["ok"] is True
    assert payload["status"] == "ok"
    assert isinstance(payload["run_id"], str)
    assert payload["strategy"] == "external_id"
    assert payload["pivot_doc_id"] == pivot_id
    assert isinstance(payload["reports"], list)
    assert len(payload["reports"]) == 1
    assert isinstance(payload.get("total_links_created"), int)

    report_path = tmp_path / "align_run_report.jsonl"
    code_report, payload_report = _http_json(
        "POST",
        f"{sidecar_base_url}/export/run_report",
        {
            "out_path": str(report_path),
            "run_id": payload["run_id"],
            "format": "jsonl",
        },
    )
    assert code_report == 200
    assert payload_report["ok"] is True
    assert payload_report["runs_exported"] == 1
    assert report_path.exists()
    lines = report_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    row = json.loads(lines[0])
    assert row["run_id"] == payload["run_id"]
    assert row["kind"] == "align"
    assert row["stats"]["strategy"] == "external_id"


def test_align_hybrid_external_id_then_position_via_sidecar(sidecar_base_url: str) -> None:
    _, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    docs = docs_payload["documents"]
    pivot_id = docs[0]["doc_id"]
    target_id = docs[1]["doc_id"]

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/align",
        {
            "pivot_doc_id": pivot_id,
            "target_doc_ids": [target_id],
            "strategy": "external_id_then_position",
            "run_id": "sidecar-test-align-hybrid",
        },
    )
    assert code == 200
    assert payload["ok"] is True
    assert payload["strategy"] == "external_id_then_position"
    assert len(payload["reports"]) == 1
    report = payload["reports"][0]
    assert report["links_created"] >= 1
    assert "links_skipped" in report


def test_align_debug_payload_when_requested(sidecar_base_url: str) -> None:
    _, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    docs = docs_payload["documents"]
    pivot_id = docs[0]["doc_id"]
    target_id = docs[1]["doc_id"]

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/align",
        {
            "pivot_doc_id": pivot_id,
            "target_doc_ids": [target_id],
            "strategy": "external_id_then_position",
            "debug_align": True,
            "run_id": "sidecar-test-align-debug",
        },
    )
    assert code == 200
    assert payload["ok"] is True
    assert payload["debug_align"] is True
    report = payload["reports"][0]
    assert "debug" in report
    debug = report["debug"]
    assert debug["strategy"] == "external_id_then_position"
    assert "link_sources" in debug


def test_align_missing_params_is_bad_request(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code, payload = _http_json("POST", f"{sidecar_base_url}/align", {})
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_align_invalid_strategy_is_bad_request(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    _, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    docs = docs_payload["documents"]

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/align",
        {
            "pivot_doc_id": docs[0]["doc_id"],
            "target_doc_ids": [docs[1]["doc_id"]],
            "strategy": "bogus_strategy",
        },
    )
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_align_invalid_debug_align_is_bad_request(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    _, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    docs = docs_payload["documents"]

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/align",
        {
            "pivot_doc_id": docs[0]["doc_id"],
            "target_doc_ids": [docs[1]["doc_id"]],
            "strategy": "external_id",
            "debug_align": "yes",
        },
    )
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_openapi_spec_has_documents_and_align_routes() -> None:
    from multicorpus_engine.sidecar_contract import openapi_spec

    spec = openapi_spec()
    assert "/documents" in spec["paths"]
    assert "/align" in spec["paths"]
    assert "get" in spec["paths"]["/documents"]
    assert "post" in spec["paths"]["/align"]
    schemas = spec["components"]["schemas"]
    assert "DocumentRecord" in schemas
    assert "DocumentsResponse" in schemas
    assert "AlignRequest" in schemas
    assert "AlignResponse" in schemas
