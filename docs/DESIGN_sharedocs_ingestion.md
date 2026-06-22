# Notes de design — Connecteur d'ingestion ShareDocs (WebDAV)

> Statut : décisions figées, prêtes à transformer en ticket(s).
> Date : 2026-06-12. Cible : `multicorpus-engine` v0.3.x.

## 1. Cadre & périmètre

**But.** Tirer des documents source depuis un dépôt **ShareDocs Huma-Num**
(Nextcloud / SabreDAV, WebDAV) pour alimenter la db locale via le pipeline
d'import existant. C'est de l'**ingestion en entrée** : la db reste strictement
locale.

**Hors périmètre — décision explicite.** On ne partage **pas** la db SQLite via
WebDAV. Le plugin Madbot fait du GET/PUT de fichier entier (pas un montage FS) ;
combiné au mode WAL et à l'absence de `LOCK`, cela donne du *last-writer-wins*
silencieux et un risque de snapshot incohérent. La collaboration multi-utilisateur
est un sujet séparé (serveur, ou handoff sérialisé assumé), pas un effet de bord
de ce connecteur.

**Choix cadrants validés.**

| Axe | Décision | Raison |
|-----|----------|--------|
| Dépendances | **stdlib `urllib` uniquement** | Besoin réel = lister + télécharger. Le sidecar fait déjà du HTTP stdlib ([sidecar.py:44-46](../src/multicorpus_engine/sidecar.py#L44)). Pas de `webdav4`/`httpx` dans le bundle PyInstaller. |
| Périmètre v1 | **CLI + endpoint sidecar + UI Prep** | Couvre aussi les utilisateurs non-CLI. Découpé en 3 phases livrables. |
| Granularité | **Dossier / batch** | Le vrai gain : pointer un dossier ShareDocs et ingérer tout le corpus d'un coup. |
| XML | **`defusedxml`** pour parser le PROPFIND | Déjà une dépendance ; protège contre XXE. |
| Credentials | **Jamais persistés** (db / runs / logs / portfile / télémétrie) | Voir §6. **(assoupli en Phase 4 — secret en trousseau OS opt-in ; cf. §9.)** |

## 2. Point d'intégration

`cmd_import` ([cli.py:113](../src/multicorpus_engine/cli.py#L113)) résout `--path`
vers **un fichier local unique**, puis dispatche par `--mode` vers l'importer, qui
ouvre le chemin lui-même. Le branchement propre :

1. **Résoudre la source distante → fichier temporaire** avant le dispatch.
2. **Réutiliser le dispatch existant** sans toucher aux importers.
3. **Tracer la provenance** : `source_path` = URL distante, `source_hash` = hash
   des octets téléchargés (identique au cas local, cf. ADR-011).

### Refactor préalable (bloquant)

Extraire le if/elif `mode → importer` ([cli.py:147-237](../src/multicorpus_engine/cli.py#L147))
dans un helper unique :

```
multicorpus_engine/importers/dispatch.py
    dispatch_import(conn, mode, path, *, language, title, doc_role,
                    resource_type, tei_unit, run_id, run_logger) -> Report
```

- `cmd_import` se réduit à un appel à ce helper.
- **Vérifier si `sidecar._handle_import` possède sa propre copie du dispatch** et
  l'unifier sur le même helper (sinon trois sites à maintenir).
- Le helper devient le point d'appel commun pour `import`, `import-remote` (CLI) et
  `POST /import-remote` (sidecar).

## 3. Client WebDAV stdlib

Module : `multicorpus_engine/remote/webdav.py`. Pas de classe lourde : deux
opérations.

### 3.1 PROPFIND (lister un dossier)

```
Request(url, method="PROPFIND",
        headers={"Depth": "1", "Content-Type": "application/xml", **auth},
        data=PROPFIND_BODY)
```

- Réponse `207 Multi-Status`, parsée avec **`defusedxml.ElementTree`** (namespace
  `DAV:`).
- Par entrée `<d:response>` : `href`, `getcontentlength`, `getlastmodified`,
  `getcontenttype`, `getetag`, et `resourcetype` (présence de `<d:collection/>` =
  dossier).
- **Gotchas tranchés :**
  - Les `href` sont **percent-encodés** et souvent **absolus côté serveur**
    (`/remote.php/dav/files/user/...`) → résoudre contre `scheme://host` de l'URL
    de base ; décoder pour l'affichage, ré-encoder pour les requêtes.
  - La **première entrée** d'un listing Depth:1 est le dossier lui-même → la
    sauter (match `href == chemin demandé`).
  - **`Depth` strictement `"1"`** — jamais `infinity` (pas de listing récursif
    massif).
  - Mapping erreurs : `401` → message d'auth clair ; `404` → dossier introuvable ;
    timeout → message réseau. Pas de stacktrace brute remontée à l'UI.

### 3.2 GET (télécharger)

- `Request(file_url, headers=auth)`, streaming par chunks (4 MiB) vers un fichier
  temp.
- **Contrôle d'intégrité = taille seule** (Content-Length vs octets écrits),
  comme Madbot. Pas d'ETag (opaque, non garanti = hash de contenu).
- Garde `--max-file-mb` (défaut **200**) : au-delà → skip + report, pas de
  remplissage disque.

### 3.3 Authentification

- Modes : `basic` (`Authorization: Basic base64(user:pass)`), `bearer`
  (`Authorization: Bearer <token>`), `anonymous` (aucun header).
- **TLS vérifié systématiquement.** Pas de `--insecure` en v1 (footgun).
- Résolution CLI (env) :
  - `AGRAFES_WEBDAV_TOKEN` présent → `bearer`
  - sinon `AGRAFES_WEBDAV_USER` + `AGRAFES_WEBDAV_PASSWORD` → `basic`
  - sinon `anonymous`
  - `--auth {auto,basic,bearer,anonymous}` peut forcer le mode (`auto` = ci-dessus).

## 4. Flux batch (cœur métier)

1. **PROPFIND** le dossier → entrées.
2. **Filtre** : garder les fichiers (pas les collections) correspondant à
   l'extension dérivée du `--mode` (`docx_* → *.docx`, `odt_* → *.odt`,
   `txt_* → *.txt`, `tei → *.xml`, `conllu → *.conllu`), surchargeable via
   `--include "<glob>"`. Les non-correspondants → `skipped-filtered` (reporté).
3. **Dédup** : pour chaque fichier retenu, télécharger → calculer le hash (même
   helper `_compute_file_hash` que les importers) → si un `documents.source_hash`
   identique existe déjà, **`skipped-duplicate`** (pas de run vide créé). Aligné
   sur la sémantique ADR-011.
4. **Import** : appeler `dispatch_import(...)` sur le fichier temp.
   - **Un run par fichier** (modèle 1-fichier-1-run inchangé) ; chaque doc reste
     traçable. Le batch agrège les `run_id`.
   - **Provenance** : après import, `UPDATE documents SET source_path = <url>
     WHERE doc_id = <renvoyé>`. Le `source_hash` (octets) reste tel quel. Évite de
     modifier la signature de chaque importer.
5. **Robustesse** : une erreur de download ou d'import sur un fichier est
   **reportée et n'interrompt pas le batch** (continue au suivant).
6. **Temp** : `tempfile.mkdtemp()` par batch, nettoyé en `finally`
   (`shutil.rmtree`). **Noms de fichiers temp générés** — ne jamais construire un
   chemin local à partir du nom serveur (garde contre la traversée de chemin).

### Report batch (JSON, style `_ok`/`_err` existant)

Par fichier : `status` ∈ {`imported`, `skipped-duplicate`, `skipped-filtered`,
`skipped-oversize`, `error`}, `source_url`, `doc_id`, `run_id`, `source_hash`,
compteurs (lignes/unités), `error` éventuel. Plus un agrégat (totaux par statut).

## 5. Phasage (livrable incrémental)

**Phase 1 — CLI ✅ LIVRÉ** (branche `feat/sharedocs-ingestion-p1`) **— validable en headless contre ShareDocs.**
- Refactor `dispatch_import`.
- `remote/webdav.py` (PROPFIND + GET + auth).
- Sous-commande `import-remote` :
  ```
  multicorpus import-remote --db <db> --url <folder-url> --mode <mode>
      [--language fr] [--include "*.docx"] [--auth auto]
      [--doc-role ...] [--resource-type ...] [--max-file-mb 200]
  ```
  → report batch JSON.

**Phase 2 — Sidecar ✅ LIVRÉ** (contrat 1.6.28). *Recalé par l'addendum P2 (job
async + carve-out lock-free + creds en closure) — voir
`TICKET_SHAREDOCS_INGESTION_P2_SIDECAR.md`.*
- `POST /webdav/list` (body : url + auth) → listing (name, href, is_dir, size,
  modified, content_type). **Lecture seule réseau, sans token, dispatché
  lock-free** (carve-out avant l'acquire du lock, comme `/shutdown`) → ne bloque
  jamais les écritures db. Erreurs : 401 (auth), 404 (dossier), 502 (réseau).
- `POST /import-remote` (body : url, mode, language, include, auth, doc_role,
  resource_type, max_file_mb) → **asynchrone** : *enqueue* un job **`JobManager`**
  (token requis) et renvoie `{job}` (202) ; l'UI poll `/jobs/<id>` pour la
  progression par fichier + le report batch. Sur le thread worker, le *download*
  reste **hors** write-lock ; seule la section DB (dédup + import + provenance)
  passe sous le lock (`remote/ingest.py` gagne `progress` + `critical_section`).
- Les deux routes câblées dans `do_POST` (`/import-remote` dans `_write_paths` ;
  `/webdav/list` en carve-out lock-free).
- `runs.params` / `params` de job ne stockent **que** `url` + `mode` (+ options
  non secrètes) — l'`auth` n'est **jamais** persisté (capturé dans la closure du
  runner), vérifié par test sur `runs.params_json` **et** `/jobs/<id>`.

**Phase 3 — UI Prep ✅ LIVRÉ.** Onglet « ShareDocs » dans `tauri-prep`
(`screens/ShareDocsImportScreen.ts` + logique pure `lib/shareDocs.ts` + bindings
`webdavList`/`importRemote`). Progression réutilise le Job Center
(`/jobs/<id>`). Creds en mémoire de session seulement.
- Écran « Importer depuis ShareDocs » :
  - Formulaire : URL de base, mode d'auth, champs creds.
  - « Connecter » → `POST /webdav/list` → vue dossier navigable (nom, type,
    taille, modifié).
  - Sélection dossier → choix `mode` + `language` + filtre `include` → « Importer ».
  - `POST /import-remote` → barre de progression (événements `JobManager`) → table
    de report par fichier.
  - **Creds : en mémoire pour la session uniquement**, jamais sur disque/db (v1).
    Re-saisie à la session suivante. Compromis UX assumé ; keychain OS = évolution
    ultérieure.

**Phase 4 — Persistance, navigation, sélection ⏳ FIGÉ (addendum §9, 2026-06-22).**
Trois améliorations post-P3, découpées en 3 tickets phasés (front-end + Rust shell ;
un seul incrément moteur/contrat en P4C) :
- **P4A ✅ implémenté** — persistance opt-in des identifiants via **trousseau OS**
  (assouplit §6) + clarté du formulaire (URL, modes, note mot-de-passe-d'application/humanID).
- **P4B** — navigation : préremplissage racine / preset Huma-Num.
- **P4C** — **sélection multiple accumulative** (panier inter-dossiers) couvrant
  dossiers ET fichiers (étend la granularité §1) ; ajoute `hrefs` au contrat
  `POST /import-remote` + `only_hrefs` dans `remote/ingest.py`.

## 6. Sécurité (tranché)

- `defusedxml` obligatoire pour le PROPFIND (XXE).
- TLS vérifié, pas d'opt-out.
- **Credentials jamais écrits** : db, `runs.params`, logs de run, logs de requête
  sidecar (exclure les champs auth du body loggé), portfile, événements télémétrie.
  **⚠️ Assoupli en Phase 4 (§9.2)** : le secret (mot de passe / jeton) peut être
  persisté **dans le trousseau OS** (opt-in « Se souvenir ») ; le clair sur disque
  (db / `localStorage` / config) reste interdit, et l'auth reste hors `runs.params`.
- Creds CLI via env ; creds UI via body POST sur `127.0.0.1` uniquement, en mémoire.
- Garde traversée de chemin (noms temp générés) ; `Depth: 1` strict ; garde taille.

## 7. Tests

- **Unitaires client WebDAV** : `urlopen` mocké, échantillons XML `207`
  multistatus (s'inspirer des fixtures `test_canonical` de Madbot). Asserts :
  parsing entrées, skip du dossier-self, résolution des href, construction header
  auth (basic/bearer/anon), mapping `401`/`404`/timeout.
- **Unitaires batch** : dossier mixte (docx/odt/txt/xml + un `.pdf` parasite) →
  filtre ; `skipped-duplicate` (hash match) ; erreur de download sur un fichier
  → continue ; `skipped-oversize` ; provenance `source_path == url`.
- **Intégration (opt-in, gated, skip en CI)** contre ShareDocs Huma-Num, creds via
  env — calquée sur le test d'intégration gated de Madbot.

## 8. À confirmer au moment du ticket (résiduel)

- Forme exacte des événements de progression `JobManager` (`sidecar_jobs.py`) pour
  câbler la barre UI — à lire en phase 2/3.
- Le `Report` de chaque importer expose-t-il bien `doc_id` (pour l'UPDATE
  `source_path`) ? À vérifier importer par importer.
- `sidecar._handle_import` duplique-t-il le dispatch ? → à unifier dans le refactor §2.

## 9. Addendum Phase 4 — persistance, navigation, sélection (figé 2026-06-22)

> Retours d'usage post-Phase 3. Trois améliorations, **3 tickets phasés** P4A → P4B →
> P4C, chacun livrable/testable seul. **Tout est front-end + Rust shell, sauf P4C**
> qui ajoute un unique petit incrément moteur/contrat. Ni `sidecar.py` ni la croissance
> du sidecar ne sont impactés.

### 9.1 Supersessions assumées

- **§6 « credentials jamais persistés »** → assoupli : le secret peut être stocké
  **dans le trousseau OS** (opt-in). Le clair sur disque reste interdit. *Pourquoi :*
  l'outil est mono-utilisateur sur poste perso, et le **mot de passe d'application
  Nextcloud n'est affiché qu'une seule fois** à sa création — en mémoire-seule,
  l'utilisateur doit en **régénérer un à chaque session** (chemin long). Persister
  ramène ce chemin à « une fois dans la vie ».
- **§1 granularité « dossier/batch »** → étendue : « dossier **ou** sélection
  explicite ». Le batch dossier reste le défaut ; la sélection est additive.

### 9.2 P4A — Persistance des identifiants + clarté du formulaire

- **Stockage secret = trousseau OS** via la crate Rust **`keyring`** (Windows
  Credential Manager ; features mac/Linux ajoutables plus tard). Trois commandes
  Tauri dans **`tauri-shell/src-tauri/src/main.rs`** : `keyring_get(service, account)
  -> Option<String>`, `keyring_set(service, account, secret)`, `keyring_delete(...)`,
  enregistrées dans `generate_handler!`. Même pattern que `read_sidecar_portfile`.
- **Clé** : service `agrafes.sharedocs`, compte `origin|mode|user`
  (`origin` = `scheme://host[:port]`) → plusieurs serveurs/comptes mémorisés sans
  collision.
- **Non-secret en `localStorage`** : dernier `{url, mode, user, remember}` (pattern
  Prep existant). **L'identifiant est non-secret** ; **seuls** `password`/`token` vont
  au trousseau.
- **Wrapper JS** `tauri-prep/src/lib/credentialStore.ts` : `secureGet/Set/Delete`
  enveloppant `invoke(...)` en **try/catch → repli gracieux mémoire-seule + toast**
  si la commande/trousseau est indisponible (prep standalone, Linux sans libsecret).
  Jamais de crash.
- **Sauvegarde uniquement après un “Connecter” réussi** (PROPFIND 200) — on ne
  mémorise jamais un secret faux. Préremplissage du dernier au montage. Lien
  **« Oublier »** → purge trousseau + `localStorage`.
- **Clarté** : ligne d'aide sous l'URL ; modes relabellés ; **note sous le mode basic**
  expliquant le mot de passe d'application Nextcloud / humanID-2FA.
- **Périmètre v1** : shell uniquement. Prep standalone dégrade en mémoire-seule.

### 9.3 P4B — Navigation

- Conserver le champ URL + un bouton **« Préremplir (ShareDocs Huma-Num) »** qui
  *template* `https://<hôte>/remote.php/dav/files/<identifiant>/` à partir du serveur
  et de l'identifiant saisis (champ **éditable** ensuite — **aucun couplage Nextcloud
  en dur** dans la logique d'import).
- Navigation existante conservée (clic dossier = entrer, « ← Retour », fil d'Ariane).

### 9.4 P4C — Sélection multiple accumulative + incrément backend

- **Modèle de sélection = panier accumulatif inter-dossiers** : une `Map` keyée par
  `href`, **persistante pendant la navigation**. Chaque item retient
  `{href, name, parentUrl, is_dir, size?}`.
- **UI** : **colonne de cases à cocher distincte** du lien de dossier (clic sur le nom
  = naviguer ; case = sélectionner/désélectionner). Badge **compteur** + panneau pour
  voir/vider le panier. Au re-rendu d'un dossier déjà visité, **refléter l'état coché**
  depuis le panier.
- **Deux actions conservées** : « Importer ce dossier entier » (sans `hrefs`) et
  « Importer la sélection (N) ».
- **Soumission de la sélection** : **grouper le panier par dossier parent**, puis
  - items **dossier** sélectionnés → `import-remote(folderUrl)` (appel existant) ;
  - items **fichiers** sélectionnés → `import-remote(parentUrl, hrefs=[…fichiers de ce parent])` ;
  - une soumission **Job Center** par groupe ; report agrégé côté écran.
  - **Dédup** : si un dossier **et** des fichiers de ce dossier sont cochés, l'import
    du dossier prime (les fichiers redondants sont ignorés) — le signaler dans l'UI.
- **Un seul `mode` + `language` (+ `include`) pour toute la soumission** (v1).
- **Contrat** : `POST /import-remote` gagne **`hrefs: list[str]` optionnel**. Régénérer
  `docs/openapi.json` + `tests/snapshots/openapi_paths.json` (`scripts/export_openapi.py`)
  et committer — sinon contract-freeze rouge. Ajouter un champ ne *retire* pas
  d'endpoint : c'est une régénération, pas une rupture.
- **Backend** `remote/ingest.py` — `ingest_remote_folder(..., only_hrefs: set[str] | None = None)` :
  après `files = [e for e in entries if not e.is_dir]`,
  `if only_hrefs is not None: files = [e for e in files if e.href in only_hrefs]`.
  **Sécurité (clé)** : `only_hrefs` **filtre le listing PROPFIND de confiance** — on ne
  fetch jamais une URL brute fournie par le client. La garantie same-origin existante
  (`webdav.py`) tient sans ajout. Les `hrefs` explicites **court-circuitent le glob
  `include`** (l'utilisateur a choisi exactement ces fichiers) ; un fichier de mode
  incompatible → **erreur per-file reportée**, pas de crash.
- **Persistance** : `hrefs` (des URLs, non-secret) admissibles dans `runs.params` /
  params de job ; l'`auth` reste **hors** params (inchangé).
- **CLI** : **pas** de `--href` en v1 (la sélection est une affordance UI ; la CLI
  garde ses globs `--include`).

### 9.5 Hors périmètre Phase 4

- **Nextcloud Login Flow v2** (SSO navigateur → jeton automatique) — supprimerait même
  la 1re génération de mot de passe d'application, mais couple à Nextcloud : évolution
  future séparée.
- Trousseau dans **prep standalone** / **macOS** / **Linux** (ajout de features
  `keyring` ultérieur).
- Sélection fichier-par-fichier **en CLI**.
