# Integration Guide — Tauri + multicorpus_engine

Last updated: 2026-03-08 (Prep phase 5 UX refinements)

## Integration modes

- **Mode A (fallback): CLI spawn**
  - Stable and always available.
  - Tauri starts `multicorpus ...` and parses stdout JSON.
- **Mode B (recommended UX): persistent sidecar HTTP**
  - Start once, then multiple HTTP requests without repeated process cold-start.
  - Contract described in `docs/SIDECAR_API_CONTRACT.md`.

CLI usage must remain functional even when sidecar is not used.

## Sidecar binary packaging (Tauri external binaries)

This repository provides a packaging path for shipping the Python CLI as a
Tauri sidecar binary using PyInstaller (`onefile` and `onedir`).

- Build entrypoint: `scripts/sidecar_entry.py`
- Builder script: `scripts/build_sidecar.py`
- Canonical app directory: `tauri/src-tauri/binaries/`
- Fixture directory: `tauri-fixture/src-tauri/binaries/`
- Manifest: `<out>/sidecar-manifest.json`
- Build formats:
  - `--format onefile`
  - `--format onedir`
- Default format mapping when `--format` is omitted (ADR-025, `per_os`):
  - macOS (`darwin`): `onefile`
  - Linux (`linux`): `onedir`
  - Windows (`windows`): `onedir`

Naming convention for produced binaries:

- macOS/Linux: `multicorpus-<target_triple>`
- Windows: `multicorpus-<target_triple>.exe`

`<target_triple>` detection strategy:

1. `rustc --print host-tuple` when `rustc` is available.
2. deterministic OS/arch fallback map from `scripts/build_sidecar.py`.

Example local build:

```bash
pip install -e ".[packaging]"
python scripts/build_sidecar.py --preset tauri
python scripts/build_sidecar.py --preset fixture
```

Layout impact by format:
- `onefile`: one executable `multicorpus-<target_triple>[.exe]`
- `onedir`: one directory `multicorpus-<target_triple>-onedir/` containing
  the executable `multicorpus-<target_triple>[.exe]`

## CI artifacts (Windows/Linux/macOS)

Workflow: `.github/workflows/build-sidecar.yml`

- Triggers:
  - manual (`workflow_dispatch`)
  - pushed tags matching `v*`
- Matrix runners: `macos-latest`, `ubuntu-latest`, `windows-latest`
- Explicit format mapping:
  - `macos-latest` -> `onefile`
  - `ubuntu-latest` -> `onedir`
  - `windows-latest` -> `onedir`
- Uploaded artifact names:
  - `sidecar-macos-latest-onefile`
  - `sidecar-ubuntu-latest-onedir`
  - `sidecar-windows-latest-onedir`

Each artifact contains:
- `multicorpus-<target_triple>[.exe]`
- `sidecar-manifest.json`

## Tauri E2E fixture (no UI)

Fixture location:
- `tauri-fixture/`

Goal:
- Validate sidecar discovery/execution and strict JSON parsing end-to-end.
- Keep the check headless for CI stability (no GUI dependency).

Primary smoke command:

```bash
node tauri-fixture/scripts/fixture_smoke.mjs
```

Smoke flow (persistent):
1. Locate sidecar binary in `tauri-fixture/src-tauri/binaries/`.
2. Spawn `serve --db ... --port 0` and parse startup JSON (`host/port/pid/portfile`).
3. Read token from `portfile` when present.
4. `GET /health`.
5. `POST /import` then `POST /index` with `X-Agrafes-Token` when token is active.
6. `POST /query`.
7. `POST /shutdown` with `X-Agrafes-Token` when token is active.

Parallel/aligned view (UI V0.1):
- UI can call `/query` with `include_aligned=true` to attach aligned units under each hit.
- Optional safety cap for payload fan-out: `aligned_limit` (sidecar default `20`).
- Recommended UX pattern:
  - one query request (no N-per-hit requests),
  - optional client-side hit render cap when aligned mode is active.

Pagination (UI V0.2, recommended):
- Send `limit` and `offset` in `/query` request body.
- Read `has_more` and `next_offset` from response to implement `Load more`.
- Default policy:
  - regular search: `limit=50`
  - aligned mode enabled: `limit=20`
- Keep one `/query` request per page (including aligned enrichment) to avoid N+1 HTTP calls.
- Current sidecar policy returns `total=null` (no global COUNT query by default).

CI workflow:
- `.github/workflows/tauri-e2e-fixture.yml`
- Builds sidecar artifacts per OS matrix, then runs fixture smoke per OS matrix.
- This is intentionally a CLI sidecar E2E check; full `tauri run` GUI execution may require GUI-capable runners.

## CLI contract (strict)

For each command invocation:
- stdout = **exactly one JSON object**.
- stderr = not part of the contract for machine parsing.
- exit code = `0` on success, `1` on error.
- parser failures (missing/invalid args, unknown subcommand) are included in the same JSON error contract.

### Success envelope

```json
{
  "status": "ok",
  "run_id": "uuid-if-applicable",
  "...": "command specific fields"
}
```

`status` may be:
- `ok`
- `warnings` (non-fatal validation outcomes)
- `listening` (for `serve` startup)

### Error envelope

```json
{
  "status": "error",
  "error": "human readable message",
  "run_id": "uuid-if-available",
  "created_at": "2026-02-28T12:00:00Z"
}
```

In current implementation, stderr stays empty for contract failures and should not be used by Tauri for control flow.

## Commands used by Tauri

- `init-project --db ...`
- `import --db ... --mode docx_numbered_lines|txt_numbered_lines|docx_paragraphs|tei ...`
- `index --db ...`
- `query --db ... --q ... --mode segment|kwic [--output path --output-format jsonl|csv|tsv|html]`
- `align --db ... --pivot-doc-id ... --target-doc-id ... [--strategy external_id|position|similarity|external_id_then_position] [--debug-align]`
- `export --db ... --format tei|csv|tsv|jsonl|html --output ...`
- `validate-meta --db ...`
- `curate --db ... --rules rules.json [--doc-id ...]`
- `segment --db ... --doc-id ... [--lang ...] [--pack auto|default|fr_strict|en_strict]`
- `serve --db ... [--host ... --port ... --token auto|off|<value>]`
- `status --db ...`
- `shutdown --db ...`

## How Tauri calls the sidecar (conceptual)

Tauri resolves the correct external binary by target triple and spawns it with
CLI arguments, then parses stdout as one JSON object.

Pseudo-flow:

1. Resolve binary name: `multicorpus-<target_triple>[.exe]`.
2. Spawn process with args (for example `query --db ... --q ... --mode segment`).
3. Read full stdout and parse JSON object.
4. Check exit code (`0` success, `1` error).
5. Do not rely on stderr for protocol decisions.

Minimal plugin-shell call pattern:

```ts
import { Command } from "@tauri-apps/plugin-shell";

const command = Command.sidecar("binaries/multicorpus", [
  "query",
  "--db",
  "/path/to/project.db",
  "--q",
  "needle",
  "--mode",
  "segment"
]);
const result = await command.execute();
const payload = JSON.parse(result.stdout);
```

Persistent flow (recommended):

```ts
import { Command } from "@tauri-apps/plugin-shell";

const serve = Command.sidecar("binaries/multicorpus", [
  "serve",
  "--db",
  "/path/to/project.db",
  "--host",
  "127.0.0.1",
  "--port",
  "0",
  "--token",
  "auto"
]);
const child = await serve.spawn();
// Parse first stdout JSON for host/port/portfile.
// Read token from portfile if present.
// Call /health, /query and token-protected write endpoints via fetch.
```

## Deep-link Prep -> Shell (`open-db`)

Recommended handoff now targets the unified app (`tauri-shell`):

- URI scheme: `agrafes-shell://open-db?mode=explorer&path=<absolute_db_path>`
- Query keys accepted by Shell parser: `path` (preferred), `db` / `open_db` (compat)
- Accepted file extensions: `.db`, `.sqlite`, `.sqlite3`

Example:

```text
agrafes-shell://open-db?mode=explorer&path=%2FUsers%2Fme%2Fcorpora%2Fmy_project.db
```

Implementation notes:

- `tauri-prep` topbar button `↗ Shell` builds this URI from current DB.
- `tauri-shell` uses `@tauri-apps/plugin-deep-link`:
  - startup resolution via `getCurrent()`
  - runtime events via `onOpenUrl(...)`
- additional startup fallback is accepted via URL params in shell:
  - `?open_db=/abs/path/to/corpus.db` (dev/manual scenarios)
- Invalid or non-DB payloads are ignored safely.
- Fallback remains manual DB selection in Shell.

## Sidecar hardening hooks

Benchmark helper script:
- `scripts/bench_sidecar_startup.py`

Current measured dimensions:
- startup time (`--help` and/or `init-project`) over N launches
- binary size in bytes/MB
- persistent time-to-ready (`spawn -> /health`) and repeated `/query` latency

Release hardening status:
- Distribution scripts/workflows now exist for macOS signing/notarization,
  Windows signing, and Linux manylinux builds.
- ADR-025 format decision is finalized (per OS).
- Final operational rollout remains pending:
  - provisioning production signing credentials and notarization keys
  - validating manylinux compatibility floor beyond CI baseline

Distribution workflows and secrets are documented in:
- `docs/DISTRIBUTION.md`
- Benchmark summary and format decision inputs:
  - `docs/BENCHMARKS.md`
  - `.github/workflows/bench-sidecar.yml`

## Sidecar API (optional)

When enabled via `multicorpus serve`:
- `GET /health`
- `GET /openapi.json`
- `GET /documents` — list all docs with unit_count
- `GET /documents/preview?doc_id=N&limit=M` — mini excerpt for Documents screen verification (no token)
- `POST /query`
- `POST /index` (full rebuild by default; accepts `{ "incremental": true }` for incremental sync)
- `POST /import`
- `POST /shutdown`
- `POST /curate`
- `POST /curate/preview` — dry-run preview, no write, no token required (V0.3)
- `POST /align` (`strategy`: `external_id|position|similarity|external_id_then_position`)
  - optional `debug_align: true` to get per-report explainability payload (`report.debug`)
  - response includes `run_id` (persisted in `runs`) and `total_links_created`
- `POST /align/audit` — paginated read-only link audit; optional status filter (V0.3/V0.4)
- `POST /align/link/update_status` — set link status accepted/rejected/null (token required, V0.4)
- `POST /align/link/delete` — permanently delete a link (token required, V0.4)
- `POST /align/link/retarget` — change target unit of a link (token required, V0.4)
- `GET /doc_relations?doc_id=N` — list doc-level relations (no token, V0.4)
- `POST /documents/update` — update one doc's metadata/workflow status (token required, V0.4+)
- `POST /documents/bulk_update` — bulk update docs metadata/workflow status (token required, V0.4+)
- `POST /doc_relations/set` — upsert a doc_relation (token required, V0.4)
- `POST /doc_relations/delete` — delete a doc_relation (token required, V0.4)
- `POST /export/tei` — export TEI XML to server-side dir (token required, V0.4)
- `POST /export/align_csv` — export alignment links as CSV/TSV (token required, V0.4)
- `POST /export/run_report` — export run history as JSONL or HTML (token required, V0.4)
- `POST /db/backup` — create timestamped backup `.db.bak` (token required)
- `POST /validate-meta`
- `POST /segment`
- `GET /jobs` — list jobs; supports `?status=`, `?limit=`, `?offset=`; returns pagination fields (V0.5)
- `POST /jobs`
- `GET /jobs/{job_id}`
- `POST /jobs/enqueue` — async job enqueue for long ops (token required, V0.5+); 12 kinds: index, curate, validate-meta, segment, import, align, export_tei, export_align_csv, export_run_report, export_tei_package, export_readable_text, qa_report
  - `kind=index` supports optional `params.incremental: boolean`
- `POST /jobs/{job_id}/cancel` — cancel queued/running job, idempotent for terminal states (token required, V0.5)

#### tauri-prep V0.3 usage

`tauri-prep` uses both V0.3 endpoints:
- `/curate/preview`: preset selector (Espaces, Apostrophes, Ponctuation, Personnalisé) → stats banner (units_changed/total, replacements) + before/after diff table with word-level highlighting.
- `/align/audit`: auto-loads after an alignment run; paginated table (ext_id, pivot text, target text); "Load more" for subsequent pages.

#### tauri-prep V0.4 usage

`tauri-prep` adds three new screens and extends the Actions audit panel:

**MetadataScreen** (`Métadonnées` tab):
- Fetches doc list via `GET /documents`; click doc to select.
- Edit panel: title, language, doc_role, resource_type (+ workflow fields when enabled) → `POST /documents/update`.
- Relations panel: lists relations (`GET /doc_relations`), add form → `POST /doc_relations/set`, delete button → `POST /doc_relations/delete`.
- Bulk edit bar: apply doc_role/resource_type/workflow_status to selected docs → `POST /documents/bulk_update`.
- Backup action: `Sauvegarder la DB` → `POST /db/backup` and displays the created backup filename/path in UI log/status.
- Validate button → `POST /validate-meta`; displays warnings in log pane.

Workflow status fields (additive):
- `workflow_status`: `draft | review | validated`
- `validated_at`: timestamp set by server when status becomes `validated`
- `validated_run_id`: optional run identifier for traceability

**ExportsScreen** (`Exports` tab):
- TEI export: multi-select docs + directory picker (`open({ directory: true })`) → `POST /export/tei`.
- Alignment CSV export: pivot/target selects + CSV or TSV format + file save dialog → `POST /export/align_csv`.
- Run report: JSONL or HTML format + file save dialog → `POST /export/run_report`.

**ActionsScreen audit panel extensions** (V0.4C):
- Status filter select: all / unreviewed / accepted / rejected — passed as `status` field in `/align/audit` request.
- Per-row action buttons: ✓ Accept → `POST /align/link/update_status`; ✗ Reject → same; 🗑 Delete → `POST /align/link/delete`.
- In-memory status update after each action (no re-fetch needed).

#### tauri-prep V0.5 usage — Job Center + async enqueue

All long-running operations now use `POST /jobs/enqueue` instead of the equivalent sync endpoint.
The `JobCenter` component polls `GET /jobs/{id}` every 500ms and displays:
- A progress bar strip (active jobs, percentage, message, "Annuler" button)
- A recent jobs list (last 5 finished: done ✓ / error ✗ / canceled ↩)
- A toast notification on completion or error (auto-fades after 3s)

**ImportScreen** — import + index rebuild:
- `POST /jobs/enqueue` `{kind: "import", params: {mode, path, language, title}}` per file
- `POST /jobs/enqueue` `{kind: "index"}` for index rebuild

**ActionsScreen** — curate, segment, align, validate-meta, index:
- `POST /jobs/enqueue` `{kind: "curate", params: {rules, doc_id?}}`
- `POST /jobs/enqueue` `{kind: "segment", params: {doc_id, lang, pack?}}`
- `POST /jobs/enqueue` `{kind: "align", params: {pivot_doc_id, target_doc_ids, strategy, sim_threshold?, debug_align?, replace_existing?, preserve_accepted?}}`
  - recommended fallback mode for prep workflows: `strategy="external_id_then_position"`
  - global recalculation mode: `replace_existing=true` (optionally keep user-approved links with `preserve_accepted=true`)
  - with `debug_align=true`, UI renders a dedicated explainability panel (sources, similarity stats, sample links)
    and allows copying diagnostic JSON for offline troubleshooting.
  - align job result now includes `run_id`, so explainability can be tied to a single persisted run.
- `POST /jobs/enqueue` `{kind: "validate-meta", params: {doc_id?}}`
- `POST /jobs/enqueue` `{kind: "index"}`

**ExportsScreen** — TEI, CSV, run report:
- `POST /jobs/enqueue` `{kind: "export_tei", params: {out_dir, doc_ids?}}`
- `POST /jobs/enqueue` `{kind: "export_align_csv", params: {out_path, pivot_doc_id?, target_doc_id?, delimiter?}}`
- `POST /jobs/enqueue` `{kind: "export_run_report", params: {out_path, format, run_id?}}`
- `POST /jobs/enqueue` `{kind: "export_readable_text", params: {out_dir, format: "txt"|"docx", doc_ids?}}`
  - `run_id` filter can export one specific align run/debug payload.

Cancel: `JobCenter` cancel button calls `POST /jobs/{job_id}/cancel` (token required).

Payload envelope, error codes, and OpenAPI details are defined in:
- `docs/SIDECAR_API_CONTRACT.md`
- `docs/openapi.json` (generated snapshot, 34 paths)

Token note:
- With `--token auto` (default), send `X-Agrafes-Token` for all write endpoints.
- Read endpoints (`/health`, `/query`, `/align/audit`, `/curate/preview`, `/doc_relations`, `/openapi.json`) do not require token.
- `POST /jobs/enqueue` and `POST /jobs/{id}/cancel` require token.
- `multicorpus status --db ...` can be used by wrappers to detect `running|stale|missing`.
- Rotate token by restarting sidecar on DB switch / stale recovery (recommended session cap: 8h).
- Full security posture and threat model: `docs/SIDECAR_SECURITY_POSTURE.md`.

### Wrapper supervision recommendations (resilience)

For desktop wrappers (Tauri shell / prep), use this control loop:

1. On app boot or DB switch, call `multicorpus status --db ...`.
2. If `state=running`, reuse existing endpoint.
3. If `state=stale|missing`, launch `serve --host 127.0.0.1 --port 0 --token auto`.
4. After spawn, wait for startup JSON then verify `GET /health`.
5. On first write `401`, refresh state/token once and retry once.
6. On `ECONNREFUSED`/timeout, run one bounded restart attempt (backoff 200-500 ms).
7. Never run two sidecars for the same DB path intentionally; treat `already_running` as success.
8. On app shutdown, prefer graceful `POST /shutdown`; if process was killed abruptly,
   stale detection/recovery on next launch is expected and supported.

This model is validated by sidecar recovery tests covering:
- stale portfile replacement,
- rapid relaunch loops,
- forced-kill recovery,
- stale unlink race tolerance.

## Run logs

CLI commands persist run logs in:

```text
<db_directory>/runs/<run_id>/run.log
```

Use these logs for diagnostics; keep stdout reserved for machine parsing.
