# Backlog — Audit onglet Constituer (Prep)

> Issu de l'audit du 2026-04-14. Couvre `tauri-prep/` et `tauri-shell/src/modules/constituerModule.ts`.
> Organisé en 5 sprints thématiques, ordonnés par dépendances.
> Prérequis croisés indiqués par `(→ ticket)`.

---

## Sprint A — Stabilisation critique

> Aucune dépendance externe. Peut commencer immédiatement.

---

### A-1 — Implémenter `dispose()` sur `ActionsScreen`

**Priorité :** Critique | **Effort :** M (3–5 h)

**Contexte**
`ActionsScreen` accumule des ressources non nettoyées lors des navigations Shell (Constituer → Recherche → Constituer). La conséquence est des appels sidecar orphelins et des listeners qui persistent après démontage.

**Ressources à nettoyer**

| Champ | Type | Risque si non nettoyé |
|---|---|---|
| `_segPreviewTimer` | `ReturnType<setTimeout>` | Appels sidecar post-unmount |
| `_previewDebounceHandle` | `number` | Idem |
| `_onLtRawScroll` / `_onLtSegScroll` | `EventListener` | Fuite sur éléments détachés |
| `_onSegPrevRawScroll` / `_onSegPrevSegScroll` | `EventListener` | Idem |
| `_onCurateRawScroll` / `_onCurateDiffScroll` | `EventListener` | Idem |
| `_mmScrollCleanups` | `Array<() => void>` | Closures minimap jamais libérées |
| Poll annotation | via `_annotStopPoll()` | Partiellement protégé, à systématiser |

**Travail à faire**

1. Ajouter `dispose(): void` à la classe `ActionsScreen` :
   ```ts
   dispose(): void {
     if (this._segPreviewTimer) { clearTimeout(this._segPreviewTimer); this._segPreviewTimer = null; }
     if (this._previewDebounceHandle) { window.clearTimeout(this._previewDebounceHandle); this._previewDebounceHandle = null; }
     this._unbindLongtextScrollSync();
     this._unbindSegPreviewScrollSync();
     this._unbindCurateScrollSync();
     for (const fn of this._mmScrollCleanups) { try { fn(); } catch { /* */ } }
     this._mmScrollCleanups = [];
     this._annotStopPoll();
     this._alignPanel?.dispose(); // → voir A-2
     this._root = null;
   }
   ```
2. Dans `tauri-prep/src/app.ts` → méthode `dispose()`, ajouter `this._actions.dispose()` avant `window.removeEventListener`.
3. Vérifier que `constituerModule.ts` appelle bien `_prepApp.dispose()` (déjà le cas — confirmer la chaîne).

**Critères d'acceptance**
- [ ] Naviguer Constituer → Recherche → Constituer 3× sans fuite mémoire (DevTools Memory snapshot).
- [ ] Aucun appel HTTP sidecar observable après démontage (DevTools Network).
- [ ] `dispose()` est idempotent (double-appel sans erreur).

---

### A-2 — Implémenter `dispose()` sur `AlignPanel`

**Priorité :** Haute | **Effort :** S (1–2 h)
**Fichier :** `tauri-prep/src/screens/AlignPanel.ts`

**Travail à faire**

1. Ajouter `dispose(): void` à `AlignPanel` :
   - Nullifier `this._el`
   - `this._pendingConfirm = null`
   - Annuler tout timer interne identifié à la lecture complète
2. L'appeler depuis `ActionsScreen.dispose()` (→ A-1).

**Critères d'acceptance**
- [ ] Pas de référence zombie à `_el` après démontage.
- [ ] `dispose()` idempotent.

---

### A-3 — Scoper les `querySelector` globaux dans `ActionsScreen` ✅

**Priorité :** Haute | **Effort :** L (6–8 h)
**Fichier :** `tauri-prep/src/screens/ActionsScreen.ts`

**Contexte**
663 appels `getElementById`/`querySelector`. Les appels `document.querySelector(...)` non scopés peuvent trouver des éléments fantômes si le panel n'est pas le seul actif, ou retourner `null` silencieusement si le panel est démonté.

**Travail à faire**

1. Créer un helper privé :
   ```ts
   private _q<T extends HTMLElement>(selector: string): T | null {
     return this._root?.querySelector<T>(selector) ?? null;
   }
   ```
2. Remplacer `document.querySelector("#act-…")` par `this._q("#act-…")` dans toutes les méthodes ayant accès à `this._root` au moment de l'appel.
3. Ajouter un guard dans les callbacks asynchrones (jobs, timers) :
   ```ts
   if (!this._root?.isConnected) return;
   ```
4. Cas prioritaires à traiter :
   - L4564 — `document.querySelector('tr[data-diff-idx="..."]')`
   - L4570 — `.raw-unit[data-diff-idx]`
   - L8064–8071 — reset des panels curation post-apply
   - L8157–8191 — `_refreshSegmentationStatusUI()` (8 sélects globaux)
   - L9404 — workflow `#wf-hdr-${i}` (déjà semi-scopé via `this._wfRoot`)

**Critères d'acceptance**
- [x] `grep "document\.querySelector\|document\.getElementById" ActionsScreen.ts` ne retourne que des cas avec commentaire justificatif (seul résidu : fallback `.__never__` dans `_qAll`, intentionnel).
- [x] Build TypeScript sans erreur (2 erreurs `.at()` pre-existantes lib es2022, sans rapport).
- [x] Unsafe `!` et casts nus corrigés dans les contextes async (`statsEl`, `applyBtn`, `reindexBtn`, `btn#act-report-btn`, `el#act-diff-list`).
- [x] `scope` dans `_setActiveDiffItem` : `panel ?? this._root ?? document`.

---

### A-4 — Remplacer les `window.confirm` résiduels par des banners inline

**Priorité :** Haute | **Effort :** L (5–7 h)
**Fichier :** `tauri-prep/src/screens/ActionsScreen.ts`, `tauri-prep/src/app.ts`

**Contexte**
9 `window.confirm` subsistent malgré la refactorisation d'`AlignPanel` qui les a déjà éliminés. Le pattern inline est établi et validé dans `AlignPanel` (bannière `_pendingConfirm`).

**Utilitaire à créer**

```ts
// tauri-prep/src/lib/inlineConfirm.ts
export function showInlineConfirm(
  container: HTMLElement,
  message: string,
  onConfirm: () => void,
  onCancel?: () => void
): () => void { /* retourne cleanup, focus sur le bouton Confirmer */ }
```

**Occurrences à traiter**

| Sous-ticket | Ligne | Contexte | Zone de la bannière |
|---|---|---|---|
| **A-4a** | L8032 | Apply curation | `#act-curation-head` |
| **A-4b** | L6680 | Définir `text_start_n` | Au-dessus de l'unité concernée dans le raw pane |
| **A-4c** | L6799 | Supprimer frontière paratextuelle | Header du raw pane |
| **A-4d** | L8289 | Valider doc sans segmentation | `#act-seg-final-bar` |
| **A-4e** | L8355 | Confirmer segmentation | Header segmentation |
| **A-4f** | L8523 | Autre confirm segmentation | Header segmentation |
| **A-4g** | L9046 | Batch delete liens | `#act-audit-batch-bar` |
| **A-4h** | L9681 | Supprimer lien unique | `#act-align-focus-panel` |
| **A-4i** | app.ts L339 | Changement d'onglet pending | Topbar |

**Critères d'acceptance**
- [ ] `grep -c "window\.confirm\|if (!confirm" ActionsScreen.ts` retourne `0`.
- [ ] Chaque action critique reste confirmable ou annulable.
- [ ] Le bouton Confirmer reçoit le focus automatiquement à l'ouverture du banner.

---

## Sprint B — Architecture

> Prérequis : A-1 complété. B-1 et B-2 peuvent aller en parallèle.

---

### B-1 — Extraire `CurationView` depuis `ActionsScreen`

**Priorité :** Haute | **Effort :** XL (10–15 h)
**Fichiers :** `tauri-prep/src/screens/ActionsScreen.ts` → nouveau `tauri-prep/src/screens/CurationView.ts`

**Contexte**
La sous-vue Curation représente ~4 500 lignes et ~30 champs de classe dans `ActionsScreen`. Elle est délimitée entre `_renderCurationPanel()` (L772) et `// ─── Segment ───` (L8135), plus les helpers de state management (L4518–5793) et les niveaux 7B–10B (L7004–8134).

**Champs à déplacer dans `CurationView`**

```
_curateExamples, _activeDiffIdx, _previewMode, _previewSyncScroll,
_curateSyncLock, _onCurateRawScroll, _onCurateDiffScroll,
_curateRuleLabels, _activeRuleFilter, _curateGlobalChanged,
_activeStatusFilter, _curateRestoredCount, _curateSavedCount,
_curateUnitsTotal, _forcedPreviewUnitId, _editingManualOverride,
_curateExceptions, _frExtraRules, _lastApplyResult, _applyHistory,
_allUnits, _allUnitsDocId, _allOverrides, _allOverridesDocId,
_conventions, _selectedUnitNs, _lastSelectedN,
_curateLog, _hasPendingPreview
```

**Méthodes à déplacer** : toutes préfixées `_curate*`, `_runPreview`, `_runCurate`, `_renderCurationPanel`, `_renderRawPane*`, `_renderDiffList`, `_renderContextDetail`, `_renderRoleBar`, `_renderTextStartSeparator`, `_renderOverrideBadge`, `_renderExceptionBadge`, `_renderExcAdminPanel`, `_renderApplyHistoryPanel`, `_renderCurateLog`, `_renderCurateDiag`, `_renderCurateMinimap`, et toutes les méthodes liées aux exceptions, overrides, history, fingerprints (Level 3A à 10B).

**Constantes locales à déplacer** : `CURATE_PRESETS`, `CURATE_PREVIEW_LIMIT`, interfaces `StoredCurateReviewState` et `CurateApplyResult`.

**Interface publique de `CurationView`**

```ts
export class CurationView {
  constructor(
    getConn: () => Conn | null,
    getDocs: () => DocumentRecord[],
    callbacks: {
      log: (msg: string, isError?: boolean) => void;
      toast: (msg: string, isError?: boolean) => void;
      setBusy: (v: boolean) => void;
      jobCenter: () => JobCenter | null;
      onOpenDocuments: () => void;
    }
  ) {}

  render(): HTMLElement;
  dispose(): void;
  setConn(conn: Conn | null): void;
  hasPendingChanges(): boolean;
  focusUnit(unitId: number): void;
}
```

**Points d'attention**
- `_curateLog` partagé avec le log global → extraire un callback `onPushLog`.
- `_isBusy` / `_busyEl` partagés → passer `setBusy` en callback.
- `this._docs` → passer `getDocs` en getter injecté.

**Critères d'acceptance**
- [ ] `ActionsScreen.ts` perd ~4 500 lignes après extraction.
- [ ] Curation fonctionne identiquement : preview live, apply, exceptions, historique, review persistence.
- [ ] `CurationView.dispose()` appelé dans `ActionsScreen.dispose()`.
- [ ] Build TypeScript sans erreur.

---

### B-2 — Extraire `SegmentationView` depuis `ActionsScreen`

**Priorité :** Haute | **Effort :** L (8–10 h)
**Fichiers :** `tauri-prep/src/screens/ActionsScreen.ts` → nouveau `tauri-prep/src/screens/SegmentationView.ts`

**Champs à déplacer**

```
_segmentPendingValidation, _lastSegmentReport, _segFocusMode,
_voPreviewLimitByDocId, _selectedSegDocId, _segMarkersDetected,
_segSplitMode, _segPreviewTimer, _segLongTextMode, _segMode,
_onLtRawScroll, _onLtSegScroll, _onSegPrevRawScroll, _onSegPrevSegScroll,
_ltSyncLock, _ltSearchOpen, _mmScrollCleanups, _mmZoneUpdaters,
_segPrevSyncLock
```

**Méthodes à déplacer** : `_renderSegmentationPanel`, `_populateSegDocList`, `_buildSegDocListHtml`, `_loadSegRightPanel`, `_setSegMode`, `_bindLongtextScrollSync`, `_unbindLongtextScrollSync`, `_bindSegPreviewScrollSync`, `_unbindSegPreviewScrollSync`, `_syncLongtextSelectors`, `_renderMinimap`, `_setupMmZone`, `_renderSegBatchOverview`, `_renderSegPreview`, `_runSegment`, `_validateSegDoc`, `_refreshSegmentationStatusUI`, `_toggleSegFocusMode`, `_currentSegDocSelection`.

**Interface publique de `SegmentationView`**

```ts
export class SegmentationView {
  constructor(
    getConn: () => Conn | null,
    getDocs: () => DocumentRecord[],
    callbacks: {
      log: (msg: string, isError?: boolean) => void;
      toast: (msg: string, isError?: boolean) => void;
      setBusy: (v: boolean) => void;
      jobCenter: () => JobCenter | null;
      onOpenExporter: (prefill?: ExportWorkflowPrefill) => void;
    }
  ) {}

  render(): HTMLElement;
  dispose(): void;
  setConn(conn: Conn | null): void;
  onDocsUpdated(docs: DocumentRecord[]): void;
}
```

**Points d'attention**
- `_refreshSegmentationStatusUI()` utilise des `document.querySelector` globaux — scoper au container (→ A-3 en prérequis recommandé).
- Le mode Grand texte a des scroll listeners à nettoyer dans `dispose()`.
- Constantes `LS_WF_RUN_ID`, `LS_WF_STEP`, `LS_SEG_POST_VALIDATE` → fichier `constants.ts` partagé si besoin.

**Critères d'acceptance**
- [ ] Les 3 modes (unités, traduction, grand texte) fonctionnent identiquement.
- [ ] Minimap, scroll sync, preview live, markers detection inchangés.
- [ ] `dispose()` nettoie `_segPreviewTimer`, listeners scroll, minimap cleanups.

---

### B-3 — Extraire `AnnotationView` depuis `ActionsScreen`

**Priorité :** Moyenne | **Effort :** M (4–5 h)
**Fichiers :** `tauri-prep/src/screens/ActionsScreen.ts` → nouveau `tauri-prep/src/screens/AnnotationView.ts`

**Périmètre** (section L9693–10519 + CSS inline `ANNOT_PANEL_CSS`)

**Champs à déplacer** : `_annotDocId`, `_annotTokens`, `_annotSelectedTokenId`, `_annotPollHandle`, `_annotPanelEl`, `_annotModelOverride`, `_annotSearchQuery`, `_annotSearchCursor`, et tous les champs `_annot*`.

**Méthodes à déplacer** : `_renderAnnoterPanel`, `_annotRenderInterlinear`, `_annotRenderEditor`, `_annotLoadDocs`, `_annotRunJob`, `_annotStopPoll`, `_annotSearch`, `annotFocusDoc` (méthode publique — navigation depuis Recherche).

**Interface publique de `AnnotationView`**

```ts
export class AnnotationView {
  constructor(getConn: () => Conn | null, getDocs: () => DocumentRecord[], callbacks: ...) {}

  render(): HTMLElement;
  dispose(): void;
  setConn(conn: Conn | null): void;
  /** Navigation depuis Recherche (sessionStorage:agrafes:prep-token-nav) */
  focusDoc(docId: number, tokenId?: number): void;
}
```

**CSS inline à extraire**
- `ANNOT_PANEL_CSS` → `tauri-prep/src/ui/annotation.css` importé via Vite.

**Points d'attention**
- `annotFocusDoc()` est appelé depuis `app.ts` → devient `this._annotationView.focusDoc(...)`.
- `_annotStopPoll()` doit être appelé dans `dispose()`.

**Critères d'acceptance**
- [ ] Vue interlinéaire, recherche token, éditeur, launch spaCy inchangés.
- [ ] `dispose()` arrête le poll annotation.
- [ ] CSS extrait dans `annotation.css`, aucun CSS inline résiduel.

---

### B-4 — Consolider l'implémentation alignement (AlignPanel + legacy)

**Priorité :** Haute | **Effort :** L (6–8 h)
**Fichiers :** `tauri-prep/src/screens/ActionsScreen.ts`, `tauri-prep/src/screens/AlignPanel.ts`

**Contexte**
`_renderAlignementPanel()` (L2711) contient deux blocs coexistants : le nouveau `AlignPanel` (2-col, confirmation inline, famille/manuel) ET des sections legacy maintenues (qualité L2760, collisions L2795, rapport). Les sélects `#act-quality-pivot`, `#act-quality-target` apparaissent **deux fois** dans le DOM (L2765 et L3120), synchronisés après coup par `_refreshQualityCollisionSelects()`.

**Travail à faire**

1. **Intégrer qualité et collisions dans `AlignPanel`** : ajouter deux sections collapsibles en bas du panneau droit. Déplacer `_runAlignQuality()`, `_renderQualityResult()`, `_loadCollisionsPage()`, `_renderCollisionTable()` dans `AlignPanel`.
2. **Supprimer la section legacy** dans `_renderAlignementPanel()` : retirer les `<section id="act-quality-card">` et `<section id="act-collision-card">` du HTML inline.
3. **Supprimer `_refreshQualityCollisionSelects()`** et ses 4 sélects dupliqués.
4. **Câbler `onRunDone`** (déjà défini dans `AlignPanelCallbacks`) pour que AlignPanel mette à jour ses propres sélects.
5. **Champs à supprimer d'`ActionsScreen`** : `_auditPivotId`, `_auditTargetId`, `_auditOffset`, `_auditLimit`, `_auditHasMore`, `_auditLoading`, `_auditLinks`, `_collOffset`, `_collLimit`, `_collGroups`, `_collHasMore`, `_collTotalCount`, `_alignExplainability`, `_alignRunId`, `_alignRunsCompareCache`, `_auditViewMode`, `_auditExceptionsOnly`, `_auditQuickFilter`, `_auditTextFilter`, `_auditSelectedLinkId`.
6. **Conserver la section workflow** (L2872) en l'état pour l'instant (→ voir ticket C-3 si un ticket dédié est nécessaire).

**Critères d'acceptance**
- [ ] `_renderAlignementPanel()` délègue entièrement à `AlignPanel` et fait < 50 lignes.
- [ ] Qualité, collisions, audit, retarget, batch fonctionnent identiquement.
- [ ] `_refreshQualityCollisionSelects()` supprimé.
- [ ] Aucun sélect dupliqué dans le DOM alignement.

---

## Sprint C — Tests

> C-1 dépend de B-1. C-2 et C-3 sont indépendants.

---

### C-1 — Tests Vitest : logique pure de curation (fingerprints, persistence)

**Priorité :** Haute | **Effort :** M (4–6 h)
**Prérequis :** B-1
**Fichier :** nouveau `tauri-prep/src/screens/__tests__/CurationView.test.ts`

**Setup**
```bash
cd tauri-prep && npm install --save-dev vitest @vitest/ui jsdom
```
Ajouter dans `vite.config.ts` (ou `vitest.config.ts`) : `test: { environment: "jsdom" }`.

**Cas de test**

**C-1a — `_rulesSignature(rules)`**
- [ ] Même règles, même ordre → même hash
- [ ] Même règles, ordre différent → même hash (signature canonique/triée)
- [ ] Règles différentes → hash différent
- [ ] Règles vides → hash stable, non-vide

**C-1b — `_sampleFingerprint(examples)`**
- [ ] Même examples → même fingerprint
- [ ] Un example en moins → fingerprint différent
- [ ] `matched_rule_ids` différents → fingerprint différent
- [ ] `unit_id` manquant (undefined) → ignoré proprement

**C-1c — `_sampleTextFingerprint(examples)`**
- [ ] Même `before` → même fingerprint
- [ ] Modification après position 64 → **même** fingerprint (borne intentionnelle)
- [ ] Modification avant position 64 → fingerprint différent
- [ ] Whitespace normalisé : `"a  b"` et `"a b"` → **même** fingerprint
- [ ] `unit_id` manquant → ignoré proprement

**C-1d — `_loadCurateReviewState` / `_saveCurateReviewState`**
- [ ] Round-trip v5 : save → load → mêmes statuses et overrides
- [ ] Signature différente → `null` retourné
- [ ] JSON malformé dans localStorage → `null` sans throw
- [ ] Statuses tous "pending" → key supprimée (pas écrite)
- [ ] Version inconnue (v99) → `null`

**C-1e — `_restoreCurateReviewState`**
- [ ] État v5 compatible → N statuts restaurés, `_curateRestoredCount === N`
- [ ] Structural fingerprint différent → refuse, `_curateRestoredCount === 0`
- [ ] Text fingerprint différent → refuse
- [ ] État v3 (pas de text fingerprint) → restaure avec warning (mode dégradé)
- [ ] État v1 → restaure sans fingerprint check

**Critères d'acceptance**
- [ ] `npx vitest run` passe, coverage > 90 % sur les fonctions ciblées.
- [ ] Tests < 1 s total, aucun appel réseau.

---

### C-2 — Tests Vitest : normalisation d'import et parsing CoNLL-U

**Priorité :** Moyenne | **Effort :** S (2–3 h)
**Fichier :** nouveau `tauri-prep/src/screens/__tests__/ImportScreen.test.ts`

**C-2a — `normalizeImportPath(path)`**
- [ ] Séparateurs `\` → `/`
- [ ] Préfixe long `\\?\C:\` normalisé
- [ ] Casse lower
- [ ] Trailing slash supprimé
- [ ] Idempotent (double application stable)

**C-2b — `modeOptionsForExt(ext)`**
- [ ] `.docx` → 2 options (paragraphes + lignes numérotées)
- [ ] `.odt` → 2 options
- [ ] `.txt` → 1 option
- [ ] `.conllu` / `.conll` → 1 option CoNLL-U
- [ ] `.xml` / `.tei` → 1 option TEI
- [ ] Extension inconnue → toutes les options
- [ ] Casse insensible (`.DOCX` → même résultat que `.docx`)

**C-2c — `parseConlluPreview(text, maxRows)`**
- [ ] Fichier CoNLL-U valide → bon comptage tokens/sentences
- [ ] Ligne malformée (≠ 10 colonnes) → incrémente `malformedLines`, pas de crash
- [ ] Token range (`1-2`) → incrémente `skippedRanges`
- [ ] Empty node (`1.1`) → incrémente `skippedEmptyNodes`
- [ ] `maxRows` respecté exactement
- [ ] Fichier vide → 0 tokens, 0 sentences

**Critères d'acceptance**
- [ ] Tous les cas passent.
- [ ] Fonctions exportées en named exports pour être testables.

---

### C-3 — Tests Vitest : diff LCS + extraction dans `diff.ts`

**Priorité :** Basse | **Effort :** S (2–3 h)
**Fichier :** nouveau `tauri-prep/src/lib/diff.ts` + `tauri-prep/src/lib/__tests__/diff.test.ts`

**Extraction préalable** : déplacer `_escHtml`, `_renderSpecialChars`, `_highlightChanges`, `_highlightChangesWordLevel` depuis la fin d'`ActionsScreen.ts` (L10520+) vers `tauri-prep/src/lib/diff.ts` en exports nommés. Les importer depuis `ActionsScreen` / `CurationView`.

**C-3a — `escHtml(s)`**
- [ ] `&`, `<`, `>`, `"` correctement échappés
- [ ] Chaîne sans caractère spécial → inchangée

**C-3b — `renderSpecialChars(s)`**
- [ ] `\u00A0` → span `title="espace insécable"`
- [ ] `\u202F` → span `title="espace fine"`
- [ ] `\t` → span `→`
- [ ] Texte normal → inchangé

**C-3c — `highlightChanges(before, after)`**
- [ ] Identique → pas de `<del>` ni `<mark>`
- [ ] Insertion pure → `<mark class="diff-char-ins">`
- [ ] Suppression pure → `<del class="diff-char-del">`
- [ ] Chaîne > 600 chars → bascule word-level sans plantage
- [ ] Caractères Unicode multi-byte (émojis) → pas de corruption (split `[...]`)

**C-3d — `highlightChangesWordLevel(before, after)`**
- [ ] Mot remplacé → `<del>` + `<mark>`
- [ ] Match case-insensitive → pas de diff sur casse seule

**Critères d'acceptance**
- [ ] Fonctions importées depuis `CurationView` (pas de break fonctionnel).
- [ ] Aucune régression visible dans la diff UI curation.

---

## Sprint D — Persistance et données

> Indépendant des autres sprints.

---

### D-1 — Persister les Presets projet en base de données

**Priorité :** Moyenne | **Effort :** M (4–6 h)
**Fichiers :** `tauri-prep/src/app.ts`, `tauri-prep/src/lib/sidecarClient.ts`, `src/multicorpus_engine/sidecar.py`

**Contexte**
Les presets (config bilingue réutilisable) sont stockés en `localStorage` (`agrafes.prep.presets`). Ils sont perdus si l'utilisateur change de machine, réinstalle l'app, ou ouvre une DB différente.

**Schéma de stockage**
Champ `presets` dans le JSON de la table `corpus_info` (migration 009) :
```json
{
  "title": "...",
  "description": "...",
  "presets": [{ "id": "...", "name": "...", ... }]
}
```

**Travail à faire**

1. **Sidecar** (`sidecar.py`) — vérifier que `POST /corpus/info` passe le champ `presets` sans filtrage. Si le handler filtre les clés inconnues, l'étendre pour accepter le payload complet.
2. **`sidecarClient.ts`** — étendre l'interface `CorpusInfo` :
   ```ts
   export interface CorpusInfo {
     title?: string;
     description?: string;
     presets?: ProjectPreset[];
     [key: string]: unknown;
   }
   ```
3. **`app.ts`** — modifier `_loadPresets()` / `_savePresets()` :
   - `_loadPresets()` : charger depuis `getCorpusInfo()` si DB ouverte, sinon fallback localStorage.
   - `_savePresets()` : persister via `updateCorpusInfo({ presets })` + double-write localStorage (résilience offline).
   - À l'ouverture d'une DB : recharger les presets et merger (DB gagne sur conflit d'ID).
4. **Modal Presets** : ajouter un indicateur `💾 DB` vs `🖥 Local` pour informer l'utilisateur du lieu de stockage de chaque preset.

**Critères d'acceptance**
- [ ] Créer un preset dans la DB A, ouvrir la DB A sur une autre session → preset visible.
- [ ] Ouvrir la DB B → presets de B, pas de A.
- [ ] Sans DB ouverte → presets locaux uniquement, aucune erreur.
- [ ] Les presets seed (`default-fr-en`, `default-de-fr`) ne sont pas réécrasés si des presets DB existent.

---

### D-2 — Preview CoNLL-U via sidecar

**Priorité :** Basse | **Effort :** M (3–5 h)
**Fichiers :** `tauri-prep/src/screens/ImportScreen.ts`, `src/multicorpus_engine/sidecar.py`, `tauri-prep/src/lib/sidecarClient.ts`

**Contexte**
La preview CoNLL-U est parsée en JS côté client (ImportScreen.ts L87–152). Elle peut diverger de l'importeur Python sur les lignes malformées, les ranges multi-word, les empty nodes, et l'encodage.

**Endpoint à créer** : `POST /import/preview` (no-write)
```
body : { path: str, mode: str, limit: int = 100 }
retour : {
  ok: bool, mode: str,
  preview: [{ n: int, text: str }],       // DOCX / TXT / TEI
  conllu_stats: {                          // mode conllu uniquement
    sentences: int, tokens: int,
    skipped_ranges: int, skipped_empty_nodes: int, malformed_lines: int,
    sample_rows: [{ sent: int, id: str, form: str, lemma: str, upos: str }]
  }
}
```

**Travail à faire**

1. **Sidecar** : implémenter le handler en réutilisant le code de l'importeur CoNLL-U sans écrire en base.
2. **`sidecarClient.ts`** : ajouter `previewImport(conn, options): Promise<ImportPreviewResponse>`.
3. **`ImportScreen.ts`** : remplacer `parseConlluPreview()` par un appel à `previewImport()` si sidecar disponible. Garder le parsing JS comme fallback (sidecar non démarré au moment de l'ajout du fichier).
4. **Contrat OpenAPI** : relancer `python scripts/export_openapi.py` et mettre à jour `docs/SIDECAR_API_CONTRACT.md`.

**Critères d'acceptance**
- [ ] La preview affiche les mêmes statistiques que l'import réel pour un fichier CoNLL-U de référence.
- [ ] Fallback JS sans erreur visible si sidecar absent.
- [ ] Snapshot OpenAPI mis à jour.
- [ ] Test Python `tests/test_sidecar_*.py` couvrant le nouvel endpoint.

---

## Sprint F — Conventions (gestion UI + moteur)

> Indépendant des autres sprints. Prérequis fonctionnel pour l'usage réel des rôles de convention.

---

### F-1 — Interface de gestion des conventions (créer / supprimer)

**Priorité :** Haute | **Effort :** M (3–5 h)
**Fichiers :** `tauri-prep/src/screens/ActionsScreen.ts`, `tauri-prep/src/ui/app.css`

**Contexte**
Les endpoints `POST /conventions` (créer) et `POST /conventions/delete` (supprimer) sont implémentés côté sidecar. Cependant, aucun panneau UI n'existe pour les gérer. L'utilisateur ne peut pas créer ou supprimer de rôles de convention depuis l'application. La feature est incomplète sans ce panneau.

**Travail à faire**

1. Ajouter une section collapsible "Conventions" dans le panneau Curation (ou dans un onglet dédié), affichant la liste des conventions existantes sous forme de lignes éditables.
2. Chaque ligne : badge coloré · label · nom · bouton Supprimer.
3. Formulaire d'ajout en bas : champs `nom`, `label`, `couleur` (color picker ou input `#xxxxxx`), bouton Ajouter.
4. Les actions Ajouter/Supprimer appellent `POST /conventions` et `POST /conventions/delete`, puis rechargent `_conventions` et re-rendent le panneau.
5. Suppression : afficher un banner inline de confirmation indiquant que les unités assignées perdront ce rôle (ON DELETE SET NULL).

**Interface sidecarClient.ts à ajouter**
```ts
export async function createConvention(conn, options: { name, label, color?, icon?, sort_order? }): Promise<ConventionRole>
export async function deleteConvention(conn, name: string): Promise<{ deleted: string }>
```

**Critères d'acceptance**
- [ ] Créer une convention → apparaît immédiatement dans la barre de rôle du raw pane.
- [ ] Supprimer une convention → confirmation inline → disparaît de la liste et des badges.
- [ ] Formulaire invalide (nom vide, couleur malformée) → erreur inline, pas d'appel API.
- [ ] Conventions triées par `sort_order` puis `role_id`.

---

### F-2 — Modifier label, couleur, icône d'une convention (UPDATE)

**Priorité :** Moyenne | **Effort :** M (3–4 h)
**Fichiers :** `src/multicorpus_engine/sidecar.py`, `tauri-prep/src/lib/sidecarClient.ts`, `tauri-prep/src/screens/ActionsScreen.ts`

**Contexte**
Il n'existe pas d'endpoint UPDATE pour les conventions. Le nom étant la clé FK, seuls le label, la couleur et l'icône peuvent être modifiés sans migration. La couleur et le label sont les propriétés les plus utiles à ajuster.

**Travail à faire**

1. **Sidecar** : ajouter `POST /conventions/update` (ou `PUT /conventions/{name}`) :
   ```
   body: { name, label?, color?, icon?, sort_order? }
   retour: { ok, convention: ConventionRole }
   ```
   `name` est la clé de lookup (non modifiable). Valider que la convention existe.

2. **`sidecarClient.ts`** : ajouter `updateConvention(conn, name, patch): Promise<ConventionRole>`.

3. **UI** (→ F-1) : rendre les champs `label` et `color` de chaque ligne de convention éditables en double-clic. Sauvegarder à la perte de focus (blur) ou sur Entrée. Mettre à jour `_conventions` localement + re-rendre les badges dans le raw pane.

4. **Contrat OpenAPI** : `python scripts/export_openapi.py` après ajout de l'endpoint.

**Critères d'acceptance**
- [ ] Modifier le label d'un rôle → badge mis à jour dans le raw pane sans rechargement complet.
- [ ] Modifier la couleur → badge et raw pane reflètent la nouvelle couleur.
- [ ] Snapshot OpenAPI mis à jour, test de non-régression contractuel.
- [ ] `POST /conventions/update` avec `name` inexistant → 404.

---

## Sprint E — CSS et accessibilité

> Indépendant des autres sprints.

---

### E-1 — Namespacing CSS : préfixer les classes de `app.css`

**Priorité :** Moyenne | **Effort :** L (6–8 h)
> ⚠ Réévalué de Basse → Moyenne : des classes non préfixées (`.card`, `.btn-row`, `.raw-*`) sont actives dans le contexte Shell et peuvent entrer en collision avec d'autres modules dès maintenant.
**Fichier :** `tauri-prep/src/ui/app.css` (6 278 lignes), tous les `.ts` référençant ces classes

**Contexte**
`app.css` contient des classes globales non préfixées (`.topbar`, `.card`, `.btn`, `.chip`, `.log-pane`, etc.), à risque de collision avec les autres modules Shell. Contraste avec `.con-*` et `.conv-*` correctement scopés.

**Travail à faire**

1. **Audit des classes** :
   ```bash
   grep -oP '^\.[a-z][a-z0-9-]+' tauri-prep/src/ui/app.css | sort -u
   ```
2. **Catégoriser** :
   - Garder sans préfixe (partagées intentionnellement) : `.btn`, `.btn-sm`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.card`, `.chip`, `.hint`, `.badge-preview`, `.log-pane`, `.empty-hint`
   - Préfixer `.prep-` : `.topbar`, `.topbar-*`, `.screen`, `.acts-*`, `.seg-*`, `.curate-*`, `.annot-*`, `.align-*`, `.imp-*`, `.meta-*`, `.exp-*`, `.wf-*`
3. **Renommer** dans `app.css` et dans tous les `.ts` (innerHTML + classList).
4. **Scinder `app.css`** (optionnel, recommandé) en 4 fichiers thématiques :
   - `topbar.css` (~150 L)
   - `curation.css` (~2 000 L)
   - `segmentation.css` (~1 500 L)
   - `alignment-annotation.css` (~1 000 L)

**Critères d'acceptance**
- [ ] Aucune régression visuelle (vérification manuelle sous-vue par sous-vue).
- [ ] `grep -r "\.topbar\|\.acts-hub\|\.curate-workspace" tauri-shell/src` ne retourne rien (pas de fuite vers d'autres modules).
- [ ] Build Vite sans avertissement CSS.

---

### E-2 — Accessibilité : focus management et navigation clavier

**Priorité :** Moyenne | **Effort :** M (4–5 h)
**Fichiers :** `tauri-prep/src/screens/ActionsScreen.ts` (ou `CurationView.ts` après B-1), `tauri-prep/src/screens/ImportScreen.ts`

**Travail à faire**

1. **Focus sur banner de confirmation** : dans `showInlineConfirm()` (→ A-4), appeler `confirmBtn.focus()` après insertion dans le DOM.
2. **Restitution focus après fermeture de sous-vue** : stocker `_lastFocusedBtn` avant la transition dans `_switchSubViewDOM()`. Au retour au hub, appeler `_lastFocusedBtn?.focus()`.
3. **Navigation clavier dans la diff list curation** :
   - `ArrowDown` / `ArrowUp` sur les lignes du tableau diff → avancer/reculer `_activeDiffIdx`
   - `a` → accepter l'item courant, `i` → ignorer
   - `Tab` doit sauter aux boutons d'action (Accepter / Ignorer / Suivant)
   - Documenter les raccourcis dans un tooltip `?` ou une légende inline
4. **Rôle `grid` sur le tableau audit alignement** : ajouter `role="grid"` + `aria-rowcount`. Les lignes sélectionnées via checkbox → `aria-selected="true"`.
5. **Live region pour les toasts** : `showToast()` doit cibler un élément `role="alert"` **unique et préexistant** (créé une seule fois au render) plutôt qu'injecter un nouvel élément à chaque appel. Évite le flood des screen readers.

**Critères d'acceptance**
- [ ] Navigation complète au clavier dans la sous-vue Curation (diff list + actions sans souris).
- [ ] Focus restitué après retour au hub.
- [ ] Les banners de confirmation reçoivent le focus automatiquement.
- [ ] Audit manuel NVDA ou VoiceOver : live regions annoncées une seule fois par action.

---

## Ordre d'implémentation recommandé

```
Sprint A  (stabilisation — aucun prérequis)
  A-1  dispose() ActionsScreen          Critique  M
  A-2  dispose() AlignPanel             Haute     S
  A-3  Scoper querySelector             Haute     L
  A-4  Remplacer window.confirm         Haute     L

Sprint B  (architecture — prérequis : A-1)
  B-1  Extraire CurationView            Haute     XL   ← plus gros ticket
  B-2  Extraire SegmentationView        Haute     L    ← parallélisable avec B-1
  B-4  Consolider alignement            Haute     L    ← après B-1/B-2
  B-3  Extraire AnnotationView          Moyenne   M

Sprint C  (tests — C-1 dépend de B-1)
  C-1  Tests curation                   Haute     M
  C-2  Tests import/parsing             Moyenne   S
  C-3  Tests diff LCS                   Basse     S

Sprint D  (persistance — indépendant)
  D-1  Presets en DB                    Moyenne   M
  D-2  Preview CoNLL-U via sidecar      Basse     M

Sprint E  (CSS/a11y — indépendant)
  E-2  Focus management / clavier       Moyenne   M
  E-1  Namespacing CSS                  Moyenne   L    ← réévalué (collision Shell active)

Sprint F  (conventions — indépendant, bloquant usage réel)
  F-1  UI gestion conventions           Haute     M    ← prérequis fonctionnel
  F-2  UPDATE label/couleur convention  Moyenne   M    ← après F-1
```
