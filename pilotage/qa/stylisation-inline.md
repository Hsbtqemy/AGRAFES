---
passe: Stylisation inline — poser et retirer l'italique
chantier: RICH-01
duree: 25 min
derniere: 2026-08-25
---

# QA — poser, retirer, conserver l'italique et le gras

Passe écrite après les trois tranches du 25 août (`69c3799`, `0dd89a0`, `9928be4`) qui
livrent le geste : sélectionner un passage dans une ligne fait apparaître une barre **I /
G** au-dessus, les boutons basculent, et le `text_raw` balisé est persisté sans que
`text_norm` bouge.

Elle couvre ce que les tests ne peuvent pas voir. Les 1105 tests automatiques tournent en
happy-dom, où `getBoundingClientRect` rend des zéros : **le placement de la barre à
l'écran n'est prouvé par rien**, et c'est le premier objet de cette passe.

**Ce qui est hors périmètre, et ne doit pas être signalé comme un défaut** — le geste
n'existe pas encore dans la couche **Segmentation** (rendu propre, tranche suivante) ni
dans la **matrice d'alignement** (les cellules ne transportent pas encore `text_raw`). La
réapplication automatique après correction n'existe pas non plus : elle a été écartée
sur mesure, le corpus ne comptant qu'une seule ligne stylée puis corrigée.

**Le document de référence** — `9-CI-OrEn-Obs-2022_Non Aligné.docx` : unité **n° 1** en
gras, unités **n° 3, 8 et 23** en italique. L'unité n° 3 est la ligne dont la curation a
resserré une double espace : c'est le cas d'adoption du verbatim.

**Le second document** — `8-CI-TrEn-2022_A Aligner.docx`, 16 unités balisées sur 28.
Attention, telles qu'importées ce sont des unités `structure` : c'est normal ici, et sans
effet sur ce que cette passe vérifie.

### Le geste, dans les trois couches

- [ ] Couche **Rôles** : sélectionner « Observer » dans l'unité n° 8 fait apparaître une barre à deux boutons, **I** puis **G**
- [ ] Cliquer **I** met le mot en italique immédiatement, sans rechargement de la liste
- [ ] Le même geste fonctionne à l'identique dans **Curation** et dans **Annotation** (sur une unité non annotée)
- [ ] Sélectionner un passage déjà en italique affiche le bouton **I** en état actif, et cliquer dessus retire l'italique
- [ ] Sélectionner un passage à cheval sur du texte nu et du texte italique affiche **I** inactif, et un clic uniformise toute la sélection en italique
- [ ] Poser **I** puis **G** sur la même sélection donne un passage à la fois italique et gras

### Ce que la stylisation ne doit pas déplacer

- [ ] Le texte affiché est identique avant et après stylisation — seule la fonte change, aucun caractère n'apparaît ni ne disparaît
- [ ] La recherche de la couche continue de trouver le mot stylisé exactement comme avant
- [ ] Dans le concordancier, le nombre d'occurrences du mot stylisé est inchangé après le geste
- [ ] Une unité annotée conserve son annotation : aucun bandeau « ⟳ texte modifié — à réannoter » n'apparaît à cause d'une stylisation

### Ligne corrigée — l'adoption du verbatim

- [ ] Unité n° 3 : la ligne affiche « The Observer, 14 Aug 2022 » avec une seule espace, sans italique (état d'avant le geste)
- [ ] Mettre « Observer » en italique sur cette ligne : le texte affiché garde la simple espace, et l'italique apparaît
- [ ] Dans la couche **Segmentation**, cette même ligne offre désormais le repli « voir l'original d'import », qu'elle n'offrait pas avant le geste
- [ ] Le repli déplié montre bien la version d'origine, à double espace et avec son italique d'import

### Refus et gardes

- [ ] Sur une unité **annotée** (prose colorée par catégorie), sélectionner du texte ne fait apparaître **aucune** barre — les offsets n'y seraient pas fiables
- [ ] Ouvrir le stylo ✎ sur une ligne puis sélectionner du texte dans une autre ligne ne fait apparaître aucune barre
- [ ] Un simple clic sans glisser (sélection vide) ne fait apparaître aucune barre
- [ ] Changer de document alors qu'une barre est affichée la fait disparaître

### Placement de la barre — non couvert par les tests

- [ ] La barre se pose au-dessus de la ligne sélectionnée, sans recouvrir son texte
- [ ] Sur la **première** ligne de la liste, la barre reste entièrement visible et n'est pas coupée en haut
- [ ] Sur une ligne proche du bord droit, la barre ne déborde pas hors de la fenêtre
- [ ] Faire défiler la liste alors qu'une barre est affichée la fait disparaître, plutôt que de la laisser flotter loin de son texte
- [ ] Réduire la fenêtre alors qu'une barre est affichée la fait disparaître
- [ ] Les boutons restent lisibles et cliquables à la souris sans viser au pixel

### Annulation

- [ ] Après une stylisation, le bouton d'annulation propose « ⟲ Annuler : Édition du texte (unité N) »
- [ ] L'annulation retire la stylisation et rend la ligne à son état précédent
- [ ] Annuler une stylisation ne modifie pas le texte affiché, seulement sa fonte

### Sortie

- [ ] Exporter le document en TEI après avoir stylisé l'unité n° 3 : la ligne exportée porte le texte **corrigé** (simple espace) **et** son `<hi rend="italic">`
- [ ] Un italique posé à la main est aujourd'hui indistinguable d'un italique importé — vérifier que c'est bien compris comme un manque connu (D-R4 non tranché) et non comme un défaut de ce lot
