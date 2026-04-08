# Backlog — multicorpus_engine

Last updated: 2026-04-08 (backlog — idées exploratoires + concordancier multi-DB)

## Priority backlog (realistic, post-implementation)

| Priority | Item | Why now | Acceptance criteria | Status |
|----------|------|---------|---------------------|--------|
| P2 | **Prep — page « Exporter » + vue Exporter dans Constituer** | `ExportsScreen` (V2 + blocs legacy) et navigation shell : besoin de **nettoyage et d’affinage** (hiérarchie visuelle, duplication V2/legacy, KPI, bouton retour Alignement, états vides/erreur) | Pass UX dédié : parcours clair sur `tauri-prep` **et** même surface embarquée via `constituerModule` (pas de régression shell : titres, scroll, Job Center) ; documenter décisions dans `UX_FLOW_PREP` ou note courte ; build vert | **todo** |
| **NOW** | **P11 — Actions TRUE DOM parity** | Inc 3 traduction native layout; Inc 0/1/2 vérifiés conformes | 2-col traduction workspace, `<details>` ref VO, preview-tools/tabs/panes à droite; build vert | **done** |
| **P1** | **P12 — Wiring traduction preview + scroll sync** | La preview traduction droite est structurée mais non câblée ; le scroll sync longtext est TODO | `_runSegment()` alimente les panes traduction (target + VO) ; sync scroll `raw-scroll` ↔ `seg-scroll` mode longtext | **todo** |
| **NOW** | **Tauri UI "Concordancier" V0** | Core + sidecar stable; time to deliver user-facing value | `tauri-app/` launches with `npm run tauri dev`; search, KWIC, import, index | **done** |
| **NOW** | **Tauri Concordancier Prep V0** (`tauri-prep/`) | Corpus preparation workflow (import → curate → segment → align) needs dedicated app | 3-screen scaffold: Project/DB, Import+Index, Actions; all sidecar routes wired | **done** |
| **NOW** | **Concordancier Prep V0.3** — curate preview diff + align audit UI | Users need to preview curation changes before applying + review alignment links | `POST /curate/preview` dry-run with diff table; `POST /align/audit` paginated link table | **done** |
| **NOW** | **Concordancier Prep V0.4** — metadata panel + exports + align manual correction | Users need to edit doc metadata, export corpora, and curate alignment links | MetadataScreen, ExportsScreen, align link accept/reject/delete/retarget, migration 004 | **done** |
| **NOW** | **Concordancier Prep V0.5** — async job enqueue + Job Center + contract freeze | V0.4 blocks UI on long ops; API needs drift protection | JobCenter panel, all long ops enqueue via `/jobs/enqueue`, OpenAPI snapshot + docs-sync CI tests | **done** |
| P1 | Concordancier Prep V1 — segmentation quality packs | Language-specific segmentation rules | Pack selector in ActionsScreen; apply lang-specific rule sets | done |
| P1 | Concordancier Prep V1 — advanced align strategies | Partial anchor corpora need robust fallback linking | Hybrid strategy `external_id_then_position` available in sidecar/jobs/ActionsScreen | done |
| P1 | Concordancier Prep V1 — align explainability | Users need visibility on fallback behavior | Optional `debug_align` payload available and visible in Actions logs | done |
| P1 | Concordancier Prep — persisted document workflow status | UX finalization needs a durable `draft/review/validated` state, not visual-only toggles | Migration + sidecar `/documents` + update endpoints carry workflow status and validation metadata; `tauri-prep` Documents tab shows/edits status and offers quick validate/review actions; `Actions` adds "Segmenter + valider ce document" fast-path + configurable post-validation routing | done |
| P1 | Concordancier Prep — UX workflow gates (design -> implementation) | The current mockup iteration needs explicit closure criteria before final wiring | `docs/UX_FLOW_PREP.md` checklist section completed (Done-by-tab, align vs audit boundary, save/error guards, recalculation conflict policy, Export V2 scope, accessibility, end-to-end validation) + runtime state banner and unsaved-change inter-tab guard wired in `tauri-prep` | done |
| P2 | Concordancier Prep — accessibility baseline hardening | Final prep iteration required keyboard/focus consistency before broader rollout | Global focus-visible styles, accordion ARIA state wiring, and explicit labels on icon-only critical controls | done |
| P1 | **tauri-prep vNext P1 — Extension UI** | Pilot CSS architecture done (P0); need raw pane + seg 2-col + batch overview + sidebar active state | `_renderRawPane()` + `.seg-workspace` 2-col sticky + `_renderSegBatchOverview()` + IntersectionObserver nav active | **done** |
| P2 | **tauri-prep vNext P2 — Polish (CSS/A11y/States/Responsive)** | P1 functional; need token coherence, responsive layout, empty/loading/error states, a11y, IO lifecycle | tokens.css enriched; breakpoint 1100px; loading hints + error states; skip link + aria-* wired; IO disconnect/tie-break | **done** |
| P1 | Concordancier V0.2 — pagination backend + load more | Prevent loading too many hits per request, especially with aligned mode | `/query` supports `limit/offset/has_more`; UI supports reset + `Charger plus` paging | done |
| P1 | Concordancier V1 — virtualisation / IntersectionObserver | V0.2 load-more exists; scrolling UX can be smoother | Automatic near-bottom page fetch with guardrails and no duplicate fetches | done |
| P1 | Concordancier V1 — metadata panel | Users need doc-level metadata at a glance | Side panel: title, language, role, resource_type, unit count | todo |
| P1 | Concordancier V1 — corpus démo | New users need a working sample | Bundled small multilingual demo corpus on first run | todo |
| P2 | Concordancier V1 — aligned view quality | V0.1 exists; needs richer control and readability | Group/sort aligned lines by language/doc and add compact expand/collapse presets | todo |
| P2 | Concordancier V1 — advanced search (regex/NEAR) | Power users need FTS5 proximity | UI for NEAR(t1 t2, N) and raw FTS5 passthrough | done |
| P2 | Deep link between Tauri apps (`open-db` URI) | Current flow relies on copy/paste path between `tauri-prep` and the unified shell | URI contract `agrafes-shell://open-db?mode=explorer&path=...` implemented; `tauri-prep` button emits handoff and `tauri-shell` consumes startup/runtime deep links with safe fallback | done |
| P1 | macOS sidecar signing + notarization hardening | Base scripts/workflow exist; production rollout still needs credential ops and release validation | Signed/notarized artifacts validated on tag pipeline with real cert identity and Gatekeeper checks | in_progress |
| P1 | Windows sidecar code signing hardening | Script/workflow stubs exist; production cert flow not yet exercised | Signed `.exe` artifacts verified in CI with operational cert management process | in_progress |
| P1 | Persistent sidecar restart resilience (advanced cases) | Baseline stale recovery is implemented; edge cases remain (PID reuse/races/forced kill) | Stress tests for crash/restart, stale cleanup race handling, and deterministic behavior under rapid relaunch loops | in_progress |
| P1 | Sidecar lifecycle and resilience | Sidecar contract exists; runtime behavior needs production guardrails | Extended integration tests for restart/recovery and process supervision recommendations for desktop wrapper | todo |
| P2 | Prep UX: DB backup action in Documents | Metadata batch edits need a visible safety checkpoint before write operations | `tauri-prep` Documents tab exposes `Sauvegarder la DB`; sidecar `POST /db/backup` creates timestamped `.db.bak`; UI shows latest backup status + log path | done |
| P1 | Tauri fixture expansion to GUI-capable runners | Headless smoke exists; full app-run coverage is still partial | Add optional GUI-capable runner lane that executes `tauri run`/`tauri build` smoke with sidecar | todo |
| P2 | Sidecar localhost security posture | Optional token is implemented, but policy is still minimal | Explicit threat model, token rotation/expiry policy, and wrapper guidance for secure defaults | in_progress |
| P2 | Linux portability baseline (glibc/manylinux policy) | manylinux build scaffold exists; support floor must be validated empirically | Documented glibc support floor + compatibility smoke matrix on older distros | **done** (Sprint 3.3: glibc floor table in DISTRIBUTION.md) |
| P2 | CI cache strategy for PyInstaller builds | Matrix builds can be slow/costly | Cached dependency/build layers with measurable time reduction | todo (deferred post-3.3) |
| P2 | Sidecar binary size optimization | Onefile convenience increases binary size | Track size budget and apply PyInstaller/payload optimizations with before/after report | todo |
| P2 | Tauri release icons (icns/ico) | Dev currently uses PNG-only placeholders to unblock `tauri dev`; release packages need platform-native icons | Generate and validate real `icon.icns` + `icon.ico` assets before release packaging | todo |
| P2 | FTS performance profile | Large corpora will stress rebuild workflow | Bench report on representative datasets + documented recommended SQLite pragmas | in_progress |
| P2 | Incremental indexing strategy (flagged) | Full rebuild is simple but costly at scale | Design note + tested incremental mode behind explicit `--incremental`-style gate | todo |
| P2 | TEI compatibility matrix | TEI files vary heavily across projects | Compatibility doc + fixtures for namespaced/non-namespaced and mixed-content edge cases | todo |
| P2 | Query/export output contract tests | Prevent regressions in JSON and file schemas | Snapshot-style tests for `query --output` + exporters across modes | todo |
| P2 | Segmentation quality fixtures + benchmarks | Pack selector is in place; quality still needs objective checks | Regression fixtures FR/EN + before/after metrics per pack | done |
| P2 | Segmentation quality fixtures expansion | Current benchmark set is intentionally small and deterministic | Add harder edge cases (quotes, parenthesis, ellipsis, mixed FR/EN) + target thresholds per language | todo |
| P2 | Align explainability UI polish | Debug payload exists; rendering can be richer than logs | Dedicated explainability panel (sources, counts, similarity stats, samples) + copy diagnostic JSON | done |
| P2 | Align explainability export/report | Operators may need offline debug traces from prep runs | Save explainability payloads to file and link them to run history | done |
| P2 | Align run exploration UX | Explainability is now run-linked; users still need easier browsing/comparison in app | Add run picker + diff view across two align runs (strategy/coverage/debug deltas) | todo |
| P3 | Project-level maintenance commands | Long-term operability | CLI helpers for diagnostics, vacuum/analyze, and run history pruning | todo |

## Kept stable (already implemented)

- Importers: DOCX numbered lines, TXT numbered lines, DOCX paragraphs, TEI.
- Query: segment/KWIC, all occurrences, aligned view.
- Sidecar `/query` pagination baseline: `limit`, `offset`, `has_more`, `next_offset`.
- Alignment: external_id, external_id_then_position, position, similarity.
- Export: TEI, CSV, TSV, JSONL, HTML.
- Curation, segmentation, sidecar API + async jobs, DB diagnostics.
- Segmentation supports quality pack selection (`auto`, `default`, `fr_strict`, `en_strict`) via CLI/sidecar/tauri-prep.
- Hybrid alignment strategy `external_id_then_position` is available (anchor-first, then position fallback).
- Align explainability hook `debug_align` is available for `/align` and align jobs.
- CLI contract hardening for parser/runtime failures (`status=error`, exit code `1`, JSON-only stdout).
- Sidecar packaging scaffold (PyInstaller onefile + target-triple naming + CI matrix artifacts).
- Tauri fixture scaffold (`tauri-fixture/`) + cross-platform headless sidecar smoke workflow.
- Persistent sidecar flow (`serve` + HTTP endpoints + `.agrafes_sidecar.json` discovery + `/shutdown`).
- `POST /curate/preview` — read-only dry-run, in-memory regex simulation, no DB write.
- `POST /align/audit` — paginated alignment link audit with pivot/target texts; optional status filter.
- `GET /documents`, `POST /align` — sidecar endpoints for Concordancier Prep.
- `GET /documents/preview` — lightweight excerpt endpoint for Documents quick verification.
- `tauri-prep/` full V0.4 scaffold: 5 screens (Project, Import, Actions, Métadonnées, Exports).
- Metadata endpoints: `GET /doc_relations`, `POST /documents/update`, `POST /documents/bulk_update`, `POST /doc_relations/set`, `POST /doc_relations/delete`.
- Export endpoints: `POST /export/tei`, `POST /export/align_csv`, `POST /export/run_report`.
- Align correction: `POST /align/link/update_status`, `POST /align/link/delete`, `POST /align/link/retarget`.
- Migration 004: `alignment_links.status` column (NULL=unreviewed, accepted, rejected).
- **V0.5 async job enqueue**: `POST /jobs/enqueue` (12 kinds) + `POST /jobs/{id}/cancel` + extended `GET /jobs` (status filter + pagination).
- **V0.5 sidecar_jobs.py cancel()**: best-effort cancel, idempotent for terminal states.
- **V0.5 contract freeze**: `tests/snapshots/openapi_paths.json` + `test_contract_openapi_snapshot.py` + `test_contract_docs_sync.py` + `scripts/export_openapi.py` + `docs/openapi.json`.
- **V0.5 tauri-prep JobCenter**: `tauri-prep/src/components/JobCenter.ts` — progress strip, cancel, recent jobs.
- **V0.5 tauri-prep screens**: all long operations use `enqueueJob` + `jobCenter.trackJob`; toast on result.
- **P3 — Shell style de-dup + Prep CSS idempotent injection** (2026-03-08):
  - `tauri-shell/src/styleRegistry.ts` : helpers idempotents (ensureStyleTag, ensureStylesheetLink, removeStyleTag, removeLink, countManagedStyles).
  - `tauri-shell/scripts/test_style_registry.mjs` : 20 tests, 5 suites.
  - `tauri-prep/src/app.ts` App.init() : guard `id="agrafes-prep-inline"` — injection unique par document lifetime.
  - `tauri-prep/src/app.ts` App.dispose() : retrait du listener `beforeunload` via référence stockée.
- **P4 — DB switch banner + Prep CSS embedded registry** (2026-03-08):
  - `tauri-shell/src/shell.ts` : banner `.shell-db-change-banner` (bleu) ; `_pendingDbRemount` flag ; `_switchDb` → deferred remount si module non-home ; `_showDbChangeBanner` / `_clearDbChangeBanner` ; `_setMode` → clear banner en entrée.
  - `tauri-prep/src/app.ts` : export `PREP_CSS` + `PREP_STYLE_ID`.
  - `tauri-shell/src/modules/constituerModule.ts` : injection CSS via `ensureStyleTag` avant mount (P4-1 embedded mode).

- **P5 — DB remount indicator + CSS feasibility** (2026-03-08):
  - `tauri-shell/src/shell.ts` : `_dbBadgeText()` → badge `"DB: nom ⚠"` quand `_pendingDbRemount = true` ; `_updateDbBadge()` → classe `.shell-db-badge--pending` (ambre) + tooltip ; CSS `.shell-db-badge--pending` dans `SHELL_CSS`.
  - P5-2 (CSS `<link>` statique) : différé P6 — les 4 CSS files sont des compléments, pas des remplacements de `PREP_CSS`.
  - Analyse P5-1 : comportement apply-on-navigate déjà correct (chaque `_setMode` remonte systématiquement).

- **P6 — Extraction CSS PREP_CSS vers Vite-managed** (2026-03-08):
  - `tauri-prep/src/ui/app.css` (768 lignes) + `tauri-prep/src/ui/job-center.css` (19 lignes) créés.
  - `tauri-prep/src/main.ts` : imports CSS ajoutés.
  - `tauri-shell/src/modules/constituerModule.ts` : imports CSS ; `ensureStyleTag` supprimé.
  - `tauri-prep/src/app.ts` : `PREP_CSS` vidé, `PREP_STYLE_ID` retiré, injection inline supprimée.
  - **Impact bundle** : JS −36 kB pour prep et shell ; CSS désormais asset Vite dédié.
  - `styleRegistry.ts` conservé (20 tests, utile P7+).

- **P7 — Cleanup final + document.title** (2026-03-08):
  - `tauri-prep/src/app.ts` : placeholder `PREP_CSS` + commentaire `PREP_STYLE_ID` supprimés.
  - `tauri-shell/src/styleRegistry.ts` : JSDoc mis à jour (Option A — conservé, tree-shaked en prod).
  - `tauri-shell/src/shell.ts` : `_updateDocTitle(mode)` + `_MODE_TITLES` — titre OS par mode.

- **P8 — Actions state-nav refactor + hub view** (2026-03-08):
  - `ActionsScreen.ts` : `SubView` étendu à `"hub" | ...` ; défaut "hub" ; `_renderHubPanel()` + `_prependBackBtn()`.
  - Segmentation : 3e mode "Traduction" (Unités / Traduction / Document complet).
  - Alignement : header `acts-align-head` (titre + pill stratégie).
  - Suppression barre `acts-subnav` ; sidebar tree = seule navigation.
  - `app.ts` : "Vue synthèse" en tête des tree-items ; clic onglet Actions → hub.
  - `app.css` : classes hub + back-btn + align-head ajoutées.

## Placeholders (post-P8)

| Priority | Item | Rationale | Status |
|----------|------|-----------|--------|
| P9 | **Shell multi-fenêtre** — `tauri::WebviewWindowBuilder` | Ouvrir Explorer et Constituer en parallèle dans des fenêtres séparées | todo |
| P9 | **Deprecation tauri-app + tauri-prep** standalone | tauri-shell les supplante ; maintien pour standalone uniquement jusqu'à V2.0 | todo |
| P9 | **Hot-swap DB sidecar** — éviter le redémarrage sidecar lors d'un switch DB | Actuellement : `_initDb` redémarre le sidecar ; un futur mécanisme de rechargement à chaud éviterait l'interruption | todo |
| P9 | **CSS audit des 4 fichiers ui/** (tokens/base/components/prep-vnext) | Depuis P6, `app.css` contient des règles dupliquées avec les 4 fichiers existants (`:root` vars, sidebar layout) | todo |

## Idées à cadrer (exploratoire — à reformuler avant spec)

Notes brèves pour ne pas perdre des pistes ; priorité et critères d’acceptation à définir plus tard.

| Thème | Piste | Notes |
|-------|--------|-------|
| Corpus / qualité | **Gestion des doublons** | Détecter / fusionner / signaler les documents ou unités en doublon. |
| Import | **Import ODT ?** | Évaluer support import OpenDocument Text (vs DOCX/TEI existants). |
| Notation / query | **`[n]` ?** | Signification à préciser (répétition, comptage, placeholder de segment, autre). |
| Curation UX | **Curation, bouton « suivant » ?** | Navigation rapide entre occurrences / règles sans quitter le flux. |
| Segmentation | **Segment `[` ? — options avancées ?** | Syntaxe ou marqueurs autour de `[` ; panneau options segmentation avancées. |
| UI segmentation | **Séparateurs actifs / autre vue ?** | Visualisation ou édition des séparateurs ; variante de vue alternative. |
| Normalisation | **Revenir sur espaces incohérents** | Harmoniser traitement des espaces (début/fin, doubles, Unicode) dans un ou plusieurs pipelines. |
| Segmentation | **Différents modes de segmentation ?** | Au-delà des packs actuels : presets, critères alternatifs, comparaison. |
| Conventions | **Conventions ? (ex. type `[InterT]` — Raluca)** | Jeu de tags ou types d’unités projet-spécifiques ; lien avec conventions nommées. |
| Export | **Export DOCX, ODT, TXT ?** | Étendre les formats d’export au-delà de l’existant (TEI, CSV, etc.). |
| Concordancier / prep | **Mode annotation ?** | Workflow ou couche dédiée à l’annotation (à distinguer de la simple lecture). |
| Concordancier | **Multiples DB ?** | Travailler avec plusieurs bases (recherche croisée, onglets, agrégation des résultats) ; modèle produit et contrat sidecar à définir. |
| Qualité données | **Vérifier aussi le XML** | Validation / lint / cohérence XML (TEI et dérivés) en import ou en continu. |
| Linguistique | **Catégories grammaticales ?** | Intégration POS / tags grammaticaux (source externe ou pipeline dédié). |
