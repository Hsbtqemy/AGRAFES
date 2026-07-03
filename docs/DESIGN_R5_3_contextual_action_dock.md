# Note de design — R5.3 : dock d'actions contextuel persistant (canvas)

> Statut : **décisions figées** (direction tranchée 2026-07-03 : *dock bas persistant unifié*).
> Date : 2026-07-03. Cible : `tauri-prep` / `tauri-shell`. **Front pur — aucun impact
> moteur ni contrat.**
> Spine : [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md) (canvas = texte central
> à scroll unique + couches).

## 0. Problème (vérifié au code)

Le canvas a **un seul conteneur de scroll** : `.prep-canvas-body { overflow-y: auto }`
(`app.css`). Les panneaux d'action contextuels sont en **flux normal**, à des extrémités
opposées, et **aucun n'est `sticky`** :

- **Éditeur de token** (`#prep-annot-token-editor`, `AnnotationPane`) → en **haut** du volet.
- **Barre borne/rôle** (`.prep-conv-action-bar`, `RolesPane`) → en **bas du contenu**
  (`margin-top` après la liste).

Sur une longue liste, agir sur une unité au milieu force un aller-retour : l'éditeur est
au-dessus du pli (scroll ↑), la barre borne/rôle en dessous (scroll ↓). Seul le « ✕ Retirer
la borne » est déjà contextuel (inline sur l'unité-borne).

## 1. Décision figée (après exploration)

**Feuille contextuelle non-modale, fixée au bas de la fenêtre**, unique et partagée par
**toutes les couches** (Rôles / Curation-futur / Annotation). La **couche active** y rend sa
box (barre borne/rôle sur sélection, éditeur de token). Non-modale = **le texte reste
cliquable** (pas de fond assombri) → on enchaîne les sélections / les tokens sans fermer.

**Chemin d'exploration** (tranché à l'usage, captures à l'appui) :
1. *Dock bas dans le cadre canvas* (R5.3-1/-2, livré puis dépassé) : « harmonisé mais pas
   pratique » — trop loin du clic, et confiné au bas du **texte** (pas de la fenêtre).
2. *Popover ancré / inline* : écartés — couvrent ou repoussent le texte.
3. *Colonne droite calée à la ligne* vs *feuille non-modale bas de fenêtre* : prototypées
   **toutes deux** pour comparer en vrai. Verdict utilisateur : **feuille partout** — plus
   sobre, garde le texte pleine largeur, « fait respirer ». La navette œil↔token en
   Annotation est acceptée, **mitigée par un liseré sur le token en cours d'édition**.

## 2. Architecture

- **La feuille appartient à `TextCanvasView`** : `#prep-canvas-bottomsheet`,
  `position: fixed; left/right/bottom: 0` (repère = la fenêtre, **hors** du cadre canvas),
  `z-index: 50`. `pointer-events: none` sur le conteneur + `auto` sur son enfant → seule la
  box capte les clics, le reste passe au travers (non-modale). Enfant centré `max-width` +
  coins hauts arrondis + ombre = allure « feuille ». Vide (enfant `display:none`) → invisible.
- **Les panes reçoivent la feuille** (param constructeur optionnel `dock?: HTMLElement`).
  Chaque pane **rattache son élément au conteneur** au `mount()` (si fourni), garde une
  **référence directe** (l'élément vit hors de `this._root`), gère **son propre show/hide**.
  Un enfant par pane, une seule couche active → au plus une box visible.
- **Mitigation Annotation** : au clic token, `AnnotationPane` pose la classe
  `.annot-editing-token` (liseré) sur le span ; ré-appliquée après chaque re-render de la
  liste (`_renderList` : render + re-highlight) pour survivre au repaint (save, bascule vue).
- **Fallback sans dock** (tests, `SegmentationView` legacy pour `RolesPane`) : l'élément reste
  in-pane, comportement inchangé → rétro-compatible.
- **Lifecycle** : `TextCanvasView._setMode` appelle `deactivate()` sur la pane **sortante**
  (masque sa box). Un changement de document ferme déjà l'éditeur (`setDocument`).

## 3. État de livraison

- **Livré** (front pur, 0 moteur/contrat ; NON committé) : `AnnotationPane` (éditeur token) et
  `RolesPane` (barre borne/rôle) rendent dans `#prep-canvas-bottomsheet` ; liseré token +
  `_renderList` ; tests `AnnotationPane.test.ts` (rattachement + `deactivate`) et
  `RolesPane.test.ts` (rattachement + fallback + `deactivate`). `807` vitest vert + build OK.
- **R5.3-3 Curation — probablement SKIP** : `CurationPane` n'a pas de box par-position mais un
  **panneau de contrôle global** (`.prep-cur-dock` : règles + Aperçu + Appliquer-au-doc). À
  revisiter avec l'**écart relevé** : l'édition **directe du texte** d'une unité (présente
  dans `CurationView` legacy) n'a pas été relogée dans le canvas.

## 4. Hors périmètre

Bande modèle (`.prep-annot-model-band`, setup par-document) et dock « Annoter » (statut) :
laissés en place. Suivi de la ligne au scroll, feuille redimensionnable : non retenus. Aucun
changement moteur/contrat.
