# Note de design — R5.1 : couche Curation dans le canvas (T1)

> Statut : **décisions figées — prête à coder** (2026-07-02). Approfondissement ancré au code (`TextCanvasView` T0, `RolesPane`, `/curate/preview`, les ~16 `lib/curation*`).
> Phase **R5.1** de [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §R5 = **tranche T1** de [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md) §7. Front-only, **contrat sidecar inchangé, zéro migration**.

## 0. Périmètre

Amener la **curation en surimpression** dans le canvas `TextCanvasView` : sur les mêmes unités que la couche Rôles, un **marqueur discret** sur les unités que les règles modifieraient, le **diff complet à la demande**, un **toggle global** « afficher tous les diffs », et l'**apply**. Réutilise `/curate/preview` + `/curate` (existants) et les `lib/curation*`.

**Hors R5.1** : la couche Annotation (T2/R5.2) ; le tiroir « Avancé » exceptions/history/diag (T3) ; le retrait des écrans legacy (T4). Le legacy `CurationView` **reste en service** pendant la migration.

## 1. Ce que le code impose (vérifié)

- **Contrat inchangé.** `curatePreview(doc_id, rules, limit_examples?, force_unit_id?)` → `{stats:{units_total, units_changed, …}, examples:[{unit_id, external_id, before, after, unit_index, matched_rule_ids, context_before/after}]}` ; `curate(...)` applique. Aucun endpoint/param neuf.
- **Aperçu échantillonné.** `examples` est **plafonné par `limit_examples`** + `stats.units_changed` donne le **compte** (pas la liste exhaustive). D'où le mapping §9 :
  - **marqueur discret** sur les unités changées → un aperçu à **`limit_examples` élevé** (≈ `units_total`) fournit l'ensemble à marquer ;
  - **diff à la demande** (clic unité hors échantillon) → **`force_unit_id`** ;
  - **toggle global** « tous les diffs » → aperçu complet inline.
- **T0.** `TextCanvasView` : bandeau d'état + picker + `RolesPane` dans le corps ; boutons **Curation/Annotation désactivés** (« à venir T1/T2 »). `RolesPane` **est** le rendu des unités (texte + badges de rôles + sélection multi/shift).

## 2. Décisions

- **D1 — Rendu partagé généralisé (tranché avec l'humain).** Extraire de `RolesPane` une **base « liste d'unités »** (texte + badges de rôles + grain + un **seul** modèle de sélection) **toujours** rendue ; chaque mode y ajoute son **décor** (rôles = assignation ; curation = marqueurs/diffs). Fidèle à §9 « base persistante + 1 mode actif », une seule liste, **zéro rendu dupliqué**. `RolesPane` devient le « mode rôles » au-dessus de la base. **Figé.**
- **D2 — Overlay léger par défaut (§9).** Unité modifiée = **marqueur discret** (bord/point coloré), **pas** le avant/après. Diff complet **au survol/clic** ; **toggle global** pour une passe de revue. **Figé.**
- **D3 — Source des règles.** La couche curation réutilise les entrées de règles existantes (`curationPresets` + regex, `lib/curationApplyInputs`) dans la **toolbar/dock** du canvas. Pas de nouveau modèle de règles. **Figé.**
- **D4 — Apply vs Valider (§6).** « **Appliquer** » (persiste la curation *staged* → DB via `/curate`) est nommé sans ambiguïté ; distinct de « Valider » (statut workflow). Le bandeau d'état gagne « **N éditions non appliquées** » + garde-fou anti-perte (`modalConfirm`) avant de quitter. **Figé.**
- **D5 — Sélection unifiée.** Un seul `_selectedUnitIds` (unité-niveau, multi + shift-range) porté par la base, partagé entre modes (résout le point dur §8). **Figé.**
- **D6 — Legacy intact.** `CurationView` reste ; le canvas est construit à côté. Retrait = T4/R6.4, après parité. **Figé.**

## 3. Sous-découpage R5.1 (incrémental, chaque pas livrable + testé)

- **R5.1a — Refactor base partagée (pur, 0 régression).** Extraire le rendu d'unités + la sélection de `RolesPane` en une base réutilisable ; `RolesPane` la consomme comme « mode rôles ». **Comportement identique** — les 746 tests prep + la parité rôles le prouvent. *De-risque tout le reste.*
- **R5.1b — Mode Curation : marqueurs.** Activer le bouton Curation ; entrée de règles (presets/regex) ; `curatePreview` à `limit_examples` élevé → **marqueur discret** sur les unités changées. Lecture seule (pas d'apply).
- **R5.1c — Diff à la demande + toggle global.** Survol/clic d'une unité marquée → avant/après (via l'exemple ou `force_unit_id`) ; toggle « afficher tous les diffs ».
- **R5.1d — Apply.** « Appliquer » → `/curate` ; bandeau « N éditions non appliquées » + garde-fou anti-perte ; réindex FTS signalée.

## 4. Implications / risque

- **Migration : aucune.** **Contrat : inchangé.** Growth-gate : sans objet (front pur).
- **Risque principal = le refactor R5.1a** d'un composant testé (`RolesPane`, 630 l.) : le neutraliser par une extraction **byte-behaviour-identique** prouvée par les tests existants + un test de parité, avant d'ajouter la curation.
- **Double UI transitoire** (canvas + legacy) : taxe assumée, bornée par des tranches courtes.
