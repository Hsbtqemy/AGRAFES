"""Regression tests for CLI JSON contract and minimal smoke flow."""

from __future__ import annotations

import json
import os
import sqlite3
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


def test_cli_index_incremental_returns_stats(tmp_path: Path) -> None:
    db_path = tmp_path / "inc.db"
    docx_path = tmp_path / "inc.docx"
    docx_path.write_bytes(make_docx(["[1] alpha", "[2] beta"]))

    init = _run_cli(["init-project", "--db", str(db_path)])
    assert init.returncode == 0
    assert init.stderr == ""

    imported = _run_cli(
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
        ]
    )
    assert imported.returncode == 0
    assert imported.stderr == ""

    indexed = _run_cli(["index", "--db", str(db_path), "--incremental"])
    assert indexed.returncode == 0
    assert indexed.stderr == ""
    payload = _parse_single_json(indexed.stdout)
    assert payload["status"] == "ok"
    assert payload["incremental"] is True
    assert payload["units_indexed"] >= 2
    assert isinstance(payload["inserted"], int)
    assert isinstance(payload["refreshed"], int)
    assert isinstance(payload["deleted"], int)


def test_cli_diagnostics_supports_strict_mode(tmp_path: Path) -> None:
    db_path = tmp_path / "diag_cli.db"
    docx_path = tmp_path / "diag_cli.docx"
    docx_path.write_bytes(make_docx(["[1] alpha", "[2] beta"]))

    assert _run_cli(["init-project", "--db", str(db_path)]).returncode == 0
    assert (
        _run_cli(
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
            ]
        ).returncode
        == 0
    )

    diag = _run_cli(["diagnostics", "--db", str(db_path)])
    assert diag.returncode == 0
    assert diag.stderr == ""
    payload = _parse_single_json(diag.stdout)
    assert payload["status"] == "warning"
    assert payload["fts"]["stale"] is True

    diag_strict = _run_cli(["diagnostics", "--db", str(db_path), "--strict"])
    assert diag_strict.returncode == 1
    assert diag_strict.stderr == ""
    strict_payload = _parse_single_json(diag_strict.stdout)
    assert strict_payload["status"] == "warning"


def test_cli_db_optimize_and_runs_prune(tmp_path: Path) -> None:
    db_path = tmp_path / "maint_cli.db"
    docx_path = tmp_path / "maint_cli.docx"
    docx_path.write_bytes(make_docx(["[1] hello", "[2] world"]))

    assert _run_cli(["init-project", "--db", str(db_path)]).returncode == 0
    assert (
        _run_cli(
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
            ]
        ).returncode
        == 0
    )
    assert _run_cli(["index", "--db", str(db_path)]).returncode == 0
    assert _run_cli(["query", "--db", str(db_path), "--q", "hello", "--mode", "segment"]).returncode == 0

    optimize = _run_cli(["db-optimize", "--db", str(db_path), "--vacuum", "--analyze"])
    assert optimize.returncode == 0
    assert optimize.stderr == ""
    optimize_payload = _parse_single_json(optimize.stdout)
    assert optimize_payload["status"] == "ok"
    assert "vacuum" in optimize_payload["operations"]
    assert "analyze" in optimize_payload["operations"]

    dry = _run_cli(
        [
            "runs-prune",
            "--db",
            str(db_path),
            "--before",
            "2999-01-01",
            "--kind",
            "query",
            "--dry-run",
        ]
    )
    assert dry.returncode == 0
    assert dry.stderr == ""
    dry_payload = _parse_single_json(dry.stdout)
    assert dry_payload["status"] == "ok"
    assert dry_payload["dry_run"] is True
    assert dry_payload["candidates"] >= 1

    prune = _run_cli(
        [
            "runs-prune",
            "--db",
            str(db_path),
            "--before",
            "2999-01-01",
            "--kind",
            "query",
        ]
    )
    assert prune.returncode == 0
    assert prune.stderr == ""
    prune_payload = _parse_single_json(prune.stdout)
    assert prune_payload["status"] == "ok"
    assert prune_payload["dry_run"] is False
    assert prune_payload["deleted_runs"] >= 1

    conn = sqlite3.connect(str(db_path))
    remaining_query_runs = conn.execute(
        "SELECT COUNT(*) FROM runs WHERE kind = 'query'"
    ).fetchone()[0]
    conn.close()
    assert int(remaining_query_runs) == 0
