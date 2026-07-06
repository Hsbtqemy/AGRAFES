# Note de design — R5.4b : couche « Segmentation » au canvas (front)

> Statut : **à discuter** (issu de la cartographie du code 2026-07-06). Date : 2026-07-06.
> Cible : `tauri-prep` / `tauri-shell` — **front pur** : consomme les endpoints livrés en
> **R5.4a** (`preset` / `spec` sur `/segment(/preview)`, contrat 1.6.45). Aucun moteur, aucun contrat.
> Amont : [`DESIGN_R5_4_segmentation_layer.md`](DESIGN_R5_4_segmentation_layer.md) (modèle figé — §2 deux
> natures, §3 décisions, §6 R5.4b), [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md) (couches).

## 0. Cadrage

R5.4a a rendu le **moteur** configurable et l'a exposé (params `preset`/`spec` additifs, byte-identique
sans eux). R5.4b **agit depuis le canvas** : une 4ᵉ couche `Segmentation` qui *propose* un découpage
(aperçu en contexte), puis l'*applique* (resegmentation destructive, garde-fou conditionnel + reload).
La segmentation « legacy » (`SegmentationView`) **reste** — R5.4b est additif (retrait = R6.4, conditionné
au relogement du *structure matcher*, hors périmètre).

## 1. État du code (vérifié)

- **`TextCanvasView`** ([screens/TextCanvasView.ts](../tauri-prep/src/screens/TextCanvasView.ts)) :
  `CanvasMode = "roles" | "curation" | "annoter"` ; boutons de mode dans `.prep-canvas-modes`
  (`data-mode`) ; panes `#prep-canvas-pane-{roles,curation,annoter}` **créés à la volée** au 1ᵉʳ switch ;
  **feuille d'actions fixée** `#prep-canvas-bottomsheet` partagée par les couches (R5.3, `ResizeObserver`
  rembourre le scroll) ; `_syncActivePane()` dispatche `setDocument(...)` à la couche active ;
  l'hôte possède déjà `onReloadDocs()` **puis** re-`_focusDoc()` (re-fetch stats + unités) — exactement
  le *reload post-apply* dont on a besoin.
- **Bandeau d'état** (`_renderStateStrip`) : chips `Brut (non segmenté)` / `Segmenté · N phrases|unités ¶`
  (heuristique `avg_text_len > 240`), `Numéroté`, **`Aligné (N)` / `Non aligné`**, `Index à jour/périmé`,
  `Borne`. → **le signal « aligné » pour le garde-fou conditionnel est déjà là** (`stats.aligned_count`).
- **Pattern de pane** (`RolesPane`) : `mount()` (idempotent) · `setDocument(docId, textStartN[, lang])` ·
  `deactivate()` (rétracte sa box du sheet au switch) · `dispose()` ; base partagée `CanvasUnitList`
  (unités + sélection + recherche) ; la box contextuelle est **re-parentée dans le dock** (sheet).
- **Client** ([lib/sidecarClient.ts](../tauri-prep/src/lib/sidecarClient.ts)) :
  `segmentPreview(conn, {doc_id, mode?, lang?, pack?, limit?, calibrate_to?})` → `SegmentPreviewResponse`
  `{ segments:[{n,text,source_unit_n,external_id}], segment_pack, units_input/output, warnings, calibrate_* }` ;
  `segment(conn, {doc_id, lang?, pack?})` → `{ units_input/output, fts_stale, warnings }`.
  → **à étendre** (R5.4b) : ajouter `preset?` / `spec?: SegmentSpecInput` aux deux (miroir du contrat 1.6.45).
- **Legacy `SegmentationView`** : panneau droit `pack` + `calibrate` + mode (`sentences`/`markers`),
  onglets Aperçu/Enregistré/Diff/Structure/Rôles, aperçu live *débattu*, + le *structure matcher*
  (`SegStructureMatcherPanel`, inter-doc, lourd → **hors périmètre**).

## 2. Modèle UI cible

### 2.1 4ᵉ couche `segment`
- `CanvasMode` gagne `"segment"` ; un 4ᵉ bouton de mode ; un pane `#prep-canvas-pane-segment` ;
  un `SegmentPane` lazy (comme Curation/Annotation).
- **Découvrabilité** : le chip d'état `Brut (non segmenté)` (et `Non aligné`) **pointe** vers la couche
  (clic → `_setMode("segment")`). Cohérent avec « le bandeau pointe vers la couche » (parent §3.1).

### 2.2 Anatomie du `SegmentPane`
- **En-tête (toolbar de la couche)** — la surface **`Brut | Phrases | Balises [N] | Personnalisé`**
  (segmented control) collée en haut du scroll. Toujours visible (contrairement aux box *contextuelles*
  déclenchées par sélection) → sa place est en **haut du pane**, pas dans le sheet.
- **Corps (le texte, scroll unique)** — selon l'onglet : **Brut** rend les unités actuelles *telles quelles*
  (aucune coupe, texte **complet**) ; les autres rendent l'**aperçu de découpe** (liste des segments
  proposés, §2.4), débattu à chaque changement.
- **Feuille fixée (bottom sheet)** — l'**action `Appliquer` + le résumé** (`N unités → M segments`,
  warnings) pour les onglets de découpe ; **masquée en Brut** (rien à appliquer). Réutilise le dock R5.3.

### 2.3 Surface `Brut | Phrases | Balises [N] | Personnalisé`
Modèle **affiné avec l'utilisateur (2026-07-06)** : chaque onglet a un rôle net, sans recouvrement — on
compare l'avant/après en **basculant d'onglet** (plutôt qu'un avant|après spatial).

| Onglet | État / envoie | Rôle |
|---|---|---|
| **Brut** | lecture des unités actuelles (`listUnits`) | l'**état courant**, en entier ; pas d'`Appliquer` |
| **Phrases** | `preset: "phrases"` (+ `lang`) | découpe sur `.` `?` `!` **+ fermants** (`.»`, `.)`…), **sans condition de majuscule** (moteur R5.4b), abréviations protégées. Coupe donc aussi devant un `[N]` via les vrais points |
| **Balises [N]** | `preset: "balises"` | texte déjà balisé → un segment par `[N]` |
| **Personnalisé** | `spec: {…}` *(R5.4b-2)* | terminateurs cumulables, **majuscule-après** (interrupteur), Mots (`kind: whitespace`), filet d'abréviations |

**Décision moteur clé** : « Phrases » = découpage **bête et robuste** (suit la ponctuation réelle) ; les
conditions fines (majuscule-après, terminateurs custom) migrent dans **Personnalisé** — sinon les deux se
recouvrent. Concrètement le préréglage `phrases` passe `require_uppercase_after` de `True` à **`False`**
(changement **global** de `segment_text`, y compris l'écran legacy).

### 2.4 Aperçu en contexte — **tranché : liste des segments proposés (A)**
- **A. Liste des segments proposés** *(retenu, 2026-07-06)* : le corps rend la *sortie* (`segments[]`) —
  une carte/ligne par segment proposé, regroupée par `source_unit_n` (frontière visible entre groupes).
  Simple, fidèle à « voici comment ça sera coupé », robuste (pas de reconstruction d'offsets).
- **B. Texte continu avec marqueurs de coupe** *(différé)* : texte d'origine + repère `¦` à chaque
  frontière. Plus immersif mais fragile (le moteur renvoie les segments, pas les offsets) → piste future.

### 2.5 Appliquer (garde-fou conditionnel + reload)
- `segment(conn, {doc_id, preset|spec})`. **`modalConfirm` seulement si `stats.aligned_count > 0`**
  (« la resegmentation efface l'alignement existant — continuer ? »). Sinon → **application libre**,
  sans friction (pas de WORKCOPY imposée, parent §3.4).
- Après succès → l'hôte **recharge** (`onReloadDocs()` puis re-`_focusDoc()`) : stats + bandeau
  rafraîchis (chip aligné → non aligné), les autres couches se rechargeront à leur prochain affichage,
  `fts_stale` remonté. → le `SegmentPane` a besoin d'un **callback hôte** `onResegmented` (que
  `TextCanvasView` câble sur son reload) — nouveau, mais minime.

## 3. Décisions à figer (avant ticket)

1. **Style d'aperçu** : **A (liste des segments proposés) — tranché** (2026-07-06). B (texte + marqueurs)
   différé (fragile : le moteur renvoie les segments, pas les offsets).
2. **Placement des contrôles** : en-tête du pane (surface + contrôles) **+** `Appliquer`/résumé dans le
   sheet fixé. (Alternative rejetée : tout dans le sheet — les contrôles de segmentation sont l'affordance
   *primaire* de la couche, pas une box contextuelle.)
3. **Périmètre R5.4b-1** : Phrases + Balises (relog du chemin legacy dans le canvas) ; Personnalisé
   (terminateurs cumulables + Mots) en **R5.4b-2**. Cases abréviations FR/EN → option de Phrases, **différée**.
4. **`calibrate_to`** (avertissement de ratio vs doc de référence) : **différé** hors R5.4b-1 (c'est un
   confort du legacy ; le garde-fou et l'aperçu sont prioritaires). À rediscuter.

## 4. Tranches

- **R5.4b-1** ✅ — surface **`Brut | Phrases | Balises [N] | Personnalisé`** + `SegmentPane` : **Brut**
  (unités actuelles en entier), **aperçu liste** (Phrases/Balises) débattu, Appliquer (confirm *conditionnel*
  + reload), client `preset?`/`spec?` étendu, chip d'état cliquable. Relogue le cœur sentences/markers du
  legacy. **Moteur associé** : « Phrases » sans condition de majuscule + ponctuation fermante (cf. §2.3).
- **R5.4b-2** — onglet **Personnalisé** : terminateurs cumulables (cases) + **majuscule-après** (interrupteur,
  migré de Phrases) + Mots (`kind: whitespace`) → construit un `spec`. (Option abréviations FR/EN ici.)
- **R5.4b-3 — anomalies + édition merge/split (relog du legacy)** : reloger du `SegmentationView` la
  **détection d'anomalies** — « segments courts + voisins » et **« ponctuation orpheline »** (regex
  `^\s*[»)\]}”’…]+`, *langue-aware* : `« ‹ ›` pour DE, cf. `SegmentationView.ts:920-966`) — **plus**
  l'**édition merge/split** des unités (pas encore au canvas). C'est **là** que se règle le fermant
  orphelin (`»` seul, ex. après Balises), **pas** dans le découpage : Phrases reste bête, l'orpheline est
  une *anomalie à réviser puis fusionner à la main*. (Décision 2026-07-06 — évite une heuristique moteur
  qui coupleraient Phrases à la convention `[N]`.)
- *(ultérieur)* aperçu B (marqueurs inline), `calibrate_to`, préréglages custom nommés.

## 5. Risques

- **Destructif** : `/segment` efface l'alignement → **confirm conditionnel** (chip `Aligné` = signal).
- **État périmé** : bien recharger après apply (réutiliser `onReloadDocs` + re-`_focusDoc` de l'hôte).
- **Échappement** : les `segments[].text` (dérivés de `text_norm`) doivent passer par `escHtml` (pas de
  `text_raw` pré-échappé ici, contrairement au rendu des unités sauvegardées).
- **Troncature d'aperçu** (limite 5000, warning moteur) : afficher le warning tel quel.
- **Couplage shell** : CSS préfixée `prep-*` ; pas de dialog natif (`modalConfirm`).
