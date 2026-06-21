"""Sprint 1.5 contract tests — POST /align/collisions + /align/collisions/resolve."""

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
def v15_sidecar(tmp_path: Path):
    """Sidecar with collisions: pivot unit 1 has 2 links to target doc."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "test_v15.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)

    pivot_txt = tmp_path / "pivot.txt"
    pivot_txt.write_text(
        "[1] Alpha.\n[2] Beta.\n[3] Gamma.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(pivot_txt), language="fr", title="Pivot FR v15")

    target_txt = tmp_path / "target.txt"
    target_txt.write_text(
        "[1] One.\n[2] Two.\n[3] Three.\n",
        encoding="utf-8",
    )
    import_txt_numbered_lines(conn, str(target_txt), language="en", title="Target EN v15")

    # Create 1-to-1 links via external_id (links: 1→1, 2→2, 3→3)
    align_by_external_id(conn, pivot_doc_id=1, target_doc_ids=[2], run_id="test-run-v15")

    # Inject a duplicate link for pivot unit 1 → target unit 2 (creating collision on pivot unit 1)
    pivot_u1 = conn.execute(
        "SELECT unit_id FROM units WHERE doc_id = 1 AND external_id = 1"
    ).fetchone()[0]
    target_u2 = conn.execute(
        "SELECT unit_id FROM units WHERE doc_id = 2 AND external_id = 2"
    ).fetchone()[0]
    conn.execute(
        """
        INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id, pivot_doc_id, target_doc_id, created_at)
        VALUES ('test-collision-v15', ?, ?, 2, 1, 2, datetime('now'))
        """,
        (pivot_u1, target_u2),
    )
    conn.commit()

    build_index(conn)
    conn.close()

    token = "testtoken-v15"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    _wait_health(f"http://127.0.0.1:{server.actual_port}")

    yield f"http://127.0.0.1:{server.actual_port}", token, server

    server.shutdown()


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestCollisionsRead:
    """POST /align/collisions is read-only (no token required)."""

    def test_no_token_returns_200(self, v15_sidecar):
        base, _, _ = v15_sidecar
        code, body = _post(
            f"{base}/align/collisions",
            {"pivot_doc_id": 1, "target_doc_id": 2},
            token=None,
        )
        assert code == 200
        assert body["ok"] is True

    def test_missing_pivot_doc_id_returns_400(self, v15_sidecar):
        base, _, _ = v15_sidecar
        code, body = _post(f"{base}/align/collisions", {"target_doc_id": 2})
        assert code == 400
        assert body["ok"] is False

    def test_missing_target_doc_id_returns_400(self, v15_sidecar):
        base, _, _ = v15_sidecar
        code, body = _post(f"{base}/align/collisions", {"pivot_doc_id": 1})
        assert code == 400
        assert body["ok"] is False

    def test_nonexistent_docs_returns_empty(self, v15_sidecar):
        base, _, _ = v15_sidecar
        code, body = _post(
            f"{base}/align/collisions",
            {"pivot_doc_id": 999, "target_doc_id": 999},
        )
        assert code == 200
        assert body["total_collisions"] == 0
        assert body["collisions"] == []


class TestCollisionsResponse:
    """Response shape and collision detection."""

    def test_detects_collision(self, v15_sidecar):
        base, _, _ = v15_sidecar
        code, body = _post(
            f"{base}/align/collisions",
            {"pivot_doc_id": 1, "target_doc_id": 2},
        )
        assert code == 200
        assert body["total_collisions"] == 1
        assert len(body["collisions"]) == 1

    def test_collision_group_shape(self, v15_sidecar):
        base, _, _ = v15_sidecar
        _, body = _post(
            f"{base}/align/collisions",
            {"pivot_doc_id": 1, "target_doc_id": 2},
        )
        group = body["collisions"][0]
        assert "pivot_unit_id" in group
        assert "pivot_text" in group
        assert "links" in group
        assert isinstance(group["pivot_text"], str)

    def test_collision_group_has_multiple_links(self, v15_sidecar):
        base, _, _ = v15_sidecar
        _, body = _post(
            f"{base}/align/collisions",
            {"pivot_doc_id": 1, "target_doc_id": 2},
        )
        group = body["collisions"][0]
        assert len(group["links"]) >= 2

    def test_link_fields_present(self, v15_sidecar):
        base, _, _ = v15_sidecar
        _, body = _post(
            f"{base}/align/collisions",
            {"pivot_doc_id": 1, "target_doc_id": 2},
        )
        for lnk in body["collisions"][0]["links"]:
            assert "link_id" in lnk
            assert "target_unit_id" in lnk
            assert "target_text" in lnk
            assert "status" in lnk

    def test_pagination_limit(self, v15_sidecar):
        base, _, _ = v15_sidecar
        _, body = _post(
            f"{base}/align/collisions",
            {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 1},
        )
        assert len(body["collisions"]) <= 1
        assert "has_more" in body
        assert "next_offset" in body


class TestMultiLink:
    """All-accepted multi-links are intentional and must not appear as collisions."""

    def test_unreviewed_collision_detected(self, v15_sidecar):
        """Baseline: fixture has 2 unreviewed links → 1 collision."""
        base, _, _ = v15_sidecar
        _, body = _post(f"{base}/align/collisions", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert body["total_collisions"] == 1

    def test_all_accepted_multi_link_not_a_collision(self, v15_sidecar):
        """Once all links for a pivot are accepted, it exits the collision list."""
        base, token, _ = v15_sidecar
        # Get the two collision link ids
        _, body = _post(f"{base}/align/collisions", {"pivot_doc_id": 1, "target_doc_id": 2})
        link_ids = [lnk["link_id"] for lnk in body["collisions"][0]["links"]]
        assert len(link_ids) == 2
        # Accept both
        for lid in link_ids:
            code, _ = _post(f"{base}/align/link/update_status", {"link_id": lid, "status": "accepted"}, token=token)
            assert code == 200
        # Now it should no longer be a collision
        _, body2 = _post(f"{base}/align/collisions", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert body2["total_collisions"] == 0

    def test_partially_accepted_still_collision(self, v15_sidecar):
        """Only one link accepted (not all) → still a collision."""
        base, token, _ = v15_sidecar
        _, body = _post(f"{base}/align/collisions", {"pivot_doc_id": 1, "target_doc_id": 2})
        link_ids = [lnk["link_id"] for lnk in body["collisions"][0]["links"]]
        # Accept only one
        _post(f"{base}/align/link/update_status", {"link_id": link_ids[0], "status": "accepted"}, token=token)
        _, body2 = _post(f"{base}/align/collisions", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert body2["total_collisions"] == 1

    def test_quality_collision_count_respects_accepted(self, v15_sidecar):
        """collision_count in /align/quality also drops to 0 once all links accepted."""
        base, token, _ = v15_sidecar
        _, body = _post(f"{base}/align/collisions", {"pivot_doc_id": 1, "target_doc_id": 2})
        link_ids = [lnk["link_id"] for lnk in body["collisions"][0]["links"]]
        for lid in link_ids:
            _post(f"{base}/align/link/update_status", {"link_id": lid, "status": "accepted"}, token=token)
        _, quality = _post(f"{base}/align/quality", {"pivot_doc_id": 1, "target_doc_id": 2})
        assert quality["stats"]["collision_count"] == 0


class TestCollisionsResolve:
    """POST /align/collisions/resolve requires token, resolves links."""

    def _get_collision_link_ids(self, base: str, token: str) -> list[int]:
        _, body = _post(
            f"{base}/align/collisions",
            {"pivot_doc_id": 1, "target_doc_id": 2},
            token=None,
        )
        return [lnk["link_id"] for lnk in body["collisions"][0]["links"]]

    def test_no_token_returns_401(self, v15_sidecar):
        base, _, _ = v15_sidecar
        code, body = _post(
            f"{base}/align/collisions/resolve",
            {"actions": [{"action": "keep", "link_id": 1}]},
            token=None,
        )
        assert code == 401
        assert body["ok"] is False

    def test_missing_actions_returns_400(self, v15_sidecar):
        base, token, _ = v15_sidecar
        code, body = _post(
            f"{base}/align/collisions/resolve",
            {},
            token=token,
        )
        assert code == 400
        assert body["ok"] is False

    def test_keep_action_sets_accepted(self, v15_sidecar):
        base, token, _ = v15_sidecar
        link_ids = self._get_collision_link_ids(base, token)
        keep_id = link_ids[0]
        code, body = _post(
            f"{base}/align/collisions/resolve",
            {"actions": [{"action": "keep", "link_id": keep_id}]},
            token=token,
        )
        assert code == 200
        assert body["ok"] is True
        assert body["applied"] >= 1
        assert body["deleted"] == 0
        # Verify status via audit
        _, audit = _post(
            f"{base}/align/audit",
            {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 20},
            token=token,
        )
        link_statuses = {lnk["link_id"]: lnk["status"] for lnk in audit["links"]}
        assert link_statuses.get(keep_id) == "accepted"

    def test_reject_action_sets_rejected(self, v15_sidecar):
        base, token, _ = v15_sidecar
        link_ids = self._get_collision_link_ids(base, token)
        reject_id = link_ids[1]
        code, body = _post(
            f"{base}/align/collisions/resolve",
            {"actions": [{"action": "reject", "link_id": reject_id}]},
            token=token,
        )
        assert code == 200
        assert body["applied"] >= 1
        _, audit = _post(
            f"{base}/align/audit",
            {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 20},
            token=token,
        )
        link_statuses = {lnk["link_id"]: lnk["status"] for lnk in audit["links"]}
        assert link_statuses.get(reject_id) == "rejected"

    def test_delete_action_removes_link(self, v15_sidecar):
        base, token, _ = v15_sidecar
        link_ids = self._get_collision_link_ids(base, token)
        delete_id = link_ids[0]
        code, body = _post(
            f"{base}/align/collisions/resolve",
            {"actions": [{"action": "delete", "link_id": delete_id}]},
            token=token,
        )
        assert code == 200
        assert body["deleted"] >= 1
        # Collision should now be resolved (only 1 link remains)
        _, coll = _post(
            f"{base}/align/collisions",
            {"pivot_doc_id": 1, "target_doc_id": 2},
        )
        assert coll["total_collisions"] == 0

    def test_nonexistent_link_appended_to_errors(self, v15_sidecar):
        base, token, _ = v15_sidecar
        code, body = _post(
            f"{base}/align/collisions/resolve",
            {"actions": [{"action": "keep", "link_id": 99999}]},
            token=token,
        )
        assert code == 200
        assert body["errors"] != []
        assert body["errors"][0]["error"] == "not found"

    def test_unreviewed_action_sets_null(self, v15_sidecar):
        base, token, _ = v15_sidecar
        link_ids = self._get_collision_link_ids(base, token)
        uid = link_ids[0]
        # First set to accepted
        _post(f"{base}/align/collisions/resolve", {"actions": [{"action": "keep", "link_id": uid}]}, token=token)
        # Then reset to unreviewed
        code, body = _post(
            f"{base}/align/collisions/resolve",
            {"actions": [{"action": "unreviewed", "link_id": uid}]},
            token=token,
        )
        assert code == 200
        assert body["applied"] >= 1
        _, audit = _post(
            f"{base}/align/audit",
            {"pivot_doc_id": 1, "target_doc_id": 2, "limit": 20},
            token=token,
        )
        link_statuses = {lnk["link_id"]: lnk["status"] for lnk in audit["links"]}
        assert link_statuses.get(uid) is None


class TestCollisionsContract:
    """OpenAPI contract and api_version checks."""

    def test_openapi_exposes_collisions(self, v15_sidecar):
        base, _, _ = v15_sidecar
        code, spec = _get(f"{base}/openapi.json")
        assert code == 200
        assert "/align/collisions" in spec["paths"]

    def test_openapi_exposes_collisions_resolve(self, v15_sidecar):
        base, _, _ = v15_sidecar
        code, spec = _get(f"{base}/openapi.json")
        assert code == 200
        assert "/align/collisions/resolve" in spec["paths"]

    def test_api_version_bumped(self, v15_sidecar):
        base, _, _ = v15_sidecar
        code, body = _get(f"{base}/health")
        assert code == 200
        version = body.get("api_version", "")
        major, minor, *_ = version.split(".")
        assert (int(major), int(minor)) >= (1, 3)
