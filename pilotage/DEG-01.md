---
chantier: DEG-01
statut: clos
---

# DEG-01 — quand une base ne s'ouvre pas : un bouton qui mentait, et une base absente qu'on créait

*Titre d'origine : « base illisible : la bonne surface existe, un bouton ment, et prep en garde
une copie morte ». Il décrivait le premier lot, écrit avant de savoir que le chantier porterait
surtout sur le second cas — la base **absente**, silencieusement créée — qui s'est révélé bien
plus grave que la base illisible par laquelle on était entré.*

**Arrêté sur** — le premier lot est livré et poussé le 1er septembre 2026 (`bc359a3`) : le
bouton qui promettait d'ouvrir et créait, la copie morte de prep et sa cascade, l'état d'erreur
persistant du déclencheur, les deux rejets rattrapés.

**Le 2 septembre, en préparant la passe, un second défaut est apparu, plus grave que le
premier : une base absente n'était pas signalée, elle était CRÉÉE.** Ouvrir et créer sont la
même opération côté moteur, et aucun chemin d'ouverture ne vérifiait que le fichier existe —
pas même celui du démarrage, qui rejoue le chemin persisté : une base déplacée entre deux
sessions revenait vide, en silence.

**Corrigé le jour même**, par un contrôle d'existence en tête de `_initDb` — le seul point où
convergent les quatre portes — avec une exemption explicite pour la création, et des gardes
prouvées au rouge.

**Le 3 septembre, l'écran a démenti le correctif deux fois avant qu'il tienne.** Première
version : garde dans `_initDb`, appuyé sur l'`exists()` du plugin `fs` — qui lève hors de
`$APP`/`$APPDATA`, donc sur toute base rangée dans les documents. Le garde tombait dans son
repli ouvert à chaque appel et n'a jamais rien empêché ; le badge « introuvable » des récentes,
qui s'appuyait sur le même appel, n'avait donc jamais fonctionné pour personne non plus. D'où
la commande Rust `path_exists`, hors portée FS.

Seconde version : le garde refusait bien — deux fois dans le journal — et la base était créée
onze secondes plus tard. Parce que `_switchDb` continuait après lui : chemin déjà adopté,
persisté, publié aux modules abonnés, dont **chacun démarre son propre sidecar** sur ce qu'on
lui donne. `_initDb` n'est que la porte du shell, pas celle du moteur.

**Ce qui tient, et qu'il faut garder en tête pour la suite** : l'invariant n'est pas « ne pas
démarrer sur un chemin absent », c'est que **`_currentDbPath` ne porte jamais un chemin qui
n'existe pas**. Contrôle avant adoption dans `_switchDb`, chemin lâché au démarrage, garde
conservé dans `_initDb` pour « Réessayer », exemption explicite pour la création.

**Clos le 3 septembre 2026 au soir.** Trois lots : le premier (`bc359a3`) sur la base
illisible, le deuxième (`25be190`) sur la base absente et sa primitive sans permission, le
troisième (`4533f89`) sur l'écran de démarrage sans sortie et l'échec qui s'annonçait « DB
changée ». La passe `qa/mode-degrade.md` est jouée entièrement, et chaque comportement a été
**vu à l'écran**, pas seulement testé — c'est elle qui a démenti deux versions du correctif que
le build, les tests et le lint validaient.

Ce qu'on n'a délibérément pas traité est descendu dans le Contexte, en bas de fiche : ce sont
des choix, pas des tâches en attente.

**La première version de cette fiche a été corrigée le jour même** : elle affirmait que rien
n'était montré quand une base ne s'ouvre pas. C'est faux, et la suite dit ce qui l'est.

## Reste

- [x] Corriger le bouton « Choisir un autre fichier… » de `_showInitError` (`shell.ts:2566`) : il appelle `_onCreateDb()`, dont le dialogue est un `dialogSave` intitulé « Créer une nouvelle base de données AGRAFES » — il promet de choisir un fichier existant et propose d'en créer un neuf
- [x] Supprimer la copie morte côté prep : `_showPrepInitError` (`app.ts:528`), doublon inatteignable de la bannière du shell, avec le même défaut de verbe dans son « Réessayer », qui relance `_onCreateDb`
- [x] Supprimer avec elle `_onOpenDb` (`app.ts:487`) et `_onCreateDb` (`app.ts:503`), morts depuis CHR-01 lot 3 et porteurs d'un défaut de conception : ils désynchroniseraient le shell
- [x] Donner au déclencheur de base un état d'erreur persistant, sur le modèle de `.shell-db-trigger--pending` qui existe déjà pour le remontage : une classe et une infobulle, toujours visibles, quel que soit le mode — c'est ce qui manque après que la bannière a été écartée
- [x] Revoir l'effacement de la bannière par Échap (`shell.ts:3561`) : le même gestionnaire ferme le menu de la base, si bien qu'un Échap réflexe emporte le message d'erreur avec lui
- [x] Rattraper le rejet de `void _switchDb(entry.path)` (`shell.ts:1316`) — chemin étroit mais réel : `_switchDb` relance encore sur ce qui n'est PAS un échec de sidecar (MRU, persistance, rappel d'un écouteur qui lève)
- [x] Idem pour `_onChangeDb` (`shell.ts:2670`), dont le `try` n'entoure que le dialogue de fichier, le `await _switchDb(newPath)` de la ligne 2687 étant en dehors
- [x] Trancher si `constituerModule` doit s'abonner à `ctx.onDbChange` — **non** : le shell le remonte à chaque changement de base plutôt que de le notifier, donc l'abonnement n'apporterait rien de plus, et le message est porté par la bannière
- [x] Écrire la passe `qa/mode-degrade.md`
- [x] La jouer — 24 sur 24 le 3 septembre 2026. Elle a fait tomber le premier correctif du jour : garde en place, base créée quand même, onze secondes après le refus
- [x] **Ouvrir une base absente en créait une, en silence.** Ouvrir et créer sont la MÊME opération côté moteur — « Créer… » ne fait rien d'autre (`shell.ts:2530`), seul le dialogue traversé les distingue. Mesuré le 2 septembre 2026 : un clic sur une récente pointant vers un fichier absent a produit une base vide et migrée (4096 o, plus un WAL de 1,4 Mo) et l'a rendue active
- [x] Contrôle d'existence posé en tête de **`_initDb`** — et non dans `_switchDb` comme cette fiche l'annonçait d'abord. La correction vient d'une **quatrième porte** que le premier relevé avait manquée : « Réessayer », le bouton de la bannière, appelle `_initDb(dbPath)` en direct (`shell.ts:2607`) et créait donc lui aussi. `_initDb` est le seul point où les quatre convergent — changement de base, chemin persisté rejoué au démarrage, « Réessayer », et `_onCreateDb`, qui s'en exempte par un `{ creation: true }` explicite
- [x] Le contrôle ne refuse que sur un « non » franc : si `exists` lui-même échoue — import du plugin, hoquet d'IPC, les deux observés le 2 septembre — on ouvre quand même. Refuser sur une incertitude empêcherait d'ouvrir une base saine ; c'est la création silencieuse qu'on ferme, pas le doute
- [x] Surface réemployée telle quelle quand le fichier manque : bannière, état rouge du déclencheur, « Choisir un autre fichier… ». Détail affiché : « Ce fichier n'existe plus à cet emplacement. » Rien de neuf dessiné
- [x] Garde posée — `modules/__tests__/dbOpenGuard.test.ts`, 3 cas, tous prouvés au rouge : le contrôle retiré, le contrôle qui échouerait fermé, et un second `{ creation: true }` ajouté ailleurs. Ce dernier est le vrai risque de rechute : l'exemption est un mot-clé qu'on peut recopier sans y penser
- [x] Cas du démarrage vérifié à l'écran le 3 septembre 2026 à 17h46 : `corpus_agrafes.WORKCOPY.db` renommée application fermée, réouverture — journal `[AGRAFES:boot] Base persistée absente`, bannière, déclencheur à « (aucune) », **et rien de recréé sur le disque**. Le matin même, le même scénario rendait un corpus vide sans un mot. Piège rencontré au premier essai : l'application avait persisté `pas-une-base.db`, la base *illisible* de la passe, si bien qu'elle a rouvert dessus et montré une bannière qui ressemblait à la bonne pour une tout autre cause — il a fallu forcer `agrafes.lastDbPath` sur la base renommée pour exercer la branche visée
- [x] Passe adverse du correctif, deux défauts trouvés dans mon propre travail. **Un** : la commande Rust s'appuyait sur `Path::exists()`, qui rend `false` quand il n'a pas PU regarder — permissions, partage réseau injoignable — et confondait donc « absent » avec « je ne sais pas ». Au démarrage, une base sur un lecteur momentanément indisponible aurait vu son chemin **lâché** : perdue de vue pour un incident passager, exactement le fail-closed contre lequel le garde était écrit. Passé à `try_exists()`, dont l'`Err` arrive au front comme une incertitude. **Deux** : le contrôle étant asynchrone, je l'avais inséré ENTRE le test de réentrance de `_switchDb` et la prise du verrou — deux clics rapides passaient tous deux, donc deux sidecars concurrents, la panne que le verrou de spawn existe pour éteindre. Verrou pris avant le contrôle, relâché au refus
- [x] Passe adverse du second lot, trois défauts. **Un** : `_hideSidecarOverlay` retrouvait l'écran par `getElementById`, alors que son retrait est différé de 380 ms pour l'estompe — deux `_initDb` rapprochés, un double clic sur « Réessayer » suffit, laissent un instant deux éléments du même id, et le masquage visait le premier. Le second écran serait resté pour de bon : le blocage même que ce lot supprime. L'écran est désormais tenu en variable. **Défaut latent, pas observé** — et vérifié comme tel après coup : aucun geste n'atteint la fenêtre de 380 ms, `_switchDb` ayant son verrou, le démarrage n'appelant qu'une fois, et « Réessayer » supprimant sa propre bannière en se déclenchant, si bien qu'un double clic ne part qu'une fois. Le correctif reste juste et gratuit ; c'est la case de QA que j'en avais tirée qui était fausse, et elle est retirée **Deux** : le bouton de sortie prenait le focus et ne le rendait pas — après son clic, focus sur `<body>` et tabulation qui repart du haut, la famille QAS-01 corrigée cette semaine pour le tiroir du Journal. Il le rend au déclencheur de base. **Trois** : un changement de base échoué se journalisait en `info` avec le mot « not ready » ; il passe en `warn`
- [x] L'écran de démarrage a une sortie, et un sous-titre vrai. Un bouton « Poursuivre en arrière-plan » est **créé** au bout de six secondes — pas masqué par `hidden`, dont la faiblesse contre une règle de classe s'est déjà refermée deux fois dans ce fichier — et rend la main sur l'interface, le menu de la base compris, donc on peut en désigner une autre pendant que celle-ci s'ouvre. Il ne coupe pas `ensureRunning` : l'interrompre risquerait un sidecar orphelin, et le verrou de spawn est fait pour qu'il aboutisse. Le sous-titre annonce désormais la trentaine de secondes du premier lancement, au lieu de « quelques secondes »
- [x] Le « DB changée » par-dessus la bannière d'échec : `_initDb` rend un booléen, et `_switchDb` saute le toast et le bandeau bleu quand l'ouverture a échoué. **Et rien d'autre** — les abonnés sont prévenus comme avant, `_pendingDbRemount` est posé comme avant : changer ça demanderait de trancher ce que voient les modules pendant un échec, et la passe a validé le comportement actuel (écrans vides, sans plantage)
- [x] `_checkMruPaths` : refait sur la même primitive que le garde. Deux de ses trois défaillances ouvertes ont disparu par construction — plus d'import à rater, plus de `catch` par entrée. Reste l'appel en `void`, donc un menu ouvrable avant la réponse : latence, non trou, puisque `_rebuildMruMenu` corrige à l'arrivée et que le garde de `_switchDb` rattrape le clic qui court plus vite

## QA

- qa/mode-degrade.md

Écrite le 1er septembre 2026, pas encore jouée. Elle se joue en pointant une base qui n'en
est pas — un fichier texte renommé en `.db`, la recette est dans son préambule — puis en
pressant chacun des trois boutons de la bannière. Le point qui compte est le deuxième :
« Choisir un autre fichier… » doit ouvrir un sélecteur de fichier existant, pas un
enregistreur.

Voir aussi `qa/chrome-constituer.md`, dont le dernier point demande ce que l'écran montre
sidecar arrêté — c'est de là que ce chantier est parti.

## Contexte

**Ce que la première version de cette fiche affirmait, et qui est faux.** Elle citait le
`catch` de `_switchDb` (`shell.ts:1415`) — « Still notify on failure so modules can show
their own error state » — pour conclure que le shell ne montrait rien, confiait tout aux
modules, et que Constituer n'écoutant pas, personne ne parlait. La lecture s'était arrêtée
trop haut.

`_initDb` (`shell.ts:2507`) **attrape** l'échec du sidecar, cache l'overlay, journalise, et
appelle `_showInitError(dbPath, …)` : une bannière collante, ambre, portant le détail de
l'erreur et trois boutons. Et son `catch` **ne relance pas**. Le `catch` de `_switchDb`
n'est donc pas atteint sur ce chemin, il n'y a pas de promesse rejetée dans le vide, et
l'utilisateur voit bien un message. La bannière vit dans le shell, hors des modules : elle
s'affiche dans les quatre modes, y compris l'accueil et la publication qui n'en montent
aucun. `_initDb` étant appelé au démarrage (`shell.ts:1652`), au changement de base
(`:1398`) et à la création (`:2496`), la couverture est complète.

**La question qui avait ouvert ce chantier trouve donc sa réponse.** « Le shell doit-il dire
quelque chose lui-même, ou la délégation aux modules suffit-elle ? » — il le dit déjà, et
c'est le bon endroit : une bannière de niveau shell ne dépend d'aucun module monté.
L'abonnement de `constituerModule` à `onDbChange` reste envisageable pour son état **local**,
pas pour le message.

**Le vrai défaut est un bouton qui ment, et il est vivant.** Dans `_showInitError`, « Choisir
un autre fichier… » exécute `_onCreateDb()` (`shell.ts:2566`), dont le dialogue est un
`dialogSave` intitulé « Créer une nouvelle base de données AGRAFES ». On vient d'échouer à
ouvrir une base, on demande à en désigner une autre, et on obtient un enregistreur de fichier
neuf. `_onChangeDb()` — le `dialogOpen` — est juste à côté et fait exactement ce que le
libellé promet.

**Prep en garde une copie morte, avec le même défaut.** `_showPrepInitError` (`app.ts:528`)
est un doublon de cette bannière, devenu inatteignable depuis que « Créer… » a quitté prep
(CHR-01 lot 3) : son seul appelant est le `catch` de `_onCreateDb`, lui-même appelé
seulement par son propre bouton « Réessayer ». Un cycle fermé. Et ce « Réessayer » relance
`_onCreateDb`, soit un flux de création sur une erreur d'ouverture — le même verbe fautif
qu'en face. La bonne réponse n'est donc pas de le recâbler, comme la première version le
proposait : c'est de le supprimer, la bannière du shell faisant le travail, mieux et partout.

**Ce qui reste silencieux, et qu'il faut arbitrer.** `_onDbChanged` de prep (`app.ts:668`)
attrape l'erreur, pose `_conn = null`, écrit un `console.error`, puis distribue
`setConn(null)` aux six écrans et au Job Center. La bannière du shell dit ce qui se passe,
mais les écrans se rendent vides sans dire pourquoi : une liste de documents à zéro ressemble
à un corpus vide autant qu'à une base fermée. C'est le seul endroit où un signal local aurait
de la valeur, et il est à peser — la bannière est collante et visible, un second message
pourrait n'être que du bruit.

**Un signal local dans prep n'est pas la réponse — mesuré.** La bannière est en
`position: fixed; top: 44px; z-index: 9990`, posée sur `document.body`, et `_setMode`
n'efface que la bannière de *changement* de base : celle d'erreur **survit à la
navigation**. Elle reste donc à l'écran en arrivant dans Constituer, ce qui rend un second
message local redondant, et coûteux — six écrans à toucher.

Le trou est ailleurs. La bannière disparaît sur « Réessayer », « Choisir un autre… », sa
propre ✕, une nouvelle tentative… **et sur Échap**, par un gestionnaire global qui ferme
aussi le menu de la base (`shell.ts:3561`). Un Échap réflexe emporte donc le message. Et
une fois écarté, il ne reste **rien** : `_updateDbBadge` ne reflète que `_pendingDbRemount`,
pas un échec d'ouverture, si bien que le déclencheur a l'air normal pendant que les écrans
sont vides. La réponse tient donc en une classe sur le déclencheur, pas en un signal par
écran — le patron `--pending` est déjà là, il ne manque que le cas.

**Le rejet non traité subsiste, mais étroit.** `_switchDb` relance encore, sur ce qui n'est
pas un échec de sidecar : `_addToMru`, `_persist`, ou le rappel d'un écouteur `onDbChange`
qui lèverait. Deux appelants laissent filer — le clic sur une base récente (`shell.ts:1316`,
en `void`) et `_onChangeDb`, dont le `try` n'entoure que le dialogue. Les trois autres appels
sont protégés.

**Ce que CHR-01 a fermé sans le savoir, et qu'il ne faut pas rouvrir.** `lib/db.ts` ne tient
qu'une variable de module, sans persistance. Si `_onOpenDb` de prep s'exécutait, il posait
cette variable et démarrait un sidecar sur un autre chemin, pendant que le shell gardait son
`_currentDbPath`, sa liste de récentes, sa valeur persistée et Recherche pointée sur
l'ancienne base ; un changement de mode remontait ensuite Constituer avec `ctx.getDbPath()`
= l'ancien chemin, annulant le tout en silence. Le bouton « Ouvrir… » de la barre y menait,
et le lot 3 de CHR-01 l'a supprimé sans le savoir. **Prep ne choisit pas la base** : les deux
dialogues partent, et ils ne reviennent pas.

**Coût.** Front pur, et bien plus petit que la première version ne le laissait croire : un
appel de fonction à corriger, une soixantaine de lignes mortes à retirer côté prep, deux
rejets à rattraper, une décision à prendre sur l'état local des écrans. Zéro moteur, zéro
endpoint, zéro migration, zéro artefact de contrat.

**Ce que la correction enseigne**, et qui vaut d'être noté ici plutôt que perdu : le `catch`
que je lisais annonçait une intention — déléguer aux modules — que le code n'appliquait pas,
parce qu'un appelant plus bas avait déjà tout traité. Un commentaire dit ce qu'on a voulu ;
seul le chemin d'exécution dit ce qui arrive. La première version de cette fiche a été écrite
sur le commentaire.

**Collision.** `shell.ts` et `app.ts` sont aussi le terrain de CHR-01, dont il reste le
raccourci Documents et la purge CSS ; les zones ne se recouvrent pas.

Pas de champ `audit:` : ce chantier vient de la préparation de `qa/chrome-constituer.md`,
le 1er septembre 2026 — chercher comment provoquer le bandeau de prep a suffi à montrer
qu'on ne pouvait pas, puis à faire trouver celui du shell.

**Ce qu'on n'a pas traité, et qui reste vrai.** Résiduels connus, non traités et non bloquants : une base supprimée **pendant** la session est toujours recréée si un module se remonte dessus (le contrôle est à l'ouverture, pas au remontage) ; `_onCreateDb` viole l'invariant le temps de trois lignes, par construction, et un échec de création laisse un chemin mort dans les récentes et dans l'état persisté — que le garde du démarrage rattrape au lancement suivant. Ce sont des choix, pas des tâches en attente : les laisser dans le `Reste` d'une
fiche close ferait compter comme ouvert ce qu'on a décidé de ne pas faire.
