---
chantier: ALP-01
statut: à venir
---

# ALP-01 — les réglages de l'alignement sont derrière un engrenage

**Point de départ** — remarque d'usage du 4 septembre 2026, en jouant la QA des listes
déroulantes : « avoir les paramètres si précieux quasi invisibles n'est pas une bonne idée ».
Le chantier est le réexamen des **contrôles du panneau d'alignement**, pas un correctif ponctuel.

**Ce que l'engrenage replie, relevé au gabarit.** Le bouton `⚙` de la barre supérieure — un
`btn-ghost` sans libellé, dont le seul indice est un `title` au survol — ouvre et ferme un bloc
qui contient :

| | |
|---|---|
| **Stratégie** | cinq valeurs : `external_id`, `external_id → position`, `position`, `similarité`, `longueurs ¶ (Gale–Church)`. C'est **le** paramètre qui décide comment l'alignement apparie. |
| **Seuil** | le seuil de similarité — **doublement caché** : il n'apparaît que si la stratégie vaut `similarité`. |
| Préserver les liens validés | case cochée par défaut ; décochée, un run **remplace** le travail de révision. |
| Debug | case. |
| **Recalcul global** | un bouton destructeur. |
| **Par famille** | le bloc entier : sélecteur de famille, ↻, « Aligner famille », « Réviser famille », bandeau de stats. Deux capacités, pas deux options. |

**Ce qui atténue, et qu'il faut dire.** Le bandeau de confirmation nomme la stratégie et
l'état de « liens validés » avant de lancer. On ne peut donc pas aligner en aveugle. Mais on
découvre le réglage au moment de confirmer, pas au moment de choisir — et rien, au repos, ne
dit qu'un réglage n'est plus au défaut.

**Mesure de contexte.** `alignPanelTemplate.ts` porte **17** blocs en `display:none`, le plus
de tous les gabarits de prep (Exports en a 14, ShareDocs 6, les cinq autres zéro). La plupart
sont légitimes — progression, résumé, barre de lot, section collisions n'ont pas à exister
avant leur tour. Le point n'est pas leur nombre mais qu'un **réglage** soit rangé dans la même
catégorie qu'un **résultat**.

## Reste

- [ ] Trancher ce qui remonte au repos et ce qui reste replié. La stratégie est le premier candidat : elle change le résultat du bouton principal, et elle est nommée dans la confirmation — donc déjà jugée assez importante pour être dite, mais trop tard
- [ ] Donner un état au `⚙` : qu'il dise qu'il y a des options derrière, et qu'un réglage n'est plus au défaut. Aujourd'hui il ne dit ni l'un ni l'autre
- [ ] Décider si « Par famille » relève des options. Ce sont deux capacités entières — aligner une famille, la réviser — rangées derrière le même engrenage que la case « debug »
- [ ] Le repli ne se souvient de rien : décider s'il doit survivre à un redémarrage, et vérifier ce que font les autres replis de prep (le panneau ShareDocs, les cartes d'Exports)
- [ ] Le seuil de similarité est caché à deux niveaux — chercher si ce motif existe ailleurs, et le nommer une fois pour toutes
- [ ] Regarder le reste de la barre avant de conclure : ce chantier est le réexamen des contrôles, pas seulement du `⚙`
- [ ] Écrire la passe de QA

## QA

Pas encore de passe. `qa/listes-deroulantes-prep.md` touche le même panneau mais pour une autre
raison — elle vérifie que les listes ne se retournent plus, pas qu'on trouve les réglages.

## Contexte

### Pourquoi ce n'est pas dans l'audit d'alignement

`docs/AUDIT_ALIGNEMENT_2026-08-18.md` porte 25 constats et aucun ne vise ce point. Le plus
proche, **ALI-21**, dit « gestes de cellule invisibles au repos » — mais il parle de la
**matrice**, et de gestes, pas de réglages. L'audit a regardé la justesse de l'alignement et
la lisibilité de la grille ; la barre de commande du panneau n'était pas son sujet.

D'où l'absence de champ `audit:` sur cette fiche, et l'avertissement du vérificateur qui va
avec : la source est l'usage, pas un document de constats.

### Ce qu'il ne faut pas confondre avec

Deux choses ont été corrigées sur ce panneau le 4 septembre, sans rapport avec ce chantier —
ne pas les relire comme un début de traitement :

- les trois listes peuplées par la base ont cessé de se retourner (SEL-01) ;
- le sélecteur de familles se recharge quand le panneau redevient visible, au lieu d'attendre
  un clic sur ↻. Ce dernier touche le même bloc replié, et c'est en le corrigeant que la
  question des réglages cachés a été posée.
