# Backlog — multicorpus_engine

Last updated: 2026-04-08 (priorisation « Idées à cadrer » + plan d’action)

## Priority backlog (realistic, post-implementation)

| Priority | Item | Why now | Acceptance criteria | Status |
|----------|------|---------|---------------------|--------|
| P2 | **Prep — page « Exporter » + vue Exporter dans Constituer** | `ExportsScreen` (V2 + blocs legacy) et navigation shell : besoin de **nettoyage et d’affinage** (hiérarchie visuelle, duplication V2/legacy, KPI, bouton retour Alignement, états vides/erreur) | Pass UX dédié : parcours clair sur `tauri-prep` **et** même surface embarquée via `constituerModule` (pas de régression shell : titres, scroll, Job Center) ; documenter décisions dans `UX_FLOW_PREP` ou note courte ; build vert | **done** (2026-04-08 : 2e passe — KPI **Étape + Produit + Format**, bandeau état corpus vide, `aria-*` / table / région, toggle legacy `hidden` + `aria-expanded`, libellés) |
| P2 | **Prep — Curation : distinguer navigation doc vs diff** | Les boutons « Précédent / Suivant » près du sélecteur de document sont utiles mais confondus avec « Préc. / Suiv. » de l’aperçu des différences ; voir spec ci-dessous | Libellés explicites (ex. *Document préc. / suiv.*) ou `title` / `aria-label` ; vérification accessibilité ; pas de régression sur `_navigateCurateDoc` / `_setActiveDiffItem` | **done** (2026-04-08 : Doc précéd. / suiv. vs Modif précéd. / suiv. + `aria-*`) |
| P2 | **Prep — Segmentation : mode explicite + lisibilité des séparateurs** | Les stratégies existent (phrases vs balises `[N]`) mais le choix n’est pas assez visible ; pas de séparateur « au choix » côté moteur hors ces deux familles ; voir spec ci-dessous | Sélecteur principal **Stratégie** (phrases / balises) + résumé de l’effet ; packs/lang visibles pour phrases ; doc utilisateur ; extension moteur **hors scope** sauf décision produit (délimiteur custom, ¤, etc.) | **done** (2026-04-08 : fieldset Stratégie + ligne « Règle active » + désactivation pack en mode balises) |
| **NOW** | **P11 — Actions TRUE DOM parity** | Inc 3 traduction native layout; Inc 0/1/2 vérifiés conformes | 2-col traduction workspace, `<details>` ref VO, preview-tools/tabs/panes à droite; build vert | **done** |
| **P1** | **P12 — Wiring traduction preview + scroll sync** | La preview traduction droite est structurée mais non câblée ; le scroll sync longtext est TODO | `_runSegment()` alimente les panes traduction (target + VO) ; sync scroll `raw-scroll` ↔ `seg-scroll` mode longtext | **done** (2026-04-08 : sync scroll **aperçu segmentation** colonnes brut ↔ segmenté `#act-seg-prev-raw` ↔ `#act-seg-prev-seg` — flux actif ; stub « traduction » non monté) |
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
| P1 | Concordancier V1 — metadata panel | Users need doc-level metadata at a glance | Side panel: title, language, role, resource_type, unit count | **done** (`tauri-app/src/features/metaPanel.ts` — panneau hit / document ; voir revue §4) |
| P1 | Concordancier V1 — corpus démo | New users need a working sample | Bundled small multilingual demo corpus on first run | **done** (shell : `tauri-shell` + `public/demo/agrafes_demo.db` ; `tauri-app` standalone sans démo — voir revue §4) |
| P2 | Concordancier V1 — aligned view quality | V0.1 exists; needs richer control and readability | Group/sort aligned lines by language/doc and add compact expand/collapse presets | **done** (2026-04-08 — clé JSON + tri lang→doc→titre ; `<details>` ouverts par défaut ; panneau méta + citation alignés) |
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
| P2 | Align run exploration UX | Explainability is now run-linked; users still need easier browsing/comparison in app | Add run picker + diff view across two align runs (strategy/coverage/debug deltas) | **done** (2026-04-08 — `GET /runs?kind=align` ; Prep Actions « Comparer deux runs » + tableau paramètres / stats) |
| P3 | Project-level maintenance commands | Long-term operability | CLI helpers for diagnostics, vacuum/analyze, and run history pruning | todo |

## Revue consolidée — priorisation, risques, incohérences (2026-04-08)

Synthèse après passage sur le tableau prioritaire, les placeholders P9, la section exploratoire et les documents voisins (`docs/ROADMAP.md`). Objectif : **réduire les doublons de suivi**, **classer le reste**, **signaler les écarts**.

### 1. Regroupement par intention (tout ce qui « reste »)

| Bande | Thème | Entrées typiques |
|-------|--------|------------------|
| **A — UX Prep immédiate** | Lisibilité et finition sans changer le moteur | 3 lignes **P2** en tête de tableau (Exporter, curation doc/diff, segmentation stratégie) ; aligne les specs exploratoires déjà rédigées. |
| **B — Parcours traduction** | Cohérence Actions | **P12** wiring preview + scroll sync (dépend du layout déjà en place). |
| **C — Concordancier** | Qualité de lecture / résultats | Vue alignée enrichie ; exploration runs align (picker + diff) ; éventuellement raffinages hors scope moteur. |
| **D — Release & confiance** | Distribuer sans friction | Signing macOS/Windows, résilience sidecar avancée, politique localhost, icônes release, FTS bench. |
| **E — Qualité moteur & dette** | Régressions, perf, TEI | TEI compatibility matrix ; tests contrat query/export ; fixtures segmentation étendues ; index incrémental. |
| **F — Horizon produit** | Specs déjà écrites, pas livrées | Section **Idées à cadrer** (export par étape, mode annotation, multiples DB, XML, POS…) — **P2–P3+** selon arbitrages. |
| **G — Shell / archi** | Placeholders **P9** | Multi-fenêtre, dépréciation standalone, hot-swap DB, audit CSS. |

### 2. Priorisation recommandée (ordre de traitement)

1. **P2 Prep (A)** — impact utilisateur quotidien, faible risque régression si limité à l’UI (libellés, sélecteur stratégie, Exporter). *Dépendances :* aucune bloquante.
2. **P12 (B)** — débloque l’usage « traduction » annoncé par le hub Actions ; *risque* : régressions scroll / perf sur gros textes.
3. **Release (D)** — **bloquant** pour une diffusion large hors dev ; *risque* : secrets CI, certs, comportement Gatekeeper — souvent **parallélisable** avec le dev feature.
4. **Sidecar résilience + sécurité (D)** — `in_progress` / todo : à garder sous contrôle avant exposition réseau ; lien avec **P9 hot-swap** (moins de redémarrages = moins de courses).
5. **Qualité & tests (E)** — TEI matrix + snapshots export : **réduit le coût** des évolutions futures ; index incrémental : **priorité basse** tant que les corpus restent modérés.
6. **F (horizon)** — traiter **après** stabilisation UX Prep et release, sauf **décision métier** (ex. POS obligatoire pour un partenaire).
7. **G (P9)** — utile quand le shell est la cible principale ; **multi-fenêtre** recoupe la spec **multiples DB** (fenêtres = plusieurs DB sans fédération).

### 3. Risques transverses

| Risque | Où ça pince | Atténuation |
|--------|-------------|-------------|
| **Contrat API / OpenAPI** | Toute évolution sidecar + Tauri | Garder les tests snapshot + `docs/openapi.json` ; ne pas multiplier les variantes non versionnées. |
| **Double vérité UI** | Exporter V2 vs legacy, shell vs standalone | Revue continue « une source de vérité » ; P9 dépréciation explicite des standalone. |
| **Segmentation vs annotation (futur)** | `text_norm` / unités changeantes | Déjà noté en spec POS / mode annotation — **ne pas** lancer tokens avant règles de stabilité. |
| **TEI hétérogène** | Import / export | TEI matrix + `validate_tei_ids` ; aligner avec **XML — validation** (section exploratoire). |
| **Fédération multi-DB** | Complexité + collisions `doc_id` | Reste **P3+** ; préférer **fenêtres séparées** (P9) avant **requête unifiée**. |

### 4. Incohérences ou doublons détectés (corrections appliquées ou à suivre)

| Sujet | Problème | Action |
|-------|----------|--------|
| **Panneau métadonnées Concordancier** | Tableau prioritaire en **todo** alors que `metaPanel.ts` expose titre, langue, rôle, type, unités. | Lignes **metadata panel** et **corpus démo** passées en **done** avec renvoi ici ; *standalone `tauri-app`* sans démo documenté. |
| **TEI compatibility matrix** | Apparaît en **P2** dans le tableau prioritaire **et** dans la spec exploratoire **XML**. | **Un seul suivi** : implémentation = ligne P2 du tableau ; la section XML décrit le *pourquoi* produit. |
| **`docs/ROADMAP.md` section « Next »** | Peut encore lister des items déjà livrés (métadonnées, démo). | À **rafraîchir** quand on referme un sprint (éviter double source avec ce backlog). |
| **Export « par étape »** | Spec exploratoire ambitieuse vs **Kept stable** (exports listés sans distinguer jobs `readable_text`). | Pas de contradiction : **Kept stable** = capacités moteur ; spec export = **couverture UX** par étape — la revue **P2 maillage étape ↔ exports** reste la bonne entrée. |
| **Priorités P1 vs P2 en tête de tableau** | Les **P2 Prep** sont placées **avant** les **P1 P12** dans le fichier. | **Volontaire** (finition Prep priorisée) ; sinon réordonner le tableau par **P1 → P2** uniquement pour la lecture. |

### 5. État synthétique du tableau prioritaire (après correction)

- **todo** : surtout **Prep P2** (3), **P12**, **Concordancier** (raffinages résultats au besoin), **infra** (signing, sidecar, sécurité, bench, CI, TEI matrix, tests contrat, segmentation fixtures expansion, icônes, taille binaire, index incrémental), **Tauri fixtures GUI**, **P3** maintenance CLI.
- **in_progress** : signing macOS/Windows, résilience sidecar avancée, sécurité localhost, FTS bench.
- **done** : inclut désormais **metadata panel** et **corpus démo** (avec le périmètre shell ci-dessus).

---

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
| Corpus / qualité | **Gestion des doublons (import)** | Spec détaillée dans la sous-section **« Import — doublons (corpus) »** ci-dessous. |
| Import | **DOCX + ODT = « traitement de texte »** | Spec : sous-section **« Import — traitement de texte (DOCX / ODT) »** ci-dessous. |
| Notation / query | **Balises `[n]` (segments numérotés)** | Spec : sous-section **« Notation [n] — import, segmentation, concordancier »** ci-dessous. |
| Curation UX | **Précédent / Suivant (curation)** | Spec : **« Curation — navigation documents vs diff »** ci-dessous ; entrée P2 dans le tableau prioritaire. |
| Segmentation | **Texte avant premier `[N]` (préfixe)** | Spec : **« Segmentation — préfixe avant balises `[N]` »** ci-dessous. |
| UI segmentation | **Mode de segmentation & séparateurs** | Spec : **« UI Segmentation — stratégie et séparateurs »** ci-dessous ; entrée P2 dans le tableau prioritaire. |
| Segmentation | **Revue pack d'abréviations / coupes phrases** | Itération prévue : voir paragraphe **« Revue — pack coupes phrases »** dans la même section. |
| Normalisation | **Espaces incohérents (Unicode)** | Spec : **« Normalisation — espaces et texte »** ci-dessous. |
| Segmentation | **Modes / parent VO (traductions)** | Spec : **« Segmentation — traductions et document parent »** ci-dessous (lie les « modes » et le VO). |
| Conventions | **Vocabulaire contrôlé (conventions)** | Spec : **« Conventions projet »** ci-dessous (définition porteur + réf. LingWhistX). |
| Export | **Export par étape + formats multiples** | Spec : **« Export — étapes de workflow et formats »** ci-dessous (inclut DOCX / ODT / TXT comme familles de formats). |
| Concordancier / prep | **Mode annotation** | Spec : **« Mode annotation (couche linguistique / travail) »** ci-dessous ; piste technique détaillée dans `docs/BACKLOG_CQL.md`. |
| Concordancier | **Multiples bases (SQLite)** | Spec : **« Multiples bases — concordancier et sidecar »** ci-dessous. |
| Qualité données | **XML — validation & cohérence** | Spec : **« XML — validation, lint et cohérence (TEI) »** ci-dessous. |
| Linguistique | **Catégories grammaticales (POS)** | Spec : **« Catégories grammaticales et schéma d’étiquettes »** ci-dessous ; croise **Mode annotation** et `docs/BACKLOG_CQL.md`. |

### Priorisation et plan d’action (section « Idées à cadrer »)

Cette synthèse **ne remplace pas** les sous-sections détaillées ci-dessous ; elle ordonne le travail et les **décisions produit** à prendre.

#### Critères de rang

| Critère | Rôle |
|--------|------|
| **Dépendance** | Un thème bloque-t-il un autre (ex. POS dépend du mode annotation / tokens) ? |
| **Valeur utilisateur immédiate** | Réduit erreurs, clarifie le flux, ou livre un export vérifiable sans changer tout le schéma DB. |
| **Coût / risque** | Refonte moteur + migration > doc + UI > polish. |
| **État** | Déjà partiellement implémenté → finir avant d’ouvrir un chantier plus lourd. |

#### Vue par bandes de priorité

| Bande | Thèmes (lignes du tableau) | Rationale courte |
|-------|----------------------------|------------------|
| **A — Fondations entrée / sortie** | Import DOCX+ODT (suite) ; **Export par étape** ; **Normalisation espaces** | Alignement avec le principe « texte visible / exportable à chaque étape » ; réduction d’incohérences avant couches avancées. |
| **B — Qualité & lisibilité sans nouveau schéma** | Notation `[n]` (aide) ; préfixe avant `[N]` (doc UI) ; **XML / TEI** ; revue **pack coupes phrases** ; **Segmentation VO** (doc + optionnel prévisualisation calibrage) | Fort retour utilisateur, contrat DB stable. |
| **C — Décisions métier puis implémentation lourde** | **Conventions projet** ; **Mode annotation** ; **Multiples bases** (A/B) ; **POS** | Nécessitent arbitrage produit ; certaines dépendent de `docs/BACKLOG_CQL.md` ou du shell P9. |
| **D — Recherche / horizon** | Requête **multi-DB fédérée** ; extensions moteur non cadrées | Coût élevé ; à traiter après clarté sur A–C. |

#### Ordre recommandé (séquentiel à l’intérieur d’une bande)

1. **A1** — Finaliser **Import — traitement de texte** : audit Unicode DOCX/ODT (plan déjà dans la sous-section), tooltip ou phrase d’aide, note QA / tests manuels sur caractères typiques ; jeux de tests automatisés si faible coût. **done** (2026-04-08 : aide UI Unicode dans `ImportScreen`, note `docs/IMPORT_DOCX_ODT_UNICODE_QA.md`, tests `tests/test_import_word_processing_unicode.py`).
2. **A2** — **Export — étapes de workflow** : produire la **matrice** « étape × formats » (même page ou annexe) ; choisir **1 à 2** étapes pilotes (ex. post-segmentation, post-align) avec bouton ou deep-link vers **Exporter** pré-rempli + même options que le job concerné ; documenter les écarts restants (ODT sortant, parité `[n]` réimport).
3. **A3** — **Normalisation espaces** : exécuter l’**audit** import → FTS → UI (liste dans la sous-section) ; **décision** produit : documenter seulement **vs** évolution de `text_norm` (impact réindexation) ; relier aux presets curation existants.
4. **B1** — **Notation `[n]`** : textes d’aide (import + panneau segmentation) sur motif en tête de ligne **vs** mode balises ; optionnel : preset curation « retirer `[n]` résiduels » si cas réels.
5. **B2** — **Préfixe avant `[N]`** : rappel UI que le bloc avant `[1]` est un segment sans `external_id` ; trancher **P3** si besoin d’option « supprimer préfixe » (voir sous-section).
6. **B3** — **XML / TEI** : décider moment (import bloquant **vs** warning) ; renforcer `validate_tei_ids` / rapports ; aligner avec l’entrée **TEI compatibility matrix** du tableau prioritaire (fixtures).
7. **B4** — **Revue pack coupes phrases** : revue de contenu des packs + exemples doc ; pas de changement moteur tant que l’audit ne conclut pas.
8. **B5** — **Segmentation — VO / parent** : doc courte sur **« Calibrer sur »** ; optionnel : étendre `segment/preview` avec `calibrate_to` pour afficher le même avertissement ratio qu’en job.
9. **C1** — **Conventions projet** : atelier codes `[T]` / équivalents ; choix import **vs** curation **vs** outil externe ; puis **P3+** d’implémentation.
10. **C2** — **Mode annotation** : atelier strates (lecture / préparation / annotation riche) ; lien explicite avec `BACKLOG_CQL.md` ; une fois cadré, ordre de travail technique (tokens, routes, UI).
11. **C3** — **Multiples bases** : trancher modèle **A** (basculer + récents) **vs** **B** (multi-fenêtre P9) avant d’envisager **C** fédéré ; renforcer l’indicateur « DB active » si besoin.
12. **C4** — **POS** : suit **C2** et granularité token/segment ; sinon reste **P3+** documentaire.
13. **D** — **Import — doublons** (polish) : messages serveur plus discriminants + test d’intégration ; **fédération multi-DB** uniquement si besoin métier prouvé.

#### Jalons / livrables suggérés

| Jalon | Contenu | Dépend de |
|-------|---------|-----------|
| **J1** | Import DOCX/ODT : critères d’acceptation Unicode + doc utilisateur 1 page | A1 |
| **J2** | Matrice export + 2 parcours « étape → export » filables | A2 |
| **J3** | Note décision normalisation (statu quo **vs** évolution) | A3 |
| **J4** | Pack aide `[n]` + TEI (règles d’erreur actionnables) | B1, B3 |
| **J5** | Fiche produit « annotation » + lien CQL | C2 |

#### Rappel : entrées déjà largement couvertes ailleurs

- **Doublons (import)** : déjà implémenté — reste polish optionnel (voir sous-section).
- **Curation — navigation doc vs diff** : traité en **P2** (libellés / accessibilité) dans le tableau prioritaire ; la sous-section reste la référence comportementale.
- **UI Segmentation — stratégie** : traité en **P2** (fieldset stratégie) ; la sous-section décrit les extensions **P3+** (séparateur custom).

---

### Import — doublons (corpus)

**État implémenté**

- **Moteur** (`src/multicorpus_engine/importers/import_guard.py`) : avant écriture, `find_duplicate_doc_id` refuse un import si — dans l’ordre — (1) même `source_hash`, (2) même chemin logique (`source_path`, normalisation slash / casse / préfixe Windows long), (3) si `check_filename=True` : même **nom de fichier seul** (casse ignorée) qu’un document existant ayant un `source_path`. Message serveur unique : `Fichier déjà présent dans le corpus (doc_id=…).`
- **Prep — écran Import** (`tauri-prep/src/screens/ImportScreen.ts`) : pré-contrôle **avant** soumission des jobs (`listDocuments` → cartes chemin + nom). Affichage **immédiat** sur la ligne du fichier : statut erreur, journal « Import », toast. Option **« Bloquer les doublons par nom de fichier »** (deux cases liées, profil + pied de page) : si cochée, le client bloque aussi les homonymes dans le lot en cours ; le job envoie `check_filename` pour alignement avec le serveur.
- **Si `listDocuments` échoue** : toast + log d’avertissement ; le pré-contrôle client est partiel, le **serveur** applique toujours hash/chemin et `check_filename` au moment de l’import.

**Quand l’utilisateur voit quoi**

| Moment | Canal | Contenu |
|--------|--------|---------|
| Clic sur « Importer » (fichiers déjà en base ou doublons dans le lot) | Liste fichier + journal + toast | Message explicite chemin déjà vu / nom déjà vu / doublon **dans le lot** (sans `doc_id` fantaisiste). |
| Import refusé côté job (course rare, liste stale, ou CLI sans UI) | Job Center + ligne fichier en erreur | Message serveur (`Fichier déjà présent…`) — ne distingue pas hash vs chemin vs nom. |

**Plan d’action / vérif**

1. **Manuel Prep** : même fichier deux fois (même chemin) → erreur avant job ; copie renommée avec case différente → selon option nom ; deux fichiers différents, même basename, chemins différents → bloqué si option cochée, message `doc_id` cohérent avec le document en base.
2. **Manuel** : deux fichiers même nom dans **un seul** lot avec option nom → second fichier refusé, libellé « dans ce lot » (pas de `doc_id -1`).
3. **Amélioration backlog (optionnelle)** : message serveur plus discriminant (hash / chemin / nom) pour le débogage ; test d’intégration Prep ↔ sidecar sur `check_filename`.

**Priorité après cadrage global des idées** : P2 (polish UX + messages serveur si besoin).

### Import — traitement de texte (DOCX / ODT)

**Objectif produit**

- **Regrouper** DOCX et ODT comme une seule famille **« traitement de texte »** (même intention utilisateur : document bureautique structuré), sans les confondre avec TXT ou TEI.
- **Limiter les choix** selon le type de fichier : pour `.docx` / `.odt`, ne proposer **que** les deux stratégies métier **paragraphes** vs **lignes numérotées `[n]`**, pas les modes TEI / TXT / etc. dans le sélecteur de ligne (aujourd’hui `ImportScreen` affiche **tous** les modes pour chaque fichier, ce qui est bruyant et source d’erreur).
- **Unicode / caractères spéciaux** : s’assurer que le parcours utilisateur et la doc reflètent comment le texte est lu (UTF-8 côté fichiers, XML ODT, `python-docx` + politique `unicode_policy` côté DOCX/TXT) ; traiter les cas limites (espaces insécables, combinaisons, symboles) de façon **explicite** et cohérente entre DOCX et ODT.

**État actuel (référence)**

- Moteur : modes distincts `docx_*` / `odt_*` (sidecar inchangé) ; ODT lit `content.xml` en ZIP ; DOCX lignes numérotées utilise `unicode_policy.normalize` / `count_sep` (`docx_numbered_lines.py`).
- UI : `_deriveModeFromExt` distingue DOCX/ODT/TXT/TEI ; défauts différents (docx → lignes numérotées, odt → paragraphes). *Avant 2026-04* : liste de modes globale pour chaque ligne ; *depuis impl. partielle* : sélecteur filtré par extension + profil « traitement de texte ».

**Décision UX retenue**

1. **Famille « Traitement de texte »** : libellés ou regroupement visuel (carte profil, aide) indiquant que DOCX et ODT partagent les mêmes **deux** modes sémantiques.
2. **Filtrage du `<select>` par fichier** selon l’extension :
   - **Option A (minimal)** : pour `docx`/`odt`, ne montrer que les **quatre** entrées pertinentes (deux formats × deux stratégies), ou seulement **deux** entrées génériques si on mappe automatiquement (voir option B).
   - **Option B (recommandée)** : **deux** modes génériques pour le traitement de texte — *« Paragraphes »* / *« Lignes numérotées [n] »* — et **mapping automatique** vers `docx_paragraphs` | `odt_paragraphs` ou `docx_numbered_lines` | `odt_numbered_lines` selon l’extension du fichier au moment du job (interne `ImportScreen` / payload inchangé côté API).
3. **Profil de lot** : le « format par défaut » doit rester cohérent avec cette famille (ex. défaut « lignes numérotées » pour toute la famille traitement de texte, ou réglage par profil).

**Implémentation Prep (mise à jour, 2026-04-08)** — `ImportScreen` : optgroup *Traitement de texte (DOCX / ODT)* avec modes logiques `wp_numbered` / `wp_paragraphs` mappés vers les modes API par extension ; `<select>` par fichier ne propose que les modes compatibles avec l’extension (critère d’acceptation « pas de TEI/TXT sur .docx/.odt » rempli côté UI). **A1 livré** : phrase d’aide Unicode + note QA (`docs/IMPORT_DOCX_ODT_UNICODE_QA.md`) + tests de parité Unicode DOCX/ODT (`tests/test_import_word_processing_unicode.py`).

**Unicode — plan de vérification**

1. Recenser où `normalize` / `count_sep` s’appliquent pour **ODT** (numéroté + paragraphes) vs **DOCX** ; aligner si besoin avec `unicode_policy.py`.
2. Jeux de test manuels ou fixtures : guillemets typographiques, espaces insécables (U+00A0), tirets, caractères accentués, éventuellement cas bidi (si pertinent).
3. Documenter en une phrase dans l’UI (tooltip ou aide) **sans** surcharger : « Texte Unicode ; normalisation selon la politique moteur ».

**Critères d’acceptation**

- Impossible de choisir TEI ou TXT pour un fichier `.docx` / `.odt` depuis l’écran Import Prep (sauf bug).
- Comportement DOCX vs ODT **symétrique** pour l’utilisateur final au niveau des deux modes.
- Liste de tests ou note de QA sur Unicode validée une fois.

**Priorité après cadrage global** : P1 (UX import claire + réduction d’erreurs).

### Notation `[n]` — import, segmentation, concordancier, curation

**Ce que l’utilisateur décrit**

- Fichiers **déjà segmentés** avec des balises du type `[n]` où `n` est un entier (identifiant de segment).

**Comportement actuel du moteur (import « lignes numérotées »)**

- Modes : `txt_numbered_lines`, `docx_numbered_lines`, `odt_numbered_lines` (chaque **ligne / paragraphe non vide** est testé).
- **Reconnaissance automatique** : une ligne correspond au motif `^\[\s*(\d+)\s*\]\s*(.+)$` (début de ligne/paragraphe après trim). Si oui :
  - `external_id` = le nombre `n` ;
  - **`text_raw` / `text_norm` = uniquement le texte *après* la balise** — le préfixe `[n]` **n’est pas stocké** dans le contenu indexé.
- Si la ligne **ne** correspond pas (balise ailleurs qu’en tête, autre syntaxe) : l’unité est en général traitée comme **structure** (pas `line` indexée comme segment numéroté) avec le texte brut du paragraphe — les `[n]` peuvent alors **rester visibles** dans le texte stocké.
- **Concordancier / FTS / requêtes** : s’appuient sur `text_norm` pour les unités `line` — donc **pas de `[42]` dans le texte** pour les imports correctement reconnus en tête de ligne.

**Resegmentation après import**

- **Actions → Segmentation** (`tauri-prep`, panneau segmentation) propose deux logiques :
  - **Phrases** (`resegment_document`) : découpe chaque unité ligne existante en phrases (règles + pack) ; les **nouvelles** unités ont `external_id = NULL` (perte des numéros d’origine comme IDs d’alignement par numéro).
  - **Balises `[N]`** (`resegment_document_markers`) : découpe le **texte déjà en base** sur des motifs `[N]` **n’importe où** dans `text_norm` ; chaque segment récupère `external_id = N` ; le texte stocké par segment **ne contient pas** la balise. Utile si tout le texte était importé en **gros blocs** (ex. paragraphes) avec des balises **à l’intérieur**.
- Si l’import « lignes numérotées » a déjà créé **une unité par `[n]`** avec texte sans balise, le mode **balises** ne refait souvent qu’**un segment par unité** (pas de `[n]` restant dans le texte).

**Curation (onglet Actions → Curation)**

- Applique des **règles regex** sur `text_norm` (nettoyage OCR, etc.). **Aucune règle par défaut** pour retirer des `[n]` — si des balises restent dans le texte (cas non reconnus à l’import), il faut les traiter par **règles curation** explicites.

**Où ça vit dans Prep**

- **Import** : choix du mode d’import (lignes numérotées vs autre) — c’est là que la reconnaissance `[n]` en tête de ligne est décidée.
- **Préparation au sens workflow** : surtout **Actions** (Segmentation / Curation / Alignement), pas un onglet « préparation » unique nommé ainsi ; la doc utilisateur peut clarifier cette navigation.

**Pistes / backlog (optionnel)**

- Aide contextuelle : rappeler le motif attendu (début de ligne) et le lien avec le mode **balises** en segmentation.
- **Priorité après cadrage global** : P2 (doc + UX) ; P1 si besoin de règles curation préconfigurées pour retirer des `[n]` résiduels.

### Curation — navigation documents vs diff

**Constat (comportement actuel — `ActionsScreen.ts`)**

- **`#act-curate-prev-btn` / `#act-curate-next-btn`** : appellent `_navigateCurateDoc(±1)` — changent le document sélectionné dans `#act-curate-doc` (liste `this._docs`), équivalent à parcourir le menu déroulant **document par document** pour enchaîner une revue de corpus. Quand aucun doc n’est encore ciblé, **Suivant** peut initialiser sur le premier doc (`_renderCurateQuickQueue`).
- **`#act-diff-prev` / `#act-diff-next`** : naviguent **dans l’aperçu** entre **occurrences de diff** (`_setActiveDiffItem`, `_filteredExamples`) — autre périmètre.

**Problème UX**

- Libellés génériques **« Précédent / Suivant »** (et **« Préc. / Suiv. »** pour les diffs) prêtent à confusion : on croit souvent que c’est la même action.

**Pistes d’implémentation (P2)**

- Renommer ou compléter par **`title` / `aria-label`** : par ex. *« Document précédent dans la liste »* / *« Document suivant dans la liste »* vs *« Occurrence de modification précédente »* / *« … suivante »* pour la rangée diff.
- Option visuelle : préfixe court **« Doc »** sur les boutons document si l’espace le permet.

**Référence code** : `_navigateCurateDoc`, `_renderCurateQuickQueue` (activation/désactivation des boutons selon l’index courant).

### Segmentation — préfixe avant balises `[N]`

**Question produit**

- Faut-il une **segmentation** qui s’applique **avant** tout `[` (marqueur générique), ou un réglage pour le **texte d’en-tête** avant le premier `[n]` numéroté ?

**Comportement déjà implémenté (`segmenter.py` — `segment_text_markers`)**

- Le découpage utilise le motif `\[\s*(\d+)\s*\]\s*` (uniquement des **crochets entourant un entier**).
- Tout **texte avant le premier `[n]`** devient **déjà** un segment séparé avec **`external_id = NULL`** (pas d’identifiant d’alignement par numéro pour ce bloc). Les segments suivants récupèrent l’`external_id` du marqueur.
- S’il n’y a **aucun** motif `[n]` dans l’unité : un seul segment `(None, texte_entier)`.

**Donc « option segmentation avant `[` » au sens strict `[n]` numéroté**

- **Pas indispensable** si l’objectif est seulement de **séparer** l’intro du reste : c’est le comportement actuel.
- Une **option** pourrait toutefois servir à **décider du sort du préfixe** :
  - **Garder** (défaut actuel) — segment non numéroté, utile pour titres / licences ;
  - **Fusionner** avec le premier segment numéroté — rarement souhaitable ;
  - **Supprimer** (ne pas créer d’unité) — à risque si on perd du contenu ; à documenter.

**Variante « tout `[` littéral » (sans nombre)**

- **Non couvert** aujourd’hui : seuls `[` + **chiffres** + `]` sont des marqueurs. Étendre à n’importe quel `[` serait ambigu (citations, listes, caractères techniques) — **déconseillé** sans grammaire de projet explicite.

**Pistes backlog (optionnel)**

- Aide UI dans le panneau Segmentation : rappeler que le **préfixe avant `[1]`** est un segment **sans** `external_id`.
- Option explicite « **ignorer le préfixe** avant le premier `[n]` » seulement si un cas d’usage métier le justifie (sinon **P3**).

**Priorité après cadrage global** : P3 sauf besoin métier fort d’option « drop préfixe ».

### UI Segmentation — stratégie et séparateurs

**Besoin utilisateur (synthèse)**

- Pouvoir **choisir clairement** le **mode** de segmentation (pas seulement « repérer des balises »).
- **Voir** ce qui **découpe** le texte (séparateurs / règles).
- À terme : choisir un **type de séparateur** jugé important pour le projet (au-delà des deux familles actuelles).

**État actuel — moteur (`POST /segment/preview`, `segmenter.py`)**

- Deux modes seulement : **`sentences`** (découpe par règles de phrase + pack d’abréviations) et **`markers`** (découpe sur motifs **`[n]`** numérotés dans `text_norm`).
- Pas de mode générique « split sur caractère X » ou « sur ¤ » exposé au sidecar pour la resegmentation (le **`¤`** est surtout une convention d’import / `count_sep`, pas un séparateur de resegmentation configurable).

**État actuel — UI Prep (`ActionsScreen`, panneau Segmentation)**

- **Langue** + **pack** (`auto`, `fr_strict`, `en_strict`, `default`) : influencent **uniquement** le mode **phrases**.
- Bascule **phrases ↔ balises** via `_segSplitMode` (bouton *« Utiliser les balises »* après détection) — le choix **existe** mais est **secondaire** dans le flux (détection balises d’abord, libellés peu « stratégie »).
- Bloc repliable **« Moteur de découpage »** : explique déjà les frontières de phrase (ponctuation + majuscule, etc.).
- **Aperçu live** : colonne brut vs segmenté — montre l’**effet**, pas toujours la **règle active** en un coup d’œil.

**Écart ressenti**

- L’utilisateur peut croire qu’il n’y a **que** la détection de balises : il manque une **entrée unique** du type *« Stratégie : phrases automatiques | balises [N] »* et un **résumé** (ex. *« Découpe sur . ! ? … + pack fr_strict »* vs *« Découpe sur [1] [2] … »*).

**Pistes P2 (UI / doc — sans changer le moteur)**

- Placer en haut du panneau un **sélecteur de stratégie** explicite (deux options), relié au même état que `_segSplitMode`.
- Mettre à jour le badge « phrases / balises » et les textes d’aide pour que le **pack** ne s’affiche **que** en mode phrases.
- Optionnel : une ligne **« Règle active »** dynamique (texte court) sous le sélecteur.

**Pistes P3+ (produit + moteur — si besoin « autre séparateur »)**

- Définir quels séparateurs ont un sens (ex. ligne vide, `¤`, pattern regex projet) ; ajouter endpoint / option côté `segmenter` + contrat sidecar ; **charge** plus élevée (tests, ambiguïtés).

**Priorité** : **P2** pour clarifier l’existant ; extensions séparateur **custom** à trancher après usage réel.

**Revue — pack « coupes phrases » (ex. pack d’abréviations)**

- Le libellé UI a été rendu plus lisible (**« Où couper les phrases »**, aide sur les fausses coupes). Il reste à **revenir** sur le fond : **contenu** des packs (`default`, `fr_strict`, `en_strict`, `auto` via `resolve_segment_pack` dans `segmenter.py`), **pertinence** des listes d’abréviations par langue, **exemples** dans la doc / infobulles, **tests** sur corpus réels ou fixtures, et **cohérence** des libellés entre Prep, logs et messages sidecar.
- **Priorité** : **P2–P3** selon retours utilisateurs et dette technique constatée.

### Normalisation — espaces et texte

**Problème perçu**

- Espaces **début/fin**, **doublons**, **espaces Unicode** (insécables, fines, etc.) peuvent varier selon la source (Word, LibreOffice, copier-coller) et donner l’impression d’**incohérences** entre `text_raw`, `text_norm`, affichage Prep et concordancier.

**État actuel — `unicode_policy.normalize` (ADR-003)**

- **NFC** ; fins de ligne unifiées ; **suppression** de certains caractères invisibles (ZWSP, BOM, soft hyphen, etc.) ; **NBSP, NNBSP, figure/thin space, ¤** → **espace ASCII unique** ; **contrôles ASCII** hors tab/saut de ligne supprimés.
- **Pas** de fusion systématique des **séquences d’espaces** en un seul espace (pas de « collapse » global des espaces multiples dans la politique actuelle).
- Les **importers** appliquent souvent `strip()` sur **lignes/paragraphes** avant analyse ; le détail peut **différer** par mode (TXT vs DOCX vs ODT).

**Pistes de recadrage**

1. **Audit** : tableau des étapes (import → `text_raw` → `text_norm` → index FTS → UI) pour chaque format courant ; cas de test **U+00A0**, doubles espaces, espaces en tête de segment.
2. **Décision produit** : faut-il **réduire** les espaces consécutifs dans `text_norm` (changement de contrat / réindexation) ou seulement **documenter** le comportement ?
3. **Curation** : règles préfixes « espaces » existantes (`CURATE_PRESETS.spaces`) — vérifier qu’elles couvrent les cas signalés.

**Priorité** : **P2** si des bugs utilisateur sont confirmés ; sinon **P3** (doc + fixtures).

### Segmentation — traductions et document parent (VO)

**Lien avec « différents modes de segmentation »**

- La recherche de **plusieurs modes** (phrases, balises, packs, etc.) recoupe la question : pour une **traduction**, faut-il segmenter la **cible** en **s’alignant** sur la structure du **texte source / parent** ?

**Ce qui existe aujourd’hui**

- **Comparaison VO** dans l’UI (vues traduction / grand texte) : affichage des unités du document de **référence** pour **contrôler visuellement** la segmentation du document cible — **pas** une contrainte automatique sur les coupures.
- **« Calibrer sur »** (`#act-seg-calibrate`, autre document de la liste) : au **job** `segment` (mode phrases), le sidecar peut recevoir **`calibrate_to`** = `doc_id` du document de référence. Effet : **contrôle du ratio** entre le **nombre** de segments produits et le **nombre** d’unités ligne du document de référence — **avertissement** si l’écart dépasse un seuil (~15 %). **Pas** une segmentation « comme le parent » au sens des frontières de texte.
- **`POST /families/{id}/segment`** : segmentation **en lot** des documents d’une famille (même pack / paramètres), pas une projection des frontières du parent sur l’enfant.

**Ce qui n’existe pas (piste produit lourde)**

- **Segmentation imposée par le parent** : par ex. **autant de segments** que le VO avec frontières dérivées de l’**alignement** (ou copie de structure `external_id`), nécessite **règles métier** + évolutions moteur (projection des limites, fusion/découpe guidée), hors simple regex de phrases.

**Pistes backlog**

- **P2 (doc + UX)** : expliquer clairement le rôle de **« Calibrer sur »** (contrôle de **cohérence des volumes**, pas alignement des phrases) ; optionnel : afficher le même **ratio / avertissement** dans l’**aperçu** si on étend `POST /segment/preview` avec `calibrate_to` (aujourd’hui l’aperçu ne le transmet pas).
- **P3+ (recherche)** : stratégies « **1 segment VO → N segments cible** » ou iso-segmentation assistée par liens d’alignement existants.

**Priorité** : clarifications **P2** ; segmentation **guidée par le parent** au sens fort → **P3+** selon cadrage métier.

### Conventions projet

**Définition (porteur)**

- Une **convention**, ici, c’est un **vocabulaire contrôlé** pour désigner des **éléments récurrents** dans différents textes (titres, intertitres, types de passages, etc.). L’équipe projet peut **définir sa propre convention** et les **manières / formats** pour l’appliquer dans les sources.
- **Exemples de marqueurs** (illustratifs, non imposés par le moteur) : **`[T]`** pour un titre, **`[TInter]`** pour un intertitre, ou d’autres codes suivant la même logique.
- **Référence historique** : le programme **LingWhistX** (exemple de travail déjà fait sur ce principe). *Le dépôt AGRAFES ne contient pas ce code* ; sur la machine de développement, le dossier source se trouve en parallèle d’AGRAFES : **`/Users/hsmy/Dev/LingWhistX`**. À réutiliser comme référence quand on formalisera la spec d’import ou d’outillage (autres clones : même logique « frère » de `AGRAFES`).

**Écart avec le moteur Agrafes aujourd’hui**

- Les segments **numérotés** alignables suivent le schéma **`[n]`** entier (import « lignes numérotées », etc.). Les **codes sémantiques** du type **`[T]`** / **`[TInter]`** ne sont **pas** reconnus nativement comme types d’unités : ils relèvent soit du **texte brut**, soit d’une future **couche** (validation, `meta_json`, schéma de convention, module d’annotation).

**Plan d’action / pistes (à prioriser après cadrage)**

1. **Documenter** la convention choisie (liste des codes, syntaxe, exemples) + **référence LingWhistX** : code / doc sous **`/Users/hsmy/Dev/LingWhistX`** (voir audit `audit/lingwhistx-v3-review.md` si utile).
2. **Décider** : reconnaissance à l’**import**, à la **curation**, ou **post-traitement** ; besoin de **schéma** fermé (liste de tags) vs texte libre.
3. **Implémentation** (P3+ tant que la liste de codes et les flux ne sont pas figés) : extraction vers métadonnées unité / document, filtres **query** / **export**.

**Priorité** : **P3+** jusqu’à inventaire des codes et choix d’intégration (import vs curation vs outil externe).

### Export — étapes de workflow et formats

**Principe porteur**

- **Chaque étape** du parcours préparation doit être **exportable** (ou **exportable en tant que telle** : instantané vérifiable hors session), et **en plusieurs formats** au choix — pas une seule sortie imposée ni un export uniquement « en fin de chaîne ».
- **Étapes visées** (alignées sur `docs/UX_FLOW_PREP.md`) : **Import** (résultat d’ingestion) ; **Documents** (vue corpus / métadonnées) ; **Actions — Curation** ; **Actions — Segmentation** ; **Actions — Alignement** ; **livraisons** (écran **Exporter** et équivalents côté CLI / concordancier).
- **Formats** : recouvrir à terme les familles utiles — **traitement de texte** (DOCX, ODT, TXT), **interop XML** (TEI), **tableaux** (CSV, TSV), **rapports** (JSONL, HTML), **alignement** (TMX, CSV d’align, bilingue), etc., avec **plusieurs options là où c’est pertinent** (ex. même état segmenté → TEI + texte lisible + snapshot JSON).

**Écart ressenti (au-delà des formats manquants unitaires)**

- Aujourd’hui, une part importante des **exports structurants** vit dans l’écran **Exporter** et les **jobs** associés (TEI, align, texte lisible, rapports, etc.) — **pas** systématiquement un bouton « Exporter cette étape » au moment où l’utilisateur **termine** la curation, la segmentation ou un run d’alignement.
- Des **prévisualisations** (curation dry-run, segmentation preview) ne sont pas toujours assorties d’un **export fichier** identique au ce que l’utilisateur valide ensuite — **à rapprocher** du principe ci-dessus.

**Pistes de cadrage (produit)**

1. **Matrice** « étape × formats possibles » (même schéma que la checklist d’acceptation).
2. **Par étape** : rappel UI ou action **Exporter** / **Télécharger** (même jeu de formats réduit + lien vers l’écran Exporter pré-rempli).
3. **Cohérence** : mêmes **options** (champ `text_raw` / `text_norm`, inclusion `external_id`, périmètre documents) exposées partout où le même objet métier est exporté.

---

#### Famille « traitement de texte » (DOCX / ODT / TXT)

**Objectif complémentaire**

- **Regrouper** DOCX, ODT et TXT comme la famille **« traitement de texte »** côté **sortie** (symétrie avec l’import), pour réexport, relecture, **réimport**.
- Cette famille est **une** des familles de formats du principe global ; elle ne remplace pas TEI, CSV, etc.

**État implémenté**

- **TXT et DOCX** — `export_readable_text` (`src/multicorpus_engine/exporters/readable_text.py`) :
  - **Job sidecar** `kind: "export_readable_text"` (`params.out_dir`, `format` ∈ `txt` | `docx`, `doc_ids`, `include_structure`, `include_external_id`, `source_field` ∈ `text_norm` | `text_raw`).
  - **Prep** : écran Exporter (produit **« Texte lisible »** / `readable_text`) propose **TXT** et **DOCX**.
  - **Contenu** : une **ligne** (TXT) ou un **paragraphe** (DOCX) par unité chargée ; en-tête `# titre [lang]` (TXT) ou titre niveau 1 (DOCX).
  - **Balises** : si `include_external_id` est vrai, préfixe **`[0001]`** (4 chiffres) sur les unités `line` avec `external_id` — **pas** le même motif que l’import « lignes numérotées » (`^\[\s*\d+\s*\]` sans padding fixe).
- **CLI `multicorpus export`** : formats documentés **TEI, CSV, TSV, JSONL, HTML** (requête) — **pas** d’appel direct à `export_readable_text` dans le flux CLI actuel ; l’usage « texte lisible » passe par **sidecar / Prep**.

**Non implémenté**

- **Export ODT** : aucun équivalent `export_readable_odt` ; l’**import** ODT existe (`odt_paragraphs`, `odt_numbered_lines`). Un export ODT impliquerait génération **OpenDocument** (ZIP + `content.xml`, styles de base) ou dépendance dédiée.

**Décisions / questions à trancher**

1. **ODT** : priorité métier (workflow LibreOffice) vs coût (nouvelle dépendance, tests, styles) ; alignement paragraphe ↔ unité comme pour DOCX.
2. **Parité motifs `[n]`** : faut-il une option d’export **sans** padding 4 chiffres, ou **identique** au motif d’import (`[12]` vs `[0012]`) pour faciliter le réimport ?
3. **Styles** : aujourd’hui DOCX = paragraphes « body » ; faut-il **titres / intertitres** (mapping `unit_type` ou conventions `[T]` / `[TInter]`) — **lien** avec **Conventions projet** si ces codes deviennent structurants.
4. **TXT « brut »** : distinguer export **unité par ligne** (actuel) d’un export **fichier unique concaténé** ou **dumps** pour usages outils — besoin utilisateur à confirmer.

**Critères d’acceptation (quand cadrage validé)**

- **Principe global** : pour chaque étape du workflow, au moins **deux formats** de sortie **pertinents** documentés (ou un format + export « paquet » ZIP multi-formats) — **sauf** étapes purement techniques si le porteur tranche autrement.
- **ODT** (si retenu) : fichier ouvrable dans LibreOffice, une unité par paragraphe ou par ligne logique, UTF-8, pas de perte de caractères par rapport à `text_norm` / `text_raw` choisi.
- **Cohérence** : doc utilisateur ou tooltip indiquant que « texte lisible » ≠ export **TEI** (structure XML) ni **résultats de requête** CSV/HTML.

**Priorité** : **P2** sur le **maillage étape ↔ exports** (UX + contrats) ; **P2** aussi si ODT ou parité réimport `[n]` sont bloquants pour la famille bureautique ; sinon **P3** sur les détails d’un format donné.

### Mode annotation (couche linguistique / travail)

**Définition (porteur)**

- Un **mode annotation** n’est **pas** la simple **consultation** du concordancier (KWIC, vue alignée, lecture des segments). C’est un **régime de travail** où l’on **ajoute, contrôle ou importe** des couches sur le texte : étiquettes **linguistiques** (tokens, lemmes, POS), **régions** ou **marqueurs** métier (lien avec **Conventions projet** : `[T]`, `[TInter]`, etc.), voire **commentaires** liés à des unités — selon ce qui est cadré.

**À distinguer (trois strates)**

1. **Lecture / exploration** (existant) : recherche FTS, KWIC, alignement, exports — **sans** édition d’étiquettes fines sur le texte.
2. **Préparation « structurelle »** (existant) : curation par règles, segmentation, alignement de documents — **sans** tokenisation ni POS dans le schéma DB actuel.
3. **Annotation au sens linguistique ou riche** (cible / recherche) : données au niveau **token** ou **span**, import **CoNLL-U** / pipeline **NLP**, requêtes du type **CQL**, export des annotations — voir **piste** dans `docs/BACKLOG_CQL.md` (sprints A–D, table `tokens`, `POST /annotate`, etc.).

**État actuel du moteur**

- Schéma SQLite **sans** table `tokens` ni import **CoNLL-U** dans les migrations livrées ; **pas** de route `POST /annotate` ni de mode CQL dans le sidecar tel que décrit dans `BACKLOG_CQL.md`.
- La **curation** agit sur `text_norm` par **regex** (nettoyage, substitutions) — ce n’est **pas** l’annotation POS / lemmatisée.
- Les **conventions textuelles** (`[T]`, etc.) restent du **texte brut** ou une future **couche** tant qu’aucun schéma d’étiquettes ou d’événements n’est adopté.

**Décisions produit à prendre**

1. **Périmètre** : annotation **uniquement** linguistique (POS, lemmes) **ou** aussi **métier** (typologie de passages, liens avec alignement) **ou** les deux — avec priorités.
2. **Lieu d’usage** : **Concordancier** (survol + surcouche), **Prep** (post-segmentation), ou **les deux** avec le même modèle de données.
3. **Source des étiquettes** : **manuel** (UI), **import** (CoNLL-U, XML enrichi), **automatique** (spaCy ou autre — dépendances optionnelles), **mixte** (auto puis relecture).
4. **Rapport au backlog CQL** : traiter `BACKLOG_CQL.md` comme **feuille de route technique** une fois les décisions 1–3 fixées ; sinon risque d’implémenter des **tokens** sans cas d’usage validé.

**Critères d’acceptation (quand spec validée)**

- Un **utilisateur** sait s’il est en **mode lecture** ou en **mode annotation** (libellé, permissions, persistance des modifications).
- Les **annotations** sont **stockées** (où et sous quelle forme), **exportables** (au moins un format cible : CoNLL-U, TEI enrichi, JSON — à trancher), et **reproductibles** après réindexation si le modèle le permet.
- **Pas de collision** non documentée entre segmentation / `text_norm` et couches token (règles de stabilité ou réannotation après changement de segments).

**Priorité** : **P3+** tant que le périmètre (strates 2 vs 3) et le lien avec `BACKLOG_CQL.md` ne sont pas arbitrés ; peut monter en **P1–P2** si un corpus annoté est au cœur du métier.

### Multiples bases — concordancier et sidecar

**Objectif produit (porteur)**

- Permettre de **travailler avec plusieurs corpus** (plusieurs fichiers **SQLite** / projets) sans ambiguïté : **basculer** entre eux, les **comparer**, ou à terme **interroger** ou **agréger** des résultats — selon le niveau de besoin (simple multitâche vs recherche **croisée** unifiée).

**État actuel (référence)**

- **Une DB active à la fois** pour une instance du **sidecar** : le serveur HTTP est lancé avec un **`db_path`** fixe ; les routes (`/query`, `/documents`, etc.) ne ciblent **que** cette base.
- **Changement de corpus** : l’utilisateur **ouvre une autre** `.db` (shell Prep / Concordancier / handoff `agrafes-shell://open-db?...`) — le sidecar est **réinitialisé** sur le nouveau chemin (comportement documenté dans `docs/INTEGRATION_TAURI.md` ; **pas** de rechargement à chaud documenté — entrée **P9** « hot-swap DB » dans les placeholders post-P8).
- **Plusieurs fenêtres / apps** : rien n’interdit d’avoir **deux shells** ou deux processus avec **deux DB** en parallèle sur la machine — mais **pas** de produit unique « vue fusionnée » des résultats.
- **Concordancier** : une session de recherche = une DB ; **pas** de barre « corpus A + corpus B » ni d’agrégat serveur.

**Modèles possibles (à trancher)**

| Modèle | Idée | Charge technique | UX |
|--------|------|------------------|-----|
| **A — Basculer seulement** | Rester sur une DB active ; raccourcis « récentes » / favoris | Faible (déjà proche de l’existant) | Simple, pas de recherche croisée |
| **B — Multi-fenêtre** | Une fenêtre Concordancier = une DB (`P9` shell multi-fenêtre) | Moyenne (Tauri) | Comparaison visuelle côte à côte, pas d’union de hits dans une liste |
| **C — Requête fédérée** | Un `POST /query` qui accepte **plusieurs** `db_path` ou une **liste de corpus** ; fusion / tri des hits | **Élevée** (plusieurs connexions SQLite, contrat sidecar, quotas mémoire, identifiants `doc_id` qui collisionnent) | Une seule UI, résultats mélangés avec **provenance** obligatoire |
| **D — Export intermédiaire** | Exporter des sous-ensembles vers une **DB de travail** dédiée (fusion offline) | Moyenne (outillage import/merge) | Contrôle fin, pas de live-query multi-DB |

**Décisions produit à prendre**

1. **Besoin réel** : le multitâche **A/B** suffit-il, ou faut-il **C** (liste d’hits unifiée) ?
2. **Identité des documents** : en **C**, préfixer les résultats par `(db_id, doc_id)` — définition d’un **registre de corpus** côté client ou serveur.
3. **Prep** : le même questionnement (travail sur deux projets) peut rester **hors scope** du concordancier si le porteur limite le sujet à **Explorer** seul.

**Critères d’acceptation (quand spec validée)**

- L’utilisateur sait **quelle DB** est active (déjà partiellement : bannière / badge — à renforcer si besoin).
- Toute fonction **multi-DB** affiche **sans ambiguïté** la **provenance** d’un hit (nom court du fichier ou identifiant projet).
- **Pas** de mélange silencieux de `doc_id` issus de bases différentes.

**Priorité** : **P3+** pour **C** ; **P2** pour **A/B** (ergonomie « récents », multi-fenêtre) si le flux actuel « ouvrir une autre DB » est jugé trop lourd.

### XML — validation, lint et cohérence (TEI)

**Objectif produit**

- Garantir la **qualité des sources XML** (surtout **TEI** et dérivés du profil projet) : **bien-formé**, **cohérent** (identifiants, liens internes), et à terme **conforme** à un **sous-ensemble de schéma** retenu — **à l’import** et/ou **en continu** (avant export, avant publication), selon le porteur.

**État actuel (référence)**

- **Import TEI** : le moteur ingère le texte selon les règles de l’importeur TEI ; les fichiers **mal formés** échouent au parse XML ; au-delà, **pas** de validation **Relax NG / XSD** systématique du document entier dans le pipeline standard.
- **Utilitaire** `validate_tei_ids` (`src/multicorpus_engine/utils/tei_validate.py`) : vérifie la **cohérence référentielle** des `xml:id` et des cibles des `<link>` (liens internes cassés) — **retour structuré**, sans dépendance lxml obligatoire.
- **Tableau prioritaire** : entrée **« TEI compatibility matrix »** (P2, `docs/BACKLOG.md`) — fixtures et doc pour variantes namespaced / non-namespaced, contenu mixte.
- **Autres XML** : **ODT** (`content.xml`) est du XML **zip** ; la **validation TEI** ne s’applique pas tel quel — périmètre **distinct** (intégrité ZIP + XML ODF si un jour on le formalise).

**Décisions produit à prendre**

1. **Moment** : bloquer l’**import** si validation échoue **vs** **avertissement** + import quand même **vs** contrôle uniquement à l’**export** (package TEI, publication).
2. **Profil** : se limiter à **bien-formé + `validate_tei_ids`** **vs** ajouter **lint** (éléments attendus du profil Agrafes / `docs/TEI_PROFILE.md`) **vs** validation externe (outil hors moteur).
3. **Scope** : **TEI seulement** en V1 **vs** tout fichier XML déclaré en import.

**Critères d’acceptation (quand spec validée)**

- Toute règle de **rejet** ou **avertissement** est **documentée** (utilisateur et opérateur).
- Les erreurs remontées sont **actionnables** (ligne / id / type), pas seulement « XML invalide ».
- Cohérence avec **export TEI** : un export package passé par les mêmes contrôles optionnels si le porteur le demande.

**Priorité** : **P2** si les corpus TEI sont hétérogènes en production ; **P3** si l’import reste sur un jeu de fichiers maîtrisés.

### Catégories grammaticales et schéma d’étiquettes

**Objectif produit**

- Permettre d’**associer** aux unités de texte (ou aux **tokens**, si le modèle évolue) des **catégories grammaticales** : POS, traits (nombre, temps), voire **tags projet** — pour **recherche**, **filtrage**, **export** et **cours** (statistiques).

**Lien avec d’autres entrées**

- **Mode annotation** : les catégories grammaticales sont **un cas** (souvent le principal) d’**annotation linguistique** ; la persistance et l’UI peuvent être **communes**.
- **`docs/BACKLOG_CQL.md`** : prévoit **UPOS** / **lemma** au niveau **token** (CoNLL-U, spaCy) — **piste technique** ; tant que la table `tokens` n’existe pas, les catégories **au niveau segment** restent **limitées** (pas de vraie POS par mot sans tokenisation).

**État actuel**

- **Pas** de colonne POS systématique sur `units` ; **pas** de schéma **UD** ou **Penn Treebank** intégré au cœur.
- **Import** : pas de CoNLL-U en prod (voir `BACKLOG_CQL.md`).
- **Convention textuelle** : des marqueurs maison dans le texte ne remplacent **pas** un **schéma d’étiquettes** interrogeable proprement.

**Décisions produit à prendre**

1. **Granularité** : **token** (cible CQL) **vs** **segment / phrase** seulement (plus simple, moins fin).
2. **Jeu d’étiquettes** : **Universal Dependencies** (`upos` / `xpos`) **vs** liste projet **vs** les deux (mapping).
3. **Origine** : **import** (CoNLL-U, XML annoté) **vs** **NLP** (spaCy, etc.) **vs** **saisie manuelle** — ou **pipeline** combinant auto + correction.
4. **Surface produit** : **Concordancier** (filtre par POS) **vs** **Prep** **vs** export uniquement.

**Critères d’acceptation (quand spec validée)**

- Le **schéma** (tags autorisés, cardinalité) est **fixé** et **documenté**.
- Les données sont **stockées** de façon **requêtable** (pas seulement du texte libre dans `meta_json` sans contrat).
- **Cohérence** avec segmentation : règle claire si les unités changent après une annotation (réinitialisation, versionnement, ou interdiction).

**Priorité** : **P3+** tant que le socle **tokens** / import CoNLL-U n’est pas arbitré ; aligner avec la **priorité du mode annotation** et de `BACKLOG_CQL.md`.

---

*Toutes les lignes du tableau **« Idées à cadrer »** ci-dessus renvoient désormais à une sous-section dédiée dans ce document (sujets encore ouverts au niveau produit, pas nécessairement implémentés).*
