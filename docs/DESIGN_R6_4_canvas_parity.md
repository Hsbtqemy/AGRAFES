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

## 7. Décisions figées (2026-07-20) — vérifiées au code

> Cadrage tranché après **re-vérification au code** (branche `refonte`, 2026-07-20). Le §2 datait du 07/07 ; #9 a été relogé depuis, la vérif confirme que les 5 autres 🔴 sont bien **ouverts** (aucun secrètement soldé) et recense leur **couplage réel** — que la liste à plat masquait.

### 7.1 Reframing vérifié — les 5 🔴 = **4 chantiers**, tous **front-only**

| Chantier | Gaps | Couplage | Backend |
|---|---|---|---|
| **Revue de curation** | #2 statut par item **+ #4** résumé **+ #14** filtre par règle | **indivisibles** — tout est bâti sur `_curateExamples[].status` + `_activeStatusFilter`/`_activeRuleFilter`/`_curateRuleLabels` ; `_setItemStatus` (`CurationView.ts:1185`) appelle résumé+persistance à chaque mutation | **front pur** (in-memory) |
| **Règles avancées** | #1 Find/Replace+Regex (`_parseAdvancedCurateRules:1004`) | autonome | parsing front → `/curate/preview`+`/curate` **déjà live** |
| **Exceptions par unité** | #10 ignore/override/delete (`_setExceptionIgnore:2876`) | même sous-système + `_curateExceptions` (Map) | `/curate/exceptions`, `/set`, `/delete` **déjà live** |
| **Recherche token** | #22 (`AnnotationView.ts:201`) | autonome | **front pur** (opère sur `_annotTokens` en mémoire) |

**Constat structurant : aucun port ne requiert de contrat ni de migration.** #10 et #1 réutilisent des endpoints déjà en service ; #2/#3/#4/#22 sont front pur (in-memory + localStorage optionnel `agrafes.prep.curate.review.*` pour #3). → **Le chantier de parité est entièrement front — la discipline contrat n'est pas déclenchée.** #3 (persistance) est une **feuille localStorage** *stubbable* : on peut porter #2 sans elle. #13 (queue) est **séparable** (navigation doc-niveau, ne touche pas `_curateExamples`).

### 7.2 Réponses aux 4 décisions du §6

1. **Voie de cadrage** = **§5 option 3 (parité puis retrait), mais séquencée incrémentale et front-only** — *pas* big-bang. Annotation retirée d'abord (petit écran, 1 seul 🔴 → prouve le playbook de retrait), Curation ensuite.
2. **🟡 abandonnés** (documentés comme choix, non portés) : **#13** queue (le dropdown de doc du canvas navigue), **#15** minimap (le canvas marque chaque unité changée inline, R5.1b), **#17** bannière d'échantillon (**sans objet** : l'aperçu canvas est exhaustif, il ne tronque pas), **#18** carte contexte-détail (conteneur seul — #9 est déjà inline, #10 est porté en R6.5-B), **#19** **télémétrie soak seule** (`_emitUndoTransition`), **#24** sidebar par doc annotation (la nav doc du canvas la couvre ; perte = le badge « annoté ✓ », petit ajout futur si manqué). **Portés** (indivisibles de #2) : #4 résumé, #14 filtre.
   > **⚠️ Exception #19 (correction 2026-07-20).** Le doc conflait deux choses sous « transitions undo ». `_emitUndoTransition:3011` = télémétrie → **abandon**. Mais le **bouton « ↶ Annuler » de curation** (`_refreshUndoButton`, `#act-curate-undo-btn`) est une **vraie capacité** (annule un Apply via `prep_action_history`, mig 019) que `CurationPane` **n'a pas**. La capacité `prepUndo(conn, docId)` est **générique** et **déjà câblée au canvas** (`SegmentPane.ts:504`, `#prep-seg-canvas-undo`) — juste pas surfacée côté curation. → **NON abandonné** : surfacer un bouton undo dans `CurationPane` est **rattaché à R6.5-B** (parité de l'Apply — sinon on livre un Apply destructif sans annulation visible à côté).
3. **🟢 actés comme design** (documentés, jamais portés) : #11 (rôles déjà au canvas), #12 (borne affichée au state strip), #16 (diff **inline** remplace sciemment le côte-à-côte), #21 (modèle actif auto).
4. **Retrait = R6.5** (tranche dédiée post-parité). **R6.4** se limite au **responsive T4a** (sûr) + relogement **T3** (tiroir « Avancé »).

### 7.3 Séquence figée (front-only, retrait incrémental)

- **R6.4 · T4a — Responsive** ✅ *(livré 2026-07-20)*. Bloc `@container (max-width: 560px)` sur `.prep-canvas-root` (posé après `.prep-cur-editor-actions`) : onglets de couche en pleine largeur, `.prep-conv-search { min-width: 0 }` (anti-débordement des barres sans-`flex-wrap` Curation/Annotation/Rôles sous ~310px, débusqué en passe adverse), pousseurs `margin-left:auto` de dock neutralisés (modes, résumé curation, statut/gérer-modèles annotation, undo Segmentation). **Constat** : les panes étaient déjà bâties `flex-wrap` (token-editor, docks, interlinéaire Étendu qui wrappe ses cellules) → aucun débordement hormis les barres de recherche. Additif, zéro régression au-dessus du seuil. **QA visuelle restante** (headless impossible : lancer le shell + rétrécir).
- **R6.5-A — Retrait Annotation** *(le petit ; prouve le playbook)*. Port **#22** (recherche token + nav d'occurrences) dans `AnnotationPane` → reloger **#23** (`annotFocusDoc` route vers le canvas) → **#24** abandonné (7.2) → **retrait** : sous-vue `annoter`, `_annotationView`, `_renderAnnoterPanel`, carte hub (`lib/actionsHubTemplate.ts`), `dispose`, lien sidebar (`app.ts:365`), token-nav RG→Prep (`app.ts:167-168`).
- **R6.5-B — Parité Curation** *(les 3 chantiers + undo Apply + tiroir Avancé)*. Chantier **Revue** (#2+#4+#14) → chantier **Règles** (#1) → chantier **Exceptions** (#10) → **bouton undo Apply** dans `CurationPane` (surface le `prepUndo` générique déjà câblé, cf. `SegmentPane.ts:504` — petit ajout, *pas* un abandon, cf. §7.2 exception #19) → **tiroir « Avancé » (T3)** : reloger les 🟠 autonomes #5 (diag), #6 (export rapport), #7 (`CurateExceptionsAdminPanel`), #8 (`CurateApplyHistoryPanel`), #20 (bouton réindex). **#3 persistance** = optionnel (localStorage seul, portable si un cas réel le réclame).
- **R6.5-C — Retrait Curation**. Retrait : sous-vue `curation`, `_curationView`, `_renderCurationPanel`, carte hub, renvois pendants, branches `hasPendingChanges`, `dispose`, lien sidebar (`app.ts:362`), `_syncCurationWideClass` ; **~18 tests orphelins** (`curation*`) ; **garder** `curationPresets.ts` + `diff.ts` (partagés avec le canvas).

### 7.4 Blast radius — dérive constatée (allège le retrait vs §4 du 07/07)

- **`curationFocusDoc`** (`ActionsScreen.ts:552`) est **déjà mort** (0 appelant au grep) → suppression sèche, hors chantier.
- **`agrafes:prep-curation-doc`** (`app.ts:180`) n'appartient **plus** à la curation : c'est un alias `sessionStorage` legacy qui route vers **Segmentation→Rôles** (`segFocusDocRoles`) → **hors périmètre** du retrait curation.
- Cartes hub **extraites** dans `lib/actionsHubTemplate.ts` (retirer les 2 blocs `data-target="curation"/"annoter"`).
- Refs externes **propres** (`tauri-shell/src`, Python `src/` = 0) → **blast radius confiné à `tauri-prep`**.
