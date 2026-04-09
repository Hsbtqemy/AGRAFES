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


@pytest.fixture()
def federated_sidecar_context(tmp_path: Path) -> dict[str, str]:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_a = (tmp_path / "federated_a.db").resolve()
    conn_a = get_connection(db_a)
    apply_migrations(conn_a)
    txt_a = tmp_path / "federated_a.txt"
    txt_a.write_text(
        "".join(f"[{i}] federatedneedle A {i}.\n" for i in range(1, 5)),
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn=conn_a, path=txt_a, language="fr", title="Federated A")
    build_index(conn_a)
    conn_a.close()

    db_b = (tmp_path / "federated_b.db").resolve()
    conn_b = get_connection(db_b)
    apply_migrations(conn_b)
    txt_b = tmp_path / "federated_b.txt"
    txt_b.write_text(
        "".join(f"[{i}] federatedneedle B {i}.\n" for i in range(1, 5)),
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn=conn_b, path=txt_b, language="en", title="Federated B")
    build_index(conn_b)
    conn_b.close()

    server = CorpusServer(db_path=db_a, host="127.0.0.1", port=0)
    server.start()
    base_url = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base_url)
    try:
        yield {
            "base_url": base_url,
            "db_a": str(db_a),
            "db_b": str(db_b),
        }
    finally:
        server.shutdown()


@pytest.fixture()
def token_query_sidecar_base_url(tmp_path: Path) -> str:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.conllu import import_conllu
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "sidecar_token_query.db"
    conn = get_connection(db_path)
    apply_migrations(conn)

    fr_path = tmp_path / "fr.conllu"
    fr_path.write_text(
        (
            "# sent_id = 1\n"
            "# text = Le Livre rouge arrive.\n"
            "1\tLe\tle\tDET\t_\t_\t0\troot\t_\t_\n"
            "2\tLivre\tlivre\tNOUN\t_\t_\t1\tnsubj\t_\t_\n"
            "3\trouge\trouge\tADJ\t_\t_\t2\tamod\t_\t_\n"
            "4\tarrive\tarriver\tVERB\t_\t_\t2\troot\t_\t_\n"
            "\n"
            "# sent_id = 2\n"
            "# text = Un livreur lit.\n"
            "1\tUn\tun\tDET\t_\t_\t0\troot\t_\t_\n"
            "2\tlivreur\tlivreur\tNOUN\t_\t_\t1\tnsubj\t_\t_\n"
            "3\tlit\tlire\tVERB\t_\t_\t2\troot\t_\t_\n"
            "\n"
        ),
        encoding="utf-8",
    )
    import_conllu(conn=conn, path=fr_path, language="fr", title="FR CQL")

    en_path = tmp_path / "en.conllu"
    en_path.write_text(
        (
            "# sent_id = 1\n"
            "# text = The book arrives.\n"
            "1\tThe\tthe\tDET\t_\t_\t0\troot\t_\t_\n"
            "2\tbook\tbook\tNOUN\t_\t_\t1\tnsubj\t_\t_\n"
            "3\tarrives\tarrive\tVERB\t_\t_\t2\troot\t_\t_\n"
            "\n"
            "# sent_id = 2\n"
            "# text = A library opens.\n"
            "1\tA\ta\tDET\t_\t_\t0\troot\t_\t_\n"
            "2\tlibrary\tlibrary\tNOUN\t_\t_\t1\tnsubj\t_\t_\n"
            "3\topens\topen\tVERB\t_\t_\t2\troot\t_\t_\n"
            "\n"
        ),
        encoding="utf-8",
    )
    import_conllu(conn=conn, path=en_path, language="en", title="EN CQL")
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
        "/token_query",
        "/tokens",
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


def test_get_runs_list_contract(sidecar_base_url: str) -> None:
    code, payload = _http_json("GET", f"{sidecar_base_url}/runs")
    assert code == 200
    assert payload["ok"] is True
    assert isinstance(payload.get("runs"), list)
    assert "limit" in payload
    code2, all_kinds = _http_json("GET", f"{sidecar_base_url}/runs?limit=5")
    assert code2 == 200
    assert all_kinds["limit"] == 5


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


def test_index_incremental_bad_type_returns_validation(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_VALIDATION

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/index",
        {"incremental": "yes"},
    )
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_VALIDATION
    assert payload["error_code"] == ERR_VALIDATION


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


def test_query_federation_multi_db_contract(federated_sidecar_context: dict[str, str]) -> None:
    base_url = federated_sidecar_context["base_url"]
    db_a = federated_sidecar_context["db_a"]
    db_b = federated_sidecar_context["db_b"]

    code, payload = _http_json(
        "POST",
        f"{base_url}/query",
        {
            "q": "federatedneedle",
            "mode": "segment",
            "db_paths": [db_a, db_b],
            "limit": 10,
            "offset": 0,
        },
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["federated"] is True
    assert payload["db_count"] == 2
    assert payload["db_paths"] == [db_a, db_b]
    assert payload["count"] == 8
    sources = {hit.get("source_db_path") for hit in payload["hits"]}
    assert sources == {db_a, db_b}
    for hit in payload["hits"]:
        assert hit["source_db_name"] in {"federated_a.db", "federated_b.db"}
        assert isinstance(hit["source_db_index"], int)


def test_query_federation_pagination_global(federated_sidecar_context: dict[str, str]) -> None:
    base_url = federated_sidecar_context["base_url"]
    db_a = federated_sidecar_context["db_a"]
    db_b = federated_sidecar_context["db_b"]

    code1, page1 = _http_json(
        "POST",
        f"{base_url}/query",
        {
            "q": "federatedneedle",
            "mode": "segment",
            "db_paths": [db_a, db_b],
            "limit": 5,
            "offset": 0,
        },
    )
    assert code1 == 200, page1
    assert page1["count"] == 5
    assert page1["has_more"] is True
    assert page1["next_offset"] == 5

    code2, page2 = _http_json(
        "POST",
        f"{base_url}/query",
        {
            "q": "federatedneedle",
            "mode": "segment",
            "db_paths": [db_a, db_b],
            "limit": 5,
            "offset": 5,
        },
    )
    assert code2 == 200, page2
    assert page2["count"] == 3
    assert page2["has_more"] is False
    assert page2["next_offset"] is None


def test_query_federation_invalid_db_paths_returns_400(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/query",
        {"q": "needle", "db_paths": []},
    )
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_query_federation_family_id_conflict_returns_400(
    federated_sidecar_context: dict[str, str],
) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    base_url = federated_sidecar_context["base_url"]
    db_a = federated_sidecar_context["db_a"]
    code, payload = _http_json(
        "POST",
        f"{base_url}/query",
        {"q": "federatedneedle", "family_id": 1, "db_paths": [db_a]},
    )
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_token_query_success_contract(token_query_sidecar_base_url: str) -> None:
    code, payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/token_query",
        {
            "cql": '[lemma = "liv.*" %c]',
            "mode": "kwic",
            "language": "fr",
        },
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert isinstance(payload["run_id"], str)
    assert payload["count"] >= 2
    assert payload["limit"] == 50
    assert payload["offset"] == 0
    assert isinstance(payload["has_more"], bool)
    assert isinstance(payload["total"], int)

    hit = payload["hits"][0]
    for key in ("doc_id", "unit_id", "language", "title", "tokens", "context_tokens"):
        assert key in hit
    assert isinstance(hit["tokens"], list)
    assert len(hit["tokens"]) >= 1
    tok = hit["tokens"][0]
    for key in ("token_id", "position", "word", "lemma", "upos"):
        assert key in tok


def test_token_query_sequence_with_doc_filter(token_query_sidecar_base_url: str) -> None:
    docs_code, docs_payload = _http_json("GET", f"{token_query_sidecar_base_url}/documents")
    assert docs_code == 200
    fr_docs = [d for d in docs_payload["documents"] if d.get("language") == "fr"]
    assert fr_docs
    fr_doc_id = fr_docs[0]["doc_id"]

    code, payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/token_query",
        {
            "cql": '[pos = "DET"][lemma = "liv.*" %c]',
            "mode": "kwic",
            "doc_ids": [fr_doc_id],
        },
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["count"] == 2
    for hit in payload["hits"]:
        assert len(hit["tokens"]) == 2
        assert (hit["tokens"][0]["upos"] or "").upper() == "DET"
        lemma = (hit["tokens"][1]["lemma"] or "").lower()
        assert lemma.startswith("liv")


def test_token_query_wildcard_quantifier_and_within_s(token_query_sidecar_base_url: str) -> None:
    code, payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/token_query",
        {
            "cql": '[pos = "DET"][]{0,2}[lemma = "arriv.*"] within s',
            "mode": "kwic",
            "language": "fr",
        },
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["count"] >= 1
    first = payload["hits"][0]
    assert len(first["tokens"]) >= 3
    lemmas = [(t.get("lemma") or "").lower() for t in first["tokens"]]
    assert any(l.startswith("arriv") for l in lemmas)


def test_token_query_within_s_accepts_terminal_semicolon(token_query_sidecar_base_url: str) -> None:
    code, payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/token_query",
        {
            "cql": '[pos = "DET"][]{0,2}[lemma = "arriv.*"] within s;',
            "mode": "kwic",
            "language": "fr",
        },
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["count"] >= 1


def test_token_query_pagination_page_flow(token_query_sidecar_base_url: str) -> None:
    code1, page1 = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/token_query",
        {"cql": '[pos = "DET"]', "mode": "segment", "limit": 2, "offset": 0},
    )
    assert code1 == 200, page1
    assert page1["count"] == 2
    assert page1["limit"] == 2
    assert page1["offset"] == 0
    assert page1["has_more"] is True
    assert page1["next_offset"] == 2
    assert isinstance(page1["total"], int)
    assert page1["total"] >= 4

    code2, page2 = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/token_query",
        {"cql": '[pos = "DET"]', "mode": "segment", "limit": 2, "offset": 2},
    )
    assert code2 == 200, page2
    assert page2["count"] == 2
    assert page2["offset"] == 2
    assert page2["has_more"] is False
    assert page2["next_offset"] is None


def test_token_query_invalid_cql_returns_bad_request(token_query_sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code, payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/token_query",
        {"cql": '[lemma = "liv.*"'},
    )
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_token_query_invalid_trailing_constraint_returns_bad_request(token_query_sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code, payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/token_query",
        {"cql": '[lemma = "liv.*"] within doc'},
    )
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_export_conllu_contract(token_query_sidecar_base_url: str, tmp_path: Path) -> None:
    out_path = tmp_path / "token_query_export.conllu"
    code, payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/export/conllu",
        {"out_path": str(out_path)},
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["out_path"] == str(out_path)
    assert payload["docs_written"] >= 1
    assert payload["sentences_written"] >= 1
    assert payload["tokens_written"] >= 1
    assert out_path.exists()
    content = out_path.read_text(encoding="utf-8")
    assert "# newdoc id =" in content
    assert "# sent_id =" in content
    assert "\tDET\t" in content or "\tNOUN\t" in content or "\tVERB\t" in content


def test_export_token_query_csv_contract(token_query_sidecar_base_url: str, tmp_path: Path) -> None:
    out_path = tmp_path / "token_query_hits.tsv"
    code, payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/export/token_query_csv",
        {
            "out_path": str(out_path),
            "cql": '[pos = "DET"][]{0,2}[lemma = "arriv.*"] within s',
            "mode": "kwic",
            "delimiter": "\t",
            "max_hits": 1000,
        },
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["out_path"] == str(out_path)
    assert payload["rows_written"] >= 1
    assert payload["mode"] == "kwic"
    assert payload["delimiter"] == "\t"
    assert out_path.exists()
    content = out_path.read_text(encoding="utf-8")
    lines = [ln for ln in content.splitlines() if ln.strip()]
    assert len(lines) >= 2  # header + >=1 row
    assert "left\tmatch\tright" in lines[0]


def test_export_ske_contract(token_query_sidecar_base_url: str, tmp_path: Path) -> None:
    out_path = tmp_path / "token_query_export.ske"
    code, payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/export/ske",
        {"out_path": str(out_path)},
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["out_path"] == str(out_path)
    assert payload["docs_written"] >= 1
    assert payload["sentences_written"] >= 1
    assert payload["tokens_written"] >= 1
    assert out_path.exists()
    text = out_path.read_text(encoding="utf-8")
    assert "<doc id=" in text
    assert "<s id=" in text
    assert "</s>" in text
    assert "</doc>" in text


def test_tokens_list_contract(token_query_sidecar_base_url: str) -> None:
    docs_code, docs_payload = _http_json("GET", f"{token_query_sidecar_base_url}/documents")
    assert docs_code == 200, docs_payload
    doc_id = docs_payload["documents"][0]["doc_id"]

    code, payload = _http_json(
        "GET",
        f"{token_query_sidecar_base_url}/tokens?doc_id={doc_id}&limit=2&offset=0",
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["doc_id"] == doc_id
    assert payload["count"] <= 2
    assert payload["limit"] == 2
    assert payload["offset"] == 0
    assert isinstance(payload["total"], int)
    assert isinstance(payload["has_more"], bool)
    assert "next_offset" in payload
    assert isinstance(payload["tokens"], list)
    assert payload["tokens"]
    row = payload["tokens"][0]
    for key in (
        "token_id", "doc_id", "unit_id", "unit_n", "external_id",
        "sent_id", "position", "word", "lemma", "upos", "xpos", "feats", "misc",
    ):
        assert key in row


def test_tokens_list_missing_doc_id_is_bad_request(token_query_sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code, payload = _http_json("GET", f"{token_query_sidecar_base_url}/tokens")
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_tokens_update_contract(token_query_sidecar_base_url: str) -> None:
    docs_code, docs_payload = _http_json("GET", f"{token_query_sidecar_base_url}/documents")
    assert docs_code == 200, docs_payload
    doc_id = docs_payload["documents"][0]["doc_id"]

    list_code, list_payload = _http_json(
        "GET",
        f"{token_query_sidecar_base_url}/tokens?doc_id={doc_id}&limit=1",
    )
    assert list_code == 200, list_payload
    token_id = list_payload["tokens"][0]["token_id"]
    original_word = list_payload["tokens"][0]["word"]

    upd_code, upd_payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/tokens/update",
        {"token_id": token_id, "lemma": "edited_lemma", "upos": "PROPN"},
    )
    assert upd_code == 200, upd_payload
    assert upd_payload["ok"] is True
    assert upd_payload["updated"] == 1
    assert upd_payload["token"]["token_id"] == token_id
    assert upd_payload["token"]["lemma"] == "edited_lemma"
    assert upd_payload["token"]["upos"] == "PROPN"
    assert upd_payload["token"]["word"] == original_word


def test_tokens_update_invalid_field_type_is_bad_request(token_query_sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    code, payload = _http_json(
        "POST",
        f"{token_query_sidecar_base_url}/tokens/update",
        {"token_id": 1, "lemma": 123},
    )
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


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


def test_segment_preview_accepts_calibrate_to_and_returns_ratio(sidecar_base_url: str) -> None:
    docs_code, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    assert docs_code == 200
    docs = docs_payload["documents"]
    assert len(docs) >= 2
    doc_id = docs[0]["doc_id"]
    ref_doc_id = docs[1]["doc_id"]

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/segment/preview",
        {
            "doc_id": doc_id,
            "mode": "sentences",
            "lang": "fr",
            "pack": "fr_strict",
            "calibrate_to": ref_doc_id,
        },
    )
    assert code == 200
    assert payload["ok"] is True
    assert payload["doc_id"] == doc_id
    assert payload["calibrate_to"] == ref_doc_id
    assert "calibrate_ratio_pct" in payload
    assert payload["calibrate_ratio_pct"] is None or isinstance(payload["calibrate_ratio_pct"], int)


def test_segment_preview_invalid_calibrate_to_is_bad_request(sidecar_base_url: str) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST

    docs_code, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    assert docs_code == 200
    doc_id = docs_payload["documents"][0]["doc_id"]

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/segment/preview",
        {"doc_id": doc_id, "calibrate_to": "abc"},
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


def test_documents_preview_returns_excerpt(sidecar_base_url: str) -> None:
    _, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    doc_id = docs_payload["documents"][0]["doc_id"]

    code, payload = _http_json(
        "GET",
        f"{sidecar_base_url}/documents/preview?doc_id={doc_id}&limit=3",
    )
    assert code == 200
    assert payload["ok"] is True
    assert payload["doc"]["doc_id"] == doc_id
    assert payload["limit"] == 3
    assert isinstance(payload["lines"], list)
    assert payload["count"] == len(payload["lines"])
    if payload["lines"]:
        line = payload["lines"][0]
        for key in ("unit_id", "n", "text"):
            assert key in line


def test_documents_preview_missing_doc_returns_404(sidecar_base_url: str) -> None:
    code, payload = _http_json(
        "GET",
        f"{sidecar_base_url}/documents/preview?doc_id=999999",
    )
    assert code == 404
    assert payload["ok"] is False
    assert payload["error_code"] == "NOT_FOUND"


def test_import_duplicate_error_includes_reason_source_hash(
    sidecar_base_url: str,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.sidecar_contract import ERR_VALIDATION

    txt = tmp_path / "dup-hash.txt"
    txt.write_text("[1] hash duplicate\n", encoding="utf-8")

    code1, payload1 = _http_json(
        "POST",
        f"{sidecar_base_url}/import",
        {"mode": "txt_numbered_lines", "path": str(txt), "language": "fr"},
    )
    assert code1 == 200, payload1
    assert payload1["ok"] is True

    code2, payload2 = _http_json(
        "POST",
        f"{sidecar_base_url}/import",
        {"mode": "txt_numbered_lines", "path": str(txt), "language": "fr"},
    )
    assert code2 == 400, payload2
    assert payload2["ok"] is False
    assert payload2["error_code"] == ERR_VALIDATION
    assert "reason=source_hash" in payload2["error"]["message"]


def test_import_conllu_mode_contract(
    sidecar_base_url: str,
    tmp_path: Path,
) -> None:
    conllu_path = tmp_path / "api-import.conllu"
    conllu_path.write_text(
        (
            "# sent_id = 1\n"
            "# text = Bonjour tout le monde.\n"
            "1\tBonjour\tbonjour\tINTJ\t_\t_\t0\troot\t_\t_\n"
            "2\ttout\ttout\tDET\t_\t_\t3\tdet\t_\t_\n"
            "3\tle\tle\tDET\t_\t_\t4\tdet\t_\t_\n"
            "4\tmonde\tmonde\tNOUN\t_\t_\t1\tobj\t_\t_\n"
            "\n"
        ),
        encoding="utf-8",
    )
    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/import",
        {
            "mode": "conllu",
            "path": str(conllu_path),
            "language": "fr",
            "title": "CoNLL-U API",
        },
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["mode"] == "conllu"
    assert isinstance(payload["doc_id"], int)


def test_import_duplicate_error_includes_reason_filename_when_enabled(
    sidecar_base_url: str,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.sidecar_contract import ERR_VALIDATION

    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    dir_a.mkdir()
    dir_b.mkdir()
    file_a = dir_a / "same-name.txt"
    file_b = dir_b / "same-name.txt"
    file_a.write_text("[1] first content\n", encoding="utf-8")
    file_b.write_text("[1] second content\n", encoding="utf-8")

    code1, payload1 = _http_json(
        "POST",
        f"{sidecar_base_url}/import",
        {
            "mode": "txt_numbered_lines",
            "path": str(file_a),
            "language": "fr",
            "check_filename": True,
        },
    )
    assert code1 == 200, payload1
    assert payload1["ok"] is True

    code2, payload2 = _http_json(
        "POST",
        f"{sidecar_base_url}/import",
        {
            "mode": "txt_numbered_lines",
            "path": str(file_b),
            "language": "fr",
            "check_filename": True,
        },
    )
    assert code2 == 400, payload2
    assert payload2["ok"] is False
    assert payload2["error_code"] == ERR_VALIDATION
    assert "reason=filename" in payload2["error"]["message"]


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


def test_align_recalculate_preserves_accepted_links_when_requested(sidecar_base_url: str) -> None:
    _, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    docs = docs_payload["documents"]
    pivot_id = docs[0]["doc_id"]
    target_id = docs[1]["doc_id"]

    _, initial_audit = _http_json(
        "POST",
        f"{sidecar_base_url}/align/audit",
        {"pivot_doc_id": pivot_id, "target_doc_id": target_id, "limit": 200},
    )
    assert len(initial_audit["links"]) >= 1
    first_link_id = initial_audit["links"][0]["link_id"]

    code_accept, payload_accept = _http_json(
        "POST",
        f"{sidecar_base_url}/align/link/update_status",
        {"link_id": first_link_id, "status": "accepted"},
    )
    assert code_accept == 200, payload_accept

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/align",
        {
            "pivot_doc_id": pivot_id,
            "target_doc_ids": [target_id],
            "strategy": "external_id",
            "replace_existing": True,
            "preserve_accepted": True,
            "run_id": "sidecar-test-align-recalc-preserve",
        },
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["replace_existing"] is True
    assert payload["preserve_accepted"] is True
    assert payload["preserved_before"] == 1
    assert payload["deleted_before"] >= 1
    assert payload["total_effective_links"] == len(initial_audit["links"])

    _, accepted_audit = _http_json(
        "POST",
        f"{sidecar_base_url}/align/audit",
        {"pivot_doc_id": pivot_id, "target_doc_id": target_id, "status": "accepted", "limit": 200},
    )
    accepted_ids = {row["link_id"] for row in accepted_audit["links"]}
    assert first_link_id in accepted_ids


def test_align_recalculate_can_drop_previous_accepted_links(sidecar_base_url: str) -> None:
    _, docs_payload = _http_json("GET", f"{sidecar_base_url}/documents")
    docs = docs_payload["documents"]
    pivot_id = docs[0]["doc_id"]
    target_id = docs[1]["doc_id"]

    _, initial_audit = _http_json(
        "POST",
        f"{sidecar_base_url}/align/audit",
        {"pivot_doc_id": pivot_id, "target_doc_id": target_id, "limit": 200},
    )
    first_link_id = initial_audit["links"][0]["link_id"]
    _http_json(
        "POST",
        f"{sidecar_base_url}/align/link/update_status",
        {"link_id": first_link_id, "status": "accepted"},
    )

    code, payload = _http_json(
        "POST",
        f"{sidecar_base_url}/align",
        {
            "pivot_doc_id": pivot_id,
            "target_doc_ids": [target_id],
            "strategy": "external_id",
            "replace_existing": True,
            "preserve_accepted": False,
            "run_id": "sidecar-test-align-recalc-drop",
        },
    )
    assert code == 200, payload
    assert payload["ok"] is True
    assert payload["replace_existing"] is True
    assert payload["preserve_accepted"] is False
    assert payload["preserved_before"] == 0

    _, accepted_audit = _http_json(
        "POST",
        f"{sidecar_base_url}/align/audit",
        {"pivot_doc_id": pivot_id, "target_doc_id": target_id, "status": "accepted", "limit": 200},
    )
    assert len(accepted_audit["links"]) == 0


def test_openapi_spec_has_documents_and_align_routes() -> None:
    from multicorpus_engine.sidecar_contract import openapi_spec

    spec = openapi_spec()
    assert "/documents" in spec["paths"]
    assert "/align" in spec["paths"]
    assert "/runs" in spec["paths"]
    assert "get" in spec["paths"]["/documents"]
    assert "post" in spec["paths"]["/align"]
    assert "get" in spec["paths"]["/runs"]
    schemas = spec["components"]["schemas"]
    assert "DocumentRecord" in schemas
    assert "DocumentsResponse" in schemas
    assert "AlignRequest" in schemas
    assert "AlignResponse" in schemas
