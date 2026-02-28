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
| **Projet** | Open or create a corpus DB, view sidecar status (port/PID), shutdown sidecar |
| **Import** | Multi-file import with mode/language/title per file, 2-concurrent batch, FTS rebuild |
| **Actions** | Curate (regex rules), Segment (per-doc), Align (pivot+targets, 3 strategies), Validate metadata |

## Workflow recommandé (Prep → Concordancier)

1. Préparer le corpus dans `tauri-prep` (import + index + align).
2. Dans l’écran **Projet**, cliquer **Copier le chemin de la DB**.
3. Ouvrir l’app `tauri-app` (Concordancier), puis cliquer **Open DB…**.
4. Coller le chemin copié (ou sélectionner le fichier `.db`) et lancer la recherche.

## Sidecar lifecycle

The app spawns `multicorpus serve --db <path> --port 0 --token auto` on first DB open.
The portfile `.agrafes_sidecar.json` is created in the DB directory.
Switching DB shuts down the previous sidecar and spawns a new one.

## Charter

See [docs/CHARTER_TAURI_PREP_AGENT.md](../docs/CHARTER_TAURI_PREP_AGENT.md) for anti-drift rules.

## Status

See [docs/STATUS_TAURI_PREP.md](../docs/STATUS_TAURI_PREP.md) for incremental progress.
