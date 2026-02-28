# Concordancier — AGRAFES Tauri UI V0

Search-first desktop concordancer built on Tauri v2 + the `multicorpus_engine` sidecar.

> **Statut** : V0 — fonctionnel, non publié. Nécessite le sidecar compilé localement.

---

## Architecture

```
tauri-app/
├── src/
│   ├── main.ts              — point d'entrée Vite
│   ├── app.ts               — UI Concordancier complète (DOM vanilla TS)
│   └── lib/
│       ├── sidecarClient.ts — client HTTP sidecar (spawn/reuse, token)
│       └── db.ts            — gestion du chemin DB + répertoire app data
├── src-tauri/
│   ├── src/main.rs          — Tauri app Rust
│   ├── Cargo.toml           — dépendances Rust
│   ├── tauri.conf.json      — config Tauri v2
│   ├── capabilities/
│   │   └── default.json     — permissions (shell, fs, dialog, path)
│   └── binaries/            — sidecar binaire (non versionné, voir ci-dessous)
├── scripts/
│   ├── prepare_sidecar.sh   — build + copie sidecar macOS/Linux
│   └── prepare_sidecar.ps1  — build + copie sidecar Windows
├── package.json
├── vite.config.ts
└── tsconfig.json
```

Le sidecar (`binaries/multicorpus-<target-triple>`) est le binaire
`multicorpus serve` compilé avec PyInstaller. Il doit être présent avant de
lancer `tauri dev` ou `tauri build`.

---

## Prérequis

| Outil | Version | Notes |
|-------|---------|-------|
| Node.js | ≥ 18 | pour Vite + npm |
| Rust / Cargo | stable | pour Tauri |
| Python | ≥ 3.10 | pour le moteur + PyInstaller |
| `pip install -e ".[packaging]"` | — | PyInstaller dans le venv |

```bash
# Depuis la racine du dépôt
pip install -e ".[packaging]"
```

---

## 1 — Construire le sidecar

Le sidecar est le binaire `multicorpus serve` compilé. Il doit être généré
**une fois** puis copié dans `tauri-app/src-tauri/binaries/`.

### macOS / Linux

```bash
# Depuis la racine du dépôt
bash tauri-app/scripts/prepare_sidecar.sh
```

Ce script :
1. Appelle `scripts/build_sidecar.py --format onefile --preset tauri` (macOS) ou
   `--format onedir` (Linux) — conforme à ADR-025.
2. Copie le binaire dans `tauri-app/src-tauri/binaries/multicorpus-<target-triple>`.

### Windows (PowerShell)

```powershell
.\tauri-app\scripts\prepare_sidecar.ps1
```

---

## 2 — Installer les dépendances front

```bash
cd tauri-app
npm install
```

---

## 3 — Lancer en développement

```bash
cd tauri-app
npm run tauri dev
```

Tauri :
- Lance Vite sur `http://localhost:1420`
- Ouvre la fenêtre native avec le frontend

Au premier lancement, l'app crée une DB par défaut dans le répertoire
app data du système (`~/Library/Application Support/com.agrafes.concordancier/corpus.db`
sur macOS, `%APPDATA%\com.agrafes.concordancier\corpus.db` sur Windows).

---

## 4 — Fonctionnalités V0

| Fonctionnalité | Description |
|---|---|
| **Sidecar auto-start** | Spawn automatique via portfile ou `multicorpus serve --port 0` |
| **Recherche** | Barre de recherche FTS5 plein texte |
| **Mode Segment** | Texte complet avec mise en évidence `<< >>` |
| **Mode KWIC** | Fenêtre contexte gauche / terme / droite |
| **Vue alignée V0.1** | Toggle `Alignés: on/off` (requête `/query` avec `include_aligned`) |
| **Slider fenêtre** | Fenêtre KWIC de 3 à 25 tokens |
| **Filtres** | Langue, doc_role, doc_id |
| **Importer** | Choisir fichier + mode + langue → import + auto-index |
| **Ouvrir DB** | Changer de corpus via file dialog |
| **Indicateur statut** | starting / ready / error avec message |

## Utiliser une DB préparée (tauri-prep)

1. Dans `tauri-prep`, finaliser les étapes import/index/align.
2. Copier le chemin de la DB depuis l’écran **Projet**.
3. Dans `tauri-app`, cliquer **Open DB…** et ouvrir cette même DB.
4. Si nécessaire, relancer un index puis activer la vue Alignés.

---

## 5 — Build de production

```bash
cd tauri-app
npm run tauri build
```

Le binaire résultant est dans `src-tauri/target/release/bundle/`.

> Pour macOS : signer + notariser avec `scripts/macos_sign_and_notarize_sidecar.sh`
> Pour Windows : signer avec `scripts/windows_sign_sidecar.ps1`

---

## Roadmap V1

- Pagination / liste virtuelle pour les grands corpus
- Panneau métadonnées document
- Corpus démo embarqué
- Recherche avancée (NEAR, regex, `^anchored`)
- Amélioration vue alignée (tri/filtres langues, presets d’affichage)

---

## Notes

- `tauri-fixture/` est la **fixture CI headless** (ne pas modifier pour l'UI).
- `tauri-app/` est l'**application utilisateur** (ce dossier).
- Le sidecar portfile `.agrafes_sidecar.json` est créé dans le répertoire contenant la DB.
- Token d'authentification : lu depuis le portfile, injecté automatiquement en header `X-Agrafes-Token`.
- Dev uses PNG-only icons placeholders; generate real `icon.icns` and `icon.ico` before release packaging.
