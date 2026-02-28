# Backlog — multicorpus_engine

Last updated: 2026-02-28

## Priority backlog (realistic, post-implementation)

| Priority | Item | Why now | Acceptance criteria | Status |
|----------|------|---------|---------------------|--------|
| P1 | CLI error envelope hardening (including argparse failures) | Tauri expects strict machine-readable errors | All command failures (including bad args) return exactly one JSON error object + exit code 1 | todo |
| P1 | Packaging CLI/sidecar for Tauri | Needed for reproducible desktop delivery | Scripted build artifacts for macOS/Linux/Windows + documented install/runtime constraints | todo |
| P1 | Sidecar lifecycle and resilience | Sidecar is implemented but needs production guardrails | Graceful shutdown, startup collision handling, and integration tests for restart/recovery | todo |
| P2 | FTS performance profile | Large corpora will stress rebuild workflow | Bench report on representative datasets + documented recommended SQLite pragmas | in_progress |
| P2 | Incremental indexing strategy | Full rebuild is simple but costly at scale | Design note + tested incremental mode guarded by explicit flag | todo |
| P2 | TEI compatibility matrix | TEI files vary heavily across projects | Compatibility doc + fixtures for namespaced/non-namespaced and mixed-content edge cases | todo |
| P2 | Query/export output contract tests | Prevent regressions in JSON and file schemas | Snapshot-style tests for `query --output` + exporters across modes | todo |
| P3 | Segmentation quality packs by language | Current segmenter is rule-based baseline | Language-specific rules documented + regression fixtures for FR/EN | todo |
| P3 | Similarity alignment explainability | Similarity strategy exists, needs traceability | Optional debug report with scores/threshold decisions per aligned pair | todo |
| P3 | Project-level maintenance commands | Long-term operability | CLI helpers for diagnostics, vacuum/analyze, and run history pruning | todo |

## Kept stable (already implemented)

- Importers: DOCX numbered lines, TXT numbered lines, DOCX paragraphs, TEI.
- Query: segment/KWIC, all occurrences, aligned view.
- Alignment: external_id, position, similarity.
- Export: TEI, CSV, TSV, JSONL, HTML.
- Curation, segmentation, sidecar API + async jobs, DB diagnostics.
