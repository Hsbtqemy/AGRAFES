# Tauri Wrapper Scaffold (No UI in this repo)

This directory hosts Tauri-facing packaging artifacts for `multicorpus_engine`.
No frontend/UI is implemented here in this iteration.

## Binaries location

Tauri sidecar binaries are generated into:

`tauri/src-tauri/binaries/`

Expected naming convention:

- macOS/Linux: `multicorpus-<target_triple>`
- Windows: `multicorpus-<target_triple>.exe`

Examples:

- `multicorpus-aarch64-apple-darwin`
- `multicorpus-x86_64-unknown-linux-gnu`
- `multicorpus-x86_64-pc-windows-msvc.exe`

Naming reminder for Tauri `externalBin`:

- Config entry uses base path `binaries/multicorpus`
- Actual files on disk must be suffixed by target triple:
  - `multicorpus-<target_triple>`
  - `multicorpus-<target_triple>.exe` on Windows

## Tauri v2 config snippets (copy/paste)

`src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "bundle": {
    "externalBin": ["binaries/multicorpus"]
  }
}
```

`src-tauri/capabilities/default.json` (plugin shell sidecar permission):

```json
{
  "identifier": "default",
  "description": "Allow sidecar execution for multicorpus binary",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "binaries/multicorpus",
          "sidecar": true
        }
      ]
    }
  ]
}
```

App-side invocation with `@tauri-apps/plugin-shell` (`sidecar: true` path):

```ts
import { Command } from "@tauri-apps/plugin-shell";

// Command.sidecar(...) is the sidecar=true path in plugin-shell.
const cmd = Command.sidecar("binaries/multicorpus", [
  "init-project",
  "--db",
  "/tmp/agrafes_fixture.db"
]);
const result = await cmd.execute();
const payload = JSON.parse(result.stdout);
```

Persistent sidecar launch pattern (`serve --port 0`):

```ts
import { Command } from "@tauri-apps/plugin-shell";

const command = Command.sidecar("binaries/multicorpus", [
  "serve",
  "--db",
  "/tmp/agrafes.db",
  "--host",
  "127.0.0.1",
  "--port",
  "0",
  "--token",
  "auto"
]);
const child = await command.spawn();

// Parse first stdout JSON object to get host/port/portfile.
// If portfile contains token, send header:
//   X-Agrafes-Token: <token>
// for write endpoints (/import, /index, /shutdown).
```

## Build locally

From repository root:

```bash
pip install -e ".[packaging]"
python scripts/build_sidecar.py --preset tauri --format onefile
# optional benchmark track:
python scripts/build_sidecar.py --preset tauri --format onedir
```

Distribution/signing/notarization references:
- `docs/DISTRIBUTION.md`

## Manual smoke test (local)

After build, run:

```bash
TARGET_TRIPLE="$(python -c 'import json;print(json.load(open(\"tauri/src-tauri/binaries/sidecar-manifest.json\", encoding=\"utf-8\"))[\"target_triple\"])')"
./tauri/src-tauri/binaries/multicorpus-"${TARGET_TRIPLE}" --help
```

The help command should exit with `0`.
