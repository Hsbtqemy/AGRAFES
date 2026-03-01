"""Sprint 1.3 contract tests — POST /align/links/batch_update endpoint."""

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
def v13_sidecar(tmp_path: Path):
    """Sidecar with 5 alignment links for batch operations."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "test_v13.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    pivot_txt = tmp_path / "pivot.txt"
    pivot_txt.write_text(
        "[1] Un.\n[2] Deux.\n[3] Trois.\n[4] Quatre.\n[5] Cinq.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(pivot_txt), language="fr", title="Pivot")

    target_txt = tmp_path / "target.txt"
    target_txt.write_text(
        "[1] One.\n[2] Two.\n[3] Three.\n[4] Four.\n[5] Five.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(target_txt), language="en", title="Target")

    align_by_external_id(conn, pivot_doc_id=1, target_doc_ids=[2], run_id="test-run-v13")
    build_index(conn)
    conn.close()

    token = "testtoken-v13"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    _wait_health(f"http://127.0.0.1:{server.actual_port}")

    yield f"http://127.0.0.1:{server.actual_port}", token, server

    server.shutdown()


def _get_link_ids(base: str, token: str) -> list[int]:
    """Helper to retrieve link_ids for the test pair."""
    code, body = _post(f"{base}/align/audit", {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 10}, token)
    assert code == 200
    return [lnk["link_id"] for lnk in body["links"]]


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestBatchUpdateRequiresToken:
    """Endpoint requires auth token."""

    def test_no_token_returns_401(self, v13_sidecar):
        base, token, _ = v13_sidecar
        link_ids = _get_link_ids(base, token)
        code, body = _post(
            f"{base}/align/links/batch_update",
            {"actions": [{"action": "set_status", "link_id": link_ids[0], "status": "accepted"}]},
            token=None,  # no token
        )
        assert code == 401
        assert body["ok"] is False


class TestBatchUpdateValidation:
    """Input validation."""

    def test_empty_actions_returns_400(self, v13_sidecar):
        base, token, _ = v13_sidecar
        code, body = _post(f"{base}/align/links/batch_update", {"actions": []}, token)
        assert code == 400
        assert body["ok"] is False

    def test_missing_actions_key_returns_400(self, v13_sidecar):
        base, token, _ = v13_sidecar
        code, body = _post(f"{base}/align/links/batch_update", {}, token)
        assert code == 400
        assert body["ok"] is False


class TestBatchSetStatus:
    """set_status action."""

    def test_batch_accept_multiple_links(self, v13_sidecar):
        base, token, _ = v13_sidecar
        link_ids = _get_link_ids(base, token)
        actions = [
            {"action": "set_status", "link_id": link_ids[0], "status": "accepted"},
            {"action": "set_status", "link_id": link_ids[1], "status": "accepted"},
        ]
        code, body = _post(f"{base}/align/links/batch_update", {"actions": actions}, token)
        assert code == 200
        assert body["ok"] is True
        assert body["applied"] == 2
        assert body["deleted"] == 0
        assert body["errors"] == []

    def test_batch_reject(self, v13_sidecar):
        base, token, _ = v13_sidecar
        link_ids = _get_link_ids(base, token)
        actions = [{"action": "set_status", "link_id": link_ids[2], "status": "rejected"}]
        code, body = _post(f"{base}/align/links/batch_update", {"actions": actions}, token)
        assert code == 200
        assert body["applied"] == 1

    def test_batch_unreviewed_null(self, v13_sidecar):
        """Setting status to null resets to unreviewed."""
        base, token, _ = v13_sidecar
        link_ids = _get_link_ids(base, token)
        # First accept, then reset to null
        _post(f"{base}/align/links/batch_update",
              {"actions": [{"action": "set_status", "link_id": link_ids[0], "status": "accepted"}]}, token)
        code, body = _post(f"{base}/align/links/batch_update",
                           {"actions": [{"action": "set_status", "link_id": link_ids[0], "status": None}]}, token)
        assert code == 200
        assert body["applied"] == 1

    def test_nonexistent_link_id_goes_to_errors(self, v13_sidecar):
        base, token, _ = v13_sidecar
        code, body = _post(
            f"{base}/align/links/batch_update",
            {"actions": [{"action": "set_status", "link_id": 99999, "status": "accepted"}]},
            token,
        )
        assert code == 200
        assert body["applied"] == 0
        assert len(body["errors"]) == 1
        assert body["errors"][0]["link_id"] == 99999

    def test_partial_success_some_valid_some_not(self, v13_sidecar):
        base, token, _ = v13_sidecar
        link_ids = _get_link_ids(base, token)
        actions = [
            {"action": "set_status", "link_id": link_ids[0], "status": "accepted"},
            {"action": "set_status", "link_id": 99999, "status": "accepted"},  # nonexistent
        ]
        code, body = _post(f"{base}/align/links/batch_update", {"actions": actions}, token)
        assert code == 200
        assert body["applied"] == 1
        assert len(body["errors"]) == 1


class TestBatchDelete:
    """delete action."""

    def test_batch_delete(self, v13_sidecar):
        base, token, _ = v13_sidecar
        link_ids = _get_link_ids(base, token)
        assert len(link_ids) == 5

        actions = [
            {"action": "delete", "link_id": link_ids[3]},
            {"action": "delete", "link_id": link_ids[4]},
        ]
        code, body = _post(f"{base}/align/links/batch_update", {"actions": actions}, token)
        assert code == 200
        assert body["ok"] is True
        assert body["deleted"] == 2
        assert body["applied"] == 0
        assert body["errors"] == []

        # Verify links are gone
        code2, body2 = _post(f"{base}/align/audit", {"pivot_doc_id": 1, "target_doc_id": 2}, token)
        assert code2 == 200
        assert len(body2["links"]) == 3

    def test_mixed_set_status_and_delete(self, v13_sidecar):
        base, token, _ = v13_sidecar
        link_ids = _get_link_ids(base, token)
        actions = [
            {"action": "set_status", "link_id": link_ids[0], "status": "accepted"},
            {"action": "delete", "link_id": link_ids[1]},
        ]
        code, body = _post(f"{base}/align/links/batch_update", {"actions": actions}, token)
        assert code == 200
        assert body["applied"] == 1
        assert body["deleted"] == 1
        assert body["errors"] == []

    def test_openapi_exposes_batch_update(self, v13_sidecar):
        base, _, _ = v13_sidecar
        code, spec = _get(f"{base}/openapi.json")
        assert code == 200
        assert "/align/links/batch_update" in spec["paths"]
