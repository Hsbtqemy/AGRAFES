---
passe: Actions — le double filtre
chantier: ACT-01
duree: 12 min
derniere: 2026-09-01
---

# QA — les trois piles du bandeau de filtre

Le filtre de la page Actions avait cessé de trier. Tant qu'aucune coche n'existe, les
quatre capacités concernent le corpus entier : les quatre boutons annonçaient « Voir les
58 » et n'ôtaient aucune ligne. Les piles resserrent au sein de la capacité choisie —
**jamais commencé**, **en cours**, ou les deux — et la petite, « en cours », est celle
qu'on ne pouvait pas atteindre : finir ce qui est commencé.

Cette passe couvre ce que 16 tests ne peuvent pas voir : que le bandeau se lit, que les
comptes correspondent au corpus réel, et que les trois cas de sortie ne laissent jamais
une liste vide sans explication.

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

| capacité | jamais commencé | en cours | Tous |
|---|---|---|---|
| Curation | 56 | **2** | 58 |
| Segmentation | **0** | 58 | 58 |
| Alignement | 37 | **21** | 58 |
| Annotation | 50 | **8** | 58 |

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
La pile tombe à zéro et le bandeau doit se replier sur « Tous ».

**Épuiser une capacité** : plus court sur une base d'essai que sur les 58 d'ici.

### Le bandeau

- [x] Sans filtre, aucune pile n'est visible — le bandeau ne montre que le nombre de documents
- [x] Choisir une capacité fait apparaître les trois piles
- [x] « Tous » est sélectionné d'emblée : choisir une capacité ne présume d'aucune pile
- [x] Les trois libellés se lisent d'un coup d'œil et disent leur compte
- [x] Le bandeau reste sur une seule ligne, y compris avec le libellé de capacité le plus long (« Segmentation »)
- [x] Les piles s'atteignent au clavier et annoncent laquelle est active

### Ce que chaque pile contient

- [x] Curation affiche `56 jamais commencés · 2 en cours · Tous (58)`
- [x] Alignement affiche `37 · 21 · 58`, Annotation `50 · 8 · 58`
- [x] « en cours » sur Curation donne exactement 2 lignes — `#364` et `#416`, les deux seuls documents sur lesquels une curation a été **appliquée au moins une fois** ; « en cours » ne dit pas qu'ils sont propres, il dit que l'opération a tourné et que personne n'a conclu
- [x] « jamais commencés » sur Alignement donne 37 lignes, toutes sans lien
- [x] Le compte annoncé par la pile et le nombre de lignes affichées coïncident, sur les quatre capacités
- [x] Un document validé n'apparaît dans aucune des trois piles
- [x] Une coche **périmée** remet son document dans « en cours », jamais dans « jamais commencé »

### Les cas de sortie

- [x] Changer de capacité remet la pile à « Tous » — passer de « 2 en cours » de la Curation à l'Alignement ne doit pas afficher ses 21
- [x] « Tout afficher » sort du filtre et fait disparaître les piles
- [x] Cocher le dernier document de la pile sélectionnée replie sur « Tous » au lieu de laisser une liste vide
- [x] Après ce repli, la pile vidée est désactivée et affiche `0`
- [x] « Tous » n'est jamais désactivé, même quand les deux autres sont à zéro

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
