"""Sprint 1.4 contract tests — POST /align/retarget_candidates endpoint."""

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
def v14_sidecar(tmp_path: Path):
    """Sidecar with aligned corpus (5 pivot ↔ 5 target links via external_id)."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "test_v14.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    pivot_txt = tmp_path / "pivot.txt"
    pivot_txt.write_text(
        "[1] Un.\n[2] Deux.\n[3] Trois.\n[4] Quatre.\n[5] Cinq.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(pivot_txt), language="fr", title="Pivot FR")

    target_txt = tmp_path / "target.txt"
    target_txt.write_text(
        "[1] One.\n[2] Two.\n[3] Three.\n[4] Four.\n[5] Five.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(target_txt), language="en", title="Target EN")

    align_by_external_id(conn, pivot_doc_id=1, target_doc_ids=[2], run_id="test-run-v14")
    build_index(conn)
    conn.close()

    token = "testtoken-v14"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    _wait_health(f"http://127.0.0.1:{server.actual_port}")

    yield f"http://127.0.0.1:{server.actual_port}", token, server

    server.shutdown()


def _get_unit_ids(base: str, token: str) -> dict:
    """Return pivot unit_id → target unit_id mapping via audit."""
    code, body = _post(f"{base}/align/audit", {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 10}, token)
    assert code == 200
    return {lnk["pivot_unit_id"]: lnk["target_unit_id"] for lnk in body["links"]}


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestRetargetCandidatesAuth:
    """Endpoint is read-only — no token required."""

    def test_no_token_returns_200(self, v14_sidecar):
        base, token, _ = v14_sidecar
        unit_map = _get_unit_ids(base, token)
        pivot_uid = next(iter(unit_map))
        code, body = _post(
            f"{base}/align/retarget_candidates",
            {"pivot_unit_id": pivot_uid, "target_doc_id": 2},
            token=None,  # no token
        )
        assert code == 200
        assert body["ok"] is True


class TestRetargetCandidatesValidation:
    """Input validation."""

    def test_missing_pivot_unit_id_returns_400(self, v14_sidecar):
        base, _, _ = v14_sidecar
        code, body = _post(f"{base}/align/retarget_candidates", {"target_doc_id": 2})
        assert code == 400
        assert body["ok"] is False

    def test_missing_target_doc_id_returns_400(self, v14_sidecar):
        base, token, _ = v14_sidecar
        unit_map = _get_unit_ids(base, token)
        pivot_uid = next(iter(unit_map))
        code, body = _post(f"{base}/align/retarget_candidates", {"pivot_unit_id": pivot_uid})
        assert code == 400

    def test_nonexistent_pivot_unit_returns_404(self, v14_sidecar):
        base, _, _ = v14_sidecar
        code, body = _post(
            f"{base}/align/retarget_candidates",
            {"pivot_unit_id": 99999, "target_doc_id": 2},
        )
        assert code == 404
        assert body["ok"] is False


class TestRetargetCandidatesResponse:
    """Response shape and heuristic."""

    def test_returns_pivot_and_candidates(self, v14_sidecar):
        base, token, _ = v14_sidecar
        unit_map = _get_unit_ids(base, token)
        pivot_uid = next(iter(unit_map))
        code, body = _post(
            f"{base}/align/retarget_candidates",
            {"pivot_unit_id": pivot_uid, "target_doc_id": 2},
        )
        assert code == 200
        assert "pivot" in body
        assert "candidates" in body
        pivot = body["pivot"]
        assert pivot["unit_id"] == pivot_uid
        assert isinstance(pivot.get("external_id"), int)
        assert isinstance(pivot.get("text"), str)

    def test_candidates_have_required_fields(self, v14_sidecar):
        base, token, _ = v14_sidecar
        unit_map = _get_unit_ids(base, token)
        pivot_uid = next(iter(unit_map))
        _, body = _post(
            f"{base}/align/retarget_candidates",
            {"pivot_unit_id": pivot_uid, "target_doc_id": 2},
        )
        for c in body["candidates"]:
            assert "target_unit_id" in c
            assert "target_text" in c
            assert "score" in c
            assert "reason" in c
            assert 0.0 < c["score"] <= 1.0

    def test_external_id_match_has_score_1(self, v14_sidecar):
        """Exact external_id match should get score=1.0."""
        base, token, _ = v14_sidecar
        unit_map = _get_unit_ids(base, token)
        pivot_uid = next(iter(unit_map))
        _, body = _post(
            f"{base}/align/retarget_candidates",
            {"pivot_unit_id": pivot_uid, "target_doc_id": 2},
        )
        exact = [c for c in body["candidates"] if c["reason"] == "external_id_match"]
        assert len(exact) >= 1
        assert exact[0]["score"] == 1.0

    def test_limit_respected(self, v14_sidecar):
        base, token, _ = v14_sidecar
        unit_map = _get_unit_ids(base, token)
        pivot_uid = next(iter(unit_map))
        _, body = _post(
            f"{base}/align/retarget_candidates",
            {"pivot_unit_id": pivot_uid, "target_doc_id": 2, "limit": 2},
        )
        assert len(body["candidates"]) <= 2

    def test_candidates_sorted_by_score_desc(self, v14_sidecar):
        base, token, _ = v14_sidecar
        unit_map = _get_unit_ids(base, token)
        pivot_uid = next(iter(unit_map))
        _, body = _post(
            f"{base}/align/retarget_candidates",
            {"pivot_unit_id": pivot_uid, "target_doc_id": 2, "limit": 10},
        )
        scores = [c["score"] for c in body["candidates"]]
        assert scores == sorted(scores, reverse=True)

    def test_openapi_exposes_endpoint(self, v14_sidecar):
        base, _, _ = v14_sidecar
        code, spec = _get(f"{base}/openapi.json")
        assert code == 200
        assert "/align/retarget_candidates" in spec["paths"]

    def test_contract_version_bumped(self, v14_sidecar):
        base, _, _ = v14_sidecar
        code, body = _get(f"{base}/health")
        assert code == 200
        # API version should be >= 1.2.0
        version = body.get("api_version", "")
        major, minor, *_ = version.split(".")
        assert (int(major), int(minor)) >= (1, 2)
