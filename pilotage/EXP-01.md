---
chantier: EXP-01
statut: à venir
audit: docs/DESIGN_explorer_autonome.md
---

# EXP-01 — Explorer autonome, consultation et analyse sans écriture

**Point de départ** — cadrage écrit et mesuré, aucune ligne de code ; deux décisions ouvertes (forme du livrable, niveau d'étanchéité), 24 août 2026.

## Reste

### Décisions à prendre avant tout code

- [ ] D-EX1 — trancher la forme du livrable : second bundle du même shell (recommandé, §3 de la note) ou application `tauri-explorer` dédiée
- [ ] D-EX2 — trancher le niveau d'étanchéité : interface seule, `serve --read-only`, ou base ouverte en `mode=ro` (recommandé : moteur + suppression des écritures d'ouverture et de lecture)
- [ ] EXA-10 — trancher la conduite quand la base est d'un schéma plus ancien que l'Explorer, puisque l'ouverture ne migrera plus : refus nommant le geste, ou migration d'une copie — le corpus démo du dépôt est lui-même **25 migrations en retard** (12 contre 37)

### Moteur — la lecture seule n'existe pas encore

- [ ] EXA-03 — supprimer les écritures d'ouverture : mesuré le 25 août, **4 fichiers apparaissent à la seule ouverture** (portfile, `-wal`, `-shm`, `runs/<id>/run.log`) et l'empreinte de la base change
- [ ] EXA-04 — supprimer la ligne `runs` insérée par `/query` (`sidecar.py:2009`) et `/token_query` (`:2153`) : une recherche ne doit pas écrire, ni prendre le verrou d'écriture — mesuré à +4 lignes pour une session de trois requêtes
- [ ] EXA-05 — corriger les lectures qui écrivent : `ensure_corpus_info_row` sur `GET /corpus/info`, backfill de colonnes `_ensure_document_workflow_columns`
- [ ] EXA-06 — partitionner `_WRITE_PATHS` (65 routes) entre mutation de base et écriture de fichier : les 12 routes d'export doivent rester ouvertes en lecture seule
- [ ] EXA-12 — faire refuser l'adoption d'un sidecar ouvert en écriture : **prouvé le 25 août**, le second processus reçoit `already_running` **et le jeton d'écriture**, et une écriture passe (`POST /corpus/info` → 200, titre modifié)
- [ ] EXA-13 — trancher le sort de `.agrafes_telemetry.ndjson`, écrit à côté du corpus pendant une simple consultation, sans condition ni retrait possible

### Front — le profil Explorer

- [ ] EXA-01 — retirer les gestes d'écriture du concordancier : boutons « ⬆ Importer… » et « ⟳ Réindexer » (`tauri-app/src/ui/buildUI.ts:241-242`)
- [ ] EXA-02 — retirer l'écriture de rôle d'unité du panneau métadonnées (`POST /units/set_role`, `tauri-app/src/lib/sidecarClient.ts:603`)
- [ ] EXA-08 — reloger l'export CSV de la recherche grammaticale, dont la seconde entrée vit dans le mode « Publier » (`shell.ts:2889`) qu'Explorer n'aura pas
- [ ] Refaire l'accueil du profil plutôt que griser : sans le module dans le bundle, la carte « Constituer » ne peut pas fonctionner — et gater aussi les onglets, les raccourcis ⌘2/⌘3 et le deep-link `?mode=constituer`, qui mène aujourd'hui droit à un `import()` de chunk absent. Aucune mention de Constituer : la diffusion étroite est un objectif
- [ ] Traiter l'entrée CSS du profil : `main.ts` importe six feuilles de Prep en statique (`app.css` 215 KiB à elle seule), qu'aucune garde sur l'`import()` dynamique n'élimine — mesuré le 25 août
- [ ] EXA-11 — remplacer l'accès aux métadonnées par une fiche technique en lecture (corpus + document), alimentée par les GET existants, sans endpoint neuf

### Diffusion — c'est là que pèse le téléchargement

- [ ] EXA-07 — inscrire le preset `explorer` sans spaCy dans `build_sidecar.py`, son budget propre dans `sidecar_size_budget.json` et son job de build : mesuré le 25 août à **16,03 MiB contre 223,91** (−92,8 %), sonde identique des deux côtés, seul `/annotate` tombe
- [ ] Réécrire pour un lecteur le message d'échec de l'annotation, qui dit aujourd'hui « Install NLP extras with `pip install .[nlp]` » (`annotator.py:57`)
- [ ] EXA-09 — rendre la recherche fédérée utilisable par un lecteur : elle se pilote aujourd'hui par un textarea de chemins bruts (`features/filters.ts:286`)

## QA

Aucune passe. À créer au premier lot livré — la plus utile portera sur la promesse elle-même :
ouvrir un corpus, chercher, exporter, et vérifier qu'aucun octet de la base n'a bougé
(empreinte avant/après, absence de `-wal`, de `runs/`, de portfile).

## Contexte

Chantier neuf, ouvert le 24 août 2026 sur une demande de cadrage. Rien n'est codé : la
fiche existe pour porter les décisions et la mesure, pas un reste de travail interrompu.

Le besoin : distribuer une application de **lecture** — concordancier, recherche
grammaticale, statistiques, exports de résultats — à qui consulte un corpus sans le
constituer. Sans perte de fonctionnalité, et sans pouvoir modifier la base.

**Le constat qui commande le chantier** : l'intuition « sans Prep, on ne peut rien
modifier » est fausse. Explorer expose aujourd'hui trois gestes d'écriture (import,
réindexation, rôle d'unité), et sept écritures partent de la simple ouverture ou d'une
simple recherche — migrations, ligne `runs` par recherche, `run.log`, WAL, portfile,
`ensure_corpus_info_row`, fichier de télémétrie. Une application qui affiche « ne modifie pas votre corpus »
dément la promesse au premier clic. C'est le vrai contenu du chantier, bien plus que le
masquage d'onglets.

**Le second constat commande le packaging** : le poids du téléchargement, c'est le sidecar
— 223,91 MiB contre 564 KiB de code Constituer. Retirer Prep du bundle ne gagne rien de
perceptible ; retirer spaCy, si, puisque `token_query`, `token_stats`, `token_collocates`,
`cql_parser` et `query` n'en importent rien.

**Mesuré le 25 août, plus supposé** : le même build sans la pile spaCy sort à **16,03 MiB**
contre 223,91, soit **−207,88 MiB (−92,8 %)**. Même machine, même PyInstaller, même
`onefile`, seules les exclusions changent. Les deux binaires passent la même sonde sur une
copie du corpus démo — `/health`, `/documents`, `/models`, `/query`, `/token_query`,
`/stats/lexical` répondent à l'identique, dont 3 hits sur 115 en recherche grammaticale.
Seul le job `/annotate` tombe, avec le message attendu. Et comme la machine de build n'a
aucun modèle installé, la référence n'en embarque aucun : sur l'installeur diffusé, où la
CI en ajoute neuf, l'économie est **au moins** celle-là. Le binaire mince démarre en outre
en **1,33 s de médiane contre 10,16** (pire cas 1,84 contre 37,7), ce qui prive de son
objet l'avertissement « ~30 s au 1er lancement » du shell.

**Trois mesures du 25 août ont déplacé la fiche**, et deux d'entre elles ont trouvé ce que
la lecture du code avait manqué : une consultation sans le moindre geste d'écriture laisse
**trois fichiers** à côté du corpus — dont un fichier de télémétrie qu'aucune lecture
n'avait signalé — et ajoute **25 lignes** de `schema_migrations` sur le corpus démo du
dépôt, 25 migrations en retard. Et l'adoption par portfile n'est plus un risque déduit :
un second processus reçoit le jeton d'écriture du premier et écrit.

**Le profil de build tient, à une réserve près** (mesuré le 25 août) : avec une garde
`VITE_PROFILE` sur l'`import()` de `constituerModule`, le bundle passe de 1 290 à 706 KiB
(−45 %), `constituerModule.js` (573 KiB) et son CSS disparaissent, et les marqueurs de Prep
ne survivent pas dans le JavaScript. Le **CSS**, lui, ne bouge pas d'un octet : `main.ts`
importe six feuilles de Prep en statique. Le profil est donc une garde **plus** un
traitement de l'entrée CSS — pas la ligne unique annoncée.

**Sur la forme du livrable**, la mesure penche nettement : sur les 3 640 lignes de
`shell.ts`, seuls le wizard « Publier » (483 l.) et les cartes associées sont propres à
Constituer — 15 %. Les 85 % restants (MRU, deep-link, corpus démo, diagnostics,
télémétrie, mises à jour, raccourcis) servent Explorer autant que Prep. Écrire une
application dédiée reviendrait à réécrire ces 85 % pour économiser 0,25 % de l'installeur.
La réserve est réelle malgré tout : un second bundle donne à `shell.ts`, déjà gros, une
seconde raison de changer.

**Séquencement décidé le 25 août : les lots 2, 3 et 5 attendent que `refonte` redescende
sur `dev` ; les lots 1 et 4 n'ont pas à attendre.** Mesuré sur trois couches : le code
d'Explorer n'importe de Prep que `safeHtml`, `sidecarClient` et les six feuilles CSS de
`main.ts` ; sur six mois, 26 commits touchent Prep **et** une surface d'Explorer sur 461 et
97, et un seul est une notion de Prep qui a dû affleurer dans Explorer (`06dba21`, badge de
curation propagée). Le couplage réel n'est pas le code mais **la production** : Explorer
filtre `unit_role`, `unit_status`, les familles, le `token_count`, et affiche l'unité —
soit exactement ce que R2 (deux grains), R5.4 (segmentation configurable), R4 (rôles) et R3
(alignement) déplacent encore. Le lot moteur (lecture seule) et le lot packaging (preset
sans spaCy) ne touchent rien de tout cela.

Collision connue : le lot moteur touche `sidecar.py`, `cli.py`, `db/connection.py` et
`runs.py` — noyau partagé avec A-01 (extraction `services/`, growth gate à +410 / 500) et
avec R5/R6. Toute reprise s'y heurte.

Sources : `docs/DESIGN_explorer_autonome.md` (état des lieux mesuré, constats EXA-01…EXA-13,
décisions D-EX1…D-EX7, tranches), `BACKLOG.md` P9 (deprecation des standalone).
