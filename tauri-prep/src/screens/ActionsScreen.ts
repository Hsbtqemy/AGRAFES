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
  UnitRecord,
  ConventionRole,
} from "../lib/sidecarClient.ts";
import {
  listDocuments,
  listUnits,
  listConventions,
  updateConvention,
  deleteConvention,
  bulkSetRole,
  setTextStart,
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
  enqueueJob,
  exportRunReport,
  getDocumentPreview,
  SidecarError,
  type CurateException,
  listCurateExceptions,
  setCurateException,
  deleteCurateException,
  listRuns,
} from "../lib/sidecarClient.ts";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";
import { inlineConfirm } from "../lib/inlineConfirm.ts";
import { escHtml as _escHtml, renderSpecialChars as _renderSpecialChars, highlightChanges as _highlightChanges } from "../lib/diff.ts";
import { AlignPanel } from "./AlignPanel.ts";
import { AnnotationView } from "./AnnotationView.ts";
import { SegmentationView } from "./SegmentationView.ts";
import { CurationView } from "./CurationView.ts";

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
  // AnnotationView (extracted)
  private _annotationView: AnnotationView | null = null;
  // SegmentationView (extracted)
  private _segmentationView: SegmentationView | null = null;
  // CurationView (extracted)
  private _curationView: CurationView | null = null;

  // Segmentation workflow state
  private _segmentPendingValidation = false;
  private _lastSegmentReport: {
    doc_id: number;
    units_input: number;
    units_output: number;
    segment_pack?: string;
    warnings?: string[];
  } | null = null;

  // Sprint 9 — new split segmentation panel

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
  private _lastFocusedBtn: HTMLElement | null = null;
  private static readonly LS_ACTIVE_SUB = "agrafes.prep.actions.active";

  // Longtext scroll sync state
  private _alignViewMode: "table" | "run" = "table";

  // ─── Curation review-locale state ────────────────────────────────────────
  /** Examples returned by the last curatePreview call (full set). */
  private _curateExamples: CuratePreviewExample[] = [];
  /** Index of the currently selected diff item in the FILTERED list (null = none). */
  private _activeDiffIdx: number | null = null;
  /** Preview display mode: both panes | raw only | diff only. */
  private _previewMode: "sidebyside" | "rawonly" | "diffonly" = "rawonly";
  /** Whether raw pane and diff pane scroll in sync. */
  private _previewSyncScroll = true;
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
   * All line units for the currently selected curation document.
   * Loaded once per doc change via _loadAllUnits(). Empty until loaded.
   */
  private _allUnits: UnitRecord[] = [];
  /**
   * doc_id for which _allUnits is loaded. Used to detect stale cache.
   */
  private _allUnitsDocId: number | null = null;
  /**
   * Direct text overrides keyed by unit_id, entered by the user in the raw pane.
   * Merged into manual_overrides on curate apply.
   */
  private _allOverrides: Map<number, string> = new Map();
  /**
   * doc_id for which _allOverrides was collected. Cleared on doc change.
   */
  private _allOverridesDocId: number | null = null;
  /**
   * Convention roles defined for this corpus. Loaded once per connection.
   * Used to render role badges and populate the role selector.
   */
  private _conventions: ConventionRole[] = [];
  /**
   * Set of unit_n values currently selected in the raw pane (for role assignment).
   * Cleared on doc change and after apply.
   */
  private _selectedUnitNs: Set<number> = new Set();
  /** n of the last unit clicked, for Shift+click range selection. */
  private _lastSelectedN: number | null = null;

  /** Scoped querySelector — searches within the mounted root only. Returns null when unmounted. */
  private _q<T extends HTMLElement>(selector: string): T | null {
    return this._root?.querySelector<T>(selector) ?? null;
  }
  /** Scoped querySelectorAll — returns empty NodeList when unmounted. */
  private _qAll<T extends HTMLElement>(selector: string): NodeListOf<T> {
    return this._root?.querySelectorAll<T>(selector) ?? document.querySelectorAll<T>(".__never__");
  }

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen prep-actions-screen";
    this._root = root;
    this._loadSubViewPref();

    const header = document.createElement("div");
    header.className = "prep-acts-header";
    header.innerHTML = `
      <div id="act-state-banner" class="runtime-state prep-state-info" aria-live="polite">
        En attente de connexion sidecar…
      </div>
      <button id="act-reload-docs" class="btn btn-secondary btn-sm prep-acts-reload-btn">↻ Rafraîchir docs</button>
    `;
    root.appendChild(header);
    this._stateEl = root.querySelector("#act-state-banner")!;
    root.querySelector("#act-reload-docs")!.addEventListener("click", () => this._loadDocs());

    const panelSlot = document.createElement("div");
    panelSlot.className = "prep-acts-panel-slot";

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

    const logSection = document.createElement("section");
    logSection.className = "card prep-acts-log-section";
    logSection.setAttribute("data-collapsible", "true");
    logSection.setAttribute("data-collapsed-default", "true");
    logSection.innerHTML = `<h3>Journal</h3><div id="act-log" class="prep-log-pane"></div>`;
    panelSlot.appendChild(logSection);

    root.appendChild(panelSlot);

    const busyOverlay = document.createElement("div");
    busyOverlay.id = "act-busy";
    busyOverlay.className = "prep-busy-overlay";
    busyOverlay.style.display = "none";
    busyOverlay.innerHTML = `<div class="prep-busy-spinner">⏳ Opération en cours…</div>`;
    root.appendChild(busyOverlay);

    this._logEl = root.querySelector("#act-log")!;
    this._busyEl = root.querySelector("#act-busy")!;

    this._wfRoot = root;
    this._initWorkflow(root);
    initCardAccordions(root);
    this._refreshRuntimeState();
    this._setSubViewClass(root, this._activeSubView);

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
    // Store the triggering button so focus can be restored when returning to hub
    if (this._activeSubView === "hub" && view !== "hub") {
      const active = document.activeElement;
      this._lastFocusedBtn = active instanceof HTMLElement ? active : null;
    }
    this._activeSubView = view;
    try { localStorage.setItem(ActionsScreen.LS_ACTIVE_SUB, view); } catch { /* */ }
    root.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
      panel.style.display = panel.dataset.panel === view ? "" : "none";
    });
    this._qAll<HTMLElement>("[data-nav]").forEach((link) => {
      const isActive = link.dataset.nav === view;
      link.classList.toggle("active", isActive);
      if (isActive) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
    this._setSubViewClass(root, view);
    // Restore focus to the hub card button that launched this sub-view
    if (view === "hub" && this._lastFocusedBtn) {
      const btn = this._lastFocusedBtn;
      this._lastFocusedBtn = null;
      requestAnimationFrame(() => btn.focus());
    }
  }

  private _setSubViewClass(root: HTMLElement, view: SubView): void {
    root.classList.remove("actions-sub-hub", "actions-sub-curation", "actions-sub-segmentation", "actions-sub-alignement", "actions-sub-annoter");
    root.classList.add(`actions-sub-${view}`);
    const content = root.closest<HTMLElement>(".content");
    if (content) content.classList.toggle("prep-curation-wide", view === "curation");
  }

  /** Stable class method — replaces captured closure pattern for seg mode switching. */
  private _renderHubPanel(root: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.className = "prep-acts-hub";
    el.setAttribute("role", "main");
    el.setAttribute("aria-label", "Vue synth\u00e8se Actions");
    el.innerHTML = `
      <section class="prep-acts-hub-head-card">
        <div class="prep-acts-hub-head-left">
          <h2 class="prep-acts-hub-head-title">Traitement de corpus</h2>
          <p class="prep-acts-hub-head-desc">Curation &middot; Segmentation &middot; Alignement &mdash; pilotage des op&eacute;rations de pr&eacute;paration du corpus.</p>
        </div>
        <div class="prep-acts-hub-head-tools">
          <button class="prep-acts-hub-head-link acts-hub-head-link-accent" data-cta="segmentation-longtext">Sc&eacute;nario grand texte &nearr;</button>
        </div>
      </section>
      <div class="prep-acts-hub-workspace">
        <div class="card prep-acts-hub-wf-card">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#10002;</span>
            <span class="prep-acts-hub-wf-step">&Eacute;tape 1</span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Curation</h3>
          <p class="prep-acts-hub-wf-desc">Nettoyage et normalisation du texte brut. Applique des r&egrave;gles regex sur les documents sources avant segmentation.</p>
          <div class="prep-acts-hub-wf-actions">
            <button class="prep-acts-hub-wf-btn" data-target="curation">Ouvrir &rarr;</button>
          </div>
        </div>
        <div class="card prep-acts-hub-wf-card">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#9889;</span>
            <span class="prep-acts-hub-wf-step">&Eacute;tape 2</span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Segmentation</h3>
          <p class="prep-acts-hub-wf-desc">D&eacute;coupage du corpus en unit&eacute;s traductionnelles pivot et cibles. G&eacute;n&egrave;re les segments pour l&rsquo;alignement automatique.</p>
          <div class="prep-acts-hub-wf-actions">
            <button class="prep-acts-hub-wf-btn" data-target="segmentation">Ouvrir &rarr;</button>
            <button class="prep-acts-hub-wf-link" data-cta="segmentation-longtext">Grand texte &nearr;</button>
          </div>
        </div>
        <div class="card prep-acts-hub-wf-card">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#8644;</span>
            <span class="prep-acts-hub-wf-step">&Eacute;tape 3</span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Alignement</h3>
          <p class="prep-acts-hub-wf-desc">Cr&eacute;ation et r&eacute;vision des liens pivot &harr; cible entre documents align&eacute;s. Inspection, retarget et r&eacute;solution de collisions.</p>
          <div class="prep-acts-hub-wf-actions">
            <button class="prep-acts-hub-wf-btn" data-target="alignement">Ouvrir &rarr;</button>
          </div>
        </div>
        <div class="card prep-acts-hub-wf-card">
          <div class="prep-acts-hub-wf-top">
            <span class="prep-acts-hub-wf-icon" aria-hidden="true">&#9000;</span>
            <span class="prep-acts-hub-wf-step">Optionnel</span>
          </div>
          <h3 class="prep-acts-hub-wf-title">Annotation</h3>
          <p class="prep-acts-hub-wf-desc">Vue interlin&eacute;aire (mot / POS / lemme) par document. Annotation spaCy automatique et correction manuelle token par token.</p>
          <div class="prep-acts-hub-wf-actions">
            <button class="prep-acts-hub-wf-btn" data-target="annoter">Ouvrir &rarr;</button>
          </div>
        </div>
      </div>
    `;
    // Workflow card primary buttons → navigate to sub-view
    el.querySelectorAll<HTMLButtonElement>(".prep-acts-hub-wf-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.target as SubView;
        this._switchSubViewDOM(root, target);
      });
    });
    // CTA buttons (head accent + secondary wf links) → navigate with optional segMode
    el.querySelectorAll<HTMLButtonElement>(".prep-acts-hub-head-link, .prep-acts-hub-wf-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cta = btn.dataset.cta!;
        this._switchSubViewDOM(root, cta === "segmentation-longtext" ? "segmentation" : cta as SubView);
      });
    });
    return el;
  }

  private _prependBackBtn(panel: HTMLElement, root: HTMLElement): void {
    const div = document.createElement("div");
    div.className = "prep-acts-view-back";
    div.innerHTML = `<button class="prep-acts-view-back-btn">&#8592; Vue synth&#232;se</button>`;
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

  private _renderCurationPanel(_root: HTMLElement): HTMLElement {
    this._curationView = new CurationView(
      () => this._conn,
      () => this._docs,
      {
        log: (msg, isError) => this._log(msg, isError),
        toast: (msg, isError) => this._showToast?.(msg, isError),
        setBusy: (v) => this._setBusy(v),
        isBusy: () => this._isBusy,
        jobCenter: () => this._jobCenter,
        onNavigate: (target) => this._switchSubViewDOM(this._wfRoot!, target as Parameters<typeof this._switchSubViewDOM>[1]),
        onReindex: () => { void this._runIndex(); },
        onValidateMeta: () => { void this._runValidateMeta(); },
        getLastSegmentReport: () => this._segmentationView?.getLastSegmentReport() ?? null,
      },
    );
    return this._curationView.render();
  }

  // ── New split segmentation panel (Sprint 9) ────────────────────────────────

  /**
   * Build the segmentation panel — delegated to SegmentationView.
   */
  private _renderSegmentationPanel(_root: HTMLElement): HTMLElement {
    const wrapper = document.createElement("div");
    this._segmentationView = new SegmentationView(
      () => this._conn,
      () => this._docs,
      {
        log: (msg, isError) => this._log(msg, isError),
        toast: (msg, isError) => this._showToast?.(msg, isError),
        setBusy: (v) => this._setBusy(v),
        isBusy: () => this._isBusy,
        jobCenter: () => this._jobCenter,
        onNavigate: (target) => this._switchSubViewDOM(this._wfRoot!, target as Parameters<typeof this._switchSubViewDOM>[1]),
        onOpenDocuments: () => this._openDocumentsTab?.(),
        onOpenExporter: (prefill) => this._openExporterTab?.(prefill),
      },
    );
    this._segmentationView.render(wrapper);
    return wrapper;
  }

  private _renderAlignementPanel(root: HTMLElement): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "main");
    wrapper.setAttribute("aria-label", "Vue Alignement");

    // ── En-tête rapide ──
    const headSection = document.createElement("section");
    headSection.className = "prep-acts-seg-head-card";
    headSection.innerHTML = `
      <div class="prep-acts-hub-head-left">
        <h1>Alignement</h1>
        <p>L'alignement crée des correspondances segment à segment entre un document pivot et ses traductions. Lancez un alignement automatique, puis vérifiez chaque lien dans l'audit&nbsp;: acceptez, rejetez ou redirigez manuellement. Les liens acceptés alimentent le Concordancier bilingue.</p>
      </div>
      <div class="prep-acts-hub-head-tools">
        <button class="prep-acts-hub-head-link" id="act-align-open-export-btn">Exporter cette étape…</button>
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
          const linkEl = this._q<HTMLButtonElement>(`[data-nav="${target}"]`);
          linkEl?.click();
        },
      },
    );
    const newPanelEl = this._alignPanel.render();
    newPanelEl.classList.add("prep-align-new-panel-section");
    wrapper.appendChild(newPanelEl);

    // ── Sections secondaires (qualité, collisions, rapport) — conservées ──
    const legacyContainer = document.createElement("div");
    legacyContainer.setAttribute("data-legacy-align", "true");
    legacyContainer.innerHTML = `
      <section class="prep-acts-seg-head-card" style="display:none"><!-- placeholder legacy head --></section>
      <section class="card" id="act-quality-card" data-collapsible="true">
        <h3>Qualit&#233; alignement <span class="prep-badge-preview">m&#233;triques</span></h3>
        <p class="hint">Couverture et orphelins pour une paire pivot&#8596;cible. Recalculez apr&#232;s chaque run ou modification manuelle.</p>
        <div class="prep-form-row">
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
        <h3>Comparer deux runs <span class="prep-badge-preview">align</span></h3>
        <p class="hint">Historique des runs d&#8217;alignement en base ; comparez strat&#233;gie et indicateurs.</p>
        <div class="prep-form-row" style="flex-wrap:wrap;gap:0.5rem;align-items:flex-end">
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
        <h3>Collisions d&#8217;alignement <span class="prep-badge-preview">r&#233;solution</span></h3>
        <p class="hint">Un pivot ayant plusieurs liens vers le m&#234;me document cible est une collision.</p>
        <div class="prep-form-row">
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
        <h3>Rapport de runs <span class="prep-badge-preview">export</span></h3>
        <p class="hint">Exporter l&#8217;historique des runs en HTML ou JSONL.</p>
        <div class="prep-form-row">
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
        <div class="prep-btn-row" style="margin-top:0.5rem">
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
      <section class="prep-acts-seg-head-card">
        <div class="prep-acts-hub-head-left">
          <h1>Alignement &#8212; vue run globale</h1>
          <p>Cr&#233;ez les liens pivot &#8596; cible entre documents. Lancez un run, contr&#244;lez la qualit&#233;, corrigez les exceptions.</p>
        </div>
        <div class="prep-acts-hub-head-tools">
          <span class="prep-curate-pill" id="act-align-run-pill">Liens pivot &#8596; cible</span>
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
        <div class="prep-btn-row">
          <button id="act-reload-docs-align" class="btn btn-secondary btn-sm">&#8635;&#160;Rafra&#238;chir</button>
        </div>
        <div id="act-doc-list" class="prep-doc-list"><p class="empty-hint">Aucun corpus ouvert.</p></div>
      </section>
      <section class="card" id="act-align-card">
        <div class="prep-align-layout">
          <div class="prep-align-main">
            <div class="prep-align-launcher">
              <div class="prep-align-launcher-head">Configuration du run</div>
              <div class="prep-align-setup-row">
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
              <div class="prep-form-row" style="margin-top:8px">
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
              <div class="prep-btn-row" style="margin-top:0.5rem">
                <button id="act-align-btn" class="btn btn-warning" disabled>Lancer la run d&#8217;alignement</button>
                <button id="act-align-recalc-btn" class="btn btn-secondary" disabled>Recalcul global</button>
              </div>
              <div id="act-align-confirm" class="prep-audit-batch-bar" style="display:none"></div>
            </div>
            <!-- Synthèse du run — visible after alignment -->
            <div id="act-align-results" style="display:none;margin-top:0.75rem">
              <div class="prep-run-synthese-head">
                <h4 class="prep-run-synthese-title">Synth&#232;se du run</h4>
                <div id="act-align-banner" class="prep-preview-stats"></div>
              </div>
              <div id="act-align-kpis" class="prep-align-kpis" style="margin-top:10px">
                <div class="kpi prep-align-kpi" id="act-kpi-wrap-created"><div class="label prep-align-kpi-label">Liens cr&#233;&#233;s</div><div class="value prep-align-kpi-value" id="act-kpi-created">&#8212;</div></div>
                <div class="kpi prep-align-kpi" id="act-kpi-wrap-skipped"><div class="label prep-align-kpi-label">Ignor&#233;s</div><div class="value prep-align-kpi-value" id="act-kpi-skipped">&#8212;</div></div>
                <div class="kpi prep-align-kpi" id="act-kpi-wrap-coverage"><div class="label prep-align-kpi-label">Couverture</div><div class="value prep-align-kpi-value" id="act-kpi-coverage">&#8212;</div></div>
                <div class="kpi prep-align-kpi" id="act-kpi-wrap-orphan-p"><div class="label prep-align-kpi-label">Orphelins pivot</div><div class="value prep-align-kpi-value" id="act-kpi-orphan-p">&#8212;</div></div>
                <div class="kpi prep-align-kpi" id="act-kpi-wrap-orphan-t"><div class="label prep-align-kpi-label">Orphelins cible</div><div class="value prep-align-kpi-value" id="act-kpi-orphan-t">&#8212;</div></div>
              </div>
              <div class="prep-btn-row" style="margin-top:10px">
                <button id="act-align-open-audit-cta" class="btn btn-primary btn-sm">Ouvrir l&#8217;audit &#8595;</button>
                <button id="act-align-recalc-cta" class="btn btn-secondary btn-sm">Recalcul global</button>
              </div>
            </div>
            <div id="act-align-debug-panel" style="display:none;margin-top:0.75rem">
              <div class="prep-align-debug-head">
                <h4 style="margin:0;font-size:0.9rem">Explainability</h4>
                <button id="act-align-copy-debug-btn" class="btn btn-secondary btn-sm">Copier diagnostic JSON</button>
              </div>
              <div id="act-align-debug-content" class="prep-align-debug-content"></div>
            </div>
            <div id="act-audit-panel" style="display:none;margin-top:0.75rem">
              <div class="prep-run-toolbar">
                <div class="prep-run-toolbar-title">
                  <h4 style="margin:0;font-size:0.9rem">Texte complet align&#233;</h4>
                </div>
                <div class="prep-run-toolbar-filters">
                  <button id="act-audit-qf2-all" class="chip active" data-qf2="all">Tout</button>
                  <button id="act-audit-qf2-review" class="chip" data-qf2="review">&#192; revoir</button>
                  <button id="act-audit-qf2-unreviewed" class="chip" data-qf2="unreviewed">Non r&#233;vis&#233;s</button>
                  <button id="act-audit-qf2-rejected" class="chip" data-qf2="rejected">Rejet&#233;s</button>
                </div>
                <div class="prep-run-toolbar-actions">
                  <div class="prep-run-view-toggle chip-row">
                    <button id="act-audit-view-table" class="chip active" title="Vue tableau" aria-pressed="true">&#9776; Tableau</button>
                    <button id="act-audit-view-run" class="chip" title="Vue run-row" aria-pressed="false">&#9711; Run</button>
                  </div>
                  <button id="act-audit-next-cta" class="btn btn-sm btn-secondary">Suivant &#224; revoir &#8595;</button>
                </div>
              </div>
              <div class="prep-form-row">
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
              <div class="prep-btn-row" style="margin-top:0.4rem;gap:0.75rem;align-items:center">
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
              <div class="prep-btn-row" style="margin-top:0.35rem;gap:0.4rem;align-items:center">
                <button id="act-audit-qf-all" class="btn btn-sm btn-secondary prep-audit-filter-btn" data-qf="all">Tout</button>
                <button id="act-audit-qf-review" class="btn btn-sm btn-secondary prep-audit-filter-btn" data-qf="review">&#192; revoir</button>
                <button id="act-audit-qf-unreviewed" class="btn btn-sm btn-secondary prep-audit-filter-btn" data-qf="unreviewed">Non r&#233;vis&#233;s</button>
                <button id="act-audit-qf-rejected" class="btn btn-sm btn-secondary prep-audit-filter-btn" data-qf="rejected">Rejet&#233;s</button>
                <button id="act-audit-next-exception-btn" class="btn btn-sm btn-secondary">Suivant &#224; revoir</button>
              </div>
              <div id="act-audit-kpis" class="hint" style="margin-top:0.35rem"></div>
              <div id="act-audit-table-wrap" style="margin-top:0.5rem;overflow-x:auto"></div>
              <div id="act-audit-run-view" style="display:none;margin-top:0.5rem"></div>
              <div id="act-audit-batch-bar" class="prep-audit-batch-bar" style="display:none">
                <span id="act-audit-sel-count" class="prep-audit-sel-count">0 s&#233;lectionn&#233;(s)</span>
                <button id="act-audit-batch-accept" class="btn btn-sm btn-secondary">&#10003; Accepter</button>
                <button id="act-audit-batch-reject" class="btn btn-sm btn-secondary">&#10007; Rejeter</button>
                <button id="act-audit-batch-unreviewed" class="btn btn-sm btn-secondary">? Non r&#233;vis&#233;</button>
                <button id="act-audit-batch-delete" class="btn btn-sm btn-danger">Supprimer</button>
              </div>
              <div id="act-audit-batch-confirm" class="prep-audit-batch-bar" style="display:none"></div>
              <div class="prep-btn-row" style="margin-top:0.4rem">
                <button id="act-audit-more-btn" class="btn btn-secondary btn-sm" style="display:none">Charger plus</button>
              </div>
            </div>
          </div>
          <aside class="prep-align-focus">
            <h4 style="margin:0 0 0.45rem;font-size:0.9rem">Correction cibl&#233;e</h4>
            <p id="act-align-focus-empty" class="empty-hint">S&#233;lectionnez une ligne dans &#171; Texte complet align&#233; &#187; pour corriger rapidement.</p>
            <div id="act-align-focus-panel" style="display:none">
              <div id="act-align-focus-meta" class="hint" style="margin-bottom:0.35rem"></div>
              <div class="prep-align-focus-text">
                <strong>Pivot</strong>
                <p id="act-align-focus-pivot"></p>
              </div>
              <div class="prep-align-focus-text" style="margin-top:0.45rem">
                <strong>Cible</strong>
                <p id="act-align-focus-target"></p>
              </div>
              <div class="prep-btn-row" style="margin-top:0.65rem">
                <button id="act-focus-accept-btn" class="btn btn-sm btn-secondary">&#10003; Valider</button>
                <button id="act-focus-reject-btn" class="btn btn-sm btn-secondary">&#10007; &#192; revoir</button>
                <button id="act-focus-unreviewed-btn" class="btn btn-sm btn-secondary">? Non r&#233;vis&#233;</button>
                <button id="act-focus-lock-btn" class="btn btn-sm btn-secondary">Verrouiller</button>
                <button id="act-focus-unlock-btn" class="btn btn-sm btn-secondary">D&#233;verrouiller</button>
                <button id="act-focus-retarget-btn" class="btn btn-sm btn-secondary">&#8644; Retarget</button>
                <button id="act-focus-delete-btn" class="btn btn-sm btn-danger">Supprimer</button>
              </div>
              <div id="act-focus-confirm" class="prep-audit-batch-bar" style="display:none"></div>
            </div>
          </aside>
        </div>
        <div class="btn-row prep-align-finalize-row">
          <button id="act-goto-report" class="btn btn-secondary btn-sm">Terminer: ouvrir Rapport runs &#8595;</button>
        </div>
      </section>
      <section class="card" id="act-quality-card" data-collapsible="true">
        <h3>Qualit&#233; alignement <span class="prep-badge-preview">m&#233;triques</span></h3>
        <p class="hint">Couverture et orphelins pour une paire pivot&#8596;cible. Recalculez apr&#232;s chaque run ou modification manuelle.</p>
        <div class="prep-form-row">
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
        <h3>Collisions d&#8217;alignement <span class="prep-badge-preview">r&#233;solution</span></h3>
        <p class="hint">Un pivot ayant plusieurs liens vers le m&#234;me document cible est une collision.</p>
        <div class="prep-form-row">
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
        <h3>Rapport de runs <span class="prep-badge-preview">export</span></h3>
        <p class="hint">Exporter l&#8217;historique des runs (import, alignement, curation&#8230;) en HTML ou JSONL.</p>
        <div class="prep-form-row">
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
        <div class="prep-btn-row" style="margin-top:0.5rem">
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
      const sel = this._q<HTMLSelectElement>(`#${id}`);
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
      const btn = this._q<HTMLButtonElement>(`#act-quality-btn, #act-coll-load-btn`);
      if (btn) btn.disabled = docs.length === 0;
    }
    // Enable report button if docs exist
    const reportBtn = this._q<HTMLButtonElement>("#act-report-btn");
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
      container.innerHTML = '<p class="prep-live-note">Aucun lien &#224; afficher. Chargez les liens depuis le tableau.</p>';
      container.onclick = null;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const link of visibleLinks) {
      const normalizedStatus = this._normalizeAuditStatus(link.status);
      const dotClass = normalizedStatus === "accepted" ? "dot ok" : normalizedStatus === "rejected" ? "dot bad" : "dot review";
      const dotLabel = normalizedStatus === "accepted" ? "Accepté" : normalizedStatus === "rejected" ? "Rejeté" : "Non révisé";
      const art = document.createElement("article");
      art.className = "prep-run-row";
      art.dataset.linkId = String(link.link_id);
      art.innerHTML = `
        <div class="prep-run-cell prep-run-cell-pivot">
          <span class="prep-run-cell-id">${_escHtml(String(link.external_id ?? "—"))}</span>
          <span class="prep-run-cell-text">${_escHtml(String(link.pivot_text ?? "")).slice(0, 140)}</span>
        </div>
        <div class="prep-status-rail">
          <span class="${dotClass}" title="${dotLabel}"></span>
          <span class="prep-dot-label">${dotLabel}</span>
        </div>
        <div class="prep-run-cell prep-run-cell-target">
          <span class="prep-run-cell-text">${_escHtml(String(link.target_text ?? "")).slice(0, 140)}</span>
          <span class="prep-run-row-actions">
            <button class="btn btn-sm btn-secondary prep-run-accept-btn" data-id="${link.link_id}" title="Accepter" aria-label="Accepter ce lien">✓</button>
            <button class="btn btn-sm btn-danger prep-run-reject-btn" data-id="${link.link_id}" title="Rejeter" aria-label="Rejeter ce lien">✗</button>
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
      if (btn.classList.contains("prep-run-accept-btn")) void this._runFocusStatusAction(root, "accepted");
      else if (btn.classList.contains("prep-run-reject-btn")) void this._runFocusStatusAction(root, "rejected");
    };
  }

  // ── Longtext scroll sync ─────────────────────────────────────────────────────

  /** Sync scroll between split-panel preview columns (`#act-seg-prev-raw` ↔ `#act-seg-prev-seg`). */
  // ── Curation preview scroll sync (#act-preview-raw ↔ #act-diff-list) ───────────────

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._docs = [];
    this._alignExplainability = [];
    this._alignRunId = null;
    this._lastSegmentReport = null;
    this._segmentPendingValidation = false;
    this._hasPendingPreview = false;
    this._lastAuditEmpty = false;
    this._auditSelectedLinkId = null;
    this._curateExamples = [];
    this._activeDiffIdx = null;
    this._curateRuleLabels = [];
    this._activeRuleFilter = null;
    this._activeStatusFilter = null;
    this._curateGlobalChanged = 0;
    const _rec = this._q<HTMLElement>("#act-review-export-card");
    if (_rec) _rec.style.display = "none";
    this._curateRestoredCount = 0;
    this._curateSavedCount = 0;
    this._curateUnitsTotal = 0;
    this._editingManualOverride = false;
    this._curateExceptions = new Map();
    this._allUnits = [];
    this._allUnitsDocId = null;
    this._allOverrides = new Map();
    this._allOverridesDocId = null;
    this._conventions = [];
    this._selectedUnitNs = new Set();
    this._lastSelectedN = null;
    this._renderConventionsList(); // clear list on disconnect
    if (!conn) {
      this._lastErrorMsg = null;
    }
    this._setButtonsEnabled(false);
    this._renderCurateQuickQueue();
    this._refreshCurateHeaderState();
    if (conn) {
      this._loadDocs();
      void this._loadConventions();
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
      this._segmentationView?.refreshDocs();
    }
    this._refreshRuntimeState();
    // Refresh annotation panel if it was rendered before conn was available.
    if (conn) this._annotRefreshIfVisible();
  }

  /** Public API: called from app.ts after RG→Prep token navigation. */
  annotFocusDoc(docId: number, tokenId?: number): void {
    this._annotationView?.focusDoc(docId, tokenId);
  }

  private _annotRefreshIfVisible(): void {
    this._annotationView?.refreshIfConnected();
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
     "act-seg-open-export-btn", "act-seg-lt-btn", "act-seg-lt-validate-btn", "act-seg-lt-validate-only-btn",
     "act-seg-lt-open-export-btn", "act-align-open-export-btn",
     "act-meta-btn", "act-quality-btn", "act-coll-load-btn",
     "act-report-btn"].forEach(id => {
      const el = this._q(`#${id}`) as HTMLButtonElement | null;
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
    root.querySelectorAll<HTMLButtonElement>(".prep-audit-filter-btn").forEach((btn) => {
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
    return (this._q<HTMLInputElement>(`#${id}`)?.checked) ?? false;
  }

  /**
   * Bidirectional auto-switch of preview mode based on rule state.
   *   rawonly  + rules become active  → sidebyside
   *   sidebyside + all rules cleared  → rawonly
   * diffonly is never auto-changed (it's a deliberate user choice).
   */
  /** Reads the selected punctuation language from the radio group. */
  private _getPunctLang(): "fr" | "en" | "" {
    const el = this._q<HTMLInputElement>('input[name="curate-punct"]:checked');
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
   * Activate or clear the status filter.
   * Combines with the rule filter via _filteredExamples().
   */
  private _setStatusFilter(status: "pending" | "accepted" | "ignored" | null): void {
    this._activeStatusFilter = status;
    this._activeDiffIdx = null;
    const filtered = this._filteredExamples();
    this._refreshCuratePreviewPanes();
    this._updateSessionSummary(); // re-renders chips with correct active state
    const panel = this._q<HTMLElement>("#act-preview-panel");
    if (filtered.length > 0) {
      this._setActiveDiffItem(0, panel);
    } else {
      this._updateActionButtons();
      const posEl = this._q<HTMLElement>("#act-diff-position");
      if (posEl) posEl.textContent = status ? "0 modif." : "—";
      [this._q<HTMLButtonElement>("#act-diff-prev"),
       this._q<HTMLButtonElement>("#act-diff-next")].forEach(b => { if (b) b.disabled = true; });
    }
  }

  /**
   * Re-render the session summary (pending / accepted / ignored counts).
   * The summary chips double as status-filter toggles.
   */
  private _updateSessionSummary(): void {
    const el = this._q<HTMLElement>("#act-curate-session-summary");
    if (!el) return;
    const total = this._curateExamples.length;
    if (total === 0) { el.style.display = "none"; return; }

    el.style.display = "";
    const c = this._getStatusCounts();
    const af = this._activeStatusFilter;
    const sl = ActionsScreen._STATUS_LABEL;

    const chip = (key: "pending" | "accepted" | "ignored", icon: string, label: string, count: number) =>
      `<span class="prep-session-chip prep-session-${key}${af === key ? " prep-session-chip-active" : ""}"` +
      ` data-sf="${key}" role="button" tabindex="0" title="${af === key ? "Effacer ce filtre" : `Filtrer : ${label}`}">` +
      `${icon}&#160;<strong>${count}</strong>&#160;<span class="prep-session-chip-label">${label}</span></span>`;

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
        `<div class="prep-session-restore-notice" title="Statuts restaurés depuis la session précédente (même document, mêmes règles)">` +
        `&#8635; ${countText}${modeNote} &#8212; ` +
        `<button class="btn-inline-link" id="act-reset-review">Réinitialiser</button>` +
        `</div>`;
    } else {
      // When no doc is selected, "Réinitialiser" sweeps all saved review states (Level 6A).
      const modeNote = isAllMode
        ? `<span class="prep-session-all-note" title="Aucun document sélectionné. La réinitialisation effacera toutes les sessions de review sauvegardées.">&#9432; Portée globale</span> &#8212; `
        : "";
      restoreNotice = `<div class="prep-session-reset-row">${modeNote}<button class="btn-inline-link" id="act-reset-review">Effacer la review sauvegardée</button></div>`;
    }

    el.innerHTML =
      `<div class="prep-session-counts">` +
      chip("pending",  "&#9632;", sl.pending,  c.pending)  +
      chip("accepted", "&#10003;", sl.accepted, c.accepted) +
      chip("ignored",  "&#215;",  sl.ignored,  c.ignored)  +
      `</div>` +
      (af ? `<div class="prep-session-filter-note">Filtre statut actif &#8212; <button class="btn-inline-link" id="act-clear-sf">Afficher tout</button></div>` : "") +
      (() => {
        const overrideCount = this._curateExamples.filter(ex => ex.is_manual_override).length;
        return overrideCount > 0
          ? `<div class="prep-session-override-note">&#9998;&#160;${overrideCount} correction(s) manuelle(s) dans cette session</div>`
          : "";
      })() +
      (() => {
        const excCount = this._curateExceptions.size;
        return excCount > 0
          ? `<div class="prep-session-exception-note">🔒&#160;${excCount} exception(s) persistée(s) active(s) pour ce document</div>`
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

    const accept  = this._q<HTMLButtonElement>("#act-item-accept");
    const ignore  = this._q<HTMLButtonElement>("#act-item-ignore");
    const pending = this._q<HTMLButtonElement>("#act-item-pending");

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
    const card   = this._q<HTMLElement>("#act-curate-context-card");
    const body   = this._q<HTMLElement>("#act-curate-context");
    const posEl  = this._q<HTMLElement>("#act-context-pos");
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
      ? `<div class="prep-ctx-row ctx-before">
           <span class="prep-ctx-label">Avant</span>
           <span class="prep-ctx-text">${_escHtml(trim(ctxBefore))}</span>
         </div>`
      : "";
    const ctxAfterHtml = ctxAfter
      ? `<div class="prep-ctx-row ctx-after">
           <span class="prep-ctx-label">Après</span>
           <span class="prep-ctx-text">${_escHtml(trim(ctxAfter))}</span>
         </div>`
      : "";

    if (this._editingManualOverride) {
      // ── Edit mode ──────────────────────────────────────────────────────────
      body.innerHTML =
        ctxBeforeHtml +
        `<div class="prep-ctx-row ctx-current">
           <span class="prep-ctx-label ctx-label-cur">Original</span>
           <span class="prep-ctx-text ctx-original">${_escHtml(ex.before)}</span>
         </div>` +
        `<div class="prep-ctx-row ctx-edit-row">
           <span class="prep-ctx-label ctx-label-edit">Résultat</span>
           <span class="prep-ctx-edit-area">
             <textarea id="act-manual-override-input" class="prep-ctx-override-textarea"
               rows="3" spellcheck="true">${_escHtml(effectiveAfter)}</textarea>
             <span class="prep-ctx-edit-hint">Proposition automatique : <em>${_escHtml(ex.after)}</em></span>
           </span>
         </div>` +
        `<div class="prep-ctx-edit-actions">
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
        ? `<span class="prep-ctx-override-badge"
             title="Ce résultat a été corrigé manuellement. Proposition automatique : ${_escHtml(ex.after)}">
             ✏ Édité manuellement
           </span>`
        : "";

      // Level 7B: persistent exception badge
      const hasException = ex.is_exception_ignored || ex.is_exception_override;
      const exceptionBadgeHtml = hasException
        ? `<span class="prep-ctx-exception-badge"
             title="${ex.is_exception_ignored
               ? "Exception persistée : cette unité sera toujours ignorée par la curation, quelle que soit la session."
               : `Exception persistée : ce texte sera toujours appliqué à cette unité. Texte : "${_escHtml(ex.exception_override ?? "")}"`}">
             🔒 ${ex.is_exception_ignored ? "Ignoré durablement" : "Override durable"}
           </span>`
        : "";

      // Level 8C: forced-unit indicator
      const forcedReason = ex.preview_reason;
      const forcedNoteHtml = forcedReason && forcedReason !== "standard"
        ? `<div class="prep-ctx-forced-note ctx-forced-${forcedReason}">
             ${forcedReason === "forced"
               ? "↗ Ouverture ciblée depuis le panneau Exceptions."
               : forcedReason === "forced_ignored"
               ? "↗ Ouverture ciblée — cette unité est <strong>neutralisée par une exception ignore</strong>. Elle n'est pas appliquée."
               : "↗ Ouverture ciblée — aucune modification active avec les règles courantes."}
           </div>`
        : "";

      body.innerHTML =
        ctxBeforeHtml +
        `<div class="prep-ctx-row ctx-current">
           <span class="prep-ctx-label ctx-label-cur">${forcedReason === "forced_no_change" ? "Inchangé" : forcedReason === "forced_ignored" ? "Neutralisé" : "Modifié"}</span>
           <span class="prep-ctx-modification">
             <span class="prep-ctx-diff-before">${_escHtml(ex.before)}</span>
             <span class="prep-ctx-arrow">&#8594;</span>
             <span class="prep-ctx-diff-after${ex.is_manual_override ? " ctx-manual-override" : ""}">${_highlightChanges(ex.before, effectiveAfter)}</span>
           </span>
         </div>` +
        ctxAfterHtml +
        forcedNoteHtml +
        `<div class="prep-ctx-edit-actions">
           ${overrideBadgeHtml}
           <button class="btn btn-sm" id="act-override-edit"
             title="Modifier manuellement le résultat de cette modification">&#9998; Éditer</button>
           ${ex.is_manual_override
             ? `<button class="btn btn-sm" id="act-override-revert"
                  title="Annuler la correction manuelle et utiliser la proposition automatique">&#8617; Proposition auto</button>`
             : ""}
         </div>` +
        `<div class="prep-ctx-exception-actions">
           ${exceptionBadgeHtml}
           ${!hasException
             ? `<button class="btn btn-sm prep-ctx-exception-btn" id="act-exc-ignore"
                  title="Ne plus jamais appliquer de curation sur cette unité, même lors des prochaines sessions">
                  🔒 Toujours ignorer</button>
                <button class="btn btn-sm prep-ctx-exception-btn" id="act-exc-override"
                  title="Appliquer durablement le résultat actuel comme correction permanente de cette unité">
                  🔒 Conserver cette correction</button>`
             : `<button class="btn btn-sm prep-ctx-exception-btn prep-ctx-exception-btn-delete" id="act-exc-delete"
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
    const raw = (this._q<HTMLTextAreaElement>("#act-curate-rules"))?.value ?? "";
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
    (panel ?? document).querySelectorAll<HTMLElement>(".prep-curate-diag-rule-chip").forEach(chip => {
      chip.classList.toggle("active", chip.dataset.ruleLabel === label);
    });
    // Auto-select first item in filtered set (or reset nav buttons)
    if (filtered.length > 0) {
      this._setActiveDiffItem(0, panel);
    } else {
      const posEl = (panel ?? this._root)?.querySelector<HTMLElement>("#act-diff-position")
        ?? this._q<HTMLElement>("#act-diff-position");
      if (posEl) posEl.textContent = label ? "0 modif." : "—";
      [(panel ?? this._root)?.querySelector<HTMLButtonElement>("#act-diff-prev"),
       (panel ?? this._root)?.querySelector<HTMLButtonElement>("#act-diff-next")].forEach(btn => {
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
    const el = this._q<HTMLElement>("#act-curate-sample-info");
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
      ?? this._q<HTMLElement>("#act-curate-filter-badge");
    const labelEl = scope.querySelector<HTMLElement>("#act-curate-filter-label")
      ?? this._q<HTMLElement>("#act-curate-filter-label");
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
    const scope: Element | Document = panel ?? this._root ?? document;

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
      p.classList.toggle("prep-raw-active", p.dataset.diffIdx === String(idx));
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
    const posEl = scope.querySelector<HTMLElement>("#act-diff-position") ?? this._q<HTMLElement>("#act-diff-position");
    if (posEl) posEl.textContent = total > 0 && idx !== null ? `${idx + 1} / ${total}${filterSuffix}` : total > 0 ? `${total} modif.` : "—";

    const prevBtn = scope.querySelector<HTMLButtonElement>("#act-diff-prev") ?? this._q<HTMLButtonElement>("#act-diff-prev");
    const nextBtn = scope.querySelector<HTMLButtonElement>("#act-diff-next") ?? this._q<HTMLButtonElement>("#act-diff-next");
    if (prevBtn) prevBtn.disabled = idx === null || idx <= 0;
    if (nextBtn) nextBtn.disabled = idx === null || idx >= total - 1;

    // Update preview-info header
    const infoEl = this._q<HTMLElement>("#act-preview-info");
    if (infoEl && total > 0 && idx !== null) {
      infoEl.textContent = `Modif. ${idx + 1}/${total}${filterSuffix}`;
    }

    // Reflect active item's status in action buttons
    this._updateActionButtons();

    // Update context detail card for the active example
    const activeEx = idx !== null ? this._filteredExamples()[idx] ?? null : null;
    this._renderContextDetail(activeEx);
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

    const raw = (this._q("#act-curate-rules") as HTMLTextAreaElement | null)?.value ?? "";
    rules.push(...this._parseAdvancedCurateRules(raw));
    rules.push(...this._frExtraRules);
    return rules;
  }

  private _currentCurateDocId(): number | undefined {
    const v = (this._q("#act-curate-doc") as HTMLSelectElement)?.value;
    return v ? parseInt(v) : undefined;
  }

  private _curateDocIndex(docId: number | undefined): number {
    if (docId === undefined) return -1;
    return this._docs.findIndex((d) => d.doc_id === docId);
  }

  private _refreshCurateHeaderState(): void {
    const docLabelEl = this._q<HTMLElement>("#act-curate-doc-label");
    const modePillEl = this._q<HTMLElement>("#act-curate-mode-pill");
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
    const queueEl = this._q<HTMLElement>("#act-curate-queue");
    const prevBtn = this._q<HTMLButtonElement>("#act-curate-prev-btn");
    const nextBtn = this._q<HTMLButtonElement>("#act-curate-next-btn");
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
        <div class="prep-curate-qitem">
          <div class="prep-curate-qmeta"><span>File locale</span><span>${this._docs.length} doc(s)</span></div>
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
        <div class="prep-curate-qitem${idx === currentIdx ? " prep-curate-log-apply" : ""}">
          <div class="prep-curate-qmeta"><span>#${doc.doc_id} · ${_escHtml(doc.language)}</span><span>${state}</span></div>
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
    const bottomPanel = this._q<HTMLDetailsElement>("#act-curate-bottom-panel");
    if (bottomPanel && !bottomPanel.open) bottomPanel.open = true;
    this._renderCurateLog();
  }

  private _renderCurateLog(): void {
    const el = this._q<HTMLElement>("#act-curate-review-log");
    if (!el) return;
    if (this._curateLog.length === 0) {
      el.innerHTML = `<p class="empty-hint" style="padding:10px">Aucune action enregistr&#233;e.</p>`;
      return;
    }
    const now = Date.now();
    el.innerHTML = this._curateLog.map(entry => {
      const diffS = Math.round((now - entry.ts) / 1000);
      const age = diffS < 60 ? `il y a ${diffS} s` : new Date(entry.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      const kindClass = entry.kind === "warn" ? "prep-curate-log-warn" : entry.kind === "apply" ? "prep-curate-log-apply" : "";
      return `<div class="prep-curate-qitem ${kindClass}">` +
        `<div class="prep-curate-qmeta"><span>${entry.kind === "preview" ? "Prévisu" : entry.kind === "apply" ? "Application" : "⚠"}</span><span>${age}</span></div>` +
        `<div>${_escHtml(entry.msg)}</div>` +
        `</div>`;
    }).join("");
  }

  /** Update the 2×2 context info row in the left col when doc selection changes. */
  private _updateCurateCtx(): void {
    const el = this._q<HTMLElement>("#act-curate-ctx");
    if (!el) return;
    const docId = this._currentCurateDocId();
    const doc = docId !== undefined ? this._docs.find(d => d.doc_id === docId) : undefined;
    const pivotLabel = !doc ? "fr" : (doc.language?.toLowerCase() === "fr" ? "Fran&#231;ais (VO)" : _escHtml(doc.language ?? "fr"));
    const packLabel = "&#8212;";
    const scopeLabel = doc ? "Document s&#233;lectionn&#233;" : "Document complet";
    const liveLabel = "Actif";
    el.innerHTML =
      `<div class="f prep-curate-ctx-cell"><strong>Langue pivot</strong>${pivotLabel}</div>` +
      `<div class="f prep-curate-ctx-cell"><strong>Pack</strong>${packLabel}</div>` +
      `<div class="f prep-curate-ctx-cell"><strong>Port&#233;e</strong>${scopeLabel}</div>` +
      `<div class="f prep-curate-ctx-cell"><strong>Aper&#231;u live</strong>${liveLabel}</div>`;
    this._refreshCurateHeaderState();
    this._renderCurateQuickQueue();
  }

  private _populateSelects(): void {
    const allDocSelects = ["act-curate-doc", "act-align-pivot",
      "act-align-targets", "act-meta-doc", "act-audit-pivot", "act-audit-target",
      "act-quality-pivot", "act-quality-target",
      "act-coll-pivot", "act-coll-target"];
    allDocSelects.forEach(id => {
      const sel = this._q(`#${id}`) as HTMLSelectElement | null;
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
      this._curationView?.populateSelects();
      this._updateCurateCtx();
      this._setButtonsEnabled(true);
      this._loadAlignDocsIntoSelects();
      this._alignPanel?.refreshDocs();
      this._segmentationView?.refreshDocs();
      this._log(`${this._docs.length} document(s) chargé(s).`);
      this._refreshRuntimeState();
    } catch (err) {
      this._log(`Erreur chargement docs : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._refreshRuntimeState();
    }
  }

  private _renderDocList(): void {
    const el = this._q("#act-doc-list");
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
    const infoEl = this._q("#act-preview-info");
    if (infoEl) infoEl.textContent = "Chargement…";
    const rawEl = this._q("#act-preview-raw");
    if (rawEl) rawEl.innerHTML = `<p class="loading-hint">Prévisualisation en cours…</p>`;
    const diffEl0 = this._q("#act-diff-list");
    if (diffEl0) diffEl0.innerHTML = "";

    // Ensure all units are loaded in parallel with the preview request
    if (this._allUnitsDocId !== docId) {
      void this._loadAllUnits(docId);
    }

    try {
      const res = await curatePreview(this._conn, {
        doc_id: docId,
        rules,
        limit_examples: CURATE_PREVIEW_LIMIT,
        ...(this._forcedPreviewUnitId !== null ? { force_unit_id: this._forcedPreviewUnitId } : {}),
      });
      this._forcedPreviewUnitId = null; // reset after use

      // Stats banner (footer)
      const statsEl = this._q("#act-preview-stats");
      const changed = res.stats.units_changed;
      const total = res.stats.units_total;
      const reps = res.stats.replacements_total;
      this._hasPendingPreview = changed > 0;
      if (statsEl) statsEl.innerHTML = changed === 0
        ? `<span class="prep-stat-ok">✓ Aucune modification prévue (${total} unités analysées).</span>`
        : `<span class="prep-stat-warn">⚠ ${changed}/${total} unité(s) modifiée(s), ${reps} remplacement(s).</span>`;

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
      const panel = this._q<HTMLElement>("#act-preview-panel");
      this._updateFilterBadge(panel);
      this._updateSampleInfo();
      this._updateSessionSummary();

      // Show action bar when there are examples to review
      const actionBar = this._q<HTMLElement>("#act-curate-action-bar");
      if (actionBar) actionBar.style.display = toRender.length > 0 ? "" : "none";
      this._updateActionButtons();

      // Auto-select first diff item if any
      if (toRender.length > 0) {
        this._setActiveDiffItem(0, panel ?? undefined);
      }

      // Minimap
      this._renderCurateMinimap(res.examples.length, total);

      // Show / hide apply button
      const applyBtn = this._q<HTMLButtonElement>("#act-apply-after-preview-btn");
      if (applyBtn) applyBtn.style.display = changed > 0 ? "" : "none";
      // Show review export card as soon as we have a loaded sample.
      const reviewExportCard = this._q<HTMLElement>("#act-review-export-card");
      if (reviewExportCard) reviewExportCard.style.display = "";
      const reindexBtn = this._q<HTMLElement>("#act-reindex-after-curate-btn");
      if (reindexBtn) reindexBtn.style.display = "none";

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
            const statsEl = this._q("#act-preview-stats");
            if (statsEl) {
              const cur = statsEl.innerHTML;
              statsEl.innerHTML = cur + ` <span class="prep-stat-exc">🔒 ${excIgnored} unité(s) silencée(s) par exception persistée.</span>`;
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
      const rawElErr = this._q("#act-preview-raw");
      if (rawElErr) rawElErr.innerHTML = `<p class="prep-diag-v warn" style="margin:0"><strong>Erreur prévisualisation</strong>${_escHtml(msg)}</p>`;
      if (!silent) {
        this._log(`✗ Prévisualisation : ${msg}`, true);
        this._pushCurateLog("warn", `Erreur prévisu : ${msg}`);
      }
    }
    this._setBusy(false);
    this._refreshRuntimeState();
  }

  private _renderSegBatchOverview(): void {
    const listEl = this._q("#act-seg-batch-list");
    const infoEl = this._q("#act-seg-batch-info");
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

  private _renderCurateDiag(changed: number, total: number, replacements: number): void {
    const diagEl = this._q<HTMLElement>("#act-curate-diag");
    if (!diagEl) return;

    if (changed === 0) {
      diagEl.innerHTML = `<div class="prep-curate-diag"><strong>✓ Aucune modification</strong>${total} unités analysées, corpus propre.</div>`;
    } else {
      const shown = this._curateExamples.length;
      const isTruncated = shown < this._curateGlobalChanged;
      const ruleStats = this._getRuleStats(); // label → count (within sample only)

      // Truncation notice: shown when the sample doesn't cover all real changes.
      // We can confirm truncation (shown < changed) but cannot state the exact total per rule.
      const truncationHtml = isTruncated
        ? `<div class="prep-curate-diag curate-diag-notice">
             &#9432;&#160;Preview limit&#233;e &#224; ${shown}&#160;exemples sur&#160;${this._curateGlobalChanged} modifications r&#233;elles.
             Les compteurs par r&#232;gle ci-dessous concernent uniquement l&#8217;&#233;chantillon affich&#233;.
           </div>`
        : "";

      // Build per-rule clickable chips with explicit scope annotation
      let ruleChipsHtml = "";
      if (ruleStats.size > 0) {
        const scopeNote = isTruncated
          ? `<span class="prep-diag-scope-note">dans l&#8217;&#233;chantillon courant</span>`
          : "";
        const chipsInner = [...ruleStats.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) =>
            `<span class="chip prep-curate-diag-rule-chip" data-rule-label="${_escHtml(label)}" role="button" tabindex="0"` +
            ` title="Filtrer sur : ${_escHtml(label)}${isTruncated ? " (dans l\u2019\u00e9chantillon courant)" : ""}"` +
            `>${_escHtml(label)}<span class="prep-diag-rule-count">${count}</span></span>`
          ).join("");
        ruleChipsHtml = `
          <div class="prep-curate-diag curate-diag-rules">
            <strong>Filtrer par r&#232;gle</strong>${scopeNote}
            <div class="chip-row prep-diag-rule-chips" style="margin-top:5px">${chipsInner}</div>
          </div>`;
      }

      diagEl.innerHTML = `
        <div class="prep-curate-diag warn curate-diag-summary">
          <strong>${changed} unit&#233;(s) modifi&#233;e(s)</strong>
          ${replacements} remplacement(s) sur ${total} unit&#233;s.
        </div>
        ${shown > 0 ? `<div class="prep-curate-diag curate-diag-action" id="act-diag-goto-first" role="button" tabindex="0">
          <strong>&#8594; Premi&#232;re modification</strong>
          <span style="font-size:11px;color:var(--prep-muted)">${shown} exemple(s) &#8212; cliquer pour naviguer</span>
        </div>` : ""}
        ${truncationHtml}
        ${ruleChipsHtml}
        <div class="prep-curate-diag">
          <strong>Impact segmentation</strong>
          V&#233;rifiez la preview avant d&#8217;appliquer.
        </div>
      `;

      // Jump-to-first listener
      if (shown > 0) {
        const gotoBtn = diagEl.querySelector<HTMLElement>("#act-diag-goto-first");
        gotoBtn?.addEventListener("click", () => {
          const panel = this._q<HTMLElement>("#act-preview-panel") ?? undefined;
          this._setRuleFilter(null, panel);
          this._q("#act-diff-list")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
        gotoBtn?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") gotoBtn.click(); });
      }

      // Per-rule chip filter listeners
      diagEl.querySelectorAll<HTMLElement>(".prep-curate-diag-rule-chip").forEach(chip => {
        const label = chip.dataset.ruleLabel ?? "";
        const activate = () => {
          const panel = this._q<HTMLElement>("#act-preview-panel") ?? undefined;
          // Toggle: clicking the active filter clears it
          this._setRuleFilter(this._activeRuleFilter === label ? null : label, panel);
        };
        chip.addEventListener("click", activate);
        chip.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") activate(); });
      });
    }

    // Show "Voir segmentation" link if a segmentation report exists
    const segLinkEl = this._q<HTMLElement>("#act-curate-seg-link");
    if (segLinkEl) {
      if (this._lastSegmentReport) {
        const r = this._lastSegmentReport;
        segLinkEl.style.display = "";
        segLinkEl.innerHTML = `
          <button class="prep-acts-hub-head-link" data-action="goto-seg" style="font-size:11.5px">
            &#9654; Voir segmentation (${r.units_output} unités${r.warnings?.length ? ` · ${r.warnings.length} avertissements` : ""})
          </button>`;
      } else {
        segLinkEl.style.display = "none";
      }
    }
  }

  private _renderCurateMinimap(changed: number, total: number): void {
    const mm = this._q("#act-curate-minimap");
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
      // If all units are loaded for this doc, render the full text in the raw pane
      if (this._allUnitsDocId === docId && this._allUnits.length > 0) {
        this._renderRawPaneFull();
        // Also update the diff pane (no changes to show)
        const diffEl = this._q<HTMLElement>("#act-diff-list");
        if (diffEl) {
          diffEl.innerHTML =
            `<div class="prep-stat-ok" style="margin-bottom:8px;font-size:13px">` +
            `&#10003;&#160;Aucune diff&#233;rence &#8212; texte cur&#233; identique au source.</div>`;
        }
      } else {
        void this._fillCuratePanesWithDocumentText(docId);
      }
      return;
    }
    // Raw pane: if full units are loaded, render the full doc with changed units highlighted
    if (this._allUnitsDocId === docId && this._allUnits.length > 0 && this._previewMode !== "diffonly") {
      const changedIds = new Set(filtered.map(ex => ex.unit_id));
      this._renderRawPaneFull(changedIds);
    } else {
      this._renderRawPane(filtered);
    }
    this._renderDiffList(filtered);
  }

  private async _fillCuratePanesWithDocumentText(docId: number): Promise<void> {
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    const diffEl = this._q<HTMLElement>("#act-diff-list");
    if (!this._conn || !rawEl || !diffEl) return;
    delete rawEl.dataset.fullText; // this path uses limited preview (not full text)
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
        `<div class="prep-stat-ok" style="margin-bottom:8px;font-size:13px">` +
        `&#10003;&#160;Aucune modification &#8212; le document est propre avec ces r&#232;gles.</div>`;
      const bannerDiff =
        `<div class="prep-stat-ok" style="margin-bottom:8px;font-size:13px">` +
        `&#10003;&#160;Aucune diff&#233;rence &#8212; texte cur&#233; identique au source.</div>`;
      const truncNote = preview.total_lines > preview.limit
        ? `<p class="empty-hint" style="margin:4px 0 8px;font-style:italic">` +
          `Aper&#231;u &#8212; ${preview.limit}/${preview.total_lines} unit&#233;s</p>`
        : "";
      const linesHtml = preview.lines.map(l =>
        `<div class="prep-vo-line"><span class="prep-vo-ln">${l.n}</span><span class="prep-vo-txt">${_escHtml(l.text)}</span></div>`,
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
    const el = this._q<HTMLElement>("#act-preview-raw");
    if (!el) return;
    // Clear full-text flag so scroll sync re-enables
    delete el.dataset.fullText;
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
        this._setRuleFilter(null, this._q<HTMLElement>("#act-preview-panel"));
      });
      return;
    }
    el.innerHTML = "";
    examples.forEach((ex, i) => {
      const p = document.createElement("p");
      p.dataset.diffIdx = String(i);
      p.className = "prep-raw-unit";
      // Primary label from first matched rule (if available)
      const firstLabel = (ex.matched_rule_ids ?? []).length > 0
        ? (this._curateRuleLabels[ex.matched_rule_ids![0]] ?? "")
        : "";
      // Status class for raw pane
      const st = ex.status ?? "pending";
      if (st !== "pending") p.classList.add(`raw-${st}`);
      if (firstLabel) {
        const badge = document.createElement("span");
        badge.className = "prep-raw-rule-badge";
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
    const el = this._q<HTMLElement>("#act-diff-list");
    if (!el) return;
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
        this._setRuleFilter(null, this._q<HTMLElement>("#act-preview-panel"));
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
        ? ruleLabels.map(l => `<span class="prep-diff-rule-badge">${_escHtml(l)}</span>`).join(" ")
        : `<span class="prep-diff-rule-badge prep-diff-rule-badge-unknown">—</span>`;
      // Apply status class so CSS can show accepted/ignored state
      const st = ex.status ?? "pending";
      if (st !== "pending") tr.classList.add(`diff-${st}`);
      // Status badge (only for non-pending, to avoid clutter)
      const statusBadgeHtml = st !== "pending"
        ? `<span class="prep-diff-status-badge prep-diff-status-${st}" title="${_escHtml(ActionsScreen._STATUS_LABEL[st] ?? st)}">${st === "accepted" ? "✓" : "✗"}</span>`
        : "";
      // Override badge (Level 7A)
      const overrideBadgeHtml = ex.is_manual_override
        ? `<span class="prep-diff-override-badge" title="Modifié manuellement">✏</span>`
        : "";
      // Exception badge (Level 7B)
      const exceptionBadgeHtml = (ex.is_exception_ignored || ex.is_exception_override)
        ? `<span class="prep-diff-exception-badge" title="${ex.is_exception_ignored ? "Exception persistée : ignoré durablement" : "Exception persistée : override durable"}">🔒</span>`
        : "";
      // Forced-unit badge (Level 8C)
      const forcedReason = ex.preview_reason;
      const forcedBadgeHtml = forcedReason && forcedReason !== "standard"
        ? `<span class="prep-diff-forced-badge prep-diff-forced-${forcedReason}" title="${
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
      // P4: "before" hint above the diff — only when before !== after (no-op rows excluded)
      const showBefore = ex.before !== effectiveAfter;
      const beforeHtml = showBefore
        ? `<span class="prep-diff-before-hint">${_renderSpecialChars(_escHtml(ex.before))}</span>`
        : "";
      tr.innerHTML =
        `<td class="prep-diff-extid">${ex.external_id ?? i + 1}${statusBadgeHtml}${overrideBadgeHtml}${exceptionBadgeHtml}${forcedBadgeHtml}</td>` +
        `<td class="prep-diff-rule-cell">${ruleBadgeHtml}</td>` +
        `<td class="diff-after${ex.is_manual_override ? " prep-diff-after-overridden" : ""}">${beforeHtml}${_highlightChanges(ex.before, effectiveAfter)}</td>`;
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

  // ─── Convention management ────────────────────────────────────────────────

  /** Render the convention list rows inside #act-conventions-list. */
  private _renderConventionsList(): void {
    const listEl = this._q<HTMLElement>("#act-conventions-list");
    if (!listEl) return;
    if (this._conventions.length === 0) {
      listEl.innerHTML = '<p class="prep-conv-empty">Aucune convention définie.</p>';
      return;
    }
    listEl.innerHTML = "";
    this._conventions.forEach(conv => {
      const row = document.createElement("div");
      row.className = "conv-row";
      row.dataset.convName = conv.name;

      // Color swatch — click to edit color inline
      const swatch = document.createElement("input");
      swatch.type = "color";
      swatch.className = "conv-swatch";
      swatch.value = conv.color ?? "#6366f1";
      swatch.title = "Cliquer pour modifier la couleur";
      swatch.addEventListener("change", () => {
        void this._conventionUpdate(conv.name, { color: swatch.value });
      });

      // Label — dblclick to edit inline
      const labelEl = document.createElement("span");
      labelEl.className = "conv-label";
      labelEl.textContent = conv.label || conv.name;
      labelEl.title = "Double-cliquer pour modifier le label";
      labelEl.addEventListener("dblclick", () => this._conventionEditLabel(row, conv));

      // Name badge
      const nameBadge = document.createElement("code");
      nameBadge.className = "conv-name-badge";
      nameBadge.textContent = conv.name;

      // Delete button
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-ghost btn-xs prep-conv-del-btn";
      delBtn.textContent = "Supprimer";
      delBtn.title = "Supprimer cette convention (les unités assignées perdent ce rôle)";
      delBtn.addEventListener("click", () => void this._conventionDelete(conv.name, row));

      row.appendChild(swatch);
      row.appendChild(labelEl);
      row.appendChild(nameBadge);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });
  }

  /** Inline label editing on dblclick. */
  private _conventionEditLabel(row: HTMLElement, conv: ConventionRole): void {
    const labelEl = row.querySelector<HTMLElement>(".prep-conv-label");
    if (!labelEl || row.classList.contains("prep-conv-row-editing")) return;
    row.classList.add("prep-conv-row-editing");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "prep-conv-input prep-conv-label-edit";
    input.value = conv.label || conv.name;
    input.maxLength = 64;
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    let saved = false;
    const save = async () => {
      if (saved) return;
      saved = true;
      const newLabel = input.value.trim();
      if (newLabel && newLabel !== conv.label) {
        await this._conventionUpdate(conv.name, { label: newLabel });
      } else {
        this._renderConventionsList();
      }
    };
    input.addEventListener("blur", () => void save());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); void save(); }
      if (e.key === "Escape") { saved = true; row.classList.remove("prep-conv-row-editing"); this._renderConventionsList(); }
    });
  }

  /** Delete a convention with inline confirmation banner. */
  private async _conventionDelete(name: string, rowEl: HTMLElement): Promise<void> {
    if (!this._conn) return;
    // Inline confirmation in the row
    const existing = rowEl.querySelector(".prep-conv-del-confirm");
    if (existing) return; // already showing confirm
    const confirm = document.createElement("span");
    confirm.className = "conv-del-confirm";
    confirm.innerHTML =
      `<span class="prep-conv-del-warn">Supprimer ? Les unités assignées perdront ce rôle.</span>` +
      `<button class="btn btn-danger btn-xs prep-conv-del-confirm-yes">Confirmer</button>` +
      `<button class="btn btn-ghost btn-xs prep-conv-del-confirm-no">Annuler</button>`;
    rowEl.appendChild(confirm);
    confirm.querySelector(".prep-conv-del-confirm-no")!.addEventListener("click", () => confirm.remove());
    confirm.querySelector(".prep-conv-del-confirm-yes")!.addEventListener("click", async () => {
      if (!this._conn) return;
      try {
        await deleteConvention(this._conn, name);
        this._conventions = this._conventions.filter(c => c.name !== name);
        this._renderConventionsList();
        // Update raw pane badges
        this._allUnits = this._allUnits.map(u =>
          u.unit_role === name ? { ...u, unit_role: null } : u
        );
        if (this._allUnits.length > 0 && this._previewMode !== "diffonly") {
          const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
          this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
        }
        this._log(`Convention « ${name} » supprimée.`);
      } catch (err) {
        this._log(`Erreur suppression convention : ${err instanceof Error ? err.message : String(err)}`, true);
      }
    });
  }

  /** Update label, color or other fields of a convention. */
  private async _conventionUpdate(
    name: string,
    patch: { label?: string; color?: string; icon?: string; sort_order?: number },
  ): Promise<void> {
    if (!this._conn) return;
    try {
      const updated = await updateConvention(this._conn, name, patch);
      this._conventions = this._conventions.map(c => c.name === name ? updated : c);
      this._renderConventionsList();
      // Re-render badges in raw pane (color/label may have changed)
      if (this._allUnits.length > 0 && this._previewMode !== "diffonly") {
        const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
        this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
      }
    } catch (err) {
      this._log(`Erreur mise à jour convention : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  /** Load convention roles once per connection. Silent on error. */
  private async _loadConventions(): Promise<void> {
    if (!this._conn) return;
    try {
      this._conventions = await listConventions(this._conn);
    } catch {
      this._conventions = [];
    }
    // Populate the conventions management panel
    this._renderConventionsList();
    // If the raw pane is already rendered, rebuild the role bar with the loaded options
    if (this._allUnits.length > 0 && this._previewMode !== "diffonly") {
      const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
      this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
    }
  }

  /**
   * Assign (or clear) a role on all currently selected units.
   * Updates _allUnits locally — no re-fetch needed.
   */
  private async _applyRoleToSelected(role: string | null): Promise<void> {
    if (!this._conn || this._selectedUnitNs.size === 0) return;
    const docId = this._currentCurateDocId();
    if (docId === undefined) return;
    const unitNs = [...this._selectedUnitNs];
    try {
      await bulkSetRole(this._conn, docId, unitNs, role);
    } catch (err) {
      this._log(`Erreur assignation rôle : ${err instanceof Error ? err.message : String(err)}`, true);
      return;
    }
    // Update local cache without re-fetch
    const nsSet = new Set(unitNs);
    this._allUnits = this._allUnits.map(u =>
      nsSet.has(u.n) ? { ...u, unit_role: role } : u
    );
    // Clear selection
    this._selectedUnitNs = new Set();
    this._lastSelectedN = null;
    // Re-render with current changed IDs intact
    const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
    this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
    this._log(`Rôle ${role ? `«\u00a0${role}\u00a0»` : "effacé"} assigné à ${unitNs.length} unité(s).`);
  }

  /**
   * Toggle selection of unit n in the raw pane.
   * If shiftKey and _lastSelectedN is set, selects the full range.
   */
  private _toggleUnitSelection(n: number, shiftKey: boolean): void {
    if (shiftKey && this._lastSelectedN !== null) {
      const lo = Math.min(n, this._lastSelectedN);
      const hi = Math.max(n, this._lastSelectedN);
      // All ns in range that exist in _allUnits
      for (const u of this._allUnits) {
        if (u.n >= lo && u.n <= hi) this._selectedUnitNs.add(u.n);
      }
    } else {
      if (this._selectedUnitNs.has(n)) {
        this._selectedUnitNs.delete(n);
      } else {
        this._selectedUnitNs.add(n);
      }
    }
    this._lastSelectedN = n;
    this._updateRoleBar();
    // Refresh selection state on the existing DOM without full re-render
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    if (!rawEl) return;
    rawEl.querySelectorAll<HTMLElement>(".prep-raw-unit-full").forEach(p => {
      const pn = Number(p.dataset.unitN);
      p.classList.toggle("prep-raw-unit-selected", this._selectedUnitNs.has(pn));
    });
  }

  /** Show/hide and populate the role assignment bar. */
  private _updateRoleBar(): void {
    const bar = this._q<HTMLElement>(".prep-raw-role-bar");
    if (!bar) return;
    const count = this._selectedUnitNs.size;
    if (count === 0) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "";
    const countEl = bar.querySelector<HTMLElement>(".prep-raw-role-bar-count");
    if (countEl) countEl.textContent = `${count} unité(s) sélectionnée(s)`;
  }

  /**
   * Render the role assignment bar HTML into the raw pane wrapper.
   * Called once when the raw pane is first rendered.
   */
  private _renderRoleBar(container: HTMLElement): void {
    // Remove existing bar if any
    container.querySelector(".prep-raw-role-bar")?.remove();
    const bar = document.createElement("div");
    bar.id = "raw-role-bar";
    bar.className = "prep-raw-role-bar";
    bar.style.display = "none";
    const roleOptions = this._conventions.map(r =>
      `<option value="${_escHtml(r.name)}">${_escHtml(r.label || r.name)}</option>`
    ).join("");
    bar.innerHTML =
      `<span class="prep-raw-role-bar-count"></span>` +
      `<label class="prep-raw-role-bar-label">Assigner&nbsp;:</label>` +
      `<select id="raw-role-select" class="prep-raw-role-select">` +
        `<option value="">— choisir un rôle —</option>` +
        roleOptions +
      `</select>` +
      `<button id="raw-role-assign-btn" class="btn btn-primary btn-xs">Assigner</button>` +
      `<button id="raw-role-clear-btn" class="btn btn-secondary btn-xs">Effacer le rôle</button>` +
      `<button id="raw-role-deselect-btn" class="btn btn-ghost btn-xs">✕ Désélectionner</button>`;
    bar.querySelector("#raw-role-assign-btn")!.addEventListener("click", () => {
      const sel = bar.querySelector<HTMLSelectElement>("#raw-role-select");
      const role = sel?.value || null;
      if (!role) { this._log("Sélectionnez un rôle à assigner.", true); return; }
      void this._applyRoleToSelected(role);
    });
    bar.querySelector("#raw-role-clear-btn")!.addEventListener("click", () => {
      void this._applyRoleToSelected(null);
    });
    bar.querySelector("#raw-role-deselect-btn")!.addEventListener("click", () => {
      this._selectedUnitNs = new Set();
      this._lastSelectedN = null;
      this._updateRoleBar();
      container.querySelectorAll<HTMLElement>(".prep-raw-unit-selected").forEach(p =>
        p.classList.remove("prep-raw-unit-selected")
      );
    });
    // Insert before the scrollable list
    container.insertBefore(bar, container.firstChild);
  }

  private async _loadAllUnits(docId: number): Promise<void> {
    if (!this._conn) return;
    if (this._allUnitsDocId === docId) return; // already loaded
    this._allUnits = [];
    this._allUnitsDocId = null;
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    if (rawEl && this._previewMode === "rawonly") {
      rawEl.innerHTML = '<p class="loading-hint">Chargement du texte&#8230;</p>';
    }
    try {
      this._allUnits = await listUnits(this._conn, docId);
      this._allUnitsDocId = docId;
    } catch {
      if (rawEl && this._previewMode === "rawonly") {
        rawEl.innerHTML = '<p class="empty-hint">Impossible de charger le texte.</p>';
      }
      return;
    }
    if (this._previewMode === "rawonly") {
      // Include any already-loaded preview changed IDs so highlights are correct
      // even when _loadAllUnits completes after curatePreview.
      const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
      this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
    }
  }

  /**
   * Render the raw pane with ALL units for the current document.
   * changedUnitIds (optional): set of unit_ids that have preview changes — shown with a highlight.
   */
  private _renderRawPaneFull(changedUnitIds?: Set<number>): void {
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    if (!rawEl) return;
    if (this._allUnits.length === 0) {
      rawEl.innerHTML = '<p class="empty-hint">Aucune unit&#233; disponible pour ce document.</p>';
      return;
    }
    // Build a map from unit_id → diff index, for click navigation
    const filtered = this._filteredExamples();
    const unitIdToDiffIdx = new Map<number, number>();
    filtered.forEach((ex, i) => unitIdToDiffIdx.set(ex.unit_id, i));

    // Build a lookup: role name → ConventionRole (for badge color)
    const roleMap = new Map(this._conventions.map(r => [r.name, r]));

    rawEl.innerHTML = "";
    rawEl.dataset.fullText = "1";

    // Resolve text_start_n from current document record
    const curateDocId = this._currentCurateDocId();
    const textStartN: number | null =
      (curateDocId !== undefined
        ? (this._docs.find(d => d.doc_id === curateDocId)?.text_start_n ?? null)
        : null);

    // Render role assignment bar (sticky, above the list)
    this._renderRoleBar(rawEl);

    this._allUnits.forEach(unit => {
      // Insert separator before the first text unit (when boundary is set)
      if (textStartN !== null && unit.n === textStartN) {
        rawEl.appendChild(this._renderTextStartSeparator(textStartN));
      }

      const p = document.createElement("p");
      p.className = "prep-raw-unit raw-unit-full";
      p.dataset.unitId = String(unit.unit_id);
      p.dataset.unitN = String(unit.n);

      // Mark paratext units
      if (textStartN !== null && unit.n < textStartN) {
        p.classList.add("prep-raw-unit-paratext");
      }

      const hasOverride = this._allOverrides.has(unit.unit_id);
      const isChanged = changedUnitIds?.has(unit.unit_id);
      const isSelected = this._selectedUnitNs.has(unit.n);
      const role = unit.unit_role;
      const conv = role ? roleMap.get(role) : undefined;

      if (hasOverride) p.classList.add("prep-raw-unit-overridden");
      if (isChanged)   p.classList.add("prep-raw-unit-changed");
      if (isSelected)  p.classList.add("prep-raw-unit-selected");
      if (role)        p.classList.add("prep-raw-unit-has-role");

      // Line number — when no boundary is set, click defines this unit as text start
      const ln = document.createElement("span");
      ln.className = "prep-vo-ln";
      ln.textContent = String(unit.n);
      if (textStartN === null && this._currentCurateDocId() !== undefined && unit.n > 1) {
        ln.classList.add("prep-vo-ln-settable");
        ln.title = `Cliquer pour définir l'unité ${unit.n} comme début du texte`;
        ln.addEventListener("click", (e) => {
          e.stopPropagation();
          // Ignore click when in role-selection mode
          if (this._selectedUnitNs.size > 0) return;
          if (unit.n === 1) return; // n=1 would mean no paratext — use ✕ on separator
          // Inline confirm banner at the top of the raw pane
          const rawEl2 = this._q<HTMLElement>("#act-preview-raw");
          if (!rawEl2) return;
          const existing = rawEl2.querySelector(".prep-raw-tsn-confirm");
          if (existing) { existing.remove(); return; } // toggle off on second click
          const banner = document.createElement("div");
          banner.className = "prep-raw-tsn-confirm";
          const paraCount = unit.n - 1;
          banner.innerHTML =
            `<span>Définir l'unité ${unit.n} comme début du texte ? ` +
            `${paraCount > 0 ? `Les ${paraCount} unité(s) précédente(s) seront marquées comme paratexte.` : ""}</span>` +
            `<button class="btn btn-primary btn-xs">Confirmer</button>` +
            `<button class="btn btn-ghost btn-xs">Annuler</button>`;
          rawEl2.insertBefore(banner, rawEl2.querySelector(".prep-raw-role-bar")?.nextSibling ?? rawEl2.firstChild);
          const [confirmBtn, cancelBtn] = banner.querySelectorAll("button");
          cancelBtn.addEventListener("click", () => banner.remove(), { once: true });
          confirmBtn.addEventListener("click", () => { banner.remove(); void this._setTextStart(unit.n); }, { once: true });
          confirmBtn.focus();
        });
      }
      p.appendChild(ln);

      // Convention role badge
      if (conv) {
        const roleBadge = document.createElement("span");
        roleBadge.className = "prep-raw-role-badge";
        roleBadge.textContent = conv.label || conv.name;
        roleBadge.title = `Rôle : ${conv.label || conv.name}`;
        if (conv.color) roleBadge.style.setProperty("--role-color", conv.color);
        p.appendChild(roleBadge);
        p.appendChild(document.createTextNode(" "));
      }

      // Override badge
      if (hasOverride) {
        const badge = document.createElement("span");
        badge.className = "prep-raw-override-badge";
        badge.textContent = "✏";
        badge.title = "Modifié manuellement";
        p.appendChild(badge);
        p.appendChild(document.createTextNode(" "));
      }

      // Text content (override wins)
      const displayText = this._allOverrides.get(unit.unit_id) ?? unit.text_norm ?? "";
      p.appendChild(document.createTextNode(displayText));

      // Tag changed units with data-diff-idx so _setActiveDiffItem can scroll them
      if (isChanged) {
        const diffIdx = unitIdToDiffIdx.get(unit.unit_id);
        if (diffIdx !== undefined) p.dataset.diffIdx = String(diffIdx);
      }

      // Click: role selection (shift=range) — priority over diff navigation
      p.addEventListener("click", (e: MouseEvent) => {
        if (p.classList.contains("prep-raw-unit-editing")) return;
        if ((e.target as HTMLElement).closest(".prep-raw-unit-edit-wrapper")) return;
        // Ctrl/Cmd or Shift → selection mode
        if (e.ctrlKey || e.metaKey || e.shiftKey || this._selectedUnitNs.size > 0) {
          e.preventDefault();
          this._toggleUnitSelection(unit.n, e.shiftKey);
          return;
        }
        // Plain click on changed unit → navigate to diff item
        if (isChanged) {
          const diffIdx = unitIdToDiffIdx.get(unit.unit_id);
          if (diffIdx !== undefined) {
            const panel = p.closest<HTMLElement>("#act-preview-panel") ?? undefined;
            this._setActiveDiffItem(diffIdx, panel);
          }
        }
      });

      // Double-click to edit text inline
      p.addEventListener("dblclick", (e: MouseEvent) => {
        if (this._selectedUnitNs.size > 0) return; // don't edit while selecting
        e.stopPropagation();
        this._enterInlineEdit(p, unit);
      });

      rawEl.appendChild(p);
    });

    // Edge case: text_start_n is set but beyond the last unit — show separator at the end
    if (textStartN !== null && textStartN > (this._allUnits.at(-1)?.n ?? 0)) {
      rawEl.appendChild(this._renderTextStartSeparator(textStartN));
    }

    // Sync role bar visibility
    this._updateRoleBar();
  }

  /**
   * Build the separator element displayed between the paratext zone and the
   * main text zone. Contains ▲▼ buttons to move the boundary by one unit.
   */
  private _renderTextStartSeparator(textStartN: number): HTMLElement {
    const sep = document.createElement("div");
    sep.className = "prep-raw-text-separator";
    sep.dataset.textStartN = String(textStartN);

    const label = document.createElement("span");
    label.className = "prep-raw-text-separator-label";
    label.textContent = `Début du texte (unité ${textStartN})`;
    sep.appendChild(label);

    const btnUp = document.createElement("button");
    btnUp.className = "btn-ghost btn-xs raw-sep-btn";
    btnUp.title = "Reculer la frontière (inclure une unité de plus dans le paratexte)";
    btnUp.textContent = "▲";
    const maxN = this._allUnits.at(-1)?.n ?? 0;
    btnUp.addEventListener("click", (e) => {
      e.stopPropagation();
      const newN = textStartN + 1;
      if (newN <= maxN) void this._setTextStart(newN);
    });

    const btnDown = document.createElement("button");
    btnDown.className = "btn-ghost btn-xs raw-sep-btn";
    btnDown.title = "Avancer la frontière (réduire le paratexte d'une unité)";
    btnDown.textContent = "▼";
    btnDown.addEventListener("click", (e) => {
      e.stopPropagation();
      const newN = textStartN - 1;
      // Stop at 2: moving below 2 would mean no paratext; use ✕ to clear entirely.
      if (newN >= 2) void this._setTextStart(newN);
    });

    const btnClear = document.createElement("button");
    btnClear.className = "btn-ghost btn-xs raw-sep-btn raw-sep-btn-clear";
    btnClear.title = "Supprimer la frontière paratextuelle";
    btnClear.textContent = "✕";
    btnClear.addEventListener("click", (e) => {
      e.stopPropagation();
      // Inline confirmation in the separator
      if (sep.querySelector(".prep-raw-sep-del-confirm")) return;
      const confirmSpan = document.createElement("span");
      confirmSpan.className = "prep-raw-sep-del-confirm";
      confirmSpan.innerHTML =
        `<span class="prep-conv-del-warn">Supprimer la frontière ?</span>` +
        `<button class="btn btn-danger btn-xs">Confirmer</button>` +
        `<button class="btn btn-ghost btn-xs">Annuler</button>`;
      sep.appendChild(confirmSpan);
      const [confirmBtn, cancelBtn] = confirmSpan.querySelectorAll("button");
      cancelBtn.addEventListener("click", (ev) => { ev.stopPropagation(); confirmSpan.remove(); }, { once: true });
      confirmBtn.addEventListener("click", (ev) => { ev.stopPropagation(); confirmSpan.remove(); void this._setTextStart(null); }, { once: true });
      confirmBtn.focus();
    });

    const controls = document.createElement("span");
    controls.className = "prep-raw-sep-controls";
    controls.appendChild(btnUp);
    controls.appendChild(btnDown);
    controls.appendChild(btnClear);
    sep.appendChild(controls);

    return sep;
  }

  /**
   * Set or clear the paratextual boundary for the current document.
   * Updates the document record locally and re-renders the raw pane.
   */
  private async _setTextStart(n: number | null): Promise<void> {
    if (!this._conn) return;
    const docId = this._currentCurateDocId();
    if (docId === undefined) return;
    try {
      await setTextStart(this._conn, docId, n);
      // Update local doc record so next render uses the new value
      const doc = this._docs.find(d => d.doc_id === docId);
      if (doc) doc.text_start_n = n;
      // Re-render with existing changedIds
      const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
      this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
    } catch (err) {
      this._log(`Erreur lors de la mise à jour de la frontière : ${err}`, true);
    }
  }

  /**
   * Enter inline edit mode for a unit in the raw pane.
   * Replaces the <p> content with a textarea + save/cancel controls.
   */
  private _enterInlineEdit(unitEl: HTMLElement, unit: UnitRecord): void {
    if (unitEl.classList.contains("prep-raw-unit-editing")) return; // already editing
    unitEl.classList.add("prep-raw-unit-editing");
    const currentText = this._allOverrides.get(unit.unit_id) ?? unit.text_norm ?? "";
    // Save original content to restore on cancel
    const originalContent = unitEl.innerHTML;
    unitEl.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "prep-raw-unit-edit-wrapper";
    const ta = document.createElement("textarea");
    ta.className = "prep-raw-unit-textarea";
    ta.value = currentText;
    ta.rows = Math.max(2, Math.ceil(currentText.length / 80));
    const actions = document.createElement("div");
    actions.className = "prep-raw-unit-edit-actions";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary btn-xs";
    saveBtn.textContent = "Enregistrer";
    saveBtn.title = "Ctrl+Entrée";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-xs";
    cancelBtn.textContent = "Annuler";
    cancelBtn.title = "Échap";
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    wrapper.appendChild(ta);
    wrapper.appendChild(actions);
    unitEl.appendChild(wrapper);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const save = () => {
      const newText = ta.value;
      unitEl.classList.remove("prep-raw-unit-editing");
      if (newText !== (unit.text_norm ?? "")) {
        this._allOverrides.set(unit.unit_id, newText);
        const docId = this._currentCurateDocId();
        if (docId !== undefined) this._allOverridesDocId = docId;
      } else {
        this._allOverrides.delete(unit.unit_id);
      }
      // Re-render this unit
      const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
      this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
    };
    const cancel = () => {
      unitEl.classList.remove("prep-raw-unit-editing");
      unitEl.innerHTML = originalContent;
      // The dblclick listener is on the element itself (not innerHTML) — still active after restore
    };
    saveBtn.addEventListener("click", save);
    cancelBtn.addEventListener("click", cancel);
    ta.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
  }

  /** Enter inline edit mode for the currently active example. */
  private _enterEditMode(): void {
    this._editingManualOverride = true;
    const filtered = this._filteredExamples();
    const ex = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
    this._renderContextDetail(ex);
    // Auto-focus the textarea after a short tick (DOM needs to be in place)
    setTimeout(() => {
      const ta = this._q<HTMLTextAreaElement>("#act-manual-override-input");
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
    const panel = this._q<HTMLElement>("#act-preview-panel");
    const row = (panel ?? this._root)?.querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
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
    const panel = this._q<HTMLElement>("#act-preview-panel");
    const row = (panel ?? this._root)?.querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
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
      const panel = this._q<HTMLElement>("#act-preview-panel");
      const row = (panel ?? this._root)?.querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
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
      const panel = this._q<HTMLElement>("#act-preview-panel");
      const row = (panel ?? this._root)?.querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
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
      const panel = this._q<HTMLElement>("#act-preview-panel");
      const row = (panel ?? this._root)?.querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
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
    list.innerHTML = `<p class="empty-hint prep-exc-admin-loading">Chargement…</p>`;
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
        docHead.className = "prep-exc-admin-doc-head";
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
    row.className = "prep-exc-admin-row";
    row.dataset.excUnitId = String(exc.unit_id);

    const kindBadge = `<span class="prep-exc-kind-badge exc-kind-${exc.kind}">${exc.kind === "ignore" ? "🚫 ignore" : "✏ override"}</span>`;
    const unitText = exc.unit_text ? `<span class="prep-exc-unit-preview" title="${this._escHtml(exc.unit_text)}">${this._escHtml(exc.unit_text.slice(0, 80))}…</span>` : "";
    const createdAt = exc.created_at ? `<span class="prep-exc-created-at">${exc.created_at.slice(0, 16).replace("T", " ")}</span>` : "";
    // "Voir dans Curation" button — only shown when doc_id is known
    const openBtn = exc.doc_id !== undefined
      ? `<button class="btn btn-sm exc-row-open-curation" title="Voir cette unité dans Curation">&#x1F441;</button>`
      : "";

    const isEditing = this._excAdminEditing === exc.unit_id;

    if (exc.kind === "override" && isEditing) {
      row.innerHTML = `
        <div class="prep-exc-row-meta">
          ${kindBadge}
          <span class="prep-exc-unit-id">unité&nbsp;${exc.unit_id}</span>
          ${createdAt}
        </div>
        ${unitText ? `<div class="prep-exc-unit-preview-block">${unitText}</div>` : ""}
        <div class="prep-exc-row-edit-block">
          <label class="prep-exc-edit-label">Texte override :</label>
          <textarea class="prep-exc-edit-textarea" id="exc-edit-${exc.unit_id}" rows="3">${this._escHtml(exc.override_text ?? "")}</textarea>
          <div class="prep-exc-edit-actions">
            <button class="btn btn-sm btn-primary prep-exc-row-edit-save">Enregistrer</button>
            <button class="btn btn-sm prep-exc-row-edit-cancel">Annuler</button>
          </div>
        </div>`;
    } else {
      const overrideText = exc.kind === "override" && exc.override_text
        ? `<div class="prep-exc-override-text">${this._escHtml(exc.override_text)}</div>`
        : "";
      const editBtn = exc.kind === "override"
        ? `<button class="btn btn-sm prep-exc-row-edit-start" title="Modifier le texte override">✎</button>`
        : "";
      row.innerHTML = `
        <div class="prep-exc-row-meta">
          ${kindBadge}
          <span class="prep-exc-unit-id">unité&nbsp;${exc.unit_id}</span>
          ${createdAt}
          <div class="prep-exc-row-actions">
            ${openBtn}
            ${editBtn}
            <button class="btn btn-sm prep-exc-row-delete" title="Supprimer cette exception">✕</button>
          </div>
        </div>
        ${unitText ? `<div class="prep-exc-unit-preview-block">${unitText}</div>` : ""}
        ${overrideText}`;
    }
    return row;
  }

  /** Helper: escape HTML for safe injection in innerHTML. */
  private _escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private _openExporterWithPrefill(prefill?: ActionsExportPrefill): void {
    if (!this._openExporterTab) {
      this._showToast?.("Onglet Exporter indisponible.", true);
      return;
    }
    this._openExporterTab(prefill);
  }

  private _openAlignmentExportPrefill(): void {
    const pivotRaw = (this._q("#act-align-pivot") as HTMLSelectElement | null)?.value ?? "";
    const pivotId = pivotRaw ? parseInt(pivotRaw, 10) : NaN;
    const targetsSel = this._q("#act-align-targets") as HTMLSelectElement | null;
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

  // ─── Feature 2: Align + Audit ────────────────────────────────────────────

  private async _runAlign(recalculate = false): Promise<void> {
    if (!this._conn) return;
    const pivotSel = (this._q("#act-align-pivot") as HTMLSelectElement).value;
    if (!pivotSel) { this._log("Sélectionnez un document pivot.", true); return; }
    const pivotId = parseInt(pivotSel);

    const targetsSel = this._q("#act-align-targets") as HTMLSelectElement;
    const targetIds: number[] = [];
    for (const opt of targetsSel.selectedOptions) targetIds.push(parseInt(opt.value));
    if (targetIds.length === 0) { this._log("Sélectionnez au moins un doc cible.", true); return; }

    const strategy = (this._q("#act-align-strategy") as HTMLSelectElement).value as
      "external_id" | "external_id_then_position" | "position" | "similarity";
    const debugAlign = (this._q("#act-align-debug") as HTMLInputElement).checked;
    const simThreshold = parseFloat(
      (this._q("#act-sim-threshold") as HTMLInputElement).value
    ) || 0.8;
    const preserveAccepted = (this._q("#act-align-preserve-accepted") as HTMLInputElement | null)?.checked ?? true;
    const modeLabel = recalculate ? "Recalcul global" : "Alignement";

    const alignConfirmEl = this._q<HTMLElement>("#act-align-confirm");
    if (alignConfirmEl) {
      const ok = await inlineConfirm(
        alignConfirmEl,
        `${modeLabel} : pivot #${pivotId} → [${targetIds.join(", ")}], stratégie ${strategy}`,
        { confirmLabel: "Lancer", danger: false }
      );
      if (!ok) return;
    }

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
          const reportInput = this._q<HTMLInputElement>("#act-report-run-id");
          if (reportInput && this._alignRunId) reportInput.value = this._alignRunId;
          // ALIGN-3: mettre à jour la pill avec le run ID actif
          const pillEl = this._q<HTMLElement>("#act-align-run-pill");
          if (pillEl && this._alignRunId) pillEl.textContent = `run\u00a0: ${this._alignRunId}`;
          // Sync workflow display
          this._wfSyncRunId();
          this._alignExplainability = reports.map((r) => ({
            target_doc_id: r.target_doc_id,
            links_created: r.links_created,
            links_skipped: r.links_skipped ?? 0,
            debug: r.debug,
          }));
          const resultsEl = this._q("#act-align-results") as HTMLElement | null;
          const bannerEl = this._q("#act-align-banner");
          if (resultsEl) resultsEl.style.display = "";
          if (bannerEl) {
            const reportBits = reports
              .map((r) => {
                const skipped = r.links_skipped ?? 0;
                return `<span class="prep-stat-ok">→ doc #${r.target_doc_id} : ${r.links_created} liens créés, ${skipped} ignorés.</span>`;
              })
              .join(" &nbsp;");
            const recalcBits = recalculate
              ? ` <span class="prep-stat-warn">Nettoyés: ${deletedBefore}</span> <span class="prep-stat-ok">Conservés: ${preservedBefore}</span> <span class="prep-stat-ok">Liens effectifs: ${totalEffectiveLinks}</span>`
              : "";
            bannerEl.innerHTML = `${reportBits}${recalcBits}`;
          }
          // Populate KPIs
          const totalCreated = reports.reduce((s, r) => s + r.links_created, 0);
          const totalSkipped = reports.reduce((s, r) => s + (r.links_skipped ?? 0), 0);
          const setKpi = (id: string, value: string, cls?: string) => {
            const el = this._q(`#${id}`);
            if (el) {
              el.textContent = value;
              el.className = cls ? `align-kpi-value value ${cls}` : "align-kpi-value value";
              // Also update parent kpi card class for color coding
              const wrap = this._q(`#${id.replace("act-kpi-", "act-kpi-wrap-")}`);
              if (wrap) wrap.className = cls ? `kpi prep-align-kpi ${cls}` : "kpi prep-align-kpi";
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
          const auditPivSel = this._q("#act-audit-pivot") as HTMLSelectElement | null;
          const auditTgtSel = this._q("#act-audit-target") as HTMLSelectElement | null;
          if (auditPivSel) auditPivSel.value = String(pivotId);
          if (auditTgtSel) auditTgtSel.value = String(targetIds[0]);
          const root = this._root;
          if (root) {
            this._auditQuickFilter = "review";
            this._writeAuditQuickFilterPref(this._auditQuickFilter);
            this._syncAuditQuickFilterUi(root);
            this._renderAuditTable(root);
            void this._loadAuditPage(root, false);
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
    const panel = this._q("#act-align-debug-panel") as HTMLElement | null;
    const content = this._q("#act-align-debug-content") as HTMLElement | null;
    const copyBtn = this._q("#act-align-copy-debug-btn") as HTMLButtonElement | null;
    if (!panel || !content || !copyBtn) return;

    if (this._alignExplainability.length === 0) {
      panel.style.display = "none";
      content.innerHTML = "";
      copyBtn.disabled = true;
      return;
    }

    panel.style.display = "";
    const runMeta = this._alignRunId
      ? `<div class="prep-align-debug-meta" style="margin-bottom:0.35rem">run_id: <code>${_escHtml(this._alignRunId)}</code></div>`
      : "";
    const rows = this._alignExplainability.map((rep) => {
      const debug = rep.debug;
      if (!debug) {
        return `
          <div class="prep-align-debug-card">
            <div class="prep-align-debug-title">Doc cible #${rep.target_doc_id}</div>
            <div class="prep-align-debug-meta">
              liens créés: <strong>${rep.links_created}</strong>, ignorés: <strong>${rep.links_skipped}</strong>
            </div>
            <div class="empty-hint">Aucun détail debug pour ce rapport.</div>
          </div>
        `;
      }

      const strategy = typeof debug.strategy === "string" ? debug.strategy : "n/a";
      const sourceParts = _isRecord(debug.link_sources)
        ? Object.entries(debug.link_sources).map(([k, v]) => `<span class="prep-align-debug-pill">${_escHtml(k)}: ${_escHtml(String(v))}</span>`)
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
        <div class="prep-align-debug-card">
          <div class="prep-align-debug-title">Doc cible #${rep.target_doc_id}</div>
          <div class="prep-align-debug-meta">
            stratégie: <strong>${_escHtml(strategy)}</strong> ·
            liens créés: <strong>${rep.links_created}</strong> · ignorés: <strong>${rep.links_skipped}</strong>
          </div>
          ${sourceParts.length > 0
            ? `<div class="prep-align-debug-row"><span class="prep-align-debug-label">Sources</span><div class="prep-align-debug-pills">${sourceParts.join("")}</div></div>`
            : `<div class="prep-align-debug-row"><span class="prep-align-debug-label">Sources</span><span class="empty-hint">n/a</span></div>`}
          ${sim
            ? `<div class="prep-align-debug-row">
                 <span class="prep-align-debug-label">Similarité</span>
                 <span>mean=${_formatMaybeNumber(sim.score_mean)} min=${_formatMaybeNumber(sim.score_min)} max=${_formatMaybeNumber(sim.score_max)}</span>
               </div>`
            : ""}
          ${sampleRows
            ? `<div class="prep-align-debug-row">
                 <span class="prep-align-debug-label">Exemples</span>
                 <ul class="prep-align-debug-list">${sampleRows}</ul>
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
    table.setAttribute("role", "grid");
    table.setAttribute("aria-rowcount", String(this._auditLinks.length));
    table.setAttribute("aria-label", "Liens d\u2019alignement");
    table.innerHTML = `
      <thead><tr role="row">
        <th role="columnheader"><input type="checkbox" id="act-audit-sel-all" title="Tout sélectionner" aria-label="Tout sélectionner"/></th>
        <th role="columnheader">ext_id</th>
        <th role="columnheader">Pivot (texte)</th>
        <th role="columnheader">Cible (texte)</th>
        <th role="columnheader">Statut</th>
        ${showExplain ? '<th role="columnheader">Expliquer</th>' : ""}
        <th role="columnheader">Actions</th>
      </tr></thead>
    `;
    const tbody = document.createElement("tbody");
    for (const link of visibleLinks) {
      const isSelected = link.link_id === this._auditSelectedLinkId;
      const tr = document.createElement("tr");
      tr.setAttribute("role", "row");
      tr.setAttribute("aria-selected", isSelected ? "true" : "false");
      tr.classList.toggle("prep-audit-row-active", isSelected);
      tr.dataset.linkId = String(link.link_id);
      const normalizedStatus = this._normalizeAuditStatus(link.status);
      const statusBadge = normalizedStatus === "accepted"
        ? `<span class="prep-status-badge prep-status-ok">✅ Accepté</span>`
        : normalizedStatus === "rejected"
        ? `<span class="prep-status-badge prep-status-error">❌ Rejeté</span>`
        : `<span class="prep-status-badge prep-status-unknown">🔵 Non révisé</span>`;

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
        <td><input type="checkbox" class="prep-audit-row-cb" data-id="${link.link_id}"/></td>
        <td style="white-space:nowrap">${link.external_id ?? "—"}</td>
        <td class="prep-audit-text">${_escHtml(String(link.pivot_text ?? ""))}</td>
        <td class="prep-audit-text">${_escHtml(String(link.target_text ?? ""))}</td>
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
      const checked = wrap.querySelectorAll<HTMLInputElement>(".prep-audit-row-cb:checked");
      const countEl = root.querySelector<HTMLElement>("#act-audit-sel-count");
      if (countEl) countEl.textContent = `${checked.length} sélectionné(s)`;
      if (batchBar) batchBar.style.display = checked.length > 0 ? "flex" : "none";
    };
    if (selAllCb) {
      selAllCb.addEventListener("change", () => {
        wrap.querySelectorAll<HTMLInputElement>(".prep-audit-row-cb").forEach(cb => {
          cb.checked = selAllCb.checked;
        });
        updateBatchBar();
      });
    }
    wrap.querySelectorAll<HTMLInputElement>(".prep-audit-row-cb").forEach(cb => {
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
    return Array.from(root.querySelectorAll<HTMLInputElement>(".prep-audit-row-cb:checked"))
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
      const batchConfirmEl = root.querySelector<HTMLElement>("#act-audit-batch-confirm");
      if (batchConfirmEl) {
        const ok = await inlineConfirm(
          batchConfirmEl,
          `Supprimer ${ids.length} lien(s) sélectionné(s) ? Cette action est irréversible.`
        );
        if (!ok) return;
      }
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
        <div class="prep-quality-stats-grid">
          <div class="prep-quality-stat">
            <span class="prep-quality-label">Couverture pivot</span>
            <span class="prep-quality-value ${s.coverage_pct >= 90 ? "ok" : s.coverage_pct >= 60 ? "warn" : "err"}">
              ${s.coverage_pct}% (${s.covered_pivot_units}/${s.total_pivot_units})
            </span>
          </div>
          <div class="prep-quality-stat">
            <span class="prep-quality-label">Liens total</span>
            <span class="prep-quality-value">${s.total_links}</span>
          </div>
          <div class="prep-quality-stat">
            <span class="prep-quality-label">Orphelins pivot</span>
            <span class="prep-quality-value ${s.orphan_pivot_count === 0 ? "ok" : "warn"}">${s.orphan_pivot_count}</span>
          </div>
          <div class="prep-quality-stat">
            <span class="prep-quality-label">Orphelins cible</span>
            <span class="prep-quality-value ${s.orphan_target_count === 0 ? "ok" : "warn"}">${s.orphan_target_count}</span>
          </div>
          <div class="prep-quality-stat">
            <span class="prep-quality-label">Collisions</span>
            <span class="prep-quality-value ${s.collision_count === 0 ? "ok" : "err"}">${s.collision_count}</span>
          </div>
          <div class="prep-quality-stat">
            <span class="prep-quality-label">Statuts</span>
            <span class="prep-quality-value">
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
        const el = this._q(`#${id}`);
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
          ? `<span class="prep-status-badge prep-status-ok">✅ Accepté</span>`
          : lnk.status === "rejected"
          ? `<span class="prep-status-badge prep-status-error">❌ Rejeté</span>`
          : `<span class="prep-status-badge prep-status-unknown">🔵 Non révisé</span>`;
        return `<tr>
          <td class="prep-audit-cell-text">${lnk.target_text}</td>
          <td>[§${lnk.target_external_id ?? "?"}]</td>
          <td>${badge}</td>
          <td class="prep-audit-cell-actions">
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
    const fmt = (this._q<HTMLSelectElement>("#act-report-fmt"))?.value as "html" | "jsonl" || "html";
    const runIdRaw = (this._q<HTMLInputElement>("#act-report-run-id"))?.value.trim();
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

    const resultEl = this._q<HTMLElement>("#act-report-result");
    const btn = this._q<HTMLButtonElement>("#act-report-btn");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Export en cours\u2026";

    try {
      const opts: ExportRunReportOptions = { out_path: outPath, format: fmt };
      if (runIdRaw) opts.run_id = runIdRaw;
      const res = await exportRunReport(this._conn, opts);

      if (resultEl) {
        resultEl.style.display = "";
        resultEl.innerHTML =
          `<span class="prep-stat-ok">✓ ${res.runs_exported} run(s) export\u00e9(s) \u2192 ` +
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
    const docSel = (this._q("#act-meta-doc") as HTMLSelectElement)?.value;
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
          const reindexBtn = this._q("#act-reindex-after-curate-btn") as HTMLElement | null;
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
    const focusConfirmEl = root.querySelector<HTMLElement>("#act-focus-confirm");
    if (focusConfirmEl) {
      const ok = await inlineConfirm(
        focusConfirmEl,
        `Supprimer le lien #${linkId} ? Cette action est irréversible.`
      );
      if (!ok) return;
    }
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

  // ─── Annotation panel (delegated to AnnotationView) ──────────────────────

  private _renderAnnoterPanel(_root: HTMLElement): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "main");
    wrapper.setAttribute("aria-label", "Vue Annotation");
    this._annotationView = new AnnotationView(() => this._conn);
    this._annotationView.render(wrapper);
    return wrapper;
  }


  /**
   * Release all resources held by this screen.
   * Safe to call multiple times (idempotent).
   */
  dispose(): void {
    // Cancel curation preview debounce timer
    if (this._previewDebounceHandle !== null) {
      window.clearTimeout(this._previewDebounceHandle);
      this._previewDebounceHandle = null;
    }
    // Dispose extracted views
    this._annotationView?.dispose();
    this._annotationView = null;
    this._segmentationView?.dispose();
    this._segmentationView = null;
    this._curationView?.dispose();
    this._curationView = null;
    // Dispose sub-panels
    this._alignPanel?.dispose();
    this._alignPanel = null;
    // Drop DOM reference
    this._root = null;
  }
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

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
