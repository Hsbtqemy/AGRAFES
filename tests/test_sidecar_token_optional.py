"""CLI sidecar hardening tests: token modes and stale portfile recovery."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _run_cli(args: list[str], timeout: float = 10.0) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(_repo_root() / "src")
    return subprocess.run(
        [sys.executable, "-m", "multicorpus_engine.cli", *args],
        cwd=_repo_root(),
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def _spawn_serve(db_path: Path, token: str) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(_repo_root() / "src")
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "multicorpus_engine.cli",
            "serve",
            "--db",
            str(db_path),
            "--host",
            "127.0.0.1",
            "--port",
            "0",
            "--token",
            token,
        ],
        cwd=_repo_root(),
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def _parse_single_json(raw: str, label: str) -> dict:
    text = raw.strip()
    if not text.startswith("{") or not text.endswith("}"):
        raise AssertionError(f"{label}: stdout is not one JSON object: {text!r}")
    payload = json.loads(text)
    assert isinstance(payload, dict)
    return payload


def _wait_portfile(portfile: Path, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if portfile.exists():
            return json.loads(portfile.read_text(encoding="utf-8"))
        time.sleep(0.05)
    raise AssertionError(f"Portfile was not created in time: {portfile}")


def _http_json(
    method: str,
    url: str,
    payload: dict | None = None,
    headers: dict | None = None,
) -> tuple[int, dict]:
    data: bytes | None = None
    merged_headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        merged_headers["Content-Type"] = "application/json; charset=utf-8"
    if headers:
        merged_headers.update(headers)

    req = Request(url, method=method, data=data, headers=merged_headers)
    try:
        with urlopen(req, timeout=10.0) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body)
    except HTTPError as exc:
        body = exc.read().decode("utf-8")
        return exc.code, json.loads(body)


def _wait_health(base_url: str, tries: int = 120) -> dict:
    for _ in range(tries):
        code, payload = _http_json("GET", f"{base_url}/health")
        if code == 200 and payload.get("ok") is True and payload.get("status") == "ok":
            return payload
        time.sleep(0.05)
    raise RuntimeError("Sidecar not ready")


def test_token_off_keeps_write_endpoints_open(tmp_path: Path) -> None:
    from multicorpus_engine.sidecar import sidecar_portfile_path

    db_path = tmp_path / "token_off.db"
    txt_path = tmp_path / "fixture.txt"
    txt_path.write_text("[1] bonjour token off\n", encoding="utf-8")

    proc = _spawn_serve(db_path, token="off")
    try:
        portfile = sidecar_portfile_path(db_path)
        info = _wait_portfile(portfile)
        assert "token" not in info
        base_url = f"http://{info['host']}:{info['port']}"

        health = _wait_health(base_url)
        assert health["token_required"] is False

        code_i, imported = _http_json(
            "POST",
            f"{base_url}/import",
            {
                "mode": "txt_numbered_lines",
                "path": str(txt_path),
                "language": "fr",
            },
        )
        assert code_i == 200
        assert imported["ok"] is True

        code_s, shut = _http_json("POST", f"{base_url}/shutdown", {})
        assert code_s == 200
        assert shut["ok"] is True
    finally:
        try:
            stdout, stderr = proc.communicate(timeout=10.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate(timeout=5.0)

    assert proc.returncode == 0
    assert stderr == ""
    startup = _parse_single_json(stdout, "serve-token-off")
    assert startup["status"] == "listening"
    assert startup["token_required"] is False


def test_token_auto_requires_header_for_write(tmp_path: Path) -> None:
    from multicorpus_engine.sidecar import sidecar_portfile_path
    from multicorpus_engine.sidecar_contract import ERR_UNAUTHORIZED

    db_path = tmp_path / "token_auto.db"
    txt_path = tmp_path / "fixture.txt"
    txt_path.write_text("[1] bonjour token auto\n", encoding="utf-8")

    proc = _spawn_serve(db_path, token="auto")
    try:
        portfile = sidecar_portfile_path(db_path)
        info = _wait_portfile(portfile)
        token = info.get("token")
        assert isinstance(token, str) and token

        base_url = f"http://{info['host']}:{info['port']}"
        health = _wait_health(base_url)
        assert health["token_required"] is True

        code_unauth, unauth = _http_json(
            "POST",
            f"{base_url}/import",
            {
                "mode": "txt_numbered_lines",
                "path": str(txt_path),
                "language": "fr",
            },
        )
        assert code_unauth == 401
        assert unauth["ok"] is False
        assert unauth["error_code"] == ERR_UNAUTHORIZED

        auth_header = {"X-Agrafes-Token": token}
        code_i, imported = _http_json(
            "POST",
            f"{base_url}/import",
            {
                "mode": "txt_numbered_lines",
                "path": str(txt_path),
                "language": "fr",
            },
            headers=auth_header,
        )
        assert code_i == 200
        assert imported["ok"] is True

        code_s, shut = _http_json(
            "POST",
            f"{base_url}/shutdown",
            {},
            headers=auth_header,
        )
        assert code_s == 200
        assert shut["ok"] is True
    finally:
        try:
            stdout, stderr = proc.communicate(timeout=10.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate(timeout=5.0)

    assert proc.returncode == 0
    assert stderr == ""
    startup = _parse_single_json(stdout, "serve-token-auto")
    assert startup["status"] == "listening"
    assert startup["token_required"] is True


def test_serve_reports_already_running_instead_of_starting_second_process(tmp_path: Path) -> None:
    from multicorpus_engine.sidecar import sidecar_portfile_path

    db_path = tmp_path / "already_running.db"
    proc = _spawn_serve(db_path, token="off")
    try:
        portfile = sidecar_portfile_path(db_path)
        info = _wait_portfile(portfile)
        base_url = f"http://{info['host']}:{info['port']}"
        _wait_health(base_url)

        second = _run_cli(
            [
                "serve",
                "--db",
                str(db_path),
                "--host",
                "127.0.0.1",
                "--port",
                "0",
                "--token",
                "off",
            ]
        )
        assert second.returncode == 0
        assert second.stderr == ""
        second_payload = _parse_single_json(second.stdout, "serve-already-running")
        assert second_payload["status"] == "already_running"
        assert second_payload["port"] == info["port"]
        assert second_payload["token_required"] is False

        code_s, shut = _http_json("POST", f"{base_url}/shutdown", {})
        assert code_s == 200
        assert shut["ok"] is True
    finally:
        try:
            stdout, stderr = proc.communicate(timeout=10.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate(timeout=5.0)

    assert proc.returncode == 0
    assert stderr == ""
    startup = _parse_single_json(stdout, "serve-first-instance")
    assert startup["status"] == "listening"


def test_serve_replaces_stale_portfile_and_status_reports_states(tmp_path: Path) -> None:
    from multicorpus_engine.sidecar import sidecar_portfile_path

    db_path = tmp_path / "stale.db"
    portfile = sidecar_portfile_path(db_path)
    portfile.write_text(
        json.dumps(
            {
                "host": "127.0.0.1",
                "port": 9,
                "pid": 999999,
                "started_at": "2001-01-01T00:00:00Z",
                "db_path": str(db_path),
            }
        ),
        encoding="utf-8",
    )

    stale_status = _run_cli(["status", "--db", str(db_path)])
    assert stale_status.returncode == 0
    assert stale_status.stderr == ""
    stale_payload = _parse_single_json(stale_status.stdout, "status-stale")
    assert stale_payload["state"] == "stale"

    proc = _spawn_serve(db_path, token="off")
    try:
        info = _wait_portfile(portfile)
        deadline = time.time() + 10.0
        while time.time() < deadline:
            running_status = _run_cli(["status", "--db", str(db_path)])
            if running_status.returncode == 0 and running_status.stderr == "":
                running_payload = _parse_single_json(running_status.stdout, "status-running-poll")
                if running_payload.get("state") == "running":
                    info = json.loads(portfile.read_text(encoding="utf-8"))
                    break
            time.sleep(0.05)
        assert info["port"] != 9
        assert info["pid"] != 999999
        base_url = f"http://{info['host']}:{info['port']}"
        _wait_health(base_url)

        running_status = _run_cli(["status", "--db", str(db_path)])
        assert running_status.returncode == 0
        assert running_status.stderr == ""
        running_payload = _parse_single_json(running_status.stdout, "status-running")
        assert running_payload["state"] == "running"
        assert running_payload["port"] == info["port"]

        code_s, shut = _http_json("POST", f"{base_url}/shutdown", {})
        assert code_s == 200
        assert shut["ok"] is True
    finally:
        try:
            stdout, stderr = proc.communicate(timeout=10.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate(timeout=5.0)

    assert proc.returncode == 0
    assert stderr == ""
    startup = _parse_single_json(stdout, "serve-stale-recovery")
    assert startup["status"] == "listening"
    assert startup["token_required"] is False

    missing_status = _run_cli(["status", "--db", str(db_path)])
    assert missing_status.returncode == 0
    assert missing_status.stderr == ""
    missing_payload = _parse_single_json(missing_status.stdout, "status-missing")
    assert missing_payload["state"] == "missing"
