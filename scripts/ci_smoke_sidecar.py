#!/usr/bin/env python3
"""
ci_smoke_sidecar.py — Integration smoke test for the AGRAFES sidecar.

No GUI, no Tauri, no secrets needed. Runs entirely with Python + the
multicorpus_engine installed from source.

Steps:
  1. Create a temp SQLite DB and start the sidecar in serve mode
  2. Wait for the portfile to appear (avoids fragile stdout JSON parsing)
  3. Read host/port/token from the portfile
  4. Wait for /health OK
  5. Import a small text fixture (3 units) — current contract payload
  6. Rebuild the FTS index
  7. Query for "needle" — expect ≥1 hit
  8. List documents — expect ≥1
  9. Shutdown the sidecar
  10. Assert results — exit 0 on success, 1 on failure

Usage:
  python scripts/ci_smoke_sidecar.py [--timeout 60]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import textwrap
import time
import urllib.error
import urllib.request
from pathlib import Path


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    print(f"[smoke] {msg}", flush=True)


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read())


def _post(url: str, payload: dict, token: str | None = None) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Agrafes-Token"] = token  # correct header (not Authorization: Bearer)
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {body}") from exc


def wait_portfile(portfile: Path, timeout: float) -> dict:
    """Block until the portfile appears and contains valid JSON with 'port'."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if portfile.exists():
            try:
                data = json.loads(portfile.read_text(encoding="utf-8"))
                if data.get("port"):
                    return data
            except (json.JSONDecodeError, OSError):
                pass
        time.sleep(0.25)
    raise TimeoutError(f"Portfile not ready after {timeout}s: {portfile}")


def wait_healthy(base_url: str, timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            resp = _get(f"{base_url}/health")
            if resp.get("ok"):
                return True
        except Exception:
            pass
        time.sleep(0.4)
    return False


def sidecar_portfile_path(db_path: Path) -> Path:
    """Mirror of sidecar.sidecar_portfile_path — avoids import dependency."""
    try:
        from multicorpus_engine.sidecar import sidecar_portfile_path as _fn
        return _fn(db_path)
    except ImportError:
        return db_path.resolve().parent / ".agrafes_sidecar.json"


# ──────────────────────────────────────────────────────────────────────────────
# Main smoke test
# ──────────────────────────────────────────────────────────────────────────────

def run_smoke(timeout: float) -> bool:
    ok = True
    proc = None

    with tempfile.TemporaryDirectory(prefix="agrafes_smoke_") as tmpdir:
        tmp = Path(tmpdir)
        db_path = tmp / "smoke.db"
        portfile = sidecar_portfile_path(db_path)

        # Small text fixture — numbered-lines format ([N] prefix), one containing "needle"
        fixture_path = tmp / "fixture.txt"
        fixture_path.write_text(
            textwrap.dedent("""\
            [1] This is the first unit without anything special.
            [2] This needle unit contains the search term we need.
            [3] This is the third unit, also without the term.
            """),
            encoding="utf-8",
        )

        log(f"DB      : {db_path}")
        log(f"Portfile: {portfile}")
        log(f"Fixture : {fixture_path}")

        # ── Start sidecar (stdout/stderr go to PIPE so CI stderr stays clean) ──
        cmd = [
            sys.executable, "-m", "multicorpus_engine.cli",
            "serve",
            "--db", str(db_path),
            "--port", "0",
            "--host", "127.0.0.1",
            "--token", "auto",
        ]
        log(f"Starting: {' '.join(cmd)}")
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,  # swallow stderr to keep parent stderr clean
            text=True,
        )

        base_url: str | None = None
        token: str | None = None

        try:
            # ── Wait for portfile (robust; no stdout parsing) ─────────────────
            portdata = wait_portfile(portfile, timeout=timeout)
            host = portdata.get("host", "127.0.0.1")
            port = portdata["port"]
            token = portdata.get("token") or None
            base_url = f"http://{host}:{port}"
            log(f"Portfile ready → {base_url}  token={'<set>' if token else 'none'}")

            # ── Wait for /health ──────────────────────────────────────────────
            if not wait_healthy(base_url, timeout=timeout):
                log("ERROR: sidecar did not become healthy in time")
                return False
            log("Sidecar healthy ✓")

            # ── Import — current contract: mode + path, not file_path/mode=lines ──
            log("Importing fixture…")
            imp = _post(f"{base_url}/import", {
                "mode": "txt_numbered_lines",
                "path": str(fixture_path),
                "language": "en",
                "title": "Smoke fixture",
            }, token)
            if not imp.get("ok"):
                log(f"ERROR: /import failed: {imp}")
                ok = False
            else:
                log(f"  imported: {imp.get('data', {}).get('units_inserted', '?')} units ✓")

            # ── Index ─────────────────────────────────────────────────────────
            log("Rebuilding FTS index…")
            idx = _post(f"{base_url}/index", {}, token)
            if not idx.get("ok"):
                log(f"ERROR: /index failed: {idx}")
                ok = False
            else:
                log("  index rebuilt ✓")

            # ── Query (no token required) ─────────────────────────────────────
            log("Querying for 'needle'…")
            qr = _post(f"{base_url}/query", {
                "q": "needle",
                "mode": "segment",
                "limit": 10,
                "offset": 0,
            }, None)
            if not qr.get("ok"):
                log(f"ERROR: /query failed: {qr}")
                ok = False
            else:
                # success_payload wraps data at root level (not nested under "data")
                hits = qr.get("hits", [])
                total = qr.get("total", len(hits))
                log(f"  hits: {len(hits)} / total: {total}")
                if len(hits) == 0:
                    log("ERROR: expected ≥1 hit for 'needle', got 0")
                    ok = False
                else:
                    first_text = (hits[0].get("text") or hits[0].get("unit_text") or "")
                    if "needle" not in first_text.lower():
                        log(f"ERROR: first hit text does not contain 'needle': {first_text!r}")
                        ok = False
                    else:
                        log(f"  first hit text: {first_text!r} ✓")

            # ── List documents ────────────────────────────────────────────────
            log("Listing documents…")
            docs = _get(f"{base_url}/documents")
            doc_list = docs.get("documents", [])
            if len(doc_list) == 0:
                log("ERROR: expected ≥1 document after import")
                ok = False
            else:
                log(f"  {len(doc_list)} document(s) ✓")

            # ── Shutdown (token required) ─────────────────────────────────────
            log("Shutting down…")
            try:
                _post(f"{base_url}/shutdown", {}, token)
            except Exception:
                pass  # expected: connection may close before full response

        except Exception as exc:
            log(f"ERROR during smoke: {exc}")
            ok = False

        finally:
            if proc and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()

            if not ok and proc:
                out = proc.stdout.read() if proc.stdout else ""
                err = proc.stderr.read() if proc.stderr else ""
                if out:
                    log("=== sidecar stdout ===")
                    print(out, flush=True)
                if err:
                    log("=== sidecar stderr ===")
                    print(err, file=sys.stderr, flush=True)

    return ok


def main() -> None:
    parser = argparse.ArgumentParser(description="AGRAFES sidecar smoke test")
    parser.add_argument("--timeout", type=float, default=60.0,
                        help="Max seconds to wait for sidecar startup and queries")
    args = parser.parse_args()

    log("=== AGRAFES CI Smoke Test ===")
    success = run_smoke(args.timeout)
    if success:
        log("=== ALL SMOKE TESTS PASSED ✓ ===")
        sys.exit(0)
    else:
        log("=== SMOKE TEST FAILED ✗ ===")
        sys.exit(1)


if __name__ == "__main__":
    main()
