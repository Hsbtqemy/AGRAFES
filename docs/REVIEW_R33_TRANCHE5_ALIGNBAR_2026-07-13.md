# Revue adverse — tranche 5 « barre Aligner à défaut assumé » (`681f34f`)

**Méthode :** 4 finders (honnêteté du résumé, garde de re-run, câblage DOM/cycle de vie, défauts &
modes vs moteur) → 19 findings bruts → 2 réfutateurs adverses par finding. **12 confirmés, dont 3
critiques**, 3 réfutés, 4 non jugés (quota de session — recoupés à la main).

> **La leçon du lot.** C'est le seul des cinq à récolter des *critiques*, et c'est le plus petit :
> « un bouton et un select ». Je l'ai écrit **sans reprendre les gardes** que les tranches
> précédentes avaient durement acquises (identité de connexion F1, non-réentrance F5, destruction des
> surfaces armées). Un écran qui porte un état (`_view`, famille chargée, connexion) impose sa
> discipline à **tout** ce qu'on y greffe, y compris à ce qui a l'air trivial.

---

## C1 — CRITIQUE · Le bandeau « Recalcul global » survit à un changement de famille / de corpus

Les boutons du bandeau relisent `this._selectedFamilyId` **au moment du clic** et ne vérifient ni la
famille ni la connexion. Séquence : ouvrir le bandeau sur la famille A (déjà alignée) → changer de
famille (ou de corpus) → cliquer « Recalcul global » → **la mauvaise famille est remise à plat**
(opération destructive). `_resetMatrix()` ne détruisait pas non plus le bandeau.

**Correctif :** le bandeau **capture** sa famille et sa connexion ; un clic sur une sélection qui a
bougé refuse et le dit. `_resetMatrix()` et `_loadFamilies()` détruisent le bandeau.

## C2 — CRITIQUE · La garde de re-run répondait pour la mauvaise famille

`_loadedLinkCount()` lit `this._view` — or le bouton « Aligner » est actif **dès qu'une famille est
sélectionnée**, sans « Charger », et une vue chargée appartient à la famille **précédente**. Résultat :
la garde répond 0, le bandeau ne s'ouvre pas, et le run part en « compléter » — c'est-à-dire **ne fait
rien** : exactement le footgun que la tranche existe pour tuer, laissé ouvert par la porte de derrière.

**Correctif :** le clic charge l'état **réel** de la famille sélectionnée avant de décider.

## C3 — CRITIQUE · Un échec de chargement laissait la vue précédente en place

`_loadMatrix()` n'invalidait `_view` que sur succès : après une erreur, **toute** la suite (garde de
re-run, gestes) raisonnait sur la famille d'avant. Ma propre correction de C2 s'appuyait d'ailleurs
sur `_view === null`, donc reposait sur ce bug.

**Correctif :** un échec de chargement invalide la vue (`_view`, `_matrix`, `_loadedFamilyId`).

## M1 — MAJEUR · « Compléter — n'ajoute que les liens manquants » est **faux**

Avec `replace_existing:false` l'aligneur **relance toute la stratégie** ; l'`INSERT OR IGNORE` ne
dédoublonne que sur l'index unique **(pivot, cible) exact**. Il ne « protège » donc rien : une **autre**
stratégie ajoutera des liens **par-dessus** les anciens (et pourra créer des collisions). Le libellé
promettait le contraire.

**Correctif :** libellés littéraux — « garde les liens existants ; une autre stratégie peut en ajouter
par-dessus » / « supprime les liens puis réaligne ».

## M2 — MAJEUR · Le message de footgun s'affichait **sans aucun lien existant**

Le moteur marque une paire « aligned » **dès qu'elle a tourné sans lever** (`sidecar.py`, le statut est
posé inconditionnellement) : un run où la stratégie n'a **rien apparié** (`external_id` sur un corpus
sans `[N]`, `similarité` au-dessus du seuil) est donc indiscernable, côté réponse, d'une famille déjà
alignée. La barre affichait « les segments déjà liés ne sont pas retouchés » sur une famille **à zéro
lien** : cause inventée, et remède (« Recalcul global ») inutile.

**Correctif :** l'appelant passe le **nombre de liens d'avant le run** — seul lui peut trancher. Trois
messages distincts : aucune paire n'a tourné · déjà liés · le **mode** n'a rien apparié (et il est nommé).

## M3 — MAJEUR · La garde ignorait les liens **rejetés**

Le compteur lisait la **projection**, qui exclut les liens rejetés (F8) — mais l'index d'unicité, lui,
tient toujours leur ligne : une famille dont les liens ont **tous** été rejetés se réaligne donc à
**rien**, et passait à travers la garde.

**Correctif moteur (contrat 1.6.58)** : `/align/matrix` expose `link_count` — **tous** les liens de la
famille, rejetés compris. C'est ce compteur que la barre interroge.

## M4 — MAJEUR · F1/F5 absents du chemin d'alignement

`_runAlign` était le **seul chemin d'écriture de l'écran** sans garde d'identité de connexion ; et
pendant un run (qui **réécrit les link_ids**), la grille restait entièrement interactive — un ✂ pouvait
poster des ids déjà supprimés. Le sélecteur de famille et « Charger » restaient actifs, et la
re-projection relisait la famille **courante** au lieu de celle qu'on venait d'aligner.

**Correctif :** garde F1 comme partout ailleurs ; `_cutBusy` posé pendant le run (les gestes gèlent) ;
famille **capturée** pour la re-projection ; sélecteurs désactivés.

## Mineurs corrigés

- Les boutons ajoutés par la tranche n'étaient resynchronisés que par le `change` du `<select>` :
  après un rechargement des familles (corpus switch, suppression), « Aligner » restait **armé** sur un
  id disparu → `_loadFamilies()` resynchronise les trois boutons.
- Le toast d'un run stérile était stylé en **succès** → il suit désormais le message.

## Réfutés

- « `preserve_accepted` est un contrôle mort hors recalcul » — vrai côté moteur (il n'est lu que dans
  `if replace_existing:`), mais la case reste **exacte** pour le seul chemin où elle agit ; l'étiqueter
  autrement serait plus confus. Noté, pas corrigé.
- Le résumé ne rapporte pas les **suppressions** d'un recalcul (`deleted_before`) — vrai, mais la
  réponse *famille* ne les expose pas (seul le rapport par paire le fait) : hors périmètre, à traiter
  si la tranche 6 remonte le rapport détaillé.
