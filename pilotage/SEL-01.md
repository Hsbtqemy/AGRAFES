---
chantier: SEL-01
statut: interrompu
---

# SEL-01 — les listes déroulantes cessent de se retourner

**Arrêté sur** — 4 septembre 2026 : **14 listes converties sur 15**, la quinzième laissée
native après mesure. Tout le code est écrit ; il reste à le regarder, sur le bon écran.

La quinzième est `meta-token-unit`, que cette fiche désignait comme « le seul dont la liste
n'est pas bornée par le nombre de documents ». C'est vrai, et l'inquiétude était à l'envers :
elle est bornée **plus court** que toutes les autres, à six lignes d'aperçu — l'écran l'annonce
lui-même (« 6 lignes max »). Un menu maison n'apporterait rien à sept entrées. Un test tient
la borne : si elle monte, la décision se rejoue.

**L'inventaire était faux, dans les deux sens.** La prose de cette fiche annonçait onze
sélecteurs pendant que son propre tableau en listait treize, et le tableau oubliait
`bil-pivot-sel` et `bil-target-sel` — qui reçoivent leurs `<option>` par la même fonction que
leurs voisins. Refait au code : **44 `<select>` portent un identifiant**, trois autres n'en
portent pas ; quinze sont peuplés par la base en liste déroulante, trois en `<select multiple>`,
vingt-neuf sont des listes courtes et fixes. Un détecteur automatique ne suffit pas à trancher
— il a manqué `align-pivot-sel` (peuplé dans une boucle sur des identifiants) et `rel-target-sel`
(interpolé dans la même chaîne de gabarit), et il a compté `edit-role` et `rel-type` comme
dynamiques alors qu'ils viennent de constantes. Le compte ci-dessous est lu, pas déduit.

**Ce que la conversion coûte, et que la première tranche n'avait pas vu : la largeur.** Un
`<select>` natif se dimensionne sur son option la **plus large** ; le déclencheur qui le
remplace n'affiche qu'un texte, donc il se dimensionne sur l'entrée **choisie**. Mesuré au
banc (Chrome sans tête, fenêtre 1500×760, libellés réels de la base) : le natif ne bougeait
pas d'un pixel d'un document à l'autre, et l'habillage sans règle de largeur oscillait entre
**138 px** (« Modiano-Rue_ES ») et **249 px** (le plus long titre du corpus). La barre aurait
changé de largeur à chaque choix — un défaut que le contrôle natif n'avait pas.

**Et le chiffrage est sorti trop petit deux fois de suite, pour la même raison.** On ne
mesurait pas le libellé le plus large que le code SAIT composer. Il en existe quatre formes —
`titre (langue)` dans l'Alignement et les relations, `#id titre` pour les exports CSV et v2,
`#id titre (langue)` pour l'export bilingue, `#id titre (n docs)` pour ses listes de familles
— et c'est la troisième qui commande. Premier relevé sur des titres nus : 243 px. Deuxième,
suffixe de langue remis : 266. Troisième, identifiant compris : **300**, et il faut **320** au
déclencheur pour ne pas couper. Les 240 puis 280 posés en chemin coupaient donc le libellé le
plus long — ce que le natif ne fait jamais, puisqu'il se dimensionne sur son option la plus
large. Mesurer une seule forme, c'est mesurer le mauvais mot.

Retenu : **320 px** pour une liste de documents, **400 px** pour une liste de familles (le
natif rendait 300 et 407), vérifié sans coupe et sans débordement horizontal à 1500, 1300,
1000 et 800 px de large. Deux classes posées à l'habillage (`prep-selmenu--doc`,
`--famille`) plutôt qu'une règle par emplacement : la largeur dépend de ce que la liste
contient, pas de l'écran qui la porte.

Deuxième chose que le banc a démolie : `max-width: 420px` n'était pas décoratif. Le
`<select>` de famille porte `flex:1` en style inline, et c'est la règle générique
`.prep-actions-screen select` (0,1,1) qui le bornait. L'enveloppe reprenant `flex:1` sans ce
plafond mesurait **1167 px** — elle mangeait la ligne entière. Au passage, la même règle
générique écrasait déjà le `max-width: 220px` que `.prep-align-pair-sel` déclarait :
quatrième occurrence du motif de spécificité, sans conséquence visible cette fois puisque le
natif se bornait à son contenu.

**L'origine, et pourquoi ce n'est pas du CSS.** La liste d'un `<select>` natif n'est pas du
DOM : c'est une fenêtre du système. Aucune feuille de style ne l'atteint, et Chromium la
**bascule au-dessus du déclencheur** quand il juge la place insuffisante en dessous. Or
« insuffisante » se mesure sur l'**écran**, pas sur la fenêtre de l'application : le même
menu s'ouvre donc vers le bas sur un moniteur et vers le haut sur un autre, en débordant.

Mesuré le 4 septembre 2026 sur les deux écrans de la machine — zones de travail 1920×**1032**
et 1536×**816** — avec les 20 familles du corpus, dont la liste réclame ~500 px. Sur l'écran
court, dès que la fenêtre n'est pas collée en haut, il ne reste pas 500 px sous le sélecteur.
Le symptôme a été rapporté exactement ainsi : « sur l'écran d'ordinateur ça monte et dépasse,
sur l'écran externe ça va vers le bas et c'est bien calibré ».

**Le dépôt avait déjà tranché la question, sans l'appliquer.** `shared/anchorMenu.ts`, écrit
à l'audit du 21 août 2026 (passe `qa/menus-flottants.md`), pose la règle : « le parti pris est
de **glisser**, pas de basculer de l'autre côté du déclencheur ; un menu qui saute au-dessus du
bouton change de place d'une ouverture à l'autre, ce qui se paie en repérage. Quand le menu est
plus grand que le cadre, glisser ne suffit plus — on borne et on laisse défiler. » Un `<select>`
natif ne sait suivre aucune de ces trois règles.

**Ce qui existait déjà, et ce qu'on en a fait.** Un seul menu maison dans tout le dépôt :
`prep-canvas-doc-menu`, le choix de document en haut du canvas — d'où le souvenir, exact, que
« ça avait été réglé pour Segmentation ». C'était un cas isolé, jamais érigé en règle. Le
composant de ce chantier en reprend la forme et la complète (frappe au clavier).

**Le périmètre, mesuré, et pourquoi ce n'est pas « tous les `<select>` ».** Prep en compte
~50. Sur une liste de trois formats ou cinq rôles, la bascule est sans conséquence et le
contrôle natif garde de vraies qualités (clavier, lecteurs d'écran, zéro code). Le défaut
mord sur les listes **alimentées par la base**, qui grandissent avec le corpus. Il y en a
onze, tous peuplés en TS :

| Écran | Sélecteurs |
|---|---|
| Alignement | `matrix-family` ✔, `align-family-sel` ✔, `align-pivot-sel` ✔, `align-target-sel` ✔ |
| Exports | `matrix-family-sel` ✔, `bil-family-sel` ✔, `bil-pivot-sel` ✔, `bil-target-sel` ✔, `v2-align-pivot` ✔, `v2-align-target` ✔, `align-csv-pivot` ✔, `align-csv-target` ✔ |
| Documents | `rel-target-sel` ✔ |
| Import | `fam-dlg-parent-sel` ✔ |
| Inspecteur d'unités | `meta-token-unit` — **natif exprès**, borné à 6 entrées |

Hors périmètre, et vérifié plutôt que supposé : les trois `<select multiple>` d'Exports
(`v2-doc-sel`, `tei-doc-sel`, `pkg-doc-sel`) s'affichent en liste ouverte, pas en menu — ils
n'ont rien à retourner. Et trois `<select>` sans identifiant sont peuplés par du code sans
être bornés par le corpus : les étiquettes UPOS de l'annotation (liste fixe), le pivot d'un
groupe détecté à l'import (les fichiers d'UNE famille, deux à cinq), les modèles spaCy
installés. Le critère reste la longueur de la liste, pas l'uniformité visuelle.

**Le parti pris qui rend la conversion peu chère : le `<select>` reste le modèle.** On ne
remplace pas le contrôle, on l'habille. Le `<select>` reste dans le DOM, masqué : il porte
toujours `value`, émet toujours `change`, garde toujours ses `<option>`. Le menu visible n'est
qu'une vue qui écrit dedans. Conséquence mesurée : les **85 assertions** des huit suites de la
matrice — dont 27 visent `#matrix-family` — sont passées **sans une retouche**. Réécrire des
tests pour accommoder un changement d'habillage aurait affaibli la suite au moment précis où
elle sert le plus.

**Ce qu'on observe plutôt que d'exiger.** Le `<select>` est manipulé de partout : options
reconstruites, et `disabled` posé pendant un run d'alignement (discipline F5 — geler les
sélecteurs tant que le run vole). Exiger un appel après chaque geste, c'est se garantir qu'un
site sera oublié, et le menu mentirait alors sur l'état réel. D'où un `MutationObserver` sur
les options et sur `disabled`. `value`, lui, est une **propriété** : l'écrire ne produit
aucune mutation et rien ne peut l'observer — les sites qui la posent par programme appellent
`sync()`. Ils sont deux dans la matrice.

**La frappe au clavier, et pourquoi elle est meilleure que la native.** Un `<select>` saute à
l'entrée dont le texte **commence** par ce qu'on tape. Nos libellés commencent par un
identifiant : « #368 Houellebecq-Plateforme_FR.docx ». Taper « h » n'y menait donc à rien, il
aurait fallu taper « #368 » — c'est-à-dire connaître déjà la réponse. Le composant retire ce
préfixe avant de comparer. Le natif ne perd rien ici : il n'avait rien à offrir.

## Reste

- [x] Écrire `lib/selectMenu.ts` : déclencheur + `role="listbox"` ancré sous lui, borné à `min(50vh, 360px)` et défilant, recadré par `clampAnchoredMenu` s'il sort du cadre
- [x] Le `<select>` reste le modèle — masqué, il garde `value`, `change` et ses `<option>` ; vérifié par les 85 assertions de la matrice passées sans retouche
- [x] `MutationObserver` sur les options et sur `disabled` ; `sync()` pour les deux sites qui posent `value` par programme
- [x] Frappe au clavier avec le préfixe `#\d+` retiré, flèches, Home/End, Échap qui rend le focus, Tab qui referme, clic extérieur
- [x] Le CSS `prep-selmenu-*`, calqué sur `.prep-canvas-doc-menu`, plus l'enveloppe de largeur du sélecteur de famille (260–420 px) pour que la barre ne change pas de largeur à chaque choix
- [x] Câbler `matrix-family` dans `AlignMatrixView` : pose au rendu, `sync()` aux deux écritures de `value`, `destroy()` au démontage
- [x] `lib/__tests__/selectMenu.test.ts`, 14 cas : le contrat du modèle (l'événement part du `<select>` et bouillonne), l'observateur, la frappe, le clavier, l'idempotence, le démontage
- [x] Convertir les trois autres sélecteurs de l'Alignement : `align-family-sel`, `align-pivot-sel`, `align-target-sel` (`AlignPanel`) — les ~25 sites qui LISENT `value` n'ont pas bougé d'une ligne, seuls les **trois** qui l'écrivent demandent `_syncMenus()`
- [x] Convertir ceux d'Exports — **huit et non six** : `bil-pivot-sel` et `bil-target-sel` manquaient à l'inventaire, ils sont peuplés par la même fonction que leurs voisins
- [x] Convertir `rel-target-sel` (Documents) et `fam-dlg-parent-sel` (Import) — le premier vit dans un panneau qui se re-rend en entier, donc l'habillage précédent doit être démonté à chaque rendu ; le second dans une boîte modale **centrée**, le cas le plus exposé du chantier, et il part avec elle
- [x] `meta-token-unit` (inspecteur d'unités) — vérifié, et **il reste natif** : son aperçu est borné à six lignes, soit plus court que toutes les autres listes. L'inquiétude était à l'envers. Un test tient la borne
- [x] Décider du sort des `<select multiple>` d'Exports (`v2-doc-sel`, `tei-doc-sel`, `pkg-doc-sel`) : **hors périmètre**, confirmé — une liste ouverte n'a pas de fenêtre système à retourner, et un test nomme les trois pour que la conversion ne les prenne pas au passage
- [x] Vérifier que les sélecteurs restants restent natifs — **29 listes courtes et fixes** sur les 44 identifiées, plus trois sans identifiant : rien à convertir, le natif y garde ses qualités pour zéro ligne
- [x] Écrire la passe de QA — `qa/listes-deroulantes-prep.md`, 28 points en sept zones. Passe propre plutôt qu'extension de `qa/menus-flottants.md` : celle-ci couvre le concordancier, la Recherche grammaticale et la barre du shell, pas Prep
- [ ] **Jouer cette passe sur l'écran court** (1536×816), fenêtre placée assez bas pour qu'il reste moins de 400 px sous le sélecteur — sur le grand écran, tout paraîtra correct sans que rien n'ait été vérifié

## QA

- qa/listes-deroulantes-prep.md — **écrite le 4 septembre, jamais jouée.** 28 points en sept
  zones : les deux surfaces de l'Alignement, Exports, Métadonnées, la boîte de l'Import, ce qui
  doit être resté natif, et la tenue à l'écran. Son préambule porte ce qu'aucun test ne peut
  tenir : sur quel écran jouer, et où placer la fenêtre. Elle nomme les **trois** endroits où
  le code pose la valeur lui-même (handoff depuis la matrice, deep-link famille, paire chargée
  après un run) — ce sont les seuls où le déclencheur peut mentir, et le seul défaut de cette
  famille qui ne se voit pas au premier coup d'œil.
- Le tout premier sélecteur converti est en outre couvert par un point de
  `qa/identite-base.md` (zone « L'espace Alignement »), joué le 4 septembre.

## Contexte

**Ce que la conversion coûte ailleurs qu'en lignes.** Un `<select>` natif apporte gratuitement
l'intégration au système : lecteurs d'écran, gestes tactiles, et sur mobile un sélecteur
plein écran. Rien de tout cela n'est en jeu ici — l'application est un binaire de bureau — mais
c'est la raison de ne PAS généraliser aux ~40 listes courtes, où le natif reste le meilleur
choix. Le critère est la longueur de la liste et le fait qu'elle vienne de la base, pas
l'uniformité visuelle.

**Le défaut voisin, trouvé le même jour et corrigé séparément.** Les labels de l'espace
Alignement recevaient de `.prep-actions-screen label` (spécificité 0,1,1 contre 0,1,0) une
mise en page qu'ils n'avaient pas demandée — troisième occurrence de ce motif. Corrigé sous
CHR-01, avec sa garde `ui/__tests__/actionsScreenOverrides.test.ts`. Ce n'est pas le même
problème, mais les deux se sont manifestés sur le même écran et à la même heure : ne pas les
confondre en relisant l'historique.

**L'identifiant retiré des libellés (décidé en jouant la passe).** Un document se nomme
désormais `titre (langue)` et une famille `titre (n docs)`, sur les quinze listes. Le `#428`
en tête n'était affiché que par **la moitié** d'entre elles — les cinq listes d'Exports et la
famille de la matrice l'avaient, les deux sélecteurs de paire de l'Alignement, la famille du
panneau et la cible d'une relation ne l'avaient pas : le même document portait deux noms selon
l'écran. Il ne désambiguïsait rien (58 documents et 20 familles, **aucun titre en double**),
la frappe le sautait exprès, et il n'est affiché nulle part ailleurs dans l'interface — ni
colonne dans la table Actions, ni dans l'arbre des métadonnées, où il vit en `data-doc-id`.
Les largeurs retombent de 320/400 à **280/300 px**.

Ce que le retrait coûte, et qu'un test existant a fait remonter : deux familles de même titre
**et** de même taille seraient désormais indiscernables à l'œil. Le corpus de travail n'en
compte aucune ; le cas est nommé dans `AlignMatrixView.selectFamily.test.ts`, qui construit
deux « Corpus » et les départage par leur nombre de documents.

**Un défaut trouvé en jouant la passe, et corrigé : le ↻ des familles.** Le panneau
d'alignement ne chargeait ses familles qu'à son `render()` — qui ne se rejoue jamais, le DOM
des sous-vues étant persistant (bascule par `display`). Une famille créée ailleurs après
l'ouverture de l'écran restait donc invisible jusqu'à un clic sur ↻, et le bouton finissait
par ressembler à une étape obligatoire ; la question posée en jouant la passe était exactement
celle-là.

Ce n'était pas un parti pris mais une divergence entre deux voisines : `AlignMatrixView`, sur
le même écran et pour la même liste, rechargeait déjà dans son `onActivated`. Le panneau fait
pareil désormais. `refreshDocs()` ne suffisait pas et donnait le change : il appelle
`_populateFamilySelect`, qui repeint depuis le cache **sans redemander au moteur**.

**Deux choses relevées en passe adverse, hors périmètre, non traitées.**

`.prep-selmenu-native` — la règle qui masque le `<select>` — perdait contre
`.prep-actions-screen select` (0,1,0 contre 0,1,1) : le contrôle « masqué » gardait sa
largeur, son padding et sa bordure, mesuré **320×12px au lieu de 1×1**. Sans conséquence
visible, puisqu'il est en `absolute`, d'opacité nulle et hors du pointeur — mais la règle ne
faisait pas ce qu'elle annonçait, et seulement dans les écrans qui ont une règle générique
`select`. **Cinquième occurrence du motif de spécificité**, corrigée d'un sélecteur
descendant. Cinq fois le même geste : une règle générique d'écran qui écrase la classe d'un
composant. Ce n'est plus une coïncidence, c'est une propriété de `app.css`.

`ExportsScreen.dispose()` et `MetadataScreen.dispose()` **ne sont appelés par personne** :
`app.dispose()` ne démonte que `_actions`. C'est antérieur à ce chantier et sans rapport avec
lui — mais ce qui fuit alors n'est pas l'habillage (le DOM détaché part au ramasse-miettes),
c'est le `setTimeout` de sondage d'Exports, qui survit au démontage en tenant l'écran entier.
À traiter ailleurs, avec sa propre vérification.

Pas de champ `audit:` — et l'avertissement du vérificateur est ici attendu : aucun audit ne
porte ce chantier. Sa source est l'usage, rapporté le 4 septembre 2026 (« sur l'écran
d'ordinateur ça monte et dépasse »), puis l'inventaire des ~50 `<select>` de prep et la mesure
des deux zones de travail. Le raisonnement de fond, lui, est déjà écrit : c'est l'en-tête de
`shared/anchorMenu.ts`, que ce chantier ne fait qu'appliquer là où il ne l'était pas.
