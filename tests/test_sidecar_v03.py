"""V0.3 contract tests — /curate/preview and /align/audit endpoints."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


# ─── HTTP helpers ──────────────────────────────────────────────────────────────

def _http(method: str, url: str, payload: dict | None = None) -> tuple[int, dict]:
    data: bytes | None = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = Request(url, method=method, data=data, headers=headers)
    try:
        with urlopen(req, timeout=10.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _wait_health(base_url: str, tries: int = 50) -> None:
    import time
    for _ in range(tries):
        code, payload = _http("GET", f"{base_url}/health")
        if code == 200 and payload.get("ok") is True:
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


# ─── Shared fixture ────────────────────────────────────────────────────────────

@pytest.fixture()
def v03_sidecar(tmp_path: Path):
    """Sidecar with pivot + target docs already imported and aligned."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "v03.db"
    conn = get_connection(db_path)
    apply_migrations(conn)

    pivot_txt = tmp_path / "pivot.txt"
    pivot_txt.write_text(
        "[1] Bonjour monde. Voici le texte un.\n"
        "[2] Au revoir monde. Le texte deux.\n"
        "[3] Un troisieme exemple ici.\n",
        encoding="utf-8",
    )
    pivot = import_txt_numbered_lines(conn=conn, path=pivot_txt, language="fr", title="Pivot FR")

    target_txt = tmp_path / "target.txt"
    target_txt.write_text(
        "[1] Hello world. Here is text one.\n"
        "[2] Goodbye world. The text two.\n"
        "[3] A third example here.\n",
        encoding="utf-8",
    )
    target = import_txt_numbered_lines(conn=conn, path=target_txt, language="en", title="Target EN")

    align_by_external_id(
        conn=conn,
        pivot_doc_id=pivot.doc_id,
        target_doc_ids=[target.doc_id],
        run_id="v03-test",
    )
    build_index(conn)
    conn.close()

    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0)
    server.start()
    base_url = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base_url)
    try:
        yield {"base_url": base_url, "pivot_doc_id": pivot.doc_id, "target_doc_id": target.doc_id}
    finally:
        server.shutdown()


# ─── /curate/preview tests ────────────────────────────────────────────────────

def test_curate_preview_returns_stats_and_examples(v03_sidecar) -> None:
    base_url = v03_sidecar["base_url"]
    doc_id = v03_sidecar["pivot_doc_id"]

    code, payload = _http("POST", f"{base_url}/curate/preview", {
        "doc_id": doc_id,
        "rules": [{"pattern": "monde", "replacement": "MONDE", "flags": "i"}],
        "limit_examples": 5,
    })
    assert code == 200
    assert payload["ok"] is True
    assert payload["status"] == "ok"
    assert payload["doc_id"] == doc_id
    stats = payload["stats"]
    assert stats["units_total"] >= 2   # 3 units, at least 2 match "monde"
    assert stats["units_changed"] >= 2
    assert stats["replacements_total"] >= 2
    examples = payload["examples"]
    assert len(examples) >= 1
    # Verify before != after
    for ex in examples:
        assert ex["before"] != ex["after"]
        assert "MONDE" in ex["after"]
        assert "unit_id" in ex


def test_curate_preview_does_not_modify_db(v03_sidecar) -> None:
    """Verify that /curate/preview is a pure dry-run — DB units unchanged after preview."""
    from multicorpus_engine.db.connection import get_connection

    base_url = v03_sidecar["base_url"]
    doc_id = v03_sidecar["pivot_doc_id"]

    # Fetch unit texts via /query before preview
    code_before, q_before = _http("POST", f"{base_url}/query", {"q": "monde", "mode": "segment"})
    assert code_before == 200
    texts_before = {h["unit_id"]: h.get("text_norm", h.get("text", "")) for h in q_before["hits"]}

    # Run preview
    code_p, _ = _http("POST", f"{base_url}/curate/preview", {
        "doc_id": doc_id,
        "rules": [{"pattern": "monde", "replacement": "XYZXYZ"}],
    })
    assert code_p == 200

    # Re-query — texts must be unchanged
    code_after, q_after = _http("POST", f"{base_url}/query", {"q": "monde", "mode": "segment"})
    assert code_after == 200
    texts_after = {h["unit_id"]: h.get("text_norm", h.get("text", "")) for h in q_after["hits"]}
    assert texts_before == texts_after
    # "XYZXYZ" must not appear anywhere in query results
    for h in q_after["hits"]:
        assert "XYZXYZ" not in (h.get("text", "") + h.get("text_norm", ""))


def test_curate_preview_empty_rules_returns_zero_changes(v03_sidecar) -> None:
    base_url = v03_sidecar["base_url"]
    doc_id = v03_sidecar["pivot_doc_id"]

    code, payload = _http("POST", f"{base_url}/curate/preview", {
        "doc_id": doc_id,
        "rules": [],
    })
    assert code == 200
    assert payload["ok"] is True
    assert payload["stats"]["units_changed"] == 0
    assert payload["stats"]["replacements_total"] == 0
    assert payload["examples"] == []


def test_curate_preview_missing_doc_id_is_400(v03_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST
    code, payload = _http("POST", f"{v03_sidecar['base_url']}/curate/preview", {
        "rules": [{"pattern": "a", "replacement": "b"}],
    })
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_curate_preview_invalid_regex_is_400(v03_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_VALIDATION
    code, payload = _http("POST", f"{v03_sidecar['base_url']}/curate/preview", {
        "doc_id": v03_sidecar["pivot_doc_id"],
        "rules": [{"pattern": "[invalid(", "replacement": "x"}],
    })
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_VALIDATION


def test_curate_preview_limit_examples_respected(v03_sidecar) -> None:
    base_url = v03_sidecar["base_url"]
    doc_id = v03_sidecar["pivot_doc_id"]

    # All units contain letters, so match everything
    code, payload = _http("POST", f"{base_url}/curate/preview", {
        "doc_id": doc_id,
        "rules": [{"pattern": "\\w", "replacement": "X"}],
        "limit_examples": 1,
    })
    assert code == 200
    assert len(payload["examples"]) <= 1


# ─── /align/audit tests ───────────────────────────────────────────────────────

def test_align_audit_returns_links(v03_sidecar) -> None:
    base_url = v03_sidecar["base_url"]
    pivot_id = v03_sidecar["pivot_doc_id"]
    target_id = v03_sidecar["target_doc_id"]

    code, payload = _http("POST", f"{base_url}/align/audit", {
        "pivot_doc_id": pivot_id,
        "target_doc_id": target_id,
    })
    assert code == 200
    assert payload["ok"] is True
    assert payload["pivot_doc_id"] == pivot_id
    assert payload["target_doc_id"] == target_id
    assert isinstance(payload["links"], list)
    assert len(payload["links"]) == 3   # 3 aligned pairs
    link = payload["links"][0]
    assert "pivot_unit_id" in link
    assert "target_unit_id" in link
    assert "pivot_text" in link
    assert "target_text" in link
    assert isinstance(link["pivot_text"], str)
    assert isinstance(link["target_text"], str)


def test_align_audit_pagination(v03_sidecar) -> None:
    base_url = v03_sidecar["base_url"]
    pivot_id = v03_sidecar["pivot_doc_id"]
    target_id = v03_sidecar["target_doc_id"]

    # Page 1 (limit=2)
    code1, p1 = _http("POST", f"{base_url}/align/audit", {
        "pivot_doc_id": pivot_id, "target_doc_id": target_id,
        "limit": 2, "offset": 0,
    })
    assert code1 == 200
    assert len(p1["links"]) == 2
    assert p1["has_more"] is True
    assert p1["next_offset"] == 2

    # Page 2
    code2, p2 = _http("POST", f"{base_url}/align/audit", {
        "pivot_doc_id": pivot_id, "target_doc_id": target_id,
        "limit": 2, "offset": 2,
    })
    assert code2 == 200
    assert len(p2["links"]) == 1
    assert p2["has_more"] is False
    assert p2["next_offset"] is None


def test_align_audit_external_id_filter(v03_sidecar) -> None:
    base_url = v03_sidecar["base_url"]
    pivot_id = v03_sidecar["pivot_doc_id"]
    target_id = v03_sidecar["target_doc_id"]

    code, payload = _http("POST", f"{base_url}/align/audit", {
        "pivot_doc_id": pivot_id, "target_doc_id": target_id,
        "external_id": 1,
    })
    assert code == 200
    assert payload["ok"] is True
    assert len(payload["links"]) == 1
    assert payload["links"][0]["external_id"] == 1


def test_align_audit_missing_params_is_400(v03_sidecar) -> None:
    from multicorpus_engine.sidecar_contract import ERR_BAD_REQUEST
    code, payload = _http("POST", f"{v03_sidecar['base_url']}/align/audit", {
        "pivot_doc_id": 1,
        # missing target_doc_id
    })
    assert code == 400
    assert payload["ok"] is False
    assert payload["error"]["type"] == ERR_BAD_REQUEST


def test_align_audit_empty_when_no_links(v03_sidecar) -> None:
    """Querying a non-existent pair returns empty list, not error."""
    code, payload = _http("POST", f"{v03_sidecar['base_url']}/align/audit", {
        "pivot_doc_id": 999, "target_doc_id": 998,
    })
    assert code == 200
    assert payload["ok"] is True
    assert payload["links"] == []
    assert payload["has_more"] is False


def test_openapi_spec_has_v03_routes() -> None:
    from multicorpus_engine.sidecar_contract import openapi_spec
    spec = openapi_spec()
    assert "/curate/preview" in spec["paths"]
    assert "/align/audit" in spec["paths"]
    schemas = spec["components"]["schemas"]
    for name in ("CuratePreviewRequest", "CuratePreviewResponse", "CuratePreviewExample",
                 "AlignAuditRequest", "AlignAuditResponse", "AlignLinkRecord"):
        assert name in schemas, f"Missing schema: {name}"
