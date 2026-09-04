---
chantier: CHR-01
statut: interrompu
---

# CHR-01 — la barre Constituer remonte d'un cran, et les presets tombent

**Arrêté sur** — quatre lots livrés et poussés le 1er septembre 2026 (`591d784`) : la coquille
de modale renommée avec sa garde, les presets retirés des deux côtés, le pont shell → prep et
les deux remontées, puis la barre elle-même avec ses trois réancrages. 98px de chrome ramenés
à 44. **La passe de QA est jouée, 35 sur 35 le 2 septembre 2026.** Elle a trouvé trois défauts,
tous corrigés le jour même : une seconde barre de défilement vieille de six mois ; l'icône du
Journal qui restait peinte quand le tiroir se fermait par sa propre ✕, plus la seconde porte du
même défaut — le remontage à mode égal — trouvée à la passe adverse du correctif ; et « Fiche
corpus » qui rendait une URL de boucle locale sur une base illisible. Quatre de ses attendus
ont par ailleurs été corrigés par la mesure, tous écrits d'après l'architecture plutôt que
d'après l'écran.

**Les deux items de code sont faits le 3 septembre.** Le raccourci « Fiche corpus » est dans
l'en-tête de Documents, et la purge CSS s'est révélée sept fois plus large que l'item ne le
disait : 25 classes mortes au lieu de trois blocs, 188 lignes retirées, le bundle CSS de prep
allégé de 2,3 %.

**Le dernier item est fait le 4 septembre, et il a changé de nature en route.** Il était posé
comme « une décision, pas du code » : restituer le titre du corpus, ou constater que le nom de
fichier suffit. La mesure penchait pour le second — `title` NULL sur les quatre bases, dans un
emplacement pourtant occupé cinq mois durant. Mais un champ vide parce que les bases sont des
bases de travail n'est pas un champ inutile : c'est un champ jamais mis en situation. Et une
fois la question reprise du bon côté, elle en a ouvert une plus importante — **une copie de
fichier emporte le titre avec elle**, donc le titre étiquette et ne peut pas identifier. Le
lot livré ne restitue donc pas un affichage : il sépare l'étiquette de l'identité, et rend le
nom de fichier visible aux quatre endroits où l'on risque de confondre deux copies.

**Point de reprise, 4 septembre.** Le lot « identité de la base » est écrit, construit et
testé — prep 1420 tests, shell 106 (dont 10 neufs, 5 prouvés au rouge), les deux lints au
vert — et **rien n'est commité** : aux huit fichiers du 3 septembre s'ajoutent `shell.ts`,
la fiche corpus dans `app.ts`, `app.css` et la garde neuve. Rien n'a encore été vu à l'écran,
ni pour ce lot ni pour les deux précédents : le raccourci Documents, la purge CSS, et
maintenant le déclencheur à deux lignes. Le prochain geste est donc de lancer le shell et de
regarder — Documents d'abord, puis le déclencheur avec et sans titre.

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
- [x] Passe adverse des deux derniers items, deux défauts. **Un** : vider un `@media` devenu vide emporte aussi ses commentaires, et l'un d'eux ne parlait pas des règles mortes qui l'entouraient — c'était une décision sur `.prep-nav` (« ne PAS empiler le rail sous 1050px, le flip en colonne produisait un bloc navy de 48px collé en haut »), logée dans un `@media` de curation par accident d'histoire. Remise à côté de `.prep-nav`, où elle s'applique. Vérification faite sélecteur par sélecteur sur le diff : aucun vivant emporté, et aucun autre commentaire de fond perdu. **Deux** : `_showCorpusInfoModal` ne se gardait d'aucune seconde ouverture — deux modales empilées au double clic, en fermer une laissait l'autre. Préexistant, mais le raccourci le rendait atteignable, l'entrée de menu du shell se refermant après le clic. Garde posée, prouvée au rouge
- [x] Restituer le titre du corpus — **tranché autrement que prévu, deux fois**. La mesure disait « `title` est NULL sur les quatre bases de la machine, WORKCOPY comprise, alors que la barre l'affichait du 24 mars au 1er septembre : champ vu et non rempli, donc à ne pas restituer ». La raison réelle était ailleurs : ce sont des bases de **travail**, jamais nommées parce qu'on n'a jamais eu à les nommer. Elle explique la mesure ; la mesure ne l'impliquait pas. Un titre a été posé sur WORKCOPY le 4 septembre 2026, et le champ est devenu vivant
- [x] La forme « Titre — fichier.db » de l'ancienne barre est morte à la mesure : le déclencheur fait 240px avec ellipse, la forme composée en demande 309 et coupe à ~26 caractères — soit exactement le segment qui distingue une base de sa copie (`…WORKCOPY.db` contre `…WORKCOPY.PRE-REBUILD-2026-08-25.db`). La barre pouvait se le permettre, elle était pleine largeur
- [x] **Le point qui commande tout le lot** : une copie de fichier emporte le titre avec elle. Deux copies portent donc le même. Le titre ÉTIQUETTE, le nom de fichier IDENTIFIE — d'où deux lignes plutôt qu'un choix entre les deux, et le nom de fichier qui descend d'un cran sans jamais disparaître
- [x] Déclencheur 🗄 à deux lignes. Mesuré : 206×36px avec titre, 229×26px sans (soit, sans titre, exactement la taille et la place d'avant), contre 44px de header et 240px de plafond. Quand ça déborde, c'est le **titre** qui cède ; et deux sauvegardes dont les noms ne diffèrent qu'à la fin (`…_161454` / `…_161529`) restent distinguables, les chiffres tombant avant la coupe — vérifié, pas d'ellipse médiane nécessaire
- [x] Le titre est stocké en couple `{ chemin, titre }` et filtré par `_titreCourant()`. `_currentDbPath` est affecté depuis **neuf** endroits : un titre qu'il faudrait penser à effacer à chacun finirait par survivre à l'un d'eux. Clefé sur son chemin, un titre périmé n'est pas nettoyé — il est **inaffichable**. Vaut aussi pour DEG-01 : une base qui échoue à s'ouvrir ne peut pas hériter du titre de la précédente
- [x] Lecture par la connexion que `ensureRunning` vient d'établir (`getActiveConn`), pas par une redécouverte du portfile — même connexion, déjà authentifiée, et elle passe par la commande Rust ; un `fetch()` direct est bloqué par CORS (QA-13, le piège où `diagnostics.ts` était tombé). Sans attente et sans conséquence en cas d'échec : une fiche illisible ne rend pas la base inutilisable, on reste au nom de fichier
- [x] Les messages passagers (« Chargement… », « Démarrage du moteur… ») masquent la ligne de titre, via `_setTriggerTransient`. Ce n'est pas cosmétique : pendant un changement de base, le titre encore affiché est celui de la base qu'on **quitte**, posé au-dessus du nom de celle qu'on ouvre — et un changement peut durer plusieurs secondes
- [x] La fiche corpus dit dans quelle base elle écrit : nom de fichier dans son en-tête, chemin complet en infobulle. C'est l'endroit où l'on **saisit** le titre, et le seul où l'on pouvait nommer une copie en croyant nommer l'original. Au passage, son texte d'aide renvoyait encore à « la barre », retirée au lot 3
- [x] La liste des récentes préfixe du dossier parent les seules entrées **homonymes** : deux copies de même nom dans deux dossiers y étaient rigoureusement indiscernables, le chemin complet ne vivant que dans l'infobulle. Préfixer partout allongerait chaque ligne pour un cas qui n'arrive pas toujours
- [x] Le titre de fenêtre porte le nom de fichier — c'est ce qui distingue deux fenêtres dans la barre des tâches. Pas le titre de corpus, qu'une copie porte à l'identique et qui n'y départagerait rien
- [x] **Passe adverse du lot, quatre trouvailles.** *Un* — j'avais mesuré une maquette CSS puis écrit un CSS légèrement différent dans `SHELL_CSS` : mesure refaite sur le littéral **extrait du fichier**, les six états y sont justes, y compris les deux lignes teintées ensemble en rouge (DEG-01) et en ambre (« modifiée »), que la maquette ne couvrait pas. *Deux* — mon propre plafond de `46%` sur le repère de la fiche coupait le nom de fichier **avant** que la place ne manque : un nom de sauvegarde réel de 48 caractères demande 336px et n'en recevait que 278. Le retirer tout à fait replie le titre du dialogue sur deux lignes (en-tête à 90px au lieu de 49) ; `60%` prend les deux cas, mesuré. *Trois* — `_setTriggerTransient("Chargement…")` dans `_switchDb` ne peint **jamais** : `_updateDbBadge()` le remplace quatre instructions plus loin, sans `await` entre les deux. Antérieur au lot — l'écriture directe qu'il remplace subissait le même sort — donc comportement laissé tel quel, mais la garde dit désormais qu'elle protège le *routage* et non une visibilité. *Quatre* — les trois étapes du tour d'accueil posent `_currentDbPath` **sans** passer par `_initDb`, donc sans lire de titre ; sans danger (la base démo vit dans `$APPDATA`, où `exists()` fonctionne, et sa taille est contrôlée avant qu'on la propose) et sans effet visible, une base démo n'ayant pas de titre
- [x] **Un troisième cas du même motif, corrigé en chemin** (hors périmètre du chantier, mais trouvé par lui). Les règles génériques `.prep-actions-screen <élément>` sont en spécificité **0,1,1** ; les classes des composants de cet écran — la matrice d'alignement comprise — en **0,1,0**. La générique gagne donc toujours, y compris pour ajouter ce que le composant n'a pas demandé. Après les textareas plafonnées à 420/480px et le sélecteur de famille qui flottait 8px au-dessus de ses voisins (`margin-bottom: 0.5rem` reçu, dans une barre en `align-items: flex-end` qui aligne les bords de marge), le panneau « Avancé… » : ses labels déclarent `display: flex` **sans direction**, comptant sur `row`, et recevaient `column` — « Mode » au-dessus de son menu, « Seuil » au-dessus de son champ, et la case à cocher détachée au-dessus de « Conserver les liens validés ». Depuis la création du panneau le 13 juillet 2026 : il ne s'est **jamais** affiché comme il est écrit. Mesuré 173px de haut, 114 une fois rendu à son intention ; décalage du sélecteur ramené de 8,0 à 0,0px. Garde `ui/__tests__/actionsScreenOverrides.test.ts`, 6 cas, les quatre points de rupture prouvés au rouge — dont un qui surveille la règle générique elle-même : si elle cesse d'imposer la colonne, c'est là qu'on rouvrira la question plutôt qu'au hasard d'une capture
- [x] Vérifications de fond de la même passe : `ensureRunning` termine bien par `_conn = makeConn(…)`, donc `getActiveConn()` rend la connexion qu'on vient d'établir — l'hypothèse qui porte tout le lot ; `_buildHeader` n'est appelé qu'une fois ; et seuls **deux** sites écrivent dans la ligne du nom (le peintre et le message passager), ce que la garde verrouille par un compte
- [x] Gardes : `modules/__tests__/dbIdentity.test.ts` (10 cas), dont **cinq prouvés au rouge** — titre déclefé de son chemin, message passager qui ne masque plus, peintre qui lit `_titreCorpus` en direct, contrôle de chemin remonté avant l'attente, titre de fenêtre qui reprend le titre de corpus ; plus 4 cas côté prep dans `prepChrome.test.ts`. Rien de tout cela ne se rend : un titre périmé ressemble trait pour trait à un titre juste
- [x] QAS-01 — le retour de focus par la ✕ du tiroir : réglé le 2 septembre par l'annonce d'état (`agrafes:prep-journal`), qui rend au shell les deux fermetures d'un coup. Prep ne connaît toujours pas son déclencheur — il n'a plus besoin de le connaître
- [x] « Fiche corpus » sur une base illisible rendait une URL de boucle locale — `Lecture fiche corpus : sidecar_fetch_loopback: request to 'http://127.0.0.1:57263/corpus/info' failed…` — dans un toast de 400px affiché trois secondes en bas à droite, que l'utilisateur n'a pas reconnu comme une réponse à son clic. Toast réécrit en une phrase, détail laissé à la console où le client sidecar l'écrit déjà. Au passage : le garde sur `_conn` nul ne se déclenche PAS dans ce cas, prep obtenant bien une connexion — c'est la requête qui échoue
- [x] Seconde porte du même défaut, trouvée à la passe adverse : `_updateHeaderTabs` ne dépeignait l'icône que si le mode changeait, or le remontage après un changement de base passe par `_setMode(_currentMode, { force: true })` — tiroir détruit, icône allumée. Dépeint rendu inconditionnel : `_setMode` est le seul appelant et démonte le module juste après. Le dépeint reste là plutôt que dans `dispose()`, dont l'annonce ferait sauter le focus sur 📋 au milieu d'un changement de base
- [x] L'icône 📋 restait peinte quand le tiroir se fermait par sa PROPRE ✕ — le shell peignait depuis le retour de `toggleJournal()`, aveugle à ce chemin, et le clic suivant rouvrait ce qu'elle semblait proposer de fermer. Trouvé en jouant la passe le 2 septembre, corrigé avec le point ci-dessus : prep émet son état, un écouteur du shell est désormais le seul à peindre l'icône. Deux gardes posées de chaque côté, les quatre prouvées au rouge
- [x] Poser la garde des trois réancrages — `ui/__tests__/prepChrome.test.ts`, 5 cas, chacun prouvé au rouge (ancêtre positionné retiré, repli du token dérivé, ancrage optionnel rétabli)
- [x] Purge CSS faite, et **bien plus large que ces trois blocs** : l'item avait été écrit sur un sondage. L'audit classe par classe — vocabulaire des sélecteurs confronté au TS/HTML, protection de racine pour les classes construites dynamiquement — donne **25 classes qu'aucun code n'applique**, restes de SegmentationView (`prep-seg-split-*`, `prep-seg-diff-*`…) et de CurationView (`curate-*`). 38 règles, toutes PURES : aucun sélecteur ne mélange mort et vivant, donc 0 usage vivant = 0 régression. Retiré : 188 lignes et 9 blocs `@media` devenus vides, plus cinq commentaires qui nommaient encore une classe purgée. Bundle CSS 168,21 → **164,33 kB** (−2,3 %)
- [x] Seconde barre de défilement supprimée — le wrapper de prep héritait de `min-height: 100vh` de la règle `#app` de `tauri-shell/index.html`, dont seul le `padding-top` était annulé : 794px dans un parent de 706. Défaut d'origine (`c417e9d`, 1er mars 2026), trouvé par la sonde de la passe
- [x] Raccourci « 📄 Fiche corpus… » ajouté en tête de `prep-meta-head-actions`, le bloc que le gabarit appelle déjà « corpus actions ». En `btn-ghost`, plus léger que ses voisins — c'est un raccourci, pas une action, comme le cadrage le demandait. Chaîne à trois maillons sur le modèle de `setOnOpenAlignment` : bouton du gabarit → `setOnOpenCorpusInfo` de `MetadataScreen` → `App` qui oriente vers `openCorpusInfo()`, la commande que le menu de la base du shell appelle aussi. Une seule modale, deux entrées. Trois gardes dans `prepChrome.test.ts`, la dernière prouvée au rouge en retirant le câblage d'`App` : aucun maillon ne casse bruyamment, prep tournant sous `node`, sans DOM
- [x] Écrire la passe de QA `qa/chrome-constituer.md`
- [x] La jouer — 35 sur 35 le 2 septembre 2026, trois défauts trouvés et corrigés le jour même, et quatre de ses attendus corrigés par la mesure

## QA

- qa/chrome-constituer.md
- qa/identite-base.md

Écrite et jouée le 4 septembre 2026 — **24 sur 24**, et aucun défaut dans le lot lui-même :
le déclencheur à deux lignes, la fiche qui nomme son fichier, les homonymes des récentes et
le titre de fenêtre ont tous rendu ce qui était annoncé.

Ce qu'elle a fait remonter est venu d'ailleurs, et par une question plutôt que par une case :
« la boîte *Avancé…* a changé ? ». Elle n'avait pas changé — elle ne s'était **jamais**
affichée comme elle est écrite, depuis le 13 juillet 2026. Troisième occurrence du motif
`.prep-actions-screen <élément>` contre la classe du composant. Corrigé le jour même avec le
sélecteur de famille, qui relevait de la même cause. D'où la zone ajoutée en fin de passe,
seule non jouée à ce jour.

Écrite le 1er septembre 2026, jouée le 2 — 35 sur 35. Elle porte moins sur ce qui disparaît que
sur les trois réancrages : un bandeau d'erreur qui ne s'insère plus, un garde de sortie
d'onglet qui ne demande plus rien, un tiroir qui passe sous le header. Trois défauts
silencieux, dont aucun ne se voit tant qu'on ne provoque pas le cas.

Son préambule porte la sonde de console qui départage les barres de défilement réelles —
à avoir sous la main pour la zone « Défilement », dont un point demande de la relancer sur
Importer **chargé**, cet écran n'ayant de hauteur que par sa file de fichiers.

Le bandeau d'erreur, lui, ne s'y teste plus : celui de prep était un doublon inatteignable et
a été supprimé, celui du shell est parfaitement atteignable et se vérifie dans
`qa/mode-degrade.md`. Le préambule le dit depuis DEG-01.

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
