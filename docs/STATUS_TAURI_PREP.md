# Status — Concordancier Prep (tauri-prep) V0

**Last updated:** 2026-03-01 (V1.1: Sprint 1.1 align quality metrics + Sprint 2.1 virtualisation)

---

## Done

- [x] `GET /documents` added to sidecar (lists all docs with unit_count)
- [x] `POST /align` added to sidecar (strategies: external_id / position / similarity)
- [x] OpenAPI spec updated (DocumentRecord, DocumentsResponse, AlignRequest, AlignResponse)
- [x] 5 new tests for /documents and /align (contract + error cases)
- [x] `docs/CHARTER_TAURI_PREP_AGENT.md` created
- [x] `docs/BACKLOG.md` updated with tauri-prep V0/V0.1/V1 items
- [x] `tauri-prep/` scaffold created (package.json, vite.config.ts, tsconfig.json, index.html)
- [x] `tauri-prep/src/lib/sidecarClient.ts` — Conn, ensureRunning, all API calls
- [x] `tauri-prep/src/lib/db.ts` — getOrCreateDefaultDbPath, current DB path helpers
- [x] `tauri-prep/src/screens/ProjectScreen.ts` — DB open/create, sidecar status, shutdown
- [x] `tauri-prep/src/screens/ImportScreen.ts` — batch import (2 concurrent), index button, log
- [x] `tauri-prep/src/screens/ActionsScreen.ts` — curate/segment/align with confirmation + doc selector
- [x] `tauri-prep/src/app.ts` — tab nav (Project | Import | Actions)
- [x] `tauri-prep/src/main.ts` — entry point
- [x] `tauri-prep/src-tauri/` — tauri.conf.json, Cargo.toml, build.rs, src/main.rs, capabilities/default.json
- [x] `tauri-prep/src-tauri/binaries/.gitkeep`
- [x] `tauri-prep/scripts/prepare_sidecar.sh` + `.ps1`
- [x] `tauri-prep/README.md` — dev launch instructions
- [x] Open in Concordancier helpers (copy DB path + workflow instructions modal)
- [x] Segmentation quality pack selector in Actions (`auto`, `default`, `fr_strict`, `en_strict`) + sidecar `/segment` and async job support (`params.pack`)
- [x] Advanced align strategy in Actions: `external_id_then_position` (hybrid fallback) + sidecar `/align` + `/jobs/enqueue` support
- [x] Align explainability option: `debug_align` on `/align` and align jobs; debug sources/stats logged in Actions screen
- [x] Align explainability panel in Actions: structured per-target diagnostics + "Copier diagnostic JSON" button
- [x] Segmentation quality benchmark harness:
  - `bench/fixtures/segmentation_quality_cases.json` (FR/EN deterministic fixtures)
  - `scripts/bench_segmentation_quality.py` (pack scoring: exact match + precision/recall/F1)
  - `docs/SEGMENTATION_BENCHMARKS.md` generated summary
- [x] Align explainability now linked to persisted runs:
  - sidecar `/align` response includes `run_id`
  - align async jobs include `run_id` and persist `kind=align` run stats (pairs/debug payload)
  - Exports tab supports optional `run_id` filter for run report export

### V0.3 (Curation Preview Diff + Align Audit UI)

- [x] `POST /curate/preview` sidecar endpoint — in-memory dry-run, no DB write
  - returns `{doc_id, stats, examples, fts_stale: false}`
  - validates `doc_id` (400/BAD_REQUEST), invalid regex (400/VALIDATION_ERROR)
- [x] `POST /align/audit` sidecar endpoint — paginated alignment link audit
  - returns `{links, has_more, next_offset, stats}`
  - optional `external_id` filter; non-existent pairs → `ok: true, links: []`
- [x] `sidecar_contract.py` updated — 6 new OpenAPI schemas
- [x] `tests/test_sidecar_v03.py` — 12 new contract tests (all passing)
- [x] `tauri-prep/src/lib/sidecarClient.ts` updated — `curatePreview`, `alignAudit`, new types
- [x] `tauri-prep/src/screens/ActionsScreen.ts` rewritten with full V0.3 UI:
  - Curation: 4 presets (Espaces, Apostrophes, Ponctuation, Personnalisé) + JSON textarea
  - Preview panel: stats banner + before/after diff table (word-level highlight)
  - Apply button enabled only after preview; confirmation before curate
  - Align: results banner after alignment run
  - Audit panel: paginated table with "Charger plus"
- [x] `tauri-prep/src/app.ts` — new CSS for diff-table, audit-table, preview-stats, diff marks
- [x] `docs/SIDECAR_API_CONTRACT.md` — both endpoints fully documented
- [x] `docs/INTEGRATION_TAURI.md` — new endpoints + tauri-prep V0.3 usage section

### V0.4 (Metadata Panel + Exports + Align Manual Correction)

- [x] `migrations/004_align_link_status.sql` — adds `status TEXT` column + index to `alignment_links`
  - NULL = unreviewed, 'accepted', 'rejected'; non-destructive (existing rows stay NULL)
- [x] `GET /doc_relations?doc_id=N` — lists doc-level relations (no token required)
- [x] `POST /documents/update` — update title/language/doc_role/resource_type for one doc (token required)
- [x] `POST /documents/bulk_update` — bulk update multiple docs (token required)
- [x] `POST /doc_relations/set` — upsert a doc_relation (token required)
- [x] `POST /doc_relations/delete` — delete a doc_relation by id (token required)
- [x] `POST /export/tei` — export docs as TEI XML to server-side dir (token required)
- [x] `POST /export/align_csv` — export alignment links as CSV/TSV (token required)
- [x] `POST /export/run_report` — export run history as JSONL or HTML (token required)
- [x] `POST /align/link/update_status` — set link status (accepted/rejected/null, token required)
- [x] `POST /align/link/delete` — permanently delete an alignment link (token required)
- [x] `POST /align/link/retarget` — change target unit of a link (token required)
- [x] `POST /align/audit` backward-compat extension — each link includes `status` field; optional status filter
- [x] `sidecar_contract.py` updated — 10 new schemas (26 paths, 39 schemas total)
- [x] `tests/test_sidecar_v04.py` — 32 new tests (all passing)
- [x] `tauri-prep/src/lib/sidecarClient.ts` — 13 new interfaces, 11 new API functions
- [x] `tauri-prep/src/screens/MetadataScreen.ts` — NEW:
  - Doc list (click to select), edit panel (title/language/doc_role/resource_type + Save)
  - Relations panel: list + add form (type/target/note) + delete per-row
  - Bulk edit bar: doc_role + resource_type for all docs
  - Validate metadata button with warnings display
  - Log pane
- [x] `tauri-prep/src/screens/ExportsScreen.ts` — NEW:
  - TEI: multi-select docs + directory dialog → exportTei
  - Alignment CSV: pivot/target selects + CSV/TSV format + save dialog → exportAlignCsv
  - Run report: format select + save dialog → exportRunReport
  - Log pane
- [x] `tauri-prep/src/screens/ActionsScreen.ts` — extended with V0.4C:
  - Audit panel: status filter select (all/unreviewed/accepted/rejected)
  - Audit table: status column with badges + action buttons (✓ Accept, ✗ Reject, 🗑 Delete)
- [x] `tauri-prep/src/app.ts` — 5-tab navigation: Projet | Import | Actions | Métadonnées | Exports
- [x] `docs/SIDECAR_API_CONTRACT.md` — all V0.4A/B/C endpoints documented

### V0.5 (Async Job Enqueue + Job Center + Contract Freeze)

- [x] `sidecar_jobs.py` extended — `cancel(job_id)` method (queued → immediate; running → best-effort)
- [x] `POST /jobs/enqueue` (token required) — 9 job kinds: index, curate, validate-meta, segment, import, align, export_tei, export_align_csv, export_run_report
- [x] `POST /jobs/{job_id}/cancel` (token required) — idempotent; 404 for unknown id
- [x] `GET /jobs` extended — `?status=`, `?limit=`, `?offset=`; response includes pagination fields
- [x] `sidecar_contract.py` — `CONTRACT_VERSION = "0.5.0"`, `x-contract-version` in OpenAPI info, 2 new paths + 2 schemas
- [x] `scripts/export_openapi.py` — exports `docs/openapi.json` (28 paths, sorted keys)
- [x] `docs/openapi.json` — generated OpenAPI snapshot
- [x] `tests/snapshots/openapi_paths.json` — 29 "METHOD /path" entries (breaking-change detector)
- [x] `tests/test_contract_openapi_snapshot.py` — 8 contract freeze tests (`test_no_endpoints_removed` is the key guard)
- [x] `tests/test_contract_docs_sync.py` — 3 tests: all OpenAPI paths must appear in `SIDECAR_API_CONTRACT.md`
- [x] `tests/test_sidecar_jobs_v05.py` — 19 tests covering enqueue/cancel/list/pagination/all kinds
- [x] `tauri-prep/src/components/JobCenter.ts` — NEW: progress strip + cancel + recent jobs + 500ms polling
- [x] `tauri-prep/src/lib/sidecarClient.ts` — `enqueueJob`, `cancelJob`, `listJobs`; `JobRecord.status` + `"canceled"`
- [x] `tauri-prep/src/app.ts` — mounts `JobCenter`, passes it + `showToast` to screens
- [x] `tauri-prep/src/screens/ImportScreen.ts` — import + index use `enqueueJob`
- [x] `tauri-prep/src/screens/ActionsScreen.ts` — curate, segment, align, validate-meta, index use `enqueueJob`
- [x] `tauri-prep/src/screens/ExportsScreen.ts` — TEI, CSV, run-report use `enqueueJob`
- [x] `docs/SIDECAR_API_CONTRACT.md` — V0.5 section added
- [x] `docs/CHARTER_TAURI_PREP_AGENT.md` — v0.5; anti-drift rule #3 (contract freeze) + rule #11 (enqueue for long ops)

### V1.1 (Sprint 1.1 — Align Quality Metrics)

- [x] `POST /align/quality` sidecar endpoint — read-only quality report (no token required)
  - coverage_pct, orphan counts, collision count, status_counts per pair
  - optional `run_id` filter; sample orphan pivot/target units (max 5 each)
- [x] `sidecar_contract.py` updated — `CONTRACT_VERSION = "1.1.0"`, 2 new schemas (AlignQualityRequest, AlignQualityResponse)
- [x] `docs/openapi.json` regenerated — 29 paths, contract v1.1.0
- [x] `tests/snapshots/openapi_paths.json` updated — `POST /align/quality` added
- [x] `tests/test_sidecar_v11.py` — 9 new tests (full coverage + partial coverage + contract)
- [x] `docs/SIDECAR_API_CONTRACT.md` — `/align/quality` documented (listed + detail section)
- [x] `tauri-prep/src/lib/sidecarClient.ts` — `AlignQualityStats`, `AlignQualityOrphan`, `AlignQualityResponse` types + `alignQuality()` function
- [x] `tauri-prep/src/screens/ActionsScreen.ts` — "Qualité alignement" card: pivot/cible selects + stats grid + orphan samples collapse + log line
- [x] `tauri-prep/src/app.ts` — `.quality-stats-grid` + `.quality-stat` + `.quality-value` CSS

### V1.2–V1.4 (Sprints 1.2/1.3/1.4 — completed in previous session)

- [x] V1.2: `/align/audit` include_explain + status enum + text badges
- [x] V1.3: `/align/links/batch_update` + batch bar in ActionsScreen
- [x] V1.4: `/align/retarget_candidates` + Retarget modal in ActionsScreen

### V1.5 (Sprint 1.5 — Collision Resolver)

- [x] `POST /align/collisions` (read, no token): paginated collision groups
  `{total_collisions, collisions: [CollisionGroup], has_more, next_offset}`
- [x] `POST /align/collisions/resolve` (write, token): batch keep/delete/reject/unreviewed
  partial failures tolerated; `{applied, deleted, errors}`
- [x] `CONTRACT_VERSION = "1.3.0"`, `API_VERSION = "1.3.0"`
- [x] 19 new tests in `tests/test_sidecar_v15.py`
- [x] `sidecarClient.ts`: CollisionGroup/Link/ResolveAction interfaces + listCollisions() + resolveCollisions()
- [x] `ActionsScreen.ts` V1.5: "Collisions d'alignement" card — collision table per group,
  per-link ✓ Garder / ❌ Rejeter / 🗑 / "Tout supprimer" batch; toast + auto-refresh

## Confirmed green

- [x] pytest: **352 tests passing**, 0 failures (2026-03-01; includes hardening fixes v1.4.1)
- [x] npm build: green (tauri-prep bundle ~113 kB, tauri-app ~43 kB)

## Next tasks (V1.x)

1. Prep V1: include_explain toggle in audit UI (backend ready at V1.2)
2. Concordancier V1: metadata panel (doc title/lang/role/resource_type/units side panel)
3. Concordancier V1: demo corpus (bundled small multilingual corpus on first run)
4. Sidecar release hardening: notarization, Windows signing, production certs setup

---

## Tests count

| Milestone | Tests |
|-----------|-------|
| V2.1 (entry this session) | 114 |
| After /documents + /align | +4 → 118 (confirmed) |
| After V0.3 (curate/preview + align/audit) | +12 → 130 (confirmed) |
| After V0.4 (metadata + exports + align correction) | +32 → 162 (confirmed) |
| After V0.5 (job enqueue + contract freeze) | +27 → 189 (confirmed) |
| After V0.6.1 (segmentation quality packs) | +6 → 195 (confirmed) |
| After V0.7 (advanced align strategy hybrid) | +4 → 199 (confirmed) |
| After V0.8 (align explainability) | +4 → 203 (confirmed) |
| After V0.9 (segmentation fixtures/bench + pack case-insensitivity) | +5 → 208 (confirmed) |
| After V0.10 (align runs linkage + run export filter) | +0 → 208 (confirmed) |
| After V1.1 (Sprint 1.1 — /align/quality + UI quality panel) | +9 → 217 (confirmed) |
| After V1.2–V1.4 (explain, batch, retarget) | +31 → 248 (confirmed) |
| After V1.5 (Sprint 1.5 — collision resolver) | +19 → 267 (confirmed) |
