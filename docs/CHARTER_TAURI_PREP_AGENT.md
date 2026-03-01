# Charter — Concordancier Prep (tauri-prep)

**Last updated:** 2026-02-28
**Version:** V0.5

---

## Mission

`tauri-prep` is the **corpus preparation desktop app** of the AGRAFES suite.
Its sole role is to help a corpus manager go from raw files (DOCX/TXT/TEI) to a
ready-to-query corpus in five steps:

1. Open or create a corpus DB
2. Batch-import source documents (with mode, language, title)
3. Rebuild the FTS index
4. Curate / segment / align documents
5. Validate metadata before handing off the DB to Concordancier

It communicates with `multicorpus_engine` **exclusively via the sidecar HTTP API**
on `127.0.0.1`; no Python is embedded in the Tauri process.

---

## Scope

| In scope (V0–V0.5) | Out of scope |
|---|---|
| Open/create DB file via dialog | Query/KWIC search (→ Concordancier) |
| Sidecar status display (port, pid, health) | Advanced TEI editing |
| Batch import (DOCX/TXT/TEI, mode+lang+title) | Multi-user / network corpus |
| FTS index rebuild | Plugin/extension system |
| Curate (JSON rules + preview diff) | |
| Segment (per-doc, lang select) | |
| Align (strategy + doc selector + audit + correction) | |
| Metadata validate + per-doc edit + bulk edit | |
| Doc relations manage (set/delete) | |
| Export TEI/CSV/run-report | |
| Async job enqueue (POST /jobs/enqueue) | |
| Job Center panel (progress + cancel + recent) | |
| Sidecar shutdown | |

---

## Anti-drift rules

1. **No pytest breakage.** Every code change to `src/` or `tests/` must leave all
   existing tests green. Run `pytest -q` before committing.
2. **No breaking sidecar API changes.** New endpoints are additive; existing
   response envelopes keep their shape. Clients relying on `ok`, `api_version`,
   `status` must not be broken.
3. **Contract freeze (V0.5+).** The OpenAPI snapshot at `tests/snapshots/openapi_paths.json`
   is the source of truth for the sidecar API surface. **Never remove an endpoint**
   without updating the snapshot and `docs/SIDECAR_API_CONTRACT.md`. The tests
   `test_contract_openapi_snapshot.py` and `test_contract_docs_sync.py` enforce this.
   Run `python scripts/export_openapi.py` after adding endpoints to refresh the snapshot.
4. **No Python inside Tauri process.** All engine calls go via HTTP
   (`http://127.0.0.1:<port>/<route>`). Do not shell-exec Python.
5. **ADR-025 sidecar format.** macOS = PyInstaller onefile; Linux/Windows =
   onedir directory bundle. The `prepare_sidecar.sh` / `.ps1` scripts handle
   packaging.
6. **Screens are independent TS modules.** Each screen (ProjectScreen,
   ImportScreen, ActionsScreen, MetadataScreen, ExportsScreen) is a
   self-contained class with a `render()` method returning an `HTMLElement`.
   No global state except `AppState`.
7. **sidecarClient.ts is the only HTTP layer.** All fetch calls go through it.
   No `fetch()` or `XMLHttpRequest` outside sidecarClient.
8. **V0 functional first.** No animations, no complex theming, no external UI
   libraries. Pure vanilla TS + CSS variables.
9. **Always confirm destructive actions.** Align, curate, and segment buttons
   must show a confirmation dialog before firing.
10. **Log pane, not alerts.** Errors from the sidecar surface in the log pane;
    `window.alert()` is forbidden.
11. **Long operations use job enqueue (V0.5+).** Import, index rebuild, curate,
    segment, align, and all exports must call `POST /jobs/enqueue` (not the sync
    endpoint) and track via the `JobCenter`. Direct sync calls are allowed only
    for fast read operations (listDocuments, health, audit, preview).

---

## Technical rules

- Tauri v2, `plugin-shell` (sidecar spawn), `plugin-fs` (portfile),
  `plugin-dialog` (file picker), `plugin-http` (localhost fetch),
  `plugin-path` (appDataDir).
- Portfile pattern: `ensureRunning(dbPath)` → reads `.agrafes_sidecar.json`
  in the DB directory → polls `/health` → if absent, spawns
  `multicorpus serve --db <path> --host 127.0.0.1 --port 0 --token auto`.
- Sidecar binary at `src-tauri/binaries/multicorpus-<target-triple>` (copied
  by `prepare_sidecar.sh`). Tauri `externalBin = ["multicorpus"]` in
  `tauri.conf.json`. `build.rs` copies it to manifest root at build time.
- Shared `sidecarClient.ts` pattern: `Conn` interface with `.post()` / `.get()`,
  token injection via `X-Agrafes-Token`, `SidecarError` class.
- **V0.5 Job pattern:** `enqueueJob(conn, kind, params)` → `POST /jobs/enqueue` (202);
  `JobCenter.trackJob(jobId, label, onDone)` polls `GET /jobs/{id}` every 500ms;
  `cancelJob(conn, jobId)` → `POST /jobs/{id}/cancel`.

---

## Increments

| Tag | Deliverables | Status |
|-----|-------------|--------|
| V0 | 3-screen scaffold + all sidecar calls wired | done |
| V0.3 | Curation preview diff (dry-run + stats + before/after table) + align audit UI (paginated link table) | done |
| V0.4 | Metadata panel (per-doc edit + bulk + relations + validate) + exports (TEI/CSV/run report) + align correction (accept/reject/delete/retarget) | done |
| V0.5 | Job Center panel + async enqueue for all long ops (import/index/curate/segment/align/export) + contract freeze (snapshot + docs sync tests) | done |
| V1 | Segmentation quality packs selection | todo |
