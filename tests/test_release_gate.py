"""Unit tests for release_gate.py parser helpers (Sprint 1 — V1.7.0).

Tests do NOT run npm/pytest/node — only the output-parsing helpers.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

# Load release_gate module without executing main()
_GATE_PATH = Path(__file__).parent.parent / "scripts" / "release_gate.py"
_spec = importlib.util.spec_from_file_location("release_gate", _GATE_PATH)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

parse_pytest_summary = _mod.parse_pytest_summary
parse_fts_summary = _mod.parse_fts_summary
parse_npm_build_summary = _mod.parse_npm_build_summary
StepResult = _mod.StepResult


# ── parse_pytest_summary ──────────────────────────────────────────────────────

def test_pytest_summary_all_passed() -> None:
    output = "340 passed in 89.62s (0:01:29)"
    r = parse_pytest_summary(output)
    assert r["passed"] == 340
    assert r["failed"] == 0
    assert r["ok"] is True


def test_pytest_summary_with_failures() -> None:
    output = "320 passed, 5 failed in 90s"
    r = parse_pytest_summary(output)
    assert r["passed"] == 320
    assert r["failed"] == 5
    assert r["ok"] is False


def test_pytest_summary_empty_output() -> None:
    r = parse_pytest_summary("")
    assert r["ok"] is True  # no failures found
    assert r["passed"] == 0


def test_pytest_summary_with_errors() -> None:
    output = "10 passed, 2 error in 5s"
    r = parse_pytest_summary(output)
    assert r["errors"] == 2
    assert r["ok"] is False


# ── parse_fts_summary ─────────────────────────────────────────────────────────

def test_fts_summary_all_passed() -> None:
    output = "26 tests: 26 passed, 0 failed"
    r = parse_fts_summary(output)
    assert r["passed"] == 26
    assert r["ok"] is True


def test_fts_summary_with_failures() -> None:
    output = "26 tests: 20 passed, 6 failed"
    r = parse_fts_summary(output)
    assert r["failed"] == 6
    assert r["ok"] is False


def test_fts_summary_zero_passed() -> None:
    output = "Error: could not find module"
    r = parse_fts_summary(output)
    assert r["ok"] is False


# ── parse_npm_build_summary ───────────────────────────────────────────────────

def test_npm_build_success() -> None:
    output = "dist/assets/index.js  67.11 kB │ gzip: 18.99 kB\n✓ built in 469ms"
    r = parse_npm_build_summary(output)
    assert r["ok"] is True
    assert r["built"] is True


def test_npm_build_failure() -> None:
    output = "ERROR: Build failed\n  src/main.ts(10,5): error TS2345"
    r = parse_npm_build_summary(output)
    assert r["ok"] is False


def test_npm_build_no_output() -> None:
    r = parse_npm_build_summary("")
    assert r["ok"] is False
    assert r["built"] is False


# ── StepResult ────────────────────────────────────────────────────────────────

def test_step_result_ok() -> None:
    s = StepResult("pytest", "ok", 0, 10.5, "340 passed", "")
    assert s.ok() is True
    d = s.to_dict()
    assert d["label"] == "pytest"
    assert d["status"] == "ok"
    assert d["elapsed_s"] == 10.5


def test_step_result_error() -> None:
    s = StepResult("npm_build_shell", "error", 1, 2.0, "", "Build failed")
    assert s.ok() is False
    d = s.to_dict()
    assert d["returncode"] == 1
    assert "Build failed" in d["stderr_tail"]
