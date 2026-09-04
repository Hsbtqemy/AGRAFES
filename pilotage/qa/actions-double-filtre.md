---
passe: Actions — le double filtre
chantier: ACT-01
duree: 12 min
derniere: 2026-09-04
---

# QA — les quatre piles du bandeau de filtre

Le filtre de la page Actions avait cessé de trier. Tant qu'aucune coche n'existe, les
quatre capacités concernent le corpus entier : les quatre boutons annonçaient « Voir les
58 » et n'ôtaient aucune ligne. Les piles resserrent au sein de la capacité choisie —
**jamais commencé**, **en cours**, **faits**, ou tout ce qui reste **à traiter** — et la
petite, « en cours », est celle qu'on ne pouvait pas atteindre : finir ce qui est commencé.

Cette passe couvre ce que **91 tests** ne peuvent pas voir (`actionsHubState` et
`ActionsScreen.hubFilter`, comptés le 4 septembre) : que le bandeau se lit, que les
comptes correspondent au corpus réel, et que les trois cas de sortie ne laissent jamais
une liste vide sans explication.

**Le 4 septembre 2026, le bandeau a gagné une quatrième pile.** « faits » n'existait pas,
et « Tous » ne comptait pas le corpus mais son complément — tout ce qui n'est pas validé.
Le mot passait tant qu'aucune case n'était cochée, et mentait dès la première. Huit points
de cette passe décrivaient l'ancien bandeau : ils ont été réécrits, décochés, puis
**rejoués le jour même**. Ce qui est demandé ici est donc à jour ; le tableau ci-dessous
vaut, comme avant, pour un corpus sans coche vive.

Elle **remplace la zone « Le filtre et la liste »** de `qa/actions-action-dabord.md`, que
le tri-état avait invalidée.

## Avant de jouer

Mêmes préalables que `qa/actions-tri-etat.md` — binaire reconstruit, contrat **1.6.88**
au minimum, lancement par le shell. Le double filtre est purement front : aucune route,
aucune migration, rien à vérifier côté moteur au-delà du contrat.

Cette passe **ne pose qu'une coche**, au dernier bloc, et demande de la retirer.

## Comptes attendus

Mesurés le 1er septembre sur `corpus_agrafes.WORKCOPY.db`, 58 documents, **aucune coche
vive**. À re-mesurer avant de jouer : ces nombres bougent dès qu'on travaille.

| capacité | jamais commencé | en cours | faits | à traiter |
|---|---|---|---|---|
| Curation | 56 | **2** | 0 | 58 |
| Segmentation | **0** | 58 | 0 | 58 |
| Alignement | 37 | **21** | 0 | 58 |
| Annotation | 50 | **8** | 0 | 58 |

Les trois premières colonnes **partitionnent le corpus** : leur somme fait 58 sur chaque
ligne, et c'est vrai quel que soit le nombre de coches. « À traiter » n'est pas une
cinquième catégorie mais le raccourci des deux premières — c'est ce que « Tous » prétendait
être avant de compter, à tort, la même chose sous un nom qui promettait le corpus entier.

**« En cours » ne veut pas dire la même chose partout**, et le libellé unique le cache.
La pile regroupe ce dont le moteur a vu une trace sans que personne ait validé — mais la
trace diffère : pour la **curation**, une passe a été appliquée (`curated_at`) ; pour
l'**alignement**, des liens existent ; pour l'**annotation**, des tokens existent ; pour
la **segmentation**, l'import a découpé. Aucune ne signifie « à moitié fait » ni
« presque propre » : elles signifient « ça a eu lieu, et ce n'est pas conclu ».

La segmentation est le cas particulier à comprendre avant de la juger défaillante :
l'import produit **toujours** un découpage, donc sa pile « jamais commencé » est vide par
construction — zéro document sur 58 est en un seul bloc. Son travail n'est pas de
découper mais de **vérifier** le découpage, et cette progression-là ne passe que par les
coches. Un `0` désactivé y est donc l'énoncé juste, pas une panne.

## Fabriquer les cas de sortie

**Vider une pile** : filtrer Curation, choisir « 2 en cours », cocher les deux documents.
La pile tombe à zéro et le bandeau doit se replier sur « À traiter ».

**Épuiser une capacité** : plus court sur une base d'essai que sur les 58 d'ici.

### Le bandeau

- [x] Sans filtre, aucune pile n'est visible — le bandeau ne montre que le nombre de documents
- [x] Choisir une capacité fait apparaître les **quatre** piles
- [x] « À traiter » est sélectionné d'emblée : choisir une capacité ne présume d'aucune pile
- [x] Les quatre libellés se lisent d'un coup d'œil et disent leur compte
- [x] Le bandeau reste sur une seule ligne — exigence plus dure depuis qu'il porte quatre piles, et à vérifier avec le libellé de capacité le plus long (« Segmentation »)
- [x] Les piles s'atteignent au clavier et annoncent laquelle est active

### Ce que chaque pile contient

- [x] Curation affiche `À traiter (58) · 56 jamais commencés · 2 en cours · 0 fait`, dans cet ordre — « À traiter » en tête parce que c'est le défaut
- [x] Sur les quatre capacités, **les trois piles fines totalisent 58** — c'est l'invariant qui rend le bandeau lisible, et ce que « Tous » rompait dès la première coche
- [x] « en cours » sur Curation donne exactement 2 lignes — `#364` et `#416`, les deux seuls documents sur lesquels une curation a été **appliquée au moins une fois** ; « en cours » ne dit pas qu'ils sont propres, il dit que l'opération a tourné et que personne n'a conclu
- [x] « jamais commencés » sur Alignement donne 37 lignes, toutes sans lien
- [x] Le compte annoncé par la pile et le nombre de lignes affichées coïncident, sur les quatre capacités **et sur les quatre piles**
- [x] Un document validé n'apparaît que dans « faits », et « À traiter » l'exclut — avant ce lot il ne se retrouvait que sous « Tout afficher », noyé parmi les 58
- [x] Une coche **périmée** remet son document dans « en cours », jamais dans « jamais commencé »

### Les cas de sortie

- [x] Changer de capacité remet la pile à « À traiter » — passer de « 2 en cours » de la Curation à l'Alignement ne doit pas afficher ses 21
- [x] « Tout afficher » sort du filtre et fait disparaître les piles
- [x] Cocher le dernier document de la pile sélectionnée replie sur « À traiter » au lieu de laisser une liste vide
- [x] Après ce repli, la pile vidée est désactivée et affiche `0`
- [x] « À traiter » n'est jamais désactivé — mais le zéro qui le mettrait à l'épreuve voudrait dire « les 58 documents sont faits », état qu'aucune lecture n'a produit : cet item tient par le code (`ActionsScreen.ts:471`), pas par la passe

### La segmentation, cas particulier

- [x] `0 jamais commencé` est désactivé, mais **visible** — sa présence dit que la pile existe et vaut zéro
- [x] `58 en cours` est sélectionnable et donne les 58 lignes
- [x] Cocher une segmentation fait descendre « en cours » à 57 : c'est la seule progression que cette capacité connaisse

### Tenue à l'écran

- [x] Les colonnes de la liste ne bougent pas d'une pile à l'autre
- [x] Changer de pile ne fait pas sauter la position de défilement
- [x] Sous 1300 px puis 760 px, le bandeau et ses piles restent lisibles
- [x] Sidecar coupé, changer de pile ne vide pas la liste en silence

### Nettoyage

- [x] Retirer les coches posées pendant la passe, et vérifier que les quatre capacités retrouvent leurs comptes d'ouverture
