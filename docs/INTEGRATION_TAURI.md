# Integration Guide — Tauri + multicorpus_engine

Last updated: 2026-02-28 (persistent sidecar restart/token hardening)

## Integration modes

- **Mode A (fallback): CLI spawn**
  - Stable and always available.
  - Tauri starts `multicorpus ...` and parses stdout JSON.
- **Mode B (recommended UX): persistent sidecar HTTP**
  - Start once, then multiple HTTP requests without repeated process cold-start.
  - Contract described in `docs/SIDECAR_API_CONTRACT.md`.

CLI usage must remain functional even when sidecar is not used.

## Sidecar binary packaging (Tauri external binaries)

This repository now provides a packaging path for shipping the Python CLI as a
Tauri sidecar binary using PyInstaller (`onefile` mode).

- Build entrypoint: `scripts/sidecar_entry.py`
- Builder script: `scripts/build_sidecar.py`
- Canonical app directory: `tauri/src-tauri/binaries/`
- Fixture directory: `tauri-fixture/src-tauri/binaries/`
- Manifest: `<out>/sidecar-manifest.json`
- Build formats:
  - `--format onefile` (default)
  - `--format onedir` (benchmark/decision track)

Naming convention for produced binaries:

- macOS/Linux: `multicorpus-<target_triple>`
- Windows: `multicorpus-<target_triple>.exe`

`<target_triple>` detection strategy:

1. `rustc --print host-tuple` when `rustc` is available.
2. deterministic OS/arch fallback map from `scripts/build_sidecar.py`.

Example local build:

```bash
pip install -e ".[packaging]"
python scripts/build_sidecar.py --preset tauri --format onefile
python scripts/build_sidecar.py --preset fixture --format onefile
```

## CI artifacts (Windows/Linux/macOS)

Workflow: `.github/workflows/build-sidecar.yml`

- Triggers:
  - manual (`workflow_dispatch`)
  - pushed tags matching `v*`
- Matrix runners: `macos-latest`, `ubuntu-latest`, `windows-latest`
- Uploaded artifact names:
  - `sidecar-macos-latest`
  - `sidecar-ubuntu-latest`
  - `sidecar-windows-latest`

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
- `align --db ... --pivot-doc-id ... --target-doc-id ... [--strategy external_id|position|similarity]`
- `export --db ... --format tei|csv|tsv|jsonl|html --output ...`
- `validate-meta --db ...`
- `curate --db ... --rules rules.json [--doc-id ...]`
- `segment --db ... --doc-id ... [--lang ...]`
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
- Final operational rollout remains pending:
  - provisioning production signing credentials and notarization keys
  - validating manylinux compatibility floor beyond CI baseline
  - finalizing onefile vs onedir default from multi-OS benchmark data

Distribution workflows and secrets are documented in:
- `docs/DISTRIBUTION.md`
- Benchmark summary and format decision inputs:
  - `docs/BENCHMARKS.md`
  - `.github/workflows/bench-sidecar.yml`

## Sidecar API (optional)

When enabled via `multicorpus serve`:
- `GET /health`
- `GET /openapi.json`
- `POST /query`
- `POST /index`
- `POST /import`
- `POST /shutdown`
- `POST /curate`
- `POST /validate-meta`
- `POST /segment`
- `GET /jobs`
- `POST /jobs`
- `GET /jobs/{job_id}`

Payload envelope, error codes, and OpenAPI details are defined in:
- `docs/SIDECAR_API_CONTRACT.md`

Token note:
- With `--token auto` (default), send `X-Agrafes-Token` for `/import`, `/index`, `/shutdown`.
- `multicorpus status --db ...` can be used by wrappers to detect `running|stale|missing`.

## Run logs

CLI commands persist run logs in:

```text
<db_directory>/runs/<run_id>/run.log
```

Use these logs for diagnostics; keep stdout reserved for machine parsing.
