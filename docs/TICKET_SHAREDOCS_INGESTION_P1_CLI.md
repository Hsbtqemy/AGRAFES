# Mission : Connecteur d'ingestion ShareDocs — Phase 1 (refactor dispatch + CLI `import-remote`)

Tu interviens sur le repo AGRAFES (branche `development`).

Lis d'abord **[docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md)**
(décisions cadres, toutes figées) puis [HANDOFF_PREP.md](../HANDOFF_PREP.md). Ce
ticket implémente la **Phase 1** du design : la couche WebDAV stdlib + la
sous-commande CLI batch. **Pas de sidecar, pas d'UI** (phases 2 et 3 séparées).

# Contexte

AGRAFES doit pouvoir tirer des documents source d'un dépôt **ShareDocs Huma-Num**
(WebDAV : Nextcloud / SabreDAV) pour alimenter la db locale via le pipeline
d'import. Aujourd'hui, `cmd_import` ([cli.py:113](../src/multicorpus_engine/cli.py#L113))
ne lit qu'**un fichier local unique** (`--path`) et dispatche par `--mode` vers
l'importer correspondant ([cli.py:147-237](../src/multicorpus_engine/cli.py#L147)).

La db reste **strictement locale** : on ne partage rien par WebDAV, on ne fait
qu'**ingérer en entrée**.

# Périmètre

Fichiers **créés** :
- `src/multicorpus_engine/remote/__init__.py`
- `src/multicorpus_engine/remote/webdav.py` — client WebDAV stdlib (PROPFIND + GET).
- `src/multicorpus_engine/importers/dispatch.py` — helper de dispatch extrait.
- `tests/test_webdav_client.py`, `tests/test_import_remote_batch.py`.

Fichiers **modifiés** :
- `src/multicorpus_engine/cli.py` — `cmd_import` réécrit pour appeler le helper ;
  nouvelle sous-commande `import-remote`.
- `CHANGELOG.md`, [docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md)
  (cocher Phase 1).

**Interdit en Phase 1** : toucher au sidecar, au frontend, ajouter une dépendance
(`webdav4`/`httpx` proscrits), migrer la db.

# Décisions de design (figées — ne pas re-débattre dans le code)

1. **stdlib uniquement.** WebDAV via `urllib.request` (`Request(method="PROPFIND")`,
   `urlopen`) ; parsing du `207 Multi-Status` via **`defusedxml.ElementTree`**
   (déjà dépendance, protège XXE). Aucune lib tierce.
2. **PROPFIND `Depth: "1"` strict** — jamais `infinity`. La première entrée du
   listing est le dossier lui-même → la sauter (`href == chemin demandé`). Les
   `href` sont percent-encodés et souvent absolus côté serveur
   (`/remote.php/dav/files/...`) → résoudre contre `scheme://host` de l'URL de base.
3. **GET en streaming** (chunks 4 MiB) vers un fichier temp. Intégrité = **taille
   seule** (Content-Length vs octets écrits), pas d'ETag. Garde `--max-file-mb`
   (défaut **200**) : au-delà → `skipped-oversize`.
4. **Auth** : `basic` / `bearer` / `anonymous`. **TLS toujours vérifié**, aucun
   opt-out. Résolution (`--auth auto`) :
   `AGRAFES_WEBDAV_TOKEN` → bearer ; sinon `AGRAFES_WEBDAV_USER`+`AGRAFES_WEBDAV_PASSWORD`
   → basic ; sinon anonymous. `--auth {basic,bearer,anonymous}` force le mode.
5. **Credentials jamais persistés** : ni db, ni `runs.params`, ni logs de run, ni
   stdout. `runs.params` ne contient que `url` + `mode`. Exclure tout header
   `Authorization` des logs.
6. **Flux batch** : PROPFIND dossier → filtrer fichiers par extension dérivée du
   `--mode` (`docx_* → *.docx`, `odt_* → *.odt`, `txt_* → *.txt`, `tei → *.xml`,
   `conllu → *.conllu`), surchargeable via `--include "<glob>"`. Non-correspondants
   → `skipped-filtered`.
7. **Dédup** : télécharger → hasher (même helper `_compute_file_hash` que les
   importers) → si un `documents.source_hash` identique existe déjà →
   `skipped-duplicate`, **sans créer de run**. (Aligné ADR-011.)
8. **Un run par fichier** (modèle 1-fichier-1-run inchangé). Provenance : après
   import, `UPDATE documents SET source_path = <url_distante> WHERE doc_id = <renvoyé>` ;
   `source_hash` (octets) inchangé. Ne **pas** modifier la signature des importers.
9. **Robustesse** : une erreur (download ou import) sur un fichier est reportée et
   **n'interrompt pas** le batch.
10. **Temp** : `tempfile.mkdtemp()` par batch, supprimé en `finally`. **Noms de
    fichiers temp générés** — jamais construits depuis le nom serveur (garde
    traversée de chemin).

## Cas à gérer

| Cas | Comportement |
|---|---|
| URL pointe sur un fichier, pas un dossier | Erreur claire « --url doit pointer un dossier WebDAV ». |
| `401` au PROPFIND/GET | Message d'auth explicite (pas de stacktrace). |
| `404` (dossier introuvable) | Message clair. |
| Timeout / `URLError` réseau | Message réseau, code de sortie non-zéro. |
| Dossier vide ou 0 fichier après filtre | Report avec totaux à 0, message « aucun fichier correspondant à <glob/mode> ». |
| Fichier > `--max-file-mb` | `skipped-oversize`, pas de download complet (vérifier Content-Length au PROPFIND ; sinon couper le stream). |
| `getcontentlength` absent dans le PROPFIND | Tolérer (taille inconnue) ; skip le contrôle d'intégrité taille pour ce fichier, le noter. |

# Livrables

## L1 — Helper de dispatch (refactor préalable)

Créer `importers/dispatch.py` :
```python
def dispatch_import(conn, *, mode, path, language, title=None,
                    doc_role="standalone", resource_type=None,
                    tei_unit="p", run_id, run_logger):
    """Route vers l'importer selon `mode`. Retourne le Report de l'importer.
    Lève ValueError sur mode inconnu."""
```
- Déplacer le if/elif `mode → importer` de [cli.py:147-237](../src/multicorpus_engine/cli.py#L147)
  dans ce helper, **à l'identique** (imports paresseux conservés).
- Réécrire `cmd_import` pour : créer le run, appeler `dispatch_import(...)`,
  `update_run_stats`, `_ok(...)`. Comportement CLI `import` **strictement
  inchangé** (vérifier via la suite de tests existante).
- **doc_id** : `import-remote` (L3) a besoin du `doc_id` créé. Vérifier si le
  Report l'expose déjà ; sinon, l'ajouter comme champ du report (une fois, propre)
  ou le faire retourner par `dispatch_import`. Ne pas le récupérer par un
  `SELECT MAX(doc_id)` fragile.

## L2 — Client WebDAV (`remote/webdav.py`)

API minimale, fonctionnelle, sans état lourd :
```python
def build_auth_header(mode, *, user=None, password=None, token=None) -> dict
def propfind(url, *, auth_header, timeout=30) -> list[RemoteEntry]
def download(url, dest_path, *, auth_header, max_bytes, timeout=30) -> int  # octets écrits
```
- `RemoteEntry` (dataclass) : `name`, `href` (URL absolue résolue), `is_dir`,
  `size`, `modified`, `content_type`.
- `propfind` envoie `Depth: 1` + corps XML minimal, parse via `defusedxml`,
  saute l'entrée self, résout les href.
- Mapping d'erreurs en exceptions maison claires
  (`WebdavAuthError`, `WebdavNotFound`, `WebdavError`).

## L3 — Sous-commande CLI `import-remote`

```
multicorpus import-remote --db <db> --url <folder-url> --mode <mode>
    [--language fr] [--include "*.docx"] [--auth auto]
    [--doc-role standalone] [--resource-type ...] [--max-file-mb 200]
```
- Orchestration : résoudre auth (env + `--auth`) → `propfind` → filtrer → pour
  chaque fichier : `download` → hash → dédup → `dispatch_import` (1 run) →
  UPDATE `source_path`. Continue sur erreur. Temp nettoyé en `finally`.
- **Report batch JSON** (style `_ok`) : par fichier `{status, source_url, doc_id,
  run_id, source_hash, ...compteurs, error?}` avec `status` ∈ {`imported`,
  `skipped-duplicate`, `skipped-filtered`, `skipped-oversize`, `error`} + un
  agrégat `{total, imported, skipped_*, errors}`.
- Code de sortie non-zéro si au moins une erreur **bloquante** (auth/réseau global) ;
  les erreurs par fichier ne font pas échouer le batch entier.

## L4 — Tests (pytest)

`tests/test_webdav_client.py` — `urlopen` mocké :
- Échantillon `207` multistatus (1 dossier-self + 2 fichiers + 1 sous-dossier) →
  `propfind` renvoie les 2 fichiers + 1 dossier, self exclu, href résolus absolus.
- Construction header auth basic/bearer/anonymous.
- Mapping `401` → `WebdavAuthError`, `404` → `WebdavNotFound`, timeout → `WebdavError`.
- `download` respecte `max_bytes` (oversize coupé).

`tests/test_import_remote_batch.py` — WebDAV mocké, vraie db temp :
- Dossier mixte (docx/odt/txt/xml + un `.pdf` parasite) avec `--mode docx_numbered_lines`
  → seuls les `.docx` importés, `.pdf` → `skipped-filtered`.
- Re-run identique → tout `skipped-duplicate`, aucun nouveau run.
- Un download qui lève → ce fichier `error`, les autres importés.
- Provenance : `documents.source_path == url distante`, `source_hash` = hash octets.
- Fichier oversize → `skipped-oversize`.

`tests/` existants d'import → doivent rester **verts** (régression du refactor L1).

## L5 — Documentation

- `CHANGELOG.md` — entrée `[Unreleased] / Added` : « `import-remote` : ingestion
  batch depuis un dépôt WebDAV (ShareDocs Huma-Num) ».
- [docs/DESIGN_sharedocs_ingestion.md](DESIGN_sharedocs_ingestion.md) — cocher
  « Phase 1 » comme livrée, avec lien commit.

# Conventions du repo

- Commits Conventional par livrable :
  - `refactor(prep): extract mode→importer dispatch into dispatch_import`
  - `feat(prep): stdlib WebDAV client (PROPFIND + GET) for remote ingestion`
  - `feat(prep): import-remote CLI — batch ingest from a WebDAV folder`
  - `test(prep): WebDAV client + import-remote batch edge cases`
  - `docs(prep): document import-remote (ShareDocs ingestion phase 1)`
- Pas de migration DB. Pas de bump de version.

# Ordre d'exécution

1. L1 (refactor dispatch) + faire passer la suite d'import existante (régression).
2. L2 (client WebDAV) + ses tests.
3. L3 (`import-remote`) + L4 tests batch.
4. L5 doc.

# Ce qu'il NE FAUT PAS faire

- Pas de sidecar, pas de frontend (phases 2-3).
- Pas de `webdav4`/`httpx` ni aucune nouvelle dépendance.
- Pas d'opt-out TLS, pas de `Depth: infinity`.
- Aucun credential en db / `runs.params` / logs / stdout.
- Pas de PUT/upload, pas de partage de db (hors périmètre, cf. design §1).
- Pas de modification des signatures d'importers (provenance via UPDATE post-import).

# Si tu butes

- Si `urllib` rechigne sur la méthode `PROPFIND`, passer `method="PROPFIND"` à
  `Request` (supporté Python ≥3.3) ; ne pas retomber sur une lib tierce.
- Si un serveur renvoie des href relatifs, résoudre via `urllib.parse.urljoin`
  contre l'URL de base.
- Si une décision ambiguë bloque, choisir la **moins invasive** et `// NOTE:`.

# Livrable attendu

4-5 commits + court résumé final : ce qui marche (scénarios testés), ce qui n'a pu
être fait et pourquoi, les `// NOTE:` laissés, bugs pré-existants rencontrés,
recommandation pour la Phase 2 (sidecar).
