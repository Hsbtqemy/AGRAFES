---
passe: Prep — les listes déroulantes peuplées par la base
chantier: SEL-01
duree: 15 min
derniere:
---

# QA — les quatorze listes qui ne se retournent plus

La liste d'un `<select>` natif n'est pas du DOM : c'est une fenêtre du système. Chromium la
**bascule au-dessus du déclencheur** quand il juge la place insuffisante en dessous — et
« insuffisante » se mesure sur l'**écran**, pas sur la fenêtre de l'application. Le même menu
s'ouvrait donc vers le bas sur un moniteur et vers le haut sur un autre, en débordant.

Quatorze listes peuplées par la base ont été habillées d'un menu maison qui s'ouvre vers le
bas, se borne en hauteur et défile. Une quinzième (`Unité`, dans l'inspecteur) reste native
exprès : son aperçu est borné à six lignes.

## Avant de jouer

**Sur quel écran.** Le défaut ne se manifestait que sur l'écran court — zones de travail
mesurées 1920×**1032** et 1536×**816**. Jouer cette passe sur le **1536×816**, fenêtre
**placée assez bas** pour qu'il reste moins de 400 px sous le sélecteur. Sur le grand écran,
tout paraîtra correct : ce n'est pas une vérification, c'est une absence de symptôme.

**Le geste, partout le même.** Ouvrir la liste, et regarder trois choses : elle s'ouvre
**vers le bas**, elle **ne dépasse pas** le bas de la fenêtre (elle défile à la place), et le
déclencheur affiche bien l'entrée choisie après la sélection.

**Comptes attendus**, mesurés le 4 septembre 2026 sur `corpus_agrafes.WORKCOPY.db` :
**58 documents** et **20 familles**. Une liste de documents porte donc 58 entrées plus son
invite ; celle des relations en porte 57 (elle exclut le document courant).

**Le `<select>` reste le modèle.** Il est toujours là, masqué : c'est lui qui porte la valeur
et émet l'événement. Un menu qui affiche autre chose que ce que l'écran fait ensuite est
donc le défaut à chercher — il a un nom, « le déclencheur affiche l'entrée précédente », et
il apparaît là où le code pose la valeur sans le dire au menu.

**Largeurs attendues** : 320 px pour une liste de documents, 400 px pour une liste de
familles. Elles sont **fixes** exprès — un menu qui se redimensionne à chaque choix fait
bouger la barre autour de lui. Le libellé le plus long du corpus doit tenir sans être coupé
(`#428 [1] hi rend=…​.txt (fr)`, 49 caractères).

**Un point a changé sous la passe, en cours de lecture.** L'item de frappe disait, le
4 septembre au matin, que retaper la même lettre ne passait pas à l'entrée suivante. C'était
exact, et c'était une capacité perdue par rapport à la liste native qu'on remplaçait : sur les
deux familles « Houellebecq » du corpus, la seconde n'était atteignable par aucune frappe. Le
composant a été corrigé le jour même. L'item joué reste coché — il portait aussi le fait que
l'identifiant est ignoré par la frappe, et cela a bien été vu — mais le parcours, que personne
n'a encore vu tourner, est un item neuf et **décoché**.

### L'espace Alignement — la matrice

- [x] La liste des 20 familles s'ouvre vers le bas et défile, fenêtre placée bas sur l'écran court
- [x] Taper `h` mène à « Houellebecq » — l'identifiant en tête de libellé (`#366 …`) est ignoré par la frappe
- [ ] **Retaper `h` passe à la famille suivante**, et boucle. Le corpus en porte deux, `#366 Houellebecq-Carte_FR.docx` et `#368 Houellebecq-Plateforme_FR.docx` : la seconde n'était atteignable par aucune frappe
- [ ] Taper `m` puis `o` reste une **recherche** et ne parcourt pas — « mo » mène à Modiano
- [x] Flèches haut/bas, Début/Fin, Échap qui referme et rend le focus au déclencheur
- [x] Le déclencheur ne change pas de largeur d'une famille à l'autre

### L'espace Alignement — le panneau de révision

- [ ] `Pivot` et `Cible` : 58 entrées chacun, ouverture vers le bas, aucune ne dépasse
- [ ] `Par famille`, sous « Options d'alignement » : la liste s'ouvre sous le champ, qui remplit sa ligne
- [ ] Depuis la matrice, le bouton 🔎 d'une cellule bascule sur la révision fine **et les deux déclencheurs affichent la paire** — c'est le premier des trois endroits où le code pose la valeur lui-même
- [ ] Depuis l'écran Documents, « à réviser » sur une famille ouvre la revue famille **et le déclencheur de famille l'affiche**
- [ ] Après un « Aligner famille », la paire chargée d'office s'affiche dans les deux déclencheurs

### Exports

- [ ] Carte « Export alignements » : `Pivot (optionnel)` et `Cible (optionnel)` s'ouvrent vers le bas
- [ ] Carte du haut : `Pivot (optionnel)` et `Cible (optionnel)`. Ils ne s'affichent que pour le produit « Tableau segments alignés » — c'est le défaut de l'étape « Alignement », mais si la carte a changé de produit, il faut y revenir
- [ ] Carte « Export bilingue / TMX » : `Famille (optionnel)`, `Pivot (original)` et `Cible (traduction)`
- [ ] Choisir une famille dans l'export bilingue **remplit pivot et cible**, et les deux déclencheurs le montrent
- [ ] Carte « Matrice multilingue » : `Famille (original moyeu)`
- [ ] Les listes de documents à cocher (TEI, paquet, export v2) sont **inchangées** — ce sont des listes ouvertes, pas des menus : elles n'ont jamais eu de fenêtre système à retourner

### Métadonnées — la relation documentaire

- [ ] `Document cible` : 57 entrées, le document courant en est absent
- [ ] Changer de document dans l'arbre, puis rouvrir la liste : elle montre les documents à jour, et il n'y a toujours qu'**un** menu dans le panneau
- [ ] `Type de relation`, à côté, est resté natif — deux entrées fixes (`translation_of`, `excerpt_of`)

### Import — la boîte « Rattacher à une famille ? »

- [ ] Importer un document dans un corpus qui en contient déjà : la boîte s'ouvre, et `Document original (parent)` liste les autres
- [ ] C'est le cas le plus exposé : la boîte est centrée, donc le sélecteur est à mi-hauteur d'écran. La liste s'ouvre **vers le bas** et défile
- [ ] Fermer la boîte, la rouvrir sur un autre import : un seul menu, pas deux

### Ce qui doit être resté natif

- [ ] Inspecteur d'unités, `Unité` : liste native — l'aperçu est borné à six lignes, l'écran l'annonce (« 6 lignes max »)
- [ ] Stratégie d'alignement, formats d'export, rôles, statuts : natifs, listes courtes et fixes
- [ ] Aucun de ces menus natifs n'a changé d'apparence

### Tenue à l'écran

- [ ] À 1300 px puis 800 px de large, aucune barre de défilement horizontale n'apparaît sur la page
- [ ] Sous 1000 px, la ligne de l'export bilingue passe à deux lignes plutôt que de déborder
- [ ] Un menu ouvert près du bas de la fenêtre reste dans le cadre : il se borne et défile, il ne se retourne pas
- [ ] Ouvrir un menu, cliquer ailleurs : il se referme sans rien changer
