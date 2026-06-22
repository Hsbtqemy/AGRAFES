# Mission : Connecteur d'ingestion ShareDocs — Phase 2 (endpoints sidecar)

Tu interviens sur le repo AGRAFES (branche `development`).

**Prérequis : la Phase 1 ([TICKET_SHAREDOCS_INGESTION_P1_CLI.md](TICKET_SHAREDOCS_INGESTION_P1_CLI.md))
est mergée** — `remote/webdav.py`, `importers/dispatch.py` et la sous-commande
`import-remote` existent. Lis d'abord
[docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) (§5 phase 2,
§6 sécurité) puis [HANDOFF_PREP.md](../HANDOFF_PREP.md).

# Contexte

Exposer l'ingestion ShareDocs au sidecar HTTP pour que l'UI (phase 3) puisse
parcourir un dépôt et lancer un import batch. Le sidecar fait déjà du HTTP stdlib
et possède une mécanique de progression d'op longue : `JobManager` +
`_track_stage("import")` autour du `POST /import`
([sidecar.py:738-740](../src/multicorpus_engine/sidecar.py#L738)). On la réutilise.

# Périmètre

Fichiers **modifiés** :
- `src/multicorpus_engine/sidecar.py` — 2 routes + handlers.
- `src/multicorpus_engine/sidecar_contract.py` — schémas requête/réponse.
- `docs/SIDECAR_API_CONTRACT.md`, `docs/openapi.json` (régénéré), `CHANGELOG.md`.
- `tests/` — tests d'intégration sidecar.

**Interdit** : frontend (phase 3), nouvelle dépendance, migration DB, modifier la
logique métier de Phase 1 (réutiliser `propfind`/`download`/`dispatch_import` tels
quels ; si un ajustement de signature est nécessaire, le faire minimal et le noter).

# Décisions de design (figées)

1. **`POST /webdav/list`** — lecture seule réseau. Body :
   `{url, auth: {mode, user?, password?, token?}}`. Renvoie
   `{entries: [{name, href, is_dir, size, modified, content_type}]}`.
   **Hors write-lock** (ne bloque pas les écritures db). Réponse rapide, pas de
   `JobManager` nécessaire.
2. **`POST /import-remote`** — opération d'écriture. Body :
   `{url, mode, language?, include?, auth:{...}, doc_role?, resource_type?, max_file_mb?}`.
   - Sous **`_track_stage("import-remote")` + write-lock** (même protection que
     `/import`).
   - Progression **par fichier** via `JobManager` (calquer exactement la façon dont
     `/import` émet ses stages — lire `sidecar_jobs.py` et `_handle_import`).
   - Renvoie le **même report batch** que la CLI de Phase 1.
3. Ajouter `"/webdav/list"` et `"/import-remote"` à la liste des routes POST
   autorisées ([sidecar.py:671](../src/multicorpus_engine/sidecar.py#L671)).
4. **Credentials** : reçus dans le body sur `127.0.0.1` uniquement, gardés **en
   mémoire** le temps de la requête. **Jamais** écrits en db, `runs.params` (qui ne
   contient que `url`+`mode`), logs de requête, ni télémétrie. Exclure les champs
   `auth.*` de tout body loggé.
5. **Erreurs** : auth/réseau global (PROPFIND en échec) → `400`/`502` avec message
   clair ; erreurs par fichier → dans le report, `200` global.

# Livrables

## L1 — `POST /webdav/list`
Handler `_handle_webdav_list(body)` : valide `url` + `auth`, appelle
`remote.webdav.propfind`, mappe les `RemoteEntry` en JSON. Erreurs WebDAV →
codes HTTP appropriés (`401→401`, `404→404`, réseau→`502`).

## L2 — `POST /import-remote`
Handler `_handle_import_remote(body)` : réutilise l'orchestration batch de Phase 1
(extraire cette orchestration dans une fonction partagée si elle est encore inline
dans `cmd_import_remote` — sinon l'importer telle quelle). Émettre la progression
par fichier via `JobManager`. Retourner le report batch.

## L3 — Contrat & OpenAPI
- `sidecar_contract.py` : schémas des 2 requêtes + réponses. `auth` est un objet ;
  documenter que les creds ne sont jamais persistés.
- `docs/SIDECAR_API_CONTRACT.md` : documenter les 2 routes.
- `docs/openapi.json` : régénérer (`python scripts/export_openapi.py`).

## L4 — Tests
- `/webdav/list` : WebDAV mocké → entries JSON ; `401` → `401` ; réseau → `502`.
- `/import-remote` : WebDAV mocké + db temp → report batch correct ; vérifier que
  `runs.params` **ne contient aucun credential** ; vérifier qu'aucun log ne fuit le
  header `Authorization`.
- Concurrence : `/import-remote` prend bien le write-lock (pas de course avec un
  `/import` simultané).

## L5 — Doc
`CHANGELOG.md` `[Unreleased] / Added` ; cocher Phase 2 dans
[docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md).

# Conventions du repo
- `feat(prep): sidecar /webdav/list endpoint (PROPFIND browse)`
- `feat(prep): sidecar /import-remote endpoint with JobManager progress`
- `docs(prep): contract + openapi for ShareDocs ingestion endpoints`
- `test(prep): sidecar ShareDocs endpoints + credential non-persistence`
- Pas de migration DB, pas de bump de version.

# Ordre d'exécution
1. Lire `sidecar_jobs.py` + `_handle_import` pour la forme exacte des events de
   progression. 2. L1 (`/webdav/list`). 3. L2 (`/import-remote`) + progression.
   4. L3 contrat/openapi. 5. L4 tests. 6. L5 doc.

# Ce qu'il NE FAUT PAS faire
- Pas de frontend (phase 3). Pas de nouvelle dépendance.
- Aucun credential persisté nulle part ; `auth.*` hors des logs.
- Pas de PUT/upload, pas de partage de db.
- Ne pas mettre `/webdav/list` derrière le write-lock (c'est de la lecture réseau).

# Si tu butes
- Si la progression `JobManager` par fichier est lourde à câbler, émettre au minimum
  un stage par fichier (début/fin) plutôt que rien, et `// NOTE:` un raffinement.
- Si l'orchestration batch de Phase 1 n'est pas factorisable proprement, l'extraire
  dans `remote/ingest.py` et faire pointer CLI + sidecar dessus.

# Livrable attendu
3-4 commits + résumé : ce qui marche, fuites de creds vérifiées absentes, `// NOTE:`,
recommandation pour la Phase 3 (UI).

---

# Addendum 2026-06-22 — décision async + recalage post-R-01b / A-03B

> **Pourquoi cet addendum.** Le corps ci-dessus a été figé le 2026-06-12. Depuis,
> **R-01b** (2026-06-20) a changé le *threading* du sidecar — `do_POST` acquiert
> désormais un **RLock global** pour tout le dispatch DB sauf `/shutdown`
> ([sidecar.py:766](../src/multicorpus_engine/sidecar.py#L766)) — et **A-03/A-03B**
> ont introduit le valideur déclaratif + le générateur de contrat. Trois hypothèses
> du corps ne tiennent plus telles quelles. **Décisions tranchées (priment sur le
> corps en cas de conflit) :** base de branche = **`dev`** (pas `development`).

## D1 — `/import-remote` est **asynchrone** (job `JobManager`), pas un POST synchrone

Le corps dit « sous `_track_stage("import-remote")` + write-lock … progression par
fichier via `JobManager` (calquer `/import`) ». **Problème :** le `/import`
synchrone émet *un seul* `stage_completed` via `_track_stage` (télémétrie), **pas**
du `JobManager` ; et tenir le **lock global** (R-01b) pendant tout un batch
(N téléchargements réseau + imports = minutes) **gèle** `/query`, `/index`, etc.

**Décision :** `/import-remote` **enqueue un job `JobManager`** et renvoie
`{job_id}` ; l'UI (P3) poll `/jobs/<id>` pour la progression par fichier + le report
final. Pas de gel du sidecar, progression *live* native, P3 réutilise le polling de
l'import async classique. `_track_stage` n'est **pas** le bon mécanisme ici.

## D2 — Creds : ne **jamais** les mettre dans `params` de job (fuite par le statut)

[`JobRecord.to_dict()`](../src/multicorpus_engine/sidecar_jobs.py#L36) **expose
`params` verbatim**, et l'UI lit `/jobs/<id>` → `to_dict()`. Mettre `auth` dans les
params le **renverrait à chaque poll de statut**. Donc :

- `submit("import-remote", params={url, mode, language, include, doc_role,
  resource_type, max_file_mb}, runner=…)` — **`params` SANS `auth`** (sûr à exposer,
  même règle que `runs.params` = url+mode).
- L'`auth_header` (via `webdav.build_auth_header`) est construit dans le handler et
  **capturé dans la closure `runner`** — mémoire seule, jamais persisté ni exposé.
- ⇒ **handler dédié `POST /import-remote`** (qui sépare `auth`→closure de
  `params`→exposés), **PAS** le générique `POST /jobs/enqueue {kind, params}` (qui
  passerait `auth` dans `params` → fuite). Le test L4 doit asserter que
  `/jobs/<id>` ne contient **jamais** `auth`, en plus de `runs.params`.

## D3 — Granularité du lock dans le runner : **DB sous lock, download hors lock, par fichier**

Le runner tourne sur un thread worker concurrent des autres handlers → il doit
sérialiser les écritures DB sous le RLock R-01b. Mais tenir le lock pendant les
**téléchargements** réintroduit le gel de D1. **Décision :** par fichier, le
*download* reste **hors** lock et seule la **section DB** (dédup `SELECT` + import +
`UPDATE … source_path`) passe **sous** lock.

→ `remote/ingest.py:ingest_remote_folder()` gagne **deux paramètres optionnels
additifs** (le corps autorise un ajustement de signature minimal, noté) :
- `progress: Callable[[dict], None] | None` — appelé par fichier
  (`{index, total, name, status}`) ; le runner le branche sur le `progress_cb` du
  `JobManager`.
- `critical_section: ContextManager | None` — CM enveloppant **uniquement** les ops
  DB de `_process_one` ; le sidecar fournit `self._lock()`, la CLI laisse `None`
  (no-op). Si la séparation download/DB dans `_process_one` est trop intriquée pour
  un CM propre, fallback acceptable : lock par fichier autour de tout `_process_one`
  (tient le lock pendant le download de CE fichier seulement, pas tout le batch) +
  `// NOTE:` le raffinement.

## D4 — `/webdav/list` : **carve-out lock-free explicite** (pas juste « hors `_write_paths` »)

Post-R-01b, `do_POST` prend le RLock pour **tout sauf `/shutdown`** avant de
dispatcher. `/webdav/list` ne touche **pas** la DB (PROPFIND réseau → JSON) → il doit
être branché **avant** `self._lock().acquire()`, en cas lock-free dédié **comme
`/shutdown`** ([sidecar.py:763-766](../src/multicorpus_engine/sidecar.py#L763)). Le
mettre simplement « pas dans `_write_paths` » ne suffit plus (il prendrait quand même
le lock). Pas de token (lecture, cohérent avec `/query`).

## D5 — Contrat : schémas **écrits à la main** (hors générateur A-03B)

A-03B dérive un `requestBody` d'un schéma `Field`, mais **ne gère pas les objets
imbriqués** ; `auth: {mode, user?, password?, token?}` en est un. Donc les schémas
des 2 routes sont **écrits à la main** dans `sidecar_contract.py` (cohérent avec le
reste du contrat), `additionalProperties` au choix d'auteur. Régénérer
`openapi.json` **+ le snapshot** `tests/snapshots/openapi_paths.json` (2 paths
ajoutés — l'ajout fait échouer le contract-freeze jusqu'à regen+commit, c'est
nominal). Documenter dans le schéma `auth` que les creds ne sont **jamais
persistés**.

## Récap des deltas au périmètre du corps

| Point du corps | Statut après addendum |
|---|---|
| `/import-remote` synchrone sous write-lock | **Remplacé** par job async `JobManager` (D1) |
| « progression via `JobManager` en calquant `/import` » | Calquer le chemin **async** `/jobs/enqueue`, pas le `/import` synchrone (D1) |
| Ajouter `/import-remote` à `_write_paths` | **Tient** (token requis) ; le handler enqueue + renvoie `{job_id}` |
| Ajouter `/webdav/list` aux routes POST | **Préciser** : carve-out lock-free avant l'acquire du lock (D4) |
| `auth` dans le body | **Préciser** : jamais dans `params` de job → closure (D2) |
| Tests creds (`runs.params`) | **Étendre** : asserter aussi `/jobs/<id>` sans `auth` (D2) |
| Reste (filtre/dédup/provenance/report) | **Inchangé** — déjà dans `remote/ingest.py` |

## Ordre d'exécution révisé
1. Lire `sidecar_jobs.py` (`submit`/`_run_job`/`progress_cb`) + un kind de job async
   existant (ex. import) pour la forme du runner. 2. `remote/ingest.py` : +`progress`
   +`critical_section` (additifs, defaults no-op ; tests CLI verts inchangés).
   3. L1 `/webdav/list` (carve-out lock-free, D4). 4. L2 `/import-remote` (handler
   dédié → `submit` job, params sans auth, runner-closure, D2+D3). 5. L3
   contrat/openapi écrits main + regen freeze (D5). 6. L4 tests (dont non-fuite
   `/jobs/<id>` + per-file lock). 7. L5 doc + cocher Phase 2 dans le DESIGN.
