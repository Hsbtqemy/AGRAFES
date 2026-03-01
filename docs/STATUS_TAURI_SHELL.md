# Status: AGRAFES Shell (tauri-shell/)

**Current version:** V1.2 (2026-03-01)

## What it is

`tauri-shell/` is the unified Tauri 2.0 app that replaces the two standalone apps
(`tauri-app/` and `tauri-prep/`). It hosts both modules in a single process with
a home screen, a permanent header with mode tabs, DB state management, and proper
lifecycle management via module wrappers.

## Architecture

- **Router**: state-based (`Mode = "home" | "explorer" | "constituer"`), no library
- **Header**: fixed 44px bar with brand (AGRAFES) + two tabs (Explorer, Constituer) + DB zone
- **Accent system**: `body[data-mode]` + CSS custom properties (`--accent`, `--accent-header-bg`)
  - `home` → dark neutral header (#1a1a2e)
  - `explorer` → blue (#1e4a80 header / #2c5f9e accent)
  - `constituer` → teal-green (#145a38 header / #1a7f4e accent)
- **DB state (V0.2 / V0.4)**:
  - Single source of truth: `_currentDbPath` in `shell.ts`
  - Header badge: "DB: \<basename\>" or "DB: (aucune)"
  - **V0.2** — "Changer…" button → Tauri file dialog (filters: .db/.sqlite/.sqlite3)
  - **V0.4** — Le bouton devient "DB ▾" et ouvre un micro-menu déroulant :
    - **Ouvrir…** : dialog `open` → sélectionner une DB existante
    - **Créer…** : dialog `save` → choisir un chemin, le sidecar créera et initialisera le schéma au premier accès
  - On change: updates badge, notifies `_dbListeners`, re-mounts active module, shows toast
- **Persistence (V0.2)**:
  - `localStorage["agrafes.lastMode"]` + `localStorage["agrafes.lastDbPath"]`
  - Restored at boot; persisted on every mode/DB change
  - "Retour accueil" (brand click) resets view only — DB persists
- **Deep-link boot (V0.2)**:
  - `location.hash` (`#explorer`, `#constituer`, `#home`) or `?mode=` query param
  - Overrides `lastMode` if present at boot
- **Module wrappers (V0.2)**:
  - `src/modules/explorerModule.ts` and `constituerModule.ts`
  - Each exposes `mount(container, ctx)` and `dispose()`
  - `ShellContext` (defined in `src/context.ts`) provides `getDbPath()` and `onDbChange()`
  - DB path injected via `setCurrentDbPath()` before module init
- **Lifecycle**:
  - `dispose()` called before every navigation (stops timers, disconnects observers)
  - Container DOM swap (`#app` replaced with fresh element) breaks lingering listeners
  - Modules loaded via dynamic `import()` — lazy, split into separate chunks
- **Sidecar sharing**: both modules share the same `sidecarClient.ts` module instance
  → single sidecar connection per session
- **Option A**: imports existing `tauri-prep/src/` and `tauri-app/src/` directly — no duplication

## Files

```
tauri-shell/
├── index.html                        Fixed header + #app layout
├── package.json                      Port 1422
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.ts                       Entry: initShell()
│   ├── shell.ts                      Router + header + DB zone + toast + lifecycle
│   ├── context.ts                    ShellContext interface
│   └── modules/
│       ├── explorerModule.ts         mount/dispose wrapper → tauri-app
│       └── constituerModule.ts       mount/dispose wrapper → tauri-prep
└── src-tauri/
    ├── src/main.rs                   Tauri v2 app with 4 plugins
    ├── build.rs                      Sidecar copy (mirrors tauri-prep)
    ├── Cargo.toml
    ├── tauri.conf.json               id: com.agrafes.shell, 1200×760, port 1422
    └── capabilities/
        └── default.json              shell+fs+dialog+http (same as tauri-prep)
```

## Navigation flow (V0.2)

```
Header: [AGRAFES] [🔍 Explorer ⌘1] [📝 Constituer ⌘2] ... [DB: corpus.db] [Changer…]

Boot:
  1. Restore localStorage (lastMode + lastDbPath)
  2. Check location.hash or ?mode= (overrides lastMode)
  3. Navigate to resolved mode

Home screen (default on launch if no saved mode)
  ├── [🔍 Explorer AGRAFES]       → setMode("explorer")
  └── [📝 Constituer son corpus]  → setMode("constituer")

Header tabs: always visible — click to switch at any time
Keyboard shortcuts: Cmd/Ctrl+1 (explorer), +2 (constituer), +0 (home)

DB zone (right side of header) — V0.4:
  [DB: corpus.db] [DB ▾]
  ↓ click "DB ▾" → dropdown:
    • Ouvrir…  → file picker (existante) → updates badge + re-mounts
    • Créer…   → save dialog → sidecar crée le schéma au premier accès
```

## Lifecycle detail

```
setMode(newMode):
  1. Call _currentDispose?.()           [stop timers, disconnect observers]
  2. document.body.dataset.mode = mode  [update accent tokens]
  3. _freshContainer()                  [replace #app with clean div#app]
  4. Show loading spinner
  5. dynamic import() the module wrapper
  6. _freshContainer() again            [swap out spinner]
  7. wrapper.mount(container, ctx)
     └── setCurrentDbPath(ctx.getDbPath())  [inject shell DB into module]
     └── initApp() / new App().init()
  8. _currentDispose = () => wrapper.dispose()

DB change (_onChangeDb):
  1. Tauri dialog.open() → pick .db file
  2. _currentDbPath = newPath
  3. _persist() → localStorage
  4. _updateDbBadge()
  5. Notify _dbListeners
  6. _showToast("DB active: <basename>")
  7. If module active: setMode(_currentMode)  [re-mount with new DB]
```

## Child module changes

| File | Addition |
|------|----------|
| `tauri-app/src/app.ts` | `export function disposeApp(): void` — disconnects `_scrollObserver` (V0.1) |
| `tauri-prep/src/app.ts` | `App.dispose(): void` — calls `this._jobCenter.setConn(null)` (V0.1) |
| `tauri-prep/src/lib/db.ts` | `getOrCreateDefaultDbPath()` now checks `_currentDbPath` first (V0.2) |

## Deep-link usage

```
# Open directly on Explorer tab
http://localhost:1422/#explorer
http://localhost:1422/?mode=explorer

# Open directly on Constituer tab
http://localhost:1422/#constituer
http://localhost:1422/?mode=constituer
```

Hash takes precedence over `?mode=`. Both override `localStorage.lastMode`.

## V0.1 limitations (carried forward)

1. **CSS accumulation**: both child apps inject `<style>` tags on each `init()`.
   Re-navigating adds duplicate tags (harmless, no visual conflict).

## V0.2 limitations

1. **Create new DB**: "Changer…" opens an existing DB only (save dialog for new DB in backlog).
2. **In-module DB re-init**: on DB switch while a module is mounted, the module is fully
   disposed + re-mounted (sidecar restarted). No hot-swap without sidecar changes.
3. **Deep-link hash persistence**: the hash is consumed at boot but not cleared from the URL,
   so hard-refreshing the page will re-apply the deep-link override.

## Dev

```bash
cd tauri-shell
npm install
npm run dev        # Vite dev server on http://localhost:1422
npm run build      # TypeScript + Vite production build
npm run tauri dev  # Full Tauri dev (requires Rust toolchain + sidecar binary)
```

## CI

`build-shell` job in `.github/workflows/ci.yml` — installs tauri-prep, tauri-app,
and tauri-shell deps, then runs `npm run build` (TS + Vite, no Rust/secrets needed).

## Deprecation status

| App | Status |
|-----|--------|
| `tauri-app/` (Concordancier) | Superseded by tauri-shell; kept for standalone use |
| `tauri-prep/` (Prep) | Superseded by tauri-shell; kept for standalone use |
| `tauri-shell/` | **Active — primary app** |

## V0.3 additions (2026-03-01)

### A — Concordancier: panneau métadonnées des hits
- Bouton ⓘ sur chaque résultat (mode segment et parallèle) → ouvre un drawer droit (340px)
- Contenu : Titre, Langue, doc_id, unit_id, external_id, Rôle, Type ressource, Unités corpus
- `_docsById` map peuplée depuis `/documents` pour les champs enrichis (doc_role, resource_type, unit_count)
- Boutons "Copier doc_id" / "Copier unit_id" + "Fermer"
- Fermeture : Esc + clic backdrop + bouton ✕ + bouton Fermer

### B — Onboarding: corpus démo bundlé (first-run)
- `tauri-shell/public/demo/agrafes_demo.db` : Le Prince FR/EN, 5 unités × 2 docs, alignés, FTS
- Section "Corpus démo" dans l'écran d'accueil, en dessous des deux cartes principales
- Bouton "Installer…" : fetch binary depuis `/demo/agrafes_demo.db`, write vers AppData
- Bouton "Ouvrir Explorer" : set DB = demo path → navigate explorer → toast
- Détection si déjà installé (async au montage de l'écran d'accueil)
- Script de régénération : `scripts/create_demo_db.py`
- Capabilities : `fs:scope-appdata-recursive` ajouté à `tauri-shell/src-tauri/capabilities/default.json`

### C — Prep: toggle include_explain dans l'audit
- Checkbox "Expliquer (include_explain)" dans le panneau d'audit des liens
- Quand activé : `alignAudit` appelé avec `include_explain: true`
- Rechargement automatique si des liens sont déjà affichés
- Colonne supplémentaire "Expliquer" dans la table → `<details>` par lien :
  - stratégie (résumé)
  - notes (liste)
- Stockage: état dans `_auditIncludeExplain` (reset à false sur `setConn`)

## Comment tester V0.3

```bash
npm --prefix tauri-shell run tauri dev

# Sprint A — métadonnées
# 1. Lancer une recherche dans Explorer
# 2. Cliquer ⓘ sur un résultat → panneau droit s'ouvre
# 3. Vérifier : Titre, Langue, doc_id, unit_id, external_id, Rôle, Unités
# 4. Copier doc_id → presse-papiers
# 5. Esc → panneau se ferme

# Sprint B — démo
# 1. Accueil → section "Corpus démo" visible
# 2. Cliquer "Installer…" → toast + bouton "Ouvrir Explorer" apparaît
# 3. Cliquer "Ouvrir Explorer" → badge DB = agrafes_demo.db + Explorer lancé
# 4. Rechercher "prince" → résultats en FR et EN

# Sprint C — include_explain
# 1. Dans Constituer → Actions → Audit des liens
# 2. Cocher "Expliquer (include_explain)"
# 3. Charger les liens → colonne "Expliquer" avec <details> par lien
# 4. Expand → stratégie + notes visibles
```

## V0.4 additions (2026-03-01)

### Sprint 1 — Shell: Créer une DB
- Bouton "Changer…" remplacé par "DB ▾" ouvrant un menu déroulant (CSS dropdown)
- **Ouvrir…** : dialog `open`, comportement existant
- **Créer…** : dialog `save` (extension `.db` forcée si absente) → set `_currentDbPath` → toast
  - Le sidecar crée et initialise le schéma SQLite au premier accès (via migrations)
  - Re-monte le module actif pour démarrer le sidecar sur la nouvelle DB
- `dialog:allow-save` ajouté à `tauri-shell/src-tauri/capabilities/default.json`

### Sprint 2 — Explorer: UX recherche avancée
- **Preview FTS** : barre "FTS : <query effective>" apparaît sous la toolbar dès qu'un terme est tapé
  - Affiche le résultat de `buildFtsQuery(raw)` en temps réel (sans appel réseau)
- **Chips de filtres** : zone sous le filtre drawer montrant les filtres actifs (langue / rôle / type)
  - Chaque chip a un × pour effacer le filtre individuel + re-rend immédiatement
- **Bouton "✕ Réinitialiser"** : efface query + tous les filtres + état builder → reset UI complet
- Aucun changement backend

### Sprint 3 — Constituer: Export rapport de runs
- Section "Rapport de runs" dans `ActionsScreen` (sous "Index FTS")
- Champs : format HTML/JSONL + run_id optionnel (pré-rempli après un alignement)
- **"Enregistrer le rapport…"** → `dialogSave` → appelle `POST /export/run_report` (sidecar existant)
- Résultat affiché inline (`✓ N run(s) exportés → /chemin/vers/rapport.html`)
- Log + toast de confirmation
- `dialog:allow-save` ajouté à `tauri-prep/src-tauri/capabilities/default.json`
- Aucun changement sidecar (endpoint `/export/run_report` + fonction `exportRunReport` déjà présents)

## Comment tester V0.4

```bash
npm --prefix tauri-shell run tauri dev

# Sprint 1 — Créer DB
# 1. Cliquer "DB ▾" dans le header → menu déroulant avec "Ouvrir…" et "Créer…"
# 2. Choisir "Créer…" → dialog save → entrer "test.db" → Enregistrer
# 3. Toast "Nouvelle DB : test.db — le sidecar initialisera le schéma au premier accès"
# 4. Badge DB mis à jour ; naviguer en Explorer → sidecar crée le schéma SQLite

# Sprint 2 — Recherche avancée
# 1. Explorer → taper "prince" dans la barre → barre FTS apparaît sous la toolbar
#    ex: FTS : prince*
# 2. Activer un filtre langue → chip "Langue: fr" apparaît
# 3. Cliquer × sur le chip → filtre effacé
# 4. Cliquer "✕ Réinitialiser" → query + filtres + mode builder effacés

# Sprint 3 — Rapport de runs
# 1. Constituer → Actions → section "Rapport de runs"
# 2. Sélectionner format "HTML", laisser Run ID vide → "Enregistrer le rapport…"
# 3. Save dialog → choisir rapport.html
# 4. → "✓ N run(s) exportés → /chemin/rapport.html"
# 5. Optionnel : après un alignement, Run ID pré-rempli avec l'ID du run courant
```

## Comment tester V0.3

```bash
npm --prefix tauri-shell run tauri dev

# Sprint A — métadonnées
# 1. Lancer une recherche dans Explorer
# 2. Cliquer ⓘ sur un résultat → panneau droit s'ouvre
# 3. Vérifier : Titre, Langue, doc_id, unit_id, external_id, Rôle, Unités
# 4. Copier doc_id → presse-papiers
# 5. Esc → panneau se ferme

# Sprint B — démo
# 1. Accueil → section "Corpus démo" visible
# 2. Cliquer "Installer…" → toast + bouton "Ouvrir Explorer" apparaît
# 3. Cliquer "Ouvrir Explorer" → badge DB = agrafes_demo.db + Explorer lancé
# 4. Rechercher "prince" → résultats en FR et EN

# Sprint C — include_explain
# 1. Dans Constituer → Actions → Audit des liens
# 2. Cocher "Expliquer (include_explain)"
# 3. Charger les liens → colonne "Expliquer" avec <details> par lien
# 4. Expand → stratégie + notes visibles
```

## V0.5 additions (2026-03-01)

### Sprint 1 — Shell V0.5 : Create DB init immédiat + UX erreurs
- `_onCreateDb()` enchaîne maintenant : set path → `_initDb()` → remount si module actif
- `_initDb(dbPath)` : import dynamique de `ensureRunning` (chunk `sidecarClient` séparé) → démarre le sidecar → applique les migrations SQLite → affiche "DB initialisée ✓" ou bannière d'erreur
- Bannière d'erreur (`#shell-init-error`) : icône ⚠, message, code tronqué, boutons "Réessayer" / "Choisir un autre fichier…" / "✕" (Fermer)
- Touche `Escape` ferme le menu DB ET la bannière d'erreur (via `_installKeyboardShortcuts`)
- CSS `.shell-init-error` ajouté à `SHELL_CSS`

### Sprint 2 — Explorer V1 : Search history + export hits
- **Historique** (`localStorage["agrafes.explorer.history"]`, max 10 items) :
  - Stocke `{ts, raw, fts, mode, filters, aligned, parallel}` après chaque recherche réussie
  - Bouton "🕘 Hist." → dropdown panel : liste les recherches, click restore state + relance
  - Bouton "Vider" efface l'historique
- **Export** : bouton "⬇ Export" → menu JSONL / CSV :
  - JSONL : chaque hit sérialisé en JSON sur une ligne
  - CSV : colonnes `doc_id, title, language, unit_id, external_id, text, left, match, right`
  - `dialogSave` + `writeTextFile` → confirmation dans la barre de statut
- Capabilities : `dialog:allow-save` + `fs:allow-write-text-file` dans `tauri-app` et `tauri-shell`

### Sprint 3 — Constituer V1 : Workflow alignement guidé
- Section "🔄 Workflow Alignement guidé" en tête de `ActionsScreen`
- 5 étapes en accordéon cliquables (un seul ouvert à la fois) :
  1. **Alignement** — affiche le dernier `run_id`, CTA "Aller à la section ↓"
  2. **Qualité** — bouton "Lancer la vérification qualité" (inline, délègue à `alignQuality`) avec mini-résultat (couverture %, collisions, orphelins)
  3. **Collisions** — CTA scroll + auto-click sur "Charger les collisions"
  4. **Audit & Retarget** — CTA scroll + auto-click sur "Charger l'audit"
  5. **Rapport** — CTA scroll vers la section export existante
- État persisté : `localStorage["agrafes.prep.workflow.run_id"]` + `["agrafes.prep.workflow.step"]`
- `_alignRunId` pré-rempli depuis localStorage au `setConn()`
- Étape active mise en évidence (fond vert, numéro coloré)

## Comment tester V0.5

```bash
npm --prefix tauri-shell run tauri dev

# Sprint 1 — init immédiat
# 1. Cliquer "DB ▾" → "Créer…" → choisir ~/test.db
# 2. Le sidecar démarre et initialise les migrations → toast "DB initialisée ✓"
# 3. Si le chemin est invalide → bannière jaune avec "Réessayer" / "Choisir un autre fichier…"
# 4. Escape → ferme bannière ET dropdown menu

# Sprint 2 — Historique + Export
# 1. Explorer → chercher "prince" → puis "alliance" → puis "homme"
# 2. Cliquer "🕘 Hist." → les 3 recherches apparaissent
# 3. Cliquer une recherche → restaure la query + relance
# 4. Cliquer "⬇ Export" → "JSONL" → save dialog → fichier créé
# 5. "⬇ Export" → "CSV" → même chose

# Sprint 3 — Workflow
# 1. Constituer → Actions → section "Workflow Alignement guidé" tout en haut
# 2. Étape 1 : Cliquer "Aller à la section Alignement ↓" → scroll
# 3. Lancer un alignement → run_id s'affiche dans l'étape 1 + persisté
# 4. Étape 2 : cliquer entête → "Lancer la vérification qualité" → mini stats inline
# 5. Étape 5 : → scroll vers section Rapport → exporter
```

## V1.2 — Ajouts (2026-03-01)

### Sprint 1 — Constituer V1.2 : Presets de projet

- **Fichiers** : `tauri-prep/src/app.ts`, `tauri-prep/src/screens/ActionsScreen.ts`
- Modal "Presets" dans la topbar de la Prep
- `ProjectPreset` : `{id, name, description?, languages[], pivot_language?, segmentation_lang?, segmentation_pack?, curation_preset?, alignment_strategy?, similarity_threshold?, created_at}`
- Store : `localStorage["agrafes.prep.presets"]` — seed 2 presets (FR-EN, DE-FR)
- Modal : liste, appliquer, dupliquer, supprimer, nouveau, import JSON, export JSON
- `ActionsScreen.applyPreset(preset)` remplit les champs act-seg-lang, act-seg-pack, act-preset-sel, act-align-strategy, act-sim-threshold (non-destructif)

### Sprint 2 — Export TEI enrichi (CONTRACT_VERSION 1.3.1)

- **Fichiers sidecar** : `src/multicorpus_engine/sidecar.py`, `sidecar_contract.py`, `docs/openapi.json`, `docs/SIDECAR_API_CONTRACT.md`
- **Fichiers UI** : `tauri-prep/src/screens/ExportsScreen.ts`, `tauri-prep/src/lib/sidecarClient.ts`
- `POST /export/tei` accepte `include_structure?: bool` (default false) pour emettre les head des unites structurelles
- UI : checkbox include_structure, select relation_type (none/translation_of/excerpt_of), banniere recap apres export
- Contract backward-compatible ; openapi_paths.json snapshot inchange

### Sprint 3 — Explorer V1.2 : Help/guardrails + Pinned history

- **Fichiers** : `tauri-app/src/app.ts`
- Bouton "?" pres du builder : popover aide avec 7 exemples FTS5 + boutons Copier + section guardrails
- Historique enrichi (HistoryItem.pinned?) : bouton pin etoile sur chaque entree (max 3 favoris)
- Favoris affiches en tete (fond ambre, label Favoris)
- "Vider" conserve les favoris ; "Tout effacer" supprime tout

## Roadmap (post-V1.2)

- V1.3: CSS style deduplication (style-id guards to avoid style accumulation)
- V1.4: Optional multi-window via Tauri create_window
- V2.0: Full migration — deprecate standalone tauri-app/ and tauri-prep/

## V1.5.0 — Publication Wizard + Global Presets

### Sprint 1 — Publication Wizard + Global Presets

**Fichiers modifiés :** `tauri-shell/src/shell.ts`

#### A) Global Presets Store
- Nouveau localStorage key `agrafes.presets.global` (type `GlobalPreset[]`)
- `_loadGlobalPresets()` / `_saveGlobalPresets()` — lecture/écriture sans stderr
- `_migratePresetsFromPrep()` — migration additive depuis `agrafes.prep.presets` (pas d'écrasement)
- `_openPresetsModal()` — modal presets avec :
  - Liste + bouton supprimer par preset
  - Bouton "Migrer depuis Constituer" (migration à la demande)
  - Export JSON (download)
  - Import JSON (FileReader)
- Bouton "⚙ Presets" ajouté dans le header (à droite des tabs)

#### B) Publication Wizard (mode "publish")
- Nouveau mode `"publish"` dans le type `Mode`
- Carte "Publier" ajoutée dans Home screen (badge ambre, icône 📦)
- Wizard 5 étapes (renderProgress + WizardState) :
  1. **DB** — confirmation DB active
  2. **Documents** — `<select multiple>` peuplé depuis `listDocuments(conn)`
  3. **Options** — include_structure, include_alignment, status_filter
  4. **Exporter** — `save()` dialog → `enqueueJob("export_tei_package")` → polling `getJob()` (~1.2s)
  5. **Résumé** — doc_count, zip_path, warnings count, "Copier le chemin" + "Retour accueil"
- Zero backend change (utilise job `export_tei_package` existant, CONTRACT_VERSION inchangé)

## V1.6.1 — Onboarding Demo Guided Tour

### Guided Tour (3 steps)

**Fichiers modifiés :** `tauri-shell/src/shell.ts`, `tauri-shell/src/modules/explorerModule.ts`

#### Fonctionnement
- Le guide rapide apparaît dans la Home Screen **uniquement si le corpus démo est installé**
- Persistance : `localStorage["agrafes.onboarding.demo.step"]` (0..3)
- Bouton "Réinitialiser le guide" pour recommencer

#### 3 étapes guidées
1. **Explorer "prince"** — Active la démo DB, navigue vers Explorer, pré-remplit la barre de recherche via `sessionStorage["agrafes.explorer.prefill"]`
2. **Rapport QA** — Active la démo DB, navigue vers Constituer + toast "Allez dans Exports → Rapport QA"
3. **Package publication** — Active la démo DB, navigue vers le wizard Publier

#### Welcome hint (Explorer)
- Si `sessionStorage["agrafes.explorer.prefill"]` est défini après montage : pré-remplit l'input de recherche + affiche un tooltip bleu transitoire (8s ou au premier Enter)
- Flag supprimé immédiatement après affichage (one-shot)

## V1.7.1 — Multi-DB MRU list + pin + missing-DB recovery

**Fichiers modifiés :** `tauri-shell/src/shell.ts`

### MRU (Most Recently Used) list

- Persisted in `localStorage["agrafes.db.recent"]` : array of `MruEntry` (path, label, last_opened_at, pinned?)
- Maximum 10 entries, deduplication on insert
- **Functions:** `_loadMru`, `_saveMru`, `_addToMru`, `_removeFromMru`, `_togglePinMru`

### UI — DB dropdown enrichi

- Ouvrir… / Créer… (unchanged)
- **Section "Récents"** : liste triée (pinned en haut, puis par date desc)
  - Clic = `_switchDb(path)` ou `_onChangeDb(path)` si introuvable
  - 📌 / 📍 : épingler/désépingler (action icon apparaît au hover)
  - ✕ : retirer de la liste
  - Badge "introuvable" (gris) si le fichier n'existe plus

### DB switching hardening (`_switchDb`)

- Désactive le bouton DB + onglets pendant le switch (état "Chargement…")
- Appelle `_initDb(path)` + remount du module actif si non-Home
- Ajoute au MRU + persiste + notifie les listeners
- `_onChangeDb(defaultPath?)` : ouvre dialog, délègue à `_switchDb`

### Async file-existence check (`_checkMruPaths`)

- Import dynamique `@tauri-apps/plugin-fs` pour vérifier si les paths existent
- Marque les entrées `missing: true` → badge gris + re-sélection forcée via dialog
- Rebuild la section MRU sans reconstruire tout le header
