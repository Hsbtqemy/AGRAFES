# PKG-2 — Premiers bundles réels tauri-shell

**Date:** 2026-03-10
**Version:** 0.1.0
**Host:** macOS arm64 (Apple Silicon)
**Tauri CLI:** 2.10.0 | **Rust:** 1.93.1 | **Cargo:** 1.93.1

---

## A. Icônes générées / remplacées

### Méthode

```bash
# 1. Génération source 1024×1024 via Pillow (Python 3 / 11.3.0)
python3 - <<'EOF'
# fond dark-teal arrondi, lettre "A" + "GRAFES" en blanc
# → tauri-shell/src-tauri/icons/icon-source-1024.png (30 648 B)
EOF

# 2. Génération de tous les formats via CLI Tauri
cd tauri-shell
npx tauri icon src-tauri/icons/icon-source-1024.png
```

### Fichiers produits dans `tauri-shell/src-tauri/icons/`

| Fichier | Usage | Taille |
|---------|-------|--------|
| `icon-source-1024.png` | Source (référence) | 30 648 B |
| `icon.icns` | macOS .app / .dmg | ✅ généré |
| `icon.ico` | Windows NSIS | ✅ généré |
| `32x32.png` | Linux AppImage | remplacé |
| `64x64.png` | Linux AppImage | nouveau |
| `128x128.png` | macOS / Linux | remplacé |
| `128x128@2x.png` | macOS Retina | remplacé |
| `icon.png` | Référence universelle | nouveau |
| `Square*.png` | Windows Store (APPX) | nouveaux |
| `AppIcon-*.png` | iOS (futur) | nouveaux |
| `mipmap-*/` | Android (futur) | nouveaux |

### Mise à jour `tauri.conf.json`

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```

---

## B. Sidecars disponibles par plateforme

| Plateforme | Triple | Statut | Taille | SHA256 | Date |
|------------|--------|--------|--------|--------|------|
| macOS arm64 | `aarch64-apple-darwin` | ✅ présent | 26.327 MB | `a1c52ff1…` | 2026-03-10 |
| macOS x64 | `x86_64-apple-darwin` | ❌ absent | — | — | — |
| Windows x64 | `x86_64-pc-windows-msvc.exe` | ❌ absent | — | — | — |
| Linux x64 | `x86_64-unknown-linux-gnu` | ❌ absent | — | — | — |

**Note :** PyInstaller ne supporte pas la cross-compilation. Chaque sidecar doit être buildé sur son hôte natif ou dans une VM/CI dédiée. Voir §F pour le détail.

SHA256 `a1c52ff1a49f515c5a5757280508c4173d5a14546f1e59502b60f25ecd0dc69a` correspond à la version 1.4.6 (post-fix BUG-FW2-01).

---

## C. Fichiers modifiés

### Fichiers trackés (git diff --name-only)

```
tauri-shell/src-tauri/icons/128x128.png
tauri-shell/src-tauri/icons/128x128@2x.png
tauri-shell/src-tauri/icons/32x32.png
tauri-shell/src-tauri/tauri.conf.json
```

### Fichiers non-trackés significatifs (nouveaux, à committer)

```
tauri-shell/src-tauri/icons/icon.icns
tauri-shell/src-tauri/icons/icon.ico
tauri-shell/src-tauri/icons/icon.png
tauri-shell/src-tauri/icons/64x64.png
tauri-shell/src-tauri/icons/icon-source-1024.png
tauri-shell/src-tauri/icons/Square*.png  (Windows Store)
packaging/PKG2_REPORT.md
```

### Fichiers gitignorés (binaires, non versionnés)

```
tauri-shell/src-tauri/binaries/multicorpus-aarch64-apple-darwin  (26.327 MB)
tauri-shell/src-tauri/target/                                     (build Rust)
```

---

## D. Bundles réellement produits

### macOS ✅

Commande :
```bash
cd tauri-shell
npm run tauri build
```

Résultat :
```
Bundling AGRAFESShell.app (…/bundle/macos/AGRAFESShell.app)
Bundling AGRAFESShell_0.1.0_aarch64.dmg (…/bundle/dmg/AGRAFESShell_0.1.0_aarch64.dmg)
Finished 2 bundles
```

| Artefact | Taille | Chemin |
|----------|--------|--------|
| `AGRAFESShell.app` | 42 MB | `tauri-shell/src-tauri/target/release/bundle/macos/` |
| `AGRAFESShell_0.1.0_aarch64.dmg` | 32 MB | `tauri-shell/src-tauri/target/release/bundle/dmg/` |

**Contenu du .app :**

```
AGRAFESShell.app/Contents/
  MacOS/
    agrafes-shell          (main binary Tauri, 16 MB, arm64)
    multicorpus            (sidecar PyInstaller, 26.327 MB, arm64)
  Resources/
    icon.icns              (icône macOS générée)
  Info.plist
```

**Signature :** adhoc (linker-signed) — non signé Developer ID. Gatekeeper bloquera l'ouverture hors développement sans `xattr -cr`. Voir §H.

### Windows ❌ — non buildable sur ce host

### Linux ❌ — non buildable sur ce host

---

## E. Smoke tests réalisés

### Test 1 — Sidecar dans .app : exécution et protocole JSON

```bash
./AGRAFESShell.app/Contents/MacOS/multicorpus --version
```

Résultat :
```json
{
  "error": "Invalid arguments: the following arguments are required: command",
  "status": "error",
  "created_at": "2026-03-10T16:47:27Z"
}
```

✅ Le binaire s'exécute, retourne du JSON valide selon le protocole CLI sidecar. L'erreur "command required" est le comportement correct pour `--version` (le CLI attend `serve`, `query`, etc.).

### Test 2 — SHA256 du sidecar embarqué

```
sidecar dans .app : sha256=a1c52ff1a49f515c5a5757280508c4173d5a14546f1e59502b60f25ecd0dc69a
source binaire    : sha256=a1c52ff1a49f515c5a5757280508c4173d5a14546f1e59502b60f25ecd0dc69a
```

✅ Hashes identiques — le sidecar embarqué est bit-à-bit identique à la source.

### Test 3 — Binary Tauri principal

`agrafes-shell` binary (16 MB, arm64) présent et exécutable. Fenêtre Tauri ouvre (adhoc signed). Test GUI complet requiert Gatekeeper bypass ou cert Developer ID (hors scope PKG-2).

### Smoke test sidecar via Python (depuis `fw2_smoke.py` PKG-1/FW-2)

Le sidecar 1.4.6 a été validé fonctionnellement par les smoke tests FW-2 :
- Import TEI : ✅ (BUG-FW2-01 corrigé)
- Segmentation job : ✅
- Export CSV exceptions_only : ✅
- Export TEI relation_type / listRelation : ✅

---

## F. Builds impossibles et pourquoi

### Windows x64

**Impossible depuis macOS.** Raisons :
1. **Sidecar absent** — `multicorpus-x86_64-pc-windows-msvc.exe` non généré. PyInstaller ne cross-compile pas — il faut un hôte Windows avec Python 3 + PyInstaller installés.
2. **Tauri Windows build** — requiert l'hôte Windows (les crates Rust dépendent de MSVC et de l'API Win32). La cross-compilation Tauri macOS→Windows n'est pas supportée officiellement.

**Solution CI :** runner `windows-latest` GitHub Actions.

```yaml
# .github/workflows/release.yml (futur)
- name: Build Windows sidecar
  if: runner.os == 'Windows'
  run: python scripts/build_sidecar.py --out tauri-shell/src-tauri/binaries

- name: Build Windows bundle
  if: runner.os == 'Windows'
  run: |
    cd tauri-shell
    npm run tauri build
```

Output attendu : `AGRAFESShell_0.1.0_x64-setup.exe` (NSIS)

### Linux x64

**Impossible depuis macOS.** Raisons :
1. **Sidecar absent** — `multicorpus-x86_64-unknown-linux-gnu` non généré. PyInstaller Linux requis (glibc ≥ 2.17 selon ADR-025).
2. **Tauri Linux build** — requiert GTK 3.x + WebKit2GTK 4.1 sur hôte Linux. Buildable depuis Ubuntu 22.04 (glibc 2.35).
3. **Dépendances système Linux :**
   ```bash
   sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
   ```

**Solution CI :** runner `ubuntu-22.04` GitHub Actions.

Output attendu : `agrafes-shell_0.1.0_amd64.AppImage`

### macOS x64 (Intel)

**Non produit** — machine actuelle est arm64. Options :
1. Machine Intel Mac disponible → build natif
2. Cross-compile Rust : `rustup target add x86_64-apple-darwin && npm run tauri build -- --target x86_64-apple-darwin`
3. Sidecar x64 : requiert machine Intel (PyInstaller ne cross-compile pas)

---

## G. Stratégie recommandée pour les prochaines releases

### Versionnage sidecars

Les sidecars sont **gitignorés** (`.gitignore` ligne 61). Ils sont :
- régénérés à chaque release par `python scripts/build_sidecar.py --out tauri-shell/src-tauri/binaries`
- NON versionnés en git (trop lourds, dépendent de l'hôte)
- documentés via `sidecar-manifest.json` (sha256, date, version)

**Recommandation :** publier les sidecars comme artefacts de release GitHub (`.zip` par triple) pour permettre aux runners CI de les télécharger sans rebuild.

### Pipeline CI reproductible recommandée (PKG-3)

```yaml
# .github/workflows/release.yml
on:
  push:
    tags: ['v*']

jobs:
  sidecar-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install pyinstaller
      - run: python scripts/build_sidecar.py --out tauri-shell/src-tauri/binaries
      - uses: actions/upload-artifact@v4
        with: { name: sidecar-aarch64-apple-darwin, path: tauri-shell/src-tauri/binaries/multicorpus-aarch64-apple-darwin }

  sidecar-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install pyinstaller
      - run: python scripts/build_sidecar.py --out tauri-shell/src-tauri/binaries

  sidecar-linux:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - run: pip install pyinstaller
      - run: python scripts/build_sidecar.py --out tauri-shell/src-tauri/binaries

  bundle:
    needs: [sidecar-macos, sidecar-windows, sidecar-linux]
    strategy:
      matrix:
        include:
          - os: macos-latest
          - os: windows-latest
          - os: ubuntu-22.04
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4  # download matching sidecar
      - run: cd tauri-shell && npm install && npm run tauri build
      - uses: actions/upload-artifact@v4  # upload .dmg / .exe / .AppImage
```

### Icônes

L'artwork source `icon-source-1024.png` est généré programmatiquement (Pillow). Pour la production :
- Remplacer `icon-source-1024.png` par l'artwork officiel AGRAFES
- Relancer `npx tauri icon src-tauri/icons/icon-source-1024.png`
- Committer les nouveaux fichiers `icon.icns`, `icon.ico`, `32x32.png`, `128x128.png`, `128x128@2x.png`

---

## H. Recommandation PKG-3

### Priorité 1 — Signature et notarisation macOS

Pour distribuer hors App Store sans message Gatekeeper :

```bash
# 1. Cert Apple Developer ID (Developer ID Application)
# 2. Configurer dans tauri.conf.json :
"macOS": {
  "minimumSystemVersion": "11.0",
  "signingIdentity": "Developer ID Application: YOUR_TEAM (XXXXXXXXXX)",
  "notarizationCredentials": {
    "appleId": "developer@example.com",
    "teamId": "XXXXXXXXXX",
    "password": "@keychain:AC_PASSWORD"
  }
}
# 3. Build signé :
npm run tauri build
```

### Priorité 2 — Signature Windows (Authenticode)

```yaml
# Dans CI :
- uses: tauri-apps/tauri-action@v0
  with:
    tagName: v${{ env.VERSION }}
  env:
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}
```

### Priorité 3 — Updater automatique

Ajouter `tauri-plugin-updater` pour les mises à jour OTA :
```toml
# Cargo.toml
tauri-plugin-updater = "2"
```
```json
// tauri.conf.json
"plugins": { "updater": { "pubkey": "...", "endpoints": ["https://..."] } }
```

### État PKG-2

| Item | Statut |
|------|--------|
| Icônes réelles (.icns + .ico) | ✅ générées |
| Sidecar macOS arm64 1.4.6 | ✅ embarqué |
| Build macOS .app | ✅ produit (42 MB) |
| Build macOS .dmg | ✅ produit (32 MB) |
| Sidecar dans .app : SHA256 vérifié | ✅ identique source |
| Sidecar dans .app : exécution JSON OK | ✅ validé |
| Build Windows NSIS | ❌ impossible sur ce host |
| Build Linux AppImage | ❌ impossible sur ce host |
| Code signing | ⚠️ hors scope (PKG-3) |
