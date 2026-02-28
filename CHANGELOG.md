# Changelog — multicorpus_engine

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

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
