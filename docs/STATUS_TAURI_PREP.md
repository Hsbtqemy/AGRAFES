# Status — Concordancier Prep (tauri-prep) V0

**Last updated:** 2026-03-08 (P6 — extraction CSS PREP_CSS vers fichiers Vite-managed)

Current contract/runtime reference:
- `CONTRACT_VERSION = 1.4.6`
- `docs/openapi.json` currently exposes 35 paths
- Execution plan reference: `docs/PREP_IMPLEMENTATION_PLAN.md`
- Plan status: Phase 0–6 done; **vNext UI Pilot (P0 + P1 + P2) done**
- Redesign plan: `docs/PREP_UI_REDESIGN_PLAN.md`

---

## P6 — Extraction CSS PREP_CSS (2026-03-08) — fait

### Problème

`app.ts` contenait une constante JS `PREP_CSS` (~67 kB, ~768 lignes) injectée inline dans `<head>`
à chaque `App.init()`. Depuis P3-B un guard idempotent évitait l'accumulation, mais le CSS restait
embarqué dans le bundle JS, gonflant `constituerModule.js` (shell) et `index.js` (standalone).

### Solution

- Extraction vers deux fichiers CSS Vite-managed :
  - `tauri-prep/src/ui/app.css` — règles globales (`:root`, topbar, widgets, screens, layout vNext)
  - `tauri-prep/src/ui/job-center.css` — classes `.jc-*` (ex-`JOB_CENTER_CSS`)
- `main.ts` importe les deux fichiers (standalone build).
- `constituerModule.ts` importe les deux fichiers (embedded build) ; `ensureStyleTag` supprimé.
- `app.ts` : `PREP_CSS` vidé (kept as `""` pour P7), injection inline supprimée, `PREP_STYLE_ID` retiré.

### Impact bundle

| Artifact | Avant P6 | Après P6 | Delta |
|---|---|---|---|
| `tauri-prep dist/index-*.js` | 251.72 kB | 215.89 kB | **−35.83 kB** |
| `tauri-prep dist/index-*.css` | 13.14 kB | 39.73 kB | +26.59 kB |
| `tauri-shell constituerModule-*.js` | 238.03 kB | 201.99 kB | **−36.04 kB** |
| `tauri-shell constituerModule-*.css` | (absent) | 28.91 kB | nouveau chunk |

Le JS est allégé ; le CSS est désormais un asset à part entière (cache browser, HMR, séparation).

### Fichiers touchés

- `tauri-prep/src/ui/app.css` — **nouveau**
- `tauri-prep/src/ui/job-center.css` — **nouveau**
- `tauri-prep/src/main.ts` — imports CSS ajoutés
- `tauri-prep/src/app.ts` — `PREP_CSS`, `PREP_STYLE_ID`, injection supprimés
- `tauri-shell/src/modules/constituerModule.ts` — imports CSS ; `ensureStyleTag` supprimé

### Invariants post-P6

- `node tauri-shell/scripts/test_style_registry.mjs` → 20/20
- `node tauri-app/scripts/test_buildFtsQuery.mjs` → 26/26
- `npm --prefix tauri-prep run build` → vert
- `npm --prefix tauri-shell run build` → vert

---

## vNext UI Pilot (P0) — fait

- [x] CSS architecture : `src/ui/{tokens,base,components,prep-vnext}.css` + `src/vite-env.d.ts`
- [x] `main.ts` : imports CSS pour build standalone
- [x] `app.ts` CSS constant : ajout classes sidebar + curation workspace (compatibilité tauri-shell)
- [x] `app.ts` `_buildUI()` : sidebar layout vNext (`.prep-shell` / `.prep-nav` / `.prep-nav-tab` / collapse toggle / Actions sub-tree)
- [x] `ActionsScreen.ts` curation section : workspace 3 colonnes (params gauche · preview centrale sticky · diagnostics droite)
- [x] `_runPreview()` : panel toujours visible, `_renderCurateDiag()` + `_renderCurateMinimap()` appelés après preview
- [x] `_runCurate()` : reset contenu preview au lieu de `display:none`
- [x] `docs/PREP_UI_REDESIGN_PLAN.md` : inventaire visuels, mapping, P0/P1/P2, tokens

**Comment tester :**
```bash
# Dev standalone (port 1421)
npm --prefix tauri-prep run dev

# Dev via shell (port 1422)
npm --prefix tauri-shell run dev
# → onglet "Constituer" → sidebar gauche, onglet Actions → section Curation 3 colonnes
```

## vNext UI Pilot (P1) — fait

- [x] `ActionsScreen.ts` pane brut : `_renderRawPane()` remplit `#act-preview-raw` avec `ex.before` de `curatePreview()`; reset à `_runCurate()` success
- [x] `ActionsScreen.ts` segmentation 2-col : section restructurée en `.seg-workspace` (360px gauche · 1fr droite sticky)
  - colonne gauche : contrôles + `<details class="seg-batch-overview">` avec `#act-seg-batch-list`
  - colonne droite : `.seg-preview-card` sticky avec `#act-seg-preview-body` et `#act-seg-preview-info`
  - `_renderSegPreview()` : popule `.seg-stats-grid` depuis `_lastSegmentReport` après fin du job
- [x] `ActionsScreen.ts` segmentation VO batch : `_renderSegBatchOverview()` construit le tableau multilingue depuis `_docs`; badges `workflow_status` par doc; appelé depuis `_loadDocs()`
- [x] `ActionsScreen.ts` sidebar nav active : `IntersectionObserver` sur 3 cartes (curation / segmentation / alignement), `data-nav` sur les liens de l'arbre; `_updateNavActive()` marque le lien visible le plus haut
- [x] `app.ts` nav tree : `treeItems: Array<[string, string, string]>` — ajout du `navKey`; `link.dataset.nav = navKey`; CSS `.prep-nav-tree-link.active`

**Comment tester :**
```bash
# Dev standalone (port 1421)
npm --prefix tauri-prep run dev

# Dev via shell (port 1422)
npm --prefix tauri-shell run dev
# → onglet "Constituer" → sidebar gauche, onglet Actions → section Curation 3 colonnes + Segmentation 2 colonnes
```

## vNext UI Pilot (P2) — fait

### P2-A — Cohérence CSS + audit tokens

- [x] `tokens.css` : ajout tokens typographie (`--prep-fs-xs/sm/body/base`), espacement (`--prep-sp-1/2/3/4/6`), statut (`--prep-ok-soft`, `--prep-ok-line`, `--prep-loading-pulse`)
- [x] `components.css` : remplacement des `font-size: 11px/12px` hardcodés par `var(--prep-fs-xs/sm)`; transitions + `:focus-visible` sur `.chip-v`; variant `.diag-v.ok`; nouvelles classes `.loading-hint`, `.status-counter-row`, `.status-counter`
- [x] `prep-vnext.css` : littéraux `font-size` dans les classes seg remplacés par tokens; livraison JS constant dans `app.ts` synchronisée

### P2-B — Responsive ≤ 900px

- [x] Breakpoint workspace seg : `1320px` → `1100px` (dans `prep-vnext.css` et constante JS `app.ts`)
- [x] Règle `@media (max-width: 900px)` : réduction `padding` sur `.seg-stats-grid`, `.seg-inner-body`, `.seg-preview-body`

### P2-C — États vides/chargement/erreur

- [x] `_runPreview()` : état chargement `<p class="loading-hint">Prévisualisation en cours…</p>` dans `#act-preview-raw` avant `await`; état erreur `.diag-v.warn` dans le catch
- [x] `_runSegment()` : état chargement `<p class="loading-hint">Segmentation en cours…</p>` dans `#act-seg-preview-body` juste après soumission du job
- [x] `_renderSegBatchOverview()` : compteurs de statut (`Validé` / `À revoir` / `Aucun`) affichés en `.status-counter` colorés dans le header `<summary>`

### P2-D — Accessibilité

- [x] Skip link `<a class="prep-skip-link" href="#prep-main-content">` injecté en tête de `_buildUI()`; CSS visible au focus
- [x] `<aside>` → `<nav>` avec `aria-label="Navigation Prep"` dans `_buildUI()`
- [x] Topbar : `role="banner"` ajouté
- [x] Bouton collapse : `aria-expanded` + `aria-controls="prep-nav"` initiaux; `_toggleNav()` les met à jour
- [x] Onglets : `aria-current="page"` sur l'onglet actif; `_switchTab()` le bascule
- [x] Zone principale : `id="prep-main-content"` + `role="main"`
- [x] Arbre nav : `aria-current="true"` géré par `_updateNavActive()` en sync avec la classe `.active`

### P2-E — Cycle de vie IntersectionObserver

- [x] `_navObserver: IntersectionObserver | null` et `_visibleSections: Map<string, DOMRectReadOnly>` comme champs de classe
- [x] `render()` : `this._navObserver?.disconnect()` + `this._visibleSections.clear()` avant recréation
- [x] `_updateNavActive()` : tie-break par `rect.top` minimal → un seul lien actif même si plusieurs sections visibles
- [x] `setConn(null)` : `disconnect()` + `null` + `clear()` pour libérer l'observer à la déconnexion

**Résultat build :**
- tauri-prep : ✅ **251.43 kB JS, 13.14 kB CSS** (0 erreurs TS)
- pytest : ✅ 391 passing
- JS FTS tests : ✅ 26 passed

---

## Done

- [x] `GET /documents` added to sidecar (lists all docs with unit_count)
- [x] `POST /align` added to sidecar (strategies: external_id / position / similarity)
- [x] OpenAPI spec updated (DocumentRecord, DocumentsResponse, AlignRequest, AlignResponse)
- [x] 5 new tests for /documents and /align (contract + error cases)
- [x] `docs/CHARTER_TAURI_PREP_AGENT.md` created
- [x] `docs/BACKLOG.md` updated with tauri-prep V0/V0.1/V1 items
- [x] `tauri-prep/` scaffold created (package.json, vite.config.ts, tsconfig.json, index.html)
- [x] `tauri-prep/src/lib/sidecarClient.ts` — Conn, ensureRunning, all API calls
- [x] `tauri-prep/src/lib/db.ts` — getOrCreateDefaultDbPath, current DB path helpers
- [x] `tauri-prep/src/screens/ProjectScreen.ts` — DB open/create, sidecar status, shutdown
- [x] `tauri-prep/src/screens/ImportScreen.ts` — batch import (2 concurrent), index button, log
- [x] `tauri-prep/src/screens/ActionsScreen.ts` — curate/segment/align with confirmation + doc selector
- [x] `tauri-prep/src/app.ts` — tab nav (Project | Import | Actions)
- [x] `tauri-prep/src/main.ts` — entry point
- [x] `tauri-prep/src-tauri/` — tauri.conf.json, Cargo.toml, build.rs, src/main.rs, capabilities/default.json
- [x] `tauri-prep/src-tauri/binaries/.gitkeep`
- [x] `tauri-prep/scripts/prepare_sidecar.sh` + `.ps1`
- [x] `tauri-prep/README.md` — dev launch instructions
- [x] `docs/UX_FLOW_PREP.md` — règles UX de navigation et branchements (document courant vs batch, fin de flux)
- [x] Open in Concordancier helpers (copy DB path + workflow instructions modal)
- [x] Documents tab workflow wiring: `draft/review/validated` badge in list + status selector + quick actions ("Marquer à revoir", "Valider ce document")
- [x] Segmentation fast-path: "Segmenter + valider ce document" (Actions tab) updates workflow_status then redirects to Documents
- [x] Segmentation post-validation routing preference (`Documents` / `Document suivant` / `Rester sur place`) persisted in localStorage
- [x] Deep-link handoff to unified Shell: `agrafes-shell://open-db?mode=explorer&path=...` (topbar button + fallback)
- [x] Segmentation quality pack selector in Actions (`auto`, `default`, `fr_strict`, `en_strict`) + sidecar `/segment` and async job support (`params.pack`)
- [x] Advanced align strategy in Actions: `external_id_then_position` (hybrid fallback) + sidecar `/align` + `/jobs/enqueue` support
- [x] Align explainability option: `debug_align` on `/align` and align jobs; debug sources/stats logged in Actions screen
- [x] Align explainability panel in Actions: structured per-target diagnostics + "Copier diagnostic JSON" button
- [x] Actions runtime UX state banner:
  - session state shown in UI (`sidecar indisponible` / `opération en cours` / `prévisualisation en attente` / `aucun alignement` / `prêt`)
  - state updates live after preview, audit load, success/error logs, and busy transitions
- [x] Runtime unsaved-change guard (inter-onglets):
  - tab switch now prompts confirmation when pending changes are detected
  - `Actions`: pending curation preview not yet applied
  - `Documents`: edited metadata form, relation draft, or bulk draft values
  - browser close/refresh guard mirrors current-tab pending state (`beforeunload`)
- [x] Documents tab DB backup action:
  - `Sauvegarder la DB` button calls sidecar `POST /db/backup`
  - backend writes timestamped backup file (`<db_stem>_<timestamp>.db.bak`)
  - UI displays latest backup status and logs full backup path
- [x] Segmentation quality benchmark harness:
  - `bench/fixtures/segmentation_quality_cases.json` (FR/EN deterministic fixtures)
  - `scripts/bench_segmentation_quality.py` (pack scoring: exact match + precision/recall/F1)
  - `docs/SEGMENTATION_BENCHMARKS.md` generated summary
- [x] Align explainability now linked to persisted runs:
  - sidecar `/align` response includes `run_id`
  - align async jobs include `run_id` and persist `kind=align` run stats (pairs/debug payload)
  - Exports tab supports optional `run_id` filter for run report export

### V0.3 (Curation Preview Diff + Align Audit UI)

- [x] `POST /curate/preview` sidecar endpoint — in-memory dry-run, no DB write
  - returns `{doc_id, stats, examples, fts_stale: false}`
  - validates `doc_id` (400/BAD_REQUEST), invalid regex (400/VALIDATION_ERROR)
- [x] `POST /align/audit` sidecar endpoint — paginated alignment link audit
  - returns `{links, has_more, next_offset, stats}`
  - optional `external_id` filter; non-existent pairs → `ok: true, links: []`
- [x] `sidecar_contract.py` updated — 6 new OpenAPI schemas
- [x] `tests/test_sidecar_v03.py` — 12 new contract tests (all passing)
- [x] `tauri-prep/src/lib/sidecarClient.ts` updated — `curatePreview`, `alignAudit`, new types
- [x] `tauri-prep/src/screens/ActionsScreen.ts` rewritten with full V0.3 UI:
  - Curation: 4 presets (Espaces, Apostrophes, Ponctuation, Personnalisé) + JSON textarea
  - Preview panel: stats banner + before/after diff table (word-level highlight)
  - Apply button enabled only after preview; confirmation before curate
  - Align: results banner after alignment run
  - Audit panel: paginated table with "Charger plus"
- [x] `tauri-prep/src/app.ts` — new CSS for diff-table, audit-table, preview-stats, diff marks
- [x] `docs/SIDECAR_API_CONTRACT.md` — both endpoints fully documented
- [x] `docs/INTEGRATION_TAURI.md` — new endpoints + tauri-prep V0.3 usage section

### V0.4 (Metadata Panel + Exports + Align Manual Correction)

- [x] `migrations/004_align_link_status.sql` — adds `status TEXT` column + index to `alignment_links`
  - NULL = unreviewed, 'accepted', 'rejected'; non-destructive (existing rows stay NULL)
- [x] `GET /doc_relations?doc_id=N` — lists doc-level relations (no token required)
- [x] `POST /documents/update` — update title/language/doc_role/resource_type for one doc (token required)
- [x] `POST /documents/bulk_update` — bulk update multiple docs (token required)
- [x] `POST /doc_relations/set` — upsert a doc_relation (token required)
- [x] `POST /doc_relations/delete` — delete a doc_relation by id (token required)
- [x] `POST /export/tei` — export docs as TEI XML to server-side dir (token required)
- [x] `POST /export/align_csv` — export alignment links as CSV/TSV (token required)
- [x] `POST /export/run_report` — export run history as JSONL or HTML (token required)
- [x] `POST /align/link/update_status` — set link status (accepted/rejected/null, token required)
- [x] `POST /align/link/delete` — permanently delete an alignment link (token required)
- [x] `POST /align/link/retarget` — change target unit of a link (token required)
- [x] `POST /align/audit` backward-compat extension — each link includes `status` field; optional status filter
- [x] `sidecar_contract.py` updated — 10 new schemas (26 paths, 39 schemas total)
- [x] `tests/test_sidecar_v04.py` — 32 new tests (all passing)
- [x] `tauri-prep/src/lib/sidecarClient.ts` — 13 new interfaces, 11 new API functions
- [x] `tauri-prep/src/screens/MetadataScreen.ts` — NEW:
  - Doc list (click to select), edit panel (title/language/doc_role/resource_type + Save)
  - Relations panel: list + add form (type/target/note) + delete per-row
  - Bulk edit bar: doc_role + resource_type for all docs
  - Validate metadata button with warnings display
  - Log pane
- [x] `tauri-prep/src/screens/ExportsScreen.ts` — NEW:
  - TEI: multi-select docs + directory dialog → exportTei
  - Alignment CSV: pivot/target selects + CSV/TSV format + save dialog → exportAlignCsv
  - Run report: format select + save dialog → exportRunReport
  - Log pane
- [x] `tauri-prep/src/screens/ActionsScreen.ts` — extended with V0.4C:
  - Audit panel: status filter select (all/unreviewed/accepted/rejected)
  - Audit table: status column with badges + action buttons (✓ Accept, ✗ Reject, 🗑 Delete)
- [x] `tauri-prep/src/app.ts` — 5-tab navigation: Projet | Import | Actions | Métadonnées | Exports
- [x] `docs/SIDECAR_API_CONTRACT.md` — all V0.4A/B/C endpoints documented

### V0.5 (Async Job Enqueue + Job Center + Contract Freeze)

- [x] `sidecar_jobs.py` extended — `cancel(job_id)` method (queued → immediate; running → best-effort)
- [x] `POST /jobs/enqueue` (token required) — 12 job kinds: index, curate, validate-meta, segment, import, align, export_tei, export_align_csv, export_run_report, export_tei_package, export_readable_text, qa_report
- [x] `POST /jobs/{job_id}/cancel` (token required) — idempotent; 404 for unknown id
- [x] `GET /jobs` extended — `?status=`, `?limit=`, `?offset=`; response includes pagination fields
- [x] `sidecar_contract.py` — `CONTRACT_VERSION = "0.5.0"`, `x-contract-version` in OpenAPI info, 2 new paths + 2 schemas
- [x] `scripts/export_openapi.py` — exports `docs/openapi.json` (28 paths at V0.5 milestone, sorted keys)
- [x] `docs/openapi.json` — generated OpenAPI snapshot
- [x] `tests/snapshots/openapi_paths.json` — 29 "METHOD /path" entries (breaking-change detector)
- [x] `tests/test_contract_openapi_snapshot.py` — 8 contract freeze tests (`test_no_endpoints_removed` is the key guard)
- [x] `tests/test_contract_docs_sync.py` — 3 tests: all OpenAPI paths must appear in `SIDECAR_API_CONTRACT.md`
- [x] `tests/test_sidecar_jobs_v05.py` — 19 tests covering enqueue/cancel/list/pagination/all kinds
- [x] `tauri-prep/src/components/JobCenter.ts` — NEW: progress strip + cancel + recent jobs + 500ms polling
- [x] `tauri-prep/src/lib/sidecarClient.ts` — `enqueueJob`, `cancelJob`, `listJobs`; `JobRecord.status` + `"canceled"`
- [x] `tauri-prep/src/app.ts` — mounts `JobCenter`, passes it + `showToast` to screens
- [x] `tauri-prep/src/screens/ImportScreen.ts` — import + index use `enqueueJob`
- [x] `tauri-prep/src/screens/ActionsScreen.ts` — curate, segment, align, validate-meta, index use `enqueueJob`
- [x] `tauri-prep/src/screens/ExportsScreen.ts` — TEI, CSV, run-report use `enqueueJob`
- [x] `docs/SIDECAR_API_CONTRACT.md` — V0.5 section added
- [x] `docs/CHARTER_TAURI_PREP_AGENT.md` — v0.5; anti-drift rule #3 (contract freeze) + rule #11 (enqueue for long ops)

### V1.1 (Sprint 1.1 — Align Quality Metrics)

- [x] `POST /align/quality` sidecar endpoint — read-only quality report (no token required)
  - coverage_pct, orphan counts, collision count, status_counts per pair
  - optional `run_id` filter; sample orphan pivot/target units (max 5 each)
- [x] `sidecar_contract.py` updated — `CONTRACT_VERSION = "1.1.0"`, 2 new schemas (AlignQualityRequest, AlignQualityResponse)
- [x] `docs/openapi.json` regenerated — 29 paths, contract v1.1.0
- [x] `tests/snapshots/openapi_paths.json` updated — `POST /align/quality` added
- [x] `tests/test_sidecar_v11.py` — 9 new tests (full coverage + partial coverage + contract)
- [x] `docs/SIDECAR_API_CONTRACT.md` — `/align/quality` documented (listed + detail section)
- [x] `tauri-prep/src/lib/sidecarClient.ts` — `AlignQualityStats`, `AlignQualityOrphan`, `AlignQualityResponse` types + `alignQuality()` function
- [x] `tauri-prep/src/screens/ActionsScreen.ts` — "Qualité alignement" card: pivot/cible selects + stats grid + orphan samples collapse + log line
- [x] `tauri-prep/src/app.ts` — `.quality-stats-grid` + `.quality-stat` + `.quality-value` CSS

### V1.2–V1.4 (Sprints 1.2/1.3/1.4 — completed in previous session)

- [x] V1.2: `/align/audit` include_explain + status enum + text badges
- [x] V1.3: `/align/links/batch_update` + batch bar in ActionsScreen
- [x] V1.4: `/align/retarget_candidates` + Retarget modal in ActionsScreen

### V1.5 (Sprint 1.5 — Collision Resolver)

- [x] `POST /align/collisions` (read, no token): paginated collision groups
  `{total_collisions, collisions: [CollisionGroup], has_more, next_offset}`
- [x] `POST /align/collisions/resolve` (write, token): batch keep/delete/reject/unreviewed
  partial failures tolerated; `{applied, deleted, errors}`
- [x] `CONTRACT_VERSION = "1.3.0"`, `API_VERSION = "1.3.0"`
- [x] 19 new tests in `tests/test_sidecar_v15.py`
- [x] `sidecarClient.ts`: CollisionGroup/Link/ResolveAction interfaces + listCollisions() + resolveCollisions()
- [x] `ActionsScreen.ts` V1.5: "Collisions d'alignement" card — collision table per group,
  per-link ✓ Garder / ❌ Rejeter / 🗑 / "Tout supprimer" batch; toast + auto-refresh

## P3-B — Embedded CSS invariant (2026-03-08)

### Problème

`App.init()` injectait la constante CSS (~67 Ko, incluant `JOB_CENTER_CSS`) via `document.head.appendChild(style)` **sans guard**. En mode embedded (tauri-shell), chaque navigation vers "Constituer" ajoutait un nouveau bloc `<style>` sans jamais le retirer. De plus, le handler `beforeunload` était ajouté via `window.addEventListener` sans stocker la référence, créant une fuite de listeners à chaque remount.

### Fix (P3-B)

**`tauri-prep/src/app.ts`** :

1. **Guard CSS injection** — constante `PREP_STYLE_ID = "agrafes-prep-inline"` ; `init()` vérifie `document.getElementById(PREP_STYLE_ID)` avant d'injecter. Si l'élément existe déjà, le bloc entier est sauté.
2. **Cleanup listener `beforeunload`** — le handler est stocké dans `this._beforeUnloadHandler`. `dispose()` appelle `window.removeEventListener("beforeunload", this._beforeUnloadHandler)` puis set à `null`.

### Invariants garantis

| Scénario | Avant P3-B | Après P3-B |
|----------|-----------|-----------|
| Standalone (tauri-prep dev/build) | 1 `<style>` (1 seul mount) | 1 `<style>` (inchangé) |
| Embedded, navigation ×N | N `<style>` accumulés | 1 `<style>` (guard idempotent) |
| Listeners `beforeunload` | N listeners en mémoire | max 1 (retiré dans `dispose()`) |

**Build résultant :** `dist/assets/index-*.js` 251.72 kB JS, 13.14 kB CSS (build vert, 0 erreur TS).

## Confirmed green

- [x] pytest: **352 tests passing**, 0 failures (2026-03-01; includes hardening fixes v1.4.1)
- [x] npm build: green (tauri-prep bundle ~251.72 kB JS, 13.14 kB CSS)

## Next tasks (V1.x)

1. Concordancier V1: metadata panel (doc title/lang/role/resource_type/units side panel)
2. Concordancier V1: demo corpus (bundled small multilingual corpus on first run)
3. Sidecar release hardening: notarization, Windows signing, production certs setup

---

## Tests count

| Milestone | Tests |
|-----------|-------|
| V2.1 (entry this session) | 114 |
| After /documents + /align | +4 → 118 (confirmed) |
| After V0.3 (curate/preview + align/audit) | +12 → 130 (confirmed) |
| After V0.4 (metadata + exports + align correction) | +32 → 162 (confirmed) |
| After V0.5 (job enqueue + contract freeze) | +27 → 189 (confirmed) |
| After V0.6.1 (segmentation quality packs) | +6 → 195 (confirmed) |
| After V0.7 (advanced align strategy hybrid) | +4 → 199 (confirmed) |
| After V0.8 (align explainability) | +4 → 203 (confirmed) |
| After V0.9 (segmentation fixtures/bench + pack case-insensitivity) | +5 → 208 (confirmed) |
| After V0.10 (align runs linkage + run export filter) | +0 → 208 (confirmed) |
| After V1.1 (Sprint 1.1 — /align/quality + UI quality panel) | +9 → 217 (confirmed) |
| After V1.2–V1.4 (explain, batch, retarget) | +31 → 248 (confirmed) |
| After V1.5 (Sprint 1.5 — collision resolver) | +19 → 267 (confirmed) |
