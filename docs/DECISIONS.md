# Decisions — multicorpus_engine

Mini ADRs (Context -> Decision -> Consequences).
This file is the consolidated source of truth after the 2026-02-28 stabilisation pass.

## ADR-001 — `external_id` extraction from DOCX numbered lines

**Date:** 2026-02-28
**Status:** Accepted

**Context**
HIMYC-style DOCX sources encode alignable lines as `[n] content` paragraphs.

**Decision**
- Parse numbered lines with regex: `^\[\s*(\d+)\s*\]\s*(.+)$`.
- Matching paragraph -> `unit_type="line"`, `external_id=int(n)`, indexed in FTS.
- Non-matching paragraph -> `unit_type="structure"`, `external_id=NULL`, preserved but not indexed.
- Import diagnostics must report duplicates, holes, non-monotonic ids.

**Consequences**
- Anchor-based alignment is possible (`external_id` shared across docs).
- Structure paragraphs remain available for context without polluting search results.

---

## ADR-002 — `¤` separator policy (Option 2)

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Some sources use `¤` as an inline segment separator.

**Decision**
- `text_raw`: keep `¤` unchanged.
- `text_norm`: replace each `¤` with one ASCII space.
- Display helper: `text_display(text_raw)` replaces `¤` by `" | "`.
- `sep_count` may be stored in `meta_json` for analytics.

**Consequences**
- Search over `text_norm` is separator-agnostic.
- UI can still render visual segment boundaries from raw text.

---

## ADR-003 — Unicode normalization policy for `text_norm`

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Corpus sources contain mixed encodings, spacing conventions, and invisible characters.

**Decision**
Apply the following normalization pipeline before indexing:
- Unicode NFC.
- Normalize line endings (`CRLF`/`CR` -> `LF`).
- Remove invisibles (`ZWSP`, `ZWNJ`, `ZWJ`, `WORD JOINER`, `BOM`, soft hyphen).
- Normalize `NBSP` (`U+00A0`) and `NNBSP` (`U+202F`) to ASCII space.
- Replace `¤` with ASCII space (per ADR-002).
- Strip ASCII controls `U+0000..U+001F` except `TAB`, `LF`, `CR`.

**Consequences**
- `text_norm` is deterministic and search-safe.
- `text_raw` remains the faithful source text.

---

## ADR-004 — Run logging and reproducibility

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Operations must be auditable and replayable from machine-readable metadata.

**Decision**
- Every CLI operation creates a `runs` row (`run_id`, `kind`, `params_json`, `stats_json`, `created_at`).
- Detailed logs are written to `<db_dir>/runs/<run_id>/run.log`.
- Stdout remains reserved for one JSON summary object.

**Consequences**
- Tauri can parse stdout deterministically.
- Operational diagnosis relies on run logs and persisted run stats.

---

## ADR-005 — FTS5 indexing strategy

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Search index must remain simple, deterministic, and tied to corpus units.

**Decision**
- `fts_units` is a regular FTS5 table (`text_norm`), not an external-content table.
- Insert rows with `rowid = units.unit_id`.
- Index only `units.unit_type='line'`.
- Current indexing mode is full rebuild (`DELETE FROM fts_units` + reinsert eligible units).
- Incremental indexing is deferred and must be introduced behind an explicit design/test gate.

**Consequences**
- Join semantics are stable (`fts_units.rowid -> units.unit_id`).
- Structure units are intentionally excluded from search.
- Rebuild is robust and easy to reason about, with predictable cost.

---

## ADR-006 — Query output modes

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Concordance workflows require two complementary views of a match.

**Decision**
- `segment` mode returns the full normalized unit with highlighted match.
- `kwic` mode returns `left/match/right` windows.
- `--all-occurrences` in KWIC returns one hit per match occurrence.

**Consequences**
- API stays compact while serving both browsing and concordance use cases.

---

## ADR-007 — Alignment duplicate handling

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Duplicate `external_id` values can appear in source documents.

**Decision**
- Use first occurrence (lowest `n`) for ambiguous duplicates.
- Report duplicates and missing anchors in alignment reports.

**Consequences**
- Alignment remains deterministic even on imperfect sources.
- Users are informed of data quality issues instead of silent mismatch.

---

## ADR-008 — Structure units are preserved but non-indexed

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Headings and document scaffolding are useful context but hurt lexical search quality.

**Decision**
- Keep structure paragraphs in `units` as `unit_type='structure'`.
- Exclude them from FTS indexing and default query hits.

**Consequences**
- Search precision is improved.
- Context remains available for export/rendering/audit paths.

---

## ADR-009 — TEI export strategy

**Date:** 2026-02-28
**Status:** Accepted

**Context**
TEI export must be valid XML 1.0 and safe for downstream processing.

**Decision**
- Use stdlib `xml.etree.ElementTree` for generation.
- Escape XML-sensitive content and strip XML 1.0 invalid code points.
- UTF-8 output with XML declaration.
- Export line units by default; structure units remain optional.

**Consequences**
- Export stays dependency-light and robust across platforms.

---

## ADR-010 — Metadata validation model

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Metadata quality must be observable without blocking ingest workflows.

**Decision**
- `validate_document` / `validate_all_documents` return structured warnings.
- Missing required fields (`title`, `language`) set `is_valid=false`.
- CLI `validate-meta` reports `status=ok|warnings`, not hard failures by default.

**Consequences**
- Data quality can be monitored continuously with non-destructive checks.

---

## ADR-011 — TXT encoding detection

**Date:** 2026-02-28
**Status:** Accepted

**Context**
TXT files arrive in mixed encodings.

**Decision**
- Detection order: BOM -> `charset-normalizer` (if installed) -> `cp1252` -> `latin-1`.
- Persist encoding metadata in `documents.meta_json`.
- Keep importer operational without optional dependency installed.

**Consequences**
- Good default interoperability with deterministic fallback behavior.
- Encoding fallback (cp1252/latin-1) is not written to stderr: it is logged only to the run log (CLI) when `run_logger` is provided, and added to import run `stats_json.warnings` as `{"type": "encoding_fallback", "path": "...", "chosen": "cp1252"}` so that CLI/sidecar stderr stays empty (contract hardening).

---

## ADR-012 — DOCX paragraphs importer

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Some corpora do not provide `[n]` anchors.

**Decision**
- Import non-empty paragraphs as `unit_type='line'`.
- Assign monotone `external_id = n`.

**Consequences**
- Documents become alignable by position even without explicit anchors.

---

## ADR-013 — Position-based alignment fallback

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Anchor-based alignment is not always available.

**Decision**
- Provide alignment by shared sequential position `n`.
- Report missing positions on each side.

**Consequences**
- Predictable fallback with clear limitations on structural divergence.

---

## ADR-014 — TEI basic importer

**Date:** 2026-02-28
**Status:** Accepted

**Context**
TEI corpora must be ingestible with minimal dependencies.

**Decision**
- Import `<p>` or `<s>` units using stdlib XML parser.
- Resolve language/title from TEI metadata with CLI override support.
- Derive `external_id` from numeric suffix of `xml:id` when available.

**Consequences**
- Broad TEI compatibility while keeping importer simple and deterministic.

---

## ADR-015 — Curation engine on `text_norm`

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Post-import text normalization sometimes requires corpus-specific regex corrections.

**Decision**
- Apply ordered regex rules to `text_norm` (`curate` command).
- Keep `text_raw` unchanged.
- Mark FTS as stale after any modification.

**Consequences**
- Curation is reproducible and auditable, with explicit reindex requirement.

---

## ADR-016 — Sidecar API contract and optional runtime role

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Tauri integration needs a localhost API without making sidecar mandatory for CLI users.

**Decision**
- Sidecar contract is versioned (`api_version`), exposed by `GET /openapi.json`.
- Standard error codes: `BAD_REQUEST`, `NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.
- Async jobs are supported via `/jobs` and `/jobs/{job_id}` for `index`, `curate`, `validate-meta`, `segment`.
- Sidecar is optional; CLI remains the primary integration baseline.

**Consequences**
- Contract-first integration is possible for Tauri.
- Projects can operate in CLI-only mode with no sidecar dependency.

---

## ADR-017 — Segmentation strategy (line -> sentence)

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Some workflows require sentence-level units while source imports are line-based.

**Decision**
- Provide regex-based resegmentation (`segment` command) from line units.
- Delete stale alignment links touching the segmented document.
- Do not auto-rebuild FTS; return `fts_stale=true` and require explicit `index`.

**Consequences**
- Segmentation remains controlled and reversible at workflow level.
- Post-segmentation consistency is explicit (alignment/FTS refresh required).

---

## ADR-018 — Similarity alignment fallback

**Date:** 2026-02-28
**Status:** Accepted

**Context**
When anchors and positions both fail, a fuzzy fallback is still useful.

**Decision**
- Provide `align --strategy similarity` using normalized edit-distance similarity.
- Greedy one-to-one target matching with configurable threshold.

**Consequences**
- More recall on noisy corpora, at the cost of score-dependent ambiguity.
- Threshold tuning remains a user responsibility.

---

## ADR-019 — CLI JSON envelope contract

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Frontend integration fails when commands emit mixed logs/text and inconsistent JSON shapes.

**Decision**
- CLI emits exactly one JSON object on stdout per invocation.
- Success payloads include `status` (`ok`, `warnings`, or command-specific non-error status such as `listening`).
- Error payloads include `status="error"`, `error`, and `created_at`, with exit code `1`.
- Parser/validation failures from `argparse` (missing args, invalid choices, unknown subcommand) must use the same JSON error envelope and must not emit usage text to stderr.
- Human-readable diagnostics stay in run log files.

**Consequences**
- Tauri can treat stdout as strict machine I/O.
- Contract regressions become testable via subprocess smoke tests (success path + parse-failure path).

---

## ADR-020 — Sidecar binary packaging via PyInstaller (onefile)

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Tauri desktop packaging requires platform-specific sidecar binaries, while the
core engine must remain UI-independent and CLI-contract stable.

**Decision**
- Use PyInstaller in `onefile` mode to package the CLI as a sidecar binary.
- Add a stable packaging entrypoint `scripts/sidecar_entry.py` that only calls
  `multicorpus_engine.cli.main`.
- Build with `scripts/build_sidecar.py`, output to
  canonical app path `tauri/src-tauri/binaries/` and optional fixture path
  `tauri-fixture/src-tauri/binaries/` via presets.
- Bundle SQL migrations inside the PyInstaller artifact and resolve migration
  directory from `sys._MEIPASS` when running in bundled mode.
- Binary naming convention:
  - macOS/Linux: `multicorpus-<target_triple>`
  - Windows: `multicorpus-<target_triple>.exe`
- Target triple resolution:
  1. `rustc --print host-tuple` when available.
  2. deterministic fallback mapping by OS/arch.
- Write `sidecar-manifest.json` with:
  `name`, `target_triple`, `version`, `sha256`, `build_time`.
- Keep packaging dependency isolated in optional extra
  `[project.optional-dependencies].packaging` (`pyinstaller` only).

**Consequences**
- Local macOS packaging and CI matrix packaging become reproducible.
- Runtime/core dependencies stay minimal for non-packaging users.
- Signing/notarization and advanced binary hardening remain explicit backlog items.

---

## ADR-021 — Tauri E2E fixture strategy + onefile baseline

**Date:** 2026-02-28
**Status:** Accepted

**Context**
We need cross-platform end-to-end confidence that Tauri sidecar execution
respects the CLI JSON contract, without requiring a full UI test harness.
We also need an explicit baseline for onefile packaging tradeoffs.

**Decision**
- Add a minimal headless fixture under `tauri-fixture/` (no product UI).
- Validate E2E by running the sidecar CLI directly from fixture smoke script:
  - `init-project` success JSON + `rc=0`
  - `query` success JSON + `rc=0`
  - invalid-arg error JSON + `rc=1`
  - stderr must remain empty in fixture checks
- Add workflow `.github/workflows/tauri-e2e-fixture.yml`:
  - build sidecar artifacts in matrix (`macos`, `ubuntu`, `windows`)
  - run fixture smoke in matrix using downloaded artifacts
- Keep PyInstaller `onefile` as current baseline.
- Add startup/size benchmark script `scripts/bench_sidecar_startup.py` to gather
  data for future onefile vs onedir evaluation.

**Consequences**
- We get reproducible, UI-independent integration checks on all target OSes.
- GUI runner constraints do not block contract validation in CI.
- Onefile remains default until measured evidence justifies switching to onedir.

---

## ADR-022 — Persistent sidecar HTTP for UX (serve once, query many)

**Date:** 2026-02-28
**Status:** Accepted

**Context**
PyInstaller onefile cold-start cost is noticeable for one-shot CLI invocations
in interactive desktop UX. Tauri integration needs a low-latency multi-request path.

**Decision**
- Standardize a persistent sidecar process started with:
  - `multicorpus serve --db ... --host 127.0.0.1 --port 0|NNNN`
- Provide minimum HTTP endpoints for persistent workflows:
  - `GET /health`
  - `POST /import`
  - `POST /index`
  - `POST /query`
  - `POST /shutdown`
- Keep strict JSON envelope with `ok` + `status` and structured errors.
- Write sidecar discovery file next to DB:
  - `.agrafes_sidecar.json` containing `host/port/pid/started_at/db_path`.
- Implement graceful shutdown path:
  - `/shutdown` stops server, closes DB, removes portfile.
- Keep CLI one-shot path as fallback compatibility mode.

**Consequences**
- Tauri can start sidecar once and reuse HTTP calls for responsive UX.
- Persistent lifecycle (restart/crash/stale portfile/security policy) becomes a
  first-class operational concern and remains tracked in backlog.

---

## ADR-023 — Restart policy + optional localhost token

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Persistent sidecar mode needs deterministic startup behavior in the presence of
stale portfiles, and a lightweight localhost guard without introducing heavy
web dependencies.

**Decision**
- Startup policy for `multicorpus serve`:
  - inspect existing `.agrafes_sidecar.json` using PID + `/health` probe
  - if PID alive and `/health` is OK, return `status="already_running"` and do
    not launch a second process
  - otherwise treat portfile as stale, remove it, and start a fresh sidecar
- Add `multicorpus status --db ...` for state discovery:
  - `running`, `stale`, or `missing`
- Add optional token mode for localhost write endpoints:
  - `serve --token auto|off|<value>` (`auto` default)
  - token is persisted in portfile when active
  - require `X-Agrafes-Token` for `/import`, `/index`, `/shutdown`
  - return `401` with `UNAUTHORIZED` on missing/invalid token

**Consequences**
- Sidecar lifecycle is deterministic and easier to integrate from Tauri.
- Default persistent mode is safer on localhost without breaking compatibility:
  `--token off` preserves previous open behavior.
- Localhost threat model and wrapper token lifecycle guidance are now documented
  in `docs/SIDECAR_SECURITY_POSTURE.md`.
- Advanced auth (scoped tokens, server-side expiry, ACL) remains explicit backlog.

---

## ADR-024 — Distribution pipeline with conditional signing/notarization

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Desktop distribution needs OS-specific signing/notarization, but CI must remain
usable without privileged credentials in forks and early setup stages.

**Decision**
- Add dedicated distribution scripts:
  - macOS sidecar sign/notarize
  - macOS representative Tauri app sign/notarize
  - Windows sidecar signing
  - Linux manylinux sidecar build
- Add CI workflows for macOS, Windows, Linux distribution lanes.
- Gate signing/notarization by presence of GitHub Secrets.
- If secrets are missing:
  - keep build green
  - publish unsigned artifacts
  - emit explicit warnings
- Keep release workflow on `v*` tags with artifact aggregation and publication.

**Consequences**
- Distribution can start immediately, with incremental hardening as secrets are
  provisioned.
- Security-sensitive operations stay out of repository content.
- CI behavior is deterministic across signed/unsigned modes.

---

## ADR-025 — Sidecar packaging format default (onefile vs onedir)

**Date:** 2026-02-28
**Status:** Decided

**Context**
`onefile` improves distribution simplicity but can increase cold-start. `onedir`
can reduce launch overhead at the cost of larger artifact sets and packaging
complexity.

**Decision**
- Extend build tooling to support both `--format onefile|onedir`.
- Extend benchmark tooling to capture startup latency and size metrics for both.
- Add CI matrix benchmark workflow (`.github/workflows/bench-sidecar.yml`) and
  aggregation script (`scripts/aggregate_bench_results.py`) to produce
  `docs/BENCHMARKS.md`.
- Bench CI policy for persistent runs:
  - fixture input file is written explicitly as UTF-8 with LF newlines
  - stderr remains strict by default, but known benign benchmark warning lines
    can be allowlisted (unknown stderr lines still fail the benchmark)
- Final decision scope: `per_os`.
- Default mapping when `--format` is omitted:
  - `darwin` -> `onefile`
  - `linux` -> `onedir`
  - `windows` -> `onedir` ← **amendé par ADR-037** (voir ci-dessous)
- CI workflows use explicit per-OS `--format` flags to avoid ambiguity.

Benchmark basis (from `docs/BENCHMARKS.md`):

| OS | Choice | Startup gain of onedir vs onefile | Size growth (onedir / onefile) | Rationale |
|----|--------|-----------------------------------:|---------------------------------:|-----------|
| macOS | onefile | +64.2% | 3.79x | Startup gain is strong, but size exceeds accepted 2.5x threshold. |
| Linux | onedir | +70.9% | 2.28x | Startup gain exceeds threshold and size growth stays within limit. |
| Windows | onedir | +73.0% | 2.07x | Startup gain exceeds threshold and size growth stays within limit. |

**Consequences**
- Sidecar build defaults now depend on OS when `--format` is not provided.
- Linux release lanes publish `onedir` sidecars by default.
- macOS release and fixture lanes keep `onefile` by default.
- Windows release lanes: `onedir` per benchmark, but **overridden to `onefile`** by Tauri externalBin constraint (ADR-037).
- Tauri integration must support both artifact layouts:
  - `onefile`: single executable
  - `onedir`: directory bundle with renamed executable inside
- Current benchmark summary remains tracked in `docs/BENCHMARKS.md`.

---

## ADR-026 — Segmentation quality packs (V0 scaffold)

**Date:** 2026-02-28
**Status:** Accepted

**Context**
`tauri-prep` needed a first V1 step to select language-aware segmentation behavior
without introducing heavy NLP dependencies or breaking existing workflows.

**Decision**
- Add an optional segmentation `pack` parameter across CLI/sidecar/job paths.
- Supported values:
  - `auto` (default): resolves from `lang` (`fr* -> fr_strict`, `en* -> en_strict`, else `default`)
  - `default`, `fr_strict`, `en_strict`
- Expose the selected pack in segmentation responses as `segment_pack`.
- Add a pack selector in `tauri-prep` Actions screen and forward it to `/jobs/enqueue` segment requests.

**Consequences**
- Backward compatibility is preserved (no `pack` still works via default `auto`).
- Segmentation quality can now be tuned per workflow before adding richer fixtures/metrics.
- Further pack refinement remains in backlog (evaluation fixtures + measurable quality targets).

---

## ADR-027 — Hybrid alignment strategy (`external_id_then_position`)

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Some corpora are partially anchored: many lines share `external_id`, but some
rows are missing or drifted. Pure `external_id` leaves avoidable gaps; pure
`position` can over-link when anchors exist.

**Decision**
- Add strategy `external_id_then_position`:
  1. align by `external_id` first (anchor-first behavior preserved)
  2. align remaining unmatched rows by shared position `n`
- Expose strategy in CLI, sidecar `/align`, and async jobs (`/jobs/enqueue`).
- Keep response shape backward-compatible and include `links_skipped` in reports.

**Consequences**
- Better default recall on partially anchored corpora without abandoning anchors.
- UI (`tauri-prep`) can offer a practical fallback strategy with a single toggle.
- Rich explainability UI/scoring visualization remains backlog (debug payload hook exists via ADR-028).

---

## ADR-028 — Optional align explainability payload (`debug_align`)

**Date:** 2026-02-28
**Status:** Accepted

**Context**
Advanced alignment strategies are harder to trust without visibility on which
phase produced links (anchor, position fallback, similarity).

**Decision**
- Add optional flag `debug_align` (default `false`) to:
  - CLI `align`
  - sidecar `POST /align`
  - sidecar align jobs (`POST /jobs/enqueue`, kind `align`)
- When enabled, each report may include `debug` payload with:
  - strategy id
  - per-phase link source counts
  - optional sample links
  - similarity stats where relevant (min/max/mean)
- Keep default responses unchanged when `debug_align=false`.

**Consequences**
- Backward compatibility is preserved.
- Tauri prep can surface diagnostics on-demand without additional queries.
- Explainability UI is now available in `tauri-prep` Actions (dedicated panel + JSON copy);
  export/report integration remains backlog.

---

## ADR-029 — Segmentation quality benchmark protocol (FR/EN fixtures)

**Date:** 2026-03-01
**Status:** Accepted

**Context**
`pack` support (`auto/default/fr_strict/en_strict`) was available, but quality
evaluation stayed manual and non-repeatable. We needed a lightweight, deterministic
way to compare packs and detect regressions.

**Decision**
- Add a small FR/EN fixture dataset:
  - `bench/fixtures/segmentation_quality_cases.json`
- Add a benchmark script:
  - `scripts/bench_segmentation_quality.py`
  - computes:
    - sentence exact-match rate
    - boundary precision / recall / F1
  - writes:
    - JSON artifact in `bench/results/`
    - Markdown summary in `docs/SEGMENTATION_BENCHMARKS.md`
- Define abbreviation matching as case-insensitive in segmentation packs,
  so sentence-initial abbreviations (e.g. `Approx.` / `Etc.`) are treated
  consistently.

**Consequences**
- Segmentation quality can be tracked with reproducible metrics in CI/local runs.
- `auto` pack behavior becomes measurable against strict and default baselines.
- Future pack changes should update fixture coverage and benchmark summary.

---

## ADR-030 — Align explainability must be linked to persisted runs

**Date:** 2026-03-01
**Status:** Accepted

**Context**
Explainability payloads (`debug_align`) were available in align responses, but
tracking/exporting them was fragile because sidecar align operations were not
consistently persisted in the `runs` table.

**Decision**
- `POST /align` now always returns `run_id` and persists an `align` run:
  - `params_json` includes strategy/pivot/targets/debug flag
  - `stats_json` includes `total_links_created` and full `pairs` reports
- Async align jobs (`POST /jobs/enqueue`, kind `align`) now return `run_id` and
  persist the same run stats.
- `tauri-prep` Actions explainability payload now carries the `run_id`.
- `tauri-prep` Exports run-report workflow supports optional `run_id` filter.

**Consequences**
- Explainability traces are exportable and reproducible via run history.
- Existing clients remain compatible (new fields are additive).
- Auditing/debug workflows can reference one stable identifier (`run_id`) end-to-end.

---

## ADR-031 — Document workflow status for Prep finalization

**Date:** 2026-03-03
**Status:** Accepted

**Context**
The Prep UX now distinguishes clearly between:
- document-local completion (`Valider ce document`)
- optional batch actions.

Without a persisted document workflow state, this decision remains purely visual
and cannot drive navigation, filtering, or downstream automation reliably.

**Decision**
- Add persistent workflow fields on `documents`:
  - `workflow_status` (`draft` | `review` | `validated`, default `draft`)
  - `validated_at` (nullable timestamp)
  - `validated_run_id` (nullable run reference string)
- Expose these fields in `GET /documents`.
- Extend `POST /documents/update` and `POST /documents/bulk_update` to support
  `workflow_status`.
- Validation metadata behavior:
  - setting `workflow_status="validated"` auto-fills `validated_at` if missing
  - switching to `draft` or `review` clears `validated_at` and `validated_run_id`

**Consequences**
- Prep can implement deterministic post-validation routing (e.g. return to
  `Documents`) with a stable persisted state.
- Existing clients stay compatible (additive fields and optional inputs).
- Batch and per-document workflows become auditable and queryable.

---

## ADR-032 — Deep-link contract between `tauri-prep` and AGRAFES apps

**Date:** 2026-03-03  
**Status:** Accepted

**Context**
The Prep -> Concordancier handoff depended on manual copy/paste of DB paths, which
added friction and frequent user errors. After introducing `tauri-shell` as the
primary app, the handoff target needed to be shell-first.

**Decision**
- Define a stable handoff URI contract:
  - shell-first URI: `agrafes-shell://open-db?mode=explorer&path=<absolute_db_path>`
  - accepted aliases on consumer side: `path` (preferred), `db` / `open_db` (compat)
- In `tauri-prep`, add topbar action `↗ Shell`:
  - build URI from current DB path
  - attempt immediate open
  - keep copy/manual fallback behavior
- In `tauri-shell`, integrate `tauri-plugin-deep-link`:
  - process startup payload via `getCurrent()`
  - process runtime payloads via `onOpenUrl(...)`
  - switch DB only for valid SQLite path candidates (`.db`, `.sqlite`, `.sqlite3`)
  - ignore invalid/unexpected payloads safely
- Keep standalone `tauri-app` deep-link intake (`agrafes://open-db`) for compatibility.

**Consequences**
- Prep can hand off directly into the primary unified app (`tauri-shell`) without
  forcing users through manual DB selection.
- User workflow friction is reduced while preserving manual fallback and standalone
  compatibility.
- Contract remains additive and does not affect CLI/sidecar JSON behavior.

---

## ADR-033 — DB backup safety checkpoint in Prep Documents tab

**Date:** 2026-03-06
**Status:** Accepted

**Context**
Metadata edits in `tauri-prep` (single/bulk + workflow status) need a visible
safety checkpoint before large write operations.

**Decision**
- Add sidecar endpoint `POST /db/backup` (token required).
- Endpoint creates a timestamped backup file in `.db.bak` format:
  - default target directory = current DB directory;
  - optional `out_dir` override accepted.
- In `tauri-prep` Documents tab, expose `Sauvegarder la DB` and show:
  - latest backup status text,
  - full backup path in the log panel.

**Consequences**
- Backup generation is centralized in backend (consistent behavior across
  Tauri wrappers).
- Users get an explicit recovery checkpoint before metadata batch work.
- Change is additive and does not alter CLI/sidecar JSON envelope contract.

---

## ADR-034 — Readable text exports in async job pipeline (TXT/DOCX)

**Date:** 2026-03-07
**Status:** Accepted

**Context**
The unified Export V2 flow in `tauri-prep` exposed “Texte lisible” as pending,
which blocked a common user expectation: exporting reviewed/segmented content in
editable formats.

**Decision**
- Add async job kind `export_readable_text` to sidecar `/jobs/enqueue`.
- Support output formats:
  - `txt` (UTF-8)
  - `docx` (via `python-docx`, already a project dependency)
- Export scope:
  - `doc_ids` optional (`None` => all documents)
  - default source field: `text_norm` (stable post-curation/segmentation view)
  - optional flags: `include_structure`, `include_external_id`, `source_field`
- Apply strict enqueue-time validation for this job:
  - `format` must be `txt|docx`
  - `doc_ids` must be an array of positive integers when provided
  - `source_field` must be `text_norm|text_raw`
  - optional flags must be booleans when provided
- Wire `tauri-prep` Export V2 card to this job for segmentation/curation flows
  (remove pending placeholder state for TXT/DOCX).

**Consequences**
- “Texte lisible” is now operational in runtime (not just a roadmap placeholder).
- Contract remains backward-compatible (additive job kind + optional params).
- No change to core JSON envelope policy (`ok/error`) for sidecar responses.

---

## ADR-035 — Alignment global recalculation keeps accepted links by default

**Date:** 2026-03-07
**Status:** Accepted

**Context**
During alignment review, users manually mark links as accepted/rejected. A full
re-run of alignment should refresh machine-generated links without destroying
already validated decisions.

**Decision**
- Extend `/align` (and async align job params) with optional flags:
  - `replace_existing` (default `false`)
  - `preserve_accepted` (default `true`)
- Behavior:
  - `replace_existing=false`: additive run (existing behavior).
  - `replace_existing=true` + `preserve_accepted=true`: delete non-accepted links,
    keep accepted links and protect them from overwrite in the new run.
  - `replace_existing=true` + `preserve_accepted=false`: full replacement.
- Return extra counters for transparency:
  - `deleted_before`, `preserved_before`, `total_effective_links`.

**Consequences**
- Prep UI can expose a clear “Recalcul global” action without breaking reviewed
  work by default.
- Contract change is backward-compatible (optional request fields, additive
  response fields).

---

## ADR-036 — Prep phase 5: explicit document scope + lightweight document preview

**Date:** 2026-03-08
**Status:** Accepted

**Context**
During Prep implementation, two recurring UX issues remained on non-technical flows:
- in `Exporter`, users could not always infer the effective document scope before launch;
- in `Documents`, users could edit metadata without a quick content excerpt to verify they selected the right document.

Additionally, some CI runs surfaced legacy DBs missing workflow columns (`workflow_status`), causing `/documents` and metadata updates to fail hard.

**Decision**
- Add read endpoint `GET /documents/preview?doc_id=<id>&limit=<1..20>`:
  - returns the first line units (`unit_id`, `n`, `external_id`, `text`) + `count/total_lines`.
  - no token required (read-only).
- In `tauri-prep`:
  - `Documents` screen displays a mini excerpt panel fed by this endpoint;
  - `Exports` V2 keeps document scope explicit with select-all/clear controls and blocks launch on empty scope;
  - `Import` uses user-facing mode labels and provides an explicit “apply lot defaults” action.
- Sidecar hardening:
  - auto-backfill missing document workflow columns before `/documents` read and metadata update operations.

**Consequences**
- Prep runtime becomes clearer for lambda users without changing core JSON envelopes.
- Contract remains backward-compatible (additive endpoint only).

---

## ADR-037 — Windows sidecar format override: onedir → onefile (Tauri externalBin constraint)

**Date:** 2026-04-09
**Status:** Decided

**Context**
ADR-025 selected `onedir` for Windows based on startup-latency and size benchmarks.
However, during PKG-3A (first real Windows NSIS build), it was discovered that
`tauri.conf.json` `bundle.externalBin` expects a **single file path** — not a directory.
A `onedir` build produces `multicorpus-x86_64-pc-windows-msvc/` (a directory with
`multicorpus.exe` inside plus dozens of DLLs), which Tauri cannot reference via
`externalBin`. Only a single `.exe` file is supported.

**Decision**
- Override Windows format to `onefile` for all Tauri Shell release and CI lanes.
- `tauri-shell-build.yml`, `release.yml`, `build-sidecar.yml` all use `onefile` for
  `windows-latest` matrix entries.
- `build.rs` in `tauri-shell/src-tauri/` adds the `.exe` suffix on Windows when copying
  the sidecar to the Tauri manifest root.
- The `bench/fixtures/sidecar_size_budget.json` Windows onefile limit is set to 20 MB.

**Benchmark note**
The onedir startup advantage (+73%) does not apply in Tauri Shell context because the
sidecar runs as a persistent subprocess (started once per session), not as a repeated
one-shot CLI invocation. The cold-start penalty of onefile is therefore acceptable.

**Consequences**
- Windows NSIS installer embeds a single `multicorpus.exe` (~15 MB compressed).
- Tauri `externalBin` works correctly on Windows.
- ADR-025 mapping updated: `windows` → `onefile` (Tauri Shell context).
- Non-Tauri benchmarks may still use `onedir` for latency measurement purposes.
- Legacy DB schemas are tolerated more gracefully, reducing runtime/CI fragility.

---

## ADR-038 — PyInstaller `-d noarchive` pour éviter les erreurs zlib (Python 3.13+)

**Date:** 2026-04-14
**Status:** Decided

**Context**
Avec PyInstaller 6.19+ et Python 3.13, le bytecode compressé dans l'archive PYZ
(archive interne au binaire onefile) provoque une erreur `"Error -3 while decompressing
data: incorrect header check"` à l'exécution des endpoints `/segment/preview` et
`/curate/preview`. Ces endpoints importent `segmenter.py` et `curation.py` depuis la PYZ
au moment de l'appel. La décompression zlib échoue en raison d'un mismatch de header entre
le format attendu par CPython 3.13 et celui écrit par PyInstaller.

**Investigation**
Analyse binaire du bundle : PYZ vide (22 octets, 0 entrées) avec l'option noarchive.
Sans noarchive, les .pyc sont stockés compressés dans la PYZ — le décompresseur zlib
de CPython 3.13 rejette les headers produits par PyInstaller 6.x.

**Decision**
Ajouter `-d noarchive` à la commande PyInstaller dans `scripts/build_sidecar.py`.
Cette option stocke les `.pyc` directement dans le CArchive (archive externe du bootloader)
sans passer par la compression PYZ, contournant entièrement la décompression zlib
par module. Le champ `pyinstaller_noarchive: true` est ajouté au manifest JSON.

```python
# build_sidecar.py
pyinstaller_cmd.extend(["-d", "noarchive"])  # après --strip si applicable
```

**Conséquence sur la taille**
Légère augmentation de taille binaire (pas de compression inter-modules). Acceptable :
le budget CI de taille reste respecté.

**Consequences**
- `/segment/preview`, `/curate/preview` et tout endpoint lazily-importé fonctionnent
  correctement dans le binaire onefile sur macOS, Linux et Windows.
- Binaire ~5–10 % plus grand qu'avec PYZ compressé.
- À surveiller lors de mises à jour PyInstaller futures (le flag est un sous-mode de debug,
  potentiellement amené à changer de nom).

---

## ADR-039 — Update check in-app via GitHub Releases API (sans auto-install)

**Date:** 2026-04-14
**Status:** Decided

**Context**
`tauri-plugin-updater` (Tauri 2) exige des binaires **signés** avec une paire de clés
pour la vérification d'intégrité des téléchargements. Les secrets de signing GitHub
Actions ne sont pas encore configurés, et l'app macOS est distribuée sans notarisation
(décision utilisateur). Un auto-install nécessiterait également un endpoint JSON hébergé
et mis à jour à chaque release.

**Decision**
Implémenter une vérification légère sans auto-install :
1. Bouton "Vérifier les mises à jour…" dans le menu support (⚙) de `shell.ts`.
2. Appel `fetch_github_latest_release(owner, repo)` — commande Rust dans `main.rs`
   utilisant `reqwest` (déjà dépendance). Nécessaire car le CSP WebView restreint
   les `fetch()` natifs aux URL autorisées dans `capabilities/default.json`.
3. Comparaison semver locale (major.minor.patch). Modal en 4 états :
   checking / à jour / nouvelle version (avec notes de release) / erreur réseau.
4. Si mise à jour disponible : bouton "Télécharger vX.X.X" ouvre la page GitHub
   Release dans le navigateur natif via `@tauri-apps/plugin-shell`.

**Raison du rejet de `tauri-plugin-updater`**
- Requiert signing (non configuré).
- Sur macOS sans notarisation, Gatekeeper bloquerait de toute façon les binaires téléchargés.
- Complexité infrastructure (endpoint JSON versionné, secrets CI) disproportionnée
  par rapport au besoin actuel.

**Consequences**
- Aucune mise à jour automatique : l'utilisateur télécharge manuellement depuis GitHub.
- Aucune dépendance CI supplémentaire.
- Path vers `tauri-plugin-updater` reste ouvert : il suffira de configurer les secrets
  de signing et un endpoint JSON pour migrer.
