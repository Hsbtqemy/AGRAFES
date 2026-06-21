"""Sprint 1.1 contract tests — POST /align/quality endpoint."""

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


def _get(url: str, token: str | None = None) -> tuple[int, dict]:
    return _http("GET", url, token=token)


def _post(url: str, payload: dict, token: str | None = None) -> tuple[int, dict]:
    return _http("POST", url, payload, token=token)


def _wait_health(base_url: str, tries: int = 50) -> None:
    import time
    for _ in range(tries):
        code, payload = _get(f"{base_url}/health")
        if code == 200 and payload.get("ok") is True:
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


# ─── Shared fixture ────────────────────────────────────────────────────────────

@pytest.fixture()
def v11_sidecar(tmp_path: Path):
    """Sidecar with a 5-unit pivot doc and 5-unit target doc, fully aligned."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "test_v11.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    # 5-unit pivot (FR)
    pivot_txt = tmp_path / "pivot.txt"
    pivot_txt.write_text(
        "[1] Un chat.\n[2] Un chien.\n[3] Un lapin.\n[4] Un cheval.\n[5] Un oiseau.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(pivot_txt), language="fr", title="Pivot FR")

    # 5-unit target (EN) — fully aligned by external_id
    target_txt = tmp_path / "target.txt"
    target_txt.write_text(
        "[1] A cat.\n[2] A dog.\n[3] A rabbit.\n[4] A horse.\n[5] A bird.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(target_txt), language="en", title="Target EN")

    align_by_external_id(conn, pivot_doc_id=1, target_doc_ids=[2], run_id="test-run-v11")
    build_index(conn)
    conn.close()

    token = "testtoken-v11"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    _wait_health(f"http://127.0.0.1:{server.actual_port}")

    yield f"http://127.0.0.1:{server.actual_port}", token, server

    server.shutdown()


@pytest.fixture()
def v11_partial_sidecar(tmp_path: Path):
    """Sidecar with 5 pivot units but only 3 target units aligned (orphan scenario)."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "test_v11_partial.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    pivot_txt = tmp_path / "pivot.txt"
    pivot_txt.write_text(
        "[1] Un chat.\n[2] Un chien.\n[3] Un lapin.\n[4] Un cheval.\n[5] Un oiseau.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(pivot_txt), language="fr", title="Pivot FR")

    # Only 3 target units — external_ids 1,2,3 will match, 4 and 5 will be orphans
    target_txt = tmp_path / "target.txt"
    target_txt.write_text(
        "[1] A cat.\n[2] A dog.\n[3] A rabbit.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(target_txt), language="en", title="Target EN")

    align_by_external_id(conn, pivot_doc_id=1, target_doc_ids=[2], run_id="test-run-partial")
    build_index(conn)
    conn.close()

    token = "testtoken-partial"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    _wait_health(f"http://127.0.0.1:{server.actual_port}")

    yield f"http://127.0.0.1:{server.actual_port}", token, server

    server.shutdown()


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestAlignQualityFullCoverage:
    """Fully aligned pair → 100% coverage, zero orphans."""

    def test_basic_stats(self, v11_sidecar):
        base, token, _ = v11_sidecar
        code, body = _post(f"{base}/align/quality", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert code == 200
        assert body["ok"] is True
        stats = body["stats"]
        assert stats["total_pivot_units"] == 5
        assert stats["total_target_units"] == 5
        assert stats["total_links"] == 5
        assert stats["covered_pivot_units"] == 5
        assert stats["covered_target_units"] == 5
        assert stats["coverage_pct"] == 100.0
        assert stats["orphan_pivot_count"] == 0
        assert stats["orphan_target_count"] == 0
        assert stats["collision_count"] == 0

    def test_status_counts_all_unreviewed(self, v11_sidecar):
        base, token, _ = v11_sidecar
        code, body = _post(f"{base}/align/quality", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert code == 200
        sc = body["stats"]["status_counts"]
        assert sc["unreviewed"] == 5
        assert sc["accepted"] == 0
        assert sc["rejected"] == 0

    def test_sample_orphans_empty_when_full_coverage(self, v11_sidecar):
        base, token, _ = v11_sidecar
        code, body = _post(f"{base}/align/quality", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert code == 200
        assert body["sample_orphan_pivot"] == []
        assert body["sample_orphan_target"] == []

    def test_missing_params_returns_400(self, v11_sidecar):
        base, _, _ = v11_sidecar
        code, body = _post(f"{base}/align/quality", {"pivot_doc_id": 1})
        assert code == 400
        assert body["ok"] is False

    def test_nonexistent_pair_returns_zero_stats(self, v11_sidecar):
        base, _, _ = v11_sidecar
        code, body = _post(f"{base}/align/quality", {"pivot_doc_id": 99, "target_doc_id": 99})
        assert code == 200
        assert body["stats"]["total_links"] == 0
        assert body["stats"]["coverage_pct"] == 0.0


class TestAlignQualityPartialCoverage:
    """Partially aligned pair → orphans present."""

    def test_partial_coverage(self, v11_partial_sidecar):
        base, _, _ = v11_partial_sidecar
        code, body = _post(f"{base}/align/quality", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert code == 200
        stats = body["stats"]
        # 5 pivot units, 3 target units, 3 links
        assert stats["total_pivot_units"] == 5
        assert stats["total_target_units"] == 3
        assert stats["total_links"] == 3
        assert stats["covered_pivot_units"] == 3
        assert stats["covered_target_units"] == 3
        assert stats["coverage_pct"] == 60.0
        assert stats["orphan_pivot_count"] == 2
        assert stats["orphan_target_count"] == 0  # all 3 target units are covered

    def test_sample_orphan_pivot_present(self, v11_partial_sidecar):
        base, _, _ = v11_partial_sidecar
        code, body = _post(f"{base}/align/quality", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert code == 200
        # Should have samples for the 2 orphan pivot units
        assert len(body["sample_orphan_pivot"]) == 2
        for item in body["sample_orphan_pivot"]:
            assert "unit_id" in item
            assert "external_id" in item
            assert "text" in item

    def test_run_id_filter_no_match(self, v11_partial_sidecar):
        base, _, _ = v11_partial_sidecar
        code, body = _post(
            f"{base}/align/quality",
            {"pivot_doc_id": 1, "target_doc_id": 2, "run_id": "nonexistent-run-id"},
        )
        assert code == 200
        assert body["stats"]["total_links"] == 0

    def test_openapi_exposes_align_quality(self, v11_partial_sidecar):
        base, _, _ = v11_partial_sidecar
        code, spec = _get(f"{base}/openapi.json")
        assert code == 200
        assert "/align/quality" in spec["paths"]
