# AGRAFES Shell — Briefing complet pour Claude Code Web

Compte-rendu de cadrage de **AGRAFES Shell**, l'application desktop unifiée. Détaille Shell ET ses composants embarqués (Prep, Explorer/Concordancier, moteur Python sidecar). À lire avant toute intervention.

État : **Shell 0.1.40 · Engine 0.8.4** · branche `development` (avril 2026).

---

## 1. Vue d'ensemble

**AGRAFES Shell** est l'application desktop unifiée que reçoivent les utilisateurs finaux. Elle englobe **deux apps frontend** (préparation + concordancier) et un **moteur Python** (sidecar HTTP local) dans un seul binaire signé/notarisé, distribué en `.dmg` / `.msi` / `.AppImage`.

```
                    ┌────────────────────────────────────────┐
                    │         AGRAFES Shell (binaire)        │
                    │                                         │
                    │  ┌─────────────────────────────────┐   │
                    │  │  Frontend Shell (TS)            │   │
                    │  │  ┌───────────┬───────────┐      │   │
                    │  │  │ Explorer  │ Constituer│      │   │
                    │  │  └───────────┴───────────┘      │   │
                    │  │  ⚠ Single webview (§ 12)         │   │
                    │  │     couplage de pannes JS         │   │
                    │  │  ⚠ Import source-level prep+app   │   │
                    │  │     versions couplées (§ 12)      │   │
                    │  └────────┬────────────────────────┘   │
                    │           │ Tauri IPC                   │
                    │  ┌────────▼────────────────────────┐   │
                    │  │  Backend Rust (~6 commands)     │   │
                    │  └────────┬────────────────────────┘   │
                    │           │ ⚠ spawn + stdin/stdout      │
                    │           │   séq. shutdown fragile     │
                    │           │   (cassée 3×, § 12)         │
                    │  ┌────────▼────────────────────────┐   │
                    │  │  multicorpus sidecar             │   │
                    │  │  (PyInstaller, externalBin)      │   │
                    │  │  HTTP loopback + portfile        │   │
                    │  │  ~55 endpoints                   │   │
                    │  │  ⚠ sidecar.py 9423 lignes         │   │
                    │  │     refactor backlog (§ 11)       │   │
                    │  └──────────────────────────────────┘   │
                    └─────────────────────────────────────────┘
                                       │
                                       ▼
                                  corpus.db
                                  (.agrafes_sidecar.json)
```

**Légende** : ⚠ = point de fragilité connu, voir section référencée. Le diagramme privilégie l'honnêteté à la pub : trois ⚠ pointent vers § 12 (limites/pièges en exploitation), un vers § 11 (dette planifiée).

**Principe clé** : Shell n'utilise **pas** d'iframes ni de webviews multiples. Il importe **les modules TypeScript de tauri-app et tauri-prep au niveau source** via Vite resolver, monte/démonte dynamiquement leurs apps. Une seule webview, un seul process Rust, un seul sidecar Python.

| Composant | Rôle | Distribution |
|-----------|------|--------------|
| **tauri-shell** | **Hub** — navigation, diagnostic, sidecar lifecycle | **Cible production** |
| **tauri-prep** | Préparation de corpus (import, segment, curate, align, export) | Standalone historique + embedded dans Shell |
| **tauri-app** | Concordancier (FTS, CQL, KWIC, collocations, stats) | Standalone historique + embedded dans Shell |
| **multicorpus_engine** | Moteur Python (sidecar HTTP + CLI) | PyInstaller bundlé dans Shell |

La roadmap pousse vers **un seul produit livré : Shell**. Les standalone tauri-prep/tauri-app existent toujours pour le dev mais ne sont plus la cible distribution.

---

## 2. Composant 1 — tauri-shell (orchestrateur)

[tauri-shell/](tauri-shell/) — TypeScript + Rust. Versions : `tauri.conf.json` v0.1.40 (livraison) ; `package.json` v0.1.28 (interne, non aligné, convention).

### 2.1 Structure

```
tauri-shell/
├── package.json                          v0.1.28 (interne)
├── tauri.conf.json (via src-tauri)      v0.1.40 (livraison)
├── index.html, vite.config.ts, tsconfig.json
├── src/                                  FRONTEND TS
│   ├── main.ts                           bootstrap
│   ├── shell.ts                          ~2200 lignes — app principale
│   ├── context.ts                        SharedContext (DB path)
│   ├── diagnostics.ts                    collectDiagnostics + formatDiagnosticsText (purs, testables)
│   ├── styleRegistry.ts                  gestion CSS dynamique
│   └── modules/
│       ├── explorerModule.ts             onglet Explorer (concordancier + recherche)
│       ├── constituerModule.ts           onglet Constituer (prep + conventions)
│       ├── rechercheModule.ts            sub-tab Recherche grammaticale CQL
│       └── conventionsModule.ts          sub-tab Conventions (rôles d'unités)
├── src-tauri/                            BACKEND RUST
│   ├── tauri.conf.json
│   ├── tauri.windows.conf.json           NSIS perMachine override Windows
│   ├── Cargo.toml
│   ├── build.rs                          copie binaire sidecar depuis binaries/
│   ├── src/main.rs                       6 #[tauri::command]
│   └── binaries/                         sidecar PyInstaller bundlé
│       ├── multicorpus-macos-arm64
│       ├── multicorpus-linux-x86_64
│       ├── multicorpus-windows-x64.exe
│       └── sidecar-manifest.json         généré par CI (sha256 + version)
├── scripts/
│   ├── test_diagnostics.mjs              42 tests purs Node.js
│   └── test_style_registry.mjs           idem
└── public/                               assets
```

### 2.2 Backend Rust — [src-tauri/src/main.rs](tauri-shell/src-tauri/src/main.rs)

Six commands `#[tauri::command]` exposées au frontend via `invoke()` :

| Command | Rôle |
|---------|------|
| `sidecar_fetch_loopback(url, body, headers)` | Proxy HTTP loopback (127.0.0.1, localhost, ::1 strict). Bypass nécessaire car Tauri 2 bloque le scope HTTP loopback dynamique. |
| `read_text_file_raw(path)` | Lecture restreinte au portfile `.agrafes_sidecar.json` uniquement (guard explicite sur le nom). |
| `write_sidecar_log(line)` | Append dans `$APPDATA/com.agrafes.shell/sidecar-debug.log`. Évite rebuild Cargo en dev. |
| `register_sidecar(url, token)` | Stocke URL+token dans `tauri::State` pour shutdown propre. |
| `shutdown_sidecar_cmd()` | POST `/shutdown` au sidecar enregistré (async, best-effort). Appelé sur `WindowEvent::CloseRequested` avec `prevent_close()` puis `window.close()` async. |
| `fetch_github_latest_release(owner, repo)` | Vérification update — validation regex owner/repo, User-Agent obligatoire. |

**Plugins Tauri activés** : `tauri-plugin-shell` (spawn sidecar), `tauri-plugin-fs` (DB), `tauri-plugin-dialog` (file picker), `tauri-plugin-http` (frontend HTTP), `tauri-plugin-deep-link` (`agrafes-shell://`).

[build.rs](tauri-shell/src-tauri/build.rs) copie le binaire sidecar plateforme-spécifique avant build Tauri (`externalBin: ["multicorpus"]`).

### 2.3 Frontend Shell — [src/shell.ts](tauri-shell/src/shell.ts)

Entry point ~2200 lignes. Responsabilités :

- **`initShell()`** — bootstrap : prefs localStorage, event listeners, monte module initial.
- **Header fixe 44px** — brand cliquable (= retour home), tabs (Explorer / Constituer / Recherche), DB trigger, accent dynamique par mode (bleu/vert).
- **Navigation** — body remplacé entièrement à chaque tab change (`div#app`). Deep-linking via `location.hash`.
- **DB centralisée** — `_currentDbPath` source unique. Modules enfants reçoivent via [SharedContext](tauri-shell/src/context.ts). Persistance `localStorage["agrafes.shell.last_db_path"]`.
- **Diagnostic menu** — modal "?" via [diagnostics.ts](tauri-shell/src/diagnostics.ts) : sidecar health, DB path redacté, prefs, log tail. Boutons Copier/Exporter `.txt`.

### 2.4 Modules Shell

| Module | Sub-tabs | Source réutilisée |
|--------|----------|-------------------|
| [explorerModule.ts](tauri-shell/src/modules/explorerModule.ts) | concordancier · recherche | `tauri-app/initApp/disposeApp` |
| [constituerModule.ts](tauri-shell/src/modules/constituerModule.ts) | preparer · conventions | `tauri-prep/App` (instanciée) + `conventionsModule` |
| [rechercheModule.ts](tauri-shell/src/modules/rechercheModule.ts) | CQL builder + KWIC + stats + collocations | `tauri-app/features/search.ts` (validator) |
| [conventionsModule.ts](tauri-shell/src/modules/conventionsModule.ts) | CRUD conventions + `text_start_n` | sidecar `/conventions/*` |

**Bridges** :
- Event `agrafes:open-prep-token` : Explorer émet vers Shell pour ouvrir Prep sur un doc.
- `localStorage["agrafes.shell.last_mode"]` : préserve tab actif.

---

## 3. Composant 2 — tauri-prep (préparation, embedded)

[tauri-prep/](tauri-prep/) — TypeScript/Vite. Version package.json 0.1.28. C'est le composant le plus volumineux côté frontend (~25k lignes TS).

### 3.1 Vues (8 écrans)

| Écran | Fichier | Rôle |
|-------|---------|------|
| **ImportScreen** | [tauri-prep/src/screens/ImportScreen.ts](tauri-prep/src/screens/ImportScreen.ts) | Sélection fichiers, profil de lot, post-import family dialog (mode child OU parent depuis v0.1.41) |
| **SegmentationView** | [tauri-prep/src/screens/SegmentationView.ts](tauri-prep/src/screens/SegmentationView.ts) | Preview phrases/balises [N], édition merge/split, filtres anomalies (Segments courts + Ponctuation orpheline langue-aware DE/FR) |
| **CurationView** | [tauri-prep/src/screens/CurationView.ts](tauri-prep/src/screens/CurationView.ts) (~3750 lignes) | Presets, F/R, mode Trouver, preview diff, review locale (accept/ignore/manual override), exceptions persistantes |
| **AlignPanel** | [tauri-prep/src/screens/AlignPanel.ts](tauri-prep/src/screens/AlignPanel.ts) | Alignement par external_id/position/similarity, audit, collisions, retarget, mode révision famille |
| **AnnotationView** | [tauri-prep/src/screens/AnnotationView.ts](tauri-prep/src/screens/AnnotationView.ts) (~818 lignes) | Annotation lexicale unitaire (dormant — pas de feature work récent) |
| **MetadataScreen** | [tauri-prep/src/screens/MetadataScreen.ts](tauri-prep/src/screens/MetadataScreen.ts) | Auteur/date/biblio, rôles unités, relations parent/enfant, bulk update, audit |
| **ExportsScreen** | [tauri-prep/src/screens/ExportsScreen.ts](tauri-prep/src/screens/ExportsScreen.ts) | TEI strict, TMX bilingue, CSV long, JSONL, SKE, audit, QA gate |
| **ActionsScreen** | [tauri-prep/src/screens/ActionsScreen.ts](tauri-prep/src/screens/ActionsScreen.ts) | Index FTS rebuild, dispatcher |

### 3.2 Lib clés

- [sidecarClient.ts](tauri-prep/src/lib/sidecarClient.ts) — client HTTP, types contractuels, lifecycle (spawn/portfile/health polling). **Aussi utilisé par tauri-app** : seule instance dans Shell.
- [modalConfirm.ts](tauri-prep/src/lib/modalConfirm.ts) — modal centré générique (remplace `window.confirm()` non fiable en Tauri).
- [inlineConfirm.ts](tauri-prep/src/lib/inlineConfirm.ts) — confirmation inline strip.
- [diff.ts](tauri-prep/src/lib/diff.ts) — diff visuel pour curation preview.
- [curationFingerprint.ts](tauri-prep/src/lib/curationFingerprint.ts), [curationReview.ts](tauri-prep/src/lib/curationReview.ts) — persistence locale review.

### 3.3 CSS

[tauri-prep/src/ui/app.css](tauri-prep/src/ui/app.css) — ~6000 lignes, namespace `prep-*`. Importée intégralement par Shell.

### 3.4 Workflow utilisateur prep

```
ImportScreen ─▶ SegmentationView ─▶ CurationView ─▶ AlignPanel ─▶ ExportsScreen
                       │                  │                │
                  AnnotationView ◀────────┤                │
                                          │                │
                                  MetadataScreen ◀─────────┘
```

1. **Import** — DOCX `[n]`, paragraphes, TEI, CoNLL-U. Détection familles auto par radical. Modal post-import (child ou parent).
2. **Segmentation** — phrases vs balises, merge/split, filtres anomalies.
3. **Curation** — presets (espaces, guillemets, ponctuation FR/EN, invisibles, numérotation), F/R, preview diff côte-à-côte, review locale, exceptions persistantes.
4. **Alignement** — external_id/position/similarity, review famille, collisions, retarget par segment.
5. **Métadonnées** — biblio, rôles unités, relations parent/enfant (auto-assign `doc_role` cohérent), bulk update.
6. **Exports** — TEI parcolab_strict, TMX, CSV, SKE. QA gate optionnel.

---

## 4. Composant 3 — tauri-app (concordancier/explorer, embedded)

[tauri-app/](tauri-app/) — TypeScript/Vite. Version package.json 0.1.28. `agrafes-concordancier`. Application **monolithique à panneaux** (pas d'onglets internes).

### 4.1 Architecture

```
main.ts → initApp() (app.ts)
  ├─→ buildUI() [ui/buildUI.ts]            construction DOM complète
  ├─→ resolveInitialDbPath() [bootstrap.ts] détection DB (URL search, deep-link, default)
  ├─→ startSidecar(dbPath) [bootstrap.ts]   ensureRunning + portfile + health poll
  └─→ setMetaOpener / setRerenderCallback / setFilterDocCallback (DI)

state.ts (singleton AppState)

features/
  ├─ query.ts          orchestration recherche, pagination IntersectionObserver, virtual cap 150
  ├─ search.ts         buildFtsQuery (PUR), validateCqlSyntax (PUR), updateFtsPreview
  ├─ filters.ts        loadDocsForFilters, populateDropdowns
  ├─ docSelector.ts    multi-doc checklist (persistée localStorage)
  ├─ stats.ts          fréquences lexicales, mode simple + A/B compare
  ├─ export.ts         JSONL simple/parallel, CSV flat/long/family
  ├─ history.ts        localStorage "agrafes.explorer.history" (max 10)
  ├─ importFlow.ts     modal import + POST /import + rebuild FTS
  └─ metaPanel.ts      open/close panneau métadonnées

ui/
  ├─ buildUI.ts        DOM + event listeners
  ├─ results.ts        renderHit (segment | KWIC card), aligned grouping
  ├─ dom.ts            elt, escapeHtml, CSS injection
  └─ status.ts         toasts

lib/
  ├─ sidecarClient.ts  ~1434 lignes — réutilisé depuis tauri-prep dans Shell
  └─ db.ts             persistance DB path
```

### 4.2 Vues principales (panneaux)

UI monolithique — éléments montrés/masqués via class `hidden` :

- **Topbar + toolbar de recherche** : input FTS/regex/CQL, mode Segment/KWIC, toggles (Alignés, Parallèle, Source modifiée, Case-sensitive), fenêtre contextuelle.
- **Zone résultats** `#results-area` : cartes de concordance, pagination IntersectionObserver, virtual cap 150 cartes simultanées.
- **Panneau filtres** `#filter-drawer` (hidden default) : multi-docs checklist, langue, rôle, type ressource, famille, auteur, titre, date, extension, DBs fédérées.
- **Panneau builder** `#builder-panel` : modes simple/phrase/AND/OR/NEAR/regex/CQL + aperçu coloré.
- **Historique** `#hist-panel` : 10 dernières requêtes (pin optionnel).
- **Stats lexicales** `#stats-panel` : freq simple ou compare A/B (top-N, KPI, barres visuelles, export CSV).
- **Modaux** : import, aide FTS.
- **Panneau méta** `#meta-panel` : texte unité, métadonnées doc, contexte local (`/unit/context`), alignements, historique modifs (curation).

### 4.3 Recherche

[features/search.ts](tauri-app/src/features/search.ts) — **logique pure** (pas de DOM, pas de sidecar) :

- **`buildFtsQuery(raw, mode, nearN)`** — construit la query FTS5 selon mode :
  - `simple` : passthrough
  - `phrase` : `"…"`
  - `and` : `t1 AND t2 AND …`
  - `or` : `t1 OR t2 OR …`
  - `near` : `NEAR(tokens, N)`
  - `regex` : flag pour scan Python full-scan
  - `cql` : flag pour endpoint `/token_query`
  - **Détection passthrough** : si input contient `AND|OR|NOT|NEAR` ou guillemets, transformation contournée.
- **`validateCqlSyntax(raw)`** — parse léger, détecte `[token_predicate]` (word/lemma/pos/upos/xpos/feats), quantificateurs `{m,n}`, `within s`. Ne valide pas la sémantique regex (déléguée à Python).
- Tests : [tauri-app/scripts/test_buildFtsQuery.mjs](tauri-app/scripts/test_buildFtsQuery.mjs) — exhaustifs Node.js ESM.

### 4.4 KWIC display + alignés + familles

- Modes affichage : `segment` (texte unité brut) ou `kwic` (left | match | right).
- **Aligned toggle** : `state.showAligned` inclut unités alignées du couple, regroupées par (langue, doc_id, titre).
- **Family scope** : `state.filterFamilyId` restreint à un parent + enfants, force aligned=true, auto-expand.
- **Pagination append** : `appendResultCards()` incrémental, sauf mode by-doc qui force full rerender pour groupes.
- **Virtual cap** : 150 cartes visibles simultanément, anciennes masquées pour perf.
- **Tri** (Sprint G) : toggle "Par doc" qui groupe les hits par `doc_id` + position.

### 4.5 Exports tauri-app

[features/export.ts](tauri-app/src/features/export.ts) :
- `jsonl-simple` — un JSON par ligne (QueryHit brut)
- `jsonl-parallel` — pivot + aligned groupés
- `csv-flat` — colonnes pivot + N colonnes aligned
- `csv-long` — pivot répétée pour chaque aligned
- `csv-family` — déclaré

### 4.6 Stats lexicales

[features/stats.ts](tauri-app/src/features/stats.ts) — endpoint `/stats/lexical` (mode simple) ou `/stats/compare` (A/B). Métriques **fréquences uniquement**. PMI/G²/log-likelihood vivent dans `rechercheModule.ts` (Shell) qui appelle `/token_stats` et `/token_collocates`.

### 4.7 Exports pour Shell

[tauri-app/src/app.ts](tauri-app/src/app.ts) exporte `initApp()`, `disposeApp()`. Utilisés par [tauri-shell/src/modules/explorerModule.ts](tauri-shell/src/modules/explorerModule.ts) pour intégrer tauri-app dans le sub-tab "Concordancier".

---

## 5. Composant 4 — multicorpus_engine (sidecar Python)

[src/multicorpus_engine/](src/multicorpus_engine/) — Python 3.12, version 0.8.4. UI-independent : CLI `multicorpus` + bibliothèque + sidecar HTTP.

### 5.1 Modules

| Module | Rôle |
|--------|------|
| [sidecar.py](src/multicorpus_engine/sidecar.py) (9423 lignes, 178 handlers) | Serveur HTTP stdlib, ~55 endpoints, jobs asynchrones — **monolithique, candidat refactor** |
| [sidecar_contract.py](src/multicorpus_engine/sidecar_contract.py) (~3500 lignes) | Schémas OpenAPI, codes erreur (`ERR_BAD_REQUEST`, `ERR_NOT_FOUND`, etc.) |
| [cli.py](src/multicorpus_engine/cli.py) | CLI `multicorpus` (init/import/index/query/curate/segment/serve) |
| [importers/](src/multicorpus_engine/importers/) | docx_numbered_lines, docx_paragraphs, txt_*, odt_*, tei_importer, conllu |
| [exporters/](src/multicorpus_engine/exporters/) | tei, csv, jsonl, conllu, ske, tmx, bilingual, audit, run_report |
| [db/](src/multicorpus_engine/db/) | connection.py, migrations.py (~18 versions), diagnostics.py |
| [segmenter.py](src/multicorpus_engine/segmenter.py) | Découpe phrases/balises [N], packs langue (fr_strict, en_strict, default, auto) |
| [aligner.py](src/multicorpus_engine/aligner.py) | Stratégies external_id / position / similarity |
| [curation.py](src/multicorpus_engine/curation.py) | Règles regex sur text_norm, exceptions persistantes, **translator JS→Python** ($N → \\g<N>) |
| [annotator.py](src/multicorpus_engine/annotator.py) | Annotation lexicale, marqueurs |
| [query.py](src/multicorpus_engine/query.py), [cql_parser.py](src/multicorpus_engine/cql_parser.py), [token_query.py](src/multicorpus_engine/token_query.py) | Recherche FTS5 + CQL token-niveau |
| [token_collocates.py](src/multicorpus_engine/token_collocates.py), [token_stats.py](src/multicorpus_engine/token_stats.py) | Collocations, PMI, G², log-likelihood |
| [qa_report.py](src/multicorpus_engine/qa_report.py) | Audit qualité corpus (publication gate) |
| [metadata.py](src/multicorpus_engine/metadata.py), [corpus_info.py](src/multicorpus_engine/corpus_info.py) | Métadonnées doc/corpus |
| [runs.py](src/multicorpus_engine/runs.py) | Traçabilité d'exécutions |
| [unicode_policy.py](src/multicorpus_engine/unicode_policy.py) | Normalisation typographique (NBSP/NNBSP, guillemets) |

### 5.2 Endpoints sidecar (référence)

| Domaine | Endpoints clés |
|---------|----------------|
| Imports | `POST /import`, `POST /import/preview`, `GET /documents/preview` |
| Segmentation | `POST /segment`, `POST /segment/preview` (cap 5000), `POST /segment/detect_markers`, `POST /segment/propagate_preview` |
| Curation | `POST /curate`, `POST /curate/preview` (cap 5000), `GET/POST /curate/exceptions`, `GET /curate/apply-history` |
| Édition unitaire | `POST /units/merge`, `POST /units/split`, `POST /units/set_role` |
| Prep undo (Mode A) | `POST /prep/undo/eligibility` (read-only), `POST /prep/undo` (write) |
| Alignement | `POST /align`, `POST /align/audit`, `POST /align/quality`, `POST /align/link/{create,update_status,delete,retarget,acknowledge_source_change}`, `POST /align/collisions/resolve` |
| Métadonnées | `POST /documents/update`, `POST /documents/bulk_update`, `POST /documents/delete` |
| Familles | `GET /families`, `GET /doc_relations/all`, `POST /doc_relations/{set,delete}` |
| Conventions | `GET /conventions`, `POST /conventions/{create,update,delete}` |
| Index | `POST /index` (incremental + full rebuild) |
| Query | `POST /query`, `POST /token_query`, `POST /token_stats`, `POST /token_collocates`, `POST /query/facets`, `GET /unit/context` |
| Stats | `POST /stats/lexical`, `POST /stats/compare` |
| Exports | `POST /export/{tei,tmx,csv,jsonl,ske,bilingual,conllu,align_csv,run_report}` |
| Audit | `POST /qa-report`, `POST /corpus/audit` |
| Jobs | `GET /jobs`, `GET /jobs/{id}`, `POST /jobs` |
| Système | `GET /health`, `POST /shutdown`, `GET /openapi` |

Auth : `X-Agrafes-Token` requis sur tout POST mutant. Token HMAC-SHA256 généré au boot, écrit dans portfile.

---

## 6. Schéma SQLite (essentiel)

```
documents              (doc_id PK, title, language, doc_role, resource_type,
                        source_path, source_hash, text_start_n, workflow_status,
                        author_lastname/firstname, doc_date, translator_*,
                        work_title, pub_place, publisher, meta_json)

units                  (unit_id PK, doc_id FK, unit_type ∈ {line, structure},
                        n, external_id, text_raw, text_norm, meta_json,
                        unit_role FK→unit_role_conventions)

units_fts              (FTS5 virtuelle sur text_norm, unicode61 tokenizer)

alignment_links        (link_id PK, run_id, pivot_doc_id, pivot_unit_id,
                        target_doc_id, target_unit_id, status,
                        source_changed_at)

doc_relations          (id PK, doc_id, relation_type ∈
                        {translation_of, excerpt_of}, target_doc_id)

curation_exceptions    (unit_id PK, kind ∈ {ignore, override}, override_text)

unit_role_conventions  (name PK, label, color, icon, description)

curate_apply_history   (id PK, doc_id, applied_at, units_modified,
                        rules_signature)

tokens                 (CoNLL-U : word, lemma, upos, xpos, feats)

corpus_info            (singleton — title, description, meta_json)

schema_migrations      (version, applied_at)
```

Migrations dans [src/multicorpus_engine/db/migrations.py](src/multicorpus_engine/db/migrations.py) — 18 versions, ordre incrémental strict, immuables une fois appliquées.

---

## 7. Intégration cross-composants

### 7.1 Embedding source-level (trade-off architectural conscient)

Shell importe les modules TS de prep + app **au build** (Vite resolver). C'est un **choix d'arbitrage**, pas un avantage neutre — il a un envers à bien comprendre avant d'intervenir.

**Avantages** :
- Une seule webview, un seul process Rust, un seul sidecar Python — distribution simplifiée (un binaire pour tout).
- `sidecarClient` partagé : connexion sidecar unique cross-modules ([tauri-prep/src/lib/sidecarClient.ts](tauri-prep/src/lib/sidecarClient.ts)).
- Code source partagé : un fix dans `tauri-prep/src/screens/CurationView.ts` est répercuté dans Shell au prochain build, zéro duplication.

**Envers** :
- **Couplage de pannes JS** : un crash ou une exception non catchée dans Prep peut tearer down l'Explorer (et inversement). À ce jour aucun rapport user-visible sur 6 mois d'usage, mais le risque architectural est réel — à instrumenter (logs JS errors) plutôt que présumer absent.
- **Versions couplées** : bumper Shell capture l'état actuel de prep+app sur `development`. Pas de moyen direct de livrer un fix Shell urgent sans embarquer le WIP de prep. Mitigation actuelle : attendre que prep soit stable. Mitigation prévue (P3) : branches `stabilization/v0.1.X` qui cherry-pick uniquement les fixes Shell.
- **CSS surface** : Shell charge `tauri-prep/src/ui/app.css` (~6000 lignes namespace `prep-*`) + `tauri-app` + son propre CSS (`shell-*`). Les namespaces évitent la fuite **par discipline humaine** — aucun outil ne le force aujourd'hui. Migration vers CSS Modules en backlog.

Le trade-off reste défendable au stade actuel (cadence release mensuelle, équipe restreinte, base utilisateur connue) mais n'est pas une vérité éternelle. Si l'un de ces paramètres change, à reconsidérer.

### 7.2 Sidecar lifecycle dans Shell

1. Shell démarre, `_currentDbPath` lu depuis localStorage ou prompt utilisateur
2. Premier module enfant monté → appelle `ensureRunning(dbPath)` de sidecarClient
3. sidecarClient découvre/spawn sidecar, lit portfile, polls `/health`
4. Token + URL passés à Rust via command `register_sidecar`
5. À la fermeture (`WindowEvent::CloseRequested`) : `prevent_close()` → `shutdown_sidecar_cmd()` → `window.close()` async
6. Sidecar reçoit `/shutdown`, libère le port, exit propre

**Cette séquence a été cassée plusieurs fois historiquement** (cf. fix v0.1.39, ADR sur passage de `Destroyed` à `CloseRequested`). À tester manuellement après toute modif de la séquence.

### 7.3 Bridges inter-modules

- Event `agrafes:open-prep-token` : Explorer émet, Shell écoute, ouvre Constituer sur le doc demandé.
- `localStorage["agrafes.shell.last_mode"]` : préserve tab actif entre sessions.
- SharedContext expose DB path à tous les modules ; modif via le DB trigger header propage à tous.

---

## 8. Build & déploiement Shell

### 8.1 Sidecar bundling

- `externalBin: ["multicorpus"]` dans tauri.conf.json
- [build.rs](tauri-shell/src-tauri/build.rs) copie depuis `binaries/multicorpus-{platform}` (cherche direct, puis `-onedir`, puis `-onefile`)
- Binaire produit par : `python scripts/build_sidecar.py --preset shell --format onefile` (PyInstaller)
- `sidecar-manifest.json` : version + sha256 + plateforme, joint à chaque artifact

### 8.2 Workflows CI

| Workflow | Trigger | Produit |
|----------|---------|---------|
| [tauri-shell-build.yml](.github/workflows/tauri-shell-build.yml) | push tag `v*.*.*` | matrix macOS/Ubuntu/Windows : `.dmg`, `.deb`/`.AppImage`, `.msi`/`.exe` (unsigned) + sidecar-manifest |
| [macos-sign-shell.yml](.github/workflows/macos-sign-shell.yml) | secrets-gated | DMG signé + notarié + agrafé |
| [windows-sign-shell.yml](.github/workflows/windows-sign-shell.yml) | secrets-gated | `.exe`/`.msi` doublement signés (timestamp URL) |
| [build-sidecar.yml](.github/workflows/build-sidecar.yml) | tag push | sidecar PyInstaller seul (pour debug ou packagers tiers) |
| [smoke.yml](.github/workflows/smoke.yml) | PR + push | `ci_smoke_sidecar.py` matrix macOS/Ubuntu, no secrets |

**Sans secrets, les workflows de signature exit 0 gracieusement** — binaires non signés restent utilisables (avec warning Gatekeeper / SmartScreen).

### 8.3 Formats par plateforme

- **macOS** : `.app` + `.dmg` (universal2 si build sur Apple Silicon avec lipo)
- **Linux** : `.deb` + `.AppImage`
- **Windows** : `.msi` (NSIS perMachine, override [tauri.windows.conf.json](tauri-shell/src-tauri/tauri.windows.conf.json))

---

## 9. Tests

| Composant | Framework | Tests notables |
|-----------|-----------|----------------|
| moteur (Python) | pytest | `tests/test_v21.py` (rules_from_list), `tests/test_sidecar_v03.py` (par endpoint avec fixture `v03_sidecar`), `tests/test_sidecar_api_contract.py`, `tests/test_v21.py` (concordancer), `scripts/ci_smoke_sidecar.py` (E2E) |
| tauri-prep | Vitest + tests Vitest dans `__tests__/` | curationFingerprint, curationReview |
| tauri-app | Tests purs Node.js | [scripts/test_buildFtsQuery.mjs](tauri-app/scripts/test_buildFtsQuery.mjs) |
| tauri-shell | Tests purs Node.js (pas de Vitest) | [scripts/test_diagnostics.mjs](tauri-shell/scripts/test_diagnostics.mjs) (42 tests), [scripts/test_style_registry.mjs](tauri-shell/scripts/test_style_registry.mjs) |
| E2E Shell | Workflow CI dédié | `.github/workflows/tauri-e2e-fixture` |

**`ci_smoke_sidecar.py`** : crée DB temp → spawn sidecar via subprocess → lit portfile → wait `/health` → import 3-unit fixture → rebuild FTS → query "needle" → list documents → `/shutdown` → assert. Tourne en CI matrix Ubuntu/macOS sans secrets.

---

## 10. Conventions de dev

### 10.1 Branches & releases

- **Branches** : tout sur `development` (pas de `main` séparé). Tags `v0.1.X` lightweight depuis commits `chore(release): vX.Y.Z — résumé`.
- **Versionnage** : `python scripts/bump_version.py --engine X.Y.Z --shell X.Y.Z` synchronise pyproject + `__init__.py` + tauri.conf + shell.ts. Engine suit semver moteur, Shell suit livraison applicative.
- **Release procédure** : voir [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). Tag push → `tauri-shell-build.yml` + `build-sidecar.yml` produisent les binaires.
- **Commits** : préfixes Conventional `feat(scope):`, `fix(scope):`, `chore(release):`, `docs:`. Co-authored avec Claude marqué dans le footer.
- **CHANGELOG** : à jour à chaque release, format Keep a Changelog (Added/Changed/Fixed).

### 10.2 Spécifique Shell

- **Toute modification UI réutilisée** (bouton, modal, layout) doit être faite dans `tauri-prep/src/...` ou `tauri-app/src/...` puis prise en compte au prochain build Shell. **Ne pas dupliquer** dans `tauri-shell/src/`.
- **Logique propre Shell** (orchestration, diagnostic, deep-link, navigation) → `tauri-shell/src/modules/` et `tauri-shell/src/shell.ts`.
- **Rust commands** : `main.rs` + tauri.conf.json capabilities. Validation stricte des inputs (whitelist loopback, regex owner/repo).
- **Bumping** : `bump_version.py --shell X.Y.Z` met à jour tauri.conf + shell.ts:APP_VERSION. Le package.json reste à 0.1.28.
- **CSS namespace** : `prep-*` pour prep, `app-*` pour app, `shell-*` pour Shell propre.

---

## 11. État actuel — Shell 0.1.40 (avril 2026)

### 11.1 Sur `development` (post-tag v0.1.40)

- `lib/modalConfirm.ts` (tauri-prep) : helper centré générique remplaçant les 4 `window.confirm()` natifs de MetadataScreen — résout bug Tauri WebView où confirm() pouvait ne pas bloquer.
- Family dialog post-import enrichi : toggle child↔parent, mode parent permet de sélectionner N enfants en un pass.
- Filtres anomalies segmentation : « segments courts + voisins » et « ponctuation orpheline » (langue-aware DE).
- Message `/segment/preview` distingue 3 cas : doc inexistant, doc sans line units (hint « failed import »), doc OK.
- Cap `/segment/preview` aligné sur 5000 (était 300).

### 11.2 v0.1.40 (publié)

- Bug `$1` littéral dans text_norm — translator JS→Python ajouté dans curation.py.
- Modals mal positionnées (confirm curation inline en haut, family dialog sans CSS) — refonte modale centrée.
- Caps preview alignés sur 5000 (`/curate/preview` capait silencieusement à 50, raw pane à 800).
- Presets curation `spaces`/`quotes`/`punctuation_fr` réécrits idempotents.
- Layout preview tronqué — clamp ajusté.

### 11.3 v0.1.39

- Fix critique shutdown sidecar — `WindowEvent::Destroyed` → `CloseRequested` + `prevent_close()` + `window.close()` async.
- Auto doc_role sur création de relation famille.
- Bulk role select intégré (suppression de `prompt()` natif).

---

## 12. Limites connues / pièges à éviter

- **Tauri 2 et `window.confirm()`** : non fiable cross-platform. Toujours utiliser `lib/modalConfirm.ts` (centré) ou `lib/inlineConfirm.ts` (inline strip). **Jamais d'`alert()` ou `confirm()` natifs** dans Shell ou ses sub-apps.
- **Couplage versions** : bumper Shell capture prep+app dans leur état actuel sur development. Si on ne veut pas embarquer un changement WIP, **ne pas bumper Shell** tant que prep n'est pas stabilisée.
- **Sidecar shutdown sequence** : critique. Toute modif (`register_sidecar` → `shutdown_sidecar_cmd` → `window.close()`) doit être testée manuellement (le sidecar oublié reste running, port occupé). Symptôme : « Sidecar indisponible » au prochain lancement.
- **Build sidecar preset** : `--preset shell --format onefile` produit un binaire unique (~80MB). Sur Windows, onefile obligatoire ([ADR-037 dans docs/DECISIONS.md](docs/DECISIONS.md#adr-037--windows-sidecar-format-override-onedir--onefile-tauri-externalbin-constraint) — contrainte Tauri externalBin). Sur macOS, onefile aussi (Gatekeeper). Linux peut tolérer onedir.
- **Loopback whitelist** dans `sidecar_fetch_loopback` : strict — uniquement 127.0.0.1, localhost, ::1. Toute extension nécessite mise à jour de la regex Rust.
- **Deep-link — deux schémas hérités** : Shell utilise `agrafes-shell://`, les standalones prep+app utilisent `agrafes://`. C'est une **dette de migration**, pas un design final. Stratégie de résorption prévue : Shell accepte les **deux** schémas temporairement (compat), un log discret enregistre chaque réception `agrafes://` ; après 2 releases sans réception observée, retrait définitif de `agrafes://`. Casser des liens utilisateurs déjà enregistrés en Info.plist macOS / registre Windows pour propreté nominale serait un mauvais arbitrage — la migration progressive est intentionnelle.
- **Importer DOCX en table** : `docx_numbered_lines` n'itère que `document.paragraphs` (python-docx), rate les contenus en tableaux. Décision actuelle : workaround utilisateur (préparer le DOCX en flux unique). Voir hint UX dans SegmentationView pour les docs avec 0 line units.
- **Backreferences regex curation** : utiliser syntaxe JS `$1`/`$&`/`$$` côté frontend — le translator backend convertit. NE PAS envoyer du `\g<1>` brut. Note : le translator gère REPLACEMENT, pas PATTERN — `\p{L}` n'est pas supporté en Python `re` (utiliser `[A-Za-zÀ-Ÿ]` explicite).
- **Caps hardcodés (5000 unités raw pane, 150 cartes virtuelles tauri-app)** : valeurs **provisoires posées à la louche**, pas mesurées empiriquement. Couvrent les corpus connus (le plus gros utilisateur : 1247 unités) mais sans benchmark formel. Plan de validation : **instrumenter en prod** plutôt que benchmark offline — log discret quand un cap est touché, comptage sur 3 mois, ajustement seulement si signal réel arrive. Virtual scrolling propre (~1 semaine) à déclencher au premier ralentissement signalé ou corpus >3000 unités importé. Les chiffres actuels ne sont pas une vérité, juste un point de départ.
- **NBSP intentionnelles** : ne JAMAIS écraser les ` ` (NBSP/NNBSP) systématiquement dans un preset (cf. fix v0.1.40 où `spaces` détruisait les insécables typographiques).
- **CSS namespace** : ajouter du CSS sans préfixe (`.foo` au lieu de `.shell-foo`/`.prep-foo`/`.app-foo`) risque de fuiter sur d'autres apps Tauri du repo.
- **Lightweight tags vs annotated** : convention projet = lightweight (objecttype `commit`). Ne pas créer d'annotated tags.
- **`sidecar.py` à 9423 lignes / 178 handlers** : monolithique, candidat à découpage par routers domaine (imports/curation/alignement/query/exports). Refactor ~2-3 jours, pas urgent mais à programmer dès qu'une grosse feature pointe.

---

## 13. Pointeurs documentaires

| Doc | Contenu |
|-----|---------|
| [docs/SIDECAR_API_CONTRACT.md](docs/SIDECAR_API_CONTRACT.md) | Référence API exhaustive |
| [docs/openapi.json](docs/openapi.json) | Schéma OpenAPI machine-readable |
| [docs/DECISIONS.md](docs/DECISIONS.md) | ADR-001 à ~ADR-041 (architecture, schéma, choix) |
| [docs/DESIGN.md](docs/DESIGN.md) | Tokens UI, design system |
| [docs/UX_FLOW_PREP.md](docs/UX_FLOW_PREP.md) | Flux utilisateur prep |
| [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) | Procédure release |
| [docs/STATUS_TAURI_PREP.md](docs/STATUS_TAURI_PREP.md) | État frontend prep |
| [docs/STATUS_TAURI_SHELL.md](docs/STATUS_TAURI_SHELL.md) | État Shell |
| [docs/TEI_PROFILE.md](docs/TEI_PROFILE.md) | Profil TEI (parcolab_strict) |
| [docs/INTEGRATION_TAURI.md](docs/INTEGRATION_TAURI.md) | Intégration Tauri ↔ sidecar |
| [docs/SIDECAR_SECURITY_POSTURE.md](docs/SIDECAR_SECURITY_POSTURE.md) | Sécurité sidecar (HMAC, loopback) |
| [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) | Stratégie de distribution |
| [docs/BACKLOG*.md](docs/) | Backlogs CQL, familles, recherche grammaticale, audit prep |
| [CHANGELOG.md](CHANGELOG.md) | Historique versions |

---

## 14. Comment intervenir

### 14.1 Bug ou feature dans Shell propre (orchestration)
- `tauri-shell/src/shell.ts` ou `tauri-shell/src/modules/*Module.ts`
- Test en dev : `npm --prefix tauri-shell run tauri dev`
- Build local : `npm --prefix tauri-shell run build` puis `npm --prefix tauri-shell run tauri build`

### 14.2 Bug Rust (sidecar shutdown, GitHub fetch, log, loopback)
- `tauri-shell/src-tauri/src/main.rs`
- Cargo build local + smoke test à la main (sidecar lance, `/shutdown` répond, port libéré)
- Validation stricte des inputs obligatoire — pattern récurrent

### 14.3 Nouveau Rust command
- `main.rs` (#[tauri::command] + register dans `invoke_handler`)
- `tauri.conf.json` capabilities
- Côté JS : `import { invoke } from '@tauri-apps/api/core'`

### 14.4 Bug ou feature Prep (préparation)
- `tauri-prep/src/screens/<View>.ts` ou `tauri-prep/src/lib/<file>.ts`
- CSS dans `tauri-prep/src/ui/app.css` namespace `prep-*`
- Test : `npm --prefix tauri-prep run dev` (standalone) ou rebuild Shell pour intégration
- Conventions : utiliser `modalConfirm`/`inlineConfirm`, jamais natif

### 14.5 Bug ou feature Concordancier (recherche)
- `tauri-app/src/features/<file>.ts` (search.ts pour query building, query.ts pour orchestration)
- UI : `tauri-app/src/ui/buildUI.ts` ou `results.ts`
- Tests : `tauri-app/scripts/test_buildFtsQuery.mjs`
- Test : `npm --prefix tauri-app run dev` (standalone) ou rebuild Shell

### 14.6 Bug moteur / sidecar
- `src/multicorpus_engine/`
- Tests d'abord : `pytest -q -k <pattern>`
- Smoke E2E : `python scripts/ci_smoke_sidecar.py`
- Bumper engine si changement publique : `bump_version.py --engine X.Y.Z`

### 14.7 Nouveau endpoint sidecar
- Ajouter dans `sidecar.py` (handler `_handle_X` + dispatch dans `do_POST`)
- Schéma dans `sidecar_contract.py`
- Régénérer `docs/openapi.json` (script à vérifier : `scripts/export_openapi.py`)
- Types TypeScript dans `tauri-prep/src/lib/sidecarClient.ts` (réutilisé par tauri-app)
- Test dans `tests/`

### 14.8 Nouveau preset curation
- `CURATE_PRESETS` dans `tauri-prep/src/screens/CurationView.ts`
- Vérifier idempotence + compatibilité ordre avec autres presets
- Penser au translator `$N` → `\g<N>` (déjà central dans curation.py)
- Tester sur des cas mêlant NBSP et NNBSP

### 14.9 Nouvelle migration DB
- `src/multicorpus_engine/db/migrations.py` — ordre incrémental strict
- **Jamais modifier une migration appliquée** (ajouter une nouvelle qui corrige)
- Tester `pytest tests/test_migrations*.py`

### 14.10 Bug diagnostic Shell (menu "?")
- `tauri-shell/src/diagnostics.ts` (purs)
- Tests : `node tauri-shell/scripts/test_diagnostics.mjs`

### 14.11 Modif workflow CI
- `.github/workflows/tauri-shell-build.yml` (build matrix)
- `.github/workflows/macos-sign-shell.yml` ou `windows-sign-shell.yml` (signing, secrets-gated)
- Tester sur PR avant push tag
- Si secrets absents, workflows doivent skip gracieusement (`exit 0`)

### 14.12 Bump release Shell
1. `python scripts/bump_version.py --shell X.Y.Z` (et `--engine` si moteur changé)
2. CHANGELOG.md : ajouter entrée `## [0.1.X] - YYYY-MM-DD` avec sections Added/Changed/Fixed
3. `git commit -m "chore(release): vX.Y.Z — résumé"`
4. `git tag vX.Y.Z` (lightweight, pas annotated)
5. `git push origin development && git push origin vX.Y.Z`
6. CI déclenche : tauri-shell-build → sign workflows → release attach
7. `gh release create vX.Y.Z --title "..." --notes-from CHANGELOG`

---

**Ce briefing est volontairement exhaustif** pour qu'un Claude Code Web qui n'a jamais vu le repo puisse intervenir sur n'importe quelle couche (Shell / Prep / App / moteur) sans demander de contexte supplémentaire. Les références entre crochets pointent vers les fichiers de référence pour aller plus loin.
