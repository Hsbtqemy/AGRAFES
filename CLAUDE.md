# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

AGRAFES is a monorepo for a multilingual corpus tool (import → index → query → align → curate → export). It has two layers:

- **`src/multicorpus_engine/`** — a UI-independent Python core engine, exposed two ways:
  - a **CLI** (`multicorpus`, entry `multicorpus_engine.cli:main`) that emits **exactly one JSON object per command** on stdout (exit `0` ok / `1` error);
  - a **persistent HTTP sidecar** (`multicorpus serve`) that the desktop apps talk to.
- **`tauri-*/`** — four TypeScript/Vite/Tauri front-ends (see *Front-ends* below).

The database is **strictly local SQLite** (FTS-backed). The engine never depends on a UI; the CLI must keep working even when the sidecar isn't used.

## Common commands

### Python engine

```bash
pip install -e ".[dev]"          # editable install + dev deps (pytest, ruff)
pytest tests/test_foo.py::test_bar   # run a single test
pytest -k "import and not sidecar"   # run a subset by keyword
ruff check src tests             # lint — must cover BOTH src and tests (CI scope)
```

- `pythonpath=["src"]` is set in `pyproject.toml`, so plain `pytest` works without `PYTHONPATH=src`.
- **Do not run the full `tests/` suite locally.** The `test_sidecar_*` tests spawn a real sidecar subprocess that does not start reliably outside CI and appears to hang. Target with `-k`/explicit paths locally; let CI run the full suite.
- **Replicate the CI gate before committing**: `ruff check src tests` (not just `src`) + the relevant pytest scope. A narrower scope has missed CI failures before.

### Front-ends (per package: `tauri-prep`, `tauri-app`, `tauri-shell`, `tauri-fixture`)

```bash
npm --prefix tauri-prep ci        # install
npm --prefix tauri-prep run build # tsc + vite build
npm --prefix tauri-prep test      # vitest run
npm --prefix tauri-prep run dev   # vite dev server
```

`tauri-shell` imports `tauri-prep` and `tauri-app` **at source level**, so building/testing the shell requires `npm ci` in all three first (their versions are coupled — see *Front-ends*).

### Sidecar binary (PyInstaller)

```bash
pip install -e ".[packaging]"
python scripts/build_sidecar.py --preset tauri --format onefile   # canonical app
python scripts/build_sidecar.py --preset shell                     # shell app
python scripts/build_sidecar.py --preset fixture                  # e2e fixture
python scripts/smoke_sidecar.py <out>/sidecar-manifest.json        # serve + /health smoke
```

## CI (`.github/workflows/ci.yml`) — what must pass

1. **Ruff** — `ruff check src tests` (rule set is conservative: `E4/E7/E9/F`, see `[tool.ruff]`).
2. **Pytest + coverage** — `--cov-fail-under=60` (the `35` in `pyproject.toml` is a stale comment; the gate is 60 in CI).
3. **Contract freeze** — `docs/openapi.json` and `tests/snapshots/openapi_paths.json` must match the spec generated from `sidecar_contract.py`. Endpoints can never be *removed*; *adding* one fails CI until you regenerate (see below).
4. **TS builds + vitest** for `tauri-prep`, `tauri-app`, `tauri-shell`.
5. **Sidecar binary** builds on Linux and answers `--help` + smoke.
6. **Sidecar growth gate** (`.github/workflows/sidecar-growth-gate.yml`) — fires on any PR touching `sidecar.py`. Blocks the PR if **net growth (`add − del`) of `sidecar.py` exceeds 500 lines over a rolling 90-day window**. New features that grow `sidecar.py` past the threshold require splitting the file by domain first. Emergency override only for critical security fixes via a `Sidecar-Growth-Override:` trailer in the PR's head commit. **This directly constrains WebDAV Phase 2** — keep the new handlers thin (logic in `services/`/`remote/`) so they add few net lines.

## Architecture

### Engine core (`src/multicorpus_engine/`)

- **Data model.** Imported documents become `documents` (with `source_hash` for dedup, `source_path` for provenance) and `units` rows. A unit is `unit_type="line"` (indexed in FTS, may carry an `external_id` for alignment) or `unit_type="structure"` (preserved, not indexed). Text is stored as `text_raw` (verbatim) and `text_norm` (normalized for search). These conventions are ADRs — **`docs/DECISIONS.md` is the source of truth** for separator/normalization/alignment rules; read it before touching import or normalization.
- **Importers** live in `importers/`; the `mode → importer` mapping is centralized in **`importers/dispatch.py` (`dispatch_import`)** — the single dispatch point shared by CLI `import`, CLI `import-remote`, and the sidecar. Do not reintroduce per-call-site dispatch copies.
- **Runs.** Every import/index/mutation creates a run; logs go to `<db_dir>/runs/<run_id>/run.log`. One file → one run.
- **Schema.** The authoritative schema is the numbered SQL files in **`migrations/` (root)** (`001_initial_schema.sql`, `002_fts5_index.sql`, …); `db/connection.py` + `db/migrations.py` apply them. Add a new numbered file rather than editing an applied one.

### Sidecar (`sidecar.py` + `services/` + `sidecar_jobs.py` + `sidecar_contract.py`)

- Two integration modes (`docs/INTEGRATION_TAURI.md`): **Mode A** = Tauri spawns the CLI and parses stdout JSON (fallback, always available); **Mode B** = persistent HTTP sidecar on loopback (recommended UX). A `.agrafes_sidecar.json` portfile next to the DB holds host/port/pid/token; write endpoints require the `X-Agrafes-Token` header when started with `--token auto`.
- `sidecar.py` (~8.5k lines) is an `http.server` handler class. `do_POST` has an **explicit allowlist of write paths** (`_write_paths`) — new POST routes must be added there; writes go through `with self._lock()`.
- **Domain logic is being extracted into `services/<dom>_service.py`** (audit A-01): pure functions `(conn, …)` that raise typed errors from `services/errors.py` (`ValidationError`/`NotFoundError`/`ConflictError`/`BadRequestError`); the handler becomes a thin adapter that owns the write-lock and maps each typed error to the endpoint's **historical** wire code. Responses must stay byte-identical (the contract freeze enforces this). **A-01 is intentionally parked** — 7 services are extracted (import, conventions, doc_relations, documents, curate, units, tokens); the rest (delegators + stateful/coupled handlers) are deliberately left. See `docs/AUDIT_FOLLOW_UP.md`. Follow the established service/adapter protocol when adding new endpoint logic.
- Async/long-running work uses **`JobManager`** (`sidecar_jobs.py`) with per-stage progress events.

### Adding or changing a sidecar endpoint

1. Implement domain logic in `services/` (pure, typed errors) and a thin adapter handler in `sidecar.py`; register the route, and add it to `_write_paths` if it mutates.
2. Update `sidecar_contract.py`, then run `python scripts/export_openapi.py` and **commit the regenerated `docs/openapi.json` + `tests/snapshots/openapi_paths.json`** — otherwise the contract-freeze CI job fails.
3. Add a read-only GET to `scripts/smoke_sidecar.py` coverage where applicable; service test locally (with a `db_conn`), HTTP test runs in CI.

### Front-ends (`tauri-*`)

- **`tauri-prep`** — the *préparation* app ("Constituer"): import, segmentation/roles, curation, alignment, metadata, annotation, exports (`src/screens/`). Talks to the engine via `src/lib/sidecarClient.ts`.
- **`tauri-app`** — the *concordancier* (search/Explorer): query/KWIC UI (`src/features/`).
- **`tauri-shell`** — the **unified desktop app shipped to users**: a single webview that embeds prep + app as modules (`src/modules/constituerModule.ts`, `explorerModule.ts`, `rechercheModule.ts`) plus the Python sidecar in one signed/notarized binary. Because it imports prep and app at source level, **their versions are coupled and a JS fault in one can take down the whole webview** (see `HANDOFF_SHELL.md`).
- **`tauri-fixture`** — minimal harness used by the sidecar e2e workflow.
- **`tauri/`** — holds `src-tauri/binaries/`, the canonical output dir for the packaged sidecar.

### Front-end conventions (enforced by review, see `CONTRIBUTING.md`)

- **No native dialogs.** Never use `window.confirm()`/`alert()`/`prompt()` — unreliable on Tauri 2. Use `tauri-prep/src/lib/modalConfirm.ts` (centered modal) or `inlineConfirm.ts` (inline strip).
- **CSS namespacing is mandatory**: `prep-*`, `app-*`, `shell-*`. No unprefixed class names — the shell bundles prep + app CSS into one webview, so unprefixed classes collide.
- `tauri-prep` lints with ESLint (`eslint.config.mjs`, includes `eslint-plugin-no-unsanitized`); use `lib/safeHtml.ts` rather than raw `innerHTML`.

## Commits & versioning

- **Conventional commits** with a component scope: `feat(prep):`, `fix(engine):`, `refactor(shell):`, `test(curation):`, `chore(release):`, `docs:`, `ci:`.
- **Never hand-edit version numbers.** Run `python scripts/bump_version.py --engine X.Y.Z --shell X.Y.Z`, which syncs `pyproject.toml`, `src/multicorpus_engine/__init__.py`, and the shell's `tauri.conf.json` / `shell.ts` / `package.json`. (Note: `tauri-prep`/`tauri-app` carry their own independent versions — the docs are not always consistent here.)
- Commit/push only when asked. Default PR branch is **`dev`** (some docs still say `development` — `dev` is what the repo uses).

## Project conventions & gotchas

- **`docs/DECISIONS.md`** (ADRs) and the audit docs (`docs/AUDIT_*.md`, `AUDIT_FOLLOW_UP.md`) are the authoritative design record. Design notes are frozen *before* a ticket is opened (e.g. `docs/DESIGN_sharedocs_ingestion.md`, the `TICKET_*` files).
- **No new runtime dependencies in the sidecar bundle** without cause — the engine deliberately stays near stdlib (`python-docx`, `defusedxml`, `regex` only). New network/IO features use `urllib` + `defusedxml`, not `httpx`/`webdav4`.
- **ShareDocs / WebDAV ingestion** (`remote/`, `docs/DESIGN_sharedocs_ingestion.md`): Phases 1-4 are merged to `dev` — CLI `import-remote` (P1), sidecar routes `POST /webdav/list` + `POST /import-remote` (P2), Prep UI screen (P3), and credential-keychain / root-prefill / multi-select cart / batch-undo (P4A-D). **Phase 5** (per-file format+language detection in ShareDocs, reusing the local Import screen's recognition via a shared `importDetect` module) is **designed, not built** — see `docs/DESIGN_sharedocs_ingestion.md` §11 + `docs/TICKET_SHAREDOCS_INGESTION_P5_DETECTION.md`. The DB is never shared over WebDAV — this is ingestion-only.
- **Curation regex**: `curation.py` uses the PyPI `regex` package with `regex.V0` forced (not stdlib `re`) for Unicode classes (`\p{L}`, `\X`, POSIX). Before changing the accepted-pattern grammar or migrating, run `python scripts/validate_regex_migration.py <corpus.db>` (exit 1 = human audit required).
- **Git identity**: commit as `hsbtqemy <hugo.semilly@gmail.com>`. If `git config` is empty, restore it before committing rather than letting git derive a name from the OS account.
- For deeper background read `CONTRIBUTING.md`, `HANDOFF_SHELL.md`/`HANDOFF_PREP.md` (front-end briefings), and `docs/SIDECAR_API_CONTRACT.md`.
