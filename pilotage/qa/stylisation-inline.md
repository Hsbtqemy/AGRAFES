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

Elle couvre ce que les tests ne peuvent pas voir. Les 1130 tests automatiques tournent en
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

**Le second document** — `8-CI-TrEn-2022_A Aligner.docx`, 16 unités balisées sur 28. Il a été
réimporté en *DOCX paragraphes* le 25 août : ses 28 unités sont désormais de type `line`,
donc indexées et cherchables. La passe précédente l'avait trouvé en `structure`, invisible
au concordancier — si tu le retrouves ainsi, c'est qu'il a été réimporté autrement.

**Où jouer chaque bloc, et ce qu'il faut savoir avant.**

Chaque point porte désormais son lieu, en tête : la **couche**, puis le document et l'unité.
`doc de réf.` désigne toujours `9-CI-OrEn-Obs-2022_Non Aligné.docx`.

Trois choses valent d'être sues avant de commencer, parce qu'elles décident du lieu :

- **En Rôles, Curation et Segmentation, l'italique se voit toujours** — ces couches n'ont pas
  de surcouche. En **Annotation**, l'italique n'est visible que sur une unité **non annotée** :
  dans le document de référence, ce sont les unités **1, 2 et 3**, les 25 autres portant des
  tokens.
- **Le bandeau d'annulation n'existe que dans Curation et Segmentation.** Une stylisation posée
  en Rôles ne se défait donc pas sur place : il faut passer en Curation pour voir, et utiliser,
  l'historique.
- Dans l'unité n° 8, **« Observer » est déjà en italique** et « Kabul » est nu. Partir de
  « Kabul » pour tout ce qui *pose* un style, d'« Observer » pour ce qui en *retire* un.
- *Enchaîner et défaire* — le retrait par le même bouton n'est pas gratuit : il inscrit lui
  aussi une entrée dans l'historique *Annuler*. Ce qu'il évite, c'est de dépendre de l'ordre
  des annulations.
- *Ce que la stylisation ne doit pas déplacer* — la recherche ne peut rien voir de la
  stylisation, elle lit `text_norm`. **Une seule exception** : « Respecter la casse » re-vérifie
  chaque résultat sur `text_raw`, donc sur le texte **avec** ses balises. Une balise autour d'un
  mot entier le laisse intact ; une balise au milieu d'un mot le couperait et l'unité serait
  perdue — défaut connu, suivi dans RICH-01.
- *Ligne corrigée — l'adoption du verbatim* — **bloc à usage unique sur une base donnée** : ses
  deux premiers points décrivent l'état *avant* le geste, que le geste détruit en réécrivant le
  verbatim. Sur la base de travail, l'unité n° 3 y est déjà passée. Pour rejouer, prendre une
  autre ligne corrigée mais pas encore stylée, ou repartir d'une copie.
- *Correction en cours* — avant ce lot, tout rafraîchissement de la liste ressemait la zone de
  saisie depuis la base, et la frappe en cours disparaissait sans un mot. Ces points vérifient
  qu'elle tient.

### Le geste, dans les trois couches

- [x] **Rôles** · doc de réf. n° 8 — sélectionner « Observer » fait apparaître une barre à deux boutons, **I** puis **G**
- [x] **Rôles** · doc de réf. n° 8 — sélectionner « Kabul », un mot encore nu, et cliquer **I** le met en italique immédiatement, sans rechargement de la liste (pas « Observer » ici : il est déjà en italique, le clic le retirerait)
- [x] **Curation** · doc de réf. n° 8, puis **Annotation** · doc de réf. n° 1, 2 ou 3 — le geste s'y comporte à l'identique. En Annotation il faut une unité **non annotée**, et ce sont les trois seules du document : les unités 4 à 28 portent des tokens
- [x] **Rôles** · doc de réf. n° 8 — sélectionner « Observer », déjà en italique : le bouton **I** est en état actif, et cliquer dessus retire l'italique
- [x] **Rôles** · doc de réf. n° 8 — sélectionner « with the Observer », à cheval sur du texte nu et du texte italique : **I** est inactif, et un clic uniformise toute la sélection en italique
- [x] **Rôles** · doc de réf. n° 8 — poser **I** puis **G** sur « Kabul » donne un passage à la fois italique et gras

### Ce que la stylisation ne doit pas déplacer

- [x] **Rôles** · doc de réf. n° 8 — le texte affiché est identique avant et après stylisation : seule la fonte change, aucun caractère n'apparaît ni ne disparaît
- [x] **Rôles** · doc de réf., champ *Rechercher* — chercher « Kabul » après l'avoir stylisé : la ligne est trouvée exactement comme avant
- [x] **Concordancier** — « Observer » rend **16 unités sur 10 documents**, dont **3** pour le document 423 : mêmes nombres avant et après le geste (le compteur groupe par document et compte les unités trouvées, pas les apparitions du mot dans une unité)
- [x] **Concordancier** — l'unité stylisée figure toujours dans les résultats, et son texte s'y affiche **sans balise** : « The Observer, 14 Aug 2022 », et non un `<hi rend=…>` en toutes lettres
- [x] **Concordancier** — cocher **Respecter la casse** puis chercher `Observer` : l'unité n° 3 du document 423, dont le mot est entièrement en italique, figure toujours dans les résultats
- [x] **Annotation**, vue **Prose** · `Lodge-Small_ES.docx` n° 11 (95 caractères des deux côtés, la barre y apparaît) — poser l'italique laisse la prose colorée en place, et **aucune** pastille « ⟳ texte modifié — à réannoter » ne s'affiche. L'italique lui-même **ne se voit pas** : la surcouche repeint le texte depuis les tokens. C'est attendu, et suivi dans RICH-01 ; ce point vérifie que l'annotation survit, pas que le style se voie
- [x] **Annotation**, vue **Prose** · `Lodge-Small_ES.docx` n° 11 — pour comparer une fois : corriger cette même unité au stylo ✎ fait bien apparaître la pastille, et le compteur « ⚠ 1 à réannoter » dans le résumé du haut. C'est le signal que la stylisation ne doit jamais déclencher

### Ligne corrigée — l'adoption du verbatim

- [x] **Rôles** · doc de réf. n° 3 — la ligne affiche « The Observer, 14 Aug 2022 » avec une seule espace, sans italique (état d'avant le geste)
- [x] **Rôles** · doc de réf. n° 3 — mettre « Observer » en italique : le texte affiché garde la simple espace, et l'italique apparaît
- [x] **Segmentation** · doc de réf. n° 3 — cette même ligne offre désormais le repli « voir l'original d'import », qu'elle n'offrait pas avant le geste
- [x] **Segmentation** · doc de réf. n° 3 — le repli déplié montre la version d'origine, à double espace et avec son italique d'import

### Enchaîner et défaire — la barre reste

- [x] **Rôles** · doc de réf. n° 8, sur « Kabul » — poser **I** : le passage devient italique **et** reste surligné, la barre reste affichée au même endroit
- [x] **Rôles** · doc de réf. n° 8 — enchaîner **G** sans re-sélectionner : le passage devient italique *et* gras
- [x] **Rôles** · doc de réf. n° 8 — les deux boutons apparaissent alors « enfoncés »
- [x] **Rôles** · doc de réf. n° 8 — recliquer **G** retire le gras et laisse l'italique ; recliquer **I** rend « Kabul » à son état de départ
- [x] **Curation** · doc de réf. — le bandeau d'annulation n'existe **que** dans Curation et Segmentation, il faut donc y passer pour l'observer : chaque clic sur **I** ou **G** y a ajouté une entrée « Édition du texte (unité N) », poser puis retirer l'italique en laisse **deux**, indiscernables d'une correction au stylo (mesuré : 31 → 32 → 33 sur le document 423). Le retrait par le même bouton reste préférable — il rend le texte exact sans dépendre de l'ordre des annulations
- [x] **Rôles** · doc de réf. n° 8 — sélectionner « with the Observer », à cheval sur du texte nu et de l'italique, puis cliquer **G** : le passage devient gras d'un bout à l'autre, et le surlignage couvre toujours exactement « with the Observer » — ni le point final, ni une moitié seulement. C'est le point délicat du lot : en posant le style, le geste vient de scinder ce passage en deux fragments (« with the » en gras seul, « Observer » en gras + italique), et la sélection doit être reposée par-dessus la couture
- [x] **Rôles** · doc de réf. n° 8 — cliquer ailleurs, ou faire défiler, retire la barre normalement

### Refus et gardes

- [x] **Annotation**, vue **Prose** · `Lodge-Small_ES.docx` n° 20 — sélectionner du texte dans cette ligne : **aucune** barre n'apparaît. La raison se voit à l'œil, en comparant la même ligne dans deux couches : ici elle finit par « días: », alors qu'en couche **Rôles** elle finit par « días : », avec une espace. L'écran ne montre donc pas le texte enregistré, et l'application refuse plutôt que de risquer de poser l'italique à côté
- [x] **Annotation**, vue **Étendue** · `Lodge-Small_ES.docx` n° 11 — basculer cette unité en Étendue et refaire la sélection : **aucune** barre, alors qu'elle apparaissait en Prose. Ici l'écart saute aux yeux — la vue empile sous chaque mot son UPOS et son lemme, donc ce qui est affiché n'a plus la forme d'une phrase. Le refus vaut pour **toute** unité annotée en vue Étendue, sans exception
- [x] **Rôles** · doc de réf. n° 8 — ouvrir le stylo ✎ sur la ligne : dans **cette** ligne, sélectionner du texte ne fait apparaître aucune barre (la textarea ne porte que du texte nu)
- [x] **Rôles** · doc de réf., stylo ✎ ouvert sur n° 8 — taper une correction sans l'enregistrer, puis mettre du texte en italique dans **une autre** ligne (n° 9) : l'italique s'applique **et** la correction en cours est toujours à l'écran, intacte
- [x] **Rôles** · doc de réf. — un simple clic sans glisser (sélection vide) ne fait apparaître aucune barre
- [x] **Rôles** — barre affichée sur le doc de réf., puis basculer sur `8-CI-TrEn-2022_A Aligner.docx` : la barre disparaît

### Correction en cours — ce qui ne doit plus l'effacer

- [x] **Curation** · doc de réf. n° 8 — stylo ✎ ouvert, taper une correction, puis taper dans le champ *Rechercher* : la correction est toujours là, et le curseur reste dans le champ de recherche (il n'est pas aspiré par la zone de saisie)
- [x] **Rôles** · doc de réf. — sélectionner l'unité n° 5, ouvrir le stylo ✎ sur la n° 8 et y taper, puis assigner un rôle : la correction survit
- [x] **Curation** · doc de réf. n° 8 — chercher un mot qui **masque** la ligne en cours de correction, puis vider la recherche : la ligne revient avec la correction encore en place
- [x] **Curation** · doc de réf. n° 8 — stylo ✎ ouvert, taper `ZZZ` à la fin du texte, puis cliquer le bouton **Annuler de la zone de saisie** (celui du bas, pas le « ↶ Annuler » de l'historique) ; rouvrir le ✎ sur la même ligne : le `ZZZ` n'y est plus, la zone affiche le texte enregistré
- [x] **Curation** · doc de réf. — stylo ✎ ouvert sur la n° 8, y taper `ZZZ` sans enregistrer, puis cliquer ✎ sur la n° 9 : la seconde s'ouvre sur **son propre texte**, sans `ZZZ`. C'est le point qui compte de ce bloc — il vérifie que le brouillon relevé avant un rendu est bien rattaché à son unité
- [x] **Curation** — stylo ✎ ouvert sur le doc de réf. n° 8, y taper `ZZZ` sans enregistrer, puis basculer sur `8-CI-TrEn-2022_A Aligner.docx` et y ouvrir le ✎ sur n'importe quelle ligne : aucun `ZZZ` n'apparaît

### Placement de la barre — non couvert par les tests

- [x] **Rôles** · doc de réf. n° 8 — la barre se pose au-dessus de la ligne sélectionnée, sans recouvrir son texte
- [x] **Rôles** · doc de réf. n° 1, la première de la liste — la barre reste entièrement visible et n'est pas coupée en haut
- [x] **Rôles** · doc de réf. — point de compréhension : la barre se pose au coin **haut-gauche de la ligne**, jamais au-dessus du passage surligné. Sur une unité qui tient sur plusieurs lignes à l'écran — c'est le cas de toutes celles de ce document — elle apparaît donc loin du mot visé. Comportement actuel, suivi dans RICH-01 : ce n'est pas un défaut de placement à signaler
- [x] **Rôles** · doc de réf. — faire défiler la liste alors qu'une barre est affichée la fait disparaître, plutôt que de la laisser flotter loin de son texte
- [x] **Rôles** · doc de réf. — réduire la fenêtre alors qu'une barre est affichée la fait disparaître
- [x] **Rôles** · doc de réf. — les boutons restent lisibles et cliquables à la souris sans viser au pixel

### Annulation

- [x] **Curation** · doc de réf. (le bandeau n'existe qu'ici et en Segmentation) — après une stylisation, le bouton propose « ↶ Annuler : Édition du texte (unité N) » ; le glyphe est ↶, `prepUndo.ts:135`
- [x] **Curation** · doc de réf. n° 8 — l'annulation retire la stylisation et rend la ligne à son état précédent
- [x] **Curation** · doc de réf. n° 8 — annuler une stylisation ne modifie pas le texte affiché, seulement sa fonte

### Sortie

- [x] Écran **Exports** · doc de réf. — exporter en TEI après avoir stylisé l'unité n° 3 : la ligne exportée porte le texte **corrigé** (simple espace) **et** son `<hi rend="italic">`
- [x] Point de compréhension, sans manipulation — un italique posé à la main est aujourd'hui indistinguable d'un italique importé : vérifier que c'est bien compris comme un manque connu (D-R4 non tranché) et non comme un défaut de ce lot
