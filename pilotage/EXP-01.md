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
- [ ] EXA-10 — trancher la conduite quand la base est d'un schéma plus ancien que l'Explorer, puisque l'ouverture ne migrera plus : refus nommant le geste, ou migration d'une copie

### Moteur — la lecture seule n'existe pas encore

- [ ] EXA-03 — supprimer les écritures d'ouverture : migrations appliquées par `cmd_serve`, ligne `runs` insérée, `runs/<id>/run.log` créé, WAL posé sur le fichier, portfile écrit à côté de la base
- [ ] EXA-04 — supprimer la ligne `runs` insérée par `/query` (`sidecar.py:2009`) et `/token_query` (`:2153`) : une recherche ne doit pas écrire, ni prendre le verrou d'écriture
- [ ] EXA-05 — corriger les lectures qui écrivent : `ensure_corpus_info_row` sur `GET /corpus/info`, backfill de colonnes `_ensure_document_workflow_columns`
- [ ] EXA-06 — partitionner `_WRITE_PATHS` (65 routes) entre mutation de base et écriture de fichier : les 12 routes d'export doivent rester ouvertes en lecture seule
- [ ] EXA-12 — prouver par un test à deux processus ce qui arrive quand un Explorer lecture seule adopte, par portfile, un sidecar déjà lancé en écriture par Constituer

### Front — le profil Explorer

- [ ] EXA-01 — retirer les gestes d'écriture du concordancier : boutons « ⬆ Importer… » et « ⟳ Réindexer » (`tauri-app/src/ui/buildUI.ts:241-242`)
- [ ] EXA-02 — retirer l'écriture de rôle d'unité du panneau métadonnées (`POST /units/set_role`, `tauri-app/src/lib/sidecarClient.ts:603`)
- [ ] EXA-08 — reloger l'export CSV de la recherche grammaticale, dont la seconde entrée vit dans le mode « Publier » (`shell.ts:2889`) qu'Explorer n'aura pas
- [ ] EXA-11 — remplacer l'accès aux métadonnées par une fiche technique en lecture (corpus + document), alimentée par les GET existants, sans endpoint neuf

### Diffusion — c'est là que pèse le téléchargement

- [ ] EXA-07 — mesurer par un build réel le poids d'un preset sidecar sans spaCy, puis décider : 223,91 MiB aujourd'hui, budget 350 MiB, et la pile de requête n'importe pas spaCy
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
réindexation, rôle d'unité), et six écritures partent de la simple ouverture ou d'une
simple recherche — migrations, ligne `runs` par recherche, `run.log`, WAL, portfile,
`ensure_corpus_info_row`. Une application qui affiche « ne modifie pas votre corpus »
dément la promesse au premier clic. C'est le vrai contenu du chantier, bien plus que le
masquage d'onglets.

**Le second constat commande le packaging** : le poids du téléchargement, c'est le sidecar
— 223,91 MiB contre 564 KiB de code Constituer. Retirer Prep du bundle ne gagne rien de
perceptible ; retirer spaCy, si, puisque `token_query`, `token_stats`, `token_collocates`,
`cql_parser` et `query` n'en importent rien. Le chiffre exact demande un build : il est
inscrit comme mesure à faire, pas comme gain acquis.

**Sur la forme du livrable**, la mesure penche nettement : sur les 3 640 lignes de
`shell.ts`, seuls le wizard « Publier » (483 l.) et les cartes associées sont propres à
Constituer — 15 %. Les 85 % restants (MRU, deep-link, corpus démo, diagnostics,
télémétrie, mises à jour, raccourcis) servent Explorer autant que Prep. Écrire une
application dédiée reviendrait à réécrire ces 85 % pour économiser 0,25 % de l'installeur.
La réserve est réelle malgré tout : un second bundle donne à `shell.ts`, déjà gros, une
seconde raison de changer.

Collision connue : le lot moteur touche `sidecar.py`, `cli.py`, `db/connection.py` et
`runs.py` — noyau partagé avec A-01 (extraction `services/`, growth gate à +410 / 500) et
avec R5/R6. Toute reprise s'y heurte.

Sources : `docs/DESIGN_explorer_autonome.md` (état des lieux mesuré, constats EXA-01…EXA-12,
décisions D-EX1…D-EX7, tranches), `BACKLOG.md` P9 (deprecation des standalone).
