# PKG-3A - Windows build reel tauri-shell

Date: 2026-03-12  
Host: Windows x64 (local)  
Objectif: pipeline Windows reel (sidecar + NSIS) reproductible

---

## A. Sidecar Windows produit ou non

Oui, sidecar Windows x64 produit en local:

- Fichier: `tauri-shell/src-tauri/binaries/multicorpus-x86_64-pc-windows-msvc.exe`
- Taille: `15710345` bytes (`14.983 MB`)
- SHA256: `d769ff0a57b0e9c66fd553ae9c40466b3c5bff9d940d73524d661efa4ab3e96f`
- Date manifest UTC: `2026-03-12T08:56:50Z`
- Manifest: `tauri-shell/src-tauri/binaries/sidecar-manifest.json`

Mode de build exact:

```powershell
python -m pip install -e ".[packaging]"
python scripts/build_sidecar.py --preset shell --format onefile
```

Coherence `externalBin`:

- `tauri-shell/src-tauri/tauri.conf.json` contient `bundle.externalBin = ["multicorpus"]`
- Le nom attendu pour Windows est `multicorpus-x86_64-pc-windows-msvc.exe`
- Presence verifiee:
  - `tauri-shell/src-tauri/binaries/multicorpus-x86_64-pc-windows-msvc.exe`
  - `tauri-shell/src-tauri/multicorpus-x86_64-pc-windows-msvc.exe` (copie `build.rs` pour `tauri_build`)

---

## B. Config Windows appliquee

Config dediee creee:

- `tauri-shell/src-tauri/tauri.windows.conf.json`

Contenu applique:

- `bundle.targets = "nsis"`
- `bundle.windows.nsis.installMode = "perMachine"`
- `bundle.windows.webviewInstallMode.type = "offlineInstaller"`

Choix WebView2:

- Choix retenu: `offlineInstaller` (priorite robustesse utilisateur finale)
- Effet observe: build NSIS telecharge le runtime WebView2 offline pendant la generation
- Tradeoff: installeur plus lourd, mais installation plus robuste hors-ligne

---

## C. Fichiers modifies

### Fichiers modifies (tracked)

- `.github/workflows/tauri-shell-build.yml`
- `tauri-shell/package.json`
- `tauri-shell/scripts/prepare_sidecar.ps1`
- `tauri-shell/src-tauri/build.rs`

### Nouveaux fichiers (untracked)

- `scripts/build_tauri_shell_windows.ps1`
- `tauri-shell/src-tauri/tauri.windows.conf.json`

### Fichiers runtime/gitignored mis a jour

- `tauri-shell/src-tauri/binaries/multicorpus-x86_64-pc-windows-msvc.exe`
- `tauri-shell/src-tauri/binaries/sidecar-manifest.json`
- `tauri-shell/src-tauri/multicorpus-x86_64-pc-windows-msvc.exe`
- `tauri-shell/src-tauri/target/release/bundle/nsis/AGRAFESShell_0.1.0_x64-setup.exe`

---

## D. Build Windows reel produit ou blocage exact

Build Windows reel produit en local.

Commande de build appliquee:

```powershell
npm --prefix tauri-shell run tauri:build:windows
```

Commande encapsulee reproductible:

```powershell
.\scripts\build_tauri_shell_windows.ps1
```

Artefact NSIS reel:

- `tauri-shell/src-tauri/target/release/bundle/nsis/AGRAFESShell_0.1.0_x64-setup.exe`
- Taille: `214255050` bytes
- SHA256: `93245869d650666ff1728b58676d4ffda2c2815dccf75ea5534d2f197e1af8e2`
- MTime UTC: `2026-03-12T09:00:03Z`

Blocages rencontres puis resolus:

1. `build.rs` ne gerait pas le suffixe `.exe` Windows -> corrige.
2. Sidecar onefile compilait sans `multicorpus_engine` (module absent runtime) -> `pip install -e ".[packaging]"` rendu obligatoire avant build sidecar.
3. `tauri-shell` compile du code depuis `tauri-app`/`tauri-prep` -> installation npm des trois apps necessaire.

---

## E. Smoke test minimal

### 1) Installeur genere

- OK: `AGRAFESShell_0.1.0_x64-setup.exe` present.

### 2) App demarre

Verification:

- `APP_RUNNING:True`
- `MAIN_WINDOW_HANDLE:4655226`
- `MAIN_WINDOW_TITLE:AGRAFES Shell`

### 3) Shell s'ouvre

- OK: fenetre principale detectee (`MainWindowHandle > 0`, titre `AGRAFES Shell`).

### 4) Sidecar lance sans erreur critique immediate

Verification binaire sidecar (serve + `/health`):

- `SIDECAR_HEALTH: {"ok":true,...,"api_version":"1.4.6","version":"0.6.1",...}`
- `SIDECAR_STOP:CLEAN`

Observation au demarrage app:

- Le lancement sidecar depend de l'etat DB (persisted context / init DB).
- Sur un run, sidecars observes (`MULTICORPUS_AFTER:2`).
- Sur un run "froid", aucun sidecar auto (`SIDECAR_COUNT:0`) tant qu'aucune DB n'est initialisee.

Conclusion smoke:

- pipeline build/packaging Windows validee;
- app GUI validee;
- sidecar Windows valide en execution;
- auto-demarrage sidecar dans l'app conditionne par le contexte DB au boot.

---

## F. Strategie CI recommandee

Strategie stable recommandee:

1. Runner Windows natif pour build sidecar.
2. Runner Windows natif pour build Tauri NSIS.
3. Publication artefacts (`setup.exe` + `sidecar-manifest.json` + sidecar).

Ajustements appliques dans `.github/workflows/tauri-shell-build.yml`:

- matrice Windows passe a `sidecar_format: onefile`
- installation npm sur `tauri-app`, `tauri-prep`, `tauri-shell`
- build Windows dedie via `npm --prefix tauri-shell run tauri:build:windows`

Commande CI/locale unique recommandee:

```powershell
.\scripts\build_tauri_shell_windows.ps1
```

Dependances machine/CI necessaires:

- Windows x64 natif
- Python 3.11+ + pip
- `pip install -e ".[packaging]"` (PyInstaller inclus)
- Node 20 + npm
- Rust stable + toolchain MSVC
- Acces reseau pour:
  - `pip install`
  - `npm ci`
  - telechargement runtime WebView2 offline (mode `offlineInstaller`)

---

## G. Prochain pas

1. PKG-3B: macOS signing + notarization (app + sidecar) en pipeline dedie.
2. PKG-3C: Linux AppImage reel (runner Linux natif + sidecar Linux natif).

---

## Validation demandee

`git diff --name-only`:

```text
.github/workflows/tauri-shell-build.yml
tauri-shell/package.json
tauri-shell/scripts/prepare_sidecar.ps1
tauri-shell/src-tauri/build.rs
```

Local Windows build reel: OUI (pas theorique).
