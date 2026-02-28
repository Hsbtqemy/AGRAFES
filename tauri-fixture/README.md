# AGRAFES Tauri Fixture (E2E, no UI)

This fixture is a minimal Tauri v2 shell used to validate sidecar invocation
and JSON contract parsing end-to-end, without implementing a UI.

## What is validated

- Sidecar binary discovery in `src-tauri/binaries/`
- Persistent sidecar startup (`serve --port 0`) and startup JSON parsing
- Portfile token discovery and auth header injection for write endpoints
- HTTP flow: `/health`, `/import`, `/index`, `/query`, `/shutdown`
- JSON contract parsing (single JSON object responses)
- Exit-code convention (`0` for success, `1` for controlled errors)
- stderr is expected to stay empty for the tested commands

## Local run (no GUI required)

From repository root:

```bash
pip install -e ".[packaging]"
python scripts/build_sidecar.py --preset fixture --format onefile
node tauri-fixture/scripts/fixture_smoke.mjs
```

The smoke script prints a JSON summary and exits with `0` on success.

Optional scenario override:

```bash
FIXTURE_SCENARIO=oneshot node tauri-fixture/scripts/fixture_smoke.mjs
FIXTURE_SCENARIO=both node tauri-fixture/scripts/fixture_smoke.mjs
```

## Tauri scaffold notes

- Tauri config: `tauri-fixture/src-tauri/tauri.conf.json`
- Sidecar declaration: `bundle.externalBin = ["binaries/multicorpus"]`
- Shell plugin capability: `tauri-fixture/src-tauri/capabilities/default.json`
- Example plugin-shell sidecar call: `tauri-fixture/src/sidecar_runner.ts`
- Example plugin-shell persistent flow: `tauri-fixture/src/sidecar_persistent_runner.ts`

This fixture is intentionally headless for CI reliability.

Distribution/signing/notarization references:
- `docs/DISTRIBUTION.md`
