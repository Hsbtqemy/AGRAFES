/**
 * CurationView — extracted curation panel from ActionsScreen.
 *
 * Owns all curation state, rendering, and logic:
 *   - Rule presets, advanced JSON rules, Find/Replace
 *   - Live preview (curatePreview) with diff display
 *   - Local review statuses (accept/ignore/pending) + localStorage persistence
 *   - Persistent exceptions (Level 7B) + admin panel (Level 8A)
 *   - Apply history (Level 10A/10B)
 *   - Convention roles + raw prep-pane with unit roles + text_start_n
 *   - Full curate apply with job tracking
 *
 * Dependency injection:
 *   - _getConn()  — live Conn | null (never cached)
 *   - _getDocs()  — live DocumentRecord[] snapshot
 *   - _cb         — CurationCallbacks (log, toast, setBusy, isBusy, etc.)
 */

import type {
  Conn,
  DocumentRecord,
  DocRelationRecord,
  CurateRule,
  CuratePreviewExample,
  UnitRecord,
  ConventionRole,
  CurateApplyEvent,
} from "../lib/sidecarClient.ts";
import {
  listUnits,
  listConventions,
  createConvention,
  updateConvention,
  deleteConvention,
  bulkSetRole,
  setTextStart,
  curatePreview,
  enqueueJob,
  getDocumentPreview,
  SidecarError,
  richTextToHtml,
  type CurateException,
  listCurateExceptions,
  setCurateException,
  deleteCurateException,
  exportCurateExceptions,
  type ExportCurateExceptionsOptions,
  recordApplyHistory,
  listApplyHistory,
  exportApplyHistory,
  type ExportApplyHistoryOptions,
} from "../lib/sidecarClient.ts";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";
import { escHtml as _escHtml, renderSpecialChars as _renderSpecialChars, highlightChanges as _highlightChanges } from "../lib/diff.ts";
import { rulesSignature as _rulesSignature, sampleFingerprint as _sampleFingerprint, sampleTextFingerprint as _sampleTextFingerprint } from "../lib/curationFingerprint.ts";
import { reportEvent, reportUserError } from "../lib/telemetry.ts";
import { CURATE_PRESETS, parseAdvancedCurateRules, getPunctLangFromValue } from "../lib/curationPresets.ts";
import { mergeApplyHistory, formatApplyHistoryList, type ApplyHistoryScope } from "../lib/curationApplyHistory.ts";
import {
  filterExceptions,
  buildExcDocOptions,
  formatExcAdminList,
  type ExcKindFilter,
} from "../lib/curationExceptionsAdmin.ts";
import {
  appendCurateLogEntry,
  formatCurateLog,
  countCurateWarnings,
  type CurateLogEntry,
} from "../lib/curationDiagnostics.ts";
import { filterExamples, getRuleStats } from "../lib/curationFiltering.ts";
import {
  getStatusCounts,
  countManualOverrides,
  hasAnyManualOverride,
} from "../lib/curationCounters.ts";
import { buildSampleInfo } from "../lib/curationSampleInfo.ts";
import {
  formatMinimap,
  formatNoChangesDiag,
  formatChangesSummary,
  formatTruncationNotice,
  formatRuleChips,
  formatGotoFirstAction,
  formatImpactNotice,
} from "../lib/curationDiagPanel.ts";
import {
  formatDiffEmptyMessage,
  formatDiffStatusBadge,
  formatDiffOverrideBadge,
  formatDiffExceptionBadge,
  formatDiffForcedBadge,
  getRuleLabelsForExample,
  formatDiffRuleBadges,
  getDiffRowClasses,
  formatDiffPaginationLabel,
  formatDiffRowTitle,
} from "../lib/curationDiffList.ts";

// ─── Curation review persistence ──────────────────────────────────────────────

interface StoredCurateReviewState {
  version: 1 | 2 | 3 | 4 | 5;
  docId: number | null;
  rulesSignature: string;
  updatedAt: number;
  unitsTotal?: number;
  unitsChanged?: number;
  sampleFingerprint?: string;
  sampleSize?: number;
  sampleTextFingerprint?: string;
  statuses: Record<string, "accepted" | "ignored">;
  overrides?: Record<string, string>;
}

type CurateApplyResult = CurateApplyEvent;

// ─── Curation presets ─────────────────────────────────────────────────────────

const CURATE_PREVIEW_LIMIT = 5000;
const CURATE_PAGE_SIZE = 50;
// Max units rendered at once in the raw pane; keeps DOM size manageable for
// large documents. Changed units are always rendered regardless of this cap.
const RAW_PANE_DOM_CAP = 5000;

// CURATE_PRESETS et parseAdvancedCurateRules extraits vers ../lib/curationPresets.ts
// (Phase 1 du chantier de décomposition CurationView, cf. HANDOFF_PREP § 7).
// Tests : ../lib/__tests__/curationPresets.test.ts
//
// La classe CurationView importe CURATE_PRESETS (lecture seule) ; elle ne le
// modifie jamais. Si un preset built-in doit changer, le faire dans le module
// pur — pas ici, pas dupliqué.

// ─── Callbacks interface ───────────────────────────────────────────────────────

export interface CurationCallbacks {
  log: (msg: string, isError?: boolean) => void;
  toast?: (msg: string, isError?: boolean) => void;
  setBusy: (v: boolean) => void;
  isBusy: () => boolean;
  jobCenter?: () => JobCenter | null;
  onNavigate?: (view: string, context?: { docId?: number }) => void;
  onReloadDocs?: () => void;
  onReindex?: () => void;
  onValidateMeta?: () => void;
  getLastSegmentReport?: () => { doc_id: number; units_output: number; warnings?: string[] } | null;
}

// ─── CurationView ─────────────────────────────────────────────────────────────

export class CurationView {
  private static readonly LS_CURATE_REVIEW_PREFIX = "agrafes.prep.curate.review.";
  private static readonly _STATUS_LABEL: Record<string, string> = {
    pending: "En attente",
    accepted: "Acceptée",
    ignored: "Ignorée",
  };

  // ── Root element ────────────────────────────────────────────────────────────
  private _root: HTMLElement | null = null;

  // ── Preview state ───────────────────────────────────────────────────────────
  private _hasPendingPreview = false;
  private _curateLog: CurateLogEntry[] = [];
  private _previewDebounceHandle: number | null = null;
  private _curateExamples: CuratePreviewExample[] = [];
  private _activeDiffIdx: number | null = null;
  private _curatePreviewPage = 0;
  private _previewMode: "sidebyside" | "rawonly" | "diffonly" = "rawonly";
  private _previewSyncScroll = true;
  private _curateSyncLock = false;
  private _onCurateRawScroll: EventListener | null = null;
  private _onCurateDiffScroll: EventListener | null = null;

  // ── Rule / filter state ─────────────────────────────────────────────────────
  private _curateRuleLabels: string[] = [];
  private _activeRuleFilter: string | null = null;
  private _curateGlobalChanged = 0;
  private _activeStatusFilter: "pending" | "accepted" | "ignored" | null = null;
  private _frExtraRules: CurateRule[] = [];
  private _frSearchHits: number[] = []; // unit_ids with search matches (Trouver mode)
  private _frSearchHitIdx = -1;

  // ── Review restore counters ─────────────────────────────────────────────────
  private _curateRestoredCount = 0;
  private _curateSavedCount = 0;
  private _curateUnitsTotal = 0;
  private _forcedPreviewUnitId: number | null = null;
  private _editingManualOverride = false;

  // ── Exceptions (Level 7B) ───────────────────────────────────────────────────
  private _curateExceptions: Map<number, CurateException> = new Map();

  // ── Apply history (Level 9C / 10A) ─────────────────────────────────────────
  private _lastApplyResult: CurateApplyResult | null = null;
  private _applyHistory: CurateApplyEvent[] = [];

  // ── Raw prep-pane / unit cache ───────────────────────────────────────────────────
  private _allUnits: UnitRecord[] = [];
  private _allUnitsDocId: number | null = null;
  private _allOverrides: Map<number, string> = new Map();
  private _allOverridesDocId: number | null = null;

  // ── Conventions / roles ─────────────────────────────────────────────────────
  private _conventions: ConventionRole[] = [];
  private _selectedUnitNs: Set<number> = new Set();
  private _lastSelectedN: number | null = null;
  private _selectionMode = false;

  // ── Doc list UI state ───────────────────────────────────────────────────────
  private _docRelations: DocRelationRecord[] = [];
  private _docListQuery = "";
  private _docListSort: "id" | "alpha" = "id";

  // ── Admin panel (Level 8A) ──────────────────────────────────────────────────
  private _excAdminFilter: "all" | "ignore" | "override" = "all";
  private _excAdminAll: CurateException[] = [];
  private _excAdminEditing: number | null = null;
  private _excAdminDocFilter: number = 0;

  // ── Constructor ─────────────────────────────────────────────────────────────

  constructor(
    private readonly _getConn: () => Conn | null,
    private readonly _getDocs: () => DocumentRecord[],
    private readonly _cb: CurationCallbacks,
  ) {}

  // ── Scoped query helpers ────────────────────────────────────────────────────

  private _q<T extends HTMLElement>(selector: string): T | null {
    return this._root?.querySelector<T>(selector) ?? null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Returns true if a preview has been run but not yet applied. */
  hasPendingChanges(): boolean {
    return hasAnyManualOverride(this._curateExamples);
  }

  /** Populate #act-curate-doc and #act-meta-doc from the current docs list. */
  populateSelects(): void {
    const docs = this._getDocs();
    for (const id of ["act-curate-doc", "act-meta-doc"]) {
      const sel = this._q<HTMLSelectElement>(`#${id}`);
      if (!sel) continue;
      const keepFirst = sel.options[0]?.value === "" ? sel.options[0] : null;
      sel.innerHTML = "";
      if (keepFirst) sel.appendChild(keepFirst);
      for (const doc of docs) {
        const opt = document.createElement("option");
        opt.value = String(doc.doc_id);
        opt.textContent = `[${doc.doc_id}] ${doc.title} (${doc.language}, ${doc.unit_count} u.)`;
        sel.appendChild(opt);
      }
    }
    this._renderDocList();
  }

  private _renderDocList(): void {
    const container = this._q<HTMLElement>("#act-curate-doc-list");
    if (!container) return;
    const allDocs = this._getDocs();
    const sel = this._q<HTMLSelectElement>("#act-curate-doc");
    const currentVal = sel?.value ?? "";
    const query = this._docListQuery.toLowerCase().trim();

    const matches = (d: DocumentRecord) =>
      !query || d.title.toLowerCase().includes(query) || String(d.doc_id).includes(query);

    const sortFn = (a: DocumentRecord, b: DocumentRecord) =>
      this._docListSort === "alpha"
        ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
        : a.doc_id - b.doc_id;

    // Build family structure from cached relations
    const childIdSet = new Set(this._docRelations.map(r => r.doc_id));
    const parentMap = new Map<number, number[]>();
    for (const rel of this._docRelations) {
      if (!parentMap.has(rel.target_doc_id)) parentMap.set(rel.target_doc_id, []);
      parentMap.get(rel.target_doc_id)!.push(rel.doc_id);
    }

    interface DocGroup { root: DocumentRecord; children: DocumentRecord[]; }
    const groups: DocGroup[] = [];
    const orphans: DocumentRecord[] = [];
    const seen = new Set<number>();

    for (const d of [...allDocs].sort(sortFn)) {
      if (seen.has(d.doc_id)) continue;
      if (!childIdSet.has(d.doc_id)) {
        if (parentMap.has(d.doc_id)) {
          const children = (parentMap.get(d.doc_id) ?? [])
            .map(cid => allDocs.find(dd => dd.doc_id === cid))
            .filter(Boolean) as DocumentRecord[];
          children.sort(sortFn);
          groups.push({ root: d, children });
          seen.add(d.doc_id);
          children.forEach(c => seen.add(c.doc_id));
        } else {
          orphans.push(d);
          seen.add(d.doc_id);
        }
      }
    }
    allDocs.filter(d => !seen.has(d.doc_id)).sort(sortFn).forEach(d => orphans.push(d));

    container.innerHTML = "";

    const makeRow = (value: string, label: string, lang: string | null, isChild = false) => {
      const row = document.createElement("div");
      row.className = "prep-curate-doc-row" + (isChild ? " prep-curate-doc-row--child" : "");
      row.dataset.value = value;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(currentVal === value));
      if (currentVal === value) row.classList.add("active");
      const dot = document.createElement("span");
      dot.className = "prep-curate-doc-row-dot";
      row.appendChild(dot);
      const titleEl = document.createElement("span");
      titleEl.className = "prep-curate-doc-row-title";
      titleEl.textContent = label;
      row.appendChild(titleEl);
      if (lang) {
        const badge = document.createElement("span");
        badge.className = "prep-curate-doc-row-lang";
        badge.textContent = lang;
        row.appendChild(badge);
      }
      row.addEventListener("click", () => {
        if (!sel) return;
        sel.value = value;
        sel.dispatchEvent(new Event("change"));
        this._syncDocList();
      });
      return row;
    };

    const makeFamilyHeader = (label: string) => {
      const h = document.createElement("div");
      h.className = "prep-curate-doc-family-header";
      h.textContent = label;
      return h;
    };

    container.appendChild(makeRow("", "Tous les documents", null));

    const hasFamilies = groups.length > 0;

    for (const { root, children } of groups) {
      const rootMatches = matches(root);
      const anyChildMatches = children.some(matches);
      if (!rootMatches && !anyChildMatches) continue;
      container.appendChild(makeFamilyHeader(root.title));
      container.appendChild(makeRow(String(root.doc_id), `#${root.doc_id} ${root.title}`, root.language));
      for (const child of children) {
        if (rootMatches || matches(child)) {
          container.appendChild(makeRow(String(child.doc_id), `#${child.doc_id} ${child.title}`, child.language, true));
        }
      }
    }

    const matchingOrphans = orphans.filter(matches);
    if (matchingOrphans.length > 0) {
      if (hasFamilies) container.appendChild(makeFamilyHeader("Documents sans famille"));
      for (const d of matchingOrphans) {
        container.appendChild(makeRow(String(d.doc_id), `#${d.doc_id} ${d.title}`, d.language));
      }
    }

    if (query && container.children.length <= 1) {
      const hint = document.createElement("div");
      hint.className = "prep-curate-doc-empty-hint";
      hint.textContent = "Aucun document ne correspond.";
      container.appendChild(hint);
    }
  }

  private _syncDocList(): void {
    const container = this._q<HTMLElement>("#act-curate-doc-list");
    if (!container) return;
    const currentVal = this._q<HTMLSelectElement>("#act-curate-doc")?.value ?? "";
    container.querySelectorAll<HTMLElement>(".prep-curate-doc-row").forEach(row => {
      const active = row.dataset.value === currentVal;
      row.classList.toggle("active", active);
      row.setAttribute("aria-selected", String(active));
    });
  }

  /** Called when docs are (re)loaded by the parent. */
  onDocsLoaded(): void {
    this.populateSelects();
    this._updateCurateCtx();
    void this._fetchDocRelations();
  }

  private async _fetchDocRelations(): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    try {
      const { getAllDocRelations } = await import("../lib/sidecarClient.ts");
      this._docRelations = await getAllDocRelations(conn);
    } catch {
      this._docRelations = [];
    }
    this._renderDocList();
  }

  /** Called when the connection changes. Clears all curation state. */
  setConn(): void {
    const conn = this._getConn();
    this._docRelations = [];
    this._docListQuery = "";
    this._docListSort = "id";
    const filterInput = this._q<HTMLInputElement>("#act-curate-doc-filter");
    if (filterInput) filterInput.value = "";
    const sortBtns = this._root?.querySelectorAll<HTMLButtonElement>(".prep-curate-sort-btn");
    sortBtns?.forEach(b => b.classList.toggle("active", b.dataset.sort === "id"));
    this._hasPendingPreview = false;
    this._curateExamples = [];
    this._activeDiffIdx = null;
    this._curateRuleLabels = [];
    this._activeRuleFilter = null;
    this._activeStatusFilter = null;
    this._curateGlobalChanged = 0;
    this._lastApplyResult = null;
    this._applyHistory = [];
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
    this._selectionMode = false;
    const _rec = this._q<HTMLElement>("#act-review-export-card");
    if (_rec) _rec.style.display = "none";
    this._renderConventionsList();
    this._refreshCurateHeaderState();
    if (conn) {
      void this._loadConventions();
    }
  }

  /** Apply a named preset programmatically (used by parent for "Apply preset" shortcuts). */
  applyCurationPreset(preset?: string): void {
    this._applyCurationPreset(preset);
  }

  /** Render the curation panel into a new element and return it. */
  render(): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("role", "main");
    el.setAttribute("aria-label", "Vue Curation");
    this._root = el;
    el.innerHTML = `
      <section class="prep-acts-seg-head-card acts-seg-head-card--compact" id="act-curation-head">
        <div class="prep-acts-hub-head-left">
          <h1>Curation <span class="prep-badge-preview">pr&#233;visualisation live</span></h1>
        </div>
        <div class="prep-acts-hub-head-tools">
          <button id="act-reload-docs-btn" class="btn btn-secondary btn-sm">&#8635;&#160;Rafra&#238;chir</button>
          <span class="prep-curate-pill" id="act-curate-mode-pill">Mode &#233;dition</span>
        </div>
      </section>
      <div id="act-curate-diverge-banner" class="prep-curate-diverge-banner" style="display:none" role="status">
        &#9872;&#160;<strong>text_norm a diverg&#233; de text_raw</strong> &#8212; les modifications sont visibles dans les autres panneaux.
      </div>
      <div id="act-curate-confirm-bar" class="prep-curate-confirm-bar" style="display:none" role="alertdialog" aria-modal="false"></div>
      <div class="prep-curate-doc-bar">
        <select id="act-curate-doc" style="display:none"><option value="">Tous les documents</option></select>
        <div class="prep-curate-doc-toolbar">
          <input type="search" id="act-curate-doc-filter" class="prep-curate-doc-filter-input"
            placeholder="Filtrer&#8230;" autocomplete="off" spellcheck="false" />
          <div class="prep-curate-sort-group" role="group" aria-label="Tri">
            <button class="prep-curate-sort-btn active" data-sort="id" title="Trier par identifiant">ID</button>
            <button class="prep-curate-sort-btn" data-sort="alpha" title="Trier par titre">A&#8211;Z</button>
          </div>
        </div>
        <div id="act-curate-doc-list" class="prep-curate-doc-list" role="listbox" aria-label="S&#233;lectionner un document"></div>
        <span id="act-curate-ctx-lang" style="display:none"></span>
      </div>
      <section class="card curate-workspace-card" id="act-curate-card">
        <div class="prep-curate-workspace">
          <div class="prep-curate-col curate-col-left prep-curate-col-left-layout">
            <article class="prep-curate-inner-card">
              <div class="card-head">
                <h2>Param&#232;tres curation</h2>
                <span id="act-curate-doc-label"></span>
              </div>
              <div class="prep-card-body">
                <div class="prep-curation-quick-rules">
                  <div class="prep-curate-rule-group">
                    <span class="prep-curate-rule-group-label">Corrections</span>
                    <div class="prep-chip-row">
                      <input id="act-rule-spaces" class="prep-curate-rule-input" type="checkbox" />
                      <label class="prep-curation-chip" for="act-rule-spaces">Espaces incoh&#233;rents</label>
                      <input id="act-rule-quotes" class="prep-curate-rule-input" type="checkbox" />
                      <label class="prep-curation-chip" for="act-rule-quotes">Guillemets typographiques</label>
                      <input id="act-rule-invisibles" class="prep-curate-rule-input" type="checkbox" />
                      <label class="prep-curation-chip" for="act-rule-invisibles">Contr&#244;le invisibles</label>
                      <input id="act-rule-numbering" class="prep-curate-rule-input" type="checkbox" />
                      <label class="prep-curation-chip" for="act-rule-numbering">Num&#233;rotation [n]</label>
                    </div>
                  </div>
                  <div class="prep-curate-rule-group">
                    <span class="prep-curate-rule-group-label">Ponctuation</span>
                    <div class="prep-curate-segmented" role="group" aria-label="Mode de correction ponctuation">
                      <input id="act-punct-none" class="prep-curate-rule-input" type="radio" name="curate-punct" value="" checked />
                      <label class="prep-curate-seg-item" for="act-punct-none" title="Aucune correction de ponctuation">&#8212;</label>
                      <input id="act-punct-fr" class="prep-curate-rule-input" type="radio" name="curate-punct" value="fr" />
                      <label class="prep-curate-seg-item" for="act-punct-fr" title="Typographie fran&#231;aise">FR</label>
                      <input id="act-punct-en" class="prep-curate-rule-input" type="radio" name="curate-punct" value="en" />
                      <label class="prep-curate-seg-item" for="act-punct-en" title="Typographie anglaise">EN</label>
                    </div>
                  </div>
                </div>
              </div>
            </article>

            <article class="prep-curate-inner-card" id="act-roles-card">
              <details id="act-curate-roles" class="prep-curation-advanced">
                <summary class="card-head prep-curate-advanced-summary">
                  <h2>R&#244;les</h2>
                </summary>
                <div class="prep-card-body prep-curate-roles-body">
                  <p class="prep-curate-roles-hint" id="act-roles-hint">Passez en <em>Texte brut</em> pour assigner des r&#244;les aux unit&#233;s.</p>
                  <div id="act-roles-controls" style="display:none">
                    <button id="raw-role-mode-btn" class="btn btn-xs prep-raw-role-mode-btn">Activer Conventions</button>
                    <div class="prep-curate-roles-assign" id="act-roles-assign">
                      <span class="prep-curate-roles-count" id="act-roles-count" style="display:none"></span>
                      <div class="prep-curate-roles-select-row">
                        <label class="prep-curate-roles-select-label" for="raw-role-select">R&#244;le&nbsp;:</label>
                        <select id="raw-role-select" class="prep-raw-role-select"><option value="">&#8212; choisir &#8212;</option></select>
                      </div>
                      <div class="prep-curate-roles-btns">
                        <button id="raw-role-assign-btn" class="btn btn-primary btn-xs">Assigner</button>
                        <button id="raw-role-clear-btn" class="btn btn-secondary btn-xs">Effacer le r&#244;le</button>
                        <button id="raw-role-deselect-btn" class="btn btn-ghost btn-xs">&#10005;&#160;D&#233;s&#233;lectionner tout</button>
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            </article>

            <article class="prep-curate-inner-card curate-stack-card" id="act-fr-card">
              <details id="act-curate-advanced" class="prep-curation-advanced">
                <summary class="card-head prep-curate-advanced-summary">
                  <h2>R&#232;gles avanc&#233;es <span id="act-fr-active-badge" class="prep-fr-active-badge" style="display:none">actif</span></h2>
                </summary>
                <div class="prep-card-body">
                  <div class="prep-curate-adv-tabs">
                    <button class="prep-curate-adv-tab active" data-adv-tab="fr">Trouver&#160;/&#160;Remplacer</button>
                    <button class="prep-curate-adv-tab" data-adv-tab="regex">Regex</button>
                  </div>

                  <div class="prep-curate-adv-panel" data-adv-panel="regex" style="display:none">
                    <div class="prep-curate-adv-regex-row">
                      <input id="act-curate-quick-pattern" type="text" placeholder="Motif regex&#8230;" />
                      <input id="act-curate-quick-replacement" type="text" placeholder="Remplacement" />
                      <input id="act-curate-quick-flags" type="text" value="g" maxlength="6" style="width:3rem" title="Flags" />
                      <button id="act-curate-add-rule-btn" class="btn btn-secondary btn-sm">+</button>
                    </div>
                    <label class="prep-curate-json-field">
                      <textarea id="act-curate-rules" rows="3" placeholder='[{"pattern":"foo","replacement":"bar","flags":"gi"}]'></textarea>
                    </label>
                    <div class="prep-curate-adv-footer">
                      <button id="act-curate-reset-btn" class="btn btn-secondary btn-sm">R&#233;initialiser</button>
                    </div>
                  </div>

                  <div class="prep-curate-adv-panel" data-adv-panel="fr">
                    <div class="prep-fr-fields">
                      <label class="prep-fr-field-label">
                        <span>Chercher</span>
                        <input id="act-fr-find" type="text" class="prep-fr-input" placeholder="ex&#160;: M.&#160;" autocomplete="off" />
                      </label>
                      <label class="prep-fr-field-label">
                        <span>Remplacer par</span>
                        <input id="act-fr-replace" type="text" class="prep-fr-input" placeholder="(vide&#160;= supprimer)" autocomplete="off" />
                      </label>
                    </div>
                    <div class="prep-chip-row fr-options-row">
                      <input id="act-fr-regex" type="checkbox" />
                      <label class="chip" for="act-fr-regex">Regex</label>
                      <input id="act-fr-nocase" type="checkbox" />
                      <label class="chip" for="act-fr-nocase">Insensible &#224; la casse</label>
                    </div>
                    <div class="prep-btns fr-actions-row">
                      <button id="act-fr-count-btn" class="btn btn-sm btn-secondary">&#128269;&#160;Trouver</button>
                      <button id="act-fr-apply-btn" class="btn btn-sm alt">&#9654;&#160;Pr&#233;visualiser</button>
                      <button id="act-fr-clear-btn" class="btn btn-sm" style="display:none">&#10005;&#160;Effacer</button>
                    </div>
                    <div id="act-fr-feedback" class="prep-fr-feedback" style="display:none"></div>
                    <div id="act-fr-nav" class="prep-fr-nav" style="display:none">
                      <button id="act-fr-prev-btn" class="btn btn-xs btn-secondary" disabled>&#8592;&#160;Pr&#233;c.</button>
                      <span id="act-fr-nav-pos" class="prep-fr-nav-pos"></span>
                      <button id="act-fr-next-btn" class="btn btn-xs btn-secondary">Suiv.&#160;&#8594;</button>
                    </div>
                  </div>
                </div>
              </details>
            </article>

            <div class="prep-curate-col-spacer"></div>
            <div class="prep-curate-primary-actions-footer">
              <button id="act-curate-btn" class="btn pri" disabled>Appliquer curation</button>
              <button id="act-curate-goto-annot-btn" class="btn btn-sm" title="Ouvrir ce document dans le panneau Annotation">Voir&#160;annotation&#160;&#8599;</button>
            </div>
          </div>
          <div class="prep-curate-col curate-col-center">
            <article class="prep-curate-inner-card curate-preview-card" id="act-preview-panel">
              <div class="card-head">
                <h2>Preview synchronis&#233;e</h2>
                <span id="act-preview-info" style="font-size:12px;color:var(--prep-muted,#4f5d6d)">&#8212;</span>
              </div>
              <div class="prep-preview-controls">
                <div class="prep-preview-mode-row prep-chip-row">
                  <button class="prep-preview-mode-btn" data-preview-mode="diffonly" title="Afficher le texte cur&#233; avec les modifications en surbrillance">Cur&#233; seul</button>
                  <button class="prep-preview-mode-btn active" data-preview-mode="rawonly" title="Afficher le texte source uniquement (vue par d&#233;faut)">Brut seul</button>
                  <button class="prep-preview-mode-btn" data-preview-mode="sidebyside" title="Afficher le brut et le cur&#233; c&#244;te &#224; c&#244;te">C&#244;te &#224; c&#244;te</button>
                  <label class="prep-preview-sync-label" title="Synchroniser le scroll entre les deux panneaux">
                    <input id="act-sync-scroll" type="checkbox" checked />&#160;Sync scroll
                  </label>
                </div>
                <div class="prep-preview-nav-row" role="toolbar" aria-label="Navigation entre occurrences de modification">
                  <button id="act-diff-prev" type="button" class="btn btn-sm btn-secondary" disabled
                    title="Occurrence de modification pr&#233;c&#233;dente"
                    aria-label="Occurrence de modification pr&#233;c&#233;dente">&#8592; Modif pr&#233;c&#233;d.</button>
                  <span id="act-diff-position" class="prep-preview-nav-pos">&#8212;</span>
                  <button id="act-diff-next" type="button" class="btn btn-sm btn-secondary" disabled
                    title="Occurrence de modification suivante"
                    aria-label="Occurrence de modification suivante">Modif suiv. &#8594;</button>
                </div>
                <div id="act-curate-filter-badge" class="prep-preview-filter-badge" style="display:none">
                  Filtre&#160;: <strong id="act-curate-filter-label"></strong><span class="filter-scope-note">&#160;&#8212;&#160;dans l&#8217;&#233;chantillon courant</span>
                  <button id="act-curate-filter-clear" class="filter-clear-btn" title="Effacer le filtre">&#215;</button>
                </div>
                <div id="act-curate-sample-info" class="prep-curate-sample-info" style="display:none"></div>
              </div>
              <div class="prep-preview-grid">
                <section class="prep-pane">
                  <div class="prep-pane-head">Texte brut (source)</div>
                  <div id="act-preview-raw" class="prep-doc-scroll" aria-label="Texte brut">
                    <p class="empty-hint">S&#233;lectionnez un document et lancez une pr&#233;visualisation.</p>
                  </div>
                </section>
                <section class="prep-pane">
                  <div class="prep-pane-head">Texte cur&#233; (diff)
                    <span class="prep-kbd-legend" title="Raccourcis clavier" aria-label="Raccourcis clavier : fl&#232;ches naviguer, A accepter, I ignorer, P remettre en attente">
                      <kbd>&#8593;</kbd><kbd>&#8595;</kbd>&#160;nav&#160;·&#160;<kbd>A</kbd>&#160;acc.&#160;·&#160;<kbd>I</kbd>&#160;ign.&#160;·&#160;<kbd>P</kbd>&#160;att.
                    </span>
                  </div>
                  <div id="act-diff-list" class="prep-diff-list prep-doc-scroll" tabindex="0" aria-label="Texte cur&#233; avec diff&#233;rences (&#8593;&#8595; naviguer, A&#160;accepter, I&#160;ignorer, P&#160;remettre en attente)">
                    <p class="empty-hint">Aucune pr&#233;visualisation.</p>
                  </div>
                </section>
                <aside id="act-curate-minimap" class="prep-minimap" aria-label="Minimap des changements">
                  <div class="prep-mm"></div>
                  <div class="prep-mm"></div>
                  <div class="prep-mm"></div>
                </aside>
              </div>
              <div class="prep-preview-foot">
                <div id="act-preview-stats" class="prep-preview-stats"></div>
                <div id="act-curate-action-bar" class="prep-curate-action-bar" style="display:none">
                  <button id="act-item-accept"  class="btn btn-sm prep-btn-action-accept"  disabled title="Marquer cette modification comme accept&#233;e">&#10003;&#160;Accepter</button>
                  <button id="act-item-ignore"  class="btn btn-sm prep-btn-action-ignore"  disabled title="Ignorer cette modification (ne pas appliquer)">&#215;&#160;Ignorer</button>
                  <button id="act-item-pending" class="btn btn-sm prep-btn-action-pending" disabled title="Remettre en attente de d&#233;cision">&#8635;&#160;En attente</button>
                  <span class="prep-action-bar-sep"></span>
                  <button id="act-bulk-accept"  class="btn btn-sm prep-btn-action-bulk" title="Accepter toutes les modifications visibles">&#10003;&#160;Tout accepter</button>
                  <button id="act-bulk-ignore"  class="btn btn-sm prep-btn-action-bulk" title="Ignorer toutes les modifications visibles">&#215;&#160;Tout ignorer</button>
                </div>
                <div class="prep-btn-row" style="margin-top:0.35rem">
                  <button id="act-apply-after-preview-btn" class="btn prep-btn-warning btn-sm" style="display:none">Appliquer maintenant</button>
                  <button id="act-reindex-after-curate-btn" class="btn btn-secondary btn-sm" style="display:none" title="L'index de recherche est périmé — cliquez pour le mettre à jour">Mettre à jour l'index</button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
      <details class="prep-curate-bottom-panel" id="act-curate-bottom-panel">
        <summary class="prep-curate-bottom-summary">
          <span class="prep-curate-bottom-title">Diagnostics &amp; journal <span class="prep-curate-log-badge" id="act-curate-log-badge" style="display:none"></span></span>
          <span class="prep-curate-bottom-hint">session courante</span>
        </summary>
        <div class="prep-curate-bottom-body">
          <div class="prep-curate-bottom-col curate-bottom-col-diag">
            <div class="prep-curate-bottom-col-head">Diagnostics</div>
            <div id="act-curate-session-summary" class="prep-curate-session-summary" style="display:none"></div>
            <div id="act-curate-diag" class="prep-curate-diag-list">
              <p class="empty-hint">Lancez une pr&#233;visualisation pour voir les statistiques.</p>
            </div>
            <div id="act-curate-seg-link" style="display:none;padding:8px 0"></div>
          </div>
          <div class="prep-curate-bottom-col curate-bottom-col-journal">
            <div class="prep-curate-bottom-col-head">Journal de revue</div>
            <div id="act-curate-review-log" class="prep-curate-log-list" aria-live="polite">
              <p class="empty-hint" style="padding:10px">Aucune action enregistr&#233;e.</p>
            </div>
            <div id="act-curate-context-card" class="prep-curate-bottom-context" style="display:none" aria-label="Contexte local de la modification active">
              <div class="prep-curate-bottom-context-head">
                Contexte local
                <span id="act-context-pos" style="font-size:11px;color:var(--prep-muted,#4f5d6d);margin-left:8px">&#8212;</span>
              </div>
              <div id="act-curate-context" class="prep-curate-context-body"></div>
            </div>
          </div>
          <div class="prep-curate-bottom-col curate-bottom-col-extra">
            <div id="act-review-export-card" class="prep-curate-bottom-export" style="display:none">
              <div class="prep-curate-bottom-col-head">Exporter le rapport</div>
              <div id="act-apply-result-note" class="prep-apply-result-note" style="display:none"></div>
              <div class="prep-review-export-row">
                <button class="btn btn-sm review-export-btn" id="act-review-export-json" title="Exporter en JSON structuré">JSON</button>
                <button class="btn btn-sm review-export-btn" id="act-review-export-csv" title="Exporter en CSV (une ligne par item)">CSV</button>
                <span id="act-review-export-result" class="prep-review-export-result" style="display:none"></span>
              </div>
              <p class="hint review-export-hint">Items de l&#8217;&#233;chantillon courant, statuts et d&#233;cisions.</p>
            </div>
            <details class="prep-exc-admin-panel" id="act-exc-admin-panel">
              <summary class="prep-curate-bottom-details-summary">
                Exceptions persistées <span id="act-exc-admin-badge" class="prep-exc-admin-count-badge" style="display:none">0</span>
              </summary>
              <div style="padding:6px 10px 10px">
                <div class="prep-exc-admin-toolbar">
                  <div class="prep-exc-admin-filters">
                    <button class="btn btn-sm prep-exc-filter-btn prep-exc-filter-active" data-exc-filter="all">Toutes</button>
                    <button class="btn btn-sm prep-exc-filter-btn" data-exc-filter="ignore">Ignore</button>
                    <button class="btn btn-sm prep-exc-filter-btn" data-exc-filter="override">Override</button>
                  </div>
                  <button class="btn btn-sm exc-admin-refresh" id="act-exc-admin-refresh" title="Actualiser la liste">&#8635;</button>
                </div>
                <div class="prep-exc-admin-doc-filter-row">
                  <select id="act-exc-doc-filter" class="prep-exc-doc-filter-select">
                    <option value="">Tous les documents</option>
                  </select>
                </div>
                <div class="prep-exc-admin-export-row">
                  <span class="prep-exc-export-label">Exporter&nbsp;:</span>
                  <button class="btn btn-sm exc-export-btn" id="act-exc-export-json" title="Exporter en JSON">JSON</button>
                  <button class="btn btn-sm exc-export-btn" id="act-exc-export-csv" title="Exporter en CSV">CSV</button>
                  <span id="act-exc-export-result" class="prep-exc-export-result" style="display:none"></span>
                </div>
                <div id="act-exc-admin-list" class="prep-exc-admin-list" aria-live="polite">
                  <p class="empty-hint">Ouvrez ce panneau apr&#232;s une pr&#233;visualisation.</p>
                </div>
              </div>
            </details>
            <details class="prep-apply-hist-panel" id="act-apply-hist-panel">
              <summary class="prep-curate-bottom-details-summary">
                Historique des apply <span id="act-apply-hist-badge" class="prep-apply-hist-badge" style="display:none">0</span>
              </summary>
              <div style="padding:6px 10px 10px">
                <div class="prep-apply-hist-toolbar">
                  <select id="act-apply-hist-scope" class="prep-apply-hist-scope-select" title="Filtrer par portée">
                    <option value="">Tous</option>
                    <option value="doc">Document</option>
                    <option value="all">Corpus</option>
                  </select>
                  <button class="btn btn-sm apply-hist-refresh" id="act-apply-hist-refresh" title="Actualiser">&#8635;</button>
                  <button class="btn btn-sm apply-hist-export-btn" id="act-apply-hist-export-json" title="Exporter en JSON">JSON</button>
                  <button class="btn btn-sm apply-hist-export-btn" id="act-apply-hist-export-csv" title="Exporter en CSV">CSV</button>
                </div>
                <div id="act-apply-hist-list" class="prep-apply-hist-list" aria-live="polite">
                  <p class="empty-hint">Ouvrez ce panneau pour charger l&#8217;historique.</p>
                </div>
                <span id="act-apply-hist-export-result" class="prep-apply-hist-export-result" style="display:none"></span>
              </div>
            </details>
          </div>
        </div>
      </details>
      <section class="card" data-collapsible="true" data-collapsed-default="true" id="act-conventions-card">
        <h3>Conventions</h3>
        <div id="act-conventions-list" class="prep-conv-list"></div>
        <form id="act-conventions-form" class="prep-conv-form" autocomplete="off">
          <div class="prep-conv-form-row">
            <input id="act-conv-name"  class="prep-conv-input" type="text"  placeholder="identifiant (ex: titre)"  maxlength="64" required />
            <input id="act-conv-label" class="prep-conv-input" type="text"  placeholder="label (ex: Titre)"        maxlength="64" required />
            <input id="act-conv-color" class="prep-conv-color-input" type="color" value="#6366f1" />
            <button type="submit" class="btn btn-primary btn-sm" disabled id="act-conv-add-btn">Ajouter</button>
          </div>
          <p id="act-conv-form-error" class="prep-conv-form-error" style="display:none"></p>
        </form>
      </section>
      <section class="card" data-collapsible="true" data-collapsed-default="true">
        <h3>Validation m&#233;tadonn&#233;es</h3>
        <div class="prep-form-row">
          <label>Document :
            <select id="act-meta-doc"><option value="">Tous</option></select>
          </label>
        </div>
        <div class="prep-btn-row" style="margin-top:0.5rem">
          <button id="act-meta-btn" class="btn btn-secondary" disabled>Valider</button>
        </div>
      </section>
    `;

    this._wireEvents(el);
    this._applyPreviewMode(el);
    this._refreshCurateHeaderState();
    initCardAccordions(el);
    this._bindCurateScrollSync();
    return el;
  }

  /** Clean up all listeners and timers. */
  /** Navigate to a specific document in the curation selector. */
  focusDoc(docId: number): void {
    const sel = this._q<HTMLSelectElement>("#act-curate-doc");
    if (!sel) return;
    if (sel.value === String(docId)) return;
    sel.value = String(docId);
    sel.dispatchEvent(new Event("change"));
  }

  dispose(): void {
    this._unbindCurateScrollSync();
    if (this._previewDebounceHandle !== null) {
      clearTimeout(this._previewDebounceHandle);
      this._previewDebounceHandle = null;
    }
    this._root = null;
  }

  // ── Event wiring ────────────────────────────────────────────────────────────

  private _wireEvents(el: HTMLElement): void {
    // Quick rule chips
    for (const sel of ["#act-rule-spaces", "#act-rule-quotes", "#act-rule-invisibles", "#act-rule-numbering"]) {
      el.querySelector(sel)!.addEventListener("change", () => {
        this._autoSwitchPreviewMode(el);
        this._schedulePreview(true);
      });
    }
    // Punctuation radio group
    el.querySelectorAll<HTMLInputElement>('input[name="curate-punct"]').forEach(radio => {
      radio.addEventListener("change", () => {
        this._autoSwitchPreviewMode(el);
        this._schedulePreview(true);
      });
    });
    // Doc list toolbar
    el.querySelector("#act-curate-doc-filter")?.addEventListener("input", (e) => {
      this._docListQuery = (e.target as HTMLInputElement).value;
      this._renderDocList();
    });
    el.querySelectorAll<HTMLButtonElement>(".prep-curate-sort-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this._docListSort = (btn.dataset.sort as "id" | "alpha") ?? "id";
        el.querySelectorAll<HTMLButtonElement>(".prep-curate-sort-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this._renderDocList();
      });
    });

    // Document selector
    el.querySelector("#act-curate-doc")!.addEventListener("change", () => {
      const newDocId = this._currentCurateDocId() ?? null;
      if (this._lastApplyResult !== null && this._lastApplyResult.doc_id !== newDocId) {
        this._lastApplyResult = null;
        this._updateApplyResultUI();
      }
      this._allUnits = [];
      this._allUnitsDocId = null;
      this._selectedUnitNs = new Set();
      this._lastSelectedN = null;
      this._frClearSearch();
      if (this._allOverridesDocId !== newDocId) {
        this._allOverrides = new Map();
        this._allOverridesDocId = null;
      }
      if (newDocId !== null) void this._loadAllUnits(newDocId);
      const divergeBanner = this._q<HTMLElement>("#act-curate-diverge-banner");
      if (divergeBanner) divergeBanner.style.display = "none";
      this._syncDocList();
      this._updateCurateCtx();
      this._schedulePreview(true);
    });

    // Preview mode buttons
    el.querySelectorAll<HTMLButtonElement>(".prep-preview-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.previewMode as "sidebyside" | "rawonly" | "diffonly";
        if (mode) {
          this._previewMode = mode;
          this._applyPreviewMode(el);
          if (mode !== "diffonly") {
            const docId = this._currentCurateDocId();
            if (docId !== undefined && this._allUnitsDocId !== docId) {
              void this._loadAllUnits(docId);
            } else if (docId !== undefined && this._allUnits.length > 0) {
              const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
              this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
            }
          }
        }
      });
    });

    // Sync-scroll toggle
    el.querySelector<HTMLInputElement>("#act-sync-scroll")?.addEventListener("change", (e) => {
      this._previewSyncScroll = (e.target as HTMLInputElement).checked;
    });

    // Diff navigation (buttons)
    el.querySelector("#act-diff-prev")?.addEventListener("click", () => {
      if (this._activeDiffIdx !== null && this._activeDiffIdx > 0)
        this._setActiveDiffItem(this._activeDiffIdx - 1, el);
    });
    el.querySelector("#act-diff-next")?.addEventListener("click", () => {
      const next = this._activeDiffIdx === null ? 0 : this._activeDiffIdx + 1;
      if (next < this._filteredExamples().length) this._setActiveDiffItem(next, el);
    });
    el.querySelector("#act-curate-filter-clear")?.addEventListener("click", () => {
      this._setRuleFilter(null, el);
    });

    // Diff list keyboard navigation — ArrowUp/Down to move, 'a' accept, 'i' ignore
    el.querySelector<HTMLElement>("#act-diff-list")?.addEventListener("keydown", (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const filtered = this._filteredExamples();
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = this._activeDiffIdx === null ? 0 : Math.min(this._activeDiffIdx + 1, filtered.length - 1);
        this._setActiveDiffItem(next, el);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (this._activeDiffIdx !== null && this._activeDiffIdx > 0)
          this._setActiveDiffItem(this._activeDiffIdx - 1, el);
      } else if (e.key === "a" && this._activeDiffIdx !== null) {
        e.preventDefault();
        this._setItemStatus("accepted");
      } else if (e.key === "i" && this._activeDiffIdx !== null) {
        e.preventDefault();
        this._setItemStatus("ignored");
      } else if (e.key === "p" && this._activeDiffIdx !== null) {
        e.preventDefault();
        this._setItemStatus("pending");
      }
    });

    // Review actions
    el.querySelector("#act-bulk-accept")?.addEventListener("click",  () => this._bulkSetStatus("accepted"));
    el.querySelector("#act-bulk-ignore")?.addEventListener("click",  () => this._bulkSetStatus("ignored"));

    // JSON rules textarea
    el.querySelector("#act-curate-rules")!.addEventListener("input", () => {
      this._autoSwitchPreviewMode(el);
      this._schedulePreview(true);
    });

    // Add advanced rule button
    el.querySelector("#act-curate-add-rule-btn")!.addEventListener("click", (evt) => {
      evt.preventDefault();
      this._addAdvancedCurateRule();
      this._autoSwitchPreviewMode(el);
    });

    // Reset button
    el.querySelector("#act-curate-reset-btn")?.addEventListener("click", () => {
      for (const id of ["#act-rule-spaces", "#act-rule-quotes", "#act-rule-invisibles", "#act-rule-numbering"]) {
        const cb = el.querySelector<HTMLInputElement>(id);
        if (cb) cb.checked = false;
      }
      const noneRadio = el.querySelector<HTMLInputElement>("#act-punct-none");
      if (noneRadio) noneRadio.checked = true;
      const ta = el.querySelector<HTMLTextAreaElement>("#act-curate-rules");
      if (ta) ta.value = "";
      this._frExtraRules = [];
      const findEl = el.querySelector<HTMLInputElement>("#act-fr-find");
      const replaceEl = el.querySelector<HTMLInputElement>("#act-fr-replace");
      if (findEl) findEl.value = "";
      if (replaceEl) replaceEl.value = "";
      this._allOverrides = new Map();
      this._previewMode = "rawonly";
      this._applyPreviewMode(el);
      if (this._allUnits.length > 0) this._renderRawPaneFull();
      this._schedulePreview(true);
    });

    // ── Find / Replace ─────────────────────────────────────────────────────
    const _frGetRegex = (): RegExp | null => {
      const pattern = el.querySelector<HTMLInputElement>("#act-fr-find")?.value.trim() ?? "";
      if (!pattern) return null;
      const isRegex = el.querySelector<HTMLInputElement>("#act-fr-regex")?.checked ?? false;
      const noCase  = el.querySelector<HTMLInputElement>("#act-fr-nocase")?.checked ?? false;
      const flags = "g" + (noCase ? "i" : "");
      try {
        return new RegExp(isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      } catch { return null; }
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

    // ── Navigation helpers (Trouver mode) ────────────────────────────────────
    const _frNavUpdatePos = () => {
      const pos = el.querySelector<HTMLElement>("#act-fr-nav-pos");
      if (pos) pos.textContent = this._frSearchHits.length > 0
        ? `${this._frSearchHitIdx + 1} / ${this._frSearchHits.length}`
        : "";
      const prevBtn = el.querySelector<HTMLButtonElement>("#act-fr-prev-btn");
      const nextBtn = el.querySelector<HTMLButtonElement>("#act-fr-next-btn");
      if (prevBtn) prevBtn.disabled = this._frSearchHitIdx <= 0;
      if (nextBtn) nextBtn.disabled = this._frSearchHitIdx >= this._frSearchHits.length - 1;
    };
    const _frScrollToHit = (idx: number) => {
      const uid = this._frSearchHits[idx];
      if (uid === undefined) return;
      const rawEl = this._q<HTMLElement>("#act-preview-raw");
      if (!rawEl) return;
      rawEl.querySelectorAll<HTMLElement>(".prep-raw-unit-found-active")
        .forEach(e => e.classList.remove("prep-raw-unit-found-active"));
      const target = rawEl.querySelector<HTMLElement>(`[data-unit-id="${uid}"]`);
      if (target) {
        target.classList.add("prep-raw-unit-found-active");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      this._frSearchHitIdx = idx;
      _frNavUpdatePos();
    };

    el.querySelector("#act-fr-count-btn")?.addEventListener("click", () => {
      const re = _frGetRegex();
      const findVal = el.querySelector<HTMLInputElement>("#act-fr-find")?.value.trim() ?? "";
      if (!findVal) { _frSetFeedback("Saisir un motif à chercher.", false); return; }
      if (!re) { _frSetFeedback("Expression régulière invalide.", false); return; }

      const docId = this._currentCurateDocId();
      if (docId === undefined) {
        _frSetFeedback("Sélectionnez un document.", false); return;
      }
      if (this._allUnits.length === 0) {
        _frSetFeedback("Unités en cours de chargement, réessayez dans un instant.", false); return;
      }

      // Search all loaded units
      this._frClearSearch();
      const hits: number[] = [];
      let totalOcc = 0;
      for (const unit of this._allUnits) {
        re.lastIndex = 0;
        const matches = (unit.text_norm ?? "").match(re);
        if (matches) { hits.push(unit.unit_id); totalOcc += matches.length; }
      }
      this._frSearchHits = hits;

      if (hits.length === 0) {
        _frSetFeedback(`Aucune occurrence dans ${this._allUnits.length} unités.`, false);
        return;
      }

      // Ensure raw pane is visible and rendered
      if (this._previewMode === "diffonly") {
        this._previewMode = "rawonly";
        this._applyPreviewMode(el);
      }
      if (!this._q("#act-preview-raw [data-unit-id]")) {
        this._renderRawPaneFull();
      } else {
        this._frApplySearchHighlights();
      }

      _frSetFeedback(`${totalOcc} occurrence(s) dans ${hits.length} unité(s) sur ${this._allUnits.length} analysées.`);
      const nav = el.querySelector<HTMLElement>("#act-fr-nav");
      if (nav) nav.style.display = "";
      this._frSearchHitIdx = 0;
      _frScrollToHit(0);
    });

    el.querySelector("#act-fr-prev-btn")?.addEventListener("click", () => {
      if (this._frSearchHitIdx > 0) _frScrollToHit(this._frSearchHitIdx - 1);
    });
    el.querySelector("#act-fr-next-btn")?.addEventListener("click", () => {
      if (this._frSearchHitIdx < this._frSearchHits.length - 1)
        _frScrollToHit(this._frSearchHitIdx + 1);
    });

    // Clear search highlights when pattern changes
    el.querySelector<HTMLInputElement>("#act-fr-find")?.addEventListener("input", () => {
      if (this._frSearchHits.length > 0) this._frClearSearch();
    });

    el.querySelector("#act-fr-apply-btn")?.addEventListener("click", () => {
      const pattern  = el.querySelector<HTMLInputElement>("#act-fr-find")?.value.trim() ?? "";
      const replaceVal = el.querySelector<HTMLInputElement>("#act-fr-replace")?.value ?? "";
      const isRegex  = el.querySelector<HTMLInputElement>("#act-fr-regex")?.checked ?? false;
      const noCase   = el.querySelector<HTMLInputElement>("#act-fr-nocase")?.checked ?? false;
      if (!pattern) { _frSetFeedback("Saisir un motif à chercher.", false); return; }
      const re = _frGetRegex();
      if (!re) { _frSetFeedback("Expression régulière invalide.", false); return; }
      const flags = "g" + (noCase ? "i" : "");
      const safePattern = isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      this._frExtraRules = [{
        pattern: safePattern,
        replacement: replaceVal,
        flags,
        description: `R/R: ${pattern}`,
      }];
      _frSetActive(true);
      _frSetFeedback("Règle R/R active — prévisualisation en cours…");
      this._autoSwitchPreviewMode(el);
      this._schedulePreview(true);
    });

    el.querySelector("#act-fr-clear-btn")?.addEventListener("click", () => {
      this._frExtraRules = [];
      this._frClearSearch();
      _frSetActive(false);
      _frSetFeedback("");
      const findEl   = el.querySelector<HTMLInputElement>("#act-fr-find");
      const replaceEl = el.querySelector<HTMLInputElement>("#act-fr-replace");
      if (findEl)   findEl.value = "";
      if (replaceEl) replaceEl.value = "";
      this._autoSwitchPreviewMode(el);
      this._schedulePreview(true);
    });

    // Primary action buttons
    el.querySelector("#act-curate-btn")!.addEventListener("click", () => void this._runCurate());
    el.querySelector("#act-apply-after-preview-btn")!.addEventListener("click", () => void this._runCurate());
    el.querySelector("#act-reindex-after-curate-btn")!.addEventListener("click", () => this._cb.onReindex?.());
    el.querySelector("#act-meta-btn")!.addEventListener("click", () => this._cb.onValidateMeta?.());
    el.querySelector("#act-curate-goto-annot-btn")?.addEventListener("click", () => {
      this._cb.onNavigate?.("annoter", { docId: this._currentCurateDocId() });
    });

    // Reload docs button
    el.querySelector("#act-reload-docs-btn")?.addEventListener("click", () => this._cb.onReloadDocs?.());

    // Roles card — mode toggle + assign/clear/deselect
    el.querySelector("#raw-role-mode-btn")?.addEventListener("click", () => {
      this._selectionMode = !this._selectionMode;
      const btn = el.querySelector<HTMLButtonElement>("#raw-role-mode-btn")!;
      btn.classList.toggle("active", this._selectionMode);
      btn.textContent = this._selectionMode ? "✓ Conventions actives" : "Activer Conventions";
      if (!this._selectionMode) {
        this._selectedUnitNs = new Set(); this._lastSelectedN = null;
        el.querySelectorAll<HTMLElement>(".prep-raw-unit-selected").forEach(p => p.classList.remove("prep-raw-unit-selected"));
        this._updateRoleBar();
      }
    });
    el.querySelector("#raw-role-assign-btn")?.addEventListener("click", () => {
      const role = el.querySelector<HTMLSelectElement>("#raw-role-select")?.value || null;
      if (!role) { this._cb.log("Sélectionnez un rôle à assigner.", true); return; }
      void this._applyRoleToSelected(role);
    });
    el.querySelector("#raw-role-clear-btn")?.addEventListener("click", () => { void this._applyRoleToSelected(null); });
    el.querySelector("#raw-role-deselect-btn")?.addEventListener("click", () => {
      this._selectedUnitNs = new Set(); this._lastSelectedN = null; this._updateRoleBar();
      el.querySelectorAll<HTMLElement>(".prep-raw-unit-selected").forEach(p => p.classList.remove("prep-raw-unit-selected"));
    });

    // Advanced rules tab switching
    el.querySelectorAll<HTMLButtonElement>(".prep-curate-adv-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.advTab;
        el.querySelectorAll<HTMLButtonElement>(".prep-curate-adv-tab").forEach(t => t.classList.toggle("active", t === tab));
        el.querySelectorAll<HTMLElement>("[data-adv-panel]").forEach(panel => {
          panel.style.display = panel.dataset.advPanel === target ? "" : "none";
        });
      });
    });

    // Diagnostics "Voir segmentation" link
    el.querySelector("#act-curate-seg-link")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action='goto-seg']");
      if (btn) this._cb.onNavigate?.("segmentation", { docId: this._currentCurateDocId() });
    });

    // Convention form
    el.querySelector("#act-conventions-form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      void this._conventionAdd();
    });
    const _convInputChange = () => {
      const name  = (el.querySelector<HTMLInputElement>("#act-conv-name")?.value ?? "").trim();
      const label = (el.querySelector<HTMLInputElement>("#act-conv-label")?.value ?? "").trim();
      const btn   = el.querySelector<HTMLButtonElement>("#act-conv-add-btn");
      if (btn) btn.disabled = !(name && label);
    };
    el.querySelector("#act-conv-name")!.addEventListener("input", _convInputChange);
    el.querySelector("#act-conv-label")!.addEventListener("input", _convInputChange);

    // ── Exceptions admin panel (Level 8A) ──────────────────────────────────
    el.querySelector("#act-exc-admin-refresh")?.addEventListener("click", () => {
      void this._loadExceptionsAdminPanel();
    });
    el.querySelector<HTMLDetailsElement>("#act-exc-admin-panel")?.addEventListener("toggle", (e) => {
      const det = e.target as HTMLDetailsElement;
      if (det.open && this._excAdminAll.length === 0) void this._loadExceptionsAdminPanel();
    });
    el.querySelectorAll<HTMLButtonElement>(".prep-exc-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const filter = btn.dataset.excFilter as "all" | "ignore" | "override" | undefined;
        if (filter) this._setExcAdminFilter(filter);
      });
    });
    el.querySelector("#act-exc-admin-list")?.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-exc-unit-id]");
      if (!row) return;
      const unitId = parseInt(row.dataset.excUnitId ?? "0");
      if (!unitId) return;
      if (target.closest(".prep-exc-row-delete")) {
        await this._excAdminDelete(unitId);
      } else if (target.closest(".prep-exc-row-edit-start")) {
        this._excAdminEnterEdit(unitId);
      } else if (target.closest(".prep-exc-row-edit-save")) {
        await this._excAdminSaveEdit(unitId);
      } else if (target.closest(".prep-exc-row-edit-cancel")) {
        this._excAdminCancelEdit(unitId);
      } else if (target.closest(".prep-exc-row-open-curation")) {
        const exc = this._excAdminAll.find(e => e.unit_id === unitId);
        if (exc) await this._excAdminOpenInCuration(exc);
      }
    });
    el.querySelector<HTMLSelectElement>("#act-exc-doc-filter")?.addEventListener("change", (e) => {
      const val = (e.target as HTMLSelectElement).value;
      this._excAdminDocFilter = val ? parseInt(val) : 0;
      this._renderExcAdminPanel();
    });
    el.querySelector("#act-exc-export-json")?.addEventListener("click", () => void this._runExcAdminExport("json"));
    el.querySelector("#act-exc-export-csv")?.addEventListener("click",  () => void this._runExcAdminExport("csv"));

    // Review export
    el.querySelector("#act-review-export-json")?.addEventListener("click", () => void this._runExportReviewReport("json"));
    el.querySelector("#act-review-export-csv")?.addEventListener("click",  () => void this._runExportReviewReport("csv"));

    // Apply history panel
    el.querySelector<HTMLDetailsElement>("#act-apply-hist-panel")?.addEventListener("toggle", (e) => {
      if ((e.target as HTMLDetailsElement).open) void this._loadApplyHistoryPanel();
    });
    el.querySelector("#act-apply-hist-refresh")?.addEventListener("click", () => void this._loadApplyHistoryPanel());
    el.querySelector("#act-apply-hist-scope")?.addEventListener("change", () => void this._loadApplyHistoryPanel());
    el.querySelector("#act-apply-hist-export-json")?.addEventListener("click", () => void this._runApplyHistoryExport("json"));
    el.querySelector("#act-apply-hist-export-csv")?.addEventListener("click",  () => void this._runApplyHistoryExport("csv"));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // PLACEHOLDER METHODS — implementations follow in subsequent parts
  // ────────────────────────────────────────────────────────────────────────────

  private _bindCurateScrollSync(): void {
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    const diffEl = this._q<HTMLElement>("#act-diff-list");
    if (!rawEl || !diffEl) return;
    this._unbindCurateScrollSync();
    this._onCurateRawScroll = () => {
      if (!this._previewSyncScroll || this._curateSyncLock || rawEl.dataset.fullText === "1") return;
      this._curateSyncLock = true;
      const maxRaw = rawEl.scrollHeight - rawEl.clientHeight;
      const ratio = maxRaw > 0 ? rawEl.scrollTop / maxRaw : 0;
      diffEl.scrollTop = ratio * Math.max(0, diffEl.scrollHeight - diffEl.clientHeight);
      requestAnimationFrame(() => { this._curateSyncLock = false; });
    };
    this._onCurateDiffScroll = () => {
      if (!this._previewSyncScroll || this._curateSyncLock || rawEl.dataset.fullText === "1") return;
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
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    const diffEl = this._q<HTMLElement>("#act-diff-list");
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

  private _schedulePreview(silent = false): void {
    if (!this._getConn() || this._cb.isBusy()) return;
    if (this._previewDebounceHandle !== null) window.clearTimeout(this._previewDebounceHandle);
    this._previewDebounceHandle = window.setTimeout(() => {
      this._previewDebounceHandle = null;
      void this._runPreview(silent);
    }, 260);
  }

  private _applyCurationPreset(preset?: string): void {
    const spaces = this._q<HTMLInputElement>("#act-rule-spaces");
    const quotes = this._q<HTMLInputElement>("#act-rule-quotes");
    if (!spaces || !quotes) return;
    const setPunctLang = (v: "" | "fr" | "en") => {
      const id = v === "fr" ? "act-punct-fr" : v === "en" ? "act-punct-en" : "act-punct-none";
      const radio = this._q<HTMLInputElement>(`#${id}`);
      if (radio) radio.checked = true;
    };
    const mode = (preset ?? "spaces").trim();
    if (mode === "spaces") { spaces.checked = true; quotes.checked = false; setPunctLang(""); }
    else if (mode === "quotes") { spaces.checked = false; quotes.checked = true; setPunctLang(""); }
    else if (mode === "punctuation" || mode === "punctuation_en") { spaces.checked = false; quotes.checked = false; setPunctLang("en"); }
    else if (mode === "punctuation_fr") { spaces.checked = false; quotes.checked = false; setPunctLang("fr"); }
    else { spaces.checked = true; quotes.checked = true; setPunctLang("fr"); }
    this._schedulePreview(true);
  }

  private _isRuleChecked(id: string): boolean {
    return this._q<HTMLInputElement>(`#${id}`)?.checked ?? false;
  }

  private _getPunctLang(): "fr" | "en" | "" {
    // Lit le DOM puis délègue la validation/typage au helper pur.
    const el = this._q<HTMLInputElement>('input[name="curate-punct"]:checked');
    return getPunctLangFromValue(el?.value);
  }

  private _parseAdvancedCurateRules(raw: string): CurateRule[] {
    // Délégué au helper pur (testé dans __tests__/curationPresets.test.ts).
    return parseAdvancedCurateRules(raw);
  }

  private _addAdvancedCurateRule(): void {
    const patternEl     = this._q<HTMLInputElement>("#act-curate-quick-pattern");
    const replacementEl = this._q<HTMLInputElement>("#act-curate-quick-replacement");
    const flagsEl       = this._q<HTMLInputElement>("#act-curate-quick-flags");
    const rulesEl       = this._q<HTMLTextAreaElement>("#act-curate-rules");
    if (!patternEl || !replacementEl || !flagsEl || !rulesEl) return;
    const pattern = patternEl.value.trim();
    if (!pattern) { this._cb.log("Saisissez un motif de recherche pour ajouter une règle.", true); return; }
    const replacement = replacementEl.value;
    const flags = flagsEl.value.trim();
    const existing = this._parseAdvancedCurateRules(rulesEl.value);
    existing.push({ pattern, replacement, ...(flags ? { flags } : {}) });
    rulesEl.value = JSON.stringify(existing, null, 2);
    patternEl.value = ""; replacementEl.value = ""; flagsEl.value = "g";
    this._cb.log(`Règle avancée ajoutée (${existing.length} au total).`);
    this._schedulePreview(true);
  }

  private _hasActiveRules(el: HTMLElement): boolean {
    const anyChip = ["#act-rule-spaces","#act-rule-quotes","#act-rule-invisibles","#act-rule-numbering"]
      .some(id => el.querySelector<HTMLInputElement>(id)?.checked);
    return anyChip || this._getPunctLang() !== ""
      || this._parseAdvancedCurateRules(el.querySelector<HTMLTextAreaElement>("#act-curate-rules")?.value ?? "").length > 0
      || this._frExtraRules.length > 0;
  }

  private _autoSwitchPreviewMode(el: HTMLElement): void {
    const hasRules = this._hasActiveRules(el);
    if (this._previewMode === "rawonly" && hasRules) { this._previewMode = "sidebyside"; this._applyPreviewMode(el); }
    else if (this._previewMode === "sidebyside" && !hasRules) { this._previewMode = "rawonly"; this._applyPreviewMode(el); }
  }

  private _applyPreviewMode(container: HTMLElement): void {
    const rawPane  = container.querySelector<HTMLElement>("#act-preview-raw")?.closest<HTMLElement>(".prep-pane");
    const diffPane = container.querySelector<HTMLElement>("#act-diff-list")?.closest<HTMLElement>(".prep-pane");
    if (rawPane)  rawPane.style.display  = this._previewMode === "diffonly" ? "none" : "";
    if (diffPane) diffPane.style.display = this._previewMode === "rawonly"  ? "none" : "";
    container.querySelectorAll<HTMLButtonElement>(".prep-preview-mode-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.previewMode === this._previewMode);
    });
    const previewGrid = container.querySelector<HTMLElement>(".prep-preview-grid");
    if (previewGrid) previewGrid.dataset.previewMode = this._previewMode;
    // Show role controls only in raw-text mode
    const inRaw = this._previewMode === "rawonly";
    const hint = this._q<HTMLElement>("#act-roles-hint");
    const controls = this._q<HTMLElement>("#act-roles-controls");
    if (hint)     hint.style.display     = inRaw ? "none" : "";
    if (controls) controls.style.display = inRaw ? "" : "none";
  }

  private _currentRules(): CurateRule[] {
    const rules: CurateRule[] = [];
    if (this._isRuleChecked("act-rule-spaces"))    rules.push(...CURATE_PRESETS.spaces.rules);
    if (this._isRuleChecked("act-rule-quotes"))    rules.push(...CURATE_PRESETS.quotes.rules);
    const punctLang = this._getPunctLang();
    if (punctLang === "fr") rules.push(...CURATE_PRESETS.punctuation_fr.rules);
    else if (punctLang === "en") rules.push(...CURATE_PRESETS.punctuation_en.rules);
    if (this._isRuleChecked("act-rule-invisibles")) rules.push(...CURATE_PRESETS.invisibles.rules);
    if (this._isRuleChecked("act-rule-numbering"))  rules.push(...CURATE_PRESETS.numbering.rules);
    const raw = this._q<HTMLTextAreaElement>("#act-curate-rules")?.value ?? "";
    rules.push(...this._parseAdvancedCurateRules(raw));
    rules.push(...this._frExtraRules);
    return rules;
  }

  private _currentCurateDocId(): number | undefined {
    const v = this._q<HTMLSelectElement>("#act-curate-doc")?.value;
    return v ? parseInt(v) : undefined;
  }

  private _curateDocIndex(docId: number | undefined): number {
    if (docId === undefined) return -1;
    return this._getDocs().findIndex(d => d.doc_id === docId);
  }

  private _navigateCurateDoc(direction: -1 | 1): void {
    const sel = this._q<HTMLSelectElement>("#act-curate-doc");
    const docs = this._getDocs();
    if (!sel || docs.length === 0) return;
    const idx = this._curateDocIndex(this._currentCurateDocId());
    let nextIdx = idx < 0 ? (direction > 0 ? 0 : docs.length - 1) : idx + direction;
    if (nextIdx < 0 || nextIdx >= docs.length) return;
    sel.value = String(docs[nextIdx].doc_id);
    sel.dispatchEvent(new Event("change"));
  }

  private _refreshCurateHeaderState(): void {
    const docLabelEl = this._q<HTMLElement>("#act-curate-doc-label");
    const modePillEl = this._q<HTMLElement>("#act-curate-mode-pill");
    const docId = this._currentCurateDocId();
    const doc = docId !== undefined ? this._getDocs().find(d => d.doc_id === docId) : undefined;
    if (docLabelEl) docLabelEl.textContent = doc ? `#${doc.doc_id} · ${doc.title} (${doc.language})` : "Portée: tous les documents";
    if (modePillEl) {
      if (!this._getConn()) modePillEl.textContent = "Hors ligne";
      else if (this._cb.isBusy()) modePillEl.textContent = "En cours\u2026";
      else if (this._hasPendingPreview) modePillEl.textContent = "Preview\u2026";
      else if (doc) modePillEl.textContent = `Doc.\u00a0#${doc.doc_id}`;
      else modePillEl.textContent = "Tous les documents";
    }
  }

  private _renderCurateQuickQueue(): void {
    const queueEl = this._q<HTMLElement>("#act-curate-queue");
    const prevBtn = this._q<HTMLButtonElement>("#act-curate-prev-btn");
    const nextBtn = this._q<HTMLButtonElement>("#act-curate-next-btn");
    if (!queueEl) return;
    const docs = this._getDocs();
    if (docs.length === 0) {
      queueEl.innerHTML = '<p class="empty-hint">Aucun document charg&#233;.</p>';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }
    const currentId = this._currentCurateDocId();
    const currentIdx = this._curateDocIndex(currentId);
    if (currentIdx < 0) {
      queueEl.innerHTML = `<div class="prep-curate-qitem"><div class="prep-curate-qmeta"><span>File locale</span><span>${docs.length} doc(s)</span></div><div>Aucun document cibl&#233;. Utilisez <strong>Suivant</strong> pour d&#233;marrer la revue locale.</div></div>`;
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = false;
      return;
    }
    const start = Math.max(0, currentIdx - 1);
    const end = Math.min(docs.length, currentIdx + 2);
    queueEl.innerHTML = docs.slice(start, end).map((doc, offset) => {
      const idx = start + offset;
      const state = idx === currentIdx ? "Document actif" : idx < currentIdx ? "D&#233;j&#224; revu" : "Suivant";
      const role = doc.doc_role ? `${_escHtml(doc.doc_role)} · ` : "";
      return `<div class="prep-curate-qitem${idx === currentIdx ? " prep-curate-log-apply" : ""}">` +
        `<div class="prep-curate-qmeta"><span>#${doc.doc_id} · ${_escHtml(doc.language)}</span><span>${state}</span></div>` +
        `<div>${_escHtml(doc.title)}</div>` +
        `<div style="font-size:11px;color:var(--prep-muted,#4f5d6d)">${role}${doc.unit_count} unit&#233;s</div></div>`;
    }).join("");
    if (prevBtn) prevBtn.disabled = currentIdx <= 0;
    if (nextBtn) nextBtn.disabled = currentIdx >= docs.length - 1;
  }

  private _updateCurateCtx(): void {
    const docId = this._currentCurateDocId();
    const doc = docId !== undefined ? this._getDocs().find(d => d.doc_id === docId) : undefined;
    const langEl = this._q<HTMLElement>("#act-curate-ctx-lang");
    if (langEl) langEl.textContent = !doc ? "fr" : (doc.language ?? "fr");
    this._refreshCurateHeaderState();
  }

  private _pushCurateLog(kind: "preview" | "apply" | "warn", msg: string): void {
    // Append + cap délégué au helper pur (testé dans
    // __tests__/curationDiagnostics.test.ts).
    this._curateLog = appendCurateLogEntry(this._curateLog, kind, msg);
    const bottomPanel = this._q<HTMLDetailsElement>("#act-curate-bottom-panel");
    // Auto-open only for warnings — individual accept/ignore clicks (kind="apply")
    // and previews should not force-open the panel and disrupt the review workflow.
    if (bottomPanel && !bottomPanel.open && kind === "warn") bottomPanel.open = true;
    this._renderCurateLog();
  }

  private _renderCurateLog(): void {
    const el = this._q<HTMLElement>("#act-curate-review-log");
    if (!el) return;
    el.innerHTML = formatCurateLog(this._curateLog, Date.now());
    // Update the badge on the <summary> so the count is visible when the panel is collapsed.
    const badge = this._q<HTMLElement>("#act-curate-log-badge");
    if (badge) {
      const warnCount = countCurateWarnings(this._curateLog);
      if (warnCount > 0) {
        badge.textContent = String(warnCount);
        badge.style.display = "";
      } else {
        badge.style.display = "none";
      }
    }
  }

  private _getStatusCounts(): { pending: number; accepted: number; ignored: number } {
    return getStatusCounts(this._curateExamples);
  }

  private _setItemStatus(status: NonNullable<CuratePreviewExample["status"]>): void {
    if (this._activeDiffIdx === null) return;
    const filtered = this._filteredExamples();
    const ex = filtered[this._activeDiffIdx];
    if (!ex) return;
    const prevStatus = ex.status ?? "pending";
    if (prevStatus === status) return;
    ex.status = status;
    const idx = this._activeDiffIdx;
    if (!this._activeStatusFilter || this._activeStatusFilter === status) {
      const row = this._q<HTMLElement>(`tr[data-diff-idx="${idx}"]`);
      if (row) {
        row.classList.remove("diff-pending","diff-accepted","diff-ignored");
        row.classList.add(`diff-${status}`);
        this._renderStatusBadge(row, status);
      }
      const para = this._q<HTMLElement>(`.raw-unit[data-diff-idx="${idx}"]`);
      if (para) { para.classList.remove("prep-raw-pending","prep-raw-accepted","prep-raw-ignored"); para.classList.add(`prep-raw-${status}`); }
      this._updateActionButtons();
    } else {
      const newFiltered = this._filteredExamples();
      this._activeDiffIdx = null;
      this._refreshCuratePreviewPanes();
      const panel = this._q<HTMLElement>("#act-preview-panel");
      if (newFiltered.length > 0) this._setActiveDiffItem(Math.min(idx, newFiltered.length - 1), panel);
      else {
        this._updateActionButtons();
        const posEl = this._q<HTMLElement>("#act-diff-position");
        if (posEl) posEl.textContent = "0 modif.";
        [this._q<HTMLButtonElement>("#act-diff-prev"), this._q<HTMLButtonElement>("#act-diff-next")].forEach(b => { if (b) b.disabled = true; });
      }
    }
    this._updateSessionSummary();
    this._saveCurateReviewState();
    const extId = ex.external_id ?? (idx + 1);
    const sl = CurationView._STATUS_LABEL;
    this._pushCurateLog("apply", `Unité ${extId} : ${sl[prevStatus] ?? prevStatus} → ${sl[status]}`);
  }

  private _bulkSetStatus(status: NonNullable<CuratePreviewExample["status"]>): void {
    const filtered = this._filteredExamples();
    if (filtered.length === 0) return;
    for (const ex of filtered) ex.status = status;
    const newFiltered = this._filteredExamples();
    this._activeDiffIdx = null;
    this._refreshCuratePreviewPanes();
    const panel = this._q<HTMLElement>("#act-preview-panel");
    if (newFiltered.length > 0) this._setActiveDiffItem(0, panel);
    else this._updateActionButtons();
    this._updateSessionSummary();
    this._saveCurateReviewState();
    this._pushCurateLog("apply", `Lot : ${filtered.length} modif(s) → ${CurationView._STATUS_LABEL[status]}`);
  }

  private _setStatusFilter(status: "pending" | "accepted" | "ignored" | null): void {
    this._activeStatusFilter = status;
    this._activeDiffIdx = null;
    this._curatePreviewPage = 0;
    const filtered = this._filteredExamples();
    this._refreshCuratePreviewPanes();
    this._updateSessionSummary();
    const panel = this._q<HTMLElement>("#act-preview-panel");
    if (filtered.length > 0) this._setActiveDiffItem(0, panel);
    else {
      this._updateActionButtons();
      const posEl = this._q<HTMLElement>("#act-diff-position");
      if (posEl) posEl.textContent = status ? "0 modif." : "—";
      [this._q<HTMLButtonElement>("#act-diff-prev"), this._q<HTMLButtonElement>("#act-diff-next")].forEach(b => { if (b) b.disabled = true; });
    }
  }

  private _updateSessionSummary(): void {
    const el = this._q<HTMLElement>("#act-curate-session-summary");
    if (!el) return;
    const total = this._curateExamples.length;
    if (total === 0) { el.style.display = "none"; return; }
    el.style.display = "";
    const c = this._getStatusCounts();
    const af = this._activeStatusFilter;
    const sl = CurationView._STATUS_LABEL;
    const chip = (key: "pending" | "accepted" | "ignored", icon: string, label: string, count: number) =>
      `<span class="prep-session-chip prep-session-${key}${af === key ? " prep-session-chip-active" : ""}"` +
      ` data-sf="${key}" role="button" tabindex="0" title="${af === key ? "Effacer ce filtre" : `Filtrer : ${label}`}">` +
      `${icon}&#160;<strong>${count}</strong>&#160;<span class="prep-session-chip-label">${label}</span></span>`;
    const docId = this._currentCurateDocId() ?? null;
    const isAllMode = docId === null;
    let restoreNotice: string;
    if (this._curateRestoredCount > 0) {
      const countText = this._curateSavedCount > this._curateRestoredCount
        ? `${this._curateRestoredCount} statut(s) restauré(s) sur ${this._curateSavedCount} sauvegardé(s)`
        : `${this._curateRestoredCount} statut(s) restauré(s)`;
      const modeNote = isAllMode ? ` <em>(sélection modifiée depuis la preview)</em>` : "";
      restoreNotice = `<div class="prep-session-restore-notice" title="Statuts restaurés depuis la session précédente">&#8635; ${countText}${modeNote} &#8212; <button class="prep-btn-inline-link" id="act-reset-review">Réinitialiser</button></div>`;
    } else {
      const modeNote = isAllMode ? `<span class="prep-session-all-note" title="Portée globale">&#9432; Portée globale</span> &#8212; ` : "";
      restoreNotice = `<div class="prep-session-reset-row">${modeNote}<button class="prep-btn-inline-link" id="act-reset-review">Effacer la review sauvegardée</button></div>`;
    }
    el.innerHTML =
      `<div class="prep-session-counts">${chip("pending","&#9632;",sl.pending,c.pending)}${chip("accepted","&#10003;",sl.accepted,c.accepted)}${chip("ignored","&#215;",sl.ignored,c.ignored)}</div>` +
      (af ? `<div class="prep-session-filter-note">Filtre statut actif &#8212; <button class="prep-btn-inline-link" id="act-clear-sf">Afficher tout</button></div>` : "") +
      (() => { const n = countManualOverrides(this._curateExamples); return n > 0 ? `<div class="prep-session-override-note">&#9998;&#160;${n} correction(s) manuelle(s)</div>` : ""; })() +
      (() => { const n = this._curateExceptions.size; return n > 0 ? `<div class="prep-session-exception-note">🔒&#160;${n} exception(s) persistée(s)</div>` : ""; })() +
      restoreNotice;
    el.querySelectorAll<HTMLElement>("[data-sf]").forEach(chip => {
      chip.addEventListener("click", () => { const sf = chip.dataset.sf as "pending"|"accepted"|"ignored"; this._setStatusFilter(this._activeStatusFilter === sf ? null : sf); });
      chip.addEventListener("keydown", e => { if ((e as KeyboardEvent).key === "Enter") chip.click(); });
    });
    el.querySelector("#act-clear-sf")?.addEventListener("click", () => this._setStatusFilter(null));
    el.querySelector("#act-reset-review")?.addEventListener("click", () => this._clearCurateReviewState());
  }

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
    if (pending) { pending.disabled = !hasActive || currentStatus === "pending"; pending.classList.toggle("action-active", hasActive && currentStatus === "pending"); }
  }

  private _renderStatusBadge(row: HTMLElement, status: string): void {
    const existing = row.querySelector<HTMLElement>(".prep-diff-status-badge");
    if (status === "pending") { existing?.remove(); return; }
    const badge = existing ?? document.createElement("span");
    badge.className = `prep-diff-status-badge diff-status-${status}`;
    badge.textContent = status === "accepted" ? "✓" : "✗";
    badge.title = CurationView._STATUS_LABEL[status] ?? status;
    if (!existing) { const firstCell = row.querySelector("td"); if (firstCell) firstCell.appendChild(badge); }
  }

  private _filteredExamples(): CuratePreviewExample[] {
    // Délégué au helper pur (testé dans __tests__/curationFiltering.test.ts).
    return filterExamples(
      this._curateExamples,
      this._activeRuleFilter,
      this._activeStatusFilter,
      this._curateRuleLabels,
    );
  }

  private _getRuleStats(): Map<string, number> {
    return getRuleStats(this._curateExamples, this._curateRuleLabels);
  }

  private _setRuleFilter(label: string | null, panel?: HTMLElement | null): void {
    this._activeRuleFilter = label;
    this._activeDiffIdx = null;
    this._curatePreviewPage = 0;
    const filtered = this._filteredExamples();
    this._refreshCuratePreviewPanes();
    this._updateFilterBadge(panel);
    (panel ?? document).querySelectorAll<HTMLElement>(".prep-curate-diag-rule-chip").forEach(chip => {
      chip.classList.toggle("active", chip.dataset.ruleLabel === label);
    });
    if (filtered.length > 0) {
      this._setActiveDiffItem(0, panel);
    } else {
      const posEl = (panel ?? this._root)?.querySelector<HTMLElement>("#act-diff-position") ?? this._q<HTMLElement>("#act-diff-position");
      if (posEl) posEl.textContent = label ? "0 modif." : "—";
      [(panel ?? this._root)?.querySelector<HTMLButtonElement>("#act-diff-prev"),
       (panel ?? this._root)?.querySelector<HTMLButtonElement>("#act-diff-next")].forEach(btn => { if (btn) btn.disabled = true; });
    }
  }

  private _updateSampleInfo(): void {
    // HTML/className délégué au helper pur (testé dans
    // __tests__/curationSampleInfo.test.ts). Reste DOM-bound :
    // mute display + className + innerHTML selon le résultat.
    const el = this._q<HTMLElement>("#act-curate-sample-info");
    if (!el) return;
    const banner = buildSampleInfo(
      this._curateExamples.length,
      this._curateGlobalChanged,
      CURATE_PREVIEW_LIMIT,
    );
    if (!banner) { el.style.display = "none"; return; }
    el.style.display = "";
    el.className = banner.className;
    el.innerHTML = banner.html;
  }

  private _updateFilterBadge(panel?: HTMLElement | null): void {
    const scope = panel ?? document;
    const badge = scope.querySelector<HTMLElement>("#act-curate-filter-badge") ?? this._q<HTMLElement>("#act-curate-filter-badge");
    const labelEl = scope.querySelector<HTMLElement>("#act-curate-filter-label") ?? this._q<HTMLElement>("#act-curate-filter-label");
    if (!badge) return;
    if (this._activeRuleFilter) { badge.style.display = ""; if (labelEl) labelEl.textContent = this._activeRuleFilter; }
    else badge.style.display = "none";
  }

  private _setActiveDiffItem(idx: number | null, panel?: HTMLElement | null): void {
    if (this._editingManualOverride) this._editingManualOverride = false;
    if (idx !== null) {
      const targetPage = Math.floor(idx / CURATE_PAGE_SIZE);
      if (targetPage !== this._curatePreviewPage) {
        this._curatePreviewPage = targetPage;
        this._renderDiffList(this._filteredExamples());
      }
    }
    this._activeDiffIdx = idx;
    const scope: Element | Document = panel ?? this._root ?? document;
    scope.querySelectorAll<HTMLElement>("tr[data-diff-idx]").forEach(tr => {
      const isActive = tr.dataset.diffIdx === String(idx);
      tr.classList.toggle("diff-active", isActive);
      tr.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    if (idx !== null) {
      const activeRow = scope.querySelector<HTMLElement>(`tr[data-diff-idx="${idx}"]`);
      activeRow?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    scope.querySelectorAll<HTMLElement>("[data-diff-idx].raw-unit").forEach(p => {
      p.classList.toggle("prep-raw-active", p.dataset.diffIdx === String(idx));
    });
    if (idx !== null && this._previewSyncScroll) {
      scope.querySelector<HTMLElement>(`.raw-unit[data-diff-idx="${idx}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    const total = this._filteredExamples().length;
    const filterParts: string[] = [];
    if (this._activeRuleFilter)   filterParts.push(this._activeRuleFilter);
    if (this._activeStatusFilter) filterParts.push(CurationView._STATUS_LABEL[this._activeStatusFilter] ?? this._activeStatusFilter);
    const filterSuffix = filterParts.length ? ` (${filterParts.join(" + ")})` : "";
    const posEl = scope.querySelector<HTMLElement>("#act-diff-position") ?? this._q<HTMLElement>("#act-diff-position");
    if (posEl) posEl.textContent = total > 0 && idx !== null ? `${idx + 1} / ${total}${filterSuffix}` : total > 0 ? `${total} modif.` : "—";
    const prevBtn = scope.querySelector<HTMLButtonElement>("#act-diff-prev") ?? this._q<HTMLButtonElement>("#act-diff-prev");
    const nextBtn = scope.querySelector<HTMLButtonElement>("#act-diff-next") ?? this._q<HTMLButtonElement>("#act-diff-next");
    if (prevBtn) prevBtn.disabled = idx === null || idx <= 0;
    if (nextBtn) nextBtn.disabled = idx === null || idx >= total - 1;
    const infoEl = this._q<HTMLElement>("#act-preview-info");
    if (infoEl && total > 0 && idx !== null) infoEl.textContent = `Modif. ${idx + 1}/${total}${filterSuffix}`;
    this._updateActionButtons();
    const activeEx = idx !== null ? this._filteredExamples()[idx] ?? null : null;
    this._renderContextDetail(activeEx);
  }

  private _updateApplyResultUI(): void {
    const noteEl = this._q<HTMLElement>("#act-apply-result-note");
    if (!noteEl) return;
    if (!this._lastApplyResult) { noteEl.style.display = "none"; return; }
    const r = this._lastApplyResult;
    noteEl.style.display = "";
    noteEl.innerHTML = `<strong>Dernier apply</strong> : ${r.units_modified} unité(s) modifiée(s)` +
      (r.doc_id !== null ? ` (doc #${r.doc_id})` : " (corpus)") +
      ` — ${new Date(r.applied_at ?? Date.now()).toLocaleTimeString("fr-FR")}`;
  }
  // ── FNV-1a helpers ────────────────────────────────────────────────────────

  // Fingerprint functions delegated to lib/curationFingerprint.ts (testable without DOM)
  private static _rulesSignature = _rulesSignature;
  private static _sampleFingerprint = _sampleFingerprint;
  private static _sampleTextFingerprint = _sampleTextFingerprint;

  // ── localStorage review state ─────────────────────────────────────────────

  private _curateReviewKey(docId: number | null): string {
    return CurationView.LS_CURATE_REVIEW_PREFIX + (docId ?? "all");
  }

  private _clearAllCurateReviewKeys(): number {
    const prefix = CurationView.LS_CURATE_REVIEW_PREFIX;
    const toRemove: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) toRemove.push(k); }
      for (const k of toRemove) { try { localStorage.removeItem(k); } catch { /* */ } }
    } catch { /* */ }
    return toRemove.length;
  }

  private _saveCurateReviewState(): void {
    if (this._curateExamples.length === 0) return;
    const docId = this._currentCurateDocId() ?? null;
    const rules = this._currentRules();
    const sig = CurationView._rulesSignature(rules);
    const statuses: Record<string, "accepted"|"ignored"> = {};
    const overrides: Record<string, string> = {};
    for (const ex of this._curateExamples) {
      if (ex.unit_id === undefined) continue;
      if (ex.status === "accepted" || ex.status === "ignored") statuses[String(ex.unit_id)] = ex.status;
      if (ex.is_manual_override && ex.manual_after != null) overrides[String(ex.unit_id)] = ex.manual_after;
    }
    const key = this._curateReviewKey(docId);
    if (Object.keys(statuses).length === 0 && Object.keys(overrides).length === 0) {
      try { localStorage.removeItem(key); } catch { /* */ }
      return;
    }
    const state: StoredCurateReviewState = {
      version: 5, docId, rulesSignature: sig, updatedAt: Date.now(),
      unitsTotal: this._curateUnitsTotal, unitsChanged: this._curateGlobalChanged,
      sampleFingerprint: CurationView._sampleFingerprint(this._curateExamples),
      sampleSize: this._curateExamples.length,
      sampleTextFingerprint: CurationView._sampleTextFingerprint(this._curateExamples),
      statuses, ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    };
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* quota */ }
  }

  private _loadCurateReviewState(docId: number | null, rulesSignature: string): StoredCurateReviewState | null {
    try {
      const raw = localStorage.getItem(this._curateReviewKey(docId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredCurateReviewState;
      if (![1,2,3,4,5].includes(parsed.version)) return null;
      if (parsed.rulesSignature !== rulesSignature) return null;
      if (typeof parsed.statuses !== "object" || parsed.statuses === null) return null;
      return parsed;
    } catch { return null; }
  }

  private _restoreCurateReviewState(rules: CurateRule[], currentUnitsTotal: number): number {
    const docId = this._currentCurateDocId() ?? null;
    const sig = CurationView._rulesSignature(rules);
    const saved = this._loadCurateReviewState(docId, sig);
    if (!saved) { this._curateSavedCount = 0; return 0; }
    this._curateSavedCount = Object.keys(saved.statuses).length;
    if (saved.sampleFingerprint !== undefined) {
      const currentFp = CurationView._sampleFingerprint(this._curateExamples);
      if (currentFp !== saved.sampleFingerprint) {
        this._pushCurateLog("warn", `Session sauvegardée ignorée : l'échantillon de preview a changé (empreinte structurelle différente).`);
        this._curateSavedCount = 0; return 0;
      }
      if (saved.sampleTextFingerprint !== undefined) {
        const currentTextFp = CurationView._sampleTextFingerprint(this._curateExamples);
        if (currentTextFp !== saved.sampleTextFingerprint) {
          this._pushCurateLog("warn", `Session sauvegardée ignorée : l'échantillon textuel a changé (empreinte textuelle différente).`);
          this._curateSavedCount = 0; return 0;
        }
      } else {
        this._pushCurateLog("warn", "Session restaurée avec garde-fous textuels réduits (format v3).");
      }
    } else {
      if (saved.unitsTotal !== undefined && saved.unitsTotal > 0) {
        const delta = Math.abs(currentUnitsTotal - saved.unitsTotal);
        const threshold = Math.max(5, Math.round(saved.unitsTotal * 0.10));
        if (delta > threshold) this._pushCurateLog("warn", `Ancienne session restaurée — le document a changé (${saved.unitsTotal} → ${currentUnitsTotal} unités).`);
        else this._pushCurateLog("warn", "Ancienne session restaurée avec garde-fous réduits (format v1/v2).");
      } else this._pushCurateLog("warn", "Ancienne session restaurée avec garde-fous réduits (format v1).");
    }
    if (docId === null) this._pushCurateLog("warn", "Restauration en mode global (tous les documents).");
    let restored = 0;
    for (const ex of this._curateExamples) {
      if (ex.unit_id === undefined) continue;
      const storedStatus = saved.statuses[String(ex.unit_id)];
      if (storedStatus) { ex.status = storedStatus; restored++; }
      if (saved.overrides) {
        const storedOverride = saved.overrides[String(ex.unit_id)];
        if (storedOverride !== undefined) { ex.manual_after = storedOverride; ex.is_manual_override = true; }
      }
    }
    if (this._curateSavedCount > 0 && restored < this._curateSavedCount / 2) {
      this._pushCurateLog("warn", `Restauration partielle : ${restored} statut(s) sur ${this._curateSavedCount} sauvegardé(s).`);
    } else if (restored > 0) {
      const quality = saved.sampleTextFingerprint !== undefined ? "✓" : saved.sampleFingerprint !== undefined ? "✓ (garde-fous réduits)" : "ancienne session";
      const overrideCount = Object.keys(saved.overrides ?? {}).length;
      this._pushCurateLog("preview", `${restored} statut(s) restauré(s)${overrideCount > 0 ? `, ${overrideCount} override(s)` : ""} — ${quality}`);
    }
    return restored;
  }

  private _invalidateCurateReviewAfterApply(docId: number | null): void {
    if (docId === null) {
      const cleared = this._clearAllCurateReviewKeys();
      this._curateRestoredCount = 0; this._curateSavedCount = 0; this._updateSessionSummary();
      this._pushCurateLog("apply", cleared > 0 ? `Review locale effacée pour ${cleared} document(s).` : "Review locale effacée (aucun état sauvegardé).");
    } else {
      try { localStorage.removeItem(this._curateReviewKey(docId)); } catch { /* */ }
      this._curateRestoredCount = 0; this._curateSavedCount = 0; this._updateSessionSummary();
      this._pushCurateLog("apply", `Review locale du document #${docId} effacée.`);
    }
  }

  private _clearCurateReviewState(): void {
    const docId = this._currentCurateDocId() ?? null;
    let logMsg: string;
    if (docId === null) {
      const cleared = this._clearAllCurateReviewKeys();
      logMsg = cleared > 0 ? `Review globale réinitialisée — ${cleared} clé(s) effacée(s).` : "Review globale réinitialisée (aucun état sauvegardé).";
    } else {
      try { localStorage.removeItem(this._curateReviewKey(docId)); } catch { /* */ }
      logMsg = `Review du document #${docId} réinitialisée.`;
    }
    for (const ex of this._curateExamples) { ex.status = "pending"; ex.manual_after = undefined; ex.is_manual_override = undefined; }
    this._editingManualOverride = false;
    this._curateRestoredCount = 0; this._curateSavedCount = 0;
    this._refreshCuratePreviewPanes();
    this._updateSessionSummary(); this._updateActionButtons();
    this._pushCurateLog("preview", logMsg);
  }

  private _buildRuleLabels(): void {
    const labels: string[] = [];
    const PRESET_LABEL: Record<string, string> = {
      spaces: "Espaces", quotes: "Guillemets", punctuation_fr: "Ponctuation FR",
      punctuation_en: "Ponctuation EN", invisibles: "Invisibles", numbering: "Numérotation",
    };
    for (const [checkId, key] of [["act-rule-spaces","spaces"],["act-rule-quotes","quotes"],["act-rule-invisibles","invisibles"],["act-rule-numbering","numbering"]] as [string,string][]) {
      if (this._isRuleChecked(checkId)) for (const _ of CURATE_PRESETS[key].rules) labels.push(PRESET_LABEL[key]);
    }
    const punctLang = this._getPunctLang();
    if (punctLang === "fr") for (const _ of CURATE_PRESETS.punctuation_fr.rules) labels.push(PRESET_LABEL.punctuation_fr);
    else if (punctLang === "en") for (const _ of CURATE_PRESETS.punctuation_en.rules) labels.push(PRESET_LABEL.punctuation_en);
    const raw = this._q<HTMLTextAreaElement>("#act-curate-rules")?.value ?? "";
    for (const rule of this._parseAdvancedCurateRules(raw)) labels.push(rule.description || "Règle custom");
    this._curateRuleLabels = labels;
  }

  // ── _runPreview ────────────────────────────────────────────────────────────

  private async _runPreview(silent = false): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const docId = this._currentCurateDocId();
    if (docId === undefined) { if (!silent) this._cb.log("Sélectionnez un document pour la prévisualisation.", true); return; }
    const rules = this._currentRules();
    if (rules.length === 0) { if (!silent) this._cb.log("Aucune règle de curation configurée.", true); return; }

    this._cb.setBusy(true);
    const infoEl = this._q("#act-preview-info");
    if (infoEl) infoEl.textContent = "Chargement…";
    const rawEl = this._q("#act-preview-raw");
    if (rawEl) rawEl.innerHTML = `<p class="loading-hint">Prévisualisation en cours…</p>`;
    const diffEl0 = this._q("#act-diff-list");
    if (diffEl0) diffEl0.innerHTML = "";
    const applyBtnEarly = this._q<HTMLButtonElement>("#act-apply-after-preview-btn");
    if (applyBtnEarly) applyBtnEarly.style.display = "none";
    if (this._allUnitsDocId !== docId) void this._loadAllUnits(docId);

    try {
      const res = await curatePreview(conn, {
        doc_id: docId, rules, limit_examples: CURATE_PREVIEW_LIMIT,
        ...(this._forcedPreviewUnitId !== null ? { force_unit_id: this._forcedPreviewUnitId } : {}),
      });
      this._forcedPreviewUnitId = null;
      const changed = res.stats.units_changed;
      const total   = res.stats.units_total;
      const reps    = res.stats.replacements_total;
      this._hasPendingPreview = changed > 0;
      const statsEl = this._q("#act-preview-stats");
      if (statsEl) statsEl.innerHTML = changed === 0
        ? `<span class="prep-stat-ok">✓ Aucune modification prévue (${total} unités analysées).</span>`
        : `<span class="stat-warn">⚠ ${changed}/${total} unité(s) modifiée(s), ${reps} remplacement(s).</span>`;
      if (infoEl) infoEl.textContent = `${total} unités · ${changed} modifiée(s)`;
      this._curateExamples = res.examples.map(ex => ({ ...ex, status: "pending" as const }));
      this._curateGlobalChanged = changed;
      this._curateUnitsTotal = total;
      this._activeDiffIdx = null; this._activeRuleFilter = null; this._activeStatusFilter = null; this._curatePreviewPage = 0;
      this._buildRuleLabels();
      this._curateRestoredCount = this._restoreCurateReviewState(rules, total);
      const toRender = this._filteredExamples();
      this._refreshCuratePreviewPanes();
      this._renderCurateDiag(changed, total, reps);
      const panel = this._q<HTMLElement>("#act-preview-panel");
      this._updateFilterBadge(panel);
      this._updateSampleInfo();
      this._updateSessionSummary();
      const actionBar = this._q<HTMLElement>("#act-curate-action-bar");
      if (actionBar) actionBar.style.display = toRender.length > 0 ? "" : "none";
      this._updateActionButtons();
      if (toRender.length > 0) this._setActiveDiffItem(0, panel ?? undefined);
      this._renderCurateMinimap(res.examples.length, total);
      const applyBtn = this._q<HTMLButtonElement>("#act-apply-after-preview-btn");
      if (applyBtn) {
        applyBtn.textContent = changed > 0 ? `Appliquer (${changed}/${total} unités)` : "Appliquer maintenant";
        applyBtn.style.display = changed > 0 ? "" : "none";
      }
      const reviewExportCard = this._q<HTMLElement>("#act-review-export-card");
      if (reviewExportCard) reviewExportCard.style.display = "";
      const reindexBtn = this._q<HTMLElement>("#act-reindex-after-curate-btn");
      if (reindexBtn) reindexBtn.style.display = "none";
      this._cb.log(`Prévisualisation : ${changed}/${total} unités → ${reps} remplacements.`);
      this._pushCurateLog("preview", changed === 0 ? `OK – aucune modification (${total} unités)` : `OK – ${changed}/${total} unités, ${reps} remplacement(s)`);
      // Level 7B: load persistent exceptions (async, non-blocking)
      this._loadCurateExceptions().then(() => {
        const filtered = this._filteredExamples();
        if (filtered.length > 0) this._renderDiffList(filtered);
        const activeEx = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
        this._renderContextDetail(activeEx);
        if (this._curateExceptions.size > 0) {
          const excIgnored = [...this._curateExceptions.values()].filter(e => e.kind === "ignore").length;
          if (excIgnored > 0) {
            const s = this._q("#act-preview-stats");
            if (s) s.innerHTML += ` <span class="stat-exc">🔒 ${excIgnored} unité(s) silencée(s) par exception.</span>`;
          }
        }
      }).catch(() => { /* non-critical */ });
      // Level 8A: refresh admin panel if open
      const adminPanel = this._q<HTMLDetailsElement>("#act-exc-admin-panel");
      if (adminPanel?.open) {
        this._loadExceptionsAdminPanel().catch(() => { /* non-critical */ });
      } else {
        const badge = this._q<HTMLElement>("#act-exc-admin-badge");
        if (badge && this._curateExceptions.size > 0) { badge.textContent = String(this._curateExceptions.size); badge.style.display = "inline-flex"; }
      }
    } catch (err) {
      this._forcedPreviewUnitId = null;
      this._hasPendingPreview = false;
      if (infoEl) infoEl.textContent = "Erreur";
      const msg = err instanceof SidecarError ? err.message : String(err);
      const rawElErr = this._q("#act-preview-raw");
      if (rawElErr) rawElErr.innerHTML = `<p class="prep-diag-v warn" style="margin:0"><strong>Erreur prévisualisation</strong>${_escHtml(msg)}</p>`;
      if (!silent) { this._cb.log(`✗ Prévisualisation : ${msg}`, true); this._pushCurateLog("warn", `Erreur prévisu : ${msg}`); }
      reportUserError(this._getConn(), err instanceof SidecarError ? "SidecarError" : "Error",
                      { stage: "curate", doc_id: this._currentCurateDocId() ?? undefined });
    }
    this._cb.setBusy(false);
    this._refreshCurateHeaderState();
    // If doc changed while we were busy the earlier _schedulePreview was dropped;
    // kick off a fresh preview for the now-selected document.
    if (docId !== this._currentCurateDocId()) {
      this._schedulePreview(true);
    }
  }
  private async _runCurate(): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const rules = this._currentRules();
    const hasRawOverrides = this._allOverrides.size > 0;
    if (rules.length === 0 && !hasRawOverrides) {
      this._cb.log("Aucune règle configurée et aucune modification manuelle.", true);
      return;
    }
    const docId = this._currentCurateDocId();
    const label = docId !== undefined ? `doc #${docId}` : "tous les documents";
    const ignoredUnitIds = this._collectIgnoredUnitIds();
    const manualOverrides = this._collectManualOverrides();
    const confirmMsg = this._buildApplyConfirmMessage(label, ignoredUnitIds, manualOverrides);
    const confirmed = await this._showCurateApplyConfirm(confirmMsg);
    if (!confirmed) return;
    this._cb.setBusy(true);
    const params: Record<string, unknown> = { rules };
    if (docId !== undefined) params.doc_id = docId;
    if (ignoredUnitIds.length > 0) params.ignored_unit_ids = ignoredUnitIds;
    if (manualOverrides.length > 0) params.manual_overrides = manualOverrides;
    const _applySnapshot = {
      scope: (docId !== undefined ? "doc" : "all") as "doc" | "all",
      doc_id: docId ?? null,
      doc_title: docId !== undefined ? (this._getDocs().find(d => d.doc_id === docId)?.title ?? null) : null,
      ignored_count: ignoredUnitIds.length,
      manual_override_count: manualOverrides.length,
      preview_displayed_count: this._curateExamples.length,
      preview_units_changed: this._curateGlobalChanged,
      preview_truncated: this._curateExamples.length < this._curateGlobalChanged,
    };
    try {
      const job = await enqueueJob(conn, "curate", params);
      const skipNote = ignoredUnitIds.length > 0 ? `, ${ignoredUnitIds.length} ignorée(s)` : "";
      const overrideNote = manualOverrides.length > 0 ? `, ${manualOverrides.length} correction(s) manuelle(s)` : "";
      this._cb.log(`Job curation soumis (${job.job_id.slice(0, 8)}…)${skipNote}${overrideNote}`);
      this._pushCurateLog("apply", `Soumis – ${label}${skipNote}${overrideNote}`);
      const rawEl = this._q("#act-preview-raw");
      if (rawEl) rawEl.innerHTML = `<p class="empty-hint">Curation en cours&#8230;</p>`;
      const diffEl = this._q("#act-diff-list");
      if (diffEl) diffEl.innerHTML = `<p class="empty-hint">Curation en cours&#8230;</p>`;
      const statsEl = this._q("#act-preview-stats");
      if (statsEl) statsEl.innerHTML = "";
      const infoEl2 = this._q("#act-preview-info");
      if (infoEl2) infoEl2.textContent = "Job soumis…";
      this._cb.jobCenter?.()?.trackJob(job.job_id, `Curation ${label}`, (done) => {
        if (done.status === "done") {
          const r = done.result as { docs_curated?: number; units_modified?: number; units_skipped?: number; fts_stale?: boolean } | undefined;
          const skippedNote = (r?.units_skipped ?? 0) > 0 ? `, ${r!.units_skipped} ignorée(s)` : "";
          this._cb.log(`✓ Curation : ${r?.docs_curated ?? "?"} doc(s), ${r?.units_modified ?? "?"} unité(s) modifiée(s)${skippedNote}.`);
          this._pushCurateLog("apply", `OK – ${r?.docs_curated ?? "?"} doc(s), ${r?.units_modified ?? "?"} modifiée(s)${skippedNote}`);
          const _event: CurateApplyEvent = {
            ..._applySnapshot,
            applied_at: new Date().toISOString(),
            docs_curated: r?.docs_curated ?? 0,
            units_modified: r?.units_modified ?? 0,
            units_skipped: r?.units_skipped ?? 0,
          };
          this._lastApplyResult = _event;
          this._applyHistory.unshift(_event);
          const conn2 = this._getConn();
          if (conn2) {
            recordApplyHistory(conn2, _event).catch(() => {
              this._cb.log("⚠ Impossible de persister l'historique d'apply.", true);
            });
          }
          this._updateApplyResultUI();
          this._invalidateCurateReviewAfterApply(docId ?? null);
          if (r?.fts_stale) {
            this._cb.log("⚠ Index FTS périmé.");
            this._pushCurateLog("warn", "Index de recherche périmé — cliquez sur « Mettre à jour l'index »");
            const btn = this._q("#act-reindex-after-curate-btn") as HTMLElement | null;
            if (btn) btn.style.display = "";
          }
          this._hasPendingPreview = false;
          this._allOverrides = new Map();
          this._allUnits = [];
          this._allUnitsDocId = null;
          this._selectedUnitNs = new Set();
          this._lastSelectedN = null;
          this._cb.toast?.("✓ Curation appliquée");
          const divergeBanner = this._q<HTMLElement>("#act-curate-diverge-banner");
          if (divergeBanner) divergeBanner.style.display = "";
        } else {
          this._cb.log(`✗ Curation : ${done.error ?? done.status}`, true);
          this._pushCurateLog("warn", `Erreur : ${done.error ?? done.status}`);
          this._cb.toast?.("✗ Erreur curation", true);
          reportUserError(this._getConn(), "JobError",
                          { stage: "curate", doc_id: this._currentCurateDocId() ?? undefined });
        }
        this._cb.setBusy(false);
        this._refreshCurateHeaderState();
      });
    } catch (err) {
      const msg = err instanceof SidecarError ? err.message : String(err);
      this._cb.log(`✗ Curation : ${msg}`, true);
      this._pushCurateLog("warn", `Erreur soumission : ${msg}`);
      reportUserError(this._getConn(), err instanceof SidecarError ? "SidecarError" : "Error",
                      { stage: "curate", doc_id: this._currentCurateDocId() ?? undefined });
      this._cb.setBusy(false);
      this._refreshCurateHeaderState();
    }
  }
  private async _loadAllUnits(docId: number): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    if (this._allUnitsDocId === docId) return;
    this._allUnits = [];
    this._allUnitsDocId = null;
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    if (rawEl && this._previewMode === "rawonly") {
      rawEl.innerHTML = '<p class="loading-hint">Chargement du texte&#8230;</p>';
    }
    try {
      this._allUnits = await listUnits(conn, docId);
      this._allUnitsDocId = docId;
    } catch {
      if (rawEl && this._previewMode === "rawonly") {
        rawEl.innerHTML = '<p class="empty-hint">Impossible de charger le texte.</p>';
      }
    }
    // Rendering is deferred to _refreshCuratePreviewPanes after the preview
    // completes, avoiding a double DOM rebuild (fetch render → "Prévisualisation
    // en cours…" wipe → preview render).
  }

  // ── Trouver (search highlights) ──────────────────────────────────────────────

  /** Re-apply search highlights after a raw-pane re-render. */
  private _frApplySearchHighlights(): void {
    if (this._frSearchHits.length === 0) return;
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    if (!rawEl) return;
    const hitSet = new Set(this._frSearchHits);
    rawEl.querySelectorAll<HTMLElement>("[data-unit-id]").forEach(unitEl => {
      const uid = parseInt(unitEl.dataset.unitId ?? "");
      if (hitSet.has(uid)) unitEl.classList.add("prep-raw-unit-found");
    });
    if (this._frSearchHitIdx >= 0 && this._frSearchHitIdx < this._frSearchHits.length) {
      const activeUid = this._frSearchHits[this._frSearchHitIdx];
      rawEl.querySelector<HTMLElement>(`[data-unit-id="${activeUid}"]`)
        ?.classList.add("prep-raw-unit-found-active");
    }
  }

  /** Clear search highlights and nav state. */
  private _frClearSearch(): void {
    this._frSearchHits = [];
    this._frSearchHitIdx = -1;
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    if (rawEl) {
      rawEl.querySelectorAll<HTMLElement>(".prep-raw-unit-found, .prep-raw-unit-found-active")
        .forEach(e => e.classList.remove("prep-raw-unit-found", "prep-raw-unit-found-active"));
    }
    const nav = this._q<HTMLElement>("#act-fr-nav");
    if (nav) nav.style.display = "none";
    const fb = this._q<HTMLElement>("#act-fr-feedback");
    if (fb) { fb.textContent = ""; fb.style.display = "none"; }
  }

  private _renderRawPaneFull(changedUnitIds?: Set<number>): void {
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    if (!rawEl) return;
    if (this._allUnits.length === 0) {
      rawEl.innerHTML = '<p class="empty-hint">Aucune unit&#233; disponible pour ce document.</p>';
      return;
    }
    const filtered = this._filteredExamples();
    const unitIdToDiffIdx = new Map<number, number>();
    filtered.forEach((ex, i) => unitIdToDiffIdx.set(ex.unit_id, i));
    const roleMap = new Map(this._conventions.map(r => [r.name, r]));
    rawEl.innerHTML = "";
    rawEl.dataset.fullText = "1";

    // Cap DOM nodes to RAW_PANE_DOM_CAP. Changed units are always included so
    // diff-list navigation can scroll to them; remaining slots are filled in order.
    let unitsToRender = this._allUnits;
    const totalUnits = this._allUnits.length;
    if (totalUnits > RAW_PANE_DOM_CAP) {
      const changedSet = changedUnitIds ?? new Set<number>();
      const changed = this._allUnits.filter(u => changedSet.has(u.unit_id));
      const rest    = this._allUnits.filter(u => !changedSet.has(u.unit_id));
      const slots   = Math.max(0, RAW_PANE_DOM_CAP - changed.length);
      // Merge: take first `slots` unchanged units and re-sort by n to preserve reading order
      const combined = [...changed, ...rest.slice(0, slots)];
      combined.sort((a, b) => a.n - b.n);
      unitsToRender = combined;
      // Telemetry : DOM raw pane cap hit. Useful for triggering virtual
      // scrolling work if signal grows over time.
      reportEvent(this._getConn(), "cap_hit", {
        cap_name: "dom_raw_pane_5000",
        actual_count: totalUnits,
        doc_id: this._currentCurateDocId() ?? null,
      });
    }
    const curateDocId = this._currentCurateDocId();
    const textStartN: number | null = curateDocId !== undefined
      ? (this._getDocs().find(d => d.doc_id === curateDocId)?.text_start_n ?? null)
      : null;
    this._renderRoleBar();
    unitsToRender.forEach(unit => {
      if (textStartN !== null && unit.n === textStartN) {
        rawEl.appendChild(this._renderTextStartSeparator(textStartN));
      }

      // Structure units (headings, titles…) rendered as non-interactive markers
      if (unit.unit_type === "structure") {
        const role = unit.unit_role;
        const conv = role ? roleMap.get(role) : undefined;
        const marker = document.createElement("div");
        marker.className = "prep-raw-unit-structure";
        marker.dataset.unitId = String(unit.unit_id);
        marker.dataset.unitN = String(unit.n);
        if (conv) {
          marker.style.setProperty("--role-color", conv.color ?? "#9333ea");
          const badge = document.createElement("span");
          badge.className = "prep-raw-struct-badge";
          badge.textContent = (conv.icon ? conv.icon + "\u00a0" : "") + conv.label;
          marker.appendChild(badge);
          marker.appendChild(document.createTextNode("\u00a0"));
        }
        marker.appendChild(document.createTextNode(unit.text_norm ?? ""));
        rawEl.appendChild(marker);
        return;
      }

      const p = document.createElement("p");
      p.className = "prep-raw-unit prep-raw-unit-full";
      p.dataset.unitId = String(unit.unit_id);
      p.dataset.unitN = String(unit.n);
      if (textStartN !== null && unit.n < textStartN) p.classList.add("prep-raw-unit-paratext");
      const hasOverride = this._allOverrides.has(unit.unit_id);
      const isChanged = changedUnitIds?.has(unit.unit_id);
      const isSelected = this._selectedUnitNs.has(unit.n);
      const role = unit.unit_role;
      const conv = role ? roleMap.get(role) : undefined;
      if (hasOverride) p.classList.add("prep-raw-unit-overridden");
      if (isChanged)   p.classList.add("prep-raw-unit-changed");
      if (isSelected)  p.classList.add("prep-raw-unit-selected");
      if (role)        p.classList.add("prep-raw-unit-has-role");
      const ln = document.createElement("span");
      ln.className = "prep-vo-ln";
      ln.textContent = String(unit.n);
      if (textStartN === null && curateDocId !== undefined && unit.n > 1) {
        ln.classList.add("prep-vo-ln-settable");
        ln.title = `Cliquer pour définir l'unité ${unit.n} comme début du texte`;
        ln.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this._selectedUnitNs.size > 0) return;
          if (unit.n === 1) return;
          const rawEl2 = this._q<HTMLElement>("#act-preview-raw");
          if (!rawEl2) return;
          const existing = rawEl2.querySelector(".prep-raw-tsn-confirm");
          if (existing) { existing.remove(); return; }
          const banner = document.createElement("div");
          banner.className = "prep-raw-tsn-confirm";
          const paraCount = unit.n - 1;
          banner.innerHTML =
            `<span>Définir l'unité ${unit.n} comme début du texte ? ` +
            `${paraCount > 0 ? `Les ${paraCount} unité(s) précédente(s) seront marquées comme paratexte.` : ""}</span>` +
            `<button class="btn btn-primary btn-xs">Confirmer</button>` +
            `<button class="btn btn-ghost btn-xs">Annuler</button>`;
          rawEl2.insertBefore(banner, rawEl2.firstChild);
          const [confirmBtn, cancelBtn] = banner.querySelectorAll("button");
          cancelBtn.addEventListener("click", () => banner.remove(), { once: true });
          confirmBtn.addEventListener("click", () => { banner.remove(); void this._setTextStart(unit.n); }, { once: true });
          confirmBtn.focus();
        });
      }
      p.appendChild(ln);
      if (conv) {
        const roleBadge = document.createElement("span");
        roleBadge.className = "prep-raw-role-badge";
        roleBadge.textContent = conv.label || conv.name;
        roleBadge.title = `Rôle : ${conv.label || conv.name}`;
        if (conv.color) roleBadge.style.setProperty("--role-color", conv.color);
        p.appendChild(roleBadge);
        p.appendChild(document.createTextNode(" "));
      }
      if (hasOverride) {
        const badge = document.createElement("span");
        badge.className = "prep-raw-override-badge";
        badge.textContent = "✏";
        badge.title = "Modifié manuellement";
        p.appendChild(badge);
        p.appendChild(document.createTextNode(" "));
      }
      const displayText = this._allOverrides.get(unit.unit_id) ?? unit.text_norm ?? "";
      p.appendChild(document.createTextNode(displayText));
      if (isChanged) {
        const diffIdx = unitIdToDiffIdx.get(unit.unit_id);
        if (diffIdx !== undefined) p.dataset.diffIdx = String(diffIdx);
      }
      p.addEventListener("click", (e: MouseEvent) => {
        if (p.classList.contains("prep-raw-unit-editing")) return;
        if ((e.target as HTMLElement).closest(".prep-raw-unit-edit-wrapper")) return;
        if (this._selectionMode || e.ctrlKey || e.metaKey || e.shiftKey || this._selectedUnitNs.size > 0) {
          e.preventDefault();
          this._toggleUnitSelection(unit.n, e.shiftKey);
          return;
        }
        if (isChanged) {
          const diffIdx = unitIdToDiffIdx.get(unit.unit_id);
          if (diffIdx !== undefined) {
            const panel = p.closest<HTMLElement>("#act-preview-panel") ?? undefined;
            this._setActiveDiffItem(diffIdx, panel);
          }
        }
      });
      p.addEventListener("dblclick", (e: MouseEvent) => {
        if (this._selectionMode || this._selectedUnitNs.size > 0) return;
        e.stopPropagation();
        this._enterInlineEdit(p, unit);
      });
      rawEl.appendChild(p);
    });
    if (textStartN !== null && textStartN > (this._allUnits[this._allUnits.length - 1]?.n ?? 0)) {
      rawEl.appendChild(this._renderTextStartSeparator(textStartN));
    }
    if (totalUnits > RAW_PANE_DOM_CAP) {
      const notice = document.createElement("div");
      notice.className = "prep-raw-cap-notice";
      notice.textContent = `Affichage partiel : ${unitsToRender.length} unités sur ${totalUnits} (toutes les modifications sont incluses).`;
      rawEl.appendChild(notice);
    }
    this._updateRoleBar();
    this._frApplySearchHighlights();
  }
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
      row.className = "prep-conv-row";
      row.dataset.convName = conv.name;
      const swatch = document.createElement("input");
      swatch.type = "color";
      swatch.className = "conv-swatch";
      swatch.value = conv.color ?? "#6366f1";
      swatch.title = "Cliquer pour modifier la couleur";
      swatch.addEventListener("change", () => { void this._conventionUpdate(conv.name, { color: swatch.value }); });
      const labelEl = document.createElement("span");
      labelEl.className = "prep-conv-label";
      labelEl.textContent = conv.label || conv.name;
      labelEl.title = "Double-cliquer pour modifier le label";
      labelEl.addEventListener("dblclick", () => this._conventionEditLabel(row, conv));
      const nameBadge = document.createElement("code");
      nameBadge.className = "conv-name-badge";
      nameBadge.textContent = conv.name;
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
  private async _conventionAdd(): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const nameEl  = this._q<HTMLInputElement>("#act-conv-name");
    const labelEl = this._q<HTMLInputElement>("#act-conv-label");
    const colorEl = this._q<HTMLInputElement>("#act-conv-color");
    const errEl   = this._q<HTMLElement>("#act-conv-form-error");
    const name  = nameEl?.value.trim() ?? "";
    const label = labelEl?.value.trim() ?? "";
    const color = colorEl?.value ?? "#6366f1";
    if (!name || !label) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      if (errEl) { errEl.textContent = "L'identifiant ne peut contenir que des lettres, chiffres, tirets et underscores."; errEl.style.display = ""; }
      return;
    }
    if (errEl) errEl.style.display = "none";
    try {
      const created = await createConvention(conn, { name, label, color });
      this._conventions = [...this._conventions, created].sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      );
      this._renderConventionsList();
      if (this._allUnits.length > 0 && this._previewMode !== "diffonly") {
        const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
        this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
      }
      if (nameEl) nameEl.value = "";
      if (labelEl) labelEl.value = "";
      if (colorEl) colorEl.value = "#6366f1";
      const addBtn = this._q<HTMLButtonElement>("#act-conv-add-btn");
      if (addBtn) addBtn.disabled = true;
      this._cb.log(`Convention « ${label} » (${name}) créée.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (errEl) { errEl.textContent = msg; errEl.style.display = ""; }
    }
  }
  private async _loadConventions(): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    try {
      this._conventions = await listConventions(conn);
    } catch {
      this._conventions = [];
    }
    this._renderConventionsList();
    if (this._allUnits.length > 0 && this._previewMode !== "diffonly") {
      const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
      this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
    }
  }
  private async _loadExceptionsAdminPanel(): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const list = this._q<HTMLElement>("#act-exc-admin-list");
    if (!list) return;
    list.innerHTML = `<p class="empty-hint prep-exc-admin-loading">Chargement…</p>`;
    try {
      const res = await listCurateExceptions(conn);
      this._excAdminAll = res.exceptions;
      this._excAdminEditing = null;
      this._pushCurateLog("preview", `${res.count} exception(s) persistée(s) chargée(s) dans le panneau admin`);
      this._renderExcAdminPanel();
    } catch (err) {
      list.innerHTML = `<p class="empty-hint" style="color:#b91c1c">Erreur lors du chargement : ${_escHtml(String(err))}</p>`;
    }
  }
  private _setExcAdminFilter(f: "all" | "ignore" | "override"): void {
    this._excAdminFilter = f;
    this._root?.querySelectorAll<HTMLButtonElement>(".prep-exc-filter-btn").forEach(btn => {
      btn.classList.toggle("prep-exc-filter-active", btn.dataset.excFilter === f);
    });
    this._renderExcAdminPanel();
  }
  private _renderExcAdminPanel(): void {
    // Filter/group/format délégués au helper pur (testé dans
    // __tests__/curationExceptionsAdmin.test.ts). Reste DOM-bound :
    // mise à jour du badge et reconstruction conditionnelle du <select>
    // doc-filter (préserver la valeur courante quand la liste change).
    const list = this._q<HTMLElement>("#act-exc-admin-list");
    const badge = this._q<HTMLElement>("#act-exc-admin-badge");
    if (!list) return;
    const all = this._excAdminAll;
    if (badge) { badge.textContent = String(all.length); badge.style.display = all.length > 0 ? "inline-flex" : "none"; }
    const docSel = this._q<HTMLSelectElement>("#act-exc-doc-filter");
    if (docSel) {
      const knownDocs = buildExcDocOptions(all);
      const existingDocIds = new Set(Array.from(docSel.options).slice(1).map(o => parseInt(o.value)));
      const newDocIds = new Set(knownDocs.keys());
      const needsRebuild = existingDocIds.size !== newDocIds.size || [...newDocIds].some(id => !existingDocIds.has(id));
      if (needsRebuild) {
        const currentVal = docSel.value;
        docSel.innerHTML = `<option value="">Tous les documents</option>`;
        for (const [docId, docTitle] of knownDocs) {
          const opt = document.createElement("option");
          opt.value = String(docId);
          opt.textContent = docTitle;
          docSel.appendChild(opt);
        }
        if (currentVal) docSel.value = currentVal;
      }
    }
    const filtered = filterExceptions(all, this._excAdminFilter as ExcKindFilter, this._excAdminDocFilter);
    list.innerHTML = formatExcAdminList(filtered, {
      editingUnitId: this._excAdminEditing,
      showDocHeads: this._excAdminDocFilter === 0,
      totalIsEmpty: all.length === 0,
    });
  }
  private async _excAdminDelete(unitId: number): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    try {
      await deleteCurateException(conn, unitId);
      this._excAdminAll = this._excAdminAll.filter(e => e.unit_id !== unitId);
      this._curateExceptions.delete(unitId);
      const ex = this._curateExamples.find(e => e.unit_id === unitId);
      if (ex) { ex.is_exception_ignored = false; ex.is_exception_override = false; ex.exception_override = undefined; }
      this._cb.log(`🔓 Exception persistée supprimée (panneau admin) – unité ${unitId}.`);
      this._pushCurateLog("apply", `Exception supprimée via admin – unité ${unitId}`);
      this._renderExcAdminPanel();
      this._updateSessionSummary();
    } catch (err) {
      this._cb.log(`✗ Erreur lors de la suppression de l'exception ${unitId} : ${String(err)}`, true);
    }
  }
  private _excAdminEnterEdit(unitId: number): void {
    this._excAdminEditing = unitId;
    this._renderExcAdminPanel();
    const ta = this._q<HTMLTextAreaElement>(`#exc-edit-${unitId}`);
    ta?.focus();
  }
  private async _excAdminSaveEdit(unitId: number): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const ta = this._q<HTMLTextAreaElement>(`#exc-edit-${unitId}`);
    const newText = ta?.value.trim() ?? "";
    if (!newText) { this._cb.log("⚠ Le texte override ne peut pas être vide.", true); return; }
    try {
      await setCurateException(conn, { unit_id: unitId, kind: "override", override_text: newText });
      const idx = this._excAdminAll.findIndex(e => e.unit_id === unitId);
      if (idx >= 0) this._excAdminAll[idx] = { ...this._excAdminAll[idx], override_text: newText };
      const sessionExc = this._curateExceptions.get(unitId);
      if (sessionExc) this._curateExceptions.set(unitId, { ...sessionExc, override_text: newText });
      const ex = this._curateExamples.find(e => e.unit_id === unitId);
      if (ex) ex.exception_override = newText;
      this._excAdminEditing = null;
      this._cb.log(`🔒 Override persisté mis à jour – unité ${unitId}.`);
      this._pushCurateLog("apply", `Override persisté mis à jour via admin – unité ${unitId}`);
      this._renderExcAdminPanel();
      this._updateSessionSummary();
    } catch (err) {
      this._cb.log(`✗ Erreur lors de la mise à jour de l'override : ${String(err)}`, true);
    }
  }
  private _excAdminCancelEdit(unitId: number): void {
    if (this._excAdminEditing === unitId) this._excAdminEditing = null;
    this._renderExcAdminPanel();
  }
  private async _excAdminOpenInCuration(exc: CurateException): Promise<void> {
    if (exc.doc_id === undefined) {
      this._cb.log("⚠ Impossible d'ouvrir dans Curation : doc_id inconnu pour cette exception.", true);
      return;
    }
    this._cb.onNavigate?.("curation");
    const sel = this._q<HTMLSelectElement>("#act-curate-doc");
    if (!sel) { this._cb.log("⚠ Sélecteur de document introuvable.", true); return; }
    const alreadyOnDoc = sel.value === String(exc.doc_id);
    sel.value = String(exc.doc_id);
    sel.dispatchEvent(new Event("change"));
    const docTitle = exc.doc_title || `Document #${exc.doc_id}`;
    this._cb.log(`→ Navigation vers ${docTitle} (unité ${exc.unit_id}) depuis le panneau Exceptions.`);
    this._pushCurateLog("preview", `Ouverture depuis admin – ${docTitle}, unité ${exc.unit_id}`);
    if (alreadyOnDoc) this._schedulePreview(true);
    const targetUnitId = exc.unit_id;
    const maxAttempts = 10;
    const attemptIntervalMs = 250;
    let found = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise<void>(res => setTimeout(res, attemptIntervalMs));
      if (this._cb.isBusy()) continue;
      const filtered = this._filteredExamples();
      const idx = filtered.findIndex(ex => ex.unit_id === targetUnitId);
      if (idx >= 0) {
        this._setActiveDiffItem(idx);
        this._cb.log(`✓ Unité ${targetUnitId} trouvée dans le sample standard — sélectionnée.`);
        this._pushCurateLog("preview", `Unité ${targetUnitId} sélectionnée via admin`);
        found = true;
        break;
      }
      const rawIdx = this._curateExamples.findIndex(ex => ex.unit_id === targetUnitId);
      if (rawIdx >= 0) {
        this._setRuleFilter(null, null);
        this._activeStatusFilter = null;
        const filtered2 = this._filteredExamples();
        const idx2 = filtered2.findIndex(ex => ex.unit_id === targetUnitId);
        if (idx2 >= 0) {
          this._setActiveDiffItem(idx2);
          this._cb.log(`✓ Unité ${targetUnitId} trouvée (filtres réinitialisés) — sélectionnée.`);
          this._pushCurateLog("preview", `Unité ${targetUnitId} sélectionnée via admin (filtres effacés)`);
          found = true;
          break;
        }
      }
      if (!this._cb.isBusy() && attempt >= 3) break;
    }
    if (found) return;
    this._cb.log(`ℹ Unité ${targetUnitId} hors du sample standard. Lancement d'une preview ciblée…`);
    this._pushCurateLog("preview", `Preview ciblée pour unité ${targetUnitId}…`);
    this._forcedPreviewUnitId = targetUnitId;
    await this._runPreview(true);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise<void>(res => setTimeout(res, attemptIntervalMs));
      if (this._cb.isBusy()) continue;
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
          reason === "forced_ignored"   ? "unité neutralisée par exception ignore (inspection seulement)" :
          reason === "forced_no_change" ? "unité sans modification active" : "ouverture ciblée";
        this._cb.log(`✓ Unité ${targetUnitId} rendue visible en mode forcé (${label}).`);
        this._pushCurateLog("preview", `Unité ${targetUnitId} ouverte en mode ciblé – ${label}`);
        found = true;
        break;
      }
      if (!this._cb.isBusy()) break;
    }
    if (!found) {
      this._cb.log(`⚠ Unité ${targetUnitId} introuvable même en mode ciblé. Elle a peut-être été supprimée ou le document a changé.`);
      this._pushCurateLog("warn", `Unité ${targetUnitId} introuvable (doc ${exc.doc_id})`);
    }
  }
  private async _runExcAdminExport(fmt: "json" | "csv"): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const docId = this._excAdminDocFilter > 0 ? this._excAdminDocFilter : undefined;
    const today = new Date().toISOString().slice(0, 10);
    const scopeTag = docId ? `doc_${docId}` : "all";
    const defaultName = `curation_exceptions_${scopeTag}_${today}.${fmt}`;
    let outPath: string | null;
    try {
      outPath = await dialogSave({
        title: "Exporter les exceptions de curation",
        defaultPath: defaultName,
        filters: fmt === "json" ? [{ name: "JSON", extensions: ["json"] }] : [{ name: "CSV", extensions: ["csv"] }],
      });
    } catch { return; }
    if (!outPath) return;
    const resultEl = this._q<HTMLElement>("#act-exc-export-result");
    const btnJson = this._q<HTMLButtonElement>("#act-exc-export-json");
    const btnCsv  = this._q<HTMLButtonElement>("#act-exc-export-csv");
    if (btnJson) btnJson.disabled = true;
    if (btnCsv)  btnCsv.disabled = true;
    if (resultEl) { resultEl.style.display = "none"; resultEl.textContent = ""; }
    try {
      const opts: ExportCurateExceptionsOptions = { out_path: outPath, format: fmt };
      if (docId !== undefined) opts.doc_id = docId;
      const res = await exportCurateExceptions(conn, opts);
      const msg = res.count > 0 ? `✓ ${res.count} exception(s) exportée(s)` : "ℹ Aucune exception à exporter";
      if (resultEl) {
        resultEl.style.display = "";
        resultEl.className = `prep-exc-export-result ${res.count > 0 ? "exc-export-ok" : "exc-export-empty"}`;
        resultEl.textContent = msg;
      }
      this._cb.log(`✓ Exceptions exportées (${fmt.toUpperCase()}) : ${res.count} → ${res.out_path}`);
      this._cb.toast?.(msg);
    } catch (err) {
      const msg = `✗ Erreur export : ${err instanceof SidecarError ? err.message : String(err)}`;
      if (resultEl) { resultEl.style.display = ""; resultEl.className = "prep-exc-export-result exc-export-error"; resultEl.textContent = msg; }
      this._cb.log(msg, true);
      this._cb.toast?.("✗ Erreur export exceptions", true);
    } finally {
      if (btnJson) btnJson.disabled = false;
      if (btnCsv)  btnCsv.disabled = false;
    }
  }
  private async _runExportReviewReport(fmt: "json" | "csv"): Promise<void> {
    if (this._curateExamples.length === 0) {
      this._cb.toast?.("ℹ Aucune preview active à exporter");
      const resultEl = this._q<HTMLElement>("#act-review-export-result");
      if (resultEl) { resultEl.style.display = ""; resultEl.className = "prep-review-export-result review-export-empty"; resultEl.textContent = "ℹ Aucune preview active à exporter"; }
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
        filters: fmt === "json" ? [{ name: "JSON", extensions: ["json"] }] : [{ name: "CSV", extensions: ["csv"] }],
      });
    } catch { return; }
    if (!outPath) return;
    const resultEl = this._q<HTMLElement>("#act-review-export-result");
    const btnJson = this._q<HTMLButtonElement>("#act-review-export-json");
    const btnCsv  = this._q<HTMLButtonElement>("#act-review-export-csv");
    if (btnJson) btnJson.disabled = true;
    if (btnCsv)  btnCsv.disabled = true;
    if (resultEl) { resultEl.style.display = "none"; resultEl.textContent = ""; }
    try {
      const content = fmt === "json"
        ? JSON.stringify(this._buildReviewReportPayload(), null, 2)
        : this._buildReviewReportCsv();
      await writeTextFile(outPath, content);
      const count = this._curateExamples.length;
      const msg = `✓ Rapport exporté (${count} item(s))`;
      if (resultEl) { resultEl.style.display = ""; resultEl.className = "prep-review-export-result review-export-ok"; resultEl.textContent = msg; }
      this._cb.log(`✓ Rapport de review (${fmt.toUpperCase()}) exporté : ${count} item(s) → ${outPath}`);
      this._pushCurateLog("apply", `Rapport exporté – ${count} item(s)`);
      this._cb.toast?.(msg);
    } catch (err) {
      const msg = `✗ Erreur export rapport : ${err instanceof Error ? err.message : String(err)}`;
      if (resultEl) { resultEl.style.display = ""; resultEl.className = "prep-review-export-result review-export-error"; resultEl.textContent = msg; }
      this._cb.log(msg, true);
      this._cb.toast?.("✗ Erreur export rapport", true);
    } finally {
      if (btnJson) btnJson.disabled = false;
      if (btnCsv)  btnCsv.disabled = false;
    }
  }
  private async _loadApplyHistoryPanel(): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const listEl = this._q<HTMLElement>("#act-apply-hist-list");
    if (!listEl) return;
    const scopeEl = this._q<HTMLSelectElement>("#act-apply-hist-scope");
    const scopeFilter = (scopeEl?.value ?? "") as ApplyHistoryScope;
    listEl.innerHTML = `<p class="empty-hint" style="opacity:.6">Chargement\u2026</p>`;
    try {
      const res = await listApplyHistory(conn, { limit: 50 });
      const dbEvents = (res.events ?? []) as CurateApplyEvent[];
      // Merge + filter + cap delegated to the pure helper (testé dans
      // __tests__/curationApplyHistory.test.ts).
      const merged = mergeApplyHistory(this._applyHistory, dbEvents, {
        scope: scopeFilter,
        cap: 50,
      });
      this._renderApplyHistoryPanel(listEl, merged);
      const badge = this._q<HTMLElement>("#act-apply-hist-badge");
      if (badge) { badge.textContent = String(merged.length); badge.style.display = merged.length ? "" : "none"; }
    } catch (err) {
      listEl.innerHTML = `<p class="empty-hint error-hint">Erreur lors du chargement.</p>`;
      this._cb.log(`⚠ Historique apply : ${err}`, true);
    }
  }
  private _refreshCuratePreviewPanes(): void {
    const filtered = this._filteredExamples();
    const docId = this._currentCurateDocId();
    if (
      filtered.length === 0 && this._curateGlobalChanged === 0 &&
      (this._curateUnitsTotal ?? 0) > 0 && docId !== undefined &&
      !this._activeRuleFilter && !this._activeStatusFilter
    ) {
      if (this._allUnitsDocId === docId && this._allUnits.length > 0) {
        this._renderRawPaneFull();
        const diffEl = this._q<HTMLElement>("#act-diff-list");
        if (diffEl) diffEl.innerHTML = `<div class="prep-stat-ok" style="margin-bottom:8px;font-size:13px">&#10003;&#160;Aucune diff&#233;rence &#8212; texte cur&#233; identique au source.</div>`;
      } else {
        void this._fillCuratePanesWithDocumentText(docId);
      }
      return;
    }
    if (this._allUnitsDocId === docId && this._allUnits.length > 0 && this._previewMode !== "diffonly") {
      const changedIds = new Set(filtered.map(ex => ex.unit_id));
      this._renderRawPaneFull(changedIds);
    } else {
      this._renderRawPane(filtered);
    }
    this._renderDiffList(filtered);
  }

  private _renderCurateDiag(changed: number, total: number, replacements: number): void {
    const diagEl = this._q<HTMLElement>("#act-curate-diag");
    if (!diagEl) return;
    if (changed === 0) {
      diagEl.innerHTML = formatNoChangesDiag(total);
    } else {
      const shown = this._curateExamples.length;
      const isTruncated = shown < this._curateGlobalChanged;
      const ruleStats = this._getRuleStats();
      diagEl.innerHTML =
        formatChangesSummary(changed, total, replacements) +
        formatGotoFirstAction(shown) +
        formatTruncationNotice(shown, this._curateGlobalChanged) +
        formatRuleChips(ruleStats, isTruncated) +
        formatImpactNotice();
      if (shown > 0) {
        const gotoBtn = diagEl.querySelector<HTMLElement>("#act-diag-goto-first");
        gotoBtn?.addEventListener("click", () => { const panel = this._q<HTMLElement>("#act-preview-panel") ?? undefined; this._setRuleFilter(null, panel); this._q("#act-diff-list")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); });
        gotoBtn?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") (gotoBtn as HTMLElement).click(); });
      }
      diagEl.querySelectorAll<HTMLElement>(".prep-curate-diag-rule-chip").forEach(chip => {
        const label = chip.dataset.ruleLabel ?? "";
        const activate = () => { const panel = this._q<HTMLElement>("#act-preview-panel") ?? undefined; this._setRuleFilter(this._activeRuleFilter === label ? null : label, panel); };
        chip.addEventListener("click", activate);
        chip.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") activate(); });
      });
    }
    const segLinkEl = this._q<HTMLElement>("#act-curate-seg-link");
    if (segLinkEl) {
      const r = this._cb.getLastSegmentReport?.();
      if (r) {
        segLinkEl.style.display = "";
        segLinkEl.innerHTML = `<button class="prep-acts-hub-head-link" data-action="goto-seg" style="font-size:11.5px">&#9654; Voir segmentation (${r.units_output} unités${r.warnings?.length ? ` · ${r.warnings.length} avertissements` : ""})</button>`;
      } else {
        segLinkEl.style.display = "none";
      }
    }
  }

  private _renderCurateMinimap(changed: number, total: number): void {
    const mmEl = this._q("#act-curate-minimap");
    if (!mmEl) return;
    mmEl.innerHTML = formatMinimap(changed, total);
  }

  private async _fillCuratePanesWithDocumentText(docId: number): Promise<void> {
    const conn = this._getConn();
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    const diffEl = this._q<HTMLElement>("#act-diff-list");
    if (!conn || !rawEl || !diffEl) return;
    delete rawEl.dataset.fullText;
    rawEl.innerHTML = '<p class="loading-hint">Chargement du texte&#8230;</p>';
    diffEl.innerHTML = '<p class="loading-hint">Chargement&#8230;</p>';
    try {
      const preview = await getDocumentPreview(conn, docId, 300);
      if (!preview.lines.length) {
        const empty = '<p class="empty-hint">Aucune unit&#233; disponible pour ce document.</p>';
        rawEl.innerHTML = empty; diffEl.innerHTML = empty; return;
      }
      const bannerRaw  = `<div class="prep-stat-ok" style="margin-bottom:8px;font-size:13px">&#10003;&#160;Aucune modification &#8212; le document est propre avec ces r&#232;gles.</div>`;
      const bannerDiff = `<div class="prep-stat-ok" style="margin-bottom:8px;font-size:13px">&#10003;&#160;Aucune diff&#233;rence &#8212; texte cur&#233; identique au source.</div>`;
      const truncNote = preview.total_lines > preview.limit
        ? `<p class="empty-hint" style="margin:4px 0 8px;font-style:italic">Aper&#231;u &#8212; ${preview.limit}/${preview.total_lines} unit&#233;s</p>` : "";
      const roleMap = new Map(this._conventions.map(r => [r.name, r]));
      const linesHtml = preview.lines.map(l => {
        const conv = l.unit_role ? roleMap.get(l.unit_role) : undefined;
        const badge = conv
          ? `<span class="prep-raw-role-badge" style="--role-color:${conv.color ?? "#64748b"}">${conv.icon ? _escHtml(conv.icon) + "\u00a0" : ""}${_escHtml(conv.label)}</span>`
          : "";
        return `<div class="prep-vo-line"><span class="prep-vo-ln">${l.n}</span>${badge}<span class="prep-vo-txt">${richTextToHtml(l.text_raw, l.text)}</span></div>`;
      }).join("");
      rawEl.innerHTML = bannerRaw + truncNote + linesHtml;
      diffEl.innerHTML = bannerDiff + truncNote + linesHtml;
    } catch {
      const err = '<p class="empty-hint">Impossible de charger le texte.</p>';
      rawEl.innerHTML = err; diffEl.innerHTML = err;
    }
  }

  private _renderRawPane(examples: CuratePreviewExample[]): void {
    const el = this._q<HTMLElement>("#act-preview-raw");
    if (!el) return;
    delete el.dataset.fullText;
    if (examples.length === 0) {
      let msg: string;
      if (this._activeRuleFilter) {
        msg = `Aucune modification pour &#171;&#160;${_escHtml(this._activeRuleFilter)}&#160;&#187; dans cet &#233;chantillon. <button class="prep-btn-inline-link" id="raw-pane-clear-filter">Effacer le filtre</button>`;
      } else if (this._curateGlobalChanged === 0) {
        msg = `&#10003;&#160;Aucune modification &#8212; le document est propre avec ces r&#232;gles.`;
      } else {
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
      const firstLabel = (ex.matched_rule_ids ?? []).length > 0 ? (this._curateRuleLabels[ex.matched_rule_ids![0]] ?? "") : "";
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
      el.innerHTML = formatDiffEmptyMessage(this._activeRuleFilter, this._curateGlobalChanged);
      el.querySelector<HTMLElement>("#diff-pane-clear-filter")?.addEventListener("click", () => {
        this._setRuleFilter(null, this._q<HTMLElement>("#act-preview-panel"));
      });
      return;
    }
    const totalPages = Math.ceil(examples.length / CURATE_PAGE_SIZE);
    const page = Math.min(this._curatePreviewPage, Math.max(0, totalPages - 1));
    this._curatePreviewPage = page;
    const pageStart = page * CURATE_PAGE_SIZE;
    const pageExamples = examples.slice(pageStart, pageStart + CURATE_PAGE_SIZE);

    const table = document.createElement("table");
    table.className = "diff-table";
    table.setAttribute("role", "grid");
    table.setAttribute("aria-label", "Liste des modifications (&#8593;&#8595; naviguer, A&#160;accepter, I&#160;ignorer)");
    table.innerHTML = `<thead><tr role="row"><th role="columnheader" style="width:28px">#</th><th role="columnheader" style="width:72px">R&#232;gle</th><th role="columnheader">Texte cur&#233; (modifications en surbrillance)</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    pageExamples.forEach((ex, localI) => {
      const i = pageStart + localI;
      const tr = document.createElement("tr");
      tr.dataset.diffIdx = String(i);
      tr.className = "diff-row";
      tr.setAttribute("role", "row");
      tr.setAttribute("aria-selected", "false");
      const ruleLabels = getRuleLabelsForExample(ex, this._curateRuleLabels);
      tr.title = formatDiffRowTitle(ruleLabels.length);
      const ruleBadgeHtml = formatDiffRuleBadges(ruleLabels);
      const st = ex.status ?? "pending";
      for (const cls of getDiffRowClasses(ex)) tr.classList.add(cls);
      const statusBadgeHtml = formatDiffStatusBadge(st, CurationView._STATUS_LABEL[st] ?? st);
      const overrideBadgeHtml = formatDiffOverrideBadge(ex.is_manual_override);
      const exceptionBadgeHtml = formatDiffExceptionBadge(ex.is_exception_ignored, ex.is_exception_override);
      const forcedBadgeHtml = formatDiffForcedBadge(ex.preview_reason);
      const effectiveAfter = ex.manual_after ?? ex.after;
      const showBefore = ex.before !== effectiveAfter;
      const beforeHtml = showBefore ? `<span class="prep-diff-before-hint">${_renderSpecialChars(_escHtml(ex.before))}</span>` : "";
      // Jump-to-segment button: ouvre Segmentation focalisé sur cette unit
      // (chantier 2 — pattern de retour amont). Émet stage_returned via le
      // listener Shell.
      const jumpBtnHtml = `<button class="prep-diff-jump-btn" type="button"
        title="Voir cette unité dans Segmentation (retour amont)"
        aria-label="Ouvrir l'unité ${ex.external_id ?? i + 1} dans la vue Segmentation"
        data-unit-n="${ex.external_id ?? ""}">✂</button>`;
      tr.innerHTML =
        `<td class="prep-diff-extid">${ex.external_id ?? i + 1}${statusBadgeHtml}${overrideBadgeHtml}${exceptionBadgeHtml}${forcedBadgeHtml}${jumpBtnHtml}</td>` +
        `<td class="prep-diff-rule-cell">${ruleBadgeHtml}</td>` +
        `<td class="diff-after${ex.is_manual_override ? " prep-diff-after-overridden" : ""}">${beforeHtml}${_highlightChanges(ex.before, effectiveAfter)}</td>`;
      tr.addEventListener("click", (evt) => {
        // Ne pas activer la sélection si le clic vient du bouton jump
        if ((evt.target as HTMLElement)?.classList.contains("prep-diff-jump-btn")) return;
        const panel = tr.closest<HTMLElement>("#act-preview-panel") ?? undefined;
        this._setActiveDiffItem(i, panel);
      });
      // Wire jump button — émet l'event que Shell écoute pour switch + focus.
      const jumpBtn = tr.querySelector<HTMLButtonElement>(".prep-diff-jump-btn");
      if (jumpBtn) {
        jumpBtn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          const docId = this._currentCurateDocId();
          const unitN = ex.external_id;  // external_id correspond au n du segment
          if (docId === undefined || unitN === null || unitN === undefined) return;
          window.dispatchEvent(new CustomEvent("agrafes:open-segmentation-unit", {
            detail: { docId, unitN },
          }));
        });
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    el.innerHTML = "";
    el.appendChild(table);

    if (totalPages > 1) {
      const bar = document.createElement("div");
      bar.className = "prep-diff-pagination";
      const prevPageBtn = document.createElement("button");
      prevPageBtn.className = "btn btn-sm prep-diff-page-btn";
      prevPageBtn.textContent = "← Précédents";
      prevPageBtn.disabled = page === 0;
      prevPageBtn.addEventListener("click", () => {
        this._curatePreviewPage = page - 1;
        this._activeDiffIdx = null;
        this._renderDiffList(this._filteredExamples());
      });
      const pageLabel = document.createElement("span");
      pageLabel.className = "prep-diff-page-label";
      pageLabel.textContent = formatDiffPaginationLabel(page, totalPages, examples.length, this._curateGlobalChanged);
      const nextPageBtn = document.createElement("button");
      nextPageBtn.className = "btn btn-sm prep-diff-page-btn";
      nextPageBtn.textContent = "Suivants →";
      nextPageBtn.disabled = page >= totalPages - 1;
      nextPageBtn.addEventListener("click", () => {
        this._curatePreviewPage = page + 1;
        this._activeDiffIdx = null;
        this._renderDiffList(this._filteredExamples());
      });
      bar.appendChild(prevPageBtn);
      bar.appendChild(pageLabel);
      bar.appendChild(nextPageBtn);
      el.appendChild(bar);
    }
  }

  private _collectIgnoredUnitIds(): number[] {
    return this._curateExamples.filter(ex => ex.status === "ignored").map(ex => ex.unit_id);
  }

  private _collectManualOverrides(): Array<{ unit_id: number; text: string }> {
    const fromExamples = this._curateExamples
      .filter(ex => ex.is_manual_override === true && ex.manual_after != null && ex.unit_id !== undefined)
      .map(ex => ({ unit_id: ex.unit_id, text: ex.manual_after! }));
    const sampleIds = new Set(fromExamples.map(o => o.unit_id));
    const fromRaw: Array<{ unit_id: number; text: string }> = [];
    this._allOverrides.forEach((text, uid) => { if (!sampleIds.has(uid)) fromRaw.push({ unit_id: uid, text }); });
    return [...fromExamples, ...fromRaw];
  }

  private _conventionEditLabel(row: HTMLElement, conv: ConventionRole): void {
    const labelEl = row.querySelector<HTMLElement>(".prep-conv-label");
    if (!labelEl || row.classList.contains("prep-conv-row-editing")) return;
    row.classList.add("prep-conv-row-editing");
    const input = document.createElement("input");
    input.type = "text"; input.className = "prep-conv-input prep-conv-label-edit";
    input.value = conv.label || conv.name; input.maxLength = 64;
    labelEl.replaceWith(input); input.focus(); input.select();
    let saved = false;
    const save = async () => {
      if (saved) return; saved = true;
      const newLabel = input.value.trim();
      if (newLabel && newLabel !== conv.label) { await this._conventionUpdate(conv.name, { label: newLabel }); }
      else { this._renderConventionsList(); }
    };
    input.addEventListener("blur", () => void save());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); void save(); }
      if (e.key === "Escape") { saved = true; row.classList.remove("prep-conv-row-editing"); this._renderConventionsList(); }
    });
  }

  private async _conventionDelete(name: string, rowEl: HTMLElement): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const existing = rowEl.querySelector(".prep-conv-del-confirm");
    if (existing) return;
    const confirm = document.createElement("span");
    confirm.className = "prep-conv-del-confirm";
    confirm.innerHTML =
      `<span class="prep-conv-del-warn">Supprimer ? Les unités assignées perdront ce rôle.</span>` +
      `<button class="btn btn-danger btn-xs prep-conv-del-confirm-yes">Confirmer</button>` +
      `<button class="btn btn-ghost btn-xs prep-conv-del-confirm-no">Annuler</button>`;
    rowEl.appendChild(confirm);
    confirm.querySelector(".prep-conv-del-confirm-no")!.addEventListener("click", () => confirm.remove());
    confirm.querySelector(".prep-conv-del-confirm-yes")!.addEventListener("click", async () => {
      const c = this._getConn();
      if (!c) return;
      try {
        await deleteConvention(c, name);
        this._conventions = this._conventions.filter(c => c.name !== name);
        this._renderConventionsList();
        this._allUnits = this._allUnits.map(u => u.unit_role === name ? { ...u, unit_role: null } : u);
        if (this._allUnits.length > 0 && this._previewMode !== "diffonly") {
          const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
          this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
        }
        this._cb.log(`Convention « ${name} » supprimée.`);
      } catch (err) {
        this._cb.log(`Erreur suppression convention : ${err instanceof Error ? err.message : String(err)}`, true);
      }
    });
  }

  private async _conventionUpdate(name: string, patch: { label?: string; color?: string; icon?: string; sort_order?: number }): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    try {
      const updated = await updateConvention(conn, name, patch);
      this._conventions = this._conventions.map(c => c.name === name ? updated : c);
      this._renderConventionsList();
      if (this._allUnits.length > 0 && this._previewMode !== "diffonly") {
        const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
        this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
      }
    } catch (err) {
      this._cb.log(`Erreur mise à jour convention : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private async _applyRoleToSelected(role: string | null): Promise<void> {
    const conn = this._getConn();
    if (!conn || this._selectedUnitNs.size === 0) return;
    const docId = this._currentCurateDocId();
    if (docId === undefined) return;
    const unitNs = [...this._selectedUnitNs];
    try {
      await bulkSetRole(conn, docId, unitNs, role);
    } catch (err) {
      this._cb.log(`Erreur assignation rôle : ${err instanceof Error ? err.message : String(err)}`, true);
      return;
    }
    const nsSet = new Set(unitNs);
    this._allUnits = this._allUnits.map(u => nsSet.has(u.n) ? { ...u, unit_role: role } : u);
    this._selectedUnitNs = new Set();
    this._lastSelectedN = null;
    const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
    this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
    this._cb.log(`Rôle ${role ? `«\u00a0${role}\u00a0»` : "effacé"} assigné à ${unitNs.length} unité(s).`);
  }

  private _toggleUnitSelection(n: number, shiftKey: boolean): void {
    if (shiftKey && this._lastSelectedN !== null) {
      const lo = Math.min(n, this._lastSelectedN);
      const hi = Math.max(n, this._lastSelectedN);
      for (const u of this._allUnits) {
        if (u.n >= lo && u.n <= hi) this._selectedUnitNs.add(u.n);
      }
    } else {
      if (this._selectedUnitNs.has(n)) this._selectedUnitNs.delete(n);
      else this._selectedUnitNs.add(n);
    }
    this._lastSelectedN = n;
    this._updateRoleBar();
    const rawEl = this._q<HTMLElement>("#act-preview-raw");
    if (!rawEl) return;
    rawEl.querySelectorAll<HTMLElement>(".prep-raw-unit-full").forEach(p => {
      const pn = Number(p.dataset.unitN);
      p.classList.toggle("prep-raw-unit-selected", this._selectedUnitNs.has(pn));
    });
  }

  private _updateRoleBar(): void {
    const count = this._selectedUnitNs.size;
    const hasSelection = count > 0;
    const countEl = this._q<HTMLElement>("#act-roles-count");
    if (countEl) {
      countEl.style.display = hasSelection ? "" : "none";
      countEl.textContent = `${count} unité(s) sélectionnée(s)`;
    }
    this._q<HTMLButtonElement>("#raw-role-assign-btn")?.toggleAttribute("disabled", !hasSelection);
    this._q<HTMLButtonElement>("#raw-role-clear-btn")?.toggleAttribute("disabled", !hasSelection);
    this._q<HTMLButtonElement>("#raw-role-deselect-btn")?.toggleAttribute("disabled", !hasSelection);
    const modeBtn = this._q<HTMLButtonElement>("#raw-role-mode-btn");
    if (modeBtn) {
      modeBtn.classList.toggle("active", this._selectionMode);
      modeBtn.textContent = this._selectionMode ? "✓ Conventions actives" : "Activer Conventions";
    }
  }

  private _renderRoleBar(): void {
    // Refresh the role dropdown in the left-column roles card
    const sel = this._q<HTMLSelectElement>("#raw-role-select");
    if (!sel) return;
    const prev = sel.value;
    const roleOptions = this._conventions.map(r =>
      `<option value="${_escHtml(r.name)}">${_escHtml(r.label || r.name)}</option>`
    ).join("");
    sel.innerHTML = `<option value="">— choisir —</option>${roleOptions}`;
    if (prev) sel.value = prev;
  }

  private _renderTextStartSeparator(textStartN: number): HTMLElement {
    const sep = document.createElement("div");
    sep.className = "prep-raw-text-separator"; sep.dataset.textStartN = String(textStartN);
    const label = document.createElement("span");
    label.className = "prep-raw-text-separator-label"; label.textContent = `Début du texte (unité ${textStartN})`;
    sep.appendChild(label);
    const maxN = this._allUnits[this._allUnits.length - 1]?.n ?? 0;
    const btnUp = document.createElement("button");
    btnUp.className = "btn-ghost btn-xs raw-sep-btn"; btnUp.title = "Reculer la frontière (inclure une unité de plus dans le paratexte)"; btnUp.textContent = "▲";
    btnUp.addEventListener("click", (e) => { e.stopPropagation(); const newN = textStartN + 1; if (newN <= maxN) void this._setTextStart(newN); });
    const btnDown = document.createElement("button");
    btnDown.className = "btn-ghost btn-xs raw-sep-btn"; btnDown.title = "Avancer la frontière (réduire le paratexte d'une unité)"; btnDown.textContent = "▼";
    btnDown.addEventListener("click", (e) => { e.stopPropagation(); const newN = textStartN - 1; if (newN >= 2) void this._setTextStart(newN); });
    const btnClear = document.createElement("button");
    btnClear.className = "btn-ghost btn-xs raw-sep-btn raw-sep-btn-clear"; btnClear.title = "Supprimer la frontière paratextuelle"; btnClear.textContent = "✕";
    btnClear.addEventListener("click", (e) => {
      e.stopPropagation();
      if (sep.querySelector(".prep-raw-sep-del-confirm")) return;
      const confirmSpan = document.createElement("span");
      confirmSpan.className = "prep-raw-sep-del-confirm";
      confirmSpan.innerHTML = `<span class="prep-conv-del-warn">Supprimer la frontière ?</span><button class="btn btn-danger btn-xs">Confirmer</button><button class="btn btn-ghost btn-xs">Annuler</button>`;
      sep.appendChild(confirmSpan);
      const [confirmBtn, cancelBtn] = confirmSpan.querySelectorAll("button");
      cancelBtn.addEventListener("click", (ev) => { ev.stopPropagation(); confirmSpan.remove(); }, { once: true });
      confirmBtn.addEventListener("click", (ev) => { ev.stopPropagation(); confirmSpan.remove(); void this._setTextStart(null); }, { once: true });
      confirmBtn.focus();
    });
    const controls = document.createElement("span");
    controls.className = "prep-raw-sep-controls";
    controls.appendChild(btnUp); controls.appendChild(btnDown); controls.appendChild(btnClear);
    sep.appendChild(controls);
    return sep;
  }

  private async _setTextStart(n: number | null): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const docId = this._currentCurateDocId();
    if (docId === undefined) return;
    try {
      await setTextStart(conn, docId, n);
      const doc = this._getDocs().find(d => d.doc_id === docId);
      if (doc) doc.text_start_n = n;
      const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
      this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
    } catch (err) {
      this._cb.log(`Erreur lors de la mise à jour de la frontière : ${err}`, true);
    }
  }

  private _enterInlineEdit(unitEl: HTMLElement, unit: UnitRecord): void {
    if (unitEl.classList.contains("prep-raw-unit-editing")) return;
    unitEl.classList.add("prep-raw-unit-editing");
    const currentText = this._allOverrides.get(unit.unit_id) ?? unit.text_norm ?? "";
    const originalContent = unitEl.innerHTML;
    unitEl.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "prep-raw-unit-edit-wrapper";
    const ta = document.createElement("textarea");
    ta.className = "prep-raw-unit-textarea"; ta.value = currentText;
    ta.rows = Math.max(2, Math.ceil(currentText.length / 80));
    const actions = document.createElement("div");
    actions.className = "prep-raw-unit-edit-actions";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary btn-xs"; saveBtn.textContent = "Enregistrer"; saveBtn.title = "Ctrl+Entrée";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-xs"; cancelBtn.textContent = "Annuler"; cancelBtn.title = "Échap";
    actions.appendChild(saveBtn); actions.appendChild(cancelBtn);
    wrapper.appendChild(ta); wrapper.appendChild(actions);
    unitEl.appendChild(wrapper); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
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
      const changedIds = new Set(this._curateExamples.map(e => e.unit_id));
      this._renderRawPaneFull(changedIds.size > 0 ? changedIds : undefined);
    };
    const cancel = () => { unitEl.classList.remove("prep-raw-unit-editing"); unitEl.innerHTML = originalContent; };
    saveBtn.addEventListener("click", save);
    cancelBtn.addEventListener("click", cancel);
    ta.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
  }

  private _enterEditMode(): void {
    this._editingManualOverride = true;
    const filtered = this._filteredExamples();
    const ex = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
    this._renderContextDetail(ex);
    setTimeout(() => { const ta = this._q<HTMLTextAreaElement>("#act-manual-override-input"); if (ta) { ta.focus(); ta.select(); } }, 30);
  }

  private _saveManualOverride(value: string): void {
    const filtered = this._filteredExamples();
    const ex = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
    if (!ex) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === ex.after) {
      if (ex.is_manual_override) {
        ex.manual_after = null; ex.is_manual_override = false;
        this._cb.log(`↩ Override annulé pour unité ${ex.unit_id} (valeur identique à la proposition automatique).`);
        this._pushCurateLog("preview", `Override identique à l'auto — annulé (unité ${ex.unit_id})`);
      }
    } else {
      ex.manual_after = trimmed; ex.is_manual_override = true;
      if (!ex.status || ex.status === "pending") ex.status = "accepted";
      this._cb.log(`✏ Override manuel enregistré pour unité ${ex.unit_id}.`);
      this._pushCurateLog("preview", `Override manuel – unité ${ex.unit_id}`);
    }
    this._editingManualOverride = false;
    this._saveCurateReviewState();
    this._renderContextDetail(ex);
    this._updateSessionSummary();
    this._updateActionButtons();
    const panel = this._q<HTMLElement>("#act-preview-panel");
    const row = (panel ?? this._root)?.querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
    if (row) {
      const afterCell = row.querySelector<HTMLElement>(".diff-after");
      if (afterCell) afterCell.innerHTML = _highlightChanges(ex.before, ex.manual_after ?? ex.after);
      this._renderOverrideBadge(row, ex.is_manual_override ?? false);
      this._renderStatusBadge(row, ex.status ?? "pending");
      const st = ex.status ?? "pending";
      row.className = "diff-row" + (st !== "pending" ? ` diff-${st}` : "");
      if (this._activeDiffIdx !== null) row.classList.add("diff-active");
    }
  }

  private _cancelEditMode(): void {
    this._editingManualOverride = false;
    const filtered = this._filteredExamples();
    const ex = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
    this._renderContextDetail(ex);
  }

  private _revertManualOverride(): void {
    const filtered = this._filteredExamples();
    const ex = this._activeDiffIdx !== null ? filtered[this._activeDiffIdx] ?? null : null;
    if (!ex) return;
    ex.manual_after = null; ex.is_manual_override = false; this._editingManualOverride = false;
    this._cb.log(`↩ Override annulé pour unité ${ex.unit_id} — proposition automatique rétablie.`);
    this._pushCurateLog("preview", `Override annulé – unité ${ex.unit_id}`);
    this._saveCurateReviewState();
    this._renderContextDetail(ex);
    this._updateSessionSummary();
    const panel = this._q<HTMLElement>("#act-preview-panel");
    const row = (panel ?? this._root)?.querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
    if (row) {
      const afterCell = row.querySelector<HTMLElement>(".diff-after");
      if (afterCell) afterCell.innerHTML = _highlightChanges(ex.before, ex.after);
      this._renderOverrideBadge(row, false);
    }
  }

  private _renderOverrideBadge(row: HTMLElement, isOverride: boolean): void {
    const existing = row.querySelector<HTMLElement>(".prep-diff-override-badge");
    if (!isOverride) { existing?.remove(); return; }
    if (existing) return;
    const badge = document.createElement("span");
    badge.className = "prep-diff-override-badge"; badge.textContent = "✏"; badge.title = "Modifié manuellement";
    const firstCell = row.querySelector("td");
    if (firstCell) firstCell.appendChild(badge);
  }

  private async _loadCurateExceptions(): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const docId = this._currentCurateDocId();
    if (docId === undefined) return;
    try {
      const res = await listCurateExceptions(conn, docId);
      this._curateExceptions = new Map(res.exceptions.map(e => [e.unit_id, e]));
      for (const ex of this._curateExamples) {
        const exc = this._curateExceptions.get(ex.unit_id);
        if (exc) {
          if (exc.kind === "ignore") { ex.is_exception_ignored = true; ex.exception_override = undefined; }
          else { ex.is_exception_override = true; ex.exception_override = exc.override_text ?? undefined; }
        }
      }
      if (this._curateExceptions.size > 0) {
        this._cb.log(`ℹ ${this._curateExceptions.size} exception(s) locale(s) persistée(s) active(s) pour ce document.`);
        this._pushCurateLog("preview", `${this._curateExceptions.size} exception(s) persistée(s) chargée(s)`);
      }
    } catch (err) {
      this._cb.log(`⚠ Impossible de charger les exceptions persistées : ${String(err)}`, true);
    }
  }

  private async _setExceptionIgnore(ex: CuratePreviewExample): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    try {
      await setCurateException(conn, { unit_id: ex.unit_id, kind: "ignore" });
      ex.is_exception_ignored = true; ex.is_exception_override = false; ex.exception_override = undefined;
      if (!ex.status || ex.status === "pending") ex.status = "ignored";
      this._curateExceptions.set(ex.unit_id, { id: -1, unit_id: ex.unit_id, kind: "ignore", override_text: null, note: null, created_at: new Date().toISOString() });
      this._cb.log(`🔒 Exception persistée créée : ignorer l'unité ${ex.unit_id} durablement.`);
      this._pushCurateLog("apply", `Exception persistée ignore – unité ${ex.unit_id}`);
      this._saveCurateReviewState(); this._renderContextDetail(ex); this._updateSessionSummary(); this._updateActionButtons();
      const panel = this._q<HTMLElement>("#act-preview-panel");
      const row = (panel ?? this._root)?.querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
      if (row) this._renderExceptionBadge(row, ex);
    } catch (err) {
      this._cb.log(`✗ Erreur lors de la création de l'exception ignore : ${String(err)}`, true);
    }
  }

  private async _setExceptionOverride(ex: CuratePreviewExample): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const text = ex.manual_after ?? ex.after;
    if (!text) return;
    try {
      await setCurateException(conn, { unit_id: ex.unit_id, kind: "override", override_text: text });
      ex.is_exception_override = true; ex.exception_override = text; ex.is_exception_ignored = false;
      if (!ex.status || ex.status === "pending") ex.status = "accepted";
      this._curateExceptions.set(ex.unit_id, { id: -1, unit_id: ex.unit_id, kind: "override", override_text: text, note: null, created_at: new Date().toISOString() });
      this._cb.log(`🔒 Exception persistée créée : override durablement "${text}" pour l'unité ${ex.unit_id}.`);
      this._pushCurateLog("apply", `Exception persistée override – unité ${ex.unit_id}`);
      this._saveCurateReviewState(); this._renderContextDetail(ex); this._updateSessionSummary(); this._updateActionButtons();
      const panel = this._q<HTMLElement>("#act-preview-panel");
      const row = (panel ?? this._root)?.querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
      if (row) this._renderExceptionBadge(row, ex);
    } catch (err) {
      this._cb.log(`✗ Erreur lors de la création de l'exception override : ${String(err)}`, true);
    }
  }

  private async _deleteException(ex: CuratePreviewExample): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    try {
      await deleteCurateException(conn, ex.unit_id);
      ex.is_exception_ignored = false; ex.is_exception_override = false; ex.exception_override = undefined;
      this._curateExceptions.delete(ex.unit_id);
      this._cb.log(`🔓 Exception persistée supprimée pour l'unité ${ex.unit_id}. Comportement automatique rétabli.`);
      this._pushCurateLog("apply", `Exception persistée supprimée – unité ${ex.unit_id}`);
      this._saveCurateReviewState(); this._renderContextDetail(ex); this._updateSessionSummary();
      const panel = this._q<HTMLElement>("#act-preview-panel");
      const row = (panel ?? this._root)?.querySelector<HTMLElement>(`tr[data-diff-idx="${this._activeDiffIdx}"]`);
      if (row) this._renderExceptionBadge(row, ex);
    } catch (err) {
      this._cb.log(`✗ Erreur lors de la suppression de l'exception : ${String(err)}`, true);
    }
  }

  private _renderExceptionBadge(row: HTMLElement, ex: CuratePreviewExample): void {
    const existing = row.querySelector<HTMLElement>(".prep-diff-exception-badge");
    const hasException = ex.is_exception_ignored || ex.is_exception_override;
    if (!hasException) { existing?.remove(); return; }
    if (existing) {
      existing.textContent = ex.is_exception_ignored ? "🔒" : "🔒✏";
      existing.title = ex.is_exception_ignored ? "Exception persistée : ignoré durablement" : "Exception persistée : override durable";
      return;
    }
    const badge = document.createElement("span");
    badge.className = "prep-diff-exception-badge";
    badge.textContent = ex.is_exception_ignored ? "🔒" : "🔒✏";
    badge.title = ex.is_exception_ignored ? "Exception persistée : ignoré durablement" : "Exception persistée : override durable";
    const firstCell = row.querySelector("td");
    if (firstCell) firstCell.appendChild(badge);
  }

  private _buildReviewReportPayload(): object {
    const docId = this._currentCurateDocId() ?? null;
    const docTitle = docId !== null ? (this._getDocs().find(d => d.doc_id === docId)?.title ?? null) : null;
    const items = this._curateExamples;
    const pending  = items.filter(e => (e.status ?? "pending") === "pending").length;
    const accepted = items.filter(e => e.status === "accepted").length;
    const ignored  = items.filter(e => e.status === "ignored").length;
    const manuals  = items.filter(e => e.is_manual_override).length;
    const isTruncated = this._curateGlobalChanged > items.length;
    const notes: string[] = [];
    if (isTruncated) notes.push(`Preview tronquée : ${items.length} item(s) affichés sur ${this._curateGlobalChanged} modifications réelles dans le document.`);
    notes.push("Ce rapport reflète uniquement la session courante (en mémoire). Les décisions ne survivent pas à un rechargement sans restauration localStorage.");
    return {
      exported_at: new Date().toISOString(),
      report_type: "curation_review_session",
      doc_id: docId, doc_title: docTitle,
      sample: { displayed: items.length, units_changed: this._curateGlobalChanged, units_total: this._curateUnitsTotal, truncated: isTruncated },
      summary: { pending, accepted, ignored, manual_overrides: manuals },
      rules: [...this._curateRuleLabels],
      items: items.map(ex => {
        const persistentExc = ex.unit_id !== undefined ? (this._curateExceptions.get(ex.unit_id) ?? null) : null;
        return {
          unit_id: ex.unit_id ?? null, unit_index: ex.unit_index ?? null,
          status: ex.status ?? "pending", before: ex.before, after: ex.after,
          effective_after: ex.is_manual_override ? (ex.manual_after ?? ex.after) : ex.after,
          is_manual_override: ex.is_manual_override ?? false,
          matched_rules: (ex.matched_rule_ids ?? []).map(idx => this._curateRuleLabels[idx] ?? `règle ${idx + 1}`),
          preview_reason: ex.preview_reason ?? "standard",
          context_before: ex.context_before ?? null, context_after: ex.context_after ?? null,
          persistent_exception: persistentExc ? { kind: persistentExc.kind, text: persistentExc.override_text ?? null } : null,
        };
      }),
      last_apply_result: this._lastApplyResult, notes,
    };
  }

  private _buildReviewReportCsv(): string {
    const cols = ["unit_id","unit_index","status","is_manual_override","before","after","effective_after","matched_rules","preview_reason","context_before","context_after","persistent_exception_kind"];
    const escape = (v: unknown): string => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows: string[] = [cols.join(",")];
    for (const ex of this._curateExamples) {
      const persistentExc = ex.unit_id !== undefined ? (this._curateExceptions.get(ex.unit_id) ?? null) : null;
      rows.push([
        ex.unit_id ?? "", ex.unit_index ?? "", ex.status ?? "pending",
        ex.is_manual_override ? "true" : "false",
        escape(ex.before), escape(ex.after),
        escape(ex.is_manual_override ? (ex.manual_after ?? ex.after) : ex.after),
        escape((ex.matched_rule_ids ?? []).map(idx => this._curateRuleLabels[idx] ?? `r${idx + 1}`).join("; ")),
        ex.preview_reason ?? "standard",
        escape(ex.context_before ?? ""), escape(ex.context_after ?? ""),
        persistentExc?.kind ?? "",
      ].join(","));
    }
    return rows.join("\n");
  }

  private _showCurateApplyConfirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const bar = this._q<HTMLElement>("#act-curate-confirm-bar");
      if (!bar) { resolve(false); return; }
      if (bar.style.display !== "none") { resolve(false); return; }
      const html = message.split("\n").map(line => line.trim() ? `<span>${_escHtml(line)}</span>` : "").filter(Boolean).join("<br>");
      bar.innerHTML =
        `<div class="prep-curate-confirm-modal" role="document">` +
          `<div class="prep-curate-confirm-body">${html}</div>` +
          `<div class="prep-curate-confirm-actions">` +
            `<button class="btn btn-ghost btn-sm" id="act-confirm-cancel">Annuler</button>` +
            `<button class="btn prep-btn-warning btn-sm" id="act-confirm-ok">Confirmer l'application</button>` +
          `</div>` +
        `</div>`;
      bar.style.display = "";
      // Backdrop click: NOT once:true — a click on an inner element bubbles up
      // and would consume the listener before any backdrop click could fire.
      // We remove it explicitly in cleanup() instead.
      const onBackdropClick = (e: MouseEvent) => { if (e.target === bar) decide(false); };
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") decide(false); };
      const cleanup = () => {
        bar.style.display = "none";
        bar.innerHTML = "";
        bar.removeEventListener("click", onBackdropClick);
        document.removeEventListener("keydown", onKey);
      };
      const decide = (ok: boolean) => { cleanup(); resolve(ok); };
      bar.querySelector("#act-confirm-ok")!.addEventListener("click", () => decide(true), { once: true });
      bar.querySelector("#act-confirm-cancel")!.addEventListener("click", () => decide(false), { once: true });
      bar.addEventListener("click", onBackdropClick);
      document.addEventListener("keydown", onKey);
      bar.querySelector<HTMLButtonElement>("#act-confirm-ok")?.focus();
    });
  }

  private _buildApplyConfirmMessage(label: string, ignoredUnitIds: number[], manualOverrides: Array<{ unit_id: number; text: string }> = []): string {
    const hasReview = this._curateExamples.length > 0;
    const isTruncated = this._curateExamples.length < this._curateGlobalChanged;
    const counts = hasReview ? this._getStatusCounts() : null;
    let msg = `Appliquer la curation sur ${label} ?\nCette opération modifie text_norm en base.\n`;
    if (hasReview && counts) {
      msg += `\nRésumé de la session de review :\n  • Acceptées    : ${counts.accepted}\n  • En attente   : ${counts.pending}\n  • Ignorées     : ${counts.ignored}`;
      if (counts.ignored > 0) msg += ` → ne seront PAS appliquées`;
      msg += `\n`;
      if (isTruncated) {
        const unreviewed = this._curateGlobalChanged - this._curateExamples.length;
        msg += `\n⚠ Attention — preview partielle :\n  ${unreviewed} modification(s) hors échantillon n'ont pas été examinées.\n  Elles seront appliquées normalement (aucun statut local disponible).\n  Seules les ${ignoredUnitIds.length} unités ignorées dans l'échantillon seront exclues.`;
      } else {
        if (counts.ignored > 0) msg += `\nL'application exclura ${counts.ignored} unité(s) ignorée(s).`;
        else msg += `\nToutes les modifications seront appliquées (aucune ignorée).`;
      }
    } else {
      msg += `\nAucune review locale — toutes les modifications seront appliquées.`;
    }
    const docId = this._currentCurateDocId();
    if (docId === undefined) msg += `\n\n📌 Toutes les sessions de review sauvegardées par document seront effacées après application.`;
    else msg += `\n\n📌 La session de review sauvegardée pour ce document sera effacée après application.`;
    if (manualOverrides.length > 0) {
      const fromExamplesIds = new Set(this._curateExamples.filter(ex => ex.is_manual_override === true && ex.manual_after != null && ex.unit_id !== undefined).map(ex => ex.unit_id));
      const diffCount = manualOverrides.filter(o => fromExamplesIds.has(o.unit_id)).length;
      const rawCount = manualOverrides.length - diffCount;
      if (rawCount > 0 && diffCount > 0) msg += `\n✏ ${manualOverrides.length} correction(s) manuelle(s) : ${diffCount} via panneau diff, ${rawCount} directement dans le texte.`;
      else if (rawCount > 0) msg += `\n✏ ${rawCount} correction(s) saisie(s) directement dans le panneau texte.`;
      else msg += `\n✏ ${manualOverrides.length} correction(s) manuelle(s) seront appliquées à la place de la proposition automatique.`;
    }
    return msg;
  }

  private _renderApplyHistoryPanel(container: HTMLElement, events: CurateApplyEvent[]): void {
    // Delegated to the pure helper (testé dans __tests__/curationApplyHistory.test.ts).
    container.innerHTML = formatApplyHistoryList(events);
  }

  private _renderContextDetail(ex: CuratePreviewExample | null): void {
    const card = this._q<HTMLElement>("#act-curate-context-card");
    const body = this._q<HTMLElement>("#act-curate-context");
    const posEl = this._q<HTMLElement>("#act-context-pos");
    if (!card || !body) return;
    if (!ex) { card.style.display = "none"; return; }
    card.style.display = "";
    if (posEl) posEl.textContent = ex.unit_index !== undefined ? `Unité ${ex.unit_index + 1}` : `ID ${ex.unit_id}`;
    const DISPLAY_TRIM = 200;
    const trim = (t: string): string => t.length > DISPLAY_TRIM ? t.slice(0, DISPLAY_TRIM) + "…" : t;
    const ctxBefore = (ex.context_before ?? "").trim();
    const ctxAfter  = (ex.context_after  ?? "").trim();
    const effectiveAfter = ex.manual_after ?? ex.after;
    const ctxBeforeHtml = ctxBefore ? `<div class="prep-ctx-row ctx-before"><span class="prep-ctx-label">Avant</span><span class="prep-ctx-text">${_escHtml(trim(ctxBefore))}</span></div>` : "";
    const ctxAfterHtml  = ctxAfter  ? `<div class="prep-ctx-row ctx-after"><span class="prep-ctx-label">Après</span><span class="prep-ctx-text">${_escHtml(trim(ctxAfter))}</span></div>`  : "";
    if (this._editingManualOverride) {
      body.innerHTML =
        ctxBeforeHtml +
        `<div class="prep-ctx-row ctx-current"><span class="prep-ctx-label ctx-label-cur">Original</span><span class="prep-ctx-text ctx-original">${_escHtml(ex.before)}</span></div>` +
        `<div class="prep-ctx-row ctx-edit-row"><span class="prep-ctx-label ctx-label-edit">Résultat</span><span class="prep-ctx-edit-area"><textarea id="act-manual-override-input" class="prep-ctx-override-textarea" rows="3" spellcheck="true">${_escHtml(effectiveAfter)}</textarea><span class="prep-ctx-edit-hint">Proposition automatique : <em>${_escHtml(ex.after)}</em></span></span></div>` +
        `<div class="prep-ctx-edit-actions"><button class="btn btn-sm btn-primary" id="act-override-save">Enregistrer</button><button class="btn btn-sm btn-secondary" id="act-override-cancel">Annuler</button>${ex.is_manual_override ? `<button class="btn btn-sm" id="act-override-revert" title="Revenir à la proposition automatique">&#8617; Automatique</button>` : ""}</div>` +
        ctxAfterHtml;
    } else {
      const overrideBadgeHtml = ex.is_manual_override
        ? `<span class="prep-ctx-override-badge" title="Ce résultat a été corrigé manuellement. Proposition automatique : ${_escHtml(ex.after)}">✏ Édité manuellement</span>` : "";
      const hasException = ex.is_exception_ignored || ex.is_exception_override;
      const exceptionBadgeHtml = hasException
        ? `<span class="prep-ctx-exception-badge" title="${ex.is_exception_ignored ? "Exception persistée : cette unité sera toujours ignorée par la curation, quelle que soit la session." : `Exception persistée : ce texte sera toujours appliqué à cette unité. Texte : "${_escHtml(ex.exception_override ?? "")}"`}">🔒 ${ex.is_exception_ignored ? "Ignoré durablement" : "Override durable"}</span>` : "";
      const forcedReason = ex.preview_reason;
      const forcedNoteHtml = forcedReason && forcedReason !== "standard"
        ? `<div class="prep-ctx-forced-note ctx-forced-${forcedReason}">${forcedReason === "forced" ? "↗ Ouverture ciblée depuis le panneau Exceptions." : forcedReason === "forced_ignored" ? "↗ Ouverture ciblée — cette unité est <strong>neutralisée par une exception ignore</strong>. Elle n'est pas appliquée." : "↗ Ouverture ciblée — aucune modification active avec les règles courantes."}</div>` : "";
      body.innerHTML =
        ctxBeforeHtml +
        `<div class="prep-ctx-row ctx-current"><span class="prep-ctx-label ctx-label-cur">${forcedReason === "forced_no_change" ? "Inchangé" : forcedReason === "forced_ignored" ? "Neutralisé" : "Modifié"}</span><span class="prep-ctx-modification"><span class="prep-ctx-diff-before">${_escHtml(ex.before)}</span><span class="prep-ctx-arrow">&#8594;</span><span class="prep-ctx-diff-after${ex.is_manual_override ? " ctx-manual-override" : ""}">${_highlightChanges(ex.before, effectiveAfter)}</span></span></div>` +
        ctxAfterHtml + forcedNoteHtml +
        `<div class="prep-ctx-edit-actions">${overrideBadgeHtml}<button class="btn btn-sm" id="act-override-edit" title="Modifier manuellement le résultat de cette modification">&#9998; Éditer</button>${ex.is_manual_override ? `<button class="btn btn-sm" id="act-override-revert" title="Annuler la correction manuelle et utiliser la proposition automatique">&#8617; Proposition auto</button>` : ""}</div>` +
        `<div class="prep-ctx-exception-actions">${exceptionBadgeHtml}${!hasException ? `<button class="btn btn-sm prep-ctx-exception-btn" id="act-exc-ignore" title="Ne plus jamais appliquer de curation sur cette unité, même lors des prochaines sessions">🔒 Toujours ignorer</button><button class="btn btn-sm prep-ctx-exception-btn" id="act-exc-override" title="Appliquer durablement le résultat actuel comme correction permanente de cette unité">🔒 Conserver cette correction</button>` : `<button class="btn btn-sm prep-ctx-exception-btn prep-ctx-exception-btn-delete" id="act-exc-delete" title="Supprimer l'exception persistée — la curation automatique sera réactivée pour cette unité">🔓 Supprimer l'exception</button>`}</div>`;
    }
    body.querySelector<HTMLButtonElement>("#act-override-edit")?.addEventListener("click", () => this._enterEditMode());
    body.querySelector<HTMLButtonElement>("#act-override-save")?.addEventListener("click", () => { const ta = body.querySelector<HTMLTextAreaElement>("#act-manual-override-input"); if (ta) this._saveManualOverride(ta.value); });
    body.querySelector<HTMLButtonElement>("#act-override-cancel")?.addEventListener("click", () => this._cancelEditMode());
    body.querySelector<HTMLButtonElement>("#act-override-revert")?.addEventListener("click", () => this._revertManualOverride());
    body.querySelector<HTMLButtonElement>("#act-exc-ignore")?.addEventListener("click", () => { this._setExceptionIgnore(ex); });
    body.querySelector<HTMLButtonElement>("#act-exc-override")?.addEventListener("click", () => { this._setExceptionOverride(ex); });
    body.querySelector<HTMLButtonElement>("#act-exc-delete")?.addEventListener("click", () => { this._deleteException(ex); });
  }

  private async _runApplyHistoryExport(format: "json" | "csv"): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const resultEl = this._q<HTMLElement>("#act-apply-hist-export-result");
    const scopeEl  = this._q<HTMLSelectElement>("#act-apply-hist-scope");
    const scopeFilter = scopeEl?.value ?? "";
    if (resultEl) { resultEl.textContent = ""; resultEl.style.display = "none"; }
    const today = new Date().toISOString().slice(0, 10);
    const defaultName = `curation_apply_history_${scopeFilter || "all"}_${today}.${format}`;
    const outPath = await dialogSave({
      title: "Exporter l\u2019historique des apply",
      defaultPath: defaultName,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!outPath) return;
    try {
      const opts: ExportApplyHistoryOptions = { out_path: outPath, format };
      const res = await exportApplyHistory(conn, opts);
      if (resultEl) {
        resultEl.textContent = res.count
          ? `Export\u00e9\u00a0: ${res.count}\u00a0\u00e9v\u00e9nement(s) \u2192 ${outPath}`
          : "Aucun \u00e9v\u00e9nement \u00e0 exporter.";
        resultEl.className = res.count ? "apply-hist-export-result ok" : "apply-hist-export-result empty";
        resultEl.style.display = "";
      }
    } catch (err) {
      if (resultEl) { resultEl.textContent = `Erreur export\u00a0: ${err}`; resultEl.className = "prep-apply-hist-export-result error"; resultEl.style.display = ""; }
      this._cb.log(`⚠ Export historique apply\u00a0: ${err}`, true);
    }
  }
}

