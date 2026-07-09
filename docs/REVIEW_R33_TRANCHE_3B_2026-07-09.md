# Review — R3.3 tranche 3b « ✂ Couper depuis la cellule » (2026-07-09)

**Périmètre :** commit `eb9457e` (feat(prep): R3.3 — « ✂ Couper » depuis la cellule de la matrice, tranche 3b), branche `refonte`.
**Méthode :** passe multi-agents à effort *high* — 8 angles de recherche (ligne à ligne, comportements retirés, traceur inter-fichiers, réutilisation, simplification, efficacité, altitude, conventions), 29 candidats bruts → 22 dédupliqués → vérification adverse individuelle (CONFIRMED / PLAUSIBLE / REFUTED). Bilan : **16 confirmés, 2 plausibles partiels, 3 réfutés.** Les 10 plus sévères sont détaillés ci-dessous ; le reste est en §2/§3.

**Statut (mis à jour après le lot écran+lib, même journée) :**
- **Corrigés** : F1, F3, F4, F5, F7, F9, F10, plus A3 (garde dans `buildCutActions`), N3, N4, N5. F2 a reçu la **mitigation front** (coupe partielle → fermeture + resync + message honnête) ; le fond (transactionnalité ou compensation) reste au lot moteur.
- **Restants (lot moteur, session à froid)** : **A2 en premier** (link_ids par cellule dans `/align/matrix` — absorbe F6, A1 et la moitié de F8), puis F8 (exclusion cohérente des `rejected`, décision produit) et F2-fond. N1/N2/N6 en passe qualité opportuniste.
- Recoupement utilisateur du 2026-07-09 : tous les findings confirmés tenus, nuances de précision intégrées ci-dessous (F1 : écriture conditionnelle, défaut inconditionnel = boutons vivants ; F2 : réponse serveur honnête, « refus total » était une lecture front ; A1 : filtre `external_id` existant = mitigation partielle ; N1 : `-actions` diffère d'un `margin-top`).

---

## 1. Les 10 findings retenus (par sévérité décroissante, tous CONFIRMED)

### F1 — Changement de corpus : la grille périmée reste actionnable → écriture cross-base
`tauri-prep/src/screens/AlignMatrixView.ts:82` (`refreshDocs`) · correctness

`ActionsScreen.setConn` (appelé par `app.ts _onDbChanged` sur la **même instance** d'écran, DOM persistant) ne fait que `_matrixView?.refreshDocs()`, qui repeuple le `<select>` famille sans vider `#matrix-grid-area` ni `_matrix`/`_view`. Les boutons ✂ restent câblés : un clic utilise `_getConn()` (nouvelle base) avec `hub_doc_id`/`hub_unit_ids`/`language_doc_ids` de l'ancienne. Les rowids SQLite recommencent à 1 dans chaque base → collision d'ids réaliste → `set_target_span` ×2 écrit dans la mauvaise base, silencieusement.
**Fix proposé :** invalider grille + `_matrix`/`_view` sur changement de connexion (ou garder l'identité de conn au chargement et la comparer avant tout geste).

### F2 — Batch partiellement committé mais présenté comme refus total
`tauri-prep/src/screens/AlignMatrixView.ts:258` (`_performCellCut`) · correctness

Le handler sidecar `_handle_align_links_batch_update` applique chaque action indépendamment, accumule les erreurs et fait `conn.commit()` **inconditionnellement**. Si l'action 1 passe et la 2 échoue (lien supprimé/reciblé depuis la Révision fine pendant que le modal est ouvert), la demi-coupe est durable côté serveur ; le front toast « ✗ Coupe refusée », ne ferme pas le modal et **ne recharge pas** : queue de traduction orpheline dans la projection/CSV, la paire n'est plus « fused » donc l'affordance ✂ de réparation disparaît. (Même forme d'erreur préexistante dans `AlignPanel._performCut`, mais fenêtre de staleness bien plus courte là-bas.)
**Fix proposé :** sur `res.errors` non vide avec `res.applied > 0`, compenser (`clear_target_span` sur la moitié appliquée) ou a minima recharger + message explicite « coupe partielle ».

### F3 — Vue relue après l'`await` d'audit : étiquetage croisé / crash
`tauri-prep/src/screens/AlignMatrixView.ts:191` (`_openCutModal`) · correctness

`_openCellCut` capture `matrix`/`view` en locales, mais `_openCutModal` relit `this._view!`. Pendant les 1–30 requêtes d'audit, « Charger la matrice » n'est jamais désactivé (`_loading` ne couvre pas cette fenêtre) : charger la famille B fait ouvrir le modal avec les libellés/segments de B et une suggestion calculée sur les mauvais textes moyeu, pendant que la confirmation écrit sur les liens de A. Si B a moins de lignes : `TypeError` non gérée, aucun toast.
**Fix proposé :** passer la `view` capturée (et `rowAbove`/`rowCur`) en paramètres de `_openCutModal`.

### F4 — `dispose()` ne ferme pas le modal ouvert (overlay + keydown + écriture vivante)
`tauri-prep/src/screens/AlignMatrixView.ts:292` (`dispose`) · correctness

L'overlay vit sur `document.body`, Échap est un listener `document` ; `dispose()` nullifie les champs sans fermer. Chemin réel : picker ouvert → raccourci clavier du shell (« 1 » → Explorer, l'overlay bloque la souris mais pas le clavier) → overlay z-index 9200 peint sur l'autre module, listener qui fuit, et le bouton OK écrit encore (`ActionsScreen.dispose` ne nullifie pas `_conn`) — écriture committée sans aucun retour visuel (`_reloadPreservingScroll` no-op).
**Fix proposé :** tracker l'overlay ouvert dans l'instance et le fermer dans `dispose()` (et sur re-render).

### F5 — Pas de garde de réentrance (double-clic ✂ / double-clic OK)
`tauri-prep/src/screens/AlignMatrixView.ts:138` (`_bindCutButtons`) · correctness

Double-clic sur ✂ (latence = l'audit paginé) → deux modals empilés, deux listeners keydown ; confirmer le premier applique et recharge, le second reste sur des liens périmés et re-poste des spans pré-coupe. OK n'est pas désactivé pendant le POST → double batch possible.
**Fix proposé :** flag « geste en cours » + désactiver le bouton ✂ cliqué et le OK pendant les requêtes.

### F6 — Couplage par index entre HTML et tableaux parallèles (bombe à retardement D-W4)
`tauri-prep/src/lib/alignMatrixGrid.ts:31` · altitude

`data-cut-row`/`data-cut-col` indexent le view-model ; la vue les déréférence dans `matrix.hub_unit_ids[row-1]`/`language_doc_ids[col+1]`. L'invariant 1:1 `view.rows[i] ↔ matrix.rows[i]` n'est imposé nulle part (pas de type partagé, pas d'assert). Les tranches déjà actées (repli au ¶ D-W4, lignes-structure §2.2, filtre ⚠) décaleront les index : les ids restent valides → coupe des **mauvais** liens avec « ✓ » vert.
**Fix proposé :** porter `hubUnitId`/`hubUnitIdAbove`/`targetDocId` dans le view-model (`MatrixRowView`/colonnes) et les émettre directement en data-attributes — l'HTML transporte des identités, pas des positions.

### F7 — Blanc de tête → coupe dégénérée [0,1], que la suggestion peut pré-sélectionner
`tauri-prep/src/lib/alignCellCut.ts:138` (+ `alignBeads.cutOffsets`) · correctness

`text_raw` verbatim peut porter un blanc de tête (l'importeur docx ne strip pas) → `cutOffsets(' Hello world') = [1, 7]` : l'offset 1 (pseudo-mot blanc) est légal, `suggestCutOffset` peut le choisir si le segment moyeu du haut est court, et confirmer produit une tranche `' '` → cellule projetée ∅ (la « tranche vide » que §3.2 interdit). Pire : `' Hello'` a `cutOffsets=[1]` et contourne le garde « seul mot ». Préexiste dans le picker B2 d'AlignPanel, mais là l'utilisateur doit cliquer explicitement le ✂ en tête de texte ; ici la suggestion l'automatise.
**Fix proposé :** filtrer les offsets dont une des deux tranches est blanche (dans `cutOffsets` ou côté suggestion/panneaux + garde dans `buildCutActions`, cf. §2 A3).

### F8 — Liens `rejected` comptés dans la résolution → faux refus
`tauri-prep/src/lib/alignCellCut.ts:57` (`resolveFusedCellLinks`) · correctness

L'audit sans filtre renvoie tous les statuts ; un lien rejeté résiduel (3e pivot → même cible, ou doublon) fait `holders.length=3` → « couvre 3 segments » ou « Appariement ambigu » alors que 2 liens vifs existent. Nuance vérifiée : la projection `/align/matrix` n'exclut pas non plus les rejetés (leur texte s'affiche dans les cellules) — filtrer seulement côté résolveur serait *moins* correct.
**Fix proposé :** exclure `rejected` de façon **cohérente** dans la projection moteur ET le résolveur (décision de design, cf. `qa_report.py` qui traite déjà rejected comme mort — ALN-03).

### F9 — L'en-tête du panneau Matrice dit encore « Lecture seule. »
`tauri-prep/src/screens/ActionsScreen.ts:471` · correctness (UX/contrat visuel)

Le header promet « voir sans risque » pendant que les cellules ⚠ proposent un geste d'écriture. Trivial à corriger, trompeur tant que c'est là.

### F10 — Fermeture backdrop sur `click` : un drag de sélection jette le réglage
`tauri-prep/src/screens/AlignMatrixView.ts:231` · correctness (UX)

mousedown dans le dialogue + mouseup sur le fond → le `click` est dispatché sur l'ancêtre commun (l'overlay) → `close()` silencieux, point de coupe ajusté perdu. Pattern hérité de `modalConfirm`, mais ce dialogue est le seul qui invite à manipuler du texte et tient un état en cours.
**Fix proposé :** décider la fermeture sur la cible du **mousedown**, pas du click.

---

## 2. Confirmés mais sous le plafond des 10 (pour une passe qualité ultérieure)

- **A1 (altitude, moteur)** — Pas de filtre `pivot_unit_id`/`target_unit_id` sur `/align/audit` : la résolution d'UNE cellule pagine toute la paire (jusqu'à 30×200) à chaque clic, avec un plafond arbitraire à 6000 liens (« couper via la Révision fine »). Fix naturel : filtre additif sur l'audit **ou** A2.
- **A2 (altitude, moteur)** — L'heuristique « fused » (égalité de textes, front) sous-détecte (moyeu A→T1+T2 = « T1 T2 » vs B→T2 = « T2 » : vrai 2-1 invisible, complétude faussée) et sur-détecte (refrains identiques → bouton ✂ mort). Le moteur calcule déjà `links_by_t` (cellule→liens) dans `build_alignment_matrix` et le jette : exposer les `link_ids` par cellule (champ additif) supprimerait l'heuristique, le join client et le fetch d'audit d'un coup.
- **A3 (altitude)** — `buildCutActions` n'impose pas `0 < offset < textLen` alors que le serveur accepte les spans dégénérés (`[0,0]`, `[len,len]` passent sa validation) ; et `text_raw` est mutable (`/units/update_text`) → offsets calculés sur texte périmé : texte raccourci = rejet serveur, texte allongé = queue silencieusement hors des deux tranches. Le « garde-fou de conservation » de §3.2 n'existe que comme commentaire.
- **N1 (nettoyage)** — `.prep-matrix-cut-overlay`/`-actions` dupliquent à l'identique `.prep-modal-confirm-overlay`/`-actions` (app.css) : réutiliser la classe existante pour le backdrop.
- **N2 (nettoyage, partiel)** — Squelette modal (overlay/Échap/backdrop/cleanup) forké depuis `modalConfirm.ts` ; à 2 sites c'est défendable (règle de trois), mais le vrai reste-à-faire est l'accessibilité : aucun focus déplacé dans le dialogue `aria-modal`. (La crainte « Échap ne marche pas sans focus » est réfutée : keydown sur `document` tire partout.)
- **N3 (nettoyage)** — Les deux `offset!` dans `_openCutModal` disparaissent en rebindant après le garde null (`let cur: number = offset`).
- **N4 (nettoyage)** — `_bindCutButtons` (un listener par bouton, à re-binder après chaque render) vs la délégation déjà utilisée 100 lignes plus bas (`panelsHost`) : un seul listener délégué sur `#matrix-grid-area` bindé dans `render()` supprime l'étape oubliable.
- **N5 (nettoyage, partiel)** — Dans `_reloadPreservingScroll`, la re-query `areaAfter` est morte (`#matrix-grid-area` n'est jamais remplacé, seulement son innerHTML) ; la restauration elle-même est nécessaire (le hint « Chargement… » clampe le scroll).
- **N6 (nettoyage)** — `buildCutPanelsHtml` refait `Array.from(texte entier)` par mot (O(N×W)) à chaque re-render ; hoister un seul `Array.from` est trivialement équivalent. Impact faible (cibles de taille phrase), lecture exacte.

## 3. Réfutés (ne pas « corriger »)

- Le double état `_matrix`/`_view` : écrits ensemble à un seul site, purs, pas de chemin de désync réaliste.
- La forme de l'union `CellCutResolution` (`?: undefined`) : le narrowing fonctionne au site de prod ; l'alternative `{ok}` n'améliorerait pas le site de test.
- Le **reload complet post-coupe** : c'est le choix doctrinal (D4 « projection jamais stockée » + invariant §4.1 « données actualisées ») — patcher localement les deux cellules ré-implémenterait la projection côté client et risquerait la divergence.

## 4. Ordre de correction proposé

1. **Lot écran (rapide, local)** : F9 (header), F3 (passer la vue capturée), F5 (réentrance), F4 (fermeture au dispose), F10 (mousedown backdrop), F1 (invalidation sur changement de conn), N3/N4 au passage.
2. **Lot lib** : F7 (offsets blancs) + A3 (garde dans `buildCutActions`) — mêmes tests.
3. **Lot moteur (petites décisions de design d'abord)** : F8 (exclure `rejected` — projection ET résolveur, cohérent avec ALN-03), F2 (sémantique du batch partiel : compensation front vs transaction moteur), puis A1/A2 (exposer les `link_ids` par cellule dans `/align/matrix`, champ additif — supprime l'heuristique et le plafond 6000), qui absorbe F6 (les data-attributes porteront des identités).

---

*Généré par la passe /code-review (8 finders + 6 vérificateurs adverses) du 2026-07-09. Vérité au moment du commit `eb9457e` ; re-vérifier les numéros de ligne après correctifs.*
