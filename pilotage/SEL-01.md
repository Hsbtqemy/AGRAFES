---
chantier: SEL-01
statut: interrompu
---

# SEL-01 — les listes déroulantes cessent de se retourner

**Arrêté sur** — 4 septembre 2026 : l'espace Alignement est converti en entier, **4 sur 11**.
Le composant partagé porte 14 tests, le branchement de l'AlignPanel 8 de plus, dont **3 qui
échouent si l'un des trois sites qui posent `value` par programme oublie de repeindre**.
Reste sept sélecteurs, sur trois écrans — Exports (six), Documents, Import, Inspecteur.

**Ce que la conversion coûte, et que la première tranche n'avait pas vu : la largeur.** Un
`<select>` natif se dimensionne sur son option la **plus large** ; le déclencheur qui le
remplace n'affiche qu'un texte, donc il se dimensionne sur l'entrée **choisie**. Mesuré au
banc (Chrome sans tête, fenêtre 1500×760, titres et familles réels de la base) : les deux
sélecteurs de paire faisaient 245 px quel que soit le document, et l'habillage sans règle de
largeur oscillait entre **138 px** (« Modiano-Rue_ES ») et **249 px** (le plus long titre du
corpus). La barre aurait changé de largeur à chaque choix — un défaut que le contrôle natif
n'avait pas. D'où une largeur posée sur l'enveloppe, et la même vérification à faire pour
chacun des sept sélecteurs restants : c'est la seule partie de la conversion qui ne se
déduit pas.

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
| Exports | `matrix-family-sel`, `bil-family-sel`, `v2-align-pivot`, `v2-align-target`, `align-csv-pivot`, `align-csv-target` |
| Documents | `rel-target-sel` |
| Import | `fam-dlg-parent-sel` |
| Inspecteur d'unités | `meta-token-unit` |

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
- [ ] Convertir les six d'Exports : `matrix-family-sel`, `bil-family-sel`, `v2-align-pivot`/`-target`, `align-csv-pivot`/`-target`
- [ ] Convertir `rel-target-sel` (Documents — 58 documents dans le corpus de travail) et `fam-dlg-parent-sel` (Import)
- [ ] Convertir `meta-token-unit` (inspecteur d'unités) — vérifier d'abord combien d'entrées il peut porter : c'est le seul dont la liste n'est pas bornée par le nombre de documents
- [ ] Décider du sort des `<select multiple>` d'Exports (`v2-doc-sel`, `tei-doc-sel`, `pkg-doc-sel`) : ils s'affichent en liste, pas en menu déroulant, donc ils ne basculent pas — hors périmètre a priori, à confirmer à l'écran
- [ ] Vérifier que les ~40 sélecteurs restants (formats, modes, rôles : listes courtes et fixes) restent natifs — la conversion serait une perte nette, pas un gain
- [ ] Écrire la passe de QA du chantier, ou étendre `qa/menus-flottants.md` qui porte déjà cette famille

## QA

Pas encore de passe propre. Le premier sélecteur converti est vérifié par un point ajouté à
`qa/identite-base.md` (zone « L'espace Alignement »), qui demande de l'ouvrir **sur l'écran
court, fenêtre placée assez bas** — le seul cas où le défaut se manifestait.

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

Pas de champ `audit:` — et l'avertissement du vérificateur est ici attendu : aucun audit ne
porte ce chantier. Sa source est l'usage, rapporté le 4 septembre 2026 (« sur l'écran
d'ordinateur ça monte et dépasse »), puis l'inventaire des ~50 `<select>` de prep et la mesure
des deux zones de travail. Le raisonnement de fond, lui, est déjà écrit : c'est l'en-tête de
`shared/anchorMenu.ts`, que ce chantier ne fait qu'appliquer là où il ne l'était pas.
