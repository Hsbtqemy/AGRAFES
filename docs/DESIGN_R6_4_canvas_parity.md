# R6.4 — Parité canvas vs écrans legacy (cadrage)

> **But de cette note.** R6.4 (dernière tranche de la refonte) = *tiroir « Avancé » (T3) + responsive container-query (T4a) + **retrait des écrans legacy** (T4b)*. Cette note établit, **contre le code réel** (branche `refonte`, 2026-07-07), que **le canvas n'est pas à parité** avec `CurationView`/`AnnotationView` — donc le retrait legacy régresserait des fonctionnalités. Elle liste les 24 écarts, les qualifie, et pose les options de cadrage.
>
> Consolide et précise : [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §3 (R6.4) et [`DESIGN_prep_text_canvas.md`](DESIGN_prep_text_canvas.md) §7 (T3/T4).

## 1. Constat central

| Écran legacy | Lignes | Pane canvas | Lignes | Couverture |
|---|---|---|---|---|
| [`CurationView.ts`](../tauri-prep/src/screens/CurationView.ts) | 3087 | [`CurationPane.ts`](../tauri-prep/src/components/CurationPane.ts) | 337 | cœur seul (preset → aperçu → appliquer → **diff inline**) |
| [`AnnotationView.ts`](../tauri-prep/src/screens/AnnotationView.ts) | 832 | [`AnnotationPane.ts`](../tauri-prep/src/components/AnnotationPane.ts) | 559 | cœur (annoter, éditeur token, bande modèle, prose/interlinéaire) |

R5.1 / R5.2 ont relogé le **cœur** de la curation et de l'annotation dans le canvas — **pas** l'appareil dense de revue/administration. Les 4 panneaux denses cibles du « tiroir Avancé » (exceptions admin, apply-history, diagnostics, export rapport) vivent **uniquement** dans `CurationView`.

**Conséquence** : « retirer Cur/Annot » (T4b) **régresserait ~24 fonctionnalités**. La parité présupposée par la roadmap n'est **pas** atteinte. Le retrait est donc destructif *et* bloqué tant que l'écart n'est pas comblé.

**Point positif (T4a, non bloqué)** : le canvas déclare déjà `container-type: inline-size` sur `.prep-canvas-root` ([`app.css:6699`](../tauri-prep/src/ui/app.css#L6699)) mais **0 règle `@container`** — le responsive est purement additif à écrire (modèle = `AlignPanel`, seule `@container` existante, [`app.css:2396`](../tauri-prep/src/ui/app.css#L2396)).

## 2. Les 24 écarts

Légende verdict : 🔴 vraie perte à porter · 🟠 cible du tiroir Avancé T3 (relogement, pas réécriture) · 🟡 confort/navigation (perte faible, négociable) · 🟢 pas un vrai trou (choix de design du canvas, ou déjà couvert ailleurs).

### 2.1 Curation — 20 écarts (`CurationPane` vs `CurationView`)

| # | Feature | Réf. legacy | Verdict |
|---|---|---|---|
| 1 | Règles avancées (Find/Replace + Regex) | [`_parseAdvancedCurateRules:1004`](../tauri-prep/src/screens/CurationView.ts#L1004) | 🔴 |
| 2 | Statut de revue par item (pending/accepted/ignored) + bulk + filtre | [`_setItemStatus:1185`](../tauri-prep/src/screens/CurationView.ts#L1185) | 🔴 |
| 3 | Persistance d'état de revue + fingerprints de péremption | [`_saveCurateReviewState:1440`](../tauri-prep/src/screens/CurationView.ts#L1440) | 🔴 |
| 4 | Résumé de session | [`_updateSessionSummary:1256`](../tauri-prep/src/screens/CurationView.ts#L1256) | 🟡 |
| 5 | Diagnostics + journal de revue | [`_renderCurateDiag:2300`](../tauri-prep/src/screens/CurationView.ts#L2300) | 🟠 |
| 6 | Export rapport JSON/CSV | [`_runExportReviewReport:2227`](../tauri-prep/src/screens/CurationView.ts#L2227) | 🟠 |
| 7 | Exceptions persistées (panneau admin) | [`CurateExceptionsAdminPanel:896`](../tauri-prep/src/screens/CurationView.ts#L896) | 🟠 |
| 8 | Apply-history (panneau) | [`CurateApplyHistoryPanel:915`](../tauri-prep/src/screens/CurationView.ts#L915) | 🟠 |
| 9 | Overrides manuels + revert | [`_saveManualOverride:2780`](../tauri-prep/src/screens/CurationView.ts#L2780) | ✅ (relogé 2026-07-19, éditeur inline `CurationPane` — [note](DESIGN_curation_inline_edit_canvas.md)) |
| 10 | Exceptions par unité (ignore/override/delete) | [`_setExceptionIgnore:2875`](../tauri-prep/src/screens/CurationView.ts#L2875) | 🔴 |
| 11 | Gestion conventions/rôles + role bar + apply-role | [`_renderConventionsList:2042`](../tauri-prep/src/screens/CurationView.ts#L2042) | 🟢 déjà sur canvas (RolesPane/SegmentPane) |
| 12 | Réglage borne début-de-texte | [`_setTextStart:2714`](../tauri-prep/src/screens/CurationView.ts#L2714) | 🟢 affiché (state strip) ; réglé en Seg |
| 13 | File d'attente + doc préc./suiv. | [`_renderCurateQuickQueue:1110`](../tauri-prep/src/screens/CurationView.ts#L1110) | 🟡 |
| 14 | Filtre par règle d'origine | [`_setRuleFilter:1317`](../tauri-prep/src/screens/CurationView.ts#L1317) | 🟡 |
| 15 | Minimap des changements | [`_renderCurateMinimap:2339`](../tauri-prep/src/screens/CurationView.ts#L2339) | 🟡 |
| 16 | Panes brut↔diff côte-à-côte + scroll-sync | [`_bindCurateScrollSync:928`](../tauri-prep/src/screens/CurationView.ts#L928) | 🟢 remplacé par diff **inline** (design §7 = « le vrai gain ») |
| 17 | Bannière de péremption d'échantillon | [`_updateSampleInfo:1337`](../tauri-prep/src/screens/CurationView.ts#L1337) | 🟡 |
| 18 | Carte contexte-détail | [`_renderContextDetail:2988`](../tauri-prep/src/screens/CurationView.ts#L2988) | 🟡 |
| 19 | Transitions undo / nav étape suivante | [`_emitUndoTransition:3011`](../tauri-prep/src/screens/CurationView.ts#L3011) | 🟡 |
| 20 | Bouton réindexer-après-apply | canvas = hint texte seul ([`CurationPane:291`](../tauri-prep/src/components/CurationPane.ts#L291)) | 🟠 petit |

### 2.2 Annotation — 4 écarts (`AnnotationPane` vs `AnnotationView`)

| # | Feature | Réf. legacy | Verdict |
|---|---|---|---|
| 21 | Sélecteur de modèle explicite (auto + fr/en/de/es/it/sv/ro/el/multi) | [`AnnotationView:157`](../tauri-prep/src/screens/AnnotationView.ts#L157) | 🟢 volontaire (canvas = modèle actif auto) |
| 22 | Recherche token + nav d'occurrences (compte/highlight/scroll) | [`AnnotationView:201`](../tauri-prep/src/screens/AnnotationView.ts#L201) | 🔴 |
| 23 | Deep-link token `focusDoc(docId, tokenId)` | [`AnnotationView:116`](../tauri-prep/src/screens/AnnotationView.ts#L116) | 🟠 (annotFocusDoc route encore vers le legacy) |
| 24 | Sidebar par doc (tri A-Z/ID + badge annoté ✓) | [`_annotRenderDocList:368`](../tauri-prep/src/screens/AnnotationView.ts#L368) | 🟡 |

## 3. Synthèse par criticité

| Catégorie | Compte | # | Interprétation |
|---|---|---|---|
| 🟢 Pas un vrai trou | 4 | 11, 12, 16, 21 | Le canvas fait autrement, *sciemment* |
| 🟠 Cibles du tiroir Avancé (T3) | 6 | 5, 6, 7, 8, 20, 23 | **Reloger**, pas réécrire — `CurateExceptionsAdminPanel`/`CurateApplyHistoryPanel` sont autonomes |
| 🔴 Vraies pertes à porter | 6 | 1, 2, 3, 9, 10, 22 | Le vrai cœur de la parité |
| 🟡 Confort/navigation | 8 | 4, 13, 14, 15, 17, 18, 19, 24 | Perte réelle mais faible ; certains abandonnables |

> **La « parité » n'est donc pas 24 réécritures.** 4 non-trous ; 6 relogements (T3, mécanique) ; **6 vrais ports** ; 8 conforts négociables. Le vrai investissement = les **6 rouges** (+ le relogement T3).

## 4. Blast radius d'un retrait (pour mémoire, T4b)

Si/quand la parité est atteinte, retirer les deux écrans touche (source : cartographie ActionsScreen/app.ts) :

- **Suppression** : [`CurationView.ts`](../tauri-prep/src/screens/CurationView.ts) (−3087 l.), [`AnnotationView.ts`](../tauri-prep/src/screens/AnnotationView.ts) (−832 l.) ; composants dédiés `CurateExceptionsAdminPanel`, `CurateApplyHistoryPanel`, `CurateApplyConfirmDialog` deviennent morts ; ~17 tests `lib/__tests__/curation*` + `screens/__tests__/CurationView.render.test.ts` orphelins.
- **À garder** (partagés) : `lib/curationPresets.ts` (utilisé par `CurationPane`), `lib/diff.ts`, `ui/annotationProse.ts`, `lib/jobPolling.ts`, `lib/models.ts`.
- **ActionsScreen** : retirer sous-vues `curation`/`annoter` du type `SubView`, imports, champs `_curationView`/`_annotationView`, builders `_renderCurationPanel`/`_renderAnnoterPanel`, cartes hub Curation/Annotation, et les renvois pendants (`applyCurationPreset`, `annotFocusDoc`, `curationFocusDoc`, branches `hasPendingChanges`, `dispose`).
- **app.ts** : liens sidebar `Curation`/`Annotation`, cast `setSubView`, nav token RG→Prep (`setSubView("annoter")` + `annotFocusDoc`), clé `agrafes:prep-curation-doc`, `_syncCurationWideClass`.
- **Garder l'écran Segmentation** : le *structure matcher* inter-doc (R5.4d) n'est pas relogé.
- **Externe** : aucune référence dans `tauri-shell/src` ni `src/` (grep propre) → blast radius confiné à `tauri-prep`.

## 5. Options de cadrage R6.4

1. **Responsive + tiroir Avancé** — T4a (canvas `@container` + matcher) *puis* T3 (reloger 🟠 dans un tiroir « Avancé » repliable). Additif, 0 régression, comble 6 écarts en déplaçant du code existant. Grosse tranche.
2. **Responsive seul** — T4a uniquement. Petit, sûr, rapide. Diffère T3 + retrait.
3. **Viser la parité puis retrait** — porter les 6 🔴 (+ T3) puis supprimer Cur/Annot. Fidèle à R6.4 tel qu'écrit, mais multi-session.

**Recommandation** : ne pas faire T4b (retrait) tant que les 🔴 ne sont pas portés. Livrer T4a (sûr, valeur immédiate) ; enchaîner T3 (relogement) comme pont ; traiter les 🔴 comme un chantier explicite avant tout retrait.

## 6. Décisions à figer

1. Voie de cadrage (§5) : 1, 2 ou 3 ?
2. Parmi les 🟡 confort : lesquels sont *abandonnés* (pas reportés) au canvas ? (ex. minimap, carte contexte-détail, résumé de session.)
3. Les 🟢 (#11, 12, 16, 21) sont-ils *actés* comme choix de design (à documenter, pas à porter) ?
4. Le retrait (T4b) reste-t-il dans R6.4, ou devient-il **R6.5** (tranche dédiée post-parité) ?
