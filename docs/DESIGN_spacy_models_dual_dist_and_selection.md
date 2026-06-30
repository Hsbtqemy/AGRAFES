# Notes de design — Modèles spaCy : double distribution, détection bundlé, catalogue étendu & sélection par langue

> Statut : **draft, décisions à figer** (défauts proposés marqués ✅).
> Date : 2026-06-30. Cible : `multicorpus-engine` v0.4.x + `tauri-prep`/`tauri-shell`.
> Suite de [`DESIGN_spacy_model_download.md`](DESIGN_spacy_model_download.md) (téléchargement à la demande, livré en 0.3.x).

## 0. Origine

Le téléchargement à la demande a été livré (Phases 1-4, 0.3.x), **mais l'installeur
bundle quand même les 9 modèles** (`build_sidecar.py:BUNDLED_SPACY_MODELS` plein +
`spacy download` des 9 dans `release.yml`/`tauri-shell-build.yml` → sidecar ~330 Mo,
installeur ~530 Mo). Conséquences :

- L'UI de téléchargement (Paramètres) est **redondante** avec les modèles embarqués.
- **Incohérence visible** : `list_models()` ne regarde que le dossier utilisateur, donc
  Paramètres affiche les 9 comme **« Absent »** alors qu'ils sont embarqués et que
  l'annotation fonctionne.
- L'étape §9 du design précédent (« rendre l'installeur léger ») n'a jamais été appliquée.

Trois besoins :
- **(A)** Deux installeurs : **léger** (par défaut) + **tout-en-un** (hors-ligne).
- **(B)** Détecter qu'un modèle est **disponible** = chargeable (embarqué **ou** téléchargé) — corrige l'incohérence.
- **(C)** **Catalogue étendu** : choisir parmi plus de modèles par langue (`sm`/`md`/`lg`/`trf`), les télécharger et **sélectionner celui qui est actif** pour l'annotation.

## 1. Idée structurante

> Le runtime considère un modèle comme **disponible** dès que l'annotateur peut le
> charger — **embarqué OU téléchargé**. Les deux installeurs « marchent » alors sans
> que l'app sache lequel elle est.

`list_models()` détecte donc trois états par modèle : `bundled` (importable dans le
sidecar figé), `downloaded` (présent dans `spacy_models_dir`), `absent` (ni l'un ni
l'autre, proposé au téléchargement). Ce seul changement lève l'incohérence actuelle,
**indépendamment** de la double distribution.

## 2. Catalogue : des 9 en dur → dérivé de `compatibility.json`

Aujourd'hui `MODEL_CATALOG` = 9 noms en dur ; l'allowlist = ces 9 (frontière de sécurité).

**Nouveau** : le catalogue des modèles *disponibles à l'installation* est dérivé de
`compatibility.json` (déjà récupéré pour la résolution de version), filtré sur la
`major.minor` de spaCy embarquée. Cette table liste **tous** les modèles publiés par
Explosion (toutes langues, toutes tailles/genres).

- **Sécurité préservée.** L'allowlist devient « nom ∈ `compatibility.json` (version
  courante) » **+ regex stricte** (`^[a-z]{2,3}(_[a-z0-9]+)+$`). Tout nom hors de la
  table officielle est rejeté → pas d'injection d'URL/chemin (hôte figé
  `github.com/explosion`, https). La **table épinglée de secours** (offline) garde les
  9 défauts + quelques `lg` courants.
- **Parsing du nom** pour l'affichage : `{lang}_{genre}_{source}_{size}` →
  langue (`fr`), genre (`core`/`dep`/`ent`), source (`news`/`web`/`wiki`),
  taille (`sm`/`md`/`lg`/`trf`).
- **Tailles** (pas dans `compatibility.json`) : ✅ petite **table statique** indicative
  par famille (`sm≈12-15`, `md≈40-50`, `lg≈400-560`, `trf≈400+` Mo) ; affinage optionnel
  via **HEAD `Content-Length`** sur l'URL du wheel quand l'utilisateur déplie une langue
  (réseau, peu d'appels). Décision ouverte (cf. §10).

## 3. Modèle actif par langue (nouvelle préférence)

Aujourd'hui `annotator._DEFAULT_MODEL_BY_LANG` fige un modèle par langue.

**Nouveau** : préférence `active_model_by_lang: {lang → model_name}` qui **prime** sur le
défaut.

- **Stockage** : ✅ **global**, fichier `.active_models.json` dans `spacy_models_dir`
  (les modèles sont globaux/partagés entre corpus → le choix l'est aussi). Alternative :
  prefs par-DB (rejetée : un même chercheur veut son `lg` partout).
- `_model_for_language(lang)` : si `active_model_by_lang[base_lang]` défini **et
  disponible** → l'utiliser ; sinon fallback `_DEFAULT_MODEL_BY_LANG`.
- Contrainte : on ne peut activer qu'un modèle **disponible** (sinon l'UI propose
  d'abord « Télécharger », puis « Définir comme actif »). `clear_model_cache()` après
  changement d'actif.

## 4. API moteur

```
list_models(language=None) -> list[ModelInfo]
    # ModelInfo: name, language, genre, size_class, approx_size_mb,
    #            source ("bundled"|"downloaded"|"absent"), version|None, active: bool
    # Sans filtre: catalogue complet (compat.json ∪ bundled ∪ downloaded), groupé par langue.
    # Avec ?language=fr: seulement les modèles de la langue (UI au déploiement).
set_active_model(language, name)   # valide dispo ; persiste ; clear_model_cache()
resolve_download / install_model / remove_model
    # allowlist = compat.json + regex ; remove refuse un modèle 'bundled' (lecture seule)
```

- **Détection `bundled`** : `importlib.util.find_spec(name) is not None` (ou
  `spacy.util.is_package`) dans le process sidecar.
- **Contrat** : `GET /models` gagne `source`/`active`/`genre`/`size_class` (additif) ;
  nouvelle route **`POST /models/active`** `{language, model}` (écriture →
  `_WRITE_PATHS`). Bump `CONTRACT_VERSION` + régénération `openapi.json` + snapshot.

## 5. Endpoints sidecar

| Route | Type | Détail |
|-------|------|--------|
| `GET /models` (`?language=`) | lecture | catalogue + statut (`bundled`/`downloaded`/`absent`) + `active` |
| `POST /models/download` `{model}` | job async | allowlist = `compatibility.json` |
| `POST /models/remove` `{model}` | écriture | refuse un modèle `bundled` |
| `POST /models/active` `{language, model}` | écriture | définit le modèle actif d'une langue |

## 6. UI (composant partagé `ModelManager`)

- **Paramètres** : un **sélecteur de langue** (les langues supportées). En sélectionnant
  une langue, on déplie ses modèles (`sm`/`md`/`lg`/`trf`) avec, par ligne : statut
  (**Intégré** / **Installé · version** / **Absent**), taille, **Télécharger** /
  **Supprimer** (masqué si `bundled`), et un **radio « Actif »** (le modèle utilisé pour
  annoter cette langue).
- **AnnotationView (bande in-context)** : « Modèle actif pour {langue} : **{X}** » ; si
  absent → Télécharger ; lien « Gérer les modèles » → Paramètres.
- Reste **un seul composant** monté aux deux endroits (exigence A+B du design initial).

## 7. Double distribution (build + CI)

- **`build_sidecar.py`** : flag `--bundle-models {none|default}` (✅ défaut **`none`**).
  `none` = saute la boucle `--collect-all` (léger) ; `default` = embarque les 9
  `_DEFAULT_MODEL_BY_LANG` (tout-en-un). *(Embarquer « tout » est exclu : trop lourd.)*
  Au-delà des 9, **tout se télécharge à la demande dans les deux variantes** (y compris
  `lg`/`trf`).
- **CI** (`tauri-shell-build.yml` / `release.yml`) : produire **deux artefacts** par OS :
  - **light** (par défaut) : pas de `spacy download`, `--bundle-models none` → installeur **~130 Mo**.
  - **full** : `spacy download` des 9 + `--bundle-models default` → installeur **~530 Mo**.
  - **budgets de taille par variante** ; ~2× le temps de build par release (✅ accepté).
- **Page Releases** : ✅ publier **les deux** ; le **light est le défaut** mis en avant
  (le full clairement étiqueté « hors-ligne / tout-en-un »).
- **Nommage** : décision ouverte (§10). Proposition : light = nom actuel
  `AGRAFESShell_<ver>_x64-setup.exe` ; full = `AGRAFESShell_<ver>_x64-full-setup.exe`.

## 8. Sécurité & robustesse

- Allowlist dynamique (`compatibility.json`) + regex stricte ; https, hôte figé.
- `lg`/`trf` lourds (400-560 Mo) → **avertir avant download**, vérifier l'espace disque ;
  l'anti-zip-slip + install atomique + `.part` existants s'appliquent.
- `remove` refuse un modèle `bundled` (lecture seule dans le bundle figé).
- Table épinglée de secours si `compatibility.json` injoignable.

## 9. Découpage en phases (chacune livrable)

1. **Lot 1 — cohérence (rapide, indépendant)** : `list_models` détecte `bundled` + champ
   `source` ; UI affiche **« Intégré »** au lieu de « Absent » ; `remove` refuse un
   bundlé. Bump contrat. *Corrige le bug actuel sans rien d'autre.*
2. **Lot 2 — double distribution** : flag `--bundle-models`, CI deux variantes, nommage,
   budgets, page Releases.
3. **Lot 3 — catalogue étendu** : catalogue dérivé de `compatibility.json` (allowlist
   dynamique), parsing nom + tailles, UI sélecteur de langue + modèles groupés.
4. **Lot 4 — sélection du modèle actif** : `active_model_by_lang`, `POST /models/active`,
   intégration annotateur, UI radio « Actif » + bande AnnotationView.

   *(Lots 3 et 4 peuvent fusionner ; 1 et 2 sont indépendants l'un de l'autre.)*

## 10. Décisions restant à confirmer

- **Nommage des deux installeurs** (proposé : `…-setup.exe` léger / `…-full-setup.exe`).
- **Affichage des tailles** : table statique seule, ou + HEAD `Content-Length` à la demande.
- **Stockage du modèle actif** : global (proposé) vs par-corpus.
- **Variante full** : limiter aux 9 défauts (proposé) ou jeu configurable.
- **Version cible** : 0.4.0 (catalogue étendu = changement notable) — à confirmer au moment du ticket.
