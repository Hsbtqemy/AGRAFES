# Suivi des audits — finding → statut → commit

**But.** Vue *inverse* manquante (finding D-04 de l'audit 2026-06-12). Le CHANGELOG
référence déjà les findings dans le sens **commit → finding** (« C-08→C-13 : XSS
corrigé ») ; ce fichier fournit le sens **finding → statut → commit**, pour savoir
d'un coup d'œil si un item est clos sans avoir à lancer un `git log -S`.

**Légende statut.**
✅ corrigé · 🟦 partiel · 📝 documenté (assumé, sans correctif) · 🔵 connu/assumé (dette) · ⬜ ouvert · 🔎 à vérifier · ❌ réfuté / retiré

**Convention.** Mettre ce fichier à jour **dans le même commit** que le correctif
d'un finding (au même titre que le CHANGELOG). Les priorités (P0/P1/P2) reprennent
le §6 de l'audit 2026-06-12 ; « — » = non priorisé explicitement.

> **Mise à jour 2026-06-18.** Tous les correctifs ci-dessous sont **mergés** dans
> `dev` (branche par défaut depuis la normalisation `main`/`dev`). Le commit
> `ae78207` (findings métier) a été intégré via la PR #41. Cette révision
> réconcilie le tracker avec la série tests front (PR #59→#63) et les chiffres
> A-01 réels.
>
> **Mise à jour 2026-06-22.** Recalage après la vague de validation : **A-03 clos**
> (valideur déclaratif `services/validation.py`, 6 lots #94→#99, clôture #100) et
> **A-03B clos** (dérivation OpenAPI single-source, #101) — les deux passent en
> *Traités*. La ligne A-03 « ⬜ ouvert / 66 blocs » de la section *Ouverts* était
> périmée (elle décrivait encore l'avant-projet) et a été retirée.
>
> **Mise à jour 2026-06-27.** Recalage **U-02** après la 2ᵉ vague de dégraissage
> front (#149→#157, 9 PRs). La ligne U-02 « ⬜ ouvert / Curation ~3 800 l., Metadata
> ~3 200 l. » était périmée (chiffres d'origine de l'audit) — les correctifs avaient
> été mergés sans recaler le tracker, contrairement à la convention ci-dessus. U-02
> passe en **🟦 partiel (point d'arrêt)** (en miroir d'A-01) : tout l'extractible à
> comportement-préservant est fait, le résidu (tables de constantes + cœurs
> interactifs) est hors périmètre = tickets dédiés. Méthode + bilan en mémoire de
> session (`u02-prep-decomposition-method`).
>
> **Mise à jour 2026-06-28.** Nouvel audit général (`AUDIT_2026-06-28.md`, base
> `docs/smoke-u02-progress`, post-v0.2.7) — 6 agents par domaine + contre-vérification
> manuelle des findings tête d'affiche. Section dédiée ci-dessous. Cette passe, plus
> orientée *correction* qu'architecture, ouvre **~40 findings neufs** dont **2 🔴**
> (DoS CQL `QRY-01`, mauvais code HTTP `SID-01`) et un cluster sécurité/intégrité 🟠
> *local mais exploitable* — **tous ouverts** (aucun correctif appliqué). Elle confirme
> par ailleurs **clos dans le code** (pas seulement le tracker) la quasi-totalité des
> findings 2026-06-12 : A-02, A-03/A-03B, Q-01, Q-02, Q-03, T-01→T-03, N-01→N-04, N-07,
> S-01→S-04, U-01, C-01, R-01a→d, ADR-039, F-04, DEP-1, D-02, D-04. Elle **re-confirme
> ouverts** A-01, A-04, Q-04, U-02, U-04, N-05, N-06, N-08, F-03, T-05, D-03, D-05.
> **Aggravations** : `Q-05`→`QRY-01` (DoS reproduit 114 s), `D-06`→`OPS-03` (drift contrat
> 1.6.23 vs 1.6.31, +8 patches), roleBadge drift→`SEC-02`/`FE-01`.

---

## Audit 2026-06-28 (post-v0.2.7, base `docs/smoke-u02-progress`) — `AUDIT_2026-06-28.md`

Findings **neufs** de la passe du 2026-06-28. Tous **⬜ ouverts** (aucun correctif appliqué
— l'audit est en lecture seule). « ✔ » = re-vérifié manuellement dans le code au-delà de
l'agent. Priorités = §6 de `AUDIT_2026-06-28.md` (P0 = correctifs ponctuels immédiats ;
P1 = durcissement sécurité/intégrité ; P2 = fond de panier). Détail + preuve `fichier:ligne`
dans le fichier d'audit, §4.

> **Lot P0 corrigé le 2026-06-28** (même commit que cette transcription) :
> **ENG-01, QRY-01, QRY-02, QRY-03, SID-01, SID-02, SID-03** → ✅ corrigé
> (correctif + test de régression + CHANGELOG `[Unreleased]`). **SID-05 différé** :
> le fix atomique impose de passer l'URL distante à `dispatch_import` et aux
> 7 importeurs (hors périmètre du lot ponctuel) — reste ⬜. Tous les autres
> findings de la passe restent ⬜.
>
> **Passe de revue adverse (même jour, commit de suivi)** — deux incomplétudes des
> correctifs ci-dessus, refermées : (a) **SID-02 était une classe**, pas un cas
> isolé — l'auth d'écriture par match exact laissait **6 routes mutatrices sans
> token** : `/curate/exceptions/set|delete`, `/export/tmx|bilingual`, et surtout
> `/families/{id}/segment|align` (resegment / ré-alignement **destructifs**). Set
> extrait au niveau module (`_WRITE_PATHS`) + prédicat pur **testable**
> `_post_requires_write_token` couvrant aussi les routes à segment dynamique ;
> 32 tests (`test_sidecar_write_paths.py`). (b) **QRY-02** contournable par **espace
> de tête** avant `=` (`" =1+1"`, NBSP) — corrigé (inspection du 1ᵉʳ caractère
> non-blanc). Reviewer adverse a aussi confirmé **0 bug/régression** sur les 7
> correctifs et **0 autre appel `_send_error` positionnel** (SID-01, 303 appels
> scannés).
>
> **Lot P1 (commit suivant)** : **SID-04** (SSRF — IP internes bloquées),
> **QRY-04** (contrat CLI `serve --host`), **SEC-02/FE-01** (couleur convention :
> validation hex serveur + `safeColor` front → drift roleBadge résorbé) → ✅ ;
> **OPS-02** smoke sur `dev` (🟦 — `release-gate` laissé). **OPS-01** laissé
> `📝 documenté` (gate informatif assumé). **Différé** (lot front suivant) :
> FE-02 (fuite listeners), FE-05 (dialogues natifs), FE-03/04 (CSS non préfixé).

### Ouverts — Correction & intégrité (moteur)

| ID | Sév | Prio | Statut | Constat (résumé) |
|----|-----|------|--------|------------------|
| ENG-01 ✔ | 🟠 | P0-5 | ✅ corrigé | Styles inline ODT perdus à l'import : `odt_para_to_rich_text(elem, style_map)` en 2-positionnel → `style_map` lié au param `ns` (mort), vrai param `None`→`{}` ; **tous** les imports ODT perdent `<hi rend>`. Tests masquent (forme 3-args). `odt_common.py:133` / `rich_text.py:282`. |
| ENG-02 | 🟡 | P2-19 | ✅ corrigé (P3) | Préfixe `[n]` désaligné plain vs rich. **Fix** : re-match du marqueur sur `rich.lstrip()` (`_NUMBERED_RE.match`) pour retirer exactement le préfixe en préservant le style ; fallback sur l'offset plain si le marqueur rich ne matche pas (brackets normalisés). docx + odt. Test (revue P3b) : `test_docx_numbered_lines_tables.py::test_paragraph_to_unit_strips_marker_despite_leading_whitespace` (sans le fix → `] hello`). `docx_numbered_lines.py` / `odt_numbered_lines.py`. |
| ENG-03 | 🟡 | P2-19 | ✅ corrigé (P3) | merge/split renvoient désormais `fts_stale: true` (réindex requise) ; merge **supprime la ligne FTS orpheline** de l'unité supprimée (best-effort) que `stale_doc_ids()` ne voit pas. Champ documenté au contrat (CONTRACT_VERSION 1.6.32). `sidecar.py` (merge/split). |
| ENG-04 | 🟢 | P2-19 | ✅ corrigé (P3) | `update_unit_text` ne (ré)insère en FTS que les unités `line` (lecture `unit_type` avant INSERT) ; le DELETE reste inconditionnel (purge des lignes périmées). Tests : `test_units_service.py` (structure exclue / line réindexée). `units_service.py`. |
| ENG-05 | 🟢 | P2-19 | ✅ corrigé (P3) | TEI : `_iter_body_elements` ne garde que le match **le plus externe** d'une imbrication même-tag (parent-map) → plus de double comptage. Test : `test_parse_layer.py::test_parse_tei_nested_same_tag_not_double_counted`. `tei_importer.py`. |

### Ouverts — Requête / curation / export / CLI

| ID | Sév | Prio | Statut | Constat (résumé) |
|----|-----|------|--------|------------------|
| QRY-01 ✔ | 🔴 | P0-2 | ✅ corrigé | **DoS algorithmique CQL** : récursion exponentielle (`seen` ne déduplique qu'aux feuilles), cap `_MAX_REPEAT` par-quantifieur seulement. `[]{0,30}×4` sur 100 tokens = **114 s**. Exposé via `/token_query`/`/token_stats`/`/token_collocates`. Aggrave Q-05. `token_query.py:57` / `cql_parser.py:152`. |
| QRY-02 ✔ | 🟠 | P0-4 | ✅ corrigé | **Injection de formule CSV** : neutralisation par préfixe `'`. Étendu (revue adverse) : inspection du **1ᵉʳ caractère non-blanc** → contournement par espace/NBSP de tête fermé. `csv_export.py`. |
| QRY-03 | 🟠 | P0-4 | ✅ corrigé | **XSS rapport QA HTML** : `render_qa_report_html` interpole title/language/gates en f-strings bruts (vs `html.escape` ailleurs). `qa_report.py:360-405`. |
| QRY-04 | 🟠 | P1-11 | ✅ corrigé | `serve --host` invalide émet l'objet JSON d'erreur via `_err` (était `raise SystemExit(str)` → pas de JSON). `cli.py` ; test `test_cli_contract.py::test_serve_invalid_host_emits_single_json_error`. |
| QRY-05 | 🟡 | P2-19 | ✅ corrigé (P3) | `_translate_js_replacement(repl, ngroups)` : un `$NN` sans groupe correspondant est laissé **littéral** (sémantique JS : fallback 2-chiffres puis verbatim) au lieu de `\g<NN>` (qui faisait planter `re.sub`). `rules_from_list` passe `compiled.groups`. Tests : `test_curation.py` (group-count + backref inconnu littéral). `curation.py`. |
| QRY-06 | 🟡 | P2-19 | ⬜ ouvert | Garde ReDoS incomplet (`(a|a)*`, `(a|ab)*`, `((a)*)*` non détectés) ; filet réel = `_MAX_REGEX_LEN`. `query.py:32` / `curation.py:38`. |
| QRY-07 | 🟡 | P2-19 | ✅ corrigé (P3) | `source_ext` échappe désormais `\ % _` + `LIKE ? ESCAPE '\'`, comme author/title → sémantique LIKE cohérente. Test (revue P3b) : `test_query.py` (clause ESCAPE + wildcards échappés sur `_apply_doc_filters`). `query.py`. |
| QRY-08 | 🟢 | P2-19 | ⬜ ouvert | `rules_fired` : détection regex sans flags V0 + recompilation pattern×unité. `curation.py:287`. |
| QRY-09 | 🟢 | P2-19 | ✅ corrigé (P3) | `_HIGHLIGHT_CLOSE` remonté à côté de `_HIGHLIGHT_OPEN` en tête de module (était au milieu d'un corps de fonction). `query.py`. |

### Ouverts — Sidecar / services / contrat

| ID | Sév | Prio | Statut | Constat (résumé) |
|----|-----|------|--------|------------------|
| SID-01 ✔ | 🔴 | P0-1 | ✅ corrigé | `_send_error(400, "BAD_REQUEST", "…")` en positionnel (code/http_status keyword-only) → `TypeError` → **500 au lieu de 400** sur `/families/{id}/curation_status` id non-entier. `sidecar.py:639` (sig. `:422`). |
| SID-02 / SEC-01 ✔ | 🟠 | P0-3 | ✅ corrigé | `/jobs` était absent de `_write_paths` → mutation DB **sans token**. **Étendu (revue adverse) : classe entière** — 6 routes mutatrices passaient à travers le match exact (`/curate/exceptions/set\|delete`, `/export/tmx\|bilingual`, `/families/{id}/segment\|align`). Set extrait (`_WRITE_PATHS`) + prédicat testable `_post_requires_write_token`. `sidecar.py:406,459,807` ; `test_sidecar_write_paths.py`. |
| SID-03 | 🟠 | P0-6 | ✅ corrigé | Mutations multi-statements non atomiques sans rollback (`delete_documents`, `bulk_update_documents`) sur connexion partagée ; 1 seul `rollback()` dans tout le sidecar. `documents_service.py:164-262` / `connection.py:14`. |
| SID-04 | 🟠 | P1-7 | ✅ corrigé | SSRF : `validate_remote_url` rejette les **IP littérales** loopback/privées/link-local (incl. `169.254.169.254`) + `localhost`, **sans résolution DNS** (validateur pur). **Durci (revue adverse)** : couvre aussi les **encodages IPv4 obfusqués** (`2130706433`/`0x7f000001`/`0177.0.0.1`/`127.1`/`localhost.`) via `inet_aton` (network-free). Nom DNS→IP interne = hors périmètre (défense-en-profondeur, sidecar loopback-only). `webdav.py` ; tests `test_webdav_client.py`. |
| SID-05 | 🟠 | P0-6 | ⬜ ouvert (différé) | Provenance ShareDocs non atomique : import commit puis UPDATE `source_path` 2ᵉ commit ; crash entre → `source_path = tmp_path`. **Différé du lot P0** : fix atomique = passer l'URL distante à `dispatch_import` + aux 7 importeurs (la fenêtre de crash ne se ferme pas sans cela). `ingest.py:195-208`. |
| SID-06 | 🟠 | P1-13 | 🟦 partiel | 11 routes hors OpenAPI ; le contract-freeze ne voit que le snapshot. **Volet auth refermé** (extension SID-02 : `/curate/exceptions/set\|delete` etc. désormais dans `_WRITE_PATHS` — l'audit les disait à tort déjà protégées). Reste le **volet documentation contrat** (routes absentes de l'OpenAPI). `sidecar.py`. |
| SID-07 | 🟡 | P2-19 | ✅ corrigé (P3) | Les 2 erreurs d'écriture d'export utilisent désormais `ERR_INTERNAL` (catalogue) au lieu du littéral `EXPORT_WRITE_ERROR`. `sidecar.py`. |
| SID-08 | 🟡 | P2-15 | ✅ corrigé (P3) | Ambiguïté `version` documentée (commentaire `sidecar_contract.py`) : `/health.version` = version **moteur** ; partout ailleurs `version`/`api_version` = version **API/contrat**. Conjoint à OPS-03. |
| SID-09 | 🟡 | P0-1/A-01 | ⬜ ouvert | A-03 résiduel : `validate()` sur 3 endpoints, ~22 handlers en validation manuelle (dette assumée « pilote »). `request_schemas.py:127`. |
| SID-10 | 🟡 | P2-19 | ✅ corrigé (P3) | `_lock()` annoté `threading.RLock` (+ docstring module corrigée « reentrant threading.RLock »). `sidecar.py`. |
| SID-11 | 🟡 | P2-19 | ✅ corrigé (P3) | `JobRecord.status` : `canceled` ajouté au commentaire des statuts. `sidecar_jobs.py`. |
| SID-12 | 🟡 | P2-19 | ⬜ ouvert | Coerce-int dupliqué/incohérent (`_int_or` vs `validate` vs `int()` nu). `curate_service.py:32,52`. |
| SID-13 | 🟡 | P2-19 | ✅ corrigé (P3) | `components.securitySchemes.token` (apiKey, header `X-Agrafes-Token`) ajouté ; `/align/collisions/resolve` unifié `ApiKeyAuth`→`token` (référence aussi pendante). `openapi.json` régénéré. `sidecar_contract.py`. |
| SID-14 | 🟡 | P2-19 | ⬜ ouvert | Timeout WebDAV fixe (30 s) non configurable, per-read (pas de budget total). `webdav.py:28` / `ingest.py:103`. |
| SID-15 | 🟡 | P2-19 | ⬜ ouvert | Pic disque ShareDocs (temp non purgés par fichier, `rmtree` global en fin). `ingest.py:116`. |
| SID-16 | 🟢 | P2-19 | ✅ corrigé (P3) | Les 2 lignes de sémantique `hrefs` (1.6.29) remontées sous leur entrée ; nouvelle entrée 1.6.32 ajoutée. `sidecar_contract.py`. |

### Ouverts — Sécurité transverse & Rust

| ID | Sév | Prio | Statut | Constat (résumé) |
|----|-----|------|--------|------------------|
| SEC-02 / FE-01 | 🟠 | P1-8 | ✅ corrigé | roleBadge drift **résorbé** : serveur valide la couleur en hex (`conventions_service` create+update → `ValidationError` sinon) ; front `UnitInspectorPanel` passe par `safeColor` (comme les 2 autres renderers). `conventions_service.py` / `UnitInspectorPanel.ts:50` ; tests `test_conventions_service.py`. |
| SEC-03 | 🟡 | P2-19 | ✅ corrigé (P3, QA runtime requise) | CSP ajoutée aux **3 apps livrables** (shell/prep/app) : `script-src 'self'` (durcissement XSS ; Tauri 2 nonce ses scripts, Vite = modules `'self'`), `style-src 'unsafe-inline'`, `connect-src` loopback+`ipc:`, `object-src 'none'`, `base-uri 'self'`. I/O sidecar = `@tauri-apps/plugin-http` (Rust) donc non gated par `connect-src`. **Fixture e2e hors périmètre** (non livré, `bundle.active:false`). ⚠️ Seul item P3 non prouvable par build : **smoke runtime des 3 apps requis avant de s'y fier** (tsc/vitest ne lisent pas `tauri.conf.json`). **Inclure le mode `tauri dev`** : `script-src 'self'` peut casser le HMR Vite (scripts inline + websocket) — remède = `app.security.devCsp` permissive (non ajoutée ici car la clé n'est pas vérifiable hors `tauri build`/`dev`, le schéma vendored étant l'ACL des permissions). |
| SEC-04 | 🟡 | P2-19 | ⬜ ouvert | Portfile `0o600` non effectif sur Windows (token hérite de l'ACL parent ; même-utilisateur). `sidecar.py:8170`. |
| SEC-05 | 🟢 | P2-19 | ⬜ ouvert | `register_sidecar` (Rust) fait confiance à `base_url` JS pour `/shutdown` (théorique : appelant déjà détenteur du token). `main.rs:262`. |
| SEC-06 | 🟢 | P2-19 | ⬜ ouvert | `sidecar_fetch_loopback` recopie headers JS sans allowlist (host loopback → impact ~nul). `main.rs:59`. |
| SEC-07 | 🟢 | P2-19 | ⬜ ouvert | `serve --token <secret-littéral>` persiste verbatim dans `runs.params` (mode `auto` du shell = sûr). `cli.py:915`. |
| SEC-08 | 🟢 | — | 🔵 connu | `richTextToHtml` réinjecte `<hi>` sans ré-échapper, sûr sous l'invariant ADR « text_raw XML-échappé à l'import ». `sidecarClient.ts:118`. |

### Ouverts — Front-ends

| ID | Sév | Prio | Statut | Constat (résumé) |
|----|-----|------|--------|------------------|
| FE-02 | 🟠 | P1-9 | ✅ corrigé | `buildUI` (`tauri-app`) retourne un disposer (helper `onDoc` traçant les 3 écouteurs `document`) que `disposeApp` appelle au démontage → plus d'accumulation au re-montage Explorer. `buildUI.ts` / `app.ts` ; `tsc` + 81 tests app verts. |
| FE-03/04 | 🟠 | P2-17 | ⬜ ouvert (différé, investigué) | **Investigation (passe 4)** : la vraie collision shell = **9 classes** définies dans app **et** prep (`active`, `btn`, `btn-ghost`, `btn-primary`, `btn-secondary`, `chip`, `error`, `open`, `visible`). **Bug réel et visible** : app `.btn`=`padding:8px 14px;border:1.5px` vs prep `.btn`=`padding:.35rem .9rem;border:none` → la dernière CSS chargée dans le shell gagne. **Fix = renommer ces 9 côté app → `app-*`** (CSS de `tauri-app` centralisée dans `ui/dom.ts` `const CSS`). **Pièges (pourquoi pas mécanique aveugle)** : ~21 classes app finissent par `-btn` (`source-changed-btn`…) ≠ collision `btn` ; `.error-banner` ≠ collision `error` → patterns à frontière exacte requis (`\.btn\b` sûr en CSS ; `([\s"'])btn\b` en TS ; négatif-lookahead `-` pour `error`/`active`/`open`/`visible`). **Vérif = rendu visuel du shell** (prep+app bundlés) — `tsc`/`vitest` ne voient pas les classes CSS. **Différé = ticket à faire avec QA visuelle du shell.** Le « tout préfixer » (277 classes app) est hors sujet : seules les 9 collisionnent. **Cadrage complet : `docs/TICKET_FE0304_CSS_NAMESPACING.md`.** |
| FE-05 | 🟠 | P1-12 | ✅ corrigé | Dialogues natifs supprimés : 4 `alert` SegmentationView → `this._cb.log(…, true)` ; `alert` preset `app.ts` prep → `showToast` ; `window.confirm` export `tauri-app` → modal promise-based `confirmModal` (CSS `.modal-overlay`, 4 tests happy-dom). |
| FE-06 | 🟡 | P2-18 | ⬜ ouvert | (= U-03) `tauri-app` non testé sur `ui/dom.ts` (1788 l.), results/metaPanel/stats/docSelector/importFlow. |
| FE-07 | 🟡 | — | ⬜ ouvert | (= U-05) i18n absent (FR en dur). |
| FE-08 | 🟡 | P2-19 | ✅ corrigé | Écouteur `window` `agrafes:prep-focus-segment-unit` (anonyme) jamais retiré dans `App.dispose()` → fuite au re-montage prep dans le shell (la note d'origine « mono-instance » était fausse : le shell re-crée `App`). Stocké en champ `_focusSegmentHandler` + retiré dans `dispose()`. Trouvé en revue adverse P2. `app.ts:436`. |
| FE-09 | 🟢 | — | ❌ écarté | « Dual sidecarClient state » = faux positif : un seul `_conn` partagé via `shared/sidecarCore.ts`. |
| FE-10 | 🟢 | — | ❌ écarté | Handlers async `MetadataScreen` « sans try/catch » surévalués : les méthodes appelées ont leur propre `try`. |

### Ouverts — CI/CD, build, supply chain, gouvernance

| ID | Sév | Prio | Statut | Constat (résumé) |
|----|-----|------|--------|------------------|
| OPS-01 | 🟠 | P1-10 | 📝 documenté | Growth-gate non bloquant **par choix documenté** (`::warning::` + commentaire : les PR de réduction A-01 passaient elles-mêmes au rouge, fenêtre 90 j dominée par la croissance historique). À re-durcir (`exit 1`) une fois le net 90 j confirmé sous le seuil — décision de politique CI, laissée en l'état. `sidecar-growth-gate.yml:99`. |
| OPS-02 | 🟠 | P1-10 | 🟦 partiel | `smoke.yml` tire désormais sur `[main, dev]` (✅). `release-gate.yml` laissé `main`-only (gate de *release*, lourd sur PR dev — à arbitrer). `smoke.yml:4`. |
| OPS-03 | 🟡 | P2-15 | ✅ corrigé (P3) | `API_VERSION = CONTRACT_VERSION` (dérivé, plus un 2ᵉ littéral maintenu à la main) → drift structurellement impossible. CONTRACT_VERSION 1.6.31→1.6.32 ; `openapi.json` régénéré. `sidecar_contract.py`. |
| OPS-04 | 🟡 | P2-19 | ✅ corrigé (P3) | Commentaire `pyproject.toml` corrigé (gate CI = **60**, plus le 35 périmé). `pyproject.toml`. |
| OPS-05 | 🟡 | P2-19 | ⬜ ouvert (différé) | CHANGELOG recrû (632 l.). **Différé du lot P3** : churn récurrent (le fichier regrossit à chaque feature) ; l'archivage (~100 l. à déplacer vers `docs/CHANGELOG_ARCHIVE.md` + cutoff + footer à mettre à jour) polluerait un PR de correctifs code — à traiter en passe d'archivage dédiée. |

**Rappels — antérieurs re-confirmés ouverts par cette passe** (déjà tracés ci-dessous / en
2026-06-12, non dupliqués ici) : `A-01` (sidecar 8 885 l., point d'arrêt), `A-04`, `Q-04`,
`U-02` (point d'arrêt), `U-04`, `N-05`, `N-06`, `N-08`, `F-03` (SHA-pinning), `T-05` (driver
E2E), `D-03`, `D-05`.

**Trou de tests transversal.** 23 modules moteur sans `test_<module>.py` direct ; prioriser
`aligner`, `importers/dispatch`, `db/connection`, `sidecar_contract` (logique centrale).

---

## Audit 2026-06-12 (post-v0.2.6, base `373524b`) — `AUDIT_2026-06-12.md`

### Traités

| ID | Sév | Prio | Statut | Preuve / commit |
|----|-----|------|--------|-----------------|
| N-02 | 🟡 | P1-5 | ✅ corrigé | Re-flag des liens dans `_undo_merge_units`/`_undo_split_unit` + purge FK avant DELETE. Étendu à `_undo_resegment` (même crash FK, trouvé en revue). `ae78207`, tests `test_undo.py` |
| N-03 | 🟡 | P1-5 | ✅ corrigé | `links_created` via `cur.rowcount` aux 4 stratégies d'alignement (était `len(links)`). `ae78207`, test `test_alignment.py::test_align_links_created_excludes_ignored_duplicates` |
| N-05 | 🟡 | P1-5 | 📝 documenté | Race statut de job au shutdown : commentaire `sidecar_jobs.py` (~ligne 152). Fix fidèle = signal de commit côté runner, hors périmètre. `ae78207` |
| N-07 | 🟡 | P1-5 | ✅ corrigé | `bump_version.py` met à jour le `Cargo.toml` du shell (regex ancrée) + resync `0.1.28 → 0.2.6`. `ae78207` |
| Q-01 | 🟠 | P0-2 | ✅ corrigé | `[tool.ruff]` (E4/E7/E9/F, E741 ignoré) + job CI `lint` ; 57 violations résorbées (46 autofix, 5 vars, 1 dead). `1b12520` |
| T-01 | 🔴 | P0-2 | ✅ corrigé | Gate `--cov-fail-under=60` dans le step pytest CI (ratcheté depuis 35 ; couverture réelle CI = 61,94 %). `1b12520` |
| N-01 | 🟠 | P0-2 | ✅ corrigé | `dependabot.yml` étendu à pip/npm/cargo (4 apps + `src-tauri`), groupé hebdo. `1b12520` |
| A-02 | 🟠 | P0-1 | ✅ corrigé | `/import/preview` ne réimplémente plus les importers : chaque mode passe par `parse_<mode>() -> ParsedDoc` + `to_preview()` (txt/docx×2/odt×2/tei), preview CoNLL-U *lenient* déplacé dans `conllu.preview_conllu`. `sidecar.py` −142 l. Corrige 3 divergences preview↔import (strip préfixe docx, fallback ext_id TEI, preview ODT cassé). PR #47, tests `test_parse_layer.py` (équivalence preview==import) |
| Q-03 | 🟡 | — | ✅ corrigé | `file_sha256` unique dans `parsed.py` ; les 7 importers l'utilisent (suppression des 5 `_compute_file_hash` + 2 cross-imports docx→odt). PR #47 |
| A-03 | 🟠 | P0-1 | ✅ corrigé | Valideur de schéma **déclaratif** `services/validation.py` (`Field`+`validate`, **stdlib pur** — pas de pydantic/jsonschema) remplaçant les blocs de validation manuelle ; invariant **`error_code` byte-identique** par endpoint. **6 lots** : socle + 2 preuves (#94), `documents_service` + facettes items/bornes-collections (#95), `units_service` coerce-int id (#96), facette `nullable` + `tokens_service` (#97), `doc_relations_service` (#98), 1ʳᵉ preuve handler **inline** sidecar (`out_path` export conllu/ske, #99). **Clôturé #100** (§8 `TICKET_A03_SCHEMA_VALIDATION.md`) : **finding line-négatif** — migrer un garde *mono-champ* de `sidecar.py` coûte des lignes (imports + try/except) ⇒ la traîne sidecar field-by-field reste un **backlog assumé** (gain réel seulement sur handlers multi-champs ou helper partagé). Le valideur est l'outil de référence pour toute nouvelle validation structurelle. |
| A-03B | 🟠 | P0-1 | ✅ corrigé | **Dérivation OpenAPI single-source** : le `requestBody` de `/index` (`IndexRequest`) est **généré** du même tuple `Field` que la validation, via `field_schema_to_openapi()` (`services/request_schemas.py`). `Field` gagne `description` (pure métadonnée — `validate()` l'ignore). **Byte-identique** (contract-freeze vert, `docs/openapi.json` + snapshot inchangés) ; 26 tests générateur. **Pilote = `/index`** ; extension **gatée** sur la complétude + le typage des `Field` (les autres schémas migrés sont presence-only/partiels → dériveraient une régression du contrat). #101, §7 `TICKET_A03B_OPENAPI_FROM_FIELD.md`. |
| — | — | — | ✅ bonus | CI déclenchée aussi sur `development` (les gates ne tiraient que sur `main`). `1b12520` |
| — | — | — | ✅ bonus | Tests front **gatés en CI** : les 394 tests Vitest de Prep existaient mais ne tournaient jamais (seul `build` tournait). Jobs Vitest prep/app/shell ajoutés dans `ci.yml` + `smoke.yml` ; `.mjs` ad-hoc (qui testaient des copies inline) migrés vers du Vitest important le vrai code. PR #59→#63. |
| D-04 | 🟡 | P1-7 | ✅ corrigé | **Ce fichier** (vue inverse finding→statut→commit) |
| T-02 | 🟠 | P0-3 | ✅ corrigé | Suites dédiées `test_telemetry.py` (13) + `test_curation.py` (35) important le vrai code (étaient testés seulement indirectement). `curation.py` **100 %** ; coverage projet 61,94 %→66,82 %. PR #65 |
| A-05 | — | — | ❌ retiré | Réfuté en passe 2 : les index secondaires existent (`003_alignment.sql`, `012_tokens.sql`) |
| D-01 | 🟠 | P1-7 | ✅ corrigé | `ROADMAP.md` remis à niveau 2026-06-19 (forward roadmap ancrée sur cet audit + historique préservé + table phases étendue) ; `BACKLOG*.md` réconciliés — conventions CRUD F-1/F-2 (livré via onglet Rôles) et `POST /token_stats` SP-3.1 marqués ✅ avec preuve. Archivage CHANGELOG suivi séparément (D-02). |

### Ouverts

| ID | Sév | Prio | Statut | Constat (résumé) |
|----|-----|------|--------|------------------|
| A-01 | 🔴 | P0-1 | 🟦 partiel (point d'arrêt) | `sidecar.py` monolithe (9961→8523 l). Couche `services/` (7 domaines) : `import` (#46) + `conventions` (#50) + `doc_relations` (#52) + `documents` (#53, +`BadRequestError`) + `curate`-CRUD (#54) + `units` (#55) + `tokens` (list/update). Handlers→adapters fins (lock writes, map erreurs typées→codes, envelope ; byte-identiques). Couplé laissé en adapter (assumé) : backfill schéma `_ensure_*`, télémétrie `doc_deleted`. Filet : smoke-run binaire en CI (#51) = 1 GET/couche, gate de croissance rendu informatif (#56). **Point d'arrêt assumé** : tous les domaines à logique DB réelle sont extraits. **Non extraits (volontaire)** : `export` + `query`/`token_query`/`stats` (délégateurs — la logique est déjà dans `exporters/`/`query.py`/`token_query.py`/`cql_parser`, extraction = simple déplacement de validation) ; `units/merge`+`split`, `curate_preview`/`*_export`, `align`/`segment`/`jobs` (à état/couplés). |
| A-04 | 🟡 | P2-13 | ⬜ ouvert | Attributs dynamiques non typés sur `HTTPServer` |
| Q-02 | 🟠 | P0-1 | 🟦 partiel | Fonctions géantes : `_handle_import` 242 l → adapter ~15 l (A-01 #46) ; **`_build_hits`/`_build_hits_regex` dédupliqués** via `_build_hits_core` partagé (paramétré matchers + `coerce_text_norm` + `log_hits` ; byte-identique, logs inclus) — le chemin regex, jamais testé, gagne une couverture directe. Reste : `_handle_query` 221 l (délégateur, laissé avec les autres). |
| Q-04 | 🟡 | P2-13 | ⬜ ouvert | Typage hétérogène ; pas de TypedDict pour les shapes de contrat |
| Q-05 | 🟡 | — | ⬜ ouvert | Matcher CQL : pas de cap global documenté (gardes présentes) |
| T-03 | 🟡 | P1-6 | ✅ corrigé | Les 11 fichiers versionnés (`test_v2`/`test_v21`/`test_sidecar_v03…v15`/`test_sidecar_jobs_v05`/`test_sidecar_hardening_v141`) déplacés sous `tests/contracts/` (`git mv`). Discovery OK (`testpaths=["tests"]`, sous-dossier sans `__init__.py` — convention `importers/`/`services/`) : 225 tests collectés ; `test_v21` FIXTURES_DIR repointé `.parent.parent`. README tests mis à jour. |
| T-04 | 🟡 | — | ✅ corrigé | **NO_PROXY** centralisé dans `tests/conftest.py` (ajoute loopback à `no_proxy` à l'import, additif, no-op en CI) → plus besoin de `NO_PROXY=…` manuel en local. **Re-classification des `time.sleep`** (audit ré-examiné) : sur 27, **26 sont des intervalles de polling dans des boucles condition+timeout** (`while time.time()<deadline` / `for _ in range(N)` → poll `/health`/job/portfile puis `raise`) — déjà robustes, pas un défaut. Le seul sleep *fixe* (`test_sidecar_threading.py` `time.sleep(0.4)` pour laisser un thread se bloquer sur le lock du dispatch) est inhérent au test de concurrence et commenté → laissé. Dedup des helpers de polling (~12 copies quasi-identiques) = cosmétique, non fait (tests sidecar non-runnables localement ⇒ risque en aveugle ; option de suivi). |
| T-05 | 🟠 | — | 🟦 partiel | E2E Tauri *driver* (Playwright/WebDriver) toujours absent. Couverture d'intégration accumulée sans driver : render-smoke DOM happy-dom côté shell (`styleRegistry`/`diagnostics`/`telemetry`, PR #61→#63) **+ côté `tauri-prep`** (happy-dom opt-in par fichier via docblock, env `node` préservé ; tests de caractérisation montant `CurationView` 3802 l. & `MetadataScreen` 3201 l. sans sidecar → filet avant décompo U-02) ; **tests d'intégration de la couche connexion** `sidecarClient` (prep) — `ensureRunning` reuse (portfile + in-memory + switch-DB) **et chemin spawn / cold-start** (`_spawnSidecar` via fake `Command` : JSON de démarrage → connexion + token + registry, kill du child précédent), `shutdownSidecar`, `getActiveConn`/`resetConnection`, **le transport** (`conn.get`/`post` : envelope JSON, mapping `SidecarError` message+statut, header `X-Agrafes-Token`, **reconnect-once** sur erreur réseau), helpers URL — via mocks des plugins Tauri (22 tests), qui **gatent la réconciliation connexion d'U-01 (PR2) sur reuse, spawn ET transport**. Reste : vrai driver E2E + cas d'échec spawn / fall-throughs (portfile autre-DB, unhealthy). |
| S-01 | 🟡 | P1-8 | ✅ corrigé | Garde DNS-rebinding : `_check_host()` rejette tout header `Host` non-loopback (≠ `127.0.0.1`/`localhost`/`::1`) → 403 `FORBIDDEN`, appelé en tête de `do_GET/POST/PUT` (Host manquant HTTP/1.0 toléré, connexion déjà bornée loopback). 2 tests (`test_sidecar_security.py`). |
| S-02 | 🟡 | P1-8 | ✅ corrigé | `_write_portfile` crée le portfile via `os.open(O_WRONLY\|O_CREAT\|O_EXCL, 0o600)` → perms `0o600` **à la création** (plus de fenêtre avant le `chmod`) ; un portfile périmé (qu'on possède) est `unlink` d'abord. 2 tests (perms POSIX + écrasement du stale). |
| S-03 | 🟡 | P0-2 | ✅ corrigé | Sink type-safe `setHtml`/`safeHtml\`\`` + ESLint no-unsanitized ; 3 fichiers migrés, `f858c78`. Aucun vrai XSS trouvé (escapers tous vérifiés). **Phase 1 livrée** : la règle `no-unsanitized` est **bloquante en CI** (job `Lint tauri-prep`, scripts `lint`/`lint:prune`) → toute *nouvelle* affectation `innerHTML` hors sink échoue. Les **21 sites de la traîne** (6 fichiers : `app.ts`, `RolesPane`, `ImportScreen`, `ExportsScreen`, `AnnotationView`, `ActionsScreen`) routés via `setHtml`/`appendHtml` + `raw()` ; passe adversariale → **10 interpolations de données non échappées corrigées** (titre/langue/chemin de fichier importé `ImportScreen`, champs modal preset `app.ts`, langue/rôle doc `ExportsScreen`) pour que les `raw()` soient honnêtes. Les **89 sites des 4 géants** (Curation 31, Segmentation 21, Metadata 20, Align 17) *grandfathered* via les **bulk suppressions natives** d'ESLint 10 (`tauri-prep/eslint-suppressions.json`) — résorption incrémentale (`lint:prune`) en tickets dédiés, sans régression possible. **Burndown des 4 géants TERMINÉ** — AlignPanel (17, 5 fixes + `_esc` durci), Metadata (20, 1 fix), Segmentation (21, 2 fixes dont `conv.color`→`safeColor`), Curation (31, 4 fixes : `conv.color`→`safeColor` + `external_id` ×3 dont un `aria-label`). **Baseline `89 → 0`** : `eslint-suppressions.json` supprimé, garde **pleinement stricte** (zéro site toléré). **Phase 2 livrée** (#86 `tauri-app`, #87 `tauri-shell`, + fix prep #88) : sink autonome dans app (escapers `escapeHtml`/`_escHtml` durcis pour `"` ; KWIC concordancier sécurisé par escape-then-highlight + DOM/`textContent`), sink réutilisé de prep dans shell (lint scopé au `src/` propre). Revue post-impl → 1 fix `_esc` (presets shell.ts). **S-03 CLOS : 3 gardes `no-unsanitized` strictes en CI (`Lint tauri-prep`/`-app`/`-shell`), aucune baseline nulle part.** Total ~9 vrais sinks data corrigés, 0 XSS exploitable. Réf. `docs/TICKET_S03_PHASE2_APP_SHELL.md`. |
| S-04 | 🟡 | P1-8 | 📝 documenté | `exporters/tei.py` est **write-only** (construit/sérialise du XML depuis des rows DB de confiance, **0 parse** → pas de surface XXE) ; `defusedxml` ne durcit que le *parsing* et n'expose pas l'API de build (`Element`/`SubElement` absents — vérifié). Commentaire ajouté au point d'import. Le parsing de XML non-fiable (importers, `tei_validate`, webdav) utilise déjà `defusedxml`. Pas de changement de code utile. |
| U-01 | 🟠 | P1-4 | ✅ corrigé | `sidecarClient.ts` dupliqué/divergent (app 1434 l. / prep 2984 l. ; 25 symboles communs, 17 divergents). **PR1a** : 9 types réconciliés byte-identiques — app adopte les canoniques prep (`Conn`, `DocumentRecord`, `ImportOptions`, `ImportResponse`, `TokenRecord`, `FamilyStats`, `FamilyRecord` + support `FamilyChildEntry`/`FamilyRatioWarning`), `tsc`/builds verts, zéro changement runtime. **PR1b** : sur les 10 fonctions divergentes, 6 étaient mortes côté app (conventions CRUD, `bulkSetUnitRole`, `setDocumentTextStart`, `listConventions`) → supprimées (+ type `UnitRole`) ; `importFile` (cosmétique) et `getActiveConn` (canonique = version app renvoyant `Conn`, requise par le shell ; celle de prep était morte → alignée) rendus byte-identiques. **Divergence : 25→2.** Reste 2 fonctions à divergence *environnementale* (`ensureRunning`/`shutdownSidecar` appellent `_notifyRustRegistry`→`invoke("register_sidecar")`, commande absente du backend app) → à unifier en PR2 via un cœur partagé **paramétré** (hook registry optionnel), puis extraction byte-identique → le shell ne bundlera plus qu'un chunk client. **PR2 gatée par les tests d'intégration connexion (T-05)** : les chemins *reuse* (portfile/in-memory/switch-DB), le chemin **spawn / cold-start** (`_spawnSidecar`), **et le transport** (`conn.get`/`post` : envelope, `SidecarError`, header token, **reconnect-once** — le comportement que l'app gagnera de prep), plus `shutdownSidecar`/`getActiveConn`, sont pinnés sur le client prep (canonique) → le merge superset ne régressera pas en silence, ni en reuse, ni au premier lancement, ni sur les erreurs HTTP/réseau. Reste hors filet (mineur) : cas d'échec spawn + fall-throughs (portfile autre-DB, unhealthy). **PR2a** : prep devient le **canonique superset** — la persistance du port (`agrafes.sidecar.port`, lue par la diagnostics du shell) qu'avait seule l'app est ajoutée à prep (helper `_persistSidecarPort`, aux **3 sites** de l'app : portfile-reuse, in-memory-reuse, spawn — fidèle au comportement app pour que PR2b soit un move pur), couverte par 3 tests. **PR2bc** (#72) : extraction du cœur connexion dans **`shared/sidecarCore.ts`** (neutre) — app + prep l'importent, leurs copies divergentes supprimées ; dans le shell, **un seul chunk `sidecarCore` + un seul `_conn` partagé** (vérifié au bundle : la logique cœur n'existe qu'une fois). **Divergence connexion 2→0.** Explorer-seul préservé (`shared/` auto-suffisant). **#73** : suite connexion repointée sur `shared/sidecarCore` en direct (découplée des clients). |
| U-02 | 🟠 | P2-11 | 🟦 partiel (point d'arrêt) | Écrans Prep monolithiques **décomposés à comportement-préservant**. Campagne « dégraissage » (3 patrons : template statique → `lib/*Template.ts` ; logique pure → `lib/*.ts` + test Vitest ; sous-panneau à état isolé → `components/*.ts` ; + dédup de helpers) — chaque incrément **byte-identique** (sed-transplant + diff), revue fresh-eyes, gates verts (tsc/vitest/eslint/shell). **Vague 1 (#139→#147)** + **vague 2 (#149→#157, 9 PRs, ~−279 l.)** : `CurationView` 3802→3087, `MetadataScreen` 3201→1979 (−38 %), `SegmentationView` 2671→1595 (−40 %), + ImportScreen/ShareDocs/ExportsScreen/ActionsScreen/AnnotationView/AlignPanel ; ~30 modules `lib/` testés extraits. **3 duplications réelles supprimées** (hubTree inter-écrans → `metadataTree` ; règle d'espacement FR `annotationSpacing` ; normalisation `workflowStatus` du chemin formulaire) ; **3 faux dedups évités** par la discipline byte-identité (`_trunc`/`truncateMid`, `statusLabel`/`workflowLabel`, troncature end/middle — drifts documentés en en-tête de module). **Point d'arrêt assumé** : tout l'extractible à comportement-préservant est fait. **Non extraits (volontaire)** : (a) tables de constantes (AnnotationView `UPOS_COLORS`/`SPACY_MODELS`/`UPOS_LIST` — data, pas de logique testable) ; (b) **cœurs interactifs = tickets dédiés** (éditeur bitext AlignPanel `_auditLinks`/`_renderActiveBitext` ; cluster raw-pane/conventions/manual-override CurationView ; form-lifecycle `_renderEditPanel` MetadataScreen ; `_renderSegSavedTable` SegmentationView) — chacun partage un moteur de mutation sur plusieurs tableaux hôtes, ne possède pas de DOM stable et demande ≥2 callbacks ⇒ conception data-ownership/seam hors périmètre U-02. **Finding sécurité dérivé** : drift `roleBadge` à 3 variantes (escaper `escHtml`/`escHtmlMeta` + sanitisation couleur `safeColor` vs brute) → ticket *hardening* séparé. |
| U-03 | 🟡 | P2-11 | 🟦 partiel | `tauri-app` : 14 tests Vitest (happy-dom) sur le **vrai** `features/search.ts` (`buildFtsQuery`/`isSimpleInput`), gatés en CI (PR #60). Reste : couverture large des 8 112 l. (concordancier, état, rendu). |
| U-04 | 🟡 | P2-12 | ⬜ ouvert | Signalisation de statut fragmentée entre READMEs |
| U-05 | 🟡 | — | ⬜ ouvert | i18n absent (chaînes FR en dur) — non bloquant |
| D-02 | 🟠 | P1-7 | ✅ corrigé | CHANGELOG scindé : courant **1951→557 l.** (`[Unreleased]` + semver [0.1.12]→[0.2.6]) ; l'historique antérieur (schéma « V… » + incréments [0.1.0]→[0.6.1]) déplacé dans **`docs/CHANGELOG_ARCHIVE.md`** (1406 l.) + pointeur. Intégrité vérifiée (82 sections = 35 + 47, 0 perdue). |
| D-03 | 🟠 | P2-10 | ⬜ ouvert | 267 artefacts trackés sans index (`audit/`, `artifacts/`) |
| D-05 | 🟡 | P2-12 | ⬜ ouvert | Aucun guide utilisateur final |
| D-06 | 🟡 | P1-7 | ✅ documenté | Section *Versioning* de `docs/SIDECAR_API_CONTRACT.md` réécrite : 3 champs distincts (`api_version`=`API_VERSION` impl runtime ; `version` envelope=`API_VERSION`, mais engine version sur `/health` ; `contract_version`=`CONTRACT_VERSION`, source de vérité du contrat). Exemples d'enveloppe corrigés (disaient `1.6.27`/`0.8.2`, le code émet `API_VERSION`). **Dérive signalée** : `API_VERSION` 1.6.23 < `CONTRACT_VERSION` 1.6.27 (bumps 1.6.24–1.6.27 oubliés) → réconciliation code = ticket séparé (touche l'enveloppe ⇒ contract-freeze). |
| N-04 | 🟡 | P2-14 | ✅ résolu (ADR-043) | Resegmentation écrasait `text_raw` + supprimait les liens. **Résolu via ADR-043** (colonne `text_source` immuable préservant l'original d'import), livré en 7 PR : **P0** `insert_units` centralisé (#111) ; **P1** migration 020 + peuplement à l'import (#112) ; **P2** resegment propage + undo (#113) ; **P2b** merge/split propagent + undo, migration 021 (#114) ; **P3a** lecture (`/units`, `/documents/preview`) + export `source_field=text_source`, contrat 1.6.30 (#115) ; **P3b** repli inline « voir l'original » + sélecteur export (#116) ; **P2c** propagation `apply_propagated` = **limite documentée** (re-segmentation par section + éditeur front interactif ⇒ pas de ligne parente nette ; `text_source` laissé NULL, sûr — fallback `text_raw`, réimport restaure ; #117). Suppression des `alignment_links` restée **hors périmètre** (l'alignement est refait). Cf. `docs/DECISIONS.md` ADR-043. |
| N-06 | 🟡 | P2-9 | ⬜ ouvert | `tauri-fixture` sans lockfiles ; CI en `npm install` |
| N-08 | 🟢 | — | ⬜ ouvert | Divers mineurs (sémantique reflag cible, lock télémétrie Windows, release-gate 3.12, etc.) |
| DEP-1\* | 🟢 | — | ✅ corrigé | `esbuild`/`vite`/`postcss` (devDeps, non embarqués) soldées par l'upgrade **vite 5→8** (PR #42). vite 8 (rolldown) embarque l'esbuild patché ; `npm audit` = 0 sur les 3 apps. Découvert en câblant N-01. |

\*Item dérivé (pas un finding d'audit), tracé pour ne pas perdre un « high » connu.

---

## Découvert hors audit — runtime (2026-06-20)

Trouvé en testant le shell desktop : ouvrir une DB en mauvais état (vieux WAL non
checkpointé, dossier **OneDrive** qui verrouille le fichier) figeait le sidecar et
laissait une **pile de `multicorpus.exe` orphelins** que la machinerie de cleanup
ne récupérait pas. Investigation au code → **4 causes racines** (toutes vérifiées),
puis durcissement **P0+P1 livré** ; **P2 (serveur threadé) différé** après une passe
adversariale (voir R-01b).

| ID | Sév | Statut | Constat (résumé) + preuve |
|----|-----|--------|---------------------------|
| R-01a | 🟠 | ✅ corrigé | **Mauvais header de token au shutdown Rust.** `_do_shutdown` envoyait `X-Sidecar-Token` (`main.rs:251`), le serveur attend `X-Agrafes-Token` (`sidecar.py:511`) et `/shutdown` est write-path protégé (`sidecar.py:669`). Les 2 chemins de fermeture (`beforeunload`→`shutdown_sidecar_cmd` `shell.ts:1616`, et `WindowEvent::CloseRequested` `main.rs:286`) y passaient → **401 systématique → fuite d'un sidecar à chaque fermeture/reload** (pas seulement quand hung). Dérive depuis `a7d2a79`. **Fix P0** : header → `X-Agrafes-Token`. Vérifié par smoke headless (mauvais header → 401 + vivant ; bon header → 200 + arrêt). |
| R-01b | 🟠 | ✅ corrigé | **Serveur mono-thread.** `HTTPServer` figeait `/health` **et** `/shutdown` sous un handler bloqué (recovery WAL OneDrive). Une 1ʳᵉ tentative de `ThreadingHTTPServer` naïf a été **revertée** (passe adversariale : ~lectures partagent la connexion **hors lock**, sûres seulement en mono-thread → race « recursive use of cursors »). **Fix (approche A du cadrage)** : `ThreadingHTTPServer` + `daemon_threads` ; lock global `Lock`→**`RLock`** ; **sérialisation au dispatch** dans `do_GET/POST/PUT` (carve-out lock-free de `/health`, `/openapi.json`, `/shutdown`) → un seul accès DB à la fois (pas de race), mais `/health`+`/shutdown` restent vifs sous handler bloqué. Cadrage : **`docs/TICKET_R01B_SIDECAR_THREADING.md`** ; `sidecar.py` net **+25 l**. Vérif : 3 tests de concurrence (`/health` vif sous lock tenu + réentrance RLock) + **195 tests in-process** verts (reads/POST/PUT/contrat). |
| R-01c | 🟠 | ✅ corrigé | **Spawn non-sérialisé + child non-tué sur échec.** `_spawnedChild` est une variable unique (`sidecarCore.ts:36`) ; sur `!healthy` le child était abandonné sans kill (`sidecarCore.ts:784`). L'écran Constituer tire 4 GET en parallèle → 4 `reconnect→re-spawn` concurrents (`sidecarCore.ts:541-552`) → course sur l'unique handle → **orphelins multiples (le storm)**. **Fix P1** : kill-on-failed-spawn (tous chemins post-spawn) + **single-flight** (une seule tentative de spawn concurrente par DB). 2 tests vitest. Vérifié en live (1 seul spawn à l'ouverture du corpus démo). |
| R-01d | 🟡 | ✅ corrigé | **Aucun reap niveau OS.** Le Rust ne tuait que par HTTP ; rien ne récupérait un process quand `/shutdown` échoue/timeout, alors que le portfile porte le `pid`. **Fix P1** : `register_sidecar` transmet le `pid` ; `_do_shutdown` **force-kill par PID** (`taskkill /F /T` / `kill -9`) en secours si le POST échoue/timeout. Couvre **spawn** (pid bootstrap → `/T` tue l'arbre) **et reuse** (pid worker lu du portfile → le bootstrap parent s'arrête en cascade) ; reap OS **vérifié headless** (kill du worker → cascade → 0 process). Vérifié en live (0 orphelin après fermeture d'une fenêtre avec sidecar actif). |

Déclencheur environnemental (R-01, hors périmètre code) : DB sous dossier cloud-sync
(**OneDrive**) + WAL périmé. **Garde P3 — ✅ implémentée** : le shell détecte à
l'ouverture si la base est sous un dossier synchronisé connu (OneDrive, Dropbox,
Google Drive, iCloud, macOS CloudStorage) via `isCloudSyncedPath` (heuristique pure,
testée) et affiche un **toast d'avertissement** non bloquant dans `_switchDb`
(recommande de copier la base hors du dossier synchronisé).

**Dette adjacente — résorbée par R-01b.** La cause de R-01b — des handlers de lecture
touchaient la connexion SQLite partagée **hors `self._lock()`** — existait déjà via le
`JobManager` (écritures sur threads worker concurrentes des lectures de requêtes). Le
fix R-01b met **tout le dispatch DB sous le lock** (RLock au niveau `do_GET/POST/PUT`),
donc les 132 `self._conn()` sont désormais sérialisés — lecture-vs-job comprise.

---

## Audits antérieurs — échantillon vérifié (pas un ré-audit exhaustif)

Statuts repris du §7 « Suivi des audits précédents » de `AUDIT_2026-06-12.md`
(échantillon contre-vérifié en passe 2). Pour le détail finding-par-finding des
33 findings de 2026-04-19, voir le CHANGELOG (sens commit→finding) et le fichier
d'audit correspondant.

| Finding | Audit | Statut | Preuve / commit |
|---------|-------|--------|-----------------|
| B7 — XSS `innerHTML` ActionsScreen | 2026-04-19 | ✅ corrigé | `td.textContent` (`ActionsScreen.ts`), commit `84e92be`, CHANGELOG « C-08→C-13 » |
| B6 — rollback import | 2026-04-19 | ✅ corrigé | ADR-040, try/except/rollback dans les importers |
| C-01 (AGRAFES-3) — lecture fichier arbitraire côté Rust | 2026-04-19 | ✅ corrigé | `read_sidecar_portfile` whitelisté, commit `0c4dc78` |
| Bloc C-01→C-13 / M-01→M-15 / F-01→F-05 / D-09 (33 findings) | 2026-04-19 | 🔎 voir CHANGELOG | « 33 findings résolus (v0.1.31) » (ROADMAP) — statut individuel à tracer ici au besoin |
| M-01 — zéro test frontend | 2026-03-26 | 🟦 partiel | Vitest Prep (20 fichiers, 394 tests) + `tauri-app` (14) + `tauri-shell` (28), **tous gatés en CI** (PR #59→#63) ; reste la couverture large de `tauri-app` (→ U-03) |
| W-01 / W-02 — monolithes | 2026-03-26 | 🟦 partiel | Extractions côté Prep faites ; `sidecar.py` + écrans géants demeurent (→ A-01, U-02) |
| F-03 — épinglage GitHub Actions par SHA | 2026-04-19 | 🟦 partiel | **Option B livrée** : 7 occurrences **tierces** épinglées au SHA (`dtolnay/rust-toolchain` ×3 + `with: toolchain: stable` ; `softprops/action-gh-release` ×2 ; `Swatinem/rust-cache` ×2). Reste **Option A** : les 6 `actions/*` first-party (77 occ.). Cadrage + SHA : `docs/TICKET_F03_SHA_PINNING.md`. Dependabot couvre déjà `github-actions`. |
