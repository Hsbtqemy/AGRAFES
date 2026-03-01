# Backlog — multicorpus_engine

Last updated: 2026-03-01 (tauri-prep V0.10: align explainability linked runs/export)

## Priority backlog (realistic, post-implementation)

| Priority | Item | Why now | Acceptance criteria | Status |
|----------|------|---------|---------------------|--------|
| **NOW** | **Tauri UI "Concordancier" V0** | Core + sidecar stable; time to deliver user-facing value | `tauri-app/` launches with `npm run tauri dev`; search, KWIC, import, index | **done** |
| **NOW** | **Tauri Concordancier Prep V0** (`tauri-prep/`) | Corpus preparation workflow (import → curate → segment → align) needs dedicated app | 3-screen scaffold: Project/DB, Import+Index, Actions; all sidecar routes wired | **done** |
| **NOW** | **Concordancier Prep V0.3** — curate preview diff + align audit UI | Users need to preview curation changes before applying + review alignment links | `POST /curate/preview` dry-run with diff table; `POST /align/audit` paginated link table | **done** |
| **NOW** | **Concordancier Prep V0.4** — metadata panel + exports + align manual correction | Users need to edit doc metadata, export corpora, and curate alignment links | MetadataScreen, ExportsScreen, align link accept/reject/delete/retarget, migration 004 | **done** |
| **NOW** | **Concordancier Prep V0.5** — async job enqueue + Job Center + contract freeze | V0.4 blocks UI on long ops; API needs drift protection | JobCenter panel, all long ops enqueue via `/jobs/enqueue`, OpenAPI snapshot + docs-sync CI tests | **done** |
| P1 | Concordancier Prep V1 — segmentation quality packs | Language-specific segmentation rules | Pack selector in ActionsScreen; apply lang-specific rule sets | done |
| P1 | Concordancier Prep V1 — advanced align strategies | Partial anchor corpora need robust fallback linking | Hybrid strategy `external_id_then_position` available in sidecar/jobs/ActionsScreen | done |
| P1 | Concordancier Prep V1 — align explainability | Users need visibility on fallback behavior | Optional `debug_align` payload available and visible in Actions logs | done |
| P1 | Concordancier V0.2 — pagination backend + load more | Prevent loading too many hits per request, especially with aligned mode | `/query` supports `limit/offset/has_more`; UI supports reset + `Charger plus` paging | done |
| P1 | Concordancier V1 — virtualisation / IntersectionObserver | V0.2 load-more exists; scrolling UX can be smoother | Automatic near-bottom page fetch with guardrails and no duplicate fetches | done |
| P1 | Concordancier V1 — metadata panel | Users need doc-level metadata at a glance | Side panel: title, language, role, resource_type, unit count | todo |
| P1 | Concordancier V1 — corpus démo | New users need a working sample | Bundled small multilingual demo corpus on first run | todo |
| P2 | Concordancier V1 — aligned view quality | V0.1 exists; needs richer control and readability | Group/sort aligned lines by language/doc and add compact expand/collapse presets | todo |
| P2 | Concordancier V1 — advanced search (regex/NEAR) | Power users need FTS5 proximity | UI for NEAR(t1 t2, N) and raw FTS5 passthrough | todo |
| P2 | Deep link between Tauri apps (`open-db` URI) | Current flow relies on copy/paste path between `tauri-prep` and `tauri-app` | Define and implement a URI/app-link contract so Prep can open Concordancier on a DB directly | todo |
| P1 | macOS sidecar signing + notarization hardening | Base scripts/workflow exist; production rollout still needs credential ops and release validation | Signed/notarized artifacts validated on tag pipeline with real cert identity and Gatekeeper checks | in_progress |
| P1 | Windows sidecar code signing hardening | Script/workflow stubs exist; production cert flow not yet exercised | Signed `.exe` artifacts verified in CI with operational cert management process | in_progress |
| P1 | Persistent sidecar restart resilience (advanced cases) | Baseline stale recovery is implemented; edge cases remain (PID reuse/races/forced kill) | Stress tests for crash/restart, stale cleanup race handling, and deterministic behavior under rapid relaunch loops | in_progress |
| P1 | Sidecar lifecycle and resilience | Sidecar contract exists; runtime behavior needs production guardrails | Extended integration tests for restart/recovery and process supervision recommendations for desktop wrapper | todo |
| P1 | Tauri fixture expansion to GUI-capable runners | Headless smoke exists; full app-run coverage is still partial | Add optional GUI-capable runner lane that executes `tauri run`/`tauri build` smoke with sidecar | todo |
| P2 | Sidecar localhost security posture | Optional token is implemented, but policy is still minimal | Explicit threat model, token rotation/expiry policy, and wrapper guidance for secure defaults | in_progress |
| P2 | Linux portability baseline (glibc/manylinux policy) | manylinux build scaffold exists; support floor must be validated empirically | Documented glibc support floor + compatibility smoke matrix on older distros | in_progress |
| P2 | CI cache strategy for PyInstaller builds | Matrix builds can be slow/costly | Cached dependency/build layers with measurable time reduction | todo |
| P2 | Sidecar binary size optimization | Onefile convenience increases binary size | Track size budget and apply PyInstaller/payload optimizations with before/after report | todo |
| P2 | Tauri release icons (icns/ico) | Dev currently uses PNG-only placeholders to unblock `tauri dev`; release packages need platform-native icons | Generate and validate real `icon.icns` + `icon.ico` assets before release packaging | todo |
| P2 | FTS performance profile | Large corpora will stress rebuild workflow | Bench report on representative datasets + documented recommended SQLite pragmas | in_progress |
| P2 | Incremental indexing strategy (flagged) | Full rebuild is simple but costly at scale | Design note + tested incremental mode behind explicit `--incremental`-style gate | todo |
| P2 | TEI compatibility matrix | TEI files vary heavily across projects | Compatibility doc + fixtures for namespaced/non-namespaced and mixed-content edge cases | todo |
| P2 | Query/export output contract tests | Prevent regressions in JSON and file schemas | Snapshot-style tests for `query --output` + exporters across modes | todo |
| P2 | Segmentation quality fixtures + benchmarks | Pack selector is in place; quality still needs objective checks | Regression fixtures FR/EN + before/after metrics per pack | done |
| P2 | Segmentation quality fixtures expansion | Current benchmark set is intentionally small and deterministic | Add harder edge cases (quotes, parenthesis, ellipsis, mixed FR/EN) + target thresholds per language | todo |
| P2 | Align explainability UI polish | Debug payload exists; rendering can be richer than logs | Dedicated explainability panel (sources, counts, similarity stats, samples) + copy diagnostic JSON | done |
| P2 | Align explainability export/report | Operators may need offline debug traces from prep runs | Save explainability payloads to file and link them to run history | done |
| P2 | Align run exploration UX | Explainability is now run-linked; users still need easier browsing/comparison in app | Add run picker + diff view across two align runs (strategy/coverage/debug deltas) | todo |
| P3 | Project-level maintenance commands | Long-term operability | CLI helpers for diagnostics, vacuum/analyze, and run history pruning | todo |

## Kept stable (already implemented)

- Importers: DOCX numbered lines, TXT numbered lines, DOCX paragraphs, TEI.
- Query: segment/KWIC, all occurrences, aligned view.
- Sidecar `/query` pagination baseline: `limit`, `offset`, `has_more`, `next_offset`.
- Alignment: external_id, external_id_then_position, position, similarity.
- Export: TEI, CSV, TSV, JSONL, HTML.
- Curation, segmentation, sidecar API + async jobs, DB diagnostics.
- Segmentation supports quality pack selection (`auto`, `default`, `fr_strict`, `en_strict`) via CLI/sidecar/tauri-prep.
- Hybrid alignment strategy `external_id_then_position` is available (anchor-first, then position fallback).
- Align explainability hook `debug_align` is available for `/align` and align jobs.
- CLI contract hardening for parser/runtime failures (`status=error`, exit code `1`, JSON-only stdout).
- Sidecar packaging scaffold (PyInstaller onefile + target-triple naming + CI matrix artifacts).
- Tauri fixture scaffold (`tauri-fixture/`) + cross-platform headless sidecar smoke workflow.
- Persistent sidecar flow (`serve` + HTTP endpoints + `.agrafes_sidecar.json` discovery + `/shutdown`).
- `POST /curate/preview` — read-only dry-run, in-memory regex simulation, no DB write.
- `POST /align/audit` — paginated alignment link audit with pivot/target texts; optional status filter.
- `GET /documents`, `POST /align` — sidecar endpoints for Concordancier Prep.
- `tauri-prep/` full V0.4 scaffold: 5 screens (Project, Import, Actions, Métadonnées, Exports).
- Metadata endpoints: `GET /doc_relations`, `POST /documents/update`, `POST /documents/bulk_update`, `POST /doc_relations/set`, `POST /doc_relations/delete`.
- Export endpoints: `POST /export/tei`, `POST /export/align_csv`, `POST /export/run_report`.
- Align correction: `POST /align/link/update_status`, `POST /align/link/delete`, `POST /align/link/retarget`.
- Migration 004: `alignment_links.status` column (NULL=unreviewed, accepted, rejected).
- **V0.5 async job enqueue**: `POST /jobs/enqueue` (9 kinds) + `POST /jobs/{id}/cancel` + extended `GET /jobs` (status filter + pagination).
- **V0.5 sidecar_jobs.py cancel()**: best-effort cancel, idempotent for terminal states.
- **V0.5 contract freeze**: `tests/snapshots/openapi_paths.json` + `test_contract_openapi_snapshot.py` + `test_contract_docs_sync.py` + `scripts/export_openapi.py` + `docs/openapi.json`.
- **V0.5 tauri-prep JobCenter**: `tauri-prep/src/components/JobCenter.ts` — progress strip, cancel, recent jobs.
- **V0.5 tauri-prep screens**: all long operations use `enqueueJob` + `jobCenter.trackJob`; toast on result.
