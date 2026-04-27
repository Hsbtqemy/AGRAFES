/**
 * SegmentationView.ts — Standalone segmentation view extracted from ActionsScreen.
 *
 * Dependencies injected via closures:
 *   - _getConn: () => Conn | null
 *   - _getDocs: () => DocumentRecord[]
 *   - _cb: SegmentationCallbacks
 */

import type {
  Conn,
  DocumentRecord,
  DetectMarkersResponse,
  ConventionRole,
} from "../lib/sidecarClient.ts";
import {
  enqueueJob,
  updateDocument,
  getDocumentPreview,
  segmentPreview,
  structureSections,
  structureDiff,
  segmentPropagatePreview,
  applyPropagated,
  zoneLines,
  insertStructureUnit,
  deleteStructureUnit,
  detectMarkers,
  mergeUnits,
  splitUnit,
  listConventions,
  SidecarError,
  richTextToHtml,
} from "../lib/sidecarClient.ts";
import type { StructureSection, StructureDiffSection, PropagateSection } from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { inlineConfirm } from "../lib/inlineConfirm.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SegmentReport {
  doc_id: number;
  units_input: number;
  units_output: number;
  segment_pack?: string;
  warnings?: string[];
}

export interface SegmentExportPrefill {
  stage?: "segmentation";
  product?: "readable_text";
  format?: "txt";
  docIds?: number[];
  strictMode?: boolean;
}

export interface SegmentationCallbacks {
  log(msg: string, isError?: boolean): void;
  toast?(msg: string, isError?: boolean): void;
  setBusy(v: boolean): void;
  isBusy(): boolean;
  jobCenter?(): JobCenter | null;
  onNavigate?(target: string, context?: { docId?: number }): void;
  onOpenDocuments?(): void;
  onOpenExporter?(prefill?: SegmentExportPrefill): void;
}

// ─── SegmentationView ─────────────────────────────────────────────────────────

export class SegmentationView {
  // ─── Statics ──────────────────────────────────────────────────────────────
  static readonly LS_SEG_POST_VALIDATE = "agrafes.prep.seg.post_validate";

  // ─── Dependencies ─────────────────────────────────────────────────────────
  private readonly _getConn: () => Conn | null;
  private readonly _getDocs: () => DocumentRecord[];
  private readonly _cb: SegmentationCallbacks;

  // ─── State ────────────────────────────────────────────────────────────────
  private _root: HTMLElement | null = null;
  private _segmentPendingValidation = false;
  private _lastSegmentReport: SegmentReport | null = null;
  private _selectedSegDocId: number | null = null;
  private _segShortFilter = false;
  private _segOrphanFilter = false;
  private _segDocListSort: "id" | "alpha" = "id";
  private _conventions: ConventionRole[] = [];
  private _segMarkersDetected: DetectMarkersResponse | null = null;
  private _segSplitMode: "sentences" | "markers" = "sentences";
  private _segPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private _ltSyncLock = false;
  private _onLtRawScroll: ((e: Event) => void) | null = null;
  // ─── Structure matcher state ───────────────────────────────────────────────
  private _refSections: StructureSection[] = [];
  private _tgtSections: StructureSection[] = [];
  private _structurePairs: [number, number][] = []; // [ref_idx, tgt_idx][]
  private _matcherInitialized = false; // true once user sees the matcher (prevents re-init on tab re-open)
  private _matcherPendingSide: "ref" | "tgt" | null = null;
  private _matcherPendingIdx: number | null = null;
  private _matcherDocId: number | null = null;
  private _matcherRefDocId: number | null = null;
  private _lastDeletedUnit: { docId: number; n: number; text: string; role: string | null } | null = null;
  private _undoTimer: ReturnType<typeof setTimeout> | null = null;
  private _undoCountdownInterval: ReturnType<typeof setInterval> | null = null;
  // ─── Propagate preview editable state ─────────────────────────────────────
  private _propagateLiveSections: Array<{
    status: string;
    header_text: string | null;
    header_role: string | null;
    ref_count: number;
    original_count: number;
    adjusted: boolean;
    segments: string[];
  }> = [];
  private _onLtSegScroll: ((e: Event) => void) | null = null;
  private _segPrevSyncLock = false;
  private _onSegPrevRawScroll: ((e: Event) => void) | null = null;
  private _onSegPrevSegScroll: ((e: Event) => void) | null = null;

  constructor(
    getConn: () => Conn | null,
    getDocs: () => DocumentRecord[],
    callbacks: SegmentationCallbacks,
  ) {
    this._getConn = getConn;
    this._getDocs = getDocs;
    this._cb = callbacks;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  render(container: HTMLElement): void {
    this._root = container;
    this._segmentPendingValidation = false;
    this._lastSegmentReport = null;
    this._segSplitMode = "sentences";

    const el = this._buildRootEl();
    container.appendChild(el);
    this._populateSegDocList();
  }

  dispose(): void {
    if (this._segPreviewTimer) {
      clearTimeout(this._segPreviewTimer);
      this._segPreviewTimer = null;
    }
    if (this._undoTimer) {
      clearTimeout(this._undoTimer);
      this._undoTimer = null;
    }
    if (this._undoCountdownInterval) {
      clearInterval(this._undoCountdownInterval);
      this._undoCountdownInterval = null;
    }
    this._unbindLongtextScrollSync();
    this._unbindSegPreviewScrollSync();
    this._root = null;
  }

  hasPendingChanges(): boolean {
    return this._segmentPendingValidation;
  }

  pendingChangesMessage(): string {
    return "Une segmentation est en attente de validation document. Quitter cet onglet ?";
  }

  /** Called by parent when the document list changes. */
  refreshDocs(): void {
    this._populateSegDocList();
    this._refreshSegmentationStatusUI();
  }

  focusDoc(docId: number): void {
    this._selectedSegDocId = docId;
    const row = this._q<HTMLElement>(`.prep-seg-doc-row[data-doc-id="${docId}"]`);
    if (row) {
      this._q<HTMLElement>("#act-seg-split-left")
        ?.querySelectorAll(".prep-seg-doc-row")
        .forEach(r => r.classList.remove("active"));
      row.classList.add("active");
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    const rightEl = this._q<HTMLElement>("#act-seg-split-right");
    if (rightEl) void this._loadSegRightPanel(docId, rightEl);
  }

  /** Returns the most recent segment report (for cross-view display in CurationView). */
  getLastSegmentReport(): { doc_id: number; units_output: number; warnings?: string[] } | null {
    return this._lastSegmentReport;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _q<T extends Element = Element>(sel: string): T | null {
    return (this._root?.querySelector<T>(sel)) ?? null;
  }

  // ─── Build root element ───────────────────────────────────────────────────

  private _buildRootEl(): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("role", "main");
    el.setAttribute("aria-label", "Vue Segmentation");
    el.className = "prep-seg-panel-root";
    el.innerHTML = `
      <div class="prep-seg-split-layout">
        <div class="prep-seg-split-list" id="act-seg-split-list">
          <div class="prep-seg-list-branding">
            <h2 class="prep-seg-list-brand-title">Segmentation</h2>
            <p class="prep-seg-list-brand-desc">S&#233;lectionnez un document pour voir l&#8217;aper&#231;u live et lancer la segmentation.</p>
          </div>
          <div class="prep-seg-split-list-head">
            <input type="search" id="act-seg-list-filter" class="prep-seg-split-list-filter"
              placeholder="Filtrer&#8230;" autocomplete="off" />
            <div class="prep-curate-sort-group" role="group" aria-label="Tri">
              <button class="prep-curate-sort-btn active" data-seg-sort="id" title="Trier par identifiant">ID</button>
              <button class="prep-curate-sort-btn" data-seg-sort="alpha" title="Trier par titre">A&#8211;Z</button>
            </div>
          </div>
          <div class="prep-seg-split-list-scroll" id="act-seg-list-scroll">
            <p class="empty-hint">Chargement&#8230;</p>
          </div>
        </div>
        <div class="prep-seg-split-right" id="act-seg-split-right">
          <div class="prep-seg-right-empty">&#8592; S&#233;lectionnez un document</div>
        </div>
      </div>
    `;

    // Filter list on input
    el.querySelector<HTMLInputElement>("#act-seg-list-filter")?.addEventListener("input", (e) => {
      const q = (e.target as HTMLInputElement).value.toLowerCase();
      el.querySelectorAll<HTMLElement>(".prep-seg-doc-row").forEach(row => {
        const match = (row.textContent ?? "").toLowerCase().includes(q);
        row.style.display = match ? "" : "none";
      });
      el.querySelectorAll<HTMLElement>(".prep-seg-doc-group").forEach(grp => {
        const visible = Array.from(grp.querySelectorAll<HTMLElement>(".prep-seg-doc-row"))
          .some(r => r.style.display !== "none");
        const prev = grp.previousElementSibling as HTMLElement | null;
        if (prev?.style) prev.style.display = visible ? "" : "none";
        (grp as HTMLElement).style.display = visible ? "" : "none";
      });
    });
    // Sort buttons
    el.querySelectorAll<HTMLButtonElement>("[data-seg-sort]").forEach(btn => {
      btn.addEventListener("click", () => {
        this._segDocListSort = (btn.dataset.segSort as "id" | "alpha") ?? "id";
        el.querySelectorAll<HTMLButtonElement>("[data-seg-sort]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this._populateSegDocList(true);
      });
    });

    return el;
  }

  // ─── Doc list (left panel) ────────────────────────────────────────────────

  private _populateSegDocList(keepScroll = false): void {
    const scrollEl = this._q<HTMLElement>("#act-seg-list-scroll");
    if (!scrollEl) return;

    const savedScrollTop = keepScroll ? scrollEl.scrollTop : 0;

    scrollEl.innerHTML = `<p class="empty-hint">Chargement des familles&#8230;</p>`;
    if (keepScroll) scrollEl.scrollTop = savedScrollTop;
    void this._buildSegDocListHtml().then(html => {
      if (!scrollEl.isConnected) return;
      scrollEl.innerHTML = html;
      scrollEl.querySelectorAll<HTMLElement>(".prep-seg-doc-row").forEach(row => {
        row.addEventListener("click", () => {
          const docId = parseInt(row.dataset.docId ?? "", 10);
          if (!docId) return;
          scrollEl.querySelectorAll(".prep-seg-doc-row").forEach(r => r.classList.remove("active"));
          row.classList.add("active");
          this._selectedSegDocId = docId;
          const rightEl = this._q<HTMLElement>("#act-seg-split-right");
          if (rightEl) void this._loadSegRightPanel(docId, rightEl);
        });
      });

      if (keepScroll) scrollEl.scrollTop = savedScrollTop;

      if (this._selectedSegDocId) {
        const prevRow = scrollEl.querySelector<HTMLElement>(
          `.prep-seg-doc-row[data-doc-id="${this._selectedSegDocId}"]`,
        );
        if (prevRow) {
          prevRow.classList.add("active");
          // Ensure the active row is visible; scroll to it only if out of view
          const rowTop = prevRow.offsetTop;
          const rowBot = rowTop + prevRow.offsetHeight;
          const visTop = scrollEl.scrollTop;
          const visBot = visTop + scrollEl.clientHeight;
          if (rowTop < visTop || rowBot > visBot) {
            scrollEl.scrollTop = Math.max(0, rowTop - scrollEl.clientHeight / 2);
          }
        }
      }
    });
  }

  private async _buildSegDocListHtml(): Promise<string> {
    const statusBadge = (d: DocumentRecord): string => {
      const s = d.workflow_status ?? "draft";
      if (s === "validated") return `<span class="prep-seg-doc-badge prep-seg-badge-ok">&#10003; Valid&#233;</span>`;
      if (s === "review")    return `<span class="prep-seg-doc-badge prep-seg-badge-warn">&#9203; En revue</span>`;
      return `<span class="prep-seg-doc-badge prep-seg-badge-none">Brouillon</span>`;
    };

    const docRow = (d: DocumentRecord, indent = false): string =>
      `<div class="prep-seg-doc-row${indent ? " prep-seg-doc-child" : ""}" data-doc-id="${d.doc_id}">
        <div class="prep-seg-doc-row-main">
          <span class="prep-seg-doc-title" title="${_escHtml(d.title)}">${_escHtml(d.title)}</span>
          <span class="prep-seg-doc-lang">[${_escHtml(d.language)}]</span>
        </div>
        <div class="prep-seg-doc-row-foot">
          <span class="prep-seg-doc-units">${d.unit_count} unit&#233;s</span>
          ${statusBadge(d)}
        </div>
      </div>`;

    let familyGroups: Array<{ root: DocumentRecord; children: DocumentRecord[] }> = [];
    const orphans: DocumentRecord[] = [];
    try {
      const { getAllDocRelations } = await import("../lib/sidecarClient.ts");
      const conn = this._getConn();
      if (conn) {
        const relations = await getAllDocRelations(conn);
        const childIds = new Set(relations.map(r => r.doc_id));
        const parentMap = new Map<number, number[]>();

        for (const rel of relations) {
          if (!parentMap.has(rel.target_doc_id)) parentMap.set(rel.target_doc_id, []);
          parentMap.get(rel.target_doc_id)!.push(rel.doc_id);
        }

        const sortFn = (a: DocumentRecord, b: DocumentRecord) =>
          this._segDocListSort === "alpha"
            ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
            : a.doc_id - b.doc_id;
        const docs = [...this._getDocs()].sort(sortFn);
        for (const d of docs) {
          if (!childIds.has(d.doc_id) && parentMap.has(d.doc_id)) {
            const children = (parentMap.get(d.doc_id) ?? [])
              .map(cid => docs.find(dd => dd.doc_id === cid))
              .filter(Boolean) as DocumentRecord[];
            children.sort(sortFn);
            familyGroups.push({ root: d, children });
          } else if (!childIds.has(d.doc_id) && !parentMap.has(d.doc_id)) {
            orphans.push(d);
          }
        }
      }
    } catch {
      const sortFn = (a: DocumentRecord, b: DocumentRecord) =>
        this._segDocListSort === "alpha"
          ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
          : a.doc_id - b.doc_id;
      return [...this._getDocs()].sort(sortFn).map(d => docRow(d)).join("");
    }

    let html = "";
    for (let fi = 0; fi < familyGroups.length; fi++) {
      const { root, children } = familyGroups[fi];
      html += `<div class="prep-seg-doc-group-label">
        <span class="prep-seg-family-pill">Famille ${fi + 1}</span>
        <span class="prep-seg-family-root-name" title="${_escHtml(root.title)}">${_escHtml(root.title)}</span>
      </div>`;
      html += `<div class="prep-seg-doc-group">`;
      html += docRow(root);
      for (const child of children) html += docRow(child, true);
      html += `</div>`;
    }
    if (orphans.length > 0) {
      if (familyGroups.length > 0) {
        html += `<div class="prep-seg-doc-group-label">&#8212; Sans famille</div>`;
      } else {
        html += `<div class="prep-seg-doc-group-label">Tous les documents</div>`;
      }
      html += `<div class="prep-seg-doc-group">`;
      for (const d of orphans) html += docRow(d);
      html += `</div>`;
    }
    return html || `<p class="empty-hint">Aucun document.</p>`;
  }

  // ─── Right panel ──────────────────────────────────────────────────────────

  private async _loadSegRightPanel(docId: number, rightEl: HTMLElement): Promise<void> {
    const docs = this._getDocs();
    const doc = docs.find(d => d.doc_id === docId);
    if (!doc) { rightEl.innerHTML = `<div class="prep-seg-right-empty">Document introuvable.</div>`; return; }

    this._segMarkersDetected = null;
    this._segSplitMode = "sentences";
    this._segShortFilter = false;
    this._segOrphanFilter = false;
    this._refSections = [];
    this._tgtSections = [];
    this._structurePairs = [];
    this._matcherInitialized = false;
    this._propagateLiveSections = [];
    this._matcherPendingSide = null;
    this._matcherPendingIdx = null;
    this._matcherDocId = null;
    this._matcherRefDocId = null;

    // Load conventions for role badges (best-effort)
    const conn = this._getConn();
    if (conn) {
      try { this._conventions = await listConventions(conn); } catch { this._conventions = []; }
    }

    const pack = (this._q("#act-seg-pack") as HTMLSelectElement | null)?.value ?? "auto";
    const lang = (this._q("#act-seg-lang") as HTMLInputElement | null)?.value.trim() || doc.language || "fr";
    const statusBadge = doc.workflow_status === "validated"
      ? `<span class="prep-seg-state-chip prep-seg-badge-ok">&#10003; Valid&#233;</span>`
      : doc.workflow_status === "review"
      ? `<span class="prep-seg-state-chip prep-seg-badge-warn">&#9203; En revue</span>`
      : `<span class="prep-seg-state-chip prep-seg-badge-none">Brouillon</span>`;

    const savedAlready = (doc.unit_count ?? 0) > 0;

    // Build calibrate-select options: family members first, then others alphabetically
    let calibrateOptions = `<option value="">&#8212; aucun &#8212;</option>`;
    const _calibrateFallback = () => {
      docs
        .filter(d => d.doc_id !== docId)
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
        .forEach(d => {
          calibrateOptions += `<option value="${d.doc_id}">[${d.doc_id}] ${_escHtml(d.title)}</option>`;
        });
    };
    if (!conn) {
      _calibrateFallback();
    } else {
      try {
        const { getAllDocRelations } = await import("../lib/sidecarClient.ts");
        const relations = await getAllDocRelations(conn);
        const otherDocs = docs.filter(d => d.doc_id !== docId);

        const parentRel = relations.find(r => r.doc_id === docId);
        const parentId = parentRel?.target_doc_id ?? null;
        const childIds = new Set(relations.filter(r => r.target_doc_id === docId).map(r => r.doc_id));
        const siblingIds = parentId
          ? new Set(relations.filter(r => r.target_doc_id === parentId && r.doc_id !== docId).map(r => r.doc_id))
          : new Set<number>();

        const familyIds = new Set<number>();
        if (parentId !== null) familyIds.add(parentId);
        for (const id of childIds) familyIds.add(id);
        for (const id of siblingIds) familyIds.add(id);

        const familyDocs = otherDocs
          .filter(d => familyIds.has(d.doc_id))
          .sort((a, b) => {
            if (a.doc_id === parentId) return -1;
            if (b.doc_id === parentId) return 1;
            return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
          });
        const restDocs = otherDocs
          .filter(d => !familyIds.has(d.doc_id))
          .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

        if (familyDocs.length > 0) {
          calibrateOptions += `<optgroup label="Famille">`;
          for (const d of familyDocs) {
            const prefix = d.doc_id === parentId ? "&#8593; " : "";
            calibrateOptions += `<option value="${d.doc_id}">${prefix}[${d.doc_id}] ${_escHtml(d.title)}</option>`;
          }
          calibrateOptions += `</optgroup>`;
        }
        if (restDocs.length > 0) {
          const grpLabel = familyDocs.length > 0 ? "Autres documents" : "Documents";
          calibrateOptions += `<optgroup label="${grpLabel}">`;
          for (const d of restDocs) {
            calibrateOptions += `<option value="${d.doc_id}">[${d.doc_id}] ${_escHtml(d.title)}</option>`;
          }
          calibrateOptions += `</optgroup>`;
        }
      } catch {
        _calibrateFallback();
      }
    }

    this._unbindSegPreviewScrollSync();

    rightEl.innerHTML = `
      <div class="prep-seg-right-root" id="act-seg-right-root">
        <div class="prep-seg-right-scroll">
        <div class="prep-seg-right-header">
          <div class="prep-seg-right-header-main">
            <h3 class="prep-seg-right-doc-title">${_escHtml(doc.title)}</h3>
            ${statusBadge}
          </div>
          <div class="prep-seg-right-header-meta">#${doc.doc_id} &middot; ${_escHtml(doc.language)} &middot; ${doc.unit_count} unit&#233;s</div>
        </div>
        <div class="prep-seg-config-bar" role="region" aria-label="Strat&#233;gie de segmentation">
          <div class="prep-seg-config-row">
            <div class="prep-seg-config-tabs" role="group" aria-label="Strat&#233;gie">
              <label class="prep-seg-tab-label">
                <input type="radio" name="act-seg-strategy" id="act-seg-strategy-sentences" value="sentences" checked />
                <span>Phrases</span>
              </label>
              <label class="prep-seg-tab-label">
                <input type="radio" name="act-seg-strategy" id="act-seg-strategy-markers" value="markers" />
                <span>Balises&nbsp;<code>[N]</code></span>
              </label>
            </div>
            <div class="prep-seg-config-params">
              <label class="prep-seg-param-field">Langue
                <input id="act-seg-lang" type="text" value="${_escHtml(lang)}" maxlength="10"
                  class="prep-seg-param-input" placeholder="fr, en&#8230;" autocomplete="off" spellcheck="false" />
              </label>
              <div id="act-seg-params-phrases" class="prep-seg-config-params-group">
                <label class="prep-seg-param-field"
                  title="&#201;vite de couper apr&#232;s un point qui suit une abr&#233;viation (M., Dr., ann., chap., etc.).">
                  <span class="prep-seg-param-label-text">O&#249; couper les phrases</span>
                  <select id="act-seg-pack" class="seg-param-select">
                    <option value="auto"${pack === "auto" ? " selected" : ""}>Auto (selon la langue)</option>
                    <option value="fr_strict"${pack === "fr_strict" ? " selected" : ""}>Fran&#231;ais &#8212; liste longue d&#8217;abr&#233;viations</option>
                    <option value="en_strict"${pack === "en_strict" ? " selected" : ""}>Anglais &#8212; liste longue d&#8217;abr&#233;viations</option>
                    <option value="default"${pack === "default" ? " selected" : ""}>Liste courte (moins de protections)</option>
                  </select>
                </label>
              </div>
              <div id="act-seg-params-markers" class="prep-seg-config-params-group" style="display:none">
                <button type="button" class="btn btn-ghost btn-sm" id="act-seg-detect-btn"
                  title="D&#233;tecter les balises [N] dans le texte">&#128270; D&#233;tecter balises</button>
              </div>
              <label class="prep-seg-param-field"
                title="R&#233;f&#233;rence pour calibrer la segmentation (mode phrases) et comparer la structure (onglet Structure).">Calibrer sur
                <select id="act-seg-calibrate" class="seg-param-select">
                  ${calibrateOptions}
                </select>
              </label>
            </div>
          </div>
          <p id="act-seg-strategy-summary" class="prep-seg-strategy-summary" aria-live="polite"></p>
        </div>
        <div id="act-seg-marker-banner" class="prep-seg-marker-banner" style="display:none" aria-live="polite"></div>
        <details class="prep-seg-rule-info" id="act-seg-rule-info">
          <summary class="prep-seg-rule-info-sum">&#9432; Moteur de d&#233;coupage</summary>
          <div class="prep-seg-rule-info-body">
            <p>Le moteur coupe sur <code>.&nbsp;!&nbsp;?</code> suivi d&#8217;un espace puis d&#8217;une <strong>lettre majuscule</strong> (ou guillemet ouvrant).</p>
            <p>&#8594; Si vos phrases d&#233;butent par une minuscule, le moteur ne les d&#233;tectera pas comme d&#233;but de phrase.</p>
            <p>&#8594; Si chaque paragraphe du document est d&#233;j&#224; une phrase, la segmentation retourne le m&#234;me nombre d&#8217;unit&#233;s.</p>
            <p><strong>O&#249; couper les phrases :</strong> les options <em>Fran&#231;ais / Anglais &#8212; liste longue</em> ajoutent des abr&#233;viations prot&#233;g&#233;es (ann., chap., etc.) pour &#233;viter les faux d&#233;coupages apr&#232;s un point.</p>
            <p><strong>Mode balises :</strong> utilisez-le si des motifs <code>[N]</code> sont encore dans <em>le texte des unit&#233;s</em> (ex. import en paragraphes / blocs). Chaque balise devient un <code>external_id</code> pour l&#8217;alignement. Si le document a d&#233;j&#224; &#233;t&#233; import&#233; en <em>lignes num&#233;rot&#233;es [n]</em>, les IDs sont d&#233;j&#224; port&#233;s par les unit&#233;s et ce mode apporte souvent peu de diff&#233;rence.</p>
            <p><strong>Pr&#233;fixe avant <code>[1]</code> :</strong> le texte plac&#233; avant la premi&#232;re balise devient un segment distinct, avec <code>external_id = NULL</code>.</p>
          </div>
        </details>
        <div class="prep-seg-content-section" id="act-seg-content-section">
          <div class="prep-seg-content-head">
            <div class="prep-seg-content-tabs" role="tablist">
              <button class="prep-seg-content-tab active" role="tab" data-pane="preview">
                Aper&#231;u&#160;<span class="prep-seg-preview-badge" id="act-seg-mode-badge">phrases</span>
              </button>
              <button class="prep-seg-content-tab" role="tab" data-pane="saved"
                ${!savedAlready ? 'disabled title="Aucun segment — appliquez d\'abord la segmentation"' : 'title="Éditer les segments : fusionner, couper"'}>
                &#9986; Modifier&#160;<span id="act-seg-saved-count" class="chip">${savedAlready ? doc.unit_count : "&#8212;"}</span>
              </button>
              <button class="prep-seg-content-tab" role="tab" data-pane="diff"
                ${!savedAlready ? 'disabled title="Aucun segment en base"' : 'title="Comparer avant/après re-segmentation"'}>
                &#8644;&#160;Diff
              </button>
              <button class="prep-seg-content-tab" role="tab" data-pane="structure"
                title="Comparer la structure (intertitres) avec le document de référence">
                &#9783;&#160;Structure
              </button>
            </div>
            <span id="act-seg-prev-stats" class="prep-seg-preview-stats"></span>
            <button type="button" class="btn btn-ghost btn-sm" id="act-seg-prev-refresh"
              title="Relancer l&#8217;aper&#231;u">&#8635;</button>
          </div>
          <div id="act-seg-pane-preview" role="tabpanel">
            <div class="prep-seg-preview-split" id="act-seg-preview-split">
              <div>
                <div class="prep-seg-preview-col-title">Brut (<span id="act-seg-prev-raw-count">&#8212;</span> unit&#233;s)</div>
                <div class="prep-seg-preview-col-list" id="act-seg-prev-raw">
                  <p class="empty-hint">Chargement&#8230;</p>
                </div>
              </div>
              <div>
                <div class="prep-seg-preview-col-title">Segment&#233; (<span id="act-seg-prev-seg-count">&#8212;</span> phrases)</div>
                <div class="prep-seg-preview-col-list" id="act-seg-prev-seg">
                  <p class="empty-hint">En attente&#8230;</p>
                </div>
              </div>
            </div>
            <div id="act-seg-prev-warns" class="prep-seg-warn-list" style="display:none"></div>
          </div>
          <div id="act-seg-pane-saved" style="display:none" role="tabpanel">
            <div id="act-seg-saved-table">
              ${savedAlready ? `<p class="empty-hint">Chargement des segments&#8230;</p>` : ""}
            </div>
          </div>
          <div id="act-seg-pane-diff" style="display:none" role="tabpanel">
            <div id="act-seg-diff-content">
              <p class="empty-hint">Basculez sur l&#8217;onglet Diff pour comparer.</p>
            </div>
          </div>
          <div id="act-seg-pane-structure" style="display:none" role="tabpanel">
            <div id="act-seg-structure-content">
              <p class="empty-hint">S&#233;lectionnez un document de r&#233;f&#233;rence dans &#171;&#160;Calibrer sur&#160;&#187; puis ouvrez cet onglet.</p>
            </div>
          </div>
        </div>
        </div><!-- /.prep-seg-right-scroll -->
        <div class="prep-seg-actions-bar" id="act-seg-actions">
          <button class="btn prep-btn-warning" id="act-seg-btn"
            title="Appliquer la segmentation (efface les liens d&#8217;alignement existants)">Appliquer</button>
          <button class="btn btn-secondary btn-sm" id="act-seg-validate-btn"
            title="Appliquer la segmentation puis valider le document">Appliquer + Valider</button>
          <button class="btn btn-primary btn-sm" id="act-seg-validate-only-btn"
            ${!savedAlready ? "disabled" : ""}>Valider &#10003;</button>
          <button class="btn btn-sm" id="act-seg-goto-annot-btn"
            title="Ouvrir ce document dans le panneau Annotation">Voir&#160;annotation&#160;&#8599;</button>
          <div class="prep-seg-actions-dest">
            Apr&#232;s validation&#160;:
            <select id="act-seg-after-validate" class="seg-param-select prep-seg-param-select-sm">
              <option value="stay">Rester ici</option>
              <option value="next">Doc suivant</option>
              <option value="documents">Onglet Documents</option>
            </select>
          </div>
        </div>
        <div id="act-seg-confirm-bar" class="audit-batch-bar" style="display:none"></div>
        <div id="act-seg-status-banner" class="prep-seg-status-banner prep-runtime-state prep-state-info" aria-live="polite"></div>
      </div>
    `;

    // Restore after-validate pref
    const afterSel = rightEl.querySelector<HTMLSelectElement>("#act-seg-after-validate");
    if (afterSel) afterSel.value = this._postValidateDestination();
    afterSel?.addEventListener("change", () => {
      const raw = afterSel.value;
      const next = raw === "next" || raw === "stay" ? raw : "documents";
      try { localStorage.setItem(SegmentationView.LS_SEG_POST_VALIDATE, next); } catch { /* ignore */ }
    });

    // Wire params → debounced preview
    rightEl.querySelector("#act-seg-lang")?.addEventListener("input", () => this._scheduleSegPreview(docId));
    rightEl.querySelector("#act-seg-pack")?.addEventListener("change", () => this._scheduleSegPreview(docId));
    rightEl.querySelector("#act-seg-calibrate")?.addEventListener("change", () => {
      this._scheduleSegPreview(docId);
      this._structurePairs = [];
      this._matcherInitialized = false;
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      this._matcherDocId = null;
      this._matcherRefDocId = null;
      const activePane = this._root?.querySelector<HTMLButtonElement>(".prep-seg-content-tab.active")?.dataset.pane;
      if (activePane === "structure") void this._renderStructureDiff(docId);
    });
    rightEl.querySelector("#act-seg-prev-refresh")?.addEventListener("click", () => void this._runSegPreview(docId));

    rightEl.querySelectorAll<HTMLInputElement>('input[name="act-seg-strategy"]').forEach(r => {
      r.addEventListener("change", () => {
        if (r.value === "markers") this._activateMarkersMode(docId);
        else this._deactivateMarkersMode(docId);
      });
    });
    this._syncSegStrategyRadios();

    rightEl.querySelector("#act-seg-detect-btn")?.addEventListener("click", () => void this._runDetectMarkers(docId));
    rightEl.querySelector("#act-seg-goto-annot-btn")?.addEventListener("click", () => {
      this._cb.onNavigate?.("annoter", { docId });
    });
    rightEl.querySelector("#act-seg-btn")?.addEventListener("click", () => void this._runSegment());
    rightEl.querySelector("#act-seg-validate-btn")?.addEventListener("click", () => void this._runSegment(true));
    rightEl.querySelector("#act-seg-validate-only-btn")?.addEventListener("click", () => void this._runValidateCurrentSegDoc());

    // Wire content pane tabs (Aperçu / Enregistré / Diff)
    rightEl.querySelectorAll<HTMLButtonElement>(".prep-seg-content-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        const pane = btn.dataset.pane as "preview" | "saved" | "diff" | "structure";
        this._switchContentPane(pane, docId);
      });
    });

    void this._loadSegRawColumn(docId);
    void this._runSegPreview(docId);
    void this._runDetectMarkers(docId, /* silent */ true);

    this._bindSegPreviewScrollSync();

    if (savedAlready) {
      const savedTableEl = rightEl.querySelector<HTMLElement>("#act-seg-saved-table");
      if (savedTableEl) void this._renderSegSavedTable(docId, savedTableEl);
      // Doc already has segments — open on the edit pane directly.
      this._switchContentPane("saved");
    }

    this._refreshSegmentationStatusUI();
  }

  // ─── Raw column ───────────────────────────────────────────────────────────

  private async _loadSegRawColumn(docId: number): Promise<void> {
    const rawEl = this._q<HTMLElement>("#act-seg-prev-raw");
    const countEl = this._q<HTMLElement>("#act-seg-prev-raw-count");
    const conn = this._getConn();
    if (!rawEl || !conn) return;
    try {
      const preview = await getDocumentPreview(conn, docId, 200);
      if (countEl) countEl.textContent = String(preview.total_lines);
      if (!preview.lines.length) {
        rawEl.innerHTML = `<p class="empty-hint">Aucune unit&#233;.</p>`;
        return;
      }
      const truncNote = preview.total_lines > 200
        ? `<p class="prep-seg-trunc-note">Aper&#231;u &#8212; 200/${preview.total_lines} unit&#233;s (premi&#232;res lignes)</p>`
        : "";
      rawEl.innerHTML = truncNote + preview.lines.map(l =>
        `<div class="prep-seg-prev-row" data-unit-n="${l.n}"><span class="prep-seg-prev-n">${l.n}</span>${_roleBadgeHtml(l.unit_role, this._conventions)}<span class="prep-seg-prev-tx">${richTextToHtml(l.text_raw, l.text)}</span></div>`,
      ).join("");
    } catch (err) {
      rawEl.innerHTML = `<p class="empty-hint">Impossible de charger le texte brut : ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  // ─── Live preview ─────────────────────────────────────────────────────────

  private _scheduleSegPreview(docId: number): void {
    if (this._segPreviewTimer) clearTimeout(this._segPreviewTimer);
    this._segPreviewTimer = setTimeout(() => {
      this._segPreviewTimer = null;
      const rightEl = this._q<HTMLElement>("#act-seg-split-right");
      if (!rightEl?.isConnected) return;
      void this._runSegPreview(docId);
    }, 400);
  }

  private async _runSegPreview(docId: number): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const segEl = this._q<HTMLElement>("#act-seg-prev-seg");
    const statsEl = this._q<HTMLElement>("#act-seg-prev-stats");
    const segCountEl = this._q<HTMLElement>("#act-seg-prev-seg-count");
    const warnsEl = this._q<HTMLElement>("#act-seg-prev-warns");
    const segColTitle = this._q<HTMLElement>("#act-seg-preview-split > div:nth-child(2) .prep-seg-preview-col-title");
    if (!segEl) return;

    const lang = (this._q("#act-seg-lang") as HTMLInputElement | null)?.value.trim() || "fr";
    const pack = (this._q("#act-seg-pack") as HTMLSelectElement | null)?.value ?? "auto";
    const mode = this._segSplitMode;
    const calibrateRaw = (this._q("#act-seg-calibrate") as HTMLSelectElement | null)?.value ?? "";
    const calibrateTo = mode === "sentences" && calibrateRaw ? parseInt(calibrateRaw, 10) : NaN;

    segEl.innerHTML = `<p class="empty-hint">Calcul en cours&#8230;</p>`;
    if (statsEl) statsEl.textContent = "&#8230;";
    if (segColTitle) {
      segColTitle.textContent = mode === "markers"
        ? `Balises [N] (&#8212; segments)`
        : `Segment&#233; (&#8212; phrases)`;
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
      const res = await segmentPreview(conn, previewPayload);
      if (segCountEl) segCountEl.textContent = String(res.units_output);
      const calibrateText = mode === "sentences" &&
        Number.isInteger(res.calibrate_to) && Number.isInteger(res.calibrate_ratio_pct)
        ? ` · &#233;cart ${res.calibrate_ratio_pct}% vs doc #${res.calibrate_to}`
        : "";
      if (statsEl) {
        statsEl.innerHTML = mode === "markers"
          ? `${res.units_input} u. &#8594; ${res.units_output} segments par balise`
          : `${res.units_input} u. &#8594; ${res.units_output} phrases · r&#233;glage ${res.segment_pack}${calibrateText}`;
      }
      if (segColTitle) {
        segColTitle.innerHTML = mode === "markers"
          ? `Balises [N] (<span id="act-seg-prev-seg-count">${res.units_output}</span> segments)`
          : `Segment&#233; (<span id="act-seg-prev-seg-count">${res.units_output}</span> phrases)`;
      }

      const truncNote = res.units_output >= 300
        ? `<p class="prep-seg-trunc-note">Aper&#231;u tronqu&#233; &#224; 300 segments</p>`
        : "";

      segEl.innerHTML = truncNote + (res.segments.length
        ? res.segments.map(s => {
            const hasId = s.external_id != null;
            return `<div class="prep-seg-prev-row${hasId ? " prep-seg-prev-row-marker" : ""}" data-source-unit="${s.source_unit_n ?? ""}">` +
              `<span class="prep-seg-prev-n">${hasId ? `[${s.external_id}]` : s.n}</span>` +
              `<span class="prep-seg-prev-tx">${_escHtml(s.text)}</span></div>`;
          }).join("")
        : `<p class="empty-hint">Aucun segment produit.</p>`);

      if (warnsEl) {
        if (res.warnings.length) {
          warnsEl.style.display = "";
          warnsEl.innerHTML = res.warnings.map(w => `<div class="prep-seg-warn">${_escHtml(w)}</div>`).join("");
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

  // ─── Marker detection ─────────────────────────────────────────────────────

  private async _runDetectMarkers(docId: number, silent = false): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const bannerEl = this._q<HTMLElement>("#act-seg-marker-banner");
    const detectBtn = this._q<HTMLButtonElement>("#act-seg-detect-btn");

    if (!silent && detectBtn) {
      detectBtn.disabled = true;
      detectBtn.textContent = "D\u00e9tection\u2026";
    }

    try {
      const report = await detectMarkers(conn, docId);
      this._segMarkersDetected = report;

      if (!bannerEl) return;

      if (report.detected) {
        const sample = report.first_markers.slice(0, 5).join(", ");
        bannerEl.style.display = "";
        bannerEl.innerHTML = `
          <span class="prep-seg-marker-icon">&#127991;</span>
          <span class="prep-seg-marker-info">
            <strong>Balises [N] d&#233;tect&#233;es</strong> &#8212;
            ${report.marked_units}/${report.total_units} unit&#233;s marqu&#233;es
            (ex.&nbsp;: [${sample}])
          </span>
          <button type="button" class="btn btn-sm ${this._segSplitMode === "markers" ? "prep-btn-warning" : "btn-outline-warning"}"
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
          <span class="prep-seg-marker-icon prep-seg-marker-icon-miss">&#8416;</span>
          <span class="prep-seg-marker-info">Aucune balise <code>[N]</code> d&#233;tect&#233;e dans ce document
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

  private _switchContentPane(pane: "preview" | "saved" | "diff" | "structure", docId?: number): void {
    const previewPane   = this._q<HTMLElement>("#act-seg-pane-preview");
    const savedPane     = this._q<HTMLElement>("#act-seg-pane-saved");
    const diffPane      = this._q<HTMLElement>("#act-seg-pane-diff");
    const structurePane = this._q<HTMLElement>("#act-seg-pane-structure");
    const refreshBtn    = this._q<HTMLElement>("#act-seg-prev-refresh");
    const statsEl       = this._q<HTMLElement>("#act-seg-prev-stats");
    if (!previewPane || !savedPane) return;
    previewPane.style.display   = pane === "preview"   ? "" : "none";
    savedPane.style.display     = pane === "saved"     ? "" : "none";
    if (diffPane)      diffPane.style.display      = pane === "diff"      ? "" : "none";
    if (structurePane) structurePane.style.display = pane === "structure" ? "" : "none";
    if (refreshBtn) refreshBtn.style.display = pane === "preview" ? "" : "none";
    if (statsEl)    statsEl.style.display    = pane === "preview" ? "" : "none";
    this._root?.querySelectorAll<HTMLButtonElement>(".prep-seg-content-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.pane === pane);
    });
    if (pane === "diff" && docId != null) void this._renderSegDiff(docId);
    if (pane === "structure" && docId != null) void this._renderStructureDiff(docId);
  }

  private async _renderSegDiff(docId: number): Promise<void> {
    const diffEl = this._q<HTMLElement>("#act-seg-diff-content");
    if (!diffEl) return;
    const conn = this._getConn();
    if (!conn) { diffEl.innerHTML = `<p class="empty-hint">Non connecté.</p>`; return; }

    diffEl.innerHTML = `<p class="empty-hint">Calcul du diff&#8230;</p>`;
    try {
      const [savedRes, previewRes] = await Promise.all([
        getDocumentPreview(conn, docId, 2000),
        segmentPreview(conn, {
          doc_id: docId,
          mode: this._segSplitMode,
          lang: (this._q<HTMLInputElement>("#act-seg-lang"))?.value.trim() || "fr",
          pack: (this._q<HTMLSelectElement>("#act-seg-pack"))?.value ?? "auto",
          limit: 2000,
        }),
      ]);

      const before = savedRes.lines.map(l => l.text ?? "");
      const after  = previewRes.segments.map(s => s.text ?? "");

      // LCS-based diff on text arrays
      const ops = _seqDiff(before, after);

      if (ops.every(o => o.op === "eq")) {
        diffEl.innerHTML = `<div class="prep-seg-diff-equal-note">&#10003; Aucune diff&#233;rence — la re-segmentation produirait les m&#234;mes ${before.length} segments.</div>`;
        return;
      }

      const beforeCount = ops.filter(o => o.op !== "ins").length;
      const afterCount  = ops.filter(o => o.op !== "del").length;
      const addedCount  = ops.filter(o => o.op === "ins").length;
      const removedCount = ops.filter(o => o.op === "del").length;

      diffEl.innerHTML = `
        <div class="prep-seg-diff-stats">
          <span>${beforeCount} segments avant</span>
          <span class="prep-seg-diff-arrow">&#8594;</span>
          <span>${afterCount} segments apr&#232;s</span>
          <span class="prep-seg-diff-added">+${addedCount} ajout&#233;(s)</span>
          <span class="prep-seg-diff-removed">&#8722;${removedCount} supprim&#233;(s)</span>
        </div>
        <div class="prep-seg-diff-list">
          ${ops.map((o, i) =>
            `<div class="prep-seg-diff-row prep-seg-diff-${o.op}" data-n="${i + 1}">` +
            `<span class="prep-seg-diff-marker">${o.op === "eq" ? "=" : o.op === "ins" ? "+" : "−"}</span>` +
            `<span class="prep-seg-diff-text">${_escHtml(o.text)}</span></div>`
          ).join("")}
        </div>
      `;
    } catch (err) {
      diffEl.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur diff : ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  private async _renderStructureDiff(docId: number): Promise<void> {
    const el = this._q<HTMLElement>("#act-seg-structure-content");
    if (!el) return;
    const conn = this._getConn();
    if (!conn) { el.innerHTML = `<p class="empty-hint">Non connecté.</p>`; return; }

    const calibrateRaw = (this._q("#act-seg-calibrate") as HTMLSelectElement | null)?.value ?? "";
    if (!calibrateRaw) {
      el.innerHTML = `<p class="empty-hint">S&#233;lectionnez un document de r&#233;f&#233;rence dans &#171;&#160;Calibrer sur&#160;&#187;.</p>`;
      return;
    }
    const refDocId = parseInt(calibrateRaw, 10);
    const docs = this._getDocs();
    const refDoc = docs.find(d => d.doc_id === refDocId);
    const curDoc = docs.find(d => d.doc_id === docId);

    el.innerHTML = `<p class="empty-hint">Analyse de la structure&#8230;</p>`;
    try {
      const res = await structureSections(conn, docId, refDocId);
      this._refSections = res.ref_sections;
      this._tgtSections = res.target_sections;

      if (res.ref_sections.length === 0 && res.target_sections.length === 0) {
        el.innerHTML = `<p class="empty-hint">Aucune unit&#233; de structure dans ces deux documents.</p>`;
        return;
      }

      // Init default positional pairs only on first load for this doc/ref pair
      if (!this._matcherInitialized || this._matcherDocId !== docId || this._matcherRefDocId !== refDocId) {
        const n = Math.min(this._refSections.length, this._tgtSections.length);
        this._structurePairs = Array.from({ length: n }, (_, i) => [i, i] as [number, number]);
        this._matcherPendingSide = null;
        this._matcherPendingIdx = null;
        this._matcherDocId = docId;
        this._matcherRefDocId = refDocId;
        this._matcherInitialized = true;
      }

      el.innerHTML = `
        <div class="prep-matcher-root">
          <div class="prep-matcher-toolbar">
            <span class="prep-matcher-hint" id="act-matcher-hint"></span>
            <button type="button" class="btn btn-ghost btn-sm" id="act-matcher-reset" title="Revenir à l'appariement positionnel par défaut">&#8635; Réinitialiser</button>
          </div>
          <div class="prep-matcher-cols">
            <div class="prep-matcher-col-head">
              <span class="prep-matcher-col-title">Référence — ${_escHtml(refDoc?.title ?? `#${refDocId}`)}</span>
              <span class="prep-matcher-col-count">${res.ref_sections.length} section${res.ref_sections.length !== 1 ? "s" : ""}</span>
            </div>
            <div class="prep-matcher-col-head">
              <span class="prep-matcher-col-title">Document courant — ${_escHtml(curDoc?.title ?? `#${docId}`)}</span>
              <span class="prep-matcher-col-count">${res.target_sections.length} section${res.target_sections.length !== 1 ? "s" : ""}</span>
            </div>
            <div class="prep-matcher-col" id="act-matcher-ref"></div>
            <div class="prep-matcher-col" id="act-matcher-tgt"></div>
          </div>
          <div id="act-matcher-undo-bar" class="prep-matcher-undo-bar" style="display:none"></div>
          <div class="prep-matcher-footer">
            <button type="button" class="btn btn-primary btn-sm" id="act-strucdiff-propagate-btn">
              &#9654; Aperçu propagé
            </button>
          </div>
          <div id="act-strucdiff-propagate-result"></div>
        </div>
      `;

      this._rebuildMatcherCards();

      el.querySelector("#act-matcher-reset")?.addEventListener("click", () => {
        const n = Math.min(this._refSections.length, this._tgtSections.length);
        this._structurePairs = Array.from({ length: n }, (_, i) => [i, i] as [number, number]);
        this._matcherPendingSide = null;
        this._matcherPendingIdx = null;
        this._matcherInitialized = true; // keep initialized so re-opening the tab preserves reset state
        this._rebuildMatcherCards();
      });

      el.querySelector("#act-strucdiff-propagate-btn")?.addEventListener("click", () => {
        void this._runPropagatePreview(docId, refDocId);
      });
    } catch (err) {
      el.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur structure : ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  private _pairColor(pairIdx: number): string {
    return `hsl(${Math.round((pairIdx * 137.508) % 360)}, 55%, 35%)`;
  }

  private _rebuildMatcherCards(): void {
    const refCol = this._q<HTMLElement>("#act-matcher-ref");
    const tgtCol = this._q<HTMLElement>("#act-matcher-tgt");
    const hintEl = this._q<HTMLElement>("#act-matcher-hint");
    if (!refCol || !tgtCol) return;

    const cardHtml = (side: "ref" | "tgt", idx: number, section: StructureSection): string => {
      const pairIdx = side === "ref"
        ? this._structurePairs.findIndex(p => p[0] === idx)
        : this._structurePairs.findIndex(p => p[1] === idx);
      const isPending = this._matcherPendingSide === side && this._matcherPendingIdx === idx;

      let badge: string;
      let stateClass: string;
      if (isPending) {
        badge = `<span class="prep-matcher-badge prep-matcher-badge--pending">&#9679;</span>`;
        stateClass = "prep-matcher-card--pending";
      } else if (pairIdx >= 0) {
        const color = this._pairColor(pairIdx);
        badge = `<span class="prep-matcher-badge prep-matcher-badge--linked" style="background:${color};color:#fff">${pairIdx + 1}</span>`;
        stateClass = "prep-matcher-card--linked";
      } else {
        badge = `<span class="prep-matcher-badge prep-matcher-badge--orphan">&#8212;</span>`;
        stateClass = "prep-matcher-card--orphan";
      }

      const insertBtn = side === "ref" && pairIdx < 0
        ? `<button type="button" class="prep-matcher-insert-btn btn btn-ghost btn-xs" data-insert-ref-idx="${idx}" title="Insérer cet intertitre dans le document cible">&#8853;</button>`
        : side === "tgt"
        ? `<button type="button" class="prep-matcher-insert-btn btn btn-ghost btn-xs" data-insert-tgt-idx="${idx}" title="Insérer un nouvel intertitre dans cette section">&#8853;</button>
           <button type="button" class="prep-matcher-delete-btn btn btn-ghost btn-xs" data-delete-tgt-n="${section.n}" title="Supprimer cet intertitre du document cible">&#10005;</button>`
        : "";
      return `<div class="prep-matcher-card ${stateClass}" data-side="${side}" data-idx="${idx}" data-unit-role="${_escHtml(section.role ?? "")}" role="button" tabindex="0" title="${_escHtml(section.text)}">
        ${badge}
        <span class="prep-matcher-card-text">${_escHtml(section.text || "—")}</span>
        <span class="prep-matcher-card-count">${section.line_count} l.</span>
        ${insertBtn}
      </div>`;
    };

    refCol.innerHTML = this._refSections.map((s, i) => cardHtml("ref", i, s)).join("");
    tgtCol.innerHTML = this._tgtSections.map((s, i) => cardHtml("tgt", i, s)).join("");

    if (hintEl) {
      if (this._matcherPendingSide !== null) {
        const pendingIsLinked = this._matcherPendingSide === "ref"
          ? this._structurePairs.some(p => p[0] === this._matcherPendingIdx)
          : this._structurePairs.some(p => p[1] === this._matcherPendingIdx);
        const otherSide = this._matcherPendingSide === "ref" ? "document courant" : "référence";
        if (pendingIsLinked) {
          hintEl.textContent = `Section sélectionnée — cliquez sur une section de la ${otherSide} pour re-lier, ou recliquez pour délier`;
        } else {
          hintEl.textContent = `Section sélectionnée — cliquez sur une section de la ${otherSide} pour apparier`;
        }
      } else {
        const orphanRef = this._refSections.filter((_, i) => !this._structurePairs.some(p => p[0] === i)).length;
        const orphanTgt = this._tgtSections.filter((_, i) => !this._structurePairs.some(p => p[1] === i)).length;
        const parts = [`${this._structurePairs.length} paire${this._structurePairs.length !== 1 ? "s" : ""}`];
        if (orphanRef > 0) parts.push(`${orphanRef} orphelin${orphanRef !== 1 ? "s" : ""} réf`);
        if (orphanTgt > 0) parts.push(`${orphanTgt} orphelin${orphanTgt !== 1 ? "s" : ""} cible`);
        hintEl.textContent = parts.join(" · ") + " — cliquez une section pour la sélectionner";
      }
    }

    [refCol, tgtCol].forEach(col => {
      col.querySelectorAll<HTMLElement>(".prep-matcher-card").forEach(card => {
        card.addEventListener("click", () => {
          const side = card.dataset.side as "ref" | "tgt";
          const idx = parseInt(card.dataset.idx ?? "0", 10);
          this._handleMatcherClick(side, idx);
        });
      });
    });

    // Bind insert buttons on orphan ref cards
    refCol.querySelectorAll<HTMLButtonElement>(".prep-matcher-insert-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rIdx = parseInt(btn.dataset.insertRefIdx ?? "0", 10);
        if (this._matcherDocId != null) {
          void this._openInsertZone({ side: "ref", idx: rIdx }, this._matcherDocId);
        }
      });
    });

    // Bind insert buttons on target cards
    tgtCol.querySelectorAll<HTMLButtonElement>(".prep-matcher-insert-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tIdx = parseInt(btn.dataset.insertTgtIdx ?? "0", 10);
        if (this._matcherDocId != null) {
          void this._openInsertZone({ side: "tgt", idx: tIdx }, this._matcherDocId);
        }
      });
    });

    // Bind delete buttons on target cards
    tgtCol.querySelectorAll<HTMLButtonElement>(".prep-matcher-delete-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const n = parseInt(btn.dataset.deleteTgtN ?? "0", 10);
        if (this._matcherDocId != null) {
          void this._deleteStructureUnit(this._matcherDocId, n, btn);
        }
      });
    });
  }

  private async _deleteStructureUnit(docId: number, n: number, triggerBtn: HTMLButtonElement): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const card = triggerBtn.closest<HTMLElement>(".prep-matcher-card");
    const label = card?.querySelector(".prep-matcher-card-text")?.textContent?.trim() ?? `n=${n}`;

    // Fetch role before deleting
    const roleAttr = card?.dataset.unitRole ?? null;

    try {
      await deleteStructureUnit(conn, docId, n);
      // Store for undo
      this._lastDeletedUnit = { docId, n, text: label, role: roleAttr };
      this._matcherInitialized = false;
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      await this._renderStructureDiff(docId);
      this._showUndoBanner(label);
    } catch (err) {
      this._cb.toast?.(`Erreur suppression : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private _showUndoBanner(label: string): void {
    const bar = this._q<HTMLElement>("#act-matcher-undo-bar");
    if (!bar) return;

    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }

    const DURATION = 8000;
    bar.style.display = "";
    bar.innerHTML = `
      <span class="prep-matcher-undo-msg">Intertitre &#171;&#160;${_escHtml(label)}&#160;&#187; supprimé</span>
      <span class="prep-matcher-undo-countdown" id="act-undo-countdown">8</span>
      <button type="button" class="btn btn-ghost btn-xs prep-matcher-undo-btn" id="act-matcher-undo-btn">&#8630; Annuler</button>
    `;

    // Countdown display
    let remaining = DURATION / 1000;
    const countEl = bar.querySelector<HTMLElement>("#act-undo-countdown");
    if (this._undoCountdownInterval) clearInterval(this._undoCountdownInterval);
    this._undoCountdownInterval = setInterval(() => {
      remaining -= 1;
      if (countEl) countEl.textContent = String(remaining);
      if (remaining <= 0) { clearInterval(this._undoCountdownInterval!); this._undoCountdownInterval = null; }
    }, 1000);

    bar.querySelector("#act-matcher-undo-btn")?.addEventListener("click", () => {
      if (this._undoCountdownInterval) { clearInterval(this._undoCountdownInterval); this._undoCountdownInterval = null; }
      this._clearUndoBanner();
      void this._undoDeleteStructure();
    });

    this._undoTimer = setTimeout(() => {
      if (this._undoCountdownInterval) { clearInterval(this._undoCountdownInterval); this._undoCountdownInterval = null; }
      this._clearUndoBanner();
      this._lastDeletedUnit = null;
    }, DURATION);
  }

  private _clearUndoBanner(): void {
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    const bar = this._q<HTMLElement>("#act-matcher-undo-bar");
    if (bar) { bar.style.display = "none"; bar.innerHTML = ""; }
  }

  private async _undoDeleteStructure(): Promise<void> {
    const saved = this._lastDeletedUnit;
    if (!saved) return;
    this._lastDeletedUnit = null;
    const conn = this._getConn();
    if (!conn) return;
    try {
      await insertStructureUnit(conn, saved.docId, saved.n, saved.text, saved.role ?? undefined);
      this._matcherInitialized = false;
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      await this._renderStructureDiff(saved.docId);
      this._cb.toast?.(`Intertitre « ${saved.text} » restauré.`);
    } catch (err) {
      this._cb.toast?.(`Erreur restauration : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private _handleMatcherClick(side: "ref" | "tgt", idx: number): void {
    const existingPairIdx = side === "ref"
      ? this._structurePairs.findIndex(p => p[0] === idx)
      : this._structurePairs.findIndex(p => p[1] === idx);
    const isLinked = existingPairIdx >= 0;
    const isPending = this._matcherPendingSide === side && this._matcherPendingIdx === idx;

    // Already pending (selected) → second click = deselect (and unlink if it was linked)
    if (isPending) {
      if (isLinked) this._structurePairs.splice(existingPairIdx, 1);
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      this._rebuildMatcherCards();
      return;
    }

    // Opposite side pending → create pair (first unlink both sides if already linked)
    if (this._matcherPendingSide !== null && this._matcherPendingSide !== side) {
      const refIdx = this._matcherPendingSide === "ref" ? this._matcherPendingIdx! : idx;
      const tgtIdx = this._matcherPendingSide === "tgt" ? this._matcherPendingIdx! : idx;
      // Remove any existing pair involving either side
      this._structurePairs = this._structurePairs.filter(
        p => p[0] !== refIdx && p[1] !== tgtIdx
      );
      this._structurePairs.push([refIdx, tgtIdx]);
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      this._rebuildMatcherCards();
      return;
    }

    // Same side pending → reselect to a different card on the same side
    if (this._matcherPendingSide === side) {
      this._matcherPendingIdx = idx;
      this._rebuildMatcherCards();
      return;
    }

    // No pending → select this card (linked or orphan)
    this._matcherPendingSide = side;
    this._matcherPendingIdx = idx;
    this._rebuildMatcherCards();
  }

  /** Open the insert modal for a ref orphan or a target section. */
  private async _openInsertZone(source: { side: "ref"; idx: number } | { side: "tgt"; idx: number }, docId: number): Promise<void> {
    if (!this._root) return;
    const conn = this._getConn();
    if (!conn) return;

    // Remove any existing modal first
    this._root.querySelector(".prep-insert-modal-backdrop")?.remove();

    let prefillText = "";
    let fromN: number | null = null;
    let toN: number | null = null;

    if (source.side === "ref") {
      // Orphan ref section: zone = target area around where this ref section should go
      const refSection = this._refSections[source.idx];
      if (!refSection) return;
      prefillText = refSection.text;
      const sortedPairs = [...this._structurePairs].sort((a, b) => a[0] - b[0]);
      const prevPair = [...sortedPairs].reverse().find(p => p[0] < source.idx);
      const nextPair = sortedPairs.find(p => p[0] > source.idx);
      fromN = prevPair != null ? this._tgtSections[prevPair[1]]?.n ?? null : null;
      toN = nextPair != null ? this._tgtSections[nextPair[1]]?.n ?? null : null;
    } else {
      // Target section: zone = lines within this target section
      const tgtSection = this._tgtSections[source.idx];
      if (!tgtSection) return;
      prefillText = "";
      fromN = tgtSection.n;
      toN = this._tgtSections[source.idx + 1]?.n ?? null;
    }

    const backdrop = document.createElement("div");
    backdrop.className = "prep-insert-modal-backdrop";
    backdrop.innerHTML = `
      <div class="prep-insert-modal" role="dialog" aria-modal="true">
        <div class="prep-insert-modal-header">
          <span class="prep-insert-modal-title">&#8853; Insérer un intertitre</span>
          <button type="button" class="btn btn-ghost btn-xs prep-insert-modal-close">&#10005;</button>
        </div>
        <div class="prep-insert-modal-body">
          <div class="prep-insert-modal-form">
            <label class="prep-matcher-insert-label">Texte de l'intertitre</label>
            <input type="text" class="prep-matcher-insert-text-input prep-insert-modal-text" value="${_escHtml(prefillText)}" placeholder="Saisir le texte de l'intertitre…" />
          </div>
          <div class="prep-matcher-insert-lines-label">Choisissez la ligne du document cible avant laquelle insérer :</div>
          <div class="prep-matcher-insert-lines prep-insert-modal-lines">
            <p class="empty-hint">Chargement&#8230;</p>
          </div>
        </div>
      </div>
    `;
    this._root.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector(".prep-insert-modal-close")?.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    const textInput = backdrop.querySelector<HTMLInputElement>(".prep-insert-modal-text");
    textInput?.focus();

    try {
      const res = await zoneLines(conn, docId, fromN, toN);
      const linesEl = backdrop.querySelector<HTMLElement>(".prep-insert-modal-lines");
      if (!linesEl) return;

      if (res.lines.length === 0) {
        // Zone vide — proposer d'insérer à la position calculée (après fromN, ou en début de doc)
        const insertN = fromN != null ? fromN + 1 : 1;
        linesEl.innerHTML = `
          <p class="empty-hint" style="margin-bottom:0.5rem">Aucune ligne dans cette zone.</p>
          <div class="prep-matcher-insert-line">
            <span class="prep-matcher-insert-line-n">${insertN}</span>
            <span class="prep-matcher-insert-line-text" style="font-style:italic">${fromN != null ? `après la position ${fromN}` : "début du document"}</span>
            <button type="button" class="btn btn-ghost btn-xs prep-matcher-insert-line-btn" data-before-n="${insertN}">Insérer ici</button>
          </div>`;
        linesEl.querySelectorAll<HTMLButtonElement>(".prep-matcher-insert-line-btn").forEach(btn => {
          btn.addEventListener("click", async () => {
            const beforeN = parseInt(btn.dataset.beforeN ?? "0", 10);
            const text = textInput?.value.trim() ?? prefillText;
            if (!text) return;
            close();
            await this._executeInsertStructure(docId, beforeN, text);
          });
        });
        return;
      }

      linesEl.innerHTML = res.lines.map(line => `
        <div class="prep-matcher-insert-line" data-line-n="${line.n}">
          <span class="prep-matcher-insert-line-n">${line.n}</span>
          <span class="prep-matcher-insert-line-text">${_escHtml(line.text)}</span>
          <button type="button" class="btn btn-ghost btn-xs prep-matcher-insert-line-btn" data-before-n="${line.n}">Insérer avant</button>
        </div>
      `).join("");

      linesEl.querySelectorAll<HTMLButtonElement>(".prep-matcher-insert-line-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const beforeN = parseInt(btn.dataset.beforeN ?? "0", 10);
          const text = textInput?.value.trim() ?? prefillText;
          if (!text) return;
          close();
          await this._executeInsertStructure(docId, beforeN, text);
        });
      });
    } catch (err) {
      const linesEl = backdrop.querySelector<HTMLElement>(".prep-insert-modal-lines");
      if (linesEl) linesEl.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur : ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  /** Insert a structure unit in the DB and reload the matcher. */
  private async _executeInsertStructure(docId: number, beforeN: number, text: string): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;

    try {
      await insertStructureUnit(conn, docId, beforeN, text);
      this._cb.toast?.(`Intertitre « ${text} » inséré avant la ligne ${beforeN}.`);
      // Reset matcher state and reload
      this._matcherInitialized = false;
      this._matcherPendingSide = null;
      this._matcherPendingIdx = null;
      await this._renderStructureDiff(docId);
    } catch (err) {
      this._cb.toast?.(`Erreur insertion : ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private async _runPropagatePreview(docId: number, refDocId: number): Promise<void> {
    const resultEl = this._q<HTMLElement>("#act-strucdiff-propagate-result");
    const btn = this._q<HTMLButtonElement>("#act-strucdiff-propagate-btn");
    if (!resultEl) return;
    const conn = this._getConn();
    if (!conn) return;

    const lang = (this._q("#act-seg-lang") as HTMLInputElement | null)?.value.trim() || "fr";
    const pack = (this._q("#act-seg-pack") as HTMLSelectElement | null)?.value ?? "auto";

    if (btn) { btn.disabled = true; btn.textContent = "Calcul…"; }
    resultEl.innerHTML = `<p class="empty-hint">Segmentation propagée en cours&#8230;</p>`;

    try {
      const mapping = this._structurePairs.length > 0 ? this._structurePairs : undefined;
      const res = await segmentPropagatePreview(conn, { doc_id: docId, reference_doc_id: refDocId, lang, pack, section_mapping: mapping });

      // Build live editable state
      this._propagateLiveSections = res.sections.map(s => ({
        status: s.status,
        header_text: s.header_text,
        header_role: s.header_role,
        ref_count: s.ref_count,
        original_count: s.segments.length,
        adjusted: s.adjusted,
        segments: s.segments.map(seg => seg.text),
      }));

      const warns = res.warnings.length
        ? `<div class="prep-seg-warn-list">${res.warnings.map(w => `<div class="prep-seg-warn">${_escHtml(w)}</div>`).join("")}</div>`
        : "";

      resultEl.innerHTML = `
        <div class="prep-propagate-result-header">
          <span class="prep-propagate-result-title">Aperçu propagé — <span data-propagate-total>${res.total_segments} phrases</span> · pack ${res.segment_pack}</span>
          <button type="button" class="btn prep-btn-warning btn-sm" id="act-propagate-apply-btn">
            Appliquer cette segmentation
          </button>
        </div>
        ${warns}
        <div class="prep-propagate-sections">
          ${res.sections.map((s, i) => {
            const headerLabel = s.header_text != null ? _escHtml(s.header_text) : `<em>avant premier intertitre</em>`;
            const missingBadge = s.status === "missing_in_target"
              ? `<span class="prep-strucdiff-badge prep-strucdiff-missing">&#9888; manquant dans cible</span>` : "";
            return `
              <details class="prep-propagate-section" open data-sec-idx="${i}">
                <summary class="prep-propagate-section-head">
                  <span class="prep-propagate-section-label">${headerLabel}</span>
                  <span class="prep-propagate-section-count" data-count-sec="${i}"></span>
                  ${missingBadge}
                </summary>
                <div class="prep-propagate-section-body" data-sec-body="${i}"></div>
              </details>`;
          }).join("")}
        </div>
      `;

      // Render each section body with interactive edit controls
      res.sections.forEach((_, i) => {
        this._rebuildPropagateSectionBody(i);
        this._updateSectionCount(i);
      });

      resultEl.querySelector("#act-propagate-apply-btn")?.addEventListener("click", () => {
        void this._applyPropagateResult(res);
      });

    } catch (err) {
      resultEl.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur : ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = "&#9654; Aperçu propagé"; }
    }
  }

  private _rebuildPropagateSectionBody(secIdx: number): void {
    const bodyEl = this._q<HTMLElement>(`[data-sec-body="${secIdx}"]`);
    if (!bodyEl) return;
    const sec = this._propagateLiveSections[secIdx];
    if (!sec) return;

    if (sec.segments.length === 0) {
      bodyEl.innerHTML = `<div class="prep-propagate-seg-empty">Aucun segment (section manquante dans la cible).</div>`;
      return;
    }

    bodyEl.innerHTML = sec.segments.flatMap((text, segIdx) => {
      const segRow = `
        <div class="prep-propagate-seg-row" data-sec-idx="${secIdx}" data-seg-idx="${segIdx}">
          <span class="prep-propagate-seg-n">${segIdx + 1}</span>
          <span class="prep-propagate-seg-text" title="Double-cliquez pour modifier">${_escHtml(text)}</span>
          <div class="prep-propagate-seg-actions">
            <button type="button" class="btn btn-ghost btn-xs prep-propagate-split-btn" title="Couper ce segment">&#247;</button>
          </div>
        </div>`;
      const mergeRow = segIdx < sec.segments.length - 1 ? `
        <div class="prep-propagate-merge-row" data-sec-idx="${secIdx}" data-before-seg-idx="${segIdx}">
          <button type="button" class="prep-propagate-merge-btn" title="Fusionner avec le segment suivant">&#8627; fusionner</button>
        </div>` : "";
      return [segRow, mergeRow];
    }).join("");

    bodyEl.querySelectorAll<HTMLElement>(".prep-propagate-seg-text").forEach(el => {
      el.addEventListener("dblclick", () => {
        const row = el.closest<HTMLElement>(".prep-propagate-seg-row");
        if (!row) return;
        this._startSegmentEdit(
          parseInt(row.dataset.secIdx ?? "0", 10),
          parseInt(row.dataset.segIdx ?? "0", 10),
        );
      });
    });

    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-propagate-split-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const row = btn.closest<HTMLElement>(".prep-propagate-seg-row");
        if (!row) return;
        this._startSegmentSplit(
          parseInt(row.dataset.secIdx ?? "0", 10),
          parseInt(row.dataset.segIdx ?? "0", 10),
        );
      });
    });

    bodyEl.querySelectorAll<HTMLButtonElement>(".prep-propagate-merge-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const mrow = btn.closest<HTMLElement>(".prep-propagate-merge-row");
        if (!mrow) return;
        this._mergeSegments(
          parseInt(mrow.dataset.secIdx ?? "0", 10),
          parseInt(mrow.dataset.beforeSegIdx ?? "0", 10),
        );
      });
    });
  }

  private _startSegmentEdit(secIdx: number, segIdx: number): void {
    const bodyEl = this._q<HTMLElement>(`[data-sec-body="${secIdx}"]`);
    if (!bodyEl) return;
    const text = this._propagateLiveSections[secIdx]?.segments[segIdx] ?? "";
    const row = bodyEl.querySelector<HTMLElement>(
      `.prep-propagate-seg-row[data-sec-idx="${secIdx}"][data-seg-idx="${segIdx}"]`,
    );
    if (!row) return;

    const editDiv = document.createElement("div");
    editDiv.className = "prep-propagate-edit-row";
    editDiv.innerHTML = `
      <textarea class="prep-propagate-edit-area" rows="2">${_escHtml(text)}</textarea>
      <div class="prep-propagate-edit-actions">
        <button type="button" class="btn btn-primary btn-xs prep-propagate-edit-ok">&#10003; Valider</button>
        <button type="button" class="btn btn-ghost btn-xs prep-propagate-edit-cancel">&#10005; Annuler</button>
      </div>`;
    row.replaceWith(editDiv);

    const ta = editDiv.querySelector<HTMLTextAreaElement>("textarea");
    ta?.focus();

    const commit = () => {
      const val = ta?.value.trim() ?? "";
      if (!val) {
        if (ta) ta.style.borderColor = "var(--color-danger, #dc2626)";
        return;
      }
      this._propagateLiveSections[secIdx].segments[segIdx] = val;
      this._rebuildPropagateSectionBody(secIdx);
      this._updateSectionCount(secIdx);
    };
    editDiv.querySelector(".prep-propagate-edit-ok")?.addEventListener("click", commit);
    editDiv.querySelector(".prep-propagate-edit-cancel")?.addEventListener("click", () => {
      this._rebuildPropagateSectionBody(secIdx);
    });
    ta?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === "Escape") this._rebuildPropagateSectionBody(secIdx);
    });
  }

  private _startSegmentSplit(secIdx: number, segIdx: number): void {
    const bodyEl = this._q<HTMLElement>(`[data-sec-body="${secIdx}"]`);
    if (!bodyEl) return;
    const text = this._propagateLiveSections[secIdx]?.segments[segIdx] ?? "";
    const row = bodyEl.querySelector<HTMLElement>(
      `.prep-propagate-seg-row[data-sec-idx="${secIdx}"][data-seg-idx="${segIdx}"]`,
    );
    if (!row) return;

    const [partA, partB] = _splitAtMidpoint(text);
    const splitDiv = document.createElement("div");
    splitDiv.className = "prep-propagate-split-row";
    splitDiv.innerHTML = `
      <div class="prep-propagate-split-halves">
        <textarea class="prep-propagate-edit-area prep-propagate-split-a" rows="2">${_escHtml(partA)}</textarea>
        <div class="prep-propagate-split-sep">&#8213; coupure &#8213;</div>
        <textarea class="prep-propagate-edit-area prep-propagate-split-b" rows="2">${_escHtml(partB)}</textarea>
      </div>
      <div class="prep-propagate-edit-actions">
        <button type="button" class="btn btn-primary btn-xs prep-propagate-split-ok">&#247; Couper</button>
        <button type="button" class="btn btn-ghost btn-xs prep-propagate-split-cancel">&#10005; Annuler</button>
      </div>`;
    row.replaceWith(splitDiv);

    splitDiv.querySelector<HTMLTextAreaElement>(".prep-propagate-split-a")?.focus();

    splitDiv.querySelector(".prep-propagate-split-ok")?.addEventListener("click", () => {
      const a = splitDiv.querySelector<HTMLTextAreaElement>(".prep-propagate-split-a")?.value.trim() ?? "";
      const b = splitDiv.querySelector<HTMLTextAreaElement>(".prep-propagate-split-b")?.value.trim() ?? "";
      const parts = [a, b].filter(s => s.length > 0);
      if (parts.length > 0) {
        this._propagateLiveSections[secIdx].segments.splice(segIdx, 1, ...parts);
      }
      this._rebuildPropagateSectionBody(secIdx);
      this._updateSectionCount(secIdx);
    });
    splitDiv.querySelector(".prep-propagate-split-cancel")?.addEventListener("click", () => {
      this._rebuildPropagateSectionBody(secIdx);
    });
  }

  private _mergeSegments(secIdx: number, beforeSegIdx: number): void {
    const segs = this._propagateLiveSections[secIdx]?.segments;
    if (!segs || beforeSegIdx + 1 >= segs.length) return;
    const merged = (segs[beforeSegIdx] + " " + segs[beforeSegIdx + 1]).replace(/\s+/g, " ").trim();
    segs.splice(beforeSegIdx, 2, merged);
    this._rebuildPropagateSectionBody(secIdx);
    this._updateSectionCount(secIdx);
  }

  private _updateSectionCount(secIdx: number): void {
    const el = this._q<HTMLElement>(`[data-count-sec="${secIdx}"]`);
    if (!el) return;
    const sec = this._propagateLiveSections[secIdx];
    if (!sec) return;
    const count = sec.segments.length;
    const delta = count - sec.ref_count;
    const deltaSign = delta > 0 ? "+" : "";
    const deltaAbs = Math.abs(delta);
    const deltaRatio = sec.ref_count > 0 ? deltaAbs / sec.ref_count : 0;
    const deltaClass = deltaAbs === 0 ? "prep-strucdiff-delta-ok"
      : deltaRatio > 0.15 ? "prep-strucdiff-delta-warn"
      : "prep-strucdiff-delta-ok";
    const deltaBadge = sec.ref_count > 0
      ? `<span class="prep-strucdiff-delta ${deltaClass}">${deltaSign}${delta}</span>`
      : "";
    const isEdited = count !== sec.original_count;
    const badge = isEdited
      ? `<span class="prep-propagate-adj-badge prep-propagate-edited-badge">édité</span>`
      : sec.adjusted ? `<span class="prep-propagate-adj-badge">ajusté</span>` : "";
    el.innerHTML = sec.ref_count > 0
      ? `${count} phrases <span class="prep-strucdiff-count-ref">(réf: ${sec.ref_count})</span> ${deltaBadge} ${badge}`
      : `${count} phrases ${badge}`;

    // Update global total
    const total = this._propagateLiveSections.reduce((sum, s) => sum + s.segments.length, 0);
    const totalEl = this._q<HTMLElement>("[data-propagate-total]");
    if (totalEl) totalEl.textContent = `${total} phrases`;
  }

  private async _applyPropagateResult(res: import("../lib/sidecarClient.ts").PropagatePreviewResponse): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const docId = res.doc_id;

    if (this._propagateLiveSections.length === 0) {
      this._cb.toast?.("Aucune section à appliquer.", true);
      return;
    }

    // Build flat ordered unit list from the editable state
    const units: import("../lib/sidecarClient.ts").ApplyPropagatedUnit[] = [];
    for (const sec of this._propagateLiveSections) {
      // Include structure unit for matched/extra sections (pre and missing_in_target have none)
      if (sec.status !== "pre" && sec.status !== "missing_in_target" && sec.header_text) {
        units.push({
          type: "structure",
          text: sec.header_text,
          ...(sec.header_role ? { role: sec.header_role } : {}),
        });
      }
      for (const text of sec.segments) {
        if (text.trim()) units.push({ type: "line", text });
      }
    }

    if (units.length === 0) {
      this._cb.toast?.("Aucune unité à écrire.", true);
      return;
    }

    const applyBtn = this._q<HTMLButtonElement>("#act-propagate-apply-btn");
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = "Application…"; }

    try {
      const result = await applyPropagated(conn, docId, units);
      this._lastSegmentReport = { doc_id: docId, units_input: 0, units_output: result.units_written };
      this._segmentPendingValidation = true;
      this._refreshSegmentationStatusUI();
      this._cb.toast?.(`Segmentation propagée appliquée — ${result.units_written} unités écrites.`);
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.innerHTML = "&#10003; Réappliquer";
      }
    } catch (e) {
      this._cb.toast?.(`Erreur : ${e instanceof Error ? e.message : String(e)}`, true);
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = "Appliquer cette segmentation"; }
    }
  }

  private _activateMarkersMode(docId: number): void {
    this._segSplitMode = "markers";
    const badge = this._q<HTMLElement>("#act-seg-mode-badge");
    if (badge) badge.textContent = "balises [N]";
    void this._runDetectMarkers(docId, /* silent */ true);
    const phrasesParams = this._q<HTMLElement>("#act-seg-params-phrases");
    const markersParams = this._q<HTMLElement>("#act-seg-params-markers");
    if (phrasesParams) phrasesParams.style.display = "none";
    if (markersParams) markersParams.style.display = "contents";
    this._syncSegStrategyRadios();
    this._switchContentPane("preview");
    void this._runSegPreview(docId);
  }

  private _deactivateMarkersMode(docId: number): void {
    this._segSplitMode = "sentences";
    const badge = this._q<HTMLElement>("#act-seg-mode-badge");
    if (badge) badge.textContent = "phrases";
    void this._runDetectMarkers(docId, /* silent */ true);
    const phrasesParams = this._q<HTMLElement>("#act-seg-params-phrases");
    const markersParams = this._q<HTMLElement>("#act-seg-params-markers");
    if (phrasesParams) phrasesParams.style.display = "contents";
    if (markersParams) markersParams.style.display = "none";
    this._syncSegStrategyRadios();
    this._switchContentPane("preview");
    void this._runSegPreview(docId);
  }

  // ─── Saved segments table ─────────────────────────────────────────────────

  private async _renderSegSavedTable(docId: number, el: HTMLElement, scrollToN?: number): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    el.innerHTML = `<p class="empty-hint">Chargement&#8230;</p>`;
    try {
      const preview = await getDocumentPreview(conn, docId, 500);
      const countEl = this._q<HTMLElement>("#act-seg-saved-count");
      if (countEl) countEl.textContent = String(preview.total_lines);
      if (!preview.lines.length) {
        el.innerHTML = `<p class="empty-hint">Aucun segment en base.</p>`;
        return;
      }

      const truncNote = preview.total_lines > 500
        ? `<p class="prep-seg-trunc-note">Aper&#231;u &#8212; 500/${preview.total_lines} segments</p>`
        : "";

      // Language-aware detection of orphaned closing punctuation at line start —
      // typical artefact of bad numbered-line imports where a closing mark gets
      // left on the next line. German tolerates »...« reversed convention so we
      // also flag « ‹ › for de-* documents.
      const docLang = (this._getDocs().find(d => d.doc_id === docId)?.language ?? "").toLowerCase();
      const orphanChars = docLang.startsWith("de") ? "»«‹›)\\]}”’" : "»)\\]}”’";
      const orphanRegex = new RegExp(`^\\s*[${orphanChars}]+`);

      const buildRow = (l: { n: number; text: string; text_raw?: string | null; unit_role?: string | null }, idx: number, total: number): string => {
        const lenClass = l.text.length > 200 ? " prep-seg-cell-len-warn" : l.text.length > 120 ? " prep-seg-cell-len-hint" : "";
        const mergeUpBtn   = idx > 0
          ? `<button class="prep-seg-action-btn prep-seg-merge-up"   title="Fusionner avec le pr&#233;c&#233;dent" data-n="${l.n}">&#8679;</button>`
          : `<span class="prep-seg-action-placeholder"></span>`;
        const mergeDownBtn = idx < total - 1
          ? `<button class="prep-seg-action-btn prep-seg-merge-down" title="Fusionner avec le suivant"     data-n="${l.n}">&#8681;</button>`
          : `<span class="prep-seg-action-placeholder"></span>`;
        const splitBtn = `<button class="prep-seg-action-btn prep-seg-split-btn" title="Couper ce segment" data-n="${l.n}">&#9986;</button>`;
        const orphanAttr = orphanRegex.test(l.text) ? ` data-orphan="1"` : "";
        return `<tr data-unit-n="${l.n}" data-len="${l.text.length}"${orphanAttr}>
          <td class="prep-seg-cell-n">${l.n}</td>
          <td class="prep-seg-cell-text">${_roleBadgeHtml(l.unit_role, this._conventions)}${richTextToHtml(l.text_raw, l.text)}</td>
          <td class="prep-seg-cell-len${lenClass}">${l.text.length}</td>
          <td class="prep-seg-cell-actions">${mergeUpBtn}${mergeDownBtn}${splitBtn}</td>
        </tr>`;
      };

      const renderTable = (lines: { n: number; text: string }[]) => {
        const shortCount = lines.filter(l => l.text.length <= 5).length;
        const orphanCount = lines.filter(l => orphanRegex.test(l.text)).length;
        const rows = lines.map((l, i) => buildRow(l, i, lines.length)).join("");
        return truncNote + `
          <div class="prep-seg-saved-info">
            <span>${lines.length} segment(s)</span>
            <label class="prep-seg-short-filter-label" title="Afficher les segments de 5 caract&#232;res ou moins, avec leurs voisins imm&#233;diats pour faciliter la fusion">
              <input type="checkbox" id="act-seg-filter-short" class="prep-seg-short-filter-cb" />
              Segments courts
              <span class="chip prep-seg-short-chip" title="${shortCount} segment(s) courts">${shortCount}</span>
            </label>
            <label class="prep-seg-short-filter-label" title="Afficher les lignes commen&#231;ant par une ponctuation fermante orpheline (signe de mauvais d&#233;coupage), avec leurs voisins">
              <input type="checkbox" id="act-seg-filter-orphan" class="prep-seg-orphan-filter-cb" />
              Ponctuation orpheline
              <span class="chip prep-seg-orphan-chip" title="${orphanCount} ligne(s) suspecte(s)">${orphanCount}</span>
            </label>
          </div>
          <div class="prep-seg-segments-scroll">
            <table class="prep-seg-segments-table">
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

      let lines = preview.lines.map(l => ({ n: l.n, text: l.text, text_raw: l.text_raw, unit_role: l.unit_role }));
      el.innerHTML = renderTable(lines);

      const reload = (targetN?: number) => void this._renderSegSavedTable(docId, el, targetN);

      const wireEvents = () => {
        // ── Merge up (↑) ────────────────────────────────────────────────────
        el.querySelectorAll<HTMLButtonElement>(".prep-seg-merge-up").forEach(btn => {
          btn.addEventListener("click", async () => {
            const n2 = parseInt(btn.dataset.n ?? "", 10);
            const idx = lines.findIndex(l => l.n === n2);
            if (idx < 1) return;
            const conn2 = this._getConn();
            if (!conn2) return;
            const n1 = lines[idx - 1].n;
            btn.disabled = true;
            try {
              await mergeUnits(conn2, { doc_id: docId, n1, n2 });
              reload(n1);
            } catch (e) {
              btn.disabled = false;
              alert(`Erreur fusion : ${e instanceof Error ? e.message : String(e)}`);
            }
          });
        });

        // ── Merge down (↓) ──────────────────────────────────────────────────
        el.querySelectorAll<HTMLButtonElement>(".prep-seg-merge-down").forEach(btn => {
          btn.addEventListener("click", async () => {
            const n1 = parseInt(btn.dataset.n ?? "", 10);
            const idx = lines.findIndex(l => l.n === n1);
            if (idx < 0 || idx >= lines.length - 1) return;
            const conn2 = this._getConn();
            if (!conn2) return;
            const n2 = lines[idx + 1].n;
            btn.disabled = true;
            try {
              await mergeUnits(conn2, { doc_id: docId, n1, n2 });
              reload(n1);
            } catch (e) {
              btn.disabled = false;
              alert(`Erreur fusion : ${e instanceof Error ? e.message : String(e)}`);
            }
          });
        });

        // ── Split (✂) ───────────────────────────────────────────────────────
        el.querySelectorAll<HTMLButtonElement>(".prep-seg-split-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            const unitN = parseInt(btn.dataset.n ?? "", 10);
            const lineData = lines.find(l => l.n === unitN);
            if (!lineData) return;
            const tr = btn.closest("tr")!;
            const fullText = lineData.text;
            const midPoint = Math.ceil(fullText.length / 2);
            const lastSpace = fullText.lastIndexOf(" ", midPoint);
            const splitAt = lastSpace > 0 ? lastSpace : midPoint;

            tr.innerHTML = `
              <td colspan="4" class="prep-seg-split-inline">
                <div class="prep-seg-split-label">&#9986; Couper le segment ${unitN} en deux&#160;:</div>
                <div class="prep-seg-split-fields">
                  <textarea class="prep-seg-split-ta seg-split-ta-a" rows="2">${_escHtml(fullText.slice(0, splitAt).trim())}</textarea>
                  <div class="prep-seg-split-divider">&#9660;</div>
                  <textarea class="prep-seg-split-ta seg-split-ta-b" rows="2">${_escHtml(fullText.slice(splitAt).trim())}</textarea>
                </div>
                <div class="prep-seg-split-actions">
                  <button class="btn prep-btn-warning btn-sm seg-split-confirm">Confirmer la coupure</button>
                  <button class="btn btn-ghost btn-sm seg-split-cancel">Annuler</button>
                </div>
              </td>`;

            tr.querySelector(".seg-split-cancel")?.addEventListener("click", () => reload());
            tr.querySelector(".seg-split-confirm")?.addEventListener("click", async () => {
              const taA = tr.querySelector<HTMLTextAreaElement>(".seg-split-ta-a");
              const taB = tr.querySelector<HTMLTextAreaElement>(".seg-split-ta-b");
              const textA = taA?.value.trim() ?? "";
              const textB = taB?.value.trim() ?? "";
              if (!textA || !textB) {
                alert("Les deux parties doivent \u00eatre non-vides.");
                return;
              }
              const conn2 = this._getConn();
              if (!conn2) return;
              try {
                await splitUnit(conn2, { doc_id: docId, unit_n: unitN, text_a: textA, text_b: textB });
                reload(unitN);
              } catch (e) {
                alert(`Erreur d\u00e9coupe : ${e instanceof Error ? e.message : String(e)}`);
              }
            });
          });
        });

      };

      wireEvents();

      // ── Anomaly filters (short segments + orphan punctuation) ──────────────
      // Each active filter targets matching rows; their immediate neighbors are
      // kept as context so the user can decide whether to merge. When both
      // filters are on, the displayed set is the union of their targets+context.
      const applyFilters = () => {
        const rows = Array.from(el.querySelectorAll<HTMLElement>("tr[data-len]"));
        const shortActive = this._segShortFilter;
        const orphanActive = this._segOrphanFilter;
        if (!shortActive && !orphanActive) {
          rows.forEach(tr => {
            tr.style.display = "";
            tr.classList.remove("prep-seg-row-short", "prep-seg-row-orphan", "prep-seg-row-context");
          });
          return;
        }
        const lens = rows.map(tr => parseInt(tr.dataset.len ?? "999", 10));
        const orphans = rows.map(tr => tr.dataset.orphan === "1");
        const isShort = new Set<number>();
        const isOrphan = new Set<number>();
        const keep = new Set<number>();
        for (let i = 0; i < rows.length; i++) {
          let target = false;
          if (shortActive && lens[i] <= 5) { isShort.add(i); target = true; }
          if (orphanActive && orphans[i]) { isOrphan.add(i); target = true; }
          if (target) {
            keep.add(i);
            if (i > 0) keep.add(i - 1);
            if (i < rows.length - 1) keep.add(i + 1);
          }
        }
        rows.forEach((tr, i) => {
          tr.style.display = keep.has(i) ? "" : "none";
          // Orphan styling wins over short when a row matches both — orphans are
          // genuine segmentation errors, shorts may be legitimate.
          tr.classList.toggle("prep-seg-row-orphan", isOrphan.has(i));
          tr.classList.toggle("prep-seg-row-short", isShort.has(i) && !isOrphan.has(i));
          tr.classList.toggle("prep-seg-row-context", keep.has(i) && !isShort.has(i) && !isOrphan.has(i));
        });
      };
      const shortCb = el.querySelector<HTMLInputElement>("#act-seg-filter-short");
      if (shortCb) {
        shortCb.checked = this._segShortFilter;
        shortCb.addEventListener("change", () => {
          this._segShortFilter = shortCb.checked;
          applyFilters();
        });
      }
      const orphanCb = el.querySelector<HTMLInputElement>("#act-seg-filter-orphan");
      if (orphanCb) {
        orphanCb.checked = this._segOrphanFilter;
        orphanCb.addEventListener("change", () => {
          this._segOrphanFilter = orphanCb.checked;
          applyFilters();
        });
      }
      if (this._segShortFilter || this._segOrphanFilter) applyFilters();

      if (scrollToN !== undefined) {
        const scrollEl = el.querySelector<HTMLElement>(".prep-seg-segments-scroll");
        const row = el.querySelector<HTMLElement>(`[data-unit-n="${scrollToN}"]`);
        if (scrollEl && row && row.style.display !== "none") {
          scrollEl.scrollTop = Math.max(0, row.offsetTop - scrollEl.clientHeight / 2);
          row.classList.add("prep-seg-row-flash");
          setTimeout(() => row.classList.remove("prep-seg-row-flash"), 800);
        }
      }
      lines = preview.lines.map(l => ({ n: l.n, text: l.text, text_raw: l.text_raw, unit_role: l.unit_role }));
    } catch (err) {
      el.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur: ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  // ─── Status UI ────────────────────────────────────────────────────────────

  private _refreshSegmentationStatusUI(): void {
    const banner = this._q<HTMLElement>("#act-seg-status-banner");
    const validateOnlyBtn = this._q<HTMLButtonElement>("#act-seg-validate-only-btn");
    if (!banner) return;

    const segSel = this._currentSegDocSelection();

    if (!this._getConn()) {
      banner.className = "prep-seg-status-banner prep-runtime-state prep-state-error";
      banner.textContent = "Sidecar indisponible.";
      if (validateOnlyBtn) validateOnlyBtn.disabled = true;
      return;
    }
    if (!segSel) {
      banner.className = "prep-seg-status-banner prep-runtime-state prep-state-info";
      banner.textContent = "S\u00e9lectionnez un document pour segmenter.";
      if (validateOnlyBtn) validateOnlyBtn.disabled = true;
      return;
    }

    if (this._lastSegmentReport && this._lastSegmentReport.doc_id === segSel.docId) {
      const warnings = this._lastSegmentReport.warnings ?? [];
      const pack = this._lastSegmentReport.segment_pack ?? "auto";
      if (this._segmentPendingValidation) {
        banner.className = "prep-seg-status-banner prep-runtime-state prep-state-warn";
        banner.textContent =
          `Segmentation pr\u00eate sur ${segSel.docLabel}: ${this._lastSegmentReport.units_input} \u2192 ${this._lastSegmentReport.units_output} unit\u00e9s (pack ${pack})${warnings.length ? ` \u00b7 avertissements: ${warnings.length}` : ""}. Validez le document.`;
      } else {
        banner.className = "prep-seg-status-banner prep-runtime-state prep-state-ok";
        banner.textContent =
          `Derni\u00e8re segmentation ${segSel.docLabel}: ${this._lastSegmentReport.units_input} \u2192 ${this._lastSegmentReport.units_output} unit\u00e9s (pack ${pack})${warnings.length ? ` \u00b7 avertissements: ${warnings.length}` : ""}.`;
      }
      if (validateOnlyBtn) validateOnlyBtn.disabled = !this._segmentPendingValidation;
      return;
    }

    banner.className = "prep-seg-status-banner prep-runtime-state prep-state-info";
    banner.textContent = `Aucune segmentation lanc\u00e9e sur ${segSel.docLabel} dans cette session.`;
    if (validateOnlyBtn) validateOnlyBtn.disabled = true;
  }

  private _currentSegDocSelection(): { docId: number; docLabel: string } | null {
    const docId = this._selectedSegDocId;
    if (docId === null || !Number.isInteger(docId)) return null;
    const doc = this._getDocs().find((d) => d.doc_id === docId);
    const docLabel = doc ? `"${doc.title}"` : `#${docId}`;
    return { docId, docLabel };
  }

  // ─── Run segmentation ─────────────────────────────────────────────────────

  private async _runSegment(validateAfter = false): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const segSel = this._currentSegDocSelection();
    if (!segSel) { this._cb.log("S\u00e9lectionnez un document.", true); return; }
    const docId = segSel.docId;
    const lang = (this._q("#act-seg-lang") as HTMLInputElement | null)?.value.trim() || "und";
    const pack = (this._q("#act-seg-pack") as HTMLSelectElement | null)?.value || "auto";
    const calibrateRaw = (this._q("#act-seg-calibrate") as HTMLSelectElement | null)?.value ?? "";
    const calibrateTo = calibrateRaw ? parseInt(calibrateRaw, 10) : undefined;
    const useMarkers = this._segSplitMode === "markers";
    const docLabel = segSel.docLabel;
    const postValidate = this._postValidateDestination();
    const postValidateLabel = postValidate === "next"
      ? "s\u00e9lectionnera le document suivant"
      : postValidate === "stay"
      ? "restera sur l'onglet Actions"
      : "basculera vers l'onglet Documents";

    const modeLabel = useMarkers ? "MODE BALISES [N]" : `Pack: ${pack}`;

    const confirmMsg = validateAfter
      ? `Segmenter puis valider « ${docLabel} » ? ${modeLabel} — efface les liens d'alignement existants.`
      : `Segmenter « ${docLabel} » ? ${modeLabel} — efface les liens d'alignement existants.`;
    const confirmEl = this._q<HTMLElement>("#act-seg-confirm-bar");
    if (confirmEl) {
      const ok = await inlineConfirm(confirmEl, confirmMsg, { confirmLabel: "Appliquer", danger: true });
      if (!ok) return;
    }

    this._cb.setBusy(true);
    try {
      const jobPayload: Record<string, unknown> = useMarkers
        ? { doc_id: docId, mode: "markers" }
        : { doc_id: docId, lang, pack };
      if (!useMarkers && calibrateTo) jobPayload.calibrate_to = calibrateTo;
      const job = await enqueueJob(conn, "segment", jobPayload);
      this._cb.log(`Job segmentation soumis pour ${docLabel} (${job.job_id.slice(0, 8)}\u2026)`);

      this._cb.jobCenter?.()?.trackJob(job.job_id, `Segmentation ${docLabel}`, (done) => {
        if (done.status === "done") {
          const r = done.result as {
            units_input?: number;
            units_output?: number;
            segment_pack?: string;
            warnings?: string[];
            fts_stale?: boolean;
            roles_reapplied?: number;
          } | undefined;
          this._lastSegmentReport = {
            doc_id: docId,
            units_input: Number(r?.units_input ?? 0),
            units_output: Number(r?.units_output ?? 0),
            segment_pack: r?.segment_pack,
            warnings: r?.warnings ?? [],
          };
          // Refresh saved segments table and raw column; enable & switch to saved tab
          const savedTableEl = this._q<HTMLElement>("#act-seg-saved-table");
          const savedCount   = this._q<HTMLElement>("#act-seg-saved-count");
          const savedTab     = this._q<HTMLButtonElement>('[data-pane="saved"]');
          if (savedCount) savedCount.textContent = String(this._lastSegmentReport?.units_output ?? "?");
          if (savedTab) { savedTab.disabled = false; savedTab.removeAttribute("title"); }
          if (savedTableEl) void this._renderSegSavedTable(docId, savedTableEl);
          this._switchContentPane("saved");
          void this._loadSegRawColumn(docId);
          void this._runSegPreview(docId);
          this._populateSegDocList(true);

          const warns = r?.warnings?.length ? ` Avertissements : ${r.warnings!.join("; ")}` : "";
          const usedPack = r?.segment_pack ? ` Pack=${r.segment_pack}.` : "";
          const rolesNote = r?.roles_reapplied ? ` ${r.roles_reapplied} r\u00f4le(s) de convention r\u00e9appliqu\u00e9(s).` : "";
          this._cb.log(`\u2713 Segmentation : ${r?.units_input ?? "?"} \u2192 ${r?.units_output ?? "?"} unit\u00e9s.${usedPack}${rolesNote}${warns}`);
          if (r?.fts_stale) this._cb.log("\u26a0 Index FTS p\u00e9rim\u00e9.");
          if (validateAfter) {
            this._segmentPendingValidation = true;
            this._refreshSegmentationStatusUI();
            void this._markSegmentedDocValidated(docId, docLabel);
          } else {
            this._segmentPendingValidation = true;
            this._refreshSegmentationStatusUI();
            this._cb.toast?.(`\u2713 Segmentation ${docLabel} termin\u00e9e`);
            this._cb.setBusy(false);
          }
        } else {
          this._cb.log(`\u2717 Segmentation : ${done.error ?? done.status}`, true);
          this._cb.toast?.("\u2717 Erreur segmentation", true);
          this._cb.setBusy(false);
        }
      });
    } catch (err) {
      this._cb.log(`\u2717 Segmentation : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._cb.setBusy(false);
    }
  }

  // ─── Validate ─────────────────────────────────────────────────────────────

  private async _runValidateCurrentSegDoc(): Promise<void> {
    if (this._cb.isBusy()) return;
    const segSel = this._currentSegDocSelection();
    if (!segSel) {
      this._cb.log("S\u00e9lectionnez un document avant validation.", true);
      return;
    }
    const confirmEl = this._q<HTMLElement>("#act-seg-confirm-bar");
    if (confirmEl) {
      const ok = await inlineConfirm(
        confirmEl,
        `Valider ${segSel.docLabel} sans relancer la segmentation ?`,
        { confirmLabel: "Valider", danger: false }
      );
      if (!ok) return;
    }
    this._cb.setBusy(true);
    await this._markSegmentedDocValidated(segSel.docId, segSel.docLabel);
  }

  private async _markSegmentedDocValidated(docId: number, docLabel: string): Promise<void> {
    const conn = this._getConn();
    if (!conn) {
      this._cb.setBusy(false);
      return;
    }
    try {
      await updateDocument(conn, {
        doc_id: docId,
        workflow_status: "validated",
      });
      this._segmentPendingValidation = false;
      this._cb.log(`\u2713 ${docLabel} marqu\u00e9 comme valid\u00e9.`);
      this._cb.toast?.(`\u2713 ${docLabel} valid\u00e9`);
      this._refreshSegmentationStatusUI();
      const postValidate = this._postValidateDestination();
      if (postValidate === "next") {
        const moved = this._selectNextSegDoc(docId);
        if (moved) {
          this._cb.log(`\u2192 Document suivant s\u00e9lectionn\u00e9: #${moved.doc_id} (${moved.language}).`);
        } else {
          this._cb.log("\u2192 Aucun document suivant: redirection vers Documents.");
          this._cb.onOpenDocuments?.();
        }
      } else if (postValidate === "stay") {
        this._cb.log("\u2192 Reste sur l'onglet Actions.");
      } else {
        this._cb.onOpenDocuments?.();
      }
    } catch (err) {
      this._cb.log(
        `\u2717 Validation workflow apr\u00e8s segmentation : ${err instanceof SidecarError ? err.message : String(err)}`,
        true,
      );
      this._cb.toast?.("\u2717 Segmentation OK mais validation workflow en \u00e9chec", true);
    } finally {
      this._refreshSegmentationStatusUI();
      this._cb.setBusy(false);
    }
  }

  private _postValidateDestination(): "documents" | "next" | "stay" {
    try {
      const raw = localStorage.getItem(SegmentationView.LS_SEG_POST_VALIDATE);
      if (raw === "next" || raw === "stay" || raw === "documents") return raw;
    } catch { /* ignore */ }
    return "stay";
  }

  private _selectNextSegDoc(currentDocId: number): DocumentRecord | null {
    const docs = this._getDocs();
    const idx = docs.findIndex((d) => d.doc_id === currentDocId);
    if (idx < 0 || idx >= docs.length - 1) return null;
    const nextDoc = docs[idx + 1];
    this._selectedSegDocId = nextDoc.doc_id;
    this._populateSegDocList(true);
    const rightEl = this._q<HTMLElement>("#act-seg-split-right");
    if (rightEl) void this._loadSegRightPanel(nextDoc.doc_id, rightEl);
    return nextDoc;
  }

  // ─── Strategy controls ────────────────────────────────────────────────────

  private _syncSegStrategyRadios(): void {
    const s = this._q<HTMLInputElement>("#act-seg-strategy-sentences");
    const m = this._q<HTMLInputElement>("#act-seg-strategy-markers");
    if (!s || !m) return;
    if (this._segSplitMode === "markers") {
      m.checked = true; s.checked = false;
    } else {
      s.checked = true; m.checked = false;
    }
  }

  private _updateSegStrategySummary(): void {
    const el = this._q<HTMLElement>("#act-seg-strategy-summary");
    if (!el) return;
    if (this._segSplitMode === "markers") {
      el.textContent =
        "R\u00e8gle active : d\u00e9coupe sur les balises [N] pr\u00e9sentes dans le texte (utile si [N] n\u2019a pas \u00e9t\u00e9 absorb\u00e9 \u00e0 l\u2019import). Le pr\u00e9fixe avant [1] reste un segment s\u00e9par\u00e9 sans external_id.";
      return;
    }
    const packSel = this._q<HTMLSelectElement>("#act-seg-pack");
    const label = packSel?.selectedOptions[0]?.textContent?.trim() ?? packSel?.value ?? "";
    el.textContent =
      `R\u00e8gle active : phrases automatiques \u2014 \u00ab ${label} \u00bb (d\u00e9tail sous \u00ab Moteur de d\u00e9coupage \u00bb).`;
  }

  // ─── Scroll sync ──────────────────────────────────────────────────────────

  private _bindSegPreviewScrollSync(): void {
    this._unbindSegPreviewScrollSync();
    const rawEl = this._q<HTMLElement>("#act-seg-prev-raw");
    const segEl = this._q<HTMLElement>("#act-seg-prev-seg");
    if (!rawEl || !segEl) return;

    // Return the unit-n of the first row whose bottom edge is below the scroll top.
    const firstVisibleUnitN = (el: HTMLElement): number | null => {
      const rows = el.querySelectorAll<HTMLElement>("[data-unit-n]");
      for (const row of rows) {
        if (row.offsetTop + row.offsetHeight > el.scrollTop) {
          const n = parseInt(row.dataset.unitN ?? "", 10);
          return isNaN(n) ? null : n;
        }
      }
      return null;
    };

    // Return the unit-n of the first segment row whose bottom edge is below scroll top.
    const firstVisibleSourceUnitN = (el: HTMLElement): number | null => {
      const rows = el.querySelectorAll<HTMLElement>("[data-source-unit]");
      for (const row of rows) {
        if (row.offsetTop + row.offsetHeight > el.scrollTop) {
          const n = parseInt(row.dataset.sourceUnit ?? "", 10);
          return isNaN(n) ? null : n;
        }
      }
      return null;
    };

    // Scroll targetEl so the first row matching unitN is at the top.
    const scrollToUnitN = (targetEl: HTMLElement, unitN: number, attr: string): void => {
      const row = targetEl.querySelector<HTMLElement>(`[${attr}="${unitN}"]`);
      if (row) targetEl.scrollTop = row.offsetTop;
    };

    this._onSegPrevRawScroll = () => {
      if (this._segPrevSyncLock) return;
      this._segPrevSyncLock = true;
      const unitN = firstVisibleUnitN(rawEl);
      if (unitN !== null) scrollToUnitN(segEl, unitN, "data-source-unit");
      requestAnimationFrame(() => { this._segPrevSyncLock = false; });
    };
    this._onSegPrevSegScroll = () => {
      if (this._segPrevSyncLock) return;
      this._segPrevSyncLock = true;
      const unitN = firstVisibleSourceUnitN(segEl);
      if (unitN !== null) scrollToUnitN(rawEl, unitN, "data-unit-n");
      requestAnimationFrame(() => { this._segPrevSyncLock = false; });
    };
    rawEl.addEventListener("scroll", this._onSegPrevRawScroll);
    segEl.addEventListener("scroll", this._onSegPrevSegScroll);
  }

  private _unbindSegPreviewScrollSync(): void {
    const rawEl = this._q<HTMLElement>("#act-seg-prev-raw");
    const segEl = this._q<HTMLElement>("#act-seg-prev-seg");
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

  private _unbindLongtextScrollSync(): void {
    const el = this._root;
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

}

// ─── Module-level helpers ─────────────────────────────────────────────────────

function _roleBadgeHtml(role: string | null | undefined, conventions: ConventionRole[]): string {
  if (!role) return "";
  const conv = conventions.find(c => c.name === role);
  const label = _escHtml(conv?.label ?? role);
  const color = conv?.color ?? "#64748b";
  return `<span class="prep-role-badge" style="--role-color:${color}" title="Rôle : ${label}">${conv?.icon ? _escHtml(conv.icon) + "\u00a0" : ""}${label}</span>`;
}

function _escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** LCS-based sequence diff on string arrays. Returns edit script as ops. */
function _seqDiff(before: string[], after: string[]): Array<{ op: "eq" | "del" | "ins"; text: string }> {
  const m = before.length, n = after.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = before[i - 1] === after[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const ops: Array<{ op: "eq" | "del" | "ins"; text: string }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      ops.unshift({ op: "eq",  text: before[i - 1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ op: "ins", text: after[j - 1] }); j--;
    } else {
      ops.unshift({ op: "del", text: before[i - 1] }); i--;
    }
  }
  return ops;
}

function _splitAtMidpoint(text: string): [string, string] {
  const mid = Math.floor(text.length / 2);
  let best = mid;
  let bestDist = Infinity;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " || text[i] === "\n") {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
  }
  return [text.slice(0, best).trim(), text.slice(best).trim()];
}
