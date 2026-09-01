---
chantier: CHR-01
statut: interrompu
---

# CHR-01 — la barre Constituer remonte d'un cran, et les presets tombent

**Arrêté sur** — quatre lots livrés et poussés le 1er septembre 2026 (`591d784`) : la coquille
de modale renommée avec sa garde, les presets retirés des deux côtés, le pont shell → prep et
les deux remontées, puis la barre elle-même avec ses trois réancrages. 98px de chrome ramenés
à 44. Reste la passe de QA à jouer — un seul de ses points l'a été, celui du défilement, qui a
trouvé un défaut vieux de six mois — et quatre items, tous petits.

## Reste

- [x] Renommer les 6 règles de coquille `.prep-presets-{overlay,modal,modal-head,modal-body,modal-foot}` en **`.prep-dialog-*`** — et non `.prep-modal-*` comme prévu au cadrage : `modalConfirm.ts` occupe déjà la famille `.prep-modal-confirm-*`, deux voisines trop proches
- [x] Poser la garde de la coquille — `ui/__tests__/dialogShell.test.ts`, 4 cas : elle échoue bien si le lot 2 emporte une règle de trop (prouvé en supprimant `.prep-dialog-overlay`, 2 cas au rouge)
- [x] Supprimer les presets de projet dans prep : `SEED_PRESETS`, `_presets`, `_loadPresetsFromDb`, `_savePresetsToDb`, `_showPresetsModal`, `_showPresetEditModal`, le bouton de barre
- [x] Supprimer `applyPreset()` et l'interface `ProjectPreset` (`ActionsScreen.ts:42-54` et `:648`)
- [x] Supprimer les 7 règles CSS propres aux presets (`.prep-preset-row`, `-name`, `-desc`, `-chips`, `-chip`, `.prep-presets-empty`)
- [x] Supprimer les presets globaux du shell : bouton `⚙ Presets`, store, modale, `_migratePresetsFromPrep`, les deux clés `localStorage`, le CSS
- [x] Retirer `global_presets_count` de `diagnostics.ts` et ses deux assertions dans `diagnostics.test.ts:94` et `:184`
- [x] Retirer les symboles devenus morts que rien ne signale : `appendHtml`, `writeTextFile`, `readTextFile` dans `app.ts`, `_getJson` dans `diagnostics.ts` — `noUnusedLocals: false` dans les DEUX tsconfig, et l'ESLint du dépôt ne les voit pas non plus
- [x] Réancrer le bandeau d'erreur d'ouverture de base : `insertAdjacentElement` sur `.prep-topbar` (`app.ts:732`) échoue **silencieusement** une fois la barre partie
- [x] Réancrer `#app-pending-confirm` en tête de `.prep-shell`, sinon le garde de sortie d'onglet devient muet
- [x] Passer `--prep-topbar-h` de 54 à 44px (`tokens.css:62`) et revérifier ses quatre consommateurs
- [x] Supprimer la barre elle-même : titre « Constituer », chemin de la base, `Ouvrir…`, `Créer…`, `Presets`, `Fiche corpus`, `↗ Shell`, `Journal`
- [x] Garder `_onOpenDb`, `_onCreateDb` et la classe `.prep-topbar-db-btn` : le bandeau d'erreur s'en sert encore (`app.ts:727-729`)
- [x] Trancher le sort de la boucle qui désactive tous les `.prep-topbar-db-btn` pendant la création d'une base (`app.ts:703`) — sans barre elle ne trouve plus que les boutons du bandeau
- [x] Ouvrir un pont shell → `constituerModule` → `App` : une commande nommée, sans élargir `ShellContext` qui est délibérément minimal
- [x] Ajouter « 📄 Fiche corpus… » au menu de la base du shell — toujours visible, bascule sur Constituer si on vient d'Explorer
- [x] Ajouter l'icône `📋` Journal au header shell, **rendue seulement en mode Constituer**
- [x] Poser la garde du pont — `modules/__tests__/constituerCommands.test.ts`, 4 cas : une commande appelée module démonté doit être sans effet, pas lever (prouvé au rouge en retirant les appels optionnels : `TypeError` sur les deux)
- [x] Réancrer le tiroir Journal sous le header shell (`app.css:56`, `top: var(--prep-topbar-h)`)
- [x] Rendre lisibles les trois boutons du bandeau d'erreur — ils empruntaient `.prep-topbar-db-btn`, soit du blanc à 90 % sur fond jaune clair ; défaut préexistant, sur la seule surface qui annonce une base illisible
- [x] Rendre au header shell le repère ARIA `banner`, que la barre portait et que rien ne portait plus
- [x] Rendre le focus au déclencheur à la fermeture du Journal (QAS-01, chemin header)
- [ ] Restituer le titre du corpus quelque part : la barre affichait « Titre — fichier.db », le déclencheur du shell n'affiche que le nom de fichier
- [ ] QAS-01 — le retour de focus par la ✕ du tiroir reste ouvert : prep ne connaît pas son déclencheur, et l'item de la revue prescrit un correctif sur un bouton qui n'existe plus
- [x] Poser la garde des trois réancrages — `ui/__tests__/prepChrome.test.ts`, 5 cas, chacun prouvé au rouge (ancêtre positionné retiré, repli du token dérivé, ancrage optionnel rétabli)
- [ ] Purger trois blocs CSS morts que la passe du lot 3 a mis au jour : `.prep-seg-split-layout` (`app.css:4771` + la surcharge de `constituerModule.ts:51`) et `.curate-preview-card` (`prep-vnext.css`) ne sont appliqués par AUCUN code — survivants des retraits de SegmentationView et CurationView, que la purge `aa7ded3` a manqués
- [x] Seconde barre de défilement supprimée — le wrapper de prep héritait de `min-height: 100vh` de la règle `#app` de `tauri-shell/index.html`, dont seul le `padding-top` était annulé : 794px dans un parent de 706. Défaut d'origine (`c417e9d`, 1er mars 2026), trouvé par la sonde de la passe
- [ ] Ajouter le raccourci « Fiche corpus » dans l'en-tête de l'écran Documents, par callback sur le modèle de `setOnOpenExporter`
- [x] Écrire la passe de QA `qa/chrome-constituer.md`
- [ ] La jouer

## QA

- qa/chrome-constituer.md

Écrite le 1er septembre 2026, pas encore jouée. Elle porte moins sur ce qui disparaît que
sur les trois réancrages : un bandeau d'erreur qui ne s'insère plus, un garde de sortie
d'onglet qui ne demande plus rien, un tiroir qui passe sous le header. Trois défauts
silencieux, dont aucun ne se voit tant qu'on ne provoque pas le cas.

Son préambule porte deux choses qu'il faut avoir sous la main pour l'exécuter : la sonde de
console qui départage les barres de défilement réelles, et la raison pour laquelle le
bandeau d'erreur ne peut PAS être provoqué — il n'a plus d'entrée du tout.

## Contexte

**L'origine.** Plus on utilise Constituer, plus la barre du haut — « Ouvrir », « Créer »,
« Presets » — paraît occuper une place qu'elle ne mérite pas : soit redondante, soit utile
une seule fois. La vérification donne raison à l'impression, et plus fort qu'elle ne le
disait.

**Quatre boutons sur six sont déjà un cran au-dessus.** Le header shell
(`shell.ts:2192`) porte à droite un déclencheur `🗄 <nom de la base> ▾` dont le menu offre
`Ouvrir…`, `Créer…` et une liste de bases récentes avec épinglage et détection des
introuvables — soit strictement mieux que les deux boutons de prep. Le nom de la base y
est déjà affiché. La barre de prep (`app.ts:245-311`) redit donc le nom, `Ouvrir…` et
`Créer…`, et ajoute un titre « Constituer » qui répète l'onglet actif.

**Un bouton est absurde.** `↗ Shell`, dont l'infobulle dit « Ouvrir la DB active dans
AGRAFES Shell », est déclenché **depuis le shell** : prep n'a aucune notion d'être
embarqué — zéro occurrence de `isShell`, `embedded` ou équivalent dans tout
`tauri-prep/src`. Les six boutons se dessinent à l'identique dans les deux contextes.
C'est un vestige du mode autonome, lequel n'est plus une cible : l'autonomie visée
désormais est celle d'Explorer, pas celle de prep.

**Les presets sont morts, et de deux façons indépendantes.** `applyPreset()`
(`ActionsScreen.ts:648`) ne pose plus que deux champs — `#act-align-strategy` et
`#act-sim-threshold` — et seulement si l'écran Actions est monté, sinon `return` muet :
les champs de langue et de pack de segmentation, et le preset de curation, ont disparu
avec le retrait de SegmentationView et de CurationView. Un preset porte six attributs
dont quatre ne vont nulle part. Côté shell, les presets *globaux* ne sont **jamais lus**
hors de leur propre modale (`shell.ts:2766`) : lister, supprimer, exporter, importer,
migrer. Aucun « Appliquer », nulle part. Et le bouton « ↓ Migrer depuis Constituer » lit
`localStorage["agrafes.prep.presets"]` (`shell.ts:1033`), une clé que prep n'écrit plus
depuis qu'il persiste dans `corpus_info.meta.presets` — il ne migre rien depuis ce
jour-là. On retire, on ne déplace pas.

**Le volume, mesuré.**

| Zone | Contenu | Lignes |
|---|---|---|
| `tauri-prep/src/app.ts` | seeds, chargement, persistance, deux modales, bouton | ~356 sur 1189, soit 30 % du fichier |
| `tauri-shell/src/shell.ts` | store, modale, bouton, migration, CSS, deux clés | ~173 |
| `tauri-prep/src/ui/app.css` | 13 règles, dont 6 à renommer et 7 à supprimer | 13 |
| `tauri-shell/src/diagnostics.ts` | `global_presets_count` et ses 2 assertions de test | ~6 |

Aucun test ne couvre les presets de projet : les occurrences de `preset` dans les suites
visent les *presets de curation*, un autre objet, qui reste. Coût moteur, endpoint,
migration, artefact de contrat : **zéro** — les presets vivent dans `meta_json` en JSON
libre, et les données déjà écrites y resteront inertes, rien à migrer.

**Le piège qui ordonne les travaux.** La Fiche corpus réutilise les classes CSS des
presets : `.prep-presets-overlay`, `-modal`, `-modal-head`, `-modal-body`, `-modal-foot`
(`app.ts:759-810`). Purger le CSS des presets casserait la Fiche corpus, celle-là même
qu'on cherche à mettre en valeur. D'où le renommage en préalable, et non en nettoyage
final.

Le nom retenu est **`.prep-dialog-*`** et non `.prep-modal-*` comme l'annonçait le
cadrage : `modalConfirm.ts` tient déjà `.prep-modal-confirm-overlay`, `.prep-modal-confirm`,
`-title`, `-body`, `-actions`. Un `.prep-modal-overlay` juste à côté d'un
`.prep-modal-confirm-overlay` aurait donné deux familles voisines à une syllabe près, pour
deux objets différents — la coquille générique d'un côté, la boîte de confirmation de
l'autre. `prep-dialog` était libre au grep, et aucun sélecteur du dépôt ne filtre les
classes par préfixe (`[class^=]`, `[class*=]`), donc le renommage ne pouvait rien attraper
d'autre.

**Ce que la purge a révélé, et qui vaut au-delà d'elle.** Les deux `tsconfig.json` portent
`noUnusedLocals: false`, et la configuration ESLint du dépôt ne relève pas non plus les
imports inutilisés. Retirer un gros bloc laisse donc derrière lui des symboles morts que
**rien** ne signale — ni le build, ni le lint, ni les 1394 tests. Cinq ici :
`appendHtml`, `writeTextFile`, `readTextFile` et la fonction `_escHtmlApp` dans `app.ts`,
`_getJson` dans `diagnostics.ts`.

La chasse se fait en deux temps, et **le premier ne suffit pas** : compter les occurrences
de chaque nom importé n'attrape que les imports. `_escHtmlApp` est une fonction de module —
elle n'apparaît dans aucune liste d'import et n'est tombée qu'au second balayage, celui des
fonctions, méthodes privées, champs et constantes du fichier. Le lot 3 en produira d'autres,
`_showPresetsModal` n'étant pas le seul bloc de `app.ts` à mourir : faire les deux passes.

Ce balayage a aussi levé quatre orphelins **préexistants**, à ne pas confondre avec les
siens : `_dbBadgeText` (`shell.ts`), `_prependBackBtn`, `_runValidateMeta` et `_runIndex`
(`ActionsScreen.ts`), tous déjà morts dans `HEAD`. Attribuer avant de retirer — un
`git show HEAD:<fichier>` et un compte d'occurrences suffisent.

Deux mesures de fin de lot, à ne pas re-dériver : `app.ts` passe de 1190 à 827 lignes,
`shell.ts` de 3665 à 3491, pour 613 suppressions et 16 ajouts au total.

**Deux choses apprises au lot 4, à ne pas redécouvrir au lot 3.**

`shell.ts` — 3491 lignes — n'est importé par **aucun** test. Les 83 suites du shell couvrent
`rechercheModule`, `cloudSync`, `cqlHighlight`, `diagnostics` et `constituerModule`, jamais
le fichier lui-même. Une erreur de syntaxe y passe donc le vitest au vert ; seul
`npm run build` la voit. C'est arrivé : un backtick dans un commentaire CSS placé à
l'intérieur de `SHELL_CSS`, qui est un littéral de gabarit. Pour toute modification de
`shell.ts`, **construire avant de tester**, sinon le vert ne prouve rien.

Et `[hidden]` de la feuille UA perd contre une règle de classe de la feuille auteur, à
spécificité égale : `rechercheModule` porte deux surcharges explicites et le commentaire qui
l'explique. L'icône du Journal ne pose pas `display`, donc rien ne casse — mais la surcharge
`.shell-journal-btn[hidden]` est posée d'avance, parce qu'ajouter un `display:inline-flex`
pour centrer une icône est exactement le geste qui la rendrait visible hors Constituer, sans
un mot.

**Le token n'a qu'un seul consommateur vivant** — mesuré à la passe du lot 3. Sur ses
quatre usages, seul `.prep-journal-drawer` (`app.css:57`) est appliqué par du code ; les
trois autres — `.prep-seg-split-layout` deux fois et `.curate-preview-card` — sont des
règles mortes, appliquées par aucun TS. Le passage de 54 à 44px est donc juste et utile
pour le tiroir, qui vient enfin se poser sous le header au lieu de laisser dix pixels de
contenu passer derrière ; il est inerte sur les trois autres. À purger séparément.

**Les trois réancrages, et pourquoi ils comptent plus que le reste.** Retirer la barre
détruit trois choses qui n'y sont que par accident d'implantation :

1. `_showPrepInitError()` insère son bandeau avec
   `root.querySelector(".prep-topbar")?.insertAdjacentElement("afterend", banner)`
   (`app.ts:732`). L'optionnel avale l'échec : sans barre, le bandeau « base illisible —
   Réessayer / Choisir un autre… » ne s'affiche plus, sans erreur ni trace. C'est la
   seule surface qui signale une base corrompue ou introuvable.
2. `#app-pending-confirm` (`app.ts:306`) est l'hôte du garde « modifications non
   enregistrées » en sortie d'onglet, interrogé par `_switchTab` (`app.ts:542`). Sans
   hôte visible, `inlineConfirm` n'a plus où s'écrire et le garde ne demande plus rien.
3. `--prep-topbar-h` (`tokens.css:62`) a quatre consommateurs — `app.css:56` (le `top` du
   tiroir Journal), `app.css:4767`, `prep-vnext.css:302`, `constituerModule.ts:52` — qui
   calculent tous « la hauteur de ce qui est au-dessus de moi ». La valeur ne tombe pas à
   zéro : elle devient les 44px du header shell (`index.html:11`).

**Pourquoi un seul pont sert aux deux remontées.** La modale Fiche corpus vit dans prep et
a besoin de `this._conn` ; la porter dans le menu de la base du shell demande donc un
appel shell → module → `App`. L'icône Journal demande exactement le même. Le pont se
construit une fois et porte les deux — c'est ce qui rend l'icône dédiée presque gratuite,
alors qu'elle paraissait chère au premier cadrage.

**Pourquoi l'icône Journal ne se dessine qu'en Constituer.** Le shell a déjà son propre
journal, sous `?` puis « Exporter logs… ». Une icône permanente ferait attendre les logs
du shell à qui la presse depuis Explorer, alors qu'elle ouvre le compte-rendu d'opérations
de Constituer — celui qu'alimentent cinq écrans (Import, ShareDocs, Actions, Documents,
Exports). La rendre solidaire du mode garde sa portée lisible depuis sa place.

**Le raccourci dans Documents.** Documents est l'écran où l'on qualifie chaque document ;
la Fiche corpus qualifie le corpus, soit le même geste un cran au-dessus. Un lien discret
dans l'en-tête, pas un bouton d'action, et par le même callback que la modale — le patron
`setOnOpenExporter` existe déjà.

**Le gain.** 98px de chrome (44 + 54) ramenés à 44, un bouton absurde en moins, environ
530 lignes de front supprimées, et deux notions homonymes de « presets » qui cessent de
coexister.

**Ordre des lots — corrigé en cours de route.** Le cadrage plaçait le retrait de la barre
avant le pont, en les disant indépendants. Ils le sont pour les tests, pas pour l'usage :
la barre porte les **seuls** accès à la Fiche corpus et au Journal, que le pont rétablit un
cran plus haut. Fait dans cet ordre, l'application perd les deux entre les deux lots.

L'ordre tenu est donc : renommage CSS (préalable) → retrait des presets → **pont et deux
remontées** → retrait de la barre et ses trois réancrages → raccourci Documents. Le pont
d'abord coûte une duplication temporaire — deux entrées pour la Fiche corpus tant que la
barre est là — ce que le menu de la base fait déjà pour « Ouvrir » et « Créer ». L'inverse
coûtait une régression fonctionnelle.

L'inversion est peu chère parce que `_setMode` est déjà `async` : l'entrée de menu bascule
sur Constituer, attend le montage, puis appelle.

**Ce que ce chantier a mis au jour et passé à un autre.** Le bandeau d'erreur réancré au
lot 3 n'a plus d'entrée : son seul appelant, le `catch` de `_onCreateDb`, n'est atteint que
par le bouton « Réessayer » du bandeau lui-même. Le réancrage reste juste — il garde une
porte que plus rien n'ouvre.

Le réflexe était de la rouvrir. La vérification a montré le contraire : le shell porte
**déjà** sa propre bannière d'échec, `_showInitError`, posée par `_initDb` au démarrage
comme au changement de base, et visible dans les quatre modes. Le bandeau de prep n'est donc
pas une surface à rétablir mais un doublon mort à retirer — avec `_onOpenDb` et
`_onCreateDb`, dont la disparition au lot 3 a fermé sans le savoir une vraie
désynchronisation : prep ne choisit pas la base, et ses dialogues n'ont pas à revenir.

Le tout est passé à **DEG-01**, ouvert le 1er septembre 2026, qui porte aussi le défaut
trouvé en chemin — un bouton du shell qui promet de choisir un fichier et ouvre un
enregistreur.

**Collisions connues.** `ActionsScreen.ts` est aussi le terrain d'ACT-01 et de R2, mais ce
chantier n'y touche que l'interface `ProjectPreset` et `applyPreset`, deux blocs isolés en
tête et en fin de fichier. `app.css` est partagé avec R2, dont les modifications en cours
portent sur le canvas — ni sur les modales, ni sur la barre.

**Le recoupement avec EXP-01.** Explorer autonome livre un bundle **sans** le module
Constituer ; son Reste prévoit déjà de gater l'accueil, les onglets, les raccourcis ⌘2/⌘3
et le deep-link `?mode=constituer`, qui mène sinon à l'`import()` d'un chunk absent. Les
deux remontées de CHR-01 tombent exactement dans cette liste : l'entrée « Fiche corpus »
du menu de la base et l'icône Journal du header dépendent du module, et devront être
gatées avec le reste. L'icône Journal l'est déjà par construction, puisqu'elle ne se
dessine qu'en mode Constituer ; l'entrée de menu, non, puisqu'elle est délibérément
toujours visible. À faire suivre dans EXP-01 plutôt qu'ici — mais à ne pas découvrir
là-bas.

Pas de champ `audit:` : aucun audit ne porte ce chantier ; la lecture des sources de
`app.ts`, `shell.ts` et `ActionsScreen.ts` le 1er septembre 2026 en est la seule source.
