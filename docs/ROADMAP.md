# Roadmap — multicorpus_engine

Last updated: 2026-02-28 (stabilisation pass)

## Current state (implemented)

- Core DB + migrations + run logging are in place and idempotent.
- Importers implemented: `docx_numbered_lines`, `txt_numbered_lines`, `docx_paragraphs`, `tei`.
- Query modes implemented: `segment`, `kwic` (+ `--all-occurrences`, `--include-aligned`).
- Alignment implemented: `external_id`, `position`, `similarity` strategies.
- Exporters implemented: `tei`, `csv`, `tsv`, `jsonl`, `html`.
- Curation + segmentation commands implemented.
- Sidecar HTTP API implemented with versioned contract (`/openapi.json`) and async jobs.

## Now (v0.6.x)

- Stabilise CLI JSON contract (single JSON object on stdout, success/error envelope).
- Keep migrations/code/docs aligned and explicit about FTS indexing policy.
- Keep sidecar optional: usable when enabled, never required for CLI workflows.
- Maintain deterministic, lightweight test suite for core regression coverage.

## Next

- Packaging: reproducible binary builds for CLI + sidecar for Tauri distribution.
- Hardening: JSON parse/error contract for CLI argument errors (`argparse`) to avoid non-JSON failures.
- Performance: FTS benchmarks on larger corpora and documented tuning profile (WAL, batch sizes).
- Integration: end-to-end Tauri fixture tests (spawn CLI + sidecar lifecycle).

## Later

- Incremental indexing strategy (beyond full rebuild) with correctness guarantees.
- Richer segmentation quality by language (rule packs and evaluation fixtures).
- Multi-project workspace/registry and corpus-level management commands.
- TEI import/export profile extensions (anchors, apparatus, richer metadata mapping).

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| V1.0 | DB + DOCX numbered lines + FTS + segment/KWIC query | Done |
| V1.1 | Alignment tables + external_id alignment + aligned query view | Done |
| V1.2 | TEI/CSV/TSV/JSONL/HTML exports + metadata validation | Done |
| V2.0 | TXT/DOCX-paragraph importers + position alignment + multi-KWIC | Done |
| V2.1 | TEI importer + curation + proximity query | Done |
| V2.2 | Sidecar API + segmentation + output/diagnostics hardening | In progress |
