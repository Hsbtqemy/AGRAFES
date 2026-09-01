---
chantier: DEG-01
statut: à venir
---

# DEG-01 — ce que l'application montre quand une base ne s'ouvre pas : rien

**Point de départ** — cadrage du 1er septembre 2026, rien de codé. Trouvé en préparant la
passe de QA de CHR-01 : le shell délègue l'affichage de l'échec aux modules, Recherche
l'assure, Constituer ne s'y abonne même pas, et le rejet part dans le vide.

## Reste

- [ ] Abonner `constituerModule` à `ctx.onDbChange`, sur le modèle de `rechercheModule.ts:197` — il lit aujourd'hui `ctx.getDbPath()` une seule fois, au montage
- [ ] Rendre visible le `catch` de `_onDbChanged` (`app.ts:668`), qui ne fait qu'un `console.error` avant de poser `setConn(null)` sur les six écrans et le Job Center
- [ ] Recibler le bandeau `_showPrepInitError` (`app.ts:528`) sur ce chemin d'échec, seule façon de le rendre à nouveau atteignable
- [ ] Réduire ses actions à « Réessayer », qui rejoue le MÊME chemin — l'actuelle relance `_onCreateDb`, c'est-à-dire un flux de création, sur une erreur d'ouverture
- [ ] Remplacer « Choisir un autre… » par une phrase renvoyant au menu 🗄 du shell : pas de dialogue dans prep, donc pas de désynchronisation ni de pont prep → shell à inventer
- [ ] Supprimer `_onOpenDb` (`app.ts:487`) et `_onCreateDb` (`app.ts:503`), morts depuis CHR-01 lot 3 et porteurs du défaut de conception
- [ ] Rattraper le rejet de `void _switchDb(entry.path)` (`shell.ts:1316`) — clic sur une base récente
- [ ] Rattraper celui de `_onChangeDb` (`shell.ts:2670`) : son `try/catch` n'enveloppe que le dialogue de fichier, le `await _switchDb(newPath)` de la ligne 2687 est en dehors, et l'appelant fait `void`
- [ ] Décider si le shell doit AUSSI dire quelque chose de son côté, ou si la délégation aux modules suffit — aujourd'hui la branche d'échec de `_switchDb` n'a aucun toast, alors que les deux branches de succès en ont un
- [ ] Vérifier le cas « aucun module monté » : depuis l'accueil, une base cassée choisie dans le menu n'a personne pour l'annoncer
- [ ] Écrire une passe de QA du mode dégradé, et la jouer

## QA

Aucune passe écrite. Celle à écrire se joue en arrêtant le sidecar, ou en pointant une base
qui n'en est pas — un fichier texte renommé en `.db` suffit. Son intérêt n'est pas de
vérifier un message, mais qu'il en existe un : le défaut actuel est qu'il n'y en a aucun.

Voir aussi `qa/chrome-constituer.md`, dont le dernier point demande déjà ce que l'écran
montre sidecar arrêté — c'est de là que ce chantier est parti.

## Contexte

**Le contrat existe, écrit dans le code.** Le `catch` de `_switchDb` (`shell.ts:1415`) dit :

```
// Still notify on failure so modules can show their own error state.
_dbListeners.forEach(cb => cb(_currentDbPath));
throw err;
```

Le shell ne montre donc rien lui-même quand une base refuse de s'ouvrir. Il n'y a pas de
toast sur cette branche — les deux `_showToast` de `_switchDb` sont dans le succès — pas de
bandeau, rien. Il notifie, il relance, et il confie l'affichage aux modules. C'est un choix
défendable ; encore faut-il que les modules le sachent.

**Recherche l'assure.** `rechercheModule.ts:197` s'abonne à `ctx.onDbChange`, remet son état
à zéro, et le `catch` de `_connect` écrit « Connexion impossible : … » dans une barre de
statut en `aria-live="polite"` (`rechercheModule.ts:247`). C'est l'implémentation de
référence, et elle est bonne.

**Constituer ne s'y abonne pas du tout.** `constituerModule` lit `ctx.getDbPath()` une fois
au montage et n'écoute rien : le shell le remonte à chaque changement de base plutôt que de
le notifier, ce qui marche tant que l'ouverture réussit. Sur un échec, le module est remonté
sur une base qui ne s'ouvre pas, et personne ne le dit.

**Et son propre chemin d'échec est muet.** `_onDbChanged` (`app.ts:668`) attrape l'erreur du
sidecar, pose `this._conn = null`, écrit un `console.error`, puis distribue `setConn(null)`
aux six écrans et au Job Center. Chacun se rend vide, proprement. L'application a l'air normale et ne fait
rien ; l'explication n'existe que dans les devtools, qu'un utilisateur n'ouvrira pas.

**Le bandeau qui aurait dû servir n'a plus d'entrée.** `_showPrepInitError` (`app.ts:528`)
n'est appelé que par le `catch` de `_onCreateDb`, lui-même appelé seulement par le bouton
« Réessayer » du bandeau : un cycle fermé depuis que « Créer… » a quitté prep pour le menu
de la base (CHR-01 lot 3). Le réancrage fait à ce lot était juste — il garde une porte que
plus rien n'ouvre.

**Personne ne rattrape le rejet.** `_switchDb` relance, et deux de ses appelants laissent
filer :

| Appelant | Ligne | État |
|---|---|---|
| Clic sur une base récente | `shell.ts:1316` | `void _switchDb(...)` — rejet non traité |
| `_onChangeDb` (« Ouvrir… ») | `shell.ts:2687` | hors du `try` qui n'entoure que le dialogue ; appelé par `void` |
| Deep-link | `shell.ts:1545` | dans un `try` |
| Corpus de démonstration | `shell.ts:3473`, `:3498` | dans un `try` |

Ouvrir une base illisible depuis le menu produit donc une promesse rejetée dans le vide, une
ligne dans le journal de session du shell, et aucun message.

**Ce que CHR-01 a fermé sans le savoir, et qu'il ne faut pas rouvrir.** `lib/db.ts` ne tient
qu'une variable de module, sans persistance. Si `_onOpenDb` de prep s'exécutait, il posait
cette variable et démarrait un sidecar sur un autre chemin, pendant que le shell gardait son
`_currentDbPath`, sa liste de récentes, sa valeur persistée et Recherche pointée sur
l'ancienne base ; un changement de mode remontait ensuite Constituer avec `ctx.getDbPath()`
= l'ancien chemin, annulant le tout en silence. Ce désaccord était atteignable par le bouton
« Ouvrir… » de la barre, supprimé au lot 3 de CHR-01. La conclusion tient pour ce
chantier-ci : **prep ne choisit pas la base**, et ses deux dialogues n'ont pas à revenir —
d'où le « Choisir un autre… » remplacé par une phrase plutôt que par un bouton.

**Coût.** Front pur. Zéro moteur, zéro endpoint, zéro migration, zéro artefact de contrat :
rien ne touche le sidecar, seul son échec est enfin raconté. Le pont shell → prep existe
déjà (CHR-01 lot 4, `constituerModule` expose des commandes nommées) ; il suffit de lui en
ajouter une. Estimation : une demi-journée pour les quatre premiers items, autant pour la
passe et les cas limites.

**Collision.** `app.ts` et `shell.ts` sont le terrain de CHR-01, dont il reste le raccourci
Documents et la purge CSS ; les zones ne se recouvrent pas. Rien à voir avec ACT-01 ni R2.

Pas de champ `audit:` : ce chantier ne vient pas d'un audit mais de la préparation de
`qa/chrome-constituer.md`, le 1er septembre 2026 — chercher comment provoquer le bandeau
d'erreur a suffi à montrer qu'on ne pouvait pas.
