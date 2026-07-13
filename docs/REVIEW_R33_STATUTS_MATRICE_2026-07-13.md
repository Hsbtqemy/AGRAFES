# Revue adverse — lot « statuts matrice ∅/＋ » (R3.3, D-W8/D8/D-W14)

**Périmètre :** exactement deux commits, `dc2bccd` (moteur, contrat 1.6.56) et `916408a` (front prep).
**Méthode :** 9 finders en parallèle par dimension (service moteur, projection, cycle de vie des
données, contrat/compat, view-model, grille/XSS, câblage écran, interaction avec les gestes
existants, couverture de tests) → 23 findings bruts → vérification adverse (2 réfutateurs par
finding, consigne « réfute par défaut »).

> **Caveat de méthode.** La phase de vérification a été tronquée par la limite de session : seuls
> 3 findings ont reçu des verdicts complets. Les findings dont les vérificateurs sont morts sont
> sortis avec `verdicts: []` — le script les a comptés « non confirmés », ce qui est **faux** : ils
> n'ont pas été *réfutés*, ils n'ont pas été *jugés*. Ils ont donc été **recoupés à la main** contre
> le code (statut ci-dessous : *recoupé*). Deux findings ont bel et bien été réfutés avec verdicts
> à l'appui (voir §Réfutés).

---

## R1 — CRITIQUE · `alignment_cell_statuses` sans `ON DELETE CASCADE` → perte de liens silencieuse

**Statut : confirmé (vérificateur unanime + repro live).** `migrations/028_alignment_cell_status.sql:17-18`
déclare deux FK (`units`, `documents`) sans action de suppression, alors que `PRAGMA foreign_keys=ON`
est posé sur *toutes* les connexions (`db/connection.py:17`, `sidecar.py:8605`), et **aucun** chemin de
suppression ne nettoie la table (les tables sœurs 006/012/019/025 sont toutes en cascade).

Une seule cellule marquée « non traduit » suffit :

| Chemin | Conséquence |
|---|---|
| `POST /documents/delete` (hub ou traduction) | `IntegrityError` → 500 ; les documents deviennent **indestructibles** tant que la marque n'est pas retirée cellule par cellule (aucun clear en masse n'existe). Ce chemin *rollback* au moins. |
| `POST /segment` (re-segmentation) | `segmenter.py:475` supprime **tous** les `alignment_links` du doc, *puis* le `DELETE FROM units` lève la FK. Ni `_handle_segment` ni le handler générique de `do_POST` ne rollback → la suppression des liens de toute la famille reste **en transaction ouverte** et la **prochaine écriture réussie la committe**. Perte de l'alignement complet, silencieuse. |
| `POST /units/merge` | Même schéma : liens supprimés + texte de `n1` déjà réécrit avant l'échec (`sidecar.py:4865/4872/4878`). |
| `POST /prep/undo` (split / re-seg) | Idem (`undo.py:280/318`) — c'est précisément la séquence que l'audit N-02 avait corrigée pour les liens, réintroduite pour la nouvelle table. |

**Correctif retenu :** migration **029** qui recrée la table avec `ON DELETE CASCADE` (recréation
SQLite standard : nouvelle table → copie → drop → rename). *Pas* une modification de 028 : la
migration est déjà appliquée sur les bases de QA (`schema_migrations` la porte déjà), l'amender ne
rejouerait rien.

## R2 — MAJEUR · Le tissage des lignes `[ajout]` n'exclut pas les unités liées → texte projeté deux fois

**Statut : confirmé (2 vérificateurs, tous deux avec repro).** `matrix_export_service.py:187-191`
sélectionne **toute** unité `unit_status='ajout'` sans exclure celles qui portent un lien actif dans la
famille — alors que la requête `uncovered`, dix lignes plus bas, a exactement le `NOT EXISTS` qu'il
fallait. Le `n` de l'unité étant dans `anchor_by_n`, la ligne de flux s'ancre juste après la ligne
moyeu qui affiche déjà son texte : **la même phrase sort deux fois**, dans la grille *et* dans le CSV
`/export/matrix` (qui écrit `rows` verbatim).

État atteignable dans les deux ordres : ni `aligner.py` ni `gale_church.py` ne consultent
`unit_status` (l'aligneur lie donc les unités `ajout` comme les autres), et
`units_service.bulk_set_unit_status` n'a aucune garde de lien (contrairement au 409 posé le même jour
sur l'axe per-cellule).

**Correctif :** le même `NOT EXISTS` (lien actif dans cette famille) sur la requête du tissage.

## R3 — MAJEUR · Les lignes `[ajout]` cassent les gestes de coupe

**Statut : recoupé à la main** (2 finders concordants ; vérificateurs coupés par le quota — vérifié
en relisant `alignCellCut.ts` et `AlignMatrixView.ts`).

Le view-model saute les lignes d'ajout pour la détection de fusion (`prevHubLinks`,
`alignMatrix.ts:168`), mais `_cellGestureCtx` (`AlignMatrixView.ts:225`) construit la colonne de liens
sur **toutes** les lignes de la vue, lignes d'ajout comprises. D'où deux régressions :

- **✂ Couper mort sur une cellule ⚠ légitime** — une ligne `[ajout]` tissée entre les deux lignes du
  bead fait que `resolveFusedCellLinks(column, row)` lit `column[row-1]` = la ligne d'ajout (liens `[]`)
  → erreur « Liens d'alignement introuvables pour cette cellule » (`alignCellCut.ts:100-102`), alors que
  la grille affiche bien le ⚠ **et** le bouton. La fusion devient irréparable depuis la matrice.
- **Bouton OK mort sur « couper à cheval »** — `resolveStraddleCut` accepte la ligne d'ajout comme
  voisin (ses liens `[]` passent la garde de partage), le picker s'ouvre avec « seg 0 » et le texte
  moyeu « [ajout] », et au clic sur « ✂ Couper » l'écran retourne **silencieusement** parce que
  `c.neighbor.hubUnitId == null` (`AlignMatrixView.ts:452-456`) : ni écriture, ni toast, ni fermeture.
  Forme très courante (un ajout en fin de traduction s'ancre après la dernière ligne moyeu).

**Correctif :** rendre la résolution *addition-aware* — la colonne des gestes est construite sur les
seules lignes **moyeu**, l'indice de la vue est remappé vers l'indice moyeu avant d'appeler les
résolveurs (et re-mappé pour l'affichage). Garde défensive : un `hubUnitId` nul ne doit plus pouvoir
faire un no-op silencieux sur un clic de confirmation.

## R4 — MINEUR · La garde 409 est unidirectionnelle : une marque ∅ ressuscite

**Statut : confirmé (1 vérificateur sur 2 ; le réfutateur concède la mécanique et conteste la gravité).**
Rien du côté création de lien (`/align/link/create`, les runs d'alignement, l'un-reject via
`batch_update`) ne consulte `alignment_cell_statuses`. Une marque posée puis recouverte par un lien
devient **invisible** (le front met `nonTraduitAxis=null` dès qu'il y a des liens — donc plus de ↺
pour la retirer), et **réapparaît** quand le lien meurt : la cellule repasse en `[non traduit]` et
compte comme *faite* (D-W5) au lieu de redevenir un trou à traiter. Le commentaire du service
(« the setter guards against creating it ») est donc faux.

**Correctif :** purge des marques contredites au moment où un lien est créé (choke points :
`/align/link/create` et la persistance des runs d'alignement), + commentaire corrigé.

## R5 — MINEUR · Ancrage d'un ajout au `max(n)` au lieu du `max(ligne)`

**Statut : recoupé.** `matrix_export_service.py:192-193` prend `anchor_by_n[max(prev_ns)]` — la ligne du
plus grand `n` couvert — au lieu du **plus grand rang** parmi les `n` couverts ≤ `n_ajout`. Sur un
alignement non monotone (une cible ré-ancrée par le geste ⇲ vers une ligne plus haute), la ligne
`[ajout]` se place **au-dessus** de lignes moyeu qui affichent du texte cible la précédant dans
l'ordre de lecture — ce que D8 (« à sa position ») interdit. Correctif : une ligne.

## R6 — MINEURS front (lot de finition)

| # | Fichier | Défaut | Correctif |
|---|---|---|---|
| R6a | `alignMatrixGrid.ts:82` | Le bouton « ∅ non traduit » est proposé sur une cellule **liée** dont le texte projeté est vide (fenêtre de coupe dégénérée) → le serveur répond 409 à chaque clic, sans raison visible. | Conditionner le bouton `set` sur `c.links.length === 0`. |
| R6b | `alignMatrixGrid.ts:44` | Le ↺ d'une ligne `[ajout]` est accroché au fait que la cellule a du texte : une unité `ajout` au texte vide donne une ligne **sans aucun ↺** → marque irréversible depuis la grille (alors que le toast promet « son ↺ »). | Résoudre la colonne de l'ajout via `translationDocIds.indexOf(addition.docId)` et y rendre le ↺ inconditionnellement. |
| R6c | `AlignMatrixView.ts` (`shorten`) | Troncature à 120 **unités UTF-16** → coupe une paire de substitution (emoji, CJK ext.) → « � » dans le panneau. | Tronquer en points de code (`Array.from`). |
| R6d | `AlignMatrixView.ts` (`_performMarkAddition`, `_onUnaddClick`) | `{updated: 0}` (unité disparue entre-temps) → toast de **succès** mensonger. | Vérifier `updated`, toaster une resynchronisation sinon. |
| R6e | `AlignMatrixView.ts` (`_onNonTraduitClick`) | Le 409 ne resynchronise pas la grille — or un 409 *n'arrive que* sur une grille périmée : l'utilisateur voit une cellule vide, un bouton ∅, et aucun ↺ à cliquer ; chaque nouvel essai re-409. | Recharger la matrice sur conflit (convention « matrice resynchronisée » de la revue 3b). |
| R6f | `docs/SIDECAR_API_CONTRACT.md` (§ `/export/matrix`) | L'entrée décrit toujours « une ligne par segment moyeu » alors que le CSV hérite désormais des lignes `[ajout]` (colonnes ¶/segment vides) et des tokens `[non traduit]`. | Amender l'entrée. |

## Réfutés (avec verdicts)

- **`Field(coerce=True)` accepte `true`/`5.9` pour les ids** — réfuté ×2 : comportement **préexistant** et
  documenté du validateur partagé A-03, appliqué à l'identique par tous les services sœurs (dont
  `update_unit_text`, où un id décalé réécrirait le *texte* d'une autre unité — pire) ; et inatteignable
  depuis le seul appelant (les ids viennent verbatim du payload serveur). Correctif éventuel = dans le
  validateur partagé, hors périmètre du lot.
- **Skew ancien front / nouveau sidecar** (les lignes `[ajout]` tissées font mentir les stats d'un front
  pré-`916408a`) — retenu comme **note de documentation** seulement : le couplage prep/shell est versionné
  ensemble (les deux sont buildés depuis la même source), le scénario suppose un binaire sidecar neuf sous
  un bundle front périmé. À consigner : 1.6.56 change la **sémantique de `rows`**, pas seulement les champs.

---

## Ordre de livraison des correctifs

1. **R1** (migration 029 cascade) — bloquant, perte de données.
2. **R2** + **R5** (projection : exclusion des unités liées, ancrage au rang).
3. **R3** (front : résolution des gestes *addition-aware*).
4. **R4** (purge des marques contredites à la création de lien).
5. **R6a–f** (finition front + docs).
