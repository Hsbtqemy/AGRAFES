"""Snapshot-style contract checks for CLI query/export file outputs."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from tests.conftest import make_docx

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_PATH = Path(__file__).resolve().parent / "snapshots" / "output_contracts.json"
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


def _run_cli(args: list[str], cwd: Path = REPO_ROOT) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(REPO_ROOT / "src")
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


def _setup_indexed_db(tmp_path: Path) -> Path:
    db_path = tmp_path / "contract-output.db"
    docx_path = tmp_path / "contract-output.docx"
    docx_path.write_bytes(
        make_docx(
            [
                "[1] Bonjour monde",
                "[2] Ceci est une ligne",
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
    ]
    for cmd in commands:
        proc = _run_cli(cmd)
        assert proc.returncode == 0, (cmd, proc.stdout, proc.stderr)
        assert proc.stderr == ""
    return db_path


def _assert_output_file_contract(fmt: str, out_path: Path) -> None:
    content = out_path.read_text(encoding="utf-8")
    if fmt == "jsonl":
        first_line = content.splitlines()[0]
        first_record = json.loads(first_line)
        assert first_record == SNAPSHOT["kwic_record"]
        return
    if fmt == "csv":
        assert content.splitlines()[0] == SNAPSHOT["csv_header"]
        return
    if fmt == "tsv":
        assert content.splitlines()[0] == SNAPSHOT["tsv_header"]
        return
    assert fmt == "html"
    for needle in SNAPSHOT["html_needles"]:
        assert needle in content


@pytest.mark.parametrize("fmt", ["jsonl", "csv", "tsv", "html"])
def test_query_output_contract_snapshot(tmp_path: Path, fmt: str) -> None:
    db_path = _setup_indexed_db(tmp_path)
    out_path = tmp_path / f"query-output.{fmt}"
    proc = _run_cli(
        [
            "query",
            "--db",
            str(db_path),
            "--q",
            "ligne",
            "--mode",
            "kwic",
            "--window",
            "3",
            "--output",
            str(out_path),
            "--output-format",
            fmt,
        ]
    )
    assert proc.returncode == 0
    assert proc.stderr == ""

    payload = _parse_single_json(proc.stdout)
    assert sorted(payload.keys()) == sorted(SNAPSHOT["query_output_stdout_keys"])
    assert "hits" not in payload
    assert Path(payload["output"]) == out_path
    assert Path(payload["log"]).name == "run.log"
    assert isinstance(payload["run_id"], str) and payload["run_id"]
    assert isinstance(payload["created_at"], str) and payload["created_at"]

    normalized = dict(payload)
    normalized.pop("run_id")
    normalized.pop("created_at")
    normalized.pop("log")
    normalized.pop("output")
    normalized.pop("output_format")
    assert normalized == SNAPSHOT["query_output_stdout_base"]
    assert payload["output_format"] == fmt

    _assert_output_file_contract(fmt, out_path)


@pytest.mark.parametrize("fmt", ["jsonl", "csv", "tsv", "html"])
def test_export_cli_contract_snapshot(tmp_path: Path, fmt: str) -> None:
    db_path = _setup_indexed_db(tmp_path)
    out_path = tmp_path / f"export.{fmt}"
    proc = _run_cli(
        [
            "export",
            "--db",
            str(db_path),
            "--format",
            fmt,
            "--output",
            str(out_path),
            "--query",
            "ligne",
            "--mode",
            "kwic",
        ]
    )
    assert proc.returncode == 0
    assert proc.stderr == ""

    payload = _parse_single_json(proc.stdout)
    assert sorted(payload.keys()) == sorted(SNAPSHOT["export_stdout_keys"])
    assert Path(payload["output"]) == out_path
    assert Path(payload["log"]).name == "run.log"
    assert isinstance(payload["run_id"], str) and payload["run_id"]
    assert isinstance(payload["created_at"], str) and payload["created_at"]

    normalized = dict(payload)
    normalized.pop("run_id")
    normalized.pop("created_at")
    normalized.pop("log")
    normalized.pop("output")
    normalized.pop("format")
    assert normalized == SNAPSHOT["export_stdout_base"]
    assert payload["format"] == fmt

    _assert_output_file_contract(fmt, out_path)
