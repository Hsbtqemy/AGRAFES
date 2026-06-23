# Roadmap — multicorpus_engine

> **Dernière mise à jour : 2026-06-22** — recalage post-clôture **A-03** (valideur déclaratif `services/validation.py`, 6 lots #94→#99, clôture #100) **et A-03B** (dérivation OpenAPI single-source `field_schema_to_openapi`, #101). Précédent recalage le 2026-06-20 post-clôture **U-01** (cœur connexion partagé extrait, #72/#73/#75) ; remise à niveau post-audit le 2026-06-19 (`docs/AUDIT_2026-06-12.md`), qui clôt le finding **D-01** (« ROADMAP/BACKLOG figés au 20-21 avril »). Suivi fin finding→statut→commit : **`docs/AUDIT_FOLLOW_UP.md`** ; idées produit détaillées : **`docs/BACKLOG*.md`** ; chantiers cadrés : `TICKET_*`/`DESIGN_*`. L'historique des incréments livrés est conservé plus bas (§ Historique).

## État au 2026-06-22

Moteur jugé **techniquement sain et bien gouverné** par l'audit du 12 juin (notes B+/A- ; 1 seul finding réfuté sur 23). Les trois P0 de l'audit sont **traités ou volontairement arrêtés** : filet CI relevé (lint + couverture + dependabot), correctifs métier livrés, l'extraction du monolithe `sidecar.py` (A-01) menée jusqu'à un point d'arrêt assumé (7 services), et la validation manuelle désormais remplaçable par un **valideur déclaratif** (**A-03 clos** ; **A-03B** dérive en prime le contrat OpenAPI de la même source, pilote `/index`). **U-01 (unification du client sidecar) est clos** (divergence connexion 2→0, cœur partagé `shared/sidecarCore.ts`). La vague de durcissement post-audit est de fait terminée ; restent surtout des chantiers **P1/P2** (pilotage, dette front) et un chantier produit vivant : l'ingestion ShareDocs/WebDAV (P2/P3, **P3 débloqué** par la clôture d'U-01).

> **Note (passe de vérification code, 2026-06-19).** Une revue item-par-item des 6 `BACKLOG*.md` confrontés au code a montré qu'ils étaient **fortement périmés** : la quasi-totalité des items « ouverts » sont en réalité livrés. La liste « à venir » ci-dessous est donc recalée sur l'**état réel du code**, pas sur les statuts déclarés des backlogs (détail en § Réconciliation backlogs).

## Réalisé depuis v0.2.6 / audit 2026-06-12

- **A-01 — extraction services sidecar** (point d'arrêt assumé 2026-06-18) : 7 domaines sortis en `services/` (`import`, `conventions`, `doc_relations`, `documents`, `curate`, `units`, `tokens`) ; handlers→adaptateurs fins ; `sidecar.py` 9961→8523 l.
- **A-03 — valideur de schéma déclaratif** (**clos** #94→#100) : `services/validation.py` (`Field`+`validate`, **stdlib pur**) remplace les blocs de validation manuelle, invariant **`error_code` byte-identique** par endpoint ; 6 lots (socle+preuves, `documents`/`units`/`tokens`/`doc_relations` services, 1ʳᵉ preuve handler inline). **Finding line-négatif** acté : la traîne sidecar field-by-field reste un **backlog assumé** (gain seulement sur handlers multi-champs). §8 `TICKET_A03_SCHEMA_VALIDATION.md`.
- **A-03B — dérivation OpenAPI single-source** (**clos** #101) : le `requestBody` de `/index` est **généré** du même tuple `Field` que la validation (`field_schema_to_openapi`, `services/request_schemas.py`) ; byte-identique (contract-freeze vert), 26 tests. **Pilote** ; extension **gatée** sur la complétude+typage des `Field`. §7 `TICKET_A03B_OPENAPI_FROM_FIELD.md`.
- **Filet CI relevé** (P0-2) : `[tool.ruff]` + job lint (Q-01) ; gate couverture `--cov-fail-under=60` (T-01) ; dependabot étendu npm/pip/cargo (N-01) ; 394+ tests Vitest front enfin gatés en CI ; vite 5→8 (solde DEP-1).
- **Tests cœur** (T-02) : suites directes `telemetry.py` + `curation.py` (100 %).
- **Correctifs métier** (P1-5) : re-flag des liens undo merge/split/resegment (N-02), `links_created` via rowcount (N-03), `bump_version.py` → Cargo.toml shell (N-07), race statut job documentée (N-05).
- **WebDAV/ShareDocs — Phase 1** : sous-commande CLI `import-remote` (client stdlib, dédup, dispatch unifié). *(Suite : P2-P4 livrées dans `dev`, P5 livrée sur branche — voir « Court terme ».)*
- **S-03 — garde XSS no-unsanitized** (audit P0-2, **clos** #80→#88) : 3 gardes ESLint `no-unsanitized` bloquantes en CI (`Lint tauri-prep`/`-app`/`-shell`), sink typé `safeHtml` dans les 3 front-ends. prep : phase 1 (traîne) + burndown des 4 écrans géants (baseline 89→0, `eslint-suppressions.json` supprimé). app : concordancier (KWIC sécurisé par escape-then-highlight + DOM). shell : sink réutilisé de prep, lint scopé au `src/` propre. **Aucune baseline nulle part** ; ~9 vrais sinks data non échappés corrigés, 0 XSS exploitable.
- **U-01 — unification du client sidecar** (audit P1-4, **clos** #66→#75) : `sidecarClient.ts` app/prep, divergence ramenée **25→0** (PR1a/PR1b/PR2a/PR2bc) ; cœur connexion extrait dans **`shared/sidecarCore.ts`** (neutre) — app + prep l'importent, un seul chunk `sidecarCore` + un seul `_conn` dans le shell (vérifié au bundle), Explorer-standalone préservé. Couvert par les tests d'intégration connexion/transport (T-05 partiel) repointés sur le cœur partagé.
- **Pilotage** : `AUDIT_FOLLOW_UP.md` créé (D-04) ; ce rafraîchissement (D-01).

## En cours

- *Aucun chantier en vol.* `dev` est propre ; prochaine tranche à choisir dans « Court terme » ci-dessous.

## Court terme (prochaines tranches)

- ~~**★ Export ODT** (priorité)~~ **✅ fait** : `export_readable_text` gère désormais `odt` (stdlib `zipfile` + ODF 1.2 minimal, aucune nouvelle dépendance ; round-trippable par l'importeur ODT) ; validations sidecar + écran Prep étendues. Symétrie import/export ODT rétablie.
- ~~**★ Dette doc — cadrages manquants** (priorité)~~ **✅ fait** : `docs/cadrage/METADONNEES_DOCUMENT.md` (C5/D1 — documente le modèle de métadonnées + validation advisory `validate-meta`, réf. ADR-010) et `docs/cadrage/IMPORT_RATIO.md` (C6/D2). **Correction de dérive** : D2 disait « ni logique ni doc » — en réalité la logique existait (ratio de divergence segments traduction↔pivot, seuil 15 %) mais le `0.15` était un **magic number dupliqué en 7 endroits** de `sidecar.py` ; centralisé en `SEGMENT_RATIO_WARN_THRESHOLD` + cadré (advisory, pas de garde à l'import brut, calibration actée).
- **WebDAV/ShareDocs — Phases 2-4 ✅ livrées dans `dev`** (#103 sidecar + UI Prep, #104 P4A-C trousseau/navigation/sélection, #105 P4D sécurité+annulation). **Phase 5 — détection par fichier ✅ livrée** (branche `feat/sharedocs-p5-detection`) : format + langue par fichier via le module partagé `importDetect` (source unique import local + ShareDocs), groupement par `(parent, mode, langue)`, glob retiré — §11 + §11.8. **Suivi P5 ✅ livré** (même branche) : expansion PROPFIND des **dossiers cochés** dans « Importer la sélection » (non récursif, dédup par href, erreur par dossier non bloquante — `routeEntriesToImport`/`dedupeDetectedFiles`) **+** convergence de l'**import local** sur le `xml:lang` TEI (helper partagé `detectLanguageForMode`). **Phase 6 — familles à l'import ShareDocs ✅ livrée** (branche `feat/sharedocs-p6-families`) — câble `translation_of` à l'import par lot, comme l'import local (le système familles est déjà entièrement construit, cf. `BACKLOG_FAMILLES.md` ; seul le point d'entrée ShareDocs manquait). Front-only. **P6A** : `detectFamilyGroups` + `pickDefaultPivot` extraits en module partagé `familyDetect` (whitelist `KNOWN_LANG_CODES`). **P6B** : détection + bannière hybride (pivot pré-sélectionné modifiable, décochable) + barrière de complétion de lot (`_submitGroups.onComplete`) + câblage post-import (`resolveFamilyRelations` → `setDocRelation`). Réf. `DESIGN_sharedocs_ingestion.md` §12. ShareDocs complet (P1→P6) ; suite éventuelle : rattachement à une famille **existante** (hors lot) côté ShareDocs (aujourd'hui via MetadataScreen).
- ~~**Sécurité mineure** (P1-8)~~ **✅ fait** : garde `Host` loopback / DNS-rebinding (S-01), portfile `O_EXCL|0o600` (S-02), `exporters/tei.py` confirmé write-only (S-04, pas de surface XXE).
- ~~**S-03 — burndown XSS lint**~~ **✅ CLOS** (#80→#88) : prep (phase 1 + 4 géants, baseline 89→0) **+ phase 2** `tauri-app` (#86) & `tauri-shell` (#87) + fix prep #88. Les 3 front-ends ont une garde `no-unsanitized` stricte en CI, aucune baseline. Voir `docs/TICKET_S03_PHASE2_APP_SHELL.md`.
- ~~**Pilotage** (P1-7)~~ **✅ fait** : ~~archivage du CHANGELOG (D-02)~~ (scindé → `docs/CHANGELOG_ARCHIVE.md`) ; ~~documenter `API_VERSION` vs `CONTRACT_VERSION` (D-06)~~ (section *Versioning* de `SIDECAR_API_CONTRACT.md` réécrite + dérive 1.6.23/1.6.27 signalée).
- ~~**Tests** (P1-6) : isoler les 11 fichiers versionnés sous `tests/contracts/` (T-03).~~ **✅ fait** (`git mv` → `tests/contracts/`, discovery + 225 tests collectés vérifiés). ~~Reste T-04~~ **✅ T-04 fait** (NO_PROXY centralisé en conftest ; les 26 `time.sleep` sont du polling à condition+timeout déjà robuste, re-classifié).

## Moyen / long terme

- **Rollback curation — superseded** : le cas « annuler l'apply qu'on vient de faire » est livré (Mode A undo : `prep_action_history`/migration 019, `undo.py`, `POST /prep/undo`, bouton « ↺ Annuler » dans CurationView), et couvre même merge/split/resegment. Reliquat **non livré, priorité basse** = « Mode B » (rollback d'un apply *arbitraire* de l'historique + gardes `structural_change`/`text_norm_diverged` + UI par ligne) ; schéma déjà prêt. Cf. `BACKLOG_ROLLBACK_CURATION.md`.
- **Analytics Concordancier — reste la distribution temporelle** : phase 1 (tri KWIC + dispersion) et collocations (`/token_collocates`) **livrées** ; seul manque le `group_by` année/`doc_date` dans `token_stats` (F2 phase 2).
- **Dette front** : `CurationView`/`SegmentationView`/`AnnotationView` **déjà extraits** d'`ActionsScreen` (U-02 partiel) ; les vues résultantes restent volumineuses (Curation/Metadata) → découpe au fil de l'eau. Couverture Vitest large `tauri-app` (U-03) ; render-smoke DOM différés (T-05).
- **Finitions & décisions UX (mineur)** : coloration syntaxique du champ CQL (seule vraie feature CQL non livrée, effort faible) ; SP-2.1 — navigation pivot→Prep **actée comme voulue** (cohérent avec F3), éventuel +deep-link Explorer optionnel ; D3 — harmoniser le badge « Source modifiée » dans le concordancier shell (optionnel).
- **Typage** : TypedDict pour les shapes de contrat (Q-04), attributs `HTTPServer` typés (A-04), mypy progressif (exclure sidecar.py au début) ; cap global documenté du matcher CQL (Q-05).
- **Pilotage/doc** : index des ~267 artefacts trackés (D-03) ; guide utilisateur final (D-05) ; bandeau de statut `tauri-app/README` (U-04).
- **N-04 — resegmentation destructive : ✅ arbitré (ADR-043)** : décision = colonne **`text_source` immuable** (préserve le verbatim d'import, jamais réécrit par curate/resegment/merge/split). Implémentation **phasée** : **P0 ✅** centraliser `insert_units` (6 importeurs dédupliqués ; #111) ; **P1 ✅** migration 020 `text_source` + peuplement à l'import (`= text_raw` via `insert_units` + CoNLL-U ; lignes existantes `NULL`) ; **P2 (resegment) ✅** les 2 resegmenteurs propagent `text_source` (héritage `COALESCE`) + undo restaure (snapshot JSON, sans migration) ; **P2b ✅** merge concatène / split fait hériter (`COALESCE`) + undo restaure via migration 021 (`text_source_before`) ; **P3a ✅** backend (GET /units + /documents/preview renvoient text_source/text_raw ; export `source_field=text_source` ; contrat 1.6.30) ; **P3b ✅** front (repli inline `<details>` « voir l'original » dans le tableau de segments + sélecteur « Source du texte » à l'export ; helper `hasImportOriginal`). **Reste P2c** : `apply_propagated` (propagation de structure) ne préserve pas encore `text_source` — décision de granularité section-vs-ligne à trancher. La suppression des `alignment_links` reste hors périmètre (couverte par warning + Mode A undo). Cf. `docs/DECISIONS.md` ADR-043.
- **Divers** : lockfiles + `npm ci` pour `tauri-fixture` (N-06) ; ~~fragilités timing des tests sidecar (T-04)~~ **✅ fait** (NO_PROXY centralisé ; sleeps = polling déjà robuste) ; i18n (U-05, non bloquant).
- **Shell P9** : multi-fenêtre (Explorer + Constituer), hot-swap DB sans redémarrage sidecar, dépréciation des apps standalone `tauri-app`/`tauri-prep`.
- **Distribution / supply chain** : AppImage Linux PKG-3C ; signing prod (cert Apple Developer + PFX en Secrets, scripts/workflows prêts) ; épinglage GitHub Actions par SHA (F-03).
- **Moteur (horizon)** : stratégie d'indexation incrémentale au-delà du rebuild ; packs de segmentation par langue enrichis ; workspace multi-projets + commandes de maintenance corpus ; extensions de profil TEI (ancres, apparat, métadonnées riches).

## Parqué — décision assumée (ne pas replanifier)

- **A-01 — poursuite de l'extraction sidecar** : arrêt volontaire. Les domaines à logique DB réelle sont sortis ; restent des délégateurs (`export`/`query`/`token_query`/`stats` — logique déjà ailleurs) et des handlers à état/couplés (`units/merge`+`split`, `curate_preview`/`*_export`, `align`/`segment`/`jobs`). Réf. `AUDIT_FOLLOW_UP.md`.

## Réconciliation backlogs (passe de vérification code, 2026-06-19)

Vérification item-par-item des 6 `BACKLOG*.md` contre le code : ils étaient **fortement périmés**, la quasi-totalité des items « ouverts » sont livrés. Re-balisés `✅ Livré` / superseded dans les fichiers concernés lors de cette passe :

- **Conventions — CRUD UI** (`BACKLOG_PREP_AUDIT.md` F-1/F-2) : livré via l'onglet « Rôles » (`components/RolesPane.ts` ; `create/update/deleteConvention`).
- **`POST /token_stats`** (`BACKLOG_RECHERCHE_GRAMMATICALE.md` SP-3.1) : livré (`_handle_token_stats` → `token_stats.run_token_stats`).
- **Rollback curation** (`BACKLOG_ROLLBACK_CURATION.md`) : bandeau « superseded par Mode A undo » + reliquat Mode B (cf. Moyen/long terme).

Également **confirmés livrés** par la passe mais **pas encore re-balisés ligne à ligne** dans `BACKLOG.md` (nettoyage cosmétique restant) : quick-wins Q1-Q4, UX U1-U3, décisions D1/D4/D5, features F1/F3/F5, toute la couche tokens/annotation/POS/CoNLL-U, recherche fédérée multi-DB (Model C), export TMX/bilingue, namespacing CSS E-1. Genuinement ouverts (vérifiés absents) : Export ODT, cadrages D1/D2, distribution temporelle (F2 ph.2), coloration CQL, Shell P9 (multi-fenêtre / hot-swap DB / dépréciation standalone).

---

## Historique

### Current state (implemented)

- Core DB + migrations + run logging are in place and idempotent.
- Importers implemented: `docx_numbered_lines`, `txt_numbered_lines`, `docx_paragraphs`, `tei`.
- Query modes implemented: `segment`, `kwic` (+ `--all-occurrences`, `--include-aligned`).
- Alignment implemented: `external_id`, `position`, `similarity` strategies.
- Exporters implemented: `tei`, `csv`, `tsv`, `jsonl`, `html`.
- Curation + segmentation commands implemented.
- Sidecar HTTP API implemented with versioned contract (`/openapi.json`) and async jobs.
- CLI contract hardened: parse/runtime errors now return one JSON error object on stdout with exit code `1`.
- Sidecar binary packaging scaffold implemented:
  - `scripts/sidecar_entry.py` + `scripts/build_sidecar.py`
  - canonical Tauri binaries directory `tauri/src-tauri/binaries/`
  - fixture binaries directory `tauri-fixture/src-tauri/binaries/`
  - CI matrix build workflow `.github/workflows/build-sidecar.yml`
  - PyInstaller payload optimization enabled (`--strip` non-Windows, `--optimize 1`, exclusion de modules lourds non requis)
  - size budget guard script `scripts/check_sidecar_size_budget.py` + policy `bench/fixtures/sidecar_size_budget.json`
- Tauri headless fixture implemented:
  - `tauri-fixture/` scaffold (Tauri v2 layout, no UI)
  - sidecar smoke runner validating JSON contract
  - CI matrix workflow `.github/workflows/tauri-e2e-fixture.yml`
- Sidecar hardening hook implemented:
  - startup/size benchmark script `scripts/bench_sidecar_startup.py`
  - onefile/onedir comparative output support (`bench/results/<date>_<os>_<arch>_<format>.json`)
  - benchmark aggregation script `scripts/aggregate_bench_results.py` -> `docs/BENCHMARKS.md`
- Segmentation quality harness implemented:
  - FR/EN fixtures `bench/fixtures/segmentation_quality_cases.json`
  - scoring script `scripts/bench_segmentation_quality.py`
  - summary doc `docs/SEGMENTATION_BENCHMARKS.md`
- Persistent sidecar HTTP hardened:
  - `/health`, `/query`, `/index`, `/import`, `/shutdown`
  - sidecar portfile `.agrafes_sidecar.json`
  - graceful shutdown path and fixture persistent scenario
  - stale portfile restart policy (`already_running` vs stale recovery)
  - optional localhost token mode + `status` command
  - explicit localhost security posture (threat model + token lifecycle + wrapper defaults) in `docs/SIDECAR_SECURITY_POSTURE.md`
- Distribution tooling scaffold implemented:
  - macOS sign/notarize scripts for sidecar + fixture app
  - Windows signing script (signtool)
  - Linux manylinux build script + Dockerfile
  - release/signing workflows with secrets-conditional behavior
  - sidecar build workflows now cache pip + PyInstaller work dir (`build/sidecar_pyinstaller`) and reuse cache via `--no-clean` for faster rebuilds
  - bench matrix workflow `.github/workflows/bench-sidecar.yml`
  - `docs/DISTRIBUTION.md`
- ADR-025 finalized from multi-OS benchmarks:
  - default format mapping: macOS=`onefile`, Linux=`onedir`, Windows=`onedir`
  - workflows aligned to explicit per-OS format selection
- FTS performance profiling completed:
  - benchmark script `scripts/bench_fts_profile.py`
  - reference report `docs/FTS_PERFORMANCE_PROFILE.md`
  - recommended SQLite tuning profile (WAL + throughput pragmas + maintenance cadence)
- Incremental indexing mode completed (explicit gate):
  - CLI `index --incremental`
  - sidecar `POST /index {"incremental": true}`
  - async jobs `kind=index` with `params.incremental`
  - design note `docs/INCREMENTAL_INDEXING.md`

### Détail des incréments livrés (Prep, Concordancier, Shell)

- All core engine increments done (V1.0–V2.8): importers, query, alignment, exports, sidecar, packaging.
- **Tauri UI "Concordancier" V0** done: search-first desktop app (`tauri-app/`), V0.1 aligned view, V0.2 pagination.
- **Concordancier Prep V0** (`tauri-prep/`) — corpus preparation desktop app:
  - 3-screen scaffold: Project (DB open/sidecar status/shutdown), Import (batch + index), Actions (curate/segment/align/validateMeta).
  - V0.3: curation preview (dry-run diff + stats banner) + align audit (paginated link table).
  - V0.4: metadata panel (per-doc edit + bulk edit + relations + validate), exports (TEI/CSV/run report), align manual correction (accept/reject/delete/retarget per link). 162 tests passing.
  - V0.5: Job Center panel (async enqueue for all long ops) + contract freeze (OpenAPI snapshot + docs sync tests). 189 tests passing.
  - V0.6: “Open in Concordancier” helpers in topbar flow (copy/URI handoff, short instructions, fallback manual open).
  - V0.6.1: segmentation quality pack selector in Actions screen (`auto`, `default`, `fr_strict`, `en_strict`) wired to sidecar `/segment` + job enqueue.
  - V0.7: align strategy `external_id_then_position` (hybrid fallback) wired in sidecar + jobs + Actions screen.
  - V0.8: align explainability option (`debug_align`) for `/align` and align jobs; Actions screen logs per-strategy debug sources/stats.
  - V0.8.1: align explainability UI polish — dedicated panel in Actions (sources, similarity stats, sample links) + "Copier diagnostic JSON".
  - V0.9: segmentation quality fixtures + benchmark harness (`bench/fixtures/segmentation_quality_cases.json`, `scripts/bench_segmentation_quality.py`, `docs/SEGMENTATION_BENCHMARKS.md`).
  - V0.10: align explainability linked to persisted runs (`run_id` on `/align` + align jobs), exportable via run report filter in `tauri-prep` Exports.
  - **V1.1 (Sprint 1.1)**: `POST /align/quality` — alignment quality metrics. CONTRACT_VERSION=1.1.0. 9 new tests → 217 total.
  - **V1.2 (Sprint 1.2)**: `/align/audit` include_explain + status enum + text badges.
  - **V1.3 (Sprint 1.3)**: `/align/links/batch_update` — multi-select accept/reject/delete in ActionsScreen.
  - **V1.4 (Sprint 1.4)**: `/align/retarget_candidates` (read, no token) + retarget modal in ActionsScreen. CONTRACT_VERSION=1.2.0. 11 tests → 248 total.
  - **V1.5 (Sprint 1.5)**: `/align/collisions` + `/align/collisions/resolve` — collision resolver. CONTRACT_VERSION=1.3.0. 19 tests → 267 total. ActionsScreen V1.5 collision card.
  - **V1.6 (UX finalization hook)**: persisted document workflow status for Prep (`draft|review|validated`) via migration 005 + `/documents` and `/documents/update` extensions.
  - `tauri-prep` Documents tab now exposes the workflow state directly (badge in doc list + status selector + quick action "Valider ce document").
  - `tauri-prep` Actions tab now includes a persisted "Après validation" routing choice (`Documents` / `Document suivant` / `Rester sur place`) for segmentation finalization.
  - `tauri-prep` Documents tab now includes `Sauvegarder la DB` (sidecar `POST /db/backup`, timestamped `.db.bak` output + status/log feedback).
  - `tauri-prep` Documents tab now includes a mini content preview (`GET /documents/preview`) to verify the selected document before metadata edits.
  - `tauri-prep` Import tab now uses user-facing mode labels and explicit lot-to-pending propagation.
  - `tauri-prep` Exporter now exposes a unified V2 flow card (`jeu de données → produit → format`) with dynamic options and one launch action, including readable text exports (`TXT`/`DOCX`).
  - Export V2 scope controls hardened: explicit selection summary + empty-scope block before launch.
  - Prep hardening baseline done: focus-visible global, accordion ARIA wiring, icon-button accessibility labels on critical actions.
- Deep-link handoff implemented from `tauri-prep` to unified shell: `agrafes-shell://open-db?mode=explorer&path=...` (startup + runtime listener, fallback clipboard fallback).
- **Importeurs — atomicité (ADR-040)** : parsing fichier avant transaction SQLite dans tous les importeurs ; rollback couvre document + unités (v0.1.29).
- **Audit sécurité externe 2026-04-19 — 33 findings résolus (v0.1.31)** : C-01→C-13 (XXE, XSS, path traversal, atomicité, timing-attack) ; M-01→M-15 (DoS, ReDoS, LIKE injection, CSS injection, fuite erreurs) ; F-01→F-05 (dispose listeners, CI permissions) ; D-09 (plafond 512 MiB importeurs). Référence : `docs/AUDIT_2026-04-19.md`.
- **feat #39 — Segments adjacents (ADR-041, v0.1.31)** : opt-in `include_context_segments` dans `/token_query` ; chaque hit expose `prev_segment` / `next_segment` ; UI checkbox dans toolbar recherche grammaticale.
- **Hub Actions — vue hiérarchie (v0.1.33)** : bouton bascule 🌿 Hiérarchie dans la card "Documents du corpus" du hub ActionsScreen.
- **About dialog (v0.1.32/33)** : `GET /health` expose `contract_version` ; boîte À propos affiche Engine + Contract version en live depuis le sidecar.
- **Concordancier V1.0 (Sprint 2.1)**: IntersectionObserver sentinel — auto load-more on scroll.
- **Concordancier V1.1 (Sprints 2.2/2.3)**: Query builder (phrase/and/or/near) + FTS safety guards + parallel KWIC 2-column layout.
- **Concordancier V2.4 (Sprint 2.4)**: Virtualised hits list — CSS content-visibility + JS DOM cap (VIRT_DOM_CAP=150).
- **Sprint 3.3**: CI workflow (`.github/workflows/ci.yml`) + RELEASE_CHECKLIST.md + glibc floor doc.
- **Shell App V0 (tauri-shell/)**: unified Tauri 2.0 shell embedding both Prep + Concordancier;
  state-based router (home/prep/concordancier), lazy dynamic imports, shared sidecar connection;
  `build-shell` CI job; deprecation notices in standalone apps. Port 1422, id `com.agrafes.shell`.
- **Shell App V0.2 (tauri-shell/)**: DB state unique (badge + switch + re-mount), persistance localStorage
- **Shell App V0.3 (tauri-shell/)**: panneau métadonnées hits (Explorer), démo corpus FR/EN bundlée (first-run), toggle include_explain dans audit (Prep)
  (last_mode + last_db_path), deep-link boot (#hash / ?mode=), module wrappers mount/dispose
  (`explorerModule.ts`, `constituerModule.ts`), `ShellContext` interface, toast notifications.
- Keep CLI contract stable and test-gated (single stdout JSON object, success/error envelope).
- Keep sidecar optional and non-blocking for CLI-first workflows.
- Maintain deterministic, lightweight regression tests (no heavy corpus fixtures).

> Les anciennes sections « Next » / « Later » (avril) ont été refondues dans la roadmap à venir, en tête de fichier. Items reportés tels quels : AppImage PKG-3C, signing prod, F-03 SHA pinning, multi-fenêtre, indexation incrémentale avancée, packs de segmentation enrichis, workspace multi-projets, extensions de profil TEI.

### Phases — incréments livrés

| Phase | Scope | Status |
|-------|-------|--------|
| V1.0 | DB + DOCX numbered lines + FTS + segment/KWIC query | Done |
| V1.1 | Alignment tables + external_id alignment + aligned query view | Done |
| V1.2 | TEI/CSV/TSV/JSONL/HTML exports + metadata validation | Done |
| V2.0 | TXT/DOCX-paragraph importers + position alignment + multi-KWIC | Done |
| V2.1 | TEI importer + curation + proximity query | Done |
| V2.2 | Sidecar API + segmentation + contract/diagnostics hardening | Done |
| V2.3 | Sidecar binary packaging scaffold (PyInstaller + CI matrix) | Done |
| V2.4 | Tauri headless fixture E2E + sidecar hardening hooks | Done |
| V2.5 | Persistent sidecar HTTP UX path + portfile + shutdown flow | Done |
| V2.6 | Restart policy + optional localhost token + path consistency cleanup | Done |
| V2.7 | Full distribution scaffold (mac/win sign, linux manylinux, release workflow) | Done |
| V2.8 | Multi-OS bench workflow + benchmark aggregation docs | Done |
| V3.0 | Tauri UI Concordancier V0 (search-first, sidecar-driven) | Done |
| V3.1 | Concordancier Prep V0 scaffold (tauri-prep, 3 screens) | Done |
| V3.2 | Concordancier Prep V0.3 (curate preview diff + align audit UI) | Done |
| V3.3 | Concordancier Prep V0.4 (metadata panel + exports + align correction) | Done |
| V3.4 | Concordancier Prep V0.5 (async job enqueue + Job Center + contract freeze) | Done |
| V3.5 | Concordancier Prep V0.6 (Prep → Concordancier handoff helpers + workflow docs) | Done |
| V3.6 | Concordancier Prep V0.6.1 (segmentation quality pack selector + sidecar pack plumbing) | Done |
| V3.7 | Concordancier Prep V0.7 (advanced align strategy `external_id_then_position`) | Done |
| V3.8 | Concordancier Prep V0.8 (align explainability `debug_align`) | Done |
| V3.9 | Concordancier Prep V0.8.1 (align explainability panel + diagnostic copy) | Done |
| V3.10 | Concordancier Prep V0.9 (segmentation quality fixtures + benchmark harness) | Done |
| V3.11 | Concordancier Prep V0.10 (align explainability linked to persisted runs + export filter) | Done |
| V4.0 | Concordancier Prep V1.1 Sprint 1.1 (`POST /align/quality` + quality panel UI) | Done |
| V4.1 | Concordancier V1.0 Sprint 2.1 (IntersectionObserver auto-scroll sentinel) | Done |
| V1.5.0 | Shell: Publication Wizard (5 steps) + Global Presets store | Done |
| V1.5.1 | Engine: Corpus QA report JSON/HTML + job kind + ExportsScreen gate UI | Done |
| V1.5.2 | TEI: export profile preset (parcolab_like) + UI selector (prep + wizard) | Done |
| V1.6.0 | QA: Strict policy (lenient/strict) + gates UI (prep + wizard) | Done |
| V1.6.1 | Shell: Onboarding Demo guided tour (3 steps + Explorer welcome hint) | Done |
| V1.6.2 | TEI: parcolab_strict profile (opt-in) + manifest validation_summary | Done |
| V1.7.0 | CI: automated release gate (pytest + FTS + builds + demo QA + TEI validate) | Done |
| V1.7.1 | Shell: MRU DB list + pin + missing-DB recovery + _switchDb hardening | Done |
| V1.7.2 | Shell: About dialog + shortcuts panel + wording harmonization | Done |
| V1.8.0 | CI: Tauri Shell build workflow (unsigned, matrix mac/linux/win) | Done |
| V1.8.1 | CI: Signing/notarization workflows (macOS + Windows, secrets-gated) | Done |
| V1.8.2 | Shell: local crash logging + log export bundle (no telemetry) | Done |
| V1.9.0 | PKG-1→PKG-3A: packaging tri-plateforme (macOS .dmg ✅, Windows NSIS ✅, Linux ⏳) | Done |
| V1.9.1 | CI hardening: PowerShell `\`, budget macOS 35 MB, manylinux désactivé, race condition manifests | Done |
| V1.9.2 | Tests CoNLL-U: couverture 2→9 tests (empty nodes, BOM, duplicates, etc.) | Done |
| V1.9.3 | Contrat API: 60 routes documentées + openapi.json synchronisé | Done |
| V2.0.0 | Audit sécurité externe 33 findings — C/M/F/D findings résolus (v0.1.31) | Done |
| V2.0.1 | feat #39 : segments adjacents opt-in dans recherche grammaticale (v0.1.31) | Done |
| V2.0.2 | Hub Actions : vue hiérarchie documents (v0.1.33) | Done |
| V2.0.3 | About dialog : contract_version live depuis /health (v0.1.32/33) | Done |
| V2.1.0 | Audit 2026-06-12 : filet CI (ruff + couverture 60 % + dependabot) + tests cœur (Q-01/T-01/N-01/T-02) | Done |
| V2.1.1 | A-01 : extraction de 7 services sidecar (point d'arrêt assumé, sidecar.py 9961→8523 l.) | Done |
| V2.1.2 | Correctifs métier audit : undo reflag, links_created via rowcount, bump Cargo.toml (N-02/N-03/N-07) | Done |
| V2.1.3 | WebDAV/ShareDocs Phase 1 : CLI `import-remote` (stdlib, dédup, dispatch unifié) | Done |
| V2.1.4 | U-01 : sidecarClient app/prep — divergence 25→0 + cœur partagé `shared/sidecarCore.ts` (PR1a/1b/2a/2bc, #66→#75) | Done |
| D-01 | Pilotage : ROADMAP/BACKLOG remis à niveau post-audit + AUDIT_FOLLOW_UP.md (D-04) | Done |
