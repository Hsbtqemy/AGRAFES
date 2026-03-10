#!/usr/bin/env python3
"""FW-2.1 targeted smoke — TEI import via sidecar job (BUG-FW2-01 fix validation)."""
from __future__ import annotations
import json, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error
from pathlib import Path

REPO   = Path(__file__).resolve().parents[4]
OUT    = Path(__file__).parent
TEI_FR = REPO / "tests/fixtures/tei/tei_simple_div_p_s.xml"
PORT   = 19901
TOKEN  = "fw21test"

sys.path.insert(0, str(REPO / "src"))


def api(method: str, path: str, body: dict | None = None, *, token: str | None = None) -> dict:
    url = f"http://localhost:{PORT}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Agrafes-Token"] = token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def wait_sidecar(proc: subprocess.Popen, timeout: int = 20) -> bool:
    for _ in range(timeout):
        time.sleep(1)
        try:
            api("GET", "/health")
            return True
        except Exception:
            pass
        if proc.poll() is not None:
            return False
    return False


def poll_job(job_id: str, timeout: int = 30) -> dict:
    for _ in range(timeout):
        time.sleep(1)
        r = api("GET", f"/jobs/{job_id}")
        job = r.get("job", {})
        if job.get("status") in ("done", "error", "cancelled"):
            return job
    return {"status": "timeout"}


def main() -> None:
    tmpdir = Path(tempfile.mkdtemp(prefix="agrafes_fw21_"))
    db = tmpdir / "project.db"
    proc = None

    try:
        # Init DB via migrations only (no corpus pre-load)
        import sqlite3
        from multicorpus_engine.db.migrations import apply_migrations
        conn = sqlite3.connect(str(db))
        apply_migrations(conn)
        conn.commit()
        conn.close()
        print("  DB initialised")

        # Start sidecar from Python source (fix already applied)
        proc = subprocess.Popen(
            [sys.executable, "scripts/sidecar_entry.py", "serve",
             "--db", str(db), "--port", str(PORT), "--token", TOKEN],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(REPO),
        )
        if not wait_sidecar(proc):
            raise RuntimeError("Sidecar failed to start")
        health = api("GET", "/health")
        print(f"  sidecar up  api_version={health.get('api_version')}")

        # Enqueue TEI import job (mode=tei, unit_element via tei_unit param)
        print(f"\n  Enqueuing TEI import job for {TEI_FR.name} ...")
        r_enqueue = api("POST", "/jobs/enqueue", {
            "kind": "import",
            "params": {
                "mode": "tei",
                "path": str(TEI_FR),
                "language": "fr",
                "title": "FW21 TEI test (FR)",
                "tei_unit": "p",
            }
        }, token=TOKEN)
        print(f"  enqueue ok={r_enqueue.get('ok')}  error={r_enqueue.get('error')}")
        job_id = r_enqueue.get("job", {}).get("job_id", "")
        print(f"  job_id={job_id}")

        # Poll
        job = poll_job(job_id)
        print(f"  final status: {job.get('status')}")
        print(f"  error:        {job.get('error')!r}")
        result = job.get("result") or {}
        print(f"  result:       {result}")

        # Verify document exists
        docs_r = api("GET", "/documents")
        docs = docs_r.get("documents", [])
        print(f"\n  documents in DB: {len(docs)}")
        for d in docs:
            print(f"    doc_id={d['doc_id']}  title={d.get('title')!r}  language={d.get('language')}")

        # Outcome
        no_kwarg_error = (
            job.get("error") is None
            or "tei_unit" not in str(job.get("error", ""))
        )
        success = job.get("status") == "done" and len(docs) > 0

        tei_unit_error_gone = "tei_unit" not in str(job.get("error", ""))
        print(f"\n  tei_unit kwarg error absent: {tei_unit_error_gone}")
        print(f"  job succeeded:               {job.get('status') == 'done'}")
        print(f"  document imported:           {len(docs) > 0}")

        outcome = {
            "job_status": job.get("status"),
            "job_error": job.get("error"),
            "result": result,
            "documents_count": len(docs),
            "tei_unit_kwarg_error_absent": tei_unit_error_gone,
            "validated": success,
        }
        (OUT / "fw21_tei_import_result.json").write_text(
            json.dumps(outcome, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(f"\n  ✓ result saved → fw21_tei_import_result.json")

        if success:
            print("\n=== RESULT: BUG-FW2-01 FIXED — TEI import job succeeds ===")
        else:
            print(f"\n=== RESULT: still failing — job_status={job.get('status')} error={job.get('error')!r} ===")

    finally:
        if proc:
            proc.terminate(); proc.wait()
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
