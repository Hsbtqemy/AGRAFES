# Changelog — multicorpus_engine

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased — V4.1] — 2026-03-01 — Concordancier V1.0 Sprint 2.1: IntersectionObserver auto-scroll

### Added

- `tauri-app/src/app.ts`: sentinel `div#scroll-sentinel` appended after results; `IntersectionObserver` (`_scrollObserver`) watches sentinel with `threshold: 0.1` relative to `#results-area`.
- Auto-load-more fires when sentinel enters viewport, guarded by `state.loadingMore` and `state.hasMore`.
- Manual "Charger plus" button retained as fallback. Sentinel hidden (`display:none`) when `!state.hasMore`.

---

## [Unreleased — V4.0] — 2026-03-01 — Concordancier Prep V1.1 Sprint 1.1: align quality metrics

### Added

- **Sidecar** `POST /align/quality` (read-only, no token required):
  - Input: `{ pivot_doc_id, target_doc_id, run_id? }`
  - Output: `stats` (coverage_pct, orphan counts, collision_count, status_counts) + `sample_orphan_pivot` / `sample_orphan_target` (≤5 each)
  - Optional `run_id` restricts metrics to a specific align run.
- `sidecar_contract.py`: `CONTRACT_VERSION = "1.1.0"`, `AlignQualityRequest` + `AlignQualityResponse` schemas.
- `docs/openapi.json`: regenerated — 29 paths, contract v1.1.0.
- `tests/snapshots/openapi_paths.json`: `POST /align/quality` added.
- `tests/test_sidecar_v11.py`: 9 new tests (full coverage, partial coverage, missing params, nonexistent pair, run_id filter, OpenAPI check).
- `docs/SIDECAR_API_CONTRACT.md`: `/align/quality` listed and documented.
- `tauri-prep/src/lib/sidecarClient.ts`: `AlignQualityStats`, `AlignQualityOrphan`, `AlignQualityResponse` interfaces + `alignQuality()` function.
- `tauri-prep/src/screens/ActionsScreen.ts`: "Qualité alignement" card — pivot/cible selects, "Calculer métriques" button, stats grid (coverage%, orphans, collisions, status_counts), orphan sample collapse panels.
- `tauri-prep/src/app.ts`: `.quality-stats-grid`, `.quality-stat`, `.quality-value` CSS (ok/warn/err color coding).
- `docs/STATUS_CONCORDANCIER.md`: created (Concordancier V0 → V1 status).

### Changed

- `tauri-prep` bundle: ~94 kB → ~99 kB.
- Test count: 208 → 217.

---

## [Unreleased — V3.11] — 2026-03-01 — Concordancier Prep V0.10: align explainability linked runs/export

### Added

- Sidecar `POST /align` now returns `run_id` and `total_links_created`.
- Async align jobs now return `run_id` in result payload.
- `tauri-prep` Actions screen includes `run_id` in copied explainability JSON.
- `tauri-prep` Exports screen adds optional `run_id` filter for run report export.

### Changed

- Sidecar align operations (sync and async) now persist `kind=align` rows in `runs`
  with `stats_json` containing strategy, totals, and pair reports (including debug payload when enabled).
- Sidecar contract version bumped to `0.5.4` (additive align response fields).

## [Unreleased — V3.10] — 2026-03-01 — Concordancier Prep V0.9: segmentation quality fixtures/bench

### Added

- Segmentation quality fixture dataset (FR/EN):
  - `bench/fixtures/segmentation_quality_cases.json`
- New benchmark script:
  - `scripts/bench_segmentation_quality.py`
  - computes exact-match rate + boundary precision/recall/F1 for packs
  - outputs JSON report in `bench/results/` and Markdown summary in `docs/SEGMENTATION_BENCHMARKS.md`
- New helper module for deterministic scoring utilities:
  - `src/multicorpus_engine/segmentation_quality.py`
- New tests:
  - `tests/test_segmentation_quality.py`
  - extended `tests/test_segmenter_packs.py` (uppercase abbreviation case)

### Changed

- Segmentation pack abbreviation matching is now case-insensitive
  (`fr_strict`, `en_strict`, `default`), improving behavior on sentence-initial
  abbreviations like `Approx.` / `Etc.` / `Env.`.

## [Unreleased — V3.8.1] — 2026-02-28 — Concordancier Prep V0.8.1: align explainability panel

### Added

- `tauri-prep` Actions screen now renders align explainability in a dedicated panel (instead of only log lines):
  - per-target card
  - strategy summary
  - link source counters
  - similarity stats
  - sample links (when provided)
- "Copier diagnostic JSON" action in Actions screen to copy the full explainability payload to clipboard.

### Changed

- Align job debug output (`debug_align=true`) is now surfaced primarily in structured UI, with concise log summary only.

## [Unreleased — V3.8] — 2026-02-28 — Concordancier Prep V0.8: align explainability

### Added

- Optional align explainability flag `debug_align` for:
  - CLI `align --debug-align`
  - sidecar `POST /align`
  - sidecar align jobs (`POST /jobs/enqueue`, kind `align`)
- Optional `report.debug` payload in alignment reports (when `debug_align=true`):
  - strategy id
  - per-phase link source counts
  - sample links
  - similarity stats for similarity strategy
- `tauri-prep` Actions screen adds a `debug explainability` toggle for align jobs
  and logs debug source/score summaries in the operation log.

### Changed

- Sidecar/OpenAPI contract updated (`CONTRACT_VERSION = 0.5.3`) with
  `AlignRequest.debug_align`.
- Alignment report now consistently includes `links_skipped`.

## [Unreleased — V3.7] — 2026-02-28 — Concordancier Prep V0.7: advanced align strategies

### Added

- New alignment strategy `external_id_then_position` (hybrid):
  - phase 1: align by anchors (`external_id`)
  - phase 2: fallback by shared position `n` for remaining unmatched rows
- Strategy exposed in:
  - CLI `align --strategy external_id_then_position`
  - sidecar `POST /align`
  - sidecar async jobs `POST /jobs/enqueue` (kind `align`)
  - `tauri-prep` Actions screen strategy selector
- Alignment reports now include `links_skipped` in addition to `links_created`.

### Changed

- Sidecar align validation hardened:
  - strict strategy allowlist
  - `sim_threshold` validation `[0.0, 1.0]`
  - integer coercion/validation for `pivot_doc_id` + `target_doc_ids`
- OpenAPI contract updated to include `external_id_then_position` in `AlignRequest.strategy`.

## [Unreleased — V3.6] — 2026-02-28 — Concordancier Prep V0.6.1: segmentation quality packs

### Added

- `segment` now accepts optional `pack` across CLI, sidecar sync route (`POST /segment`),
  and async jobs (`POST /jobs/enqueue`, kind `segment`).
- Supported pack values: `auto` (default), `default`, `fr_strict`, `en_strict`.
- Segmentation responses now include `segment_pack` (resolved pack used).
- `tauri-prep` Actions screen now exposes a segmentation pack selector and sends it
  when enqueuing segment jobs.

### Changed

- Sidecar contract/OpenAPI updated for `SegmentRequest.pack` and
  `SegmentResponse.segment_pack` (`CONTRACT_VERSION = 0.5.1`).
- Integration docs updated to include segment pack wiring for Tauri.

### Notes

- This is a V0/V1 scaffolding step for segmentation quality. Further pack tuning and
  language regression fixtures remain tracked in backlog.

## [Unreleased — V3.4] — 2026-02-28 — Concordancier Prep V0.5: Job Polling + Contract Freeze

### Added

- **`POST /jobs/enqueue`** (token required): enqueues an async job for any of 9 kinds:
  `index`, `curate`, `validate-meta`, `segment`, `import`, `align`, `export_tei`,
  `export_align_csv`, `export_run_report`. Returns HTTP 202 with `{ ok, status: "accepted", job }`.
  Kind-specific param validation returns 400 if required fields are absent.
- **`POST /jobs/{job_id}/cancel`** (token required): cancels a queued or running job
  (best-effort for running). Idempotent for terminal states. Returns 404 if `job_id` unknown.
- **`GET /jobs`** extended: now supports `?status=`, `?limit=`, `?offset=` query params.
  Response includes `total`, `limit`, `offset`, `has_more`, `next_offset` pagination fields.
- **`sidecar_jobs.py`**: `cancel()` method on `JobManager` — queued jobs are immediately
  canceled; running jobs are marked canceled upfront and the thread skips result overwrite.
- **`CONTRACT_VERSION = "0.5.0"`** in `sidecar_contract.py`; exposed as `x-contract-version`
  in OpenAPI info block.
- **`scripts/export_openapi.py`**: exports `openapi_spec()` to `docs/openapi.json` (sorted keys).
- **`docs/openapi.json`**: generated OpenAPI spec (28 paths).
- **`tests/snapshots/openapi_paths.json`**: sorted list of "METHOD /path" entries (29 entries).
  Acts as a breaking-change detector: adding endpoints is allowed; removing endpoints fails CI.
- **`tests/test_contract_openapi_snapshot.py`** (8 tests): snapshot non-regression tests —
  `test_no_endpoints_removed` blocks removal of any documented endpoint.
- **`tests/test_contract_docs_sync.py`** (3 tests): every OpenAPI path must appear in
  `docs/SIDECAR_API_CONTRACT.md` (heuristic regex check).
- **`tests/test_sidecar_jobs_v05.py`** (19 tests): full V0.5 backend coverage:
  enqueue/cancel/list with token enforcement, pagination, all 9 job kinds, idempotency.
- **`tauri-prep/src/components/JobCenter.ts`** — NEW: async job tracking panel component:
  - Polls `GET /jobs/{id}` every 500ms while jobs are active.
  - Shows active jobs with progress bar + "Annuler" button (calls `/jobs/{id}/cancel`).
  - Keeps last 5 finished jobs in a "Récents" strip (done/error/canceled icons).
  - Disappears automatically when no jobs are active or recent.
- **`tauri-prep/src/lib/sidecarClient.ts`** extended:
  - `JobRecord.status` now includes `"canceled"`.
  - `enqueueJob(conn, kind, params)` → `POST /jobs/enqueue`.
  - `cancelJob(conn, jobId)` → `POST /jobs/{jobId}/cancel`.
  - `listJobs(conn, opts?)` → `GET /jobs` with optional status/limit/offset.
- **`tauri-prep/src/app.ts`**: mounts `JobCenter` strip between tab bar and screen content;
  adds `showToast()` helper (fixed-position, auto-fades after 3s); passes both to screens.
- **`tauri-prep/src/screens/ImportScreen.ts`**: import + index rebuild now use `enqueueJob`
  (non-blocking); per-file status updated via job callbacks.
- **`tauri-prep/src/screens/ActionsScreen.ts`**: curate, segment, align, validate-meta, index
  now use `enqueueJob`; `_setBusy(false)` called in job callback not inline.
- **`tauri-prep/src/screens/ExportsScreen.ts`**: TEI, CSV, and run-report exports now use
  `enqueueJob`; button re-enabled in job callback.
- **`docs/SIDECAR_API_CONTRACT.md`** — V0.5 section added:
  `/jobs/enqueue`, `/jobs/{job_id}/cancel`, extended `GET /jobs`.
- **`docs/CHARTER_TAURI_PREP_AGENT.md`** — version → V0.5; anti-drift rule #3 added
  (contract freeze); rule #11 added (long ops must use job enqueue).

---

## [Unreleased — V3.3] — 2026-02-28 — Concordancier Prep V0.4: Metadata + Exports + Align Correction

### Added

- **Migration 004** (`migrations/004_align_link_status.sql`): non-destructive `ALTER TABLE alignment_links ADD COLUMN status TEXT` + index. `NULL` = unreviewed, `'accepted'`, `'rejected'`.
- **`GET /doc_relations?doc_id=N`** sidecar endpoint (no token): lists document-level relations.
- **`POST /documents/update`** (token required): update title/language/doc_role/resource_type for one document. Returns `{ updated, doc: DocumentRecord }`.
- **`POST /documents/bulk_update`** (token required): update multiple docs in a single call. Body: `{ updates: [{doc_id, title?, language?, doc_role?, resource_type?}, …] }`.
- **`POST /doc_relations/set`** (token required): upsert a doc_relation. Returns `{ action: "created"|"updated", id, doc_id, relation_type, target_doc_id }`.
- **`POST /doc_relations/delete`** (token required): delete a doc_relation by `id`. Returns `{ deleted }`.
- **`POST /export/tei`** (token required): export documents as TEI XML to a server-side directory. Body: `{ out_dir, doc_ids? }`. Returns `{ files_created, count }`.
- **`POST /export/align_csv`** (token required): export alignment links as CSV/TSV. Body: `{ out_path, pivot_doc_id?, target_doc_id?, delimiter? }`. Returns `{ out_path, rows_written }`.
- **`POST /export/run_report`** (token required): export run history as JSONL or HTML. Body: `{ out_path, run_id?, format }`. Returns `{ out_path, runs_exported, format }`.
- **`POST /align/link/update_status`** (token required): set link status (`"accepted"`, `"rejected"`, or `null`). Body: `{ link_id, status }`. Returns `{ link_id, status, updated: 1 }`.
- **`POST /align/link/delete`** (token required): permanently delete an alignment link. Body: `{ link_id }`. Returns `{ link_id, deleted }`.
- **`POST /align/link/retarget`** (token required): change the target unit of a link. Body: `{ link_id, new_target_unit_id }`. Returns `{ link_id, new_target_unit_id, updated: 1 }`.
- **`POST /align/audit`** backward-compatible extension: each link now includes `"status": null|"accepted"|"rejected"`; optional `"status"` filter in request (`"unreviewed"`, `"accepted"`, `"rejected"`).
- **`sidecar_contract.py`** — 10 new OpenAPI schemas: `DocumentUpdateRequest`, `DocumentBulkUpdateRequest`, `DocRelationRecord`, `DocRelationSetRequest`, `ExportTeiRequest`, `ExportAlignCsvRequest`, `ExportRunReportRequest`, `AlignLinkUpdateStatusRequest`, `AlignLinkDeleteRequest`, `AlignLinkRetargetRequest`. Total: 26 paths, 39 schemas.
- **`tests/test_sidecar_v04.py`** — 32 new contract tests (162 total, all passing):
  - V0.4A: documents_update, bulk_update, doc_relations set/get/upsert/delete, token enforcement, error cases (400/401/404).
  - V0.4B: export_tei (file created, all docs, token required), export_align_csv (TSV delimiter, token required), export_run_report (JSONL, HTML, missing params → 400).
  - V0.4C: audit status field, update_status (accepted/rejected/invalid/token/missing), status filters, retarget (ok/nonexistent unit → 404), delete (ok/token/missing).
- **`tauri-prep/src/lib/sidecarClient.ts`** — 13 new interfaces + 11 new API functions:
  - `DocumentUpdateOptions`, `DocRelationRecord`, `DocRelationsResponse`, `DocRelationSetOptions`, `ExportTeiOptions`, `ExportTeiResponse`, `ExportAlignCsvOptions`, `ExportAlignCsvResponse`, `ExportRunReportOptions`, `ExportRunReportResponse`, `AlignLinkUpdateStatusOptions`, `AlignLinkDeleteOptions`, `AlignLinkRetargetOptions`.
  - `updateDocument`, `bulkUpdateDocuments`, `getDocRelations`, `setDocRelation`, `deleteDocRelation`, `exportTei`, `exportAlignCsv`, `exportRunReport`, `updateAlignLinkStatus`, `deleteAlignLink`, `retargetAlignLink`.
  - `AlignLinkRecord.status: "accepted" | "rejected" | null` added.
  - `AlignAuditOptions.status?: "accepted" | "rejected" | "unreviewed"` added.
- **`tauri-prep/src/screens/MetadataScreen.ts`** — NEW (V0.4A UI):
  - Doc list (click to select), edit panel (title/language/doc_role/resource_type + Save), relations panel (list + add form + delete per-row), bulk edit bar (doc_role/resource_type for all docs), validate metadata button with warnings display, log pane.
- **`tauri-prep/src/screens/ExportsScreen.ts`** — NEW (V0.4B UI):
  - TEI: multi-select docs + directory dialog (`open({ directory: true })`) → `exportTei`.
  - Alignment CSV: pivot/target selects + CSV/TSV format + `save()` → `exportAlignCsv`.
  - Run report: format select + `save()` → `exportRunReport`.
  - Log pane.
- **`tauri-prep/src/screens/ActionsScreen.ts`** — V0.4C extensions:
  - Audit panel: status filter `<select>` (all / unreviewed / accepted / rejected).
  - Audit table: `status` column with badges + per-row action buttons (✓ Accept, ✗ Reject, 🗑 Delete).
  - Methods: `_updateLinkStatus`, `_deleteLinkFromAudit` — in-memory update + table re-render.
- **`tauri-prep/src/app.ts`** — 5-tab navigation: Projet | Import | Actions | Métadonnées | Exports. `MetadataScreen` and `ExportsScreen` integrated; `setConn` and `_onDbChanged` propagated.
- **`docs/SIDECAR_API_CONTRACT.md`** — all V0.4A/B/C endpoints documented with request/response shapes.

---

## [Unreleased — V3.2] — 2026-02-28 — Concordancier Prep V0.3: Curation Preview + Align Audit

### Added

- **`POST /curate/preview`** sidecar endpoint (read-only, no token required):
  - In-memory dry-run: applies regex rules via `re.subn` without writing to DB.
  - Returns `{doc_id, stats: {units_total, units_changed, replacements_total}, examples, fts_stale: false}`.
  - `limit_examples` parameter caps example rows (default 10, max 50).
  - Validates: `doc_id` required (400/BAD_REQUEST), invalid regex patterns (400/VALIDATION_ERROR).
- **`POST /align/audit`** sidecar endpoint (read-only, paginated, no token required):
  - Returns aligned link pairs for a `pivot_doc_id` / `target_doc_id` pair with `pivot_text` / `target_text`.
  - `LIMIT+1` pagination strategy: `limit`, `offset`, `has_more`, `next_offset`.
  - Optional `external_id` filter for single-pair lookup.
  - Non-existent pairs return `ok: true` with empty list (not an error).
  - Validates: both `pivot_doc_id` and `target_doc_id` required (400/BAD_REQUEST).
- **`sidecar_contract.py`** — 6 new OpenAPI schemas: `CuratePreviewRequest`, `CuratePreviewExample`, `CuratePreviewResponse`, `AlignAuditRequest`, `AlignLinkRecord`, `AlignAuditResponse`.
- **`tests/test_sidecar_v03.py`** — 12 new contract tests (130 total, all passing):
  - curate/preview: stats correctness, DB not modified, empty rules, missing doc_id (400), invalid regex (400), limit_examples respected.
  - align/audit: links returned, pagination (page 1 has_more=True, page 2 done), external_id filter, missing params (400), empty pair ok.
  - OpenAPI spec has all 6 new schemas.
- **`tauri-prep/src/lib/sidecarClient.ts`** — new types and API functions:
  - `CuratePreviewOptions`, `CuratePreviewExample`, `CuratePreviewStats`, `CuratePreviewResponse`.
  - `AlignAuditOptions`, `AlignLinkRecord`, `AlignAuditResponse`.
  - `curatePreview(conn, opts)`, `alignAudit(conn, opts)` functions.
  - `description?: string` added to `CurateRule` interface.
- **`tauri-prep/src/screens/ActionsScreen.ts`** — full V0.3 ActionsScreen:
  - Curation section: 4 presets (Espaces, Apostrophes & guillemets, Ponctuation, Personnalisé) + JSON textarea for custom rules.
  - Preview panel: stats banner (`X unités modifiées, Y remplacements`) + before/after diff table with word-level highlighting (`<mark class="diff-mark">`).
  - Apply button enabled only after successful preview; confirmation dialog before curate.
  - Align section: results banner showing `links_created / links_skipped` after alignment run.
  - Audit panel: auto-filled after alignment, paginated table (`pivot_text | target_text | ext_id`), "Charger plus" button.
- **`tauri-prep/src/app.ts`** — new CSS classes: `.form-row`, `.preview-stats`, `.stat-ok`, `.stat-warn`, `.badge-preview`, `.diff-table`, `.diff-before`, `.diff-after`, `.diff-extid`, `mark.diff-mark`, `.audit-table`, `.audit-text`.
- **`docs/SIDECAR_API_CONTRACT.md`** — `/curate/preview` and `/align/audit` documented with full request/response JSON examples.
- **`docs/INTEGRATION_TAURI.md`** — new endpoints listed; tauri-prep V0.3 usage subsection.

---

## [Unreleased — V3.1] — 2026-02-28 — Concordancier Prep V0 Scaffold

### Added

- **`tauri-prep/`** — Tauri v2 + Vite + TypeScript corpus preparation app:
  - `src/lib/sidecarClient.ts` — portfile-aware sidecar spawn/reuse, all API calls (`listDocuments`, `importFile`, `rebuildIndex`, `curate`, `segment`, `align`, `validateMeta`, `getJob`, `shutdownSidecar`).
  - `src/lib/db.ts` — default DB path via `appDataDir`, current DB path helpers.
  - `src/screens/ProjectScreen.ts` — DB open/create dialog, sidecar status (port/pid/health), shutdown button, "Open in Concordancier" flow.
  - `src/screens/ImportScreen.ts` — batch file import (2 concurrent), mode/language/title per file, index rebuild button, log pane.
  - `src/screens/ActionsScreen.ts` — curate/segment/align/validateMeta with doc selector, confirmation dialogs, log pane.
  - `src/app.ts` — tab navigation (Projet | Import | Actions), CSS design system.
  - `src/main.ts` — app entry point.
  - `src-tauri/` — Tauri v2 Rust shell, `tauri.conf.json`, `Cargo.toml`, capabilities with plugin-shell/fs/dialog/http/path.
  - `scripts/prepare_sidecar.sh` / `.ps1` — sidecar build + copy to `binaries/`.
  - `README.md` — dev setup and launch instructions.
- **`GET /documents`** sidecar endpoint — lists all documents with `unit_count`.
- **`POST /align`** sidecar endpoint — dispatches to `align_by_external_id`, `align_by_position`, or `align_by_similarity`.
- **`docs/CHARTER_TAURI_PREP_AGENT.md`** — mission, scope, anti-drift rules, technical rules, increments.
- **`docs/STATUS_TAURI_PREP.md`** — session-level progress tracker.

---

## [Unreleased — V3.0] — 2026-02-28 — Tauri UI Concordancier V0

### Added

- `tauri-app/` — Tauri v2 + Vite + TypeScript desktop application (Concordancier V0).
  - `src/lib/sidecarClient.ts` — portfile-aware sidecar spawn/reuse, token injection,
    `ensureRunning`, `query`, `importFile`, `rebuildIndex`, `shutdownSidecar`.
  - `src/lib/db.ts` — default corpus DB path via `appDataDir`.
  - `src/app.ts` — full Concordancier UI: search bar, segment/KWIC toggle, window slider,
    filter drawer (language/role/doc_id), result list, import modal, "Open DB…" button.
  - `src-tauri/` — Tauri v2 Rust shell with `plugin-shell`, `plugin-fs`, `plugin-dialog`.
  - `src-tauri/capabilities/default.json` — shell execute + fs read + dialog + path permissions.
  - `scripts/prepare_sidecar.sh` / `prepare_sidecar.ps1` — build + copy sidecar to
    `binaries/` per ADR-025 (macOS=onefile, Linux/Windows=onedir).
  - `README.md` — dev setup guide, sidecar build steps, feature table.
- Concordancier V0.1 aligned/parallel view in `tauri-app/`:
  - global toggle `Alignés: on/off` wired to `/query include_aligned`
  - per-hit expand/collapse panel for aligned units under search results
  - grouped rendering by `(language, title, doc_id)` with compact aligned text list
  - UI safety cap when aligned mode is active (first 100 hits rendered)
- Concordancier V0.2 pagination/load-more:
  - sidecar `/query` now supports `limit` and `offset` (default `50`, bounds `1..200`)
  - sidecar `/query` response now includes `limit`, `offset`, `next_offset`, `has_more`, `total`
  - pagination strategy uses `limit+1` fetch (`total` currently `null` by design)
  - UI now loads results by page and adds `Charger plus` instead of loading everything at once
  - aligned mode uses a lower page size default (`20`) to reduce payload fan-out
- `docs/ROADMAP.md` — V2.2 marked Done; V3.0 Concordancier V0 added to Now; Next updated.
- `docs/BACKLOG.md` — Concordancier V0 added as NOW; V1 features (parallel view, pagination,
  metadata panel, demo corpus, advanced search) added as P1/P2.

---

## [Unreleased] — 2026-02-28 — Sidecar hardening (packaging + persistent UX)

### Added

- Stable packaging entrypoint for sidecar builds:
  - `scripts/sidecar_entry.py`
- PyInstaller-based sidecar builder:
  - `scripts/build_sidecar.py`
  - target triple detection via `rustc --print host-tuple` with OS/arch fallback map
  - output naming: `multicorpus-<target_triple>[.exe]`
  - manifest output: `tauri/src-tauri/binaries/sidecar-manifest.json`
- Tauri wrapper scaffold (no UI implementation):
  - `tauri/README.md`
  - `tauri/src-tauri/binaries/.gitkeep`
- CI matrix for sidecar artifacts:
  - `.github/workflows/build-sidecar.yml` (macOS, Linux, Windows)
- Tauri integration fixture scaffold (no UI):
  - `tauri-fixture/` (Tauri v2 structure + sidecar config/capabilities snippets)
  - `tauri-fixture/scripts/fixture_smoke.mjs` (headless sidecar JSON contract smoke)
  - `tauri-fixture/src/sidecar_runner.ts` (plugin-shell sidecar call example)
- Cross-platform fixture workflow:
  - `.github/workflows/tauri-e2e-fixture.yml`
- Sidecar hardening benchmark hook:
  - `scripts/bench_sidecar_startup.py` (startup latency + binary size)
- Persistent sidecar HTTP flow:
  - `/health`, `/import`, `/index`, `/query`, `/shutdown`
  - sidecar discovery file `.agrafes_sidecar.json`
  - fixture persistent scenario in `tauri-fixture/scripts/fixture_smoke.mjs`
  - new tests: `tests/test_sidecar_persistent.py`
- Sidecar hardening (restart + auth):
  - `multicorpus status --db ...` command
  - optional token mode for `serve`: `--token auto|off|<value>`
  - new tests: `tests/test_sidecar_token_optional.py`
- Distribution tooling:
  - `scripts/macos_sign_and_notarize_sidecar.sh`
  - `scripts/macos_sign_and_notarize_tauri_fixture.sh`
  - `scripts/windows_sign_sidecar.ps1`
  - `scripts/linux_manylinux_build_sidecar.sh`
  - `docker/manylinux/Dockerfile`
  - `docs/DISTRIBUTION.md`
- New CI workflows:
  - `.github/workflows/macos-sign-notarize.yml`
  - `.github/workflows/windows-sign.yml`
  - `.github/workflows/linux-manylinux-sidecar.yml`
  - `.github/workflows/release.yml`
  - `.github/workflows/bench-sidecar.yml`
- Benchmark aggregation tooling:
  - `scripts/aggregate_bench_results.py`
  - `docs/BENCHMARKS.md`

### Changed

- Added optional packaging dependency group:
  - `pyproject.toml` -> `[project.optional-dependencies].packaging = ["pyinstaller>=6.0"]`
- Integration and planning docs updated for sidecar packaging flow and remaining release-hardening tasks.
- Tauri integration docs now include copy/paste snippets for:
  - `bundle.externalBin`
  - plugin-shell sidecar execution
  - naming convention `multicorpus-<target_triple>[.exe]`
- Onefile packaging now embeds `migrations/` data and runtime migration lookup
  supports PyInstaller bundle mode (`sys._MEIPASS`) for functional `init-project`
  execution in packaged sidecar E2E.
- Sidecar API envelope now exposes `ok` and structured error object; contract
  version bumped to `1.1.0`.
- Benchmark script extended with persistent metrics:
  - time-to-ready (`serve` -> `/health`)
  - repeated `/query` latency
- `serve` startup now enforces stale-portfile recovery policy:
  - returns `status="already_running"` when existing PID + `/health` is valid
  - removes stale `.agrafes_sidecar.json` before starting a new process
- Token-protected write endpoints when token is active:
  - `/import`, `/index`, `/shutdown` require `X-Agrafes-Token`
  - unauthorized responses use HTTP `401` + `UNAUTHORIZED`
- Tauri fixture smoke now reads sidecar token from portfile and sends auth header for write endpoints.
- `/query` sidecar API extended (backward-compatible):
  - `aligned_limit` optional request field
  - aligned items now include `text` alias (in addition to `text_norm`)
- Sidecar builder now supports output presets:
  - `python scripts/build_sidecar.py --preset tauri|fixture`
- Path/docs cleanup:
  - canonical binaries path clarified as `tauri/src-tauri/binaries/`
  - fixture path clarified as `tauri-fixture/src-tauri/binaries/`
- Sidecar builder now supports:
  - `--format onefile|onedir`
  - enriched manifest fields (`format`, `artifact_path`, `executable_path`, sizes)
- Bench script now supports:
  - onefile/onedir comparative runs
  - token-aware persistent benchmark flow
  - per-target output naming under `bench/results/<date>_<os>_<arch>_<format>.json`
  - version/target metadata in per-target JSON payload
- Added initial benchmark artifact:
  - `bench/results/20260228_compare_darwin.json`
  - `bench/results/20260228_macos_aarch64_onefile.json`
  - `bench/results/20260228_macos_aarch64_onedir.json`
- Added benchmark summary page:
  - `docs/BENCHMARKS.md` (complete 3-OS dataset)
- Finalize ADR-025 (sidecar format decision, `per_os`):
  - macOS -> `onefile`
  - Linux -> `onedir`
  - Windows -> `onedir`
  - `scripts/build_sidecar.py` now uses this mapping when `--format` is omitted
  - CI workflows updated to pass explicit per-OS `--format` values

## [0.6.1] — 2026-02-28 — Stabilisation (contrat CLI + cohérence docs)

### Changed

- CLI contract hardened for parser failures (`argparse`):
  - invalid/missing args and unknown subcommands now return one JSON error object on stdout
  - exit code normalized to `1` (no `argparse` exit code `2` leak)
  - error payloads now include `created_at` by default
- Added subprocess contract regression tests:
  - `tests/test_cli_contract.py` (success smoke flow + parse-failure envelope)
- Documentation synchronized with implemented behavior:
  - `docs/ROADMAP.md` (real state + priorities)
  - `docs/BACKLOG.md` (reprioritized open items; CLI hardening moved to stable)
  - `docs/DECISIONS.md` (ADR-019 clarified for `argparse` failures)
  - `docs/INTEGRATION_TAURI.md` (explicit parser-failure contract)
  - `docs/SIDECAR_API_CONTRACT.md` (implementation status clarified)

### Tests

- Full test suite remains green after stabilization updates.
- CLI smoke flow validated on temporary DB with generated DOCX fixture.

## [0.6.0] — 2026-02-28 — Stabilisation & cohérence post-implémentation

### Added

- Sidecar async jobs runtime (`/jobs`, `/jobs/{job_id}`) and associated contract tests:
  - `tests/test_sidecar_jobs.py`
  - `tests/test_sidecar_api_contract.py`
- DB diagnostics helpers and CLI script:
  - `src/multicorpus_engine/db/diagnostics.py`
  - `scripts/db_diagnostics.py`
  - `tests/test_db_diagnostics.py`
- Benchmark harness scripts and docs:
  - `bench/run_bench.py`
  - `bench/run_sidecar_bench.py`
  - `bench/README.md`

### Changed

- CLI JSON envelope hardened:
  - success payloads always expose `status`
  - error payloads now enforce `status=\"error\"`
  - `serve` now records a run and emits startup JSON with `run_id` and log path
- Documentation realigned with implemented state:
  - `docs/ROADMAP.md` updated to real status (sidecar/segmentation/output already present)
  - `docs/BACKLOG.md` reprioritized around packaging, contract hardening, perf, and Tauri integration
  - `docs/DECISIONS.md` consolidated; critical ADRs clarified (`¤`, Unicode, FTS rowid strategy, structure non-indexed, sidecar optionality)
  - `docs/INTEGRATION_TAURI.md` updated for current CLI + optional sidecar model
- Project version coherence:
  - `pyproject.toml` -> `0.6.0`
  - `src/multicorpus_engine/__init__.py` -> `0.6.0`

### Tests

- Full suite remains green after stabilisation updates.
- CLI smoke flow (init/import/index/query segment/query kwic) validated with temporary DB and generated DOCX fixture.

---

## [0.5.0] — 2026-02-28 — Increment 5: TEI importer + curation engine + proximity query (V2.1)

### Added

**TEI basic importer** (`importers/tei_importer.py`)
- `import_tei(conn, path, language, title, unit_element, ...)` — stdlib ElementTree (ADR-014)
- Extracts `<p>` (default) or `<s>` elements from TEI body as line units
- `xml:id` numeric suffix → external_id (e.g. "p42" → 42); fallback to sequential n
- Language from `xml:lang` on `<text>` or `<TEI>` root; overridden by `--language`
- Title from `teiHeader//title`; fallback to filename stem
- Namespace-aware (handles `xmlns="http://www.tei-c.org/ns/1.0"` and no-namespace TEI)
- No external dependencies (stdlib only)

**Curation engine** (`curation.py`)
- `CurationRule(pattern, replacement, flags, description)` — regex substitution rule (ADR-015)
- `apply_rules(text, rules)` — sequential pipeline application
- `curate_document(conn, doc_id, rules)` → `CurationReport` — updates `text_norm` in-place
- `curate_all_documents(conn, rules)` — applies to all documents
- `rules_from_list(data)` — loads rules from JSON-deserialized list, validates patterns eagerly
- `CurationReport(doc_id, units_total, units_modified, rules_matched, warnings)`

**Query engine** (`query.py`)
- `proximity_query(terms, distance)` → `NEAR(t1 t2, N)` — FTS5 proximity query builder
- Raises `ValueError` for fewer than 2 terms

**CLI** (new subcommand + mode)
- `multicorpus import --mode tei [--tei-unit p|s]` — TEI XML import
- `multicorpus curate --db ... --rules rules.json [--doc-id N]` — apply curation rules
  - Outputs `"fts_stale": true` when units were modified (user must re-run `index`)

**Tests** (17 new — 79 total)
- TEI: `<p>` elements, `<s>` elements, xml:id → external_id, xml:lang detection, title from header, FTS search, FileNotFoundError
- Curation: apply_rules basic/case-insensitive, curate_document modifies DB, report counts, unmodified unchanged, rules_from_list parsing, invalid pattern error
- Proximity: query builder output, ValueError on 1 term, FTS search with NEAR()

**Docs**
- `docs/DECISIONS.md` — ADR-014 (TEI importer), ADR-015 (curation engine)
- `docs/ROADMAP.md` — V2.1 marked Done, V2.2 roadmap outlined
- `docs/BACKLOG.md` — Increment 5 closed, sidecar API deferred

### Total: 79/79 tests passing

---

## [0.4.0] — 2026-02-28 — Increment 4: Additional importers + alignment + multi-KWIC (V2.0)

### Added

**New importers**
- `importers/txt.py` — `import_txt_numbered_lines`: TXT with same `[n]` pattern as DOCX
  - Encoding detection: BOM (UTF-8/UTF-16) → charset-normalizer (optional) → cp1252 → latin-1
  - Encoding method stored in `meta_json`; warnings emitted on fallback
  - Returns same `ImportReport` as docx_numbered_lines (ADR-011)
- `importers/docx_paragraphs.py` — `import_docx_paragraphs`: all non-empty paragraphs → line units
  - `external_id = n` (sequential, always monotone, no gaps) (ADR-012)
  - Enables immediate position-based alignment without numbering conventions

**Alignment engine** (`aligner.py`)
- `_load_doc_lines_by_position(conn, doc_id)` → `{n: unit_id}`
- `align_pair_by_position(conn, pivot_doc_id, target_doc_id, run_id)` → `AlignmentReport`
- `align_by_position(conn, pivot_doc_id, target_doc_ids, run_id)` → `list[AlignmentReport]`
- Monotone fallback: matches units by position n instead of external_id (ADR-013)

**Query engine** (`query.py`)
- `_all_kwic_windows(text, query, window)` → `list[tuple[str, str, str]]`
- `run_query(all_occurrences=False)` — when True, returns one KWIC hit per occurrence (ADR-013)

**CLI** (new flags + modes)
- `multicorpus import --mode txt_numbered_lines|docx_paragraphs`
- `multicorpus align --strategy external_id|position` (default: external_id)
- `multicorpus query --all-occurrences` (KWIC mode: one hit per occurrence)

**Tests** (15 new — 62 total)
- TXT: numbered lines, FTS indexing, UTF-8 BOM decoding, holes+duplicates, FileNotFoundError
- DOCX paragraphs: all-units-as-lines, external_id=n, skips blanks, searchable
- Position alignment: links created, partial match + missing positions, parallel view
- Multi-KWIC: multiple hits per unit, default unchanged, segment mode unaffected

**Docs**
- `docs/DECISIONS.md` — ADR-011 (TXT encoding), ADR-012 (DOCX paragraphs), ADR-013 (multi-KWIC)
- `docs/ROADMAP.md` — V2.0 marked Done, V2.1 roadmap outlined
- `docs/BACKLOG.md` — Increment 4 closed, TEI importer + sidecar API remain

### Total: 62/62 tests passing

---

## [0.3.0] — 2026-02-28 — Increment 3: TEI Export + Metadata

### Added

**Exporters** (`src/multicorpus_engine/exporters/`)
- `tei.py` — TEI "analyse" export: UTF-8, `teiHeader`, `<p>` units, XML escaping, invalid-char filtering (ADR-009)
- `csv_export.py` — CSV/TSV export of query results (segment + KWIC column sets)
- `jsonl_export.py` — JSONL export, one JSON object per line, `ensure_ascii=False`
- `html_export.py` — self-contained HTML report, XSS-safe (`html.escape`), `<<match>>` → `<span class='match'>`

**Metadata validation** (`src/multicorpus_engine/metadata.py`)
- `validate_document(conn, doc_id)` → `MetaValidationResult(is_valid, warnings)`
- `validate_all_documents(conn)` → list of results
- Required: title, language; Recommended: source_path, source_hash, doc_role, resource_type

**CLI** (2 new subcommands)
- `multicorpus export --format tei|csv|tsv|jsonl|html --output path [--doc-id] [--query] [--mode] [--include-structure]`
- `multicorpus validate-meta --db ... [--doc-id N]`

**Tests** (20 new — 47 total)
- TEI: UTF-8 declaration, well-formed XML, `&amp;` escaping, no invalid XML chars, structure, `--include-structure`
- CSV: segment columns, KWIC columns, TSV tab delimiter
- JSONL: each line valid JSON, UTF-8 no ASCII-escaping of Unicode
- HTML: contains hits, XSS prevention, no-hits message
- Metadata: valid doc, missing doc_id, all-docs, no-line-units warning

**Docs**
- `docs/DECISIONS.md` — ADR-009 (TEI design), ADR-010 (metadata validation strategy)
- `docs/ROADMAP.md` — Increment 3 marked Done, V2.0 roadmap outlined
- `docs/BACKLOG.md` — Increment 3 items closed, V2.0 items added

---

## [0.2.0] — 2026-02-28 — Increment 2: Alignment by anchors

### Added

**Schema**
- Migration 003: `alignment_links` table — unit-level 1-1 links, FK-constrained, 4 indexes
- Migration 003: `doc_relations` table — document-level meta-links (translation_of | excerpt_of)

**Core modules**
- `aligner.py` — `align_by_external_id`, `align_pair`, `add_doc_relation`, `AlignmentReport`
  - Coverage stats: `matched`, `missing_in_target`, `missing_in_pivot`, `coverage_pct`
  - Duplicate handling: first occurrence used, warnings emitted (ADR-007)
  - Multi-target support: align one pivot against N targets in a single run

**Query engine**
- `run_query(include_aligned=True)` — parallel view: aligned units from target docs attached to each hit as `hit["aligned"]` (ADR-008)

**CLI**
- `multicorpus align --db ... --pivot-doc-id N --target-doc-id M [M2 ...] [--relation-type translation_of|excerpt_of]`
- `multicorpus query ... --include-aligned`

**Tests**
- `test_align_creates_links` — links created for matching external_ids
- `test_align_coverage_report` — matched/missing/coverage_pct correct
- `test_align_missing_ids_in_warnings` — warnings emitted for missing ids
- `test_align_duplicate_external_ids` — first occurrence used, warning emitted
- `test_align_multiple_targets` — N target docs aligned in one run
- `test_query_include_aligned` — parallel view returns target units on hits
- `test_doc_relations_created` — doc_relations row persisted

**Docs**
- `docs/DECISIONS.md` — ADR-007 (duplicate handling), ADR-008 (parallel view design)
- `docs/ROADMAP.md` — Increment 2 marked Done, Increment 3 promoted to Now
- `docs/BACKLOG.md` — Increment 2 items closed, Increment 3 items detailed

### Total: 27/27 tests passing

---

## [0.1.0] — 2026-02-28 — Increment 1: Explorer minimal

### Added

**Infrastructure**
- Project scaffold: `src/multicorpus_engine/`, `tests/`, `docs/`, `migrations/`
- `pyproject.toml` with modern setuptools layout
- `multicorpus` CLI entrypoint registered via `[project.scripts]`
- `docs/CHARTER_AGENT_IDE_V1.md` — verbatim charter (source of truth)

**Database**
- SQLite DB with versioned migration runner (`db/migrations.py`)
- Migration 001: tables `documents`, `units`, `runs`
- Migration 002: FTS5 virtual table `fts_units` (content table on `units.text_norm`)
- Indexes: `(doc_id, external_id)` and `(doc_id, n)` on `units`

**Core modules**
- `unicode_policy.py` — NFC normalization, invisible cleanup, `¤` replacement, control char filtering
- `db/` — connection management, migration runner
- `importers/docx_numbered_lines.py` — DOCX import with `[n]` prefix extraction
- `indexer.py` — FTS5 build/rebuild
- `query.py` — FTS query with Segment and KWIC output modes
- `runs.py` — run logging (DB + log file)
- `cli.py` — CLI with subcommands: `init-project`, `import`, `index`, `query`

**CLI commands**
- `multicorpus init-project --db path/to.db`
- `multicorpus import --db ... --mode docx_numbered_lines --language fr --path file.docx`
- `multicorpus index --db ...`
- `multicorpus query --db ... --q "..." --mode segment|kwic [--window N] [filters]`

**Tests**
- `test_migrations_apply_clean_db` — migrations create all tables
- `test_import_docx_numbered_lines_extracts_external_id` — external_id extracted from `[n]`
- `test_import_keeps_sep_in_raw_and_removes_in_norm` — `¤` kept in raw, removed in norm
- `test_structure_paragraphs_not_indexed` — structure units absent from FTS
- `test_query_segment_returns_hits` — segment mode returns hits with `<<match>>` markers
- `test_query_kwic_returns_left_match_right` — KWIC mode returns left/match/right

**Documentation**
- `docs/ROADMAP.md` — Now/Next/Later (Increment 1 marked Done)
- `docs/BACKLOG.md` — Increment 2/3 items + deferred items
- `docs/DECISIONS.md` — ADR-001 through ADR-006
- `docs/INTEGRATION_TAURI.md` — JSON I/O contract for all CLI commands
- `README.md` — quickstart instructions

### Deferred to later increments
- TXT importer (policy defined in DECISIONS.md; not implemented)
- TEI basic importer
- Alignment by external_id (Increment 2)
- TEI export (Increment 3)
- Curation engine
- `--output` flag for query results
- Multi-occurrence KWIC (one hit per unit in V1)
