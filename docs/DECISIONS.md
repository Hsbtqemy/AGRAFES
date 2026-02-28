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
- Advanced auth (scoped tokens, rotation, ACL) remains explicit backlog.

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
**Status:** Pending

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
- Keep default build format as `onefile` for compatibility with existing CI and
  Tauri fixture flow until multi-OS benchmark data is collected.
- Revisit and finalize after benchmark results are gathered on macOS/Windows/Linux.

**Consequences**
- We can make a data-driven default-format decision instead of intuition.
- Current integration remains stable while comparative evidence is collected.
- Current benchmark summary is tracked in `docs/BENCHMARKS.md`.
- As of 2026-02-28, dataset is still incomplete (missing Linux/Windows matrix
  measurements), so ADR remains Pending per policy.
