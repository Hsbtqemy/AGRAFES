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
| EXA-03 | 🔴 | **Ouvrir** un corpus le modifie : `cmd_serve` applique les migrations, insère une ligne `runs` (`create_run`) et crée `<db_dir>/runs/<id>/run.log` ; `get_connection` pose `PRAGMA journal_mode=WAL` (fichiers `-wal`/`-shm`) ; le portfile `.agrafes_sidecar.json` est écrit à côté de la base. |
| EXA-04 | 🟠 | **Chaque recherche** écrit : `/query` et `/token_query` insèrent une ligne `runs` sous verrou d'écriture (`sidecar.py:2009` et `:2153`). |
| EXA-05 | 🟡 | Des lectures écrivent : `GET /corpus/info` appelle `ensure_corpus_info_row` (INSERT) ; les handlers documents backfillent des colonnes manquantes (`_ensure_document_workflow_columns`, ALTER TABLE) sur schéma ancien. |
| EXA-06 | 🟠 | `_WRITE_PATHS` (65 routes) mélange écriture-base et écriture-fichier : **12 routes** n'écrivent que sur le disque (11 exports + `/db/backup`). Un « refus global des write paths » couperait les exports d'analyse qu'on veut garder. |
| EXA-07 | 🟠 | Le poids du téléchargement est **le sidecar**, pas le JS : 223,91 MiB contre 564 KiB de code Constituer. Le seul levier réel est un preset sans spaCy — possible puisque la pile de requête ne l'importe pas. |
| EXA-08 | 🟡 | L'export CSV de la recherche grammaticale a une **seconde entrée dans le mode « Publier »** (`shell.ts:2889`, `_renderRgExportCard`, lit `agrafes.rg.lastQuery`). Sans Publier, elle disparaît — perte de fonctionnalité. |
| EXA-09 | 🟡 | La **recherche fédérée** multi-corpus existe (`/query` accepte `db_paths`, `sidecar.py:2016`) mais se pilote par un textarea de chemins bruts (`features/filters.ts:286`) : inutilisable pour un lecteur qui a téléchargé deux corpus. |
| EXA-10 | 🟠 | Aucune **politique de version de schéma** en lecture : si l'ouverture cesse de migrer, un Explorer plus récent (ou plus ancien) que la base n'a pas de conduite définie. |
| EXA-11 | 🟡 | Les métadonnées ne sont consultables que dans `MetadataScreen` (Constituer), un écran d'**édition** : aucune fiche en lecture, alors que tout est déjà servi par des GET. |
| EXA-12 | 🟠 | Le sidecar est **découvert par portfile** et adopté s'il tourne déjà : deux applications AGRAFES ouvertes sur la même base partagent le même processus. Un Explorer « lecture seule » adoptant un sidecar lancé par Constituer n'aurait aucune garantie. |

`EXA-12` est déduit du protocole d'adoption (`inspect_sidecar_state`, portfile
`.agrafes_sidecar.json`) et **reste à prouver par un test à deux processus** — c'est le
premier item du lot moteur.

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
sur un installeur qui pèse 224 MiB. Le vrai allègement est ailleurs (§6). Le profil se pose
au build (`import.meta.env.VITE_PROFILE`) et rend l'`import()` dynamique de
`constituerModule` statiquement mort — Vite l'élimine, le code de Prep ne part pas dans le bundle.

Réserve honnête : A fait porter à `shell.ts` une seconde raison de changer, et le fichier
est déjà à 3 640 lignes. Si le second `tauri.conf` se met à diverger (icônes, identifiant,
scheme, version) ou si les gardes de profil se multiplient dans le corps du shell, B
redevient le bon choix. La note dit **par où commencer**, pas où finir.

---

## 4. Lecture seule — trois niveaux

L'intuition « sans Prep, on ne peut pas modifier » est **fausse** : EXA-01 à EXA-05
recensent trois gestes d'écriture dans l'interface d'Explorer et six écritures déclenchées
par la simple ouverture ou une simple recherche.

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

- **Preset sidecar `explorer`** : sans spaCy ni modèles. La pile de requête ne les importe
  pas (§1) ; seules `/annotate` et `/models/*` en dépendent, deux routes qu'un lecteur
  n'appelle jamais. Ordre de grandeur libéré : **151,5 MiB** de dépendances non compressées
  côté build local, plus les neuf modèles ajoutés en CI. **Le chiffre exact ne sera connu
  que par un build** — c'est le premier item du lot packaging, pas une promesse de la note.
- **Conséquence produit** : un corpus non annoté ne pourra pas l'être depuis Explorer. La
  recherche grammaticale sait déjà le dire (`rechercheModule` calcule une *portée annotée*
  à partir de `token_count`) ; le message devra nommer le manque, pas rendre zéro résultat.
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
| D-EX6 | Preset sidecar | preset `explorer` sans spaCy, chiffré par un build avant décision définitive |
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
`shell.ts` (garde sur les onglets, cartes d'accueil, raccourcis), `tauri-app/src/ui/buildUI.ts`
(retrait des deux boutons), `features/metaPanel.ts` (retrait de l'écriture de rôle),
relogement de l'export RG (EXA-08).

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

## 9. Ce que la note ne tranche pas

- Le sort de `tauri-app` comme application autonome (BACKLOG P9, « deprecation ») : son
  `src-tauri` existe toujours (identifiant `com.agrafes.concordancier`, scheme `agrafes`).
  Si D-EX1 retient A, cette coquille devient une troisième vérité à supprimer.
- La possibilité d'ouvrir directement un package TEI publié : dépend du lot 5 et de D-EX7.
- Le nom du produit, l'icône, et la question de savoir si Explorer autonome et le shell
  complet peuvent être installés côte à côte sur la même machine.
