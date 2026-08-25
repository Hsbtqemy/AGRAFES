# Explorer autonome — note de conception

**Statut** : conception. Rien n'est codé. Chantier `EXP-01` (`pilotage/EXP-01.md`).
**Date** : 2026-08-24. **Périmètre** : `tauri-app`, `tauri-shell`, `sidecar.py`, `cli.py`, packaging.

---

## 0. Ce qu'on veut

Un lecteur — étudiant, collègue, relecteur — doit pouvoir **télécharger une application**,
l'ouvrir sur un corpus, et **consulter et analyser** : concordancier KWIC, recherche
grammaticale CQL, statistiques, collocations, exports de résultats. Il ne constitue pas de
corpus et **ne modifie pas la base**.

Trois contraintes énoncées au cadrage :

1. **Aucune perte de fonctionnalité** par rapport à ce qu'Explorer sait faire aujourd'hui.
2. Le sens premier de « téléchargement » est **télécharger l'application**. Télécharger un
   corpus, exporter ses résultats, ouvrir un package publié sont souhaitables mais viennent après.
3. Les métadonnées et les documents restent utiles, **mais repensés** : pas d'édition —
   une *fiche technique* (générale + détail) construite à partir de ce qui a été rempli dans Prep.
4. **La diffusion est délibérément étroite.** C'est un outil universitaire : le second
   livrable sert aussi à *maîtriser qui a accès à quoi*. Explorer ne fait donc **aucune
   publicité pour Constituer** — pas de lien de téléchargement, pas de mention d'une
   version complète. Ce qui est retiré du profil est retiré, pas montré comme verrouillé.

---

## 1. Ce qu'est Explorer aujourd'hui (mesuré)

Explorer n'est pas une application : c'est un **mode du shell**, avec deux sous-onglets
(`tauri-shell/src/modules/explorerModule.ts`, 313 l.) :

| Sous-onglet | Code | Endpoints |
|---|---|---|
| Concordancier | `tauri-app` (`initApp`) | `/query`, `/query/facets`, `/documents`, `/families`, `/tags`, `/stats/lexical`, `/stats/compare` |
| Recherche grammaticale | `rechercheModule.ts` (2 949 l.) | `/token_query`, `/token_stats`, `/token_collocates`, `/export/token_query_csv` |

Le couplage au shell est **mince** : `ShellContext` (`src/context.ts`, 18 l.) ne porte que
`getDbPath()` et `onDbChange()`. Tout le reste vient des imports source de `tauri-app`,
`tauri-prep/src/lib` (`sidecarClient`, `safeHtml`) et `shared/`.

Poids du front bâti (`tauri-shell/dist/assets`) : `constituerModule` **564 KiB**,
`explorerModule` **151 KiB**, `rechercheModule` **68 KiB**, `index` **103 KiB**, CSS **148 KiB**.

Poids du moteur embarqué : le sidecar PyInstaller pèse **223,91 MiB**
(`sidecar-manifest.json`, onefile, 0.4.0, build du 24 août) — **sans les modèles spaCy**,
absents de cette machine. La CI, elle, télécharge **neuf modèles** avant de builder
(`release.yml` l. 66-74, `tauri-shell-build.yml` l. 99) ; le budget dur est de **350 MiB**
en onefile (`bench/fixtures/sidecar_size_budget.json`).

**La pile de requête n'utilise pas spaCy** : `token_query.py`, `token_stats.py`,
`token_collocates.py`, `cql_parser.py` et `query.py` n'en importent rien. spaCy ne sert
qu'à `annotator.py` (`POST /annotate`) et à `models_service.py`. Dans l'environnement de
build local, `spacy` + `numpy` + `blis` + `thinc` + `srsly` pèsent **151,5 MiB** non compressés.

---

## 2. Constats

| Code | Sévérité | Constat |
|---|---|---|
| EXA-01 | 🔴 | Explorer **écrit déjà** dans la base : `⬆ Importer…` et `⟳ Réindexer` (`tauri-app/src/ui/buildUI.ts:241-242`) appellent `POST /import` et `POST /index`. |
| EXA-02 | 🟠 | Le panneau métadonnées du concordancier écrit un rôle d'unité : `POST /units/set_role` (`tauri-app/src/lib/sidecarClient.ts:603`). |
| EXA-03 | 🔴 | **Ouvrir** un corpus le modifie : `cmd_serve` applique les migrations, insère une ligne `runs` (`create_run`) et crée `<db_dir>/runs/<id>/run.log` ; `get_connection` pose `PRAGMA journal_mode=WAL` (fichiers `-wal`/`-shm`) ; le portfile `.agrafes_sidecar.json` est écrit à côté de la base. **Mesuré (§4.1) : 4 fichiers apparaissent à la seule ouverture, et l'empreinte de la base change.** |
| EXA-04 | 🟠 | **Chaque recherche** écrit : `/query` et `/token_query` insèrent une ligne `runs` sous verrou d'écriture (`sidecar.py:2009` et `:2153`). **Mesuré : +2 et +1 lignes pour trois requêtes.** |
| EXA-05 | 🟡 | Des lectures écrivent : `GET /corpus/info` appelle `ensure_corpus_info_row` (INSERT) ; les handlers documents backfillent des colonnes manquantes (`_ensure_document_workflow_columns`, ALTER TABLE) sur schéma ancien. |
| EXA-06 | 🟠 | `_WRITE_PATHS` (65 routes) mélange écriture-base et écriture-fichier : **12 routes** n'écrivent que sur le disque (11 exports + `/db/backup`). Un « refus global des write paths » couperait les exports d'analyse qu'on veut garder. |
| EXA-07 | 🟠 | Le poids du téléchargement est **le sidecar**, pas le JS : 223,91 MiB contre 564 KiB de code Constituer. Le seul levier réel est un preset sans spaCy — **mesuré le 25 août : 16,03 MiB, soit −207,88 MiB (−92,8 %)**, sans rien perdre de la consultation (§6). Le preset n'existe pas dans le dépôt. |
| EXA-08 | 🟡 | L'export CSV de la recherche grammaticale a une **seconde entrée dans le mode « Publier »** (`shell.ts:2889`, `_renderRgExportCard`, lit `agrafes.rg.lastQuery`). Sans Publier, elle disparaît — perte de fonctionnalité. |
| EXA-09 | 🟡 | La **recherche fédérée** multi-corpus existe (`/query` accepte `db_paths`, `sidecar.py:2016`) mais se pilote par un textarea de chemins bruts (`features/filters.ts:286`) : inutilisable pour un lecteur qui a téléchargé deux corpus. |
| EXA-10 | 🟠 | Aucune **politique de version de schéma** en lecture : si l'ouverture cesse de migrer, un Explorer plus récent (ou plus ancien) que la base n'a pas de conduite définie. Le cas n'est pas théorique — **le corpus démo livré dans le dépôt est 25 migrations en retard** (12 enregistrées contre 37 fichiers) : la toute première chose qu'un nouvel utilisateur ouvre serait migrée sous ses pieds. |
| EXA-11 | 🟡 | Les métadonnées ne sont consultables que dans `MetadataScreen` (Constituer), un écran d'**édition** : aucune fiche en lecture, alors que tout est déjà servi par des GET. |
| EXA-12 | 🔴 | Le sidecar est **découvert par portfile** et adopté s'il tourne déjà. **Prouvé (§4.2)** : un second processus lancé sur la même base répond `already_running`, **rend le jeton d'écriture**, et une écriture passe par le sidecar adopté. Un Explorer « lecture seule » lancé après Constituer hérite de ses droits — la garantie ne peut pas vivre dans les seuls arguments de lancement d'Explorer. |
| EXA-13 | 🟡 | Une consultation écrit un fichier de **télémétrie** à côté du corpus : `.agrafes_telemetry.ndjson`, sans condition ni retrait possible (`telemetry.py`, appelé depuis `sidecar.py:847`). Local, sans réseau — mais c'est une écriture, sur un corpus qu'on a promis de ne pas toucher et qui peut ne pas appartenir au lecteur. Trouvé par la mesure, pas par la lecture du code. |

---

## 3. Forme du livrable — trois options

| | A. Second bundle du même shell | B. App dédiée `tauri-explorer` | C. Mode lecture au runtime |
|---|---|---|---|
| Code front à écrire | conf + garde de profil | portage de ~3 100 l. de `shell.ts` | garde de profil |
| Réutilise MRU, deep-link, démo, diagnostics, mises à jour | oui, tel quel | à porter ou extraire en `shared/` | oui |
| L'utilisateur télécharge Constituer | non | non | **oui** |
| Gain de poids | 564 KiB de JS (0,25 % de l'installeur) | idem | nul |

**Mesure qui tranche** : sur les 3 640 lignes de `shell.ts`, seul le **wizard Publier**
(l. 2853-3336, 483 l.) et les cartes/onglets associés (~60 l.) sont propres à
Constituer/Publier — soit **~15 %**. Les 85 % restants (barre, sélecteur de base + MRU,
deep-link `agrafes-shell://`, corpus démo, diagnostics, télémétrie, vérification de mise à
jour, raccourcis, bannières, overlay de démarrage) servent Explorer autant que Prep.

**Recommandation : A.** L'option B fait réécrire 85 % d'un fichier pour économiser 564 KiB
sur un installeur qui pèse 224 MiB. Le vrai allègement est ailleurs (§6).

### 3.1 Le profil de build, mesuré

L'affirmation « Vite élimine le code de Prep » a été **vérifiée le 25 août** : garde
`import.meta.env.VITE_PROFILE !== "explorer"` posée sur l'`import()` dynamique de
`constituerModule`, deux builds comparés chunk par chunk.

| | Base | Profil explorer |
|---|---|---|
| `constituerModule.js` | 573 KiB | **absent** |
| `constituerModule.css` | 7 KiB | **absent** |
| `search.js`, `telemetry.js` | 5 + 0 KiB | absents |
| `explorerModule` + `recherche` | 219 KiB | 218 KiB |
| **Total des assets** | **1 290 KiB** | **706 KiB (−45 %)** |

Le JavaScript de Prep part réellement : les marqueurs `Pré-remplir` et
`/segment/paragraph_boundary`, présents dans la base, sont **absents** du bundle explorer.
L'élimination fonctionne.

**Mais le CSS ne part pas.** `index.css` pèse 149 KiB dans les deux profils, et il contient
toujours `prep-actions-screen`, `prep-canvas`, `prep-state-`. La cause est nette :
`tauri-shell/src/main.ts` (l. 5-10) importe **six feuilles de Prep en statique**, dont
`app.css` à lui seul 215 KiB de source. Une garde sur l'`import()` dynamique ne les touche
pas — elles sont dans l'entrée.

Deux conséquences pour le lot 2 : le profil n'est pas une ligne mais **une ligne plus le
traitement de l'entrée CSS** (déplacer ces imports dans `constituerModule`, ou donner à
Explorer sa propre entrée) ; et la garde doit aussi couvrir ce qui reste visible sans le
module — la carte « Constituer son corpus » de l'accueil survit au profil, marqueur
retrouvé dans `index.js`.

**Corollaire : l'accueil se refait, il ne se grise pas.** Une carte grisée dit « indisponible
pour l'instant » ; ici le module n'est pas dans le bundle, l'`import()` échouerait. Les
surfaces à gater sont quatre, pas une : les cartes d'accueil, les onglets d'en-tête, les
raccourcis ⌘2/⌘3, et le **deep-link** `#constituer` / `?mode=constituer`, que
`_normalizeMode` accepte encore et qui conduirait `_setMode` à charger un chunk absent.
Explorer **ne signale pas** que Constituer existe : la diffusion étroite est un objectif
(§0.4), pas un effet de bord.

Réserve honnête : A fait porter à `shell.ts` une seconde raison de changer, et le fichier
est déjà à 3 640 lignes. Si le second `tauri.conf` se met à diverger (icônes, identifiant,
scheme, version) ou si les gardes de profil se multiplient dans le corps du shell, B
redevient le bon choix. La note dit **par où commencer**, pas où finir.

---

## 4. Lecture seule — trois niveaux

L'intuition « sans Prep, on ne peut pas modifier » est **fausse** : EXA-01 à EXA-05
recensent trois gestes d'écriture dans l'interface d'Explorer et six écritures déclenchées
par la simple ouverture ou une simple recherche.

### 4.1 Ce qu'une consultation écrit, mesuré

Session type sur une copie du corpus démo, avec le binaire sans spaCy — ouvrir, lister,
chercher (KWIC, segment, CQL), statistiques, export CSV, fermer. **Aucun geste d'écriture
n'a été fait.**

| | Résultat |
|---|---|
| Empreinte de la base | `1275e189…` → `45297f4c…` — **elle a changé** |
| Fichiers apparus à la seule ouverture | 4 : `.agrafes_sidecar.json`, `corpus.db-wal`, `corpus.db-shm`, `runs/<id>/run.log` |
| Fichiers restants après fermeture | 3 : `.agrafes_telemetry.ndjson` (110 o), `runs/<id>/run.log`, plus le CSV demandé |
| Lignes ajoutées en base | `schema_migrations` **+25**, `runs` **+4** (1 `serve`, 2 `query`, 1 `token_query`) |

Les `+25` migrations disent que le corpus démo du dépôt est **25 migrations en retard**
(12 enregistrées contre 37 fichiers dans `migrations/`) : l'ouvrir le met à niveau.
La télémétrie (EXA-13) n'avait été vue par aucune lecture de code — c'est la mesure qui
l'a sortie.

### 4.2 L'adoption par portfile, prouvée

Sidecar de référence lancé sur une base (rôle « Constituer »), puis second processus lancé
sur **la même base** (rôle « Explorer ») :

```
statut renvoyé : already_running · port 63314 · pid 27944
jeton d'écriture rendu au second processus : OUI
POST /corpus/info → HTTP 200 · titre du corpus après coup : 'titre posé par le lecteur'
```

Le second processus ne démarre pas de serveur : il **adopte** le premier et en reçoit le
jeton d'écriture. Conséquence directe sur D-EX2 : un Explorer lecture seule ne peut pas se
contenter d'ouvrir sa connexion autrement — il doit **refuser d'adopter** un sidecar
ouvert en écriture, sans quoi il suffit d'avoir lancé Constituer avant pour que la
promesse tombe.

| Niveau | Ce qu'il fait | Ce qu'il couvre | Coût |
|---|---|---|---|
| **N1 — interface** | Explorer n'expose plus les trois gestes | EXA-01, EXA-02 | quelques dizaines de lignes de front, zéro contrat |
| **N2 — moteur** | `multicorpus serve --read-only` : 403 sur les routes qui mutent la **base**, exports disque autorisés | + garantit N1 même si un bouton survit | flag CLI, partition de `_WRITE_PATHS` en *DB* / *fichier* (EXA-06), tests |
| **N3 — base** | ouverture `?mode=ro`, pas de WAL, pas de migration, pas de ligne `runs`, portfile ailleurs | + EXA-03, EXA-04, EXA-05 ; permet un corpus sur support en lecture seule ou partagé | `db/connection.py`, `cli.py`, chemins `_create_run`, `ensure_corpus_info_row`, backfills |

**Proposition : N2 + la partie de N3 qui supprime les écritures d'ouverture et de lecture.**
N2 seul laisserait Explorer écrire une ligne `runs` à chaque recherche — soit exactement la
promesse affichée en tête de l'application, démentie à chaque clic.

Deux conséquences à assumer :

- **`--read-only` n'est pas un mode d'affichage**, c'est un mode de connexion. Le sidecar
  doit refuser d'adopter (et d'être adopté par) un sidecar ouvert en écriture sur la même
  base (EXA-12), sinon la garantie est un vœu.
- **Ne plus migrer à l'ouverture impose une politique** (EXA-10). Proposition : comparer la
  version de schéma, refuser proprement si la base est plus ancienne, avec un message qui
  nomme le geste (« ce corpus doit être ouvert une fois dans AGRAFES Constituer ») plutôt
  que de migrer en douce un fichier qu'on a promis de ne pas toucher.

---

## 5. Fiche technique — les métadonnées en consultation

Remplace l'accès en édition (`MetadataScreen`, Constituer) par **deux niveaux de lecture**,
alimentés par ce que Prep a rempli. Tout existe déjà en GET — **aucun endpoint neuf**,
donc aucun des trois artefacts de contrat :

| Niveau | Contenu | Source |
|---|---|---|
| **Fiche corpus** | titre, description, méta libre ; nombre de documents, langues, unités, tokens ; familles ; conventions ; alertes de complétude | `GET /corpus/info`, `/documents`, `/families`, `/conventions`, `/corpus/audit` |
| **Fiche document** | titre, langue, rôle, type de ressource, auteur, date, éditeur, lieu ; notes (R6.1) ; étiquettes (R6.2) ; borne de début de texte ; stade de préparation, tokens, alignements | `GET /documents`, `/documents/stats?doc_id`, `/tags`, `/doc_relations/all` |

Deux réserves :

- `GET /corpus/info` **écrit** aujourd'hui (EXA-05) : à corriger avant de bâtir la fiche dessus.
- La fiche n'est utile que si Prep a rempli quelque chose. Prévoir un rendu honnête du vide
  (« non renseigné ») plutôt que des sections absentes, pour que le lecteur distingue
  *absent du corpus* de *absent de l'écran*.

---

## 6. Diffusion — « télécharger l'application »

C'est le sens premier de la demande, et c'est là que se trouve le seul gain de poids réel.

- **Preset sidecar `explorer`** : sans spaCy ni modèles. **Mesuré le 25 août 2026**, même
  machine, même PyInstaller 6.18, même format `onefile`, mêmes options — seule la pile
  spaCy retirée des exclusions :

  | | Taille | Écart |
  |---|---|---|
  | Référence (`--preset shell`, 24 août) | **223,91 MiB** | — |
  | Sans spaCy | **16,03 MiB** | **−207,88 MiB · −92,8 %** |

  Les deux binaires ont été soumis **à la même sonde**, sur une copie du corpus démo :
  `/health`, `/documents`, `/models`, `/query`, `/token_query`, `/stats/lexical` —
  **réponses identiques des deux côtés**, dont 3 hits sur 115 en recherche grammaticale.
  La seule divergence est celle qu'on avait annoncée : le job `/annotate` finit en
  `error — spaCy is not installed`. Rien d'autre ne bouge.

  **Portée de la mesure** : la machine de build n'a aucun modèle installé, donc la
  référence n'en embarque aucun non plus (vérifié dans le binaire : `spacy` 1 084
  occurrences, `fr_core_news_md` zéro). La CI, elle, en télécharge neuf avant de builder —
  l'économie réelle sur l'installeur diffusé est donc **au moins** ces 207,88 MiB.
- **Le preset mince démarre aussi plus vite** — trois lancements chacun, jusqu'à ce que
  `/health` réponde : **1,33 s de médiane contre 10,16 s**, et le pire cas observé passe de
  **37,7 s à 1,84 s**. Le shell prévient aujourd'hui que « le 1er lancement peut prendre
  ~30 s » (`shell.ts:2435`) : sur ce binaire, l'avertissement n'a plus d'objet. Mesure à
  n=3 avec un fort écart-type côté référence (antivirus probable sur 224 Mo déballés) —
  l'ordre de grandeur tient, la précision non.
- **Les quatre routes de modèles tiennent** (vérifié le 25 août, à la demande d'une autre
  session) : `GET /models`, `POST /models/active` et `POST /models/remove` répondent **à
  l'identique** avec et sans spaCy — elles lisent le système de fichiers et la base, et le
  test « modèle embarqué » (`_is_model_bundled` → `importlib.util.find_spec`) rend *absent*
  des deux côtés. Première sonde trompeuse (200 contre 400) : c'était l'état du dossier de
  modèles que ma propre sonde avait modifié entre les deux passes, pas spaCy. Rejouée avec
  `AGRAFES_MODELS_DIR` détourné vers un dossier vide, la divergence disparaît. **Seul
  `/annotate` tombe.** Deux réserves : sur un binaire *de CI*, où les neuf modèles sont
  embarqués, `find_spec` les trouve et `source=bundled` existe — le preset explorer les
  perdrait, différence de contenu et non de comportement ; et l'issue du job
  `/models/download` n'a été suivie sur aucun des deux binaires (nom de modèle inexistant
  employé exprès, pour ne rien poser sur la machine).
- **Conséquence produit** : un corpus non annoté ne pourra pas l'être depuis Explorer. La
  recherche grammaticale sait déjà le dire (`rechercheModule` calcule une *portée annotée*
  à partir de `token_count`) ; le message devra nommer le manque, pas rendre zéro résultat.
  Et le message d'erreur du moteur — « Install NLP extras with `pip install .[nlp]` » —
  s'adresse à un développeur : il faudra le réécrire pour un lecteur.
- **Signature** : les chaînes existent (`windows-sign-shell.yml`, `macos-sign-shell.yml`,
  entitlement `disable-library-validation` déjà nécessaire au sidecar). Un second produit =
  un second identifiant, un second scheme de deep-link, un second passage de signature.
- **Version** : `scripts/bump_version.py` ne connaît que `tauri-shell/src-tauri/tauri.conf.json`,
  `shell.ts` (`APP_VERSION`) et `package.json`. Un second `tauri.conf` doit y être ajouté,
  sans quoi la version d'Explorer dérivera en silence — le dépôt interdit l'édition à la main.
- **Corpus démo** : `tauri-shell/public/demo/agrafes_demo.db` (2,2 MiB) est déjà installable
  depuis l'accueil. Explorer devrait s'ouvrir dessus par défaut : une application de lecture
  qui démarre sans rien à lire est une application vide.

---

## 7. Décisions à trancher

| Code | Décision | Proposition |
|---|---|---|
| D-EX1 | Forme du livrable | **A** — second bundle du même shell, profil de build `explorer` (§3) |
| D-EX2 | Niveau d'étanchéité | **N2 + suppression des écritures d'ouverture et de lecture** (§4) |
| D-EX3 | Base plus ancienne que l'Explorer | refus explicite nommant le geste, jamais de migration silencieuse |
| D-EX4 | Sort des trois gestes d'écriture | retirés d'Explorer ; Import, Réindexer et `set_role` restent dans Constituer |
| D-EX5 | Métadonnées | fiche corpus + fiche document en lecture (§5) |
| D-EX6 | Preset sidecar | preset `explorer` sans spaCy — **chiffré : 224 → 16 MiB**, à décider maintenant que le coût est connu |
| D-EX7 | Téléchargement de corpus | hors périmètre du premier livrable ; reposé après diffusion de l'application |

D-EX1 et D-EX2 sont ouvertes : elles ont été explicitement laissées à l'approfondissement.
Les cinq autres sont des propositions que le premier lot peut appliquer sans nouvel arbitrage.

---

## 8. Tranches et coût par artefact

**Lot 1 — moteur, lecture seule** · `cli.py` (`cmd_serve`), `db/connection.py`,
`sidecar.py` (partition de `_WRITE_PATHS`, `_create_run` sur `/query` et `/token_query`,
`ensure_corpus_info_row`, backfills), `runs.py`. Contrat : **un flag CLI n'ajoute aucune
route** — zéro artefact de contrat tant que le refus n'est pas décrit dans l'OpenAPI ; s'il
l'est, ce sont les trois habituels (`sidecar_contract.py` + `docs/openapi.json` +
`tests/snapshots/openapi_paths.json`), plus `docs/SIDECAR_API_CONTRACT.md`.

**Lot 2 — front, profil Explorer** · `tauri-shell/vite.config.ts` (define de profil),
`shell.ts` (garde sur l'`import()` de `constituerModule`, les onglets, les cartes
d'accueil, les raccourcis), **`main.ts` (l. 5-10 : les six imports CSS de Prep, mesurés
comme non éliminés — §3.1)**, `tauri-app/src/ui/buildUI.ts` (retrait des deux boutons),
`features/metaPanel.ts` (retrait de l'écriture de rôle), relogement de l'export RG (EXA-08).

**Lot 3 — fiche technique** · nouvel écran de lecture dans Explorer, aucun endpoint neuf (§5).

**Lot 4 — packaging et diffusion** · `scripts/build_sidecar.py` (preset + exclusions),
`bench/fixtures/sidecar_size_budget.json` (budget propre au preset),
`tauri-shell/src-tauri/tauri.explorer.conf.json`, `.github/workflows/tauri-shell-build.yml`
et `release.yml`, `scripts/bump_version.py`, `docs/RELEASE_CHECKLIST.md`.

**Lot 5 — plusieurs corpus** · sélecteur de corpus fédérés lisible (EXA-09), ouverture d'un
corpus téléchargé, puis seulement ensuite D-EX7.

L'ordre compte : le lot 1 sans le lot 2 laisse des boutons qui échouent en 403 ; le lot 2
sans le lot 1 affiche une promesse que rien ne tient.

---

## 8.1 Séquencement — ce qui dépend de Prep, et ce qui n'en dépend pas

Question posée le 25 août : un changement dans Prep peut-il induire un changement dans
Explorer ? Mesuré sur trois couches.

**Le code : couplage mince.** Les surfaces d'Explorer n'importent de Prep que
`lib/safeHtml.ts` et `lib/sidecarClient.ts` — plus les **six feuilles CSS** de `main.ts`
(§3.1), qui sont le seul vrai fil : le chrome du shell est habillé par le CSS de Prep.

**L'historique : rare.** Sur six mois, **461 commits** touchent Prep, **97** une surface
d'Explorer, **26 les deux**. À la lecture, ces 26 sont presque tous transverses (audits de
sécurité, extraction du `sidecarCore` partagé, releases, fuites de listeners) ou des
fonctions conçues des deux côtés à la fois (`token_stats`, collocations). **Un seul** est
« une notion née dans Prep qui a dû affleurer dans Explorer » : `06dba21`, curation
propagée → badge dans le concordancier.

**Le modèle : c'est là que ça bouge.** Explorer n'est pas couplé au *code* de Prep, il l'est
à sa *production*. Il affiche et filtre `unit_role`, `unit_status`, `doc_role`,
`resource_type`, les étiquettes, les familles, le `token_count` — et surtout **l'unité
elle-même**. Or les quatre chantiers ouverts portent exactement là-dessus : R2 (deux grains
¶ ⊃ phrase, cas blob différé), R5.4 (segmentation configurable — resegmenter déplace toutes
les bornes de KWIC), R4 (vocabulaire des rôles, qui est un filtre d'Explorer), R3
(alignement, que la vue parallèle lit).

**Conséquence, et elle n'est pas binaire :**

| Lot | Dépend de la production de Prep ? |
|---|---|
| **1 — moteur lecture seule** | **non** — `cli.py`, `connection.py`, `_WRITE_PATHS`, `runs` |
| **4 — preset sidecar + diffusion** | **non** — `build_sidecar.py`, budgets, CI, signature |
| 2 — profil front | oui, par le CSS (toute refonte de `app.css` le déplace) |
| 3 — fiche technique | oui, elle lit le modèle de métadonnées |
| 5 — plusieurs corpus | oui, indirectement |

Les lots 1 et 4 — la lecture seule et le binaire de 16 Mo, c'est-à-dire **la promesse et le
livrable** — ne peuvent pas être périmés par le travail en cours sur Prep. Les lots 2, 3 et
5 gagnent à attendre que `refonte` redescende sur `dev`.

---

## 9. Ce que la note ne tranche pas

- Le sort de `tauri-app` comme application autonome (BACKLOG P9, « deprecation ») : son
  `src-tauri` existe toujours (identifiant `com.agrafes.concordancier`, scheme `agrafes`).
  Si D-EX1 retient A, cette coquille devient une troisième vérité à supprimer.
- La possibilité d'ouvrir directement un package TEI publié : dépend du lot 5 et de D-EX7.
- Le nom du produit, l'icône, et la question de savoir si Explorer autonome et le shell
  complet peuvent être installés côte à côte sur la même machine.
