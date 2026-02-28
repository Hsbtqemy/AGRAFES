"""Regression tests for CLI JSON contract and minimal smoke flow."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from tests.conftest import make_docx

_REPO_ROOT = Path(__file__).parent.parent


def _run_cli(args: list[str], cwd: Path = _REPO_ROOT) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(_REPO_ROOT / "src")
    return subprocess.run(
        [sys.executable, "-m", "multicorpus_engine.cli", *args],
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
    )


def _parse_single_json(stdout: str) -> dict:
    payload_raw = stdout.strip()
    assert payload_raw.startswith("{")
    assert payload_raw.endswith("}")
    payload = json.loads(payload_raw)
    assert isinstance(payload, dict)
    return payload


def test_cli_smoke_flow_returns_single_json_object(tmp_path: Path) -> None:
    """Smoke: init/import/index/query(segment+kwic) keeps strict JSON contract."""
    db_path = tmp_path / "smoke.db"
    docx_path = tmp_path / "smoke.docx"
    docx_path.write_bytes(
        make_docx(
            [
                "[1] Bonjour ¤ monde",
                "[2] Ceci est une ligne",
                "Chapitre I",
            ]
        )
    )

    commands = [
        ["init-project", "--db", str(db_path)],
        [
            "import",
            "--db",
            str(db_path),
            "--mode",
            "docx_numbered_lines",
            "--language",
            "fr",
            "--path",
            str(docx_path),
            "--title",
            "Smoke",
        ],
        ["index", "--db", str(db_path)],
        ["query", "--db", str(db_path), "--q", "Bonjour", "--mode", "segment"],
        ["query", "--db", str(db_path), "--q", "ligne", "--mode", "kwic", "--window", "3"],
    ]

    payloads: list[dict] = []
    for cmd in commands:
        proc = _run_cli(cmd)
        assert proc.returncode == 0
        assert proc.stderr == ""
        payload = _parse_single_json(proc.stdout)
        assert payload.get("status") in {"ok", "warnings", "listening"}
        payloads.append(payload)

    segment = payloads[3]
    assert segment["mode"] == "segment"
    assert segment["count"] >= 1
    assert isinstance(segment.get("hits"), list)

    kwic = payloads[4]
    assert kwic["mode"] == "kwic"
    assert kwic["count"] >= 1
    assert isinstance(kwic.get("hits"), list)
    first = kwic["hits"][0]
    assert "left" in first and "match" in first and "right" in first


def test_cli_argparse_failure_returns_json_error(tmp_path: Path) -> None:
    """Argument parsing failures must still return JSON envelope + exit code 1."""
    proc = _run_cli(
        [
            "query",
            "--db",
            str(tmp_path / "x.db"),
            "--q",
            "x",
            "--mode",
            "bad_mode",
        ]
    )

    assert proc.returncode == 1
    assert proc.stderr == ""

    payload = _parse_single_json(proc.stdout)
    assert payload["status"] == "error"
    assert "Invalid arguments" in payload["error"]
    assert "created_at" in payload
