---
chantier: DEG-01
statut: à venir
---

# DEG-01 — base illisible : la bonne surface existe, un bouton ment, et prep en garde une copie morte

**Point de départ** — cadrage du 1er septembre 2026, rien de codé. **Première version de
cette fiche corrigée le jour même** : elle affirmait que rien n'était montré. C'est faux, et
la suite dit ce qui l'est.

## Reste

- [ ] Corriger le bouton « Choisir un autre fichier… » de `_showInitError` (`shell.ts:2566`) : il appelle `_onCreateDb()`, dont le dialogue est un `dialogSave` intitulé « Créer une nouvelle base de données AGRAFES » — il promet de choisir un fichier existant et propose d'en créer un neuf
- [ ] Supprimer la copie morte côté prep : `_showPrepInitError` (`app.ts:528`), doublon inatteignable de la bannière du shell, avec le même défaut de verbe dans son « Réessayer », qui relance `_onCreateDb`
- [ ] Supprimer avec elle `_onOpenDb` (`app.ts:487`) et `_onCreateDb` (`app.ts:503`), morts depuis CHR-01 lot 3 et porteurs d'un défaut de conception : ils désynchroniseraient le shell
- [ ] Donner au déclencheur de base un état d'erreur persistant, sur le modèle de `.shell-db-trigger--pending` qui existe déjà pour le remontage : une classe et une infobulle, toujours visibles, quel que soit le mode — c'est ce qui manque après que la bannière a été écartée
- [ ] Revoir l'effacement de la bannière par Échap (`shell.ts:3561`) : le même gestionnaire ferme le menu de la base, si bien qu'un Échap réflexe emporte le message d'erreur avec lui
- [ ] Rattraper le rejet de `void _switchDb(entry.path)` (`shell.ts:1316`) — chemin étroit mais réel : `_switchDb` relance encore sur ce qui n'est PAS un échec de sidecar (MRU, persistance, rappel d'un écouteur qui lève)
- [ ] Idem pour `_onChangeDb` (`shell.ts:2670`), dont le `try` n'entoure que le dialogue de fichier, le `await _switchDb(newPath)` de la ligne 2687 étant en dehors
- [ ] Trancher si `constituerModule` doit s'abonner à `ctx.onDbChange` comme `rechercheModule` — utile pour l'état local, inutile pour le message, que le shell porte déjà
- [ ] Écrire une passe de QA du mode dégradé, et la jouer

## QA

Aucune passe écrite. Elle se joue en pointant une base qui n'en est pas — un fichier texte
renommé en `.db` suffit — puis en pressant chacun des trois boutons de la bannière. Le point
qui compte est le deuxième : « Choisir un autre fichier… » doit ouvrir un sélecteur de
fichier existant, pas un enregistreur.

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
