# Roadmap — multicorpus_engine

Last updated: 2026-03-01 (V1.1 Sprint 1.1: align quality metrics + V1.0 Sprint 2.1: virtualisation)

## Current state (implemented)

- Core DB + migrations + run logging are in place and idempotent.
- Importers implemented: `docx_numbered_lines`, `txt_numbered_lines`, `docx_paragraphs`, `tei`.
- Query modes implemented: `segment`, `kwic` (+ `--all-occurrences`, `--include-aligned`).
- Alignment implemented: `external_id`, `position`, `similarity` strategies.
- Exporters implemented: `tei`, `csv`, `tsv`, `jsonl`, `html`.
- Curation + segmentation commands implemented.
- Sidecar HTTP API implemented with versioned contract (`/openapi.json`) and async jobs.
- CLI contract hardened: parse/runtime errors now return one JSON error object on stdout with exit code `1`.
- Sidecar binary packaging scaffold implemented:
  - `scripts/sidecar_entry.py` + `scripts/build_sidecar.py`
  - canonical Tauri binaries directory `tauri/src-tauri/binaries/`
  - fixture binaries directory `tauri-fixture/src-tauri/binaries/`
  - CI matrix build workflow `.github/workflows/build-sidecar.yml`
- Tauri headless fixture implemented:
  - `tauri-fixture/` scaffold (Tauri v2 layout, no UI)
  - sidecar smoke runner validating JSON contract
  - CI matrix workflow `.github/workflows/tauri-e2e-fixture.yml`
- Sidecar hardening hook implemented:
  - startup/size benchmark script `scripts/bench_sidecar_startup.py`
  - onefile/onedir comparative output support (`bench/results/<date>_<os>_<arch>_<format>.json`)
  - benchmark aggregation script `scripts/aggregate_bench_results.py` -> `docs/BENCHMARKS.md`
- Segmentation quality harness implemented:
  - FR/EN fixtures `bench/fixtures/segmentation_quality_cases.json`
  - scoring script `scripts/bench_segmentation_quality.py`
  - summary doc `docs/SEGMENTATION_BENCHMARKS.md`
- Persistent sidecar HTTP hardened:
  - `/health`, `/query`, `/index`, `/import`, `/shutdown`
  - sidecar portfile `.agrafes_sidecar.json`
  - graceful shutdown path and fixture persistent scenario
  - stale portfile restart policy (`already_running` vs stale recovery)
  - optional localhost token mode + `status` command
- Distribution tooling scaffold implemented:
  - macOS sign/notarize scripts for sidecar + fixture app
  - Windows signing script (signtool)
  - Linux manylinux build script + Dockerfile
  - release/signing workflows with secrets-conditional behavior
  - bench matrix workflow `.github/workflows/bench-sidecar.yml`
  - `docs/DISTRIBUTION.md`
- ADR-025 finalized from multi-OS benchmarks:
  - default format mapping: macOS=`onefile`, Linux=`onedir`, Windows=`onedir`
  - workflows aligned to explicit per-OS format selection

## Now (v0.6.1 → tauri-prep)

- All core engine increments done (V1.0–V2.8): importers, query, alignment, exports, sidecar, packaging.
- **Tauri UI "Concordancier" V0** done: search-first desktop app (`tauri-app/`), V0.1 aligned view, V0.2 pagination.
- **Concordancier Prep V0** (`tauri-prep/`) — corpus preparation desktop app:
  - 3-screen scaffold: Project (DB open/sidecar status/shutdown), Import (batch + index), Actions (curate/segment/align/validateMeta).
  - V0.3: curation preview (dry-run diff + stats banner) + align audit (paginated link table).
  - V0.4: metadata panel (per-doc edit + bulk edit + relations + validate), exports (TEI/CSV/run report), align manual correction (accept/reject/delete/retarget per link). 162 tests passing.
  - V0.5: Job Center panel (async enqueue for all long ops) + contract freeze (OpenAPI snapshot + docs sync tests). 189 tests passing.
  - V0.6: “Open in Concordancier” helpers in Project screen (copy DB path, short modal instructions, fallback manual copy field).
  - V0.6.1: segmentation quality pack selector in Actions screen (`auto`, `default`, `fr_strict`, `en_strict`) wired to sidecar `/segment` + job enqueue.
  - V0.7: align strategy `external_id_then_position` (hybrid fallback) wired in sidecar + jobs + Actions screen.
  - V0.8: align explainability option (`debug_align`) for `/align` and align jobs; Actions screen logs per-strategy debug sources/stats.
  - V0.8.1: align explainability UI polish — dedicated panel in Actions (sources, similarity stats, sample links) + "Copier diagnostic JSON".
  - V0.9: segmentation quality fixtures + benchmark harness (`bench/fixtures/segmentation_quality_cases.json`, `scripts/bench_segmentation_quality.py`, `docs/SEGMENTATION_BENCHMARKS.md`).
  - V0.10: align explainability linked to persisted runs (`run_id` on `/align` + align jobs), exportable via run report filter in `tauri-prep` Exports.
  - **V1.1 (Sprint 1.1)**: `POST /align/quality` — alignment quality metrics endpoint (coverage%, orphans, collisions, status_counts, sample orphan units); quality panel in ActionsScreen (stats grid + orphan details). CONTRACT_VERSION=1.1.0. 9 new tests → 217 total.
- **Concordancier V1.0 (Sprint 2.1)**: IntersectionObserver sentinel in results area — automatic load-more when scrolling near bottom; guards against duplicate fetches (`loadingMore`/`hasMore`). Manual "Charger plus" button retained as fallback.
- Keep CLI contract stable and test-gated (single stdout JSON object, success/error envelope).
- Keep sidecar optional and non-blocking for CLI-first workflows.
- Maintain deterministic, lightweight regression tests (no heavy corpus fixtures).

## Next

- **Sprint 1.2**: Align explainability feature trace in audit table (`include_explain` flag + `POST /align/explain` or inline in audit).
- **Sprint 1.3**: Batch correction in audit (multi-select accept/reject/delete + `POST /align/links/batch_update`).
- **Sprint 2.2**: Advanced search UI (phrase, AND/OR, NEAR, wildcard filter by doc/lang/role).
- **Sprint 2.3**: Parallel KWIC "clean" (pivot + aligned stack in KWIC mode, collapse by lang/doc).
- Concordancier V1: corpus metadata panel, multi-doc import batch, document list view.
- Sidecar release hardening: macOS notarization, Windows signing, provenance pipeline.
- Linux compatibility baseline: glibc floor and packaging policy documentation.
- Localhost security policy for sidecar HTTP (token rotation/scope/threat model).
- Performance: FTS benchmarks and documented tuning profile (WAL, batch sizes, vacuum/analyze cadence).

## Later

- Incremental indexing strategy (beyond full rebuild) with correctness guarantees and explicit flags.
- Richer segmentation quality by language (additional packs + evaluation fixtures and quality metrics).
- Multi-project workspace/registry and corpus-level maintenance commands.
- TEI import/export profile extensions (anchors, apparatus, richer metadata mapping).

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| V1.0 | DB + DOCX numbered lines + FTS + segment/KWIC query | Done |
| V1.1 | Alignment tables + external_id alignment + aligned query view | Done |
| V1.2 | TEI/CSV/TSV/JSONL/HTML exports + metadata validation | Done |
| V2.0 | TXT/DOCX-paragraph importers + position alignment + multi-KWIC | Done |
| V2.1 | TEI importer + curation + proximity query | Done |
| V2.2 | Sidecar API + segmentation + contract/diagnostics hardening | Done |
| V2.3 | Sidecar binary packaging scaffold (PyInstaller + CI matrix) | Done |
| V2.4 | Tauri headless fixture E2E + sidecar hardening hooks | Done |
| V2.5 | Persistent sidecar HTTP UX path + portfile + shutdown flow | Done |
| V2.6 | Restart policy + optional localhost token + path consistency cleanup | Done |
| V2.7 | Full distribution scaffold (mac/win sign, linux manylinux, release workflow) | Done |
| V2.8 | Multi-OS bench workflow + benchmark aggregation docs | Done |
| V3.0 | Tauri UI Concordancier V0 (search-first, sidecar-driven) | Done |
| V3.1 | Concordancier Prep V0 scaffold (tauri-prep, 3 screens) | Done |
| V3.2 | Concordancier Prep V0.3 (curate preview diff + align audit UI) | Done |
| V3.3 | Concordancier Prep V0.4 (metadata panel + exports + align correction) | Done |
| V3.4 | Concordancier Prep V0.5 (async job enqueue + Job Center + contract freeze) | Done |
| V3.5 | Concordancier Prep V0.6 (Prep → Concordancier handoff helpers + workflow docs) | Done |
| V3.6 | Concordancier Prep V0.6.1 (segmentation quality pack selector + sidecar pack plumbing) | Done |
| V3.7 | Concordancier Prep V0.7 (advanced align strategy `external_id_then_position`) | Done |
| V3.8 | Concordancier Prep V0.8 (align explainability `debug_align`) | Done |
| V3.9 | Concordancier Prep V0.8.1 (align explainability panel + diagnostic copy) | Done |
| V3.10 | Concordancier Prep V0.9 (segmentation quality fixtures + benchmark harness) | Done |
| V3.11 | Concordancier Prep V0.10 (align explainability linked to persisted runs + export filter) | Done |
| V4.0 | Concordancier Prep V1.1 Sprint 1.1 (`POST /align/quality` + quality panel UI) | Done |
| V4.1 | Concordancier V1.0 Sprint 2.1 (IntersectionObserver auto-scroll sentinel) | Done |
