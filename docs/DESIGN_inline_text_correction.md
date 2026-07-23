# Correction de texte inline — capacité transversale du canvas

> Statut : **modèle figé (2026-07-20)**, issu de la discussion refonte du 2026-07-20.
> Cette note **supersède le volet « édition directe du texte » de**
> [`DESIGN_curation_inline_edit_canvas.md`](DESIGN_curation_inline_edit_canvas.md) (dont la §8
> acte le pivot). Ce qui reste dans la note curation = l'**override d'une règle** (gap #9 / B),
> recadré comme secondaire et **différé**. Rattache à [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md)
> (le canvas et sa base `CanvasUnitList`) et à [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §R5/R6.4.

## 0. Ce que c'est — et ce que ce n'est pas

Un **« stylo » de correction ubiquitaire** : rattraper une erreur, une coquille, une petite faute
**à l'instant où on la repère, à n'importe quelle étape** (couche du canvas), sur n'importe quelle
unité.

- **Immédiat.** L'édit atterrit tout de suite (chemin **β**, `/units/update_text`). **Aucun run,
  aucun job n'est la condition pour modifier.** C'est l'exigence dure posée le 2026-07-20.
- **Décorrélé de la curation.** La curation (règles) = normalisation *systématique* ; le stylo =
  correction *ponctuelle*. Deux gestes distincts, deux moments distincts. L'un ne conditionne jamais
  l'autre.
- **Transversal.** Il vit dans la base partagée `CanvasUnitList` → disponible dans **toutes** les
  couches qui rendent des unités (Rôles, Curation, Annotation, Segmentation…), pas seulement en
  Curation.

**Ce que ce n'est PAS :**
- **Pas** l'override d'une règle (gap #9 / B) — besoin étroit, sensé *uniquement* dans la revue d'un
  preview curation. Différé (note curation §8).
- **Pas** de la normalisation en masse — ça, ce sont les **règles** de curation. Du bruit
  *systématique* (guillemets, numéros de référence `[N]`, espaces) se traite par une règle, pas au
  stylo unité par unité.

## 1. Pourquoi ce recadrage (constat legacy vérifié)

Dans le legacy, l'édition était **couplée à l'écran Curation** ET **éparpillée avec deux sémantiques
incohérentes** :
- **A** — `CurationView._enterInlineEdit` : corriger `text_norm` d'une unité dans le volet brut,
  textarea **auto-dimensionnée** (`rows = Math.max(2, ceil(len/80))`).
- **B** — `CurationView._saveManualOverride` : override du résultat d'une **règle** (gap #9),
  diff-centrique, staged en α (`manual_overrides → /curate`).
- **Et ailleurs** — `UnitInspectorPanel` édite déjà `text_norm` via β, immédiat, **mais ne flague
  PAS `source_changed_at`** → une traduction alignée se désynchronise en silence.

Le port canvas (Lot 1, 2026-07-19) a *fusionné A+B en α staged* et *figé `rows=3`* — d'où la boîte
de 3 lignes qui déverse un pavé quand le texte n'est pas segmenté-fin.

**Le stylo unifie tout ça** : une seule capacité, une seule sémantique, partout.

## 2. Sémantique figée

| Point | Décision | Détail vérifié (2026-07-20) |
|---|---|---|
| **Chemin** | **β immédiat**, jamais α/staged | `update_unit_text` (`units_service.py:270`) ; réindexe FTS déjà (`:301-316`). |
| **Champ édité** | `text_norm` ; `text_raw` **conservé** (provenance) | On montre/recherche la correction ; le verbatim d'import reste tracé. |
| **Fraîcheur d'alignement** | **flaguer** `alignment_links.source_changed_at` où `pivot_unit_id = unit` | Mirroir de `curation.py:344-350`. **Colonne = migration 011 → aucune migration.** Comble le trou de l'éditeur inspecteur. |
| **Runs ultérieurs** | **pas de protection** | Un preset relancé repasse sur `text_norm` édité. Inoffensif en pratique pour une coquille (les règles normalisent ponctuation/espaces, pas l'orthographe). Ordre assumé : règles d'abord, corrections en dernier. |
| **Undo** | **OUI (tranché 2026-07-20) — voir §5** | β **n'est pas annulable aujourd'hui** (pas de `record_action`) → à rendre annulable. |

### Décisions numérotées
- **D-C1** — édite `text_norm`, garde `text_raw`. *Réversible si un besoin « réécrire le verbatim » émerge.*
- **D-C2** — flague `source_changed_at` (obligatoire pour la cohérence d'alignement).
- **D-C3** — pas de protection contre un run curation ultérieur (ordre assumé).
- **D-C4** — β immédiat, jamais conditionné par un job.
- **D-C5** — transversal via `CanvasUnitList`.
- **D-C6** — l'override de règle (gap #9) reste secondaire et différé (note curation §8).
- **D-C7** — annulabilité : **OUI** (tranché 2026-07-20) → `action_type UPDATE_TEXT` + reverter, voir §5.
- **D-C8** — édition **en place** (port legacy A), pas de panneau détaché ni de dock — voir §3.

## 3. UX — **édition en place** (port du legacy A `_enterInlineEdit`)

**Décision D-C8 : édition EN PLACE, pas de panneau détaché, pas de dock.** La ligne *elle-même*
devient l'éditeur — on **abandonne** le panneau `.prep-cur-editor-panel` inséré `afterend` avec sa
textarea figée `rows=3` (texte dupliqué + pavé encagé). On **porte le pattern éprouvé du legacy A**
(`CurationView._enterInlineEdit`, `:2731`), remonté dans `CanvasUnitList`.

- **Entrer en édition** : `✎` révélé au survol (déjà présent) **ou** double-clic sur le texte →
  le `.prep-conv-unit-text` est remplacé **en place** par une `<textarea>`, en gardant le `[N]` et
  les badges. Le **clic simple reste la sélection** (pas de conflit avec le modèle de sélection de
  `CanvasUnitList`).
- **Éditeur flush** (polish 2026-07-20, revue visuelle) : la ligne « devient » éditable *à sa place* —
  textarea **sans bordure, `padding:0`, fond transparent, `color/font/line-height` hérités** → même
  largeur, position et flux que `.prep-conv-unit-text` en lecture (elle « reprend la forme »).
  **Prérequis CSS** : exclure `.prep-conv-unit-editor` des **DEUX** règles `.prep-actions-screen
  textarea:not(…)` (app.css ~1679/1718, `max-width` 420/480 + bordure/padding, spécificité forte)
  sinon la textarea reste plafonnée et reboxée — cf. [[reference_canvas_textarea_maxwidth_cap]].
  **Auto-grow plafonné au `max-height`** (sinon `height` inline aberrant type 43160px qui distord le flex). L'état
  d'édition est porté par le **fond + liseré de la ligne** (`--editing`) et les boutons, pas par une
  boîte. **Auto-grandissante** (JS `height=scrollHeight` sur `input`) **bornée à ~8 lignes**
  (`max-height: 12rem`) puis scroll interne ; `resize: vertical`. → ouverture **modeste et prévisible**
  (ni cage de 3 lignes, ni explosion à 45vh).
- **Enregistrer** : **Ctrl+Entrée** → `updateUnitText` **immédiat** (β) → la ligne se re-rend en
  place avec le nouveau texte (retour de β). **Échap** → annule. **Entrée = saut de ligne**
  (nécessaire pour éditer un ¶ — convention legacy).
- **Une seule ligne en édition à la fois** ; entrer en édition ailleurs annule l'édition courante.
- **Pas le dock bas R5.3** : lui vaut pour les éditeurs *transitoires par-position* (token,
  borne/rôle) ; le stylo est ancré à **une unité précise** → l'en-place est cohérent avec la décision
  D3 de R5.3. *(Le panneau détaché n'avait d'intérêt que pour voir le diff avant/après pendant un
  override — or l'override B est hors stylo, cf. §7.)*

**Grain.** Sur une unité **grossière** (¶), le stylo édite le texte du **¶ entier**. Offrir un renvoi
discret **« segmenter en phrases »** pour une correction plus fine — **jamais forcé** (principe R
« capacités indépendantes »). Le modèle deux-grains (R2) est fait pour ça.

**Transversalité gratuite.** Comme l'affordance vit dans `CanvasUnitList`, elle apparaît d'un coup
dans toutes les couches. L'inspecteur (métadonnées) et la matrice d'alignement, hors
`CanvasUnitList`, sont à aligner sur la **même sémantique** (surtout D-C2 : le flag) — cf. §6.

## 4. Coût (vérifié)

- **Moteur** (livré 2026-07-20) : flag `source_changed_at` + capture/record dans `update_unit_text`,
  `ACTION_UPDATE_TEXT` (`action_history.py`), reverter `_undo_update_text` (`undo.py`) — ~45 l.
  **+ migration 032** *(voir §5 — le « zéro migration » initial était **faux**)*. Le flag lui-même est
  sans migration (colonne `source_changed_at` = mig 011).
- **Contrat** : forme requête/réponse **inchangée** → `openapi.json`/snapshot inchangés. Documenter
  le nouvel effet dans `SIDECAR_API_CONTRACT.md` + test service (édit ⇒ `source_changed_at` posé).
- **Front** : **porter le legacy A** (`_enterInlineEdit`, édition en place + auto-size) dans
  `CanvasUnitList` ; **retirer** le panneau détaché `CurationPane` (`_buildEditor`/`_overrides`
  staged→Apply α, `rows=3`). Persistance = `updateUnitText` (β) immédiat.

## 5. Annulabilité (D-C7 = OUI, tranché 2026-07-20)

**Constat** : `update_unit_text` ne passe **pas** par `record_action` ; l'undo ne gère que
`CURATION_APPLY / MERGE_UNITS / SPLIT_UNIT / RESEGMENT` (`undo.py:397-403`). Donc un édit au stylo
est **irréversible** aujourd'hui : après enregistrement, le `text_norm` d'origine est perdu (seul
`text_raw` survit).

**Décision : le stylo DOIT être annulable** (un outil qu'on dégaine partout doit pardonner la fausse
manip ; sans ça, retirer le legacy régresserait l'undo — cf. §7). **Réalisation (livrée 2026-07-20)** :
`ACTION_UPDATE_TEXT` — `update_unit_text` capture les valeurs *avant* (`text_raw`/`text_norm`) via
`record_prep_action` + `insert_unit_snapshots`, reverter `_undo_update_text` restaure les deux + reflag.

**⚠ Correction (vérifiée au code) : il FALLAIT une migration.** Le « sans migration » supposé était
**faux** : `prep_action_history.action_type` porte un **CHECK** (mig 019) qui refuse tout nouveau type
→ **migration 032** (rebuild de table, SQLite ne modifie pas un CHECK en place). Piège traité :
`prep_action_history` a un enfant `prep_action_unit_snapshots` (`ON DELETE CASCADE`) — avec
`foreign_keys=ON`, le `DROP TABLE` cascade-effacerait tous les snapshots → rebuild **encadré
`foreign_keys=OFF/ON`**, `action_id` préservés (FK par nom re-résolues). *(Le flag `source_changed_at`
reste, lui, sans migration : colonne = mig 011.)*

## 6. Portée / déploiement

- **Toutes** les surfaces via `CanvasUnitList` (couvertes d'un coup).
- **Inspecteur** (`UnitInspectorPanel`) : édite déjà via β mais **sans flag** → à faire converger sur
  D-C2 (et D-C7 si retenu).
- **Matrice d'alignement** : hors `CanvasUnitList` → décision d'exposition ultérieure.

## 7. Impacts roadmap

- **R5.1 gap #9** : le `✅ « solde le gap #9 »` (roadmap + commit `ab8eb97`) est **prématuré**.
  Recadrer : « édition directe = **stylo transversal (β)**, immédiat, annulable ; override de règle =
  différé ». Repasser gap #9 en **🟡 parité partielle** dans
  [`DESIGN_R6_4_canvas_parity.md`](DESIGN_R6_4_canvas_parity.md) tant que le stylo n'est pas livré.
- **R6.4** : ne pas retirer le legacy Curation sur cette fausse parité.

## 8. À vérifier avant d'ouvrir le ticket

- **Gardes écran-à-état** : réinit au changement de doc/connexion + teardown propre (mais **plus
  simple** qu'α : pas d'état staged à porter — l'édit est appliqué et oublié).
- **Reload** : après β, rafraîchir l'unité affichée depuis le retour de l'endpoint.
- **D-C7** tranché (annulabilité) avant de chiffrer le lot moteur.

## 9. Branchement Annotation + convergence inspecteur (livré 2026-07-23)

Deux différés du §6 traités. **Constat clé** : D-C2 (flag) et D-C7 (undo) sont posés **dans
l'endpoint** `update_unit_text` (`units_service.py:385-408`) → **tout** appelant de
`/units/update_text` en hérite. La « convergence de l'inspecteur sur D-C2/D-C7 » du §6 était donc
**déjà acquise** (même endpoint). Restaient les deux points ci-dessous.

### 9.1 Couche Annotation — le stylo + péremption des tokens (D-C9)
`AnnotationPane` rendait déjà via `CanvasUnitList` mais sans `onEditText` → pas de stylo. Branché
sur `updateUnitTextNorm` comme Rôles/Curation. **Point de design** : dans cette couche, le texte
visible d'une unité annotée = la **prose issue des tokens** (dérivée), pas `text_norm` ; or
`update_unit_text` **ne touche pas aux tokens**. Un coup de stylo laisserait donc des tokens
décrivant l'ancien texte (et la correction serait invisible dans la prose).

- **D-C9 (tranché 2026-07-23)** : **garder les tokens, signaler « périmé »** — même posture que
  D-C2 pour l'alignement (*signaler la désync, laisser l'humain décider*), et **ne jamais détruire
  une annotation possiblement corrigée à la main** (éditeur token R5.2d). Après un édit, l'unité est
  marquée stale : l'overlay retombe sur le `text_norm` corrigé + une puce « ⟳ texte modifié — à
  réannoter » ; le bouton « Annoter » (doc entier) rafraîchit tout et lève l'état.
- **Portée** : **front seul, sans migration**. Signal **in-session** (`Set<unitId>`), effacé au
  changement de doc / à la réannotation. **Borne connue** : un reload complet re-charge les tokens
  conservés et les réaffiche (l'état « périmé » n'est pas persisté) — les tokens décrivent alors
  l'ancien texte à un mot près, non corrompu. Un signal durable (colonne d'horodatage
  d'annotation, comparaison dérivée reconstruction↔`text_norm`) est un durcissement ultérieur, pas
  requis ici.
- **Recherche de tokens (R6.5-A « chercher pour éditer »)** : une unité périmée quitte le jeu
  cherchable (`_tokensInReadingOrder` la saute) et le compteur est rafraîchi à l'édit — sinon la
  navigation ciblerait un token dont l'overlay vient de disparaître. Résidu accepté : les surlignages
  de recherche se repeignent à la prochaine interaction (le re-rendu du `CanvasUnitList` déclenché par
  le stylo n'expose pas de hook post-rendu).
- **Rejeté** : suppression moteur des tokens (détruirait les corrections manuelles sur une simple
  coquille) ; ne rien faire (édit invisible dans la prose, malhonnête).

### 9.2 Inspecteur (`UnitInspectorPanel`) — convergence D-C1
L'édition inline de l'inspecteur appelait `updateUnitText(…, newText)` → envoyait **`text_raw`**,
**écrasant la provenance d'import** (le moteur mirroir raw→norm). Pire, elle **seedait la textarea
depuis `text_raw`**, injectant le balisage `<hi>` échappé dans le texte édité (corruption latente
sur les lignes riches). Basculé sur `updateUnitTextNorm` (D-C1 : édite `text_norm`, garde
`text_raw`) + seed depuis `line.text` (norm propre). Aucun changement de contrat (route + forme
inchangées).

## 10. Surfaces hors `CanvasUnitList` — Segment/Brut + matrice d'alignement (livré 2026-07-23)

D-C5 (« transversal ») étendu aux deux surfaces qui **ne** passent pas par `CanvasUnitList` et ne
recevaient donc pas le stylo « gratuitement ». Les deux sont **front pur** (contrat inchangé, β via
`updateUnitTextNorm`).

- **Couche Segment/Brut** (`SegmentPane`) : ✎ ajouté à la zone d'actions par unité (`data-act=
  "edit-text"`), **uniquement sur les unités `isLine`** (les `structure` restent non éditables) ;
  éditeur inline qui réutilise la coquille du split editor (textarea distincte
  `prep-seg-canvas-edit-ta` pour ne pas déclencher le handler du split) ; Ctrl+Entrée / Échap ;
  exclusif avec l'éditeur de coupe. **Piège corrigé** : le modèle local d'unité droppait `unit_id`
  (il ne portait que `n`) → ajouté au mapping, sinon `updateUnitTextNorm` viserait la mauvaise unité.
  Persistance = patch local + `_refreshUndoElig` (l'édit est une action Mode-A annulable), pas de
  reload complet (non structurel).
- **Matrice d'alignement** (`AlignMatrixView` + builder `alignMatrixGrid`) : ✎ **révélé au survol**
  sur la cellule **source (moyeu)** — `data-edit-col="hub"`, `unit_id = r.hubUnitId` — et sur les
  cellules **traduction « propres »** — prédicat `c.links.length === 1 && char_start == null`,
  `unit_id = c.links[0].target_unit_id`. Exclues (pas d'unité unique bien définie) : vide,
  non_traduit, ajout, fusionnée, **coupée** (fenêtre partielle), multi-liens. La cellule DOM étant
  anonyme, l'identité se résout par le view-model (`_view.rows[row]`), le `<td>` par `btn.closest`.
  Éditeur inline (remplace le contenu de la cellule), sauvegarde → `_reloadPreservingScroll`
  (re-projection ; la source corrigée réapparaît), annulation → restaure le HTML capturé. Gardes
  reprises des gestes de coupe : `_cutBusy` pendant l'écriture, garde F1 (conn ≠ `_loadedConn` →
  toast + reset), teardown dans `_resetMatrix`/`dispose`.
- **Décision D (2026-07-23, front pur retenu)** : la matrice **ne peint PAS** le flag « périmé »
  (`source_changed_at`) sur les cellules traduction — le payload `/align/matrix` ne le transporte
  pas. Le flag reste posé côté serveur (visible bannière « Révision fine » + colonne Curation). Le
  peindre *dans la grille* = lot **moteur + contrat** (projeter `source_changed_at` par lien) laissé
  en suivi (« Level B »).
