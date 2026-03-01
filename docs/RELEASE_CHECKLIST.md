# AGRAFES — Release Checklist

**Use before every tagged release (`v*.*.*`).**

---

## 1. Pre-release — local

- [ ] `git status` — no uncommitted changes
- [ ] `pytest -q` — all tests green
- [ ] `node tauri-app/scripts/test_buildFtsQuery.mjs` — 26 tests green
- [ ] `npm --prefix tauri-app run build` — ✓
- [ ] `npm --prefix tauri-prep run build` — ✓
- [ ] `npm --prefix tauri-shell run build` — ✓
- [ ] `python scripts/ci_smoke_sidecar.py` — smoke test green (import/index/query/shutdown)
- [ ] `docs/openapi.json` up to date (`python scripts/export_openapi.py`)
- [ ] `tests/snapshots/openapi_paths.json` consistent
- [ ] `CHANGELOG.md` has entry for the release version

---

## 2. CI gates (all must be green before tag push)

| Workflow | Check |
|----------|-------|
| `ci.yml` — Python tests & contract freeze | ✅ pytest + openapi freeze |
| `smoke.yml` — Sidecar smoke (ubuntu + macos) | ✅ import/index/query |
| `smoke.yml` — Frontend builds | ✅ tauri-app, tauri-prep, tauri-shell |
| `smoke.yml` — Python tests | ✅ pytest |

---

## 3. Sidecar binary build

- [ ] Push tag `v*.*.*` → triggers `build-sidecar.yml` (macos onefile, ubuntu onedir, windows onedir)
- [ ] Download artifacts from CI, rename following naming convention:
  - `multicorpus-macos-arm64` (from macos-latest run)
  - `multicorpus-linux-x86_64` (from ubuntu-latest run)
  - `multicorpus-windows-x64.exe` (from windows-latest run)
- [ ] Place binaries in `tauri-shell/src-tauri/binaries/` (or per-app if standalone)
- [ ] Verify binary sidecar health: `./multicorpus serve --db /tmp/test.db --port 8765 --token none &`
  then `curl http://127.0.0.1:8765/health`

---

## 4. Tauri build (requires Rust + secrets)

Run via `macos-sign-notarize.yml` or `release.yml` CI workflows (require Apple credentials).

- [ ] `npm --prefix tauri-shell run tauri build` (or via CI release workflow)
- [ ] Verify installer launches, opens to Home screen, demo corpus installs
- [ ] Smoke-test "Créer…" DB flow: new DB → sidecar init → Explorer
- [ ] Smoke-test "Ouvrir…" DB flow in Prep topbar
- [ ] Smoke-test Export hits (CSV long, JSONL parallel)
- [ ] Smoke-test Workflow alignment panel (5 steps)

---

## 5. Post-release

- [ ] Tag pushed: `git tag vX.Y.Z && git push --tags`
- [ ] GitHub Release created with:
  - Binary attachments (sidecar + Tauri .dmg/.deb/.msi)
  - CHANGELOG excerpt for this version
- [ ] `ROADMAP.md` updated (mark version as shipped)

---

## Smoke CI notes

The `smoke.yml` workflow runs **no secrets** — it only requires:
- Python 3.11 + `pip install -e ".[dev]"`
- Node 20 + `npm ci` for each frontend

It tests the full sidecar integration (start → import → index → query → shutdown) on
**ubuntu-latest** and **macos-latest** using `scripts/ci_smoke_sidecar.py`.

To run locally:
```bash
pip install -e ".[dev]"
python scripts/ci_smoke_sidecar.py --timeout 60
```

## V1.5.1 — Corpus QA Gate

### Avant publication (QA gate)

- [ ] Exporter rapport QA (ExportsScreen → "Rapport QA corpus") ou CLI `multicorpus qa-report --db ... --out report.json`
- [ ] Vérifier gate status :
  - 🟢 OK — aucun problème bloquant, publication autorisée
  - 🟡 Warning — avertissements (holes/duplicates, doc_role standalone, collisions), publication possible avec vérification manuelle
  - 🔴 Blocking — erreurs critiques (titre/langue manquants, <50% couverture alignement), corrections requises avant publication
- [ ] Si gate blocking : corriger les documents signalés avant d'exporter le package TEI
- [ ] Si gate warning : confirmer manuellement la pertinence des avertissements

### Champs contrôlés par le rapport QA

1. **Import integrity** : trous/doublons dans les external_id, unités vides, lignes trop longues
2. **Métadonnées TEI** : `title`, `language` obligatoires ; `doc_role`, `resource_type` optionnels mais recommandés
3. **Alignements** : couverture pivot/cible en %, orphelins, collisions (1 pivot → N cibles)
4. **Relations** : `target_doc_id` des doc_relations doit exister en base

---

## V1.7.0 — Automated Release Gate

### Local commande

```bash
python scripts/release_gate.py
# JSON résultat sur stdout, logs dans build/release_gate.log
# Skips optionnels:
python scripts/release_gate.py --skip-builds  # skip npm builds
python scripts/release_gate.py --skip-demo    # skip demo DB gates
```

### Ce que le gate exécute

| Étape | Description | Réussite si |
|---|---|---|
| 1. pytest | Suite complète en mode quiet | 0 failed, 0 errors |
| 2. FTS tests | `node tauri-app/scripts/test_buildFtsQuery.mjs` | 0 failed |
| 3. npm builds | shell, app, prep | `✓ built in` présent, no ERROR |
| 4a. Demo DB | Create/verify `agrafes_demo.db` | DB créée |
| 4b. QA strict | `write_qa_report(policy='strict')` sur démo | gate_status ≠ blocking |
| 4c. TEI export | `export_tei_package(tei_profile='parcolab_strict')` | no exception |
| 4d. TEI validate | `validate_tei_package(zip)` | 0 errors |

### CI workflow

`.github/workflows/release-gate.yml` — matrix macos-latest + ubuntu-latest, no secrets.
Déclenché sur push vers `main`/`release/**` et PRs.
Artifacts uploadés : `release_gate.json`, `release_gate.log`.

---

## Unsigned binaries on tag (V1.8.0)

### Déclenchement

```bash
git tag v1.8.0 && git push origin v1.8.0
```

Le workflow `tauri-shell-build.yml` se déclenche automatiquement et produit :
- `tauri-shell-unsigned-macos` : `.app` + `.dmg` (unsigned)
- `tauri-shell-unsigned-linux` : `.AppImage` + `.deb`
- `tauri-shell-unsigned-windows` : `.exe` / `.msi`

### Vérification

- [ ] GitHub Actions : tous les matrix jobs verts
- [ ] Artifacts disponibles dans la release GitHub
- [ ] sidecar-manifest.json inclus dans chaque artifact
- [ ] Binaires non signés — warning attendu sur macOS (Gatekeeper) ; accepter via clic droit → Ouvrir

### Build local Shell (best effort)

```bash
python scripts/build_sidecar.py --preset shell --format onefile   # macOS
npm --prefix tauri-shell ci
npm --prefix tauri-shell run tauri build
```

---

## Signing (V1.8.1)

### macOS

- [ ] Secrets GitHub configurés : `MACOS_CERT_P12_BASE64`, `MACOS_CERT_P12_PASSWORD`, `MACOS_SIGN_IDENTITY`
- [ ] Secrets notarization : `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `APPLE_API_KEY_P8_B64`, `APPLE_TEAM_ID`
- [ ] Workflow `macos-sign-shell.yml` vert (ou skip gracieux si secrets absents)
- [ ] `codesign --verify --deep --strict <app>` passe
- [ ] `xcrun notarytool info <submission-id>` = Accepted
- [ ] DMG signé + agrafé uploadé

### Windows

- [ ] Secrets GitHub configurés : `WIN_SIGN_CERT_PFX_BASE64`, `WIN_SIGN_CERT_PASSWORD`
- [ ] Workflow `windows-sign-shell.yml` vert (ou skip gracieux)
- [ ] `.exe` / `.msi` signés

### Mode sans secrets

Les workflows s'exécutent avec `exit 0` si les secrets sont absents — aucun échec en CI.
Les binaires non signés (Sprint 1) restent utilisables.

---

## V1.9.0 — Support menu + diagnostics

### Pre-release
- [ ] `npm --prefix tauri-shell run build` vert
- [ ] `node tauri-shell/scripts/test_diagnostics.mjs` 42 tests verts
- [ ] Modal diagnostic s'ouvre depuis le menu "?" dans le header Shell
- [ ] Bouton "Exporter…" produit un fichier `.txt` lisible (aucun chemin sensible en clair)
- [ ] Bouton "Copier" copie le texte dans le presse-papiers
- [ ] Menu "?" se ferme au clic extérieur et sur Escape

### Quand un utilisateur signale un bug
1. Demander : **Menu "?" → Diagnostic système… → Exporter…** → joindre `agrafes-diagnostic-YYYY-MM-DD.txt`
2. Demander : **Menu "?" → Exporter logs…** → joindre `agrafes-logs-YYYY-MM-DD.txt`
3. Les deux fichiers ne contiennent aucun chemin utilisateur complet (redaction automatique).
4. Vérifier dans le fichier diagnostic : section `Sidecar` (running? port?), section `Collection Errors`.
