---
chantier: ACT-01
statut: à venir
---

# ACT-01 — la page Actions : une liste de documents qui ne sert à rien

**Point de départ** — demande de refonte de la présentation, écran mesuré au code, aucune ligne écrite, 26 août 2026.

## Reste

- [ ] **Trancher le geste central de la page** — choisit-on d'abord un document puis une action, ou d'abord une action puis un document ? Aujourd'hui la page pose les deux côte à côte sans les relier, et c'est de là que vient l'impression que la liste ne sert à rien
- [ ] **Rendre la liste de documents vivante** — `#act-doc-list` n'apparaît qu'une fois dans l'écran, à la ligne qui la remplit (`ActionsScreen.ts:607`). Aucun écouteur, aucune sélection, aucun lien : les lignes portent une classe `prep-meta-doc-row` que personne n'écoute. Elle ne peut RIEN transmettre aux quatre cartes
- [ ] **Ajouter l'état par étape sur chaque ligne** — c'est ce qui donnerait un intérêt à la présence des documents dans cette fenêtre : voir d'un coup d'œil ce qui reste à faire, et sur quoi. Trois des quatre étapes sont gratuites (voir le tableau de coût ci-dessous)
- [ ] **La curation est la seule étape sans état par document** — décider si on en crée un (le moteur ne stocke rien : `docs_curated` est un champ de *réponse* de `CurateResponse`, pas un état), ou si la carte Curation reste sans témoin pendant que les trois autres en ont un. Une colonne vide sur quatre est pire qu'un choix assumé
- [ ] Décider du sort des **deux vues** de la liste (liste plate / hiérarchie, `#act-hub-hierarchy-btn`) : elles affichent les mêmes cinq colonnes, la seconde ajoutant l'indentation et un badge de relation. Si la refonte ajoute de l'état, vérifier qu'il tient dans les deux, ou n'en garder qu'une
- [ ] Décider si les cartes gardent leur numérotation « Étape 1 / 2 / 3 / Optionnel » — elle décrit un pipeline, alors que `DESIGN_peritext_conventions` §0 pose l'inverse : les documents arrivent à n'importe quel stade et les capacités sont indépendantes. Une liste qui montrerait l'état réel rendrait cette numérotation soit inutile, soit fausse
- [ ] Vérifier le doublon d'actualisation : deux boutons de rechargement coexistent, `#act-hub-refresh-corpus-btn` en tête et `#act-hub-refresh-btn` sur la carte des documents
- [ ] Décider ce que devient la carte de tête « Traitement de corpus » si les documents et les actions fusionnent — elle ne porte qu'un titre, une phrase et un bouton

## QA

Aucune passe pour l'instant : l'écran change de forme avant de se vérifier. Une passe
deviendra utile quand la liste portera de l'état — elle vérifiera que l'état affiché
correspond au document (un document non segmenté ne doit pas s'annoncer segmenté), ce
qui est mesurable en base, contrairement à l'impression d'utilité.

## Contexte

**Ce que la page présente.** Six blocs, empilés verticalement
(`tauri-prep/src/lib/actionsHubTemplate.ts`) :

| bloc | ligne | contenu |
|---|---|---|
| carte de tête « Traitement de corpus » | `:9` | titre, une phrase, un bouton Actualiser |
| carte « Documents du corpus » | `:21` | la liste, + Actualiser + bascule Hiérarchie |
| carte Curation — « Étape 1 » | `:32` | icône, titre, description, bouton Ouvrir |
| carte Segmentation — « Étape 2 » | `:43` | idem |
| carte Alignement — « Étape 3 » | `:54` | idem + un second bouton, Contrôle |
| carte Annotation — « Optionnel » | `:66` | idem |

Les documents sont donc AU-DESSUS, les actions EN DESSOUS, dans un conteneur séparé
(`prep-acts-hub-workspace`). Rien ne circule de l'un à l'autre.

**Ce que la liste affiche, et ce qu'elle fait.** Cinq colonnes — N°, Titre, Langue, Rôle,
Unités — identiques dans les deux vues (`ActionsScreen.ts:620` pour la liste plate,
`:663` pour la hiérarchie). Et elle ne fait **rien** : les cellules sont construites en
`textContent`, la ligne reçoit une classe, et aucun écouteur n'est posé. On peut lire, pas
cliquer. C'est la réponse mécanique à « on ne voit pas trop l'intérêt que ce soit présent
dans cette fenêtre » : ce n'est pas une impression, la liste est inerte.

**Ce qu'on pourrait afficher, et ce que ça coûte.** Mesuré sur les types déjà servis, pas
estimé — c'est le point qui commande le découpage en tranches.

| étape | état disponible | d'où | coût |
|---|---|---|---|
| Segmentation | `segmented` (booléen) + `seg_count` | `FamilyChildEntry`, servi dans `FamilyRecord.children` | **front pur** |
| Alignement | `aligned_to_parent` (booléen) | idem | **front pur** |
| Annotation | `annotation_status` (`missing`/`annotated`) + `token_count` | `DocumentRecord`, déjà chargé | **front pur** |
| Curation | **aucun** | — | moteur : rien n'est stocké |

`getFamilies` est déjà appelé ailleurs dans Prep : les trois premières colonnes ne
demandent aucune route nouvelle, aucune migration, aucun artefact de contrat. Le
déséquilibre est donc net et il faut le trancher explicitement, sans quoi la refonte
livrera trois témoins et un trou.

**Ce que `DocumentRecord` porte déjà et que l'écran jette.** Au-delà des cinq colonnes :
`workflow_status` (draft/review/validated), `validated_at`, `resource_type`,
`text_start_n` (la borne début-de-texte), `fts_stale` (l'index de recherche est périmé
pour ce document), auteur, traducteur, titre d'œuvre, date, éditeur, notes. L'écran en
affiche cinq et laisse le reste. `fts_stale` est le plus parlant des oubliés : c'est un
état qui appelle une action, et il n'est visible nulle part ici.

**Une précaution tirée d'un cas voisin.** Un écran peu utilisé n'est pas un écran sans
valeur — l'usage faible peut venir d'un blocage en amont. Ici la mesure dit précisément
où est le blocage : la liste ne porte ni état ni interaction, donc rien n'invite à s'en
servir. C'est un défaut d'écran, pas un défaut de besoin.

Pas de champ `audit:` : aucun audit ne porte cet écran, les mesures ci-dessus en sont la
seule source.
