"""Smoke-run the built sidecar binary (audit P0-1 / A-01 safety net).

CI *builds* the frozen PyInstaller sidecar but never *runs* it, so a service that
PyInstaller failed to bundle (or any startup regression) would only surface at
runtime in production. This script closes that gap: it starts the binary, waits
for /health, then hits one representative GET per extracted service layer, and
shuts it down. Add a new check below whenever a new service is extracted.

Usage:
    python scripts/smoke_sidecar.py <exe | out-dir | manifest.json>
    python scripts/smoke_sidecar.py --via-module x   # self-test the script via `python -m`
    python scripts/smoke_sidecar.py <exe> --dry-run  # print the serve command, don't run

Exit code 0 = the binary started and served every check; non-zero = failure
(with the binary's captured output for diagnosis).
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

# (path, expected key in the JSON body) — one public GET per extracted service.
CHECKS: list[tuple[str, str]] = [
    ("/conventions", "conventions"),       # conventions_service
    ("/doc_relations/all", "relations"),   # doc_relations_service
    ("/documents", "documents"),           # documents_service
    ("/curate/exceptions", "exceptions"),  # curate_service
    ("/units?doc_id=1", "units"),          # units_service
    ("/tokens?doc_id=1", "tokens"),        # tokens_service
    ("/models", "models"),                 # models_service (spaCy model catalog)
]


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()


def _get(url: str, timeout: float = 2.0) -> tuple[int, dict]:
    with urllib.request.urlopen(url, timeout=timeout) as resp:  # noqa: S310 (loopback only)
        return resp.status, json.loads(resp.read().decode("utf-8"))


def _resolve_launch_prefix(launcher: str, via_module: bool) -> list[str]:
    """Return the argv prefix that launches the sidecar (before the `serve` verb).

    Accepts the out-dir, the manifest json, or the executable path. Handles both
    PyInstaller layouts: onefile (executable_path is the file) and onedir
    (executable_path is the bundle dir → use its inner exe, mirroring ci.yml).
    """
    if via_module:
        return [sys.executable, "-m", "multicorpus_engine.cli"]
    p = Path(launcher)
    if p.is_dir() and (p / "sidecar-manifest.json").exists():
        p = p / "sidecar-manifest.json"
    if p.suffix == ".json":
        exe = Path(json.loads(p.read_text(encoding="utf-8"))["executable_path"])
    else:
        exe = p
    if exe.is_dir():  # onedir bundle → inner executable
        inner = exe / exe.name
        if not inner.exists():
            inner = exe / "multicorpus"
        exe = inner
    return [str(exe)]


def main() -> int:
    ap = argparse.ArgumentParser(description="Smoke-run the built sidecar binary.")
    ap.add_argument("launcher", help="sidecar executable, its out-dir, or sidecar-manifest.json")
    ap.add_argument("--via-module", action="store_true",
                    help="launch via `python -m multicorpus_engine.cli` (validates this script itself)")
    ap.add_argument("--timeout", type=float, default=30.0, help="seconds to wait for /health")
    ap.add_argument("--dry-run", action="store_true", help="print the serve command and exit")
    args = ap.parse_args()

    prefix = _resolve_launch_prefix(args.launcher, args.via_module)
    port = _free_port()
    tmp = tempfile.mkdtemp(prefix="sidecar-smoke-")
    db = str(Path(tmp) / "smoke.db")
    cmd = prefix + ["serve", "--db", db, "--host", "127.0.0.1", "--port", str(port), "--token", "off"]

    if args.dry_run:
        print("DRY RUN:", " ".join(cmd))
        return 0

    base = f"http://127.0.0.1:{port}"
    # Loopback only — never route the smoke checks through a proxy.
    env = dict(os.environ, NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost")
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True
    )
    try:
        deadline = time.monotonic() + args.timeout
        healthy = False
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                out = proc.stdout.read() if proc.stdout else ""
                print(f"FAIL: sidecar exited early (code {proc.returncode}):\n{out}")
                return 1
            try:
                code, body = _get(f"{base}/health", timeout=1.0)
                if code == 200 and body.get("ok") is True:
                    healthy = True
                    break
            except Exception:
                pass
            time.sleep(0.2)

        if not healthy:
            print(f"FAIL: /health not ready within {args.timeout}s")
            return 1
        print(f"OK: /health on {base}")

        for path, key in CHECKS:
            try:
                code, body = _get(f"{base}{path}")
            except Exception as exc:
                print(f"FAIL: GET {path} raised {exc!r}")
                return 1
            if code != 200 or key not in body:
                print(f"FAIL: GET {path} -> status={code}, body keys={list(body)}")
                return 1
            print(f"OK: GET {path}")

        print("Sidecar binary smoke PASSED")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
