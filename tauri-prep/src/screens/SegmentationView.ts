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
  ConventionRole,
} from "../lib/sidecarClient.ts";
import { safeColor } from "../lib/conventionsRoles.ts";
import {
  enqueueJob,
  updateDocument,
  getDocumentPreview,
  segmentPreview,
  structureDiff,
  detectMarkers,
  mergeUnits,
  splitUnit,
  listConventions,
  prepUndoEligibility,
  prepUndo,
  SidecarError,
  richTextToHtml,
} from "../lib/sidecarClient.ts";
import type { StructureDiffSection, PropagateSection } from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { RolesPane } from "../components/RolesPane.ts";
import { SegStructureMatcherPanel } from "../components/SegStructureMatcherPanel.ts";
import { inlineConfirm } from "../lib/inlineConfirm.ts";
import { hasImportOriginal } from "../lib/importOriginal.ts";
import { computeNextSteps, type PrepNavTarget } from "../lib/prepNextStep.ts";
import { NextStepBanner } from "../components/NextStepBanner.ts";
import {
  formatUndoActionLabel,
  formatUndoTooltip,
  isUndoDisabled,
  buttonStateFromEligibility,
  transitionEvent,
  type UndoButtonState,
  type UndoEligibility,
} from "../lib/prepUndo.ts";
import { reportEvent } from "../lib/telemetry.ts";
import { compareDocsByTitle } from "../lib/docSort.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { escHtml as _escHtml } from "../lib/diff.ts";
import { segRightPanelHtml } from "../lib/segmentationRightPanel.ts";
import { seqDiff } from "../lib/seqDiff.ts";
import { formatSegDocListHtml, formatSegDocListFlat } from "../lib/segDocList.ts";

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
  /**
   * Force un re-fetch de la liste des docs côté ActionsScreen et propage
   * aux sous-vues. Branché sur le bouton « ↻ Actualiser » du header
   * SegmentationView. Cohérent avec le onReloadDocs de CurationView.
   */
  onReloadDocs?(): void;
}

// ─── SegmentationView ─────────────────────────────────────────────────────────

export class SegmentationView {
  // ─── Statics ──────────────────────────────────────────────────────────────
  static readonly LS_SEG_POST_VALIDATE = "agrafes.prep.seg.post_validate";

  // ─── Dependencies ─────────────────────────────────────────────────────────
  private readonly _getConn: () => Conn | null;
  private readonly _getDocs: () => DocumentRecord[];
  /** Bandeau « étape suivante » (HANDOFF Tier A #3) — recréé à chaque rebuild du panneau droit. */
  private _segNextStepBanner: NextStepBanner | null = null;
  private readonly _cb: SegmentationCallbacks;

  // ─── State ────────────────────────────────────────────────────────────────
  private _root: HTMLElement | null = null;
  private _segmentPendingValidation = false;
  private _lastSegmentReport: SegmentReport | null = null;
  private _selectedSegDocId: number | null = null;
  private _segShortFilter = false;
  private _segOrphanFilter = false;
  private _segDocListSort: "id" | "alpha" = "alpha";
  private _conventions: ConventionRole[] = [];
  /** Onglet « Rôles » — orchestration DOM déléguée (cf. RolesPane + lib/conventions*). */
  private _rolesPane: RolesPane | null = null;
  // Structure matcher (extracted to SegStructureMatcherPanel, U-02)
  private _matcherPanel: SegStructureMatcherPanel | null = null;
  private _segSplitMode: "sentences" | "markers" = "sentences";
  private _segPreviewTimer: ReturnType<typeof setTimeout> | null = null;
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
    this._matcherPanel = new SegStructureMatcherPanel(container, {
      getConn: () => this._getConn(),
      getDocs: () => this._getDocs(),
      toast: (m, e) => this._cb.toast?.(m, e),
      onSegmentApplied: (report) => {
        this._lastSegmentReport = report;
        this._segmentPendingValidation = true;
        this._refreshSegmentationStatusUI();
      },
    });
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
    this._matcherPanel?.dispose();
    this._unbindSegPreviewScrollSync();
    this._rolesPane?.dispose();
    this._rolesPane = null;
    this._matcherPanel = null;
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

  /**
   * Ouvre l'onglet « Rôles » du panneau droit. Utilisé par la navigation
   * entrante (ex. deep-link Conventions, désormais fusionné dans Segmentation).
   * Résilient au chargement async : poll sur le bouton d'onglet.
   */
  async focusRolesTab(): Promise<void> {
    const start = Date.now();
    let rolesTab: HTMLButtonElement | null = null;
    while (Date.now() - start < 3000) {
      rolesTab = this._q<HTMLButtonElement>('.prep-seg-content-tab[data-pane="roles"]');
      if (rolesTab) break;
      await new Promise(r => setTimeout(r, 60));
    }
    if (rolesTab && !rolesTab.classList.contains("active")) rolesTab.click();
  }

  /**
   * Focus a specific unit in the saved-segments table. Used by the
   * Curation → Segmentation jump (chantier 2).
   *
   * Switches to the "Modifier" (saved) sub-pane, scrolls to the row,
   * highlights it for ~2s. If the doc is not yet segmented (no saved
   * pane available), shows an info toast.
   *
   * Resilient to async loading : the right panel may not be mounted yet
   * (focusDoc → _loadSegRightPanel is async), so we poll for the saved
   * tab to exist before attempting to click it. Same poll for the row
   * once the table renders.
   */
  async focusUnit(unitN: number): Promise<void> {
    // 1. Wait for the saved tab to exist (right panel may still be loading)
    const start = Date.now();
    const TIMEOUT_MS = 2000;
    let savedTab: HTMLButtonElement | null = null;
    while (Date.now() - start < TIMEOUT_MS) {
      savedTab = this._q<HTMLButtonElement>('.prep-seg-content-tab[data-pane="saved"]');
      if (savedTab) break;
      await new Promise(r => setTimeout(r, 50));
    }
    if (!savedTab) {
      this._cb.toast?.("Panneau Segmentation non disponible — réessayer.", true);
      return;
    }
    if (savedTab.disabled) {
      // Not yet segmented — saved pane unavailable
      this._cb.toast?.("Cette unité n'est pas encore segmentée.", false);
      return;
    }
    if (!savedTab.classList.contains("active")) savedTab.click();

    // 2. Wait for the saved table to render the requested row.
    let row: HTMLElement | null = null;
    while (Date.now() - start < TIMEOUT_MS) {
      row = this._q<HTMLElement>(`tr[data-unit-n="${unitN}"]`);
      if (row) break;
      await new Promise(r => setTimeout(r, 50));
    }
    if (!row) {
      this._cb.toast?.(`Unité n=${unitN} introuvable dans le tableau segmenté.`, true);
      return;
    }

    // 3. Scroll + highlight (CSS animation 2s, classe auto-removed via JS)
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.add("prep-seg-row-highlight");
    setTimeout(() => row?.classList.remove("prep-seg-row-highlight"), 2000);
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
            <h2 class="prep-seg-list-brand-title">
              Segmentation
              <button type="button" id="act-seg-reload-docs-btn" class="btn btn-secondary btn-sm"
                      title="Re-charger la liste des documents depuis la base"
                      style="margin-left:0.5rem;vertical-align:middle">&#8635; Actualiser</button>
            </h2>
            <p class="prep-seg-list-brand-desc">S&#233;lectionnez un document pour voir l&#8217;aper&#231;u live et lancer la segmentation.</p>
          </div>
          <div class="prep-seg-split-list-head">
            <input type="search" id="act-seg-list-filter" class="prep-seg-split-list-filter"
              placeholder="Filtrer&#8230;" autocomplete="off" />
            <div class="prep-curate-sort-group" role="group" aria-label="Tri">
              <button class="prep-curate-sort-btn active" data-seg-sort="alpha" title="Trier par titre">A&#8211;Z</button>
              <button class="prep-curate-sort-btn" data-seg-sort="id" title="Trier par identifiant">ID</button>
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

    // « ↻ Actualiser » — force un re-fetch des docs côté ActionsScreen,
    // qui propage en re-rendering la liste via _populateSegDocList.
    el.querySelector<HTMLButtonElement>("#act-seg-reload-docs-btn")?.addEventListener("click", () => {
      this._cb.onReloadDocs?.();
    });
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
      setHtml(scrollEl, raw(html));
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
    // Markup pur délégué à lib/segDocList ; la vue garde le fetch des relations de
    // famille + la garde de connexion (no-conn → liste vide ; échec fetch → plat).
    const conn = this._getConn();
    if (!conn) return `<p class="empty-hint">Aucun document.</p>`;
    try {
      const { getAllDocRelations } = await import("../lib/sidecarClient.ts");
      const relations = await getAllDocRelations(conn);
      return formatSegDocListHtml(this._getDocs(), relations, this._segDocListSort);
    } catch {
      return formatSegDocListFlat(this._getDocs(), this._segDocListSort);
    }
  }

  // ─── Right panel ──────────────────────────────────────────────────────────

  private async _loadSegRightPanel(docId: number, rightEl: HTMLElement): Promise<void> {
    const docs = this._getDocs();
    const doc = docs.find(d => d.doc_id === docId);
    if (!doc) { rightEl.innerHTML = `<div class="prep-seg-right-empty">Document introuvable.</div>`; return; }

    this._segSplitMode = "sentences";
    this._segShortFilter = false;
    this._segOrphanFilter = false;
    this._matcherPanel?.reset(true);
    // L'onglet Rôles est recréé avec le panneau droit (rightEl.innerHTML est
    // remplacé) — le RolesPane précédent pointe vers un nœud détaché.
    this._rolesPane?.dispose();
    this._rolesPane = null;

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
        .sort(compareDocsByTitle)
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
            return compareDocsByTitle(a, b);
          });
        const restDocs = otherDocs
          .filter(d => !familyIds.has(d.doc_id))
          .sort(compareDocsByTitle);

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

    setHtml(rightEl, raw(segRightPanelHtml(doc, { lang, pack, statusBadge, calibrateOptions, savedAlready })));

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
      this._matcherPanel?.reset(false);
      const activePane = this._root?.querySelector<HTMLButtonElement>(".prep-seg-content-tab.active")?.dataset.pane;
      if (activePane === "structure") void this._matcherPanel?.render(docId);
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
    // Mode A undo button — initial state + click handler.
    rightEl.querySelector("#act-seg-undo-btn")?.addEventListener("click", () => {
      const sel = this._currentSegDocSelection();
      if (sel) void this._handleUndoClick(sel.docId);
    });
    void this._refreshUndoButton(this._currentSegDocSelection()?.docId ?? null);
    rightEl.querySelector("#act-seg-validate-only-btn")?.addEventListener("click", () => void this._runValidateCurrentSegDoc());
    // Bandeau « étape suivante » (HANDOFF Tier A #3) — inséré après le banner de statut.
    this._segNextStepBanner = new NextStepBanner((target) => this._navigateNextStep(target));
    rightEl.querySelector("#act-seg-status-banner")?.after(this._segNextStepBanner.element);

    // Wire content pane tabs (Aperçu / Enregistré / Diff)
    rightEl.querySelectorAll<HTMLButtonElement>(".prep-seg-content-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        const pane = btn.dataset.pane as "preview" | "saved" | "diff" | "structure" | "roles";
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
      setHtml(rawEl, raw(truncNote + preview.lines.map(l =>
        `<div class="prep-seg-prev-row" data-unit-n="${l.n}"><span class="prep-seg-prev-n">${l.n}</span>${_roleBadgeHtml(l.unit_role, this._conventions)}<span class="prep-seg-prev-tx">${richTextToHtml(l.text_raw, l.text)}</span></div>`,
      ).join("")));
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
      } = { doc_id: docId, mode, lang, pack, limit: 5000 };
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
        setHtml(statsEl, raw(mode === "markers"
          ? `${res.units_input} u. &#8594; ${res.units_output} segments par balise`
          : `${res.units_input} u. &#8594; ${res.units_output} phrases · r&#233;glage ${res.segment_pack}${calibrateText}`));
      }
      if (segColTitle) {
        setHtml(segColTitle, raw(mode === "markers"
          ? `Balises [N] (<span id="act-seg-prev-seg-count">${res.units_output}</span> segments)`
          : `Segment&#233; (<span id="act-seg-prev-seg-count">${res.units_output}</span> phrases)`));
      }

      const truncNote = res.units_output >= 5000
        ? `<p class="prep-seg-trunc-note">Aper&#231;u tronqu&#233; &#224; 5000 segments</p>`
        : "";

      setHtml(segEl, raw(truncNote + (res.segments.length
        ? res.segments.map(s => {
            const hasId = s.external_id != null;
            return `<div class="prep-seg-prev-row${hasId ? " prep-seg-prev-row-marker" : ""}" data-source-unit="${s.source_unit_n ?? ""}">` +
              `<span class="prep-seg-prev-n">${hasId ? `[${_escHtml(String(s.external_id))}]` : s.n}</span>` +
              `<span class="prep-seg-prev-tx">${_escHtml(s.text)}</span></div>`;
          }).join("")
        : `<p class="empty-hint">Aucun segment produit.</p>`)));

      if (warnsEl) {
        if (res.warnings.length) {
          warnsEl.style.display = "";
          setHtml(warnsEl, raw(res.warnings.map(w => `<div class="prep-seg-warn">${_escHtml(w)}</div>`).join("")));
        } else {
          warnsEl.style.display = "none";
        }
      }
      this._updateSegStrategySummary();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Special-case: doc exists but has no segmentable lines (failed import,
      // text stuck in a single 'structure' unit). Suggest reimport instead of
      // a raw error message.
      const noLines = /no segmentable line units/i.test(msg);
      if (noLines) {
        segEl.innerHTML = `
          <div class="prep-seg-import-broken">
            <strong>Ce document n'a pas de lignes segmentables.</strong>
            <p>Probablement un import partiellement échoué — tout le texte est dans une seule unité de structure (cas typique : DOCX en tableau 2 colonnes que l'import en lignes numérotées ne sait pas lire).</p>
            <p>Solution : retourner dans <strong>Importer</strong>, supprimer ce document et le réimporter (essayer le mode <em>Paragraphes</em> si <em>Lignes numérotées [n]</em> ne fonctionne pas).</p>
            <p class="prep-seg-import-broken-detail">${_escHtml(msg)}</p>
          </div>`;
      } else {
        segEl.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur preview: ${_escHtml(msg)}</p>`;
      }
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

      if (!bannerEl) return;

      if (report.detected) {
        const sample = report.first_markers.slice(0, 5).join(", ");
        bannerEl.style.display = "";
        setHtml(bannerEl, raw(`
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
        `));
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
        setHtml(bannerEl, raw(`
          <span class="prep-seg-marker-icon prep-seg-marker-icon-miss">&#8416;</span>
          <span class="prep-seg-marker-info">Aucune balise <code>[N]</code> d&#233;tect&#233;e dans ce document
          (${report.total_units} unit&#233;s analys&#233;es).</span>
        `));
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

  private _switchContentPane(pane: "preview" | "saved" | "diff" | "structure" | "roles", docId?: number): void {
    const previewPane   = this._q<HTMLElement>("#act-seg-pane-preview");
    const savedPane     = this._q<HTMLElement>("#act-seg-pane-saved");
    const diffPane      = this._q<HTMLElement>("#act-seg-pane-diff");
    const structurePane = this._q<HTMLElement>("#act-seg-pane-structure");
    const rolesPane     = this._q<HTMLElement>("#act-seg-pane-roles");
    const refreshBtn    = this._q<HTMLElement>("#act-seg-prev-refresh");
    const statsEl       = this._q<HTMLElement>("#act-seg-prev-stats");
    if (!previewPane || !savedPane) return;
    previewPane.style.display   = pane === "preview"   ? "" : "none";
    savedPane.style.display     = pane === "saved"     ? "" : "none";
    if (diffPane)      diffPane.style.display      = pane === "diff"      ? "" : "none";
    if (structurePane) structurePane.style.display = pane === "structure" ? "" : "none";
    if (rolesPane)     rolesPane.style.display     = pane === "roles"     ? "" : "none";
    if (refreshBtn) refreshBtn.style.display = pane === "preview" ? "" : "none";
    if (statsEl)    statsEl.style.display    = pane === "preview" ? "" : "none";
    this._root?.querySelectorAll<HTMLButtonElement>(".prep-seg-content-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.pane === pane);
    });
    if (pane === "diff" && docId != null) void this._renderSegDiff(docId);
    if (pane === "structure" && docId != null) void this._matcherPanel?.render(docId);
    if (pane === "roles" && docId != null) void this._renderRolesPane(docId);
  }

  /**
   * Onglet « Rôles » — délègue l'orchestration DOM à RolesPane (logique pure
   * dans lib/conventions*). Le document est partagé avec le reste de la
   * sous-vue Segmentation : pas de second sélecteur de document.
   */
  private async _renderRolesPane(docId: number): Promise<void> {
    const host = this._q<HTMLElement>("#act-seg-roles-content");
    if (!host) return;
    if (!this._rolesPane) {
      this._rolesPane = new RolesPane(
        host,
        () => this._getConn(),
        (msg) => this._cb.toast?.(msg, true),
      );
    }
    const doc = this._getDocs().find(d => d.doc_id === docId);
    await this._rolesPane.setDocument(docId, doc?.text_start_n ?? null);
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
      const ops = seqDiff(before, after);

      if (ops.every(o => o.op === "eq")) {
        setHtml(diffEl, raw(`<div class="prep-seg-diff-equal-note">&#10003; Aucune diff&#233;rence — la re-segmentation produirait les m&#234;mes ${before.length} segments.</div>`));
        return;
      }

      const beforeCount = ops.filter(o => o.op !== "ins").length;
      const afterCount  = ops.filter(o => o.op !== "del").length;
      const addedCount  = ops.filter(o => o.op === "ins").length;
      const removedCount = ops.filter(o => o.op === "del").length;

      setHtml(diffEl, raw(`
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
      `));
    } catch (err) {
      diffEl.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Erreur diff : ${_escHtml(err instanceof Error ? err.message : String(err))}</p>`;
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
      // Cap aligné sur la convention preview v0.1.40 (5000) — voir HANDOFF_SHELL.
      // Sans cap, le DOM craque sur les très gros docs ; 5000 couvre largement
      // les corpus typiques.
      const PREVIEW_CAP = 5000;
      const preview = await getDocumentPreview(conn, docId, PREVIEW_CAP);
      const countEl = this._q<HTMLElement>("#act-seg-saved-count");
      if (countEl) countEl.textContent = String(preview.total_lines);
      if (!preview.lines.length) {
        el.innerHTML = `<p class="empty-hint">Aucun segment en base.</p>`;
        return;
      }

      const truncNote = preview.total_lines > PREVIEW_CAP
        ? `<p class="prep-seg-trunc-note">Aper&#231;u &#8212; ${PREVIEW_CAP}/${preview.total_lines} segments</p>`
        : "";

      // Language-aware detection of orphaned closing punctuation at line start —
      // typical artefact of bad numbered-line imports where a closing mark gets
      // left on the next line. German tolerates »...« reversed convention so we
      // also flag « ‹ › for de-* documents.
      const docLang = (this._getDocs().find(d => d.doc_id === docId)?.language ?? "").toLowerCase();
      const orphanChars = docLang.startsWith("de") ? "»«‹›)\\]}”’" : "»)\\]}”’";
      const orphanRegex = new RegExp(`^\\s*[${orphanChars}]+`);

      const buildRow = (l: { n: number; text: string; text_raw?: string | null; unit_role?: string | null; text_source?: string | null }, idx: number, total: number): string => {
        const lenClass = l.text.length > 200 ? " prep-seg-cell-len-warn" : l.text.length > 120 ? " prep-seg-cell-len-hint" : "";
        const mergeUpBtn   = idx > 0
          ? `<button class="prep-seg-action-btn prep-seg-merge-up"   title="Fusionner avec le pr&#233;c&#233;dent" data-n="${l.n}">&#8679;</button>`
          : `<span class="prep-seg-action-placeholder"></span>`;
        const mergeDownBtn = idx < total - 1
          ? `<button class="prep-seg-action-btn prep-seg-merge-down" title="Fusionner avec le suivant"     data-n="${l.n}">&#8681;</button>`
          : `<span class="prep-seg-action-placeholder"></span>`;
        const splitBtn = `<button class="prep-seg-action-btn prep-seg-split-btn" title="Couper ce segment" data-n="${l.n}">&#9986;</button>`;
        const orphanAttr = orphanRegex.test(l.text) ? ` data-orphan="1"` : "";
        // ADR-043 P3: when a destructive op rewrote this line, offer to reveal
        // the verbatim import original via a native <details> fold (no JS handler).
        const sourceFold = hasImportOriginal(l)
          ? `<details class="prep-seg-source"><summary class="prep-seg-source-sum" title="Texte tel qu'import&#233;, avant red&#233;coupage / fusion">&#8982;&#160;voir l'original d'import</summary><div class="prep-seg-source-txt">${richTextToHtml(l.text_source, l.text_source ?? "")}</div></details>`
          : "";
        return `<tr data-unit-n="${l.n}" data-len="${l.text.length}"${orphanAttr}>
          <td class="prep-seg-cell-n">${l.n}</td>
          <td class="prep-seg-cell-text">${_roleBadgeHtml(l.unit_role, this._conventions)}${richTextToHtml(l.text_raw, l.text)}${sourceFold}</td>
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

      let lines = preview.lines.map(l => ({ n: l.n, text: l.text, text_raw: l.text_raw, unit_role: l.unit_role, text_source: l.text_source }));
      setHtml(el, raw(renderTable(lines)));

      const reload = (targetN?: number) => {
        void this._renderSegSavedTable(docId, el, targetN);
        void this._refreshUndoButton(docId);
      };

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

            setHtml(tr, raw(`
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
              </td>`));

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
      lines = preview.lines.map(l => ({ n: l.n, text: l.text, text_raw: l.text_raw, unit_role: l.unit_role, text_source: l.text_source }));
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
          void this._refreshUndoButton(docId);

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

  /** Cible du bandeau « étape suivante » → délègue aux callbacks de navigation. */
  private _navigateNextStep(target: PrepNavTarget): void {
    if (target === "export") {
      this._cb.onOpenExporter?.();
      return;
    }
    if (target === "reindex") return; // non produit par segment_validate
    this._cb.onNavigate?.(target, { docId: this._currentSegDocSelection()?.docId });
  }

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
        // Bandeau \u00ab \u00e9tape suivante \u00bb (HANDOFF Tier A #3) \u2014 uniquement quand
        // l'utilisateur reste sur place (sinon il navigue d\u00e9j\u00e0 ailleurs).
        const _nsDoc = this._getDocs().find(d => d.doc_id === docId);
        this._segNextStepBanner?.show(computeNextSteps({
          completed: "segment_validate",
          hasRelations: ["original", "translation", "excerpt"].includes(_nsDoc?.doc_role ?? ""),
        }));
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

  // ─── Mode A undo (Annuler button) ────────────────────────────────────────
  // Backbone : table prep_action_history (cf. migration 019). Le bouton est
  // rafraîchi à l'ouverture du panneau, après chaque merge/split (via reload),
  // après chaque resegment réussie, et après chaque undo. Pas de raccourci
  // clavier en V1.

  // Soak instrumentation : eligible_view / unavailable_view emis sur transition
  // d'etat (anti-bruit, cf. prepUndo.transitionEvent).
  private _lastUndoButtonState: UndoButtonState | undefined = undefined;

  private _emitUndoTransition(
    next: UndoButtonState,
    docId: number | null,
  ): void {
    const ev = transitionEvent(this._lastUndoButtonState, next);
    this._lastUndoButtonState = next;
    if (!ev) return;
    const conn = this._getConn();
    if (!conn) return;
    reportEvent(conn, ev.event, {
      ...ev.payload,
      screen: "segmentation",
      ...(docId != null ? { doc_id: docId } : {}),
    });
  }

  private async _refreshUndoButton(docId: number | null): Promise<void> {
    const btn = this._q<HTMLButtonElement>("#act-seg-undo-btn");
    if (!btn) return;
    const conn = this._getConn();
    if (!conn || docId == null) {
      btn.disabled = true;
      btn.textContent = "↶ Annuler";
      btn.title = "Aucune action à annuler.";
      this._emitUndoTransition({ kind: "idle" }, docId);
      return;
    }
    let elig: UndoEligibility;
    try {
      elig = await prepUndoEligibility(conn, docId);
    } catch (err) {
      // Silent fallback — undo unavailability shouldn't break the UI.
      btn.disabled = true;
      btn.textContent = "↶ Annuler";
      btn.title = `Undo indisponible : ${err instanceof Error ? err.message : String(err)}`;
      this._emitUndoTransition(
        { kind: "unavailable", reason: "fetch_error" },
        docId,
      );
      return;
    }
    btn.disabled = isUndoDisabled(elig);
    btn.textContent = formatUndoActionLabel(elig);
    btn.title = formatUndoTooltip(elig);
    this._emitUndoTransition(buttonStateFromEligibility(elig), docId);
  }

  private async _handleUndoClick(docId: number): Promise<void> {
    const conn = this._getConn();
    if (!conn) return;
    const btn = this._q<HTMLButtonElement>("#act-seg-undo-btn");
    if (btn) btn.disabled = true;
    try {
      const res = await prepUndo(conn, docId);
      // Refresh saved table + raw column to reflect the restored state.
      const savedTableEl = this._q<HTMLElement>("#act-seg-saved-table");
      if (savedTableEl) void this._renderSegSavedTable(docId, savedTableEl);
      void this._loadSegRawColumn(docId);
      void this._runSegPreview(docId);
      this._cb.log(
        `↶ Annulation : ${res.reverted_action_type} — ${res.units_restored} unité(s) restaurée(s)`
      );
      if (res.fts_stale) this._cb.log("⚠ Index FTS périmé.");
    } catch (err) {
      this._cb.log(
        `✗ Annulation : ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    } finally {
      void this._refreshUndoButton(docId);
    }
  }

}

// ─── Module-level helpers ─────────────────────────────────────────────────────

function _roleBadgeHtml(role: string | null | undefined, conventions: ConventionRole[]): string {
  if (!role) return "";
  const conv = conventions.find(c => c.name === role);
  const label = _escHtml(conv?.label ?? role);
  const color = safeColor(conv?.color, "#64748b");
  return `<span class="prep-role-badge" style="--role-color:${color}" title="Rôle : ${label}">${conv?.icon ? _escHtml(conv.icon) + "\u00a0" : ""}${label}</span>`;
}
