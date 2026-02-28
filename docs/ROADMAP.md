# Roadmap — multicorpus_engine

Last updated: 2026-02-28 (bench multi-OS workflow + aggregation)

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

## Now (v0.6.1)

- Packaging sidecar iteration: done (local build script + CI matrix artifacts).
- Tauri integration fixture iteration: done (headless E2E smoke per OS).
- Persistent sidecar iteration: done (serve once + multi-request HTTP flow).
- Restart/token hardening iteration: done (stale recovery + optional auth header).
- Distribution scaffold iteration: done (scripts/workflows/docs; secrets-conditional).
- Bench matrix/aggregation iteration: done (CI workflow + local summary generation).
- Keep CLI contract stable and test-gated (single stdout JSON object, success/error envelope).
- Keep sidecar optional and non-blocking for CLI-first workflows.
- Maintain deterministic, lightweight regression tests (no heavy corpus fixtures).

## Next

- Sidecar release hardening: macOS notarization, Windows signing, provenance pipeline.
- Linux compatibility baseline: glibc floor and packaging policy documentation.
- Onefile vs onedir final ADR decision after CI matrix data is collected (ADR-025 pending).
- Localhost security policy for sidecar HTTP (token rotation/scope/threat model).
- Performance: FTS benchmarks and documented tuning profile (WAL, batch sizes, vacuum/analyze cadence).
- Integration: end-to-end Tauri fixture tests (persistent lifecycle/restart paths).
- TEI compatibility matrix and fixture coverage for namespaced/mixed-content edge cases.

## Later

- Incremental indexing strategy (beyond full rebuild) with correctness guarantees and explicit flags.
- Richer segmentation quality by language (rule packs and evaluation fixtures).
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
| V2.2 | Sidecar API + segmentation + contract/diagnostics hardening | In progress |
| V2.3 | Sidecar binary packaging scaffold (PyInstaller + CI matrix) | Done |
| V2.4 | Tauri headless fixture E2E + sidecar hardening hooks | Done |
| V2.5 | Persistent sidecar HTTP UX path + portfile + shutdown flow | Done |
| V2.6 | Restart policy + optional localhost token + path consistency cleanup | Done |
| V2.7 | Full distribution scaffold (mac/win sign, linux manylinux, release workflow) | Done |
| V2.8 | Multi-OS bench workflow + benchmark aggregation docs | Done |
