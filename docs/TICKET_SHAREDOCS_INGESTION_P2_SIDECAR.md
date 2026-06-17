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
