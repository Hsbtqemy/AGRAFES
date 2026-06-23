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

**Phase 4 — Persistance, navigation, sélection, sécurité ✅ LIVRÉ** (mergé dans `dev`
via #104 + #105 ; addenda §9 et §10). Front-end + Rust shell ; un seul incrément
moteur/contrat (P4C) :
- **P4A ✅** — persistance opt-in des identifiants via **trousseau OS** (assouplit §6)
  + clarté du formulaire (note mot-de-passe-d'application/humanID).
- **P4B ✅** — navigation : préremplissage racine / preset Huma-Num.
- **P4C ✅** — **sélection multiple accumulative** (panier inter-dossiers, dossiers ET
  fichiers ; étend la granularité §1) ; `hrefs` au contrat `POST /import-remote`
  (1.6.29) + `only_hrefs` dans `remote/ingest.py`.
- **P4D ✅** — sécurité de la sélection (info format + drapeau par fichier,
  **annulation de lot**) + refacto `_guardedRun` (addendum §10).

**Phase 5 — Détection par fichier (format + langue) ✅ LIVRÉ** (branche
`feat/sharedocs-p5-detection` ; addendum §11, ticket P5). La détection de l'import
local (`ImportScreen`) est extraite dans `lib/importDetect.ts` (**source unique**,
réutilisée par l'import local ET ShareDocs) : chaque fichier importé avec **son**
format (extension) et **sa** langue (nom). Front-only, aucun changement moteur/contrat.
**Écarts assumés à la livraison : voir §11.8.** Familles (source↔traduction) différées
en Phase 6.

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

## 10. Addendum — sécurité d'import par lot (P4D, suivi)

> Motivé par le risque « casser des imports en sélectionnant en lot des fichiers
> dont on n'est pas sûr ». **Front-only**, réutilise `deleteDocuments` +
> `inlineConfirm`. Aucun changement moteur/contrat.

### 10.1 Constat

L'import est déjà **additif** (n'écrase jamais l'existant), **dédupliqué** par
`source_hash` (idempotent), un **mauvais format = erreur per-file sans écriture**,
et **réversible** (`POST /documents/delete`). Le seul risque *silencieux* : un
fichier au **bon format mais mauvais style** (numéroté vs paragraphes) → importé
mal segmenté, sans erreur — **indétectable sans parser**. Décision v1 : pas de
dry-run (préventif coûteux) ; on combine **info de sélection** (visibilité) +
**annulation de lot** (récupération).

### 10.2 Info de sélection

- Helpers purs `detectFormatFromName` (extension → format), `modeFormat`,
  `fileMatchesMode` (format **seul**).
- Panier : format affiché par fichier + **drapeau ⚠** si le format ≠ celui du mode
  choisi (sync au changement de mode). **N'attrape que les formats incompatibles**
  (qui erroneront), **pas** le style — copie honnête.
- À l'import : `inlineConfirm` si des fichiers d'un autre format sont sélectionnés
  (avertit, **n'écarte pas en silence** ce qui a été coché).

### 10.3 Annulation de lot

- Bouton **« Annuler cet import (N documents) »** sur le rapport → `deleteDocuments(ids)`.
- ⚠️ N'efface **QUE** les `status === "imported"` — **jamais** les
  `skipped-duplicate` (leur `doc_id` pointe un document préexistant). Confirmé
  (destructif).

### 10.4 Hors périmètre P4D

- **Dry-run / aperçu avant écriture** (préventif) — si le besoin se confirme à
  l'usage (annulations fréquentes).
- Heuristiques de qualité dans le rapport (ex. `units_line == 0` pour un mode
  numéroté).

## 11. Addendum — détection par fichier (réutilisation de l'import local) — Phase 5

> **But** : un import ShareDocs par lot doit se comporter comme le **menu Import
> local** — chaque fichier importé avec **son** format et **sa** langue, déduits du
> nom/extension. On **réutilise la détection existante de `ImportScreen`** (une
> seule source de vérité), on ne la réinvente pas. **Front-only**, aucun changement
> moteur/contrat. Forks tranchés : **familles différées**, **dossiers cochés étendus
> + routés**.

### 11.1 Motivation

Dossiers hétérogènes — formats mélangés, et surtout **texte + traduction bilingue
dans un même dossier**. Le `single-mode`/`single-language` de l'import par lot
(P3/P4C) taguait tout pareil (langue/format faux pour les fichiers non conformes).
L'import local résout déjà ça **par fichier** ; on le porte dans ShareDocs.

### 11.2 Module partagé (refactor préalable, sans changement de comportement)

Extraire de `ImportScreen` vers **`tauri-prep/src/lib/importDetect.ts`** (pur,
testable) :

- `extFromFileName(name)`, `deriveModeFromExt(ext, defaultProfile)`,
  `normalizeModeForExt(mode, ext)`, `modeOptionsForExt(ext)` ;
- `detectLanguageFromName(name, fallback)` + `LANG_RE` + `KNOWN_LANG_CODES` ;
- constantes de profil `WP_DEFAULT_NUMBERED` / `WP_DEFAULT_PARAGRAPHS`.

Refactorer `ImportScreen` pour consommer ce module **à l'identique** (tests de
non-régression). `detectFamilyGroups` **reste** dans `ImportScreen` (familles
différées, §11.6).

### 11.3 ShareDocs — détection + groupement

- **Formulaire** : « Mode d'import » → **« Profil par défaut »** (sélecteur de
  **style** : lignes numérotées / paragraphes, comme le menu Import — le **format**
  vient de l'extension) ; « Langue » → **« Langue par défaut (si non détectée) »**.
- **Aplatir en liste de fichiers** :
  - « Importer ce dossier » → les fichiers de `_entries` (dossier courant) ;
  - « Importer la sélection » → fichiers cochés tels quels **+** chaque **dossier
    coché → `webdavList` (PROPFIND Depth:1)** pour récupérer ses fichiers (fork
    « étendre + router »).
- **Ignorer les extensions non reconnues** (`detectFormatFromName === "unknown"`),
  comptées dans un récap (ni import ni erreur).
- Par fichier : `mode = normalizeModeForExt(deriveModeFromExt(ext, profilDéfaut), ext)`,
  `language = detectLanguageFromName(name, langueDéfaut)`.
- **Grouper par `(parentUrl, mode, language)`** → **un `import-remote` par groupe**
  (`hrefs` + `mode` + `language`), suivi Job Center, **rapports agrégés** (P4C/P4D).

### 11.4 UI

- Panier : afficher le **(mode, langue) détectés** par fichier → **remplace** le
  drapeau ⚠ « format incompatible » de P4D (on **route** au lieu de signaler).
- **Récap avant import** : « N fichiers → G lots (formats/langues) ; M ignorés
  (extension non reconnue) ». `inlineConfirm` si `M > 0` ou si des dossiers doivent
  être étendus (PROPFIND réseau).
- **Annulation de lot** (P4D) conservée telle quelle.

### 11.5 Sécurité / robustesse

- Les PROPFIND d'expansion réutilisent la garde **same-origin** existante de
  `webdav`. Les `hrefs` restent **intersectés au listing** côté backend (P4C) → un
  href non listé n'est jamais téléchargé.
- Une erreur de PROPFIND sur un dossier coché est **reportée et n'interrompt pas**
  le reste de la soumission.

### 11.6 Hors périmètre Phase 5

- **Familles / lien source↔traduction** (différé) : `detectFamilyGroups` +
  relations `translation_of` post-import, comme le dialogue post-import du menu
  Import. À porter ensuite vers le parcours d'alignement.
- **Édition (mode, langue) par fichier avant import** (grille éditable comme le menu
  Import) : v1 = détection + **affichage** ; une détection erronée se rattrape en
  **post-import** (édition métadonnées) ou via l'**annulation de lot**.
- Détection du **style** numéroté/paragraphes (reste un défaut — non détectable
  sans parser) ; auto-détection de `resource_type`/`doc_role` (non détectés même en
  local).

### 11.7 Backend

**Aucun changement** : réutilise `hrefs` + `mode`/`language` par appel ; contrat
`1.6.29` inchangé.

### 11.8 Livraison — écarts assumés vs le cadrage

Trois écarts par rapport au plan §11.1-11.7, tranchés en cours d'implémentation :

1. **Champ glob `include` retiré** (et non « profil/langue »). Découverte : dès qu'un
   appel `/import-remote` porte des `hrefs` (ce que Phase 5 fait **toujours**), le
   backend **bypasse le glob ET le filtre par extension** (`remote/ingest.py`, mode
   *explicit*). Garder le champ en aurait fait un **no-op silencieux**. Le besoin
   « sous-ensemble » est couvert par le **panier P4C** (cocher les fichiers voulus) et
   par le filtrage côté client des extensions inconnues. Le tri connu/inconnu vit
   désormais dans `importDetect.isKnownImportExt` (source unique, alignée sur la
   dérivation de mode — corrige une divergence `.conll`). Les helpers P4D devenus
   morts (`detectFormatFromName`/`modeFormat`/`fileMatchesMode`, et le groupement P4C
   `groupSelectionForImport`) sont **retirés**, remplacés par `groupDetectedFiles`
   (groupement par `(parentUrl, mode, langue)`).

2. **Expansion PROPFIND des dossiers cochés — ✅ levé en suivi P5** (§11.3
   « étendre + router »). Un **dossier coché** dans « Importer la sélection » est désormais
   **développé** à l'import : `_importSelection` lance un `webdavList` (PROPFIND
   `Depth:1`) **par dossier coché**, route ses **fichiers** via la fonction pure
   partagée `routeEntriesToImport` (extraite de l'import « ce dossier »), puis fusionne
   avec les fichiers directement cochés et **déduplique par `href`** (`dedupeDetectedFiles`
   — un fichier peut être coché *et* remonter via son dossier parent). **Non-récursif**
   (décision figée) : les sous-dossiers d'un dossier coché sont **comptés puis ignorés**
   (cohérent avec « Importer ce dossier », lui-même non récursif) et signalés au récap.
   Une **erreur de PROPFIND par dossier est reportée, jamais bloquante** (le dossier est
   listé « illisible » dans la confirmation, l'import continue). L'étiquette du panier
   passe de « ouvrir puis Importer ce dossier » à « son contenu sera développé à
   l'import ». Front-only, aucun changement moteur/contrat.

3. **Langue des fichiers TEI — `xml:lang` préservé.** `tei_importer.py` fait
   `tei_lang = language or header_lang or "und"` : une langue passée **écrase** le
   `xml:lang` du document. Pour ne pas imposer une langue par défaut à un format
   auto-descriptif, on n'envoie une langue pour un fichier **TEI** que si son **nom
   encode explicitement un token** de langue connu (ex. `roman_lat.xml` → `lat`, qui
   prime alors volontairement) ; **sinon `language` est `undefined`** et l'importeur
   **garde le `xml:lang`** du document. Les autres formats (DOCX/ODT/TXT/CoNLL-U), qui
   n'ont pas de langue intrinsèque, reçoivent toujours la langue détectée **ou** le défaut.
   Cette règle vit dans la fonction pure partagée **`detectLanguageForMode(mode, name,
   fallback)`** (importDetect).
   **✅ Convergence import local levée en suivi P5** : l'ancien écart (l'import local
   forçait encore `language: f.language || "und"` pour TEI) est **corrigé** — `ImportScreen`
   pré-remplit le champ langue d'un TEI via le token uniquement (vide si aucun), le
   « profil de lot » n'impose plus le défaut à un TEI, et la soumission envoie `undefined`
   (au lieu de `"und"`) pour un TEI au champ vide. Le champ langue d'un TEI affiche le
   placeholder « `xml:lang` » (vide = le document décide ; renseigner = forcer). Le panier
   ShareDocs affiche « `tei · xml:lang` » pour un TEI sans token.
