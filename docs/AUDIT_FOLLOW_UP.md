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
| A-03 | 🟠 | P0-1 | ⬜ ouvert | 66 blocs de validation manuelle (pas de validateur de schéma) |
| A-04 | 🟡 | P2-13 | ⬜ ouvert | Attributs dynamiques non typés sur `HTTPServer` |
| Q-02 | 🟠 | P0-1 | 🟦 partiel | Fonctions géantes : `_handle_import` 242 l → adapter ~15 l (A-01 #46) ; **`_build_hits`/`_build_hits_regex` dédupliqués** via `_build_hits_core` partagé (paramétré matchers + `coerce_text_norm` + `log_hits` ; byte-identique, logs inclus) — le chemin regex, jamais testé, gagne une couverture directe. Reste : `_handle_query` 221 l (délégateur, laissé avec les autres). |
| Q-04 | 🟡 | P2-13 | ⬜ ouvert | Typage hétérogène ; pas de TypedDict pour les shapes de contrat |
| Q-05 | 🟡 | — | ⬜ ouvert | Matcher CQL : pas de cap global documenté (gardes présentes) |
| T-03 | 🟡 | P1-6 | ⬜ ouvert | 11 fichiers de tests versionnés à isoler sous `tests/contracts/` |
| T-04 | 🟡 | — | ⬜ ouvert | Fragilités timing (23 `time.sleep`) ; 8 tests exigent `NO_PROXY` en local |
| T-05 | 🟠 | — | 🟦 partiel | E2E Tauri *driver* (Playwright/WebDriver) toujours absent. Couverture d'intégration accumulée sans driver : render-smoke DOM happy-dom côté shell (`styleRegistry`/`diagnostics`/`telemetry`, PR #61→#63) ; **tests d'intégration de la couche connexion** `sidecarClient` (prep) — `ensureRunning` reuse (portfile + in-memory + switch-DB) **et chemin spawn / cold-start** (`_spawnSidecar` via fake `Command` : JSON de démarrage → connexion + token + registry, kill du child précédent), `shutdownSidecar`, `getActiveConn`/`resetConnection`, **le transport** (`conn.get`/`post` : envelope JSON, mapping `SidecarError` message+statut, header `X-Agrafes-Token`, **reconnect-once** sur erreur réseau), helpers URL — via mocks des plugins Tauri (22 tests), qui **gatent la réconciliation connexion d'U-01 (PR2) sur reuse, spawn ET transport**. Reste : vrai driver E2E + cas d'échec spawn / fall-throughs (portfile autre-DB, unhealthy). |
| S-01 | 🟡 | P1-8 | ⬜ ouvert | Pas de validation `Host`/`Origin` (DNS rebinding théorique, lecture seule) |
| S-02 | 🟡 | P1-8 | ⬜ ouvert | Race POSIX sur le portfile (`O_EXCL`/umask absents) |
| S-03 | 🟡 | P0-2 | 🟦 partiel | Sink type-safe `setHtml`/`safeHtml\`\`` + ESLint no-unsanitized (prep) ; 3 fichiers migrés, `f858c78`. Aucun vrai XSS trouvé (escapers tous vérifiés). **Reste** : 92 sites des 4 écrans géants + app/shell + job CI bloquant. Décision de reprise en attente (grind complet vs suppressions pour les géants). |
| S-04 | 🟡 | P1-8 | ⬜ ouvert | `exporters/tei.py` importe `xml.etree` non défusé (risque nul aujourd'hui) |
| U-01 | 🟠 | P1-4 | ✅ corrigé | `sidecarClient.ts` dupliqué/divergent (app 1434 l. / prep 2984 l. ; 25 symboles communs, 17 divergents). **PR1a** : 9 types réconciliés byte-identiques — app adopte les canoniques prep (`Conn`, `DocumentRecord`, `ImportOptions`, `ImportResponse`, `TokenRecord`, `FamilyStats`, `FamilyRecord` + support `FamilyChildEntry`/`FamilyRatioWarning`), `tsc`/builds verts, zéro changement runtime. **PR1b** : sur les 10 fonctions divergentes, 6 étaient mortes côté app (conventions CRUD, `bulkSetUnitRole`, `setDocumentTextStart`, `listConventions`) → supprimées (+ type `UnitRole`) ; `importFile` (cosmétique) et `getActiveConn` (canonique = version app renvoyant `Conn`, requise par le shell ; celle de prep était morte → alignée) rendus byte-identiques. **Divergence : 25→2.** Reste 2 fonctions à divergence *environnementale* (`ensureRunning`/`shutdownSidecar` appellent `_notifyRustRegistry`→`invoke("register_sidecar")`, commande absente du backend app) → à unifier en PR2 via un cœur partagé **paramétré** (hook registry optionnel), puis extraction byte-identique → le shell ne bundlera plus qu'un chunk client. **PR2 gatée par les tests d'intégration connexion (T-05)** : les chemins *reuse* (portfile/in-memory/switch-DB), le chemin **spawn / cold-start** (`_spawnSidecar`), **et le transport** (`conn.get`/`post` : envelope, `SidecarError`, header token, **reconnect-once** — le comportement que l'app gagnera de prep), plus `shutdownSidecar`/`getActiveConn`, sont pinnés sur le client prep (canonique) → le merge superset ne régressera pas en silence, ni en reuse, ni au premier lancement, ni sur les erreurs HTTP/réseau. Reste hors filet (mineur) : cas d'échec spawn + fall-throughs (portfile autre-DB, unhealthy). **PR2a** : prep devient le **canonique superset** — la persistance du port (`agrafes.sidecar.port`, lue par la diagnostics du shell) qu'avait seule l'app est ajoutée à prep (helper `_persistSidecarPort`, aux **3 sites** de l'app : portfile-reuse, in-memory-reuse, spawn — fidèle au comportement app pour que PR2b soit un move pur), couverte par 3 tests. **PR2bc** (#72) : extraction du cœur connexion dans **`shared/sidecarCore.ts`** (neutre) — app + prep l'importent, leurs copies divergentes supprimées ; dans le shell, **un seul chunk `sidecarCore` + un seul `_conn` partagé** (vérifié au bundle : la logique cœur n'existe qu'une fois). **Divergence connexion 2→0.** Explorer-seul préservé (`shared/` auto-suffisant). **#73** : suite connexion repointée sur `shared/sidecarCore` en direct (découplée des clients). |
| U-02 | 🟠 | P2-11 | ⬜ ouvert | Écrans Prep monolithiques (Curation ~3 800 l., Metadata ~3 200 l.) |
| U-03 | 🟡 | P2-11 | 🟦 partiel | `tauri-app` : 14 tests Vitest (happy-dom) sur le **vrai** `features/search.ts` (`buildFtsQuery`/`isSimpleInput`), gatés en CI (PR #60). Reste : couverture large des 8 112 l. (concordancier, état, rendu). |
| U-04 | 🟡 | P2-12 | ⬜ ouvert | Signalisation de statut fragmentée entre READMEs |
| U-05 | 🟡 | — | ⬜ ouvert | i18n absent (chaînes FR en dur) — non bloquant |
| D-02 | 🟠 | P1-7 | ⬜ ouvert | CHANGELOG 1 942 lignes sans archivage |
| D-03 | 🟠 | P2-10 | ⬜ ouvert | 267 artefacts trackés sans index (`audit/`, `artifacts/`) |
| D-05 | 🟡 | P2-12 | ⬜ ouvert | Aucun guide utilisateur final |
| D-06 | 🟡 | P1-7 | ⬜ ouvert | `API_VERSION` (1.6.23) vs `CONTRACT_VERSION` (1.6.27) — distinction non documentée |
| N-04 | 🟡 | P2-14 | 🔵 connu/assumé | Resegmentation écrase `text_raw` + supprime les liens (dette HANDOFF) ; à arbitrer en ADR |
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
(**OneDrive**) + WAL périmé. Garde P3 envisagée (avertir si DB sous cloud-sync) — non
implémentée pour l'instant.

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
| F-03 — épinglage GitHub Actions par SHA | 2026-04-19 | ⬜ ouvert | Non traité (F-04 permissions ✅) — cf. ROADMAP « Next » |
