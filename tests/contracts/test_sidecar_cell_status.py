"""Contract tests 1.6.56 — POST /align/cell_status (per-cell « non traduit », D-W8).

Covers the HTTP adapter: token gate, set/clear round-trip, the 409 active-links
guard, 404s, and the /align/matrix projection reflecting the mark (token
[non traduit] + cell_statuses). Requires NO_PROXY=127.0.0.1,localhost locally
(see CLAUDE.md).
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


def _post(url: str, payload: dict, token: str | None = None) -> tuple[int, dict]:
    headers = {"Accept": "application/json", "Content-Type": "application/json; charset=utf-8"}
    if token:
        headers["X-Agrafes-Token"] = token
    req = Request(url, method="POST", data=json.dumps(payload).encode("utf-8"), headers=headers)
    try:
        with urlopen(req, timeout=10.0) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _wait_health(base_url: str, tries: int = 50) -> None:
    import time
    from urllib.request import urlopen as _open
    for _ in range(tries):
        try:
            with _open(f"{base_url}/health", timeout=2.0) as resp:
                if resp.status == 200:
                    return
        except Exception:
            pass
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


@pytest.fixture()
def cell_status_sidecar(tmp_path: Path):
    """FR hub (2 line units) + EN translation (1 unit); FR u1 linked, FR u2 free."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "test_cell_status.db"
    conn = get_connection(str(db_path))
    apply_migrations(conn)
    for title, lang, role in (("FR", "fr", "original"), ("EN", "en", "translation")):
        conn.execute(
            "INSERT INTO documents (title, language, doc_role, created_at) VALUES (?,?,?,datetime('now'))",
            (title, lang, role),
        )
    conn.execute(
        "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at)"
        " VALUES (2,'translation_of',1,datetime('now'))"
    )
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (1,'line',1,'Un.','un.')")
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (1,'line',2,'Deux.','deux.')")
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (2,'line',1,'One.','one.')")
    conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at) VALUES ('r',1,3,0,1,2,datetime('now'))"
    )
    conn.commit()
    conn.close()

    token = "testtoken-cell-status"
    server = CorpusServer(db_path=str(db_path), host="127.0.0.1", port=0, token=token)
    server.start()
    base = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base)
    yield base, token, server
    server.shutdown()


def test_requires_token(cell_status_sidecar):
    base, _token, _ = cell_status_sidecar
    code, body = _post(
        f"{base}/align/cell_status",
        {"pivot_unit_id": 2, "target_doc_id": 2, "status": "non_traduit"},
        token=None,
    )
    assert code == 401
    assert body["ok"] is False


def test_set_clear_and_matrix_projection(cell_status_sidecar):
    base, token, _ = cell_status_sidecar
    # Set on the free cell (FR u2 × EN).
    code, body = _post(
        f"{base}/align/cell_status",
        {"pivot_unit_id": 2, "target_doc_id": 2, "status": "non_traduit"},
        token,
    )
    assert code == 200
    assert body["ok"] is True
    assert body["cell_status"] == "non_traduit"
    assert body["status"] == "ok"  # the envelope field is NOT clobbered

    # The matrix projects the mark: D10 token + per-cell axis.
    code, m = _post(f"{base}/align/matrix", {"family_root_id": 1}, token)
    assert code == 200
    assert m["rows"][1][3] == "[non traduit]"
    assert m["cell_statuses"] == [[None], ["non_traduit"]]
    assert m["hub_unit_statuses"] == [None, None]

    # Clear (status null) → the cell is empty again.
    code, body = _post(
        f"{base}/align/cell_status",
        {"pivot_unit_id": 2, "target_doc_id": 2, "status": None},
        token,
    )
    assert code == 200
    assert body["cell_status"] is None
    code, m = _post(f"{base}/align/matrix", {"family_root_id": 1}, token)
    assert m["rows"][1][3] == ""
    assert m["cell_statuses"] == [[None], [None]]


def test_active_links_guard_409(cell_status_sidecar):
    base, token, _ = cell_status_sidecar
    code, body = _post(
        f"{base}/align/cell_status",
        {"pivot_unit_id": 1, "target_doc_id": 2, "status": "non_traduit"},
        token,
    )
    assert code == 409
    assert body["ok"] is False
    assert body["error_code"] == "CONFLICT"


def test_not_found_and_validation(cell_status_sidecar):
    base, token, _ = cell_status_sidecar
    code, body = _post(
        f"{base}/align/cell_status",
        {"pivot_unit_id": 999, "target_doc_id": 2, "status": "non_traduit"},
        token,
    )
    assert code == 404
    code, body = _post(
        f"{base}/align/cell_status",
        {"pivot_unit_id": 2, "target_doc_id": 1, "status": "non_traduit"},
        token,
    )
    assert code == 400
    assert body["error_code"] == "VALIDATION_ERROR"
    code, body = _post(
        f"{base}/align/cell_status",
        {"pivot_unit_id": 2, "target_doc_id": 2, "status": "ajout"},
        token,
    )
    assert code == 400
