"""Tests for POST /units/merge and POST /units/split.

Regression coverage for the `no such column: pivot_unit_n` bug —
the DELETE of alignment_links must use pivot_unit_id / target_unit_id,
not the non-existent pivot_unit_n / target_unit_n columns.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


# ─── HTTP helpers ─────────────────────────────────────────────────────────────

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


def _wait_health(base_url: str, tries: int = 50) -> None:
    import time
    for _ in range(tries):
        code, payload = _http("GET", f"{base_url}/health")
        if code == 200 and payload.get("ok") is True:
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


# ─── Fixture ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def ms_sidecar(tmp_path: Path):
    """Sidecar with two aligned docs (5 pivot lines ↔ 5 target lines)."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "merge_split.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    (tmp_path / "pivot.txt").write_text(
        "[1] Un.\n[2] Deux.\n[3] Trois.\n[4] Quatre.\n[5] Cinq.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(tmp_path / "pivot.txt"), language="fr", title="FR")

    (tmp_path / "target.txt").write_text(
        "[1] One.\n[2] Two.\n[3] Three.\n[4] Four.\n[5] Five.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(tmp_path / "target.txt"), language="en", title="EN")

    align_by_external_id(conn, pivot_doc_id=1, target_doc_ids=[2], run_id="ms-run")
    build_index(conn)
    conn.close()

    token = "ms-token"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    _wait_health(f"http://127.0.0.1:{server.actual_port}")

    yield f"http://127.0.0.1:{server.actual_port}", token, server

    server.shutdown()


# ─── /units/merge tests ────────────────────────────────────────────────────────

class TestUnitsMerge:
    def test_merge_succeeds(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 1, "n2": 2}, token)
        assert code == 200, body
        assert body["ok"] is True
        assert body["merged_n"] == 1
        assert body["deleted_n"] == 2

    def test_merge_concatenates_text(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 2, "n2": 3}, token)
        assert code == 200, body
        assert "Deux" in body["text"] and "Trois" in body["text"]

    def test_merge_deletes_alignment_links(self, ms_sidecar):
        """Regression: used to fail with 'no such column: pivot_unit_n'."""
        base, token, _ = ms_sidecar
        # n1=1, n2=2 are linked to EN doc
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 1, "n2": 2}, token)
        assert code == 200, body

    def test_merge_non_adjacent_returns_400(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 1, "n2": 3}, token)
        assert code == 400

    def test_merge_missing_params_returns_400(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1}, token)
        assert code == 400

    def test_merge_nonexistent_unit_returns_404(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 99, "n2": 100}, token)
        assert code == 404

    def test_merge_requires_token(self, ms_sidecar):
        base, _, _ = ms_sidecar
        code, body = _post(f"{base}/units/merge", {"doc_id": 1, "n1": 1, "n2": 2})
        assert code == 401


# ─── /units/split tests ───────────────────────────────────────────────────────

class TestUnitsSplit:
    def test_split_succeeds(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 3, "text_a": "Trois A.", "text_b": "Trois B."},
            token,
        )
        assert code == 200, body
        assert body["ok"] is True

    def test_split_deletes_alignment_links(self, ms_sidecar):
        """Regression: used to fail with 'no such column: pivot_unit_n'."""
        base, token, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 1, "text_a": "Un A.", "text_b": "Un B."},
            token,
        )
        assert code == 200, body

    def test_split_missing_params_returns_400(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(f"{base}/units/split", {"doc_id": 1}, token)
        assert code == 400

    def test_split_empty_text_returns_400(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 1, "text_a": "", "text_b": "B."},
            token,
        )
        assert code == 400

    def test_split_nonexistent_unit_returns_404(self, ms_sidecar):
        base, token, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 99, "text_a": "A.", "text_b": "B."},
            token,
        )
        assert code == 404

    def test_split_requires_token(self, ms_sidecar):
        base, _, _ = ms_sidecar
        code, body = _post(
            f"{base}/units/split",
            {"doc_id": 1, "unit_n": 1, "text_a": "A.", "text_b": "B."},
        )
        assert code == 401
