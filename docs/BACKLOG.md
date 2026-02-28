# Backlog — multicorpus_engine

Last updated: 2026-02-28 (UI V0.2 pagination + load more)

## Priority backlog (realistic, post-implementation)

| Priority | Item | Why now | Acceptance criteria | Status |
|----------|------|---------|---------------------|--------|
| **NOW** | **Tauri UI "Concordancier" V0** | Core + sidecar stable; time to deliver user-facing value | `tauri-app/` launches with `npm run tauri dev`; search, KWIC, import, index | **in_progress** |
| P1 | Concordancier V0.2 — pagination backend + load more | Prevent loading too many hits per request, especially with aligned mode | `/query` supports `limit/offset/has_more`; UI supports reset + `Charger plus` paging | done |
| P1 | Concordancier V1 — virtualisation / IntersectionObserver | V0.2 load-more exists; scrolling UX can be smoother | Automatic near-bottom page fetch with guardrails and no duplicate fetches | todo |
| P1 | Concordancier V1 — metadata panel | Users need doc-level metadata at a glance | Side panel: title, language, role, resource_type, unit count | todo |
| P1 | Concordancier V1 — corpus démo | New users need a working sample | Bundled small multilingual demo corpus on first run | todo |
| P2 | Concordancier V1 — aligned view quality | V0.1 exists; needs richer control and readability | Group/sort aligned lines by language/doc and add compact expand/collapse presets | todo |
| P2 | Concordancier V1 — advanced search (regex/NEAR) | Power users need FTS5 proximity | UI for NEAR(t1 t2, N) and raw FTS5 passthrough | todo |
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
| P3 | Segmentation quality packs by language | Current segmenter is rule-based baseline | Language-specific rules documented + regression fixtures for FR/EN | todo |
| P3 | Similarity alignment explainability | Similarity strategy exists, needs traceability | Optional debug report with scores/threshold decisions per aligned pair | todo |
| P3 | Project-level maintenance commands | Long-term operability | CLI helpers for diagnostics, vacuum/analyze, and run history pruning | todo |

## Kept stable (already implemented)

- Importers: DOCX numbered lines, TXT numbered lines, DOCX paragraphs, TEI.
- Query: segment/KWIC, all occurrences, aligned view.
- Sidecar `/query` pagination baseline: `limit`, `offset`, `has_more`, `next_offset`.
- Alignment: external_id, position, similarity.
- Export: TEI, CSV, TSV, JSONL, HTML.
- Curation, segmentation, sidecar API + async jobs, DB diagnostics.
- CLI contract hardening for parser/runtime failures (`status=error`, exit code `1`, JSON-only stdout).
- Sidecar packaging scaffold (PyInstaller onefile + target-triple naming + CI matrix artifacts).
- Tauri fixture scaffold (`tauri-fixture/`) + cross-platform headless sidecar smoke workflow.
- Persistent sidecar flow (`serve` + HTTP endpoints + `.agrafes_sidecar.json` discovery + `/shutdown`).
