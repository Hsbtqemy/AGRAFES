"""Tests for async sidecar job endpoints."""

from __future__ import annotations

import json
import time
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


def _wait_health(base_url: str, tries: int = 50) -> None:
    for _ in range(tries):
        code, payload = _http_json("GET", f"{base_url}/health")
        if code == 200 and payload.get("status") == "ok":
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


def _wait_job_done(base_url: str, job_id: str, timeout_s: float = 10.0) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        code, payload = _http_json("GET", f"{base_url}/jobs/{job_id}")
        assert code == 200
        job = payload["job"]
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.05)
    raise TimeoutError(f"job did not finish: {job_id}")


@pytest.fixture()
def sidecar_job_env(tmp_path: Path) -> dict:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "sidecar_jobs.db"
    conn = get_connection(db_path)
    apply_migrations(conn)

    txt_path = tmp_path / "doc.txt"
    txt_path.write_text("[1] Bonjour. Salut.\n[2] Encore une ligne.\n", encoding="utf-8")
    report = import_txt_numbered_lines(conn=conn, path=txt_path, language="fr", title="Jobs")
    build_index(conn)
    conn.close()

    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0)
    server.start()
    base_url = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base_url)
    try:
        yield {"base_url": base_url, "doc_id": report.doc_id}
    finally:
        server.shutdown()


def test_submit_index_job_and_poll_done(sidecar_job_env: dict) -> None:
    code, payload = _http_json(
        "POST",
        f"{sidecar_job_env['base_url']}/jobs",
        {"kind": "index", "params": {}},
    )
    assert code == 202
    assert payload["status"] == "accepted"
    job_id = payload["job"]["job_id"]

    job = _wait_job_done(sidecar_job_env["base_url"], job_id)
    assert job["status"] == "done"
    assert job["progress_pct"] == 100
    assert int(job["result"]["units_indexed"]) >= 1


def test_list_jobs_includes_submitted_job(sidecar_job_env: dict) -> None:
    code_create, created = _http_json(
        "POST",
        f"{sidecar_job_env['base_url']}/jobs",
        {"kind": "validate-meta", "params": {}},
    )
    assert code_create == 202
    job_id = created["job"]["job_id"]

    code_list, listing = _http_json("GET", f"{sidecar_job_env['base_url']}/jobs")
    assert code_list == 200
    ids = {j["job_id"] for j in listing["jobs"]}
    assert job_id in ids


def test_submit_unsupported_job_kind_is_validation_error(sidecar_job_env: dict) -> None:
    code, payload = _http_json(
        "POST",
        f"{sidecar_job_env['base_url']}/jobs",
        {"kind": "import", "params": {}},
    )
    assert code == 400
    assert payload["status"] == "error"
    assert payload["error_code"] == "VALIDATION_ERROR"


def test_segment_job_requires_doc_id_at_submit(sidecar_job_env: dict) -> None:
    code, payload = _http_json(
        "POST",
        f"{sidecar_job_env['base_url']}/jobs",
        {"kind": "segment", "params": {}},
    )
    assert code == 400
    assert payload["status"] == "error"
    assert payload["error_code"] == "VALIDATION_ERROR"


def test_segment_job_runs_and_returns_report(sidecar_job_env: dict) -> None:
    code, payload = _http_json(
        "POST",
        f"{sidecar_job_env['base_url']}/jobs",
        {"kind": "segment", "params": {"doc_id": sidecar_job_env["doc_id"], "lang": "fr"}},
    )
    assert code == 202
    job_id = payload["job"]["job_id"]

    job = _wait_job_done(sidecar_job_env["base_url"], job_id)
    assert job["status"] == "done"
    assert job["result"]["doc_id"] == sidecar_job_env["doc_id"]
    assert job["result"]["fts_stale"] is True


def test_unknown_job_id_returns_not_found(sidecar_job_env: dict) -> None:
    code, payload = _http_json(
        "GET",
        f"{sidecar_job_env['base_url']}/jobs/00000000-0000-0000-0000-000000000000",
    )
    assert code == 404
    assert payload["status"] == "error"
    assert payload["error_code"] == "NOT_FOUND"

