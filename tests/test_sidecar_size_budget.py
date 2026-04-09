from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "check_sidecar_size_budget.py"


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_size_budget_passes_when_under_limit(tmp_path: Path) -> None:
    artifact = tmp_path / "artifact.bin"
    artifact.write_bytes(b"x" * (5 * 1024 * 1024))  # 5 MB

    manifest = tmp_path / "manifest.json"
    _write_json(
        manifest,
        {
            "format": "onefile",
            "target_triple": "x86_64-unknown-linux-gnu",
            "artifact_path": str(artifact),
            "artifact_size_bytes": artifact.stat().st_size,
        },
    )

    budget = tmp_path / "budget.json"
    _write_json(
        budget,
        {
            "limits_mb": {
                "linux": {"onefile": 10.0},
            }
        },
    )

    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--manifest", str(manifest), "--budget-file", str(budget)],
        text=True,
        capture_output=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert "PASS" in proc.stdout


def test_size_budget_fails_when_over_limit(tmp_path: Path) -> None:
    artifact = tmp_path / "artifact.bin"
    artifact.write_bytes(b"x" * (6 * 1024 * 1024))  # 6 MB

    manifest = tmp_path / "manifest.json"
    _write_json(
        manifest,
        {
            "format": "onedir",
            "target_triple": "aarch64-apple-darwin",
            "artifact_path": str(artifact),
            "artifact_size_bytes": artifact.stat().st_size,
        },
    )

    budget = tmp_path / "budget.json"
    _write_json(
        budget,
        {
            "limits_mb": {
                "macos": {"onedir": 4.0},
            }
        },
    )

    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--manifest", str(manifest), "--budget-file", str(budget)],
        text=True,
        capture_output=True,
    )
    assert proc.returncode == 1
    assert "FAIL" in proc.stderr


def test_size_budget_uses_default_limit_when_os_format_missing(tmp_path: Path) -> None:
    artifact = tmp_path / "artifact.bin"
    artifact.write_bytes(b"x" * (2 * 1024 * 1024))  # 2 MB

    manifest = tmp_path / "manifest.json"
    _write_json(
        manifest,
        {
            "format": "onefile",
            "target_triple": "x86_64-unknown-linux-gnu",
            "artifact_path": str(artifact),
            "artifact_size_bytes": artifact.stat().st_size,
        },
    )

    budget = tmp_path / "budget.json"
    _write_json(
        budget,
        {
            "default_limit_mb": 3.0,
            "limits_mb": {},
        },
    )

    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--manifest", str(manifest), "--budget-file", str(budget)],
        text=True,
        capture_output=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert "PASS" in proc.stdout
