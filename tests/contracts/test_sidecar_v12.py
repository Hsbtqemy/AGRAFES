"""Sprint 1.2 contract tests — POST /align/audit include_explain flag."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


# ─── HTTP helpers ──────────────────────────────────────────────────────────────

def _http(method: str, url: str, payload: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    data: bytes | None = None
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


def _post(url: str, payload: dict, token: str | None = None) -> tuple[int, dict]:
    return _http("POST", url, payload, token=token)


def _get(url: str, token: str | None = None) -> tuple[int, dict]:
    return _http("GET", url, token=token)


def _wait_health(base_url: str, tries: int = 50) -> None:
    import time
    for _ in range(tries):
        code, payload = _get(f"{base_url}/health")
        if code == 200 and payload.get("ok") is True:
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


# ─── Fixture ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def v12_sidecar(tmp_path: Path):
    """Sidecar with aligned corpus using external_id strategy (run_id recorded in runs table)."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "test_v12.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    pivot_txt = tmp_path / "pivot.txt"
    pivot_txt.write_text(
        "[1] Un chat.\n[2] Un chien.\n[3] Un lapin.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(pivot_txt), language="fr", title="Pivot FR")

    target_txt = tmp_path / "target.txt"
    target_txt.write_text(
        "[1] A cat.\n[2] A dog.\n[3] A rabbit.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(target_txt), language="en", title="Target EN")

    from multicorpus_engine.runs import create_run, update_run_stats

    # Create the run record BEFORE aligning so alignment_links.run_id maps to a known run
    create_run(conn, "align", {"pivot_doc_id": 1, "target_doc_ids": [2], "strategy": "external_id"}, run_id="test-run-v12")
    align_by_external_id(conn, pivot_doc_id=1, target_doc_ids=[2], run_id="test-run-v12")
    update_run_stats(conn, "test-run-v12", {"strategy": "external_id", "total_links_created": 3})
    build_index(conn)
    conn.close()

    token = "testtoken-v12"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    _wait_health(f"http://127.0.0.1:{server.actual_port}")

    yield f"http://127.0.0.1:{server.actual_port}", token, server

    server.shutdown()


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestAlignAuditBackwardCompat:
    """Without include_explain=true, response is unchanged."""

    def test_no_explain_field_by_default(self, v12_sidecar):
        base, _, _ = v12_sidecar
        code, body = _post(f"{base}/align/audit", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert code == 200
        assert body["ok"] is True
        links = body["links"]
        assert len(links) == 3
        for link in links:
            assert "explain" not in link

    def test_false_flag_no_explain(self, v12_sidecar):
        base, _, _ = v12_sidecar
        code, body = _post(
            f"{base}/align/audit",
            {"pivot_doc_id": 1, "target_doc_id": 2, "include_explain": False},
        )
        assert code == 200
        for link in body["links"]:
            assert "explain" not in link

    def test_status_field_still_present(self, v12_sidecar):
        base, _, _ = v12_sidecar
        code, body = _post(f"{base}/align/audit", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert code == 200
        for link in body["links"]:
            assert "status" in link


class TestAlignAuditWithExplain:
    """include_explain=true adds explain object to each link."""

    def test_explain_present_when_flag_true(self, v12_sidecar):
        base, _, _ = v12_sidecar
        code, body = _post(
            f"{base}/align/audit",
            {"pivot_doc_id": 1, "target_doc_id": 2, "include_explain": True},
        )
        assert code == 200
        assert body["ok"] is True
        links = body["links"]
        assert len(links) == 3
        for link in links:
            assert "explain" in link

    def test_explain_has_strategy_and_notes(self, v12_sidecar):
        base, _, _ = v12_sidecar
        code, body = _post(
            f"{base}/align/audit",
            {"pivot_doc_id": 1, "target_doc_id": 2, "include_explain": True},
        )
        assert code == 200
        for link in body["links"]:
            explain = link["explain"]
            assert "strategy" in explain
            assert isinstance(explain["strategy"], str)
            assert "notes" in explain
            assert isinstance(explain["notes"], list)

    def test_explain_strategy_is_external_id(self, v12_sidecar):
        """Fixture uses align_by_external_id → strategy should be 'external_id'."""
        base, _, _ = v12_sidecar
        code, body = _post(
            f"{base}/align/audit",
            {"pivot_doc_id": 1, "target_doc_id": 2, "include_explain": True},
        )
        assert code == 200
        for link in body["links"]:
            assert link["explain"]["strategy"] == "external_id"

    def test_explain_notes_non_empty(self, v12_sidecar):
        base, _, _ = v12_sidecar
        code, body = _post(
            f"{base}/align/audit",
            {"pivot_doc_id": 1, "target_doc_id": 2, "include_explain": True},
        )
        assert code == 200
        for link in body["links"]:
            assert len(link["explain"]["notes"]) > 0

    def test_explain_works_with_pagination(self, v12_sidecar):
        base, _, _ = v12_sidecar
        code, body = _post(
            f"{base}/align/audit",
            {"pivot_doc_id": 1, "target_doc_id": 2, "include_explain": True, "limit": 2, "offset": 0},
        )
        assert code == 200
        assert len(body["links"]) == 2
        for link in body["links"]:
            assert "explain" in link

    def test_nonexistent_pair_returns_empty_links(self, v12_sidecar):
        base, _, _ = v12_sidecar
        code, body = _post(
            f"{base}/align/audit",
            {"pivot_doc_id": 99, "target_doc_id": 99, "include_explain": True},
        )
        assert code == 200
        assert body["links"] == []
