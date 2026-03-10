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
  SidecarError,
} from "../lib/sidecarClient.ts";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";

// ─── Curation presets ─────────────────────────────────────────────────────────

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
  punctuation: {
    label: "Ponctuation",
    rules: [
      { pattern: "\\s+([,;:!?])", replacement: "$1", description: "Supprimer espace avant ponctuation" },
      { pattern: "([.!?])([A-ZÀ-Ÿ])", replacement: "$1 $2", description: "Espace après ponctuation terminale" },
      { pattern: "\\.{4,}", replacement: "…", description: "Points de suspension multiples → …" },
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


// ─── Sub-view type ────────────────────────────────────────────────

type SubView = "hub" | "curation" | "segmentation" | "alignement";

// ─── ActionsScreen ────────────────────────────────────────────────────────────

export class ActionsScreen {
  private _conn: Conn | null = null;
  private _docs: DocumentRecord[] = [];
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;
  private _openDocumentsTab: (() => void) | null = null;

  // Audit state
  private _auditPivotId: number | null = null;
  private _auditTargetId: number | null = null;
  private _auditOffset = 0;
  private _auditLimit = 30;
  private _auditHasMore = false;
  private _auditLinks: AlignLinkRecord[] = [];
  private _auditIncludeExplain = false;
  private _auditExceptionsOnly = false;
  private _auditQuickFilter: "all" | "review" | "rejected" | "unreviewed" = "review";
  private _auditTextFilter = "";
  private _auditSelectedLinkId: number | null = null;
  private _alignExplainability: AlignExplainabilityEntry[] = [];
  private _alignRunId: string | null = null;

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

    panelSlot.appendChild(hubPanel);
    panelSlot.appendChild(curationPanel);
    panelSlot.appendChild(segPanel);
    panelSlot.appendChild(alignPanel);
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
      if (saved === "hub" || saved === "curation" || saved === "segmentation" || saved === "alignement") {
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
    root.classList.remove("actions-sub-hub", "actions-sub-curation", "actions-sub-segmentation", "actions-sub-alignement");
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
      <section class="acts-seg-head-card" id="act-curation-head">
        <div class="acts-hub-head-left">
          <h1>Curation <span class="badge-preview">avec pr&#233;visualisation</span></h1>
          <p>La preview centrale se met &#224; jour d&#232;s qu&#8217;une option change.</p>
        </div>
        <div class="acts-hub-head-tools">
          <span class="curate-pill" id="act-curate-mode-pill">Mode &#233;dition</span>
          <button class="acts-hub-head-link acts-hub-head-link-accent" id="act-curate-lt-cta">&#9656; Sc&#233;nario grand texte</button>
          <button class="acts-hub-head-link" data-nav="segmentation">Voir Segmentation VO</button>
          <button class="acts-hub-head-link" data-nav="alignement">Voir Alignement</button>
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
                  <input id="act-rule-punctuation" class="curate-rule-input" type="checkbox" />
                  <label class="chip curation-chip" for="act-rule-punctuation">Ponctuation fine</label>
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
                  <span class="curate-chevron">&#x25be;</span>
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
            <article class="curate-inner-card curate-stack-card" id="act-curate-quick-actions">
              <div class="card-head">
                <h2>Actions rapides</h2>
                <span style="font-size:12px;color:var(--prep-muted,#4f5d6d)">s&#233;lection locale</span>
              </div>
              <div class="card-body">
                <div id="act-curate-queue" class="curate-queue">
                  <p class="empty-hint">Aucune action en attente.</p>
                </div>
                <div class="btns curate-nav-actions">
                  <button id="act-curate-prev-btn" class="btn btn-secondary btn-sm" disabled>&#8592; Pr&#233;c&#233;dent</button>
                  <button id="act-curate-next-btn" class="btn btn-secondary btn-sm" disabled>Suivant &#8594;</button>
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
                <div class="chip-row">
                  <span class="chip active">Brut</span>
                  <span class="chip active">Cur&#233;</span>
                  <span class="chip active">Diff surlign&#233;e</span>
                </div>
                <div class="chip-row">
                  <span class="chip active">Scroll synchronis&#233;</span>
                  <span class="chip">Afficher non-modifi&#233;s</span>
                  <span class="chip">Contexte &#177;2 segments</span>
                </div>
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
                <div class="btn-row" style="margin-top:0.35rem">
                  <button id="act-apply-after-preview-btn" class="btn btn-warning btn-sm" style="display:none">Appliquer maintenant</button>
                  <button id="act-reindex-after-curate-btn" class="btn btn-secondary btn-sm" style="display:none">Re-indexer</button>
                </div>
              </div>
            </article>
          </div>
          <div class="curate-col curate-col-right">
            <article class="curate-inner-card">
              <div class="card-head">
                <h2>Diagnostics curation</h2>
                <span style="font-size:12px;color:var(--prep-muted,#4f5d6d)">live</span>
              </div>
              <div class="card-body">
                <div id="act-curate-diag" class="curate-diag-list">
                  <p class="empty-hint">Lancez une pr&#233;visualisation pour voir les statistiques.</p>
                </div>
                <div id="act-curate-seg-link" style="display:none;padding:8px 0"></div>
              </div>
            </article>
            <article class="curate-inner-card">
              <div class="card-head">
                <h2>Journal de revue</h2>
                <span style="font-size:12px;color:var(--prep-muted,#4f5d6d)">session</span>
              </div>
              <div class="card-body" style="padding:0">
                <div id="act-curate-review-log" class="curate-log-list" aria-live="polite">
                  <p class="empty-hint" style="padding:10px">Aucune action enregistr&#233;e.</p>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
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
    ["#act-rule-spaces", "#act-rule-quotes", "#act-rule-punctuation", "#act-rule-invisibles", "#act-rule-numbering"].forEach((sel) => {
      el.querySelector(sel)!.addEventListener("change", () => this._schedulePreview(true));
    });
    el.querySelector("#act-curate-doc")!.addEventListener("change", () => {
      this._updateCurateCtx();
      this._schedulePreview(true);
    });
    el.querySelector("#act-curate-prev-btn")?.addEventListener("click", () => this._navigateCurateDoc(-1));
    el.querySelector("#act-curate-next-btn")?.addEventListener("click", () => this._navigateCurateDoc(1));
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
    return el;
  }

  private _renderSegmentationPanel(root: HTMLElement): HTMLElement {
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
                  <p class="live-note" style="margin-top:0">Flux recommand&#233; : s&#233;lectionner le document &#8594; Segmenter &#8594; Valider.</p>
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
                    <button id="act-seg-btn" class="btn btn-warning" disabled>Segmenter</button>
                    <button id="act-seg-validate-btn" class="btn btn-secondary" disabled>Seg. + valider</button>
                    <button id="act-seg-validate-only-btn" class="btn btn-primary" disabled>Valider</button>
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
                    <button id="act-seg-lt-btn" class="btn btn-warning" disabled>Segmenter</button>
                    <button id="act-seg-lt-validate-btn" class="btn btn-secondary" disabled>Segmenter + valider</button>
                    <button id="act-seg-lt-validate-only-btn" class="btn btn-primary" disabled>Valider ce document</button>
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
    const el = document.createElement("div");
    el.setAttribute("role", "main");
    el.setAttribute("aria-label", "Vue Alignement");
    el.innerHTML = `
      <section class="acts-seg-head-card">
        <div class="acts-hub-head-left">
          <h1>Alignement &#8212; vue run globale</h1>
          <p>Cr&#233;ez les liens pivot &#8596; cible entre documents. Lancez un run, contr&#244;lez la qualit&#233;, corrigez les exceptions.</p>
        </div>
        <div class="acts-hub-head-tools">
          <span class="curate-pill" id="act-align-run-pill">Liens pivot &#8596; cible</span>
          <button class="acts-hub-head-link" data-nav="curation">Voir Curation</button>
          <button class="acts-hub-head-link" data-nav="segmentation">Voir Segmentation VO</button>
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
      this._renderAuditTable(root); this._loadAuditPage(root, false);
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
      this._auditTextFilter = auditTextFilterEl.value.trim().toLowerCase();
      this._renderAuditTable(root);
    });
    const exceptionsOnlyEl = el.querySelector<HTMLInputElement>("#act-audit-exceptions-only");
    if (exceptionsOnlyEl) {
      this._auditExceptionsOnly = this._readAuditExceptionsOnlyPref();
      exceptionsOnlyEl.checked = this._auditExceptionsOnly;
      exceptionsOnlyEl.addEventListener("change", () => {
        this._auditExceptionsOnly = exceptionsOnlyEl.checked;
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

    initCardAccordions(el);
    this._bindHeadNavLinks(el, root);
    return el;
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
          <div class="seg-stat"><span class="quality-label">Pack utilisé</span><strong>${_escHtml(r.segment_pack ?? "auto")}</strong></div>
          <div class="seg-stat"><span class="quality-label">Avertissements</span><strong>${warns.length}</strong></div>
        </div>
        ${warnHtml}
      `;
    }
    const footEl = segPanel.querySelector<HTMLElement>("#act-seg-tr-footer-stats");
    if (footEl) {
      const doc = this._docs.find(d => d.doc_id === r.doc_id);
      const docLabel = doc ? `${_escHtml(doc.title)} [${_escHtml(doc.language)}]` : `doc#${r.doc_id}`;
      footEl.textContent = `${docLabel} · ${r.units_output} segments · pack ${r.segment_pack ?? "auto"}`;
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
      trMeta.textContent = `${docLabel} · ${r.units_output} segments · pack ${r.segment_pack ?? "auto"}`;
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
  }

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  setOnOpenDocuments(cb: (() => void) | null): void {
    this._openDocumentsTab = cb;
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
    const punctuation = root.querySelector<HTMLInputElement>("#act-rule-punctuation");
    if (!spaces || !quotes || !punctuation) return;

    const mode = (preset ?? "spaces").trim();
    if (mode === "spaces") {
      spaces.checked = true;
      quotes.checked = false;
      punctuation.checked = false;
    } else if (mode === "quotes") {
      spaces.checked = false;
      quotes.checked = true;
      punctuation.checked = false;
    } else if (mode === "punctuation") {
      spaces.checked = false;
      quotes.checked = false;
      punctuation.checked = true;
    } else {
      // "custom" or unknown preset keeps multicorpus-friendly default.
      spaces.checked = true;
      quotes.checked = true;
      punctuation.checked = true;
    }
    this._schedulePreview(true);
  }

  private _isRuleChecked(id: string): boolean {
    return (document.querySelector<HTMLInputElement>(`#${id}`)?.checked) ?? false;
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

  private _currentRules(): CurateRule[] {
    const rules: CurateRule[] = [];
    if (this._isRuleChecked("act-rule-spaces")) rules.push(...CURATE_PRESETS.spaces.rules);
    if (this._isRuleChecked("act-rule-quotes")) rules.push(...CURATE_PRESETS.quotes.rules);
    if (this._isRuleChecked("act-rule-punctuation")) rules.push(...CURATE_PRESETS.punctuation.rules);
    if (this._isRuleChecked("act-rule-invisibles")) rules.push(...CURATE_PRESETS.invisibles.rules);
    if (this._isRuleChecked("act-rule-numbering")) rules.push(...CURATE_PRESETS.numbering.rules);

    const raw = (document.querySelector("#act-curate-rules") as HTMLTextAreaElement | null)?.value ?? "";
    rules.push(...this._parseAdvancedCurateRules(raw));
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
    const allDocSelects = ["act-curate-doc", "act-seg-doc", "act-seg-ref-doc", "act-align-pivot",
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
      this._updateCurateCtx();
      this._setButtonsEnabled(true);
      // Show audit panel once docs are loaded
      const ap = document.querySelector("#act-audit-panel") as HTMLElement | null;
      if (ap) ap.style.display = "";
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
      const res = await curatePreview(this._conn, { doc_id: docId, rules, limit_examples: 10 });

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

      // Raw pane (center left): source text before curation
      this._renderRawPane(res.examples);

      // Diff table in center right pane
      this._renderDiffList(res.examples);

      // Update diagnostics panel (right column)
      this._renderCurateDiag(changed, total, reps);

      // Minimap
      this._renderCurateMinimap(res.examples.length, total);

      // Show / hide apply button
      const applyBtn = document.querySelector("#act-apply-after-preview-btn") as HTMLButtonElement;
      applyBtn.style.display = changed > 0 ? "" : "none";
      (document.querySelector("#act-reindex-after-curate-btn") as HTMLElement).style.display = "none";

      this._log(`Prévisualisation : ${changed}/${total} unités → ${reps} remplacements.`);
      const previewMsg = changed === 0
        ? `OK – aucune modification (${total} unités)`
        : `OK – ${changed}/${total} unités, ${reps} remplacement(s)`;
      this._pushCurateLog("preview", previewMsg);
    } catch (err) {
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
    if (info) info.textContent = `${r.units_output} segments · pack ${r.segment_pack ?? "auto"}`;
    const warnHtml = warnings.length
      ? `<div class="seg-warn-list">${warnings.map((w) => `<div class="seg-warn">${_escHtml(w)}</div>`).join("")}</div>`
      : `<p class="stat-ok" style="font-size:12px">✓ Aucun avertissement</p>`;
    body.innerHTML = `
      <div class="seg-stats-grid">
        <div class="seg-stat"><strong>${r.units_input}</strong>Unités avant</div>
        <div class="seg-stat"><strong>${r.units_output}</strong>Segments après</div>
        <div class="seg-stat"><strong>${warnings.length}</strong>Avertissements</div>
        <div class="seg-stat"><strong>${r.segment_pack ?? "auto"}</strong>Pack utilisé</div>
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
    const diagEl = document.querySelector("#act-curate-diag");
    if (!diagEl) return;
    if (changed === 0) {
      diagEl.innerHTML = `<div class="curate-diag"><strong>✓ Aucune modification</strong>${total} unités analysées, corpus propre.</div>`;
    } else {
      diagEl.innerHTML = `
        <div class="curate-diag warn">
          <strong>${changed} modification(s) à valider</strong>
          ${replacements} remplacement(s) au total sur ${total} unités.
        </div>
        <div class="curate-diag">
          <strong>Impact segmentation estimé</strong>
          Vérifiez la preview avant d'appliquer.
        </div>
      `;
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

  private _renderRawPane(examples: CuratePreviewExample[]): void {
    const el = document.querySelector("#act-preview-raw");
    if (!el) return;
    if (examples.length === 0) {
      el.innerHTML = `<p class="empty-hint">Aucun exemple disponible.</p>`;
      return;
    }
    el.innerHTML = examples.map((ex) =>
      `<p>${_escHtml(ex.before)}</p>`
    ).join("");
  }

  private _renderDiffList(examples: CuratePreviewExample[]): void {
    const el = document.querySelector("#act-diff-list")!;
    if (examples.length === 0) {
      el.innerHTML = "";
      return;
    }
    const table = document.createElement("table");
    table.className = "diff-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:40px">ext_id</th>
          <th>Avant</th>
          <th>Après</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");
    for (const ex of examples) {
      const tr = document.createElement("tr");
      const extIdCell = `<td class="diff-extid">${ex.external_id ?? "—"}</td>`;
      const beforeCell = `<td class="diff-before">${_escHtml(ex.before)}</td>`;
      const afterCell = `<td class="diff-after">${_highlightChanges(ex.before, ex.after)}</td>`;
      tr.innerHTML = extIdCell + beforeCell + afterCell;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    el.innerHTML = "";
    el.appendChild(table);
  }

  private async _runCurate(): Promise<void> {
    if (!this._conn) return;
    const rules = this._currentRules();
    if (rules.length === 0) { this._log("Aucune règle configurée.", true); return; }

    const docId = this._currentCurateDocId();
    const label = docId !== undefined ? `doc #${docId}` : "tous les documents";
    if (!window.confirm(`Appliquer la curation sur ${label} ?\nCette opération modifie text_norm en base.`)) return;

    this._setBusy(true);
    const params: Record<string, unknown> = { rules };
    if (docId !== undefined) params.doc_id = docId;
    try {
      const job = await enqueueJob(this._conn, "curate", params);
      this._log(`Job curation soumis (${job.job_id.slice(0, 8)}…)`);
      this._pushCurateLog("apply", `Soumis – ${label}`);
      // vNext: panel is always visible — reset content to "applied" state
      const rawEl = document.querySelector("#act-preview-raw");
      if (rawEl) rawEl.innerHTML = `<p class="empty-hint">Curation en cours…</p>`;
      const diffEl = document.querySelector("#act-diff-list");
      if (diffEl) diffEl.innerHTML = `<p class="empty-hint">Curation en cours…</p>`;
      const statsEl = document.querySelector("#act-preview-stats");
      if (statsEl) statsEl.innerHTML = "";
      const infoEl2 = document.querySelector("#act-preview-info");
      if (infoEl2) infoEl2.textContent = "Job soumis…";
      this._jobCenter?.trackJob(job.job_id, `Curation ${label}`, (done) => {
        if (done.status === "done") {
          const r = done.result as { docs_curated?: number; units_modified?: number; fts_stale?: boolean } | undefined;
          this._log(`✓ Curation : ${r?.docs_curated ?? "?"} doc(s), ${r?.units_modified ?? "?"} unité(s).`);
          this._pushCurateLog("apply", `OK – ${r?.docs_curated ?? "?"} doc(s), ${r?.units_modified ?? "?"} unité(s)`);
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
    const docSel = (document.querySelector("#act-seg-doc") as HTMLSelectElement | null)?.value ?? "";
    if (!docSel) return null;
    const docId = parseInt(docSel, 10);
    if (!Number.isInteger(docId)) return null;
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
      return;
    }
    if (!segSel) {
      banner.className = "runtime-state state-info";
      banner.textContent = "Sélectionnez un document pour segmenter.";
      if (chipStatus) { chipStatus.textContent = "En attente"; chipStatus.className = "chip"; }
      if (validateOnlyBtn) validateOnlyBtn.disabled = true;
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
    // Hide doc-final-bar when no results
    if (finalBar) finalBar.setAttribute("hidden", "");
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
    const docLabel = segSel.docLabel;
    const postValidate = this._postValidateDestination();
    const postValidateLabel = postValidate === "next"
      ? "sélectionnera le document suivant"
      : postValidate === "stay"
      ? "restera sur l'onglet Actions"
      : "basculera vers l'onglet Documents";

    const prompt = validateAfter
      ? `Segmenter puis valider le document ${docLabel} ?\n` +
        `Pack: ${pack}\n` +
        `Cette opération EFFACE les liens d'alignement existants puis ${postValidateLabel}.`
      : `Segmenter le document ${docLabel} ?\n` +
        `Pack: ${pack}\n` +
        "Cette opération EFFACE les liens d'alignement existants.";
    if (!window.confirm(prompt)) return;

    this._setBusy(true);
    try {
      const job = await enqueueJob(this._conn, "segment", { doc_id: docId, lang, pack });
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
      this._renderAuditTable(root);
      this._log(`Audit : ${this._auditLinks.length} lien(s) chargé(s)${res.has_more ? " (suite disponible)" : ""}.`);
    } catch (err) {
      this._log(`✗ Audit : ${err instanceof SidecarError ? err.message : String(err)}`, true);
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
      this._lastAuditEmpty = true;
      wrap.innerHTML = '<p class="empty-hint">Aucun lien. Lancez un alignement ou chargez les liens.</p>';
      if (moreBtn) moreBtn.style.display = "none";
      if (batchBar) batchBar.style.display = "none";
      this._renderAuditFocus(root);
      this._refreshRuntimeState();
      return;
    }
    this._lastAuditEmpty = visibleLinks.length === 0;
    if (visibleLinks.length === 0) {
      wrap.innerHTML = '<p class="empty-hint">Aucune ligne ne correspond au filtre courant.</p>';
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
          this._log(`✗ Index : ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur index FTS", true);
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
}

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
  const beforeWords = new Set(before.toLowerCase().split(/\s+/));
  return after
    .split(/(\s+)/)
    .map(token => {
      if (/^\s+$/.test(token)) return token;
      if (!beforeWords.has(token.toLowerCase())) {
        return `<mark class="diff-mark">${_escHtml(token)}</mark>`;
      }
      return _escHtml(token);
    })
    .join("");
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
