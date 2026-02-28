"""Persistent sidecar server tests (health/import/index/query/shutdown)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


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


def _wait_health(base_url: str, tries: int = 80) -> None:
    for _ in range(tries):
        code, payload = _http_json("GET", f"{base_url}/health")
        if code == 200 and payload.get("ok") is True and payload.get("status") == "ok":
            return
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


def test_persistent_server_import_index_query_shutdown(tmp_path: Path) -> None:
    from multicorpus_engine.sidecar import CorpusServer, sidecar_portfile_path

    db_path = tmp_path / "persistent.db"
    txt_path = tmp_path / "fixture.txt"
    txt_path.write_text("[1] Bonjour needle.\n[2] Une autre ligne.\n", encoding="utf-8")

    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0)
    server.start()
    base_url = f"http://127.0.0.1:{server.actual_port}"
    _wait_health(base_url)

    portfile = sidecar_portfile_path(db_path)
    assert portfile.exists()
    port_meta = json.loads(portfile.read_text(encoding="utf-8"))
    assert port_meta["port"] == server.actual_port
    assert port_meta["db_path"] == str(db_path)

    code_h, health = _http_json("GET", f"{base_url}/health")
    assert code_h == 200
    assert health["ok"] is True
    assert health["status"] == "ok"
    assert isinstance(health["pid"], int)
    assert isinstance(health["started_at"], str)

    code_i, imported = _http_json(
        "POST",
        f"{base_url}/import",
        {
            "mode": "txt_numbered_lines",
            "path": str(txt_path),
            "language": "fr",
            "title": "PersistentFixture",
        },
    )
    assert code_i == 200
    assert imported["ok"] is True
    assert isinstance(imported["run_id"], str)
    assert imported["doc_id"] >= 1

    code_idx, idx = _http_json("POST", f"{base_url}/index", {})
    assert code_idx == 200
    assert idx["ok"] is True
    assert isinstance(idx["run_id"], str)
    assert idx["units_indexed"] >= 2

    code_q, queried = _http_json(
        "POST",
        f"{base_url}/query",
        {"q": "needle", "mode": "segment"},
    )
    assert code_q == 200
    assert queried["ok"] is True
    assert isinstance(queried["run_id"], str)
    assert queried["count"] >= 1
    assert isinstance(queried["hits"], list)

    code_s, shut = _http_json("POST", f"{base_url}/shutdown", {})
    assert code_s == 200
    assert shut["ok"] is True
    assert shut["shutting_down"] is True

    server.join()
    for _ in range(40):
        if not portfile.exists():
            break
        time.sleep(0.05)
    assert not portfile.exists()


def test_cli_shutdown_command_uses_portfile(tmp_path: Path) -> None:
    from multicorpus_engine.sidecar import CorpusServer, sidecar_portfile_path

    db_path = tmp_path / "shutdown_cli.db"
    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0)
    server.start()
    try:
        portfile = sidecar_portfile_path(db_path)
        assert portfile.exists()

        env = os.environ.copy()
        repo_root = Path(__file__).resolve().parents[1]
        env["PYTHONPATH"] = str(repo_root / "src")
        proc = subprocess.run(
            [sys.executable, "-m", "multicorpus_engine.cli", "shutdown", "--db", str(db_path)],
            cwd=repo_root,
            env=env,
            text=True,
            capture_output=True,
        )
        assert proc.returncode == 0
        assert proc.stderr == ""
        payload = _parse_stdout_json(proc.stdout, "cli-shutdown")
        assert payload["status"] == "ok"
    finally:
        server.shutdown()


def _parse_stdout_json(raw: str, label: str) -> dict:
    text = raw.strip()
    if not text.startswith("{") or not text.endswith("}"):
        raise AssertionError(f"{label}: stdout is not JSON object: {text!r}")
    obj = json.loads(text)
    assert isinstance(obj, dict)
    return obj
