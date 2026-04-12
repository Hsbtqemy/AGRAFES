/**
 * ActionsScreen — curate / segment / align with V0.3 extensions:
 *   - Curation Preview Diff (preset selector + before/after diff table)
 *   - Align Audit UI (paginated link table after alignment run)
 */

import type {
  Conn,
  DocumentRecord,
  CurateRule,
  CuratePreviewExample,
  AlignLinkRecord,
  AlignBatchAction,
  AlignDebugPayload,
  AlignQualityResponse,
  RetargetCandidate,
  CollisionGroup,
  ExportRunReportOptions,
  RunRecord,
} from "../lib/sidecarClient.ts";
import {
  listDocuments,
  curate,
  curatePreview,
  segment,
  align,
  alignAudit,
  alignQuality,
  updateAlignLinkStatus,
  deleteAlignLink,
  retargetAlignLink,
  batchUpdateAlignLinks,
  retargetCandidates,
  listCollisions,
  resolveCollisions,
  validateMeta,
  rebuildIndex,
  enqueueJob,
  exportRunReport,
  updateDocument,
  getDocumentPreview,
  segmentPreview,
  detectMarkers,
  mergeUnits,
  splitUnit,
  type DetectMarkersResponse,
  SidecarError,
  type CurateException,
  listCurateExceptions,
  setCurateException,
  deleteCurateException,
  exportCurateExceptions,
  type ExportCurateExceptionsOptions,
  type CurateApplyEvent,
  recordApplyHistory,
  listApplyHistory,
  exportApplyHistory,
  listRuns,
  type ExportApplyHistoryOptions,
} from "../lib/sidecarClient.ts";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";
import { AlignPanel } from "./AlignPanel.ts";

// ─── Curation review persistence ──────────────────────────────────────────────

/**
 * LocalStorage structure for persisting local review statuses (Level 4A / 4B / 5A / 5B).
 *
 * Compatibility check sequence (in priority order):
 *
 *   1. rulesSignature   — HARD GATE (all versions):
 *      If the ruleset changed, the state is not loaded at all.
 *
 *   2. sampleFingerprint — HARD GATE (v3+):
 *      FNV-1a of sorted (unit_id + matched_rule_ids) for every example.
 *      Detects: membership change, rule-assignment change.
 *      Does NOT detect: text changes when membership is stable.
 *
 *   3. sampleTextFingerprint — HARD GATE (v4+):
 *      FNV-1a of sorted (unit_id + normalised_before_prefix[0..64]) for every example.
 *      Normalisation: whitespace collapsed to a single space, trimmed.
 *      Detects: meaningful text changes in the first 64 chars of any unit's "before".
 *      Does NOT detect: changes beyond position 64, trivial whitespace-only variations.
 *      Applied after the structural gate, so both must pass for a full v4 restore.
 *
 *   4. unitsTotal  — SOFT GUARD (v2+, kept for v2 backward compat):
 *      Warns but allows restore.
 *
 *   5. v1/v2/v3 degradation:
 *      States missing a fingerprint (v1/v2) or the text fingerprint (v3) degrade
 *      gracefully: restore proceeds with an explicit warning.
 *
 * Only "accepted" and "ignored" statuses are stored — "pending" is the default.
 * An empty statuses object is not written (the key is removed instead).
 *
 * Keyed by: agrafes.prep.curate.review.<docId|"all">
 */
interface StoredCurateReviewState {
  /**
   * 1 = Level 4A (rulesSignature only)
   * 2 = Level 4B (adds unitsTotal / unitsChanged)
   * 3 = Level 5A (adds sampleFingerprint / sampleSize)
   * 4 = Level 5B (adds sampleTextFingerprint)
   * 5 = Level 7A (adds overrides — manual_after per unit_id)
   */
  version: 1 | 2 | 3 | 4 | 5;
  /** numeric doc_id, or null when applied to all documents */
  docId: number | null;
  /** FNV-1a 32-bit hash of the canonical rules list (pattern|replacement|flags|description, sorted) */
  rulesSignature: string;
  /** epoch ms of last write */
  updatedAt: number;
  /**
   * units_total from the preview stats at save time (v2+).
   * Used at restore time as a soft guard against significant document-size changes.
   */
  unitsTotal?: number;
  /**
   * units_changed from the preview stats at save time (v2+).
   * Reserved for a future strong guard (currently not used as a gate).
   */
  unitsChanged?: number;
  /**
   * FNV-1a 32-bit structural fingerprint of the sample at save time (v3+).
   * Built from sorted (unit_id + sorted matched_rule_ids) per example.
   * Hard gate: if present in both saved and current state and different,
   * restore is refused.
   */
  sampleFingerprint?: string;
  /**
   * Number of examples in the preview sample at save time (v3+).
   * Used in feedback messages.
   */
  sampleSize?: number;
  /**
   * FNV-1a 32-bit textual fingerprint of the sample at save time (v4+).
   * Built from sorted (unit_id + normalised_before[0..64]) per example.
   * Normalisation: whitespace sequences collapsed to " ", trimmed.
   * Hard gate: if both saved and current have this field and they differ,
   * restore is refused.  Applied after the structural fingerprint passes.
   *
   * Detects: meaningful text changes in the first 64 chars of "before".
   * Does NOT detect: changes beyond position 64 of a unit's text, or changes
   * that are purely in whitespace (e.g. double space → single space).
   */
  sampleTextFingerprint?: string;
  /** unit_id (as string) → non-pending status */
  statuses: Record<string, "accepted" | "ignored">;
  /**
   * Manual text overrides (v5+).
   * Maps unit_id (as string) → user-supplied replacement text.
   * These are applied instead of the auto-generated "after" at apply time.
   * Only present when at least one override exists.
   */
  overrides?: Record<string, string>;
}

// ─── Level 9C / 10A — Apply result + history ──────────────────────────────────

/**
 * Alias: the canonical apply event type is defined in sidecarClient (Level 10A/10B).
 * Local session captures use the same shape; DB-loaded records additionally have `id`.
 */
type CurateApplyResult = CurateApplyEvent;

// ─── Curation presets ─────────────────────────────────────────────────────────

/** Maximum number of examples requested from the server. The server caps at 50. */
const CURATE_PREVIEW_LIMIT = 50;

const CURATE_PRESETS: Record<string, { label: string; rules: CurateRule[] }> = {
  spaces: {
    label: "Espaces",
    rules: [
      { pattern: "\\u00A0", replacement: " ", description: "Non-breaking space → espace" },
      { pattern: "[ \\t]{2,}", replacement: " ", flags: "g", description: "Espaces multiples → un seul" },
      { pattern: "^\\s+|\\s+$", replacement: "", flags: "gm", description: "Trim lignes" },
    ],
  },
  quotes: {
    label: "Apostrophes et guillemets",
    rules: [
      { pattern: "[\u2018\u2019\u02BC]", replacement: "'", description: "Apostrophes courbes → droites" },
      { pattern: "[\u201C\u201D]", replacement: '"', description: "Guillemets anglais → droits" },
      { pattern: "\u00AB\\s*", replacement: "\u00AB\u00A0", description: "Guillemet ouvrant + espace insécable" },
      { pattern: "\\s*\u00BB", replacement: "\u00A0\u00BB", description: "Espace insécable + guillemet fermant" },
    ],
  },
  punctuation_fr: {
    label: "Ponctuation française",
    rules: [
      { pattern: "[ \\t]+([!?;])", replacement: "\u202F$1", flags: "g", description: "Espace fine insécable avant ! ? ; (FR)" },
      { pattern: "[ \\t]+:(?!\\d)", replacement: "\u202F:", flags: "g", description: "Espace fine avant : hors timecodes (FR)" },
      { pattern: "\u00AB[ \\t]*", replacement: "\u00AB\u202F", flags: "g", description: "Espace fine après « (FR)" },
      { pattern: "[ \\t]*\u00BB", replacement: "\u202F\u00BB", flags: "g", description: "Espace fine avant » (FR)" },
      { pattern: "\\.{4,}", replacement: "\u2026", flags: "g", description: "Points de suspension → … (FR)" },
    ],
  },
  punctuation_en: {
    label: "Ponctuation anglaise",
    rules: [
      { pattern: "\\s+([,;:!?])", replacement: "$1", flags: "g", description: "Supprimer espace avant ponctuation (EN)" },
      { pattern: "([.!?])([A-ZÀ-Ÿ])", replacement: "$1 $2", flags: "g", description: "Espace après ponctuation terminale (EN)" },
      { pattern: "\\.{4,}", replacement: "\u2026", flags: "g", description: "Points de suspension → … (EN)" },
    ],
  },
  /** @deprecated — conservé pour compatibilité presets projets ; utiliser punctuation_en */
  punctuation: {
    label: "Ponctuation",
    rules: [
      { pattern: "\\s+([,;:!?])", replacement: "$1", flags: "g", description: "Supprimer espace avant ponctuation" },
      { pattern: "([.!?])([A-ZÀ-Ÿ])", replacement: "$1 $2", flags: "g", description: "Espace après ponctuation terminale" },
      { pattern: "\\.{4,}", replacement: "\u2026", flags: "g", description: "Points de suspension multiples → …" },
    ],
  },
  invisibles: {
    label: "Contrôle invisibles",
    rules: [
      { pattern: "\\u200B|\\u200C|\\u200D|\\uFEFF", replacement: "", flags: "g", description: "Supprimer espaces de largeur nulle et BOM" },
      { pattern: "\\u00AD", replacement: "", flags: "g", description: "Supprimer tirets conditionnels" },
      { pattern: "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", replacement: "", flags: "g", description: "Supprimer caractères de contrôle" },
    ],
  },
  numbering: {
    label: "Numérotation [n]",
    rules: [
      { pattern: "^(\\d+)\\.\\s+", replacement: "[$1] ", flags: "m", description: "Normaliser numérotation décimale [n]" },
      { pattern: "^([ivxlcdmIVXLCDM]+)\\.\\s+", replacement: "[$1] ", flags: "m", description: "Normaliser numérotation romaine [n]" },
    ],
  },
  custom: {
    label: "Règles personnalisées",
    rules: [],
  },
};

interface AlignExplainabilityEntry {
  target_doc_id: number;
  links_created: number;
  links_skipped: number;
  debug?: AlignDebugPayload;
}

// ─── Project Presets (shared type) ───────────────────────────────────────────

export interface ProjectPreset {
  id: string;
  name: string;
  description?: string;
  languages: string[];
  pivot_language?: string;
  segmentation_lang?: string;
  segmentation_pack?: string;
  curation_preset?: string;
  alignment_strategy?: string;
  similarity_threshold?: number;
  created_at: number;
}

interface ActionsExportPrefill {
  stage?: "alignment" | "publication" | "segmentation" | "curation" | "runs" | "qa";
  product?: "aligned_table" | "tei_xml" | "tei_package" | "run_report" | "qa_report" | "readable_text";
  format?: "csv" | "tsv" | "tei_dir" | "zip" | "jsonl" | "html" | "json" | "txt" | "docx";
  docIds?: number[];
  pivotDocId?: number;
  targetDocId?: number;
  runId?: string;
  exceptionsOnly?: boolean;
  strictMode?: boolean;
}


// ─── Sub-view type ────────────────────────────────────────────────

type SubView = "hub" | "curation" | "segmentation" | "alignement" | "annoter";

// ─── Annotation token row ─────────────────────────────────────────

type _AnnotToken = {
  unit_id: number; unit_n: number; sent_id: number; position: number;
  word: string; lemma: string | null; upos: string | null; xpos: string | null;
  feats: string | null; misc: string | null; token_id: number;
};

// ─── ActionsScreen ────────────────────────────────────────────────────────────

export class ActionsScreen {
  private _conn: Conn | null = null;
  private _docs: DocumentRecord[] = [];
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;
  private _openDocumentsTab: (() => void) | null = null;
  private _openExporterTab: ((prefill?: ActionsExportPrefill) => void) | null = null;

  // Audit state
  private _auditPivotId: number | null = null;
  private _auditTargetId: number | null = null;
  private _auditOffset = 0;
  private _auditLimit = 30;
  private _auditHasMore = false;
  private _auditLoading = false;
  private _auditLinks: AlignLinkRecord[] = [];
  private _auditIncludeExplain = false;
  private _auditExceptionsOnly = false;
  private _auditQuickFilter: "all" | "review" | "rejected" | "unreviewed" = "review";
  private _auditTextFilter = "";
  private _auditSelectedLinkId: number | null = null;
  private _alignExplainability: AlignExplainabilityEntry[] = [];
  private _alignRunId: string | null = null;
  /** Runs d’alignement pour le comparateur (GET /runs?kind=align) */
  private _alignRunsCompareCache: RunRecord[] = [];

  // AlignPanel (new refactored alignment UI)
  private _alignPanel: AlignPanel | null = null;

  // Segmentation workflow state
  private _segmentPendingValidation = false;
  private _lastSegmentReport: {
    doc_id: number;
    units_input: number;
    units_output: number;
    segment_pack?: string;
    warnings?: string[];
  } | null = null;
  private _segFocusMode = false;
  /** Tracks current VO preview limit per docId for "Afficher plus" pagination */
  private _voPreviewLimitByDocId = new Map<number, number>();

  // Sprint 9 — new split segmentation panel
  /** Currently selected document in the split seg panel */
  private _selectedSegDocId: number | null = null;
  private _segMarkersDetected: DetectMarkersResponse | null = null;
  private _segSplitMode: "sentences" | "markers" = "sentences";
  /** Debounce timer for live segment preview */
  private _segPreviewTimer: ReturnType<typeof setTimeout> | null = null;

  // V1.5 — Collision state
  private _collOffset = 0;
  private _collLimit = 20;
  private _collGroups: CollisionGroup[] = [];
  private _collHasMore = false;
  private _collTotalCount = 0;

  // Workflow state
  private _wfStep = 0;
  private _wfRoot: HTMLElement | null = null;
  private static readonly LS_WF_RUN_ID = "agrafes.prep.workflow.run_id";
  private static readonly LS_WF_STEP = "agrafes.prep.workflow.step";
  private static readonly LS_SEG_POST_VALIDATE = "agrafes.prep.seg.post_validate";
  private static readonly LS_AUDIT_EXCEPTIONS_ONLY = "agrafes.prep.audit.exceptions_only";
  private static readonly LS_AUDIT_QUICK_FILTER = "agrafes.prep.audit.quick_filter";
  /** Prefix for per-document curate review state.  Suffix = docId | "all". */
  private static readonly LS_CURATE_REVIEW_PREFIX = "agrafes.prep.curate.review.";

  // Log + busy
  private _logEl!: HTMLElement;
  private _busyEl!: HTMLElement;
  private _stateEl!: HTMLElement;
  private _isBusy = false;
  private _hasPendingPreview = false;
  private _curateLog: Array<{ ts: number; kind: "preview" | "apply" | "warn"; msg: string }> = [];
  private _lastErrorMsg: string | null = null;
  private _lastAuditEmpty = false;
  private _previewDebounceHandle: number | null = null;

  // Sub-view state (hub navigation)
  private _activeSubView: SubView = "hub";
  private _root: HTMLElement | null = null;
  private _segLongTextMode = false;
  private _segMode: "units" | "traduction" | "longtext" = "units";
  private static readonly LS_ACTIVE_SUB = "agrafes.prep.actions.active";

  // Longtext scroll sync state
  private _ltSyncLock = false;
  private _onLtRawScroll: EventListener | null = null;
  private _onLtSegScroll: EventListener | null = null;
  /** Split segmentation panel: sync scroll between raw / segmented preview columns */
  private _segPrevSyncLock = false;
  private _onSegPrevRawScroll: EventListener | null = null;
  private _onSegPrevSegScroll: EventListener | null = null;
  private _ltSearchOpen = false;
  /** Cleanup fns for minimap viewport-zone scroll listeners (P19 Inc 3) */
  private _mmScrollCleanups: Array<() => void> = [];
  /**
   * Updater callbacks per minimap element for post-render zone refresh (P20 Inc 3).
   * RAF flag in _setupMmZone is sufficient for trackpad throttle (one update per frame).
   * Prefetch VO segments is already live via #act-seg-ref-doc change handler.
   */
  private _mmZoneUpdaters = new WeakMap<HTMLElement, () => void>();
  private _alignViewMode: "table" | "run" = "table";

  // ─── Curation review-locale state ────────────────────────────────────────
  /** Examples returned by the last curatePreview call (full set). */
  private _curateExamples: CuratePreviewExample[] = [];
  /** Index of the currently selected diff item in the FILTERED list (null = none). */
  private _activeDiffIdx: number | null = null;
  /** Preview display mode: both panes | raw only | diff only. */
  private _previewMode: "sidebyside" | "rawonly" | "diffonly" = "diffonly";
  /** Whether raw pane and diff pane scroll in sync. */
  private _previewSyncScroll = true;
  /** Lock pour éviter la boucle brute ↔ diff lors du scroll synchronisé curation. */
  private _curateSyncLock = false;
  private _onCurateRawScroll: EventListener | null = null;
  private _onCurateDiffScroll: EventListener | null = null;
  /**
   * Maps rule index (position in the rules array sent to the server) → human label.
   * Built by _buildRuleLabels() before each preview call.
   */
  private _curateRuleLabels: string[] = [];
  /** Rule label currently used as filter (null = show all). */
  private _activeRuleFilter: string | null = null;
  /**
   * Real count of changed units in the full document (from stats.units_changed).
   * May be > _curateExamples.length when the sample is truncated.
   * Used to display truncation notices honestly.
   */
  private _curateGlobalChanged = 0;
  /**
   * Status filter applied on top of the rule filter (null = all statuses shown).
   * Purely local; cleared on new preview.
   */
  private _activeStatusFilter: "pending" | "accepted" | "ignored" | null = null;
  /**
   * Number of review statuses restored from localStorage on the last _runPreview().
   * 0 = no restore happened (new preview or incompatible context).
   * Displayed in the session summary as a brief "N statuts restaurés" notice.
   */
  private _curateRestoredCount = 0;
  /**
   * Total number of statuses present in the saved state that was loaded.
   * May differ from _curateRestoredCount when only a subset of saved unit_ids
   * appear in the current preview sample (partial restore).
   */
  private _curateSavedCount = 0;
  /**
   * units_total from the last successful _runPreview() stats.
   * Persisted into StoredCurateReviewState so it can be compared at restore time
   * to detect documents that have changed in size since the last save.
   */
  private _curateUnitsTotal = 0;
  /**
   * Level 8C: when set, the next call to _runPreview will include force_unit_id
   * in the request payload, guaranteeing that unit's presence in examples.
   * Reset to null after each preview completes (success or failure).
   */
  private _forcedPreviewUnitId: number | null = null;
  /**
   * True while the user has opened the inline edit mode on the active item.
   * Cleared when changing active item or cancelling.
   */
  private _editingManualOverride = false;
  /**
   * Persistent exceptions loaded from the sidecar after each preview (Level 7B).
   * Maps unit_id → CurateException for the current document.
   * Populated by _loadCurateExceptions(), cleared on new preview / doc change.
   */
  private _curateExceptions: Map<number, CurateException> = new Map();

  /**
   * Extra rules added via the Find/Replace quick block (not persisted in JSON).
   * Injected last by _currentRules(); cleared when the user hits "Effacer".
   */
  private _frExtraRules: CurateRule[] = [];

  /**
   * Level 9C: Structured capture of the last successful curation apply.
   * Alias for _applyHistory[0] — kept for backward compatibility with 9B/9C.
   * Cleared on doc change or disconnect.
   */
  private _lastApplyResult: CurateApplyResult | null = null;
  /**
   * Level 10A: All successful apply events in the current session (newest first).
   * Never cleared on doc change — the history is global to the session.
   * Cleared only on disconnect (setConn).
   */
  private _applyHistory: CurateApplyEvent[] = [];

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen actions-screen";
    this._root = root;
    this._loadSubViewPref();

    const header = document.createElement("div");
    header.className = "acts-header";
    header.innerHTML = `
      <div id="act-state-banner" class="runtime-state state-info" aria-live="polite">
        En attente de connexion sidecar…
      </div>
      <button id="act-reload-docs" class="btn btn-secondary btn-sm acts-reload-btn">↻ Rafraîchir docs</button>
    `;
    root.appendChild(header);
    this._stateEl = root.querySelector("#act-state-banner")!;
    root.querySelector("#act-reload-docs")!.addEventListener("click", () => this._loadDocs());

    const panelSlot = document.createElement("div");
    panelSlot.className = "acts-panel-slot";

    const hubPanel = this._renderHubPanel(root);
    hubPanel.dataset.panel = "hub";
    hubPanel.style.display = this._activeSubView === "hub" ? "" : "none";

    const curationPanel = this._renderCurationPanel(root);
    curationPanel.dataset.panel = "curation";
    curationPanel.style.display = this._activeSubView === "curation" ? "" : "none";
    this._prependBackBtn(curationPanel, root);

    const segPanel = this._renderSegmentationPanel(root);
    segPanel.dataset.panel = "segmentation";
    segPanel.style.display = this._activeSubView === "segmentation" ? "" : "none";
    this._prependBackBtn(segPanel, root);

    const alignPanel = this._renderAlignementPanel(root);
    alignPanel.dataset.panel = "alignement";
    alignPanel.style.display = this._activeSubView === "alignement" ? "" : "none";
    this._prependBackBtn(alignPanel, root);

    const annoterPanel = this._renderAnnoterPanel(root);
    annoterPanel.dataset.panel = "annoter";
    annoterPanel.style.display = this._activeSubView === "annoter" ? "" : "none";
    this._prependBackBtn(annoterPanel, root);

    panelSlot.appendChild(hubPanel);
    panelSlot.appendChild(curationPanel);
    panelSlot.appendChild(segPanel);
    panelSlot.appendChild(alignPanel);
    panelSlot.appendChild(annoterPanel);
    root.appendChild(panelSlot);

    const logSection = document.createElement("section");
    logSection.className = "card";
    logSection.setAttribute("data-collapsible", "true");
    logSection.setAttribute("data-collapsed-default", "true");
    logSection.innerHTML = `<h3>Journal</h3><div id="act-log" class="log-pane"></div>`;
    root.appendChild(logSection);

    const busyOverlay = document.createElement("div");
    busyOverlay.id = "act-busy";
    busyOverlay.className = "busy-overlay";
    busyOverlay.style.display = "none";
    busyOverlay.innerHTML = `<div class="busy-spinner">⏳ Opération en cours…</div>`;
    root.appendChild(busyOverlay);

    this._logEl = root.querySelector("#act-log")!;
    this._busyEl = root.querySelector("#act-busy")!;

    this._wfRoot = root;
    this._initWorkflow(root);
    initCardAccordions(root);
    this._refreshSegmentationStatusUI();
    this._refreshRuntimeState();
    this._setSubViewClass(root, this._activeSubView);

    this._bindCurateScrollSync();

    return root;
  }

  // ─── Sub-view management ───────────────────────────────────────────────────────────

  /** Public API: called from app.ts sidebar tree links. */
  setSubView(view: SubView): void {
    this._activeSubView = view;
    try { localStorage.setItem(ActionsScreen.LS_ACTIVE_SUB, view); } catch { /* */ }
    if (this._root) this._switchSubViewDOM(this._root, view);
  }

  private _loadSubViewPref(): void {
    try {
      const saved = localStorage.getItem(ActionsScreen.LS_ACTIVE_SUB) as SubView | null;
      if (saved === "hub" || saved === "curation" || saved === "segmentation" || saved === "alignement" || saved === "annoter") {
        this._activeSubView = saved;
      }
    } catch { /* ignore */ }
  }

  private _switchSubViewDOM(root: HTMLElement, view: SubView): void {
    this._activeSubView = view;
    try { localStorage.setItem(ActionsScreen.LS_ACTIVE_SUB, view); } catch { /* */ }
    root.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
      panel.style.display = panel.dataset.panel === view ? "" : "none";
    });
    document.querySelectorAll<HTMLElement>("[data-nav]").forEach((link) => {
      const isActive = link.dataset.nav === view;
      link.classList.toggle("active", isActive);
      if (isActive) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
    this._setSubViewClass(root, view);
  }

  private _setSubViewClass(root: HTMLElement, view: SubView): void {
    root.classList.remove("actions-sub-hub", "actions-sub-curation", "actions-sub-segmentation", "actions-sub-alignement", "actions-sub-annoter");
    root.classList.add(`actions-sub-${view}`);
    const content = root.closest<HTMLElement>(".content");
    if (content) content.classList.toggle("prep-curation-wide", view === "curation");
  }

  /** Stable class method — replaces captured closure pattern for seg mode switching. */
  private _setSegMode(mode: "units" | "traduction" | "longtext"): void {
    this._segMode = mode;
    const el = this._root?.querySelector<HTMLElement>('[data-panel="segmentation"]');
    if (!el) return;
    const modeUnits = el.querySelector<HTMLButtonElement>("#act-seg-mode-units");
    const modeTraduction = el.querySelector<HTMLButtonElement>("#act-seg-mode-traduction");
    const modeLongtext = el.querySelector<HTMLButtonElement>("#act-seg-mode-longtext");
    const normalView = el.querySelector<HTMLElement>("#act-seg-normal-view");
    const longtextView = el.querySelector<HTMLElement>("#act-seg-longtext-view");
    const traductionHint = el.querySelector<HTMLElement>("#act-seg-traduction-hint");
    const long = mode === "longtext";
    this._segLongTextMode = long;
    if (modeUnits) { modeUnits.classList.toggle("active", mode === "units"); modeUnits.setAttribute("aria-pressed", mode === "units" ? "true" : "false"); }
    if (modeTraduction) { modeTraduction.classList.toggle("active", mode === "traduction"); modeTraduction.setAttribute("aria-pressed", mode === "traduction" ? "true" : "false"); }
    if (modeLongtext) { modeLongtext.classList.toggle("active", mode === "longtext"); modeLongtext.setAttribute("aria-pressed", mode === "longtext" ? "true" : "false"); }
    if (normalView) normalView.style.display = long ? "none" : "";
    if (longtextView) longtextView.style.display = long ? "" : "none";
    if (traductionHint) traductionHint.style.display = mode === "traduction" ? "" : "none";
    if (long) {
      this._syncLongtextSelectors(el);
      this._bindLongtextScrollSync();
    } else {
      this._unbindLongtextScrollSync();
    }
  }

  private _renderHubPanel(root: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.className = "acts-hub";
    el.setAttribute("role", "main");
    el.setAttribute("aria-label", "Vue synth\u00e8se Actions");
    el.innerHTML = `
      <section class="acts-hub-head-card">
        <div class="acts-hub-head-left">
          <h2 class="acts-hub-head-title">Traitement de corpus</h2>
          <p class="acts-hub-head-desc">Curation &middot; Segmentation &middot; Alignement &mdash; pilotage des op&eacute;rations de pr&eacute;paration du corpus.</p>
        </div>
        <div class="acts-hub-head-tools">
          <button class="acts-hub-head-link acts-hub-head-link-accent" data-cta="segmentation-longtext">Sc&eacute;nario grand texte &nearr;</button>
        </div>
      </section>
      <div class="acts-hub-workspace">
        <div class="card acts-hub-wf-card">
          <div class="acts-hub-wf-top">
            <span class="acts-hub-wf-icon" aria-hidden="true">&#10002;</span>
            <span class="acts-hub-wf-step">&Eacute;tape 1</span>
          </div>
          <h3 class="acts-hub-wf-title">Curation</h3>
          <p class="acts-hub-wf-desc">Nettoyage et normalisation du texte brut. Applique des r&egrave;gles regex sur les documents sources avant segmentation.</p>
          <div class="acts-hub-wf-actions">
            <button class="acts-hub-wf-btn" data-target="curation">Ouvrir &rarr;</button>
          </div>
        </div>
        <div class="card acts-hub-wf-card">
          <div class="acts-hub-wf-top">
            <span class="acts-hub-wf-icon" aria-hidden="true">&#9889;</span>
            <span class="acts-hub-wf-step">&Eacute;tape 2</span>
          </div>
          <h3 class="acts-hub-wf-title">Segmentation</h3>
          <p class="acts-hub-wf-desc">D&eacute;coupage du corpus en unit&eacute;s traductionnelles pivot et cibles. G&eacute;n&egrave;re les segments pour l&rsquo;alignement automatique.</p>
          <div class="acts-hub-wf-actions">
            <button class="acts-hub-wf-btn" data-target="segmentation">Ouvrir &rarr;</button>
            <button class="acts-hub-wf-link" data-cta="segmentation-longtext">Grand texte &nearr;</button>
          </div>
        </div>
        <div class="card acts-hub-wf-card">
          <div class="acts-hub-wf-top">
            <span class="acts-hub-wf-icon" aria-hidden="true">&#8644;</span>
            <span class="acts-hub-wf-step">&Eacute;tape 3</span>
          </div>
          <h3 class="acts-hub-wf-title">Alignement</h3>
          <p class="acts-hub-wf-desc">Cr&eacute;ation et r&eacute;vision des liens pivot &harr; cible entre documents align&eacute;s. Inspection, retarget et r&eacute;solution de collisions.</p>
          <div class="acts-hub-wf-actions">
            <button class="acts-hub-wf-btn" data-target="alignement">Ouvrir &rarr;</button>
          </div>
        </div>
        <div class="card acts-hub-wf-card">
          <div class="acts-hub-wf-top">
            <span class="acts-hub-wf-icon" aria-hidden="true">&#9000;</span>
            <span class="acts-hub-wf-step">Optionnel</span>
          </div>
          <h3 class="acts-hub-wf-title">Annotation</h3>
          <p class="acts-hub-wf-desc">Vue interlin&eacute;aire (mot / POS / lemme) par document. Annotation spaCy automatique et correction manuelle token par token.</p>
          <div class="acts-hub-wf-actions">
            <button class="acts-hub-wf-btn" data-target="annoter">Ouvrir &rarr;</button>
          </div>
        </div>
      </div>
    `;
    // Workflow card primary buttons → navigate to sub-view
    el.querySelectorAll<HTMLButtonElement>(".acts-hub-wf-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.target as SubView;
        this._switchSubViewDOM(root, target);
      });
    });
    // CTA buttons (head accent + secondary wf links) → navigate with optional segMode
    el.querySelectorAll<HTMLButtonElement>(".acts-hub-head-link, .acts-hub-wf-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cta = btn.dataset.cta!;
        if (cta === "segmentation-longtext") {
          this._switchSubViewDOM(root, "segmentation");
          this._setSegMode("longtext");
        } else {
          this._switchSubViewDOM(root, cta as SubView);
        }
      });
    });
    return el;
  }

  private _prependBackBtn(panel: HTMLElement, root: HTMLElement): void {
    const div = document.createElement("div");
    div.className = "acts-view-back";
    div.innerHTML = `<button class="acts-view-back-btn">&#8592; Vue synth&#232;se</button>`;
    div.querySelector("button")!.addEventListener("click", () => this._switchSubViewDOM(root, "hub"));
    panel.prepend(div);
  }

  /** Wires `data-nav` head-links inside a panel (cross-view navigation). */
  private _bindHeadNavLinks(el: HTMLElement, root: HTMLElement): void {
    el.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.nav as SubView;
        if (target) this._switchSubViewDOM(root, target);
      });
    });
  }

  private _renderCurationPanel(root: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("role", "main");
    el.setAttribute("aria-label", "Vue Curation");
    el.innerHTML = `
      <section class="acts-seg-head-card acts-seg-head-card--compact" id="act-curation-head">
        <div class="acts-hub-head-left">
          <h1>Curation <span class="badge-preview">pr&#233;visualisation live</span></h1>
        </div>
        <div class="acts-hub-head-tools">
          <span class="curate-pill" id="act-curate-mode-pill">Mode &#233;dition</span>
          <button class="acts-hub-head-link acts-hub-head-link-accent" id="act-curate-lt-cta">Grand texte</button>
        </div>
      </section>
      <section class="card curate-workspace-card" id="act-curate-card">
        <div class="curate-workspace">
          <div class="curate-col curate-col-left">
            <article class="curate-inner-card">
              <div class="card-head">
                <h2>Param&#232;tres curation</h2>
                <span id="act-curate-doc-label"></span>
              </div>
              <div class="card-body">
                <label class="curate-doc-field">
                  Document :
                  <select id="act-curate-doc"><option value="">Tous les documents</option></select>
                </label>
                <div id="act-curate-ctx" class="row curate-ctx-row" aria-label="Contexte du document">
                  <div class="f curate-ctx-cell"><strong>Langue pivot</strong>fr</div>
                  <div class="f curate-ctx-cell"><strong>Pack</strong>&#8212;</div>
                  <div class="f curate-ctx-cell"><strong>Port&#233;e</strong>Document complet</div>
                  <div class="f curate-ctx-cell"><strong>Aper&#231;u live</strong>Actif</div>
                </div>
                <div class="chip-row curation-quick-rules">
                  <input id="act-rule-spaces" class="curate-rule-input" type="checkbox" checked />
                  <label class="chip curation-chip" for="act-rule-spaces">Espaces incoh&#233;rents</label>
                  <input id="act-rule-quotes" class="curate-rule-input" type="checkbox" />
                  <label class="chip curation-chip" for="act-rule-quotes">Guillemets typographiques</label>
                  <input id="act-punct-none" class="curate-rule-input" type="radio" name="curate-punct" value="" checked />
                  <label class="chip curation-chip" for="act-punct-none" title="Aucune correction de ponctuation">Punct.&#160;&#8212;</label>
                  <input id="act-punct-fr" class="curate-rule-input" type="radio" name="curate-punct" value="fr" />
                  <label class="chip curation-chip" for="act-punct-fr" title="Typographie fran&#231;aise : espace fine ins&#233;cable avant ! ? ; :, espaces autour de &#171;&#160;&#187;">Punct.&#160;FR</label>
                  <input id="act-punct-en" class="curate-rule-input" type="radio" name="curate-punct" value="en" />
                  <label class="chip curation-chip" for="act-punct-en" title="Typographie anglaise : supprimer espace avant , ; : ! ?">Punct.&#160;EN</label>
                  <input id="act-rule-invisibles" class="curate-rule-input" type="checkbox" />
                  <label class="chip curation-chip" for="act-rule-invisibles">Contr&#244;le invisibles</label>
                  <input id="act-rule-numbering" class="curate-rule-input" type="checkbox" />
                  <label class="chip curation-chip" for="act-rule-numbering">Num&#233;rotation [n]</label>
                </div>
                <div class="btns curate-primary-actions">
                  <button id="act-curate-reset-btn" class="btn">R&#233;initialiser</button>
                  <button id="act-preview-btn" class="btn alt" disabled>Pr&#233;visualiser maintenant</button>
                  <button id="act-curate-btn" class="btn pri" disabled>Appliquer curation</button>
                </div>
              </div>
            </article>
            <article class="curate-inner-card curate-stack-card">
              <details id="act-curate-advanced" class="curation-advanced">
                <summary class="card-head curate-advanced-summary">
                  <h2>Retouches avanc&#233;es</h2>
                </summary>
                <div class="card-body">
                  <div class="form-row curate-advanced-row">
                    <label>Chercher (regex)
                      <input id="act-curate-quick-pattern" type="text" placeholder="ex: \\u2019" />
                    </label>
                    <label>Remplacer
                      <input id="act-curate-quick-replacement" type="text" placeholder="ex: '" />
                    </label>
                    <label class="curate-advanced-flags">Flags
                      <input id="act-curate-quick-flags" type="text" value="g" maxlength="6" />
                    </label>
                    <div class="curate-advanced-add">
                      <button id="act-curate-add-rule-btn" class="btn btn-secondary btn-sm">+ Ajouter</button>
                    </div>
                  </div>
                  <label class="curate-json-field">R&#232;gles JSON
                    <textarea id="act-curate-rules" rows="3" placeholder='[{"pattern":"foo","replacement":"bar","flags":"gi"}]'></textarea>
                  </label>
                  <p class="hint" style="margin:0.2rem 0 0">Ajout&#233;es apr&#232;s les r&#232;gles rapides.</p>
                </div>
              </details>
            </article>
            <article class="curate-inner-card curate-stack-card" id="act-fr-card">
              <div class="card-head">
                <h2>Rechercher&#160;/ Remplacer</h2>
                <span id="act-fr-active-badge" class="fr-active-badge" style="display:none">actif</span>
              </div>
              <div class="card-body">
                <div class="fr-fields">
                  <label class="fr-field-label">
                    <span>Chercher</span>
                    <input id="act-fr-find" type="text" class="fr-input" placeholder="ex&#160;: M.&#160;" autocomplete="off" />
                  </label>
                  <label class="fr-field-label">
                    <span>Remplacer par</span>
                    <input id="act-fr-replace" type="text" class="fr-input" placeholder="(vide&#160;= supprimer)" autocomplete="off" />
                  </label>
                </div>
                <div class="chip-row fr-options-row">
                  <input id="act-fr-regex" type="checkbox" />
                  <label class="chip" for="act-fr-regex">Expression r&#233;guli&#232;re</label>
                  <input id="act-fr-nocase" type="checkbox" />
                  <label class="chip" for="act-fr-nocase">Insensible &#224; la casse</label>
                </div>
                <div class="btns fr-actions-row">
                  <button id="act-fr-count-btn" class="btn btn-sm btn-secondary">&#128269;&#160;Compter</button>
                  <button id="act-fr-apply-btn" class="btn btn-sm alt">&#9654;&#160;Pr&#233;visualiser</button>
                  <button id="act-fr-clear-btn" class="btn btn-sm" style="display:none">&#10005;&#160;Effacer</button>
                </div>
                <p id="act-fr-feedback" class="fr-feedback" style="display:none"></p>
              </div>
            </article>
            <article class="curate-inner-card curate-stack-card" id="act-curate-quick-actions">
              <div class="card-head">
                <h2>Actions rapides</h2>
                <span style="font-size:12px;color:var(--prep-muted,#4f5d6d)">s&#233;lection locale</span>
              </div>
              <div class="card-body">
                <div id="act-curate-queue" class="curate-queue">
                  <p class="empty-hint">Aucune action en attente.</p>
                </div>
                <div class="btns curate-nav-actions" role="group" aria-label="Navigation entre documents">
                  <button id="act-curate-prev-btn" type="button" class="btn btn-secondary btn-sm" disabled
                    title="Document pr&#233;c&#233;dent dans la liste"
                    aria-label="Document pr&#233;c&#233;dent dans la liste">&#8592; Doc pr&#233;c&#233;d.</button>
                  <button id="act-curate-next-btn" type="button" class="btn btn-secondary btn-sm" disabled
                    title="Document suivant dans la liste"
                    aria-label="Document suivant dans la liste">Doc suiv. &#8594;</button>
                </div>
              </div>
            </article>
          </div>
          <div class="curate-col curate-col-center">
            <article class="curate-inner-card curate-preview-card" id="act-preview-panel">
              <div class="card-head">
                <h2>Preview synchronis&#233;e</h2>
                <span id="act-preview-info" style="font-size:12px;color:var(--prep-muted,#4f5d6d)">&#8212;</span>
              </div>
              <div class="preview-controls">
                <div class="preview-mode-row chip-row">
                  <button class="preview-mode-btn active" data-preview-mode="diffonly" title="Afficher le texte cur&#233; avec les modifications en surbrillance (vue par d&#233;faut)">Cur&#233; seul</button>
                  <button class="preview-mode-btn" data-preview-mode="rawonly" title="Afficher le texte source uniquement">Brut seul</button>
                  <button class="preview-mode-btn" data-preview-mode="sidebyside" title="Afficher le brut et le cur&#233; c&#244;te &#224; c&#244;te">C&#244;te &#224; c&#244;te</button>
                  <label class="preview-sync-label" title="Synchroniser le scroll entre les deux panneaux">
                    <input id="act-sync-scroll" type="checkbox" checked />&#160;Sync scroll
                  </label>
                </div>
                <div class="preview-nav-row" role="toolbar" aria-label="Navigation entre occurrences de modification">
                  <button id="act-diff-prev" type="button" class="btn btn-sm btn-secondary" disabled
                    title="Occurrence de modification pr&#233;c&#233;dente"
                    aria-label="Occurrence de modification pr&#233;c&#233;dente">&#8592; Modif pr&#233;c&#233;d.</button>
                  <span id="act-diff-position" class="preview-nav-pos">&#8212;</span>
                  <button id="act-diff-next" type="button" class="btn btn-sm btn-secondary" disabled
                    title="Occurrence de modification suivante"
                    aria-label="Occurrence de modification suivante">Modif suiv. &#8594;</button>
                </div>
                <div id="act-curate-filter-badge" class="preview-filter-badge" style="display:none">
                  Filtre&#160;: <strong id="act-curate-filter-label"></strong><span class="filter-scope-note">&#160;&#8212;&#160;dans l&#8217;&#233;chantillon courant</span>
                  <button id="act-curate-filter-clear" class="filter-clear-btn" title="Effacer le filtre">&#215;</button>
                </div>
                <div id="act-curate-sample-info" class="curate-sample-info" style="display:none"></div>
              </div>
              <div class="preview-grid">
                <section class="pane">
                  <div class="pane-head">Texte brut (source)</div>
                  <div id="act-preview-raw" class="doc-scroll" aria-label="Texte brut">
                    <p class="empty-hint">S&#233;lectionnez un document et lancez une pr&#233;visualisation.</p>
                  </div>
                </section>
                <section class="pane">
                  <div class="pane-head">Texte cur&#233; (diff)</div>
                  <div id="act-diff-list" class="diff-list doc-scroll" aria-label="Texte cur&#233; avec diff&#233;rences">
                    <p class="empty-hint">Aucune pr&#233;visualisation.</p>
                  </div>
                </section>
                <aside id="act-curate-minimap" class="minimap" aria-label="Minimap des changements">
                  <div class="mm"></div>
                  <div class="mm"></div>
                  <div class="mm"></div>
                </aside>
              </div>
              <div class="preview-foot">
                <div id="act-preview-stats" class="preview-stats"></div>
                <div id="act-curate-action-bar" class="curate-action-bar" style="display:none">
                  <button id="act-item-accept"  class="btn btn-sm btn-action-accept"  disabled title="Marquer cette modification comme accept&#233;e">&#10003;&#160;Accepter</button>
                  <button id="act-item-ignore"  class="btn btn-sm btn-action-ignore"  disabled title="Ignorer cette modification (ne pas appliquer)">&#215;&#160;Ignorer</button>
                  <button id="act-item-pending" class="btn btn-sm btn-action-pending" disabled title="Remettre en attente de d&#233;cision">&#8635;&#160;En attente</button>
                  <span class="action-bar-sep"></span>
                  <button id="act-bulk-accept"  class="btn btn-sm btn-action-bulk" title="Accepter toutes les modifications visibles">&#10003;&#160;Tout accepter</button>
                  <button id="act-bulk-ignore"  class="btn btn-sm btn-action-bulk" title="Ignorer toutes les modifications visibles">&#215;&#160;Tout ignorer</button>
                </div>
                <div class="btn-row" style="margin-top:0.35rem">
                  <button id="act-apply-after-preview-btn" class="btn btn-warning btn-sm" style="display:none">Appliquer maintenant</button>
                  <button id="act-reindex-after-curate-btn" class="btn btn-secondary btn-sm" style="display:none">Re-indexer</button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
      <details class="curate-bottom-panel" id="act-curate-bottom-panel" open>
        <summary class="curate-bottom-summary">
          <span class="curate-bottom-title">Diagnostics &amp; journal <span class="curate-log-badge" id="act-curate-log-badge" style="display:none"></span></span>
          <span class="curate-bottom-hint">session courante</span>
        </summary>
        <div class="curate-bottom-body">
          <div class="curate-bottom-col curate-bottom-col-diag">
            <div class="curate-bottom-col-head">Diagnostics</div>
            <div id="act-curate-session-summary" class="curate-session-summary" style="display:none"></div>
            <div id="act-curate-diag" class="curate-diag-list">
              <p class="empty-hint">Lancez une pr&#233;visualisation pour voir les statistiques.</p>
            </div>
            <div id="act-curate-seg-link" style="display:none;padding:8px 0"></div>
          </div>
          <div class="curate-bottom-col curate-bottom-col-journal">
            <div class="curate-bottom-col-head">Journal de revue</div>
            <div id="act-curate-review-log" class="curate-log-list" aria-live="polite">
              <p class="empty-hint" style="padding:10px">Aucune action enregistr&#233;e.</p>
            </div>
            <div id="act-curate-context-card" class="curate-bottom-context" style="display:none" aria-label="Contexte local de la modification active">
              <div class="curate-bottom-context-head">
                Contexte local
                <span id="act-context-pos" style="font-size:11px;color:var(--prep-muted,#4f5d6d);margin-left:8px">&#8212;</span>
              </div>
              <div id="act-curate-context" class="curate-context-body"></div>
            </div>
          </div>
          <div class="curate-bottom-col curate-bottom-col-extra">
            <div id="act-review-export-card" class="curate-bottom-export" style="display:none">
              <div class="curate-bottom-col-head">Exporter le rapport</div>
              <div id="act-apply-result-note" class="apply-result-note" style="display:none"></div>
              <div class="review-export-row">
                <button class="btn btn-sm review-export-btn" id="act-review-export-json" title="Exporter en JSON structuré">JSON</button>
                <button class="btn btn-sm review-export-btn" id="act-review-export-csv" title="Exporter en CSV (une ligne par item)">CSV</button>
                <span id="act-review-export-result" class="review-export-result" style="display:none"></span>
              </div>
              <p class="hint review-export-hint">Items de l&#8217;&#233;chantillon courant, statuts et d&#233;cisions.</p>
            </div>
            <details class="exc-admin-panel" id="act-exc-admin-panel">
              <summary class="curate-bottom-details-summary">
                Exceptions persistées <span id="act-exc-admin-badge" class="exc-admin-count-badge" style="display:none">0</span>
              </summary>
              <div style="padding:6px 10px 10px">
                <div class="exc-admin-toolbar">
                  <div class="exc-admin-filters">
                    <button class="btn btn-sm exc-filter-btn exc-filter-active" data-exc-filter="all">Toutes</button>
                    <button class="btn btn-sm exc-filter-btn" data-exc-filter="ignore">Ignore</button>
                    <button class="btn btn-sm exc-filter-btn" data-exc-filter="override">Override</button>
                  </div>
                  <button class="btn btn-sm exc-admin-refresh" id="act-exc-admin-refresh" title="Actualiser la liste">&#8635;</button>
                </div>
                <div class="exc-admin-doc-filter-row">
                  <select id="act-exc-doc-filter" class="exc-doc-filter-select">
                    <option value="">Tous les documents</option>
                  </select>
                </div>
                <div class="exc-admin-export-row">
                  <span class="exc-export-label">Exporter&nbsp;:</span>
                  <button class="btn btn-sm exc-export-btn" id="act-exc-export-json" title="Exporter en JSON">JSON</button>
                  <button class="btn btn-sm exc-export-btn" id="act-exc-export-csv" title="Exporter en CSV">CSV</button>
                  <span id="act-exc-export-result" class="exc-export-result" style="display:none"></span>
                </div>
                <div id="act-exc-admin-list" class="exc-admin-list" aria-live="polite">
                  <p class="empty-hint">Ouvrez ce panneau apr&#232;s une pr&#233;visualisation.</p>
                </div>
              </div>
            </details>
            <details class="apply-hist-panel" id="act-apply-hist-panel">
              <summary class="curate-bottom-details-summary">
                Historique des apply <span id="act-apply-hist-badge" class="apply-hist-badge" style="display:none">0</span>
              </summary>
              <div style="padding:6px 10px 10px">
                <div class="apply-hist-toolbar">
                  <select id="act-apply-hist-scope" class="apply-hist-scope-select" title="Filtrer par portée">
                    <option value="">Tous</option>
                    <option value="doc">Document</option>
                    <option value="all">Corpus</option>
                  </select>
                  <button class="btn btn-sm apply-hist-refresh" id="act-apply-hist-refresh" title="Actualiser">&#8635;</button>
                  <button class="btn btn-sm apply-hist-export-btn" id="act-apply-hist-export-json" title="Exporter en JSON">JSON</button>
                  <button class="btn btn-sm apply-hist-export-btn" id="act-apply-hist-export-csv" title="Exporter en CSV">CSV</button>
                </div>
                <div id="act-apply-hist-list" class="apply-hist-list" aria-live="polite">
                  <p class="empty-hint">Ouvrez ce panneau pour charger l&#8217;historique.</p>
                </div>
                <span id="act-apply-hist-export-result" class="apply-hist-export-result" style="display:none"></span>
              </div>
            </details>
          </div>
        </div>
      </details>
      <section class="card" data-collapsible="true" data-collapsed-default="true">
        <h3>Validation m&#233;tadonn&#233;es</h3>
        <div class="form-row">
          <label>Document :
            <select id="act-meta-doc"><option value="">Tous</option></select>
          </label>
        </div>
        <div class="btn-row" style="margin-top:0.5rem">
          <button id="act-meta-btn" class="btn btn-secondary" disabled>Valider</button>
        </div>
      </section>
      <section class="card" data-collapsible="true" data-collapsed-default="true">
        <h3>Index FTS</h3>
        <div class="btn-row">
          <button id="act-index-btn" class="btn btn-secondary" disabled>Reconstruire l&#8217;index</button>
        </div>
      </section>
    `;
    ["#act-rule-spaces", "#act-rule-quotes", "#act-rule-invisibles", "#act-rule-numbering"].forEach((sel) => {
      el.querySelector(sel)!.addEventListener("change", () => this._schedulePreview(true));
    });
    // Ponctuation FR/EN : radio group
    el.querySelectorAll<HTMLInputElement>('input[name="curate-punct"]').forEach(radio => {
      radio.addEventListener("change", () => this._schedulePreview(true));
    });
    el.querySelector("#act-curate-doc")!.addEventListener("change", () => {
      // Level 9C: invalidate last apply result when switching to a different document
      // context, to avoid showing stale apply data for the wrong document.
      const newDocId = this._currentCurateDocId() ?? null;
      if (this._lastApplyResult !== null && this._lastApplyResult.doc_id !== newDocId) {
        this._lastApplyResult = null;
        this._updateApplyResultUI();
      }
      this._updateCurateCtx();
      this._schedulePreview(true);
    });
    el.querySelector("#act-curate-prev-btn")?.addEventListener("click", () => this._navigateCurateDoc(-1));
    el.querySelector("#act-curate-next-btn")?.addEventListener("click", () => this._navigateCurateDoc(1));
    // Preview mode buttons
    el.querySelectorAll<HTMLButtonElement>(".preview-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.previewMode as "sidebyside" | "rawonly" | "diffonly";
        if (mode) { this._previewMode = mode; this._applyPreviewMode(el); }
      });
    });
    // Sync-scroll toggle
    el.querySelector<HTMLInputElement>("#act-sync-scroll")?.addEventListener("change", (e) => {
      this._previewSyncScroll = (e.target as HTMLInputElement).checked;
    });
    // Diff item navigation (within preview, scoped to filtered set)
    el.querySelector("#act-diff-prev")?.addEventListener("click", () => {
      if (this._activeDiffIdx !== null && this._activeDiffIdx > 0)
        this._setActiveDiffItem(this._activeDiffIdx - 1, el);
    });
    el.querySelector("#act-diff-next")?.addEventListener("click", () => {
      const next = this._activeDiffIdx === null ? 0 : this._activeDiffIdx + 1;
      if (next < this._filteredExamples().length) this._setActiveDiffItem(next, el);
    });
    // Clear active rule filter
    el.querySelector("#act-curate-filter-clear")?.addEventListener("click", () => {
      this._setRuleFilter(null, el);
    });

    // ─── Local review actions ─────────────────────────────────────────────
    el.querySelector("#act-item-accept")?.addEventListener("click",  () => this._setItemStatus("accepted"));
    el.querySelector("#act-item-ignore")?.addEventListener("click",  () => this._setItemStatus("ignored"));
    el.querySelector("#act-item-pending")?.addEventListener("click", () => this._setItemStatus("pending"));
    el.querySelector("#act-bulk-accept")?.addEventListener("click",  () => this._bulkSetStatus("accepted"));
    el.querySelector("#act-bulk-ignore")?.addEventListener("click",  () => this._bulkSetStatus("ignored"));
    el.querySelector("#act-curate-rules")!.addEventListener("input", () => this._schedulePreview(true));
    el.querySelector("#act-curate-add-rule-btn")!.addEventListener("click", (evt) => {
      evt.preventDefault();
      this._addAdvancedCurateRule(root);
    });
    el.querySelector("#act-curate-reset-btn")?.addEventListener("click", () => {
      const ta = root.querySelector<HTMLTextAreaElement>("#act-curate-rules");
      if (ta) ta.value = "";
      this._applyCurationPreset(root, "spaces");
    });

    // ─── Rechercher / Remplacer ────────────────────────────────────────────
    const _frGetRegex = (): RegExp | null => {
      const findEl = el.querySelector<HTMLInputElement>("#act-fr-find");
      const pattern = findEl?.value.trim() ?? "";
      if (!pattern) return null;
      const isRegex  = (el.querySelector<HTMLInputElement>("#act-fr-regex"))?.checked ?? false;
      const noCase   = (el.querySelector<HTMLInputElement>("#act-fr-nocase"))?.checked ?? false;
      const flags = "g" + (noCase ? "i" : "");
      try {
        return new RegExp(isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      } catch {
        return null;
      }
    };
    const _frSetFeedback = (msg: string, ok = true) => {
      const fb = el.querySelector<HTMLElement>("#act-fr-feedback");
      if (!fb) return;
      fb.textContent = msg;
      fb.style.display = msg ? "" : "none";
      fb.style.color = ok ? "var(--color-muted, #4f5d6d)" : "#b91c1c";
    };
    const _frSetActive = (active: boolean) => {
      const badge = el.querySelector<HTMLElement>("#act-fr-active-badge");
      const clearBtn = el.querySelector<HTMLElement>("#act-fr-clear-btn");
      if (badge) badge.style.display = active ? "" : "none";
      if (clearBtn) clearBtn.style.display = active ? "" : "none";
    };

    el.querySelector("#act-fr-count-btn")?.addEventListener("click", () => {
      const re = _frGetRegex();
      const findEl = el.querySelector<HTMLInputElement>("#act-fr-find");
      if (!findEl?.value.trim()) { _frSetFeedback("Saisir un motif à chercher.", false); return; }
      if (!re) { _frSetFeedback("Expression régulière invalide.", false); return; }
      if (this._curateExamples.length === 0) {
        _frSetFeedback("Lance d'abord une prévisualisation pour compter.", false); return;
      }
      let total = 0;
      let units = 0;
      for (const ex of this._curateExamples) {
        const m = ex.before.match(re);
        if (m) { total += m.length; units++; }
      }
      const note = this._curateExamples.length < this._curateGlobalChanged
        ? ` (dans l'échantillon de ${this._curateExamples.length} unités)`
        : ` sur ${this._curateExamples.length} unité(s) analysée(s)`;
      _frSetFeedback(total > 0
        ? `${total} occurrence(s) dans ${units} unité(s)${note}.`
        : `Aucune occurrence trouvée${note}.`);
    });

    el.querySelector("#act-fr-apply-btn")?.addEventListener("click", () => {
      const findEl   = el.querySelector<HTMLInputElement>("#act-fr-find");
      const replaceEl = el.querySelector<HTMLInputElement>("#act-fr-replace");
      const isRegex  = (el.querySelector<HTMLInputElement>("#act-fr-regex"))?.checked ?? false;
      const noCase   = (el.querySelector<HTMLInputElement>("#act-fr-nocase"))?.checked ?? false;
      const pattern = findEl?.value.trim() ?? "";
      if (!pattern) { _frSetFeedback("Saisir un motif à chercher.", false); return; }
      const re = _frGetRegex();
      if (!re) { _frSetFeedback("Expression régulière invalide.", false); return; }
      const flags = "g" + (noCase ? "i" : "");
      const safePattern = isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      this._frExtraRules = [{
        pattern: safePattern,
        replacement: replaceEl?.value ?? "",
        flags,
        description: `R/R: ${pattern}`,
      }];
      _frSetActive(true);
      _frSetFeedback(`Règle R/R active — prévisualisation en cours…`);
      this._schedulePreview(true);
    });

    el.querySelector("#act-fr-clear-btn")?.addEventListener("click", () => {
      this._frExtraRules = [];
      _frSetActive(false);
      _frSetFeedback("");
      const findEl   = el.querySelector<HTMLInputElement>("#act-fr-find");
      const replaceEl = el.querySelector<HTMLInputElement>("#act-fr-replace");
      if (findEl)   findEl.value = "";
      if (replaceEl) replaceEl.value = "";
      this._schedulePreview(true);
    });
    el.querySelector("#act-preview-btn")!.addEventListener("click", () => this._runPreview());
    el.querySelector("#act-curate-btn")!.addEventListener("click", () => this._runCurate());
    el.querySelector("#act-apply-after-preview-btn")!.addEventListener("click", () => this._runCurate());
    el.querySelector("#act-reindex-after-curate-btn")!.addEventListener("click", () => this._runIndex());
    el.querySelector("#act-meta-btn")!.addEventListener("click", () => this._runValidateMeta());
    el.querySelector("#act-index-btn")!.addEventListener("click", () => this._runIndex());
    // "Scénario grand texte" CTA: switch to segmentation + longtext mode
    el.querySelector("#act-curate-lt-cta")?.addEventListener("click", () => {
      this._switchSubViewDOM(root, "segmentation");
      // Mount happens synchronously via _switchSubViewDOM, setSegMode after microtask
      queueMicrotask(() => this._setSegMode("longtext"));
    });
    // Delegation for diagnostics "Voir segmentation" link (rendered dynamically)
    el.querySelector("#act-curate-seg-link")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action='goto-seg']");
      if (btn) this._switchSubViewDOM(root, "segmentation");
    });
    this._refreshCurateHeaderState();
    this._renderCurateQuickQueue();
    initCardAccordions(el);
    this._bindHeadNavLinks(el, root);

    // ─── Exceptions admin panel (Level 8A) ───────────────────────────────────
    el.querySelector("#act-exc-admin-refresh")?.addEventListener("click", () => {
      this._loadExceptionsAdminPanel(el);
    });
    // Auto-load when user first opens the <details> panel
    el.querySelector<HTMLDetailsElement>("#act-exc-admin-panel")?.addEventListener("toggle", (e) => {
      const det = e.target as HTMLDetailsElement;
      if (det.open && this._excAdminAll.length === 0) {
        this._loadExceptionsAdminPanel(el);
      }
    });
    el.querySelectorAll<HTMLButtonElement>(".exc-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const filter = btn.dataset.excFilter as "all" | "ignore" | "override" | undefined;
        if (filter) this._setExcAdminFilter(filter, el);
      });
    });
    // Delegation for dynamic rows: delete + edit save/cancel + open-in-curation
    el.querySelector("#act-exc-admin-list")?.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-exc-unit-id]");
      if (!row) return;
      const unitId = parseInt(row.dataset.excUnitId ?? "0");
      if (!unitId) return;

      if (target.closest(".exc-row-delete")) {
        await this._excAdminDelete(unitId, el);
      } else if (target.closest(".exc-row-edit-start")) {
        this._excAdminEnterEdit(unitId, el);
      } else if (target.closest(".exc-row-edit-save")) {
        await this._excAdminSaveEdit(unitId, el);
      } else if (target.closest(".exc-row-edit-cancel")) {
        this._excAdminCancelEdit(unitId, el);
      } else if (target.closest(".exc-row-open-curation")) {
        const exc = this._excAdminAll.find(e => e.unit_id === unitId);
        if (exc) await this._excAdminOpenInCuration(exc, el);
      }
    });
    // Document filter select
    el.querySelector<HTMLSelectElement>("#act-exc-doc-filter")?.addEventListener("change", (e) => {
      const val = (e.target as HTMLSelectElement).value;
      this._excAdminDocFilter = val ? parseInt(val) : 0;
      this._renderExcAdminPanel(el);
    });

    el.querySelector("#act-exc-export-json")?.addEventListener("click", () => {
      void this._runExcAdminExport("json", el);
    });
    el.querySelector("#act-exc-export-csv")?.addEventListener("click", () => {
      void this._runExcAdminExport("csv", el);
    });

    el.querySelector("#act-review-export-json")?.addEventListener("click", () => {
      void this._runExportReviewReport("json");
    });
    el.querySelector("#act-review-export-csv")?.addEventListener("click", () => {
      void this._runExportReviewReport("csv");
    });

    el.querySelector<HTMLDetailsElement>("#act-apply-hist-panel")?.addEventListener("toggle", (e) => {
      if ((e.target as HTMLDetailsElement).open) void this._loadApplyHistoryPanel(el);
    });
    el.querySelector("#act-apply-hist-refresh")?.addEventListener("click", () => {
      void this._loadApplyHistoryPanel(el);
    });
    el.querySelector("#act-apply-hist-scope")?.addEventListener("change", () => {
      void this._loadApplyHistoryPanel(el);
    });
    el.querySelector("#act-apply-hist-export-json")?.addEventListener("click", () => {
      void this._runApplyHistoryExport("json");
    });
    el.querySelector("#act-apply-hist-export-csv")?.addEventListener("click", () => {
      void this._runApplyHistoryExport("csv");
    });

    return el;
  }

  // ── New split segmentation panel (Sprint 9) ────────────────────────────────

  /**
   * Build the segmentation panel: 2-col split (doc list | detail panel).
   * Replaces the former 3-view layout (units / traduction / longtext).
   */
  private _renderSegmentationPanel(root: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("role", "main");
    el.setAttribute("aria-label", "Vue Segmentation");
    el.className = "seg-panel-root";
    el.innerHTML = `
      <section class="acts-seg-head-card">
        <div class="acts-hub-head-left">
          <h1>Segmentation</h1>
          <p>S&#233;lectionnez un document pour voir l'aper&#231;u live et lancer la segmentation.</p>
        </div>
      </section>
      <div class="seg-split-layout">
        <div class="seg-split-list" id="act-seg-split-list">
          <div class="seg-split-list-head">
            <span class="seg-split-list-title">Documents</span>
            <input type="search" id="act-seg-list-filter" class="seg-split-list-filter"
              placeholder="Filtrer&#8230;" autocomplete="off" />
          </div>
          <div class="seg-split-list-scroll" id="act-seg-list-scroll">
            <p class="empty-hint">Chargement&#8230;</p>
          </div>
        </div>
        <div class="seg-split-right" id="act-seg-split-right">
          <div class="seg-right-empty">&#8592; S&#233;lectionnez un document</div>
        </div>
      </div>
    `;
    this._bindHeadNavLinks(el, root);

    // Filter list on input
    el.querySelector<HTMLInputElement>("#act-seg-list-filter")?.addEventListener("input", (e) => {
      const q = (e.target as HTMLInputElement).value.toLowerCase();
      el.querySelectorAll<HTMLElement>(".seg-doc-row").forEach(row => {
        const match = (row.textContent ?? "").toLowerCase().includes(q);
        row.style.display = match ? "" : "none";
      });
      el.querySelectorAll<HTMLElement>(".seg-doc-group").forEach(grp => {
        const visible = Array.from(grp.querySelectorAll<HTMLElement>(".seg-doc-row"))
          .some(r => r.style.display !== "none");
        (grp.previousElementSibling as HTMLElement | null)?.style &&
          ((grp.previousElementSibling as HTMLElement).style.display = visible ? "" : "none");
        (grp as HTMLElement).style.display = visible ? "" : "none";
      });
    });

    return el;
  }

  // ── Populate doc list (called after _loadDocs) ──────────────────────────────

  private _populateSegDocList(): void {
    const scrollEl = document.querySelector<HTMLElement>("#act-seg-list-scroll");
    if (!scrollEl) return;

    // Build family groups from doc_relations (same logic as MetadataScreen)
    const rootDocs = this._docs.filter(d =>
      !this._docs.some(other => other.doc_id !== d.doc_id &&
        (other as unknown as { children?: unknown[] }).children),
    );

    // Simpler grouping: collect docs that have relation info from _docs
    // We use title prefix matching as a heuristic; actual grouping uses listFamilies
    // For now: flat list grouped into "families" (docs with same title stem) + orphelins
    // We rely on workflow_status badge only — grouping by family requires async call,
    // so we do it async here.
    scrollEl.innerHTML = `<p class="empty-hint">Chargement des familles&#8230;</p>`;
    void this._buildSegDocListHtml().then(html => {
      if (!scrollEl.isConnected) return;
      scrollEl.innerHTML = html;
      // Wire click handlers
      scrollEl.querySelectorAll<HTMLElement>(".seg-doc-row").forEach(row => {
        row.addEventListener("click", () => {
          const docId = parseInt(row.dataset.docId ?? "", 10);
          if (!docId) return;
          scrollEl.querySelectorAll(".seg-doc-row").forEach(r => r.classList.remove("active"));
          row.classList.add("active");
          this._selectedSegDocId = docId;
          const rightEl = document.querySelector<HTMLElement>("#act-seg-split-right");
          if (rightEl) void this._loadSegRightPanel(docId, rightEl);
        });
      });
      // Restore selection if a doc was previously selected
      if (this._selectedSegDocId) {
        const prevRow = scrollEl.querySelector<HTMLElement>(
          `.seg-doc-row[data-doc-id="${this._selectedSegDocId}"]`,
        );
        prevRow?.classList.add("active");
      }
    });
  }

  private async _buildSegDocListHtml(): Promise<string> {
    const statusBadge = (d: DocumentRecord): string => {
      const s = d.workflow_status ?? "draft";
      if (s === "validated") return `<span class="seg-doc-badge seg-badge-ok">&#10003; Valid&#233;</span>`;
      if (s === "review")    return `<span class="seg-doc-badge seg-badge-warn">&#9203; En revue</span>`;
      return `<span class="seg-doc-badge seg-badge-none">Brouillon</span>`;
    };

    const docRow = (d: DocumentRecord, indent = false): string =>
      `<div class="seg-doc-row${indent ? " seg-doc-child" : ""}" data-doc-id="${d.doc_id}">
        <div class="seg-doc-row-main">
          <span class="seg-doc-title" title="${_escHtml(d.title)}">${_escHtml(d.title)}</span>
          <span class="seg-doc-lang">[${_escHtml(d.language)}]</span>
        </div>
        <div class="seg-doc-row-foot">
          <span class="seg-doc-units">${d.unit_count} unit&#233;s</span>
          ${statusBadge(d)}
        </div>
      </div>`;

    // Try to load family groupings
    let familyGroups: Array<{ root: DocumentRecord; children: DocumentRecord[] }> = [];
    const orphans: DocumentRecord[] = [];
    try {
      const { getAllDocRelations } = await import("../lib/sidecarClient.ts");
      if (this._conn) {
        const relations = await getAllDocRelations(this._conn);
        const childIds = new Set(relations.map(r => r.doc_id));
        const parentMap = new Map<number, number[]>(); // parent_id → child_ids

        for (const rel of relations) {
          if (!parentMap.has(rel.target_doc_id)) parentMap.set(rel.target_doc_id, []);
          parentMap.get(rel.target_doc_id)!.push(rel.doc_id);
        }

        for (const d of this._docs) {
          if (!childIds.has(d.doc_id) && parentMap.has(d.doc_id)) {
            // root of a family
            const children = (parentMap.get(d.doc_id) ?? [])
              .map(cid => this._docs.find(dd => dd.doc_id === cid))
              .filter(Boolean) as DocumentRecord[];
            familyGroups.push({ root: d, children });
          } else if (!childIds.has(d.doc_id) && !parentMap.has(d.doc_id)) {
            orphans.push(d);
          }
        }
      }
    } catch {
      // If relations API fails, fall back to flat list
      return this._docs.map(d => docRow(d)).join("");
    }

    let html = "";
    for (let fi = 0; fi < familyGroups.length; fi++) {
      const { root, children } = familyGroups[fi];
      html += `<div class="seg-doc-group-label">
        <span class="seg-family-pill">Famille ${fi + 1}</span>
        <span class="seg-family-root-name" title="${_escHtml(root.title)}">${_escHtml(root.title)}</span>
      </div>`;
      html += `<div class="seg-doc-group">`;
      html += docRow(root);
      for (const child of children) html += docRow(child, true);
      html += `</div>`;
    }
    if (orphans.length > 0) {
      if (familyGroups.length > 0) {
        html += `<div class="seg-doc-group-label">&#8212; Sans famille</div>`;
      } else {
        html += `<div class="seg-doc-group-label">Tous les documents</div>`;
      }
      html += `<div class="seg-doc-group">`;
      for (const d of orphans) html += docRow(d);
      html += `</div>`;
    }
    return html || `<p class="empty-hint">Aucun document.</p>`;
  }

  // ── Right panel: params + live preview + actions + saved table ──────────────

  private async _loadSegRightPanel(docId: number, rightEl: HTMLElement): Promise<void> {
    const doc = this._docs.find(d => d.doc_id === docId);
    if (!doc) { rightEl.innerHTML = `<div class="seg-right-empty">Document introuvable.</div>`; return; }

    // Reset mode state when switching document
    this._segMarkersDetected = null;
    this._segSplitMode = "sentences";

    const pack = (document.querySelector("#act-seg-pack") as HTMLSelectElement | null)?.value ?? "auto";
    const lang = (document.querySelector("#act-seg-lang") as HTMLInputElement | null)?.value.trim() || doc.language || "fr";
    const statusBadge = doc.workflow_status === "validated"
      ? `<span class="seg-state-chip seg-badge-ok">&#10003; Valid&#233;</span>`
      : doc.workflow_status === "review"
      ? `<span class="seg-state-chip seg-badge-warn">&#9203; En revue</span>`
      : `<span class="seg-state-chip seg-badge-none">Brouillon</span>`;

    const savedAlready = (doc.unit_count ?? 0) > 0 && doc.workflow_status !== "draft";

    this._unbindSegPreviewScrollSync();

    rightEl.innerHTML = `
      <div class="seg-right-root" id="act-seg-right-root">
        <div class="seg-right-header">
          <div class="seg-right-header-main">
            <h3 class="seg-right-doc-title">${_escHtml(doc.title)}</h3>
            ${statusBadge}
          </div>
          <div class="seg-right-header-meta">#${doc.doc_id} &middot; ${_escHtml(doc.language)} &middot; ${doc.unit_count} unit&#233;s</div>
        </div>
        <div class="seg-strategy-bar" role="region" aria-label="Strat&#233;gie de segmentation">
          <fieldset class="seg-strategy-fieldset">
            <legend class="seg-strategy-legend">Strat&#233;gie</legend>
            <div class="seg-strategy-options">
              <label class="seg-strategy-opt">
                <span class="seg-strategy-opt-row">
                  <input type="radio" name="act-seg-strategy" id="act-seg-strategy-sentences" value="sentences" checked />
                  <span class="seg-strategy-opt-title">Phrases</span>
                </span>
                <span class="seg-strategy-opt-desc">D&#233;coupe automatique (ponctuation + pack)</span>
              </label>
              <label class="seg-strategy-opt">
                <span class="seg-strategy-opt-row">
                  <input type="radio" name="act-seg-strategy" id="act-seg-strategy-markers" value="markers" />
                  <span class="seg-strategy-opt-title">Balises <code>[N]</code></span>
                </span>
                <span class="seg-strategy-opt-desc">D&#233;coupe sur les num&#233;ros entre crochets</span>
              </label>
            </div>
          </fieldset>
          <p id="act-seg-strategy-summary" class="seg-strategy-summary" aria-live="polite"></p>
        </div>
        <div id="act-seg-marker-banner" class="seg-marker-banner" style="display:none" aria-live="polite"></div>
        <div class="seg-params-bar" id="act-seg-params">
          <label class="seg-param-field">Langue
            <input id="act-seg-lang" type="text" value="${_escHtml(lang)}" maxlength="10"
              class="seg-param-input" placeholder="fr, en&#8230;" autocomplete="off" spellcheck="false" />
          </label>
          <label class="seg-param-field"
            title="Mode &#171; phrases &#187; uniquement : &#233;vite de couper apr&#232;s un point qui suit une abr&#233;viation (M., Dr., ann., chap., etc.). Sans effet en mode balises [N].">
            <span class="seg-param-label-text">O&#249; couper les phrases</span>
            <select id="act-seg-pack" class="seg-param-select" aria-describedby="act-seg-pack-hint">
              <option value="auto"${pack==="auto"?" selected":""}>Auto (selon la langue)</option>
              <option value="fr_strict"${pack==="fr_strict"?" selected":""}>Fran&#231;ais — liste longue d&#8217;abr&#233;viations</option>
              <option value="en_strict"${pack==="en_strict"?" selected":""}>Anglais — liste longue d&#8217;abr&#233;viations</option>
              <option value="default"${pack==="default"?" selected":""}>Liste courte (moins de protections)</option>
            </select>
            <span id="act-seg-pack-hint" class="seg-param-hint">&#201;vite les fausses coupes apr&#232;s M., Dr., ann., chap.&#8230;</span>
          </label>
          <label class="seg-param-field">Calibrer sur
            <select id="act-seg-calibrate" class="seg-param-select">
              <option value="">&#8212; aucun &#8212;</option>
              ${this._docs.filter(d => d.doc_id !== docId).map(d =>
                `<option value="${d.doc_id}">[${d.doc_id}] ${_escHtml(d.title)}</option>`
              ).join("")}
            </select>
          </label>
          <button type="button" class="btn btn-ghost btn-sm" id="act-seg-detect-btn"
            title="D&#233;tecter les balises [N] dans le texte">&#128270; D&#233;tecter balises</button>
        </div>
        <details class="seg-rule-info" id="act-seg-rule-info">
          <summary class="seg-rule-info-sum">&#9432; Moteur de d&#233;coupage</summary>
          <div class="seg-rule-info-body">
            <p>Le moteur coupe sur <code>.&nbsp;!&nbsp;?</code> suivi d&#8217;un espace puis d&#8217;une <strong>lettre majuscule</strong> (ou guillemet ouvrant).</p>
            <p>&#8594; Si vos phrases d&#233;butent par une minuscule, le moteur ne les d&#233;tectera pas comme d&#233;but de phrase.</p>
            <p>&#8594; Si chaque paragraphe du document est d&#233;j&#224; une phrase, la segmentation retourne le m&#234;me nombre d&#8217;unit&#233;s.</p>
            <p><strong>O&#249; couper les phrases :</strong> les options <em>Fran&#231;ais / Anglais — liste longue</em> ajoutent des abr&#233;viations prot&#233;g&#233;es (ann., chap., etc.) pour &#233;viter les faux d&#233;coupages apr&#232;s un point.</p>
            <p><strong>Mode balises :</strong> utilisez-le si des motifs <code>[N]</code> sont encore dans <em>le texte des unit&#233;s</em> (ex. import en paragraphes / blocs). Chaque balise devient un <code>external_id</code> pour l&#8217;alignement. Si le document a d&#233;j&#224; &#233;t&#233; import&#233; en <em>lignes num&#233;rot&#233;es [n]</em>, les IDs sont d&#233;j&#224; port&#233;s par les unit&#233;s et ce mode apporte souvent peu de diff&#233;rence.</p>
            <p><strong>Pr&#233;fixe avant <code>[1]</code> :</strong> le texte plac&#233; avant la premi&#232;re balise devient un segment distinct, avec <code>external_id = NULL</code>.</p>
          </div>
        </details>
        <div class="seg-preview-section" id="act-seg-preview-section">
          <div class="seg-preview-section-head">
            <span class="seg-preview-section-label">Aper&#231;u live <span class="seg-preview-badge" id="act-seg-mode-badge">phrases</span></span>
            <span id="act-seg-prev-stats" class="seg-preview-stats"></span>
            <button type="button" class="btn btn-ghost btn-sm" id="act-seg-prev-refresh">&#8635;</button>
          </div>
          <div class="seg-preview-split" id="act-seg-preview-split">
            <div>
              <div class="seg-preview-col-title">Brut (<span id="act-seg-prev-raw-count">&#8212;</span> unit&#233;s)</div>
              <div class="seg-preview-col-list" id="act-seg-prev-raw">
                <p class="empty-hint">Chargement&#8230;</p>
              </div>
            </div>
            <div>
              <div class="seg-preview-col-title">Segment&#233; (<span id="act-seg-prev-seg-count">&#8212;</span> phrases)</div>
              <div class="seg-preview-col-list" id="act-seg-prev-seg">
                <p class="empty-hint">En attente&#8230;</p>
              </div>
            </div>
          </div>
          <div id="act-seg-prev-warns" class="seg-warn-list" style="display:none"></div>
        </div>
        <div class="seg-actions-bar" id="act-seg-actions">
          <button class="btn btn-warning" id="act-seg-btn" title="Appliquer la segmentation (efface les liens d'alignement existants)">Appliquer</button>
          <button class="btn btn-secondary btn-sm" id="act-seg-validate-btn" title="Appliquer la segmentation puis valider le document">Appliquer + Valider</button>
          <button class="btn btn-primary btn-sm" id="act-seg-validate-only-btn"
            ${!savedAlready ? "disabled" : ""}>Valider &#10003;</button>
          <div class="seg-actions-dest">
            Apr&#232;s validation&nbsp;:
            <select id="act-seg-after-validate" class="seg-param-select seg-param-select-sm">
              <option value="next">Doc suivant</option>
              <option value="stay">Rester</option>
              <option value="documents">Documents</option>
            </select>
          </div>
        </div>
        <div id="act-seg-status-banner" class="seg-status-banner" aria-live="polite"></div>
        <div class="seg-saved-section" id="act-seg-saved-section" style="${savedAlready ? "" : "display:none"}">
          <div class="seg-saved-head">Segments enregistr&#233;s
            <span id="act-seg-saved-count" class="chip">${doc.unit_count}</span>
          </div>
          <div class="seg-saved-table-wrap" id="act-seg-saved-table">
            ${savedAlready ? `<p class="empty-hint">Chargement des segments&#8230;</p>` : ""}
          </div>
        </div>
      </div>
    `;

    // Restore after-validate pref
    const afterSel = rightEl.querySelector<HTMLSelectElement>("#act-seg-after-validate");
    if (afterSel) afterSel.value = this._postValidateDestination();
    afterSel?.addEventListener("change", () => {
      const raw = afterSel.value;
      const next = raw === "next" || raw === "stay" ? raw : "documents";
      try { localStorage.setItem(ActionsScreen.LS_SEG_POST_VALIDATE, next); } catch { /* ignore */ }
    });

    // Wire params → debounced preview
    rightEl.querySelector("#act-seg-lang")?.addEventListener("input", () => this._scheduleSegPreview(docId));
    rightEl.querySelector("#act-seg-pack")?.addEventListener("change", () => this._scheduleSegPreview(docId));
    rightEl.querySelector("#act-seg-calibrate")?.addEventListener("change", () => this._scheduleSegPreview(docId));
    rightEl.querySelector("#act-seg-prev-refresh")?.addEventListener("click", () => void this._runSegPreview(docId));

    rightEl.querySelectorAll<HTMLInputElement>('input[name="act-seg-strategy"]').forEach(r => {
      r.addEventListener("change", () => {
        if (r.value === "markers") this._activateMarkersMode(docId);
        else this._deactivateMarkersMode(docId);
      });
    });
    this._syncSegStrategyRadios();

    // Wire detect-markers button
    rightEl.querySelector("#act-seg-detect-btn")?.addEventListener("click", () => void this._runDetectMarkers(docId));

    // Wire action buttons
    rightEl.querySelector("#act-seg-btn")?.addEventListener("click", () => this._runSegment());
    rightEl.querySelector("#act-seg-validate-btn")?.addEventListener("click", () => this._runSegment(true));
    rightEl.querySelector("#act-seg-validate-only-btn")?.addEventListener("click", () => void this._runValidateCurrentSegDoc());
    rightEl.querySelector("#act-seg-open-export-btn")?.addEventListener("click", () => this._openSegmentationExportPrefill());

    // Load raw preview (left column) and trigger live preview
    void this._loadSegRawColumn(docId);
    void this._runSegPreview(docId);

    // Auto-detect markers silently (no loading indicator needed — fast endpoint)
    void this._runDetectMarkers(docId, /* silent */ true);

    this._bindSegPreviewScrollSync();

    // Load saved segments if doc already has units
    if (savedAlready) {
      const savedTableEl = rightEl.querySelector<HTMLElement>("#act-seg-saved-table");
      if (savedTableEl) void this._renderSegSavedTable(docId, savedTableEl);
    }

    this._refreshSegmentationStatusUI();
  }

  private async _loadSegRawColumn(docId: number): Promise<void> {
    const rawEl = document.querySelector<HTMLElement>("#act-seg-prev-raw");
    const countEl = document.querySelector<HTMLElement>("#act-seg-prev-raw-count");
    if (!rawEl || !this._conn) return;
    try {
      // /documents/preview accepts limit 1–500; show first 200 lines for the raw column
      const preview = await getDocumentPreview(this._conn, docId, 200);
      if (countEl) countEl.textContent = String(preview.total_lines);
      if (!preview.lines.length) {
        rawEl.innerHTML = `<p class="empty-hint">Aucune unit&#233;.</p>`;
        return;
      }
      const truncNote = preview.total_lines > 200
        ? `<p class="seg-trunc-note">Aper&#231;u — 200/${preview.total_lines} unit&#233;s (premi&#232;res lignes)</p>`
        : "";
      rawEl.innerHTML = truncNote + preview.lines.map(l =>
        `<div class="seg-prev-row"><span class="seg-prev-n">${l.n}</span><span class="seg-prev-tx">${_escHtml(l.text)}</span></div>`,
      ).join("");
    } catch (err) {
      rawEl.innerHTML = `<p class="empty-hint">Impossible de charger le texte brut : ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  private _scheduleSegPreview(docId: number): void {
    if (this._segPreviewTimer) clearTimeout(this._segPreviewTimer);
    this._segPreviewTimer = setTimeout(() => {
      this._segPreviewTimer = null;
      const rightEl = document.querySelector<HTMLElement>("#act-seg-split-right");
      if (!rightEl?.isConnected) return;
      void this._runSegPreview(docId);
    }, 400);
  }

  // ── Marker detection ─────────────────────────────────────────────────────────

  private async _runDetectMarkers(docId: number, silent = false): Promise<void> {
    if (!this._conn) return;
    const bannerEl = document.querySelector<HTMLElement>("#act-seg-marker-banner");
    const detectBtn = document.querySelector<HTMLButtonElement>("#act-seg-detect-btn");

    if (!silent && detectBtn) {
      detectBtn.disabled = true;
      detectBtn.textContent = "Détection…";
    }

    try {
      const report = await detectMarkers(this._conn, docId);
      this._segMarkersDetected = report;

      if (!bannerEl) return;

      if (report.detected) {
        const sample = report.first_markers.slice(0, 5).join(", ");
        bannerEl.style.display = "";
        bannerEl.innerHTML = `
          <span class="seg-marker-icon">&#127991;</span>
          <span class="seg-marker-info">
            <strong>Balises [N] d&#233;tect&#233;es</strong> —
            ${report.marked_units}/${report.total_units} unit&#233;s marqu&#233;es
            (ex.&nbsp;: [${sample}])
          </span>
          <button type="button" class="btn btn-sm ${this._segSplitMode === "markers" ? "btn-warning" : "btn-outline-warning"}"
            id="act-seg-mode-toggle">
            ${this._segSplitMode === "markers" ? "&#10003; Mode balises actif" : "Utiliser les balises"}
          </button>
        `;
        bannerEl.querySelector("#act-seg-mode-toggle")?.addEventListener("click", () => {
          if (this._segSplitMode === "markers") {
            this._deactivateMarkersMode(docId);
          } else {
            this._activateMarkersMode(docId);
          }
        });
        this._syncSegStrategyRadios();
      } else if (!silent) {
        bannerEl.style.display = "";
        bannerEl.innerHTML = `
          <span class="seg-marker-icon seg-marker-icon-miss">&#8416;</span>
          <span class="seg-marker-info">Aucune balise <code>[N]</code> d&#233;tect&#233;e dans ce document
          (${report.total_units} unit&#233;s analys&#233;es).</span>
        `;
        setTimeout(() => { if (bannerEl) bannerEl.style.display = "none"; }, 4000);
      }
    } catch (err) {
      if (!silent && bannerEl) {
        bannerEl.style.display = "";
        bannerEl.innerHTML = `<span style="color:var(--color-danger)">Erreur d&#233;tection : ${_escHtml(err instanceof Error ? err.message : String(err))}</span>`;
      }
    } finally {
      if (!silent && detectBtn) {
        detectBtn.disabled = false;
        detectBtn.innerHTML = "&#128270; D&#233;tecter balises";
      }
    }
  }

  private _activateMarkersMode(docId: number): void {
    this._segSplitMode = "markers";
    const badge = document.querySelector<HTMLElement>("#act-seg-mode-badge");
    if (badge) badge.textContent = "balises [N]";
    // Re-render banner toggle button as active
    void this._runDetectMarkers(docId, /* silent */ true);
    // Disable sentence-specific params
    const packField = document.querySelector<HTMLElement>(".seg-param-field:nth-child(2)");
    if (packField) packField.style.opacity = "0.4";
    this._setSegPackSelectDisabled(true);
    this._syncSegStrategyRadios();
    // Trigger preview in markers mode
    void this._runSegPreview(docId);
  }

  private _deactivateMarkersMode(docId: number): void {
    this._segSplitMode = "sentences";
    const badge = document.querySelector<HTMLElement>("#act-seg-mode-badge");
    if (badge) badge.textContent = "phrases";
    void this._runDetectMarkers(docId, /* silent */ true);
    const packField = document.querySelector<HTMLElement>(".seg-param-field:nth-child(2)");
    if (packField) packField.style.opacity = "";
    this._setSegPackSelectDisabled(false);
    this._syncSegStrategyRadios();
    void this._runSegPreview(docId);
  }

  // ── Live preview ──────────────────────────────────────────────────────────────

  private async _runSegPreview(docId: number): Promise<void> {
    if (!this._conn) return;
    const segEl = document.querySelector<HTMLElement>("#act-seg-prev-seg");
    const statsEl = document.querySelector<HTMLElement>("#act-seg-prev-stats");
    const segCountEl = document.querySelector<HTMLElement>("#act-seg-prev-seg-count");
    const warnsEl = document.querySelector<HTMLElement>("#act-seg-prev-warns");
    const segColTitle = document.querySelector<HTMLElement>("#act-seg-preview-split > div:nth-child(2) .seg-preview-col-title");
    if (!segEl) return;

    const lang = (document.querySelector("#act-seg-lang") as HTMLInputElement | null)?.value.trim() || "fr";
    const pack = (document.querySelector("#act-seg-pack") as HTMLSelectElement | null)?.value ?? "auto";
    const mode = this._segSplitMode;
    const calibrateRaw = (document.querySelector("#act-seg-calibrate") as HTMLSelectElement | null)?.value ?? "";
    const calibrateTo = mode === "sentences" && calibrateRaw ? parseInt(calibrateRaw, 10) : NaN;

    segEl.innerHTML = `<p class="empty-hint">Calcul en cours&#8230;</p>`;
    if (statsEl) statsEl.textContent = "…";
    if (segColTitle) {
      segColTitle.textContent = mode === "markers"
        ? `Balises [N] (— segments)`
        : `Segmenté (— phrases)`;
    }

    try {
      const previewPayload: {
        doc_id: number;
        mode: "sentences" | "markers";
        lang: string;
        pack: string;
        limit: number;
        calibrate_to?: number;
      } = { doc_id: docId, mode, lang, pack, limit: 300 };
      if (mode === "sentences" && Number.isInteger(calibrateTo)) {
        previewPayload.calibrate_to = calibrateTo;
      }
      const res = await segmentPreview(this._conn, previewPayload);
      if (segCountEl) segCountEl.textContent = String(res.units_output);
      const calibrateText = mode === "sentences" && Number.isInteger(res.calibrate_to) && Number.isInteger(res.calibrate_ratio_pct)
        ? ` · écart ${res.calibrate_ratio_pct}% vs doc #${res.calibrate_to}`
        : "";
      if (statsEl) {
        statsEl.textContent = mode === "markers"
          ? `${res.units_input} u. → ${res.units_output} segments par balise`
          : `${res.units_input} u. → ${res.units_output} phrases · r&#233;glage ${res.segment_pack}${calibrateText}`;
      }
      if (segColTitle) {
        segColTitle.innerHTML = mode === "markers"
          ? `Balises [N] (<span id="act-seg-prev-seg-count">${res.units_output}</span> segments)`
          : `Segment&#233; (<span id="act-seg-prev-seg-count">${res.units_output}</span> phrases)`;
      }

      const truncNote = res.units_output >= 300
        ? `<p class="seg-trunc-note">Aper&#231;u tronqu&#233; &#224; 300 segments</p>`
        : "";

      segEl.innerHTML = truncNote + (res.segments.length
        ? res.segments.map(s => {
            const hasId = s.external_id != null;
            return `<div class="seg-prev-row${hasId ? " seg-prev-row-marker" : ""}">` +
              `<span class="seg-prev-n">${hasId ? `[${s.external_id}]` : s.n}</span>` +
              `<span class="seg-prev-tx">${_escHtml(s.text)}</span></div>`;
          }).join("")
        : `<p class="empty-hint">Aucun segment produit.</p>`);

      if (warnsEl) {
        if (res.warnings.length) {
          warnsEl.style.display = "";
          warnsEl.innerHTML = res.warnings.map(w => `<div class="seg-warn">${_escHtml(w)}</div>`).join("");
        } else {
          warnsEl.style.display = "none";
        }
      }
      this._updateSegStrategySummary();
    } catch (err) {
      segEl.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur preview: ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
      this._updateSegStrategySummary();
    }
  }

  private async _renderSegSavedTable(docId: number, el: HTMLElement): Promise<void> {
    if (!this._conn) return;
    el.innerHTML = `<p class="empty-hint">Chargement&#8230;</p>`;
    try {
      const preview = await getDocumentPreview(this._conn, docId, 500);
      const countEl = document.querySelector<HTMLElement>("#act-seg-saved-count");
      if (countEl) countEl.textContent = String(preview.total_lines);
      if (!preview.lines.length) {
        el.innerHTML = `<p class="empty-hint">Aucun segment en base.</p>`;
        return;
      }

      const truncNote = preview.total_lines > 500
        ? `<p class="seg-trunc-note">Aper&#231;u — 500/${preview.total_lines} segments</p>`
        : "";

      const buildRow = (l: { n: number; text: string }, idx: number, total: number): string => {
        const lenClass = l.text.length > 200 ? " seg-cell-len-warn" : l.text.length > 120 ? " seg-cell-len-hint" : "";
        const mergeUpBtn   = idx > 0       ? `<button class="seg-action-btn seg-merge-up"   title="Fusionner avec le pr&#233;c&#233;dent" data-n="${l.n}">&#8679;</button>` : `<span class="seg-action-placeholder"></span>`;
        const mergeDownBtn = idx < total-1  ? `<button class="seg-action-btn seg-merge-down" title="Fusionner avec le suivant"     data-n="${l.n}">&#8681;</button>` : `<span class="seg-action-placeholder"></span>`;
        const splitBtn     = `<button class="seg-action-btn seg-split-btn" title="Couper ce segment" data-n="${l.n}">&#9986;</button>`;
        return `<tr data-unit-n="${l.n}">
          <td class="seg-cell-n">${l.n}</td>
          <td class="seg-cell-text" title="Double-clic pour modifier le texte">${_escHtml(l.text)}</td>
          <td class="seg-cell-len${lenClass}">${l.text.length}</td>
          <td class="seg-cell-actions">${mergeUpBtn}${mergeDownBtn}${splitBtn}</td>
        </tr>`;
      };

      const renderTable = (lines: { n: number; text: string }[]) => {
        const rows = lines.map((l, i) => buildRow(l, i, lines.length)).join("");
        return truncNote + `
          <div class="seg-saved-info">${lines.length} segment(s) &middot; double-clic pour modifier</div>
          <div class="seg-segments-scroll">
            <table class="seg-segments-table">
              <colgroup>
                <col style="width:36px">
                <col>
                <col style="width:46px">
                <col style="width:72px">
              </colgroup>
              <thead><tr><th>#</th><th>Texte</th><th>Long.</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      };

      // State: keep a local mutable copy of lines so we can optimistically update
      let lines = preview.lines.map(l => ({ n: l.n, text: l.text }));
      el.innerHTML = renderTable(lines);

      const reload = () => void this._renderSegSavedTable(docId, el);

      const wireEvents = () => {
        // ── Merge up (↑) ──────────────────────────────────────────────────────
        el.querySelectorAll<HTMLButtonElement>(".seg-merge-up").forEach(btn => {
          btn.addEventListener("click", async () => {
            const n2 = parseInt(btn.dataset.n ?? "", 10);
            const idx = lines.findIndex(l => l.n === n2);
            if (idx < 1 || !this._conn) return;
            const n1 = lines[idx - 1].n;
            btn.disabled = true;
            try {
              await mergeUnits(this._conn, { doc_id: docId, n1, n2 });
              reload();
            } catch (e) {
              btn.disabled = false;
              alert(`Erreur fusion : ${e instanceof Error ? e.message : String(e)}`);
            }
          });
        });

        // ── Merge down (↓) ────────────────────────────────────────────────────
        el.querySelectorAll<HTMLButtonElement>(".seg-merge-down").forEach(btn => {
          btn.addEventListener("click", async () => {
            const n1 = parseInt(btn.dataset.n ?? "", 10);
            const idx = lines.findIndex(l => l.n === n1);
            if (idx < 0 || idx >= lines.length - 1 || !this._conn) return;
            const n2 = lines[idx + 1].n;
            btn.disabled = true;
            try {
              await mergeUnits(this._conn, { doc_id: docId, n1, n2 });
              reload();
            } catch (e) {
              btn.disabled = false;
              alert(`Erreur fusion : ${e instanceof Error ? e.message : String(e)}`);
            }
          });
        });

        // ── Split (✂) ─────────────────────────────────────────────────────────
        el.querySelectorAll<HTMLButtonElement>(".seg-split-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            const unitN = parseInt(btn.dataset.n ?? "", 10);
            const lineData = lines.find(l => l.n === unitN);
            if (!lineData) return;
            const tr = btn.closest("tr")!;
            // Replace the row with an inline split editor
            const fullText = lineData.text;
            const midPoint = Math.ceil(fullText.length / 2);
            const lastSpace = fullText.lastIndexOf(" ", midPoint);
            const splitAt = lastSpace > 0 ? lastSpace : midPoint;

            tr.innerHTML = `
              <td colspan="4" class="seg-split-inline">
                <div class="seg-split-label">&#9986; Couper le segment ${unitN} en deux :</div>
                <div class="seg-split-fields">
                  <textarea class="seg-split-ta seg-split-ta-a" rows="2">${_escHtml(fullText.slice(0, splitAt).trim())}</textarea>
                  <div class="seg-split-divider">&#9660;</div>
                  <textarea class="seg-split-ta seg-split-ta-b" rows="2">${_escHtml(fullText.slice(splitAt).trim())}</textarea>
                </div>
                <div class="seg-split-actions">
                  <button class="btn btn-warning btn-sm seg-split-confirm">Confirmer la coupure</button>
                  <button class="btn btn-ghost btn-sm seg-split-cancel">Annuler</button>
                </div>
              </td>`;

            tr.querySelector(".seg-split-cancel")?.addEventListener("click", reload);
            tr.querySelector(".seg-split-confirm")?.addEventListener("click", async () => {
              const taA = tr.querySelector<HTMLTextAreaElement>(".seg-split-ta-a");
              const taB = tr.querySelector<HTMLTextAreaElement>(".seg-split-ta-b");
              const textA = taA?.value.trim() ?? "";
              const textB = taB?.value.trim() ?? "";
              if (!textA || !textB) {
                alert("Les deux parties doivent être non-vides.");
                return;
              }
              if (!this._conn) return;
              try {
                await splitUnit(this._conn, { doc_id: docId, unit_n: unitN, text_a: textA, text_b: textB });
                reload();
              } catch (e) {
                alert(`Erreur découpe : ${e instanceof Error ? e.message : String(e)}`);
              }
            });
          });
        });

        // ── Double-click inline text edit ──────────────────────────────────────
        el.querySelectorAll<HTMLTableCellElement>(".seg-cell-text").forEach(cell => {
          cell.addEventListener("dblclick", () => {
            if (cell.querySelector("textarea")) return;
            const tr = cell.closest("tr")!;
            const origHtml = cell.innerHTML;
            const origText = cell.textContent?.trim() ?? "";
            const ta = document.createElement("textarea");
            ta.rows = 2;
            ta.value = origText;
            ta.className = "seg-cell-edit-input";
            cell.innerHTML = "";
            cell.appendChild(ta);
            ta.focus(); ta.select();

            const cancelEdit = () => { cell.innerHTML = origHtml; };
            const commit = () => {
              const newText = ta.value.trim();
              if (!newText || newText === origText) { cancelEdit(); return; }
              // Optimistic update: reflect immediately
              cell.innerHTML = _escHtml(newText);
              const lenCell = cell.nextElementSibling as HTMLElement | null;
              if (lenCell && !lenCell.classList.contains("seg-cell-actions")) {
                lenCell.textContent = String(newText.length);
              }
              const unitN = parseInt(tr.dataset.unitN ?? "", 10);
              if (unitN) lines = lines.map(l => l.n === unitN ? { ...l, text: newText } : l);
            };
            ta.addEventListener("keydown", (e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
            });
            ta.addEventListener("blur", () => setTimeout(commit, 80));
          });
        });
      };

      wireEvents();
      lines = preview.lines.map(l => ({ n: l.n, text: l.text }));
    } catch (err) {
      el.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur: ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  // ── Legacy segmentation panel (kept for fallback, now replaced) ─────────────
  // The old _renderSegmentationPanel_LEGACY content below is removed.
  // If any of the following private helpers are still referenced they are kept;
  // otherwise they can be removed in a later cleanup pass.
  // ───────────────────────────────────────────────────────────────────────────

  private _renderSegmentationPanel_STUB(root: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("role", "main");
    el.setAttribute("aria-label", "Vue Segmentation");
    el.innerHTML = `
      <section class="acts-seg-head-card">
        <div class="acts-hub-head-left">
          <h1>Segmentation</h1>
          <p>D&#233;coupez le corpus en unit&#233;s traductionnelles. S&#233;lectionnez le mode adapt&#233; au type de document.</p>
        </div>
        <div class="acts-hub-head-tools">
          <span class="curate-pill">workflow recommand&#233; avant alignement</span>
          <button class="acts-hub-head-link" data-nav="curation">Voir Curation</button>
          <button class="acts-hub-head-link" data-nav="alignement">Voir Alignement</button>
          <button class="acts-hub-head-link" id="act-seg-head-longtext">Sc&#233;nario grand texte</button>
        </div>
      </section>
      <div id="act-seg-longtext-hint" class="acts-longtext-hint" style="display:none" role="status">
        <span>Ce document est long (&gt;12&#8239;000 caract&#232;res) &#8212; le mode <strong>document complet</strong> est recommand&#233;.</span>
        <button id="act-seg-switch-longtext" class="btn btn-sm btn-secondary">Basculer</button>
      </div>
      <div class="acts-seg-mode-bar">
        <span class="acts-seg-mode-label">Mode&#160;:</span>
        <div class="acts-seg-mode-pills">
          <button id="act-seg-mode-units" class="acts-seg-mode-btn active" aria-pressed="true">Unit&#233;s</button>
          <button id="act-seg-mode-traduction" class="acts-seg-mode-btn" aria-pressed="false">Traduction</button>
          <button id="act-seg-mode-longtext" class="acts-seg-mode-btn" aria-pressed="false">Document complet</button>
        </div>
      </div>
      <div id="act-seg-normal-view">
        <div id="act-seg-traduction-hint" class="seg-traduction-panel" style="display:none">
          <div class="seg-traduction-workspace">
            <!-- Colonne gauche : bandeau + ref VO collapsible -->
            <div class="seg-traduction-left">
              <div class="seg-traduction-bandeau">
                <span class="seg-mode-pill">Mode Traduction</span>
                <p>S&#233;lectionnez un document de type <strong>traduction</strong> pour segmenter la version cible. La r&#233;f&#233;rence VO ci-dessous permet de comparer les segments source.</p>
              </div>
              <details class="seg-ref-vo-details" id="act-seg-ref-details" open>
                <summary class="seg-ref-vo-summary">
                  <span>R&#233;f&#233;rence VO</span>
                  <span class="muted-label">lecture seule</span>
                  <span class="seg-ref-vo-caret" aria-hidden="true">&#9660;</span>
                </summary>
                <div class="seg-ref-vo-body">
                  <div class="form-row" style="padding:8px 14px 0">
                    <label>Document VO :
                      <select id="act-seg-ref-doc"><option value="">&#8212; choisir &#8212;</option></select>
                    </label>
                  </div>
                  <div id="act-seg-ref-content" class="seg-ref-content">
                    <p class="empty-hint">S&#233;lectionnez un document VO pour afficher les segments de r&#233;f&#233;rence.</p>
                  </div>
                </div>
              </details>
            </div>
            <!-- Colonne droite : preview structur&#233;e (tools / tabs / panes) -->
            <div class="seg-traduction-preview-wrap">
              <article class="seg-preview-card seg-traduction-preview preview" id="act-seg-traduction-preview">
                <div class="seg-inner-head">
                  <h3>Preview traduction &#8212; comparaison VO</h3>
                  <span class="seg-preview-info">scroll synchronis&#233;</span>
                </div>
                <div class="preview-tools">
                  <button class="chip active" data-chip-tr="target">Cible</button>
                  <button class="chip" data-chip-tr="vo">R&#233;f&#233;rence VO</button>
                  <button class="chip" data-chip-tr="diff">Diff</button>
                </div>
                <div class="preview-tabs" role="tablist" aria-label="Vue traduction">
                  <button class="ptab-tr active" role="tab" aria-selected="true" data-tab-tr="target">Cible</button>
                  <button class="ptab-tr" role="tab" aria-selected="false" data-tab-tr="vo">VO r&#233;f&#233;rence</button>
                  <button class="ptab-tr" role="tab" aria-selected="false" data-tab-tr="compare">Comparaison</button>
                </div>
                <div class="preview-body">
                  <section class="pane" id="act-seg-tr-pane-target">
                    <div class="pane-head">Document cible (traduction)</div>
                    <div id="act-seg-tr-target-scroll" class="doc-scroll">
                      <p class="empty-hint">S&#233;lectionnez un document et lancez la segmentation.</p>
                    </div>
                  </section>
                  <section class="pane" id="act-seg-tr-pane-vo" style="display:none">
                    <div class="pane-head">R&#233;f&#233;rence VO</div>
                    <div id="act-seg-tr-vo-scroll" class="doc-scroll">
                      <p class="empty-hint">S&#233;lectionnez un document VO.</p>
                    </div>
                  </section>
                  <aside class="minimap minimap-track" aria-label="Minimap" id="act-seg-tr-minimap"></aside>
                </div>
                <div class="preview-foot">
                  <div id="act-seg-tr-footer-stats" class="preview-stats"></div>
                </div>
                <div class="doc-final-bar" id="act-seg-tr-final-bar" hidden>
                  <div class="doc-final-wrap">
                    <div class="doc-final-meta" id="act-seg-tr-final-meta"></div>
                    <div class="doc-final-actions">
                      <button class="btn btn-secondary btn-sm" id="act-seg-tr-final-compare">Comparer</button>
                      <button class="btn btn-primary btn-sm" id="act-seg-tr-final-validate" disabled>Valider&#160;&#10003;</button>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>
        <section class="card seg-workspace-card" id="act-seg-card">
          <div class="seg-workspace">
            <details class="seg-side" id="act-seg-side">
              <summary>R&#233;glages avanc&#233;s</summary>
              <div class="seg-side-body">
                <div class="seg-box">
                  <div class="seg-box-head">Preset global</div>
                  <div class="seg-box-body">
                    <label class="seg-box-radio"><input id="act-seg-preset-strict" type="radio" name="seg-preset" value="strict" /> Strict</label>
                    <label class="seg-box-radio"><input id="act-seg-preset-extended" type="radio" name="seg-preset" value="extended" checked /> &#201;tendu</label>
                    <label class="seg-box-radio"><input id="act-seg-preset-custom" type="radio" name="seg-preset" value="custom" /> Personnalis&#233;</label>
                  </div>
                </div>
                <div class="seg-box">
                  <div class="seg-box-head">S&#233;parateurs actifs</div>
                  <div class="seg-box-body">
                    <label class="seg-box-radio"><input id="act-seg-sep-dot" type="checkbox" checked disabled /> Point <code>.</code></label>
                    <label class="seg-box-radio"><input id="act-seg-sep-qmark" type="checkbox" checked disabled /> Interrog. <code>?</code></label>
                    <label class="seg-box-radio"><input id="act-seg-sep-bang" type="checkbox" checked disabled /> Excl. <code>!</code></label>
                    <label class="seg-box-radio"><input id="act-seg-sep-slash" type="checkbox" disabled /> Barre <code>/</code></label>
                    <label class="seg-box-radio"><input id="act-seg-sep-semicolon" type="checkbox" disabled /> Point-virgule <code>;</code></label>
                    <label class="seg-box-radio"><input id="act-seg-sep-colon" type="checkbox" disabled /> Deux-points <code>:</code></label>
                  </div>
                </div>
                <div class="seg-box">
                  <div class="seg-box-head">Port&#233;e</div>
                  <div class="seg-box-body">
                    <label class="seg-box-radio"><input id="act-seg-scope-document" type="radio" name="seg-scope" value="document" checked /> Document entier</label>
                    <label class="seg-box-radio"><input id="act-seg-scope-selection" type="radio" name="seg-scope" value="selection" disabled /> S&#233;lection active</label>
                  </div>
                </div>
                <p id="act-seg-advanced-note" class="hint" style="margin:8px 0 0">
                  Les s&#233;parateurs personnalis&#233;s et la port&#233;e &#171;&#160;S&#233;lection active&#160;&#187; ne sont pas support&#233;s dans ce flux.
                  Utilisez le champ <strong>Pack</strong> pour piloter la segmentation.
                </p>
              </div>
            </details>
            <div class="seg-col seg-col-left">
              <div class="seg-inner-card">
                <div class="seg-inner-head"><h3>Param&#232;tres</h3></div>
                <div class="seg-inner-body">
                  <p class="live-note" style="margin-top:0">Flux recommand&#233; : s&#233;lectionner le document &#8594; Appliquer &#8594; Valider.</p>
                  <div class="form-grid-seg">
                    <label>Document
                      <select id="act-seg-doc"><option value="">&#8212; choisir &#8212;</option></select>
                    </label>
                    <label>Langue
                      <input id="act-seg-lang" type="text" value="fr" maxlength="10" />
                    </label>
                    <label style="grid-column:1/-1">Pack
                      <select id="act-seg-pack">
                        <option value="auto">Auto multicorpus (recommand&#233;)</option>
                        <option value="fr_strict">Fran&#231;ais strict</option>
                        <option value="en_strict">Anglais strict</option>
                        <option value="default">Standard</option>
                      </select>
                    </label>
                  </div>
                  <div id="act-seg-status-banner" class="runtime-state state-info" style="margin-top:8px">
                    Aucune segmentation lanc&#233;e pour ce document dans cette session.
                  </div>
                  <div class="btn-row" style="margin-top:8px">
                    <button id="act-seg-btn" class="btn btn-warning" disabled title="Appliquer la segmentation (efface les liens d'alignement existants)">Appliquer</button>
                    <button id="act-seg-validate-btn" class="btn btn-secondary" disabled title="Appliquer la segmentation puis valider le document">Appliquer + Valider</button>
                    <button id="act-seg-validate-only-btn" class="btn btn-primary" disabled>Valider</button>
                    <button id="act-seg-open-export-btn" class="btn btn-secondary" disabled>Exporter cette étape…</button>
                    <button id="act-seg-focus-toggle" class="btn btn-secondary" disabled>Focus</button>
                  </div>
                  <label style="margin-top:8px;font-size:12px;color:var(--prep-muted,#4f5d6d);display:flex;flex-direction:column;gap:3px">Apr&#232;s validation
                    <select id="act-seg-after-validate">
                      <option value="documents">Aller &#224; Documents (d&#233;faut)</option>
                      <option value="next">Passer au document suivant</option>
                      <option value="stay">Rester sur place</option>
                    </select>
                  </label>
                </div>
              </div>
              <details class="seg-inner-card seg-batch-overview" open>
                <summary class="seg-inner-head" style="cursor:pointer;list-style:none">
                  <h3>Vue d&#8217;ensemble corpus</h3>
                  <span class="seg-preview-info" id="act-seg-batch-info">&#8212;</span>
                </summary>
                <div id="act-seg-batch-list" class="seg-inner-body" style="padding:8px 12px">
                  <p class="empty-hint">Chargement des documents&#8230;</p>
                </div>
              </details>
            </div>
            <div class="seg-col seg-col-right">
              <article class="seg-preview-card preview" id="act-seg-preview-card">
                <div class="seg-inner-head">
                  <h3>Preview segmentation</h3>
                  <span id="act-seg-preview-info" class="seg-preview-info">&#8212;</span>
                </div>
                <div class="preview-controls">
                  <div class="chip-row">
                    <span class="chip active" id="act-seg-chip-doc">Aucun document</span>
                    <span class="chip" id="act-seg-chip-status">En attente</span>
                    <span class="chip" id="act-seg-chip-pack">auto</span>
                  </div>
                </div>
                <div class="preview-tabs" role="tablist" aria-label="Vue segmentation units">
                  <button class="ptab" role="tab" aria-selected="false" data-stab="raw">Document brut</button>
                  <button class="ptab active" role="tab" aria-selected="true" data-stab="seg">Proposition</button>
                </div>
                <div class="preview-body">
                  <section class="pane" id="act-seg-pane-raw" style="display:none">
                    <div class="pane-head">Document brut (original)</div>
                    <div id="act-seg-raw-scroll" class="doc-scroll">
                      <p class="live-note">S&#233;lectionnez un document pour voir le texte brut.</p>
                    </div>
                  </section>
                  <section class="pane" id="act-seg-pane-seg">
                    <div class="pane-head">Proposition segment&#233;e</div>
                    <div id="act-seg-preview-body" class="doc-scroll">
                      <p class="live-note">Lancez une segmentation pour voir les r&#233;sultats ici.</p>
                    </div>
                  </section>
                  <aside class="minimap minimap-track" aria-label="Minimap segments" id="act-seg-units-minimap"></aside>
                </div>
                <div class="preview-foot">
                  <div class="preview-stats" id="act-seg-units-foot-stats"></div>
                </div>
                <div class="doc-final-bar" id="act-seg-final-bar" hidden>
                  <div class="doc-final-wrap">
                    <div class="doc-final-meta" id="act-seg-final-meta"></div>
                    <div class="doc-final-actions">
                      <button class="btn btn-secondary btn-sm" id="act-seg-final-seg-btn" disabled>Seg. + valider</button>
                      <button class="btn btn-primary btn-sm" id="act-seg-final-validate-btn" disabled>Valider &#10003;</button>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>
      <div id="act-seg-longtext-view" style="display:none">
        <section class="card">
          <div class="curate-card-head">
            <div>
              <h2>Segmentation &#8212; document complet <span class="badge-preview">aper&#231;u &#233;tendu</span></h2>
              <p>Pr&#233;visualisation globale avant application : brut vs segment&#233;, minimap et suivi des suspects.</p>
            </div>
            <span id="act-seg-lt-pill" class="curate-pill">&#8212;</span>
          </div>
          <div class="seg-workspace seg-workspace-lt">
            <div class="seg-col seg-col-left">
              <div class="seg-inner-card">
                <div class="seg-inner-head"><h3>Param&#232;tres segmentation</h3></div>
                <div class="seg-inner-body">
                  <div class="form-grid-seg">
                    <label>Document :
                      <select id="act-seg-lt-doc"><option value="">&#8212; choisir &#8212;</option></select>
                    </label>
                    <label>Langue :
                      <input id="act-seg-lt-lang" type="text" value="fr" maxlength="10" style="width:70px" />
                    </label>
                    <label>Pack :
                      <select id="act-seg-lt-pack">
                        <option value="auto">Auto multicorpus</option>
                        <option value="fr_strict">Fran&#231;ais strict</option>
                        <option value="en_strict">Anglais strict</option>
                        <option value="default">Standard</option>
                      </select>
                    </label>
                  </div>
                  <div class="btn-row" style="margin-top:0.5rem">
                    <button id="act-seg-lt-btn" class="btn btn-warning" disabled title="Appliquer la segmentation (efface les liens d'alignement existants)">Appliquer</button>
                    <button id="act-seg-lt-validate-btn" class="btn btn-secondary" disabled title="Appliquer la segmentation puis valider le document">Appliquer + valider</button>
                    <button id="act-seg-lt-validate-only-btn" class="btn btn-primary" disabled>Valider ce document</button>
                    <button id="act-seg-lt-open-export-btn" class="btn btn-secondary" disabled>Exporter cette étape…</button>
                  </div>
                  <div id="act-seg-lt-status" class="runtime-state state-info" style="margin-top:0.4rem">Aucune segmentation lanc&#233;e.</div>
                </div>
              </div>
              <div class="seg-inner-card" style="margin-top:10px">
                <div class="seg-inner-head">
                  <h3>R&#233;sum&#233; v&#233;rification</h3>
                  <span id="act-seg-lt-batch-info" class="seg-preview-info">&#8212;</span>
                </div>
                <div class="seg-inner-body">
                  <div id="act-seg-lt-stats" class="seg-stats-grid">
                    <p class="empty-hint" style="grid-column:1/-1">Lancez une segmentation pour voir les r&#233;sultats.</p>
                  </div>
                  <div id="act-seg-lt-warns" class="seg-warn-list" style="display:none"></div>
                  <div id="act-seg-lt-batch-list" style="margin-top:0.5rem">
                    <p class="empty-hint">Chargement&#8230;</p>
                  </div>
                </div>
              </div>
            </div>
            <div class="seg-col seg-col-right">
              <article class="seg-preview-card acts-seg-lt-sticky-preview preview">
                <div class="seg-inner-head">
                  <h3>Preview persistante &#8212; document complet</h3>
                  <span id="act-seg-lt-preview-info" class="seg-preview-info">scroll synchronis&#233;</span>
                </div>
                <div class="preview-tools">
                  <button class="chip active" data-chip="text_norm">text_norm</button>
                  <button class="chip" data-chip="text_raw">text_raw</button>
                  <button class="chip" data-chip="highlight_cuts">surligner coupures</button>
                  <button class="chip" data-chip="suspects_only">suspects uniquement</button>
                  <button class="chip" data-chip="search">recherche dans document</button>
                </div>
                <div class="preview-tabs" role="tablist" aria-label="Vue du document">
                  <button class="ptab" role="tab" aria-selected="false" data-tab="raw">Brut</button>
                  <button class="ptab active" role="tab" aria-selected="true" data-tab="seg">Pr&#233;visualisation segmentation</button>
                  <button class="ptab" role="tab" aria-selected="false" data-tab="diff">Diff global</button>
                </div>
                <div id="act-seg-lt-search-bar" class="lt-search-bar" style="display:none" role="search" aria-label="Recherche dans le document">
                  <input id="act-seg-lt-search-input" type="search" class="lt-search-input" placeholder="Rechercher dans le document&#8230;" aria-label="Rechercher" />
                  <button id="act-seg-lt-search-clear" class="lt-search-clear" type="button" aria-label="Fermer la recherche">&#10005;</button>
                </div>
                <div class="preview-body">
                  <section class="pane" id="act-seg-lt-pane-raw" style="display:none">
                    <div class="pane-head">Document brut</div>
                    <div id="act-seg-lt-raw-scroll" class="doc-scroll">
                      <p class="empty-hint">Lancez une segmentation pour voir le document.</p>
                    </div>
                  </section>
                  <section class="pane" id="act-seg-lt-pane-seg">
                    <div class="pane-head" id="act-seg-lt-seg-head">Segmentation propos&#233;e</div>
                    <div id="act-seg-lt-seg-scroll" class="doc-scroll">
                      <p class="empty-hint">Lancez une segmentation pour voir la proposition.</p>
                    </div>
                  </section>
                  <section class="pane" id="act-seg-lt-pane-diff" style="display:none">
                    <div class="pane-head">Diff global</div>
                    <div id="act-seg-lt-diff-scroll" class="doc-scroll">
                      <p class="empty-hint">Disponible apr&#232;s segmentation.</p>
                    </div>
                  </section>
                  <aside class="minimap minimap-track" aria-label="Minimap" id="act-seg-lt-minimap"></aside>
                </div>
                <div class="preview-foot">
                  <div id="act-seg-lt-footer-stats" class="preview-stats"></div>
                </div>
                <div class="doc-final-bar" id="act-seg-lt-final-bar" hidden>
                  <div class="doc-final-wrap">
                    <div class="doc-final-meta" id="act-seg-lt-final-meta"></div>
                    <div class="doc-final-actions">
                      <button class="btn btn-secondary btn-sm" id="act-seg-lt-final-diff">Voir Diff</button>
                      <button class="btn btn-primary btn-sm" id="act-seg-lt-final-apply" disabled>Appliquer&#160;&#10003;</button>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>
    `;
    const modeUnits = el.querySelector<HTMLButtonElement>("#act-seg-mode-units")!;
    const modeTraduction = el.querySelector<HTMLButtonElement>("#act-seg-mode-traduction")!;
    const modeLongtext = el.querySelector<HTMLButtonElement>("#act-seg-mode-longtext")!;
    // Wire mode buttons to class method (no captured closure, refactor-safe)
    el.querySelector("#act-seg-head-longtext")?.addEventListener("click", () => this._setSegMode("longtext"));
    modeUnits.addEventListener("click", () => this._setSegMode("units"));
    modeTraduction.addEventListener("click", () => this._setSegMode("traduction"));
    modeLongtext.addEventListener("click", () => this._setSegMode("longtext"));
    el.querySelector("#act-seg-switch-longtext")?.addEventListener("click", () => this._setSegMode("longtext"));
    el.querySelector("#act-seg-btn")!.addEventListener("click", () => this._runSegment());
    el.querySelector("#act-seg-validate-btn")!.addEventListener("click", () => this._runSegment(true));
    el.querySelector("#act-seg-validate-only-btn")!.addEventListener("click", () => this._runValidateCurrentSegDoc());
    el.querySelector("#act-seg-open-export-btn")?.addEventListener("click", () => this._openSegmentationExportPrefill());
    el.querySelector("#act-seg-lt-open-export-btn")?.addEventListener("click", () => this._openSegmentationExportPrefill());
    // doc-final-bar buttons (units)
    el.querySelector("#act-seg-final-seg-btn")?.addEventListener("click", () => this._runSegment(true));
    el.querySelector("#act-seg-final-validate-btn")?.addEventListener("click", () => void this._runValidateCurrentSegDoc());
    // doc-final-bar buttons (longtext) — switch to diff tab + apply validation
    el.querySelector("#act-seg-lt-final-diff")?.addEventListener("click", () => {
      const diffTab = el.querySelector<HTMLButtonElement>('#act-seg-longtext-view .ptab[data-tab="diff"]');
      diffTab?.click();
    });
    el.querySelector("#act-seg-lt-final-apply")?.addEventListener("click", () => void this._applyLongtextValidation());
    // doc-final-bar buttons (traduction) — switch to compare tab + validate
    el.querySelector("#act-seg-tr-final-compare")?.addEventListener("click", () => {
      const compareTab = el.querySelector<HTMLButtonElement>('.ptab-tr[data-tab-tr="compare"]');
      compareTab?.click();
    });
    el.querySelector("#act-seg-tr-final-validate")?.addEventListener("click", () => void this._runValidateCurrentSegDoc());
    // Inc 3 P18 — Minimap click-to-scroll: click on .mm-mark scrolls the active .doc-scroll
    el.querySelectorAll<HTMLElement>(".minimap.minimap-track").forEach(mm => {
      mm.addEventListener("click", (e: MouseEvent) => {
        const mark = (e.target as HTMLElement).closest<HTMLElement>(".mm-mark");
        if (!mark) return;
        const ratio = parseFloat(mark.style.top) / 100;
        if (!isFinite(ratio)) return;
        const body = mm.closest<HTMLElement>(".preview-body");
        if (!body) return;
        const scroll = Array.from(body.querySelectorAll<HTMLElement>(".pane .doc-scroll"))
          .find(s => (s.closest<HTMLElement>(".pane") as HTMLElement).style.display !== "none");
        if (!scroll) return;
        scroll.scrollTop = ratio * (scroll.scrollHeight - scroll.clientHeight);
      });
    });
    // Inc 3 P19 — Minimap viewport zone: live mm-zone position/size tracking
    this._mmScrollCleanups.forEach(fn => fn());
    this._mmScrollCleanups = [];
    el.querySelectorAll<HTMLElement>(".minimap.minimap-track").forEach(mm => {
      const body = mm.closest<HTMLElement>(".preview-body");
      if (body) this._mmScrollCleanups.push(this._setupMmZone(body, mm));
    });
    this._wireSegAdvancedControls(el);
    el.querySelector("#act-seg-focus-toggle")!.addEventListener("click", () => this._toggleSegFocusMode(root));
    el.querySelector("#act-seg-doc")!.addEventListener("change", () => {
      const normDoc = el.querySelector<HTMLSelectElement>("#act-seg-doc");
      const ltDoc = el.querySelector<HTMLSelectElement>("#act-seg-lt-doc");
      if (normDoc && ltDoc) ltDoc.value = normDoc.value;
      this._refreshSegmentationStatusUI();
      this._checkLongtextHint(el);
      const docId = parseInt((el.querySelector<HTMLSelectElement>("#act-seg-doc"))?.value ?? "");
      if (docId && this._conn) void this._loadUnitsRawPreview(el, docId);
    });
    el.querySelector("#act-seg-pack")!.addEventListener("change", () => {
      const normPack = el.querySelector<HTMLSelectElement>("#act-seg-pack");
      const ltPack = el.querySelector<HTMLSelectElement>("#act-seg-lt-pack");
      if (normPack && ltPack) ltPack.value = normPack.value;
      this._syncSegPresetFromPack(el);
      this._refreshSegmentationStatusUI();
    });
    el.querySelector("#act-seg-lang")!.addEventListener("input", () => {
      const normLang = el.querySelector<HTMLInputElement>("#act-seg-lang");
      const ltLang = el.querySelector<HTMLInputElement>("#act-seg-lt-lang");
      if (normLang && ltLang) ltLang.value = normLang.value;
      this._applyStrictPresetIfActive(el);
      this._syncSegPresetFromPack(el);
      this._refreshSegmentationStatusUI();
    });
    const segAfterValidateSel = el.querySelector<HTMLSelectElement>("#act-seg-after-validate");
    if (segAfterValidateSel) {
      segAfterValidateSel.value = this._postValidateDestination();
      segAfterValidateSel.addEventListener("change", () => {
        const raw = segAfterValidateSel.value;
        const next = raw === "next" || raw === "stay" ? raw : "documents";
        try { localStorage.setItem(ActionsScreen.LS_SEG_POST_VALIDATE, next); } catch { /* ignore */ }
      });
    }
    // Tabs longtext (scoped to longtext view to avoid conflict with units tabs)
    el.querySelectorAll<HTMLButtonElement>("#act-seg-longtext-view .ptab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const targetTab = tab.dataset.tab!;
        el.querySelectorAll<HTMLButtonElement>("#act-seg-longtext-view .ptab").forEach((t) => {
          const active = t.dataset.tab === targetTab;
          t.classList.toggle("active", active);
          t.setAttribute("aria-selected", active ? "true" : "false");
        });
        (el.querySelector("#act-seg-lt-pane-raw") as HTMLElement).style.display = targetTab === "raw" ? "" : "none";
        (el.querySelector("#act-seg-lt-pane-seg") as HTMLElement).style.display = targetTab === "seg" ? "" : "none";
        (el.querySelector("#act-seg-lt-pane-diff") as HTMLElement).style.display = targetTab === "diff" ? "" : "none";
      });
    });
    // Tabs units mode (scoped to preview card, using data-stab attribute)
    el.querySelectorAll<HTMLButtonElement>("#act-seg-preview-card .ptab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const targetTab = tab.dataset.stab!;
        el.querySelectorAll<HTMLButtonElement>("#act-seg-preview-card .ptab").forEach((t) => {
          const active = t.dataset.stab === targetTab;
          t.classList.toggle("active", active);
          t.setAttribute("aria-selected", active ? "true" : "false");
        });
        const paneRaw = el.querySelector<HTMLElement>("#act-seg-pane-raw");
        const paneSeg = el.querySelector<HTMLElement>("#act-seg-pane-seg");
        if (paneRaw) paneRaw.style.display = targetTab === "raw" ? "" : "none";
        if (paneSeg) paneSeg.style.display = targetTab === "seg" ? "" : "none";
      });
    });
    el.querySelector("#act-seg-lt-doc")!.addEventListener("change", () => {
      const ltDoc = el.querySelector<HTMLSelectElement>("#act-seg-lt-doc")!;
      const normDoc = el.querySelector<HTMLSelectElement>("#act-seg-doc")!;
      if (normDoc) normDoc.value = ltDoc.value;
      this._refreshSegmentationStatusUI();
      this._checkLongtextHint(el);
    });
    el.querySelector("#act-seg-lt-pack")?.addEventListener("change", () => {
      const ltPack = el.querySelector<HTMLSelectElement>("#act-seg-lt-pack");
      const normPack = el.querySelector<HTMLSelectElement>("#act-seg-pack");
      if (ltPack && normPack) {
        normPack.value = ltPack.value;
        normPack.dispatchEvent(new Event("change"));
      }
    });
    el.querySelector("#act-seg-lt-lang")?.addEventListener("input", () => {
      const ltLang = el.querySelector<HTMLInputElement>("#act-seg-lt-lang");
      const normLang = el.querySelector<HTMLInputElement>("#act-seg-lang");
      if (ltLang && normLang) {
        normLang.value = ltLang.value;
        normLang.dispatchEvent(new Event("input"));
      }
    });
    el.querySelector("#act-seg-lt-btn")!.addEventListener("click", () => this._runSegment());
    el.querySelector("#act-seg-lt-validate-btn")!.addEventListener("click", () => this._runSegment(true));
    el.querySelector("#act-seg-lt-validate-only-btn")!.addEventListener("click", () => this._runValidateCurrentSegDoc());
    el.querySelectorAll<HTMLButtonElement>("[data-chip]").forEach((chip) => {
      if (chip.dataset.chip === "search") {
        chip.addEventListener("click", () => {
          this._ltSearchOpen = !this._ltSearchOpen;
          chip.classList.toggle("active", this._ltSearchOpen);
          const bar = el.querySelector<HTMLElement>("#act-seg-lt-search-bar");
          const input = el.querySelector<HTMLInputElement>("#act-seg-lt-search-input");
          if (bar) bar.style.display = this._ltSearchOpen ? "" : "none";
          if (this._ltSearchOpen && input) { input.value = ""; input.focus(); }
          if (!this._ltSearchOpen) this._closeLtSearch(el);
        });
      } else {
        chip.addEventListener("click", () => chip.classList.toggle("active"));
      }
    });
    // Inline search bar — permanent listeners (no stored refs needed; bar lives with the panel)
    el.querySelector<HTMLInputElement>("#act-seg-lt-search-input")?.addEventListener("input", (e) => {
      const query = (e.target as HTMLInputElement).value.trim();
      const scroll = this._getActiveLtPane(el);
      if (scroll) this._applyLtSearchFilter(scroll, query);
    });
    el.querySelector<HTMLInputElement>("#act-seg-lt-search-input")?.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") this._closeLtSearch(el);
    });
    el.querySelector<HTMLButtonElement>("#act-seg-lt-search-clear")?.addEventListener("click", () => {
      this._closeLtSearch(el);
    });
    el.querySelector<HTMLSelectElement>("#act-seg-ref-doc")?.addEventListener("change", (e) => {
      const docId = parseInt((e.target as HTMLSelectElement).value);
      // Reset VO pagination limit when doc changes (P20 Inc 3 perf)
      if (docId) this._voPreviewLimitByDocId.delete(docId);
      const contentEl = el.querySelector<HTMLElement>("#act-seg-ref-content");
      const voScrollEl = el.querySelector<HTMLElement>("#act-seg-tr-vo-scroll");
      if (!docId) {
        if (contentEl) contentEl.innerHTML = '<p class="empty-hint">S&#233;lectionnez un document VO pour afficher les segments de r&#233;f&#233;rence.</p>';
        if (voScrollEl) voScrollEl.innerHTML = '<p class="empty-hint">S&#233;lectionnez un document VO.</p>';
        return;
      }
      const doc = this._docs.find(d => d.doc_id === docId);
      if (!doc) {
        if (contentEl) contentEl.innerHTML = '<p class="empty-hint">Document introuvable.</p>';
        if (voScrollEl) voScrollEl.innerHTML = '<p class="empty-hint">Document VO introuvable.</p>';
        return;
      }
      const docRow = `<div class="seg-ref-doc-row"><span>${_escHtml(doc.title)}</span><span class="seg-ref-doc-id">[${doc.doc_id}] ${_escHtml(doc.language)} &mdash; ${doc.unit_count} unit&#233;s</span></div>`;
      if (contentEl) {
        contentEl.innerHTML = docRow + '<p class="empty-hint" style="margin:8px 0 0">Pr&#233;visualisation des segments disponible apr&#232;s chargement.</p>';
      }
      if (voScrollEl) {
        voScrollEl.innerHTML = docRow +
          `<p class="empty-hint" style="margin:8px 0 0">Segments VO disponibles apr&#232;s chargement sidecar.</p>`;
      }
      // Best-effort: load actual VO segments via getDocumentPreview
      void this._loadVoSegmentsPreview(el, docId);
    });
    // Traduction preview tabs (Inc 3 — preview à droite structurée)
    el.querySelectorAll<HTMLButtonElement>(".ptab-tr").forEach((tab) => {
      tab.addEventListener("click", () => {
        const targetTab = tab.dataset.tabTr!;
        el.querySelectorAll<HTMLButtonElement>(".ptab-tr").forEach((t) => {
          const active = t.dataset.tabTr === targetTab;
          t.classList.toggle("active", active);
          t.setAttribute("aria-selected", active ? "true" : "false");
        });
        const paneTarget = el.querySelector<HTMLElement>("#act-seg-tr-pane-target");
        const paneVo = el.querySelector<HTMLElement>("#act-seg-tr-pane-vo");
        if (paneTarget) paneTarget.style.display = (targetTab === "target" || targetTab === "compare") ? "" : "none";
        if (paneVo) paneVo.style.display = (targetTab === "vo" || targetTab === "compare") ? "" : "none";
      });
    });
    initCardAccordions(el);
    this._bindHeadNavLinks(el, root);
    return el;
  }

  private _renderAlignementPanel(root: HTMLElement): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "main");
    wrapper.setAttribute("aria-label", "Vue Alignement");

    // ── En-tête rapide ──
    const headSection = document.createElement("section");
    headSection.className = "acts-seg-head-card";
    headSection.innerHTML = `
      <div class="acts-hub-head-left">
        <h1>Alignement</h1>
        <p>Créez les liens pivot ↔ cible entre documents, vérifiez et corrigez.</p>
      </div>
      <div class="acts-hub-head-tools">
        <button class="acts-hub-head-link" id="act-align-open-export-btn">Exporter cette étape…</button>
      </div>`;
    this._bindHeadNavLinks(headSection, root);
    headSection.querySelector("#act-align-open-export-btn")?.addEventListener("click", () => this._openAlignmentExportPrefill());
    wrapper.appendChild(headSection);

    // ── Nouveau panneau alignement (2-col + famille + confirmation inline) ──
    this._alignPanel = new AlignPanel(
      () => this._conn,
      () => this._docs,
      {
        log: (msg, isError) => this._log(msg, isError),
        toast: (msg, isError) => this._showToast?.(msg, isError),
        setBusy: (v) => this._setBusy(v),
        jobCenter: () => this._jobCenter,
        onRunDone: (_pivot, _targets) => {
          // After a run, also refresh the legacy audit selects below
          this._loadAlignDocsIntoSelects();
        },
        onNav: (target) => {
          // Navigate to sub-view (curation / segmentation)
          const linkEl = document.querySelector<HTMLButtonElement>(`[data-nav="${target}"]`);
          linkEl?.click();
        },
      },
    );
    const newPanelEl = this._alignPanel.render();
    newPanelEl.classList.add("align-new-panel-section");
    wrapper.appendChild(newPanelEl);

    // ── Sections secondaires (qualité, collisions, rapport) — conservées ──
    const legacyContainer = document.createElement("div");
    legacyContainer.setAttribute("data-legacy-align", "true");
    legacyContainer.innerHTML = `
      <section class="acts-seg-head-card" style="display:none"><!-- placeholder legacy head --></section>
      <section class="card" id="act-quality-card" data-collapsible="true" data-collapsed-default="true">
        <h3>Qualit&#233; alignement <span class="badge-preview">m&#233;triques</span></h3>
        <p class="hint">Calculer les m&#233;triques de couverture et d&#8217;orphelins pour une paire pivot&#8596;cible.</p>
        <div class="form-row">
          <label>Pivot
            <select id="act-quality-pivot"><option value="">&#8212; choisir &#8212;</option></select>
          </label>
          <label>Cible
            <select id="act-quality-target"><option value="">&#8212; choisir &#8212;</option></select>
          </label>
          <div style="align-self:flex-end">
            <button id="act-quality-btn" class="btn btn-secondary btn-sm" disabled>Calculer m&#233;triques</button>
          </div>
        </div>
        <div id="act-quality-result" style="display:none;margin-top:0.75rem"></div>
      </section>
      <section class="card" id="act-run-compare-card" data-collapsible="true" data-collapsed-default="true">
        <h3>Comparer deux runs <span class="badge-preview">align</span></h3>
        <p class="hint">Historique des runs d&#8217;alignement en base ; comparez strat&#233;gie et indicateurs.</p>
        <div class="form-row" style="flex-wrap:wrap;gap:0.5rem;align-items:flex-end">
          <button id="act-run-compare-refresh" type="button" class="btn btn-secondary btn-sm">Charger l&#8217;historique</button>
          <label>Run A
            <select id="act-run-compare-a" class="act-run-compare-sel" aria-label="Premier run">
              <option value="">&#8212;</option>
            </select>
          </label>
          <label>Run B
            <select id="act-run-compare-b" class="act-run-compare-sel" aria-label="Second run">
              <option value="">&#8212;</option>
            </select>
          </label>
        </div>
        <p id="act-run-compare-hint" class="hint" style="margin-top:0.5rem">Chargez l&#8217;historique, puis choisissez deux runs.</p>
        <div id="act-run-compare-result" style="display:none;margin-top:0.75rem"></div>
      </section>
      <section class="card" id="act-collision-card" data-collapsible="true" data-collapsed-default="true">
        <h3>Collisions d&#8217;alignement <span class="badge-preview">r&#233;solution</span></h3>
        <p class="hint">Un pivot ayant plusieurs liens vers le m&#234;me document cible est une collision.</p>
        <div class="form-row">
          <label>Pivot
            <select id="act-coll-pivot"><option value="">&#8212; choisir &#8212;</option></select>
          </label>
          <label>Cible
            <select id="act-coll-target"><option value="">&#8212; choisir &#8212;</option></select>
          </label>
          <div style="align-self:flex-end">
            <button id="act-coll-load-btn" class="btn btn-secondary btn-sm" disabled>Charger les collisions</button>
          </div>
        </div>
        <div id="act-coll-result" style="display:none;margin-top:0.75rem"></div>
        <div id="act-coll-more-wrap" style="display:none;margin-top:0.5rem;text-align:center">
          <button id="act-coll-more-btn" class="btn btn-sm btn-secondary">Charger plus</button>
        </div>
      </section>
      <section class="card" id="act-report-card" data-collapsible="true" data-collapsed-default="true">
        <h3>Rapport de runs <span class="badge-preview">export</span></h3>
        <p class="hint">Exporter l&#8217;historique des runs en HTML ou JSONL.</p>
        <div class="form-row">
          <label>Format :
            <select id="act-report-fmt">
              <option value="html">HTML</option>
              <option value="jsonl">JSONL</option>
            </select>
          </label>
          <label style="flex:1">Run ID (optionnel) :
            <input id="act-report-run-id" type="text" placeholder="laisser vide = tous les runs" style="width:100%;max-width:340px" />
          </label>
        </div>
        <div class="btn-row" style="margin-top:0.5rem">
          <button id="act-report-btn" class="btn btn-secondary" disabled>Enregistrer le rapport&#8230;</button>
        </div>
        <div id="act-report-result" style="display:none;margin-top:0.5rem;font-size:0.85rem"></div>
      </section>
    `;
    wrapper.appendChild(legacyContainer);

    // Wire legacy buttons
    legacyContainer.querySelector("#act-quality-btn")!.addEventListener("click", () => this._runAlignQuality(root));
    legacyContainer.querySelector("#act-coll-load-btn")!.addEventListener("click", () => {
      this._collOffset = 0; this._collGroups = []; this._loadCollisionsPage(root, false);
    });
    legacyContainer.querySelector("#act-coll-more-btn")!.addEventListener("click", () => this._loadCollisionsPage(root, true));
    legacyContainer.querySelector("#act-report-btn")!.addEventListener("click", () => void this._runExportReport());
    legacyContainer.querySelector("#act-run-compare-refresh")!.addEventListener("click", () => {
      void this._refreshAlignRunsCompare(legacyContainer);
    });
    legacyContainer.querySelector("#act-run-compare-a")!.addEventListener("change", () => {
      this._updateAlignRunCompareDiff(legacyContainer);
    });
    legacyContainer.querySelector("#act-run-compare-b")!.addEventListener("change", () => {
      this._updateAlignRunCompareDiff(legacyContainer);
    });

    initCardAccordions(legacyContainer);
    this._loadAlignDocsIntoSelects();
    return wrapper;

    // ── ANCIENNE IMPLÉMENTATION (désactivée, code mort conservé pour référence) ──
    /* eslint-disable no-unreachable */
    const _legacyEl = document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const el = _legacyEl; // alias so the original code below compiles unchanged
    _legacyEl.innerHTML = `
      <section class="acts-seg-head-card">
        <div class="acts-hub-head-left">
          <h1>Alignement &#8212; vue run globale</h1>
          <p>Cr&#233;ez les liens pivot &#8596; cible entre documents. Lancez un run, contr&#244;lez la qualit&#233;, corrigez les exceptions.</p>
        </div>
        <div class="acts-hub-head-tools">
          <span class="curate-pill" id="act-align-run-pill">Liens pivot &#8596; cible</span>
        </div>
      </section>
      <section class="card workflow-section" id="wf-section" data-collapsible="true" data-collapsed-default="true" style="border:2px solid var(--accent,#1a7f4e)">
        <h3>Workflow alignement guid&#233;
          <span style="font-size:0.75rem;font-weight:400;color:#6c757d;margin-left:0.5rem">5 &#233;tapes</span>
        </h3>
        <p class="hint" style="margin-bottom:0.5rem">Progression rapide : aligner, contr&#244;ler, corriger, exporter.</p>
        <div id="wf-steps" style="display:flex;flex-direction:column;gap:0;border:1px solid #e9ecef;border-radius:6px;overflow:hidden">
          <div class="wf-step" id="wf-step-0" style="border-bottom:1px solid #e9ecef">
            <div class="wf-step-header" id="wf-hdr-0">
              <span class="wf-num" id="wf-num-0">1</span>
              <span class="wf-step-label">Alignement</span>
              <span class="wf-status" id="wf-st-0"></span>
              <span class="wf-toggle" id="wf-tog-0">&#9660;</span>
            </div>
            <div class="wf-body" id="wf-body-0" style="display:none">
              <div style="font-size:0.8rem;margin-bottom:6px">Dernier run : <code id="wf-run-id-display">(aucun)</code></div>
              <button id="wf-goto-align" class="btn btn-primary btn-sm">Ouvrir la zone Alignement &#8595;</button>
            </div>
          </div>
          <div class="wf-step" id="wf-step-1" style="border-bottom:1px solid #e9ecef">
            <div class="wf-step-header" id="wf-hdr-1">
              <span class="wf-num" id="wf-num-1">2</span>
              <span class="wf-step-label">Contr&#244;le qualit&#233;</span>
              <span class="wf-status" id="wf-st-1"></span>
              <span class="wf-toggle" id="wf-tog-1">&#9660;</span>
            </div>
            <div class="wf-body" id="wf-body-1" style="display:none">
              <div id="wf-quality-result" style="margin-bottom:8px"></div>
              <button id="wf-quality-btn" class="btn btn-secondary btn-sm" disabled>Lancer la v&#233;rification qualit&#233;</button>
            </div>
          </div>
          <div class="wf-step" id="wf-step-2" style="border-bottom:1px solid #e9ecef">
            <div class="wf-step-header" id="wf-hdr-2">
              <span class="wf-num" id="wf-num-2">3</span>
              <span class="wf-step-label">Collisions</span>
              <span class="wf-status" id="wf-st-2"></span>
              <span class="wf-toggle" id="wf-tog-2">&#9660;</span>
            </div>
            <div class="wf-body" id="wf-body-2" style="display:none">
              <button id="wf-coll-btn" class="btn btn-secondary btn-sm" disabled>Ouvrir la section Collisions &#8595;</button>
            </div>
          </div>
          <div class="wf-step" id="wf-step-3" style="border-bottom:1px solid #e9ecef">
            <div class="wf-step-header" id="wf-hdr-3">
              <span class="wf-num" id="wf-num-3">4</span>
              <span class="wf-step-label">Revue et correction</span>
              <span class="wf-status" id="wf-st-3"></span>
              <span class="wf-toggle" id="wf-tog-3">&#9660;</span>
            </div>
            <div class="wf-body" id="wf-body-3" style="display:none">
              <button id="wf-audit-btn" class="btn btn-secondary btn-sm" disabled>Ouvrir la zone Revue &#8595;</button>
            </div>
          </div>
          <div class="wf-step" id="wf-step-4">
            <div class="wf-step-header" id="wf-hdr-4">
              <span class="wf-num" id="wf-num-4">5</span>
              <span class="wf-step-label">Rapport final</span>
              <span class="wf-status" id="wf-st-4"></span>
              <span class="wf-toggle" id="wf-tog-4">&#9660;</span>
            </div>
            <div class="wf-body" id="wf-body-4" style="display:none">
              <button id="wf-report-btn" class="btn btn-secondary btn-sm" disabled>Ouvrir la section Rapport &#8595;</button>
            </div>
          </div>
        </div>
      </section>
      <section class="card" data-collapsible="true" data-collapsed-default="true">
        <h3>Documents du corpus</h3>
        <div class="btn-row">
          <button id="act-reload-docs-align" class="btn btn-secondary btn-sm">&#8635;&#160;Rafra&#238;chir</button>
        </div>
        <div id="act-doc-list" class="doc-list"><p class="empty-hint">Aucun corpus ouvert.</p></div>
      </section>
      <section class="card" id="act-align-card">
        <div class="align-layout">
          <div class="align-main">
            <div class="align-launcher">
              <div class="align-launcher-head">Configuration du run</div>
              <div class="align-setup-row">
                <label>Doc pivot :
                  <select id="act-align-pivot"><option value="">&#8212; choisir &#8212;</option></select>
                </label>
                <label>Doc(s) cible(s) :
                  <select id="act-align-targets" multiple size="3"></select>
                </label>
                <label>Strat&#233;gie :
                  <select id="act-align-strategy">
                    <option value="external_id">external_id</option>
                    <option value="external_id_then_position">external_id_then_position (hybride)</option>
                    <option value="position">position</option>
                    <option value="similarity">similarit&#233;</option>
                  </select>
                </label>
              </div>
              <div class="form-row" style="margin-top:8px">
                <label id="act-sim-row" style="display:none">Seuil :
                  <input id="act-sim-threshold" type="number" min="0" max="1" step="0.05" value="0.8" style="width:70px"/>
                </label>
                <label style="display:flex;align-items:center;gap:0.35rem">
                  <input id="act-align-debug" type="checkbox" />
                  debug explainability
                </label>
                <label style="display:flex;align-items:center;gap:0.35rem">
                  <input id="act-align-preserve-accepted" type="checkbox" checked />
                  Conserver les liens valid&#233;s au recalcul
                </label>
              </div>
              <p class="hint" style="margin:0.35rem 0 0">Au recalcul global, les liens marqu&#233;s &#171; accept&#233;s &#187; sont consid&#233;r&#233;s comme verrouill&#233;s.</p>
              <div class="btn-row" style="margin-top:0.5rem">
                <button id="act-align-btn" class="btn btn-warning" disabled>Lancer la run d&#8217;alignement</button>
                <button id="act-align-recalc-btn" class="btn btn-secondary" disabled>Recalcul global</button>
              </div>
            </div>
            <!-- Synthèse du run — visible after alignment -->
            <div id="act-align-results" style="display:none;margin-top:0.75rem">
              <div class="run-synthese-head">
                <h4 class="run-synthese-title">Synth&#232;se du run</h4>
                <div id="act-align-banner" class="preview-stats"></div>
              </div>
              <div id="act-align-kpis" class="align-kpis" style="margin-top:10px">
                <div class="kpi align-kpi" id="act-kpi-wrap-created"><div class="label align-kpi-label">Liens cr&#233;&#233;s</div><div class="value align-kpi-value" id="act-kpi-created">&#8212;</div></div>
                <div class="kpi align-kpi" id="act-kpi-wrap-skipped"><div class="label align-kpi-label">Ignor&#233;s</div><div class="value align-kpi-value" id="act-kpi-skipped">&#8212;</div></div>
                <div class="kpi align-kpi" id="act-kpi-wrap-coverage"><div class="label align-kpi-label">Couverture</div><div class="value align-kpi-value" id="act-kpi-coverage">&#8212;</div></div>
                <div class="kpi align-kpi" id="act-kpi-wrap-orphan-p"><div class="label align-kpi-label">Orphelins pivot</div><div class="value align-kpi-value" id="act-kpi-orphan-p">&#8212;</div></div>
                <div class="kpi align-kpi" id="act-kpi-wrap-orphan-t"><div class="label align-kpi-label">Orphelins cible</div><div class="value align-kpi-value" id="act-kpi-orphan-t">&#8212;</div></div>
              </div>
              <div class="btn-row" style="margin-top:10px">
                <button id="act-align-open-audit-cta" class="btn btn-primary btn-sm">Ouvrir l&#8217;audit &#8595;</button>
                <button id="act-align-recalc-cta" class="btn btn-secondary btn-sm">Recalcul global</button>
              </div>
            </div>
            <div id="act-align-debug-panel" style="display:none;margin-top:0.75rem">
              <div class="align-debug-head">
                <h4 style="margin:0;font-size:0.9rem">Explainability</h4>
                <button id="act-align-copy-debug-btn" class="btn btn-secondary btn-sm">Copier diagnostic JSON</button>
              </div>
              <div id="act-align-debug-content" class="align-debug-content"></div>
            </div>
            <div id="act-audit-panel" style="display:none;margin-top:0.75rem">
              <div class="run-toolbar">
                <div class="run-toolbar-title">
                  <h4 style="margin:0;font-size:0.9rem">Texte complet align&#233;</h4>
                </div>
                <div class="run-toolbar-filters">
                  <button id="act-audit-qf2-all" class="chip active" data-qf2="all">Tout</button>
                  <button id="act-audit-qf2-review" class="chip" data-qf2="review">&#192; revoir</button>
                  <button id="act-audit-qf2-unreviewed" class="chip" data-qf2="unreviewed">Non r&#233;vis&#233;s</button>
                  <button id="act-audit-qf2-rejected" class="chip" data-qf2="rejected">Rejet&#233;s</button>
                </div>
                <div class="run-toolbar-actions">
                  <div class="run-view-toggle chip-row">
                    <button id="act-audit-view-table" class="chip active" title="Vue tableau" aria-pressed="true">&#9776; Tableau</button>
                    <button id="act-audit-view-run" class="chip" title="Vue run-row" aria-pressed="false">&#9711; Run</button>
                  </div>
                  <button id="act-audit-next-cta" class="btn btn-sm btn-secondary">Suivant &#224; revoir &#8595;</button>
                </div>
              </div>
              <div class="form-row">
                <label>Pivot :
                  <select id="act-audit-pivot"><option value="">&#8212; choisir &#8212;</option></select>
                </label>
                <label>Cible :
                  <select id="act-audit-target"><option value="">&#8212; choisir &#8212;</option></select>
                </label>
                <label>ext_id exact :
                  <input id="act-audit-extid" type="number" placeholder="optionnel"/>
                </label>
                <label>Statut :
                  <select id="act-audit-status">
                    <option value="">Tous</option>
                    <option value="unreviewed">Non r&#233;vis&#233;s</option>
                    <option value="accepted">Accept&#233;s</option>
                    <option value="rejected">Rejet&#233;s</option>
                  </select>
                </label>
                <label>Recherche texte :
                  <input id="act-audit-text-filter" type="text" placeholder="mot cl&#233; dans pivot/cible"/>
                </label>
              </div>
              <div class="btn-row" style="margin-top:0.4rem;gap:0.75rem;align-items:center">
                <button id="act-audit-load-btn" class="btn btn-secondary btn-sm">Charger les liens</button>
                <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.82rem;cursor:pointer">
                  <input id="act-audit-explain-toggle" type="checkbox" />
                  Expliquer (include_explain)
                </label>
                <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.82rem;cursor:pointer">
                  <input id="act-audit-exceptions-only" type="checkbox" />
                  Exceptions seulement
                </label>
              </div>
              <div class="btn-row" style="margin-top:0.35rem;gap:0.4rem;align-items:center">
                <button id="act-audit-qf-all" class="btn btn-sm btn-secondary audit-filter-btn" data-qf="all">Tout</button>
                <button id="act-audit-qf-review" class="btn btn-sm btn-secondary audit-filter-btn" data-qf="review">&#192; revoir</button>
                <button id="act-audit-qf-unreviewed" class="btn btn-sm btn-secondary audit-filter-btn" data-qf="unreviewed">Non r&#233;vis&#233;s</button>
                <button id="act-audit-qf-rejected" class="btn btn-sm btn-secondary audit-filter-btn" data-qf="rejected">Rejet&#233;s</button>
                <button id="act-audit-next-exception-btn" class="btn btn-sm btn-secondary">Suivant &#224; revoir</button>
              </div>
              <div id="act-audit-kpis" class="hint" style="margin-top:0.35rem"></div>
              <div id="act-audit-table-wrap" style="margin-top:0.5rem;overflow-x:auto"></div>
              <div id="act-audit-run-view" style="display:none;margin-top:0.5rem"></div>
              <div id="act-audit-batch-bar" class="audit-batch-bar" style="display:none">
                <span id="act-audit-sel-count" class="audit-sel-count">0 s&#233;lectionn&#233;(s)</span>
                <button id="act-audit-batch-accept" class="btn btn-sm btn-secondary">&#10003; Accepter</button>
                <button id="act-audit-batch-reject" class="btn btn-sm btn-secondary">&#10007; Rejeter</button>
                <button id="act-audit-batch-unreviewed" class="btn btn-sm btn-secondary">? Non r&#233;vis&#233;</button>
                <button id="act-audit-batch-delete" class="btn btn-sm btn-danger">Supprimer</button>
              </div>
              <div class="btn-row" style="margin-top:0.4rem">
                <button id="act-audit-more-btn" class="btn btn-secondary btn-sm" style="display:none">Charger plus</button>
              </div>
            </div>
          </div>
          <aside class="align-focus">
            <h4 style="margin:0 0 0.45rem;font-size:0.9rem">Correction cibl&#233;e</h4>
            <p id="act-align-focus-empty" class="empty-hint">S&#233;lectionnez une ligne dans &#171; Texte complet align&#233; &#187; pour corriger rapidement.</p>
            <div id="act-align-focus-panel" style="display:none">
              <div id="act-align-focus-meta" class="hint" style="margin-bottom:0.35rem"></div>
              <div class="align-focus-text">
                <strong>Pivot</strong>
                <p id="act-align-focus-pivot"></p>
              </div>
              <div class="align-focus-text" style="margin-top:0.45rem">
                <strong>Cible</strong>
                <p id="act-align-focus-target"></p>
              </div>
              <div class="btn-row" style="margin-top:0.65rem">
                <button id="act-focus-accept-btn" class="btn btn-sm btn-secondary">&#10003; Valider</button>
                <button id="act-focus-reject-btn" class="btn btn-sm btn-secondary">&#10007; &#192; revoir</button>
                <button id="act-focus-unreviewed-btn" class="btn btn-sm btn-secondary">? Non r&#233;vis&#233;</button>
                <button id="act-focus-lock-btn" class="btn btn-sm btn-secondary">Verrouiller</button>
                <button id="act-focus-unlock-btn" class="btn btn-sm btn-secondary">D&#233;verrouiller</button>
                <button id="act-focus-retarget-btn" class="btn btn-sm btn-secondary">&#8644; Retarget</button>
                <button id="act-focus-delete-btn" class="btn btn-sm btn-danger">Supprimer</button>
              </div>
            </div>
          </aside>
        </div>
        <div class="btn-row align-finalize-row">
          <button id="act-goto-report" class="btn btn-secondary btn-sm">Terminer: ouvrir Rapport runs &#8595;</button>
        </div>
      </section>
      <section class="card" id="act-quality-card" data-collapsible="true" data-collapsed-default="true">
        <h3>Qualit&#233; alignement <span class="badge-preview">m&#233;triques</span></h3>
        <p class="hint">Calculer les m&#233;triques de couverture et d&#8217;orphelins pour une paire pivot&#8596;cible.</p>
        <div class="form-row">
          <label>Pivot
            <select id="act-quality-pivot"><option value="">&#8212; choisir &#8212;</option></select>
          </label>
          <label>Cible
            <select id="act-quality-target"><option value="">&#8212; choisir &#8212;</option></select>
          </label>
          <div style="align-self:flex-end">
            <button id="act-quality-btn" class="btn btn-secondary btn-sm" disabled>Calculer m&#233;triques</button>
          </div>
        </div>
        <div id="act-quality-result" style="display:none;margin-top:0.75rem"></div>
      </section>
      <section class="card" id="act-collision-card" data-collapsible="true" data-collapsed-default="true">
        <h3>Collisions d&#8217;alignement <span class="badge-preview">r&#233;solution</span></h3>
        <p class="hint">Un pivot ayant plusieurs liens vers le m&#234;me document cible est une collision.</p>
        <div class="form-row">
          <label>Pivot
            <select id="act-coll-pivot"><option value="">&#8212; choisir &#8212;</option></select>
          </label>
          <label>Cible
            <select id="act-coll-target"><option value="">&#8212; choisir &#8212;</option></select>
          </label>
          <div style="align-self:flex-end">
            <button id="act-coll-load-btn" class="btn btn-secondary btn-sm" disabled>Charger les collisions</button>
          </div>
        </div>
        <div id="act-coll-result" style="display:none;margin-top:0.75rem"></div>
        <div id="act-coll-more-wrap" style="display:none;margin-top:0.5rem;text-align:center">
          <button id="act-coll-more-btn" class="btn btn-sm btn-secondary">Charger plus</button>
        </div>
      </section>
      <section class="card" id="act-report-card" data-collapsible="true" data-collapsed-default="true">
        <h3>Rapport de runs <span class="badge-preview">export</span></h3>
        <p class="hint">Exporter l&#8217;historique des runs (import, alignement, curation&#8230;) en HTML ou JSONL.</p>
        <div class="form-row">
          <label>Format :
            <select id="act-report-fmt">
              <option value="html">HTML</option>
              <option value="jsonl">JSONL</option>
            </select>
          </label>
          <label style="flex:1">Run ID (optionnel) :
            <input id="act-report-run-id" type="text" placeholder="laisser vide = tous les runs" style="width:100%;max-width:340px" />
          </label>
        </div>
        <div class="btn-row" style="margin-top:0.5rem">
          <button id="act-report-btn" class="btn btn-secondary" disabled>Enregistrer le rapport&#8230;</button>
        </div>
        <div id="act-report-result" style="display:none;margin-top:0.5rem;font-size:0.85rem"></div>
      </section>
    `;
    el.querySelector("#act-reload-docs-align")!.addEventListener("click", () => this._loadDocs());
    el.querySelector("#act-align-strategy")!.addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      (el.querySelector("#act-sim-row") as HTMLElement).style.display = v === "similarity" ? "" : "none";
    });
    el.querySelector("#act-align-btn")!.addEventListener("click", () => this._runAlign(false));
    el.querySelector("#act-align-recalc-btn")!.addEventListener("click", () => this._runAlign(true));
    el.querySelector("#act-align-copy-debug-btn")!.addEventListener("click", () => this._copyAlignDebugJson());
    el.querySelector("#act-audit-load-btn")!.addEventListener("click", () => {
      this._auditOffset = 0; this._auditLinks = []; this._auditSelectedLinkId = null;
      this._auditLoading = true; this._renderAuditTable(root); this._loadAuditPage(root, false);
    });
    el.querySelector("#act-audit-more-btn")!.addEventListener("click", () => this._loadAuditPage(root, true));
    (el.querySelector("#act-audit-explain-toggle") as HTMLInputElement).addEventListener("change", (e) => {
      this._auditIncludeExplain = (e.target as HTMLInputElement).checked;
      if (this._auditLinks.length > 0) {
        this._auditOffset = 0; this._auditLinks = [];
        this._renderAuditTable(root); void this._loadAuditPage(root, false);
      }
    });
    const auditTextFilterEl = el.querySelector<HTMLInputElement>("#act-audit-text-filter");
    auditTextFilterEl?.addEventListener("input", () => {
      this._auditTextFilter = auditTextFilterEl!.value.trim().toLowerCase();
      this._renderAuditTable(root);
    });
    const exceptionsOnlyEl = el.querySelector<HTMLInputElement>("#act-audit-exceptions-only");
    if (exceptionsOnlyEl) {
      this._auditExceptionsOnly = this._readAuditExceptionsOnlyPref();
      exceptionsOnlyEl!.checked = this._auditExceptionsOnly;
      exceptionsOnlyEl!.addEventListener("change", () => {
        this._auditExceptionsOnly = exceptionsOnlyEl!.checked;
        this._writeAuditExceptionsOnlyPref(this._auditExceptionsOnly);
        this._renderAuditTable(root);
      });
    }
    this._auditQuickFilter = this._readAuditQuickFilterPref();
    this._syncAuditQuickFilterUi(el);
    ["all", "review", "unreviewed", "rejected"].forEach((key) => {
      const btn = el.querySelector<HTMLButtonElement>(`#act-audit-qf-${key}`);
      if (!btn) return;
      btn.addEventListener("click", () => this._setAuditQuickFilter(root, key as "all" | "review" | "unreviewed" | "rejected"));
    });
    el.querySelector("#act-audit-next-exception-btn")!.addEventListener("click", () => this._focusNextAuditException(root));
    el.querySelector("#act-focus-accept-btn")!.addEventListener("click", () => this._runFocusStatusAction(root, "accepted"));
    el.querySelector("#act-focus-reject-btn")!.addEventListener("click", () => this._runFocusStatusAction(root, "rejected"));
    el.querySelector("#act-focus-unreviewed-btn")!.addEventListener("click", () => this._runFocusStatusAction(root, null));
    el.querySelector("#act-focus-lock-btn")!.addEventListener("click", () => this._runFocusStatusAction(root, "accepted"));
    el.querySelector("#act-focus-unlock-btn")!.addEventListener("click", () => this._runFocusStatusAction(root, null));
    el.querySelector("#act-focus-delete-btn")!.addEventListener("click", () => this._runFocusDeleteAction(root));
    el.querySelector("#act-focus-retarget-btn")!.addEventListener("click", () => this._runFocusRetargetAction(root));
    el.querySelector("#act-audit-batch-accept")!.addEventListener("click", () => this._runBatchAction(root, "set_status", "accepted"));
    el.querySelector("#act-audit-batch-reject")!.addEventListener("click", () => this._runBatchAction(root, "set_status", "rejected"));
    el.querySelector("#act-audit-batch-unreviewed")!.addEventListener("click", () => this._runBatchAction(root, "set_status", null));
    el.querySelector("#act-audit-batch-delete")!.addEventListener("click", () => this._runBatchAction(root, "delete", null));
    el.querySelector("#act-quality-btn")!.addEventListener("click", () => this._runAlignQuality(root));
    el.querySelector("#act-coll-load-btn")!.addEventListener("click", () => {
      this._collOffset = 0; this._collGroups = []; this._loadCollisionsPage(root, false);
    });
    el.querySelector("#act-coll-more-btn")!.addEventListener("click", () => this._loadCollisionsPage(root, true));
    el.querySelector("#act-report-btn")!.addEventListener("click", () => void this._runExportReport());
    el.querySelector("#act-goto-report")?.addEventListener("click", () =>
      el.querySelector("#act-report-card")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    el.querySelector("#wf-goto-align")?.addEventListener("click", () =>
      el.querySelector("#act-align-card")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    el.querySelector("#wf-coll-btn")?.addEventListener("click", () =>
      el.querySelector("#act-collision-card")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    el.querySelector("#wf-audit-btn")?.addEventListener("click", () =>
      el.querySelector("#act-audit-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    el.querySelector("#wf-report-btn")?.addEventListener("click", () =>
      el.querySelector("#act-report-card")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    // New CTA buttons in synthèse run section
    el.querySelector("#act-align-open-audit-cta")?.addEventListener("click", () =>
      el.querySelector("#act-audit-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    el.querySelector("#act-align-recalc-cta")?.addEventListener("click", () => this._runAlign(true));
    // Run-toolbar filter chips (mirror the existing filter buttons)
    el.querySelector("#act-audit-next-cta")?.addEventListener("click", () => this._focusNextAuditException(root));
    ["all", "review", "unreviewed", "rejected"].forEach((key) => {
      const btn = el.querySelector<HTMLButtonElement>(`#act-audit-qf2-${key}`);
      if (!btn) return;
      btn.addEventListener("click", () => {
        this._setAuditQuickFilter(root, key as "all" | "review" | "unreviewed" | "rejected");
        // Sync visual state of toolbar chips
        el.querySelectorAll<HTMLElement>("[data-qf2]").forEach((b) => b.classList.toggle("active", b.dataset.qf2 === key));
      });
    });
    // View mode toggle (tableau / run)
    const viewTableBtn = el.querySelector<HTMLButtonElement>("#act-audit-view-table");
    const viewRunBtn = el.querySelector<HTMLButtonElement>("#act-audit-view-run");
    viewTableBtn?.addEventListener("click", () => this._setAlignViewMode("table", root));
    viewRunBtn?.addEventListener("click", () => this._setAlignViewMode("run", root));

    initCardAccordions(_legacyEl);
    this._bindHeadNavLinks(_legacyEl, root);
    return _legacyEl;
    /* eslint-enable no-unreachable */
  }

  /** Populate quality/collision selects from this._docs (used by new AlignPanel onRunDone). */
  private _loadAlignDocsIntoSelects(): void {
    const docs = this._docs;
    const selIds = ["act-quality-pivot", "act-quality-target", "act-coll-pivot", "act-coll-target"];
    for (const id of selIds) {
      const sel = document.querySelector<HTMLSelectElement>(`#${id}`);
      if (!sel) continue;
      const prev = sel.value;
      sel.innerHTML = `<option value="">&#8212; choisir &#8212;</option>`;
      for (const d of docs) {
        const opt = document.createElement("option");
        opt.value = String(d.doc_id);
        opt.textContent = `${d.title} (${d.language ?? "?"})`;
        if (String(d.doc_id) === prev) opt.selected = true;
        sel.appendChild(opt);
      }
      const btn = document.querySelector<HTMLButtonElement>(`#act-quality-btn, #act-coll-load-btn`);
      if (btn) btn.disabled = docs.length === 0;
    }
    // Enable report button if docs exist
    const reportBtn = document.querySelector<HTMLButtonElement>("#act-report-btn");
    if (reportBtn) reportBtn.disabled = docs.length === 0;
  }

  private async _refreshAlignRunsCompare(root: HTMLElement): Promise<void> {
    const conn = this._conn;
    const hintEl = root.querySelector<HTMLElement>("#act-run-compare-hint");
    const btn = root.querySelector<HTMLButtonElement>("#act-run-compare-refresh");
    if (!conn) {
      if (hintEl) hintEl.textContent = "Aucune connexion sidecar.";
      return;
    }
    if (btn) btn.disabled = true;
    if (hintEl) hintEl.textContent = "Chargement…";
    try {
      const res = await listRuns(conn, { kind: "align", limit: 80 });
      this._alignRunsCompareCache = res.runs ?? [];
      const selA = root.querySelector<HTMLSelectElement>("#act-run-compare-a");
      const selB = root.querySelector<HTMLSelectElement>("#act-run-compare-b");
      const fill = (sel: HTMLSelectElement | null) => {
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = `<option value="">&#8212;</option>`;
        for (const r of this._alignRunsCompareCache) {
          const opt = document.createElement("option");
          opt.value = r.run_id;
          opt.textContent = this._alignRunSelectLabel(r);
          sel.appendChild(opt);
        }
        if (prev && this._alignRunsCompareCache.some(x => x.run_id === prev)) sel.value = prev;
      };
      fill(selA);
      fill(selB);
      const n = this._alignRunsCompareCache.length;
      if (hintEl) {
        hintEl.textContent = n === 0
          ? "Aucun run d’alignement en base. Lancez un alignement (job) puis rechargez."
          : `${n} run(s) — choisissez deux entrées pour comparer.`;
      }
      this._updateAlignRunCompareDiff(root);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (hintEl) hintEl.textContent = `Erreur : ${msg}`;
      this._log(`Runs /runs : ${msg}`, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  private _alignRunSelectLabel(r: RunRecord): string {
    const p = r.params && typeof r.params === "object" ? r.params as Record<string, unknown> : {};
    const s = r.stats && typeof r.stats === "object" ? r.stats as Record<string, unknown> : {};
    const strat = String(p.strategy ?? s.strategy ?? "?");
    const piv = p.pivot_doc_id ?? s.pivot_doc_id;
    const date = (r.created_at || "").slice(0, 10);
    const shortId = r.run_id.length > 12 ? `${r.run_id.slice(0, 8)}…` : r.run_id;
    return `${date} · ${strat} · pivot ${piv ?? "?"} · ${shortId}`;
  }

  private _pickAlignRunParams(r: RunRecord): Record<string, unknown> {
    const p = r.params && typeof r.params === "object" ? r.params as Record<string, unknown> : {};
    const s = r.stats && typeof r.stats === "object" ? r.stats as Record<string, unknown> : {};
    return {
      strategy: p.strategy ?? s.strategy,
      pivot_doc_id: p.pivot_doc_id ?? s.pivot_doc_id,
      target_doc_ids: p.target_doc_ids ?? s.target_doc_ids,
      debug_align: p.debug_align ?? s.debug_align,
      replace_existing: p.replace_existing ?? s.replace_existing,
      preserve_accepted: p.preserve_accepted ?? s.preserve_accepted,
    };
  }

  private _pickAlignRunStats(r: RunRecord): Record<string, unknown> {
    const s = r.stats && typeof r.stats === "object" ? r.stats as Record<string, unknown> : {};
    return {
      total_links_created: s.total_links_created,
      total_effective_links: s.total_effective_links,
      deleted_before: s.deleted_before,
      preserved_before: s.preserved_before,
    };
  }

  private _fmtRunCell(v: unknown): string {
    if (v === undefined || v === null) return "—";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  private _updateAlignRunCompareDiff(root: HTMLElement): void {
    const resultEl = root.querySelector<HTMLElement>("#act-run-compare-result");
    if (!resultEl) return;
    const idA = root.querySelector<HTMLSelectElement>("#act-run-compare-a")?.value ?? "";
    const idB = root.querySelector<HTMLSelectElement>("#act-run-compare-b")?.value ?? "";
    if (!idA || !idB || idA === idB) {
      resultEl.style.display = "none";
      resultEl.innerHTML = "";
      return;
    }
    const runA = this._alignRunsCompareCache.find(x => x.run_id === idA);
    const runB = this._alignRunsCompareCache.find(x => x.run_id === idB);
    if (!runA || !runB) {
      resultEl.style.display = "none";
      return;
    }
    const pa = this._pickAlignRunParams(runA);
    const pb = this._pickAlignRunParams(runB);
    const sta = this._pickAlignRunStats(runA);
    const stb = this._pickAlignRunStats(runB);
    const rows: Array<{ label: string; a: unknown; b: unknown }> = [
      { label: "run_id", a: runA.run_id, b: runB.run_id },
      { label: "created_at", a: runA.created_at, b: runB.created_at },
      { label: "strategy", a: pa.strategy, b: pb.strategy },
      { label: "pivot_doc_id", a: pa.pivot_doc_id, b: pb.pivot_doc_id },
      { label: "target_doc_ids", a: pa.target_doc_ids, b: pb.target_doc_ids },
      { label: "debug_align", a: pa.debug_align, b: pb.debug_align },
      { label: "replace_existing", a: pa.replace_existing, b: pb.replace_existing },
      { label: "preserve_accepted", a: pa.preserve_accepted, b: pb.preserve_accepted },
      { label: "total_links_created", a: sta.total_links_created, b: stb.total_links_created },
      { label: "total_effective_links", a: sta.total_effective_links, b: stb.total_effective_links },
      { label: "deleted_before", a: sta.deleted_before, b: stb.deleted_before },
      { label: "preserved_before", a: sta.preserved_before, b: stb.preserved_before },
    ];

    let html = `<table class="meta-table act-run-compare-table" role="region" aria-label="Comparaison de runs"><thead><tr><th>Champ</th><th>Run A</th><th>Run B</th><th></th></tr></thead><tbody>`;
    for (const row of rows) {
      const sa = this._fmtRunCell(row.a);
      const sb = this._fmtRunCell(row.b);
      const match = sa === sb;
      const icon = match ? '<span title="Identique">=</span>' : '<span title="Différent" style="color:var(--color-warning,#b45309)">≠</span>';
      html += `<tr><td>${_escHtml(row.label)}</td><td><code>${_escHtml(sa)}</code></td><td><code>${_escHtml(sb)}</code></td><td><span aria-hidden="true">${icon}</span></td></tr>`;
    }
    html += `</tbody></table>`;
    resultEl.innerHTML = html;
    resultEl.style.display = "";
  }

  /** Toggle between audit table view and visual run-row view. */
  private _setAlignViewMode(mode: "table" | "run", root: HTMLElement): void {
    this._alignViewMode = mode;
    const tableWrap = root.querySelector<HTMLElement>("#act-audit-table-wrap");
    const runView = root.querySelector<HTMLElement>("#act-audit-run-view");
    const viewTableBtn = root.querySelector<HTMLButtonElement>("#act-audit-view-table");
    const viewRunBtn = root.querySelector<HTMLButtonElement>("#act-audit-view-run");
    if (tableWrap) tableWrap.style.display = mode === "table" ? "" : "none";
    if (runView) runView.style.display = mode === "run" ? "" : "none";
    if (viewTableBtn) { viewTableBtn.classList.toggle("active", mode === "table"); viewTableBtn.setAttribute("aria-pressed", String(mode === "table")); }
    if (viewRunBtn) { viewRunBtn.classList.toggle("active", mode === "run"); viewRunBtn.setAttribute("aria-pressed", String(mode === "run")); }
    if (mode === "run") this._renderAuditRunView(root);
  }

  /** Render the visual "run-row" list from existing _auditLinks data. */
  private _renderAuditRunView(root: HTMLElement): void {
    const container = root.querySelector<HTMLElement>("#act-audit-run-view");
    if (!container) return;
    const visibleLinks = this._computeVisibleAuditLinks();
    if (visibleLinks.length === 0) {
      container.innerHTML = '<p class="live-note">Aucun lien &#224; afficher. Chargez les liens depuis le tableau.</p>';
      container.onclick = null;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const link of visibleLinks) {
      const normalizedStatus = this._normalizeAuditStatus(link.status);
      const dotClass = normalizedStatus === "accepted" ? "dot ok" : normalizedStatus === "rejected" ? "dot bad" : "dot review";
      const dotLabel = normalizedStatus === "accepted" ? "Accepté" : normalizedStatus === "rejected" ? "Rejeté" : "Non révisé";
      const art = document.createElement("article");
      art.className = "run-row";
      art.dataset.linkId = String(link.link_id);
      art.innerHTML = `
        <div class="run-cell run-cell-pivot">
          <span class="run-cell-id">${_escHtml(String(link.external_id ?? "—"))}</span>
          <span class="run-cell-text">${_escHtml(String(link.pivot_text ?? "")).slice(0, 140)}</span>
        </div>
        <div class="status-rail">
          <span class="${dotClass}" title="${dotLabel}"></span>
          <span class="dot-label">${dotLabel}</span>
        </div>
        <div class="run-cell run-cell-target">
          <span class="run-cell-text">${_escHtml(String(link.target_text ?? "")).slice(0, 140)}</span>
          <span class="run-row-actions">
            <button class="btn btn-sm btn-secondary run-accept-btn" data-id="${link.link_id}" title="Accepter" aria-label="Accepter ce lien">✓</button>
            <button class="btn btn-sm btn-danger run-reject-btn" data-id="${link.link_id}" title="Rejeter" aria-label="Rejeter ce lien">✗</button>
          </span>
        </div>
      `;
      frag.appendChild(art);
    }
    container.innerHTML = "";
    container.appendChild(frag);
    // Delegate run-row actions (single handler, replaced each render).
    container.onclick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (!id) return;
      this._auditSelectedLinkId = id;
      if (btn.classList.contains("run-accept-btn")) void this._runFocusStatusAction(root, "accepted");
      else if (btn.classList.contains("run-reject-btn")) void this._runFocusStatusAction(root, "rejected");
    };
  }

  private _wireSegAdvancedControls(segPanel: HTMLElement): void {
    const unsupportedMsg = "Option non supportée dans ce flux (FW-1). Utiliser le champ Pack.";
    const scopeSelection = segPanel.querySelector<HTMLInputElement>("#act-seg-scope-selection");
    const scopeDocument = segPanel.querySelector<HTMLInputElement>("#act-seg-scope-document");
    if (scopeSelection) {
      scopeSelection.disabled = true;
      scopeSelection.checked = false;
      scopeSelection.title = unsupportedMsg;
    }
    if (scopeDocument) scopeDocument.checked = true;
    [
      "#act-seg-sep-dot",
      "#act-seg-sep-qmark",
      "#act-seg-sep-bang",
      "#act-seg-sep-slash",
      "#act-seg-sep-semicolon",
      "#act-seg-sep-colon",
    ].forEach((sel) => {
      const cb = segPanel.querySelector<HTMLInputElement>(sel);
      if (!cb) return;
      cb.disabled = true;
      cb.title = unsupportedMsg;
    });
    segPanel.querySelectorAll<HTMLInputElement>('input[name="seg-preset"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        const preset = radio.value === "strict" || radio.value === "extended" || radio.value === "custom"
          ? radio.value
          : "extended";
        this._setSegPreset(segPanel, preset);
      });
    });
    this._syncSegPresetFromPack(segPanel);
  }

  private _strictPackForLang(lang: string): "fr_strict" | "en_strict" | "default" {
    const norm = lang.trim().toLowerCase();
    if (norm.startsWith("fr")) return "fr_strict";
    if (norm.startsWith("en")) return "en_strict";
    return "default";
  }

  private _setSegPreset(segPanel: HTMLElement, preset: "strict" | "extended" | "custom"): void {
    const packSel = segPanel.querySelector<HTMLSelectElement>("#act-seg-pack");
    const langInput = segPanel.querySelector<HTMLInputElement>("#act-seg-lang");
    if (!packSel || !langInput) return;
    const strictPack = this._strictPackForLang(langInput.value || "und");
    if (preset === "strict") {
      packSel.value = strictPack;
    } else if (preset === "extended") {
      packSel.value = "auto";
    } else if (preset === "custom" && packSel.value === "auto") {
      packSel.value = "default";
    }
    const ltPack = segPanel.querySelector<HTMLSelectElement>("#act-seg-lt-pack");
    if (ltPack) ltPack.value = packSel.value;
    this._syncSegPresetFromPack(segPanel);
    this._refreshSegmentationStatusUI();
  }

  private _applyStrictPresetIfActive(segPanel: HTMLElement): void {
    const currentPreset = segPanel.querySelector<HTMLInputElement>('input[name="seg-preset"]:checked')?.value;
    if (currentPreset !== "strict") return;
    const packSel = segPanel.querySelector<HTMLSelectElement>("#act-seg-pack");
    const langInput = segPanel.querySelector<HTMLInputElement>("#act-seg-lang");
    if (!packSel || !langInput) return;
    const strictPack = this._strictPackForLang(langInput.value || "und");
    if (packSel.value !== strictPack) {
      packSel.value = strictPack;
      const ltPack = segPanel.querySelector<HTMLSelectElement>("#act-seg-lt-pack");
      if (ltPack) ltPack.value = strictPack;
    }
  }

  private _syncSegPresetFromPack(segPanel: HTMLElement): void {
    const packSel = segPanel.querySelector<HTMLSelectElement>("#act-seg-pack");
    const langInput = segPanel.querySelector<HTMLInputElement>("#act-seg-lang");
    if (!packSel || !langInput) return;
    const strictPack = this._strictPackForLang(langInput.value || "und");
    const pack = (packSel.value || "auto").trim();
    let nextPreset: "strict" | "extended" | "custom" = "custom";
    if (pack === "auto") nextPreset = "extended";
    else if (pack === strictPack) nextPreset = "strict";
    const radio = segPanel.querySelector<HTMLInputElement>(`input[name="seg-preset"][value="${nextPreset}"]`);
    if (radio) radio.checked = true;
  }

  // ─── Long text helpers ───────────────────────────────────────────────────────

  private _syncLongtextSelectors(segPanel: HTMLElement): void {
    const normDoc = segPanel.querySelector<HTMLSelectElement>("#act-seg-doc");
    const ltDoc = segPanel.querySelector<HTMLSelectElement>("#act-seg-lt-doc");
    if (normDoc && ltDoc && normDoc.value) ltDoc.value = normDoc.value;
    const normLang = segPanel.querySelector<HTMLInputElement>("#act-seg-lang");
    const ltLang = segPanel.querySelector<HTMLInputElement>("#act-seg-lt-lang");
    if (normLang && ltLang) ltLang.value = normLang.value;
    const normPack = segPanel.querySelector<HTMLSelectElement>("#act-seg-pack");
    const ltPack = segPanel.querySelector<HTMLSelectElement>("#act-seg-lt-pack");
    if (normPack && ltPack) ltPack.value = normPack.value;
  }

  private _checkLongtextHint(segPanel: HTMLElement): void {
    const THRESHOLD = 12_000;
    const docSel = segPanel.querySelector<HTMLSelectElement>("#act-seg-doc");
    const hint = segPanel.querySelector<HTMLElement>("#act-seg-longtext-hint");
    if (!docSel || !docSel.value || !hint) return;
    const docId = parseInt(docSel.value);
    const doc = this._docs.find(d => d.doc_id === docId);
    const charCount = (doc as unknown as { char_count?: number })?.char_count ?? 0;
    hint.style.display = (charCount > THRESHOLD && !this._segLongTextMode) ? "" : "none";
  }

  // ── Longtext inline search ──────────────────────────────────────────────────

  /** Closes the search bar, clears highlights and resets state. */
  private _closeLtSearch(el: HTMLElement): void {
    this._ltSearchOpen = false;
    const chip = el.querySelector<HTMLButtonElement>("[data-chip='search']");
    const bar = el.querySelector<HTMLElement>("#act-seg-lt-search-bar");
    const input = el.querySelector<HTMLInputElement>("#act-seg-lt-search-input");
    if (chip) chip.classList.remove("active");
    if (bar) bar.style.display = "none";
    if (input) input.value = "";
    (["#act-seg-lt-raw-scroll", "#act-seg-lt-seg-scroll", "#act-seg-lt-diff-scroll"] as const)
      .forEach(id => {
        const scroll = el.querySelector<HTMLElement>(id);
        if (scroll) this._clearLtSearchHighlights(scroll);
      });
  }

  /** Returns the scrollable container of the currently visible longtext pane. */
  private _getActiveLtPane(el: HTMLElement): HTMLElement | null {
    const paneIds = ["#act-seg-lt-pane-raw", "#act-seg-lt-pane-seg", "#act-seg-lt-pane-diff"];
    for (const id of paneIds) {
      const pane = el.querySelector<HTMLElement>(id);
      if (pane && pane.style.display !== "none") {
        return pane.querySelector<HTMLElement>(".doc-scroll");
      }
    }
    return null;
  }

  /**
   * Filters and highlights `query` across direct children of `scroll`.
   * Stores original text in `data-raw-text` to avoid re-highlighting.
   */
  private _applyLtSearchFilter(scroll: HTMLElement, query: string): void {
    const children = Array.from(scroll.children) as HTMLElement[];
    if (!query) {
      children.forEach(child => {
        if (child.dataset.rawText !== undefined) {
          child.textContent = child.dataset.rawText;
          delete child.dataset.rawText;
        }
        child.style.display = "";
      });
      return;
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${escaped})`, "gi");
    const lq = query.toLowerCase();
    children.forEach(child => {
      if (child.dataset.rawText === undefined) {
        child.dataset.rawText = child.textContent ?? "";
      }
      const raw = child.dataset.rawText;
      if (raw.toLowerCase().includes(lq)) {
        child.style.display = "";
        // Build HTML: split by match (capturing group → odd indices are matches)
        const parts = raw.split(re);
        child.innerHTML = parts.map((part, idx) =>
          idx % 2 === 1 ? `<mark>${_escHtml(part)}</mark>` : _escHtml(part)
        ).join("");
      } else {
        child.style.display = "none";
      }
    });
  }

  /** Restores all children of `scroll` to their original text and shows them. */
  private _clearLtSearchHighlights(scroll: HTMLElement): void {
    (Array.from(scroll.children) as HTMLElement[]).forEach(child => {
      if (child.dataset.rawText !== undefined) {
        child.textContent = child.dataset.rawText;
        delete child.dataset.rawText;
      }
      child.style.display = "";
    });
  }

  // ── Longtext scroll sync ─────────────────────────────────────────────────────

  private _bindLongtextScrollSync(): void {
    const el = this._root?.querySelector<HTMLElement>('[data-panel="segmentation"]');
    if (!el) return;
    const rawEl = el.querySelector<HTMLElement>("#act-seg-lt-raw-scroll");
    const segEl = el.querySelector<HTMLElement>("#act-seg-lt-seg-scroll");
    if (!rawEl || !segEl) return;
    this._unbindLongtextScrollSync();
    this._onLtRawScroll = () => {
      if (this._ltSyncLock) return;
      this._ltSyncLock = true;
      const maxRaw = rawEl.scrollHeight - rawEl.clientHeight;
      const ratio = maxRaw > 0 ? rawEl.scrollTop / maxRaw : 0;
      segEl.scrollTop = ratio * Math.max(0, segEl.scrollHeight - segEl.clientHeight);
      requestAnimationFrame(() => { this._ltSyncLock = false; });
    };
    this._onLtSegScroll = () => {
      if (this._ltSyncLock) return;
      this._ltSyncLock = true;
      const maxSeg = segEl.scrollHeight - segEl.clientHeight;
      const ratio = maxSeg > 0 ? segEl.scrollTop / maxSeg : 0;
      rawEl.scrollTop = ratio * Math.max(0, rawEl.scrollHeight - rawEl.clientHeight);
      requestAnimationFrame(() => { this._ltSyncLock = false; });
    };
    rawEl.addEventListener("scroll", this._onLtRawScroll);
    segEl.addEventListener("scroll", this._onLtSegScroll);
  }

  private _unbindLongtextScrollSync(): void {
    const el = this._root?.querySelector<HTMLElement>('[data-panel="segmentation"]');
    if (!el) return;
    const rawEl = el.querySelector<HTMLElement>("#act-seg-lt-raw-scroll");
    const segEl = el.querySelector<HTMLElement>("#act-seg-lt-seg-scroll");
    if (rawEl && this._onLtRawScroll) {
      rawEl.removeEventListener("scroll", this._onLtRawScroll);
      this._onLtRawScroll = null;
    }
    if (segEl && this._onLtSegScroll) {
      segEl.removeEventListener("scroll", this._onLtSegScroll);
      this._onLtSegScroll = null;
    }
    this._ltSyncLock = false;
  }

  /** Sync scroll between split-panel preview columns (`#act-seg-prev-raw` ↔ `#act-seg-prev-seg`). */
  private _bindSegPreviewScrollSync(): void {
    this._unbindSegPreviewScrollSync();
    const rawEl = document.querySelector<HTMLElement>("#act-seg-prev-raw");
    const segEl = document.querySelector<HTMLElement>("#act-seg-prev-seg");
    if (!rawEl || !segEl) return;
    this._onSegPrevRawScroll = () => {
      if (this._segPrevSyncLock) return;
      this._segPrevSyncLock = true;
      const maxRaw = rawEl.scrollHeight - rawEl.clientHeight;
      const ratio = maxRaw > 0 ? rawEl.scrollTop / maxRaw : 0;
      segEl.scrollTop = ratio * Math.max(0, segEl.scrollHeight - segEl.clientHeight);
      requestAnimationFrame(() => { this._segPrevSyncLock = false; });
    };
    this._onSegPrevSegScroll = () => {
      if (this._segPrevSyncLock) return;
      this._segPrevSyncLock = true;
      const maxSeg = segEl.scrollHeight - segEl.clientHeight;
      const ratio = maxSeg > 0 ? segEl.scrollTop / maxSeg : 0;
      rawEl.scrollTop = ratio * Math.max(0, rawEl.scrollHeight - rawEl.clientHeight);
      requestAnimationFrame(() => { this._segPrevSyncLock = false; });
    };
    rawEl.addEventListener("scroll", this._onSegPrevRawScroll);
    segEl.addEventListener("scroll", this._onSegPrevSegScroll);
  }

  private _unbindSegPreviewScrollSync(): void {
    const rawEl = document.querySelector<HTMLElement>("#act-seg-prev-raw");
    const segEl = document.querySelector<HTMLElement>("#act-seg-prev-seg");
    if (rawEl && this._onSegPrevRawScroll) {
      rawEl.removeEventListener("scroll", this._onSegPrevRawScroll);
      this._onSegPrevRawScroll = null;
    }
    if (segEl && this._onSegPrevSegScroll) {
      segEl.removeEventListener("scroll", this._onSegPrevSegScroll);
      this._onSegPrevSegScroll = null;
    }
    this._segPrevSyncLock = false;
  }

  private _syncSegStrategyRadios(): void {
    const s = document.querySelector<HTMLInputElement>("#act-seg-strategy-sentences");
    const m = document.querySelector<HTMLInputElement>("#act-seg-strategy-markers");
    if (!s || !m) return;
    if (this._segSplitMode === "markers") {
      m.checked = true;
      s.checked = false;
    } else {
      s.checked = true;
      m.checked = false;
    }
  }

  private _setSegPackSelectDisabled(disabled: boolean): void {
    const packSel = document.querySelector<HTMLSelectElement>("#act-seg-pack");
    if (!packSel) return;
    packSel.disabled = disabled;
    if (disabled) packSel.setAttribute("aria-disabled", "true");
    else packSel.removeAttribute("aria-disabled");
  }

  private _updateSegStrategySummary(): void {
    const el = document.querySelector<HTMLElement>("#act-seg-strategy-summary");
    if (!el) return;
    if (this._segSplitMode === "markers") {
      el.textContent =
        "R\u00e8gle active : découpe sur les balises [N] présentes dans le texte (utile si [N] n'a pas été absorbé à l'import). Le préfixe avant [1] reste un segment séparé sans external_id.";
      return;
    }
    const packSel = document.querySelector<HTMLSelectElement>("#act-seg-pack");
    const label = packSel?.selectedOptions[0]?.textContent?.trim() ?? packSel?.value ?? "";
    el.textContent =
      `R\u00e8gle active : phrases automatiques \u2014 \u00ab ${label} \u00bb (d\u00e9tail sous \u00ab Moteur de d\u00e9coupage \u00bb).`;
  }

  // ── Curation preview scroll sync (#act-preview-raw ↔ #act-diff-list) ───────────────

  private _bindCurateScrollSync(): void {
    const panel = this._root?.querySelector<HTMLElement>('[data-panel="curation"]');
    const rawEl = panel?.querySelector<HTMLElement>("#act-preview-raw")
      ?? document.querySelector<HTMLElement>("#act-preview-raw");
    const diffEl = panel?.querySelector<HTMLElement>("#act-diff-list")
      ?? document.querySelector<HTMLElement>("#act-diff-list");
    if (!rawEl || !diffEl) return;
    this._unbindCurateScrollSync();
    this._onCurateRawScroll = () => {
      if (!this._previewSyncScroll || this._curateSyncLock) return;
      this._curateSyncLock = true;
      const maxRaw = rawEl.scrollHeight - rawEl.clientHeight;
      const ratio = maxRaw > 0 ? rawEl.scrollTop / maxRaw : 0;
      diffEl.scrollTop = ratio * Math.max(0, diffEl.scrollHeight - diffEl.clientHeight);
      requestAnimationFrame(() => { this._curateSyncLock = false; });
    };
    this._onCurateDiffScroll = () => {
      if (!this._previewSyncScroll || this._curateSyncLock) return;
      this._curateSyncLock = true;
      const maxDiff = diffEl.scrollHeight - diffEl.clientHeight;
      const ratio = maxDiff > 0 ? diffEl.scrollTop / maxDiff : 0;
      rawEl.scrollTop = ratio * Math.max(0, rawEl.scrollHeight - rawEl.clientHeight);
      requestAnimationFrame(() => { this._curateSyncLock = false; });
    };
    rawEl.addEventListener("scroll", this._onCurateRawScroll);
    diffEl.addEventListener("scroll", this._onCurateDiffScroll);
  }

  private _unbindCurateScrollSync(): void {
    const panel = this._root?.querySelector<HTMLElement>('[data-panel="curation"]');
    const rawEl = panel?.querySelector<HTMLElement>("#act-preview-raw")
      ?? document.querySelector<HTMLElement>("#act-preview-raw");
    const diffEl = panel?.querySelector<HTMLElement>("#act-diff-list")
      ?? document.querySelector<HTMLElement>("#act-diff-list");
    if (rawEl && this._onCurateRawScroll) {
      rawEl.removeEventListener("scroll", this._onCurateRawScroll);
      this._onCurateRawScroll = null;
    }
    if (diffEl && this._onCurateDiffScroll) {
      diffEl.removeEventListener("scroll", this._onCurateDiffScroll);
      this._onCurateDiffScroll = null;
    }
    this._curateSyncLock = false;
  }

  /**
   * Attaches a RAF-throttled scroll listener to update the .mm-zone viewport indicator.
   * Also fires on tab-bar clicks (pane change). Returns a cleanup function.
   */
  private _setupMmZone(previewBody: HTMLElement, mmEl: HTMLElement): () => void {
    let rafPending = false;
    const update = () => {
      const zone = mmEl.querySelector<HTMLElement>(".mm-zone");
      if (!zone) return;
      const scroll = Array.from(previewBody.querySelectorAll<HTMLElement>(".pane .doc-scroll"))
        .find(s => (s.closest<HTMLElement>(".pane") as HTMLElement).style.display !== "none");
      if (!scroll || scroll.scrollHeight <= 0) { zone.style.display = "none"; rafPending = false; return; }
      zone.style.display = "";
      const maxScroll = scroll.scrollHeight - scroll.clientHeight;
      if (maxScroll <= 0) { zone.style.top = "0%"; zone.style.height = "40%"; rafPending = false; return; }
      const ratioTop = scroll.scrollTop / maxScroll;
      const ratioH = scroll.clientHeight / scroll.scrollHeight;
      zone.style.top = `${Math.round(ratioTop * 100)}%`;
      zone.style.height = `${Math.max(6, Math.min(40, Math.round(ratioH * 100)))}%`;
      rafPending = false;
    };
    const onScroll = () => { if (!rafPending) { rafPending = true; requestAnimationFrame(update); } };
    // Tab switch: defer via microtask so the DOM (pane display) reflects the new tab before update reads it
    const onTabClick = () => queueMicrotask(() => { rafPending = false; onScroll(); });
    previewBody.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const tabBar = mmEl.closest<HTMLElement>("article.preview")?.querySelector<HTMLElement>(".preview-tabs");
    tabBar?.addEventListener("click", onTabClick);
    // Store updater so _renderMinimap can trigger a zone refresh post-render
    this._mmZoneUpdaters.set(mmEl, update);
    update();
    return () => {
      previewBody.removeEventListener("scroll", onScroll, { capture: true });
      tabBar?.removeEventListener("click", onTabClick);
      this._mmZoneUpdaters.delete(mmEl);
    };
  }

  _updateLongtextPreview(segPanel: HTMLElement | null): void {
    if (!segPanel || !this._lastSegmentReport) return;
    const r = this._lastSegmentReport;
    const statsEl = segPanel.querySelector<HTMLElement>("#act-seg-lt-stats");
    if (statsEl) {
      statsEl.innerHTML =
        `<div class="seg-stat"><span class="quality-label">Unités entrée</span><strong>${r.units_input}</strong></div>` +
        `<div class="seg-stat"><span class="quality-label">Unités sortie</span><strong>${r.units_output}</strong></div>` +
        (r.warnings?.length ? `<div class="seg-stat"><span class="quality-label">Suspects</span><strong style="color:var(--color-warning)">${r.warnings.length}</strong></div>` : "");
    }
    const headEl = segPanel.querySelector<HTMLElement>("#act-seg-lt-seg-head");
    if (headEl) headEl.textContent = `Segmentation proposée — ${r.units_output} segments`;
    const footEl = segPanel.querySelector<HTMLElement>("#act-seg-lt-footer-stats");
    if (footEl) footEl.textContent = `${r.units_output} segments • ${r.units_input} → ${r.units_output}`;
    const pillEl = segPanel.querySelector<HTMLElement>("#act-seg-lt-pill");
    if (pillEl) pillEl.textContent = `doc#${r.doc_id} · ${r.segment_pack ?? "auto"}`;
    const mmEl = segPanel.querySelector<HTMLElement>("#act-seg-lt-minimap");
    if (mmEl) this._renderMinimap(mmEl, r.units_output, r.warnings?.length ?? 0);
    // Show doc-final-bar for longtext + enable Appliquer if pending validation
    const ltBar = segPanel.querySelector<HTMLElement>("#act-seg-lt-final-bar");
    const ltMeta = segPanel.querySelector<HTMLElement>("#act-seg-lt-final-meta");
    const ltApplyBtn = segPanel.querySelector<HTMLButtonElement>("#act-seg-lt-final-apply");
    if (ltBar) ltBar.removeAttribute("hidden");
    if (ltMeta) {
      const warnSuffix = r.warnings?.length ? ` · ${r.warnings.length} avert.` : "";
      ltMeta.textContent = `doc#${r.doc_id} · ${r.units_output} segments${warnSuffix}`;
    }
    if (ltApplyBtn) ltApplyBtn.disabled = !this._segmentPendingValidation;
  }

  /** Fills a minimap element with bucket bars. Changed buckets mark warning density. */
  /** Render vnext-style minimap: track + zone + marks (warn/seg).
   *  Used by segmentation minimaps (.minimap-track elements).
   *  For curation, _renderCurateMinimap uses bucket style independently. */
  private _renderMinimap(mmEl: HTMLElement, totalUnits: number, warnCount: number): void {
    // Base structure always visible (even with 0 units)
    const MAX_SEG_MARKS = 5;
    const MAX_WARN_MARKS = 4;

    // Compute segment mark positions (evenly distributed)
    const segCount = Math.min(Math.max(totalUnits > 0 ? Math.ceil(totalUnits / 10) : 0, 1), MAX_SEG_MARKS);
    const segMarks = totalUnits > 0
      ? Array.from({ length: segCount }, (_, i) => Math.round(10 + (i / (segCount - 1 || 1)) * 70))
      : [];

    // Compute warning mark positions (distributed across 15%–85%)
    const warnCount2 = Math.min(warnCount, MAX_WARN_MARKS);
    const warnMarks = warnCount2 > 0
      ? Array.from({ length: warnCount2 }, (_, i) => Math.round(15 + (i / (warnCount2 - 1 || 1)) * 70))
      : [];

    const segMarkHtml = segMarks.map(top => `<div class="mm-mark seg" style="top:${top}%"></div>`).join("");
    const warnMarkHtml = warnMarks.map(top => `<div class="mm-mark warn" style="top:${top}%"></div>`).join("");

    mmEl.innerHTML = `<div class="mm-track"></div><div class="mm-zone"></div>${segMarkHtml}${warnMarkHtml}`;
    // Refresh viewport zone after minimap content is replaced (P20 Inc 3)
    const zoneUpdater = this._mmZoneUpdaters.get(mmEl);
    if (zoneUpdater) requestAnimationFrame(zoneUpdater);
  }

  private _updateTraductionPreview(): void {
    const segPanel = this._root?.querySelector<HTMLElement>('[data-panel="segmentation"]');
    if (!segPanel || !this._lastSegmentReport) return;
    const r = this._lastSegmentReport;
    const warns = r.warnings ?? [];
    const warnHtml = warns.length
      ? `<div class="seg-warn-list">${warns.map((w) => `<div class="seg-warn">${_escHtml(w)}</div>`).join("")}</div>`
      : `<p style="font-size:12px;color:#1a7f4e;margin:6px 0 0">&#10003; Aucun avertissement</p>`;
    const targetScroll = segPanel.querySelector<HTMLElement>("#act-seg-tr-target-scroll");
    if (targetScroll) {
      targetScroll.innerHTML = `
        <div class="seg-stats-grid" style="margin:8px 0">
          <div class="seg-stat"><span class="quality-label">Unités avant</span><strong>${r.units_input}</strong></div>
          <div class="seg-stat"><span class="quality-label">Segments après</span><strong>${r.units_output}</strong></div>
          <div class="seg-stat"><span class="quality-label">R&#233;glage phrases</span><strong>${_escHtml(r.segment_pack === "markers" ? "balises [N]" : (r.segment_pack ?? "auto"))}</strong></div>
          <div class="seg-stat"><span class="quality-label">Avertissements</span><strong>${warns.length}</strong></div>
        </div>
        ${warnHtml}
      `;
    }
    const footEl = segPanel.querySelector<HTMLElement>("#act-seg-tr-footer-stats");
    if (footEl) {
      const doc = this._docs.find(d => d.doc_id === r.doc_id);
      const docLabel = doc ? `${_escHtml(doc.title)} [${_escHtml(doc.language)}]` : `doc#${r.doc_id}`;
      footEl.textContent = `${docLabel} · ${r.units_output} segments · ${r.segment_pack === "markers" ? "balises [N]" : `coupes ${r.segment_pack ?? "auto"}`}`;
    }
    const mmEl = segPanel.querySelector<HTMLElement>("#act-seg-tr-minimap");
    if (mmEl) this._renderMinimap(mmEl, r.units_output, r.warnings?.length ?? 0);
    // Show doc-final-bar for traduction + enable Valider if pending validation
    const trBar = segPanel.querySelector<HTMLElement>("#act-seg-tr-final-bar");
    const trMeta = segPanel.querySelector<HTMLElement>("#act-seg-tr-final-meta");
    const trValBtn = segPanel.querySelector<HTMLButtonElement>("#act-seg-tr-final-validate");
    if (trBar) trBar.removeAttribute("hidden");
    if (trMeta) {
      const doc = this._docs.find(d => d.doc_id === r.doc_id);
      const docLabel = doc ? `${doc.title}` : `doc#${r.doc_id}`;
      trMeta.textContent = `${docLabel} · ${r.units_output} segments · ${r.segment_pack === "markers" ? "balises [N]" : `coupes ${r.segment_pack ?? "auto"}`}`;
    }
    if (trValBtn) trValBtn.disabled = !this._segmentPendingValidation;
  }

  /**
   * Loads VO document lines via getDocumentPreview with incremental pagination.
   * Shows an "Afficher X de plus" button when total_lines > current limit.
   * Stores current limit per docId in _voPreviewLimitByDocId.
   */
  private async _loadVoSegmentsPreview(el: HTMLElement, docId: number, limit?: number): Promise<void> {
    const voScrollEl = el.querySelector<HTMLElement>("#act-seg-tr-vo-scroll");
    if (!voScrollEl || !this._conn) return;
    const VO_STEPS = [100, 500, 2000];
    const currentLimit = limit ?? this._voPreviewLimitByDocId.get(docId) ?? VO_STEPS[0];
    voScrollEl.innerHTML = '<p class="empty-hint">Chargement des unit&#233;s VO&#8230;</p>';
    try {
      const preview = await getDocumentPreview(this._conn, docId, currentLimit);
      this._voPreviewLimitByDocId.set(docId, currentLimit);
      if (!preview.lines.length) {
        voScrollEl.innerHTML = '<p class="empty-hint">Aucune unit&#233; disponible pour ce document VO.</p>';
        return;
      }
      const header = `<div class="seg-ref-doc-row"><span>${_escHtml(preview.doc.title)}</span><span class="seg-ref-doc-id">[${preview.doc.doc_id}] ${_escHtml(preview.doc.language)} &mdash; ${preview.total_lines}&nbsp;unit&#233;s</span></div>`;
      const lines = preview.lines.map(l =>
        `<div class="vo-line"><span class="vo-ln">${l.n}</span><span class="vo-txt">${_escHtml(l.text)}</span></div>`
      ).join("");
      const hasMore = preview.total_lines > currentLimit;
      const nextStep = VO_STEPS.find(s => s > currentLimit) ?? preview.total_lines;
      const remaining = preview.total_lines - currentLimit;
      const loadMoreHtml = hasMore
        ? `<button class="btn btn-secondary btn-sm vo-load-more" data-doc-id="${docId}" data-next-limit="${nextStep}">Afficher ${Math.min(remaining, nextStep - currentLimit)} de plus (${currentLimit}/${preview.total_lines})</button>`
        : "";
      voScrollEl.innerHTML = header + lines + loadMoreHtml;
      // Wire load-more button
      const moreBtn = voScrollEl.querySelector<HTMLButtonElement>(".vo-load-more");
      if (moreBtn) {
        moreBtn.addEventListener("click", async () => {
          moreBtn.textContent = "Chargement\u2026";
          moreBtn.disabled = true;
          const nextLimit = parseInt(moreBtn.dataset.nextLimit ?? String(preview.total_lines), 10);
          await this._loadVoSegmentsPreview(el, docId, nextLimit);
        });
      }
    } catch {
      voScrollEl.innerHTML = '<p class="empty-hint">Impossible de charger les segments VO.</p>';
    }
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._docs = [];
    this._alignExplainability = [];
    this._alignRunId = null;
    this._lastSegmentReport = null;
    this._segmentPendingValidation = false;
    this._segFocusMode = false;
    this._voPreviewLimitByDocId.clear();
    this._mmScrollCleanups.forEach(fn => fn());
    this._mmScrollCleanups = [];
    this._hasPendingPreview = false;
    this._lastAuditEmpty = false;
    this._auditSelectedLinkId = null;
    this._curateExamples = [];
    this._activeDiffIdx = null;
    this._curateRuleLabels = [];
    this._activeRuleFilter = null;
    this._activeStatusFilter = null;
    this._curateGlobalChanged = 0;
    this._lastApplyResult = null;
    this._applyHistory = [];
    const _rec = document.querySelector<HTMLElement>("#act-review-export-card");
    if (_rec) _rec.style.display = "none";
    this._curateRestoredCount = 0;
    this._curateSavedCount = 0;
    this._curateUnitsTotal = 0;
    this._editingManualOverride = false;
    this._curateExceptions = new Map();
    if (!conn) {
      this._lastErrorMsg = null;
    }
    this._setButtonsEnabled(false);
    this._renderCurateQuickQueue();
    this._refreshCurateHeaderState();
    if (conn) {
      this._loadDocs();
      // Restore workflow run_id from localStorage
      const savedRunId = localStorage.getItem(ActionsScreen.LS_WF_RUN_ID);
      if (savedRunId) {
        this._alignRunId = savedRunId;
        this._wfSyncRunId();
      }
      this._wfEnableButtons(true);
    } else {
      this._wfEnableButtons(false);
    }
    if (this._wfRoot) {
      this._wfRoot.classList.remove("seg-focus-mode");
      const focusBtn = this._wfRoot.querySelector<HTMLButtonElement>("#act-seg-focus-toggle");
      if (focusBtn) focusBtn.textContent = "Mode focus segmentation";
      this._refreshSegmentationStatusUI();
    }
    this._refreshRuntimeState();
    // Refresh annotation panel if it was rendered before conn was available.
    if (conn) this._annotRefreshIfVisible();
  }

  /** Public API: called from app.ts after RG→Prep token navigation. */
  annotFocusDoc(docId: number, tokenId?: number): void {
    const panel = this._annotPanelEl;
    if (!panel) return;
    const li = panel.querySelector<HTMLElement>(`.annot-doc-item[data-doc-id="${docId}"]`);
    if (li) {
      li.click();
      li.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    // After tokens load, highlight the token
    if (tokenId != null) {
      const tryHighlight = (): void => {
        const tokEl = panel.querySelector<HTMLElement>(`.annot-token[data-token-id="${tokenId}"]`);
        if (tokEl) {
          tokEl.scrollIntoView({ behavior: "smooth", block: "center" });
          tokEl.classList.add("annot-token--highlighted");
          setTimeout(() => tokEl.classList.remove("annot-token--highlighted"), 2500);
        }
      };
      // Retry a few times to wait for async token load
      setTimeout(tryHighlight, 400);
      setTimeout(tryHighlight, 900);
    }
  }

  private _annotRefreshIfVisible(): void {
    const panel = this._annotPanelEl;
    if (!panel) return;
    const sidebar = panel.querySelector<HTMLElement>(".annot-sidebar");
    const viewer  = panel.querySelector<HTMLElement>(".annot-viewer");
    const editor  = panel.querySelector<HTMLElement>(".annot-editor");
    if (sidebar && viewer && editor) {
      this._annotLoadDocs(sidebar, viewer, editor);
    }
  }

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  setOnOpenDocuments(cb: (() => void) | null): void {
    this._openDocumentsTab = cb;
  }

  setOnOpenExporter(cb: ((prefill?: ActionsExportPrefill) => void) | null): void {
    this._openExporterTab = cb;
  }

  hasPendingChanges(): boolean {
    return this._hasPendingPreview || this._segmentPendingValidation;
  }

  pendingChangesMessage(): string {
    if (this._hasPendingPreview && this._segmentPendingValidation) {
      return "Prévisualisation curation et segmentation non validée en attente. Quitter cet onglet ?";
    }
    if (this._segmentPendingValidation) {
      return "Une segmentation est en attente de validation document. Quitter cet onglet ?";
    }
    return "Une prévisualisation de curation non appliquée est en attente. Quitter cet onglet ?";
  }

  /** Apply a project preset to the current form fields (non-destructive). */
  applyPreset(preset: ProjectPreset): void {
    const root = this._wfRoot;
    if (!root) return;
    const setVal = (sel: string, val: string | undefined): void => {
      if (!val) return;
      const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
      if (el) { el.value = val; el.dispatchEvent(new Event("change")); }
    };
    setVal("#act-seg-lang", preset.segmentation_lang);
    setVal("#act-seg-pack", preset.segmentation_pack);
    this._applyCurationPreset(root, preset.curation_preset);
    setVal("#act-align-strategy", preset.alignment_strategy);
    if (preset.similarity_threshold !== undefined) {
      setVal("#act-sim-threshold", String(preset.similarity_threshold));
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _log(msg: string, isError = false): void {
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = isError ? "log-line log-error" : "log-line";
    line.textContent = `[${ts}] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
    if (isError) {
      this._lastErrorMsg = msg;
    } else if (msg.trim().startsWith("✓")) {
      this._lastErrorMsg = null;
    }
    this._refreshRuntimeState();
  }

  private _scrollToSection(root: HTMLElement, selector: string): void {
    const target = root.querySelector<HTMLElement>(selector);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private _setBusy(v: boolean): void {
    this._isBusy = v;
    this._busyEl.style.display = v ? "flex" : "none";
    this._refreshRuntimeState();
  }

  private _setRuntimeState(kind: "ok" | "info" | "warn" | "error", text: string): void {
    if (!this._stateEl) return;
    this._stateEl.className = `runtime-state state-${kind}`;
    this._stateEl.textContent = text;
  }

  private _refreshRuntimeState(): void {
    this._refreshCurateHeaderState();
    if (!this._stateEl) return;
    if (!this._conn) {
      this._setRuntimeState("error", "Sidecar indisponible. Ouvrez un projet ou relancez la connexion.");
      return;
    }
    if (this._isBusy) {
      this._setRuntimeState("info", "Opération en cours…");
      return;
    }
    if (this._hasPendingPreview) {
      this._setRuntimeState("warn", "Prévisualisation prête: appliquez ou relancez avant de quitter la section.");
      return;
    }
    if (this._segmentPendingValidation) {
      this._setRuntimeState("warn", "Segmentation terminée: validez le document pour finaliser le workflow.");
      return;
    }
    if (this._lastErrorMsg) {
      this._setRuntimeState("warn", `Dernière erreur: ${this._lastErrorMsg}`);
      return;
    }
    if (this._docs.length === 0) {
      this._setRuntimeState("info", "Aucun document importé pour le moment.");
      return;
    }
    if (this._lastAuditEmpty) {
      this._setRuntimeState("info", "Aucun alignement trouvé pour le filtre courant.");
      return;
    }
    this._setRuntimeState("ok", "Session prête: vous pouvez lancer des actions.");
  }

  private _setButtonsEnabled(on: boolean): void {
    ["act-preview-btn", "act-curate-btn", "act-seg-btn", "act-align-btn", "act-align-recalc-btn",
     "act-seg-validate-btn", "act-seg-validate-only-btn", "act-seg-focus-toggle",
     "act-seg-open-export-btn", "act-seg-lt-open-export-btn", "act-align-open-export-btn",
     "act-meta-btn", "act-index-btn", "act-quality-btn", "act-coll-load-btn",
     "act-report-btn"].forEach(id => {
      const el = document.querySelector(`#${id}`) as HTMLButtonElement | null;
      if (el) el.disabled = !on;
    });
  }

  private _readAuditExceptionsOnlyPref(): boolean {
    try {
      return localStorage.getItem(ActionsScreen.LS_AUDIT_EXCEPTIONS_ONLY) === "1";
    } catch {
      return false;
    }
  }

  private _writeAuditExceptionsOnlyPref(value: boolean): void {
    try {
      localStorage.setItem(ActionsScreen.LS_AUDIT_EXCEPTIONS_ONLY, value ? "1" : "0");
    } catch {
      // ignore preference persistence failure
    }
  }

  private _readAuditQuickFilterPref(): "all" | "review" | "unreviewed" | "rejected" {
    try {
      const raw = localStorage.getItem(ActionsScreen.LS_AUDIT_QUICK_FILTER);
      if (raw === "all" || raw === "review" || raw === "unreviewed" || raw === "rejected") {
        return raw;
      }
    } catch {
      // ignore preference persistence failure
    }
    return "review";
  }

  private _writeAuditQuickFilterPref(value: "all" | "review" | "unreviewed" | "rejected"): void {
    try {
      localStorage.setItem(ActionsScreen.LS_AUDIT_QUICK_FILTER, value);
    } catch {
      // ignore preference persistence failure
    }
  }

  private _setAuditQuickFilter(
    root: HTMLElement,
    value: "all" | "review" | "unreviewed" | "rejected",
  ): void {
    this._auditQuickFilter = value;
    this._writeAuditQuickFilterPref(value);
    this._syncAuditQuickFilterUi(root);
    this._renderAuditTable(root);
  }

  private _resetAuditFilters(root: HTMLElement): void {
    this._auditQuickFilter = "all";
    this._writeAuditQuickFilterPref(this._auditQuickFilter);
    this._auditTextFilter = "";
    this._auditExceptionsOnly = false;
    const textInput = root.querySelector<HTMLInputElement>("#act-audit-text-filter");
    if (textInput) textInput.value = "";
    const exceptionsEl = root.querySelector<HTMLInputElement>("#act-audit-exceptions-only");
    if (exceptionsEl) exceptionsEl.checked = false;
    this._syncAuditQuickFilterUi(root);
    this._renderAuditTable(root);
  }

  private _syncAuditQuickFilterUi(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>(".audit-filter-btn").forEach((btn) => {
      const current = btn.dataset.qf;
      const active = current === this._auditQuickFilter;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  private _normalizeAuditStatus(
    status: AlignLinkRecord["status"] | "unreviewed" | null | undefined,
  ): "accepted" | "rejected" | "unreviewed" {
    if (status === "accepted" || status === "rejected") return status;
    return "unreviewed";
  }

  private _isAuditExceptionStatus(
    status: AlignLinkRecord["status"] | "unreviewed" | null | undefined,
  ): boolean {
    return this._normalizeAuditStatus(status) !== "accepted";
  }

  private _computeVisibleAuditLinks(): AlignLinkRecord[] {
    const textFilter = this._auditTextFilter;
    return this._auditLinks.filter((link) => {
      const status = this._normalizeAuditStatus(link.status);
      if (this._auditQuickFilter === "review" && status === "accepted") return false;
      if (this._auditQuickFilter === "unreviewed" && status !== "unreviewed") return false;
      if (this._auditQuickFilter === "rejected" && status !== "rejected") return false;
      if (this._auditExceptionsOnly && status === "accepted") return false;
      if (!textFilter) return true;
      const haystack = `${link.external_id ?? ""} ${link.pivot_text ?? ""} ${link.target_text ?? ""}`.toLowerCase();
      return haystack.includes(textFilter);
    });
  }

  private _focusNextAuditException(root: HTMLElement): void {
    const visibleLinks = this._computeVisibleAuditLinks();
    const exceptionLinks = visibleLinks.filter((link) => this._isAuditExceptionStatus(link.status));
    if (exceptionLinks.length === 0) {
      this._showToast?.("Aucune exception visible dans le filtre courant.");
      return;
    }
    const currentIdx = exceptionLinks.findIndex((link) => link.link_id === this._auditSelectedLinkId);
    const next = exceptionLinks[(currentIdx + 1) % exceptionLinks.length];
    this._auditSelectedLinkId = next.link_id;
    this._renderAuditTable(root);
    const row = root.querySelector<HTMLElement>(`tr[data-link-id='${next.link_id}']`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  private _selectedAuditLink(): AlignLinkRecord | null {
    if (this._auditSelectedLinkId === null) return null;
    return this._auditLinks.find((l) => l.link_id === this._auditSelectedLinkId) ?? null;
  }

  private async _runFocusStatusAction(root: HTMLElement, status: "accepted" | "rejected" | null): Promise<void> {
    const link = this._selectedAuditLink();
    if (!link) return;
    await this._setLinkStatus(link.link_id, status, root);
  }

  private async _runFocusDeleteAction(root: HTMLElement): Promise<void> {
    const link = this._selectedAuditLink();
    if (!link) return;
    await this._deleteLinkFromAudit(link.link_id, root);
  }

  private async _runFocusRetargetAction(root: HTMLElement): Promise<void> {
    const link = this._selectedAuditLink();
    if (!link) return;
    await this._openRetargetModal(link.link_id, link.pivot_unit_id, root);
  }

  private _schedulePreview(silent = false): void {
    if (!this._conn || this._isBusy) return;
    if (this._previewDebounceHandle !== null) {
      window.clearTimeout(this._previewDebounceHandle);
    }
    this._previewDebounceHandle = window.setTimeout(() => {
      this._previewDebounceHandle = null;
      void this._runPreview(silent);
    }, 260);
  }

  private _applyCurationPreset(root: HTMLElement, preset?: string): void {
    const spaces = root.querySelector<HTMLInputElement>("#act-rule-spaces");
    const quotes = root.querySelector<HTMLInputElement>("#act-rule-quotes");
    if (!spaces || !quotes) return;

    /** Helper: select one of the punctuation radio buttons by value ("", "fr", "en"). */
    const setPunctLang = (v: "" | "fr" | "en") => {
      const id = v === "fr" ? "act-punct-fr" : v === "en" ? "act-punct-en" : "act-punct-none";
      const radio = root.querySelector<HTMLInputElement>(`#${id}`);
      if (radio) radio.checked = true;
    };

    const mode = (preset ?? "spaces").trim();
    if (mode === "spaces") {
      spaces.checked = true;
      quotes.checked = false;
      setPunctLang("");
    } else if (mode === "quotes") {
      spaces.checked = false;
      quotes.checked = true;
      setPunctLang("");
    } else if (mode === "punctuation" || mode === "punctuation_en") {
      spaces.checked = false;
      quotes.checked = false;
      setPunctLang("en");
    } else if (mode === "punctuation_fr") {
      spaces.checked = false;
      quotes.checked = false;
      setPunctLang("fr");
    } else {
      // "custom" or unknown → activer tout par défaut
      spaces.checked = true;
      quotes.checked = true;
      setPunctLang("fr");
    }
    this._schedulePreview(true);
  }

  private _isRuleChecked(id: string): boolean {
    return (document.querySelector<HTMLInputElement>(`#${id}`)?.checked) ?? false;
  }

  /** Reads the selected punctuation language from the radio group. */
  private _getPunctLang(): "fr" | "en" | "" {
    const el = document.querySelector<HTMLInputElement>('input[name="curate-punct"]:checked');
    const v = el?.value ?? "";
    return (v === "fr" || v === "en") ? v : "";
  }

  private _parseAdvancedCurateRules(raw: string): CurateRule[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? (parsed as CurateRule[]) : [];
    } catch {
      return [];
    }
  }

  private _addAdvancedCurateRule(root: HTMLElement): void {
    const patternEl = root.querySelector<HTMLInputElement>("#act-curate-quick-pattern");
    const replacementEl = root.querySelector<HTMLInputElement>("#act-curate-quick-replacement");
    const flagsEl = root.querySelector<HTMLInputElement>("#act-curate-quick-flags");
    const rulesEl = root.querySelector<HTMLTextAreaElement>("#act-curate-rules");
    if (!patternEl || !replacementEl || !flagsEl || !rulesEl) return;

    const pattern = patternEl.value.trim();
    if (!pattern) {
      this._log("Saisissez un motif de recherche pour ajouter une règle.", true);
      return;
    }
    const replacement = replacementEl.value;
    const flags = flagsEl.value.trim();

    const existing = this._parseAdvancedCurateRules(rulesEl.value);
    existing.push({
      pattern,
      replacement,
      ...(flags ? { flags } : {}),
    });
    rulesEl.value = JSON.stringify(existing, null, 2);
    patternEl.value = "";
    replacementEl.value = "";
    flagsEl.value = "g";
    this._log(`Règle avancée ajoutée (${existing.length} au total).`);
    this._schedulePreview(true);
  }

  // ─── Level 3A: local status management ─────────────────────────────────

  private static readonly _STATUS_LABEL: Record<string, string> = {
    pending:  "En attente",
    accepted: "Acceptée",
    ignored:  "Ignorée",
  };

  /** Count pending / accepted / ignored across all examples (regardless of active filters). */
  private _getStatusCounts(): { pending: number; accepted: number; ignored: number } {
    let pending = 0, accepted = 0, ignored = 0;
    for (const ex of this._curateExamples) {
      const s = ex.status ?? "pending";
      if (s === "accepted") accepted++;
      else if (s === "ignored") ignored++;
      else pending++;
    }
    return { pending, accepted, ignored };
  }

  /**
   * Set the status of the currently active example.
   *
   * Mutation is in-place on the CuratePreviewExample object so _filteredExamples()
   * reflects the new status immediately on next call.
   *
   * If the new status excludes the current item from the active filter set,
   * the list is re-rendered and the next available item is auto-selected.
   */
  private _setItemStatus(status: NonNullable<CuratePreviewExample["status"]>): void {
    if (this._activeDiffIdx === null) return;
    const filtered = this._filteredExamples();
    const ex = filtered[this._activeDiffIdx];
    if (!ex) return;

    const prevStatus = ex.status ?? "pending";
    if (prevStatus === status) return; // no-op

    // Mutate the shared object reference
    ex.status = status;

    const idx = this._activeDiffIdx;

    // If no status filter or the new status still matches the filter, just update DOM in place
    if (!this._activeStatusFilter || this._activeStatusFilter === status) {
      const statusClass = `diff-${status}`;
      const row = document.querySelector<HTMLElement>(`tr[data-diff-idx="${idx}"]`);
      if (row) {
        row.classList.remove("diff-pending", "diff-accepted", "diff-ignored");
        row.classList.add(statusClass);
        this._renderStatusBadge(row, status);
      }
      const para = document.querySelector<HTMLElement>(`.raw-unit[data-diff-idx="${idx}"]`);
      if (para) {
        para.classList.remove("raw-pending", "raw-accepted", "raw-ignored");
        para.classList.add(`raw-${status}`);
      }
      this._updateActionButtons();
    } else {
      // Item no longer matches the status filter — re-render and advance
      const newFiltered = this._filteredExamples();
      this._activeDiffIdx = null;
      this._refreshCuratePreviewPanes();
      const panel = document.querySelector<HTMLElement>("#act-preview-panel");
      if (newFiltered.length > 0) {
        this._setActiveDiffItem(Math.min(idx, newFiltered.length - 1), panel);
      } else {
        this._updateActionButtons();
        const posEl = document.querySelector<HTMLElement>("#act-diff-position");
        if (posEl) posEl.textContent = "0 modif.";
        [document.querySelector<HTMLButtonElement>("#act-diff-prev"),
         document.querySelector<HTMLButtonElement>("#act-diff-next")].forEach(b => { if (b) b.disabled = true; });
      }
    }

    // Update session summary + log, then persist
    this._updateSessionSummary();
    this._saveCurateReviewState();
    const extId = ex.external_id ?? (idx + 1);
    const sl = ActionsScreen._STATUS_LABEL;
    this._pushCurateLog("apply", `Unité ${extId} : ${sl[prevStatus] ?? prevStatus} → ${sl[status]}`);
  }

  /**
   * Apply a status to every example in the current filtered view.
   * Used by "Tout accepter" / "Tout ignorer" bulk actions.
   */
  private _bulkSetStatus(status: NonNullable<CuratePreviewExample["status"]>): void {
    const filtered = this._filteredExamples();
    if (filtered.length === 0) return;
    for (const ex of filtered) ex.status = status;

    // Re-render because status filter may now exclude everything shown
    const newFiltered = this._filteredExamples();
    this._activeDiffIdx = null;
    this._refreshCuratePreviewPanes();
    const panel = document.querySelector<HTMLElement>("#act-preview-panel");
    if (newFiltered.length > 0) {
      this._setActiveDiffItem(0, panel);
    } else {
      this._updateActionButtons();
    }
    this._updateSessionSummary();
    this._saveCurateReviewState();
    const sl = ActionsScreen._STATUS_LABEL;
    this._pushCurateLog("apply", `Lot : ${filtered.length} modif(s) → ${sl[status]}`);
  }

  /**
   * Activate or clear the status filter.
   * Combines with the rule filter via _filteredExamples().
   */
  private _setStatusFilter(status: "pending" | "accepted" | "ignored" | null): void {
    this._activeStatusFilter = status;
    this._activeDiffIdx = null;
    const filtered = this._filteredExamples();
    this._refreshCuratePreviewPanes();
    this._updateSessionSummary(); // re-renders chips with correct active state
    const panel = document.querySelector<HTMLElement>("#act-preview-panel");
    if (filtered.length > 0) {
      this._setActiveDiffItem(0, panel);
    } else {
      this._updateActionButtons();
      const posEl = document.querySelector<HTMLElement>("#act-diff-position");
      if (posEl) posEl.textContent = status ? "0 modif." : "—";
      [document.querySelector<HTMLButtonElement>("#act-diff-prev"),
       document.querySelector<HTMLButtonElement>("#act-diff-next")].forEach(b => { if (b) b.disabled = true; });
    }
  }

  /**
   * Re-render the session summary (pending / accepted / ignored counts).
   * The summary chips double as status-filter toggles.
   */
  private _updateSessionSummary(): void {
    const el = document.querySelector<HTMLElement>("#act-curate-session-summary");
    if (!el) return;
    const total = this._curateExamples.length;
    if (total === 0) { el.style.display = "none"; return; }

    el.style.display = "";
    const c = this._getStatusCounts();
    const af = this._activeStatusFilter;
    const sl = ActionsScreen._STATUS_LABEL;

    const chip = (key: "pending" | "accepted" | "ignored", icon: string, label: string, count: number) =>
      `<span class="session-chip session-${key}${af === key ? " session-chip-active" : ""}"` +
      ` data-sf="${key}" role="button" tabindex="0" title="${af === key ? "Effacer ce filtre" : `Filtrer : ${label}`}">` +
      `${icon}&#160;<strong>${count}</strong>&#160;<span class="session-chip-label">${label}</span></span>`;

    // Build restore notice with partial-restore detail.
    // Level 6A note: preview always requires a specific doc_id, so _curateRestoredCount
    // always reflects a per-doc restore.  The "isAllMode" branch is an edge case where
    // the user changed the doc selector *after* the preview ran — it doesn't indicate
    // a real "all documents" restore.  We still show a helpful note in that case.
    const docId = this._currentCurateDocId() ?? null;
    const isAllMode = docId === null;
    let restoreNotice: string;
    if (this._curateRestoredCount > 0) {
      const countText = this._curateSavedCount > this._curateRestoredCount
        ? `${this._curateRestoredCount} statut(s) restauré(s) sur ${this._curateSavedCount} sauvegardé(s)`
        : `${this._curateRestoredCount} statut(s) restauré(s)`;
      // When the doc selector was changed after preview, clarify that the scope shown
      // may not match the document currently selected.
      const modeNote = isAllMode ? ` <em>(sélection modifiée depuis la preview)</em>` : "";
      restoreNotice =
        `<div class="session-restore-notice" title="Statuts restaurés depuis la session précédente (même document, mêmes règles)">` +
        `&#8635; ${countText}${modeNote} &#8212; ` +
        `<button class="btn-inline-link" id="act-reset-review">Réinitialiser</button>` +
        `</div>`;
    } else {
      // When no doc is selected, "Réinitialiser" sweeps all saved review states (Level 6A).
      const modeNote = isAllMode
        ? `<span class="session-all-note" title="Aucun document sélectionné. La réinitialisation effacera toutes les sessions de review sauvegardées.">&#9432; Portée globale</span> &#8212; `
        : "";
      restoreNotice = `<div class="session-reset-row">${modeNote}<button class="btn-inline-link" id="act-reset-review">Effacer la review sauvegardée</button></div>`;
    }

    el.innerHTML =
      `<div class="session-counts">` +
      chip("pending",  "&#9632;", sl.pending,  c.pending)  +
      chip("accepted", "&#10003;", sl.accepted, c.accepted) +
      chip("ignored",  "&#215;",  sl.ignored,  c.ignored)  +
      `</div>` +
      (af ? `<div class="session-filter-note">Filtre statut actif &#8212; <button class="btn-inline-link" id="act-clear-sf">Afficher tout</button></div>` : "") +
      (() => {
        const overrideCount = this._curateExamples.filter(ex => ex.is_manual_override).length;
        return overrideCount > 0
          ? `<div class="session-override-note">&#9998;&#160;${overrideCount} correction(s) manuelle(s) dans cette session</div>`
          : "";
      })() +
      (() => {
        const excCount = this._curateExceptions.size;
        return excCount > 0
          ? `<div class="session-exception-note">🔒&#160;${excCount} exception(s) persistée(s) active(s) pour ce document</div>`
          : "";
      })() +
      restoreNotice;

    el.querySelectorAll<HTMLElement>("[data-sf]").forEach(chip => {
      chip.addEventListener("click", () => {
        const sf = chip.dataset.sf as "pending" | "accepted" | "ignored";
        this._setStatusFilter(this._activeStatusFilter === sf ? null : sf);
      });
      chip.addEventListener("keydown", e => { if ((e as KeyboardEvent).key === "Enter") chip.click(); });
    });
    el.querySelector("#act-clear-sf")?.addEventListener("click", () => this._setStatusFilter(null));
    el.querySelector("#act-reset-review")?.addEventListener("click", () => this._clearCurateReviewState());
  }

  /**
   * Update the accept / ignore / pending action buttons to reflect
   * the active item's current status and disabled state.
   */
  private _updateActionButtons(): void {
    const filtered = this._filteredExamples();
    const ex = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] : undefined;
    const currentStatus = ex?.status ?? "pending";
    const hasActive = ex !== undefined;

    const accept  = document.querySelector<HTMLButtonElement>("#act-item-accept");
    const ignore  = document.querySelector<HTMLButtonElement>("#act-item-ignore");
    const pending = document.querySelector<HTMLButtonElement>("#act-item-pending");

    if (accept)  { accept.disabled  = !hasActive; accept.classList.toggle("action-active",  hasActive && currentStatus === "accepted"); }
    if (ignore)  { ignore.disabled  = !hasActive; ignore.classList.toggle("action-active",  hasActive && currentStatus === "ignored");  }
    if (pending) { pending.disabled = !hasActive || currentStatus === "pending";
                   pending.classList.toggle("action-active", hasActive && currentStatus === "pending"); }
  }

  /**
   * (Re-)render the status badge inside a diff table row without full re-render.
   * Replaces an existing .diff-status-badge if present.
   */
  private _renderStatusBadge(row: HTMLElement, status: string): void {
    const existing = row.querySelector<HTMLElement>(".diff-status-badge");
    if (status === "pending") { existing?.remove(); return; }
    const badge = existing ?? document.createElement("span");
    badge.className = `diff-status-badge diff-status-${status}`;
    badge.textContent = status === "accepted" ? "✓" : "✗";
    badge.title = ActionsScreen._STATUS_LABEL[status] ?? status;
    if (!existing) {
      const firstCell = row.querySelector("td");
      if (firstCell) firstCell.appendChild(badge);
    }
  }

  /**
   * Render the "Contexte local" card for the given example.
   * Shows the preceding unit (context_before), the modification itself (before→after),
   * and the following unit (context_after).
   *
   * The card is hidden when ex is null or when both context fields are absent.
   * Falls back gracefully: if only before/after exist, shows the modification without neighbours.
   *
   * Context text is already trimmed to 300 chars by the server.
   * We trim again here at 200 display-chars with "…" to keep the card compact.
   */
  private _renderContextDetail(ex: CuratePreviewExample | null): void {
    const card   = document.querySelector<HTMLElement>("#act-curate-context-card");
    const body   = document.querySelector<HTMLElement>("#act-curate-context");
    const posEl  = document.querySelector<HTMLElement>("#act-context-pos");
    if (!card || !body) return;

    if (!ex) {
      card.style.display = "none";
      return;
    }

    card.style.display = "";

    // Position label: prefer human-readable unit_index + 1, fallback to unit_id
    if (posEl) {
      posEl.textContent = ex.unit_index !== undefined
        ? `Unité ${ex.unit_index + 1}`
        : `ID ${ex.unit_id}`;
    }

    const DISPLAY_TRIM = 200;
    const trim = (t: string): string =>
      t.length > DISPLAY_TRIM ? t.slice(0, DISPLAY_TRIM) + "…" : t;

    const ctxBefore = (ex.context_before ?? "").trim();
    const ctxAfter  = (ex.context_after  ?? "").trim();

    // Effective "after" value: manual override wins over auto
    const effectiveAfter = ex.manual_after ?? ex.after;

    const ctxBeforeHtml = ctxBefore
      ? `<div class="ctx-row ctx-before">
           <span class="ctx-label">Avant</span>
           <span class="ctx-text">${_escHtml(trim(ctxBefore))}</span>
         </div>`
      : "";
    const ctxAfterHtml = ctxAfter
      ? `<div class="ctx-row ctx-after">
           <span class="ctx-label">Après</span>
           <span class="ctx-text">${_escHtml(trim(ctxAfter))}</span>
         </div>`
      : "";

    if (this._editingManualOverride) {
      // ── Edit mode ──────────────────────────────────────────────────────────
      body.innerHTML =
        ctxBeforeHtml +
        `<div class="ctx-row ctx-current">
           <span class="ctx-label ctx-label-cur">Original</span>
           <span class="ctx-text ctx-original">${_escHtml(ex.before)}</span>
         </div>` +
        `<div class="ctx-row ctx-edit-row">
           <span class="ctx-label ctx-label-edit">Résultat</span>
           <span class="ctx-edit-area">
             <textarea id="act-manual-override-input" class="ctx-override-textarea"
               rows="3" spellcheck="true">${_escHtml(effectiveAfter)}</textarea>
             <span class="ctx-edit-hint">Proposition automatique : <em>${_escHtml(ex.after)}</em></span>
           </span>
         </div>` +
        `<div class="ctx-edit-actions">
           <button class="btn btn-sm btn-primary" id="act-override-save">Enregistrer</button>
           <button class="btn btn-sm btn-secondary" id="act-override-cancel">Annuler</button>
           ${ex.is_manual_override
             ? `<button class="btn btn-sm" id="act-override-revert" title="Revenir à la proposition automatique">&#8617; Automatique</button>`
             : ""}
         </div>` +
        ctxAfterHtml;
    } else {
      // ── Read mode ─────────────────────────────────────────────────────────
      const overrideBadgeHtml = ex.is_manual_override
        ? `<span class="ctx-override-badge"
             title="Ce résultat a été corrigé manuellement. Proposition automatique : ${_escHtml(ex.after)}">
             ✏ Édité manuellement
           </span>`
        : "";

      // Level 7B: persistent exception badge
      const hasException = ex.is_exception_ignored || ex.is_exception_override;
      const exceptionBadgeHtml = hasException
        ? `<span class="ctx-exception-badge"
             title="${ex.is_exception_ignored
               ? "Exception persistée : cette unité sera toujours ignorée par la curation, quelle que soit la session."
               : `Exception persistée : ce texte sera toujours appliqué à cette unité. Texte : "${_escHtml(ex.exception_override ?? "")}"`}">
             🔒 ${ex.is_exception_ignored ? "Ignoré durablement" : "Override durable"}
           </span>`
        : "";

      // Level 8C: forced-unit indicator
      const forcedReason = ex.preview_reason;
      const forcedNoteHtml = forcedReason && forcedReason !== "standard"
        ? `<div class="ctx-forced-note ctx-forced-${forcedReason}">
             ${forcedReason === "forced"
               ? "↗ Ouverture ciblée depuis le panneau Exceptions."
               : forcedReason === "forced_ignored"
               ? "↗ Ouverture ciblée — cette unité est <strong>neutralisée par une exception ignore</strong>. Elle n'est pas appliquée."
               : "↗ Ouverture ciblée — aucune modification active avec les règles courantes."}
           </div>`
        : "";

      body.innerHTML =
        ctxBeforeHtml +
        `<div class="ctx-row ctx-current">
           <span class="ctx-label ctx-label-cur">${forcedReason === "forced_no_change" ? "Inchangé" : forcedReason === "forced_ignored" ? "Neutralisé" : "Modifié"}</span>
           <span class="ctx-modification">
             <span class="ctx-diff-before">${_escHtml(ex.before)}</span>
             <span class="ctx-arrow">&#8594;</span>
             <span class="ctx-diff-after${ex.is_manual_override ? " ctx-manual-override" : ""}">${_highlightChanges(ex.before, effectiveAfter)}</span>
           </span>
         </div>` +
        ctxAfterHtml +
        forcedNoteHtml +
        `<div class="ctx-edit-actions">
           ${overrideBadgeHtml}
           <button class="btn btn-sm" id="act-override-edit"
             title="Modifier manuellement le résultat de cette modification">&#9998; Éditer</button>
           ${ex.is_manual_override
             ? `<button class="btn btn-sm" id="act-override-revert"
                  title="Annuler la correction manuelle et utiliser la proposition automatique">&#8617; Proposition auto</button>`
             : ""}
         </div>` +
        `<div class="ctx-exception-actions">
           ${exceptionBadgeHtml}
           ${!hasException
             ? `<button class="btn btn-sm ctx-exception-btn" id="act-exc-ignore"
                  title="Ne plus jamais appliquer de curation sur cette unité, même lors des prochaines sessions">
                  🔒 Toujours ignorer</button>
                <button class="btn btn-sm ctx-exception-btn" id="act-exc-override"
                  title="Appliquer durablement le résultat actuel comme correction permanente de cette unité">
                  🔒 Conserver cette correction</button>`
             : `<button class="btn btn-sm ctx-exception-btn ctx-exception-btn-delete" id="act-exc-delete"
                  title="Supprimer l'exception persistée — la curation automatique sera réactivée pour cette unité">
                  🔓 Supprimer l'exception</button>`}
         </div>`;
    }

    // Attach event listeners (must be after innerHTML is set)
    body.querySelector<HTMLButtonElement>("#act-override-edit")
      ?.addEventListener("click", () => this._enterEditMode());
    body.querySelector<HTMLButtonElement>("#act-override-save")
      ?.addEventListener("click", () => {
        const ta = body.querySelector<HTMLTextAreaElement>("#act-manual-override-input");
        if (ta) this._saveManualOverride(ta.value);
      });
    body.querySelector<HTMLButtonElement>("#act-override-cancel")
      ?.addEventListener("click", () => this._cancelEditMode());
    body.querySelector<HTMLButtonElement>("#act-override-revert")
      ?.addEventListener("click", () => this._revertManualOverride());
    // Level 7B: persistent exception buttons
    body.querySelector<HTMLButtonElement>("#act-exc-ignore")
      ?.addEventListener("click", () => { this._setExceptionIgnore(ex); });
    body.querySelector<HTMLButtonElement>("#act-exc-override")
      ?.addEventListener("click", () => { this._setExceptionOverride(ex); });
    body.querySelector<HTMLButtonElement>("#act-exc-delete")
      ?.addEventListener("click", () => { this._deleteException(ex); });
  }

  /**
   * Compute a compact, deterministic FNV-1a 32-bit signature for a rules list.
   * Used to decide whether saved review statuses are compatible with the current
   * preview (same ruleset ⇒ restore; different ⇒ clean start).
   */
  private static _rulesSignature(rules: CurateRule[]): string {
    const canonical = rules
      .map(r => `${r.pattern}|${r.replacement ?? ""}|${r.flags ?? ""}|${r.description ?? ""}`)
      .sort()
      .join("\x00");
    let h = 0x811c9dc5;
    for (let i = 0; i < canonical.length; i++) {
      h ^= canonical.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  /**
   * Build a compact, deterministic FNV-1a 32-bit fingerprint for a preview sample
   * (Level 5A).  Encodes which units are in the sample AND which rules matched each
   * one, without hashing the actual text content.
   *
   * Captures correctly:
   *   - units added to / removed from the sample
   *   - changes in which rules match a given unit
   *   - re-ordering of examples (sort is applied before hashing)
   *
   * Does NOT capture:
   *   - changes to the text content of a unit (before / after)
   *   - changes to context_before / context_after
   *   These are intentional omissions to keep the fingerprint lightweight.
   *
   * Option B chosen over Option A (unit_id only) because matched_rule_ids reveals
   * rule-assignment changes (e.g. a rule removed then a similar one added) that
   * unit_id alone cannot detect.  Option C (unit_id + before) was rejected for being
   * too fragile on benign text edits.
   */
  private static _sampleFingerprint(examples: CuratePreviewExample[]): string {
    const canonical = examples
      .filter(ex => ex.unit_id !== undefined)
      .map(ex => `${ex.unit_id}:${(ex.matched_rule_ids ?? []).slice().sort((a, b) => a - b).join(",")}`)
      .sort()
      .join("\x00");
    let h = 0x811c9dc5;
    for (let i = 0; i < canonical.length; i++) {
      h ^= canonical.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  /**
   * Build a compact, deterministic FNV-1a 32-bit textual fingerprint for a
   * preview sample (Level 5B).  Encodes the beginning of each unit's original
   * text ("before") alongside its unit_id.
   *
   * Normalisation applied to each "before" value:
   *   1. Collapse any whitespace sequence to a single ASCII space.
   *   2. Trim leading / trailing whitespace.
   *   3. Take only the first 64 characters of the result.
   *
   * This makes the fingerprint robust against trivial whitespace variations
   * (e.g., NBSP → space, double space → single space) while still detecting
   * any substantive change to the beginning of a unit's text.
   *
   * Chosen over full-text hashing to avoid false invalidations on small edits
   * beyond position 64, and over shorter prefixes (32) to give enough signal
   * for typical corpus sentences (which often start similarly).
   *
   * Detects:  meaningful text changes in the first 64 normalised chars of "before".
   * Does NOT detect:  changes beyond position 64; pure whitespace normalisation.
   *
   * Applied as a hard gate AFTER the structural fingerprint (unit_id +
   * matched_rule_ids) has already passed.  If the structural fingerprint
   * already caught a membership or rule-assignment change, this method is
   * never reached for that session.
   */
  private static _sampleTextFingerprint(examples: CuratePreviewExample[]): string {
    const canonical = examples
      .filter(ex => ex.unit_id !== undefined)
      .map(ex => {
        const norm = (ex.before ?? "").replace(/\s+/g, " ").trim().slice(0, 64);
        return `${ex.unit_id}:${norm}`;
      })
      .sort()
      .join("\x00");
    let h = 0x811c9dc5;
    for (let i = 0; i < canonical.length; i++) {
      h ^= canonical.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  /** Build the LocalStorage key for a specific document scope (or the legacy "all" key). */
  private _curateReviewKey(docId: number | null): string {
    return ActionsScreen.LS_CURATE_REVIEW_PREFIX + (docId ?? "all");
  }

  /**
   * Enumerate and remove every localStorage key that belongs to the curate
   * review namespace (keys starting with LS_CURATE_REVIEW_PREFIX).
   *
   * Used when an apply-all operation completes successfully, or when the user
   * manually resets the review in "all documents" mode.
   *
   * Returns the number of keys that were removed, for feedback purposes.
   *
   * Design note (Level 6A):
   *   Since /curate/preview always requires a specific doc_id, per-doc statuses
   *   are stored under "review.<docId>" keys.  A global apply invalidates all
   *   those individual documents, so we must sweep the entire namespace rather
   *   than only removing the (never-actually-populated) "review.all" key.
   */
  private _clearAllCurateReviewKeys(): number {
    const prefix = ActionsScreen.LS_CURATE_REVIEW_PREFIX;
    const keysToRemove: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keysToRemove.push(k);
      }
      for (const k of keysToRemove) {
        try { localStorage.removeItem(k); } catch { /* */ }
      }
    } catch { /* localStorage unavailable */ }
    return keysToRemove.length;
  }

  /**
   * Persist the current review statuses to localStorage (version 4 format).
   * Includes:
   *   - sampleFingerprint (structural: unit_id + matched_rule_ids)
   *   - sampleTextFingerprint (textual: unit_id + normalised before[0..64])
   *
   * Auto-cleans: if all statuses are pending (empty map), the key is removed
   * rather than writing a useless entry.
   */
  private _saveCurateReviewState(): void {
    if (this._curateExamples.length === 0) return;
    const docId = this._currentCurateDocId() ?? null;
    const rules = this._currentRules();
    const sig = ActionsScreen._rulesSignature(rules);
    const statuses: Record<string, "accepted" | "ignored"> = {};
    const overrides: Record<string, string> = {};
    for (const ex of this._curateExamples) {
      if (ex.unit_id === undefined) continue;
      if (ex.status === "accepted" || ex.status === "ignored") {
        statuses[String(ex.unit_id)] = ex.status;
      }
      if (ex.is_manual_override && ex.manual_after != null) {
        overrides[String(ex.unit_id)] = ex.manual_after;
      }
    }
    const key = this._curateReviewKey(docId);
    // Auto-cleanup: if both statuses and overrides are empty, remove the entry entirely.
    if (Object.keys(statuses).length === 0 && Object.keys(overrides).length === 0) {
      try { localStorage.removeItem(key); } catch { /* */ }
      return;
    }
    const state: StoredCurateReviewState = {
      version: 5,
      docId,
      rulesSignature: sig,
      updatedAt: Date.now(),
      unitsTotal: this._curateUnitsTotal,
      unitsChanged: this._curateGlobalChanged,
      sampleFingerprint: ActionsScreen._sampleFingerprint(this._curateExamples),
      sampleSize: this._curateExamples.length,
      sampleTextFingerprint: ActionsScreen._sampleTextFingerprint(this._curateExamples),
      statuses,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    };
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* quota exceeded */ }
  }

  /**
   * Load and validate stored review state for the current docId + rules.
   * Returns null if absent, malformed, or incompatible (different rules signature).
   * Accepts versions 1–4 for backward compatibility with already-stored sessions.
   * Fingerprint checks (v3 structural, v4 textual) are done in _restoreCurateReviewState().
   */
  private _loadCurateReviewState(docId: number | null, rulesSignature: string): StoredCurateReviewState | null {
    try {
      const raw = localStorage.getItem(this._curateReviewKey(docId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredCurateReviewState;
      if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4 && parsed.version !== 5) return null;
      if (parsed.rulesSignature !== rulesSignature) return null;
      if (typeof parsed.statuses !== "object" || parsed.statuses === null) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Attempt to restore review statuses from localStorage after a preview.
   *
   * Compatibility guards applied in priority order:
   *
   * [HARD GATE] rulesSignature (all versions) — enforced in _loadCurateReviewState():
   *   If the ruleset changed, no state is loaded at all.
   *
   * [HARD GATE v3+] sampleFingerprint — structural:
   *   FNV-1a of (unit_id + matched_rule_ids) per example.
   *   If different → refused.  Detects: membership change, rule-assignment change.
   *
   * [HARD GATE v4] sampleTextFingerprint — textual (applied after structural pass):
   *   FNV-1a of (unit_id + normalised_before[0..64]) per example.
   *   If different → refused.  Detects: substantive text change in unit's original text.
   *   Does NOT detect: changes beyond position 64, trivial whitespace differences.
   *
   * [DEGRADED v3] structural match, no text fingerprint:
   *   Restore proceeds with a warning about missing textual guard.
   *
   * [DEGRADED v1/v2] no structural fingerprint:
   *   Uses unitsTotal soft guard, then proceeds with appropriate warnings.
   *
   * [SOFT GUARD] mode "all documents": always flagged.
   * [SOFT GUARD] partial restore: warned when < 50% of saved statuses found.
   *
   * Sets _curateSavedCount for feedback.  Returns the restored count (0 on refusal).
   */
  private _restoreCurateReviewState(rules: CurateRule[], currentUnitsTotal: number, currentUnitsChanged: number): number {
    // currentUnitsChanged is stored in v4 state; reserved for a future strong guard.
    void currentUnitsChanged;

    const docId = this._currentCurateDocId() ?? null;
    const sig = ActionsScreen._rulesSignature(rules);
    const saved = this._loadCurateReviewState(docId, sig);
    if (!saved) {
      this._curateSavedCount = 0;
      return 0;
    }

    this._curateSavedCount = Object.keys(saved.statuses).length;

    // ── HARD GATE (v3+): structural fingerprint ───────────────────────────────
    if (saved.sampleFingerprint !== undefined) {
      const currentFp = ActionsScreen._sampleFingerprint(this._curateExamples);
      if (currentFp !== saved.sampleFingerprint) {
        const savedSize = saved.sampleSize ?? this._curateSavedCount;
        this._pushCurateLog("warn",
          `Session sauvegardée ignorée : l'échantillon de preview a changé ` +
          `(${savedSize} éléments sauvegardés, empreinte structurelle différente). ` +
          `Les statuts précédents ne correspondent plus à l'aperçu courant.`
        );
        this._curateSavedCount = 0;
        return 0;
      }

      // ── HARD GATE (v4): textual fingerprint ──────────────────────────────────
      // Applied only after the structural gate has passed.
      if (saved.sampleTextFingerprint !== undefined) {
        const currentTextFp = ActionsScreen._sampleTextFingerprint(this._curateExamples);
        if (currentTextFp !== saved.sampleTextFingerprint) {
          const savedSize = saved.sampleSize ?? this._curateSavedCount;
          this._pushCurateLog("warn",
            `Session sauvegardée ignorée : l'échantillon textuel a changé ` +
            `(${savedSize} éléments sauvegardés, empreinte textuelle différente). ` +
            `Le texte source d'au moins une unité révisée a été modifié depuis la dernière session.`
          );
          this._curateSavedCount = 0;
          return 0;
        }
        // Both fingerprints match — full v4 compatibility confirmed.
      } else {
        // ── DEGRADED MODE (v3): structural match but no text fingerprint ─────────
        // Restore proceeds with a warning about reduced guarantees.
        this._pushCurateLog("warn",
          "Session restaurée avec garde-fous textuels réduits (format v3 sans empreinte textuelle). " +
          "Des modifications textuelles non détectées restent possibles si le document a changé."
        );
      }
    } else {
      // ── DEGRADED MODE (v1/v2): no structural fingerprint ─────────────────────
      if (saved.unitsTotal !== undefined && saved.unitsTotal > 0) {
        const delta = Math.abs(currentUnitsTotal - saved.unitsTotal);
        const threshold = Math.max(5, Math.round(saved.unitsTotal * 0.10));
        if (delta > threshold) {
          this._pushCurateLog("warn",
            `Ancienne session restaurée avec garde-fous réduits — ` +
            `le document a changé (${saved.unitsTotal} → ${currentUnitsTotal} unités). ` +
            `Certains statuts peuvent être obsolètes.`
          );
        } else {
          this._pushCurateLog("warn",
            "Ancienne session restaurée avec garde-fous réduits (format v1/v2 sans empreinte d'aperçu)."
          );
        }
      } else {
        this._pushCurateLog("warn",
          "Ancienne session restaurée avec garde-fous réduits (format v1 sans métadonnées de compatibilité)."
        );
      }
    }

    // Mode "all documents" is inherently less reliable — always flag it.
    if (docId === null) {
      this._pushCurateLog("warn",
        "Restauration en mode global (tous les documents). La fiabilité est moindre si le corpus a changé depuis la dernière session."
      );
    }

    // ── Apply statuses ────────────────────────────────────────────────────────
    let restored = 0;
    for (const ex of this._curateExamples) {
      if (ex.unit_id === undefined) continue;
      const storedStatus = saved.statuses[String(ex.unit_id)];
      if (storedStatus) {
        ex.status = storedStatus;
        restored++;
      }
      // Level 7A: restore manual overrides
      if (saved.overrides) {
        const storedOverride = saved.overrides[String(ex.unit_id)];
        if (storedOverride !== undefined) {
          ex.manual_after = storedOverride;
          ex.is_manual_override = true;
        }
      }
    }

    // Partial restore warning: < 50% of saved statuses found in the current sample.
    if (this._curateSavedCount > 0 && restored < this._curateSavedCount / 2) {
      this._pushCurateLog("warn",
        `Restauration partielle : ${restored} statut(s) retrouvé(s) sur ${this._curateSavedCount} sauvegardé(s). ` +
        `L'échantillon courant ne couvre peut-être pas tous les éléments révisés.`
      );
    } else if (restored > 0) {
      // Positive confirmation — distinguish quality of the restore.
      const quality = saved.sampleTextFingerprint !== undefined
        ? "aperçu structurellement et textuellement compatible ✓"
        : saved.sampleFingerprint !== undefined
          ? "aperçu structurellement compatible ✓ (garde-fous textuels réduits)"
          : "garde-fous réduits (ancienne session)";
      const overrideCount = Object.keys(saved.overrides ?? {}).length;
      const overrideNote = overrideCount > 0 ? `, ${overrideCount} override(s) manuel(s)` : "";
      this._pushCurateLog("preview", `${restored} statut(s) restauré(s)${overrideNote} — ${quality}`);
    }

    return restored;
  }

  /**
   * Invalidate the saved review state after a successful apply (Level 4B / 6A).
   *
   * Two modes:
   *
   * docId !== null — per-document apply:
   *   Remove only the key for that document.  Other per-doc keys are untouched.
   *
   * docId === null — global apply (all documents):
   *   Remove every key in the LS_CURATE_REVIEW_PREFIX namespace.
   *   Rationale (Level 6A): because /curate/preview always requires a specific
   *   doc_id, review statuses are stored as "review.<docId>" per-doc keys even
   *   when the apply scope is global.  Removing only "review.all" (which is never
   *   actually populated in normal usage) would leave those per-doc states intact,
   *   leading to stale restore on the next preview of any individual document.
   *
   * Does NOT touch in-memory _curateExamples (the apply flow already clears them).
   */
  private _invalidateCurateReviewAfterApply(docId: number | null): void {
    if (docId === null) {
      // Global apply: sweep the entire review namespace.
      const cleared = this._clearAllCurateReviewKeys();
      this._curateRestoredCount = 0;
      this._curateSavedCount = 0;
      this._updateSessionSummary();
      const note = cleared > 0
        ? `Review locale effacée pour ${cleared} document(s) après application globale.`
        : "Review locale effacée après application globale (aucun état sauvegardé).";
      this._pushCurateLog("apply", note);
    } else {
      // Per-document apply: remove only that document's key.
      try { localStorage.removeItem(this._curateReviewKey(docId)); } catch { /* */ }
      this._curateRestoredCount = 0;
      this._curateSavedCount = 0;
      this._updateSessionSummary();
      this._pushCurateLog("apply", `Review locale du document #${docId} effacée après application réussie.`);
    }
  }

  /**
   * Clear the saved review state and reset all visible statuses to "pending".
   *
   * Scope (Level 6A):
   *   - If a specific document is selected: remove only its key.
   *   - If no document is selected (docId === null, "all" scope): sweep the
   *     entire LS_CURATE_REVIEW_PREFIX namespace, because per-doc statuses are
   *     stored as "review.<docId>" keys, not under a single "review.all" entry.
   */
  private _clearCurateReviewState(): void {
    const docId = this._currentCurateDocId() ?? null;
    let logMsg: string;
    if (docId === null) {
      const cleared = this._clearAllCurateReviewKeys();
      logMsg = cleared > 0
        ? `Review globale réinitialisée — ${cleared} clé(s) de session effacée(s).`
        : "Review globale réinitialisée (aucun état sauvegardé).";
    } else {
      try { localStorage.removeItem(this._curateReviewKey(docId)); } catch { /* */ }
      logMsg = `Review du document #${docId} réinitialisée (statuts remis à en attente).`;
    }
    for (const ex of this._curateExamples) {
      ex.status = "pending";
      ex.manual_after = undefined;
      ex.is_manual_override = undefined;
    }
    this._editingManualOverride = false;
    this._curateRestoredCount = 0;
    this._curateSavedCount = 0;
    const filtered = this._filteredExamples();
    this._refreshCuratePreviewPanes();
    this._updateSessionSummary();
    this._updateActionButtons();
    this._pushCurateLog("preview", logMsg);
  }

  /**
   * Build _curateRuleLabels: one human-readable label per position in the rules
   * array that will be sent to the server. Must be called before each preview so
   * matched_rule_ids from the response can be mapped back to labels.
   *
   * Order must exactly match _currentRules() — same preset order, same custom rules.
   */
  private _buildRuleLabels(): void {
    const labels: string[] = [];
    const PRESET_LABEL: Record<string, string> = {
      spaces: "Espaces",
      quotes: "Guillemets",
      punctuation_fr: "Ponctuation FR",
      punctuation_en: "Ponctuation EN",
      invisibles: "Invisibles",
      numbering: "Numérotation",
    };
    const entries: Array<[string, string]> = [
      ["act-rule-spaces", "spaces"],
      ["act-rule-quotes", "quotes"],
      ["act-rule-invisibles", "invisibles"],
      ["act-rule-numbering", "numbering"],
    ];
    for (const [checkId, key] of entries) {
      if (this._isRuleChecked(checkId)) {
        for (const _ of CURATE_PRESETS[key].rules) labels.push(PRESET_LABEL[key]);
      }
    }
    // Punctuation FR/EN radio group
    const punctLang = this._getPunctLang();
    if (punctLang === "fr") {
      for (const _ of CURATE_PRESETS.punctuation_fr.rules) labels.push(PRESET_LABEL.punctuation_fr);
    } else if (punctLang === "en") {
      for (const _ of CURATE_PRESETS.punctuation_en.rules) labels.push(PRESET_LABEL.punctuation_en);
    }
    const raw = (document.querySelector<HTMLTextAreaElement>("#act-curate-rules"))?.value ?? "";
    for (const rule of this._parseAdvancedCurateRules(raw)) {
      labels.push(rule.description || "Règle custom");
    }
    this._curateRuleLabels = labels;
  }

  /**
   * Return _curateExamples filtered by the current rule filter AND status filter.
   * Both filters are independent and cumulative.
   * Results are references into _curateExamples — mutations to .status are visible immediately.
   */
  private _filteredExamples(): CuratePreviewExample[] {
    return this._curateExamples.filter(ex => {
      const ruleOk = !this._activeRuleFilter ||
        (ex.matched_rule_ids ?? []).some(idx => (this._curateRuleLabels[idx] ?? "") === this._activeRuleFilter);
      const statusOk = !this._activeStatusFilter ||
        (ex.status ?? "pending") === this._activeStatusFilter;
      return ruleOk && statusOk;
    });
  }

  /**
   * Count how many examples in _curateExamples match each rule label.
   * Each example is counted once per distinct label (not once per matched_rule_id).
   */
  private _getRuleStats(): Map<string, number> {
    const map = new Map<string, number>();
    for (const ex of this._curateExamples) {
      const seenLabels = new Set<string>();
      for (const idx of (ex.matched_rule_ids ?? [])) {
        const label = this._curateRuleLabels[idx] ?? `règle ${idx + 1}`;
        if (!seenLabels.has(label)) {
          seenLabels.add(label);
          map.set(label, (map.get(label) ?? 0) + 1);
        }
      }
    }
    return map;
  }

  /**
   * Activate or clear a rule filter.
   * Re-renders diff and raw panes with the filtered set and auto-selects the first item.
   */
  private _setRuleFilter(label: string | null, panel?: HTMLElement | null): void {
    this._activeRuleFilter = label;
    this._activeDiffIdx = null;
    const filtered = this._filteredExamples();
    // Re-render both panes with the new filtered set
    this._refreshCuratePreviewPanes();
    // Update filter badge visibility
    this._updateFilterBadge(panel);
    // Highlight diagnostics chips to show which filter is active
    (panel ?? document).querySelectorAll<HTMLElement>(".curate-diag-rule-chip").forEach(chip => {
      chip.classList.toggle("active", chip.dataset.ruleLabel === label);
    });
    // Auto-select first item in filtered set (or reset nav buttons)
    if (filtered.length > 0) {
      this._setActiveDiffItem(0, panel);
    } else {
      const posEl = (panel ?? document).querySelector<HTMLElement>("#act-diff-position")
        ?? document.querySelector<HTMLElement>("#act-diff-position");
      if (posEl) posEl.textContent = label ? "0 modif." : "—";
      [(panel ?? document).querySelector<HTMLButtonElement>("#act-diff-prev"),
       (panel ?? document).querySelector<HTMLButtonElement>("#act-diff-next")].forEach(btn => {
        if (btn) btn.disabled = true;
      });
    }
  }

  /**
   * Show or hide the sample-info notice in the preview controls.
   * Explains clearly how many examples are shown vs. the real total,
   * so users know whether the preview is a complete or partial view.
   *
   * What we can know from the API:
   *   - stats.units_changed → _curateGlobalChanged (real total)
   *   - examples.length     → _curateExamples.length (sample shown)
   * What we cannot know: the count per rule across the FULL document (only for the sample).
   */
  private _updateSampleInfo(): void {
    const el = document.querySelector<HTMLElement>("#act-curate-sample-info");
    if (!el) return;
    const shown = this._curateExamples.length;
    const changed = this._curateGlobalChanged;
    if (changed === 0 || shown === 0) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    if (shown < changed) {
      // Truncated: we show a partial sample
      el.className = "curate-sample-info curate-sample-truncated";
      el.innerHTML =
        `&#9432;&#160;<strong>${shown}</strong> modification(s) affich&#233;e(s) sur` +
        ` <strong>${changed}</strong> au total &#8212;` +
        ` <span class="sample-scope-note">preview limit&#233;e &#224; ${CURATE_PREVIEW_LIMIT}&#160;exemples</span>`;
    } else {
      // Full sample: nothing hidden
      el.className = "curate-sample-info curate-sample-full";
      el.innerHTML =
        `&#10003;&#160;${shown} modification(s) affich&#233;e(s) &#8212;` +
        ` <span class="sample-scope-note">liste compl&#232;te</span>`;
    }
  }

  /** Show or hide the filter badge in the preview controls. */
  private _updateFilterBadge(panel?: HTMLElement | null): void {
    const scope = panel ?? document;
    const badge = scope.querySelector<HTMLElement>("#act-curate-filter-badge")
      ?? document.querySelector<HTMLElement>("#act-curate-filter-badge");
    const labelEl = scope.querySelector<HTMLElement>("#act-curate-filter-label")
      ?? document.querySelector<HTMLElement>("#act-curate-filter-label");
    if (!badge) return;
    if (this._activeRuleFilter) {
      badge.style.display = "";
      if (labelEl) labelEl.textContent = this._activeRuleFilter;
    } else {
      badge.style.display = "none";
    }
  }

  /**
   * Select a diff item by index: highlights the row in the diff pane,
   * syncs the raw pane scroll, and updates nav buttons + position indicator.
   */
  private _setActiveDiffItem(idx: number | null, panel?: HTMLElement | null): void {
    // Level 7A: cancel any uncommitted manual edit when switching to a different item
    if (this._editingManualOverride) {
      this._editingManualOverride = false;
    }
    this._activeDiffIdx = idx;
    const scope = panel ?? document;

    // Highlight diff row
    scope.querySelectorAll<HTMLElement>("tr[data-diff-idx]").forEach(tr => {
      tr.classList.toggle("diff-active", tr.dataset.diffIdx === String(idx));
    });
    if (idx !== null) {
      const activeRow = scope.querySelector<HTMLElement>(`tr[data-diff-idx="${idx}"]`);
      activeRow?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    // Highlight raw paragraph and sync scroll
    scope.querySelectorAll<HTMLElement>("[data-diff-idx].raw-unit").forEach(p => {
      p.classList.toggle("raw-active", p.dataset.diffIdx === String(idx));
    });
    if (idx !== null && this._previewSyncScroll) {
      const rawPara = scope.querySelector<HTMLElement>(`.raw-unit[data-diff-idx="${idx}"]`);
      rawPara?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    // Update position indicator and nav buttons (scoped to filtered set)
    const total = this._filteredExamples().length;
    const filterParts: string[] = [];
    if (this._activeRuleFilter)  filterParts.push(this._activeRuleFilter);
    if (this._activeStatusFilter) filterParts.push(ActionsScreen._STATUS_LABEL[this._activeStatusFilter] ?? this._activeStatusFilter);
    const filterSuffix = filterParts.length ? ` (${filterParts.join(" + ")})` : "";
    const posEl = scope.querySelector<HTMLElement>("#act-diff-position") ?? document.querySelector<HTMLElement>("#act-diff-position");
    if (posEl) posEl.textContent = total > 0 && idx !== null ? `${idx + 1} / ${total}${filterSuffix}` : total > 0 ? `${total} modif.` : "—";

    const prevBtn = scope.querySelector<HTMLButtonElement>("#act-diff-prev") ?? document.querySelector<HTMLButtonElement>("#act-diff-prev");
    const nextBtn = scope.querySelector<HTMLButtonElement>("#act-diff-next") ?? document.querySelector<HTMLButtonElement>("#act-diff-next");
    if (prevBtn) prevBtn.disabled = idx === null || idx <= 0;
    if (nextBtn) nextBtn.disabled = idx === null || idx >= total - 1;

    // Update preview-info header
    const infoEl = document.querySelector<HTMLElement>("#act-preview-info");
    if (infoEl && total > 0 && idx !== null) {
      infoEl.textContent = `Modif. ${idx + 1}/${total}${filterSuffix}`;
    }

    // Reflect active item's status in action buttons
    this._updateActionButtons();

    // Update context detail card for the active example
    const activeEx = idx !== null ? this._filteredExamples()[idx] ?? null : null;
    this._renderContextDetail(activeEx);
  }

  /** Switch the preview pane display mode and update the mode button visual state. */
  private _applyPreviewMode(container: HTMLElement): void {
    const rawPane  = container.querySelector<HTMLElement>("#act-preview-raw")?.closest<HTMLElement>(".pane");
    const diffPane = container.querySelector<HTMLElement>("#act-diff-list")?.closest<HTMLElement>(".pane");
    if (rawPane)  rawPane.style.display  = this._previewMode === "diffonly"   ? "none" : "";
    if (diffPane) diffPane.style.display = this._previewMode === "rawonly"    ? "none" : "";
    container.querySelectorAll<HTMLButtonElement>(".preview-mode-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.previewMode === this._previewMode);
    });
    // Expose mode on the preview-grid so CSS can adapt column layout (ex: full-width in diffonly)
    const previewGrid = container.querySelector<HTMLElement>(".preview-grid");
    if (previewGrid) previewGrid.dataset.previewMode = this._previewMode;
  }

  private _currentRules(): CurateRule[] {
    const rules: CurateRule[] = [];
    if (this._isRuleChecked("act-rule-spaces")) rules.push(...CURATE_PRESETS.spaces.rules);
    if (this._isRuleChecked("act-rule-quotes")) rules.push(...CURATE_PRESETS.quotes.rules);
    const punctLang = this._getPunctLang();
    if (punctLang === "fr") rules.push(...CURATE_PRESETS.punctuation_fr.rules);
    else if (punctLang === "en") rules.push(...CURATE_PRESETS.punctuation_en.rules);
    if (this._isRuleChecked("act-rule-invisibles")) rules.push(...CURATE_PRESETS.invisibles.rules);
    if (this._isRuleChecked("act-rule-numbering")) rules.push(...CURATE_PRESETS.numbering.rules);

    const raw = (document.querySelector("#act-curate-rules") as HTMLTextAreaElement | null)?.value ?? "";
    rules.push(...this._parseAdvancedCurateRules(raw));
    rules.push(...this._frExtraRules);
    return rules;
  }

  private _currentCurateDocId(): number | undefined {
    const v = (document.querySelector("#act-curate-doc") as HTMLSelectElement)?.value;
    return v ? parseInt(v) : undefined;
  }

  private _curateDocIndex(docId: number | undefined): number {
    if (docId === undefined) return -1;
    return this._docs.findIndex((d) => d.doc_id === docId);
  }

  private _navigateCurateDoc(direction: -1 | 1): void {
    const sel = document.querySelector<HTMLSelectElement>("#act-curate-doc");
    if (!sel || this._docs.length === 0) return;
    const currentId = this._currentCurateDocId();
    const idx = this._curateDocIndex(currentId);
    let nextIdx = idx;
    if (idx < 0) nextIdx = direction > 0 ? 0 : this._docs.length - 1;
    else nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= this._docs.length) return;
    sel.value = String(this._docs[nextIdx].doc_id);
    sel.dispatchEvent(new Event("change"));
  }

  private _refreshCurateHeaderState(): void {
    const docLabelEl = document.querySelector<HTMLElement>("#act-curate-doc-label");
    const modePillEl = document.querySelector<HTMLElement>("#act-curate-mode-pill");
    const docId = this._currentCurateDocId();
    const doc = docId !== undefined ? this._docs.find((d) => d.doc_id === docId) : undefined;
    if (docLabelEl) {
      docLabelEl.textContent = doc
        ? `#${doc.doc_id} · ${doc.title} (${doc.language})`
        : "Portée: tous les documents";
    }
    if (modePillEl) {
      if (!this._conn) modePillEl.textContent = "Mode hors ligne";
      else if (this._isBusy) modePillEl.textContent = "Traitement en cours";
      else if (this._hasPendingPreview) modePillEl.textContent = "Preview en attente";
      else if (doc) modePillEl.textContent = `Mode document #${doc.doc_id}`;
      else modePillEl.textContent = "Mode corpus";
    }
  }

  private _renderCurateQuickQueue(): void {
    const queueEl = document.querySelector<HTMLElement>("#act-curate-queue");
    const prevBtn = document.querySelector<HTMLButtonElement>("#act-curate-prev-btn");
    const nextBtn = document.querySelector<HTMLButtonElement>("#act-curate-next-btn");
    if (!queueEl) return;
    if (this._docs.length === 0) {
      queueEl.innerHTML = '<p class="empty-hint">Aucun document charg&#233;.</p>';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }
    const currentId = this._currentCurateDocId();
    const currentIdx = this._curateDocIndex(currentId);
    if (currentIdx < 0) {
      queueEl.innerHTML = `
        <div class="curate-qitem">
          <div class="curate-qmeta"><span>File locale</span><span>${this._docs.length} doc(s)</span></div>
          <div>Aucun document cibl&#233;. Utilisez <strong>Suivant</strong> pour d&#233;marrer la revue locale.</div>
        </div>
      `;
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = false;
      return;
    }
    const start = Math.max(0, currentIdx - 1);
    const end = Math.min(this._docs.length, currentIdx + 2);
    const rows = this._docs.slice(start, end).map((doc, offset) => {
      const idx = start + offset;
      const state = idx === currentIdx ? "Document actif" : idx < currentIdx ? "D&#233;j&#224; revu" : "Suivant";
      const role = doc.doc_role ? `${_escHtml(doc.doc_role)} · ` : "";
      return `
        <div class="curate-qitem${idx === currentIdx ? " curate-log-apply" : ""}">
          <div class="curate-qmeta"><span>#${doc.doc_id} · ${_escHtml(doc.language)}</span><span>${state}</span></div>
          <div>${_escHtml(doc.title)}</div>
          <div style="font-size:11px;color:var(--prep-muted,#4f5d6d)">${role}${doc.unit_count} unit&#233;s</div>
        </div>
      `;
    }).join("");
    queueEl.innerHTML = rows;
    if (prevBtn) prevBtn.disabled = currentIdx <= 0;
    if (nextBtn) nextBtn.disabled = currentIdx >= this._docs.length - 1;
  }

  /** Push an entry to the in-memory curate log (max 10, FIFO) and re-render. */
  private _pushCurateLog(kind: "preview" | "apply" | "warn", msg: string): void {
    this._curateLog.unshift({ ts: Date.now(), kind, msg });
    if (this._curateLog.length > 10) this._curateLog.length = 10;
    // Auto-open the bottom panel when a new log entry arrives
    const bottomPanel = document.querySelector<HTMLDetailsElement>("#act-curate-bottom-panel");
    if (bottomPanel && !bottomPanel.open) bottomPanel.open = true;
    this._renderCurateLog();
  }

  private _renderCurateLog(): void {
    const el = document.querySelector<HTMLElement>("#act-curate-review-log");
    if (!el) return;
    if (this._curateLog.length === 0) {
      el.innerHTML = `<p class="empty-hint" style="padding:10px">Aucune action enregistr&#233;e.</p>`;
      return;
    }
    const now = Date.now();
    el.innerHTML = this._curateLog.map(entry => {
      const diffS = Math.round((now - entry.ts) / 1000);
      const age = diffS < 60 ? `il y a ${diffS} s` : new Date(entry.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      const kindClass = entry.kind === "warn" ? "curate-log-warn" : entry.kind === "apply" ? "curate-log-apply" : "";
      return `<div class="curate-qitem ${kindClass}">` +
        `<div class="curate-qmeta"><span>${entry.kind === "preview" ? "Prévisu" : entry.kind === "apply" ? "Application" : "⚠"}</span><span>${age}</span></div>` +
        `<div>${_escHtml(entry.msg)}</div>` +
        `</div>`;
    }).join("");
  }

  /** Update the 2×2 context info row in the left col when doc selection changes. */
  private _updateCurateCtx(): void {
    const el = document.querySelector<HTMLElement>("#act-curate-ctx");
    if (!el) return;
    const docId = this._currentCurateDocId();
    const doc = docId !== undefined ? this._docs.find(d => d.doc_id === docId) : undefined;
    const pivotLabel = !doc ? "fr" : (doc.language?.toLowerCase() === "fr" ? "Fran&#231;ais (VO)" : _escHtml(doc.language ?? "fr"));
    const packLabel = "&#8212;";
    const scopeLabel = doc ? "Document s&#233;lectionn&#233;" : "Document complet";
    const liveLabel = "Actif";
    el.innerHTML =
      `<div class="f curate-ctx-cell"><strong>Langue pivot</strong>${pivotLabel}</div>` +
      `<div class="f curate-ctx-cell"><strong>Pack</strong>${packLabel}</div>` +
      `<div class="f curate-ctx-cell"><strong>Port&#233;e</strong>${scopeLabel}</div>` +
      `<div class="f curate-ctx-cell"><strong>Aper&#231;u live</strong>${liveLabel}</div>`;
    this._refreshCurateHeaderState();
    this._renderCurateQuickQueue();
  }

  private _populateSelects(): void {
    const allDocSelects = ["act-curate-doc", "act-align-pivot",
      "act-align-targets", "act-meta-doc", "act-audit-pivot", "act-audit-target",
      "act-quality-pivot", "act-quality-target",
      "act-coll-pivot", "act-coll-target"];
    allDocSelects.forEach(id => {
      const sel = document.querySelector(`#${id}`) as HTMLSelectElement | null;
      if (!sel) return;
      const keepFirst = sel.options[0]?.value === "" ? sel.options[0] : null;
      sel.innerHTML = "";
      if (keepFirst) sel.appendChild(keepFirst);
      for (const doc of this._docs) {
        const opt = document.createElement("option");
        opt.value = String(doc.doc_id);
        opt.textContent = `[${doc.doc_id}] ${doc.title} (${doc.language}, ${doc.unit_count} u.)`;
        sel.appendChild(opt);
      }
    });
  }

  private async _loadDocs(): Promise<void> {
    if (!this._conn) return;
    try {
      this._docs = await listDocuments(this._conn);
      this._renderDocList();
      this._renderSegBatchOverview();
      this._populateSelects();
      this._populateSegDocList();
      this._updateCurateCtx();
      this._setButtonsEnabled(true);
      this._loadAlignDocsIntoSelects();
      this._alignPanel?.refreshDocs();
      this._log(`${this._docs.length} document(s) chargé(s).`);
      this._refreshSegmentationStatusUI();
      this._refreshRuntimeState();
    } catch (err) {
      this._log(`Erreur chargement docs : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._refreshSegmentationStatusUI();
      this._refreshRuntimeState();
    }
  }

  private _renderDocList(): void {
    const el = document.querySelector("#act-doc-list");
    if (!el) return;
    if (this._docs.length === 0) {
      el.innerHTML = '<p class="empty-hint">Aucun document importé.</p>';
      return;
    }
    const table = document.createElement("table");
    table.className = "meta-table";
    table.innerHTML = `<thead><tr><th>ID</th><th>Titre</th><th>Langue</th><th>Rôle</th><th>Unités</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    for (const doc of this._docs) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${doc.doc_id}</td><td>${doc.title}</td><td>${doc.language}</td><td>${doc.doc_role ?? "—"}</td><td>${doc.unit_count}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    el.innerHTML = "";
    el.appendChild(table);
  }

  // ─── Feature 1: Curation Preview ─────────────────────────────────────────

  private async _runPreview(silent = false): Promise<void> {
    if (!this._conn) return;
    const docId = this._currentCurateDocId();
    if (docId === undefined) {
      if (!silent) this._log("Sélectionnez un document pour la prévisualisation.", true);
      return;
    }
    const rules = this._currentRules();
    if (rules.length === 0) {
      if (!silent) this._log("Aucune règle de curation configurée.", true);
      return;
    }

    this._setBusy(true);
    // vNext: panel is always visible; update info label + show loading state
    const infoEl = document.querySelector("#act-preview-info");
    if (infoEl) infoEl.textContent = "Chargement…";
    const rawEl = document.querySelector("#act-preview-raw");
    if (rawEl) rawEl.innerHTML = `<p class="loading-hint">Prévisualisation en cours…</p>`;
    const diffEl0 = document.querySelector("#act-diff-list");
    if (diffEl0) diffEl0.innerHTML = "";

    try {
      const res = await curatePreview(this._conn, {
        doc_id: docId,
        rules,
        limit_examples: CURATE_PREVIEW_LIMIT,
        ...(this._forcedPreviewUnitId !== null ? { force_unit_id: this._forcedPreviewUnitId } : {}),
      });
      this._forcedPreviewUnitId = null; // reset after use

      // Stats banner (footer)
      const statsEl = document.querySelector("#act-preview-stats")!;
      const changed = res.stats.units_changed;
      const total = res.stats.units_total;
      const reps = res.stats.replacements_total;
      this._hasPendingPreview = changed > 0;
      statsEl.innerHTML = changed === 0
        ? `<span class="stat-ok">✓ Aucune modification prévue (${total} unités analysées).</span>`
        : `<span class="stat-warn">⚠ ${changed}/${total} unité(s) modifiée(s), ${reps} remplacement(s).</span>`;

      // Info label in preview card header
      if (infoEl) infoEl.textContent = `${total} unités · ${changed} modifiée(s)`;

      // Store examples with initial status "pending" for every item.
      // Level 4B: restore statuses from localStorage when context is compatible
      // (same docId, same rulesSignature, units_total within ±10%).
      this._curateExamples = res.examples.map(ex => ({ ...ex, status: "pending" as const }));
      this._curateGlobalChanged = changed;
      this._curateUnitsTotal = total;   // needed by _saveCurateReviewState
      this._activeDiffIdx = null;
      this._activeRuleFilter = null;
      this._activeStatusFilter = null;
      // Build rule labels AFTER storing examples (must match rules sent to server)
      this._buildRuleLabels();
      // Attempt restore; pass current stats so divergence can be detected.
      this._curateRestoredCount = this._restoreCurateReviewState(rules, total, changed);

      // Raw pane and diff pane: use filtered list (= full list since filter is reset)
      const toRender = this._filteredExamples();
      this._refreshCuratePreviewPanes();

      // Update diagnostics panel (right column)
      this._renderCurateDiag(changed, total, reps);

      // Hide filter badge + show sample-info notice + session summary
      const panel = document.querySelector<HTMLElement>("#act-preview-panel");
      this._updateFilterBadge(panel);
      this._updateSampleInfo();
      this._updateSessionSummary();

      // Show action bar when there are examples to review
      const actionBar = document.querySelector<HTMLElement>("#act-curate-action-bar");
      if (actionBar) actionBar.style.display = toRender.length > 0 ? "" : "none";
      this._updateActionButtons();

      // Auto-select first diff item if any
      if (toRender.length > 0) {
        this._setActiveDiffItem(0, panel ?? undefined);
      }

      // Minimap
      this._renderCurateMinimap(res.examples.length, total);

      // Show / hide apply button
      const applyBtn = document.querySelector("#act-apply-after-preview-btn") as HTMLButtonElement;
      applyBtn.style.display = changed > 0 ? "" : "none";
      // Show review export card as soon as we have a loaded sample.
      const reviewExportCard = document.querySelector<HTMLElement>("#act-review-export-card");
      if (reviewExportCard) reviewExportCard.style.display = "";
      (document.querySelector("#act-reindex-after-curate-btn") as HTMLElement).style.display = "none";

      this._log(`Prévisualisation : ${changed}/${total} unités → ${reps} remplacements.`);
      const previewMsg = changed === 0
        ? `OK – aucune modification (${total} unités)`
        : `OK – ${changed}/${total} unités, ${reps} remplacement(s)`;
      this._pushCurateLog("preview", previewMsg);

      // Level 7B: load persistent exceptions for this document (async, non-blocking).
      // After loading, re-render to reflect exception badges.
      this._loadCurateExceptions().then(() => {
        const filtered = this._filteredExamples();
        // Badges d'exception sur les lignes du diff uniquement ; si aucun exemple, ne pas
        // rappeler _renderDiffList (viderait le texte plein doc chargé quand changed === 0).
        if (filtered.length > 0) {
          this._renderDiffList(filtered);
        }
        const activeEx = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
        this._renderContextDetail(activeEx);
        if (this._curateExceptions.size > 0) {
          // Optionally update stats banner to mention silenced units
          const excIgnored = [...this._curateExceptions.values()].filter(e => e.kind === "ignore").length;
          if (excIgnored > 0) {
            const statsEl = document.querySelector("#act-preview-stats");
            if (statsEl) {
              const cur = statsEl.innerHTML;
              statsEl.innerHTML = cur + ` <span class="stat-exc">🔒 ${excIgnored} unité(s) silencée(s) par exception persistée.</span>`;
            }
          }
        }
      }).catch(() => { /* non-critical */ });
      // Level 8A: also refresh the admin panel (cross-doc list) after each preview.
      if (this._root) {
        const root = this._root;
        const panel = root.querySelector<HTMLDetailsElement>("#act-exc-admin-panel");
        // Only auto-refresh if the panel is already open (avoid unnecessary requests)
        if (panel?.open) {
          this._loadExceptionsAdminPanel(root).catch(() => { /* non-critical */ });
        } else {
          // Update badge count with current session exceptions size
          const badge = root.querySelector<HTMLElement>("#act-exc-admin-badge");
          if (badge && this._curateExceptions.size > 0) {
            badge.textContent = String(this._curateExceptions.size);
            badge.style.display = "inline-flex";
          }
        }
      }
    } catch (err) {
      this._forcedPreviewUnitId = null; // always reset even on failure
      this._hasPendingPreview = false;
      if (infoEl) infoEl.textContent = "Erreur";
      const msg = err instanceof SidecarError ? err.message : String(err);
      const rawElErr = document.querySelector("#act-preview-raw");
      if (rawElErr) rawElErr.innerHTML = `<p class="diag-v warn" style="margin:0"><strong>Erreur prévisualisation</strong>${_escHtml(msg)}</p>`;
      if (!silent) {
        this._log(`✗ Prévisualisation : ${msg}`, true);
        this._pushCurateLog("warn", `Erreur prévisu : ${msg}`);
      }
    }
    this._setBusy(false);
    this._refreshRuntimeState();
  }

  private _renderSegBatchOverview(): void {
    const listEl = document.querySelector("#act-seg-batch-list");
    const infoEl = document.querySelector("#act-seg-batch-info");
    if (!listEl) return;
    const docs = this._docs;
    if (docs.length === 0) {
      listEl.innerHTML = `<p class="empty-hint">Aucun document.</p>`;
      if (infoEl) infoEl.textContent = "—";
      return;
    }
    // Compute status counters
    const countValidated = docs.filter((d) => d.workflow_status === "validated").length;
    const countReview = docs.filter((d) => d.workflow_status === "review").length;
    const countNone = docs.length - countValidated - countReview;
    if (infoEl) infoEl.innerHTML =
      `<span class="seg-batch-badge seg-badge-ok" style="margin-right:3px">${countValidated} ✓</span>` +
      (countReview ? `<span class="seg-batch-badge seg-badge-warn" style="margin-right:3px">${countReview} ⏳</span>` : "") +
      (countNone ? `<span class="seg-batch-badge seg-badge-none">${countNone} —</span>` : "");
    const statusLabel = (s: string | undefined): string => {
      if (!s || s === "draft") return `<span class="seg-batch-badge seg-badge-none">Brouillon</span>`;
      if (s === "validated") return `<span class="seg-batch-badge seg-badge-ok">✓ Validé</span>`;
      if (s === "review") return `<span class="seg-batch-badge seg-badge-warn">⏳ En revue</span>`;
      return `<span class="seg-batch-badge seg-badge-none">${_escHtml(s)}</span>`;
    };
    listEl.innerHTML = `<div class="seg-batch-list">${docs.map((d) => `
      <div class="seg-batch-line">
        <div>
          <strong>${_escHtml(d.title)}</strong>
          <div class="seg-batch-meta">doc#${d.doc_id} · ${d.language} · ${d.unit_count} u.</div>
        </div>
        ${statusLabel(d.workflow_status)}
      </div>`).join("")}</div>`;
  }

  private _renderSegPreview(): void {
    const body = document.querySelector("#act-seg-preview-body");
    const info = document.querySelector("#act-seg-preview-info");
    if (!body) return;
    const r = this._lastSegmentReport;
    if (!r) {
      body.innerHTML = `<p class="empty-hint">Lancez une segmentation pour voir les résultats ici.</p>`;
      if (info) info.textContent = "—";
      return;
    }
    const warnings = r.warnings ?? [];
    if (info) info.textContent = `${r.units_output} segments · ${r.segment_pack === "markers" ? "balises [N]" : `coupes ${r.segment_pack ?? "auto"}`}`;
    const warnHtml = warnings.length
      ? `<div class="seg-warn-list">${warnings.map((w) => `<div class="seg-warn">${_escHtml(w)}</div>`).join("")}</div>`
      : `<p class="stat-ok" style="font-size:12px">✓ Aucun avertissement</p>`;
    body.innerHTML = `
      <div class="seg-stats-grid">
        <div class="seg-stat"><strong>${r.units_input}</strong>Unités avant</div>
        <div class="seg-stat"><strong>${r.units_output}</strong>Segments après</div>
        <div class="seg-stat"><strong>${warnings.length}</strong>Avertissements</div>
        <div class="seg-stat"><strong>${r.segment_pack === "markers" ? "balises [N]" : (r.segment_pack ?? "auto")}</strong>R&#233;glage phrases</div>
      </div>
      ${warnHtml}
    `;
    // Update units minimap after segmentation
    const mmEl = document.querySelector<HTMLElement>("#act-seg-units-minimap");
    if (mmEl) this._renderMinimap(mmEl, r.units_output, warnings.length);
    // Update footer stats
    const footEl = document.querySelector<HTMLElement>("#act-seg-units-foot-stats");
    if (footEl) {
      const doc = this._docs.find(d => d.doc_id === r.doc_id);
      footEl.textContent = `${doc ? _escHtml(doc.title) : `doc#${r.doc_id}`} · ${r.units_output} segments`;
    }
  }

  /**
   * After segmentation, fetches the resulting units via getDocumentPreview and
   * appends them below the stats in the "Proposition" pane (#act-seg-preview-body).
   * Also reloads the "Document brut" pane so both tabs are up-to-date.
   */
  private async _appendSegmentedLinesPreview(docId: number): Promise<void> {
    if (!this._conn) return;

    // 1. Reload "Document brut" tab (now contains post-segmentation units)
    const segCard = document.querySelector<HTMLElement>("#act-seg-preview-card");
    if (segCard) void this._loadUnitsRawPreview(segCard, docId);

    // 2. Fetch units and append below the stats in "Proposition" pane
    const body = document.querySelector<HTMLElement>("#act-seg-preview-body");
    if (!body) return;
    try {
      const preview = await getDocumentPreview(this._conn, docId, 300);
      if (!preview.lines.length) return;
      const truncNote = preview.total_lines > preview.limit
        ? `<p class="empty-hint seg-result-trunc">Aperçu — ${preview.limit}/${preview.total_lines} unités</p>`
        : "";
      body.insertAdjacentHTML(
        "beforeend",
        `<div class="seg-result-sep-row"><hr class="seg-result-sep"><span class="seg-result-label">Segments résultants (${preview.total_lines})</span></div>` +
        truncNote +
        preview.lines.map((l) =>
          `<div class="vo-line"><span class="vo-ln">${l.n}</span><span class="vo-txt">${_escHtml(l.text)}</span></div>`,
        ).join(""),
      );
    } catch {
      // best-effort — ignore errors
    }
  }

  /** Loads first 100 lines of a doc into the units raw-text pane (best-effort). */
  private async _loadUnitsRawPreview(el: HTMLElement, docId: number): Promise<void> {
    const rawScroll = el.querySelector<HTMLElement>("#act-seg-raw-scroll");
    if (!rawScroll || !this._conn) return;
    rawScroll.innerHTML = '<p class="empty-hint">Chargement du texte brut&#8230;</p>';
    try {
      const preview = await getDocumentPreview(this._conn, docId, 100);
      if (!preview.lines.length) {
        rawScroll.innerHTML = '<p class="empty-hint">Aucune unit&#233; disponible pour ce document.</p>';
        return;
      }
      const truncNote = preview.total_lines > preview.limit
        ? `<p class="empty-hint" style="margin:4px 0 8px;font-style:italic">Aper&#231;u — ${preview.limit}/${preview.total_lines} unit&#233;s</p>`
        : "";
      rawScroll.innerHTML = truncNote + preview.lines.map(l =>
        `<div class="vo-line"><span class="vo-ln">${l.n}</span><span class="vo-txt">${_escHtml(l.text)}</span></div>`
      ).join("");
    } catch {
      rawScroll.innerHTML = '<p class="empty-hint">Impossible de charger le texte brut.</p>';
    }
  }

  private _renderCurateDiag(changed: number, total: number, replacements: number): void {
    const diagEl = document.querySelector<HTMLElement>("#act-curate-diag");
    if (!diagEl) return;

    if (changed === 0) {
      diagEl.innerHTML = `<div class="curate-diag"><strong>✓ Aucune modification</strong>${total} unités analysées, corpus propre.</div>`;
    } else {
      const shown = this._curateExamples.length;
      const isTruncated = shown < this._curateGlobalChanged;
      const ruleStats = this._getRuleStats(); // label → count (within sample only)

      // Truncation notice: shown when the sample doesn't cover all real changes.
      // We can confirm truncation (shown < changed) but cannot state the exact total per rule.
      const truncationHtml = isTruncated
        ? `<div class="curate-diag curate-diag-notice">
             &#9432;&#160;Preview limit&#233;e &#224; ${shown}&#160;exemples sur&#160;${this._curateGlobalChanged} modifications r&#233;elles.
             Les compteurs par r&#232;gle ci-dessous concernent uniquement l&#8217;&#233;chantillon affich&#233;.
           </div>`
        : "";

      // Build per-rule clickable chips with explicit scope annotation
      let ruleChipsHtml = "";
      if (ruleStats.size > 0) {
        const scopeNote = isTruncated
          ? `<span class="diag-scope-note">dans l&#8217;&#233;chantillon courant</span>`
          : "";
        const chipsInner = [...ruleStats.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) =>
            `<span class="chip curate-diag-rule-chip" data-rule-label="${_escHtml(label)}" role="button" tabindex="0"` +
            ` title="Filtrer sur : ${_escHtml(label)}${isTruncated ? " (dans l\u2019\u00e9chantillon courant)" : ""}"` +
            `>${_escHtml(label)}<span class="diag-rule-count">${count}</span></span>`
          ).join("");
        ruleChipsHtml = `
          <div class="curate-diag curate-diag-rules">
            <strong>Filtrer par r&#232;gle</strong>${scopeNote}
            <div class="chip-row diag-rule-chips" style="margin-top:5px">${chipsInner}</div>
          </div>`;
      }

      diagEl.innerHTML = `
        <div class="curate-diag warn curate-diag-summary">
          <strong>${changed} unit&#233;(s) modifi&#233;e(s)</strong>
          ${replacements} remplacement(s) sur ${total} unit&#233;s.
        </div>
        ${shown > 0 ? `<div class="curate-diag curate-diag-action" id="act-diag-goto-first" role="button" tabindex="0">
          <strong>&#8594; Premi&#232;re modification</strong>
          <span style="font-size:11px;color:var(--prep-muted)">${shown} exemple(s) &#8212; cliquer pour naviguer</span>
        </div>` : ""}
        ${truncationHtml}
        ${ruleChipsHtml}
        <div class="curate-diag">
          <strong>Impact segmentation</strong>
          V&#233;rifiez la preview avant d&#8217;appliquer.
        </div>
      `;

      // Jump-to-first listener
      if (shown > 0) {
        const gotoBtn = diagEl.querySelector<HTMLElement>("#act-diag-goto-first");
        gotoBtn?.addEventListener("click", () => {
          const panel = document.querySelector<HTMLElement>("#act-preview-panel") ?? undefined;
          this._setRuleFilter(null, panel);
          document.querySelector("#act-diff-list")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
        gotoBtn?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") gotoBtn.click(); });
      }

      // Per-rule chip filter listeners
      diagEl.querySelectorAll<HTMLElement>(".curate-diag-rule-chip").forEach(chip => {
        const label = chip.dataset.ruleLabel ?? "";
        const activate = () => {
          const panel = document.querySelector<HTMLElement>("#act-preview-panel") ?? undefined;
          // Toggle: clicking the active filter clears it
          this._setRuleFilter(this._activeRuleFilter === label ? null : label, panel);
        };
        chip.addEventListener("click", activate);
        chip.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") activate(); });
      });
    }

    // Show "Voir segmentation" link if a segmentation report exists
    const segLinkEl = document.querySelector<HTMLElement>("#act-curate-seg-link");
    if (segLinkEl) {
      if (this._lastSegmentReport) {
        const r = this._lastSegmentReport;
        segLinkEl.style.display = "";
        segLinkEl.innerHTML = `
          <button class="acts-hub-head-link" data-action="goto-seg" style="font-size:11.5px">
            &#9654; Voir segmentation (${r.units_output} unités${r.warnings?.length ? ` · ${r.warnings.length} avertissements` : ""})
          </button>`;
      } else {
        segLinkEl.style.display = "none";
      }
    }
  }

  private _renderCurateMinimap(changed: number, total: number): void {
    const mm = document.querySelector("#act-curate-minimap");
    if (!mm) return;
    const bars = 12;
    const density = total > 0 ? Math.min(changed / total, 1) : 0;
    const changedBars = Math.round(density * bars);
    mm.innerHTML = Array.from({ length: bars }, (_, i) =>
      `<div class="mm${i < changedBars ? " changed" : ""}"></div>`
    ).join("");
  }

  /**
   * Rafraîchit les panneaux « Texte brut » et « Texte curé ».
   * Si la prévisu ne retourne aucun exemple (document inchangé avec ces règles),
   * charge le texte des unités via /documents/preview au lieu d’un simple message vide.
   */
  private _refreshCuratePreviewPanes(): void {
    const filtered = this._filteredExamples();
    const docId = this._currentCurateDocId();
    if (
      filtered.length === 0 &&
      this._curateGlobalChanged === 0 &&
      (this._curateUnitsTotal ?? 0) > 0 &&
      docId !== undefined &&
      !this._activeRuleFilter &&
      !this._activeStatusFilter
    ) {
      void this._fillCuratePanesWithDocumentText(docId);
      return;
    }
    this._renderRawPane(filtered);
    this._renderDiffList(filtered);
  }

  private async _fillCuratePanesWithDocumentText(docId: number): Promise<void> {
    const rawEl = document.querySelector<HTMLElement>("#act-preview-raw");
    const diffEl = document.querySelector<HTMLElement>("#act-diff-list");
    if (!this._conn || !rawEl || !diffEl) return;
    rawEl.innerHTML = '<p class="loading-hint">Chargement du texte&#8230;</p>';
    diffEl.innerHTML = '<p class="loading-hint">Chargement&#8230;</p>';
    try {
      const preview = await getDocumentPreview(this._conn, docId, 300);
      if (!preview.lines.length) {
        const empty = '<p class="empty-hint">Aucune unit&#233; disponible pour ce document.</p>';
        rawEl.innerHTML = empty;
        diffEl.innerHTML = empty;
        return;
      }
      const bannerRaw =
        `<div class="stat-ok" style="margin-bottom:8px;font-size:13px">` +
        `&#10003;&#160;Aucune modification &#8212; le document est propre avec ces r&#232;gles.</div>`;
      const bannerDiff =
        `<div class="stat-ok" style="margin-bottom:8px;font-size:13px">` +
        `&#10003;&#160;Aucune diff&#233;rence &#8212; texte cur&#233; identique au source.</div>`;
      const truncNote = preview.total_lines > preview.limit
        ? `<p class="empty-hint" style="margin:4px 0 8px;font-style:italic">` +
          `Aper&#231;u &#8212; ${preview.limit}/${preview.total_lines} unit&#233;s</p>`
        : "";
      const linesHtml = preview.lines.map(l =>
        `<div class="vo-line"><span class="vo-ln">${l.n}</span><span class="vo-txt">${_escHtml(l.text)}</span></div>`,
      ).join("");
      rawEl.innerHTML = bannerRaw + truncNote + linesHtml;
      diffEl.innerHTML = bannerDiff + truncNote + linesHtml;
    } catch {
      const err = '<p class="empty-hint">Impossible de charger le texte.</p>';
      rawEl.innerHTML = err;
      diffEl.innerHTML = err;
    }
  }

  private _renderRawPane(examples: CuratePreviewExample[]): void {
    const el = document.querySelector<HTMLElement>("#act-preview-raw");
    if (!el) return;
    if (examples.length === 0) {
      let msg: string;
      if (this._activeRuleFilter) {
        // Filter active but no matches in sample
        msg = `Aucune modification pour &#171;&#160;${_escHtml(this._activeRuleFilter)}&#160;&#187; dans cet &#233;chantillon.` +
          ` <button class="btn-inline-link" id="raw-pane-clear-filter">Effacer le filtre</button>`;
      } else if (this._curateGlobalChanged === 0) {
        // Document is genuinely clean with these rules
        msg = `&#10003;&#160;Aucune modification &#8212; le document est propre avec ces r&#232;gles.`;
      } else {
        // Shouldn't normally happen (sample empty while changes exist and no filter)
        msg = `Aucun exemple disponible dans cet &#233;chantillon.`;
      }
      el.innerHTML = `<p class="empty-hint">${msg}</p>`;
      el.querySelector<HTMLElement>("#raw-pane-clear-filter")?.addEventListener("click", () => {
        this._setRuleFilter(null, document.querySelector<HTMLElement>("#act-preview-panel"));
      });
      return;
    }
    el.innerHTML = "";
    examples.forEach((ex, i) => {
      const p = document.createElement("p");
      p.dataset.diffIdx = String(i);
      p.className = "raw-unit";
      // Primary label from first matched rule (if available)
      const firstLabel = (ex.matched_rule_ids ?? []).length > 0
        ? (this._curateRuleLabels[ex.matched_rule_ids![0]] ?? "")
        : "";
      // Status class for raw pane
      const st = ex.status ?? "pending";
      if (st !== "pending") p.classList.add(`raw-${st}`);
      if (firstLabel) {
        const badge = document.createElement("span");
        badge.className = "raw-rule-badge";
        badge.textContent = firstLabel;
        p.appendChild(badge);
        p.appendChild(document.createTextNode(" "));
      }
      p.appendChild(document.createTextNode(ex.before));
      p.addEventListener("click", () => {
        const panel = p.closest<HTMLElement>("#act-preview-panel") ?? undefined;
        this._setActiveDiffItem(i, panel);
      });
      el.appendChild(p);
    });
  }

  private _renderDiffList(examples: CuratePreviewExample[]): void {
    const el = document.querySelector<HTMLElement>("#act-diff-list")!;
    if (examples.length === 0) {
      let msg: string;
      if (this._activeRuleFilter) {
        msg = `Aucune modification pour &#171;&#160;${_escHtml(this._activeRuleFilter)}&#160;&#187; dans cet &#233;chantillon.` +
          ` <button class="btn-inline-link" id="diff-pane-clear-filter">Effacer le filtre</button>`;
      } else if (this._curateGlobalChanged === 0) {
        msg = `&#10003;&#160;Aucune modification &#8212; document propre.`;
      } else {
        msg = `Aucun exemple dans cet &#233;chantillon.`;
      }
      el.innerHTML = `<p class="empty-hint" style="padding:8px">${msg}</p>`;
      el.querySelector<HTMLElement>("#diff-pane-clear-filter")?.addEventListener("click", () => {
        this._setRuleFilter(null, document.querySelector<HTMLElement>("#act-preview-panel"));
      });
      return;
    }
    const table = document.createElement("table");
    table.className = "diff-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:28px">#</th>
          <th style="width:72px">R&#232;gle</th>
          <th>Texte cur&#233; (modifications en surbrillance)</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");
    examples.forEach((ex, i) => {
      const tr = document.createElement("tr");
      tr.dataset.diffIdx = String(i);
      tr.className = "diff-row";
      // Informative tooltip: single-rule vs. multi-rule, plus click affordance
      const ruleCount = [...new Set(
        (ex.matched_rule_ids ?? []).map(idx => this._curateRuleLabels[idx] ?? `r${idx + 1}`)
      )].length;
      tr.title = ruleCount > 1
        ? `Modification par ${ruleCount} règles — cliquer pour sélectionner`
        : "Cliquer pour sélectionner cette modification";
      // Compact rule badge(s) — show distinct labels (reuses ruleCount computed above)
      const ruleLabels = [...new Set(
        (ex.matched_rule_ids ?? []).map(idx => this._curateRuleLabels[idx] ?? `r${idx + 1}`)
      )];
      const ruleBadgeHtml = ruleLabels.length
        ? ruleLabels.map(l => `<span class="diff-rule-badge">${_escHtml(l)}</span>`).join(" ")
        : `<span class="diff-rule-badge diff-rule-badge-unknown">—</span>`;
      // Apply status class so CSS can show accepted/ignored state
      const st = ex.status ?? "pending";
      if (st !== "pending") tr.classList.add(`diff-${st}`);
      // Status badge (only for non-pending, to avoid clutter)
      const statusBadgeHtml = st !== "pending"
        ? `<span class="diff-status-badge diff-status-${st}" title="${_escHtml(ActionsScreen._STATUS_LABEL[st] ?? st)}">${st === "accepted" ? "✓" : "✗"}</span>`
        : "";
      // Override badge (Level 7A)
      const overrideBadgeHtml = ex.is_manual_override
        ? `<span class="diff-override-badge" title="Modifié manuellement">✏</span>`
        : "";
      // Exception badge (Level 7B)
      const exceptionBadgeHtml = (ex.is_exception_ignored || ex.is_exception_override)
        ? `<span class="diff-exception-badge" title="${ex.is_exception_ignored ? "Exception persistée : ignoré durablement" : "Exception persistée : override durable"}">🔒</span>`
        : "";
      // Forced-unit badge (Level 8C)
      const forcedReason = ex.preview_reason;
      const forcedBadgeHtml = forcedReason && forcedReason !== "standard"
        ? `<span class="diff-forced-badge diff-forced-${forcedReason}" title="${
            forcedReason === "forced" ? "Ouverture ciblée depuis Exceptions" :
            forcedReason === "forced_ignored" ? "Ouverture ciblée — neutralisée par exception ignore" :
            "Ouverture ciblée — aucune modification active"
          }">↗</span>`
        : "";
      if (forcedReason && forcedReason !== "standard") {
        tr.classList.add("diff-forced-row");
        if (forcedReason === "forced_ignored") tr.classList.add("diff-forced-ignored");
        if (forcedReason === "forced_no_change") tr.classList.add("diff-forced-no-change");
      }
      // Effective "after": user override wins over auto (Level 7A)
      const effectiveAfter = ex.manual_after ?? ex.after;
      tr.innerHTML =
        `<td class="diff-extid">${ex.external_id ?? i + 1}${statusBadgeHtml}${overrideBadgeHtml}${exceptionBadgeHtml}${forcedBadgeHtml}</td>` +
        `<td class="diff-rule-cell">${ruleBadgeHtml}</td>` +
        `<td class="diff-after${ex.is_manual_override ? " diff-after-overridden" : ""}">${_highlightChanges(ex.before, effectiveAfter)}</td>`;
      tr.addEventListener("click", () => {
        const panel = tr.closest<HTMLElement>("#act-preview-panel") ?? undefined;
        this._setActiveDiffItem(i, panel);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    el.innerHTML = "";
    el.appendChild(table);
  }

  /**
   * Build the list of unit_ids that should be excluded from the apply.
   * Strategy B: apply all EXCEPT units explicitly ignored in the current review session.
   * Returns an empty array if no review session is active (no status set).
   */
  private _collectIgnoredUnitIds(): number[] {
    return this._curateExamples
      .filter(ex => ex.status === "ignored")
      .map(ex => ex.unit_id);
  }

  /**
   * Collect manual overrides for the apply payload.
   * Returns [{unit_id, text}] for every example that has is_manual_override === true.
   */
  private _collectManualOverrides(): Array<{ unit_id: number; text: string }> {
    return this._curateExamples
      .filter(ex => ex.is_manual_override === true && ex.manual_after != null && ex.unit_id !== undefined)
      .map(ex => ({ unit_id: ex.unit_id, text: ex.manual_after! }));
  }

  /** Enter inline edit mode for the currently active example. */
  private _enterEditMode(): void {
    this._editingManualOverride = true;
    const filtered = this._filteredExamples();
    const ex = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
    this._renderContextDetail(ex);
    // Auto-focus the textarea after a short tick (DOM needs to be in place)
    setTimeout(() => {
      const ta = document.querySelector<HTMLTextAreaElement>("#act-manual-override-input");
      if (ta) { ta.focus(); ta.select(); }
    }, 30);
  }

  /**
   * Save the manual override value and exit edit mode.
   * If the value is identical to the auto "after", treats it as a no-op (revert).
   */
  private _saveManualOverride(value: string): void {
    const filtered = this._filteredExamples();
    const ex = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
    if (!ex) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === ex.after) {
      // User left the auto value unchanged → revert any previous override silently
      if (ex.is_manual_override) {
        ex.manual_after = null;
        ex.is_manual_override = false;
        this._log(`↩ Override annulé pour unité ${ex.unit_id} (valeur identique à la proposition automatique).`);
        this._pushCurateLog("preview", `Override identique à l'auto — annulé (unité ${ex.unit_id})`);
      }
    } else {
      ex.manual_after = trimmed;
      ex.is_manual_override = true;
      // Option A: saving an override implicitly accepts the item
      if (!ex.status || ex.status === "pending") {
        ex.status = "accepted";
      }
      this._log(`✏ Override manuel enregistré pour unité ${ex.unit_id}.`);
      this._pushCurateLog("preview", `Override manuel – unité ${ex.unit_id}`);
    }
    this._editingManualOverride = false;
    this._saveCurateReviewState();
    // Re-render the context card
    this._renderContextDetail(ex);
    this._updateSessionSummary();
    this._updateActionButtons();
    // Patch the diff row in-place (avoid full re-render)
    const panel = document.querySelector<HTMLElement>("#act-preview-panel");
    const row = (panel ?? document).querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
    if (row) {
      const afterCell = row.querySelector<HTMLElement>(".diff-after");
      if (afterCell) afterCell.innerHTML = _highlightChanges(ex.before, ex.manual_after ?? ex.after);
      this._renderOverrideBadge(row, ex.is_manual_override ?? false);
      // Refresh status badge too (status may have changed to accepted)
      this._renderStatusBadge(row, ex.status ?? "pending");
      const st = ex.status ?? "pending";
      row.className = "diff-row" + (st !== "pending" ? ` diff-${st}` : "");
      if (this._activeDiffIdx !== null) row.classList.add("diff-active");
    }
  }

  /** Cancel edit mode without saving. */
  private _cancelEditMode(): void {
    this._editingManualOverride = false;
    const filtered = this._filteredExamples();
    const ex = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
    this._renderContextDetail(ex);
  }

  /** Remove the manual override for the active item and revert to auto "after". */
  private _revertManualOverride(): void {
    const filtered = this._filteredExamples();
    const ex = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
    if (!ex) return;
    ex.manual_after = null;
    ex.is_manual_override = false;
    this._editingManualOverride = false;
    this._log(`↩ Override annulé pour unité ${ex.unit_id} — proposition automatique rétablie.`);
    this._pushCurateLog("preview", `Override annulé – unité ${ex.unit_id}`);
    this._saveCurateReviewState();
    this._renderContextDetail(ex);
    this._updateSessionSummary();
    // Patch the diff row in-place
    const panel = document.querySelector<HTMLElement>("#act-preview-panel");
    const row = (panel ?? document).querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
    if (row) {
      const afterCell = row.querySelector<HTMLElement>(".diff-after");
      if (afterCell) afterCell.innerHTML = _highlightChanges(ex.before, ex.after);
      this._renderOverrideBadge(row, false);
    }
  }

  /**
   * Show or hide the ✏ override badge in a diff table row's first cell.
   * Idempotent: creates badge if missing, removes if not needed.
   */
  private _renderOverrideBadge(row: HTMLElement, isOverride: boolean): void {
    const existing = row.querySelector<HTMLElement>(".diff-override-badge");
    if (!isOverride) { existing?.remove(); return; }
    if (existing) return;
    const badge = document.createElement("span");
    badge.className = "diff-override-badge";
    badge.textContent = "✏";
    badge.title = "Modifié manuellement";
    const firstCell = row.querySelector("td");
    if (firstCell) firstCell.appendChild(badge);
  }

  // ─── Level 7B: Persistent exception helpers ──────────────────────────────

  /**
   * Load persistent curation exceptions for the current doc from the sidecar.
   * Called after each successful preview.  Populates _curateExceptions and
   * annotates matching _curateExamples with is_exception_ignored / exception_override.
   */
  private async _loadCurateExceptions(): Promise<void> {
    if (!this._conn) return;
    const docId = this._currentCurateDocId();
    if (docId === undefined) return;
    try {
      const res = await listCurateExceptions(this._conn, docId);
      this._curateExceptions = new Map(res.exceptions.map(e => [e.unit_id, e]));
      // Annotate examples with exception flags
      for (const ex of this._curateExamples) {
        const exc = this._curateExceptions.get(ex.unit_id);
        if (exc) {
          if (exc.kind === "ignore") {
            ex.is_exception_ignored = true;
            ex.exception_override = undefined;
          } else {
            ex.is_exception_override = true;
            ex.exception_override = exc.override_text ?? undefined;
          }
        }
      }
      // Also annotate examples whose is_exception_override was set by the server
      // (they came from the preview already with is_exception_override = true)
      for (const ex of this._curateExamples) {
        if (ex.is_exception_override && !this._curateExceptions.has(ex.unit_id)) {
          // Server marked it but our local map doesn't have it yet — re-fetch was
          // already done above, so this is a no-op guard.
        }
      }
      if (this._curateExceptions.size > 0) {
        this._log(`ℹ ${this._curateExceptions.size} exception(s) locale(s) persistée(s) active(s) pour ce document.`);
        this._pushCurateLog("preview", `${this._curateExceptions.size} exception(s) persistée(s) chargée(s)`);
      }
    } catch (err) {
      this._log(`⚠ Impossible de charger les exceptions persistées : ${String(err)}`, true);
    }
  }

  /**
   * Create or update a persistent 'ignore' exception for the active example.
   * The unit will be silenced in all future previews and applies.
   */
  private async _setExceptionIgnore(ex: CuratePreviewExample): Promise<void> {
    if (!this._conn) return;
    try {
      await setCurateException(this._conn, { unit_id: ex.unit_id, kind: "ignore" });
      ex.is_exception_ignored = true;
      ex.is_exception_override = false;
      ex.exception_override = undefined;
      // Also set status = ignored for this session
      if (!ex.status || ex.status === "pending") ex.status = "ignored";
      this._curateExceptions.set(ex.unit_id, {
        id: -1, unit_id: ex.unit_id, kind: "ignore",
        override_text: null, note: null, created_at: new Date().toISOString(),
      });
      this._log(`🔒 Exception persistée créée : ignorer l'unité ${ex.unit_id} durablement.`);
      this._pushCurateLog("apply", `Exception persistée ignore – unité ${ex.unit_id}`);
      this._saveCurateReviewState();
      this._renderContextDetail(ex);
      this._updateSessionSummary();
      this._updateActionButtons();
      const panel = document.querySelector<HTMLElement>("#act-preview-panel");
      const row = (panel ?? document).querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
      if (row) this._renderExceptionBadge(row, ex);
    } catch (err) {
      this._log(`✗ Erreur lors de la création de l'exception ignore : ${String(err)}`, true);
    }
  }

  /**
   * Create or update a persistent 'override' exception using the current session's
   * manual_after value (or the auto 'after' if no session override is present).
   */
  private async _setExceptionOverride(ex: CuratePreviewExample): Promise<void> {
    if (!this._conn) return;
    const text = ex.manual_after ?? ex.after;
    if (!text) return;
    try {
      await setCurateException(this._conn, {
        unit_id: ex.unit_id,
        kind: "override",
        override_text: text,
      });
      ex.is_exception_override = true;
      ex.exception_override = text;
      ex.is_exception_ignored = false;
      if (!ex.status || ex.status === "pending") ex.status = "accepted";
      this._curateExceptions.set(ex.unit_id, {
        id: -1, unit_id: ex.unit_id, kind: "override",
        override_text: text, note: null, created_at: new Date().toISOString(),
      });
      this._log(`🔒 Exception persistée créée : override durablement "${text}" pour l'unité ${ex.unit_id}.`);
      this._pushCurateLog("apply", `Exception persistée override – unité ${ex.unit_id}`);
      this._saveCurateReviewState();
      this._renderContextDetail(ex);
      this._updateSessionSummary();
      this._updateActionButtons();
      const panel = document.querySelector<HTMLElement>("#act-preview-panel");
      const row = (panel ?? document).querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
      if (row) this._renderExceptionBadge(row, ex);
    } catch (err) {
      this._log(`✗ Erreur lors de la création de l'exception override : ${String(err)}`, true);
    }
  }

  /**
   * Delete the persistent exception for the active example.
   * Future previews and applies will use the normal rule pipeline again.
   */
  private async _deleteException(ex: CuratePreviewExample): Promise<void> {
    if (!this._conn) return;
    try {
      await deleteCurateException(this._conn, ex.unit_id);
      ex.is_exception_ignored = false;
      ex.is_exception_override = false;
      ex.exception_override = undefined;
      this._curateExceptions.delete(ex.unit_id);
      this._log(`🔓 Exception persistée supprimée pour l'unité ${ex.unit_id}. Comportement automatique rétabli.`);
      this._pushCurateLog("apply", `Exception persistée supprimée – unité ${ex.unit_id}`);
      this._saveCurateReviewState();
      this._renderContextDetail(ex);
      this._updateSessionSummary();
      const panel = document.querySelector<HTMLElement>("#act-preview-panel");
      const row = (panel ?? document).querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
      if (row) this._renderExceptionBadge(row, ex);
    } catch (err) {
      this._log(`✗ Erreur lors de la suppression de l'exception : ${String(err)}`, true);
    }
  }

  /**
   * Render (or remove) the exception badge in a diff table row's first cell.
   * Exception badges are distinct from session-override badges.
   */
  private _renderExceptionBadge(row: HTMLElement, ex: CuratePreviewExample): void {
    const existing = row.querySelector<HTMLElement>(".diff-exception-badge");
    const hasException = ex.is_exception_ignored || ex.is_exception_override;
    if (!hasException) { existing?.remove(); return; }
    if (existing) {
      existing.textContent = ex.is_exception_ignored ? "🔒" : "🔒✏";
      existing.title = ex.is_exception_ignored
        ? "Exception persistée : ignoré durablement"
        : "Exception persistée : override durable";
      return;
    }
    const badge = document.createElement("span");
    badge.className = "diff-exception-badge";
    badge.textContent = ex.is_exception_ignored ? "🔒" : "🔒✏";
    badge.title = ex.is_exception_ignored
      ? "Exception persistée : ignoré durablement"
      : "Exception persistée : override durable";
    const firstCell = row.querySelector("td");
    if (firstCell) firstCell.appendChild(badge);
  }

  // ── Level 8A: Exceptions admin panel ──────────────────────────────────────

  /** Current filter applied to the admin panel: "all" | "ignore" | "override". */
  private _excAdminFilter: "all" | "ignore" | "override" = "all";
  /** Full list of exceptions loaded for the admin panel (all docs). */
  private _excAdminAll: import("../lib/sidecarClient.js").CurateException[] = [];
  /** unit_id currently being edited inline in the admin panel (or null). */
  private _excAdminEditing: number | null = null;
  /** doc_id filter applied in the admin panel (0 = all). */
  private _excAdminDocFilter: number = 0;

  /**
   * Load all persistent exceptions (cross-document) and render the admin panel.
   * Called after each successful preview and via the Refresh button.
   */
  private async _loadExceptionsAdminPanel(root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    const list = root.querySelector<HTMLElement>("#act-exc-admin-list");
    if (!list) return;
    list.innerHTML = `<p class="empty-hint exc-admin-loading">Chargement…</p>`;
    try {
      const res = await listCurateExceptions(this._conn);
      this._excAdminAll = res.exceptions;
      this._excAdminEditing = null;
      this._pushCurateLog("preview", `${res.count} exception(s) persistée(s) chargée(s) dans le panneau admin`);
      this._renderExcAdminPanel(root);
    } catch (err) {
      list.innerHTML = `<p class="empty-hint" style="color:#b91c1c">Erreur lors du chargement : ${String(err)}</p>`;
    }
  }

  /** Set active filter and re-render the admin panel table. */
  private _setExcAdminFilter(f: "all" | "ignore" | "override", root: HTMLElement): void {
    this._excAdminFilter = f;
    root.querySelectorAll<HTMLButtonElement>(".exc-filter-btn").forEach(btn => {
      btn.classList.toggle("exc-filter-active", btn.dataset.excFilter === f);
    });
    this._renderExcAdminPanel(root);
  }

  /** Render the list of exceptions inside #act-exc-admin-list. */
  private _renderExcAdminPanel(root: HTMLElement): void {
    const list = root.querySelector<HTMLElement>("#act-exc-admin-list");
    const badge = root.querySelector<HTMLElement>("#act-exc-admin-badge");
    if (!list) return;

    const all = this._excAdminAll;

    // Update count badge on summary
    if (badge) {
      badge.textContent = String(all.length);
      badge.style.display = all.length > 0 ? "inline-flex" : "none";
    }

    // Refresh the doc-filter select with currently known docs
    const docSel = root.querySelector<HTMLSelectElement>("#act-exc-doc-filter");
    if (docSel) {
      const knownDocs = new Map<number, string>();
      for (const exc of all) {
        if (exc.doc_id !== undefined) {
          knownDocs.set(exc.doc_id, exc.doc_title || `Document #${exc.doc_id}`);
        }
      }
      // Rebuild options only if the set changed (avoid resetting mid-user-interaction)
      const existingDocIds = new Set(
        Array.from(docSel.options).slice(1).map(o => parseInt(o.value))
      );
      const newDocIds = new Set(knownDocs.keys());
      const needsRebuild = existingDocIds.size !== newDocIds.size ||
        [...newDocIds].some(id => !existingDocIds.has(id));
      if (needsRebuild) {
        const currentVal = docSel.value;
        docSel.innerHTML = `<option value="">Tous les documents</option>`;
        for (const [docId, docTitle] of [...knownDocs.entries()].sort((a, b) => a[0] - b[0])) {
          const opt = document.createElement("option");
          opt.value = String(docId);
          opt.textContent = docTitle;
          docSel.appendChild(opt);
        }
        if (currentVal) docSel.value = currentVal;
      }
    }

    // Apply kind + doc filters
    let filtered = this._excAdminFilter === "all"
      ? all
      : all.filter(e => e.kind === this._excAdminFilter);
    if (this._excAdminDocFilter > 0) {
      filtered = filtered.filter(e => e.doc_id === this._excAdminDocFilter);
    }

    if (all.length === 0) {
      list.innerHTML = `<p class="empty-hint">Aucune exception persistée.</p>`;
      return;
    }
    if (filtered.length === 0) {
      list.innerHTML = `<p class="empty-hint">Aucun résultat pour ce filtre.</p>`;
      return;
    }

    // Group by doc for readability when showing all-docs
    const byDoc = new Map<string, typeof filtered>();
    for (const exc of filtered) {
      const key = exc.doc_id !== undefined ? String(exc.doc_id) : "?";
      if (!byDoc.has(key)) byDoc.set(key, []);
      byDoc.get(key)!.push(exc);
    }

    const frag = document.createDocumentFragment();
    for (const [, rows] of byDoc) {
      // Only show doc header when displaying multiple docs
      const firstRow = rows[0];
      const showDocHead = this._excAdminDocFilter === 0 && firstRow.doc_title !== undefined;
      if (showDocHead) {
        const docHead = document.createElement("div");
        docHead.className = "exc-admin-doc-head";
        docHead.textContent = firstRow.doc_title || `Document #${firstRow.doc_id ?? "?"}`;
        frag.appendChild(docHead);
      }

      for (const exc of rows) {
        frag.appendChild(this._buildExcAdminRow(exc));
      }
    }
    list.innerHTML = "";
    list.appendChild(frag);
  }

  /** Build a single exception row element. */
  private _buildExcAdminRow(exc: import("../lib/sidecarClient.js").CurateException): HTMLElement {
    const row = document.createElement("div");
    row.className = "exc-admin-row";
    row.dataset.excUnitId = String(exc.unit_id);

    const kindBadge = `<span class="exc-kind-badge exc-kind-${exc.kind}">${exc.kind === "ignore" ? "🚫 ignore" : "✏ override"}</span>`;
    const unitText = exc.unit_text ? `<span class="exc-unit-preview" title="${this._escHtml(exc.unit_text)}">${this._escHtml(exc.unit_text.slice(0, 80))}…</span>` : "";
    const createdAt = exc.created_at ? `<span class="exc-created-at">${exc.created_at.slice(0, 16).replace("T", " ")}</span>` : "";
    // "Voir dans Curation" button — only shown when doc_id is known
    const openBtn = exc.doc_id !== undefined
      ? `<button class="btn btn-sm exc-row-open-curation" title="Voir cette unité dans Curation">&#x1F441;</button>`
      : "";

    const isEditing = this._excAdminEditing === exc.unit_id;

    if (exc.kind === "override" && isEditing) {
      row.innerHTML = `
        <div class="exc-row-meta">
          ${kindBadge}
          <span class="exc-unit-id">unité&nbsp;${exc.unit_id}</span>
          ${createdAt}
        </div>
        ${unitText ? `<div class="exc-unit-preview-block">${unitText}</div>` : ""}
        <div class="exc-row-edit-block">
          <label class="exc-edit-label">Texte override :</label>
          <textarea class="exc-edit-textarea" id="exc-edit-${exc.unit_id}" rows="3">${this._escHtml(exc.override_text ?? "")}</textarea>
          <div class="exc-edit-actions">
            <button class="btn btn-sm btn-primary exc-row-edit-save">Enregistrer</button>
            <button class="btn btn-sm exc-row-edit-cancel">Annuler</button>
          </div>
        </div>`;
    } else {
      const overrideText = exc.kind === "override" && exc.override_text
        ? `<div class="exc-override-text">${this._escHtml(exc.override_text)}</div>`
        : "";
      const editBtn = exc.kind === "override"
        ? `<button class="btn btn-sm exc-row-edit-start" title="Modifier le texte override">✎</button>`
        : "";
      row.innerHTML = `
        <div class="exc-row-meta">
          ${kindBadge}
          <span class="exc-unit-id">unité&nbsp;${exc.unit_id}</span>
          ${createdAt}
          <div class="exc-row-actions">
            ${openBtn}
            ${editBtn}
            <button class="btn btn-sm exc-row-delete" title="Supprimer cette exception">✕</button>
          </div>
        </div>
        ${unitText ? `<div class="exc-unit-preview-block">${unitText}</div>` : ""}
        ${overrideText}`;
    }
    return row;
  }

  /** Helper: escape HTML for safe injection in innerHTML. */
  private _escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ─── Level 9B — Review session report export ──────────────────────────────

  /**
   * Build the structured review report payload from the current session state.
   * All data comes from in-memory frontend fields — no sidecar call needed.
   */
  private _buildReviewReportPayload(): object {
    const docId = this._currentCurateDocId() ?? null;
    const docTitle = docId !== null
      ? (this._docs.find(d => d.doc_id === docId)?.title ?? null)
      : null;

    const items = this._curateExamples;
    const pending  = items.filter(e => (e.status ?? "pending") === "pending").length;
    const accepted = items.filter(e => e.status === "accepted").length;
    const ignored  = items.filter(e => e.status === "ignored").length;
    const manuals  = items.filter(e => e.is_manual_override).length;

    const isTruncated = this._curateGlobalChanged > items.length;
    const notes: string[] = [];
    if (isTruncated) {
      notes.push(
        `Preview tronquée : ${items.length} item(s) affichés sur ` +
        `${this._curateGlobalChanged} modifications réelles dans le document.`
      );
    }
    notes.push("Ce rapport reflète uniquement la session courante (en mémoire). " +
               "Les décisions ne survivent pas à un rechargement sans restauration localStorage.");

    return {
      exported_at: new Date().toISOString(),
      report_type: "curation_review_session",
      doc_id: docId,
      doc_title: docTitle,
      sample: {
        displayed: items.length,
        units_changed: this._curateGlobalChanged,
        units_total: this._curateUnitsTotal,
        truncated: isTruncated,
      },
      summary: { pending, accepted, ignored, manual_overrides: manuals },
      rules: [...this._curateRuleLabels],
      items: items.map(ex => {
        const persistentExc = ex.unit_id !== undefined
          ? (this._curateExceptions.get(ex.unit_id) ?? null)
          : null;
        return {
          unit_id: ex.unit_id ?? null,
          unit_index: ex.unit_index ?? null,
          status: ex.status ?? "pending",
          before: ex.before,
          after: ex.after,
          effective_after: ex.is_manual_override ? (ex.manual_after ?? ex.after) : ex.after,
          is_manual_override: ex.is_manual_override ?? false,
          matched_rules: (ex.matched_rule_ids ?? []).map(
            idx => this._curateRuleLabels[idx] ?? `règle ${idx + 1}`
          ),
          preview_reason: ex.preview_reason ?? "standard",
          context_before: ex.context_before ?? null,
          context_after: ex.context_after ?? null,
          persistent_exception: persistentExc
            ? { kind: persistentExc.kind, text: persistentExc.override_text ?? null }
            : null,
        };
      }),
      last_apply_result: this._lastApplyResult,
      notes,
    };
  }

  /** Build a CSV (one row per review item) from the current session. */
  private _buildReviewReportCsv(): string {
    const cols = [
      "unit_id", "unit_index", "status", "is_manual_override",
      "before", "after", "effective_after",
      "matched_rules", "preview_reason",
      "context_before", "context_after",
      "persistent_exception_kind",
    ];
    const escape = (v: unknown): string => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const rows: string[] = [cols.join(",")];
    for (const ex of this._curateExamples) {
      const persistentExc = ex.unit_id !== undefined
        ? (this._curateExceptions.get(ex.unit_id) ?? null)
        : null;
      rows.push([
        ex.unit_id ?? "",
        ex.unit_index ?? "",
        ex.status ?? "pending",
        ex.is_manual_override ? "true" : "false",
        escape(ex.before),
        escape(ex.after),
        escape(ex.is_manual_override ? (ex.manual_after ?? ex.after) : ex.after),
        escape((ex.matched_rule_ids ?? []).map(idx => this._curateRuleLabels[idx] ?? `r${idx + 1}`).join("; ")),
        ex.preview_reason ?? "standard",
        escape(ex.context_before ?? ""),
        escape(ex.context_after ?? ""),
        persistentExc?.kind ?? "",
      ].join(","));
    }
    return rows.join("\n");
  }

  /** Export the current review session as JSON or CSV via a save dialog (no sidecar). */
  private async _runExportReviewReport(fmt: "json" | "csv"): Promise<void> {
    if (this._curateExamples.length === 0) {
      this._showToast?.("ℹ Aucune preview active à exporter");
      const resultEl = document.querySelector<HTMLElement>("#act-review-export-result");
      if (resultEl) {
        resultEl.style.display = "";
        resultEl.className = "review-export-result review-export-empty";
        resultEl.textContent = "ℹ Aucune preview active à exporter";
      }
      return;
    }

    const docId = this._currentCurateDocId();
    const today = new Date().toISOString().slice(0, 10);
    const scopeTag = docId !== undefined ? `doc_${docId}` : "all";
    const defaultName = `curation_review_${scopeTag}_${today}.${fmt}`;

    let outPath: string | null;
    try {
      outPath = await dialogSave({
        title: "Exporter le rapport de review",
        defaultPath: defaultName,
        filters: fmt === "json"
          ? [{ name: "JSON", extensions: ["json"] }]
          : [{ name: "CSV", extensions: ["csv"] }],
      });
    } catch { return; }
    if (!outPath) return;

    const resultEl = document.querySelector<HTMLElement>("#act-review-export-result");
    const btnJson = document.querySelector<HTMLButtonElement>("#act-review-export-json");
    const btnCsv  = document.querySelector<HTMLButtonElement>("#act-review-export-csv");
    if (btnJson) btnJson.disabled = true;
    if (btnCsv)  btnCsv.disabled = true;
    if (resultEl) { resultEl.style.display = "none"; resultEl.textContent = ""; }

    try {
      let content: string;
      if (fmt === "json") {
        content = JSON.stringify(this._buildReviewReportPayload(), null, 2);
      } else {
        content = this._buildReviewReportCsv();
      }
      await writeTextFile(outPath, content);

      const count = this._curateExamples.length;
      const msg = `✓ Rapport exporté (${count} item(s))`;
      if (resultEl) {
        resultEl.style.display = "";
        resultEl.className = "review-export-result review-export-ok";
        resultEl.textContent = msg;
      }
      this._log(`✓ Rapport de review (${fmt.toUpperCase()}) exporté : ${count} item(s) → ${outPath}`);
      this._pushCurateLog("apply", `Rapport export\u00e9 – ${count} item(s)`);
      this._showToast?.(msg);
    } catch (err) {
      const msg = `✗ Erreur export rapport : ${err instanceof Error ? err.message : String(err)}`;
      if (resultEl) {
        resultEl.style.display = "";
        resultEl.className = "review-export-result review-export-error";
        resultEl.textContent = msg;
      }
      this._log(msg, true);
      this._showToast?.("✗ Erreur export rapport", true);
    } finally {
      if (btnJson) btnJson.disabled = false;
      if (btnCsv)  btnCsv.disabled = false;
    }
  }

  /**
   * Level 9C: Update the apply result note inside the review export card.
   * Called after a successful apply and after invalidation.
   */
  private _updateApplyResultUI(): void {
    const note = document.querySelector<HTMLElement>("#act-apply-result-note");
    if (!note) return;
    if (!this._lastApplyResult) {
      note.style.display = "none";
      note.textContent = "";
      return;
    }
    const r = this._lastApplyResult;
    const when = new Date(r.applied_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const skipped = r.units_skipped > 0 ? `, ${r.units_skipped} sautée(s)` : "";
    note.style.display = "";
    note.className = "apply-result-note apply-result-ok";
    const sessionCount = this._applyHistory.length;
    const sessionSuffix = sessionCount > 1 ? ` · ${sessionCount} apply dans cette session` : "";
    note.textContent =
      `✓ Dernier apply — ${r.units_modified} modifiée(s)${skipped} (${when})` +
      (r.ignored_count != null && r.ignored_count > 0 ? ` · ${r.ignored_count} ignorée(s)` : "") +
      (r.manual_override_count != null && r.manual_override_count > 0 ? ` · ${r.manual_override_count} correction(s)` : "") +
      ` — inclus dans le rapport${sessionSuffix}`;
  }

  // ─── Level 10A/10B — Apply history panel ─────────────────────────────────────

  /** Load (or refresh) apply history from DB and render the panel. */
  private async _loadApplyHistoryPanel(el: HTMLElement): Promise<void> {
    if (!this._conn) return;
    const listEl = el.querySelector<HTMLElement>("#act-apply-hist-list");
    if (!listEl) return;

    const scopeEl = el.querySelector<HTMLSelectElement>("#act-apply-hist-scope");
    const scopeFilter = scopeEl?.value ?? "";

    listEl.innerHTML = `<p class="empty-hint" style="opacity:.6">Chargement\u2026</p>`;

    try {
      const res = await listApplyHistory(this._conn, { limit: 50 });
      let events = (res.events ?? []) as CurateApplyEvent[];

      if (scopeFilter === "doc") events = events.filter(e => e.scope === "doc");
      else if (scopeFilter === "all") events = events.filter(e => e.scope === "all");

      // Merge in-memory session events not yet persisted (guard by applied_at equality)
      const dbTimes = new Set(events.map(e => e.applied_at));
      const sessionOnly = this._applyHistory.filter(e => !dbTimes.has(e.applied_at));
      const merged = [...sessionOnly, ...events].slice(0, 50);

      this._renderApplyHistoryPanel(listEl, merged);

      const badge = el.querySelector<HTMLElement>("#act-apply-hist-badge");
      if (badge) {
        badge.textContent = String(merged.length);
        badge.style.display = merged.length ? "" : "none";
      }
    } catch (err) {
      listEl.innerHTML = `<p class="empty-hint error-hint">Erreur lors du chargement.</p>`;
      this._log(`\u26a0 Historique apply : ${err}`, true);
    }
  }

  private _renderApplyHistoryPanel(container: HTMLElement, events: CurateApplyEvent[]): void {
    if (!events.length) {
      container.innerHTML = `<p class="empty-hint">Aucun apply enregistr\u00e9.</p>`;
      return;
    }
    const rows = events.map(e => {
      const ts = e.applied_at
        ? new Date(e.applied_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
        : "\u2014";
      const scope  = e.scope === "doc" ? "Document" : "Corpus";
      const docLbl = e.doc_title ? e.doc_title : (e.doc_id != null ? `#${e.doc_id}` : "\u2014");
      const modified = e.units_modified ?? 0;
      const skipped  = e.units_skipped  ?? 0;
      const extras   = [
        e.ignored_count != null && e.ignored_count > 0 ? `${e.ignored_count}\u00a0ign.` : "",
        e.manual_override_count != null && e.manual_override_count > 0 ? `${e.manual_override_count}\u00a0man.` : "",
      ].filter(Boolean).join(" / ");
      const sessionMark = e.id == null ? " apply-hist-row--session" : "";
      return `
        <div class="apply-hist-row${sessionMark}">
          <span class="apply-hist-ts">${ts}</span>
          <span class="apply-hist-scope-badge apply-hist-scope--${e.scope}">${scope}</span>
          <span class="apply-hist-doc" title="${e.doc_title ?? ""}">${docLbl}</span>
          <span class="apply-hist-counts">${modified}\u00a0mod. / ${skipped}\u00a0saut.</span>
          ${extras ? `<span class="apply-hist-extras">${extras}</span>` : ""}
        </div>`;
    });
    container.innerHTML = rows.join("");
  }

  private async _runApplyHistoryExport(format: "json" | "csv"): Promise<void> {
    if (!this._conn) return;
    const resultEl = document.querySelector<HTMLElement>("#act-apply-hist-export-result");
    const scopeEl  = document.querySelector<HTMLSelectElement>("#act-apply-hist-scope");
    const scopeFilter = scopeEl?.value ?? "";

    if (resultEl) { resultEl.textContent = ""; resultEl.style.display = "none"; }

    const today = new Date().toISOString().slice(0, 10);
    const defaultName = `curation_apply_history_${scopeFilter || "all"}_${today}.${format}`;
    const { save: dialogSave } = await import("@tauri-apps/plugin-dialog");
    const outPath = await dialogSave({
      title: "Exporter l\u2019historique des apply",
      defaultPath: defaultName,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!outPath) return;

    try {
      const opts: ExportApplyHistoryOptions = { out_path: outPath, format };
      const res = await exportApplyHistory(this._conn, opts);
      if (resultEl) {
        resultEl.textContent = res.count
          ? `Export\u00e9\u00a0: ${res.count}\u00a0\u00e9v\u00e9nement(s) \u2192 ${outPath}`
          : "Aucun \u00e9v\u00e9nement \u00e0 exporter.";
        resultEl.className = res.count ? "apply-hist-export-result ok" : "apply-hist-export-result empty";
        resultEl.style.display = "";
      }
    } catch (err) {
      if (resultEl) {
        resultEl.textContent = `Erreur export\u00a0: ${err}`;
        resultEl.className = "apply-hist-export-result error";
        resultEl.style.display = "";
      }
      this._log(`\u26a0 Export historique apply\u00a0: ${err}`, true);
    }
  }

  /**
   * Level 9A: Export curation exceptions to JSON or CSV.
   *
   * Scope is driven by the current _excAdminDocFilter:
   * - 0  → export all exceptions across the corpus
   * - >0 → export only the current document's exceptions
   *
   * The sidecar writes the file to the path chosen via the save dialog.
   */
  private async _runExcAdminExport(fmt: "json" | "csv", root: HTMLElement): Promise<void> {
    if (!this._conn) return;

    const docId = this._excAdminDocFilter > 0 ? this._excAdminDocFilter : undefined;
    const today = new Date().toISOString().slice(0, 10);
    const scopeTag = docId ? `doc_${docId}` : "all";
    const defaultName = `curation_exceptions_${scopeTag}_${today}.${fmt}`;

    let outPath: string | null;
    try {
      outPath = await dialogSave({
        title: "Exporter les exceptions de curation",
        defaultPath: defaultName,
        filters: fmt === "json"
          ? [{ name: "JSON", extensions: ["json"] }]
          : [{ name: "CSV", extensions: ["csv"] }],
      });
    } catch {
      return;
    }
    if (!outPath) return;

    const resultEl = root.querySelector<HTMLElement>("#act-exc-export-result");
    const btnJson = root.querySelector<HTMLButtonElement>("#act-exc-export-json");
    const btnCsv  = root.querySelector<HTMLButtonElement>("#act-exc-export-csv");
    if (btnJson) btnJson.disabled = true;
    if (btnCsv)  btnCsv.disabled = true;
    if (resultEl) { resultEl.style.display = "none"; resultEl.textContent = ""; }

    try {
      const opts: ExportCurateExceptionsOptions = { out_path: outPath, format: fmt };
      if (docId !== undefined) opts.doc_id = docId;

      const res = await exportCurateExceptions(this._conn, opts);

      const msg = res.count > 0
        ? `✓ ${res.count} exception(s) exportée(s)`
        : "ℹ Aucune exception à exporter";
      if (resultEl) {
        resultEl.style.display = "";
        resultEl.className = `exc-export-result ${res.count > 0 ? "exc-export-ok" : "exc-export-empty"}`;
        resultEl.textContent = msg;
      }
      this._log(`✓ Exceptions exportées (${fmt.toUpperCase()}) : ${res.count} → ${res.out_path}`);
      this._showToast?.(msg);
    } catch (err) {
      const msg = `✗ Erreur export : ${err instanceof SidecarError ? err.message : String(err)}`;
      if (resultEl) {
        resultEl.style.display = "";
        resultEl.className = "exc-export-result exc-export-error";
        resultEl.textContent = msg;
      }
      this._log(msg, true);
      this._showToast?.("✗ Erreur export exceptions", true);
    } finally {
      if (btnJson) btnJson.disabled = false;
      if (btnCsv)  btnCsv.disabled = false;
    }
  }

  /**
   * Level 8B: Navigate from the exceptions admin panel to the Curation review
   * for the document/unit concerned.
   *
   * Strategy (Option A — soft navigation):
   * 1. Switch to Curation sub-view.
   * 2. Select the target document in #act-curate-doc.
   * 3. Dispatch a 'change' event to trigger _updateCurateCtx + _schedulePreview.
   * 4. After the preview completes, search for the unit_id in _curateExamples.
   * 5. If found: call _setActiveDiffItem to focus it.
   * 6. If not found: show an honest fallback message.
   *
   * Limitation: units with a persistent 'ignore' exception are excluded from
   * the preview sample by the sidecar and will never appear in _curateExamples.
   * For override exceptions, the unit is included with the override text.
   */
  private async _excAdminOpenInCuration(
    exc: import("../lib/sidecarClient.js").CurateException,
    adminRoot: HTMLElement,
  ): Promise<void> {
    if (exc.doc_id === undefined) {
      this._log("⚠ Impossible d'ouvrir dans Curation : doc_id inconnu pour cette exception.", true);
      return;
    }

    // 1. Ensure we are in the Curation sub-view
    if (this._root) {
      this._switchSubViewDOM(this._root, "curation");
    }

    // 2. Select the target document
    const sel = document.querySelector<HTMLSelectElement>("#act-curate-doc");
    if (!sel) {
      this._log("⚠ Sélecteur de document introuvable.", true);
      return;
    }

    const alreadyOnDoc = sel.value === String(exc.doc_id);
    sel.value = String(exc.doc_id);
    sel.dispatchEvent(new Event("change"));

    const docTitle = exc.doc_title || `Document #${exc.doc_id}`;
    this._log(`→ Navigation vers ${docTitle} (unité ${exc.unit_id}) depuis le panneau Exceptions.`);
    this._pushCurateLog("preview", `Ouverture depuis admin – ${docTitle}, unité ${exc.unit_id}`);

    // 3. If we were already on that doc, force a fresh preview
    if (alreadyOnDoc) {
      this._schedulePreview(true);
    }

    // ── Phase A: standard polling (up to 2.5 s) ─────────────────────────────
    // Wait for the preview to include the unit naturally (standard sample).
    const targetUnitId = exc.unit_id;
    const maxAttempts = 10;
    const attemptIntervalMs = 250;
    let found = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise<void>(res => setTimeout(res, attemptIntervalMs));
      if (this._isBusy) continue;

      const filtered = this._filteredExamples();
      const idx = filtered.findIndex(ex => ex.unit_id === targetUnitId);
      if (idx >= 0) {
        this._setActiveDiffItem(idx);
        this._log(`✓ Unité ${targetUnitId} trouvée dans le sample standard — sélectionnée.`);
        this._pushCurateLog("preview", `Unité ${targetUnitId} sélectionnée via admin`);
        found = true;
        break;
      }
      // Also check full _curateExamples (in case active filter hides it)
      const rawIdx = this._curateExamples.findIndex(ex => ex.unit_id === targetUnitId);
      if (rawIdx >= 0) {
        this._setRuleFilter(null, null);
        this._activeStatusFilter = null;
        const filtered2 = this._filteredExamples();
        const idx2 = filtered2.findIndex(ex => ex.unit_id === targetUnitId);
        if (idx2 >= 0) {
          this._setActiveDiffItem(idx2);
          this._log(`✓ Unité ${targetUnitId} trouvée (filtres réinitialisés) — sélectionnée.`);
          this._pushCurateLog("preview", `Unité ${targetUnitId} sélectionnée via admin (filtres effacés)`);
          found = true;
          break;
        }
      }
      // If preview completed without the unit, stop early to move to Phase B
      if (!this._isBusy && attempt >= 3) break;
    }

    if (found) return;

    // ── Phase B: forced preview (Level 8C) ──────────────────────────────────
    // Unit was not in the standard sample. Trigger a new preview with force_unit_id
    // so the sidecar guarantees inclusion even if: beyond top-50, has 'ignore'
    // exception, or produces no diff at all.
    this._log(`ℹ Unité ${targetUnitId} hors du sample standard. Lancement d'une preview ciblée…`);
    this._pushCurateLog("preview", `Preview ciblée pour unité ${targetUnitId}…`);

    this._forcedPreviewUnitId = targetUnitId;
    // Trigger the preview immediately (bypass debounce for responsiveness)
    await this._runPreview(true);

    // Poll again for the forced unit
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise<void>(res => setTimeout(res, attemptIntervalMs));
      if (this._isBusy) continue;

      // Reset any filters that might hide it
      if (this._activeRuleFilter || this._activeStatusFilter) {
        this._setRuleFilter(null, null);
        this._activeStatusFilter = null;
      }

      const filtered = this._filteredExamples();
      const idx = filtered.findIndex(ex => ex.unit_id === targetUnitId);
      if (idx >= 0) {
        this._setActiveDiffItem(idx);
        const reason = filtered[idx].preview_reason ?? "forced";
        const label =
          reason === "forced_ignored"  ? "unité neutralisée par exception ignore (inspection seulement)" :
          reason === "forced_no_change" ? "unité sans modification active" :
          "ouverture ciblée";
        this._log(`✓ Unité ${targetUnitId} rendue visible en mode forcé (${label}).`);
        this._pushCurateLog("preview", `Unité ${targetUnitId} ouverte en mode ciblé – ${label}`);
        found = true;
        break;
      }
      if (!this._isBusy) break;
    }

    if (!found) {
      // Final honest fallback — unit could not be located even with forced preview
      this._log(`⚠ Unité ${targetUnitId} introuvable même en mode ciblé. Elle a peut-être été supprimée ou le document a changé.`);
      this._pushCurateLog("warn", `Unité ${targetUnitId} introuvable (doc ${exc.doc_id})`);
    }
  }

  /** Delete an exception from the admin panel. */
  private async _excAdminDelete(unitId: number, root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    try {
      await deleteCurateException(this._conn, unitId);
      this._excAdminAll = this._excAdminAll.filter(e => e.unit_id !== unitId);
      // Also sync in-session state
      this._curateExceptions.delete(unitId);
      const ex = this._curateExamples.find(e => e.unit_id === unitId);
      if (ex) {
        ex.is_exception_ignored = false;
        ex.is_exception_override = false;
        ex.exception_override = undefined;
      }
      this._log(`🔓 Exception persistée supprimée (panneau admin) – unité ${unitId}.`);
      this._pushCurateLog("apply", `Exception supprimée via admin – unité ${unitId}`);
      this._renderExcAdminPanel(root);
      this._updateSessionSummary();
    } catch (err) {
      this._log(`✗ Erreur lors de la suppression de l'exception ${unitId} : ${String(err)}`, true);
    }
  }

  /** Enter inline edit mode for an override row. */
  private _excAdminEnterEdit(unitId: number, root: HTMLElement): void {
    this._excAdminEditing = unitId;
    this._renderExcAdminPanel(root);
    // Focus the textarea
    const ta = root.querySelector<HTMLTextAreaElement>(`#exc-edit-${unitId}`);
    ta?.focus();
  }

  /** Cancel inline edit without saving. */
  private _excAdminCancelEdit(unitId: number, root: HTMLElement): void {
    if (this._excAdminEditing === unitId) this._excAdminEditing = null;
    this._renderExcAdminPanel(root);
  }

  /** Save the edited override text and persist it. */
  private async _excAdminSaveEdit(unitId: number, root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    const ta = root.querySelector<HTMLTextAreaElement>(`#exc-edit-${unitId}`);
    const newText = ta?.value.trim() ?? "";
    if (!newText) {
      this._log("⚠ Le texte override ne peut pas être vide.", true);
      return;
    }
    try {
      await setCurateException(this._conn, { unit_id: unitId, kind: "override", override_text: newText });
      // Update local list
      const idx = this._excAdminAll.findIndex(e => e.unit_id === unitId);
      if (idx >= 0) this._excAdminAll[idx] = { ...this._excAdminAll[idx], override_text: newText };
      // Sync in-session state
      const sessionExc = this._curateExceptions.get(unitId);
      if (sessionExc) this._curateExceptions.set(unitId, { ...sessionExc, override_text: newText });
      const ex = this._curateExamples.find(e => e.unit_id === unitId);
      if (ex) ex.exception_override = newText;
      this._excAdminEditing = null;
      this._log(`🔒 Override persisté mis à jour – unité ${unitId}.`);
      this._pushCurateLog("apply", `Override persisté mis à jour via admin – unité ${unitId}`);
      this._renderExcAdminPanel(root);
      this._updateSessionSummary();
    } catch (err) {
      this._log(`✗ Erreur lors de la mise à jour de l'override : ${String(err)}`, true);
    }
  }

  /**
   * Build an informative pre-apply confirmation message.
   * Called from _runCurate() before window.confirm().
   *
   * The message is honest about what WILL and WILL NOT be applied,
   * and explicitly warns when the preview is truncated (non-reviewed units exist).
   */
  private _buildApplyConfirmMessage(
    label: string,
    ignoredUnitIds: number[],
    manualOverrides: Array<{ unit_id: number; text: string }> = [],
  ): string {
    const hasReview = this._curateExamples.length > 0;
    const isTruncated = this._curateExamples.length < this._curateGlobalChanged;
    const counts = hasReview ? this._getStatusCounts() : null;

    let msg = `Appliquer la curation sur ${label} ?\nCette opération modifie text_norm en base.\n`;

    if (hasReview && counts) {
      msg += `\nRésumé de la session de review :\n`;
      msg += `  • Acceptées    : ${counts.accepted}\n`;
      msg += `  • En attente   : ${counts.pending}\n`;
      msg += `  • Ignorées     : ${counts.ignored}`;
      if (counts.ignored > 0) msg += ` → ne seront PAS appliquées`;
      msg += `\n`;

      if (isTruncated) {
        const unreviewed = this._curateGlobalChanged - this._curateExamples.length;
        msg += `\n⚠ Attention — preview partielle :\n`;
        msg += `  ${unreviewed} modification(s) hors échantillon n'ont pas été examinées.\n`;
        msg += `  Elles seront appliquées normalement (aucun statut local disponible).\n`;
        msg += `  Seules les ${ignoredUnitIds.length} unités ignorées dans l'échantillon seront exclues.`;
      } else {
        // Sample covers all changes: the apply is exhaustive
        if (counts.ignored > 0) {
          msg += `\nL'application exclura ${counts.ignored} unité(s) ignorée(s).`;
        } else {
          msg += `\nToutes les modifications seront appliquées (aucune ignorée).`;
        }
      }
    } else {
      msg += `\nAucune review locale — toutes les modifications seront appliquées.`;
    }

    // Level 6A: inform the user that saved review states will be invalidated.
    const docId = this._currentCurateDocId();
    if (docId === undefined) {
      // Apply-all: all per-doc review keys will be swept.
      msg += `\n\n📌 Toutes les sessions de review sauvegardées par document seront effacées après application.`;
    } else {
      msg += `\n\n📌 La session de review sauvegardée pour ce document sera effacée après application.`;
    }

    // Level 7A: note manual overrides
    if (manualOverrides.length > 0) {
      msg += `\n✏ ${manualOverrides.length} correction(s) manuelle(s) seront appliquées à la place de la proposition automatique.`;
    }

    return msg;
  }

  private async _runCurate(): Promise<void> {
    if (!this._conn) return;
    const rules = this._currentRules();
    if (rules.length === 0) { this._log("Aucune règle configurée.", true); return; }

    const docId = this._currentCurateDocId();
    const label = docId !== undefined ? `doc #${docId}` : "tous les documents";

    // Collect ignored unit_ids from the local review session (Strategy B).
    const ignoredUnitIds = this._collectIgnoredUnitIds();
    // Collect manual overrides (Level 7A).
    const manualOverrides = this._collectManualOverrides();
    const confirmMsg = this._buildApplyConfirmMessage(label, ignoredUnitIds, manualOverrides);

    if (!window.confirm(confirmMsg)) return;

    this._setBusy(true);
    const params: Record<string, unknown> = { rules };
    if (docId !== undefined) params.doc_id = docId;
    // Pass ignored units to sidecar — Strategy B: apply all except ignored.
    if (ignoredUnitIds.length > 0) params.ignored_unit_ids = ignoredUnitIds;
    // Pass manual overrides — Level 7A: apply user-supplied text for these units.
    if (manualOverrides.length > 0) params.manual_overrides = manualOverrides;

    // Level 9C: snapshot submit-time context for the structured apply result.
    // These values are synchronously available before the async job resolves.
    const _applySnapshot = {
      scope: (docId !== undefined ? "doc" : "all") as "doc" | "all",
      doc_id: docId ?? null,
      doc_title: docId !== undefined
        ? (this._docs.find(d => d.doc_id === docId)?.title ?? null)
        : null,
      ignored_count: ignoredUnitIds.length,
      manual_override_count: manualOverrides.length,
      preview_displayed_count: this._curateExamples.length,
      preview_units_changed: this._curateGlobalChanged,
      preview_truncated: this._curateExamples.length < this._curateGlobalChanged,
    };

    try {
      const job = await enqueueJob(this._conn, "curate", params);
      const skipNote = ignoredUnitIds.length > 0 ? `, ${ignoredUnitIds.length} ignorée(s)` : "";
      const overrideNote = manualOverrides.length > 0 ? `, ${manualOverrides.length} correction(s) manuelle(s)` : "";
      this._log(`Job curation soumis (${job.job_id.slice(0, 8)}…)${skipNote}${overrideNote}`);
      this._pushCurateLog("apply", `Soumis – ${label}${skipNote}${overrideNote}`);
      // vNext: panel is always visible — reset content to "applied" state
      const rawEl = document.querySelector("#act-preview-raw");
      if (rawEl) rawEl.innerHTML = `<p class="empty-hint">Curation en cours&#8230;</p>`;
      const diffEl = document.querySelector("#act-diff-list");
      if (diffEl) diffEl.innerHTML = `<p class="empty-hint">Curation en cours&#8230;</p>`;
      const statsEl = document.querySelector("#act-preview-stats");
      if (statsEl) statsEl.innerHTML = "";
      const infoEl2 = document.querySelector("#act-preview-info");
      if (infoEl2) infoEl2.textContent = "Job soumis…";
      this._jobCenter?.trackJob(job.job_id, `Curation ${label}`, (done) => {
        if (done.status === "done") {
          const r = done.result as {
            docs_curated?: number; units_modified?: number;
            units_skipped?: number; fts_stale?: boolean;
          } | undefined;
          const skippedNote = (r?.units_skipped ?? 0) > 0 ? `, ${r!.units_skipped} ignorée(s)` : "";
          this._log(`✓ Curation : ${r?.docs_curated ?? "?"} doc(s), ${r?.units_modified ?? "?"} unité(s) modifiée(s)${skippedNote}.`);
          this._pushCurateLog("apply", `OK – ${r?.docs_curated ?? "?"} doc(s), ${r?.units_modified ?? "?"} modifiée(s)${skippedNote}`);
          // Level 9C / 10A: store structured apply result.
          const _event: CurateApplyEvent = {
            ..._applySnapshot,
            applied_at: new Date().toISOString(),
            docs_curated: r?.docs_curated ?? 0,
            units_modified: r?.units_modified ?? 0,
            units_skipped: r?.units_skipped ?? 0,
          };
          this._lastApplyResult = _event;
          // Level 10A: push to session history (newest first).
          this._applyHistory.unshift(_event);
          // Level 10B: persist durably — fire and forget, do not block the callback.
          if (this._conn) {
            recordApplyHistory(this._conn, _event).catch(() => {
              this._log("⚠ Impossible de persister l'historique d'apply.", true);
            });
          }
          this._updateApplyResultUI();
          // Level 4B — Option A: invalidate saved review state after a successful apply.
          // The document has been modified; any saved statuses are now potentially obsolete.
          this._invalidateCurateReviewAfterApply(docId ?? null);
          if (r?.fts_stale) {
            this._log("⚠ Index FTS périmé.");
            this._pushCurateLog("warn", "Index FTS périmé – re-indexer");
            const btn = document.querySelector("#act-reindex-after-curate-btn") as HTMLElement | null;
            if (btn) btn.style.display = "";
          }
          this._hasPendingPreview = false;
          this._showToast?.("✓ Curation appliquée");
        } else {
          this._log(`✗ Curation : ${done.error ?? done.status}`, true);
          this._pushCurateLog("warn", `Erreur : ${done.error ?? done.status}`);
          // Do NOT set _lastApplyResult on failure — keep any previous successful one.
          this._showToast?.("✗ Erreur curation", true);
        }
        this._setBusy(false);
        this._refreshRuntimeState();
      });
    } catch (err) {
      const msg = err instanceof SidecarError ? err.message : String(err);
      this._log(`✗ Curation : ${msg}`, true);
      this._pushCurateLog("warn", `Erreur soumission : ${msg}`);
      this._setBusy(false);
      this._refreshRuntimeState();
    }
  }

  // ─── Segment ─────────────────────────────────────────────────────────────

  private _currentSegDocSelection(): { docId: number; docLabel: string } | null {
    // New split panel uses _selectedSegDocId; fall back to legacy #act-seg-doc if present
    const docId = this._selectedSegDocId
      ?? parseInt((document.querySelector("#act-seg-doc") as HTMLSelectElement | null)?.value ?? "", 10);
    if (!Number.isInteger(docId) || isNaN(docId)) return null;
    const doc = this._docs.find((d) => d.doc_id === docId);
    const docLabel = doc ? `"${doc.title}"` : `#${docId}`;
    return { docId, docLabel };
  }

  private _toggleSegFocusMode(root: HTMLElement): void {
    this._segFocusMode = !this._segFocusMode;
    root.classList.toggle("seg-focus-mode", this._segFocusMode);
    const btn = root.querySelector<HTMLButtonElement>("#act-seg-focus-toggle");
    if (btn) {
      btn.textContent = this._segFocusMode ? "Quitter mode focus segmentation" : "Mode focus segmentation";
    }
  }

  private _refreshSegmentationStatusUI(): void {
    const banner = document.querySelector<HTMLElement>("#act-seg-status-banner");
    const validateOnlyBtn = document.querySelector<HTMLButtonElement>("#act-seg-validate-only-btn");
    const exportBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("#act-seg-open-export-btn, #act-seg-lt-open-export-btn"));
    if (!banner) return;

    const segSel = this._currentSegDocSelection();

    // Update preview-controls chips
    const chipDoc = document.querySelector<HTMLElement>("#act-seg-chip-doc");
    const chipStatus = document.querySelector<HTMLElement>("#act-seg-chip-status");
    const chipPack = document.querySelector<HTMLElement>("#act-seg-chip-pack");
    if (chipDoc) chipDoc.textContent = segSel ? segSel.docLabel : "Aucun document";
    if (chipPack) {
      const packEl = document.querySelector<HTMLSelectElement>("#act-seg-pack");
      chipPack.textContent = packEl?.value || "auto";
    }

    if (!this._conn) {
      banner.className = "runtime-state state-error";
      banner.textContent = "Sidecar indisponible.";
      if (chipStatus) { chipStatus.textContent = "Hors ligne"; chipStatus.className = "chip"; }
      if (validateOnlyBtn) validateOnlyBtn.disabled = true;
      exportBtns.forEach((b) => { b.disabled = true; });
      return;
    }
    if (!segSel) {
      banner.className = "runtime-state state-info";
      banner.textContent = "Sélectionnez un document pour segmenter.";
      if (chipStatus) { chipStatus.textContent = "En attente"; chipStatus.className = "chip"; }
      if (validateOnlyBtn) validateOnlyBtn.disabled = true;
      exportBtns.forEach((b) => { b.disabled = true; });
      return;
    }

    const finalBar = document.querySelector<HTMLElement>("#act-seg-final-bar");
    const finalMeta = document.querySelector<HTMLElement>("#act-seg-final-meta");
    const finalSegBtn = document.querySelector<HTMLButtonElement>("#act-seg-final-seg-btn");
    const finalValBtn = document.querySelector<HTMLButtonElement>("#act-seg-final-validate-btn");

    if (this._lastSegmentReport && this._lastSegmentReport.doc_id === segSel.docId) {
      const warnings = this._lastSegmentReport.warnings ?? [];
      const warningText = warnings.length ? ` · ${warnings.length} avert.` : "";
      const pack = this._lastSegmentReport.segment_pack ?? "auto";
      if (this._segmentPendingValidation) {
        banner.className = "runtime-state state-warn";
        banner.textContent =
          `Segmentation prête sur ${segSel.docLabel}: ${this._lastSegmentReport.units_input} → ${this._lastSegmentReport.units_output} unités (pack ${pack})${warnings.length ? ` · avertissements: ${warnings.length}` : ""}. Validez le document.`;
        if (chipStatus) { chipStatus.textContent = `${this._lastSegmentReport.units_output} segments`; chipStatus.className = "chip active"; }
      } else {
        banner.className = "runtime-state state-ok";
        banner.textContent =
          `Dernière segmentation ${segSel.docLabel}: ${this._lastSegmentReport.units_input} → ${this._lastSegmentReport.units_output} unités (pack ${pack})${warnings.length ? ` · avertissements: ${warnings.length}` : ""}.`;
        if (chipStatus) { chipStatus.textContent = `${this._lastSegmentReport.units_output} segments ✓`; chipStatus.className = "chip active"; }
      }
      if (validateOnlyBtn) validateOnlyBtn.disabled = !this._segmentPendingValidation;
      exportBtns.forEach((b) => { b.disabled = false; });
      // Show doc-final-bar with contextual meta
      if (finalBar) finalBar.removeAttribute("hidden");
      if (finalMeta) finalMeta.textContent = `Pack: ${pack} · ${this._lastSegmentReport.units_output} unités${warningText}`;
      if (finalValBtn) finalValBtn.disabled = !this._segmentPendingValidation;
      if (finalSegBtn) finalSegBtn.disabled = false;
      return;
    }

    banner.className = "runtime-state state-info";
    banner.textContent = `Aucune segmentation lancée sur ${segSel.docLabel} dans cette session.`;
    if (chipStatus) { chipStatus.textContent = "Non segmenté"; chipStatus.className = "chip"; }
    if (validateOnlyBtn) validateOnlyBtn.disabled = true;
    exportBtns.forEach((b) => { b.disabled = true; });
    // Hide doc-final-bar when no results
    if (finalBar) finalBar.setAttribute("hidden", "");
  }

  private _openExporterWithPrefill(prefill?: ActionsExportPrefill): void {
    if (!this._openExporterTab) {
      this._showToast?.("Onglet Exporter indisponible.", true);
      return;
    }
    this._openExporterTab(prefill);
  }

  private _openSegmentationExportPrefill(): void {
    const segSel = this._currentSegDocSelection();
    if (!segSel) {
      this._showToast?.("Sélectionnez d'abord un document segmenté.", true);
      return;
    }
    if (!this._lastSegmentReport || this._lastSegmentReport.doc_id !== segSel.docId) {
      this._showToast?.("Lancez une segmentation avant l'export de cette étape.", true);
      return;
    }
    this._openExporterWithPrefill({
      stage: "segmentation",
      product: "readable_text",
      format: "txt",
      docIds: [segSel.docId],
      strictMode: false,
    });
  }

  private _openAlignmentExportPrefill(): void {
    const pivotRaw = (document.querySelector("#act-align-pivot") as HTMLSelectElement | null)?.value ?? "";
    const pivotId = pivotRaw ? parseInt(pivotRaw, 10) : NaN;
    const targetsSel = document.querySelector("#act-align-targets") as HTMLSelectElement | null;
    const targetIds = targetsSel
      ? Array.from(targetsSel.selectedOptions)
        .map((opt) => parseInt(opt.value, 10))
        .filter((v) => Number.isInteger(v))
      : [];

    const prefill: ActionsExportPrefill = {
      stage: "alignment",
      product: "aligned_table",
      format: "csv",
      strictMode: false,
    };
    if (Number.isInteger(pivotId)) prefill.pivotDocId = pivotId;
    if (targetIds.length > 0) {
      prefill.docIds = targetIds;
      prefill.targetDocId = targetIds[0];
    }
    if (this._alignRunId) prefill.runId = this._alignRunId;
    this._openExporterWithPrefill(prefill);
  }

  private async _runValidateCurrentSegDoc(): Promise<void> {
    if (this._isBusy) return;
    const segSel = this._currentSegDocSelection();
    if (!segSel) {
      this._log("Sélectionnez un document avant validation.", true);
      return;
    }
    if (!window.confirm(`Valider le document ${segSel.docLabel} sans relancer la segmentation ?`)) {
      return;
    }
    this._setBusy(true);
    await this._markSegmentedDocValidated(segSel.docId, segSel.docLabel);
  }

  /**
   * Longtext "Appliquer" CTA: validates current segmentation, then navigates
   * to the Curation sub-view if validation succeeded. Non-breaking on failure.
   */
  private async _applyLongtextValidation(): Promise<void> {
    const beforePending = this._segmentPendingValidation;
    const beforeView = this._activeSubView;
    await this._runValidateCurrentSegDoc();
    // Only navigate to Curation if:
    //  1. validation actually consumed the pending flag
    //  2. no internal navigation already occurred (postValidate routing may have moved away)
    const consumed = beforePending && !this._segmentPendingValidation;
    const navAlreadyOccurred = this._activeSubView !== beforeView;
    if (consumed && !navAlreadyOccurred && this._root) {
      try {
        this._switchSubViewDOM(this._root, "curation");
      } catch {
        // navigation failure is non-breaking
      }
    }
  }

  private async _runSegment(validateAfter = false): Promise<void> {
    if (!this._conn) return;
    const segSel = this._currentSegDocSelection();
    if (!segSel) { this._log("Sélectionnez un document.", true); return; }
    const docId = segSel.docId;
    const lang = (document.querySelector("#act-seg-lang") as HTMLInputElement).value.trim() || "und";
    const pack = (document.querySelector("#act-seg-pack") as HTMLSelectElement).value || "auto";
    const calibrateRaw = (document.querySelector("#act-seg-calibrate") as HTMLSelectElement | null)?.value ?? "";
    const calibrateTo = calibrateRaw ? parseInt(calibrateRaw, 10) : undefined;
    const useMarkers = this._segSplitMode === "markers";
    const docLabel = segSel.docLabel;
    const postValidate = this._postValidateDestination();
    const postValidateLabel = postValidate === "next"
      ? "sélectionnera le document suivant"
      : postValidate === "stay"
      ? "restera sur l'onglet Actions"
      : "basculera vers l'onglet Documents";

    const modeLabel = useMarkers ? "MODE BALISES [N]" : `Pack: ${pack}`;
    const prompt = validateAfter
      ? `Segmenter puis valider le document ${docLabel} ?\n` +
        `${modeLabel}\n` +
        `Cette opération EFFACE les liens d'alignement existants puis ${postValidateLabel}.`
      : `Segmenter le document ${docLabel} ?\n` +
        `${modeLabel}\n` +
        "Cette opération EFFACE les liens d'alignement existants.";
    if (!window.confirm(prompt)) return;

    this._setBusy(true);
    try {
      const jobPayload: Record<string, unknown> = useMarkers
        ? { doc_id: docId, mode: "markers" }
        : { doc_id: docId, lang, pack };
      if (!useMarkers && calibrateTo) jobPayload.calibrate_to = calibrateTo;
      const job = await enqueueJob(this._conn, "segment", jobPayload);
      this._log(`Job segmentation soumis pour ${docLabel} (${job.job_id.slice(0, 8)}…)`);
      // Show loading state in preview card immediately
      const segPreviewBody = document.querySelector("#act-seg-preview-body");
      const segPreviewInfo = document.querySelector("#act-seg-preview-info");
      if (segPreviewBody) segPreviewBody.innerHTML = `<p class="loading-hint">Segmentation en cours…</p>`;
      if (segPreviewInfo) segPreviewInfo.textContent = "En cours…";
      this._jobCenter?.trackJob(job.job_id, `Segmentation ${docLabel}`, (done) => {
        if (done.status === "done") {
          const r = done.result as {
            units_input?: number;
            units_output?: number;
            segment_pack?: string;
            warnings?: string[];
            fts_stale?: boolean;
          } | undefined;
          this._lastSegmentReport = {
            doc_id: docId,
            units_input: Number(r?.units_input ?? 0),
            units_output: Number(r?.units_output ?? 0),
            segment_pack: r?.segment_pack,
            warnings: r?.warnings ?? [],
          };
          this._renderSegPreview();
          // Reload the "Document brut" pane with post-segmentation units and
          // append the segmented lines directly to the "Proposition" pane too.
          void this._appendSegmentedLinesPreview(docId);
          // New split panel: refresh saved segments table + raw col + status
          {
            const savedSection = document.querySelector<HTMLElement>("#act-seg-saved-section");
            const savedTableEl = document.querySelector<HTMLElement>("#act-seg-saved-table");
            const savedCount = document.querySelector<HTMLElement>("#act-seg-saved-count");
            if (savedSection) savedSection.style.display = "";
            if (savedCount) savedCount.textContent = String(this._lastSegmentReport?.units_output ?? "?");
            if (savedTableEl) void this._renderSegSavedTable(docId, savedTableEl);
            void this._loadSegRawColumn(docId);
            void this._runSegPreview(docId);
            this._populateSegDocList();
          }
          this._updateLongtextPreview(this._root?.querySelector('[data-panel="segmentation"]') ?? null);
          this._updateTraductionPreview();
          const warns = r?.warnings?.length ? ` Avertissements : ${r.warnings.join("; ")}` : "";
          const usedPack = r?.segment_pack ? ` Pack=${r.segment_pack}.` : "";
          this._log(`✓ Segmentation : ${r?.units_input ?? "?"} → ${r?.units_output ?? "?"} unités.${usedPack}${warns}`);
          if (r?.fts_stale) this._log("⚠ Index FTS périmé.");
          if (validateAfter) {
            this._segmentPendingValidation = true;
            this._refreshSegmentationStatusUI();
            void this._markSegmentedDocValidated(docId, docLabel);
          } else {
            this._segmentPendingValidation = true;
            this._refreshSegmentationStatusUI();
            this._showToast?.(`✓ Segmentation ${docLabel} terminée`);
            this._setBusy(false);
          }
        } else {
          this._log(`✗ Segmentation : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur segmentation", true);
          this._setBusy(false);
        }
      });
    } catch (err) {
      this._log(`✗ Segmentation : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._setBusy(false);
    }
  }

  private async _markSegmentedDocValidated(docId: number, docLabel: string): Promise<void> {
    if (!this._conn) {
      this._setBusy(false);
      return;
    }
    try {
      await updateDocument(this._conn, {
        doc_id: docId,
        workflow_status: "validated",
      });
      this._segmentPendingValidation = false;
      this._log(`✓ ${docLabel} marqué comme validé.`);
      this._showToast?.(`✓ ${docLabel} validé`);
      this._refreshSegmentationStatusUI();
      const postValidate = this._postValidateDestination();
      if (postValidate === "next") {
        const moved = this._selectNextSegDoc(docId);
        if (moved) {
          this._log(`→ Document suivant sélectionné: #${moved.doc_id} (${moved.language}).`);
        } else {
          this._log("→ Aucun document suivant: redirection vers Documents.");
          this._openDocumentsTab?.();
        }
      } else if (postValidate === "stay") {
        this._log("→ Reste sur l'onglet Actions.");
      } else {
        this._openDocumentsTab?.();
      }
    } catch (err) {
      this._log(`✗ Validation workflow après segmentation : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Segmentation OK mais validation workflow en échec", true);
    } finally {
      this._refreshSegmentationStatusUI();
      this._setBusy(false);
    }
  }

  private _postValidateDestination(): "documents" | "next" | "stay" {
    try {
      const raw = localStorage.getItem(ActionsScreen.LS_SEG_POST_VALIDATE);
      if (raw === "next" || raw === "stay") return raw;
    } catch { /* ignore */ }
    return "documents";
  }

  private _selectNextSegDoc(currentDocId: number): DocumentRecord | null {
    const idx = this._docs.findIndex((d) => d.doc_id === currentDocId);
    if (idx < 0 || idx >= this._docs.length - 1) return null;
    const nextDoc = this._docs[idx + 1];
    const segDocSel = document.querySelector("#act-seg-doc") as HTMLSelectElement | null;
    if (segDocSel) {
      segDocSel.value = String(nextDoc.doc_id);
      segDocSel.dispatchEvent(new Event("change"));
    }
    const segLang = document.querySelector("#act-seg-lang") as HTMLInputElement | null;
    if (segLang && nextDoc.language) {
      segLang.value = nextDoc.language.slice(0, 10);
    }
    return nextDoc;
  }

  // ─── Feature 2: Align + Audit ────────────────────────────────────────────

  private async _runAlign(recalculate = false): Promise<void> {
    if (!this._conn) return;
    const pivotSel = (document.querySelector("#act-align-pivot") as HTMLSelectElement).value;
    if (!pivotSel) { this._log("Sélectionnez un document pivot.", true); return; }
    const pivotId = parseInt(pivotSel);

    const targetsSel = document.querySelector("#act-align-targets") as HTMLSelectElement;
    const targetIds: number[] = [];
    for (const opt of targetsSel.selectedOptions) targetIds.push(parseInt(opt.value));
    if (targetIds.length === 0) { this._log("Sélectionnez au moins un doc cible.", true); return; }

    const strategy = (document.querySelector("#act-align-strategy") as HTMLSelectElement).value as
      "external_id" | "external_id_then_position" | "position" | "similarity";
    const debugAlign = (document.querySelector("#act-align-debug") as HTMLInputElement).checked;
    const simThreshold = parseFloat(
      (document.querySelector("#act-sim-threshold") as HTMLInputElement).value
    ) || 0.8;
    const preserveAccepted = (document.querySelector("#act-align-preserve-accepted") as HTMLInputElement | null)?.checked ?? true;
    const modeLabel = recalculate ? "Recalcul global" : "Alignement";

    if (!window.confirm(
      `${modeLabel} pivot #${pivotId} → cibles [${targetIds.join(", ")}]\n` +
      `Stratégie : ${strategy}\n` +
      `Conserver liens validés : ${preserveAccepted ? "oui" : "non"}\n` +
      `Debug: ${debugAlign ? "on" : "off"}`
    )) return;

    this._alignExplainability = [];
    this._alignRunId = null;
    this._renderAlignExplainability();
    this._setBusy(true);
    const alignParams: Record<string, unknown> = {
      pivot_doc_id: pivotId,
      target_doc_ids: targetIds,
      strategy,
      debug_align: debugAlign,
      replace_existing: recalculate,
      preserve_accepted: preserveAccepted,
    };
    if (strategy === "similarity") alignParams.sim_threshold = simThreshold;

    try {
      const job = await enqueueJob(this._conn, "align", alignParams);
      this._log(`${modeLabel} soumis pivot #${pivotId} → [${targetIds.join(",")}] (${job.job_id.slice(0, 8)}…)`);
      this._jobCenter?.trackJob(job.job_id, `Alignement #${pivotId}→[${targetIds.join(",")}]`, (done) => {
        if (done.status === "done") {
          const reports = (done.result as {
            run_id?: string;
            deleted_before?: number;
            preserved_before?: number;
            total_effective_links?: number;
            reports?: Array<{ target_doc_id: number; links_created: number; links_skipped?: number; debug?: AlignDebugPayload }>;
          } | undefined)?.reports ?? [];
          const result = (done.result as {
            run_id?: string;
            deleted_before?: number;
            preserved_before?: number;
            total_effective_links?: number;
          } | undefined);
          const runId = result?.run_id;
          const deletedBefore = Number(result?.deleted_before ?? 0);
          const preservedBefore = Number(result?.preserved_before ?? 0);
          const totalEffectiveLinks = Number(result?.total_effective_links ?? reports.reduce((s, r) => s + r.links_created, 0));
          this._alignRunId = typeof runId === "string" && runId ? runId : null;
          // Persist run_id for workflow
          if (this._alignRunId) {
            try { localStorage.setItem(ActionsScreen.LS_WF_RUN_ID, this._alignRunId); } catch { /* ignore */ }
          }
          // Pre-fill run report field
          const reportInput = document.querySelector<HTMLInputElement>("#act-report-run-id");
          if (reportInput && this._alignRunId) reportInput.value = this._alignRunId;
          // ALIGN-3: mettre à jour la pill avec le run ID actif
          const pillEl = document.querySelector<HTMLElement>("#act-align-run-pill");
          if (pillEl && this._alignRunId) pillEl.textContent = `run\u00a0: ${this._alignRunId}`;
          // Sync workflow display
          this._wfSyncRunId();
          this._alignExplainability = reports.map((r) => ({
            target_doc_id: r.target_doc_id,
            links_created: r.links_created,
            links_skipped: r.links_skipped ?? 0,
            debug: r.debug,
          }));
          const resultsEl = document.querySelector("#act-align-results") as HTMLElement | null;
          const bannerEl = document.querySelector("#act-align-banner");
          if (resultsEl) resultsEl.style.display = "";
          if (bannerEl) {
            const reportBits = reports
              .map((r) => {
                const skipped = r.links_skipped ?? 0;
                return `<span class="stat-ok">→ doc #${r.target_doc_id} : ${r.links_created} liens créés, ${skipped} ignorés.</span>`;
              })
              .join(" &nbsp;");
            const recalcBits = recalculate
              ? ` <span class="stat-warn">Nettoyés: ${deletedBefore}</span> <span class="stat-ok">Conservés: ${preservedBefore}</span> <span class="stat-ok">Liens effectifs: ${totalEffectiveLinks}</span>`
              : "";
            bannerEl.innerHTML = `${reportBits}${recalcBits}`;
          }
          // Populate KPIs
          const totalCreated = reports.reduce((s, r) => s + r.links_created, 0);
          const totalSkipped = reports.reduce((s, r) => s + (r.links_skipped ?? 0), 0);
          const setKpi = (id: string, value: string, cls?: string) => {
            const el = document.querySelector(`#${id}`);
            if (el) {
              el.textContent = value;
              el.className = cls ? `align-kpi-value value ${cls}` : "align-kpi-value value";
              // Also update parent kpi card class for color coding
              const wrap = document.querySelector(`#${id.replace("act-kpi-", "act-kpi-wrap-")}`);
              if (wrap) wrap.className = cls ? `kpi align-kpi ${cls}` : "kpi align-kpi";
            }
          };
          setKpi("act-kpi-created", String(totalCreated), totalCreated > 0 ? "ok" : undefined);
          setKpi("act-kpi-skipped", String(totalSkipped), totalSkipped > 0 ? "warn" : undefined);
          if (recalculate) {
            setKpi("act-kpi-coverage", totalEffectiveLinks > 0 ? `${totalEffectiveLinks}` : "—");
          } else {
            setKpi("act-kpi-coverage", "—");
          }
          setKpi("act-kpi-orphan-p", "—");
          setKpi("act-kpi-orphan-t", "—");

          this._renderAlignExplainability();
          for (const r of reports) {
            const skipped = r.links_skipped ?? 0;
            this._log(`✓ → doc #${r.target_doc_id} : ${r.links_created} liens créés, ${skipped} ignorés.`);
          }
          if (recalculate) {
            this._log(`✓ Recalcul global: ${deletedBefore} liens supprimés, ${preservedBefore} conservés, ${totalEffectiveLinks} liens effectifs.`);
          }
          if (debugAlign) {
            const withDebug = reports.filter((r) => Boolean(r.debug)).length;
            if (withDebug > 0) {
              const runSuffix = this._alignRunId ? ` (run ${this._alignRunId})` : "";
              this._log(`Explainability : ${withDebug}/${reports.length} rapport(s) détaillé(s) disponibles${runSuffix}.`);
            } else {
              this._log("Explainability : aucun détail debug renvoyé par le backend.");
            }
          }
          if (recalculate) {
            this._showToast?.(`✓ Recalcul global terminé (${totalEffectiveLinks} liens effectifs)`);
          } else {
            this._showToast?.(`✓ Alignement terminé (${reports.reduce((s, r) => s + r.links_created, 0)} liens)`);
          }
          // Pre-fill audit selects
          this._auditPivotId = pivotId;
          this._auditTargetId = targetIds[0];
          this._auditOffset = 0;
          this._auditLinks = [];
          this._auditSelectedLinkId = null;
          this._lastAuditEmpty = false;
          const auditPivSel = document.querySelector("#act-audit-pivot") as HTMLSelectElement | null;
          const auditTgtSel = document.querySelector("#act-audit-target") as HTMLSelectElement | null;
          if (auditPivSel) auditPivSel.value = String(pivotId);
          if (auditTgtSel) auditTgtSel.value = String(targetIds[0]);
          const root = document.querySelector(".actions-screen");
          if (root) {
            this._auditQuickFilter = "review";
            this._writeAuditQuickFilterPref(this._auditQuickFilter);
            this._syncAuditQuickFilterUi(root as HTMLElement);
            this._renderAuditTable(root as HTMLElement);
            void this._loadAuditPage(root as HTMLElement, false);
          }
        } else {
          this._log(`✗ Alignement : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur alignement", true);
        }
        this._setBusy(false);
      });
    } catch (err) {
      this._log(`✗ Alignement : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._setBusy(false);
    }
  }

  private _renderAlignExplainability(): void {
    const panel = document.querySelector("#act-align-debug-panel") as HTMLElement | null;
    const content = document.querySelector("#act-align-debug-content") as HTMLElement | null;
    const copyBtn = document.querySelector("#act-align-copy-debug-btn") as HTMLButtonElement | null;
    if (!panel || !content || !copyBtn) return;

    if (this._alignExplainability.length === 0) {
      panel.style.display = "none";
      content.innerHTML = "";
      copyBtn.disabled = true;
      return;
    }

    panel.style.display = "";
    const runMeta = this._alignRunId
      ? `<div class="align-debug-meta" style="margin-bottom:0.35rem">run_id: <code>${_escHtml(this._alignRunId)}</code></div>`
      : "";
    const rows = this._alignExplainability.map((rep) => {
      const debug = rep.debug;
      if (!debug) {
        return `
          <div class="align-debug-card">
            <div class="align-debug-title">Doc cible #${rep.target_doc_id}</div>
            <div class="align-debug-meta">
              liens créés: <strong>${rep.links_created}</strong>, ignorés: <strong>${rep.links_skipped}</strong>
            </div>
            <div class="empty-hint">Aucun détail debug pour ce rapport.</div>
          </div>
        `;
      }

      const strategy = typeof debug.strategy === "string" ? debug.strategy : "n/a";
      const sourceParts = _isRecord(debug.link_sources)
        ? Object.entries(debug.link_sources).map(([k, v]) => `<span class="align-debug-pill">${_escHtml(k)}: ${_escHtml(String(v))}</span>`)
        : [];
      const sim = _isRecord(debug.similarity_stats) ? debug.similarity_stats : null;
      const sampleLinks = Array.isArray(debug.sample_links) ? debug.sample_links.slice(0, 3) : [];
      const sampleRows = sampleLinks.map((item) => {
        if (!_isRecord(item)) return "";
        const pivot = item.pivot_unit_id ?? "n/a";
        const target = item.target_unit_id ?? "n/a";
        const ext = item.external_id ?? "—";
        return `<li>pivot ${_escHtml(String(pivot))} → cible ${_escHtml(String(target))} (ext_id=${_escHtml(String(ext))})</li>`;
      }).join("");

      return `
        <div class="align-debug-card">
          <div class="align-debug-title">Doc cible #${rep.target_doc_id}</div>
          <div class="align-debug-meta">
            stratégie: <strong>${_escHtml(strategy)}</strong> ·
            liens créés: <strong>${rep.links_created}</strong> · ignorés: <strong>${rep.links_skipped}</strong>
          </div>
          ${sourceParts.length > 0
            ? `<div class="align-debug-row"><span class="align-debug-label">Sources</span><div class="align-debug-pills">${sourceParts.join("")}</div></div>`
            : `<div class="align-debug-row"><span class="align-debug-label">Sources</span><span class="empty-hint">n/a</span></div>`}
          ${sim
            ? `<div class="align-debug-row">
                 <span class="align-debug-label">Similarité</span>
                 <span>mean=${_formatMaybeNumber(sim.score_mean)} min=${_formatMaybeNumber(sim.score_min)} max=${_formatMaybeNumber(sim.score_max)}</span>
               </div>`
            : ""}
          ${sampleRows
            ? `<div class="align-debug-row">
                 <span class="align-debug-label">Exemples</span>
                 <ul class="align-debug-list">${sampleRows}</ul>
               </div>`
            : ""}
        </div>
      `;
    });

    content.innerHTML = runMeta + rows.join("");
    copyBtn.disabled = false;
  }

  private async _copyAlignDebugJson(): Promise<void> {
    if (this._alignExplainability.length === 0) {
      this._showToast?.("Aucun diagnostic à copier.", true);
      return;
    }
    const payload = {
      generated_at: new Date().toISOString(),
      run_id: this._alignRunId,
      reports: this._alignExplainability,
    };
    const ok = await _copyTextToClipboard(JSON.stringify(payload, null, 2));
    if (ok) {
      this._showToast?.("Diagnostic JSON copié.");
      this._log("Diagnostic alignement copié dans le presse-papiers.");
    } else {
      this._showToast?.("Impossible de copier automatiquement le diagnostic.", true);
      this._log("✗ Copie diagnostic alignement impossible.", true);
    }
  }

  private async _loadAuditPage(root: HTMLElement, append: boolean): Promise<void> {
    if (!this._conn) return;
    const pivotSel = root.querySelector("#act-audit-pivot") as HTMLSelectElement;
    const targetSel = root.querySelector("#act-audit-target") as HTMLSelectElement;
    const extIdInput = root.querySelector("#act-audit-extid") as HTMLInputElement;

    const pivotId = pivotSel?.value ? parseInt(pivotSel.value) : this._auditPivotId;
    const targetId = targetSel?.value ? parseInt(targetSel.value) : this._auditTargetId;
    if (!pivotId || !targetId) {
      this._log("Sélectionnez pivot et cible pour l'audit.", true);
      return;
    }

    if (!append) {
      this._auditOffset = 0;
      this._auditLinks = [];
      this._auditSelectedLinkId = null;
    }

    const statusSel = root.querySelector("#act-audit-status") as HTMLSelectElement;
    const opts: Parameters<typeof alignAudit>[1] = {
      pivot_doc_id: pivotId,
      target_doc_id: targetId,
      limit: this._auditLimit,
      offset: this._auditOffset,
      include_explain: this._auditIncludeExplain,
    };
    const extIdVal = extIdInput?.value.trim();
    if (extIdVal) opts.external_id = parseInt(extIdVal);
    const statusVal = statusSel?.value;
    if (statusVal) opts.status = statusVal as "accepted" | "rejected" | "unreviewed";

    try {
      const res = await alignAudit(this._conn, opts);
      this._auditLinks = append
        ? ([...this._auditLinks, ...res.links] as AlignLinkRecord[])
        : (res.links as AlignLinkRecord[]);
      this._auditOffset = res.next_offset ?? this._auditOffset + res.limit;
      this._auditHasMore = res.has_more;
      this._auditPivotId = pivotId;
      this._auditTargetId = targetId;
      this._log(`Audit : ${this._auditLinks.length} lien(s) chargé(s)${res.has_more ? " (suite disponible)" : ""}.`);
    } catch (err) {
      this._log(`✗ Audit : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      this._auditLoading = false;
      this._renderAuditTable(root);
    }
  }

  private _renderAuditTable(root: HTMLElement): void {
    const wrap = root.querySelector("#act-audit-table-wrap")!;
    const moreBtn = root.querySelector("#act-audit-more-btn") as HTMLElement;
    const batchBar = root.querySelector("#act-audit-batch-bar") as HTMLElement | null;
    const kpiEl = root.querySelector<HTMLElement>("#act-audit-kpis");
    const visibleLinks = this._computeVisibleAuditLinks();
    const acceptedCount = this._auditLinks.filter((l) => this._normalizeAuditStatus(l.status) === "accepted").length;
    const rejectedCount = this._auditLinks.filter((l) => this._normalizeAuditStatus(l.status) === "rejected").length;
    const unreviewedCount = this._auditLinks.filter((l) => this._normalizeAuditStatus(l.status) === "unreviewed").length;
    const exceptionCount = rejectedCount + unreviewedCount;
    if (kpiEl) {
      const filterLabel = this._auditQuickFilter === "review"
        ? "À revoir"
        : this._auditQuickFilter === "unreviewed"
        ? "Non révisés"
        : this._auditQuickFilter === "rejected"
        ? "Rejetés"
        : "Tout";
      kpiEl.textContent = `Chargés: ${this._auditLinks.length} · Acceptés: ${acceptedCount} · Non révisés: ${unreviewedCount} · Rejetés: ${rejectedCount} · Exceptions: ${exceptionCount} · Filtre: ${filterLabel} (${visibleLinks.length} visible(s))`;
    }
    if (!visibleLinks.some((l) => l.link_id === this._auditSelectedLinkId)) {
      this._auditSelectedLinkId = visibleLinks.length > 0 ? visibleLinks[0].link_id : null;
    }

    if (this._auditLinks.length === 0) {
      this._lastAuditEmpty = !this._auditLoading;
      if (this._auditLoading) {
        // État (c) — chargement en cours
        wrap.innerHTML = '<p class="empty-hint">Chargement des liens d\u2019alignement\u2026</p>';
      } else {
        // État (a) — aucun lien créé
        wrap.innerHTML = '<p class="empty-hint">Aucun lien d\u2019alignement trouv\u00e9.<br>Lancez d\u2019abord un alignement via le panneau ci-dessus, puis cliquez sur <strong>Charger les liens</strong>.</p>';
      }
      if (moreBtn) moreBtn.style.display = "none";
      if (batchBar) batchBar.style.display = "none";
      this._renderAuditFocus(root);
      this._refreshRuntimeState();
      return;
    }
    this._lastAuditEmpty = visibleLinks.length === 0;
    if (visibleLinks.length === 0) {
      // État (b) — liens chargés mais filtre actif les masque tous
      const hasActiveFilter = this._auditQuickFilter !== "all" || this._auditTextFilter !== "" || this._auditExceptionsOnly;
      wrap.innerHTML = `<p class="empty-hint">Aucune ligne ne correspond au filtre courant.${hasActiveFilter ? `<br><button class="btn btn-secondary btn-sm" id="act-audit-reset-filters" style="margin-top:6px">R\u00e9initialiser les filtres</button>` : ""}</p>`;
      wrap.querySelector("#act-audit-reset-filters")?.addEventListener("click", () => this._resetAuditFilters(root));
      if (moreBtn) moreBtn.style.display = this._auditHasMore ? "" : "none";
      if (batchBar) batchBar.style.display = "none";
      this._renderAuditFocus(root);
      this._refreshRuntimeState();
      return;
    }

    const showExplain = this._auditIncludeExplain;
    const table = document.createElement("table");
    table.className = "meta-table audit-table";
    table.innerHTML = `
      <thead><tr>
        <th><input type="checkbox" id="act-audit-sel-all" title="Tout sélectionner" aria-label="Tout sélectionner"/></th>
        <th>ext_id</th>
        <th>Pivot (texte)</th>
        <th>Cible (texte)</th>
        <th>Statut</th>
        ${showExplain ? "<th>Expliquer</th>" : ""}
        <th>Actions</th>
      </tr></thead>
    `;
    const tbody = document.createElement("tbody");
    for (const link of visibleLinks) {
      const tr = document.createElement("tr");
      tr.classList.toggle("audit-row-active", link.link_id === this._auditSelectedLinkId);
      tr.dataset.linkId = String(link.link_id);
      const normalizedStatus = this._normalizeAuditStatus(link.status);
      const statusBadge = normalizedStatus === "accepted"
        ? `<span class="status-badge status-ok">✅ Accepté</span>`
        : normalizedStatus === "rejected"
        ? `<span class="status-badge status-error">❌ Rejeté</span>`
        : `<span class="status-badge status-unknown">🔵 Non révisé</span>`;

      let explainCell = "";
      if (showExplain) {
        if (link.explain) {
          const notes = (link.explain.notes ?? []).map(n => `<li>${_escHtml(n)}</li>`).join("");
          explainCell = `<td>
            <details>
              <summary style="cursor:pointer;font-size:0.78rem;color:var(--brand)">${_escHtml(link.explain.strategy)}</summary>
              ${notes ? `<ul style="margin:0.25rem 0 0 1rem;font-size:0.78rem;padding:0">${notes}</ul>` : ""}
            </details>
          </td>`;
        } else {
          explainCell = `<td style="color:var(--text-muted);font-size:0.8rem">—</td>`;
        }
      }

      tr.innerHTML = `
        <td><input type="checkbox" class="audit-row-cb" data-id="${link.link_id}"/></td>
        <td style="white-space:nowrap">${link.external_id ?? "—"}</td>
        <td class="audit-text">${_escHtml(String(link.pivot_text ?? ""))}</td>
        <td class="audit-text">${_escHtml(String(link.target_text ?? ""))}</td>
        <td style="white-space:nowrap">${statusBadge}</td>
        ${explainCell}
        <td style="white-space:nowrap">
          <button class="btn btn-sm btn-secondary audit-accept-btn" data-id="${link.link_id}" title="Accepter" aria-label="Accepter ce lien">✓</button>
          <button class="btn btn-sm btn-danger audit-reject-btn" data-id="${link.link_id}" title="Rejeter" aria-label="Rejeter ce lien">✗</button>
          <button class="btn btn-sm btn-secondary audit-retarget-btn" data-id="${link.link_id}" data-pivot="${link.pivot_unit_id}" title="Recibler" aria-label="Recibler ce lien">⇄</button>
          <button class="btn btn-sm btn-danger audit-del-btn" data-id="${link.link_id}" title="Supprimer" aria-label="Supprimer ce lien">🗑</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.innerHTML = "";
    wrap.appendChild(table);

    // Wire action buttons
    const self = this;
    wrap.querySelectorAll<HTMLButtonElement>(".audit-accept-btn").forEach(btn => {
      btn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        void self._setLinkStatus(Number(btn.dataset.id), "accepted", root);
      });
    });
    wrap.querySelectorAll<HTMLButtonElement>(".audit-reject-btn").forEach(btn => {
      btn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        void self._setLinkStatus(Number(btn.dataset.id), "rejected", root);
      });
    });
    wrap.querySelectorAll<HTMLButtonElement>(".audit-del-btn").forEach(btn => {
      btn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        void self._deleteLinkFromAudit(Number(btn.dataset.id), root);
      });
    });
    wrap.querySelectorAll<HTMLButtonElement>(".audit-retarget-btn").forEach(btn => {
      btn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        void self._openRetargetModal(Number(btn.dataset.id), Number(btn.dataset.pivot), root);
      });
    });
    wrap.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        const id = Number(tr.dataset.linkId);
        if (!Number.isFinite(id)) return;
        this._auditSelectedLinkId = id;
        this._renderAuditTable(root);
      });
    });

    // Select-all checkbox
    const selAllCb = table.querySelector<HTMLInputElement>("#act-audit-sel-all");
    const updateBatchBar = () => {
      const checked = wrap.querySelectorAll<HTMLInputElement>(".audit-row-cb:checked");
      const countEl = root.querySelector<HTMLElement>("#act-audit-sel-count");
      if (countEl) countEl.textContent = `${checked.length} sélectionné(s)`;
      if (batchBar) batchBar.style.display = checked.length > 0 ? "flex" : "none";
    };
    if (selAllCb) {
      selAllCb.addEventListener("change", () => {
        wrap.querySelectorAll<HTMLInputElement>(".audit-row-cb").forEach(cb => {
          cb.checked = selAllCb.checked;
        });
        updateBatchBar();
      });
    }
    wrap.querySelectorAll<HTMLInputElement>(".audit-row-cb").forEach(cb => {
      cb.addEventListener("change", (evt) => {
        evt.stopPropagation();
        updateBatchBar();
      });
      cb.addEventListener("click", (evt) => evt.stopPropagation());
    });

    if (moreBtn) moreBtn.style.display = this._auditHasMore ? "" : "none";
    if (batchBar) batchBar.style.display = "none"; // hidden until selection
    this._renderAuditFocus(root);
    this._refreshRuntimeState();
    // Also refresh run-view if currently active
    if (this._alignViewMode === "run") this._renderAuditRunView(root);
  }

  private _renderAuditFocus(root: HTMLElement): void {
    const emptyEl = root.querySelector<HTMLElement>("#act-align-focus-empty");
    const panelEl = root.querySelector<HTMLElement>("#act-align-focus-panel");
    if (!emptyEl || !panelEl) return;
    const selected = this._selectedAuditLink();
    if (!selected) {
      emptyEl.style.display = "";
      panelEl.style.display = "none";
      return;
    }
    emptyEl.style.display = "none";
    panelEl.style.display = "";
    const metaEl = root.querySelector<HTMLElement>("#act-align-focus-meta");
    const pivotEl = root.querySelector<HTMLElement>("#act-align-focus-pivot");
    const targetEl = root.querySelector<HTMLElement>("#act-align-focus-target");
    if (metaEl) {
      const statusLabel = this._normalizeAuditStatus(selected.status) === "accepted"
        ? "accepté"
        : this._normalizeAuditStatus(selected.status) === "rejected"
        ? "rejeté"
        : "non révisé";
      metaEl.innerHTML = `Lien #${selected.link_id} · ext_id ${selected.external_id ?? "—"} · statut <strong>${statusLabel}</strong>`;
    }
    if (pivotEl) pivotEl.textContent = String(selected.pivot_text ?? "");
    if (targetEl) targetEl.textContent = String(selected.target_text ?? "");
  }

  // ─── V1.3 — Batch audit actions ────────────────────────────────────────────

  private _getSelectedLinkIds(root: HTMLElement): number[] {
    return Array.from(root.querySelectorAll<HTMLInputElement>(".audit-row-cb:checked"))
      .map(cb => Number(cb.dataset.id))
      .filter(id => Number.isFinite(id));
  }

  private async _runBatchAction(
    root: HTMLElement,
    action: "set_status" | "delete",
    status: "accepted" | "rejected" | null
  ): Promise<void> {
    if (!this._conn) return;
    const ids = this._getSelectedLinkIds(root);
    if (ids.length === 0) return;

    if (action === "delete") {
      if (!confirm(`Supprimer ${ids.length} lien(s) sélectionné(s) ? Cette action est irréversible.`)) return;
    }

    const actions: AlignBatchAction[] = ids.map(id =>
      action === "delete" ? { action: "delete", link_id: id } : { action: "set_status", link_id: id, status }
    );

    try {
      const res = await batchUpdateAlignLinks(this._conn, actions);
      if (action === "delete") {
        this._auditLinks = this._auditLinks.filter(l => !ids.includes(l.link_id));
        if (this._auditSelectedLinkId !== null && ids.includes(this._auditSelectedLinkId)) {
          this._auditSelectedLinkId = null;
        }
        this._log(`✓ ${res.deleted} lien(s) supprimé(s) en lot.`);
        this._showToast?.(`✓ ${res.deleted} lien(s) supprimé(s)`);
      } else {
        for (const l of this._auditLinks) {
          if (ids.includes(l.link_id)) l.status = status;
        }
        const label = status === "accepted" ? "accepté(s)" : status === "rejected" ? "rejeté(s)" : "réinitialisé(s)";
        this._log(`✓ ${res.applied} lien(s) ${label} en lot.${res.errors.length > 0 ? ` (${res.errors.length} erreur(s))` : ""}`);
        this._showToast?.(`✓ ${res.applied} lien(s) ${label}`);
      }
      this._renderAuditTable(root);
    } catch (err) {
      this._log(`✗ Opération lot : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Erreur opération lot", true);
    }
  }

  // ─── V1.4 — Retarget modal ─────────────────────────────────────────────────

  private async _openRetargetModal(linkId: number, pivotUnitId: number, root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    const link = this._auditLinks.find(l => l.link_id === linkId);
    if (!link) return;

    // Determine target_doc_id from stored audit context
    const targetDocId = this._auditTargetId;
    if (!targetDocId) return;

    // Fetch candidates
    let candidates: RetargetCandidate[] = [];
    try {
      const res = await retargetCandidates(this._conn, { pivot_unit_id: pivotUnitId, target_doc_id: targetDocId, limit: 10 });
      candidates = res.candidates;
    } catch (err) {
      this._log(`✗ Candidats retarget : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      return;
    }

    // Build modal
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";

    const modal = document.createElement("div");
    modal.style.cssText = "background:#fff;border-radius:8px;padding:1.2rem 1.4rem;min-width:340px;max-width:520px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.18)";
    modal.innerHTML = `<h3 style="margin:0 0 .7rem">Recibler le lien #${linkId}</h3>
      <p style="font-size:.83rem;color:#666;margin:0 0 .7rem">Pivot : <em>${_escHtml(String(link.pivot_text ?? ""))}</em></p>
      <p style="font-size:.83rem;color:#666;margin:0 0 .8rem">Actuel : <em>${_escHtml(String(link.target_text ?? ""))}</em></p>
      <div id="retarget-cands"></div>
      <div style="display:flex;gap:.5rem;margin-top:1rem;justify-content:flex-end">
        <button class="btn btn-secondary" id="retarget-cancel-btn">Annuler</button>
        <button class="btn btn-primary" id="retarget-apply-btn">Appliquer</button>
      </div>`;

    const candsDiv = modal.querySelector<HTMLElement>("#retarget-cands")!;
    if (candidates.length === 0) {
      candsDiv.innerHTML = `<p style="color:#888;font-size:.85rem">Aucun candidat trouvé.</p>`;
    } else {
      for (const c of candidates) {
        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:flex-start;gap:.4rem;padding:.3rem .25rem;border-bottom:1px solid #eee;cursor:pointer;font-size:.88rem";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "retarget-cand";
        radio.value = String(c.target_unit_id);
        radio.style.marginTop = "2px";
        label.appendChild(radio);
        label.appendChild(document.createTextNode(
          `[${c.external_id ?? "—"}] ${c.target_text} — score ${c.score.toFixed(2)} (${c.reason})`
        ));
        candsDiv.appendChild(label);
      }
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => document.body.removeChild(overlay);

    modal.querySelector("#retarget-cancel-btn")!.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    modal.querySelector("#retarget-apply-btn")!.addEventListener("click", async () => {
      const chosen = modal.querySelector<HTMLInputElement>("input[name='retarget-cand']:checked");
      if (!chosen) { alert("Sélectionnez un candidat."); return; }
      const newTargetUnitId = Number(chosen.value);
      try {
        await retargetAlignLink(this._conn!, { link_id: linkId, new_target_unit_id: newTargetUnitId });
        // Update in-memory
        const cand = candidates.find(c => c.target_unit_id === newTargetUnitId);
        if (link && cand) link.target_text = cand.target_text;
        this._renderAuditTable(root);
        this._log(`✓ Lien #${linkId} reciblé → unité ${newTargetUnitId}.`);
        this._showToast?.(`✓ Lien #${linkId} reciblé`);
        close();
      } catch (err) {
        this._log(`✗ Retarget : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      }
    });
  }

  // ─── Align quality metrics ─────────────────────────────────────────────────

  private async _runAlignQuality(root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    const pivotSel = root.querySelector<HTMLSelectElement>("#act-quality-pivot");
    const targetSel = root.querySelector<HTMLSelectElement>("#act-quality-target");
    const pivot = pivotSel?.value ? parseInt(pivotSel.value) : null;
    const target = targetSel?.value ? parseInt(targetSel.value) : null;
    if (!pivot || !target) {
      this._log("Qualité : sélectionnez un doc pivot et un doc cible.", true);
      return;
    }
    const btn = root.querySelector<HTMLButtonElement>("#act-quality-btn")!;
    btn.disabled = true;
    btn.textContent = "Calcul…";
    this._log(`Calcul métriques qualité pivot #${pivot} ↔ cible #${target}…`);
    try {
      const res: AlignQualityResponse = await alignQuality(this._conn, pivot, target);
      const s = res.stats;
      const resultEl = root.querySelector<HTMLElement>("#act-quality-result")!;
      resultEl.style.display = "";
      resultEl.innerHTML = `
        <div class="quality-stats-grid">
          <div class="quality-stat">
            <span class="quality-label">Couverture pivot</span>
            <span class="quality-value ${s.coverage_pct >= 90 ? "ok" : s.coverage_pct >= 60 ? "warn" : "err"}">
              ${s.coverage_pct}% (${s.covered_pivot_units}/${s.total_pivot_units})
            </span>
          </div>
          <div class="quality-stat">
            <span class="quality-label">Liens total</span>
            <span class="quality-value">${s.total_links}</span>
          </div>
          <div class="quality-stat">
            <span class="quality-label">Orphelins pivot</span>
            <span class="quality-value ${s.orphan_pivot_count === 0 ? "ok" : "warn"}">${s.orphan_pivot_count}</span>
          </div>
          <div class="quality-stat">
            <span class="quality-label">Orphelins cible</span>
            <span class="quality-value ${s.orphan_target_count === 0 ? "ok" : "warn"}">${s.orphan_target_count}</span>
          </div>
          <div class="quality-stat">
            <span class="quality-label">Collisions</span>
            <span class="quality-value ${s.collision_count === 0 ? "ok" : "err"}">${s.collision_count}</span>
          </div>
          <div class="quality-stat">
            <span class="quality-label">Statuts</span>
            <span class="quality-value">
              ✓${s.status_counts.accepted} ✗${s.status_counts.rejected} ?${s.status_counts.unreviewed}
            </span>
          </div>
        </div>
        ${res.sample_orphan_pivot.length > 0 ? `
        <details style="margin-top:0.5rem">
          <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-muted)">
            Exemples orphelins pivot (${res.sample_orphan_pivot.length})
          </summary>
          <div style="font-size:0.82rem; margin-top:0.3rem">
            ${res.sample_orphan_pivot.map(o =>
              `<div>[§${o.external_id ?? "?"}] ${o.text ?? ""}</div>`
            ).join("")}
          </div>
        </details>` : ""}
        ${res.sample_orphan_target.length > 0 ? `
        <details style="margin-top:0.4rem">
          <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-muted)">
            Exemples orphelins cible (${res.sample_orphan_target.length})
          </summary>
          <div style="font-size:0.82rem; margin-top:0.3rem">
            ${res.sample_orphan_target.map(o =>
              `<div>[§${o.external_id ?? "?"}] ${o.text ?? ""}</div>`
            ).join("")}
          </div>
        </details>` : ""}
      `;
      // Update KPIs from quality result
      const updKpi = (id: string, value: string, cls?: string) => {
        const el = document.querySelector(`#${id}`);
        if (el) { el.textContent = value; if (cls) el.className = `align-kpi-value ${cls}`; }
      };
      updKpi("act-kpi-coverage", `${s.coverage_pct}%`, s.coverage_pct >= 90 ? "ok" : s.coverage_pct >= 60 ? "warn" : "bad");
      updKpi("act-kpi-orphan-p", String(s.orphan_pivot_count), s.orphan_pivot_count === 0 ? "ok" : "warn");
      updKpi("act-kpi-orphan-t", String(s.orphan_target_count ?? 0), (s.orphan_target_count ?? 0) === 0 ? "ok" : "warn");
      this._log(`Qualité : couverture ${s.coverage_pct}%, orphelins=${s.orphan_pivot_count}p/${s.orphan_target_count}c, collisions=${s.collision_count}`);
    } catch (err) {
      this._log(`Erreur qualité : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Calculer métriques";
    }
  }

  // ─── Collision resolver (V1.5) ────────────────────────────────────────────

  private async _loadCollisionsPage(root: HTMLElement, append: boolean): Promise<void> {
    if (!this._conn) return;
    const pivotSel = root.querySelector<HTMLSelectElement>("#act-coll-pivot");
    const targetSel = root.querySelector<HTMLSelectElement>("#act-coll-target");
    const pivotId = parseInt(pivotSel?.value ?? "");
    const targetId = parseInt(targetSel?.value ?? "");
    if (!pivotId || !targetId) {
      this._showToast?.("Sélectionnez un pivot et une cible.", true);
      return;
    }
    if (!append) {
      this._collOffset = 0;
      this._collGroups = [];
    }
    try {
      const res = await listCollisions(this._conn, {
        pivot_doc_id: pivotId,
        target_doc_id: targetId,
        limit: this._collLimit,
        offset: this._collOffset,
      });
      this._collTotalCount = res.total_collisions;
      this._collGroups = append ? [...this._collGroups, ...res.collisions] : res.collisions;
      this._collHasMore = res.has_more;
      this._collOffset = res.next_offset;
      this._renderCollisionTable(root, targetId);
      this._log(`Collisions : ${this._collTotalCount} groupe(s) trouvé(s).`);
    } catch (err) {
      this._log(`Erreur collisions : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Erreur chargement collisions", true);
    }
  }

  private _renderCollisionTable(root: HTMLElement, targetDocId: number): void {
    const resultEl = root.querySelector<HTMLElement>("#act-coll-result");
    const moreWrap = root.querySelector<HTMLElement>("#act-coll-more-wrap");
    if (!resultEl) return;
    resultEl.style.display = "";

    if (this._collGroups.length === 0) {
      resultEl.innerHTML = `<p class="hint">✓ Aucune collision détectée.</p>`;
      if (moreWrap) moreWrap.style.display = "none";
      return;
    }

    const header = `<p style="margin-bottom:0.5rem;font-size:0.88rem;color:var(--text-muted)">
      ${this._collTotalCount} groupe(s) de collision — ${this._collGroups.length} affiché(s)</p>`;

    const groupHtml = this._collGroups.map((g) => {
      const linksHtml = g.links.map((lnk) => {
        const badge = lnk.status === "accepted"
          ? `<span class="status-badge status-ok">✅ Accepté</span>`
          : lnk.status === "rejected"
          ? `<span class="status-badge status-error">❌ Rejeté</span>`
          : `<span class="status-badge status-unknown">🔵 Non révisé</span>`;
        return `<tr>
          <td class="audit-cell-text">${lnk.target_text}</td>
          <td>[§${lnk.target_external_id ?? "?"}]</td>
          <td>${badge}</td>
          <td class="audit-cell-actions">
            <button class="btn btn-sm btn-primary coll-keep-btn" data-link="${lnk.link_id}" data-group="${g.pivot_unit_id}" title="Garder — marquer accepté">✓ Garder</button>
            <button class="btn btn-sm btn-secondary coll-reject-btn" data-link="${lnk.link_id}" title="Rejeter">❌ Rejeter</button>
            <button class="btn btn-sm btn-danger coll-delete-btn" data-link="${lnk.link_id}" data-group="${g.pivot_unit_id}" data-target="${targetDocId}" title="Supprimer ce lien" aria-label="Supprimer ce lien">🗑</button>
          </td>
        </tr>`;
      }).join("");

      return `<div class="collision-group" style="margin-bottom:1rem; border:1px solid var(--border); border-radius:6px; overflow:hidden">
        <div class="collision-pivot-header" style="background:var(--surface-alt,#f5f5f5); padding:0.4rem 0.75rem; font-size:0.85rem; font-weight:600">
          [§${g.pivot_external_id ?? "?"}] ${g.pivot_text}
          <button class="btn btn-sm btn-danger coll-delete-others-btn" data-group="${g.pivot_unit_id}" data-target="${targetDocId}"
            style="float:right; font-size:0.75rem" title="Supprimer tous les liens de ce groupe" aria-label="Supprimer tous les liens de ce groupe">🗑 Tout supprimer</button>
        </div>
        <table class="meta-table" style="margin:0; width:100%">
          <thead><tr><th>Texte cible</th><th>Ext. id</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${linksHtml}</tbody>
        </table>
      </div>`;
    }).join("");

    resultEl.innerHTML = header + groupHtml;
    if (moreWrap) moreWrap.style.display = this._collHasMore ? "" : "none";

    // Wire per-link actions
    const self = this;
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-keep-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const linkId = parseInt(btn.dataset.link!);
        await self._resolveCollision([{ action: "keep", link_id: linkId }], root, parseInt(btn.dataset.group!), targetDocId);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-reject-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const linkId = parseInt(btn.dataset.link!);
        await self._resolveCollision([{ action: "reject", link_id: linkId }], root, null, targetDocId);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-delete-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const linkId = parseInt(btn.dataset.link!);
        const pivotUid = parseInt(btn.dataset.group!);
        await self._resolveCollision([{ action: "delete", link_id: linkId }], root, pivotUid, targetDocId);
      });
    });
    resultEl.querySelectorAll<HTMLButtonElement>(".coll-delete-others-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const pivotUid = parseInt(btn.dataset.group!);
        const targetDoc = parseInt(btn.dataset.target!);
        const group = self._collGroups.find(g => g.pivot_unit_id === pivotUid);
        if (!group) return;
        const actions = group.links.map(lnk => ({ action: "delete" as const, link_id: lnk.link_id }));
        await self._resolveCollision(actions, root, pivotUid, targetDoc);
      });
    });
  }

  private async _resolveCollision(
    actions: Array<{ action: "keep" | "delete" | "reject" | "unreviewed"; link_id: number }>,
    root: HTMLElement,
    pivotUnitId: number | null,
    targetDocId: number,
  ): Promise<void> {
    if (!this._conn) return;
    try {
      const res = await resolveCollisions(this._conn, actions);
      if (res.errors.length > 0) {
        this._showToast?.(`⚠ ${res.errors.length} erreur(s)`, true);
      } else {
        this._showToast?.(`✓ Résolution appliquée (${res.applied} modif., ${res.deleted} suppr.)`);
      }
      // Reload collision list to reflect changes
      this._collOffset = 0;
      this._collGroups = [];
      await this._loadCollisionsPage(root, false);
    } catch (err) {
      this._log(`Erreur résolution collision : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Erreur résolution collision", true);
    }
  }

  // ─── Workflow ─────────────────────────────────────────────────────────────

  private _initWorkflow(root: HTMLElement): void {
    // Restore persisted step
    const savedStep = parseInt(localStorage.getItem(ActionsScreen.LS_WF_STEP) ?? "0", 10);
    this._wfStep = isNaN(savedStep) ? 0 : Math.min(savedStep, 4);

    // Wire step headers (accordion toggle)
    for (let i = 0; i < 5; i++) {
      const hdr = root.querySelector(`#wf-hdr-${i}`) as HTMLElement | null;
      if (!hdr) continue;
      const idx = i;
      hdr.addEventListener("click", () => this._wfToggleStep(idx));
      hdr.addEventListener("mouseenter", () => { hdr.style.background = "#edf2f7"; });
      hdr.addEventListener("mouseleave", () => {
        hdr.style.background = this._wfStep === idx ? "#d1fae5" : "#f8f9fa";
      });
    }

    // Wire CTA buttons
    root.querySelector("#wf-goto-align")?.addEventListener("click", () => {
      root.querySelector("#act-align-btn")?.scrollIntoView({ behavior: "smooth" });
    });
    root.querySelector("#wf-quality-btn")?.addEventListener("click", () => void this._runWfQuality(root));
    root.querySelector("#wf-coll-btn")?.addEventListener("click", () => {
      const btn = root.querySelector<HTMLButtonElement>("#act-coll-load-btn");
      btn?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => btn?.click(), 400);
    });
    root.querySelector("#wf-audit-btn")?.addEventListener("click", () => {
      const btn = root.querySelector<HTMLButtonElement>("#act-audit-load-btn");
      btn?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => btn?.click(), 400);
    });
    root.querySelector("#wf-report-btn")?.addEventListener("click", () => {
      root.querySelector("#act-report-btn")?.scrollIntoView({ behavior: "smooth" });
    });

    // Open current step + sync run_id display
    this._wfToggleStep(this._wfStep);
    this._wfSyncRunId();
  }

  private _wfToggleStep(idx: number): void {
    const root = this._wfRoot;
    if (!root) return;
    for (let i = 0; i < 5; i++) {
      const body = root.querySelector<HTMLElement>(`#wf-body-${i}`);
      const hdr = root.querySelector<HTMLElement>(`#wf-hdr-${i}`);
      const tog = root.querySelector<HTMLElement>(`#wf-tog-${i}`);
      if (!body || !hdr || !tog) continue;
      const isActive = i === idx;
      body.style.display = isActive ? "" : "none";
      hdr.style.background = isActive ? "#d1fae5" : "#f8f9fa";
      tog.textContent = isActive ? "▲" : "▼";
      // Active step number: green
      const num = root.querySelector<HTMLElement>(`#wf-num-${i}`);
      if (num) {
        num.style.background = isActive ? "var(--accent,#1a7f4e)" : "#e9ecef";
        num.style.color = isActive ? "#fff" : "#495057";
      }
    }
    this._wfStep = idx;
    try { localStorage.setItem(ActionsScreen.LS_WF_STEP, String(idx)); } catch { /* ignore */ }
    this._wfSyncCompactProgress(root);
  }

  private _wfSyncRunId(): void {
    const root = this._wfRoot;
    if (!root) return;
    const display = root.querySelector<HTMLElement>("#wf-run-id-display");
    if (display) {
      display.textContent = this._alignRunId ?? "(aucun)";
    }
    // Also mark step 1 as done if run_id known
    const st0 = root.querySelector<HTMLElement>("#wf-st-0");
    if (st0) st0.textContent = this._alignRunId ? "✓ run " + this._alignRunId.slice(0, 8) + "…" : "";
    // Sync run_id in report section
    const reportInput = root.querySelector<HTMLInputElement>("#act-report-run-id");
    if (reportInput && this._alignRunId) reportInput.value = this._alignRunId;
    this._wfSyncCompactProgress(root);
  }

  private _wfSyncCompactProgress(root: HTMLElement): void {
    for (let i = 0; i < 5; i++) {
      const step = root.querySelector<HTMLElement>(`#wf-step-${i}`);
      if (!step) continue;
      step.style.opacity = i < this._wfStep ? "0.88" : "1";
    }
  }

  private _wfEnableButtons(on: boolean): void {
    const root = this._wfRoot;
    if (!root) return;
    ["wf-quality-btn", "wf-coll-btn", "wf-audit-btn", "wf-report-btn"].forEach(id => {
      const btn = root.querySelector<HTMLButtonElement>(`#${id}`);
      if (btn) btn.disabled = !on;
    });
  }

  private async _runWfQuality(root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    // Use the first available pivot/target from docs
    const pivotSel = root.querySelector<HTMLSelectElement>("#act-quality-pivot");
    const targetSel = root.querySelector<HTMLSelectElement>("#act-quality-target");
    if (!pivotSel?.value || !targetSel?.value) {
      const wfResult = root.querySelector<HTMLElement>("#wf-quality-result");
      if (wfResult) {
        wfResult.innerHTML = `<span style="font-size:0.82rem;color:#856404">⚠ Sélectionnez d'abord un doc pivot et cible dans la section Qualité ci-dessous.</span>`;
      }
      root.querySelector("#act-quality-btn")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    const btn = root.querySelector<HTMLButtonElement>("#wf-quality-btn")!;
    btn.disabled = true;
    btn.textContent = "Calcul…";

    const pivot = parseInt(pivotSel.value);
    const target = parseInt(targetSel.value);

    try {
      const { alignQuality } = await import("../lib/sidecarClient.ts");
      const res = await alignQuality(this._conn, pivot, target);
      const s = res.stats;
      const wfResult = root.querySelector<HTMLElement>("#wf-quality-result");
      if (wfResult) {
        const okClass = (v: number, good: number) => v >= good ? "color:#1a7f4e;font-weight:600" : "color:#c0392b;font-weight:600";
        wfResult.innerHTML = `
          <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.82rem;margin-bottom:6px">
            <span>Couverture : <b style="${okClass(s.coverage_pct, 80)}">${s.coverage_pct}%</b></span>
            <span>Liens : <b>${s.total_links}</b></span>
            <span>Orphelins pivot : <b style="${okClass(s.orphan_pivot_count === 0 ? 1 : 0, 1)}">${s.orphan_pivot_count}</b></span>
            <span>Collisions : <b style="${okClass(s.collision_count === 0 ? 1 : 0, 1)}">${s.collision_count}</b></span>
          </div>`;
      }
      // Mark step 2 as done
      const st1 = root.querySelector<HTMLElement>("#wf-st-1");
      if (st1) st1.textContent = `✓ cov. ${s.coverage_pct}%`;
      this._log(`✓ Qualité: couv. ${s.coverage_pct}%, collisions ${s.collision_count}`);
    } catch (err) {
      this._log(`✗ Qualité workflow: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Lancer la vérification qualité";
    }
  }

  // ─── Run report export ────────────────────────────────────────────────────

  private async _runExportReport(): Promise<void> {
    if (!this._conn) return;
    const fmt = (document.querySelector<HTMLSelectElement>("#act-report-fmt"))?.value as "html" | "jsonl" || "html";
    const runIdRaw = (document.querySelector<HTMLInputElement>("#act-report-run-id"))?.value.trim();
    const ext = fmt === "html" ? "html" : "jsonl";
    const defaultName = runIdRaw ? `run_${runIdRaw.slice(0, 8)}.${ext}` : `runs_report.${ext}`;

    let outPath: string | null;
    try {
      outPath = await dialogSave({
        title: "Enregistrer le rapport de runs",
        defaultPath: defaultName,
        filters: [{ name: fmt.toUpperCase(), extensions: [ext] }],
      });
    } catch {
      return;
    }
    if (!outPath) return;

    const resultEl = document.querySelector<HTMLElement>("#act-report-result");
    const btn = document.querySelector<HTMLButtonElement>("#act-report-btn")!;
    btn.disabled = true;
    btn.textContent = "Export en cours\u2026";

    try {
      const opts: ExportRunReportOptions = { out_path: outPath, format: fmt };
      if (runIdRaw) opts.run_id = runIdRaw;
      const res = await exportRunReport(this._conn, opts);

      if (resultEl) {
        resultEl.style.display = "";
        resultEl.innerHTML =
          `<span class="stat-ok">✓ ${res.runs_exported} run(s) export\u00e9(s) \u2192 ` +
          `<code>${_escHtml(res.out_path)}</code></span>`;
      }
      this._log(`✓ Rapport export\u00e9 : ${res.runs_exported} run(s) \u2192 ${res.out_path}`);
      this._showToast?.(`✓ Rapport export\u00e9 (${res.runs_exported} run(s))`);
    } catch (err) {
      this._log(`✗ Export rapport : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Erreur export rapport", true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Enregistrer le rapport\u2026";
    }
  }

  // ─── Validate meta + index ────────────────────────────────────────────────

  private async _runValidateMeta(): Promise<void> {
    if (!this._conn) return;
    const docSel = (document.querySelector("#act-meta-doc") as HTMLSelectElement)?.value;
    const docId = docSel ? parseInt(docSel) : undefined;
    const label = docId !== undefined ? `doc #${docId}` : "tous les documents";
    this._log(`Validation métadonnées de ${label} (job asynchrone)…`);
    const params: Record<string, unknown> = {};
    if (docId !== undefined) params.doc_id = docId;
    try {
      const job = await enqueueJob(this._conn, "validate-meta", params);
      this._jobCenter?.trackJob(job.job_id, `Validation méta ${label}`, (done) => {
        if (done.status === "done") {
          const results = (done.result as { results?: Array<{ doc_id: number; is_valid: boolean; warnings: string[] }> } | undefined)?.results ?? [];
          const invalid = results.filter(r => !r.is_valid);
          if (invalid.length === 0) {
            this._log(`✓ Métadonnées valides (${results.length} doc(s)).`);
            this._showToast?.("✓ Métadonnées valides");
          } else {
            for (const r of invalid) {
              this._log(`⚠ doc #${r.doc_id}: ${r.warnings.join(", ")}`, true);
            }
            this._showToast?.(`⚠ ${invalid.length} doc(s) invalide(s)`, true);
          }
        } else {
          this._log(`✗ Validation : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur validation méta", true);
        }
      });
    } catch (err) {
      this._log(`✗ Validation : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private async _runIndex(): Promise<void> {
    if (!this._conn) return;
    this._setBusy(true);
    this._log("Reconstruction de l'index FTS (job asynchrone)…");
    try {
      const job = await enqueueJob(this._conn, "index", {});
      this._log(`Job index soumis (${job.job_id.slice(0, 8)}…)`);
      this._jobCenter?.trackJob(job.job_id, "Rebuild index FTS", (done) => {
        if (done.status === "done") {
          const n = (done.result as { units_indexed?: number } | undefined)?.units_indexed ?? "?";
          this._log(`✓ Index reconstruit — ${n} unités indexées.`);
          const reindexBtn = document.querySelector("#act-reindex-after-curate-btn") as HTMLElement | null;
          if (reindexBtn) reindexBtn.style.display = "none";
          this._showToast?.(`✓ Index reconstruit (${n} unités)`);
        } else {
          const errMsg = done.error ?? done.status;
          this._log(`✗ Index : ${errMsg}`, true);
          const short = typeof errMsg === "string" && errMsg.length > 60 ? errMsg.slice(0, 57) + "…" : errMsg;
          this._showToast?.(`✗ Erreur index FTS${short ? `: ${short}` : ""}`, true);
        }
        this._setBusy(false);
      });
    } catch (err) {
      this._log(`✗ Index : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._setBusy(false);
    }
  }

  // ─── V0.4C — Audit link actions ──────────────────────────────────────────────

  private async _setLinkStatus(
    linkId: number,
    status: "accepted" | "rejected" | null,
    root: HTMLElement,
  ): Promise<void> {
    if (!this._conn) return;
    try {
      if (status === null) {
        await batchUpdateAlignLinks(this._conn, [{ action: "set_status", link_id: linkId, status: null }]);
      } else {
        await updateAlignLinkStatus(this._conn, { link_id: linkId, status });
      }
      // Update in-memory link status
      const link = this._auditLinks.find(l => l.link_id === linkId);
      if (link) link.status = status;
      this._renderAuditTable(root);
      const statusLabel = status === null ? "non révisé" : status;
      this._log(`✓ Lien #${linkId} marqué "${statusLabel}".`);
    } catch (err) {
      this._log(`✗ Mise à jour statut : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private async _deleteLinkFromAudit(linkId: number, root: HTMLElement): Promise<void> {
    if (!this._conn) return;
    if (!confirm(`Supprimer le lien d'alignement #${linkId} ? Cette action est irréversible.`)) return;
    try {
      await deleteAlignLink(this._conn, { link_id: linkId });
      this._auditLinks = this._auditLinks.filter(l => l.link_id !== linkId);
      if (this._auditSelectedLinkId === linkId) this._auditSelectedLinkId = null;
      this._renderAuditTable(root);
      this._log(`✓ Lien #${linkId} supprimé.`);
    } catch (err) {
      this._log(`✗ Suppression : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  // ─── Annotation panel ─────────────────────────────────────────────────────

  private _annotDocs: Array<{
    doc_id: number; title: string; language: string | null;
    annotation_status?: string; token_count?: number;
  }> = [];
  private _annotSelectedDocId: number | null = null;
  private _annotTokens: _AnnotToken[] = [];
  private _annotSelectedTokenId: number | null = null;
  private _annotJobPoll: ReturnType<typeof setInterval> | null = null;
  private _annotJobId: string | null = null;
  private _annotPanelEl: HTMLElement | null = null;
  private _annotModelOverride: string = "";

  private _renderAnnoterPanel(_root: HTMLElement): HTMLElement {
    // Stop any in-flight poll from a previous panel instance.
    this._annotStopPoll();

    const panel = document.createElement("div");
    panel.className = "annot-panel";
    this._annotPanelEl = panel;

    const style = document.createElement("style");
    style.textContent = ANNOT_PANEL_CSS;
    panel.appendChild(style);

    // ── Toolbar ──────────────────────────────────────────────────────────────
    const toolbar = document.createElement("div");
    toolbar.className = "annot-toolbar";

    const title = document.createElement("h3");
    title.className = "annot-title";
    title.textContent = "Annotation interlinéaire";

    const modelLabel = document.createElement("label");
    modelLabel.className = "annot-model-label";
    modelLabel.textContent = "Modèle ";
    const modelSelect = document.createElement("select");
    modelSelect.className = "annot-model-select";
    const SPACY_MODELS = [
      ["(auto)", ""],
      ["fr — fr_core_news_md", "fr_core_news_md"],
      ["en — en_core_web_md", "en_core_web_md"],
      ["de — de_core_news_md", "de_core_news_md"],
      ["es — es_core_news_md", "es_core_news_md"],
      ["it — it_core_news_md", "it_core_news_md"],
      ["sv — sv_core_news_sm", "sv_core_news_sm"],
      ["ro — ro_core_news_md", "ro_core_news_md"],
      ["el — el_core_news_sm", "el_core_news_sm"],
      ["multi — xx_ent_wiki_sm", "xx_ent_wiki_sm"],
    ];
    for (const [label, value] of SPACY_MODELS) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      opt.selected = value === this._annotModelOverride;
      modelSelect.appendChild(opt);
    }
    modelSelect.addEventListener("change", () => {
      this._annotModelOverride = modelSelect.value;
    });
    modelLabel.appendChild(modelSelect);

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "annot-btn-refresh";
    refreshBtn.title = "Rafraîchir la liste des documents";
    refreshBtn.textContent = "↻";
    refreshBtn.addEventListener("click", () => {
      const sidebar = panel.querySelector<HTMLElement>(".annot-sidebar");
      const viewer  = panel.querySelector<HTMLElement>(".annot-viewer");
      const editor  = panel.querySelector<HTMLElement>(".annot-editor");
      if (sidebar && viewer && editor) this._annotLoadDocs(sidebar, viewer, editor);
    });

    const runBtn = document.createElement("button");
    runBtn.className = "annot-btn-run";
    runBtn.title = "Lancer l'annotation spaCy sur le document sélectionné";
    runBtn.textContent = "Annoter ▶";
    runBtn.addEventListener("click", () => { this._annotRunJob(panel); });

    const statusSpan = document.createElement("span");
    statusSpan.className = "annot-status";

    toolbar.appendChild(title);
    toolbar.appendChild(modelLabel);
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(runBtn);
    toolbar.appendChild(statusSpan);
    panel.appendChild(toolbar);

    // ── Layout: sidebar + viewer + editor ────────────────────────────────────
    const layout = document.createElement("div");
    layout.className = "annot-layout";

    const sidebar = document.createElement("div");
    sidebar.className = "annot-sidebar";
    sidebar.innerHTML = `<p class="annot-sidebar-loading">Chargement…</p>`;

    const viewer = document.createElement("div");
    viewer.className = "annot-viewer";
    viewer.innerHTML = `<p class="annot-placeholder">Sélectionnez un document dans la liste.</p>`;

    const editor = document.createElement("div");
    editor.className = "annot-editor";
    editor.innerHTML = `<p class="annot-placeholder">Cliquez sur un token.</p>`;

    layout.appendChild(sidebar);
    layout.appendChild(viewer);
    layout.appendChild(editor);
    panel.appendChild(layout);

    // Defer load: _conn may not be set yet at render() time.
    // setConn() will call _annotRefreshIfVisible() once connection is ready.
    if (this._conn) {
      this._annotLoadDocs(sidebar, viewer, editor);
    } else {
      sidebar.innerHTML = `<p class="annot-sidebar-loading">En attente de connexion…</p>`;
    }

    return panel;
  }

  private async _annotLoadDocs(
    sidebar: HTMLElement,
    viewer: HTMLElement,
    editor: HTMLElement,
  ): Promise<void> {
    if (!this._conn) { sidebar.innerHTML = `<p class="annot-error">Non connecté.</p>`; return; }
    try {
      const res = await this._conn.get("/documents") as {
        documents?: Array<{
          doc_id: number; title?: string; language?: string;
          annotation_status?: string; token_count?: number;
        }>
      };
      const docs = res.documents ?? [];
      this._annotDocs = docs.map(d => ({
        doc_id: d.doc_id,
        title: d.title ?? `#${d.doc_id}`,
        language: d.language ?? null,
        annotation_status: d.annotation_status,
        token_count: d.token_count,
      }));
      this._annotRenderDocList(sidebar, viewer, editor);
    } catch (err) {
      sidebar.innerHTML = `<p class="annot-error">Erreur : ${_escHtml(String(err))}</p>`;
    }
  }

  private _annotRenderDocList(
    sidebar: HTMLElement,
    viewer: HTMLElement,
    editor: HTMLElement,
  ): void {
    sidebar.innerHTML = "";
    if (this._annotDocs.length === 0) {
      sidebar.innerHTML = `<p class="annot-placeholder">Aucun document.</p>`;
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "annot-doc-list";
    for (const doc of this._annotDocs) {
      const li = document.createElement("li");
      li.className = "annot-doc-item" + (doc.doc_id === this._annotSelectedDocId ? " selected" : "");
      li.dataset.docId = String(doc.doc_id);

      const nameSpan = document.createElement("span");
      nameSpan.className = "annot-doc-name";
      nameSpan.textContent = doc.title;

      const badge = document.createElement("span");
      const isAnnotated = doc.annotation_status === "annotated";
      badge.className = "annot-doc-badge" + (isAnnotated ? " annotated" : "");
      badge.title = isAnnotated ? `${doc.token_count ?? 0} tokens` : "Non annoté";
      badge.textContent = isAnnotated ? "✓" : "·";

      li.appendChild(nameSpan);
      li.appendChild(badge);

      li.addEventListener("click", () => {
        this._annotSelectedDocId = doc.doc_id;
        this._annotSelectedTokenId = null;
        ul.querySelectorAll(".annot-doc-item").forEach(el => el.classList.remove("selected"));
        li.classList.add("selected");
        this._annotSelectDoc(doc.doc_id, viewer, editor);
      });
      ul.appendChild(li);
    }
    sidebar.appendChild(ul);
  }

  private async _annotSelectDoc(
    docId: number,
    viewer: HTMLElement,
    editor: HTMLElement,
  ): Promise<void> {
    viewer.innerHTML = `<p class="annot-placeholder">Chargement des tokens…</p>`;
    editor.innerHTML = `<p class="annot-placeholder">Cliquez sur un token.</p>`;
    this._annotTokens = [];
    if (!this._conn) return;
    try {
      const res = await this._conn.get(`/tokens?doc_id=${docId}`) as { tokens?: _AnnotToken[] };
      const rows = res.tokens ?? [];
      this._annotTokens = rows;
      this._annotRenderInterlinear(viewer, editor);
    } catch {
      viewer.innerHTML = `<p class="annot-placeholder">Aucun token — lancez l'annotation spaCy d'abord.</p>`;
    }
  }

  private _annotRenderInterlinear(viewer: HTMLElement, editor: HTMLElement): void {
    viewer.innerHTML = "";
    if (this._annotTokens.length === 0) {
      viewer.innerHTML = `<p class="annot-placeholder">Aucun token — lancez l'annotation spaCy d'abord.</p>`;
      return;
    }

    // Group by unit_n then sent_id
    const byUnit = new Map<number, Map<number, _AnnotToken[]>>();
    for (const tok of this._annotTokens) {
      if (!byUnit.has(tok.unit_n)) byUnit.set(tok.unit_n, new Map());
      const bySent = byUnit.get(tok.unit_n)!;
      if (!bySent.has(tok.sent_id)) bySent.set(tok.sent_id, []);
      bySent.get(tok.sent_id)!.push(tok);
    }

    const UPOS_COLORS: Record<string, string> = {
      NOUN: "#4e9af1", VERB: "#e07b39", ADJ: "#8e6bbf",
      ADV: "#3aab6d", PRON: "#c9a227", DET: "#5bb8c4",
      ADP: "#b0b0b0", CCONJ: "#b0b0b0", SCONJ: "#b0b0b0",
      PUNCT: "#cccccc", NUM: "#c94040", PROPN: "#2e7dbf",
      AUX: "#d97ab8", PART: "#b0b0b0", INTJ: "#e04444",
      SYM: "#999", X: "#bbb",
    };

    // Reconstruct a readable plain-text string from tokens (handle PUNCT spacing)
    const PUNCT_NO_SPACE_BEFORE = new Set([".", ",", ":", ";", "!", "?", ")", "]", "}", "»", "'", "'"]);
    const PUNCT_NO_SPACE_AFTER  = new Set(["(", "[", "{", "«", "'", "'"]);
    function _tokensToPlain(tokens: _AnnotToken[]): string {
      let out = "";
      for (let i = 0; i < tokens.length; i++) {
        const word = tokens[i].word;
        const isPunct = tokens[i].upos === "PUNCT";
        const needsSpaceBefore = i > 0
          && !PUNCT_NO_SPACE_BEFORE.has(word)
          && !PUNCT_NO_SPACE_AFTER.has(tokens[i - 1].word)
          && !(isPunct && PUNCT_NO_SPACE_BEFORE.has(word));
        out += (needsSpaceBefore ? " " : "") + word;
      }
      return out;
    }

    let globalSentIdx = 0;

    for (const [unitN, bySent] of Array.from(byUnit.entries()).sort((a, b) => a[0] - b[0])) {
      const unitDiv = document.createElement("div");
      unitDiv.className = "annot-unit";

      // ── Unit header: line number + reconstructed plain text ──────────────
      const allUnitTokens = Array.from(bySent.values()).flat();
      const plainText = _tokensToPlain(allUnitTokens);

      const unitHeader = document.createElement("div");
      unitHeader.className = "annot-unit-header";
      unitHeader.innerHTML =
        `<span class="annot-unit-n">§${unitN}</span>` +
        `<span class="annot-unit-plain">${_escHtml(plainText)}</span>`;
      unitDiv.appendChild(unitHeader);

      // ── Sentences ─────────────────────────────────────────────────────────
      const sentEntries = Array.from(bySent.entries()).sort((a, b) => a[0] - b[0]);
      for (const [sentId, tokens] of sentEntries) {
        globalSentIdx++;

        const sentWrapper = document.createElement("div");
        sentWrapper.className = "annot-sent-wrapper";

        // Sentence number label (left gutter)
        const sentLabel = document.createElement("div");
        sentLabel.className = "annot-sent-n";
        sentLabel.textContent = sentEntries.length > 1 ? String(sentId) : "";
        sentWrapper.appendChild(sentLabel);

        // Scrollable token row
        const sentDiv = document.createElement("div");
        sentDiv.className = "annot-sent";

        for (const tok of tokens) {
          const cell = document.createElement("div");
          cell.className = "annot-token" + (tok.token_id === this._annotSelectedTokenId ? " selected" : "");
          cell.dataset.tokenId = String(tok.token_id);

          // Row 1: word
          const wordEl = document.createElement("div");
          wordEl.className = "annot-word";
          wordEl.textContent = tok.word;

          // Row 2: UPOS tag
          const uposEl = document.createElement("div");
          uposEl.className = "annot-upos";
          const col = UPOS_COLORS[tok.upos ?? ""] ?? "#bbb";
          if (tok.upos) {
            uposEl.textContent = tok.upos;
            uposEl.style.background = col + "28";
            uposEl.style.color = col;
          } else {
            uposEl.textContent = "";
            uposEl.style.background = "transparent";
          }

          // Row 3: lemma (only if different from word)
          const lemmaEl = document.createElement("div");
          lemmaEl.className = "annot-lemma";
          const lemmaVal = tok.lemma ?? "";
          lemmaEl.textContent = lemmaVal && lemmaVal.toLowerCase() !== tok.word.toLowerCase()
            ? lemmaVal : "";

          cell.appendChild(wordEl);
          cell.appendChild(uposEl);
          cell.appendChild(lemmaEl);

          cell.addEventListener("click", () => {
            this._annotSelectedTokenId = tok.token_id;
            viewer.querySelectorAll(".annot-token").forEach(el => el.classList.remove("selected"));
            cell.classList.add("selected");
            this._annotRenderEditor(tok, editor);
          });

          sentDiv.appendChild(cell);
        }

        sentWrapper.appendChild(sentDiv);
        unitDiv.appendChild(sentWrapper);
      }

      viewer.appendChild(unitDiv);
    }
    void globalSentIdx; // suppress unused warning
  }

  private _annotRenderEditor(
    tok: _AnnotToken,
    editor: HTMLElement,
  ): void {
    const UPOS_LIST = [
      "ADJ","ADP","ADV","AUX","CCONJ","DET","INTJ","NOUN","NUM",
      "PART","PRON","PROPN","PUNCT","SCONJ","SYM","VERB","X",
    ];
    editor.innerHTML = `
      <div class="annot-editor-header">Token #${tok.token_id}</div>
      <label class="annot-field-label">Mot
        <input class="annot-field" data-field="word" value="${_escHtml(tok.word)}">
      </label>
      <label class="annot-field-label">Lemme
        <input class="annot-field" data-field="lemma" value="${_escHtml(tok.lemma ?? "")}">
      </label>
      <label class="annot-field-label">UPOS
        <select class="annot-field" data-field="upos">
          <option value="">(vide)</option>
          ${UPOS_LIST.map(u => `<option value="${u}"${tok.upos === u ? " selected" : ""}>${u}</option>`).join("")}
        </select>
      </label>
      <label class="annot-field-label">XPOS
        <input class="annot-field" data-field="xpos" value="${_escHtml(tok.xpos ?? "")}">
      </label>
      <label class="annot-field-label">Feats
        <input class="annot-field" data-field="feats" value="${_escHtml(tok.feats ?? "")}">
      </label>
      <label class="annot-field-label">Misc
        <input class="annot-field" data-field="misc" value="${_escHtml(tok.misc ?? "")}">
      </label>
      <button class="annot-btn-save">Enregistrer</button>
      <span class="annot-save-status"></span>
    `;

    editor.querySelector(".annot-btn-save")!.addEventListener("click", () => {
      this._annotSaveField(tok, editor);
    });
  }

  private async _annotSaveField(
    tok: _AnnotToken,
    editor: HTMLElement,
  ): Promise<void> {
    const statusEl = editor.querySelector(".annot-save-status") as HTMLElement | null;
    const get = (field: string) =>
      (editor.querySelector(`[data-field="${field}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? null;

    const payload = {
      token_id: tok.token_id,
      word: get("word") || tok.word,
      lemma: get("lemma") || null,
      upos: get("upos") || null,
      xpos: get("xpos") || null,
      feats: get("feats") || null,
      misc: get("misc") || null,
    };

    if (!this._conn) { if (statusEl) statusEl.textContent = "✗ Non connecté."; return; }
    if (statusEl) statusEl.textContent = "Enregistrement…";
    try {
      await this._conn.post("/tokens/update", payload);
      // Update local cache
      const idx = this._annotTokens.findIndex(t => t.token_id === tok.token_id);
      if (idx >= 0) {
        this._annotTokens[idx] = { ...this._annotTokens[idx], ...payload };
      }
      if (statusEl) {
        statusEl.textContent = "✓";
        setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 1500);
      }
      // Refresh interlinear view to reflect the change
      const panel = this._annotPanelEl;
      if (panel) {
        const viewer = panel.querySelector<HTMLElement>(".annot-viewer");
        if (viewer) {
          this._annotRenderInterlinear(viewer, editor);
          // Re-render editor with updated data so form fields are current
          const updated = this._annotTokens.find(t => t.token_id === tok.token_id);
          if (updated) this._annotRenderEditor(updated, editor);
        }
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = `✗ ${err instanceof SidecarError ? err.message : String(err)}`;
    }
  }

  private async _annotRunJob(panel: HTMLElement): Promise<void> {
    if (!this._conn) { this._annotSetStatus(panel, "Non connecté.", true); return; }
    if (this._annotSelectedDocId === null) {
      this._annotSetStatus(panel, "Sélectionnez d'abord un document.", true);
      return;
    }
    if (this._annotJobPoll !== null) {
      this._annotSetStatus(panel, "Annotation déjà en cours…", false);
      return;
    }
    const btn = panel.querySelector<HTMLButtonElement>(".annot-btn-run");
    if (btn) { btn.disabled = true; btn.textContent = "En cours…"; }
    this._annotSetStatus(panel, "Lancement…", false);
    try {
      const params: Record<string, unknown> = { doc_id: this._annotSelectedDocId };
      if (this._annotModelOverride) params.model = this._annotModelOverride;
      const res = await this._conn.post("/jobs/enqueue", { kind: "annotate", params });
      const enqueued = res as { job?: { job_id?: string } };
      this._annotJobId = enqueued.job?.job_id ?? null;
      if (!this._annotJobId) throw new Error("Pas de job_id dans la réponse");
      this._annotJobPoll = setInterval(() => { this._annotPoll(panel); }, 1000);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "Annoter ▶"; }
      this._annotSetStatus(panel, `✗ ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private async _annotPoll(panel: HTMLElement): Promise<void> {
    if (!this._annotJobId || !this._conn) return;
    try {
      const res = await this._conn.get(`/jobs/${this._annotJobId}`) as {
        job?: {
          status: string; error?: string;
          progress_pct?: number; progress_message?: string;
        }
      };
      const job = res.job;
      if (!job) { this._annotStopPoll(); return; }

      if (job.status === "running" && job.progress_message) {
        this._annotSetStatus(panel, job.progress_message, false);
      }

      if (job.status === "done") {
        this._annotStopPoll();
        const btn = panel.querySelector<HTMLButtonElement>(".annot-btn-run");
        if (btn) { btn.disabled = false; btn.textContent = "Annoter ▶"; }
        this._annotSetStatus(panel, "✓ Annotation terminée.", false);
        // Reload doc list (annotation_status changes) then tokens
        const sidebar = panel.querySelector<HTMLElement>(".annot-sidebar");
        const viewer = panel.querySelector<HTMLElement>(".annot-viewer");
        const editor = panel.querySelector<HTMLElement>(".annot-editor");
        if (sidebar && viewer && editor) {
          await this._annotLoadDocs(sidebar, viewer, editor);
          if (this._annotSelectedDocId !== null) {
            await this._annotSelectDoc(this._annotSelectedDocId, viewer, editor);
          }
        }
      } else if (job.status === "error" || job.status === "cancelled") {
        this._annotStopPoll();
        const btn = panel.querySelector<HTMLButtonElement>(".annot-btn-run");
        if (btn) { btn.disabled = false; btn.textContent = "Annoter ▶"; }
        this._annotSetStatus(panel, `✗ ${job.error ?? job.status}`, true);
      }
    } catch {
      // transient — keep polling
    }
  }

  private _annotStopPoll(): void {
    if (this._annotJobPoll !== null) {
      clearInterval(this._annotJobPoll);
      this._annotJobPoll = null;
    }
    this._annotJobId = null;
  }

  private _annotSetStatus(panel: HTMLElement, msg: string, isError: boolean): void {
    const el = panel.querySelector(".annot-status") as HTMLElement | null;
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "var(--color-danger, #c0392b)" : "var(--color-muted, #888)";
  }
}

const ANNOT_PANEL_CSS = `
.annot-panel { display: flex; flex-direction: column; gap: 0; height: 100%; }
.annot-toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px; border-bottom: 1px solid var(--border, #ddd);
}
.annot-title { margin: 0; font-size: 1rem; font-weight: 600; flex: 1; }
.annot-btn-run, .annot-btn-save {
  padding: 4px 12px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--border, #ccc); background: var(--bg-accent, #f5f5f5);
  font-size: 0.85rem;
}
.annot-btn-run:hover:not(:disabled), .annot-btn-save:hover { background: var(--bg-hover, #e8e8e8); }
.annot-btn-run:disabled { opacity: 0.55; cursor: default; }
.annot-status { font-size: 0.8rem; color: var(--color-muted, #888); min-width: 120px; }
.annot-model-label {
  display: flex; align-items: center; gap: 5px;
  font-size: 0.8rem; color: var(--color-muted, #888); white-space: nowrap;
}
.annot-model-select {
  padding: 3px 6px; border: 1px solid var(--border, #ccc);
  border-radius: 4px; font-size: 0.8rem; background: var(--bg, #fff); color: inherit;
  max-width: 180px;
}
.annot-btn-refresh {
  padding: 4px 8px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--border, #ccc); background: var(--bg-accent, #f5f5f5);
  font-size: 0.9rem; line-height: 1;
}
.annot-btn-refresh:hover { background: var(--bg-hover, #e8e8e8); }
.annot-layout {
  display: grid; grid-template-columns: 200px 1fr 220px;
  gap: 0; flex: 1; overflow: hidden; min-height: 0; height: 100%;
}
.annot-sidebar {
  border-right: 1px solid var(--border, #ddd);
  overflow-y: auto; padding: 8px 0;
}
.annot-doc-list { list-style: none; margin: 0; padding: 0; }
.annot-doc-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px 6px 12px; cursor: pointer; font-size: 0.85rem; gap: 4px;
}
.annot-doc-item:hover { background: var(--bg-hover, #f0f0f0); }
.annot-doc-item.selected { background: var(--bg-selected, #dce9ff); font-weight: 600; }
.annot-doc-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.annot-doc-badge {
  flex-shrink: 0; font-size: 0.72rem; font-weight: 700;
  width: 16px; height: 16px; line-height: 16px; text-align: center;
  border-radius: 50%; color: #aaa; background: #eee;
}
.annot-doc-badge.annotated { color: #2e7d32; background: #c8e6c9; }
.annot-viewer { overflow-y: auto; overflow-x: hidden; padding: 16px 16px 32px; }

/* ── Unit block ── */
.annot-unit {
  margin-bottom: 28px;
  border-left: 3px solid var(--color-primary, #4e9af1);
  padding-left: 12px;
}
.annot-unit-header {
  display: flex; align-items: baseline; gap: 10px;
  margin-bottom: 10px;
}
.annot-unit-n {
  flex-shrink: 0;
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em;
  color: var(--color-primary, #4e9af1);
  text-transform: uppercase;
}
.annot-unit-plain {
  font-size: 0.82rem; color: var(--color-muted, #999);
  font-style: italic; line-height: 1.4;
  white-space: normal; word-break: break-word;
}

/* ── Sentence row ── */
.annot-sent-wrapper {
  display: flex; align-items: flex-start; gap: 8px;
  margin-bottom: 6px;
}
.annot-sent-n {
  flex-shrink: 0; width: 16px; padding-top: 6px;
  font-size: 0.65rem; color: var(--color-muted, #bbb);
  text-align: right; user-select: none;
}
.annot-sent {
  display: flex; flex-wrap: nowrap; overflow-x: auto;
  gap: 2px; padding: 4px 4px 8px;
  /* subtle scroll track */
  scrollbar-width: thin;
  scrollbar-color: #ddd transparent;
}
.annot-sent::-webkit-scrollbar { height: 4px; }
.annot-sent::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

/* ── Token cell: 3 fixed-height rows ── */
.annot-token {
  display: flex; flex-direction: column;
  cursor: pointer; padding: 4px 6px; min-width: 32px;
  border: 1px solid transparent; border-radius: 5px;
  transition: background 0.1s, border-color 0.1s;
  flex-shrink: 0;
}
.annot-token:hover { background: var(--bg-hover, #f4f4f4); border-color: var(--border, #ddd); }
.annot-token.selected {
  border-color: var(--color-primary, #4e9af1);
  background: #dce9ff55;
}
.annot-token--highlighted {
  animation: annot-highlight-flash 2.5s ease-out forwards;
}
@keyframes annot-highlight-flash {
  0%   { background: #fff3cd; border-color: #f0a500; }
  30%  { background: #fff3cd; border-color: #f0a500; }
  100% { background: transparent; border-color: transparent; }
}

/* Row 1 – word */
.annot-word {
  height: 22px; display: flex; align-items: center; justify-content: center;
  font-size: 0.92rem; font-weight: 600; white-space: nowrap;
  color: var(--fg, #111);
}

/* Row 2 – UPOS badge */
.annot-upos {
  height: 18px; display: flex; align-items: center; justify-content: center;
  font-size: 0.6rem; font-weight: 700; letter-spacing: 0.05em;
  border-radius: 3px; padding: 0 4px; white-space: nowrap;
  min-width: 20px;
}

/* Row 3 – lemma (only shown when different from word) */
.annot-lemma {
  height: 16px; display: flex; align-items: center; justify-content: center;
  font-size: 0.7rem; font-style: italic;
  color: var(--color-muted, #999); white-space: nowrap;
}
.annot-editor {
  border-left: 1px solid var(--border, #ddd);
  padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;
}
.annot-editor-header { font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; }
.annot-field-label {
  display: flex; flex-direction: column; gap: 2px;
  font-size: 0.78rem; color: var(--color-muted, #888);
}
.annot-field {
  padding: 4px 6px; border: 1px solid var(--border, #ccc);
  border-radius: 3px; font-size: 0.85rem; background: var(--bg, #fff); color: inherit;
  width: 100%; box-sizing: border-box;
}
.annot-save-status { font-size: 0.8rem; color: var(--color-muted, #888); }
.annot-placeholder { color: var(--color-muted, #888); font-size: 0.85rem; padding: 8px; }
.annot-error { color: var(--color-danger, #c0392b); font-size: 0.85rem; padding: 8px; }
.annot-sidebar-loading { color: var(--color-muted, #888); font-size: 0.85rem; padding: 8px; }
`;

// ─── Utility helpers ──────────────────────────────────────────────────────────

function _escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Highlight words in `after` that differ from `before`.
 * Simple word-level diff: words not present in before set get a <mark>.
 */
function _highlightChanges(before: string, after: string): string {
  // Tokenise en mots (en ignorant les espaces seuls)
  const bWords = before.split(/\s+/).filter(Boolean);
  const aWords = after.split(/\s+/).filter(Boolean);
  const m = bWords.length, n = aWords.length;

  // LCS par programmation dynamique (Longest Common Subsequence)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = bWords[i].toLowerCase() === aWords[j].toLowerCase()
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);

  // Reconstruction du diff
  const parts: string[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && bWords[i].toLowerCase() === aWords[j].toLowerCase()) {
      parts.push(_escHtml(aWords[j]));
      i++; j++;
    } else if (j < n && (i >= m || dp[i + 1][j] >= dp[i][j + 1])) {
      parts.push(`<mark class="diff-mark">${_escHtml(aWords[j])}</mark>`);
      j++;
    } else {
      parts.push(`<del class="diff-del">${_escHtml(bWords[i])}</del>`);
      i++;
    }
  }
  return parts.join(" ");
}

function _formatMaybeNumber(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "n/a";
  return v.toFixed(3);
}

function _isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function _copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
