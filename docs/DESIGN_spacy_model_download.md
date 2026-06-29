# Notes de design — Téléchargement des modèles spaCy à la demande

> Statut : décisions figées, prêtes à transformer en ticket(s).
> Date : 2026-06-29. Cible : `multicorpus-engine` v0.3.x + `tauri-prep`/`tauri-shell`.
> Origine : l'installeur (`AGRAFESShell_*-setup.exe`) embarque le sidecar mais **pas**
> les modèles spaCy (sautés au build — voir [build_sidecar.py:62](../scripts/build_sidecar.py#L62)).
> Dans l'app installée, l'UI d'annotation s'affiche mais « Annoter » échoue faute de modèle.

## 1. Cadre & périmètre

**But.** Permettre à l'utilisateur de **télécharger à la demande** les modèles spaCy
nécessaires à l'annotation, depuis **deux points d'entrée partageant la même logique** :
- **(A) en contexte** dans l'AnnotationView (le modèle de la langue du doc manque → bouton de téléchargement sur place) ;
- **(B) un écran « Paramètres »** dédié pour la gestion globale (lister / télécharger / supprimer).

**Pourquoi pas bundler.** Embarquer les 9 modèles ([`_DEFAULT_MODEL_BY_LANG`](../src/multicorpus_engine/annotator.py#L15)) ajouterait ~400 Mo à
l'installeur, dont l'utilisateur n'a en général besoin que d'un ou deux. **Installeur léger
+ téléchargement ciblé** est meilleur en UX *et* cohérent avec la philosophie « proche stdlib »
du moteur.

**Hors périmètre — décisions explicites.**
- On ne réimplémente pas `pip` ni `spacy download` : on télécharge le **wheel publié** par
  Explosion et on l'installe dans un dossier utilisateur (pas dans le bundle figé, en lecture seule).
- Pas de gestion de modèles **custom/tiers** en v1 : **allowlist** sur les 9 modèles connus (sécurité, cf. §8).
- Pas de mise à jour automatique des modèles ; l'utilisateur déclenche, supprime, re-télécharge.

**Choix cadrants validés.**

| Axe | Décision | Raison |
|-----|----------|--------|
| Dépendances | **stdlib uniquement** (`urllib`, `zipfile`, `json`, `tarfile` si besoin) | Un wheel est un zip ; pas de nouvelle dép dans le bundle PyInstaller. Aligné sur la règle moteur. |
| Emplacement modèles | **Dossier utilisateur partagé** entre corpus (cf. §2) | Les modèles sont *par langue*, lourds, réutilisables — ne pas dupliquer par-DB. |
| Périmètre v1 | **Moteur + CLI + endpoint sidecar + UI (A) et (B)** | Couvre CLI et desktop. Découpé en 4 phases livrables (§11). |
| UI | **Un composant `ModelManager` partagé**, monté en (A) et (B) | Satisfait « A *et* B » sans dupliquer la logique. |
| Source | **GitHub releases d'Explosion, https uniquement** | Frontière de confiance unique ; vérif taille + anti-zip-slip (§8). |
| Résolution de version | **Table de compatibilité spaCy** (live) + **fallback épinglé** | Le modèle doit matcher la version de spaCy figée dans le sidecar. |

## 2. Emplacement des modèles (nouveau résolveur)

Aucun helper de dossier app-data n'existe aujourd'hui (les runs vivent sous `<db_dir>/runs/`).
On introduit un résolveur **niveau utilisateur**, stdlib only :

```
multicorpus_engine/paths.py
    spacy_models_dir() -> Path        # crée le dossier au besoin
```

Ordre de résolution :
1. `AGRAFES_MODELS_DIR` (env) — override pour tests / install portable ;
2. sinon, dossier app-data par OS :
   - Windows : `%LOCALAPPDATA%\AGRAFES\spacy-models`
   - macOS : `~/Library/Application Support/AGRAFES/spacy-models`
   - Linux : `${XDG_DATA_HOME:-~/.local/share}/agrafes/spacy-models`

**Décision : dossier partagé global**, pas `<db_dir>/models` — un modèle téléchargé une fois
sert tous les corpus (évite ~400 Mo dupliqués par projet). Le switch 3-OS est ~15 lignes stdlib
(pas de `platformdirs`).

## 3. Chargement spaCy depuis le dossier utilisateur

Aujourd'hui [`annotator._load_model`](../src/multicorpus_engine/annotator.py#L50) fait
`spacy.load(model_name)` **par nom de paquet** (lru_cache 8) → dans l'app figée, un modèle
non importable lève l'erreur « install with python -m spacy download ».

**Changement** — résolution à deux niveaux (le dossier utilisateur gagne) :

```python
@lru_cache(maxsize=8)
def _load_model(model_name: str):
    import spacy
    models_dir = spacy_models_dir()
    # 1. Modèle téléchargé par l'utilisateur : le rendre importable puis charger par nom
    if (models_dir / model_name).is_dir():
        if str(models_dir) not in sys.path:
            sys.path.insert(0, str(models_dir))
    # 2. spacy.load gère le cas paquet (dev/bundlé) ET le cas sys.path ci-dessus
    return spacy.load(model_name)   # erreur typée inchangée si introuvable
```

- On extrait le **paquet** `{name}/` du wheel dans `<models_dir>/` puis on charge **par nom**
  via `sys.path` → reproduit exactement la sémantique pip-installée (gère le sous-dossier de
  données versionné `{name}-{ver}/` tout seul). Alternative écartée : `spacy.load(<chemin du
  dossier de données>)` (oblige à localiser le sous-dossier versionné).
- Ajouter **`clear_model_cache()`** (vide le `lru_cache`) appelé après install/suppression,
  sinon un modèle fraîchement téléchargé reste « introuvable » jusqu'au redémarrage.

## 4. Résolution de version + téléchargement

Un modèle spaCy est versionné pour matcher la version de la lib. Le sidecar fige une version
de spaCy précise → il faut le **bon** modèle.

1. **Résoudre** : lire `https://raw.githubusercontent.com/explosion/spacy-models/master/compatibility.json`
   (`urllib`, https), chercher la version de modèle compatible avec `spacy.about.__version__`.
   *(Schéma exact à confirmer à l'implémentation ; prévoir un parseur défensif.)*
2. **Fallback épinglé** : une table `{model: version}` bakée dans le code pour la version de
   spaCy embarquée — pour rester fonctionnel hors-ligne partiel / si le schéma JSON change.
3. **URL wheel** : `https://github.com/explosion/spacy-models/releases/download/{name}-{ver}/{name}-{ver}-py3-none-any.whl`.
4. **Télécharger** en streaming (`urllib`, chunks) vers `<models_dir>/.{name}.part`, en
   rapportant `bytes/total` via le `progress_cb` du job (§6).
5. **Extraire** le wheel (zip) dans un dossier temporaire, **valider chaque membre** (anti
   zip-slip, §8), puis **rename atomique** de `{name}/` → `<models_dir>/{name}/`. Nettoyage
   du `.part`/temp en cas d'échec.

## 5. Service moteur + CLI

**Service** (logique pure, erreurs typées `services/errors.py`) :

```
multicorpus_engine/services/models_service.py
    list_models(models_dir) -> list[ModelInfo]      # name, language, installed, version, size_bytes
    resolve_download(name) -> DownloadPlan          # url, version, expected_size
    install_model(name, models_dir, progress_cb)    # download + extract atomique ; clear_model_cache()
    remove_model(name, models_dir)                  # rmtree ; clear_model_cache()
```

**CLI** (un objet JSON par commande, exit 0/1 — contrat inchangé, garde Mode A) :

```
multicorpus models list                 -> {"models": [ModelInfo, ...]}
multicorpus models download <name>      -> {"ok": true, "name", "version", "path"}   (progress sur stderr/log)
multicorpus models remove <name>        -> {"ok": true, "name"}
```

## 6. Endpoints sidecar + job

Handlers **fins** (adaptateurs) → logique dans `models_service` (garde-fou de croissance de
`sidecar.py`). Contrat figé → **régénérer** `docs/openapi.json` + `tests/snapshots/openapi_paths.json`.

| Route | Type | Détail |
|-------|------|--------|
| `GET /models` | lecture | renvoie la liste (statut installé/absent, taille, langue) |
| `POST /models/download` `{model}` | **job async** | via `JobManager.submit` ([sidecar_jobs.py:60](../src/multicorpus_engine/sidecar_jobs.py#L60)). Étapes `progress_cb` : résolution 5 % → téléchargement 5-90 % (`bytes/total`) → extraction 90-99 % → 100 %. **Annulable** (cancel best-effort déjà supporté). |
| `POST /models/remove` `{model}` | écriture | suppression ; ajouter aux `_write_paths` |

`POST /models/download` et `POST /models/remove` vont dans l'**allowlist `_write_paths`** ;
écritures sous `with self._lock()`.

## 7. UI Prep — composant partagé monté en (A) et (B)

**Composant unique** `tauri-prep/src/components/ModelManager.ts` (CSS `prep-models-*`,
sûr en collision shell) : liste des modèles avec statut (`installé` / `absent` /
`téléchargement N %`), actions **Télécharger** / **Supprimer**, barre de progression alimentée
par le **polling du job** (`GET /jobs/{id}`). Un seul jeu de méthodes dans
[`sidecarClient.ts`](../tauri-prep/src/lib/sidecarClient.ts) (`listModels`, `downloadModel→job`,
`removeModel`).

- **(B) Écran « Paramètres »** — nouveau `tauri-prep/src/screens/SettingsScreen.ts` + entrée de
  nav Prep + module shell (`tauri-shell/src/modules/`). Héberge `ModelManager` (et devient le
  foyer naturel des futurs réglages globaux). C'est la **gestion générale**.
- **(A) En contexte (AnnotationView)** — quand `_model_for_language(doc.language)` n'est pas
  installé : bande inline (style `inlineConfirm`) « Modèle **{X}** requis pour annoter — Télécharger
  (≈{N} Mo) » qui déclenche **le même job** ; à la complétion, ré-active « Annoter ». Lien
  « Gérer les modèles » → ouvre l'écran Paramètres. **Découvrabilité au point de besoin.**

Les deux entrées appellent **le même endpoint** et réutilisent **le même composant** → aucune
duplication de logique (exigence « A *et* B »).

## 8. Sécurité & robustesse

- **Allowlist** : seuls les 9 noms de [`_DEFAULT_MODEL_BY_LANG`](../src/multicorpus_engine/annotator.py#L15)
  sont acceptés (rejet sinon) → pas d'injection d'URL/chemin arbitraire.
- **Source unique** : `github.com/explosion/...` en **https** ; refuser tout autre hôte.
- **Anti zip-slip** : à l'extraction, rejeter tout membre dont le chemin résolu sort du dossier
  cible (`..`, chemin absolu). **Test dédié obligatoire.**
- **Atomicité** : download `.part` → extraction temp → rename atomique ; nettoyage sur échec
  (pas de modèle à moitié installé chargé par erreur).
- **Cache** : `clear_model_cache()` après install/suppression (sinon `lru_cache` masque le changement).
- **Concurrence** : dédupliquer un téléchargement déjà en cours du même modèle (un job actif par modèle).
- **Hors-ligne / disque plein** : erreurs typées claires, message UI actionnable, pas de crash.

## 9. Build

`BUNDLED_SPACY_MODELS` ([build_sidecar.py:62](../scripts/build_sidecar.py#L62)) → **vide par
défaut** (installeur léger ; modèles à la demande). Le build CI n'a plus besoin de
`python -m spacy download`. *(Conserver la possibilité d'une variante « tout-en-un » qui bundle
si jamais utile.)*

## 10. Tests

- **Moteur** : résolution de version sur un `compatibility.json` fixture ; `install_model` depuis
  un **wheel synthétique** dans un temp dir (+ **rejet zip-slip**) ; `remove_model` ;
  rejet hors-allowlist ; chargement après install (mock spaCy ou skip si extras absents).
- **Sidecar** : tests service (dossier modèles temp) ; séquence de progression du job.
- **CLI** : contrat JSON `list`/`download`/`remove`.
- **UI** : render-smoke `ModelManager` + `SettingsScreen` (happy-dom, `getConn → null`) ; la
  bande in-context apparaît quand le modèle de la langue manque.

## 11. Découpage en phases (chacune livrable)

1. **Phase 1 — moteur headless** : `paths.spacy_models_dir`, `models_service`
   (list/resolve/install/remove), `_load_model` deux niveaux + `clear_model_cache`, commandes
   CLI, tests. Testable sans UI.
2. **Phase 2 — sidecar** : `GET /models`, `POST /models/download` (job), `POST /models/remove` ;
   `_write_paths` ; régénération OpenAPI + snapshot ; smoke GET.
3. **Phase 3 — UI (B)** : composant `ModelManager` + écran `SettingsScreen` + nav Prep + module shell.
4. **Phase 4 — UI (A)** : bande in-context AnnotationView + gating de « Annoter » sur la présence du modèle.

## 12. Décisions restant à confirmer (proposition par défaut)

- **Résolution de version** : *live* `compatibility.json` **+** table épinglée de secours
  (proposé). Alternative : tout épinglé (offline pur, mais maintenance à chaque bump spaCy).
- **Suppression de modèle dès la Phase 1** : **oui** (peu coûteux, utile pour libérer du disque).
- **Tailles affichées** : récupérées via `Content-Length`/compat-meta pour aider le choix
  (md ≈ 40-50 Mo, sm ≈ 12-15 Mo).
