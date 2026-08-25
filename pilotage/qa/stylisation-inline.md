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

**Avant de commencer — vérifier ce qu'on exécute.** Le geste vit dans `tauri-prep`, que
le shell embarque à la compilation : un binaire déjà construit ne le contient pas. Lancer
`npm --prefix tauri-shell run tauri -- dev`. Un doute se lève en dix secondes : la couche
**Segmentation** rend l'italique depuis avril, bien avant ce lot — si elle ne le montre pas
non plus, c'est le build qui est en retard, pas le code. (Perdu une fois le 25 août 2026
sur un binaire du 29 juin.)

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

- [x] Couche **Rôles** : sélectionner « Observer » dans l'unité n° 8 fait apparaître une barre à deux boutons, **I** puis **G**
- [x] Cliquer **I** met le mot en italique immédiatement, sans rechargement de la liste
- [x] Le même geste fonctionne à l'identique dans **Curation** et dans **Annotation** (sur une unité non annotée)
- [x] Sélectionner un passage déjà en italique affiche le bouton **I** en état actif, et cliquer dessus retire l'italique
- [x] Sélectionner un passage à cheval sur du texte nu et du texte italique affiche **I** inactif, et un clic uniformise toute la sélection en italique
- [ ] Poser **I** puis **G** sur la même sélection donne un passage à la fois italique et gras

### Ce que la stylisation ne doit pas déplacer

- [x] Le texte affiché est identique avant et après stylisation — seule la fonte change, aucun caractère n'apparaît ni ne disparaît
- [x] La recherche de la couche continue de trouver le mot stylisé exactement comme avant
- [ ] Dans le concordancier, le nombre d'occurrences du mot stylisé est inchangé après le geste
- [ ] Une unité annotée conserve son annotation : aucun bandeau « ⟳ texte modifié — à réannoter » n'apparaît à cause d'une stylisation

### Ligne corrigée — l'adoption du verbatim

- [ ] Unité n° 3 : la ligne affiche « The Observer, 14 Aug 2022 » avec une seule espace, sans italique (état d'avant le geste)
- [ ] Mettre « Observer » en italique sur cette ligne : le texte affiché garde la simple espace, et l'italique apparaît
- [ ] Dans la couche **Segmentation**, cette même ligne offre désormais le repli « voir l'original d'import », qu'elle n'offrait pas avant le geste
- [ ] Le repli déplié montre bien la version d'origine, à double espace et avec son italique d'import

### Enchaîner et défaire — la barre reste

> Le surlignage et la barre survivent au geste : c'est ce qui permet de poser les deux
> styles d'affilée, et de retirer celui qu'on vient de poser sans remonter à *Annuler*.

- [ ] Poser **I** sur une sélection : le passage devient italique **et** reste surligné, la barre reste affichée au même endroit
- [ ] Enchaîner **G** sans re-sélectionner : le passage devient italique *et* gras
- [ ] Les deux boutons apparaissent alors « enfoncés »
- [ ] Recliquer **G** retire le gras et laisse l'italique ; recliquer **I** rend le texte à son état de départ
- [ ] Cette annulation ne consomme rien dans l'historique *Annuler* du haut de page — elle repasse par le même geste
- [ ] Le surlignage reposé couvre exactement les mêmes mots, y compris quand le passage stylé a coupé la ligne en plusieurs morceaux
- [ ] Cliquer ailleurs, ou faire défiler, retire la barre normalement

### Refus et gardes

- [ ] Sur une unité **annotée** (prose colorée par catégorie), sélectionner du texte ne fait apparaître **aucune** barre — les offsets n'y seraient pas fiables
- [ ] Sur une ligne **nue** contenant une esperluette (le texte affiche « &amp; » en toutes lettres), sélectionner du texte ne fait apparaître aucune barre — l'écran ne montre pas ce que la base contient, on refuse plutôt que de styliser à côté
- [ ] Ouvrir le stylo ✎ sur une ligne : dans **cette** ligne, sélectionner du texte ne fait apparaître aucune barre (la textarea ne porte que du texte nu)
- [ ] Stylo ✎ ouvert sur une ligne, taper une correction sans l'enregistrer, puis mettre du texte en italique dans **une autre** ligne : l'italique s'applique **et** la correction en cours est toujours à l'écran, intacte
- [ ] Un simple clic sans glisser (sélection vide) ne fait apparaître aucune barre
- [ ] Changer de document alors qu'une barre est affichée la fait disparaître

### Correction en cours — ce qui ne doit plus l'effacer

> Avant ce lot, tout rafraîchissement de la liste ressemait la zone de saisie depuis la
> base : la frappe en cours disparaissait sans un mot. Ces points vérifient qu'elle tient.

- [ ] Stylo ✎ ouvert, taper une correction, puis taper dans le champ **Rechercher** : la correction est toujours là, et le curseur reste dans le champ de recherche (il n'est pas aspiré par la zone de saisie)
- [ ] Même chose dans la couche **Rôles** : stylo ✎ ouvert avec une correction en cours, assigner un rôle à une sélection faite avant — la correction survit
- [ ] Une recherche qui **masque** la ligne en cours de correction, puis vidée : la ligne revient avec la correction encore en place
- [ ] Le curseur revient là où il était dans le texte, pas rejeté à la fin
- [ ] **Annuler** puis rouvrir le stylo sur la même ligne : la zone de saisie affiche le texte enregistré, pas la frappe abandonnée
- [ ] Enregistrer puis rouvrir : même chose, le texte enregistré
- [ ] Stylo ✎ ouvert sur une ligne, puis ✎ sur une **autre** ligne : la seconde s'ouvre sur son propre texte, jamais sur la frappe de la première
- [ ] Changer de document alors qu'une correction est en cours : rien n'est reporté sur le document suivant

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
