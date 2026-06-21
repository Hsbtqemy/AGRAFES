# Changelog — multicorpus_engine

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

- **prep / ingestion distante WebDAV — `import-remote` (ShareDocs, Phase 1)** : nouvelle sous-commande CLI `multicorpus import-remote --url <dossier-webdav> --mode <mode>` qui parcourt un dossier WebDAV (validé contre ShareDocs Huma-Num — Nextcloud/SabreDAV) et ingère en lot tous les fichiers correspondant au mode (extension dérivée du `--mode`, surchargeable via `--include`). Chaque fichier est téléchargé en temporaire, **dédupliqué par `source_hash`** (les ré-exécutions sont idempotentes), importé via le pipeline existant (1 run/fichier), puis sa provenance `source_path` est fixée à l'URL distante. Les erreurs par fichier sont reportées **sans interrompre le lot** ; garde de taille `--max-file-mb` (200 par défaut). Client WebDAV **stdlib pur** (`urllib` + `defusedxml`, aucune nouvelle dépendance) limité à PROPFIND (Depth:1) + GET ; **TLS toujours vérifié** ; credentials lus uniquement dans l'environnement (`AGRAFES_WEBDAV_TOKEN`, ou `AGRAFES_WEBDAV_USER`/`AGRAFES_WEBDAV_PASSWORD`), **jamais persistés** en db/runs/logs. Refactor préalable : le dispatch `mode → importer` est centralisé dans `importers/dispatch.py` (`dispatch_import`), désormais point unique partagé par `import` et `import-remote`. La db reste strictement locale (pas de partage de db par WebDAV — cf. `docs/DESIGN_sharedocs_ingestion.md`). Phases 2 (endpoints sidecar) et 3 (UI Prep) à suivre. 21 nouveaux tests (client WebDAV + batch).
- **shell / avertissement « base synchronisée » (garde R-01 P3)** : à l'**ouverture ou la création** d'une base, le shell détecte si elle se trouve sous un dossier de synchronisation cloud connu (OneDrive, Dropbox, Google Drive, iCloud, macOS CloudStorage) — helper pur `isCloudSyncedPath` (heuristique par composant de chemin, sans accès OS ; 7 tests dont gardes anti-faux-positifs) — et affiche un **toast d'avertissement non bloquant** (helper partagé `_warnIfCloudSynced` câblé dans `_switchDb` *et* `_onCreateDb`, **avant** l'init du sidecar → visible même si l'ouverture traîne ou échoue, le cas même qu'on veut signaler). La synchronisation peut verrouiller le fichier SQLite et figer le sidecar ; le toast recommande de copier la base hors du dossier synchronisé. Garde environnementale de l'incident R-01 (cf. `docs/AUDIT_FOLLOW_UP.md`).

### Changed

- **docs / archivage du CHANGELOG (D-02)** : le CHANGELOG (1 951 l.) est scindé — le courant garde `[Unreleased]` + les releases semver ([0.1.12]→[0.2.6], 557 l.) ; l'historique antérieur (schéma de versions « V… » V0→V1.9 et incréments [0.1.0]→[0.6.1]) est déplacé dans [`docs/CHANGELOG_ARCHIVE.md`](docs/CHANGELOG_ARCHIVE.md) avec un pointeur. Intégrité vérifiée (82 sections, 0 perdue).

### Fixed

- **shell / sidecar — fuite de process `multicorpus.exe` orphelins (R-01)** : ouvrir une DB en mauvais état (WAL périmé, dossier cloud-sync type OneDrive qui verrouille le fichier SQLite) figeait le sidecar et laissait s'accumuler des process orphelins que la machinerie de cleanup ne récupérait pas. Les **quatre** causes corrigées (P0+P1, puis P2), cf. `docs/AUDIT_FOLLOW_UP.md` R-01 et `docs/DECISIONS.md` ADR-042 : **(R-01a)** le shutdown gracieux côté Rust envoyait le mauvais header de token (`X-Sidecar-Token` au lieu de `X-Agrafes-Token`) → `/shutdown` 401 → fuite à **chaque** fermeture ; corrigé. **(R-01c)** côté client (`shared/sidecarCore.ts`) : **single-flight** sur `ensureRunning` (une seule tentative de spawn concurrente par DB — supprime le « spawn-storm » des 4 requêtes parallèles de l'écran Constituer) + kill du child sur tout échec de spawn. **(R-01d)** `register_sidecar` transmet le `pid` (du child spawné sur le chemin spawn, du portfile sur le chemin reuse) et le Rust **force-kill par PID** (`taskkill /F /T` / `kill -9`) en secours si le `/shutdown` gracieux échoue/timeout — reap de l'arbre process vérifié headless. **(R-01b)** `/health`/`/shutdown` rendus non-bloquants sous un handler figé : `HTTPServer`→`ThreadingHTTPServer` + `daemon_threads`, lock global `Lock`→`RLock`, et **sérialisation au dispatch** dans `do_GET/POST/PUT` (carve-out lock-free de `/health`, `/openapi.json`, `/shutdown`) → un seul accès DB à la fois (pas de race ; la dette préexistante lecture-vs-job du `JobManager` est résorbée), mais `/health`+`/shutdown` restent vifs. Conçu dans `docs/TICKET_R01B_SIDECAR_THREADING.md`. Contrat OpenAPI inchangé (aucun endpoint modifié) ; `sidecar.py` net +25 l. Tests : 2 vitest (single-flight + reap) + **3 pytest concurrence** (`/health` vif sous lock tenu, réentrance RLock) + **195 tests in-process** verts (reads/POST/PUT/contrat) ; vérifié en live (1 spawn propre à l'ouverture du démo, 0 orphelin après fermeture avec sidecar actif) + smoke headless du binaire.

### Security

- **sidecar — durcissement loopback (S-01 / S-02 / S-04)** : **(S-01)** garde DNS-rebinding — `_check_host()` rejette tout header `Host` non-loopback (≠ `127.0.0.1`/`localhost`/`::1`) avec un `403 FORBIDDEN`, appelé en tête de `do_GET`/`do_POST`/`do_PUT` (défense en profondeur ; le socket est déjà borné loopback, un `Host` manquant HTTP/1.0 est toléré). **(S-02)** le portfile `.agrafes_sidecar.json` est créé via `os.open(O_WRONLY|O_CREAT|O_EXCL, 0o600)` → permissions restrictives **dès la création** (plus de fenêtre avec les perms par défaut avant le `chmod`) ; un portfile périmé (qu'on possède) est remplacé. **(S-04)** confirmé : `exporters/tei.py` est *write-only* (pas de parse → aucune surface XXE), commentaire d'import ajouté — `defusedxml` reste réservé au parsing (importers, `tei_validate`, webdav). 4 nouveaux tests in-process (`test_sidecar_security.py`) ; contrat OpenAPI inchangé.
- **prep — garde XSS bloquante en CI (S-03, phase 1)** : la règle `eslint-plugin-no-unsanitized` (`property`/`method`) devient **bloquante** (job CI `Lint tauri-prep`, scripts `lint`/`lint:prune`) — toute *nouvelle* affectation `innerHTML`/`outerHTML` qui ne passe pas par le sink typé `safeHtml``/`setHtml()` échoue désormais. Les **21 sites de la traîne** (6 fichiers : `app.ts`, `RolesPane`, `ImportScreen`, `ExportsScreen`, `AnnotationView`, `ActionsScreen`) sont routés vers `setHtml`/`appendHtml` + `raw()`. Une **passe adversariale** a trouvé que 10 de ces blocs interpolaient des données **non échappées** (titre/langue/chemin de fichier importé dans `ImportScreen` — vecteur réel, l'affichage voisin était pourtant échappé ; champs du modal preset dans `app.ts` ; langue/rôle de document dans `ExportsScreen`) : l'échappement a été ajouté (`_escHtml`/`_escHtmlApp`) pour que chaque `raw()` soit honnête plutôt que de masquer un site non sûr au linter. Les **89 sites pré-existants** des 4 écrans géants (Curation 31, Segmentation 21, Metadata 20, Align 17) sont *grandfathered* via les **bulk suppressions natives** d'ESLint 10 (`tauri-prep/eslint-suppressions.json`) ; ils se résorbent au fil de l'eau (`npm run lint:prune`) en tickets dédiés, sans pouvoir régresser. app/shell : phase ultérieure. Build + 422 tests vitest verts.
- **prep — burndown XSS `AlignPanel` (S-03, géant 1/4)** : les 17 sites *grandfathered* d'`AlignPanel` sont migrés vers le sink (`setHtml` + `raw()`) et **retirés de la baseline** (`lint:prune` → 89 → **72**). Audit d'échappement par site : 5 interpolations de données étaient non échappées et masquées par le `raw()` — texte d'unité orpheline (`o.text`), identifiants `external_id` (orphelin, candidats de reciblage, groupe de collision), langue/statut de doc dans la ligne de résumé → échappées via `_esc`. Le helper `_esc` d'`AlignPanel` est **durci** (échappe désormais aussi `"`) pour être sûr en contexte d'attribut. Reste *grandfathered* : Curation 31, Segmentation 21, Metadata 20. Build + 422 vitest verts.
- **prep — burndown XSS `MetadataScreen` (S-03, géant 2/4)** : les 20 sites *grandfathered* de `MetadataScreen` migrés vers le sink (`setHtml` + `raw()`) et **retirés de la baseline** (`lint:prune` → 72 → **52**). Audit d'échappement élargi (toute interpolation à accès-propriété, pas seulement celles collées à `>`/`="`) : 1 seule donnée non échappée trouvée — `external_id` dans `_curationStatusHtml` (le voisin `pivot_text`/`target_text` était déjà échappé) → corrigée via `this._esc`. Les autres candidats étaient des **non-sinks** (`textContent`, `opt.value`, `.title` propriété, `_log`/`toast`) ou déjà échappés (`modalConfirm` échappe via `_esc`, `richTextToHtml` sûr). Pas de hardening (les escapers `this._esc`/`_escHtmlMeta` échappent déjà `"`). Reste *grandfathered* : Curation 31, Segmentation 21. Build + 422 vitest verts.
- **prep — burndown XSS `SegmentationView` (S-03, géant 3/4)** : les 21 sites *grandfathered* de `SegmentationView` migrés vers le sink (`setHtml` + `raw()`) et **retirés de la baseline** (`lint:prune` → 52 → **31**). Audit d'échappement (accès-propriété + templates imbriqués + builders) : 2 corrections — `external_id` dans l'aperçu de segmentation (le voisin `s.text` était échappé) → `_escHtml` ; et `_roleBadgeHtml` injectait `conv.color` **brut** dans un `style="--role-color:…"` (couleur de rôle définie par l'utilisateur → breakout d'attribut possible) → passé par `safeColor` (allowlist hex), aligné sur RolesPane. Reste non-sinks (`textContent`/`toast`/`banner.textContent`) ou déjà sûrs (`richTextToHtml`). **À noter** : `CurationView` (dernier géant) porte le même bug `conv.color` brut (L2920) — sera corrigé dans son ticket. Reste *grandfathered* : Curation 31. Build + 422 vitest verts.
- **prep — burndown XSS `CurationView` (S-03, géant 4/4 — baseline vidée)** : les 31 sites *grandfathered* de `CurationView` (dernier et plus gros écran) migrés vers le sink (`setHtml`/`appendHtml` + `raw()`). La baseline tombe à **0** → `tauri-prep/eslint-suppressions.json` **supprimé**, la garde XSS est désormais **pleinement stricte** (plus aucun site toléré). Audit d'échappement (méthode complète, regex *non-ancré* pour attraper les interps en milieu d'attribut/texte) : 4 corrections — `conv.color` brut dans `style="--role-color:…"` → `safeColor` (le bug repéré depuis Segmentation) ; et `external_id` non échappé à **3** endroits dont un `aria-label="…${external_id}…"` (milieu d'attribut, qu'un regex ancré aurait raté) → `_escHtml(String(...))`. Tout le reste : non-sinks (`textContent`/`opt.value`/`setProperty`/`dataset`/`_log`/`toast`/event-detail) ou déjà échappé (texte de curation via `_escHtml`/`_renderSpecialChars`/`_highlightChanges`). **Les 4 écrans géants prep sont faits (89 sites résorbés, baseline 89 → 0).** Reste : config no-unsanitized pour `tauri-app`/`tauri-shell` (phase 2). Build + 422 vitest verts.

---

## [0.2.6] - 2026-05-19

### Added

- **prep / conventions fusionnées dans la Segmentation (onglet « Rôles »)** : le module Shell `conventionsModule` (gestion des rôles d'unités — Titre, Intertitre, vers, dialogue… — et de la borne paratexte/texte `text_start_n`) a été retiré du Shell et fusionné dans la sous-vue Segmentation de prep comme un nouvel onglet de contenu « Rôles » (barre `prep-seg-content-tab`, après « Structure »). L'onglet réutilise le document déjà sélectionné dans Segmentation — pas de second sélecteur. Le catalogue de rôles (CRUD créer/éditer/supprimer, couleurs, icônes — action rare) passe dans un panneau repliable fermé par défaut ; l'assignation de rôle (action fréquente) est la surface principale. Adresse la friction HANDOFF_PREP Tier B #7 : les conventions étaient sous-utilisées par **problème de placement** (seul élément du workflow hors du flux prep). La logique pure est extraite dans `lib/conventionsRoles.ts` (catalogue : défauts Structure, partition par catégorie, validation du formulaire) et `lib/conventionsUnitList.ts` (recherche/filtrage, paratexte, badges, compteurs) — 28 tests Vitest ; l'orchestration DOM est isolée dans `components/RolesPane.ts`, SegmentationView ne gagnant que +255 lignes.
- **prep / recherche d'unités candidates** : l'onglet « Rôles » offre un champ de recherche qui filtre la liste d'unités du document courant sur correspondance textuelle, insensible à la casse et aux accents (helper pur `foldText` + `filterUnits`). Indicateur « N/M unités · K avec rôle ». L'assignation reste manuelle (la recherche ne fait que réduire la liste aux candidats) — pas d'assignation en masse automatique, pas de recherche cross-corpus en V1.

### Changed

- **shell / `constituer` monte directement l'app prep** : avec le retrait du sous-onglet « conventions », « préparer » devient l'unique contenu de `constituerModule` — la barre de sous-onglets (38 px) a été supprimée et l'app prep est montée directement. Le `calc()` de hauteur de `.prep-seg-split-layout` est ajusté en conséquence. Les deep-links/navigation entrante qui ciblaient les conventions ouvrent désormais Actions → Segmentation → onglet « Rôles » (`ActionsScreen.segFocusDocRoles`).

### Fixed

- **prep / a11y — structure tabulaire de l'audit d'alignement (E-2)** : la liste des liens d'alignement à réviser (AlignPanel) expose désormais une structure tabulaire ARIA complète et valide — `role="table"` sur le conteneur, `role="row"` sur les lignes (déjà présent), `role="cell"` sur chaque cellule, y compris les picker-rows de reciblage rendues en mode ligne de table. Choix de `role="table"` plutôt que `role="grid"` : `grid` impliquerait le pattern de navigation clavier grille (flèches cellule à cellule) non implémenté ; `table` expose la structure aux lecteurs d'écran sans promettre une interaction absente. Clôt le dernier point ouvert du chantier E-2 (accessibilité).

---

## [0.2.5] - 2026-05-18

### Added

- **prep / arbitrage de l'index FTS (HANDOFF F4)** : la vue Documents (MetadataScreen) devient le point unique de pilotage de l'index de recherche. Un bouton d'en-tête « Mettre à jour l'index » affiche l'état global agrégé — « ✓ Index à jour » (inactif) ou « ⚠ Mettre à jour l'index (N documents) » — et reconstruit l'index via un job asynchrone non bloquant. Le chip « ⚠ Index » par document, jusqu'ici en lecture seule, devient **cliquable** et déclenche la même réindexation. Nouveau réglage opt-in « Auto après curation » : quand il est coché, une curation qui rend l'index périmé enclenche automatiquement la réindexation en arrière-plan (réglage persisté en localStorage, lu par CurationView). Helper pur `lib/prepIndexStatus.ts` (6 tests Vitest). Adresse la friction HANDOFF_PREP Tier A #4 / backlog F4.

---

## [0.2.4] - 2026-05-18

### Added

- **prep / bandeau « étape suivante »** : après une action de pipeline réussie (curation appliquée, segmentation validée, alignement terminé), un bandeau bleu non-bloquant propose l'étape suivante logique avec un bouton de navigation directe. Adresse la friction HANDOFF_PREP Tier A #3 — « l'utilisateur termine sa curation, puis ne sait pas s'il doit aller à Aligner, à Métadonnées, ou à Reindex FTS ». Les suggestions dépendent de l'état réel observé : après curation, si l'index FTS est périmé → réindexer en priorité ; si le document a des traductions → vérifier l'alignement ; sinon → exporter. Après segmentation → curation (workflow segment-first). Après alignement → export. Le pipeline n'étant pas linéaire ni bloquant (HANDOFF §3), le bandeau *suggère* sans rien contraindre et est masquable. Calcul pur `lib/prepNextStep.ts` (`computeNextSteps`, 10 tests Vitest), rendu `components/NextStepBanner.ts`.

### Internal

- **HANDOFF_PREP #5 corrigé** : la friction « CurationView lente à charger — pas de virtualization du DOM » était périmée. Les listes lourdes sont déjà bornées (liste de diff paginée à 50 lignes, file de documents à 3 items) ; aucune lenteur frontend n'a été mesurée. Item reclassé en friction de lisibilité du fichier pour les contributeurs, pas de perf utilisateur.

---

## [0.2.3] - 2026-05-18

### Added

- **prep / AlignPanel — bannière « source modifiée »** : la page d'accueil d'AlignPanel affiche désormais une bannière ambrée quand des liens d'alignement ont une source pivot modifiée depuis l'alignement (curation apply ou Mode A undo qui reflague `source_changed_at`). Un traducteur voit le signal dès l'ouverture de l'écran, sans avoir à sélectionner une paire ni ouvrir l'audit — c'était la friction Tier A #6 de HANDOFF_PREP. Nouvel endpoint `GET /align/source_changed_summary` (helper pur `aligner.source_changed_summary`, 3 tests pytest). Le détail unité par unité + l'acquittement restent dans Documents → Curation.
- **prep / chip « index FTS périmé »** : MetadataScreen affiche un chip ambré « ⚠ Index » sur chaque document dont l'index de recherche est périmé (≥ 1 unité ligne absente ou divergente dans `fts_units`). Adresse la friction Tier A #4 de HANDOFF_PREP — l'utilisateur voit désormais quels docs ont besoin d'une réindexation, sans dépendre du banner contextuel. La staleness est **dérivée en direct** (`indexer.stale_doc_ids`, comparaison `units` ↔ `fts_units`) — pas de flag persisté, donc impossible de désynchroniser ; aucune migration ni instrumentation des handlers de mutation. Le champ `fts_stale` est exposé par `GET /documents`. 6 tests pytest.

### Fixed

- **scripts / analyze_undo_soak** : deux bugs découverts en lançant le rapport de soak sur le NDJSON réel. (1) Crash `UnicodeEncodeError` sur console Windows cp1252 (le rapport contient « → ») — corrigé via reconfiguration UTF-8 de stdout. (2) L'heuristique « frustration détectée » comptait *tous* les `unavailable_view`, y compris `no_action` qui est l'état neutre (« rien à annuler ») — d'où un faux verdict « FRUSTRATION » sur des données qui relevaient en réalité de « peu utilisé ». Corrigée : `frustration_count()` n'agrège que les vraies raisons de blocage (`structural_dependency`, `unit_diverged`…). Soak Mode A clos sur cette base : peu utilisé, Mode B reporté (cf. `docs/SOAK_MODE_A.md`).

---

## [0.2.2] - 2026-05-18

### Fixed

- **prep / import DOCX `column_index`** : le dedup des cellules fusionnées verticalement (vMerge) utilisait `id(cell._tc)` comme clé. Les proxies lxml étant GC-ables, `id()` est réutilisé après collecte → un `_tc` non fusionné pouvait hériter d'un `id()` déjà vu → ligne skippée à tort (« colonne absente »). Bug non-déterministe (dépend du GC), introduit dans le chantier DOCX 2-col (commit `c5abb9f`, présent en v0.2.0/v0.2.1). Corrigé : dedup par identité d'élément (`is`) avec conservation des références — le proxy lxml reste vivant tant qu'il est référencé, donc `is` est stable. Découvert parce que le test `test_column_mostly_unnumbered_triggers_warning` échouait en suite complète (pression GC) mais passait isolé.

### Internal

- Retrait de deux locals morts dans `sidecar.py` (`current_sent` dans le preview CoNLL-U, `mapped_tgt_idxs` dans la propagation de segments) — code mort confirmé, aucun changement fonctionnel.
- Robustesse de la suite de tests : `test_annotation_excludes_paratext` skip désormais proprement quand le modèle spaCy n'est pas téléchargé (au lieu de hard-fail) ; `test_forced_kill_process_recovers_via_stale_portfile` tolère un stdout vide d'un process tué brutalement (il vérifie la récupération via portfile stale, pas le timing stdout). Suite complète : 740 passed, 1 skipped, 0 failed.

---

## [0.2.1] - 2026-05-18

### Fixed

- **prep / export TMX** : l'export TMX crashait systématiquement avec un `NameError`. `_CorpusHandler._build_tmx` référençait `SidecarHandler._escape_xml` — ancien nom de la classe handler, jamais mis à jour lors du renommage en `_CorpusHandler`. Comme `_build_tmx` est une staticmethod (référence via le nom de classe, pas `self`), l'erreur ne se déclenchait qu'à l'exécution, et les tests TMX vivant dans les `test_sidecar_*.py` (sidecar live) ne tournent pas dans tous les environnements → le bug a shippé silencieusement. Corrigé + 2 tests de régression dans `test_exporters_e2e.py` qui appellent la staticmethod directement (sans serveur).
- **prep / exporters — couverture** : `test_exporters_e2e.py` ajoute la couverture e2e qui manquait pour `ske_export`, `conllu_export` et `readable_text` (txt + docx) — aucun test direct jusque-là. Passe ruff `F821` sur tout `multicorpus_engine` : aucun autre nom non défini — le `NameError` TMX était unique.

---

## [0.2.0] - 2026-05-11

### Out of MVP

Bump symbolique 0.1.x → 0.2.0. Au cumul depuis 0.1.0 (octobre 2025), AGRAFES n'est plus une preview : pipeline prep complet (Import → Segmentation → Curation → Alignement → Annotation → Export) ; concordancier avec CQL ; familles documentaires ; corpus QA gate ; **Mode A undo** sur les 4 actions destructives ; **DOCX bilingue 2-col** lisible (Tier S #1 fermé) ; soak télémétrie pour décider sur données plutôt qu'intuition ; ~400 tests pytest + 343 tests Vitest ; contract OpenAPI gelé. Le pas 0.1.x → 0.2.0 marque la sortie de la phase MVP, pas une rupture d'API (forward-only sur toutes les évolutions récentes).

### Added

- **prep / Annotation** : nouveau toggle de tri A-Z / ID dans la sidebar de la vue Annotation (qui n'avait aucun tri exposé jusqu'ici — ordre `doc_id` brut). Utilise `compareDocsByTitle` du helper docSort partagé, A-Z par défaut.
- **prep / refresh buttons** : un bouton « ↻ Actualiser » sur chaque panneau Prep — Import, Documents, Actions hub, Curation, Segmentation, Alignement, Annotation, Exporter. 8 boutons visuellement homogènes (`btn btn-secondary btn-sm`), même glyph, même label. Friction « repasser par Actions hub pour rafraîchir une sous-vue » fermée. Sur ActionsScreen, le helper canonique `_loadDocs()` propage à toutes les sous-vues via `onDocsLoaded` / `refreshDocs` / `refreshIfConnected`.

### Changed

- **prep / tri par défaut** : A-Z devient le tri par défaut dans CurationView, SegmentationView et AnnotationView (était `doc_id` ascendant). Le bouton A-Z passe en première position dans le toggle, classe `active` initiale. Cohérent avec le retour utilisateur : un corpus de N documents importés à différents moments a des `doc_id` non-séquentiels — l'ordre alpha est plus intuitif.
- **prep / CurationView refresh label** : `↻ Rafraîchir` → `↻ Actualiser` pour cohérence avec les autres écrans.
- **prep / AnnotationView refresh label** : ajout du label visible « Actualiser » à côté du glyph (avant : glyph seul).

---

## [0.1.44] - 2026-05-11

### Added

- **prep / DOCX tables** : nouveau paramètre `column_index` sur l'importer `docx_numbered_lines` et l'endpoint `POST /import`. Quand l'utilisateur a un DOCX bilingue (corpus original/traduction côte à côte dans une table 2-col), il indique `column_index=1` ou `=2` pour extraire la colonne voulue — auparavant ces fichiers retournaient « 0 line units » sans diagnostic. Cas pathologiques surfacés dans `ImportReport` (tables_processed, rows_skipped_short, nested_tables_skipped, + 5 warnings actionnables : table trop étroite, cellule fusionnée H ou V, sous-table imbriquée, colonne sans `[N]` dominante, extraction vide). Dedup vMerge robuste par `id(cell._tc)` + détection XML `<w:vMerge>` en défense secondaire. UI : champ « col » optionnel dans la ligne d'import, affiché uniquement quand mode=`docx_numbered_lines`. 10 tests pytest. **Ferme la friction Tier S #1** de HANDOFF_PREP § 6 pour `docx_numbered_lines`. Frictions analogues sur `docx_paragraphs` / `odt_numbered_lines` / `odt_paragraphs` documentées comme limites V1 dans `docs/IMPORT_DOCX_ODT_UNICODE_QA.md` § 8 + ticket de cadrage [docs/TICKET_COLUMN_INDEX_EXTENDED.md](docs/TICKET_COLUMN_INDEX_EXTENDED.md) pour l'extension future.

### Changed

- **prep / tri docs** : nouveau helper pur `tauri-prep/src/lib/docSort.ts` (`compareDocsByTitle` + `compareLocale`) centralise le comparateur (locale FR, insensible casse+accents, `numeric:true` pour ordonner "Doc 2" avant "Doc 10", tie-break stable sur doc_id). Appliqué dans CurationView, SegmentationView, MetadataScreen, ImportScreen, AlignPanel — qui avaient 3 variantes coexistantes (`localeCompare` nu, avec `undefined`, avec `"fr"`). Les sorts secondaires (lang/role/status dans la table column-sortable de MetadataScreen) utilisent `compareLocale` pour la même cohérence. 12 tests Vitest.
- **prep / AlignPanel** : les dropdowns pivot/cible de `_populatePairSelects` sont désormais triés alphabétiquement par titre (utilisaient l'ordre `doc_id` brut). Même friction que celle observée sur Conventions, traitée ici en passant.

### Fixed

- **docs / SIDECAR_API_CONTRACT** : ajoute `POST /telemetry` qui était routé dans le sidecar mais absent du contract doc depuis sa création (test `test_contract_docs_sync.py` rouge depuis 3 sessions, maintenant vert).
- **tauri-shell / Conventions** : la liste déroulante « Choisir un document » est triée alphabétiquement (locale FR, insensible à la casse et aux accents), au lieu de l'ordre `doc_id` ascendant brut renvoyé par `/documents`. Les docs sans titre tombent en fin via leur fallback `Doc #<id>`.
- **prep / Segmentation onglet Modifier** : la table « segments enregistrés » plafonnait à 500, contre 5000 pour les autres aperçus (curate/segment preview) depuis la convention preview v0.1.40. Aligné sur 5000.
- **sidecar `/documents/preview`** : cap runtime passé de 2000 à 5000 pour la même convention. Schéma OpenAPI (`sidecar_contract.openapi_spec()`) et `docs/SIDECAR_API_CONTRACT.md` également mis à jour (étaient encore en drift `1..20` depuis la création de l'endpoint).
- **`.gitignore`** : ignore aussi `/node_modules/` à la racine (cache vitest transient qui apparaît si on lance `npx vitest` depuis la racine du repo).

---

## [0.1.43] - 2026-04-30

### Added

- **prep / undo Mode A** : bouton « ↶ Annuler » dans CurationView et SegmentationView, qui annule la dernière action destructive du document courant (curation apply, fusion d'unités, coupure d'unité, resegmentation). Backbone : nouvelle table `prep_action_history` + snapshots par unité ([migration 019](migrations/019_prep_action_history.sql)), endpoints `/prep/undo/eligibility` et `/prep/undo`, module pur `tauri-prep/src/lib/prepUndo.ts` (33 tests Vitest dont 16 pour les transitions soak). Tous les chemins (mutation + snapshot + history + flip reverted) tiennent dans une transaction unique. **Forward-only** : les actions antérieures à cette release ne sont pas annulables. Mode B (rollback historique d'une action ancienne via panneau d'historique) reste reporté à une V2 si l'usage révèle le besoin.
- **prep / soak instrumentation** : 2 events télémétrie supplémentaires (`prep_undo_eligible_view`, `prep_undo_unavailable_view`) émis sur transition matérielle du bouton Annuler (anti-bruit assuré côté pur dans `prepUndo.transitionEvent`). Couplé au `stage_returned` existant, donne un triplet voulu / disponible / bloqué pour mesurer Mode A avant d'engager Mode B. Script d'analyse stdlib-only [scripts/analyze_undo_soak.py](scripts/analyze_undo_soak.py) avec 9 tests pytest et une recommandation calculée selon 4 seuils. Protocole et arbre de décision dans [docs/SOAK_MODE_A.md](docs/SOAK_MODE_A.md).
- **multicorpus_engine** : nouveau module `regex_boot_audit.py` — audit compile-only des patterns regex custom persistés dans `corpus_info.meta_json`. Appelé au boot du `CorpusServer` après `sidecar_started`, log WARN si un pattern flag positif (POSIX/Unicode property classes, divergence `re` vs `regex.V0`). Defensive : try/except global, ne bloque jamais le démarrage du sidecar. 19 tests pytest. Ferme l'angle mort « ma DB ≠ leur DB » identifié dans HANDOFF_PREP § 7 (F5). La version full avec sample diff sur `text_norm` reste `scripts/validate_regex_migration.py` pour audits pré-migration.

### Changed

- **tauri-prep** : sous-menu Actions réordonné en `Segmentation → Curation → Alignement → Annotation` pour aligner sur le pipeline documenté en HANDOFF_PREP § 1. Ajout d'un encart § 3 « Évolution de pratique : pourquoi segment-first » qui nomme la transition (curation-d'abord venait du brut OCR à vérifier ; sources généralement déjà nettoyées + lecture en table de segments rendent la curation locale plus utile). Aucun ordre n'est bloquant ; la friction « resegmentation post-curation écrase `text_raw` » est listée § 7 backlog comme ticket futur (colonne `text_source` immuable).
- **HANDOFF_PREP § 5** « Pas d'undo automatique » → « Undo : Mode A pour les 4 destructives, pas plus », précise le périmètre V1 et les actions hors-scope (manual override individuel, bulk role, retarget align…).
- **API contract** : nouveaux endpoints `/prep/undo/eligibility` et `/prep/undo` dans `docs/SIDECAR_API_CONTRACT.md`, `docs/openapi.json` (regen via `scripts/export_openapi.py`), `tests/snapshots/openapi_paths.json`.

### Fixed

- **HANDOFF_PREP § 6 Tier C #11** : `AnnotationView` qualifié à tort de « dormant » → « étape finale efficace » (le temps passé court y est un signal positif de workflow efficient, pas un manque d'engagement).

---

## [0.1.42] - 2026-04-29

### Changed

- **tauri-prep / curation** : décomposition de `screens/CurationView.ts` (3795 → 3651 lignes) en 9 modules purs sous `tauri-prep/src/lib/curation*.ts`. Aucun changement comportemental. Les helpers sont sans DOM/IO, testables isolément, suivent un même pattern (header `Invariants protégés`, fonctions `format*`/`get*`/`build*`). Modules : `curationPresets`, `curationApplyHistory`, `curationExceptionsAdmin`, `curationDiagnostics`, `curationFiltering`, `curationCounters`, `curationSampleInfo`, `curationDiagPanel`, `curationDiffList`. CurationView conserve l'orchestration DOM, les state mutations et l'event wiring ; les calculs et rendus HTML sont délégués.

### Added

- **tauri-prep / lib** : 298 tests Vitest (vs 110 avant la décomposition) couvrant ~100 invariants explicites — chaque test cite l'invariant qu'il protège. Couverture régressions accrue sur les chemins critiques (filtres rule/status, escape HTML sur contenu utilisateur, edge cases empty/truncated, dedup rules, idempotence presets).

### Fixed

- **tauri-prep / curation** : `formatApplyHistoryRow` n'escapait pas `event.doc_title` (dans le texte ET l'attribut `title`) — bug latent identique au comportement legacy de `CurationView`. Aligné sur `formatExcAdminRow` qui escape déjà. Risque réel faible (doc_title vient de filenames imports) mais defensive coding standard.
- **tauri-prep / curation** : preset `quotes` — règles « Apostrophes courbes → droites » et « Guillemets anglais → droits » avaient un flag `g` manquant. Le test d'idempotence (Phase 1) a surfacé la divergence : sans `g`, `String.replace` ne matche que la première occurrence côté JS. Backend non affecté (translator ré-attaque le pattern complet).

---

## [0.1.41] - 2026-04-29

Cette version cumule les fixes UX, robustesse, dette technique et nouveau pipeline d'instrumentation locale depuis v0.1.40.

### Added

- **multicorpus_engine / curation** : migration de stdlib `re` vers `regex` (PyPI). Débloque les classes Unicode `\p{L}`, `\X`, et POSIX `[[:alpha:]]` dans les patterns custom. `regex.V0` forcé en compile pour éviter le silent V1 auto-switch. Script `scripts/validate_regex_migration.py` audite les patterns persistés en DB avant migration. Ajout dépendance `regex>=2023.0` dans pyproject.toml.
- **tauri-prep / lib** : nouveau helper `lib/modalConfirm.ts` — modal centré générique remplaçant `window.confirm()` natif (non fiable sur Tauri 2 WebView, cf. issue #40). Helper `inlineConfirm.ts` existant aussi rebranché. Focus sur Annuler par défaut pour les actions destructives (`danger: true`).
- **tauri-prep / import** : family dialog post-import enrichi — toggle « ce document est issu d'un autre » (mode child existant) / « ce document est l'original » (nouveau, mode parent). Le mode parent permet de sélectionner N docs existants comme enfants en un seul pass via cases à cocher. Auto-assign `doc_role` symétrique dans les deux directions.
- **tauri-prep / segmentation** : nouveau filtre « Ponctuation orpheline » — détecte les lignes commençant par `»` `)` `]` `}` `”` `’` (et `«` `‹` `›` pour les docs en allemand). Style rose/saumon avec barre rouge à gauche, voisins immédiats en contexte. Les filtres « Segments courts » et « Ponctuation orpheline » se cumulent.
- **scripts** : `validate_regex_migration.py` — vérifie chaque pattern persisté dans `corpus_info.meta_json` avant migration `re` → `regex`. Détecte POSIX/Unicode classes, échecs de compile, divergences sample-based.
- **CI** : nouveau workflow `.github/workflows/sidecar-growth-gate.yml` — gate de croissance fenêtre glissante 90j sur `sidecar.py`. Override par commit trailer `Sidecar-Growth-Override: <motif>`. Documenté dans `CONTRIBUTING.md`.
- **docs** : `CONTRIBUTING.md` créé — règles branches/commits/release/tests, sidecar growth gate, curation regex migration, conventions modal/CSS namespacing.
- **docs** : `HANDOFF_SHELL.md` et `HANDOFF_PREP.md` — briefings pour intervenants externes (Claude Code Web ou humain).
- **multicorpus_engine / telemetry** : nouveau module `telemetry.py` — instrumentation locale en NDJSON `<db_dir>/.agrafes_telemetry.ndjson`, append-only, fire-and-forget. Aucun envoi réseau. Lock fichier (`fcntl` POSIX / `msvcrt` Windows) pour gérer la concurrence rare entre sidecars sur DBs adjacentes.
- **multicorpus_engine / telemetry** : nouveau module `telemetry.py` — instrumentation locale en NDJSON `<db_dir>/.agrafes_telemetry.ndjson`, append-only, fire-and-forget. Aucun envoi réseau. Lock fichier (`fcntl` POSIX / `msvcrt` Windows) pour gérer la concurrence rare entre sidecars sur DBs adjacentes.
- **multicorpus_engine / sidecar** : endpoint `POST /telemetry` (no-auth, loopback-only — risque limité). Schéma `TelemetryRequest` ajouté à `sidecar_contract.py`. Renvoie 204 No Content. Body silencieusement droppé si malformé (contrat fire-and-forget).
- **multicorpus_engine / sidecar** : 5 events instrumentés + 1 meta-event :
  - `sidecar_started` (au boot, avec version + db_path + port)
  - `stage_completed` (import/segment/curate/align/export — duration_ms, success, doc_id quand pertinent) via context manager `_track_stage`
  - `cap_hit` sur `/segment/preview` et `/curate/preview` quand le cap 5000 est atteint
  - `doc_deleted` (avec had_curation et had_alignment dérivés en lecture pré-delete)
- **tauri-prep / lib** : nouveau module `telemetry.ts` — `reportEvent(conn, event, payload)` et `reportUserError(conn, errClass, ctx)`. Fire-and-forget, fetch errors swallowed.
- **tauri-prep / curation** : instrumentation `cap_hit` (DOM raw pane 5000) + `error_user_facing` aux 3 sites principaux d'erreur (preview, apply, submit) avec classification `SidecarError` / `JobError` / `Error`.
- **tauri-prep / curation** : bouton « ✂ » sur chaque ligne de la diff list — émet `agrafes:open-segmentation-unit` qui navigue vers Segmentation focalisé sur l'unit. Pattern de retour amont (chantier 2) — émet `stage_returned` (curate → segment) en télémétrie.
- **tauri-prep / segmentation** : nouvelle méthode `SegmentationView.focusUnit(unitN)` — switch sub-pane Modifier, scroll vers la ligne, applique highlight CSS 2s. Toast info si le doc n'est pas encore segmenté.
- **tauri-prep / app** : listener `agrafes:prep-focus-segment-unit` qui pilote le switch tab + focus + telemetry. Méthode publique `ActionsScreen.focusSegmentationOnUnit(docId, unitN)`.
- **tauri-shell / Rust** : nouvelle commande `read_telemetry_ndjson` (whitelist filename strict, lecture bornée à 5 MiB), pendant de `read_sidecar_portfile`.
- **tauri-shell / shell.ts** : entrée menu support « 📊 Télémétrie locale… » qui ouvre un modal lisant + agrégeant le NDJSON. Bouton « Exporter NDJSON brut… » via dialog plugin. Fermeture Échap + clic backdrop.
- **tauri-shell / diagnostics.ts** : trois nouvelles fonctions pures `parseTelemetryNdjson`, `aggregateTelemetry`, `formatTelemetryStats`. Robustes aux lignes malformées, payloads incomplets, types incorrects.
- **tauri-shell / scripts** : `test_telemetry_aggregate.mjs` — 40 tests Node.js purs sur les fonctions d'agrégation, suit le pattern existant `test_diagnostics.mjs`.

### Changed

- **tauri-prep / curation** : la classe diff row reçoit maintenant un bouton inline en colonne extid (avec stop-propagation pour ne pas activer la sélection au clic du bouton). CSS `.prep-diff-jump-btn` discret au repos, contrasté au hover. Animation `prep-seg-row-highlight` 2s pour signaler la ligne ciblée par focusUnit.
- **multicorpus_engine / sidecar** : cap `/segment/preview` aligné de 300 à 5000, cohérent avec `/curate/preview`. Le frontend envoyait déjà 5000 mais le backend tronquait silencieusement.
- **tauri-shell / Rust** : commande `read_text_file_raw` renommée en `read_sidecar_portfile` — le nom mentait sur la portée réelle (whitelist d'un seul fichier `.agrafes_sidecar.json`). Cohérent avec le nouveau `read_telemetry_ndjson`.
- **scripts/bump_version.py** : aligne désormais aussi `tauri-shell/package.json` (était drifté à 0.1.28 vs tauri.conf.json à 0.1.40).
- **docs/RELEASE_CHECKLIST.md** : `git tag -s` (signature GPG) obligatoire à partir de cette release.

### Fixed

- **tauri-prep / metadata** : suppression de document continuait même après clic « Annuler » sur le confirm — `window.confirm()` natif non fiable sur Tauri 2 WebView (cf. issue #40 ouverte sur le repo). Remplacé par `modalConfirm` déterministe dans les 4 sites (suppression batch, suppression relation, propagation parent→enfants, bulk update).
- **tauri-prep / segmentation** : message erreur preview « No units found » distingue maintenant 3 cas — doc inexistant (404 explicite), doc avec 0 line units mais N autres (hint « probable failed import + suggestion réimport »), doc OK. Hint UI dédié pour le cas DOCX en table 2-colonnes que l'importer ne sait pas lire.
- **scripts/build / package.json** : alignement Shell `package.json` (0.1.28 → 0.1.41) géré par `bump_version.py`.
- **multicorpus_engine / telemetry** : `emit_event` strip les clés réservées `ts`/`event` du payload — empêche un caller de poison les valeurs canoniques. `_handle_telemetry` strip aussi `db_path`/`event_name` (positionnels d'`emit_event`) pour éviter perte silencieuse d'event sur TypeError.
- **multicorpus_engine / sidecar** : context manager `_track_stage` distingue maintenant 2xx (success=true), 4xx (success=false via flag `_send_error`), exception non rattrapée (success=false + re-raise). Analytics télémétrie plus honnête.

## [0.1.40] - 2026-04-27

### Added

- **tauri-prep / Segmentation** : le filtre « Segments courts » affiche désormais aussi les voisins immédiats (n-1 et n+1) en gris muted, pour pouvoir juger en contexte si un segment court isolé doit être fusionné. La classe `.prep-seg-row-short` (jaune) jusque-là dormante est enfin appliquée aux cibles.
- **tauri-prep / Segmentation** : nouveau filtre « Ponctuation orpheline » — détecte les lignes commençant par `»` `)` `]` `}` `”` `’` (et `«` `‹` `›` pour les docs en allemand où la convention est inversée), typiques d'un mauvais découpage d'import numéroté. Style rose/saumon avec barre rouge à gauche, voisins en contexte. Les filtres se cumulent.
- **scripts** : `diagnose_dollar_pollution.py` — script read-only listant les documents dont `text_norm` contient des artefacts `$N` persistés par les runs antérieurs au fix de la syntaxe de remplacement.

### Changed

- **multicorpus_engine / curation** : presets `spaces`, `quotes`, `punctuation_fr` réécrits pour l'idempotence et la cohérence : la règle `  → " "` retirée du preset Espaces (n'écrase plus les NBSP intentionnelles), `quotes` aligné sur la NNBSP ` ` autour de `«»`, classes étendues à `[ \t  ]*` partout pour absorber les insécables héritées sans dupliquer.
- **multicorpus_engine / sidecar** : cap silencieux `limit_examples` 50 → 5000 sur `/curate/preview`. Le frontend envoyait déjà 500 et le bandeau annonçait « preview limitée à 500 exemples » mais le backend tronquait à 50. Maintenant cohérent.
- **tauri-prep / curation** : `CURATE_PREVIEW_LIMIT` 500 → 5000 et `RAW_PANE_DOM_CAP` 800 → 5000 — sur les docs de plus de 800 unités, le panneau brut affichait au plus 800 lignes.

### Fixed

- **multicorpus_engine / curation** : `$1` `$2` `$&` `$$` (syntaxe JS) dans les replacements ne sont plus écrits littéralement dans `text_norm`. Nouveau translator `_translate_js_replacement` qui les convertit en `\g<N>`/`\g<0>`/`$` Python avant `re.sub`. Touche tous les chemins (presets, Find/Replace, JSON avancé, CLI). Les refs Python `\1`/`\g<name>` sont préservées intactes.
- **tauri-prep / curation** : modal de confirmation « Appliquer » centrée avec backdrop, fermeture par Échap ou clic en dehors. Auparavant un bandeau inline tout en haut de la card, hors viewport quand le déclencheur (« Appliquer maintenant ») se trouvait en bas de la preview.
- **tauri-prep / import** : modal « Rattacher à une famille ? » post-import enfin visuellement positionnée — le JS appelait `document.body.appendChild(overlay)` mais 50 lignes de CSS `.family-dialog-overlay` étaient absentes, le dialog s'affichait en flux normal en bas de page.
- **tauri-prep / curation** : header `Modif. N/M` et footer (Accepter / Ignorer / Tout accepter / Appliquer maintenant) ne sont plus tronqués sur les fenêtres de moyenne hauteur — `.prep-doc-scroll` clamp ajusté à `(320px, 60vh, 680px)` ; breakpoint `<1400px` aligné de la même façon.
- **tauri-prep / app** : `_showPresetEditModal` plantait à l'ouverture (`querySelector(".presets-modal-foot")` au lieu de `.prep-presets-modal-foot`, préfixe `prep-` manquant) — `foot.appendChild(saveBtn)` levait un TypeError. Modale Nouveau/Modifier preset à nouveau fonctionnelle.
- **tauri-prep / curation** : presets `punctuation_en` et `numbering` corrigés via le translator backend ; le `[$1]` du preset Numérotation produit désormais `[1]` au lieu de `[$1]` littéral.
- **tauri-prep** : `.audit-batch-bar` (confirmation inline lors d'un changement d'onglet avec modifs en cours) reçoit enfin une CSS — pas de cassure de layout dans la topbar quand le bandeau s'affiche.

---

## [0.1.39] - 2026-04-24

### Added

- **tauri-prep / ImportScreen** : rattacher un document à une famille lors de l'import attribue automatiquement un `doc_role` cohérent — `translation` ou `excerpt` pour l'enfant, `original` pour le parent (uniquement si le rôle n'était pas déjà défini).
- **tauri-prep / MetadataScreen** : l'attribution de rôle en lot utilise désormais un `<select>` intégré à la barre de sélection — fonctionne dès 1 document sélectionné (plus de `prompt()`).
- **tauri-prep / MetadataScreen** : définir une relation dans le panneau métadonnées attribue automatiquement un `doc_role` cohérent (même logique que l'import).

### Changed

- **tauri-prep / MetadataScreen** : la liste déroulante des cibles de relation est triée alphabétiquement ; le préfixe `#ID` a été retiré des labels.

### Fixed

- **tauri-shell / main.rs** : le sidecar reçoit désormais le signal d'arrêt avant la fermeture de la fenêtre — le hook passe de `WindowEvent::Destroyed` à `CloseRequested` avec `prevent_close()` + `window.close()` asynchrone.

---

## [0.1.38] - 2026-04-24

### Added

- **tauri-prep / Segmentation** : tri A–Z dans le panneau gauche (boutons ID / A–Z) — familles et orphelins triés selon le même ordre.
- **tauri-prep / Segmentation** : filtre "Segments courts" (≤ 5 car.) dans l'onglet Modifier — case à cocher, badge compteur, persistant entre merges.
- **tauri-prep / Segmentation** : "Calibrer sur" trié alphabétiquement, famille du document actif proposée en premier (groupe optgroup + ↑ parent), avec fallback si connexion indisponible.
- **tauri-prep / Curation** : liste de documents avec barre de filtre texte + tri ID / A–Z + groupes familiaux — mise à jour à chaque rechargement du corpus.

### Fixed

- **tauri-prep / Segmentation** : changer de mode (Phrases ↔ Balises) bascule maintenant automatiquement sur l'onglet Aperçu.
- **tauri-prep / Segmentation** : merge/split ne remonte plus au début de la liste — le scroll est restauré sur la ligne concernée (avec animation flash).
- **tauri-prep / Segmentation** : validation d'un document ne fait plus remonter la liste des documents en haut — position de scroll préservée, doc actif ramené en vue si nécessaire.
- **tauri-prep / Curation** : l'avertissement "Quitter cet onglet" ne s'affiche plus pour une simple prévisualisation — déclenché uniquement en présence de corrections manuelles non appliquées.
- **tauri-prep / Curation** : effacer une recherche "Trouver" ou changer de document vide également le texte de feedback périmé.

---

## [0.1.37] - 2026-04-23

### Added

- **tauri-shell / Conventions → Préparer** : persistance de navigation — quand un document est sélectionné dans l'onglet Conventions puis qu'on revient dans Préparer, l'écran Curation s'ouvre automatiquement sur ce document.

---

## [0.1.36] - 2026-04-23

### Added

- **tauri-prep / MetadataScreen** : vue Hiérarchie triable — les en-têtes Titre / Langue / Rôle / Statut trient parents, enfants et documents indépendants ; indicateurs ↑ ↓ visibles dans les deux vues.

### Fixed

- **tauri-prep / ImportScreen** : dialogues "Rattacher à une famille" s'empilaient lors d'un import de plusieurs fichiers — remplacé par une file d'attente (un dialogue à la fois). "Vider" annule les dialogues en attente.

---

## [0.1.35] - 2026-04-22

### Added

- **tauri-prep / ActionsScreen** : bouton ↺ "Actualiser" dans l'en-tête "Documents du corpus" — recharge la liste depuis le sidecar sans changer de DB.
- **tauri-prep / ImportScreen** : détection automatique de la langue depuis le nom de fichier (`roman_FR.docx` → `fr`) avec whitelist ISO 639-1/2 pour éviter les faux positifs.

### Changed

- **tauri-prep / MetadataScreen + ActionsScreen** : la colonne "ID" des tables documents affiche désormais un numéro séquentiel (1, 2, 3…) à la place de l'identifiant SQLite interne.

---

## [0.1.34] - 2026-04-22

### Added

- **tauri-prep / ExportsScreen** : carte "Export bilingue / TMX" — sélecteur famille (auto-remplit pivot/cible), formats TMX · HTML · TXT, aperçu inline 8 paires, export via `POST /export/tmx` (avec `family_id` pour multi-paires) et `POST /export/bilingual`. Clôture Sprint 5 Familles côté frontend.
- **scripts** : `bump_version.py` — synchronise `pyproject.toml`, `__init__.py`, `tauri.conf.json`, `shell.ts` en une commande.

### Fixed

- **shell / About dialog** : Engine version et Contract version restaient à "…" — CORS bloquait le `fetch()` direct ; utilise désormais `getActiveConn().get("/health")` via le bridge Tauri.
- **engine** : `__init__.__version__` désynchronisé avec `pyproject.toml` (0.7.9 vs 0.8.3).
- **sidecarClient** : port non écrit dans `localStorage` sur les chemins portfile-reuse et in-memory-reuse de `ensureRunning`.

---

## [0.1.33] - 2026-04-21

### Fixed

- **tauri-prep** : `SegmentationView.ts` — variable `tick` inexistante dans le `setTimeout` du banner undo remplacée par `this._undoCountdownInterval` (TS2304).

---

## [0.1.32] - 2026-04-20

### Fixed

- **sidecar** : `GET /health` expose désormais `contract_version` (manquant, affiché "…" dans la boîte À propos).
- **tauri-shell** : constante de fallback `APP_VERSION` mise à jour (était figée à `"0.1.28"`).

---

## [0.1.31] - 2026-04-20

### Added

- **feat #39** : Recherche grammaticale — segments adjacents (prev/next). Checkbox "contexte seg." dans la toolbar ; `include_context_segments` dans le body POST `/token_query` ; chaque hit inclut `unit_n`, `prev_segment`, `next_segment`.
- **tauri-prep / ActionsScreen** : vue hiérarchie dans la card "Documents du corpus" du hub — bouton bascule 🌿 Hiérarchie / 📋 Liste, parents → enfants indentés avec badges de relation.

### Security (audit 33 findings — v0.1.31)

- **C-01** : Rust `read_text_file_raw` restreint à `.agrafes_sidecar.json` uniquement.
- **C-02** : Comparaison token via `hmac.compare_digest` (protection timing-attack).
- **C-03/C-04** : `defusedxml` remplace `stdlib ET` dans `tei_importer.py` et `tei_validate.py`.
- **C-05** : `_resolve_export_path()` appliqué à 4 handlers d'export (path traversal).
- **C-06** : `defusedxml>=0.7` ajouté aux dépendances dans `pyproject.toml`.
- **C-07** : INSERT documents placé dans `try/except` dans `odt_paragraphs` + `odt_numbered_lines`.
- **C-08→C-13** : XSS `innerHTML` corrigé dans `MetadataScreen`, `ImportScreen`, `ExportsScreen`, `AlignPanel`, `app.ts` ; `html.escape()` sur `external_id` dans `html_export.py`.
- **F-01** : `dispose()` complété dans 7 composants (listeners non annulés).
- **F-02** : `pollTimerId` stocké + `clearTimeout` dans `dispose()` (`ExportsScreen`).
- **F-04** : `permissions: contents: read` ajouté dans 9 workflows CI.
- **F-05** : `executemany`/`commit` wrappés dans `try/except/rollback` dans `aligner.py`.
- **M-01** : `MAX_BODY_SIZE` 64 MB dans `sidecar._read_body()`.
- **M-02→M-15** : fuite `str(exc)`, casts `int()`, ReDoS, LIKE métacaractères, CQL cap, CSS injection, échappement `"`, portfile `chmod 0o600`, DoS mémoire LIMIT, messages tronqués 300 chars.
- **D-09** : Plafond 512 MiB sur tous les importeurs (DOCX, TEI, ODT, CoNLL-U, TXT).

### Changed

- **sidecar_contract.py** : `CONTRACT_VERSION = "1.6.27"` — `unit_n` + `prev_segment` + `next_segment` dans `TokenQueryHit` ; `include_context_segments` dans le body `/token_query`.
- **Versions** : Engine **0.8.1** / Shell **0.1.31**.

---

## [0.1.30] - 2026-04-19

### Added

- **Migration 018** : `unit_roles.category` TEXT NOT NULL DEFAULT `'text'` (`'structure'|'text'`).

### Changed

- **Versions** : Engine **0.8.0** / Shell **0.1.30**.

---

## [0.1.29] - 2026-04-19

### Added

- **tauri-prep / app.ts** : navigation Prep → Concordancier via deep-link `agrafes-shell://open-db?mode=explorer&path=…` ; clipboard fallback si tous les `shellOpen` échouent.

### Fixed

- **Importeurs** (B6/atomicité) : `docx_numbered_lines`, `docx_paragraphs`, `tei_importer`, `txt` — parsing fichier déplacé avant la transaction SQLite ; un seul `conn.commit()` à la fin du bloc `try`.

### Changed

- **Versions** : Engine **0.8.0** / Shell **0.1.29**.

---

## [0.1.28] - 2026-04-08

### Added

- **tauri-shell** : bouton **"Vérifier les mises à jour"** dans le menu support (⚙) — interroge l'API GitHub Releases, compare les versions, affiche un modal avec notes de release et lien de téléchargement direct.
- **Rust** : commande `fetch_github_latest_release` dans `main.rs` (reqwest, contourne le CSP WebView) pour les appels externes vers `api.github.com`.

### Fixed

- **tauri-shell** : `APP_VERSION` était figée à `"1.9.10"` dans `shell.ts` et `"1.9.0"` dans `diagnostics.ts` (constantes jamais mises à jour). Corrigé : `APP_VERSION` lu dynamiquement via `getVersion()` de l'API Tauri (fallback `"0.1.28"`) ; constantes de fallback `ENGINE_VERSION_DIAG` / `CONTRACT_VERSION_DIAG` alignées avec `pyproject.toml` et `sidecar_contract.py`.
- **tauri-shell** : dialog "À propos" — engine version et contract version désormais lues en direct depuis `/health` du sidecar (affichage "…" pendant le fetch) au lieu de constantes figées.

### Changed

- **Documentation** : `DECISIONS.md` (ADR-038 PyInstaller `noarchive`, ADR-039 vérification mises à jour GitHub) ; `SIDECAR_API_CONTRACT.md` ; `STATUS_TAURI_SHELL.md`.
- **Versions** : paquet Python **0.7.9** ; applications Tauri **0.1.28**.

## [0.1.27] - 2026-04-14

### Changed

- **Bench** : `scripts/bench_sidecar_startup.py` et `tests/test_bench_sidecar_startup.py`.
- **Fixture CI** : `tauri-fixture/scripts/fixture_smoke.mjs`.
- **Versions** : paquet Python **0.7.9** ; applications Tauri **0.1.27** ; Shell **v1.9.10**.

## [0.1.26] - 2026-04-14

### Added

- **tauri-shell** : module **Conventions** (rôles d’unités) depuis l’Explorer ; script `prepare_sidecar.sh` enrichi.

### Changed

- **Sidecar** : endpoints / contrat API ; **OpenAPI** et doc contrat.
- **Concordancier** : `sidecarClient.ts` (appels conventions).
- **build_sidecar** : ajustements manifest / PyInstaller.
- **Versions** : paquet Python **0.7.8** ; applications Tauri **0.1.26** ; Shell **v1.9.9**.

## [0.1.25] - 2026-04-13

### Added

- **Migrations** : `013_unit_roles.sql`, `014_unit_role_field.sql`, `015_text_start.sql` (rôles de segment / conventions, champs associés).
- **Sidecar** : évolutions API et handlers ; contrat OpenAPI et `docs/SIDECAR_API_CONTRACT.md` synchronisés.
- **Tests** : `tests/test_sidecar_conventions.py`.

### Changed

- **Versions** : paquet Python **0.7.7** ; applications Tauri **0.1.25** ; Shell **v1.9.8**.

## [0.1.24] - 2026-04-13

### Added

- **Tests** : `tests/test_sidecar_units_merge_split.py`.

### Fixed

- **Sidecar** : fusion / scission d’unités — suppression des liens d’alignement via `pivot_unit_id` / `target_unit_id` (plus par `unit_n` seul) ; `/units/merge` et `/units/split` exigent le jeton comme les autres opérations mutantes.

### Changed

- **tauri-prep** : `sidecarClient`, `ActionsScreen`, `AlignPanel`, `app.css`, `prep-vnext.css`.
- **Versions** : paquet Python **0.7.6** ; applications Tauri **0.1.24** ; Shell **v1.9.7**.

## [0.1.23] - 2026-04-13

### Fixed

- **tauri-shell** : recherche grammaticale — filtre de langue sur les lignes alignées : utilisation de `style.display` à la place de l’attribut `hidden` (les règles CSS `.rech-aligned-row` masquaient l’effet de `[hidden]`).

### Changed

- **Versions** : paquet Python **0.7.5** ; applications Tauri **0.1.23** ; Shell **v1.9.6**.

## [0.1.22] - 2026-04-13

### Changed

- **Moteur** : `token_query` et version exportée (`__init__.py`).
- **tauri-shell** : Explorer, recherche grammaticale, `shell.ts`, script `prepare_sidecar.sh`, corpus démo embarqué.
- **tauri-prep** : `ActionsScreen`, `prep-vnext.css`.
- **Concordancier** : `dom.ts`.
- **Versions** : paquet Python **0.7.4** ; applications Tauri **0.1.22** ; Shell **v1.9.5**.

## [0.1.21] - 2026-04-11

### Added

- **Tests** : couverture CQL étendue dans `tests/test_cql_parser.py`.

### Changed

- **tauri-prep** : navigation latérale (onglets avec icônes + libellés, raccourcis Actions avec pictos) ; ajustements `prep-vnext.css` et `ActionsScreen`.
- **tauri-shell** : recherche grammaticale — palette UPOS unifiée (`UPOS_COLORS`).
- **Versions** : paquet Python **0.7.3** ; applications Tauri **0.1.21** ; Shell **v1.9.4**.

## [0.1.20] - 2026-04-10

### Added

- **CQL** : prise en charge des attributs `xpos` et `feats` dans le parseur, `token_query` et la validation côté Concordancier.
- **Sidecar** : `POST /token_stats` (distribution d’attributs sur les occurrences d’une requête CQL), contrat OpenAPI et tests associés.
- **Shell** : recherche grammaticale (module Recherche + lien depuis Explorer), export CSV token query ; intégration Explorer élargie.

### Changed

- **Versions** : paquet Python `multicorpus-engine` **0.7.2** ; applications Tauri **0.1.20** ; libellé version Shell **v1.9.3**.

## [0.1.19] - 2026-04-09

### Added

- **ADR-037** : Windows sidecar format override `onedir` → `onefile` (Tauri externalBin exige un fichier unique).
- **`scripts/read_manifest_field.py`** : helper CLI pour lire un champ de `sidecar-manifest.json` sans escaping shell (remplace les inline `python -c` avec quotes échappées dans les workflows).
- **CoNLL-U tests** : couverture étendue de 2 à 9 tests (empty nodes, sent_id non-numérique, BOM UTF-8, champs `_`, détection de doublon, fichier manquant/vide).
- **Contrat API** : 60 routes documentées dans `docs/SIDECAR_API_CONTRACT.md` et `docs/openapi.json` synchronisé avec le code.

### Fixed

- **CI Windows** : ajout de `shell: bash` sur tous les steps utilisant des continuations `\` (`tauri-shell-build.yml`, `build-sidecar.yml`, `tauri-e2e-fixture.yml`, `release.yml`).
- **CI macOS budget** : limite sidecar macOS onefile relevée à 35 MB (était 18 MB, sidecar réel = 26.4 MB).
- **`release.yml` race condition** : manifests renommés avec suffixe OS (`sidecar-manifest-macos.json`, etc.) ; filtrage des fichiers 0-octet avant publication GitHub Release.
- **`linux-manylinux-sidecar.yml`** : désactivé sur push/tags (Python manylinux2014 sans `--enable-shared`, incompatible PyInstaller) ; Linux utilise désormais `ubuntu-latest` + `actions/setup-python`.
- **`docs/openapi.json`** : resynchronisé (+343 lignes, 15 routes manquantes ajoutées).
- **Sidecar TEI BUG-FW2-01** : paramètre `tei_unit=` → `unit_element=` dans le job runner async.

### Changed

- **`bench/fixtures/sidecar_size_budget.json`** : limite macOS onefile 18 MB → 35 MB.
- **`docs/DISTRIBUTION.md`** : format Windows mis à jour, section manylinux annotée, helper script documenté.
- **`docs/DECISIONS.md`** : ADR-025 amendé + ADR-037 ajouté.
- **`docs/ROADMAP.md`** : phases V1.9.0–V1.9.3 ajoutées.

## [0.1.12] - 2026-03-23

### Added

- Importeurs **ODT** (`odt_numbered_lines`, `odt_paragraphs`) et tests associés (`tests/test_odt.py`, `tests/support_odt.py`).
- Garde **anti-doublons** côté moteur (`importers/import_guard.py`) pour l’import.

### Changed

- **Sidecar / CLI** : robustesse encodage UTF-8 (Windows), délais et flux JSON de démarrage ; ajustements `sidecar.py`, `cli.py`, importers DOCX/TXT/TEI.
- **tauri-prep** : barre d’actions Import en bas de **fenêtre** (`position: fixed`) ; correction affichage de l’écran Import sur les autres onglets (spécificité `.screen` / `.active`).
- **tauri-app / tauri-fixture** : alignement client sidecar et runners.
- **tauri-shell / tauri-prep** : évolutions build Tauri, schémas, icônes bundle Prep.
- **Docs** : entrée backlog P2 (page Exporter + vue embarquée Constituer — nettoyage / affinage).

---

> **Historique antérieur** (schéma de versions « V… » et incréments initiaux
> [0.1.0]→[0.6.1]) : archivé dans [`docs/CHANGELOG_ARCHIVE.md`](docs/CHANGELOG_ARCHIVE.md).
