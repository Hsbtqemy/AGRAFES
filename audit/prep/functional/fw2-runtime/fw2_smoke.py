#!/usr/bin/env python3
"""
FW-2 Runtime Smoke Tests — AGRAFES tauri-prep functional wiring
Validates wired controls against a live sidecar with a real (minimal) corpus.

NOTE: Corpus setup uses direct Python API (not sidecar HTTP import jobs) to
work around BUG-FW2-01: sidecar TEI import job passes tei_unit= but
import_tei() signature uses unit_element=.
"""
from __future__ import annotations
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error
from pathlib import Path

REPO   = Path(__file__).resolve().parents[4]
OUT    = Path(__file__).parent
TEI_FR = REPO / "tests/fixtures/tei/tei_simple_div_p_s.xml"
TEI_EN = REPO / "tests/fixtures/tei/tei_with_head_and_xmlid.xml"
PORT   = 19900
TOKEN  = "fw2test"

sys.path.insert(0, str(REPO / "src"))

results: dict = {}
FOUND_BUGS: list[dict] = []

# ── helpers ──────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    print(f"  {msg}", flush=True)

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
    if not job_id:
        return {"status": "no_job_id"}
    for _ in range(timeout):
        time.sleep(1)
        r = api("GET", f"/jobs/{job_id}")
        job = r.get("job", {})
        if job.get("status") in ("done", "error", "cancelled"):
            return job
    return {"status": "timeout"}

# ── corpus setup ──────────────────────────────────────────────────────────────

def setup_corpus():
    """Build corpus directly via Python API; start sidecar with populated DB.

    Bypasses sidecar import job due to BUG-FW2-01 (tei_unit/unit_element mismatch).
    """
    FOUND_BUGS.append({
        "id": "BUG-FW2-01",
        "location": "src/multicorpus_engine/sidecar.py (job runner for kind='import', ~line 3010)",
        "symptom": "TEI import job fails: import_tei() got an unexpected keyword argument 'tei_unit'",
        "cause": "Job handler passes tei_unit= but import_tei() signature uses unit_element=",
        "severity": "high — TEI import via sidecar job API non-functional",
        "workaround": "Direct Python API used for corpus setup in smoke tests",
    })

    tmpdir = Path(tempfile.mkdtemp(prefix="agrafes_fw2_"))
    db = tmpdir / "project.db"

    log("building corpus via Python API …")
    import sqlite3
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.tei_importer import import_tei
    from multicorpus_engine.aligner import align_by_external_id

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    apply_migrations(conn)
    conn.commit()

    fr_rep = import_tei(conn, path=TEI_FR, language="fr", title="Le prince (FR)")
    conn.commit()
    fr_doc_id = fr_rep.doc_id
    log(f"  FR doc_id={fr_doc_id}  units={fr_rep.units_total}")

    en_rep = import_tei(conn, path=TEI_EN, language="en", title="The Prince (EN)")
    conn.commit()
    en_doc_id = en_rep.doc_id
    log(f"  EN doc_id={en_doc_id}  units={en_rep.units_total}")

    # Align by external_id (p1/p2/p3 match across FR/EN fixtures)
    reports = align_by_external_id(
        conn, pivot_doc_id=fr_doc_id, target_doc_ids=[en_doc_id],
        run_id="fw2-test-run-001",
    )
    conn.commit()
    links_created = sum(r.links_created for r in (reports or []))
    log(f"  alignment: {links_created} links created")

    rows = conn.execute(
        "SELECT link_id, status FROM alignment_links WHERE pivot_doc_id=? ORDER BY link_id",
        (fr_doc_id,)
    ).fetchall()
    all_link_ids = [r["link_id"] for r in rows]
    log(f"  {len(all_link_ids)} alignment links  ids={all_link_ids[:5]}")

    # Reject the first link for exceptions_only test
    rejected_link_id = None
    if all_link_ids:
        rejected_link_id = all_link_ids[0]
        conn.execute("UPDATE alignment_links SET status='rejected' WHERE link_id=?", (rejected_link_id,))
        conn.commit()
        log(f"  rejected link_id={rejected_link_id}")

    # Add doc_relation for TEI listRelation test (scenario F)
    conn.execute(
        "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at) VALUES (?, ?, ?, datetime('now'))",
        (fr_doc_id, "translation_of", en_doc_id),
    )
    conn.commit()
    log(f"  doc_relation added: {fr_doc_id} --translation_of--> {en_doc_id}")

    conn.close()

    # Start sidecar with populated DB
    log("starting sidecar …")
    proc = subprocess.Popen(
        [sys.executable, "scripts/sidecar_entry.py", "serve",
         "--db", str(db), "--port", str(PORT), "--token", TOKEN],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(REPO),
    )
    if not wait_sidecar(proc):
        proc.terminate()
        raise RuntimeError("Sidecar failed to start")

    health = api("GET", "/health")
    log(f"  sidecar up  api_version={health.get('api_version')}  port={PORT}")

    return tmpdir, proc, db, fr_doc_id, en_doc_id, rejected_link_id

# ── scenario A: documents preview ────────────────────────────────────────────

def scenario_a(fr_doc_id: int) -> dict:
    print("\n=== A: Documents preview ===")
    r = api("GET", f"/documents/preview?doc_id={fr_doc_id}&limit=6")
    ok = r.get("ok", False)
    lines = r.get("lines", [])
    doc   = r.get("doc", {})
    log(f"ok={ok}  doc_title={doc.get('title')}  lines={len(lines)}  total_lines={r.get('total_lines')}")
    for ln in lines[:3]:
        log(f"  [{ln.get('external_id')}] {ln.get('text_norm', '')[:70]}")
    return {
        "status": "validated" if (ok and len(lines) > 0) else "failed",
        "ok": ok,
        "doc_id": fr_doc_id,
        "doc_title": doc.get("title"),
        "lines_returned": len(lines),
        "total_lines": r.get("total_lines"),
        "sample_lines": [f"[{ln.get('external_id')}] {ln.get('text_norm', '')[:60]}" for ln in lines[:3]],
        "http_route": "GET /documents/preview",
    }

# ── scenario B: segmentation job smoke ───────────────────────────────────────

def scenario_b(en_doc_id: int) -> dict:
    """Uses en_doc_id (target doc) to avoid corrupting alignment links on fr_doc_id."""
    print("\n=== B: Segmentation API smoke ===")
    # Verify existing units via preview (EN doc has no alignment role as pivot)
    r = api("GET", f"/documents/preview?doc_id={en_doc_id}&limit=20")
    units_before = len(r.get("lines", []))
    log(f"units before re-segment (EN doc={en_doc_id}): {units_before}")

    # Enqueue segment job on EN doc
    r_job = api("POST", "/jobs/enqueue", {
        "kind": "segment",
        "params": {"doc_id": en_doc_id, "lang": "en", "pack": "auto"},
    }, token=TOKEN)
    log(f"enqueue response: ok={r_job.get('ok')}  error={r_job.get('error')}")
    job_id = r_job.get("job", {}).get("job_id")
    job = poll_job(job_id or "", timeout=20)
    log(f"  job_id={job_id}  final_status={job.get('status')}  error={job.get('error')!r:.80}")

    # Units after re-segment (EN doc)
    r2 = api("GET", f"/documents/preview?doc_id={en_doc_id}&limit=20")
    units_after = len(r2.get("lines", []))
    log(f"  units after re-segment: {units_after}")

    ok = job.get("status") == "done"
    return {
        "status": "validated" if ok else "partial",
        "job_enqueued": bool(job_id),
        "job_final_status": job.get("status"),
        "job_error": job.get("error"),
        "units_before": units_before,
        "units_after": units_after,
        "note": "TEI import pre-segments; re-segment job re-processes with pack=auto",
    }

# ── scenario C: dropzone ──────────────────────────────────────────────────────

def scenario_c() -> dict:
    print("\n=== C: Dropzone (Tauri-native constraint) ===")
    note = (
        "Non validable par script automatisé. "
        "Le drag-drop natif requiert un runtime Tauri WebView réel. "
        "Dans Tauri v2 (WRY), les File objects du WebView exposent .path (propriété non-standard) "
        "contenant le chemin filesystem natif. "
        "Code vérifié : ImportScreen.ts lignes 193-220 — handler lit dataTransfer.files, "
        "caste en File & { path?: string }, et pousse dans _files[] si path non-vide. "
        "Wiring code-correct, non testable sans fenêtre Tauri native."
    )
    log(note)
    return {
        "status": "blocked",
        "reason": "requires_tauri_native_webview_window",
        "note": note,
        "code_verified_correct": True,
        "handler_file": "tauri-prep/src/screens/ImportScreen.ts",
        "handler_lines": "193-220",
    }

# ── scenario D: batch role update ────────────────────────────────────────────

def scenario_d(fr_doc_id: int, en_doc_id: int) -> dict:
    print("\n=== D: Batch role update ===")
    before = api("GET", "/documents")
    roles_before = {d["doc_id"]: d.get("doc_role") for d in before.get("documents", [])}
    log(f"roles before: {roles_before}")

    updates = [
        {"doc_id": fr_doc_id, "doc_role": "original"},
        {"doc_id": en_doc_id, "doc_role": "translation"},
    ]
    r = api("POST", "/documents/bulk_update", {"updates": updates}, token=TOKEN)
    updated_count = r.get("updated", 0)
    log(f"bulk_update ok={r.get('ok')}  updated={updated_count}  error={r.get('error')}")

    after = api("GET", "/documents")
    roles_after = {d["doc_id"]: d.get("doc_role") for d in after.get("documents", [])}
    log(f"roles after: {roles_after}")

    ok = (
        roles_after.get(fr_doc_id) == "original"
        and roles_after.get(en_doc_id) == "translation"
    )
    return {
        "status": "validated" if ok else "failed",
        "updated_count": updated_count,
        "roles_before": {str(k): v for k, v in roles_before.items()},
        "roles_after": {str(k): v for k, v in roles_after.items()},
        "expected": {str(fr_doc_id): "original", str(en_doc_id): "translation"},
        "roles_match": ok,
    }

# ── scenario E: exceptions_only CSV export ────────────────────────────────────

def scenario_e(fr_doc_id: int, en_doc_id: int, tmpdir: Path, rejected_link_id) -> dict:
    print("\n=== E: exceptions_only CSV export ===")
    out_all = str(tmpdir / "export_all.csv")
    out_exc = str(tmpdir / "export_exceptions.csv")

    # Export ALL
    r = api("POST", "/jobs/enqueue", {
        "kind": "export_align_csv",
        "params": {
            "out_path": out_all,
            "pivot_doc_id": fr_doc_id,
            "target_doc_id": en_doc_id,
            "delimiter": ",",
        }
    }, token=TOKEN)
    job_all = poll_job(r.get("job", {}).get("job_id", ""))
    rows_all = (job_all.get("result") or {}).get("rows_written", 0)
    log(f"export ALL: rows_written={rows_all}  status={job_all.get('status')}")

    # Export EXCEPTIONS ONLY
    r = api("POST", "/jobs/enqueue", {
        "kind": "export_align_csv",
        "params": {
            "out_path": out_exc,
            "pivot_doc_id": fr_doc_id,
            "target_doc_id": en_doc_id,
            "delimiter": ",",
            "exceptions_only": True,
        }
    }, token=TOKEN)
    job_exc = poll_job(r.get("job", {}).get("job_id", ""))
    rows_exc = (job_exc.get("result") or {}).get("rows_written", 0)
    log(f"export EXCEPTIONS: rows_written={rows_exc}  status={job_exc.get('status')}")

    csv_all = Path(out_all).read_text(encoding="utf-8") if Path(out_all).exists() else ""
    csv_exc = Path(out_exc).read_text(encoding="utf-8") if Path(out_exc).exists() else ""
    (OUT / "scenario_e_export_all.csv").write_text(csv_all, encoding="utf-8")
    (OUT / "scenario_e_export_exceptions.csv").write_text(csv_exc, encoding="utf-8")

    filter_effective = (job_all.get("status") == "done" and job_exc.get("status") == "done"
                        and rows_exc < rows_all)
    log(f"filter effective: {filter_effective}  (all={rows_all}, exc={rows_exc})")
    log(f"rejected_link_id: {rejected_link_id}")
    log(f"CSV ALL preview:\n{csv_all[:300]}")
    log(f"CSV EXC preview:\n{csv_exc[:300]}")

    return {
        "status": "validated" if filter_effective else "partial",
        "rejected_link_id": rejected_link_id,
        "rows_all": rows_all,
        "rows_exceptions_only": rows_exc,
        "filter_effective": filter_effective,
        "csv_all_header": csv_all.split("\n")[0] if csv_all else "",
        "csv_all_rows_preview": csv_all[:400],
        "csv_exc_rows_preview": csv_exc[:400],
        "note": "exceptions_only=true → WHERE al.status='rejected' in SQL",
    }

# ── scenario F: TEI relation_type export ─────────────────────────────────────

def scenario_f(fr_doc_id: int, tmpdir: Path) -> dict:
    print("\n=== F: TEI export with relation_type ===")
    results_f = {}
    for rtype in ("none", "translation_of"):
        out_dir = str(tmpdir / f"tei_{rtype}")
        r = api("POST", "/jobs/enqueue", {
            "kind": "export_tei",
            "params": {
                "out_dir": out_dir,
                "doc_ids": [fr_doc_id],
                "include_structure": False,
                "relation_type": rtype,
            }
        }, token=TOKEN)
        job = poll_job(r.get("job", {}).get("job_id", ""), timeout=30)
        log(f"  relation_type={rtype!r}: status={job.get('status')}  error={job.get('error')!r:.80}")

        tei_files = list(Path(out_dir).glob("*.xml")) if Path(out_dir).exists() else []
        tei_content = tei_files[0].read_text(encoding="utf-8") if tei_files else ""
        (OUT / f"scenario_f_tei_{rtype}.xml").write_text(tei_content, encoding="utf-8")

        has_lr = "<listRelation" in tei_content
        log(f"    files={len(tei_files)}  size={len(tei_content)}  has_listRelation={has_lr}")

        results_f[rtype] = {
            "job_status": job.get("status"),
            "job_error": job.get("error"),
            "files_exported": len(tei_files),
            "tei_size": len(tei_content),
            "has_listRelation": has_lr,
            "tei_preview": tei_content[:600],
        }

    both_done = all(v["job_status"] == "done" for v in results_f.values())
    differ = (results_f.get("none", {}).get("has_listRelation", False) !=
              results_f.get("translation_of", {}).get("has_listRelation", False))
    log(f"  both done={both_done}  outputs differ on listRelation={differ}")

    return {
        "status": "validated" if (both_done and differ) else ("partial" if both_done else "failed"),
        "by_relation_type": results_f,
        "outputs_differ_on_listRelation": differ,
    }

# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"FW-2 Smoke Test — repo={REPO}", flush=True)
    print(f"Output dir: {OUT}", flush=True)

    tmpdir = proc = None
    try:
        tmpdir, proc, db, fr_doc_id, en_doc_id, rejected_link_id = setup_corpus()
        log(f"Corpus: FR={fr_doc_id}  EN={en_doc_id}  rejected_link={rejected_link_id}")

        # Run order: A, D, E, F before B to preserve alignment links
        # (scenario_b re-segments EN doc, which orphans no alignment_links since FR is pivot)
        results["A_documents_preview"] = scenario_a(fr_doc_id)
        results["D_batch_role"]        = scenario_d(fr_doc_id, en_doc_id)
        results["E_exceptions_only"]   = scenario_e(fr_doc_id, en_doc_id, tmpdir, rejected_link_id)
        results["F_tei_relation_type"] = scenario_f(fr_doc_id, tmpdir)
        results["B_segmentation"]      = scenario_b(en_doc_id)  # last: re-segs EN, no FR impact
        results["C_dropzone"]          = scenario_c()

        meta = {
            "sidecar_api_version": api("GET", "/health").get("api_version"),
            "fr_doc_id": fr_doc_id,
            "en_doc_id": en_doc_id,
            "rejected_link_id": rejected_link_id,
            "tei_pivot": str(TEI_FR),
            "tei_target": str(TEI_EN),
            "found_bugs": FOUND_BUGS,
        }

    finally:
        if proc:
            proc.terminate(); proc.wait()
        if tmpdir and tmpdir.exists():
            shutil.rmtree(tmpdir, ignore_errors=True)

    out_json = OUT / "fw2_results.json"
    out_json.write_text(
        json.dumps({"meta": meta, "scenarios": results}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\n✓ Results saved to {out_json}")
    print("\n=== SUMMARY ===")
    for k, v in results.items():
        print(f"  {k}: {v.get('status', '?')}")

if __name__ == "__main__":
    main()
