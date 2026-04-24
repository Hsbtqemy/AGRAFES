/**
 * ActionsScreen — curate / segment / align with V0.3 extensions:
 *   - Curation Preview Diff (preset selector + before/after diff table)
 *   - Align Audit UI (paginated link table after alignment run)
 */

import type {
  Conn,
  DocumentRecord,
  DocRelationRecord,
} from "../lib/sidecarClient.ts";
import {
  listDocuments,
  enqueueJob,
  getAllDocRelations,
  SidecarError,
} from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";
import { AlignPanel } from "./AlignPanel.ts";
import { AnnotationView } from "./AnnotationView.ts";
import { SegmentationView } from "./SegmentationView.ts";
import { CurationView } from "./CurationView.ts";

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

  // Run ID of the last completed alignment (set by AlignPanel via onRunDone callback).
  private _alignRunId: string | null = null;
  // AlignPanel (new refactored alignment UI)
  private _alignPanel: AlignPanel | null = null;
  // AnnotationView (extracted)
  private _annotationView: AnnotationView | null = null;
  // SegmentationView (extracted)
  private _segmentationView: SegmentationView | null = null;
  // CurationView (extracted)
  private _curationView: CurationView | null = null;

  private _wfRoot: HTMLElement | null = null;
  private static readonly LS_WF_RUN_ID = "agrafes.prep.workflow.run_id";

  // Hub hierarchy view
  private _hubHierarchyView = false;
  private _allRelations: DocRelationRecord[] = [];
  private _allRelationsLoaded = false;
  // Log + busy
  private _logEl: HTMLElement = document.createElement("div");
  private _busyEl!: HTMLElement;
  private _stateEl!: HTMLElement;
  private _isBusy = false;
  private _lastErrorMsg: string | null = null;

  // Sub-view state (hub navigation)
  private _activeSubView: SubView = "hub";
  private _root: HTMLElement | null = null;
  private _lastFocusedBtn: HTMLElement | null = null;
  private static readonly LS_ACTIVE_SUB = "agrafes.prep.actions.active";

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
      <div id="act-state-banner" class="prep-runtime-state prep-state-info" aria-live="polite" style="display:none"></div>
    `;
    root.appendChild(header);
    this._stateEl = root.querySelector("#act-state-banner")!;

    const panelSlot = document.createElement("div");
    panelSlot.className = "prep-acts-panel-slot";

    const hubPanel = this._renderHubPanel(root);
    hubPanel.dataset.panel = "hub";
    hubPanel.style.display = this._activeSubView === "hub" ? "" : "none";

    const curationPanel = this._renderCurationPanel(root);
    curationPanel.dataset.panel = "curation";
    curationPanel.style.display = this._activeSubView === "curation" ? "" : "none";

    const segPanel = this._renderSegmentationPanel(root);
    segPanel.dataset.panel = "segmentation";
    segPanel.style.display = this._activeSubView === "segmentation" ? "" : "none";

    const alignPanel = this._renderAlignementPanel(root);
    alignPanel.dataset.panel = "alignement";
    alignPanel.style.display = this._activeSubView === "alignement" ? "" : "none";

    const annoterPanel = this._renderAnnoterPanel(root);
    annoterPanel.dataset.panel = "annoter";
    annoterPanel.style.display = this._activeSubView === "annoter" ? "" : "none";

    panelSlot.appendChild(hubPanel);
    panelSlot.appendChild(curationPanel);
    panelSlot.appendChild(segPanel);
    panelSlot.appendChild(alignPanel);
    panelSlot.appendChild(annoterPanel);

    root.appendChild(panelSlot);

    const busyOverlay = document.createElement("div");
    busyOverlay.id = "act-busy";
    busyOverlay.className = "prep-busy-overlay";
    busyOverlay.style.display = "none";
    busyOverlay.innerHTML = `<div class="prep-busy-spinner">⏳ Opération en cours…</div>`;
    root.appendChild(busyOverlay);

    this._busyEl = root.querySelector("#act-busy")!;

    this._wfRoot = root;
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
        <div class="prep-acts-hub-head-tools"></div>
      </section>
      <section class="card prep-acts-hub-docs-card">
        <div class="prep-acts-hub-docs-header">
          <h3 class="prep-acts-hub-docs-title">Documents du corpus</h3>
          <button id="act-hub-refresh-btn" class="btn btn-secondary btn-sm"
            title="Actualiser la liste des documents">↺</button>
          <button id="act-hub-hierarchy-btn" class="btn btn-secondary btn-sm"
            aria-pressed="false" title="Basculer vue hiérarchie / liste">🌿 Hiérarchie</button>
        </div>
        <div id="act-doc-list" class="prep-acts-hub-doc-list"></div>
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

    // Refresh doc list
    el.querySelector<HTMLButtonElement>("#act-hub-refresh-btn")?.addEventListener("click", () => {
      void this._loadDocs();
    });

    // Hierarchy toggle
    el.querySelector<HTMLButtonElement>("#act-hub-hierarchy-btn")?.addEventListener("click", () => {
      void this._toggleHubHierarchyView();
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
        onNavigate: (target, context) => {
          if (!this._wfRoot) return;
          this._switchSubViewDOM(this._wfRoot, target as Parameters<typeof this._switchSubViewDOM>[1]);
          if (context?.docId != null) {
            if (target === "segmentation") this._segmentationView?.focusDoc(context.docId);
            if (target === "annoter") this._annotationView?.focusDoc(context.docId);
          }
        },
        onReloadDocs: () => { void this._loadDocs(); },
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
        onNavigate: (target, context) => {
          if (!this._wfRoot) return;
          this._switchSubViewDOM(this._wfRoot, target as Parameters<typeof this._switchSubViewDOM>[1]);
          if (context?.docId != null) {
            if (target === "annoter") this._annotationView?.focusDoc(context.docId);
          }
        },
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

    // ── En-tête ──
    const headSection = document.createElement("section");
    headSection.className = "prep-acts-seg-head-card";
    headSection.innerHTML = `
      <div class="prep-acts-hub-head-left">
        <h1>Alignement</h1>
        <p>L'alignement crée des correspondances segment à segment entre un document pivot et ses traductions.</p>
      </div>
      <div class="prep-acts-hub-head-tools">
        <button class="prep-acts-hub-head-link" id="act-align-open-export-btn">Exporter cette étape…</button>
      </div>`;
    this._bindHeadNavLinks(headSection, root);
    headSection.querySelector("#act-align-open-export-btn")?.addEventListener("click", () => this._openAlignmentExportPrefill());
    wrapper.appendChild(headSection);

    // ── AlignPanel : 2-col + famille + audit + qualité + collisions + runs ──
    this._alignPanel = new AlignPanel(
      () => this._conn,
      () => this._docs,
      {
        log: (msg, isError) => this._log(msg, isError),
        toast: (msg, isError) => this._showToast?.(msg, isError),
        setBusy: (v) => this._setBusy(v),
        jobCenter: () => this._jobCenter,
        onRunDone: (_pivot, _targets, runId) => {
          if (runId) {
            this._alignRunId = runId;
            localStorage.setItem(ActionsScreen.LS_WF_RUN_ID, runId);
          }
        },
        onNav: (target) => {
          const linkEl = this._q<HTMLButtonElement>(`[data-nav="${target}"]`);
          linkEl?.click();
        },
      },
    );
    wrapper.appendChild(this._alignPanel.render());
    return wrapper;
  }

  // ── Curation preview scroll sync (#act-preview-raw ↔ #act-diff-list) ───────────────

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._docs = [];
    this._allRelations = [];
    this._allRelationsLoaded = false;
    this._hubHierarchyView = false;
    if (!conn) {
      this._lastErrorMsg = null;
    }
    this._setButtonsEnabled(false);
    // Notify extracted views of connection change
    this._curationView?.setConn();
    if (conn) {
      this._loadDocs();
      // Restore workflow run_id from localStorage
      const savedRunId = localStorage.getItem(ActionsScreen.LS_WF_RUN_ID);
      if (savedRunId) this._alignRunId = savedRunId;
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

  /** Public API: called from app.ts after Conventions→Prep navigation. */
  curationFocusDoc(docId: number): void {
    this._curationView?.focusDoc(docId);
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
    const curatePending = this._curationView?.hasPendingChanges() ?? false;
    const segPending = this._segmentationView?.hasPendingChanges() ?? false;
    return curatePending || segPending;
  }

  pendingChangesMessage(): string {
    const curatePending = this._curationView?.hasPendingChanges() ?? false;
    const segPending = this._segmentationView?.hasPendingChanges() ?? false;
    if (curatePending && segPending) {
      return "Des corrections manuelles de curation et une segmentation non validée sont en attente. Quitter cet onglet ?";
    }
    if (segPending) {
      return "Une segmentation est en attente de validation document. Quitter cet onglet ?";
    }
    return "Des corrections manuelles de curation non appliquées sont en attente. Quitter cet onglet ?";
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
    this._curationView?.applyCurationPreset(preset.curation_preset);
    setVal("#act-align-strategy", preset.alignment_strategy);
    if (preset.similarity_threshold !== undefined) {
      setVal("#act-sim-threshold", String(preset.similarity_threshold));
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  setLogEl(el: HTMLElement): void {
    this._logEl = el;
  }

  private _log(msg: string, isError = false): void {
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = isError ? "log-line log-error" : "log-line";
    line.dataset.source = "actions";
    line.textContent = `[${ts}] [Actions] ${msg}`;
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
    this._stateEl.className = `prep-runtime-state prep-state-${kind}`;
    this._stateEl.style.display = kind === "ok" ? "none" : "";
    this._stateEl.textContent = text;
  }

  private _refreshRuntimeState(): void {
    if (!this._stateEl) return;
    if (!this._conn) {
      this._setRuntimeState("error", "Sidecar indisponible. Ouvrez un projet ou relancez la connexion.");
      return;
    }
    if (this._isBusy) {
      this._setRuntimeState("info", "Opération en cours…");
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
    this._setRuntimeState("ok", "Session prête: vous pouvez lancer des actions.");
  }

  private _setButtonsEnabled(on: boolean): void {
    ["act-preview-btn", "act-curate-btn", "act-seg-btn",
     "act-seg-validate-btn", "act-seg-validate-only-btn", "act-seg-focus-toggle",
     "act-seg-open-export-btn", "act-seg-lt-btn", "act-seg-lt-validate-btn", "act-seg-lt-validate-only-btn",
     "act-seg-lt-open-export-btn", "act-align-open-export-btn",
     "act-meta-btn", "align-coll-load-btn"].forEach(id => {
      const el = this._q(`#${id}`) as HTMLButtonElement | null;
      if (el) el.disabled = !on;
    });
  }

  private async _loadDocs(): Promise<void> {
    if (!this._conn) return;
    try {
      this._docs = await listDocuments(this._conn);
      this._renderDocList();
      this._setButtonsEnabled(true);
      this._curationView?.onDocsLoaded();
      this._alignPanel?.refreshDocs();
      this._segmentationView?.refreshDocs();
      this._annotationView?.refreshIfConnected();
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
    if (this._hubHierarchyView) {
      this._renderHubHierarchyList(el);
      return;
    }
    const table = document.createElement("table");
    table.className = "prep-meta-table";
    table.innerHTML = `<thead><tr><th>N°</th><th>Titre</th><th>Langue</th><th>Rôle</th><th>Unités</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    this._docs.forEach((doc, idx) => {
      const tr = document.createElement("tr");
      for (const text of [String(idx + 1), doc.title, doc.language, doc.doc_role ?? "—", String(doc.unit_count)]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    el.innerHTML = "";
    el.appendChild(table);
  }

  private async _toggleHubHierarchyView(): Promise<void> {
    this._hubHierarchyView = !this._hubHierarchyView;
    const btn = this._q<HTMLButtonElement>("#act-hub-hierarchy-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", String(this._hubHierarchyView));
      btn.classList.toggle("btn-active", this._hubHierarchyView);
      btn.textContent = this._hubHierarchyView ? "📋 Liste" : "🌿 Hiérarchie";
    }
    if (this._hubHierarchyView && this._conn && !this._allRelationsLoaded) {
      try {
        this._allRelations = await getAllDocRelations(this._conn);
        this._allRelationsLoaded = true;
      } catch (err) {
        this._log(`Erreur chargement relations : ${err instanceof SidecarError ? err.message : String(err)}`, true);
        this._hubHierarchyView = false;
        if (btn) { btn.setAttribute("aria-pressed", "false"); btn.classList.remove("btn-active"); btn.textContent = "🌿 Hiérarchie"; }
        return;
      }
    }
    this._renderDocList();
  }

  private _buildHubTree(): { roots: { doc: DocumentRecord; children: { doc: DocumentRecord; relationLabel: string }[] }[]; standalone: DocumentRecord[]; orphans: DocumentRecord[] } {
    const docMap = new Map(this._docs.map(d => [d.doc_id, d]));
    const childOf = new Map<number, { parentId: number; label: string }>();
    const parentTo = new Map<number, { childId: number; label: string }[]>();

    for (const rel of this._allRelations) {
      if (!docMap.has(rel.doc_id)) continue;
      childOf.set(rel.doc_id, { parentId: rel.target_doc_id, label: rel.relation_type });
      if (!parentTo.has(rel.target_doc_id)) parentTo.set(rel.target_doc_id, []);
      parentTo.get(rel.target_doc_id)!.push({ childId: rel.doc_id, label: rel.relation_type });
    }

    const roots: { doc: DocumentRecord; children: { doc: DocumentRecord; relationLabel: string }[] }[] = [];
    const standalone: DocumentRecord[] = [];
    const orphans: DocumentRecord[] = [];

    for (const doc of this._docs) {
      const childInfo = childOf.get(doc.doc_id);
      if (childInfo) {
        if (!docMap.has(childInfo.parentId)) orphans.push(doc);
        continue;
      }
      const children = parentTo.get(doc.doc_id) ?? [];
      if (children.length === 0) {
        standalone.push(doc);
      } else {
        roots.push({
          doc,
          children: children
            .map(c => ({ doc: docMap.get(c.childId)!, relationLabel: c.label }))
            .filter(n => n.doc != null),
        });
      }
    }
    return { roots, standalone, orphans };
  }

  private _renderHubHierarchyList(el: HTMLElement): void {
    el.innerHTML = "";
    const { roots, standalone, orphans } = this._buildHubTree();

    const table = document.createElement("table");
    table.className = "prep-meta-table";
    table.innerHTML = `<thead><tr><th>N°</th><th>Titre</th><th>Langue</th><th>Rôle</th><th>Unités</th></tr></thead>`;
    const tbody = document.createElement("tbody");

    let _rowNum = 0;
    const appendRow = (doc: DocumentRecord, depth = 0, relationLabel?: string): void => {
      _rowNum++;
      const tr = document.createElement("tr");
      tr.className = "prep-meta-doc-row";
      if (depth > 0) tr.classList.add("prep-tree-child");

      const indent = depth > 0 ? `<span class="prep-tree-connector" aria-hidden="true">└</span>` : "";
      const relBadge = relationLabel
        ? `<span class="prep-tree-rel-badge">${_escHtml(relationLabel)}</span>`
        : "";

      const titleTd = document.createElement("td");
      titleTd.className = "col-title tree-title-cell";
      titleTd.style.paddingLeft = `${0.5 + depth * 1.4}rem`;
      titleTd.innerHTML = `${indent}${relBadge}`;
      const titleSpan = document.createElement("span");
      titleSpan.textContent = doc.title;
      titleTd.appendChild(titleSpan);

      const idTd = document.createElement("td"); idTd.textContent = String(_rowNum);
      const langTd = document.createElement("td"); langTd.textContent = doc.language;
      const roleTd = document.createElement("td"); roleTd.textContent = doc.doc_role ?? "—";
      const unitsTd = document.createElement("td"); unitsTd.textContent = String(doc.unit_count);

      tr.appendChild(idTd);
      tr.appendChild(titleTd);
      tr.appendChild(langTd);
      tr.appendChild(roleTd);
      tr.appendChild(unitsTd);
      tbody.appendChild(tr);
    };

    const appendSectionHeader = (label: string, count: number): void => {
      const tr = document.createElement("tr");
      tr.className = "prep-tree-section-header";
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "prep-tree-section-label";
      td.textContent = `${label} `;
      const countSpan = document.createElement("span");
      countSpan.className = "prep-tree-section-count";
      countSpan.textContent = String(count);
      td.appendChild(countSpan);
      tr.appendChild(td);
      tbody.appendChild(tr);
    };

    if (roots.length > 0) {
      for (const node of roots) {
        appendRow(node.doc);
        for (const child of node.children) {
          appendRow(child.doc, 1, child.relationLabel);
        }
      }
    }
    if (standalone.length > 0) {
      if (roots.length > 0) appendSectionHeader("Sans famille", standalone.length);
      for (const doc of standalone) appendRow(doc);
    }
    if (orphans.length > 0) {
      appendSectionHeader("Parent absent du corpus", orphans.length);
      for (const doc of orphans) appendRow(doc);
    }

    table.appendChild(tbody);
    el.appendChild(table);
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
    // Drop DOM references
    this._root = null;
    this._wfRoot = null;
  }
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function _formatMaybeNumber(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "n/a";
  return v.toFixed(3);
}

function _escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

