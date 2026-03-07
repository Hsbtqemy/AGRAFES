# Concordancier Prep — AGRAFES

Tauri v2 desktop app for corpus preparation: import → curate → segment → align.
Communicates with `multicorpus_engine` exclusively via the sidecar HTTP API.

## Prerequisites

| Tool | Version |
|------|---------|
| Python | ≥ 3.10 |
| Node.js | ≥ 20 LTS |
| Rust + Cargo | stable |
| Tauri CLI | v2 (installed via npm) |
| multicorpus_engine | installed as package (pip) |

## Development setup (macOS)

```bash
# 1. Install Python package + dev dependencies
pip install -e ".[dev]"

# 2. Build and place sidecar binary
bash tauri-prep/scripts/prepare_sidecar.sh

# 3. Install JS dependencies
cd tauri-prep
npm install

# 4. Launch in dev mode
npm run tauri dev
```

The app opens at `http://localhost:1421`.

## Development setup (Windows)

```powershell
pip install -e ".[dev]"
pwsh tauri-prep/scripts/prepare_sidecar.ps1
cd tauri-prep
npm install
npm run tauri dev
```

## Production build

```bash
cd tauri-prep
npm run tauri build
```

Bundles are in `tauri-prep/src-tauri/target/release/bundle/`.

## Screens

| Screen | Purpose |
|--------|---------|
| **Topbar DB** | Open/create corpus DB, presets, handoff to AGRAFES Shell |
| **Import** | Multi-file import with mode/language/title per file, 2-concurrent batch, FTS rebuild |
| **Actions** | Curate (regex rules), Segment (per-doc + pack `auto/default/fr_strict/en_strict`), Align (pivot+targets, 4 strategies incl. `external_id_then_position` + optional debug explainability), Validate metadata |
| **Documents** | Edit metadata + workflow status (`draft/review/validated`) |
| **Exporter** | TEI / CSV / run-report exports |

## Workflow recommandé (Prep → Shell)

1. Préparer le corpus dans `tauri-prep` (import + index + align).
2. Dans la topbar, cliquer **↗ Shell** (deep-link `agrafes-shell://open-db?mode=explorer&path=...`).
3. Si le deep-link n’est pas pris en charge sur la machine, ouvrir `tauri-shell` puis choisir la DB via le menu DB.
4. Ouvrir la même DB `.db` dans l’onglet Explorer et lancer la recherche.

Règles UX de navigation/fin de flux (Prep): voir [docs/UX_FLOW_PREP.md](../docs/UX_FLOW_PREP.md).

## Sidecar lifecycle

The app spawns `multicorpus serve --db <path> --port 0 --token auto` on first DB open.
The portfile `.agrafes_sidecar.json` is created in the DB directory.
Switching DB shuts down the previous sidecar and spawns a new one.

## Charter

See [docs/CHARTER_TAURI_PREP_AGENT.md](../docs/CHARTER_TAURI_PREP_AGENT.md) for anti-drift rules.

## Status

See [docs/STATUS_TAURI_PREP.md](../docs/STATUS_TAURI_PREP.md) for incremental progress.
