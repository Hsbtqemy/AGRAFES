"""V0.5 tests for job enqueue/cancel endpoints and extended job kinds."""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _http(method: str, url: str, payload: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    data: bytes | None = None
    headers: dict = {"Accept": "application/json"}
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


def _wait_health(base_url: str, tries: int = 50) -> None:
    for _ in range(tries):
        code, p = _http("GET", f"{base_url}/health")
        if code == 200 and p.get("ok") is True:
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


def _wait_job(base_url: str, job_id: str, timeout_s: float = 12.0) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        code, p = _http("GET", f"{base_url}/jobs/{job_id}")
        assert code == 200
        job = p["job"]
        if job["status"] in ("done", "error", "canceled"):
            return job
        time.sleep(0.1)
    raise TimeoutError(f"Job {job_id} did not finish within {timeout_s}s")


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------


@pytest.fixture()
def v05_env(tmp_path: Path) -> dict:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.sidecar import CorpusServer

    db_path = tmp_path / "v05.db"
    conn = get_connection(db_path)
    apply_migrations(conn)

    txt = tmp_path / "doc.txt"
    txt.write_text("[1] Bonjour monde.\n[2] Encore une ligne.\n", encoding="utf-8")
    report = import_txt_numbered_lines(conn=conn, path=txt, language="fr", title="V05Doc")
    build_index(conn)
    conn.close()

    token = "v05-token"
    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0, token=token)
    server.start()
    base_url = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base_url)
    try:
        yield {
            "base_url": base_url,
            "token": token,
            "doc_id": report.doc_id,
            "tmp_path": tmp_path,
        }
    finally:
        server.shutdown()


# ---------------------------------------------------------------------------
# POST /jobs/enqueue — basic cases
# ---------------------------------------------------------------------------


def test_enqueue_index_requires_token(v05_env: dict) -> None:
    code, p = _http("POST", f"{v05_env['base_url']}/jobs/enqueue", {"kind": "index"})
    assert code == 401
    assert p["error_code"] == "UNAUTHORIZED"


def test_enqueue_index_succeeds(v05_env: dict) -> None:
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "index", "params": {}},
        token=v05_env["token"],
    )
    assert code == 202
    assert p["ok"] is True
    assert p["status"] == "accepted"
    job = p["job"]
    assert job["kind"] == "index"
    assert job["status"] in ("queued", "running", "done")

    done = _wait_job(v05_env["base_url"], job["job_id"])
    assert done["status"] == "done"
    assert done["result"]["units_indexed"] >= 1


def test_enqueue_unsupported_kind_returns_400(v05_env: dict) -> None:
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "bogus"},
        token=v05_env["token"],
    )
    assert code == 400
    assert p["error_code"] == "VALIDATION_ERROR"
    assert "supported_kinds" in p.get("error", {}).get("details", {})


def test_enqueue_missing_kind_returns_400(v05_env: dict) -> None:
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {},
        token=v05_env["token"],
    )
    assert code == 400


def test_enqueue_import_requires_mode_and_path(v05_env: dict) -> None:
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "import", "params": {"mode": "txt_numbered_lines"}},
        token=v05_env["token"],
    )
    assert code == 400
    assert "path" in p["error"]["message"].lower() or "mode" in p["error"]["message"].lower()


def test_enqueue_import_job_runs(v05_env: dict) -> None:
    txt_path = v05_env["tmp_path"] / "doc2.txt"
    txt_path.write_text("[1] Hello world.\n[2] Second line.\n", encoding="utf-8")
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {
            "kind": "import",
            "params": {
                "mode": "txt_numbered_lines",
                "path": str(txt_path),
                "language": "en",
                "title": "ImportJobDoc",
            },
        },
        token=v05_env["token"],
    )
    assert code == 202
    job_id = p["job"]["job_id"]
    done = _wait_job(v05_env["base_url"], job_id)
    assert done["status"] == "done"
    assert "doc_id" in done["result"]


def test_enqueue_align_job_runs(v05_env: dict) -> None:
    # Import a second doc to align against
    txt_path = v05_env["tmp_path"] / "doc_en.txt"
    txt_path.write_text("[1] Hello world.\n[2] Second line.\n", encoding="utf-8")
    code_imp, p_imp = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "import", "params": {"mode": "txt_numbered_lines", "path": str(txt_path), "language": "en", "title": "EN"}},
        token=v05_env["token"],
    )
    assert code_imp == 202
    imp_done = _wait_job(v05_env["base_url"], p_imp["job"]["job_id"])
    assert imp_done["status"] == "done"
    target_doc_id = imp_done["result"]["doc_id"]

    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {
            "kind": "align",
            "params": {
                "strategy": "external_id",
                "pivot_doc_id": v05_env["doc_id"],
                "target_doc_ids": [target_doc_id],
            },
        },
        token=v05_env["token"],
    )
    assert code == 202
    done = _wait_job(v05_env["base_url"], p["job"]["job_id"])
    assert done["status"] == "done"
    assert "reports" in done["result"]


def test_enqueue_align_hybrid_job_runs(v05_env: dict) -> None:
    txt_path = v05_env["tmp_path"] / "doc_en_hybrid.txt"
    txt_path.write_text("[1] Hello world.\n[2] Second line.\n", encoding="utf-8")
    code_imp, p_imp = _http(
        "POST",
        f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "import", "params": {"mode": "txt_numbered_lines", "path": str(txt_path), "language": "en", "title": "EN-HYBRID"}},
        token=v05_env["token"],
    )
    assert code_imp == 202
    imp_done = _wait_job(v05_env["base_url"], p_imp["job"]["job_id"])
    assert imp_done["status"] == "done"
    target_doc_id = imp_done["result"]["doc_id"]

    code, p = _http(
        "POST",
        f"{v05_env['base_url']}/jobs/enqueue",
        {
            "kind": "align",
            "params": {
                "strategy": "external_id_then_position",
                "pivot_doc_id": v05_env["doc_id"],
                "target_doc_ids": [target_doc_id],
            },
        },
        token=v05_env["token"],
    )
    assert code == 202
    done = _wait_job(v05_env["base_url"], p["job"]["job_id"])
    assert done["status"] == "done"
    assert done["result"]["strategy"] == "external_id_then_position"


def test_enqueue_align_debug_payload(v05_env: dict) -> None:
    txt_path = v05_env["tmp_path"] / "doc_en_debug.txt"
    txt_path.write_text("[1] Hello world.\n[2] Second line.\n", encoding="utf-8")
    code_imp, p_imp = _http(
        "POST",
        f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "import", "params": {"mode": "txt_numbered_lines", "path": str(txt_path), "language": "en", "title": "EN-DEBUG"}},
        token=v05_env["token"],
    )
    assert code_imp == 202
    imp_done = _wait_job(v05_env["base_url"], p_imp["job"]["job_id"])
    assert imp_done["status"] == "done"
    target_doc_id = imp_done["result"]["doc_id"]

    code, p = _http(
        "POST",
        f"{v05_env['base_url']}/jobs/enqueue",
        {
            "kind": "align",
            "params": {
                "strategy": "external_id_then_position",
                "pivot_doc_id": v05_env["doc_id"],
                "target_doc_ids": [target_doc_id],
                "debug_align": True,
            },
        },
        token=v05_env["token"],
    )
    assert code == 202
    done = _wait_job(v05_env["base_url"], p["job"]["job_id"])
    assert done["status"] == "done"
    assert isinstance(done["result"]["run_id"], str)
    assert done["result"]["debug_align"] is True
    assert "debug" in done["result"]["reports"][0]

    out_path = v05_env["tmp_path"] / "align_debug_run_report.jsonl"
    code_report, p_report = _http(
        "POST",
        f"{v05_env['base_url']}/export/run_report",
        {
            "out_path": str(out_path),
            "format": "jsonl",
            "run_id": done["result"]["run_id"],
        },
        token=v05_env["token"],
    )
    assert code_report == 200
    assert p_report["ok"] is True
    assert p_report["runs_exported"] == 1
    assert out_path.exists()
    lines = out_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    row = json.loads(lines[0])
    assert row["run_id"] == done["result"]["run_id"]
    assert row["kind"] == "align"


def test_enqueue_export_tei_job_runs(v05_env: dict) -> None:
    out_dir = v05_env["tmp_path"] / "tei_export"
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "export_tei", "params": {"out_dir": str(out_dir)}},
        token=v05_env["token"],
    )
    assert code == 202
    done = _wait_job(v05_env["base_url"], p["job"]["job_id"])
    assert done["status"] == "done"
    result = done["result"]
    assert result["count"] >= 1
    for f_path in result["files_created"]:
        assert Path(f_path).exists()


def test_enqueue_export_align_csv_missing_out_path(v05_env: dict) -> None:
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "export_align_csv", "params": {}},
        token=v05_env["token"],
    )
    assert code == 400


def test_enqueue_export_align_csv_job_runs(v05_env: dict) -> None:
    out_path = v05_env["tmp_path"] / "links.csv"
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "export_align_csv", "params": {"out_path": str(out_path)}},
        token=v05_env["token"],
    )
    assert code == 202
    done = _wait_job(v05_env["base_url"], p["job"]["job_id"])
    assert done["status"] == "done"
    assert out_path.exists()


def test_enqueue_export_run_report_job_runs(v05_env: dict) -> None:
    out_path = v05_env["tmp_path"] / "report.jsonl"
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "export_run_report", "params": {"out_path": str(out_path), "format": "jsonl"}},
        token=v05_env["token"],
    )
    assert code == 202
    done = _wait_job(v05_env["base_url"], p["job"]["job_id"])
    assert done["status"] == "done"
    assert out_path.exists()


# ---------------------------------------------------------------------------
# POST /jobs/{job_id}/cancel
# ---------------------------------------------------------------------------


def test_cancel_requires_token(v05_env: dict) -> None:
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "index", "params": {}},
        token=v05_env["token"],
    )
    assert code == 202
    job_id = p["job"]["job_id"]

    cancel_code, cancel_p = _http("POST", f"{v05_env['base_url']}/jobs/{job_id}/cancel")
    assert cancel_code == 401
    assert cancel_p["error_code"] == "UNAUTHORIZED"


def test_cancel_queued_job_succeeds(v05_env: dict) -> None:
    # Submit a job and immediately cancel before it might start
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "index", "params": {}},
        token=v05_env["token"],
    )
    assert code == 202
    job_id = p["job"]["job_id"]

    # Cancel immediately
    cancel_code, cancel_p = _http(
        "POST", f"{v05_env['base_url']}/jobs/{job_id}/cancel",
        token=v05_env["token"],
    )
    assert cancel_code == 200
    # Status is either "canceled" (queued when cancel arrived) or something terminal
    assert cancel_p["ok"] is True
    result_status = cancel_p["status"]
    assert result_status in ("canceled", "done", "error")


def test_cancel_unknown_job_id_returns_404(v05_env: dict) -> None:
    cancel_code, cancel_p = _http(
        "POST", f"{v05_env['base_url']}/jobs/00000000-0000-0000-0000-000000000000/cancel",
        token=v05_env["token"],
    )
    assert cancel_code == 404
    assert cancel_p["error_code"] == "NOT_FOUND"


def test_cancel_is_idempotent(v05_env: dict) -> None:
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "validate-meta", "params": {}},
        token=v05_env["token"],
    )
    assert code == 202
    job_id = p["job"]["job_id"]
    _wait_job(v05_env["base_url"], job_id)  # wait until done

    # Cancel a done job — idempotent
    for _ in range(2):
        cancel_code, cancel_p = _http(
            "POST", f"{v05_env['base_url']}/jobs/{job_id}/cancel",
            token=v05_env["token"],
        )
        assert cancel_code == 200
        assert cancel_p["ok"] is True


# ---------------------------------------------------------------------------
# GET /jobs with ?status= filter
# ---------------------------------------------------------------------------


def test_list_jobs_status_filter(v05_env: dict) -> None:
    # Submit and complete a validate-meta job
    code, p = _http(
        "POST", f"{v05_env['base_url']}/jobs/enqueue",
        {"kind": "validate-meta", "params": {}},
        token=v05_env["token"],
    )
    assert code == 202
    job_id = p["job"]["job_id"]
    _wait_job(v05_env["base_url"], job_id)

    # Filter by "done"
    code2, p2 = _http("GET", f"{v05_env['base_url']}/jobs?status=done")
    assert code2 == 200
    assert p2["ok"] is True
    done_ids = {j["job_id"] for j in p2["jobs"]}
    assert job_id in done_ids
    assert all(j["status"] == "done" for j in p2["jobs"])


def test_list_jobs_response_has_pagination_fields(v05_env: dict) -> None:
    code, p = _http("GET", f"{v05_env['base_url']}/jobs")
    assert code == 200
    assert "jobs" in p
    assert "total" in p
    assert "limit" in p
    assert "offset" in p
    assert "has_more" in p


def test_list_jobs_limit_and_offset(v05_env: dict) -> None:
    # Submit 3 jobs
    for _ in range(3):
        _http("POST", f"{v05_env['base_url']}/jobs/enqueue",
              {"kind": "validate-meta", "params": {}}, token=v05_env["token"])

    code, p = _http("GET", f"{v05_env['base_url']}/jobs?limit=2&offset=0")
    assert code == 200
    assert len(p["jobs"]) <= 2


# ---------------------------------------------------------------------------
# OpenAPI contract includes new V0.5 paths
# ---------------------------------------------------------------------------


def test_openapi_includes_v05_paths(v05_env: dict) -> None:
    code, spec = _http("GET", f"{v05_env['base_url']}/openapi.json")
    assert code == 200
    paths = spec.get("paths", {})
    assert "/jobs/enqueue" in paths
    assert "/jobs/{job_id}/cancel" in paths
    assert "post" in paths["/jobs/enqueue"]
    assert "post" in paths["/jobs/{job_id}/cancel"]
    info = spec.get("info", {})
    assert "x-contract-version" in info
