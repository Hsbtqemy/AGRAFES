# Note de design — R5.2c : annotation au canvas (friction modèle) + catalogue & sélection (Lots 3+4)

> Statut : **draft, décisions à figer avant ticket** (défauts proposés marqués ✅).
> Date : 2026-07-02. Cible : `multicorpus-engine` 0.4.x + `tauri-prep`/`tauri-shell`.
> Amont : [`DESIGN_spacy_models_dual_dist_and_selection.md`](DESIGN_spacy_models_dual_dist_and_selection.md)
> (Lots 1-4). **Lot 1 livré** (contrat 1.6.42 : `source` bundled/downloaded/absent).
> Spine UX : [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md) §7 (T4 = le canvas
> **remplace** les écrans legacy) et §9 (base persistante + 1 mode actif).

## 0. Cadrage

R5.2a (coloriage extrait) et R5.2b (couche Annotation read-only au canvas) sont livrées :
le canvas **affiche** la prose colorée UPOS quand les tokens existent, et **guide** sinon.
R5.2c apporte ce qui manque pour que le canvas puisse un jour **remplacer**
`AnnotationView` (objectif T4) : **agir** (lancer l'annotation, gérer les modèles) sans
renvoyer l'utilisateur vers l'atelier legacy.

Conformément à la méthode R5.1a/R5.2a, on **reloge par extraction, pas par duplication** :
on sort d'`AnnotationView` les pièces de friction (job+poll, gestion modèle), le canvas
**et** la bande legacy les consomment, puis T4 retire le legacy. On **fusionne ici les
Lots 3+4** (catalogue étendu + sélection du modèle actif) : reloger la gestion modèle est
le moment naturel pour construire le sélecteur riche **une seule fois**.

## 1. État du code (vérifié)

- **`services/models_service.py`** : catalogue **9 modèles en dur** (`MODEL_CATALOG`, un
  `md`/`sm` par langue) ; `list_models` émet `source` (Lot 1) mais l'allowlist reste ces 9.
- **`annotator.py`** : `_DEFAULT_MODEL_BY_LANG` fige **un** modèle par langue ;
  `_model_for_language` ne consulte **aucune** préférence utilisateur ; `_load_model` charge
  par chemin (téléchargé) puis par nom (embarqué).
- **`sidecar.py`** : `GET /models`, `POST /models/download` (job), `POST /models/remove`.
  Pas de route de sélection.
- **`ModelManager.ts`** : liste plate (une ligne/modèle), Télécharger/Supprimer/Intégré ;
  **pas** de sélecteur de langue, **pas** de radio « actif ». Monté en Paramètres, partagé
  avec la bande AnnotationView.
- **`AnnotationView.ts`** : deux machineries **job + polling jumelles** (même patron
  `enqueue → job_id → setInterval(getJob, 1s) → done`) :
  - annotation : `_annotRunJob` (POST /annotate) → `_annotPoll` ;
  - téléchargement modèle : `_annotDownloadModel` → `_annotPollModel`.
  Plus un `<select>` d'override modèle **en dur** (`SPACY_MODELS`, les mêmes 9).
- **`AnnotationPane.ts`** (R5.2b) : read-only, `listTokens` paginé, `decorateRow` repeint.
  Aucun déclencheur, aucune gestion modèle.

## 2. Idée structurante — deux fils

> **Fil A — relogement de la friction** : extraire le patron job+poll + le déclencheur
> d'annotation + le téléchargement modèle en pièces partagées ; le **dock du canvas** les
> compose (déclenchement non bloquant §9), la bande legacy s'y branche aussi. *C'est le
> minimum pour que le canvas se suffise → sert T4.*
>
> **Fil B — catalogue & sélection (Lots 3+4)** : moteur (allowlist dynamique + modèle actif
> par langue) + UI `ModelManager` enrichie (sélecteur de langue, tailles, radio « actif »),
> montée **à la fois** en Paramètres et dans le dock canvas.

Les deux fils sont **largement indépendants** : le Fil A peut livrer avec le catalogue
actuel (9 modèles) ; le Fil B enrichit ensuite. On les découpe en §8.

## 3. Fil B — moteur (Lots 3+4)

### 3.1 Catalogue étendu (Lot 3)

- Catalogue *à l'installation* dérivé de **`compatibility.json`** (déjà récupéré pour la
  résolution de version), filtré sur la `major.minor` de spaCy embarquée → **toutes** les
  langues / tailles (`sm`/`md`/`lg`/`trf`) publiées par Explosion.
- **Allowlist = `nom ∈ compatibility.json` (version courante) + regex stricte**
  `^[a-z]{2,3}(_[a-z0-9]+)+$` → aucun nom hors table officielle ; hôte figé, https (§7).
  **Table épinglée de secours** (offline) = les 9 défauts + `lg` courants.
- **Parsing du nom** `{lang}_{genre}_{source}_{size}` → langue / genre (`core`/`dep`/`ent`) /
  source (`news`/`web`/`wiki`) / taille. **Tailles** : ✅ table statique indicative
  (`sm≈12`, `md≈45`, `lg≈500`, `trf≈450` Mo) ; HEAD `Content-Length` **différé** (décision §9).
- **Listing vs install (raffinement c-1)** : pour préserver le « filesystem-only,
  lock-free » de `GET /models`, le **listing** utilise un **catalogue statique étendu**
  (`_STATIC_CATALOG`, sm/md/lg par langue) ∪ les modèles téléchargés — **hors réseau**.
  L'allowlist **d'installation** (`resolve_download`), elle, est **dynamique**
  (`compatibility.json` + regex). Le **listing complet toutes-langues** via compat.json est
  un **fetch à la demande** (déplié dans l'UI par langue) → **c-3**.
- `list_models(language=None)` : sans filtre = catalogue statique ; `?language=fr` = seulement
  `fr` (UI au déploiement). Chaque item : `name, language, genre, size_class, approx_size_mb,
  source, version|None` (+ `active` en c-2).

### 3.2 Modèle actif par langue (Lot 4)

- Préférence `active_model_by_lang: {base_lang → model_name}` qui **prime** sur
  `_DEFAULT_MODEL_BY_LANG`.
- **Stockage** : ✅ **par corpus (DB)** — *décidé 2026-07-02, override du défaut global*.
  Rangé dans **`corpus_info.meta_json`** (table mono-ligne id=1, migration 009 ; colonne
  `meta_json` flexible) sous la clé `active_models` → **aucune nouvelle migration**. Les
  modèles restent partagés globalement (`spacy_models_dir`) ; seul le **choix** est par-DB
  (un corpus grec peut préférer `el_core_news_lg`, un autre l'`sm`).
- `_model_for_language(conn, lang)` : lit `active_models[base]` dans `corpus_info.meta_json` ;
  si défini **et disponible** (`source ≠ absent`) → l'utiliser ; sinon fallback défaut.
  `clear_model_cache()` au changement. *(annotate_document a déjà `conn` → le passe.)*
- `set_active_model(conn, language, name)` : valide que `name` est **disponible** + langue
  cohérente ; merge dans `meta_json.active_models` (écriture mono-ligne, sous write-lock côté
  sidecar) ; vide le cache. On n'active qu'un modèle **disponible** (l'UI propose d'abord
  « Télécharger » puis « Définir comme actif »).

### 3.3 API moteur (récap)

```text
list_models(language=None, *, is_bundled=None) -> list[dict]   # + genre/size_class/active
set_active_model(language, name) -> dict                        # valide dispo ; persiste ; clear cache
resolve_download / install_model / remove_model                 # allowlist dynamique (compat.json + regex)
```

## 4. Fil A — front : relogement de la friction

### 4.1 Extraire le patron job + poll

Les deux machineries d'`AnnotationView` (annotate, download) sont le même patron. On
extrait un petit **contrôleur de job** partagé (lib, sans DOM) :

```text
runJobWithPolling(conn, { enqueue, onProgress, onDone, onError, intervalMs=1000 })
  -> { cancel(): void }   // enqueue() renvoie job_id ; poll getJob ; arrête sur done/error/canceled
```

- Remplace `_annotRunJob/_annotPoll` **et** `_annotDownloadModel/_annotPollModel` (legacy s'y
  branche → moins de code, un seul point de vérité pour l'arrêt propre au dispose, cf. FE-08).
- Le **dock canvas** l'utilise pour : (a) déclencher l'annotation (POST /annotate) avec barre
  de progression **non bloquante** (§9), (b) télécharger un modèle absent.

### 4.2 Déclencheur d'annotation au dock canvas

- Bouton « Annoter ▶ » dans le dock `AnnotationPane` : `enqueue = POST /annotate {doc_id,
  model?}` → progression → au `done`, recharger les tokens (déjà `_loadTokens` + `render`).
- Le modèle est le **modèle actif** de la langue du doc (Lot 4) ; override possible via le
  sélecteur (Fil B UI).

### 4.3 Gestion modèle au dock canvas

- Bande in-context : « Modèle actif pour {langue} : **{X}** » ; si absent → Télécharger
  (non bloquant) ; lien « Gérer les modèles » → Paramètres. Réutilise le `ModelManager`
  enrichi (Fil B) plutôt qu'une bande maison.

## 5. UI — `ModelManager` enrichi (partagé)

- **Paramètres** : **sélecteur de langue** → déplie ses modèles (`sm`/`md`/`lg`/`trf`) ;
  par ligne : statut (**Intégré** / **Installé · version** / **Absent**), taille,
  Télécharger / Supprimer (masqué si `bundled`), **radio « Actif »** (modèle utilisé pour
  annoter cette langue).
- **Canvas (dock) + bande legacy** : le **même** composant, monté en mode compact autour de
  la langue du document courant.

## 6. Contrat (additif)

- `GET /models` : gagne `genre`, `size_class`, `active` (booléen) ; `?language=` filtre.
  `active` reflète la préférence du **corpus actif** (lecture de `corpus_info.meta_json` —
  reste **sans write-lock**). *(`source` déjà livré en 1.6.42.)*
- **`POST /models/active`** `{language, model}` (écriture → `_write_paths`, token requis) :
  définit le modèle actif de la langue **pour le corpus actif**. 200 ; 400 (modèle
  inconnu/indisponible).
- Bump `CONTRACT_VERSION` + `export_openapi.py` + snapshot + `SIDECAR_API_CONTRACT.md`
  (route ajoutée → `openapi_paths.json` **change** cette fois ; cf. mémoire endpoint = 3 artefacts).

## 7. Sécurité & robustesse (repris §8 amont)

- Allowlist dynamique (`compatibility.json`) + regex stricte ; https, hôte figé
  `github.com/explosion` ; anti-zip-slip + install atomique + `.part` inchangés.
- `lg`/`trf` lourds (400-560 Mo) → **avertir avant download**, vérifier l'espace disque.
- `remove` refuse un `bundled` (déjà Lot 1). Table épinglée si `compatibility.json` injoignable.
- `set_active_model` n'accepte qu'un modèle **disponible** (jamais un nom arbitraire persisté).

## 8. Découpage en sous-tranches (chacune livrable, testable offline pour le moteur)

| Tranche | Fil | Portée | Contrat |
|---|---|---|---|
| **R5.2c-1** | B moteur | Lot 3 : allowlist dynamique `compat.json` + regex, parsing nom, tailles, `list_models(language=)` + `genre`/`size_class` | additif (`genre`/`size_class`) |
| **R5.2c-2** | B moteur | Lot 4 : `active_model_by_lang` **dans `corpus_info.meta_json`** (pas de migration), `set_active_model(conn,…)`, `POST /models/active`, `_model_for_language(conn,…)` consulte l'actif, `active` sur `list_models` | additif + **1 route** |
| **R5.2c-3** | B front | `ModelManager` enrichi (sélecteur langue, tailles, radio actif) — Paramètres d'abord | — |
| **R5.2c-4** | A front | `runJobWithPolling` partagé ; déclencheur « Annoter » + gestion modèle au dock canvas ; legacy rebranché | — |

Ordre proposé : **c-1 → c-2** (moteur d'abord, socle du reste), **c-3** (UI riche en
Paramètres), **c-4** (relogement friction + dock canvas). c-4 peut précéder c-3 si l'on veut
le canvas autonome au plus tôt (avec le catalogue 9 modèles), mais alors on reconstruit un
bout d'UI ensuite → l'ordre proposé évite ce gâchis.

## 9. Décisions restant à confirmer

- ~~**Affichage des tailles**~~ : **table statique** (décidé 2026-07-02).
- ~~**Stockage du modèle actif**~~ : **par corpus**, dans `corpus_info.meta_json` (décidé 2026-07-02).
- ~~**Ordre**~~ : **c-1 → c-2 → c-3 → c-4** (décidé 2026-07-02).
- **Override modèle** au dock canvas : réutiliser le `<select>` legacy (les 9) ou le sélecteur
  riche dès c-4 (dépend de l'ordre).
- **Version cible** : 0.4.0 (catalogue étendu = changement notable) — à confirmer au ticket.
- **Lot 2 (double distribution)** reste **hors R5.2c** : ticket build/CI séparé.
