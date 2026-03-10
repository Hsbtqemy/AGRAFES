# PKG-1 — Packaging Release tauri-shell (tri-plateforme)

**Date:** 2026-03-10
**Version cible:** 0.1.0
**App:** `tauri-shell/` — `com.agrafes.shell` / AGRAFESShell

---

## A. État actuel

### Configuration Tauri (post-PKG-1)

| Clé | Valeur |
|-----|--------|
| `identifier` | `com.agrafes.shell` |
| `productName` | `AGRAFESShell` |
| `version` | `0.1.0` |
| `bundle.targets` | `"all"` (all platforms build what's available on host OS) |
| `bundle.externalBin` | `["multicorpus"]` |
| `bundle.macOS.minimumSystemVersion` | `"11.0"` |
| `bundle.windows.nsis.installMode` | `"perMachine"` |
| `bundle.category` | `"DeveloperTool"` |

### Mécanisme sidecar embarqué

- **tauri.conf.json** → `externalBin: ["multicorpus"]` : déclare le sidecar
- **build.rs** → copie `binaries/multicorpus-{TARGET_TRIPLE}` vers `src-tauri/multicorpus-{TARGET_TRIPLE}` en racine manifeste (chemin attendu par `tauri_build`)
- **capabilities/default.json** → `shell:allow-spawn` + `shell:allow-execute` avec `sidecar: true` pour `"multicorpus"`
- **sidecarClient.ts** → `Command.sidecar("multicorpus", args)` — spawn côté TS avec `--port 0 --token auto`
- **Aucun code Rust custom** — le spawn est entièrement délégué au plugin `tauri-plugin-shell`

### Binaires sidecar présents

| Plateforme | Triple | Présent | Version | Taille |
|------------|--------|---------|---------|--------|
| macOS arm64 | `aarch64-apple-darwin` | ✅ | 1.4.6 (2026-03-10) | 26.3 MB |
| macOS x64 | `x86_64-apple-darwin` | ❌ absent | — | — |
| Windows x64 | `x86_64-pc-windows-msvc` | ❌ absent | — | — |
| Linux x64 | `x86_64-unknown-linux-gnu` | ❌ absent | — | — |

### Icônes

| Fichier | Présent | Taille | Requis pour |
|---------|---------|--------|-------------|
| `icons/32x32.png` | ✅ | 70 B (stub) | Linux AppImage |
| `icons/128x128.png` | ✅ | 70 B (stub) | Linux AppImage, Windows |
| `icons/128x128@2x.png` | ✅ | 70 B (stub) | macOS |
| `icons/icon.icns` | ❌ absent | — | macOS .app + .dmg |
| `icons/icon.ico` | ❌ absent | — | Windows NSIS |

> Les fichiers PNG existants sont des stubs vides (70 octets). Ni le `.icns` ni le `.ico` ne sont présents. Un `tauri icon <source.png>` à partir d'une image 1024×1024 est nécessaire avant le premier build de distribution.

---

## B. Modifications appliquées

### 1. Sync sidecar — `tauri-shell/src-tauri/binaries/`

**Avant :** binaire daté 2026-03-01, 14.172 MB, API 1.4.1 (précède BUG-FW2-01 fix)
**Après :** binaire daté 2026-03-10, 26.327 MB, API 1.4.6 (inclut fix BUG-FW2-01 + exceptions_only)

```bash
cp tauri-prep/src-tauri/binaries/multicorpus-aarch64-apple-darwin \
   tauri-shell/src-tauri/binaries/multicorpus-aarch64-apple-darwin
```

`sidecar-manifest.json` mis à jour : sha256, taille, build_time.

### 2. `tauri-shell/src-tauri/tauri.conf.json` — métadonnées de distribution

Ajouts dans `bundle` :

```json
"shortDescription": "AGRAFES — corpus preparation and concordancier",
"longDescription": "...",
"copyright": "2024-2026 AGRAFES",
"category": "DeveloperTool",
"macOS": { "minimumSystemVersion": "11.0" },
"windows": { "nsis": { "installMode": "perMachine" } }
```

Ces champs sont nécessaires pour les installeurs NSIS (Windows) et les métadonnées du .dmg (macOS). Ils n'affectent pas le build dev.

---

## C. Fichiers modifiés

| Fichier | Nature |
|---------|--------|
| `tauri-shell/src-tauri/tauri.conf.json` | Métadonnées bundle (committé) |
| `tauri-shell/src-tauri/binaries/multicorpus-aarch64-apple-darwin` | Binaire sidecar 1.4.6 (gitignored) |
| `tauri-shell/src-tauri/binaries/sidecar-manifest.json` | Mise à jour sha256/taille/date (gitignored) |

```
git diff --name-only
  tauri-shell/src-tauri/tauri.conf.json
```

---

## D. Sidecars attendus par plateforme

### Génération

Tous les sidecars se génèrent avec le script existant :

```bash
# macOS arm64 (build natif sur machine Apple Silicon)
python scripts/build_sidecar.py --out tauri-shell/src-tauri/binaries

# macOS x64 (cross depuis arm64 avec Rosetta ou machine Intel)
ARCH=x86_64 python scripts/build_sidecar.py --out tauri-shell/src-tauri/binaries
# → produit multicorpus-x86_64-apple-darwin

# Windows x64 — doit être buildé sur hôte Windows
python scripts/build_sidecar.py --out tauri-shell\src-tauri\binaries
# → produit multicorpus-x86_64-pc-windows-msvc.exe

# Linux x64 — doit être buildé sur hôte Linux (ou Docker glibc ≥ 2.17)
python scripts/build_sidecar.py --out tauri-shell/src-tauri/binaries
# → produit multicorpus-x86_64-unknown-linux-gnu
```

### Convention de nommage (ADR-025)

Tauri exige que les sidecars soient nommés `{name}-{target-triple}[.exe]` :

| OS | Fichier attendu |
|----|-----------------|
| macOS arm64 | `multicorpus-aarch64-apple-darwin` |
| macOS x64 | `multicorpus-x86_64-apple-darwin` |
| Windows x64 | `multicorpus-x86_64-pc-windows-msvc.exe` |
| Linux x64 | `multicorpus-x86_64-unknown-linux-gnu` |

Le `build.rs` existant détecte automatiquement `$TARGET` et copie le bon fichier — aucune modification nécessaire.

### Universal macOS (optionnel PKG-2)

Pour un binaire universel macOS (arm64 + x64) :
```bash
lipo -create multicorpus-aarch64-apple-darwin multicorpus-x86_64-apple-darwin \
     -output multicorpus-universal-apple-darwin
```
Et dans tauri.conf.json : `"macOS": { "targets": "universal" }`.

---

## E. Commandes de build par OS

### macOS — .app + .dmg

```bash
# Prérequis
python scripts/build_sidecar.py --out tauri-shell/src-tauri/binaries
# Optionnel (si icônes absentes) :
# tauri icon src/assets/icon.png  (nécessite image 1024×1024)

cd tauri-shell
npm install
npm run tauri build
# Sortie : tauri-shell/src-tauri/target/release/bundle/macos/AGRAFESShell.app
#          tauri-shell/src-tauri/target/release/bundle/dmg/AGRAFESShell_0.1.0_aarch64.dmg
```

Pour la distribution signée :
```bash
npm run tauri build -- --target aarch64-apple-darwin \
  --config '{"bundle":{"macOS":{"signingIdentity":"Developer ID Application: ...","notarizationCredentials":{"appleId":"...","teamId":"..."}}}}'
```

### Windows — NSIS setup.exe

```cmd
REM Sur hôte Windows (ou CI GitHub Actions windows-latest)
python scripts/build_sidecar.py --out tauri-shell\src-tauri\binaries
cd tauri-shell
npm install
npm run tauri build
REM Sortie : tauri-shell\src-tauri\target\release\bundle\nsis\AGRAFESShell_0.1.0_x64-setup.exe
```

### Linux — AppImage

```bash
# Sur hôte Linux ou Docker (ubuntu-22.04 recommandé pour glibc ≥ 2.17)
# Prérequis système :
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

python scripts/build_sidecar.py --out tauri-shell/src-tauri/binaries
cd tauri-shell
npm install
npm run tauri build
# Sortie : tauri-shell/src-tauri/target/release/bundle/appimage/agrafes-shell_0.1.0_amd64.AppImage
```

### GitHub Actions CI (tri-plateforme)

```yaml
strategy:
  matrix:
    include:
      - os: macos-latest          # arm64
      - os: windows-latest        # x64
      - os: ubuntu-22.04          # x64, glibc 2.35
```

---

## F. Manques bloquants restants

| # | Bloquant | Gravité | Action requise |
|---|----------|---------|----------------|
| 1 | **Icônes stub** — 32x32/128x128/128x128@2x sont des fichiers vides (70 B). Aucun `.icns` ni `.ico`. | 🔴 Bloquant distribution | Fournir une source PNG ≥ 1024×1024 + `tauri icon <source.png>` (génère tous les formats) |
| 2 | **Sidecar Windows absent** — `multicorpus-x86_64-pc-windows-msvc.exe` inexistant | 🔴 Bloquant Windows build | Build sur hôte Windows (voir §E) |
| 3 | **Sidecar Linux absent** — `multicorpus-x86_64-unknown-linux-gnu` inexistant | 🔴 Bloquant Linux build | Build sur hôte Linux (voir §E) |
| 4 | **Sidecar macOS x64 absent** — `multicorpus-x86_64-apple-darwin` inexistant | 🟡 Bloquant Intel Mac | Build sur machine Intel ou cross-compile |
| 5 | **Code signing non configuré** — pas de cert Developer ID ni de notarisation | 🟡 Bloquant distribution publique macOS | Apple Developer cert + Keychain CI setup |
| 6 | **Windows signing absent** — pas de cert signataire | 🟡 Bloquant distribution publique Windows | DigiCert / Certum EV cert + signtool config |
| 7 | **Updater non configuré** — pas de `bundle.updater` ni de clé publique | 🟢 Non bloquant V0.1 | Tauri updater plugin PKG-3 |

### Commande de génération d'icônes (référence)

```bash
# Depuis la racine du repo, avec image source 1024×1024 :
cd tauri-shell
npx tauri icon path/to/icon-1024.png
# Génère dans tauri-shell/src-tauri/icons/ :
#   32x32.png, 128x128.png, 128x128@2x.png
#   icon.icns (macOS), icon.ico (Windows)
#   Puis mettre à jour tauri.conf.json bundle.icon pour inclure icon.icns + icon.ico
```

---

## G. Recommandation PKG-2 (premiers builds)

### Séquence recommandée

1. **Créer l'artwork icône** — livrer `icon-source-1024.png` → `tauri icon` → commit les `.icns` + `.ico` générés dans `tauri-shell/src-tauri/icons/`

2. **Tester le build macOS arm64 local** (bloquant 1 résolu) :
   ```bash
   cd tauri-shell && npm run tauri build
   ```
   Vérifier que le .app contient le sidecar dans `Contents/MacOS/` et que `.dmg` est produit.

3. **Mettre en place CI GitHub Actions** avec matrix tri-plateforme :
   - `macos-latest` → `.dmg`
   - `windows-latest` → NSIS `.exe` (build Python sidecar sur Windows runner)
   - `ubuntu-22.04` → `.AppImage`

4. **Valider le sidecar embarqué** en lançant le `.app` et en vérifiant dans les logs Tauri que `multicorpus serve` démarre correctement.

5. **PKG-3** : ajouter `tauri-plugin-updater` + endpoint release GitHub pour les mises à jour auto.

### Résumé état PKG-1

- Configuration Tauri : ✅ complète et correcte
- Sidecar macOS arm64 : ✅ embarqué (1.4.6)
- Icônes : ⚠️ stubs — artwork requis avant PKG-2
- Binaires cross-plateforme : ⚠️ build CI à mettre en place
- Code signing : ⚠️ hors scope PKG-1
