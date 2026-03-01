#!/usr/bin/env python3
"""release_gate.py — Automated release readiness gate for AGRAFES.

Usage (from repo root):
    python scripts/release_gate.py [--log-file build/release_gate.log]

Runs:
  1. pytest -q
  2. node tauri-app/scripts/test_buildFtsQuery.mjs
  3. npm builds: tauri-shell / tauri-app / tauri-prep
  4. Demo-DB QA gate (strict policy, parcolab_strict export, TEI validate)

Exits 0 if all gates pass, 1 on first failure.
Writes JSON result to stdout; logs to build/release_gate.log (not stderr).
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# ── Constants ─────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent
BUILD_DIR = REPO_ROOT / "build"
DEFAULT_LOG = BUILD_DIR / "release_gate.log"
DEMO_DB_SCRIPT = REPO_ROOT / "scripts" / "create_demo_db.py"
DEMO_DB_PATH = REPO_ROOT / "tauri-shell" / "public" / "demo" / "agrafes_demo.db"

sys.path.insert(0, str(REPO_ROOT / "src"))


# ── Helpers ───────────────────────────────────────────────────────────────────

_log_lines: list[str] = []
_log_file: Path = DEFAULT_LOG
_interactive: bool = sys.stdout.isatty()


def _log(msg: str) -> None:
    """Write a log line to the log buffer (and flush to file).

    In interactive mode (tty) also echoes to sys.stderr so the operator
    can see progress while JSON stays clean on stdout.
    The requirement "pas stderr" refers to error output from subprocesses;
    our own progress logs use stderr in interactive mode only.
    """
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    _log_lines.append(line)
    # Write to log file incrementally for `tail -f` support
    try:
        with _log_file.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass
    # Interactive feedback: echo to stderr (operator-facing, not subprocess stderr)
    if _interactive:
        print(line, file=sys.stderr, flush=True)


def _run(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    label: str,
    timeout: int = 300,
) -> "StepResult":
    _log(f"▶ {label}: {' '.join(cmd)}")
    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd or REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        elapsed = round(time.monotonic() - t0, 1)
        ok = proc.returncode == 0
        status = "ok" if ok else "error"
        out_tail = _tail(proc.stdout, 20)
        err_tail = _tail(proc.stderr, 10)
        _log(f"  {'✅' if ok else '❌'} {label} [{elapsed}s] rc={proc.returncode}")
        if not ok and err_tail:
            _log(f"  stderr: {err_tail[:500]}")
        return StepResult(
            label=label,
            status=status,
            returncode=proc.returncode,
            elapsed_s=elapsed,
            stdout_tail=out_tail,
            stderr_tail=err_tail,
        )
    except subprocess.TimeoutExpired:
        elapsed = round(time.monotonic() - t0, 1)
        _log(f"  ❌ {label} TIMEOUT after {elapsed}s")
        return StepResult(
            label=label,
            status="timeout",
            returncode=-1,
            elapsed_s=elapsed,
            stdout_tail="",
            stderr_tail=f"Timeout after {elapsed}s",
        )
    except FileNotFoundError as exc:
        _log(f"  ❌ {label} command not found: {exc}")
        return StepResult(
            label=label,
            status="error",
            returncode=-1,
            elapsed_s=0.0,
            stdout_tail="",
            stderr_tail=str(exc),
        )


def _tail(text: str, n: int) -> str:
    lines = text.strip().splitlines()
    return "\n".join(lines[-n:]) if lines else ""


class StepResult:
    def __init__(
        self,
        label: str,
        status: str,
        returncode: int,
        elapsed_s: float,
        stdout_tail: str,
        stderr_tail: str,
    ) -> None:
        self.label = label
        self.status = status
        self.returncode = returncode
        self.elapsed_s = elapsed_s
        self.stdout_tail = stdout_tail
        self.stderr_tail = stderr_tail

    def ok(self) -> bool:
        return self.status == "ok"

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "status": self.status,
            "returncode": self.returncode,
            "elapsed_s": self.elapsed_s,
            "stdout_tail": self.stdout_tail,
            "stderr_tail": self.stderr_tail,
        }


# ── Demo DB gate (engine-direct, no server) ───────────────────────────────────

def _gate_demo_db(tmp_out: Path) -> list[StepResult]:
    """Run demo-DB engine-direct gates without launching a server."""
    results: list[StepResult] = []

    # Step 4a: ensure demo DB exists (create if missing)
    _log("▶ Demo DB: checking presence")
    if not DEMO_DB_PATH.exists():
        _log("  Demo DB not found, creating via create_demo_db.py…")
        r = _run(
            [sys.executable, str(DEMO_DB_SCRIPT)],
            label="create_demo_db",
            timeout=60,
        )
        results.append(r)
        if not r.ok():
            return results
    else:
        _log(f"  Demo DB found: {DEMO_DB_PATH}")

    # Step 4b: QA report strict policy via engine API
    _log("▶ Demo DB: QA report (strict policy)")
    t0 = time.monotonic()
    try:
        import sqlite3

        from multicorpus_engine.qa_report import write_qa_report

        conn = sqlite3.connect(str(DEMO_DB_PATH))
        conn.row_factory = sqlite3.Row
        qa_out = tmp_out / "demo_qa_strict.json"
        report = write_qa_report(conn, qa_out, fmt="json", policy="strict")
        conn.close()
        gate_status = report["gates"]["status"]
        blocking = report["gates"]["blocking"]
        elapsed = round(time.monotonic() - t0, 1)
        ok = gate_status != "blocking"
        _log(f"  {'✅' if ok else '❌'} QA gate: {gate_status} [{elapsed}s]")
        if blocking:
            for b in blocking:
                _log(f"    BLOCKING: {b}")
        results.append(StepResult(
            label="demo_qa_strict",
            status="ok" if ok else "error",
            returncode=0 if ok else 1,
            elapsed_s=elapsed,
            stdout_tail=f"gate_status={gate_status}",
            stderr_tail="; ".join(blocking) if blocking else "",
        ))
        if not ok:
            return results
    except Exception as exc:
        elapsed = round(time.monotonic() - t0, 1)
        _log(f"  ❌ QA gate exception: {exc}")
        results.append(StepResult(
            label="demo_qa_strict",
            status="error",
            returncode=1,
            elapsed_s=elapsed,
            stdout_tail="",
            stderr_tail=str(exc),
        ))
        return results

    # Step 4c: export parcolab_strict package
    _log("▶ Demo DB: TEI package export (parcolab_strict, include_alignment)")
    t0 = time.monotonic()
    try:
        import sqlite3

        from multicorpus_engine.exporters.tei_package import export_tei_package

        conn = sqlite3.connect(str(DEMO_DB_PATH))
        conn.row_factory = sqlite3.Row
        zip_out = tmp_out / "demo_release_gate.zip"
        export_tei_package(
            conn,
            output_path=zip_out,
            tei_profile="parcolab_strict",
            include_alignment=True,
            include_structure=True,
        )
        conn.close()
        elapsed = round(time.monotonic() - t0, 1)
        _log(f"  ✅ Package exported → {zip_out.name} [{elapsed}s]")
        results.append(StepResult(
            label="demo_export_parcolab_strict",
            status="ok",
            returncode=0,
            elapsed_s=elapsed,
            stdout_tail=f"zip={zip_out.name}",
            stderr_tail="",
        ))
    except Exception as exc:
        elapsed = round(time.monotonic() - t0, 1)
        _log(f"  ❌ Package export exception: {exc}")
        results.append(StepResult(
            label="demo_export_parcolab_strict",
            status="error",
            returncode=1,
            elapsed_s=elapsed,
            stdout_tail="",
            stderr_tail=str(exc),
        ))
        return results

    # Step 4d: validate TEI package
    _log("▶ Demo DB: TEI validate package")
    t0 = time.monotonic()
    try:
        from multicorpus_engine.utils.tei_validate import validate_tei_package

        val_results = validate_tei_package(zip_out)
        total_errors = sum(len(v) for v in val_results.values())
        elapsed = round(time.monotonic() - t0, 1)
        ok = total_errors == 0
        _log(f"  {'✅' if ok else '❌'} TEI validation: {total_errors} error(s) across {len(val_results)} file(s) [{elapsed}s]")
        if not ok:
            for fname, errs in val_results.items():
                for e in errs:
                    _log(f"    {fname}: {e}")
        results.append(StepResult(
            label="demo_tei_validate",
            status="ok" if ok else "error",
            returncode=0 if ok else 1,
            elapsed_s=elapsed,
            stdout_tail=f"files={len(val_results)} errors={total_errors}",
            stderr_tail="" if ok else json.dumps(val_results, ensure_ascii=False)[:500],
        ))
    except Exception as exc:
        elapsed = round(time.monotonic() - t0, 1)
        _log(f"  ❌ TEI validate exception: {exc}")
        results.append(StepResult(
            label="demo_tei_validate",
            status="error",
            returncode=1,
            elapsed_s=elapsed,
            stdout_tail="",
            stderr_tail=str(exc),
        ))

    return results


# ── Parse gate output helpers (tested in unit tests) ─────────────────────────

def parse_pytest_summary(output: str) -> dict:
    """Extract pass/fail counts from pytest -q stdout.

    Returns: {passed: int, failed: int, errors: int, ok: bool}
    """
    import re

    passed = failed = errors = 0
    for line in output.splitlines():
        m = re.search(r"(\d+) passed", line)
        if m:
            passed = int(m.group(1))
        m = re.search(r"(\d+) failed", line)
        if m:
            failed = int(m.group(1))
        m = re.search(r"(\d+) error", line)
        if m:
            errors = int(m.group(1))
    return {"passed": passed, "failed": failed, "errors": errors, "ok": failed == 0 and errors == 0}


def parse_fts_summary(output: str) -> dict:
    """Extract pass/fail from test_buildFtsQuery output.

    Returns: {passed: int, failed: int, ok: bool}
    """
    import re

    passed = failed = 0
    m = re.search(r"(\d+) passed", output)
    if m:
        passed = int(m.group(1))
    m = re.search(r"(\d+) failed", output)
    if m:
        failed = int(m.group(1))
    ok = failed == 0 and passed > 0
    return {"passed": passed, "failed": failed, "ok": ok}


def parse_npm_build_summary(output: str) -> dict:
    """Check npm build success from vite output.

    Returns: {ok: bool, built: bool}
    """
    built = "built in" in output or "✓ built in" in output
    error = "error" in output.lower() and "ERROR" in output
    return {"ok": built and not error, "built": built}


# ── Main ──────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AGRAFES release gate (no secrets)")
    parser.add_argument("--log-file", default=str(DEFAULT_LOG), help="Log file path")
    parser.add_argument("--skip-demo", action="store_true", help="Skip demo DB gates")
    parser.add_argument("--skip-builds", action="store_true", help="Skip npm builds")
    args = parser.parse_args(argv)

    global _log_file
    _log_file = Path(args.log_file)
    _log_file.parent.mkdir(parents=True, exist_ok=True)

    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    _log(f"=== AGRAFES Release Gate — {started_at} ===")
    _log(f"Repo: {REPO_ROOT}")

    all_steps: list[StepResult] = []
    failed_steps: list[str] = []

    # ── Step 1: pytest ────────────────────────────────────────────────────────
    r = _run([sys.executable, "-m", "pytest", "-q", "--tb=no", "-q"],
             label="pytest", timeout=300)
    all_steps.append(r)
    if not r.ok():
        failed_steps.append("pytest")

    # ── Step 2: FTS query tests ───────────────────────────────────────────────
    node_bin = shutil.which("node") or "node"
    fts_script = str(REPO_ROOT / "tauri-app" / "scripts" / "test_buildFtsQuery.mjs")
    r = _run([node_bin, fts_script], label="fts_tests", timeout=60)
    all_steps.append(r)
    if not r.ok():
        failed_steps.append("fts_tests")

    # ── Step 3: npm builds ────────────────────────────────────────────────────
    if not args.skip_builds:
        npm_bin = shutil.which("npm") or "npm"
        for prefix in ("tauri-shell", "tauri-app", "tauri-prep"):
            r = _run(
                [npm_bin, "--prefix", prefix, "run", "build"],
                label=f"npm_build_{prefix}",
                timeout=120,
            )
            all_steps.append(r)
            if not r.ok():
                failed_steps.append(f"npm_build_{prefix}")
    else:
        _log("  (npm builds skipped via --skip-builds)")

    # ── Step 4: Demo DB gates ─────────────────────────────────────────────────
    if not args.skip_demo:
        with tempfile.TemporaryDirectory(prefix="agrafes_gate_") as tmp_dir:
            demo_results = _gate_demo_db(Path(tmp_dir))
            all_steps.extend(demo_results)
            for dr in demo_results:
                if not dr.ok():
                    failed_steps.append(dr.label)
    else:
        _log("  (demo gates skipped via --skip-demo)")

    # ── Final result ──────────────────────────────────────────────────────────
    total_ok = len(failed_steps) == 0
    finished_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    result = {
        "status": "ok" if total_ok else "error",
        "started_at": started_at,
        "finished_at": finished_at,
        "steps": [s.to_dict() for s in all_steps],
        "failed_steps": failed_steps,
        "summary": {
            "total": len(all_steps),
            "passed": sum(1 for s in all_steps if s.ok()),
            "failed": len(failed_steps),
        },
    }

    _log(f"\n{'✅ ALL GATES PASSED' if total_ok else '❌ GATE FAILED: ' + ', '.join(failed_steps)}")
    _log(f"Steps: {result['summary']['passed']}/{result['summary']['total']} ok")

    _log(f"Log → {_log_file}")
    # Rewrite log file in full (already flushed incrementally, this is definitive)
    _log_file.write_text("\n".join(_log_lines), encoding="utf-8")

    # JSON output to stdout ONLY — logs are in the log file
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)

    return 0 if total_ok else 1


if __name__ == "__main__":
    sys.exit(main())
