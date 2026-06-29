# Changelog — multicorpus_engine

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

- **prep / tests — render-smoke happy-dom pour les écrans monolithiques (T-05, socle décompo U-02)** : `tauri-prep` gagne l'**infrastructure de render-smoke DOM** (happy-dom en devDep, opt-in **par fichier** via le docblock `// @vitest-environment happy-dom` — l'environnement par défaut du paquet reste `node`, donc **zéro impact** sur les tests existants). Deux **tests de caractérisation** montent les vrais écrans **sans connexion sidecar** (`getConn → null`) — `render()` construit alors son DOM statique sans aucun appel réseau — et vérifient qu'ils rendent leur structure clé et se démontent proprement : `CurationView.render.test.ts` (3802 l.) et `MetadataScreen.render.test.ts` (3201 l.). **But** : un filet de sécurité avant toute **décomposition** de ces deux écrans U-02 (on ne pouvait pas refactorer en confiance sans render-tests). Ne réduit pas encore les monolithes — c'est le **socle qui dé-risque** la suite. 570 tests prep verts (563 + 7).

- **shell — coloration syntaxique du champ CQL (recherche grammaticale)** : le `<textarea>` de requête CQL du module Recherche gagne une **coloration syntaxique** en direct. Technique **overlay** : un calque `<div>` coloré derrière un textarea au **texte transparent** (caret visible), les deux partageant exactement le même modèle de boîte (police monospace, padding, line-height, bordure) pour que les glyphes s'alignent ; le calque suit le scroll du textarea (auto-grandi, plafonné à 120px). Tokeniseur **pur, sans dépendance** (`tauri-shell/src/modules/cqlHighlight.ts`) — scanner caractère par caractère (pas de regex, robuste sur saisie partielle/invalide → tout l'inconnu reste neutre) qui classe : crochets `[ ]`, attributs (`word`/`lemma`/`pos`/`upos`/`xpos`/`feats`), opérateurs (`=`/`&`/`|`), chaîne `"…"` (tolère une quote non fermée pendant la frappe), flag `%c`, quantifieur `{m,n}`, mot-clé `within`. **Cosmétique uniquement** (la validation reste `validateCqlSyntax` à la recherche). Rendu via le sink sûr `setHtml`/`raw` (contenu échappé). 8 tests Vitest (classification, round-trip lossless, `upos`/`xpos` ≠ `pos`, quote non fermée, quantifieur malformé → neutre, échappement HTML). Front-only, aucun changement moteur/contrat.

- **shell — histogramme de distribution temporelle dans la recherche grammaticale (F2b, front)** : le module **Recherche** (`rechercheModule`) expose la distribution diachronique livrée en F2a. Le sélecteur « Grouper par » du panneau Distribution gagne **« Année »** ; le choisir bascule l'affichage des barres catégorielles vers un **histogramme Chart.js** (barres verticales, années en X, dans l'ordre **chronologique** renvoyé par le serveur — pas re-trié par fréquence). Une **bascule « Mesure »** (Occurrences / Fréquence /10k) change la hauteur des barres entre le **compte brut** et la **fréquence normalisée**, les deux restant visibles au survol (tooltip : occurrences + `%` + `freq/10k` + tokens de la période). Réutilise le `chart.js/auto` déjà chargé en lazy pour le graphe de dispersion ; pas de filtre au clic pour l'année (l'année n'est pas un attribut token des hits chargés). Logique pure extraite dans `tauri-shell/src/modules/yearChart.ts` (`yearChartData`/`yearMetricLabel`/`yearTooltipLines`) — **7 tests Vitest** (ordre chrono préservé, métrique brute vs normalisée, fallback freq absente, tooltip les deux métriques). Rendu DOM/Chart.js dans `rechercheModule` (canvas + lifecycle destroy mirroir du graphe dispersion). Front-only, aucun changement moteur/contrat. **F2 complet** (backend F2a + front F2b). Cf. `docs/cadrage/DISTRIBUTION_TEMPORELLE.md`.
- **engine + contrat — distribution temporelle dans `token_stats` (F2a, backend)** : `POST /token_stats` `group_by` gagne la valeur **`"year"`** → distribution **diachronique** d'un motif CQL (comment sa fréquence varie dans le temps), dernière brique manquante du volet analytics du concordancier (tri KWIC + dispersion + collocations déjà livrés). **Source de date** : `documents.doc_date` (texte libre `"2024"`/`"2024-03"`/`"2024-03-15"`/NULL) **bucketé par l'année à 4 chiffres en tête** (`^\d{4}`) ; non-daté → bucket **`(sans date)`**. **Comptage par hit** (une occurrence par match, attribuée à l'année du doc — un span multi-token ne gonfle pas son année), **tri chronologique**. **Les deux métriques** par ligne : `count` (brut) **et** `freq_per_10k` (= `count / tokens_in_period * 10000`, fréquence relative comparable entre années) avec `tokens_in_period` (dénominateur = tous les tokens du périmètre pour cette année, obtenu **gratuitement** depuis les mêmes streams — aucune requête supplémentaire). `TokenStatsRow` gagne les champs **additifs nullable** `tokens_in_period` + `freq_per_10k` (présents seulement pour `year`) ; `CONTRACT_VERSION` 1.6.30 → **1.6.31** + `openapi.json` régénéré (snapshot des paths inchangé). Tests : bucketing des 3 formats de date + NULL, comptage par hit, tri chrono, normalisation + dénominateur, non-régression du chemin attribut (per-token). **Rendu front (histogramme temporel) = F2b**. Cf. `docs/cadrage/DISTRIBUTION_TEMPORELLE.md`.

### Fixed

- **Lot P4 (micro-sweep) de l'audit 2026-06-28** — derniers 🟡 sidecar, tous avec test :
  - **SID-12 — coercion d'entiers unifiée** : 5 `int()` nus de `curate_service` levaient `ValueError`/`TypeError` sur entrée non-int → **500** (l'adaptateur ne rattrape que `BadRequestError`/`NotFoundError`). Nouveau helper `_req_int(value, field)` → `BadRequestError` (**400**) ; `_int_or` reste pour les champs optionnels-avec-défaut. Tests : non-int `unit_id`/`doc_id` sur set/delete/list/record.
  - **SID-14 — timeout WebDAV configurable** : `DEFAULT_TIMEOUT` dérive de l'env `AGRAFES_WEBDAV_TIMEOUT` (helper `_resolve_default_timeout`, clamp ≥1 s, fallback 30 s) ; `propfind`/`download` l'héritent. Le caractère **per-read** (vs budget total) est documenté comme délibéré (borne une connexion bloquée ; le volume total est borné par `max_bytes`). Tests : env / valeur invalide / clamp / défaut.
  - **SID-15 — pic disque ShareDocs** : le temp de chaque fichier est désormais **purgé immédiatement** dans la boucle de `ingest_remote_folder` (working-set disque ≈ 1 fichier au lieu de tout le lot) ; le `shutil.rmtree` global reste un filet. Test : le compte de fichiers du tmpdir au moment du download reste `[1, 1, 1]` (sans le fix : `[1, 2, 3]`).
- **SID-06 — complétude du contrat OpenAPI** : **12 routes (14 opérations)** servies de longue date par le sidecar mais absentes de l'OpenAPI sont désormais **documentées** — exceptions de curation (`/curate/exceptions` GET+POST, `/set`, `/delete`, `/export`), historique d'application (`/curate/apply-history` GET+POST, `/record`, `/export`), facettes/stats (`/query/facets`, `/stats/lexical`, `/stats/compare`) et `/segment/delete_structure_unit` — avec leurs schémas requête/réponse (inline + 4 schémas composants `StatsSlot`/`LexicalStatsResult`/`CurateExceptionsListResponse`/`CurateApplyHistoryListResponse`) et le marqueur `security: token` sur les routes mutatrices. **Bonus** : 2 `$ref` pendants préexistants (même classe que SID-13) définis — `OkResponse` (8 références : conventions/roles, set_role, set_text_start…) et `AlignLinkCreateRequest`. `docs/openapi.json`, `tests/snapshots/openapi_paths.json` et `docs/SIDECAR_API_CONTRACT.md` régénérés/à jour ; aucun changement de comportement (les routes existaient déjà) → pas de bump `CONTRACT_VERSION`. 72 tests de contrat verts.
- **Lot P0 de l'audit général 2026-06-28** (`docs/AUDIT_2026-06-28.md`) — bugs de correction et d'intégrité trouvés à la passe ligne-à-ligne, tous corrigés avec test de régression :
  - **ENG-01 — styles inline ODT perdus à l'import** : `read_odt_paragraph_rich_lines` appelait `odt_para_to_rich_text(elem, style_map)` en positionnel alors que la signature portait un 2ᵉ paramètre `ns` **mort** → le `style_map` réel restait `None`/`{}` et **tout le balisage `<hi rend="…">` (italique/gras) disparaissait** de `text_raw` pour *tous* les imports ODT. Cause racine supprimée (paramètre `ns` retiré). Test : `test_odt.py::test_odt_paragraphs_preserves_italic_markup` (assert `<hi rend="italic">` survit en base) ; helper `support_odt.make_styled_odt_bytes`.
  - **SID-01 — mauvais code HTTP (500 au lieu de 400)** : `GET /families/{id}/curation_status` avec un id non-entier appelait `_send_error` en positionnel (les paramètres `code`/`http_status` sont keyword-only) → `TypeError` rattrapé → « Internal error » 500 au lieu du 400 `BAD_REQUEST` voulu. Appel corrigé.
  - **SID-03 — mutations multi-statements non atomiques** : `delete_documents` (cascade de 7 DELETE) et `bulk_update_documents` (boucle d'UPDATE) commitaient en fin de cascade sans rollback ; une erreur en cours laissait des écritures partielles dans une transaction ouverte sur la connexion partagée (qu'un commit ultérieur aurait persistées). Les deux sont désormais `try/commit/except: rollback; raise` (atomiques). Test : `test_documents_service.py::test_bulk_update_is_atomic_on_midbatch_failure`.
- **Lot P1 de l'audit 2026-06-28** :
  - **QRY-04 — contrat CLI** : `serve --host <non-loopback>` faisait `raise SystemExit(str)` → texte sur stderr, **aucun JSON** sur stdout. Émet désormais l'objet JSON d'erreur via `_err` (exit 1). Test : `test_cli_contract.py::test_serve_invalid_host_emits_single_json_error`.
  - **OPS-02 — CI** : `smoke.yml` ne tirait que sur `main` ; ajout de `dev` (branche PR par défaut) aux triggers `push`/`pull_request`.
- **Lot P3 de l'audit 2026-06-28** (`docs/AUDIT_FOLLOW_UP.md`) — durcissement + nettoyage vérifiables par build/test :
  - **ENG-02 — préfixe `[n]` désaligné plain↔rich** (import DOCX/ODT numéroté) : `m.start(2)` (offset sur le texte *normalisé+strippé*) servait à trancher le texte *rich*, désalignant le découpage dès que normalize/strip changeait la longueur du préfixe. Le marqueur est désormais re-matché sur `rich.lstrip()` (préfixe retiré exactement, style préservé), avec fallback sur l'offset plain si le marqueur rich ne matche pas. `docx_numbered_lines.py` / `odt_numbered_lines.py`.
  - **ENG-03 — `fts_stale` + ligne FTS orpheline (merge/split)** : `/units/merge` et `/units/split` renvoient désormais `fts_stale: true` (leur texte indexé change → réindex requise) ; merge **purge la ligne FTS de l'unité supprimée** (best-effort) que `stale_doc_ids()`, qui n'inspecte que les unités vivantes, ne pouvait pas signaler (une recherche pouvait sinon matcher l'unité disparue jusqu'au prochain réindex complet). Champ documenté au contrat (cf. versions ci-dessous).
  - **ENG-04 — `update_unit_text` indexait une unité `structure`** : l'INSERT FTS est gardé par `unit_type == 'line'` (le DELETE reste inconditionnel pour purger toute ligne périmée). Tests : `test_units_service.py` (structure exclue / line réindexée).
  - **ENG-05 — TEI imbriqué compté 2×** : `_iter_body_elements` ne retient que le match le plus externe d'une imbrication même-tag (`<p>` dans `<p>`) — l'`itertext()` du parent contenait déjà le texte de l'enfant. Test : `test_parse_layer.py::test_parse_tei_nested_same_tag_not_double_counted`.
  - **QRY-05 — backref JS `$NN` inexistant** : un `$NN` sans groupe correspondant faisait planter `re.sub` (`\g<NN>` → *invalid group reference*) sur un preset Find/Replace pourtant valide en JS. `_translate_js_replacement(repl, ngroups)` laisse ces tokens **littéraux** (fallback 2-chiffres à la JS) ; `rules_from_list` passe `compiled.groups`. Tests : `test_curation.py`.
  - **QRY-07 — `source_ext` LIKE non échappé** : échappe `\ % _` + `ESCAPE '\'` comme les filtres author/title (sémantique cohérente ; pas de SQLi). `query.py`.
  - **QRY-09 / SID-07 / SID-10 / SID-11 / SID-13 / SID-16 / OPS-04 — nettoyages** : `_HIGHLIGHT_CLOSE` remonté en tête de module ; erreurs d'écriture d'export → `ERR_INTERNAL` (catalogue) au lieu du littéral `EXPORT_WRITE_ERROR` ; `_lock()` annoté `threading.RLock` (+ docstring module) ; statut `canceled` ajouté à la doc de `JobRecord` ; `components.securitySchemes.token` (apiKey, header `X-Agrafes-Token`) ajouté à l'OpenAPI + `/align/collisions/resolve` unifié `ApiKeyAuth`→`token` (référence pendante) ; 2 lignes de changelog `hrefs` recollées à l'entrée 1.6.29 ; commentaire de gate coverage `pyproject.toml` corrigé (CI = **60**, plus le 35 périmé).
  - **OPS-03 / SID-08 — versions** : `API_VERSION` **dérive** de `CONTRACT_VERSION` (plus de 2ᵉ littéral maintenu à la main → drift structurellement impossible) ; `CONTRACT_VERSION` 1.6.31 → **1.6.32** (champ `fts_stale` additif sur merge/split) ; `docs/openapi.json` régénéré (snapshot des *paths* inchangé). Ambiguïté du champ `version` documentée (`/health` = version moteur, partout ailleurs = API/contrat).

### Security

- **SEC-07 — token littéral non persisté** : `serve --token <secret>` enregistrait le token verbatim dans `runs.params` (DB au repos). Le nouvel `_safe_token_label(token_mode)` n'y stocke plus que `auto`/`off`/`custom` (un littéral devient `custom`). Les autres usages du token restent intentionnels (booléen `token_required` en run-stats ; token résolu renvoyé sur stdout pour l'appelant). Test : `test_cli_contract.py::test_serve_token_label_redacts_literal_secret`. (SEC-05/06, côté Rust `main.rs`, sont **documentés en risque accepté** — 🟢 loopback-only, non validables par la CI de PR : voir `docs/AUDIT_FOLLOW_UP.md`.)
- **Lot P0 de l'audit général 2026-06-28** (suite) :
  - **QRY-01 — DoS algorithmique du matcher CQL** : plusieurs quantifieurs non bornés enchaînés (`[]{0,30}[]{0,30}…`) faisaient exploser le backtracking (~114 s mesurés sur une unité de 100 tokens) **sous le lock global du sidecar** (gel de tout le serveur). Ajout d'une borne de complexité `_MAX_MATCH_STEPS` qui interrompt l'évaluation avec `CqlComplexityError` (sous-classe de `ValueError` → mappée 400). Test : `test_token_query_complexity.py` (abort < 5 s, requêtes normales intactes).
  - **SID-02 — bypass d'authentification sur les routes mutatrices** : l'autorisation d'écriture se faisait par **match exact** dans un set local `_write_paths`, aveugle aux routes dispatchées par préfixe/suffixe. Une passe de revue adverse a trouvé **6 routes mutatrices sans token** : `/jobs` (submit), `/curate/exceptions/set`, `/curate/exceptions/delete`, `/export/tmx`, `/export/bilingual`, et surtout `/families/{id}/segment` + `/families/{id}/align` (resegment / ré-alignement **destructifs**). Le set est extrait au niveau module (`_WRITE_PATHS`) + un prédicat pur **testable** `_post_requires_write_token(path)` qui couvre aussi les routes à segment dynamique (`/jobs/<id>/cancel`, `/families/<id>/{segment,align}`). Tests : `test_sidecar_write_paths.py` (32 cas : write/dynamique/read).
  - **QRY-02 — injection de formule CSV** : `export_csv` n'échappait pas les cellules dont le 1ᵉʳ caractère **non-blanc** est `= + - @` (ou un contrôle de tête) — titres/textes de corpus attaquant-contrôlables, exécution à l'ouverture dans Excel/LibreOffice. Neutralisation par préfixe `'` ; le test porte sur le **premier caractère non-blanc** (`" =1+1"`, NBSP) pour fermer le contournement par espace de tête. Les tirets typographiques `— –` ne sont pas touchés. Tests : `test_exporters.py::test_csv_export_neutralizes_formula_injection` + `..._leading_whitespace_formula`.
  - **QRY-03 — XSS dans le rapport QA HTML** : `render_qa_report_html` interpolait titre/langue/champs manquants/gates **sans échappement** (f-strings bruts). Tous les champs de données passent désormais par `html.escape`. Test : `test_qa_report.py::test_html_report_escapes_malicious_metadata`.
- **Lot P1 de l'audit 2026-06-28** :
  - **SID-04 — SSRF WebDAV** : `validate_remote_url` ne bloquait pas les cibles internes. Rejet des **IP littérales** loopback / privées / link-local (incl. métadonnées cloud `169.254.169.254`) + `localhost`, **sans résolution DNS** (validateur pur, network-free ; la résolution d'un nom DNS vers une IP interne reste hors périmètre = défense-en-profondeur, sidecar loopback-only). **Durci après revue adverse** : couvre aussi les **encodages IPv4 obfusqués** (`2130706433` décimal / `0x7f000001` hex / `0177.0.0.1` octal / `127.1` court, + `localhost.` à point final) que `ipaddress` rejette mais que glibc `getaddrinfo` résoudrait vers l'IP interne — canonicalisés network-free via `inet_aton`. Tests : `test_webdav_client.py` (cibles internes + formes obfusquées bloquées, IP publiques autorisées).
  - **SEC-02 — couleur de convention (roleBadge)** : la couleur était injectée brute dans `style="--role-color:…"`. **Serveur** : `conventions_service` restreint la couleur au hex (`#RGB`/`#RRGGBB`) à la création **et** à la mise à jour (`ValidationError` sinon). **Front** : `UnitInspectorPanel` (3ᵉ renderer de badge) passe désormais par `safeColor` comme les 2 autres → **drift roleBadge résorbé**. Tests : `test_conventions_service.py` (create/update rejettent le non-hex).
- **Lot P2 (front) de l'audit 2026-06-28** :
  - **FE-02 — fuite de listeners dans le concordancier** : `buildUI` (`tauri-app`) enregistrait 3 écouteurs `document` (2 click + 1 keydown) jamais retirés ; `disposeApp` ne les nettoyait pas → accumulation à chaque re-montage de l'Explorer dans le shell. `buildUI` retourne désormais un **disposer** (les écouteurs passent par un helper `onDoc` qui les trace) que `disposeApp` appelle au démontage. `tsc` + 81 tests `tauri-app` verts.
  - **FE-05 — suppression des dialogues natifs** (convention « no native dialogs », non fiables sur Tauri 2) : les 4 `alert` de fusion/découpe de `SegmentationView` routés vers le canal d'erreur existant `this._cb.log(…, true)` ; l'`alert` de validation de preset (`app.ts` prep) → `showToast(…, true)` ; le `window.confirm` d'export partiel (`tauri-app/features/export.ts`) remplacé par un modal promise-based `confirmModal` (réutilise la CSS `.modal-overlay`/`.modal`, 4 tests happy-dom). Vérifié par revue adverse : **plus aucun dialogue natif** dans prep/app/shell.
  - **FE-08 — fuite d'un écouteur `window` (prep, même classe que FE-02)** : `App` (prep) enregistrait `agrafes:prep-focus-segment-unit` avec un handler anonyme jamais retiré ; `dispose()` ne retirait que `beforeunload`. Comme le shell **re-crée** `App` à chaque re-montage prep, le listener s'accumulait en épinglant l'instance morte. Handler désormais stocké en champ (`_focusSegmentHandler`) + retiré dans `dispose()` (miroir de `_beforeUnloadHandler`). Trouvé en revue adverse du lot P2.
- **Lot P3 de l'audit 2026-06-28 — SEC-03 : CSP (Content-Security-Policy)** : ajout d'une CSP aux **3 apps livrables** (`tauri-shell`, `tauri-prep`, `tauri-app`) — `script-src 'self'` (durcissement XSS, défense en profondeur ; Tauri 2 nonce ses scripts injectés, Vite ne charge que des modules `'self'`), `style-src 'self' 'unsafe-inline'` (les apps injectent leurs styles), `connect-src` loopback + `ipc:`, `object-src 'none'`, `base-uri 'self'`. Les appels sidecar passent par `@tauri-apps/plugin-http` (côté Rust) donc **non conditionnés par `connect-src`**. Le harness e2e `tauri-fixture` (non livré, `bundle.active:false`) est laissé hors périmètre. ⚠️ **À valider par un smoke runtime des 3 apps** : `tauri.conf.json` n'est lu ni par `tsc` ni par `vitest`, donc une CSP trop stricte ne se révélerait qu'à l'exécution. Couvrir aussi `tauri dev` (le HMR Vite, scripts inline + websocket, peut nécessiter un `app.security.devCsp` permissif).
- **F-03 (Option B) — épinglage SHA des GitHub Actions tierces** : les 3 actions **non-GitHub** des workflows sont désormais référencées par **SHA de commit** (immuable) au lieu d'un tag/branche mutable — un tag réécrit ne peut plus injecter de code dans la CI, *a fortiori* dans `release.yml`/`*-sign-*.yml` (secrets de signature). `dtolnay/rust-toolchain@stable` (×3, **branche** mouvante) → SHA `29eef33…` **+ `with: toolchain: stable` explicite** (le ref sélectionnait le canal) ; `softprops/action-gh-release@v2` (×2) → `3bb1273…` ; `Swatinem/rust-cache@v2` (×2) → `e18b497…`. Commentaire `# version` conservé pour la lisibilité et le bump Dependabot (l'écosystème `github-actions` est déjà couvert). Les 6 actions first-party `actions/*` (best-practice) restent à pinner (Option A). Cadrage + SHA : `docs/TICKET_F03_SHA_PINNING.md`.
- **F-03 (Option A) — épinglage SHA des GitHub Actions first-party** : les 6 actions `actions/*` (`checkout`, `setup-python`, `upload-artifact`, `setup-node`, `download-artifact`, `cache`) — **77 occurrences** sur l'ensemble des workflows — passent du tag majeur mutable (`@v4`/`@v5`) au **SHA de commit** (`# vX.Y.Z` conservé en commentaire pour Dependabot). Complète l'Option B (#166) → **F-03 fermé**. Contrairement aux actions tierces (workflows tag-only), celles-ci vivent dans `ci.yml`/`smoke.yml` **PR-déclenchés**, donc **réellement exécutées et validées par la CI** de ce PR.

## [0.2.7] - 2026-06-24

### Added

- **prep — repli « voir l'original d'import » + export du texte source (ADR-043 P3b, front)** : l'UI Prep **expose** désormais l'original verbatim d'import (`text_source`, posé en P1-P2b et servi en P3a). **Repli inline** : dans le **tableau de segments** de `SegmentationView` (la surface où atterrissent resegment **et** merge/split — les 3 opérations destructives), chaque ligne dont l'original diffère du texte courant gagne un `<details>` natif **« ⌖ voir l'original d'import »** (sans handler JS) qui déplie le texte tel qu'importé. **Garde d'affichage** dans un helper pur testé `hasImportOriginal({text_raw, text_source})` (`tauri-prep/src/lib/importOriginal.ts`) : repli affiché **ssi** `text_source != null && text_source !== text_raw` — comparé au **verbatim** (`text_raw`), jamais au `text_norm` (sinon faux positif sur chaque ligne curatée) ; une ligne vierge (`text_source` NULL) ou une fusion de lignes identiques ne déclenche rien. **Export** : l'écran Exports gagne un sélecteur **« Source du texte »** (normalisé par défaut / brut / **source**) qui passe `source_field` au job `export_readable_text` (le `text_source` retombe sur `text_raw` pour les lignes vierges, cf. P3a). Champs `text_raw`/`text_source` ajoutés aux types `DocumentPreviewLine` + `UnitRecord` (`sidecarClient`). **Front-only, aucun changement moteur/contrat** (P3a a déjà livré l'API). 6 tests Vitest (helper : différence, égalité, NULL, undefined, comparaison verbatim). Surface unique **assumée** (segmentation, la plus à risque) ; les aperçus curation/métadonnées pourront recevoir le même repli en suivi. Cf. `docs/DECISIONS.md` ADR-043 P3.
- **docs + engine — ADR-043 P2c (propagation) tranché = limite documentée ; N-04 clos** : dernier chemin destructif laissé de côté par P1-P3, `POST /segment/apply_propagated` ne préserve **pas** `text_source` (les unités réécrites repartent à NULL). **Décision actée** (`docs/DECISIONS.md` ADR-043 P2c) : ce chemin re-segmente le texte **par section** *et* le front expose un **éditeur de segments interactif** (éditer/couper/fusionner) entre `propagate_preview` et apply → un nouveau segment n'a **pas de ligne parente nette** d'où hériter ; le préserver fidèlement imposerait de **rejouer l'héritage P2/P2b dans l'éditeur front** (TS), **disproportionné** pour ce chemin avancé/rare. `text_source` reste donc **NULL** sur ce chemin (sûr : fallback `text_raw`, repli masqué, réimport restaure). Options écartées : (a) original au niveau section = grossier ; (c) reconstruction du mapping ligne→segment = fragile. Le choix est **gravé en commentaire** dans le handler pour qu'il ne soit pas « corrigé » comme un oubli. Aucun changement de comportement (commentaire + docs) ; le finding **N-04 est clos**.
- **engine + contrat — exposition lecture/export de `text_source` (ADR-043 P3a, backend)** : l'original verbatim d'import (`text_source`, posé en P1-P2b) devient **lisible** par l'UI et **exportable**. **Sites de lecture** : `GET /units` renvoie désormais `text_raw` **et** `text_source` (il ne donnait que `text_norm`) ; `GET /documents/preview` renvoie `text_source` (il donnait déjà `text_raw`, désormais documenté au contrat avec `unit_role`). **Valeurs brutes nullable** (pas de `COALESCE` côté serveur) : le front a besoin de comparer `text_source` à `text_raw` pour ne révéler l'original que sur les unités réécrites par une opération destructive (`text_source ≠ text_raw`). **Export** : `export_readable_text` `source_field` accepte `"text_source"` = `COALESCE(text_source, text_raw)` (une ligne vierge — `text_source` NULL — exporte quand même son `text_raw`, jamais du vide) ; validé inline aux deux points du job (enqueue + exécution), pas dans le schéma OpenAPI gelé. **Contrat** : champs additifs nullable → `CONTRACT_VERSION` 1.6.29 → **1.6.30** + `openapi.json` régénéré (snapshot des *paths* inchangé, aucune route ajoutée). Tests : `list_units` expose text_raw/text_source bruts (original distinct sur une unité, NULL préservé sur une vierge), export `source_field=text_source` (original ressort, ligne vierge retombe sur text_raw), rejet d'un `source_field` inconnu. **Limite assumée de l'export source** : les N segments d'une ligne resegmentée héritant du **même** `text_source` (granularité ligne), l'export source émet la ligne parente **une fois par segment** (dump par unité fidèle, pas une reconstruction dédupliquée) — la fusion des sources consécutives identiques est **volontairement écartée** car, sans identifiant de ligne-source (différé), elle supprimerait de vraies lignes répétées (refrain) ; comportement épinglé par un test. **Front (repli inline « voir l'original » + option export) = P3b**. Cf. `docs/DECISIONS.md` ADR-043 P3.
- **engine — `units.text_source` : texte d'import original préservé (ADR-043, P1)** : nouvelle colonne **`units.text_source`** (migration 020, nullable) qui capture le texte **verbatim de l'import** (`= text_raw` au moment de l'import). Peuplée en **un seul point** pour les 6 importeurs via `parsed.insert_units` (grâce à P0) **+** l'importeur CoNLL-U (insert bespoke). But (ADR-043) : préserver l'original même après une **resegmentation destructive** (qui réécrit `text_raw`). **Recovery-only** : pas indexée FTS, pas requêtée, **aucun site de lecture changé** (P1) ; les lignes pré-migration et — jusqu'à P2 — les unités créées par resegment/merge/split/undo restent `NULL` (les lecteurs retomberont sur `text_raw`). Aucun changement de contrat. Tests : colonne présente après migration, `text_source == text_raw` à l'import (helper direct + docx + CoNLL-U). **P2** (propagation à travers resegment/split/merge) et **P3** (UI/export de l'original) à suivre.
- **engine + prep — export ODT (texte lisible)** : `export_readable_text` gagne le format **`odt`** aux côtés de `txt`/`docx`, rétablissant la symétrie import/export ODT (l'import ODT existait, pas l'export). Génération **stdlib pure** (`zipfile` + XML ODF 1.2 minimal : `mimetype` STORED en 1ʳᵉ entrée, `META-INF/manifest.xml`, `content.xml` avec `text:h` titre + `text:p` par ligne) — **aucune nouvelle dépendance** (le moteur reste near-stdlib ; DOCX utilise `python-docx`, ODT n'a pas de lib donc on émet le paquet ODF à la main). Le paquet **round-trippe** par l'importeur ODT existant (`importers/odt_common.py`). Validations sidecar (`export_readable_text params.format`) et écran Prep (Exports → Texte lisible → **ODT**) étendues. Robustesse : échappement XML **et** suppression des caractères de contrôle illégaux en XML 1.0 — un `text_raw` verbatim ne peut pas produire un `content.xml` mal formé (corruption silencieuse, là où DOCX lèverait via python-docx). Tests : export + round-trip via l'importeur + échappement + strip des caractères de contrôle. Aucun changement de contrat (format validé inline, pas d'enum gelé dans l'OpenAPI).
- **engine — module XML partagé `xml_text` + durcissement TMX/SKE** : la logique « strip des caractères illégaux en XML 1.0 + échappement » était **dupliquée** (TEI, ODT) et **manquante** ailleurs. Centralisée dans `multicorpus_engine/xml_text.py` (`strip_xml10_invalid` + `xml_escape`, **stdlib pur**, plages XML 1.0 définies une seule fois). `tei.py` délègue (sortie **byte-identique**, 64 tests TEI verts), `readable_text` (ODT) l'utilise. **Bugs corrigés** : le builder **TMX** (`_escape_xml`, mémoires de traduction = XML strict re-parsé par outils CAT) et l'export **SKE** (`_attr_escape`) échappaient `& < >` mais **ne strippaient pas** les caractères de contrôle → `.tmx` potentiellement mal formé sur texte verbatim ; les deux strippent désormais via la source unique. Tests : `test_xml_text` (strip/escape, contrôles, non-caractères, Unicode haut) + strip de contrôle dans `_build_tmx`.
- **prep / ShareDocs — familles à l'import (Phase 6)** : un import ShareDocs par lot **détecte les familles** (même radical, langues différentes — `familyDetect` de P6A) et **crée les relations `translation_of`** comme le dialogue de l'import local (Sprint 8). À l'import (« Importer ce dossier » **ou** « Importer la sélection »), si des familles sont détectées sur l'ensemble résolu (après expansion des dossiers cochés), une **bannière hybride** s'affiche : par famille, l'**original (pivot) est pré-sélectionné par heuristique** (`pickDefaultPivot` : langue par défaut du formulaire si présente, sinon 1ʳᵉ langue alphabétique) dans un **sélecteur modifiable**, avec une case **« Lier »** décochable ; boutons **« Importer + lier » / « Importer sans lier » / « Annuler »**. La correction reste toujours possible ensuite dans MetadataScreen (panneau famille). Les relations sont créées **après la barrière de fin de lot** (`_submitGroups` gagne un callback `onComplete` déclenché quand tous les jobs sont terminés — succès ou échec) : on résout `clé (source_url) → doc_id` via le rapport agrégé (`doc_id` présent pour `imported` **et** `skipped-duplicate`) puis on appelle `setDocRelation` (upsert idempotent) par paire enfant→pivot. **Familles partielles** : un membre sans doc_id (import échoué) ou un pivot sans doc_id sont **comptés et signalés** au récap (« N relation(s) créée(s) ; M non liée(s) ; K famille(s) sans original importé »), jamais bloquants. **Front-only, aucun changement moteur/contrat** (réutilise `POST /doc_relations/set` + le rapport `import-remote` existant). Cœur de résolution pur et testé (`resolveFamilyRelations` : `imported`/`skipped-duplicate`/`error`, pivot manquant, multi-familles, clé absente). Réf. `docs/DESIGN_sharedocs_ingestion.md` §12, `docs/TICKET_SHAREDOCS_INGESTION_P6B_FAMILIES.md`.
- **prep — module partagé de détection de familles `familyDetect` (socle Phase 6 ShareDocs)** : la détection de familles documentaires (radical commun + token de langue distinct → original + traductions) est **extraite** de la méthode statique `ImportScreen.detectFamilyGroups` dans un module pur **partagé** `tauri-prep/src/lib/familyDetect.ts` (`detectFamilyGroups(names)` + `pickDefaultPivot(group, defaultLang)`), pour être réutilisé par l'import ShareDocs (Phase 6) sans réinventer une variante — même protocole que `importDetect` (§11.2). **Source de vérité unique** : réutilise `LANG_RE` + `KNOWN_LANG_CODES` d'`importDetect`. **Affinage assumé** (seul écart vs l'ancienne détection locale) : le token de langue est désormais **validé contre la whitelist** `KNOWN_LANG_CODES` (comme `detectLanguageToken`) → un suffixe 2-3 lettres hors whitelist (`_to`, `_by`, …) **n'ouvre plus** de fausse famille. `ImportScreen` délègue (bannière de détection + dialogue post-import inchangés). 16 tests Vitest (`familyDetect` : groupement radical/token, seuil ≥2, whitelist, multi-langues, ordre, chemins ; `pickDefaultPivot` : langue défaut présente/absente/vide/casse). Réf. `docs/DESIGN_sharedocs_ingestion.md` §12, `docs/TICKET_SHAREDOCS_INGESTION_P6A_FAMILY_DETECT_SHARED.md`.
- **prep / ShareDocs — suivi Phase 5 : expansion des dossiers cochés + convergence TEI local** : deux écarts assumés de la Phase 5 (§11.8) sont **levés**, front-only, aucun changement moteur/contrat. **(1) Expansion des dossiers cochés** dans « Importer la sélection » : un dossier coché est désormais **développé** à l'import — `_importSelection` lance un `webdavList` (PROPFIND `Depth:1`) **par dossier coché**, route ses fichiers via la fonction pure partagée **`routeEntriesToImport`** (extraite de « Importer ce dossier » → source unique du routage), fusionne avec les fichiers directement cochés et **déduplique par `href`** (**`dedupeDetectedFiles`** — un fichier peut être coché *et* remonter via son dossier parent). **Non-récursif** (décision figée) : les sous-dossiers d'un dossier coché sont **comptés puis ignorés** (cohérent avec « Importer ce dossier ») et signalés au récap `inlineConfirm` ; une **erreur de PROPFIND par dossier est reportée, jamais bloquante** (dossier listé « illisible », l'import continue). L'étiquette du panier passe de « ouvrir puis Importer ce dossier » à « son contenu sera développé à l'import ». La détection par fichier est extraite en fonction pure **`detectImportFile`** (déléguée par `_detectFile`). **(2) Convergence de l'import local sur le `xml:lang` TEI** : l'import local (`ImportScreen`) ne **force plus** une langue par défaut sur un fichier TEI (ancien `language: f.language || "und"`) — il pré-remplit le champ langue d'un TEI via le **token explicite uniquement** (vide si aucun), le « profil de lot » n'impose plus le défaut à un TEI, et la soumission envoie `undefined` (clé omise → l'importeur garde le `xml:lang` du document) pour un TEI au champ vide ; le champ affiche le placeholder « `xml:lang` » (vide = le document décide, renseigner = forcer). Aligne l'import local sur ShareDocs via la fonction pure partagée **`detectLanguageForMode(mode, name, fallback)`** (importDetect), désormais consommée par les deux écrans (`_detectFile` ShareDocs **et** `ImportScreen`). Tests Vitest : `detectLanguageForMode` (TEI token/sans-token/faux-positif vs autres formats), `detectImportFile`, `routeEntriesToImport` (tri fichiers/inconnus/sous-dossiers non récursif), `dedupeDetectedFiles` (dédup par href, 1ʳᵉ occurrence). 534 tests prep verts. Réf. `docs/DESIGN_sharedocs_ingestion.md` §11.8.
- **prep / ShareDocs — détection du format et de la langue par fichier (Phase 5)** : un import ShareDocs par lot se comporte désormais comme le **menu Import local** — chaque fichier est importé avec **son** format (extension) et **sa** langue (déduite du nom, ex. `roman_fr.docx` → `fr`), au lieu d'un mode + une langue uniques pour tout le lot. **Débloque les dossiers bilingues / formats mixtes** (texte + traduction dans un même dossier). La détection est **extraite** de `ImportScreen` dans un module pur **partagé** `tauri-prep/src/lib/importDetect.ts` (`extFromFileName`, `modeOptionsForExt`, `deriveModeFromExt`, `normalizeModeForExt`, `detectLanguageFromName`, `isKnownImportExt`) — **source de vérité unique** consommée par l'import local **et** ShareDocs (interdit de réinventer une variante). Formulaire ShareDocs : « Mode d'import » → **« Profil par défaut »** (style numéroté/paragraphes — le format vient de l'extension), « Langue » → **« Langue par défaut (si non détectée) »**. Par fichier : `mode = normalizeModeForExt(deriveModeFromExt(ext, profil), ext)`, `langue = detectLanguageFromName(nom, défaut)` ; les fichiers sont **groupés par `(parentUrl, mode, langue)`** → un `import-remote` par lot (helper pur `groupDetectedFiles`), suivi Job Center, rapports agrégés (réutilise P4C/P4D). Le **panier affiche le (mode, langue) détecté** par fichier (remplace le drapeau ⚠ de P4D — on **route** au lieu de signaler) ; un **récap + `inlineConfirm`** (via `_guardedRun`) avertit si des fichiers sont ignorés ou des dossiers cochés non développés. **Extensions inconnues ignorées** (`isKnownImportExt`), comptées au récap (ni import, ni erreur, jamais en silence). **Front-only, aucun changement moteur/contrat** (réutilise `hrefs` + `mode`/`langue` par appel, contrat 1.6.29 inchangé). **Écarts assumés** (cf. `docs/DESIGN_sharedocs_ingestion.md` §11.8) : **(1)** champ glob `include` **retiré** (le backend l'ignore dès qu'il y a des `hrefs` ; le panier P4C couvre le sous-ensemble) → helpers P4D `detectFormatFromName`/`modeFormat`/`fileMatchesMode` + groupement P4C `groupSelectionForImport` retirés ; **(2)** expansion PROPFIND des **dossiers cochés** dans « Importer la sélection » **différée** (un dossier coché est signalé puis ignoré — l'ouvrir + « Importer ce dossier ») ; **(3)** **TEI : `xml:lang` préservé** — une langue n'est envoyée pour un fichier TEI que si son nom encode un **token explicite** (ex. `roman_lat.xml` → `lat`, qui prime) ; sinon `language` est omise et l'importeur garde le `xml:lang` du document (helper `detectLanguageToken`). Écart **délibéré** vs l'import local (qui force encore le défaut pour TEI) — le menu local mérite le même correctif en suivi. Tests Vitest : `importDetect` (mode par extension, langue par nom + fallback + whitelist, `isKnownImportExt`) + groupement `groupDetectedFiles` (bilingue, formats mixtes, ordre, label) ; non-régression de l'import local. Réf. `docs/DESIGN_sharedocs_ingestion.md` §11, `docs/TICKET_SHAREDOCS_INGESTION_P5_DETECTION.md`.
- **prep / ShareDocs — sécurité de la sélection par lot (Phase 4D)** : deux garde-fous pour importer une sélection multiple sans crainte, **sans dry-run** (front-only, aucun changement moteur/contrat). **(1) Info de sélection** : le panier affiche le **format détecté** par fichier (extension) et un **drapeau ⚠** quand il ne correspond pas au format du mode choisi (synchronisé au changement de mode) ; au clic « Importer la sélection », un `inlineConfirm` avertit si des fichiers d'un autre format sont sélectionnés (ils erroneront — on n'écarte rien en silence). Le drapeau n'attrape **que les formats** incompatibles, **pas** le style (numéroté vs paragraphes, indétectable sans parser) — copie honnête. **(2) Annulation de lot** : un bouton **« Annuler cet import (N documents) »** sur le rapport supprime les documents créés par ce lot (`deleteDocuments` réutilisé), avec confirmation. ⚠️ N'efface **que** les `status === "imported"` — **jamais** les `skipped-duplicate`, dont le `doc_id` pointe un document préexistant. Helpers purs `detectFormatFromName` / `modeFormat` / `fileMatchesMode` + tests Vitest. Réf. `docs/DESIGN_sharedocs_ingestion.md` §10.
- **prep / ShareDocs — préremplissage de l'URL racine (Phase 4B)** : l'écran ShareDocs gagne un bouton **« Préremplir l'URL racine (Huma-Num / Nextcloud) »** — on tape juste le serveur dans le champ URL (ex. `dav.huma-num.fr`) + son identifiant, et le bouton construit l'URL racine WebDAV de l'espace personnel (`<origin>/remote.php/dav/files/<identifiant>/`) d'où l'on navigue jusqu'au dossier voulu. Le champ reste **éditable** ; **aucun couplage Nextcloud en dur** dans la logique d'import (le connecteur reste générique WebDAV). Si le champ contient déjà un **chemin profond**, un `inlineConfirm` protège contre l'écrasement accidentel (un simple hôte est remplacé sans confirmation). Helpers purs `buildNextcloudRoot` (extraction d'origine tolérante : hôte nu → https par défaut, URL profonde → origine, identifiant percent-encodé) et `urlHasPath` + tests Vitest. Réf. `docs/DESIGN_sharedocs_ingestion.md` §9.3, `docs/TICKET_SHAREDOCS_INGESTION_P4B_NAV.md`.
- **prep + engine / ShareDocs — sélection multiple de dossiers et fichiers (Phase 4C)** : l'écran ShareDocs gagne un **panier de sélection accumulatif** — des cases à cocher sur chaque entrée (dossiers **et** fichiers), une sélection qui **persiste pendant la navigation inter-dossiers**, un compteur + liste + « Vider », et un bouton **« Importer la sélection (N) »** à côté de « Importer ce dossier entier ». La sélection est **groupée par dossier parent** : chaque dossier coché → un import de dossier entier ; les fichiers cochés → un `import-remote` par dossier parent avec leurs `hrefs` ; chaque lot est suivi dans le Job Center et les rapports sont **agrégés** à l'écran. Dédup : un fichier directement dans un dossier coché est ignoré (l'import du dossier le couvre). Contrat `CONTRACT_VERSION` 1.6.28 → **1.6.29** : `POST /import-remote` gagne un champ optionnel **`hrefs`** (array). Côté moteur, `remote/ingest.py` gagne `only_hrefs` qui **filtre le listing PROPFIND de confiance** — un href absent du listing n'est **jamais** téléchargé (garde same-origin/SSRF intacte) ; une sélection explicite **court-circuite** le glob `include` (un fichier de mode incompatible est reporté en erreur, pas de crash). Handler sidecar **mince** (logique dans `ingest.py`) ; `hrefs` (URLs, non-secret) admis dans les params de job, l'`auth` reste hors params. Pas de `--href` CLI en v1. Helpers purs `groupSelectionForImport`/`mergeReports` (tests Vitest) ; 3 tests pytest `only_hrefs` (restriction, href inconnu jamais fetché, bypass du filtre) + 2 sidecar in-process (`hrefs` restreint, `hrefs` vide → 400). Réf. `docs/DESIGN_sharedocs_ingestion.md` §9.4, `docs/TICKET_SHAREDOCS_INGESTION_P4C_SELECTION.md`.
- **prep + shell / ShareDocs — persistance des identifiants & formulaire explicite (Phase 4A)** : l'écran ShareDocs peut désormais **mémoriser les identifiants** (opt-in « Se souvenir »), pour ne plus refaire à chaque session le chemin long de génération d'un mot de passe d'application Nextcloud (affiché une seule fois). **Découpage par sensibilité** : les champs **non-secrets** (URL, mode d'auth, identifiant, flag) vont dans `localStorage` ; le **secret** (mot de passe / jeton) va au **trousseau OS** — `tauri-shell` gagne trois commandes Rust `keyring_get`/`keyring_set`/`keyring_delete` (crate `keyring`, backend Windows Credential Manager via la feature `windows-native`), wrappées côté front par `tauri-prep/src/lib/credentialStore.ts`. **Aucun secret en clair sur disque** ; le wrapper **dégrade gracieusement en mémoire-seule** (toast) si le trousseau/commande est indisponible (Prep standalone, Linux sans libsecret) — jamais de crash. Sauvegarde **uniquement après une connexion réussie** (on ne mémorise pas un secret faux) ; préremplissage au montage ; lien **« Oublier »** (purge trousseau + `localStorage`). **Clarté du formulaire** : aide sous l'URL, modes relabellés, **note expliquant le mot de passe d'application Nextcloud / humanID-2FA** sous le mode basic. Clé de trousseau `origin|mode|user` (helper pur `keyringAccount`). **Assouplit la décision §6** (cf. `docs/DESIGN_sharedocs_ingestion.md` §9.2, `docs/TICKET_SHAREDOCS_INGESTION_P4A_CREDS.md`). Front + Rust shell uniquement — aucun changement moteur/contrat. Nouveaux tests Vitest (`keyringAccount`/`authSecret` + repli `credentialStore`).
- **prep / ingestion distante WebDAV — écran « ShareDocs » (Phase 3, UI)** : nouvel onglet **ShareDocs** dans Prep (`tauri-prep`) pour les utilisateurs non-CLI. Flux : (1) **Connexion** — URL du dossier WebDAV + mode d'auth (anonyme / identifiant+mot de passe / jeton Bearer, champs conditionnels) ; (2) **Dossier** — `POST /webdav/list` → liste navigable (dossiers cliquables, fil d'Ariane + « ← Retour », taille/date) ; (3) choix `mode` d'import + `langue` + filtre `include` → « Importer ce dossier » → `POST /import-remote` (job async) → **progression via le Job Center** (réutilise le polling `/jobs/<id>` de l'import classique) → **table de rapport par fichier** (statut coloré importé/doublon/filtré/oversize/erreur, doc_id ou message). **Aucune logique métier côté front** : filtre/dédup/provenance restent au backend (Phases 1-2). **Identifiants en mémoire de session uniquement** — jamais écrits sur disque / `localStorage` / config (re-saisie à la session suivante ; keychain OS = évolution ultérieure). Logique pure extraite dans `lib/shareDocs.ts` (auth, formatage taille/rapport, tri d'entrées) — 30 tests Vitest ; rendu via le sink XSS `safeHtml`/`setHtml` (garde no-unsanitized stricte). Bindings client `webdavList`/`importRemote` typés sur le contrat 1.6.28. Réf. `docs/DESIGN_sharedocs_ingestion.md` §5 (Phase 3), `docs/TICKET_SHAREDOCS_INGESTION_P3_UI.md`.
- **prep / ingestion distante WebDAV — endpoints sidecar (ShareDocs, Phase 2)** : l'ingestion ShareDocs est exposée au sidecar HTTP pour l'UI (Phase 3). Deux routes, contrat `CONTRACT_VERSION` 1.6.27 → **1.6.28**. **`POST /webdav/list`** (lecture seule, **sans token**) parcourt un dossier WebDAV (PROPFIND `Depth:1`) et renvoie `{entries:[{name, href, is_dir, size, modified, content_type}]}` ; **dispatché lock-free** (carve-out comme `/shutdown`) → parcourir un dépôt ne bloque jamais les écritures db. **`POST /import-remote`** (token requis) est **asynchrone** : il *enqueue* un job `JobManager` et renvoie `{job}` (202), l'UI poll `/jobs/<id>` pour la progression par fichier + le report de lot. **Isolation des credentials** (décision figée §D2) : `/jobs/<id>` exposant `params` verbatim, l'objet `auth` n'est **jamais** mis dans les params du job ni dans `runs.params_json` — l'en-tête `Authorization` est construit dans le handler et capturé dans la *closure* du runner (mémoire seule). **Granularité du lock** (§D3, post-R-01b) : sur le thread worker, le *download* de chaque fichier reste **hors** du write-lock ; seule la section DB (dédup + import + `UPDATE source_path`) le prend — `remote/ingest.py` gagne deux paramètres additifs `progress` (callback par fichier) et `critical_section` (CM enveloppant la section DB ; la CLI passe `None` = no-op, donc Phase 1 inchangée). Schémas du contrat écrits à la main (objet `auth` imbriqué, hors générateur A-03B). Aucune nouvelle dépendance, aucune migration. 11 nouveaux tests (4 batch `progress`/`critical_section`/non-fuite + 7 sidecar in-process `/webdav/list` & `/import-remote` dont non-fuite creds via `/jobs/<id>` et `runs.params_json`). UI Prep (Phase 3) à suivre. Réf. `docs/DESIGN_sharedocs_ingestion.md`, `docs/TICKET_SHAREDOCS_INGESTION_P2_SIDECAR.md`.
- **prep / ingestion distante WebDAV — `import-remote` (ShareDocs, Phase 1)** : nouvelle sous-commande CLI `multicorpus import-remote --url <dossier-webdav> --mode <mode>` qui parcourt un dossier WebDAV (validé contre ShareDocs Huma-Num — Nextcloud/SabreDAV) et ingère en lot tous les fichiers correspondant au mode (extension dérivée du `--mode`, surchargeable via `--include`). Chaque fichier est téléchargé en temporaire, **dédupliqué par `source_hash`** (les ré-exécutions sont idempotentes), importé via le pipeline existant (1 run/fichier), puis sa provenance `source_path` est fixée à l'URL distante. Les erreurs par fichier sont reportées **sans interrompre le lot** ; garde de taille `--max-file-mb` (200 par défaut). Client WebDAV **stdlib pur** (`urllib` + `defusedxml`, aucune nouvelle dépendance) limité à PROPFIND (Depth:1) + GET ; **TLS toujours vérifié** ; credentials lus uniquement dans l'environnement (`AGRAFES_WEBDAV_TOKEN`, ou `AGRAFES_WEBDAV_USER`/`AGRAFES_WEBDAV_PASSWORD`), **jamais persistés** en db/runs/logs. Refactor préalable : le dispatch `mode → importer` est centralisé dans `importers/dispatch.py` (`dispatch_import`), désormais point unique partagé par `import` et `import-remote`. La db reste strictement locale (pas de partage de db par WebDAV — cf. `docs/DESIGN_sharedocs_ingestion.md`). Phases 2 (endpoints sidecar) et 3 (UI Prep) à suivre. 21 nouveaux tests (client WebDAV + batch).
- **shell / avertissement « base synchronisée » (garde R-01 P3)** : à l'**ouverture ou la création** d'une base, le shell détecte si elle se trouve sous un dossier de synchronisation cloud connu (OneDrive, Dropbox, Google Drive, iCloud, macOS CloudStorage) — helper pur `isCloudSyncedPath` (heuristique par composant de chemin, sans accès OS ; 7 tests dont gardes anti-faux-positifs) — et affiche un **toast d'avertissement non bloquant** (helper partagé `_warnIfCloudSynced` câblé dans `_switchDb` *et* `_onCreateDb`, **avant** l'init du sidecar → visible même si l'ouverture traîne ou échoue, le cas même qu'on veut signaler). La synchronisation peut verrouiller le fichier SQLite et figer le sidecar ; le toast recommande de copier la base hors du dossier synchronisé. Garde environnementale de l'incident R-01 (cf. `docs/AUDIT_FOLLOW_UP.md`).

### Changed

- **engine — merge/split préservent `text_source` (ADR-043 P2b)** : la **fusion** et la **coupure** d'unités préservent désormais l'original d'import. **Migration 021** ajoute `text_source_before` à `prep_action_unit_snapshots`. `POST /units/merge` **concatène** les originaux des deux unités (`COALESCE(text_source, text_raw)` par entrée — une ligne vierge retombe sur son `text_raw` —, séparateur `" "` aligné sur `text_raw`) et l'écrit sur l'unité conservée ; `POST /units/split` fait **hériter** aux deux moitiés le même original (`COALESCE(text_source, text_raw)` de la ligne coupée). L'**undo** des deux restaure `text_source` depuis la colonne `*_before` du snapshot (NULL ⇒ NULL : fusion/coupure de lignes vierges réversible sans clobber). Boucle l'objectif d'ADR-043 : **les trois opérations destructives** (resegment, merge, split) conservent l'original verbatim, propagation **et** undo. Tests : concat à la fusion + héritage à la coupure + restauration à l'undo (sentinels distincts du `text_raw`). Aucun changement de contrat (la réponse wire des deux endpoints est inchangée). Cf. `docs/DECISIONS.md` ADR-043.
- **engine — resegmentation préserve `text_source` (ADR-043 P2, resegment)** : les deux resegmenteurs (`resegment_document` + `resegment_document_markers`) **propagent** désormais `text_source` aux segments produits — chaque segment **hérite** de `COALESCE(parent.text_source, parent.text_raw)` (l'original d'import de la ligne parente, ou son `text_raw` actuel à défaut). L'**undo** d'une resegmentation **restaure** `text_source` (capturé dans le snapshot JSON `units_before` du recorder — **sans migration**). Résultat : une resegmentation (l'opération destructive que vise l'ADR) ne perd plus l'original d'import ; un curate→resegment→undo le conserve. Tests : propagation (segments héritent un sentinel distinct du `text_raw` segmenté) + restauration à l'undo + variante `markers`. **merge/split → P2b** (concat/héritage + undo via migration 021 ; séparés car couplage forward↔undo). Aucun changement de contrat. Cf. `docs/DECISIONS.md` ADR-043.
- **engine — centralisation de l'écriture des unités (`insert_units`, P0 d'ADR-043)** : le `INSERT INTO units` était **dupliqué dans 6 importeurs** (docx×2, odt×2, tei, txt) ; extrait dans un helper unique **`parsed.insert_units(conn, doc_id, units)`** (un `executemany`, `unit_role` lu depuis `ParsedUnit`, `NULL` par défaut → **byte-identique** aux ex-inserts 7 colonnes ; vérifié : les importeurs 7-col ne posent jamais `unit_role`). Étape **préparatoire** d'ADR-043 : `text_source` (P1) s'ajoutera en **un seul point** au lieu de 7. `conllu` reste volontairement **bespoke** (insère l'unité **puis** ses tokens via `lastrowid` par unité — incompatible avec un bulk `executemany` ; P1 l'ajoutera séparément, soit 2 points au lieu de 7). `segmenter`/`undo` ne sont pas touchés (chemin resegment = P2, pas l'import). Refactor **iso-comportement** : 47 tests d'import verts (tous formats) + test direct `insert_units` (toutes colonnes, défaut `unit_role` NULL, FK `unit_roles`). Cf. `docs/DECISIONS.md` ADR-043.
- **docs — ADR-043 : arbitrage de la resegmentation destructive (N-04)** : la resegmentation (et merge/split) réécrit `text_raw` avec la phrase segmentée et supprime les `alignment_links` → l'original verbatim d'import est perdu (invariant « `text_raw` verbatim » violé ; au-delà de la fenêtre Mode A undo, seul le réimport restaure). **Décision actée** (`docs/DECISIONS.md` ADR-043) : introduire une colonne **`units.text_source` immuable** (= texte d'import, jamais réécrit par curate/resegment/merge/split ; granularité = ligne d'origine, héritée par les descendants, concaténée au merge ; legacy `NULL → fallback text_raw`). Implémentation **phasée** : P0 centraliser `insert_units` (helper partagé dédupliquant les 7 importeurs + segmenter/undo → P1 ajoutable en 1 point) → P1 migration 020 + import peuple → P2 resegment/split/merge propagent → P3 UI. La suppression des `alignment_links` reste hors périmètre. Aucun code dans ce lot (décision + suivi N-04 : `AUDIT_FOLLOW_UP.md`, ROADMAP).
- **docs + engine — cadrages métadonnées & ratio (D1/D2) + centralisation du seuil ratio** : deux notes de cadrage manquantes écrites. **`docs/cadrage/METADONNEES_DOCUMENT.md` (C5/D1)** documente le modèle de métadonnées document (champs obligatoires `title`/`language`, recommandés `doc_role`/`resource_type`/`author_lastname`, optionnels, vocabulaires contrôlés) et la validation **advisory non bloquante** (`metadata.validate_document`, CLI `validate-meta`, `POST /validate-meta`, réf. ADR-010) — pure documentation de l'existant. **`docs/cadrage/IMPORT_RATIO.md` (C6/D2)** : **correction d'une dérive du ROADMAP** — D2 disait « ni logique ni doc », or la logique existait (avertissement quand le nombre de segments d'une traduction diverge de >15 % de son pivot/référence), mais le seuil **fixe** `0.15` était un **magic number dupliqué en 7 emplacements** de `sidecar.py` (propagation de structure ×2, segmentation calibrée ×2, segmentation de famille, liste des familles `GET /families`, job d'import `calibrate_to`). Centralisé en une constante unique **`SEGMENT_RATIO_WARN_THRESHOLD`** (refactor iso-comportement) ; cadrage : contrôle **traduction↔source** (pas de garde à l'import brut — un fichier seul n'a pas de référence), **advisory jamais bloquant**, calibration 15 % actée. Distingué du seuil **configurable** de `GET /corpus/audit` (param serveur `ratio_threshold_pct`, défaut 15) qui reste volontairement séparé (surface réglable). Aucun changement de contrat.
- **tests / robustesse timing & proxy (T-04)** : `tests/conftest.py` ajoute désormais le loopback (`127.0.0.1`/`localhost`/`::1`) à `no_proxy`/`NO_PROXY` à l'import (additif, préserve l'existant, no-op en CI) → les tests sidecar n'exigent plus un `NO_PROXY=…` manuel en local (urllib ne route plus le loopback via un proxy système). Ré-examen des `time.sleep` de l'audit : **26 des 27 sont des intervalles de polling dans des boucles condition+timeout** (poll `/health`/job/portfile puis `raise`) — déjà robustes ; le seul sleep fixe (`test_sidecar_threading.py`, attendre qu'un thread se bloque sur le lock de dispatch) est inhérent au test de concurrence et reste commenté. Pas de changement de logique de test.
- **tests / réorganisation des packs versionnés (T-03)** : les **11 fichiers de tests nommés par incrément** (`test_v2`, `test_v21`, `test_sidecar_v03…v15`, `test_sidecar_jobs_v05`, `test_sidecar_hardening_v141`) — qui servent de *gel d'API par jalon* — sont déplacés (`git mv`) sous **`tests/contracts/`**, séparés des ~50 tests nommés par domaine restés à la racine. Discovery pytest inchangée (`testpaths=["tests"]`, sous-dossier sans `__init__.py` comme `importers/`/`services/`) : **225 tests collectés**, `tests/conftest.py` toujours appliqué. `test_v21` : `FIXTURES_DIR` repointé (`.parent` → `.parent.parent`) pour retrouver `tests/fixtures/`. `tests/README.md` mis à jour (layout). Aucun changement de logique de test.
- **docs / versioning du contrat sidecar (D-06)** : section *Versioning* de [`docs/SIDECAR_API_CONTRACT.md`](docs/SIDECAR_API_CONTRACT.md) réécrite — elle confondait `api_version` avec la version du contrat et donnait des valeurs fausses (`api_version: "1.6.27"`, `version: "0.8.2"`). Clarifié en 3 champs distincts : `api_version` (= `API_VERSION`, version d'implémentation runtime), `version` (= `API_VERSION` dans l'enveloppe, mais **version moteur** sur `/health`), et `contract_version` (= `CONTRACT_VERSION`, **source de vérité** du contrat, gelée en CI). Exemples corrigés pour refléter ce que le code émet réellement. Dérive signalée (`API_VERSION` 1.6.23 < `CONTRACT_VERSION` 1.6.27, bumps 1.6.24–1.6.27 oubliés) → réconciliation code laissée à un ticket séparé. Docs-only.
- **docs / archivage du CHANGELOG (D-02)** : le CHANGELOG (1 951 l.) est scindé — le courant garde `[Unreleased]` + les releases semver ([0.1.12]→[0.2.6], 557 l.) ; l'historique antérieur (schéma de versions « V… » V0→V1.9 et incréments [0.1.0]→[0.6.1]) est déplacé dans [`docs/CHANGELOG_ARCHIVE.md`](docs/CHANGELOG_ARCHIVE.md) avec un pointeur. Intégrité vérifiée (82 sections, 0 perdue).

### Fixed

- **shell / sidecar — fuite de process `multicorpus.exe` orphelins (R-01)** : ouvrir une DB en mauvais état (WAL périmé, dossier cloud-sync type OneDrive qui verrouille le fichier SQLite) figeait le sidecar et laissait s'accumuler des process orphelins que la machinerie de cleanup ne récupérait pas. Les **quatre** causes corrigées (P0+P1, puis P2), cf. `docs/AUDIT_FOLLOW_UP.md` R-01 et `docs/DECISIONS.md` ADR-042 : **(R-01a)** le shutdown gracieux côté Rust envoyait le mauvais header de token (`X-Sidecar-Token` au lieu de `X-Agrafes-Token`) → `/shutdown` 401 → fuite à **chaque** fermeture ; corrigé. **(R-01c)** côté client (`shared/sidecarCore.ts`) : **single-flight** sur `ensureRunning` (une seule tentative de spawn concurrente par DB — supprime le « spawn-storm » des 4 requêtes parallèles de l'écran Constituer) + kill du child sur tout échec de spawn. **(R-01d)** `register_sidecar` transmet le `pid` (du child spawné sur le chemin spawn, du portfile sur le chemin reuse) et le Rust **force-kill par PID** (`taskkill /F /T` / `kill -9`) en secours si le `/shutdown` gracieux échoue/timeout — reap de l'arbre process vérifié headless. **(R-01b)** `/health`/`/shutdown` rendus non-bloquants sous un handler figé : `HTTPServer`→`ThreadingHTTPServer` + `daemon_threads`, lock global `Lock`→`RLock`, et **sérialisation au dispatch** dans `do_GET/POST/PUT` (carve-out lock-free de `/health`, `/openapi.json`, `/shutdown`) → un seul accès DB à la fois (pas de race ; la dette préexistante lecture-vs-job du `JobManager` est résorbée), mais `/health`+`/shutdown` restent vifs. Conçu dans `docs/TICKET_R01B_SIDECAR_THREADING.md`. Contrat OpenAPI inchangé (aucun endpoint modifié) ; `sidecar.py` net +25 l. Tests : 2 vitest (single-flight + reap) + **3 pytest concurrence** (`/health` vif sous lock tenu, réentrance RLock) + **195 tests in-process** verts (reads/POST/PUT/contrat) ; vérifié en live (1 spawn propre à l'ouverture du démo, 0 orphelin après fermeture avec sidecar actif) + smoke headless du binaire.

### Security

- **remote / WebDAV — garde de schéma d'URL (ShareDocs)** : `remote/webdav.py` valide désormais l'URL (`validate_remote_url`) en tête de `propfind` **et** `download` — seuls `http`/`https` **avec hôte** sont acceptés. Le client utilise `build_opener(...)` qui câble les handlers par défaut d'urllib (dont `FileHandler`/`FTPHandler`) : sans cette garde, un `file:///…` passé à `download` (GET) **lirait un fichier local** (lecture de fichier local / SSRF). Garde au **chokepoint** → couvre les trois points d'entrée (CLI `import-remote`, `POST /webdav/list`, `POST /import-remote`) ; les deux endpoints sidecar rejettent en **400 synchrone** (avant tout fetch, et avant l'enqueue pour `/import-remote`). Complète les protections existantes du client (refus des `href` off-origin, strip de l'`Authorization` sur redirection cross-origin). 6 nouveaux tests (unitaires webdav + sidecar).
- **sidecar — durcissement loopback (S-01 / S-02 / S-04)** : **(S-01)** garde DNS-rebinding — `_check_host()` rejette tout header `Host` non-loopback (≠ `127.0.0.1`/`localhost`/`::1`) avec un `403 FORBIDDEN`, appelé en tête de `do_GET`/`do_POST`/`do_PUT` (défense en profondeur ; le socket est déjà borné loopback, un `Host` manquant HTTP/1.0 est toléré). **(S-02)** le portfile `.agrafes_sidecar.json` est créé via `os.open(O_WRONLY|O_CREAT|O_EXCL, 0o600)` → permissions restrictives **dès la création** (plus de fenêtre avec les perms par défaut avant le `chmod`) ; un portfile périmé (qu'on possède) est remplacé. **(S-04)** confirmé : `exporters/tei.py` est *write-only* (pas de parse → aucune surface XXE), commentaire d'import ajouté — `defusedxml` reste réservé au parsing (importers, `tei_validate`, webdav). 4 nouveaux tests in-process (`test_sidecar_security.py`) ; contrat OpenAPI inchangé.
- **prep — garde XSS bloquante en CI (S-03, phase 1)** : la règle `eslint-plugin-no-unsanitized` (`property`/`method`) devient **bloquante** (job CI `Lint tauri-prep`, scripts `lint`/`lint:prune`) — toute *nouvelle* affectation `innerHTML`/`outerHTML` qui ne passe pas par le sink typé `safeHtml``/`setHtml()` échoue désormais. Les **21 sites de la traîne** (6 fichiers : `app.ts`, `RolesPane`, `ImportScreen`, `ExportsScreen`, `AnnotationView`, `ActionsScreen`) sont routés vers `setHtml`/`appendHtml` + `raw()`. Une **passe adversariale** a trouvé que 10 de ces blocs interpolaient des données **non échappées** (titre/langue/chemin de fichier importé dans `ImportScreen` — vecteur réel, l'affichage voisin était pourtant échappé ; champs du modal preset dans `app.ts` ; langue/rôle de document dans `ExportsScreen`) : l'échappement a été ajouté (`_escHtml`/`_escHtmlApp`) pour que chaque `raw()` soit honnête plutôt que de masquer un site non sûr au linter. Les **89 sites pré-existants** des 4 écrans géants (Curation 31, Segmentation 21, Metadata 20, Align 17) sont *grandfathered* via les **bulk suppressions natives** d'ESLint 10 (`tauri-prep/eslint-suppressions.json`) ; ils se résorbent au fil de l'eau (`npm run lint:prune`) en tickets dédiés, sans pouvoir régresser. app/shell : phase ultérieure. Build + 422 tests vitest verts.
- **prep — burndown XSS `AlignPanel` (S-03, géant 1/4)** : les 17 sites *grandfathered* d'`AlignPanel` sont migrés vers le sink (`setHtml` + `raw()`) et **retirés de la baseline** (`lint:prune` → 89 → **72**). Audit d'échappement par site : 5 interpolations de données étaient non échappées et masquées par le `raw()` — texte d'unité orpheline (`o.text`), identifiants `external_id` (orphelin, candidats de reciblage, groupe de collision), langue/statut de doc dans la ligne de résumé → échappées via `_esc`. Le helper `_esc` d'`AlignPanel` est **durci** (échappe désormais aussi `"`) pour être sûr en contexte d'attribut. Reste *grandfathered* : Curation 31, Segmentation 21, Metadata 20. Build + 422 vitest verts.
- **prep — burndown XSS `MetadataScreen` (S-03, géant 2/4)** : les 20 sites *grandfathered* de `MetadataScreen` migrés vers le sink (`setHtml` + `raw()`) et **retirés de la baseline** (`lint:prune` → 72 → **52**). Audit d'échappement élargi (toute interpolation à accès-propriété, pas seulement celles collées à `>`/`="`) : 1 seule donnée non échappée trouvée — `external_id` dans `_curationStatusHtml` (le voisin `pivot_text`/`target_text` était déjà échappé) → corrigée via `this._esc`. Les autres candidats étaient des **non-sinks** (`textContent`, `opt.value`, `.title` propriété, `_log`/`toast`) ou déjà échappés (`modalConfirm` échappe via `_esc`, `richTextToHtml` sûr). Pas de hardening (les escapers `this._esc`/`_escHtmlMeta` échappent déjà `"`). Reste *grandfathered* : Curation 31, Segmentation 21. Build + 422 vitest verts.
- **prep — burndown XSS `SegmentationView` (S-03, géant 3/4)** : les 21 sites *grandfathered* de `SegmentationView` migrés vers le sink (`setHtml` + `raw()`) et **retirés de la baseline** (`lint:prune` → 52 → **31**). Audit d'échappement (accès-propriété + templates imbriqués + builders) : 2 corrections — `external_id` dans l'aperçu de segmentation (le voisin `s.text` était échappé) → `_escHtml` ; et `_roleBadgeHtml` injectait `conv.color` **brut** dans un `style="--role-color:…"` (couleur de rôle définie par l'utilisateur → breakout d'attribut possible) → passé par `safeColor` (allowlist hex), aligné sur RolesPane. Reste non-sinks (`textContent`/`toast`/`banner.textContent`) ou déjà sûrs (`richTextToHtml`). **À noter** : `CurationView` (dernier géant) porte le même bug `conv.color` brut (L2920) — sera corrigé dans son ticket. Reste *grandfathered* : Curation 31. Build + 422 vitest verts.
- **prep — burndown XSS `CurationView` (S-03, géant 4/4 — baseline vidée)** : les 31 sites *grandfathered* de `CurationView` (dernier et plus gros écran) migrés vers le sink (`setHtml`/`appendHtml` + `raw()`). La baseline tombe à **0** → `tauri-prep/eslint-suppressions.json` **supprimé**, la garde XSS est désormais **pleinement stricte** (plus aucun site toléré). Audit d'échappement (méthode complète, regex *non-ancré* pour attraper les interps en milieu d'attribut/texte) : 4 corrections — `conv.color` brut dans `style="--role-color:…"` → `safeColor` (le bug repéré depuis Segmentation) ; et `external_id` non échappé à **3** endroits dont un `aria-label="…${external_id}…"` (milieu d'attribut, qu'un regex ancré aurait raté) → `_escHtml(String(...))`. Tout le reste : non-sinks (`textContent`/`opt.value`/`setProperty`/`dataset`/`_log`/`toast`/event-detail) ou déjà échappé (texte de curation via `_escHtml`/`_renderSpecialChars`/`_highlightChanges`). **Les 4 écrans géants prep sont faits (89 sites résorbés, baseline 89 → 0).** Reste : config no-unsanitized pour `tauri-app`/`tauri-shell` (phase 2). Build + 422 vitest verts.
- **app + shell — garde XSS no-unsanitized (S-03 phase 2, clôture)** : la garde est étendue aux deux autres front-ends → **3 gardes bloquantes en CI** (`Lint tauri-prep`/`-app`/`-shell`), aucune baseline nulle part. **`tauri-app`** (#86) : sink autonome `tauri-app/src/lib/safeHtml.ts`, escapers `escapeHtml`/`_escHtml` durcis (échappent `"`) ; le **KWIC du concordancier** (surface XSS la plus sensible) est sécurisé par *escape-then-highlight* — `escapeHtml(raw)` neutralise tout le markup, puis seules les sentinelles `<<…>>` (devenues `&lt;&lt;…&gt;&gt;`) sont retransformées en `<span class="highlight">` sur du texte déjà échappé ; le reste via `elt()`/`textContent`/clipboard. **`tauri-shell`** (#87) : sink **réutilisé** de prep (import source-level), `escape.methods=['_esc']`, lint scopé au `src/` propre du shell (le code prep/app importé est ganté en amont) ; KWIC recherche via `textContent`/`.title`/clipboard. **`tauri-prep`** (#88) : `modalConfirm._esc` échappe aussi `"` (parité). Revue post-impl → 1 fix `_esc` sur `p.languages`/`p.alignment_strategy` de la liste de presets (shell.ts). **S-03 clos sur les 3 front-ends** ; ~9 vrais sinks de données non échappés corrigés au total, 0 XSS exploitable. Réf. `docs/TICKET_S03_PHASE2_APP_SHELL.md`.

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
