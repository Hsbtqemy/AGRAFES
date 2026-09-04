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

**Les libellés ne portent plus d'identifiant**, depuis le 4 septembre : un document se nomme
`titre (langue)`, une famille `titre (n docs)`, sur les quinze listes. Le `#428` en tête n'était
affiché que par la moitié d'entre elles, ne désambiguïsait rien (58 documents, 0 titre en
double) et était sauté par la frappe.

**Largeurs attendues** : 280 px pour une liste de documents, 300 px pour une liste de familles.
Elles sont **fixes** exprès — un menu qui se redimensionne à chaque choix fait bouger la barre
autour de lui. Le libellé le plus long du corpus doit tenir sans être coupé
(`[1] hi rend=…​.txt (fr)`, 44 caractères).

**Deux points ont changé sous la passe, en cours de lecture, tous deux à partir de ce que la
lecture a soulevé.**

L'item de frappe disait, le 4 septembre au matin, que retaper la même lettre ne passait pas à
l'entrée suivante. C'était exact, et c'était une capacité perdue par rapport à la liste native
qu'on remplaçait : sur les deux familles « Houellebecq » du corpus, la seconde n'était
atteignable par aucune frappe. Deux corrections ont suivi le même jour, chacune rattrapée par
la lecture, avant que la règle se simplifie : **un appui parcourt les entrées qui commencent
par cette lettre, et boucle.** Rien ne s'accumule d'un appui à l'autre. La contrepartie est
assumée : on ne peut plus atteindre une entrée en tapant le début de son nom, et le plus gros
groupe d'initiales du corpus en compte neuf — les flèches y vont plus vite. Les items de
frappe sont donc neufs et **décochés**, personne n'a vu tourner cette règle-ci.

Et l'identifiant en tête de libellé a été **retiré** des quinze listes. Il n'y était affiché
que par la moitié d'entre elles, ne désambiguïsait rien, et la frappe le sautait. Les items
qui le nommaient sont réécrits ; ceux qui étaient cochés le restent quand ce qu'ils ont
vérifié n'a pas changé.

### L'espace Alignement — la matrice

- [x] La liste des 20 familles s'ouvre vers le bas et défile, fenêtre placée bas sur l'écran court
- [x] Taper `h` mène à « Houellebecq » — vu le 4 septembre, quand le libellé s'ouvrait encore sur un identifiant que la frappe devait sauter. Il n'y en a plus
- [ ] **Retaper `h` passe à la famille suivante**, et boucle. Le corpus en porte deux, « Houellebecq-Carte_FR.docx » et « Houellebecq-Plateforme_FR.docx » : la seconde n'était atteignable par aucune frappe
- [ ] Taper `h` puis `l` puis `l` **avance dans les L** — et ne revient pas sur Houellebecq, qui contient « ll » au milieu de son nom
- [ ] Chaque appui ne regarde qu'une lettre : taper `m` puis `o` ne cherche pas « mo », le second appui ne trouve rien et ne bouge pas
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
