/**
 * MetadataScreen.ts — Corpus metadata panel (V0.4A).
 *
 * Host tab: Documents (within Importer | Documents | Actions | Exporter).
 * Features:
 *   - Document list (GET /documents)
 *   - Edit panel: title, language, doc_role, resource_type (POST /documents/update)
 *   - Bulk update doc_role / resource_type (POST /documents/bulk_update)
 *   - Doc relations panel (GET /doc_relations, POST /doc_relations/set/delete)
 *   - Metadata validation (POST /validate-meta)
 */

import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import type { Conn } from "../lib/sidecarClient.ts";
import {
  listDocuments,
  updateDocument,
  bulkUpdateDocuments,
  deleteDocuments,
  getDocRelations,
  getAllDocRelations,
  getFamilies,
  segmentFamily,
  alignFamily,
  setDocRelation,
  deleteDocRelation,
  backupDatabase,
  validateMeta,
  annotate,
  enqueueJob,
  getCorpusAudit,
  getFamilyCurationStatus,
  acknowledgeSourceChange,
  type DocumentRecord,
  type DocRelationRecord,
  type FamilyRecord,
  SidecarError,
} from "../lib/sidecarClient.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";
import { modalConfirm } from "../lib/modalConfirm.ts";
import { compareDocsByTitle, compareLocale } from "../lib/docSort.ts";
import {
  indexButtonState,
  isAutoReindexEnabled,
  setAutoReindexEnabled,
} from "../lib/prepIndexStatus.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { CorpusAuditPanel } from "../components/CorpusAuditPanel.ts";
import { openExportPairDialog } from "../components/ExportPairDialog.ts";
import { UnitInspectorPanel } from "../components/UnitInspectorPanel.ts";
import { familyPanelHtml, segResultRow, alnResultRow, curationStatusHtml } from "../components/familyView.ts";
import { DOC_ROLES } from "../lib/docRoles.ts";
import { metadataScreenTemplate } from "../lib/metadataScreenTemplate.ts";

const RELATION_TYPES = ["translation_of", "excerpt_of"];
const WORKFLOW_STATUS = ["draft", "review", "validated"] as const;
type WorkflowStatus = (typeof WORKFLOW_STATUS)[number];
type SortCol = "id" | "title" | "lang" | "role" | "status";

interface TreeNode {
  doc: DocumentRecord;
  children: TreeNode[];
  relationLabel?: string; // e.g. "translation_of"
}

export class MetadataScreen {
  private _conn: Conn | null = null;
  private _docs: DocumentRecord[] = [];
  private _docFilter = "";
  private _statusFilter: "all" | "ok" | "todo" = "all";
  private _selectedDoc: DocumentRecord | null = null;
  private _selectedDocIds: Set<number> = new Set();
  private _relations: DocRelationRecord[] = [];

  // Hierarchy view
  private _hierarchyView = false;
  private _allRelations: DocRelationRecord[] = [];
  private _allRelationsLoaded = false;
  private _families: FamilyRecord[] = [];
  private _familiesLoaded = false;

  // DOM refs
  private _root!: HTMLElement;
  private _docListEl!: HTMLElement;
  private _editPanelEl!: HTMLElement;
  private _logEl: HTMLElement = document.createElement("div");
  private _docCountEl!: HTMLElement;
  private _stateEl!: HTMLElement;
  private _kpiBarEl!: HTMLElement;
  private _batchBarEl!: HTMLElement;
  private _batchMetaEl!: HTMLElement;
  private _selectAllEl!: HTMLInputElement;
  private _isBusy = false;
  private _lastErrorMsg: string | null = null;
  private _lastRefreshAt = 0;
  private _auditPanel!: CorpusAuditPanel;
  private _auditRatioThreshold = 15;
  private _sortCol: SortCol = "id";
  private _sortDir: "asc" | "desc" = "asc";
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;

  // Preview + token editor + inline unit edit (extracted U-02). Owns its own
  // 12 state fields + conventions cache; constructed once so state survives
  // edit-panel re-renders. Deps are lazy so they always see current screen state.
  private _unitInspector = new UnitInspectorPanel({
    getConn: () => this._conn,
    getSelectedDoc: () => this._selectedDoc,
    getEditPanelEl: () => this._editPanelEl,
    log: (m, e) => this._log(m, e),
    showToast: (m, e) => this._showToast?.(m, e),
  });

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._docFilter = "";
    this._statusFilter = "all";
    this._selectedDoc = null;
    this._selectedDocIds = new Set();
    this._relations = [];
    this._unitInspector.clear();
    this._allRelations = [];
    this._allRelationsLoaded = false;
    this._families = [];
    this._familiesLoaded = false;
    if (this._root) {
      const filterInput = this._root.querySelector<HTMLInputElement>("#meta-doc-filter");
      if (filterInput) filterInput.value = "";
      const statusSel = this._root.querySelector<HTMLSelectElement>("#meta-status-filter");
      if (statusSel) statusSel.value = "all";
      this._refreshDocList();
    }
  }

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  hasPendingChanges(): boolean {
    if (!this._root) return false;
    if (this._hasBulkDraftValues()) return true;
    return this._isSelectedDocDirty() || this._hasPendingRelationDraft();
  }

  pendingChangesMessage(): string {
    return "Des modifications de métadonnées non enregistrées sont détectées. Quitter l'onglet Documents ?";
  }

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen actions-screen";
    this._root = root;

    setHtml(root, raw(metadataScreenTemplate()));

    this._docListEl   = root.querySelector("#prep-meta-doc-list")!;
    this._editPanelEl = root.querySelector("#meta-edit-panel")!;
    this._docCountEl  = root.querySelector("#meta-doc-count")!;
    this._stateEl     = root.querySelector("#meta-state-banner")!;
    this._kpiBarEl    = root.querySelector("#prep-meta-kpi-bar")!;
    this._batchBarEl  = root.querySelector("#prep-meta-batch-bar")!;
    this._batchMetaEl = root.querySelector("#prep-meta-batch-meta")!;
    this._selectAllEl = root.querySelector<HTMLInputElement>("#meta-select-all")!;

    root.querySelector("#refresh-docs-btn")!.addEventListener("click", () => this._refreshDocList());
    root.querySelector("#meta-refresh-btn")?.addEventListener("click", () => this._refreshDocList());
    root.querySelector("#meta-doc-filter")!.addEventListener("input", (e) => {
      this._docFilter = ((e.target as HTMLInputElement).value ?? "").trim().toLowerCase();
      this._renderDocList();
    });
    root.querySelector("#meta-status-filter")!.addEventListener("change", (e) => {
      this._statusFilter = (e.target as HTMLSelectElement).value as "all" | "ok" | "todo";
      this._renderDocList();
    });
    root.querySelector("#meta-reset-filter")!.addEventListener("click", () => {
      this._docFilter = "";
      this._statusFilter = "all";
      const fi = root.querySelector<HTMLInputElement>("#meta-doc-filter");
      const ss = root.querySelector<HTMLSelectElement>("#meta-status-filter");
      if (fi) fi.value = "";
      if (ss) ss.value = "all";
      this._renderDocList();
    });
    this._selectAllEl.addEventListener("change", () => {
      const docs = this._filteredDocs();
      if (this._selectAllEl.checked) {
        docs.forEach(d => this._selectedDocIds.add(d.doc_id));
      } else {
        docs.forEach(d => this._selectedDocIds.delete(d.doc_id));
      }
      this._renderDocList();
      this._renderBatchBar();
    });
    root.querySelector("#bulk-apply-btn")!.addEventListener("click", () => this._runBulkUpdate());
    root.querySelector("#meta-batch-role-sel")!.addEventListener("change", () => this._renderBatchBar());
    root.querySelector("#meta-batch-role-btn")!.addEventListener("click", () => void this._runBatchRoleUpdate());
    root.querySelector("#meta-batch-delete-btn")!.addEventListener("click", () => void this._runBatchDelete());
    root.querySelector("#validate-btn")!.addEventListener("click", () => this._runValidate());
    root.querySelector("#db-backup-btn")!.addEventListener("click", () => void this._runDbBackup());
    root.querySelector("#db-export-btn")!.addEventListener("click", () => void this._runDbExport());
    root.querySelector("#audit-btn")!.addEventListener("click", () => void this._runAudit());
    root.querySelector("#meta-reindex-btn")!.addEventListener("click", () => void this._runReindex());
    const autoReindexCb = root.querySelector<HTMLInputElement>("#meta-auto-reindex");
    if (autoReindexCb) {
      autoReindexCb.checked = isAutoReindexEnabled();
      autoReindexCb.addEventListener("change", () => setAutoReindexEnabled(autoReindexCb.checked));
    }
    root.querySelector<HTMLInputElement>("#audit-ratio-input")?.addEventListener("change", (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      if (!isNaN(v) && v >= 1 && v <= 100) this._auditRatioThreshold = v;
    });
    this._auditPanel = new CorpusAuditPanel(
      root.querySelector<HTMLElement>("#prep-meta-audit-panel")!,
      {
        getDoc: (id) => this._docs.find(d => d.doc_id === id),
        hasFamilies: () => this._families.length > 0,
        isSelected: (id) => this._selectedDocIds.has(id),
        selectIds: (ids) => this._auditSelectIds(ids),
        toggleOne: (id, checked) => this._auditToggleOne(id, checked),
        navToDoc: (id) => this._auditNavToDoc(id),
        segmentFamilies: (roots) => void this._auditSegmentFamilies(roots),
        alignFamilies: (roots) => void this._auditAlignFamilies(roots),
      },
    );
    root.querySelector("#meta-hierarchy-btn")!.addEventListener("click", () => void this._toggleHierarchyView());

    // Chip « ⚠ Index » cliquable (HANDOFF F4) — délégué : vaut pour la vue
    // liste comme la vue hiérarchie (toutes deux rendues dans _docListEl).
    // Phase de capture : intercepte AVANT le listener de sélection de ligne
    // (qui est en phase de bulle sur le <tr>), sinon le clic sélectionnerait
    // aussi le document.
    this._docListEl.addEventListener("click", (e) => {
      const chip = (e.target as HTMLElement).closest(".prep-fts-stale-pill");
      if (chip) {
        e.stopPropagation();
        void this._runReindex();
      }
    }, true);

    // Sortable column headers
    root.querySelectorAll<HTMLElement>("th[data-sort]").forEach(th => {
      th.addEventListener("click", () => {
        const col = th.dataset.sort as SortCol;
        if (this._sortCol === col) {
          this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
        } else {
          this._sortCol = col;
          this._sortDir = "asc";
        }
        this._renderDocList();
      });
    });

    // Enable bulk-apply when any bulk field has value
    const bulkRole    = root.querySelector<HTMLSelectElement>("#bulk-role")!;
    const bulkRestype = root.querySelector<HTMLInputElement>("#bulk-restype")!;
    const bulkBtn     = root.querySelector<HTMLButtonElement>("#bulk-apply-btn")!;
    const onBulkChange = () => { bulkBtn.disabled = !bulkRole.value && !bulkRestype.value.trim(); };
    bulkRole.addEventListener("change", onBulkChange);
    bulkRestype.addEventListener("input", onBulkChange);

    initCardAccordions(root);
    this._refreshDocList();
    return root;
  }

  // ── Doc list ────────────────────────────────────────────────────────────────

  /** Auto-refresh when switching to the Documents tab (debounced: max once per 10 s). */
  onActivate(): void {
    const DEBOUNCE_MS = 10_000;
    if (this._conn && Date.now() - this._lastRefreshAt > DEBOUNCE_MS) {
      void this._refreshDocList();
    }
  }

  private async _refreshDocList(): Promise<void> {
    if (!this._conn) {
      this._docListEl.innerHTML = `<tr><td colspan="6" class="prep-meta-empty-cell">Sidecar non connecté.</td></tr>`;
      this._updateDocCount();
      this._refreshRuntimeState();
      return;
    }
    this._isBusy = true;
    this._refreshRuntimeState();
    try {
      this._docs = await listDocuments(this._conn);
      this._lastErrorMsg = null;
      this._lastRefreshAt = Date.now();
    } catch (err) {
      this._log(`Erreur liste documents: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      this._isBusy = false;
      this._refreshRuntimeState();
    }
    this._updateDocCount();
    this._renderDocList();
  }

  /** Met à jour le bouton unique « Mettre à jour l'index » (HANDOFF F4). */
  private _refreshIndexButton(): void {
    const btn = this._root.querySelector<HTMLButtonElement>("#meta-reindex-btn");
    if (!btn) return;
    const staleCount = this._docs.filter(d => d.fts_stale).length;
    const st = indexButtonState(staleCount);
    btn.textContent = st.label;
    btn.title = st.title;
    btn.disabled = st.disabled || this._isBusy || !this._conn;
    btn.classList.toggle("prep-meta-reindex-stale", st.stale);
  }

  /**
   * Réindexation FTS (HANDOFF F4) — point d'arbitrage unique. Reconstruit
   * l'index global via un job asynchrone, jamais bloquant. Déclenché par le
   * bouton d'en-tête ou par un clic sur le chip « ⚠ Index » d'un document.
   */
  private async _runReindex(): Promise<void> {
    if (!this._conn) return;
    const btn = this._root.querySelector<HTMLButtonElement>("#meta-reindex-btn");
    if (btn) btn.disabled = true;
    try {
      const job = await enqueueJob(this._conn, "index", {});
      this._log("⏳ Reconstruction de l'index FTS soumise (job asynchrone)…");
      this._showToast?.("⏳ Réindexation FTS lancée");
      if (this._jobCenter) {
        this._jobCenter.trackJob(job.job_id, "Rebuild index FTS", (done) => {
          if (done.status === "done") {
            const n = (done.result as { units_indexed?: number } | undefined)?.units_indexed ?? "?";
            this._log(`✓ Index FTS reconstruit — ${n} unités indexées.`);
            this._showToast?.(`✓ Index FTS reconstruit (${n} unités)`);
          } else if (done.status === "canceled") {
            this._log("↩ Réindexation FTS annulée.", true);
          } else {
            this._log(`✗ Réindexation FTS : ${done.error ?? done.status}`, true);
            this._showToast?.("✗ Erreur réindexation FTS", true);
          }
          void this._refreshDocList();
        });
      } else {
        // Pas de JobCenter (cas dégradé) : on ne peut pas suivre le job —
        // ré-active le bouton tout de suite plutôt que de le figer.
        this._refreshIndexButton();
      }
    } catch (err) {
      this._log(`✗ Réindexation FTS : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._refreshIndexButton();
    }
  }

  private _renderDocList(): void {
    this._updateDocCount();
    this._refreshIndexButton();

    // Refresh sort indicators on column headers (list and hierarchy)
    this._root.querySelectorAll<HTMLElement>("th[data-sort]").forEach(th => {
      const isActive = th.dataset.sort === this._sortCol;
      th.classList.toggle("sort-active", isActive);
      const ind = th.querySelector<HTMLElement>(".sort-ind");
      if (ind) ind.textContent = isActive ? (this._sortDir === "asc" ? " ↑" : " ↓") : " ⇅";
    });

    if (this._hierarchyView) {
      this._renderHierarchyList();
      return;
    }
    if (this._docs.length === 0) {
      this._docListEl.innerHTML = `<tr><td colspan="6" class="prep-meta-empty-cell">Aucun document.</td></tr>`;
      this._renderBatchBar();
      return;
    }
    const docs = this._filteredDocs();
    if (docs.length === 0) {
      this._docListEl.innerHTML = `<tr><td colspan="6" class="prep-meta-empty-cell">Aucun document ne correspond aux filtres.</td></tr>`;
      this._renderBatchBar();
      return;
    }
    this._docListEl.innerHTML = "";
    docs.forEach((doc, idx) => {
      const tr = document.createElement("tr");
      tr.className = "prep-meta-doc-row";
      if (this._selectedDoc?.doc_id === doc.doc_id) tr.classList.add("is-active");
      const isChecked = this._selectedDocIds.has(doc.doc_id);
      const wfStatus = this._workflowStatus(doc);
      const wfLabel  = this._workflowLabel(wfStatus);
      const tokenCount = Number(doc.token_count ?? 0);
      const annotationStatus = doc.annotation_status ?? (tokenCount > 0 ? "annotated" : "missing");
      const annLabel = annotationStatus === "annotated"
        ? `Annoté${tokenCount > 0 ? ` (${tokenCount})` : ""}`
        : "Non annoté";
      setHtml(tr, raw(`
        <td class="col-check">
          <input class="meta-row-check" type="checkbox" data-id="${doc.doc_id}"
            ${isChecked ? "checked" : ""} aria-label="Sélectionner doc ${doc.doc_id}" />
        </td>
        <td class="col-id">${idx + 1}</td>
        <td class="col-title" title="${this._esc(doc.title)}">${this._esc(this._truncateMid(doc.title))}</td>
        <td class="col-lang">${this._esc(doc.language)}</td>
        <td class="col-role">${this._esc(doc.doc_role ?? "—")}</td>
        <td class="col-status">
          <span class="prep-wf-pill wf-${wfStatus}">${wfLabel}</span>
          <span class="prep-ann-pill ${annotationStatus === "annotated" ? "prep-ann-annotated" : "prep-ann-missing"}" title="${this._esc(annLabel)}">A</span>
          ${doc.fts_stale
            ? `<button type="button" class="prep-fts-stale-pill" title="Index de recherche périmé — cliquez pour reconstruire l'index FTS (job asynchrone, non bloquant).">&#9888; Index</button>`
            : ""}
        </td>
      `));
      tr.querySelector(".meta-row-check")!.addEventListener("click", (e) => {
        e.stopPropagation();
        const cb = e.target as HTMLInputElement;
        if (cb.checked) this._selectedDocIds.add(doc.doc_id);
        else this._selectedDocIds.delete(doc.doc_id);
        this._renderBatchBar();
        this._updateSelectAll();
      });
      tr.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".meta-row-check")) return;
        void this._selectDoc(doc);
      });
      this._docListEl.appendChild(tr);
    });
    this._renderBatchBar();
    this._updateSelectAll();
  }

  // ── Hierarchy view ───────────────────────────────────────────────────────────

  private async _toggleHierarchyView(): Promise<void> {
    this._hierarchyView = !this._hierarchyView;
    const btn = this._root.querySelector<HTMLButtonElement>("#meta-hierarchy-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", String(this._hierarchyView));
      btn.classList.toggle("btn-active", this._hierarchyView);
      btn.textContent = this._hierarchyView ? "📋 Liste" : "🌿 Hiérarchie";
    }
    // Disable/enable filters in hierarchy mode
    const filterInput = this._root.querySelector<HTMLInputElement>("#meta-doc-filter");
    const statusSel   = this._root.querySelector<HTMLSelectElement>("#meta-status-filter");
    if (filterInput) filterInput.disabled = this._hierarchyView;
    if (statusSel)   statusSel.disabled   = this._hierarchyView;

    if (this._hierarchyView && this._conn) {
      try {
        if (!this._allRelationsLoaded) {
          this._allRelations = await getAllDocRelations(this._conn);
          this._allRelationsLoaded = true;
        }
        if (!this._familiesLoaded) {
          this._families = await getFamilies(this._conn);
          this._familiesLoaded = true;
        }
      } catch (err) {
        this._log(`Erreur chargement relations : ${err instanceof SidecarError ? err.message : String(err)}`, true);
        this._hierarchyView = false;
        if (btn) { btn.setAttribute("aria-pressed", "false"); btn.classList.remove("btn-active"); btn.textContent = "🌿 Hiérarchie"; }
        if (filterInput) filterInput.disabled = false;
        if (statusSel)   statusSel.disabled   = false;
        return;
      }
    }
    this._renderDocList();
  }

  private _buildTree(): { roots: TreeNode[]; standalone: DocumentRecord[]; orphans: DocumentRecord[] } {
    const docMap = new Map(this._docs.map(d => [d.doc_id, d]));
    // childId → { parentId, relationLabel }
    const childOf = new Map<number, { parentId: number; label: string }>();
    // parentId → [{ childId, label }]
    const parentTo = new Map<number, { childId: number; label: string }[]>();

    for (const rel of this._allRelations) {
      // rel.doc_id is "child", rel.target_doc_id is "parent"
      if (!docMap.has(rel.doc_id)) continue;
      childOf.set(rel.doc_id, { parentId: rel.target_doc_id, label: rel.relation_type });
      if (!parentTo.has(rel.target_doc_id)) parentTo.set(rel.target_doc_id, []);
      parentTo.get(rel.target_doc_id)!.push({ childId: rel.doc_id, label: rel.relation_type });
    }

    const roots: TreeNode[] = [];
    const standalone: DocumentRecord[] = [];
    const orphans: DocumentRecord[] = [];

    for (const doc of this._docs) {
      const childInfo = childOf.get(doc.doc_id);
      if (childInfo) {
        // This doc is a child — only show it under its parent
        if (!docMap.has(childInfo.parentId)) {
          orphans.push(doc); // parent missing from corpus
        }
        continue; // will be rendered as child of parent
      }
      // Not a child — check if it has children
      const children = parentTo.get(doc.doc_id) ?? [];
      if (children.length === 0) {
        standalone.push(doc);
      } else {
        roots.push({
          doc,
          children: children
            .map(c => ({ doc: docMap.get(c.childId)!, relationLabel: c.label, children: [] }))
            .filter(n => n.doc != null),
        });
      }
    }

    return { roots, standalone, orphans };
  }

  private _renderHierarchyList(): void {
    this._docListEl.innerHTML = "";
    const { roots, standalone, orphans } = this._buildTree();
    const cmp = this._docComparator();
    roots.sort((a, b) => cmp(a.doc, b.doc));
    for (const node of roots) node.children.sort((a, b) => cmp(a.doc, b.doc));
    standalone.sort(cmp);
    orphans.sort(cmp);

    if (this._docs.length === 0) {
      this._docListEl.innerHTML = `<tr><td colspan="6" class="prep-meta-empty-cell">Aucun document.</td></tr>`;
      return;
    }

    let _rowNum = 0;
    const appendRow = (doc: DocumentRecord, depth = 0, relationLabel?: string, completionPct?: number) => {
      _rowNum++;
      const tr = document.createElement("tr");
      tr.className = "prep-meta-doc-row";
      if (depth > 0) tr.classList.add("prep-tree-child");
      if (this._selectedDoc?.doc_id === doc.doc_id) tr.classList.add("is-active");
      const isChecked = this._selectedDocIds.has(doc.doc_id);
      const wfStatus = this._workflowStatus(doc);
      const wfLabel  = this._workflowLabel(wfStatus);
      const tokenCount = Number(doc.token_count ?? 0);
      const annotationStatus = doc.annotation_status ?? (tokenCount > 0 ? "annotated" : "missing");
      const annLabel = annotationStatus === "annotated"
        ? `Annoté${tokenCount > 0 ? ` (${tokenCount})` : ""}`
        : "Non annoté";
      const indent   = depth > 0 ? `<span class="prep-tree-connector" aria-hidden="true">└</span>` : "";
      const relBadge = relationLabel
        ? `<span class="prep-tree-rel-badge">${this._esc(this._relLabel(relationLabel))}</span>`
        : "";
      const pctBadge = completionPct !== undefined
        ? `<span class="prep-family-pct-badge family-pct-${this._completionTier(completionPct)}"
              title="Famille : ${completionPct} % traité">${completionPct} %</span>`
        : "";
      setHtml(tr, raw(`
        <td class="col-check">
          <input class="meta-row-check" type="checkbox" data-id="${doc.doc_id}"
            ${isChecked ? "checked" : ""} aria-label="Sélectionner doc ${doc.doc_id}" />
        </td>
        <td class="col-id">${_rowNum}</td>
        <td class="col-title tree-title-cell" title="${this._esc(doc.title)}" style="padding-left:${0.5 + depth * 1.4}rem">
          ${indent}${relBadge}${this._esc(this._truncateMid(doc.title))}${pctBadge}
        </td>
        <td class="col-lang">${this._esc(doc.language)}</td>
        <td class="col-role">${this._esc(doc.doc_role ?? "—")}</td>
        <td class="col-status">
          <span class="prep-wf-pill wf-${wfStatus}">${wfLabel}</span>
          <span class="prep-ann-pill ${annotationStatus === "annotated" ? "prep-ann-annotated" : "prep-ann-missing"}" title="${this._esc(annLabel)}">A</span>
          ${doc.fts_stale
            ? `<button type="button" class="prep-fts-stale-pill" title="Index de recherche périmé — cliquez pour reconstruire l'index FTS (job asynchrone, non bloquant).">&#9888; Index</button>`
            : ""}
        </td>
      `));
      tr.querySelector(".meta-row-check")!.addEventListener("click", (e) => {
        e.stopPropagation();
        const cb = e.target as HTMLInputElement;
        if (cb.checked) this._selectedDocIds.add(doc.doc_id);
        else this._selectedDocIds.delete(doc.doc_id);
        this._renderBatchBar();
        this._updateSelectAll();
      });
      tr.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".meta-row-check")) return;
        void this._selectDoc(doc);
      });
      this._docListEl.appendChild(tr);
    };

    const appendSectionHeader = (label: string, count: number) => {
      const tr = document.createElement("tr");
      tr.className = "prep-tree-section-header";
      setHtml(tr, raw(`<td colspan="6" class="prep-tree-section-label">${this._esc(label)} <span class="prep-tree-section-count">${count}</span></td>`));
      this._docListEl.appendChild(tr);
    };

    // Build a quick lookup: family_id → completion_pct
    const familyPct = new Map(this._families.map(f => [f.family_id, f.stats.completion_pct]));

    // Groups with parent→children
    if (roots.length > 0) {
      for (const node of roots) {
        const pct = familyPct.get(node.doc.doc_id);
        appendRow(node.doc, 0, undefined, pct);
        for (const child of node.children) {
          appendRow(child.doc, 1, child.relationLabel);
        }
      }
    }

    // Standalone (no relations)
    if (standalone.length > 0) {
      if (roots.length > 0 || orphans.length > 0) {
        appendSectionHeader("Documents indépendants", standalone.length);
      }
      for (const doc of standalone) appendRow(doc, 0);
    }

    // Orphans (parent absent du corpus)
    if (orphans.length > 0) {
      appendSectionHeader("Relations incomplètes (parent absent)", orphans.length);
      for (const doc of orphans) appendRow(doc, 0);
    }

    this._renderBatchBar();
    this._updateSelectAll();
  }

  /** CSS tier for a completion percentage: none | low | mid | high | done. */
  private _completionTier(pct: number): string {
    if (pct === 0)   return "none";
    if (pct < 40)    return "low";
    if (pct < 80)    return "mid";
    if (pct < 100)   return "high";
    return "done";
  }

  /** Human-readable label for a relation type. */
  private _relLabel(rel: string): string {
    switch (rel) {
      case "translation_of": return "trad.";
      case "excerpt_of":     return "extrait";
      default:               return rel;
    }
  }

  private _renderBatchBar(): void {
    const count = this._selectedDocIds.size;
    if (this._batchMetaEl) {
      if (count === 0)      this._batchMetaEl.textContent = "0 sélectionné";
      else if (count === 1) this._batchMetaEl.textContent = "1 document sélectionné";
      else                  this._batchMetaEl.textContent = `${count} documents sélectionnés`;
    }
    if (this._batchBarEl) this._batchBarEl.classList.toggle("active", count > 0);
    const roleSel = this._root?.querySelector<HTMLSelectElement>("#meta-batch-role-sel");
    const roleBtn = this._root?.querySelector<HTMLButtonElement>("#meta-batch-role-btn");
    const deleteBtn = this._root?.querySelector<HTMLButtonElement>("#meta-batch-delete-btn");
    if (roleSel)  roleSel.disabled  = count === 0;
    if (roleBtn)  roleBtn.disabled  = count === 0 || !roleSel?.value;
    if (deleteBtn) deleteBtn.disabled = count === 0;
  }

  private _updateSelectAll(): void {
    if (!this._selectAllEl) return;
    const docs = this._filteredDocs();
    if (docs.length === 0) {
      this._selectAllEl.checked = false;
      this._selectAllEl.indeterminate = false;
      return;
    }
    const selectedVisible = docs.filter(d => this._selectedDocIds.has(d.doc_id)).length;
    this._selectAllEl.checked = selectedVisible === docs.length;
    this._selectAllEl.indeterminate = selectedVisible > 0 && selectedVisible < docs.length;
  }

  // ── Edit panel ──────────────────────────────────────────────────────────────

  private async _selectDoc(doc: DocumentRecord): Promise<void> {
    // Nullify selectedDoc before the new assignment so _isSelectedDocDirty()
    // returns false during the _renderDocList() → _refreshRuntimeState() call below.
    this._selectedDoc = null;
    if (this._editPanelEl) this._editPanelEl.innerHTML = "";
    this._selectedDoc = doc;
    this._unitInspector.resetForDoc(doc.doc_id);
    // Render the edit panel immediately (with current relations) so the form
    // fields exist before the async getDocRelations call. Without this, a user
    // clicking another tab during the await would trigger a false dirty-check:
    // _isSelectedDocDirty would see _selectedDoc.language="fr" but #edit-lang=""
    // (edit panel still empty) and incorrectly flag unsaved changes.
    this._relations = [];
    this._renderEditPanel();
    this._renderDocList();
    // Load relations and refresh the relations section once ready.
    if (this._conn) {
      try {
        const res = await getDocRelations(this._conn, doc.doc_id);
        this._relations = res.relations;
      } catch {
        this._relations = [];
      }
      this._renderRelationsList();
    }
    void this._unitInspector.loadDocPreview(doc.doc_id);
  }

  private _renderEditPanel(): void {
    const doc = this._selectedDoc;
    if (!doc) {
      this._editPanelEl.innerHTML = `<p class="empty-hint">Sélectionnez un document dans la liste.</p>`;
      return;
    }

    // ── Author + work_title propagation context ─────────────────────────────
    // Parent: a doc that THIS doc is a translation/excerpt of
    const parentRel = this._relations.find(r =>
      r.relation_type === "translation_of" || r.relation_type === "excerpt_of"
    );
    const parentDoc = parentRel ? this._docs.find(d => d.doc_id === parentRel.target_doc_id) : null;
    const parentHasShared = parentDoc &&
      (parentDoc.author_lastname || parentDoc.author_firstname || parentDoc.work_title);

    // Children: docs that are translations/excerpts of THIS doc (from _allRelations if loaded)
    const childDocIds = this._allRelationsLoaded
      ? this._allRelations
          .filter(r =>
            r.target_doc_id === doc.doc_id &&
            (r.relation_type === "translation_of" || r.relation_type === "excerpt_of")
          )
          .map(r => r.doc_id)
      : [];

    const inheritHtml = parentHasShared
      ? `<div class="prep-author-inherit-banner">
          <span class="prep-author-inherit-from">
            De l'original #${parentDoc!.doc_id} :
            ${parentDoc!.work_title ? `<em>${this._esc(parentDoc!.work_title)}</em> — ` : ""}
            <strong>${this._esc([parentDoc!.author_lastname, parentDoc!.author_firstname].filter(Boolean).join(", ") || "—")}</strong>
          </span>
          <button id="inherit-author-btn" class="btn btn-secondary btn-sm author-inherit-btn"
            title="Copier auteur et titre de l'œuvre depuis l'original">← Hériter</button>
        </div>`
      : "";

    const propagateHtml = childDocIds.length > 0
      ? `<button id="propagate-author-btn" class="btn btn-secondary btn-sm"
            title="Appliquer auteur et titre de l'œuvre à toutes les traductions/extraits"
            data-child-ids="${childDocIds.join(",")}">
            → Propager aux ${childDocIds.length} traduction${childDocIds.length > 1 ? "s" : ""}
          </button>`
      : (this._allRelationsLoaded ? "" :
          `<button id="propagate-author-btn" class="btn btn-secondary btn-sm"
              title="Charger les traductions et appliquer auteur et titre de l'œuvre"
              data-child-ids="">→ Propager…</button>`);

    setHtml(this._editPanelEl, raw(`
      <div class="prep-form-row">
        <label style="flex:2">Nom du fichier
          <input id="edit-title" type="text" value="${this._esc(doc.title)}" placeholder="hugo_miserables_fr_ch1">
        </label>
        <label>Langue
          <input id="edit-lang" type="text" value="${this._esc(doc.language)}" style="max-width:80px" placeholder="fr">
        </label>
      </div>
      <div class="prep-form-row">
        <label style="flex:2">Titre de l'œuvre
          <input id="edit-work-title" type="text" value="${this._esc(doc.work_title ?? "")}" placeholder="Les Misérables">
        </label>
      </div>
      <div class="prep-form-row">
        <label style="flex:1.2">Nom de l'auteur
          <input id="edit-author-lastname" type="text" value="${this._esc(doc.author_lastname ?? "")}" placeholder="Hugo">
        </label>
        <label style="flex:1.2">Prénom de l'auteur
          <input id="edit-author-firstname" type="text" value="${this._esc(doc.author_firstname ?? "")}" placeholder="Victor">
        </label>
      </div>
      <div class="prep-form-row">
        <label style="flex:1.2">Nom du traducteur
          <input id="edit-translator-lastname" type="text" value="${this._esc(doc.translator_lastname ?? "")}" placeholder="Dupont">
        </label>
        <label style="flex:1.2">Prénom du traducteur
          <input id="edit-translator-firstname" type="text" value="${this._esc(doc.translator_firstname ?? "")}" placeholder="Jean">
        </label>
      </div>
      <div class="prep-form-row">
        <label>Date
          <input id="edit-doc-date" type="text" value="${this._esc(doc.doc_date ?? "")}" placeholder="2024 ou 2024-03-15" style="max-width:130px">
        </label>
        <label style="flex:1">Lieu de publication
          <input id="edit-pub-place" type="text" value="${this._esc(doc.pub_place ?? "")}" placeholder="Paris">
        </label>
        <label style="flex:1.5">Éditeur
          <input id="edit-publisher" type="text" value="${this._esc(doc.publisher ?? "")}" placeholder="Gallimard">
        </label>
      </div>
      ${inheritHtml}
      <div class="prep-form-row">
        <label>Rôle
          <select id="edit-role">
            ${DOC_ROLES.map(r => `<option value="${r}"${r === (doc.doc_role ?? "unknown") ? " selected" : ""}>${r}</option>`).join("")}
          </select>
        </label>
        <label>Resource type
          <input id="edit-restype" type="text" value="${this._esc(doc.resource_type ?? "")}" style="max-width:220px" placeholder="littérature, article, discours…">
        </label>
      </div>
      <div class="prep-form-row">
        <label>Statut workflow
          <select id="edit-workflow-status">
            ${WORKFLOW_STATUS.map((status) => (
              `<option value="${status}"${status === this._workflowStatus(doc) ? " selected" : ""}>${this._workflowLabel(status)}</option>`
            )).join("")}
          </select>
        </label>
        <label style="flex:1">Run ID validation (optionnel)
          <input id="edit-validated-run-id" type="text" value="${this._esc(doc.validated_run_id ?? "")}" placeholder="run_...">
        </label>
      </div>
      <div class="prep-form-row" style="margin-top:-0.2rem">
        <div class="hint" style="margin:0">
          ${doc.validated_at ? `Dernière validation: ${this._esc(new Date(doc.validated_at).toLocaleString())}` : "Dernière validation: —"}
        </div>
      </div>
      <div class="prep-btn-row" style="margin-bottom:1rem">
        <button id="save-doc-btn" class="btn btn-primary btn-sm">Enregistrer</button>
        <button id="mark-review-btn" class="btn btn-secondary btn-sm">Marquer à revoir</button>
        <button id="mark-validated-btn" class="btn btn-secondary btn-sm">Valider ce document</button>
        <button id="annotate-doc-btn" class="btn btn-secondary btn-sm">Annoter (spaCy)</button>
        ${propagateHtml}
      </div>

      ${familyPanelHtml(doc, this._families)}

      <h4 style="font-size:0.88rem;font-weight:600;margin:0.5rem 0 0.3rem">Relations documentaires</h4>
      <p style="font-size:0.78rem;color:var(--color-muted);margin:0 0 0.5rem">
        Définissez comment ce document est lié à un autre (traduction, extrait…).
        Ces relations apparaîtront dans le <code>&lt;teiHeader&gt;</code> à l'export.
      </p>
      <div class="prep-form-row" style="align-items:flex-end">
        <label>Type de relation
          <select id="rel-type" style="min-width:140px">
            ${RELATION_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select>
        </label>
        <label style="flex:2">Document cible
          <select id="rel-target-sel" style="min-width:200px">
            <option value="">— sélectionner —</option>
            ${this._docs
              .filter(d => d.doc_id !== doc.doc_id)
              .sort(compareDocsByTitle)
              .map(d => `<option value="${d.doc_id}">${this._esc(d.title)} (${this._esc(d.language)})</option>`)
              .join("")}
          </select>
        </label>
        <label>Note
          <input id="rel-note" type="text" placeholder="optionnel" style="max-width:130px">
        </label>
        <button id="add-rel-btn" class="btn btn-secondary btn-sm" style="align-self:flex-end">＋ Ajouter</button>
      </div>
      <div id="relations-list" style="margin-top:0.4rem"></div>

      <div class="prep-meta-preview">
        <div class="prep-meta-preview-head">
          <h4 style="font-size:0.88rem;font-weight:600;margin:0">Aperçu rapide du contenu</h4>
          <span class="hint" style="margin:0">${this._unitInspector.previewLimit} lignes max</span>
        </div>
        <div id="meta-preview-panel"></div>
      </div>

      <div class="prep-meta-token-editor">
        <div class="prep-meta-token-head">
          <h4 style="font-size:0.88rem;font-weight:600;margin:0">Édition token par token</h4>
          <span class="hint" style="margin:0">Modifiez lemma / UPOS / XPOS / FEATS / MISC pour une unité.</span>
        </div>
        <div id="meta-token-editor-panel"></div>
      </div>
    `));

    this._renderRelationsList();
    this._unitInspector.renderPreviewPanel();
    this._unitInspector.renderTokenEditorPanel();

    this._editPanelEl.querySelector("#save-doc-btn")!.addEventListener("click", () => this._saveDoc());
    this._editPanelEl.querySelector("#mark-review-btn")!.addEventListener("click", () => this._setWorkflowStatus("review"));
    this._editPanelEl.querySelector("#mark-validated-btn")!.addEventListener("click", () => this._setWorkflowStatus("validated"));
    this._editPanelEl.querySelector("#annotate-doc-btn")!.addEventListener("click", () => void this._runAnnotateDoc());
    this._editPanelEl.querySelector("#add-rel-btn")!.addEventListener("click", () => this._addRelation());

    this._editPanelEl.querySelector<HTMLButtonElement>("#inherit-author-btn")
      ?.addEventListener("click", () => this._inheritAuthorFromParent());

    this._editPanelEl.querySelector<HTMLButtonElement>("#propagate-author-btn")
      ?.addEventListener("click", (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const ids = btn.dataset.childIds
          ? btn.dataset.childIds.split(",").map(Number).filter(Boolean)
          : [];
        void this._propagateAuthorToChildren(ids, btn);
      });

    this._editPanelEl.querySelector<HTMLButtonElement>("#seg-family-btn")
      ?.addEventListener("click", (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const familyId = Number(btn.dataset.familyId);
        void this._segmentFamilyFlow(familyId, btn);
      });

    this._editPanelEl.querySelector<HTMLButtonElement>("#aln-family-btn")
      ?.addEventListener("click", (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const familyId = Number(btn.dataset.familyId);
        void this._alignFamilyFlow(familyId, btn);
      });

    this._editPanelEl.querySelectorAll<HTMLButtonElement>(".prep-fam-export-pair-btn")
      .forEach(btn => {
        btn.addEventListener("click", () => {
          const pivotId  = Number(btn.dataset.pivot);
          const targetId = Number(btn.dataset.target);
          const pivotLang  = btn.dataset.pivotLang  ?? "und";
          const targetLang = btn.dataset.targetLang ?? "und";
          const container = this._editPanelEl.querySelector<HTMLDivElement>("#export-pair-dialog");
          if (!container) return;
          void openExportPairDialog({
            container,
            getConn: () => this._conn,
            pivotId, targetId, pivotLang, targetLang,
          });
        });
      });

    this._editPanelEl.querySelector<HTMLButtonElement>("#curation-family-btn")
      ?.addEventListener("click", (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const familyId = Number(btn.dataset.familyId);
        void this._curationFamilyFlow(familyId, btn);
      });

  }

  private _inheritAuthorFromParent(): void {
    const parentRel = this._relations.find(r =>
      r.relation_type === "translation_of" || r.relation_type === "excerpt_of"
    );
    const parent = parentRel ? this._docs.find(d => d.doc_id === parentRel.target_doc_id) : null;
    if (!parent) return;

    const lastnameEl  = this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-lastname");
    const firstnameEl = this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-firstname");
    const workTitleEl = this._editPanelEl.querySelector<HTMLInputElement>("#edit-work-title");
    if (lastnameEl)  lastnameEl.value  = parent.author_lastname  ?? "";
    if (firstnameEl) firstnameEl.value = parent.author_firstname ?? "";
    if (workTitleEl) workTitleEl.value = parent.work_title ?? "";

    // Sync _selectedDoc so dirty-check doesn't fire before the user saves.
    if (this._selectedDoc) {
      this._selectedDoc = {
        ...this._selectedDoc,
        author_lastname:  parent.author_lastname  ?? null,
        author_firstname: parent.author_firstname ?? null,
        work_title:       parent.work_title       ?? null,
      };
    }

    // Visual feedback on the button
    const btn = this._editPanelEl.querySelector<HTMLButtonElement>("#inherit-author-btn");
    if (btn) { btn.textContent = "✓ Hérité"; btn.disabled = true; }
  }

  private async _propagateAuthorToChildren(childIds: number[], btn: HTMLButtonElement): Promise<void> {
    if (!this._conn || !this._selectedDoc) return;

    // If childIds is empty, relations weren't loaded yet — load them now
    if (childIds.length === 0) {
      btn.disabled = true;
      btn.textContent = "Chargement…";
      try {
        this._allRelations = await getAllDocRelations(this._conn);
        this._allRelationsLoaded = true;
        childIds = this._allRelations
          .filter(r =>
            r.target_doc_id === this._selectedDoc!.doc_id &&
            (r.relation_type === "translation_of" || r.relation_type === "excerpt_of")
          )
          .map(r => r.doc_id);
      } catch (err) {
        this._log(`Erreur chargement relations : ${err instanceof SidecarError ? err.message : String(err)}`, true);
        btn.disabled = false;
        btn.textContent = "→ Propager…";
        return;
      }
      if (childIds.length === 0) {
        btn.textContent = "Aucun enfant trouvé";
        return;
      }
      btn.dataset.childIds = childIds.join(",");
      btn.textContent = `→ Propager aux ${childIds.length} traduction${childIds.length > 1 ? "s" : ""}`;
      btn.disabled = false;
      return; // let user confirm by clicking again
    }

    const lastname   = this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-lastname")?.value.trim() || null;
    const firstname  = this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-firstname")?.value.trim() || null;
    const work_title = this._editPanelEl.querySelector<HTMLInputElement>("#edit-work-title")?.value.trim() || null;

    if (!lastname && !firstname && !work_title) {
      this._log("Aucun auteur ni titre d'œuvre renseigné — rien à propager.", true);
      return;
    }

    const summary = [
      work_title ? `titre "${work_title}"` : null,
      (lastname || firstname) ? `auteur "${[lastname, firstname].filter(Boolean).join(", ")}"` : null,
    ].filter(Boolean).join(", ");
    const ok = await modalConfirm({
      message: `Appliquer ${summary} sur ${childIds.length} document(s) enfant(s) ?`,
      confirmLabel: "Appliquer",
      danger: false,
    });
    if (!ok) return;

    btn.disabled = true;
    btn.textContent = "Propagation…";
    try {
      const updates = childIds.map(id => ({
        doc_id: id,
        author_lastname: lastname,
        author_firstname: firstname,
        work_title,
      }));
      await bulkUpdateDocuments(this._conn, updates);
      // Update in-memory cache
      for (const id of childIds) {
        const idx = this._docs.findIndex(d => d.doc_id === id);
        if (idx >= 0) {
          this._docs[idx] = { ...this._docs[idx], author_lastname: lastname, author_firstname: firstname, work_title };
        }
      }
      btn.textContent = `✓ Propagé à ${childIds.length} doc(s)`;
      this._log(`✓ Auteur et titre d'œuvre propagés à ${childIds.length} document(s) enfant(s).`);
    } catch (err) {
      this._log(`Erreur propagation : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      btn.disabled = false;
      btn.textContent = `→ Propager aux ${childIds.length} traduction${childIds.length > 1 ? "s" : ""}`;
    }
  }

  // ── Sprint 2: family segmentation flow ──────────────────────────────────────

  private async _segmentFamilyFlow(familyRootId: number, btn: HTMLButtonElement): Promise<void> {
    if (!this._conn) return;
    const resultDiv = this._editPanelEl.querySelector<HTMLDivElement>("#seg-family-result");
    const family = this._families.find(f => f.family_id === familyRootId);

    const alreadyDone = family?.stats.segmented_docs ?? 0;

    if (alreadyDone > 0) {
      // Show inline confirmation before proceeding
      if (resultDiv) {
        setHtml(resultDiv, raw(`
          <div class="prep-seg-family-confirm">
            <p>⚠ <strong>${alreadyDone} doc(s)</strong> déjà segmenté(s) dans cette famille.
               Resegmenter effacera les alignements existants pour ces documents.</p>
            <div class="prep-btn-row" style="gap:0.5rem;flex-wrap:wrap">
              <button id="seg-skip-btn" class="btn btn-secondary btn-sm">Passer les existants</button>
              <button id="seg-force-btn" class="btn btn-danger btn-sm">Re-segmenter tout</button>
              <button id="seg-cancel-btn" class="btn btn-ghost btn-sm">Annuler</button>
            </div>
          </div>`));

        resultDiv.querySelector("#seg-skip-btn")?.addEventListener("click", async () => {
          resultDiv.innerHTML = "";
          await this._doSegmentFamily(familyRootId, false, resultDiv, btn);
        });
        resultDiv.querySelector("#seg-force-btn")?.addEventListener("click", async () => {
          resultDiv.innerHTML = "";
          await this._doSegmentFamily(familyRootId, true, resultDiv, btn);
        });
        resultDiv.querySelector("#seg-cancel-btn")?.addEventListener("click", () => {
          resultDiv.innerHTML = "";
        });
      }
      return;
    }

    // No conflict — proceed directly
    await this._doSegmentFamily(familyRootId, false, resultDiv, btn);
  }

  private async _doSegmentFamily(
    familyRootId: number,
    force: boolean,
    resultDiv: HTMLDivElement | null,
    btn: HTMLButtonElement,
  ): Promise<void> {
    if (!this._conn) return;

    btn.disabled = true;
    btn.textContent = "⟳ Segmentation…";
    if (resultDiv) resultDiv.innerHTML = `<p class="prep-seg-family-loading">Segmentation en cours…</p>`;

    try {
      const res = await segmentFamily(this._conn, familyRootId, { force });

      if (resultDiv) {
        const rows = res.results.map(r => segResultRow(r)).join("");
        const { segmented, skipped, errors } = res.summary;
        const parts: string[] = [];
        if (segmented > 0) parts.push(`<span class="prep-fam-ok">${segmented} segmenté(s)</span>`);
        if (skipped  > 0) parts.push(`<span class="prep-fam-todo">${skipped} ignoré(s)</span>`);
        if (errors   > 0) parts.push(`<span class="prep-fam-ratio-warn">${errors} erreur(s)</span>`);

        setHtml(resultDiv, raw(`
          <div class="prep-seg-family-report">
            <p class="prep-seg-report-summary">${parts.join(" · ")}</p>
            <table class="prep-fam-pairs-table">
              <thead><tr><th>Doc</th><th>Statut</th><th>Unités</th><th>Avertissements</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`));
      }

      // Refresh family panel data
      this._familiesLoaded = false;
      if (this._hierarchyView) this._renderDocList();
      if (this._conn) {
        this._families = await getFamilies(this._conn);
        this._familiesLoaded = true;
        this._renderDocList();
        if (this._selectedDoc) this._renderEditPanel();
      }

      this._log(`✓ Famille #${familyRootId} segmentée : ${res.summary.segmented} doc(s) traité(s).`);
    } catch (err) {
      const msg = err instanceof SidecarError ? err.message : String(err);
      if (resultDiv) resultDiv.innerHTML = `<p class="prep-fam-ratio-warn">Erreur : ${_escHtmlMeta(msg)}</p>`;
      this._log(`Erreur segmentation famille : ${msg}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "⟳ Segmenter la famille";
    }
  }

  // ── Sprint 3: family alignment flow ─────────────────────────────────────────

  private async _alignFamilyFlow(familyRootId: number, btn: HTMLButtonElement): Promise<void> {
    if (!this._conn) return;
    const resultDiv = this._editPanelEl.querySelector<HTMLDivElement>("#aln-family-result");
    const family = this._families.find(f => f.family_id === familyRootId);
    if (!family) return;

    // Parse pair info from data attribute (set during HTML generation)
    type PairInfo = { doc_id: number; lang: string; title: string; segmented: boolean; aligned: boolean; relation_type: string };
    let pairs: PairInfo[] = [];
    try {
      pairs = JSON.parse(btn.dataset.pairs ?? "[]") as PairInfo[];
    } catch {
      pairs = family.children.map(c => ({
        doc_id: c.doc_id,
        lang: c.doc?.language ?? "?",
        title: c.doc?.title ?? `#${c.doc_id}`,
        segmented: c.segmented,
        aligned: c.aligned_to_parent,
        relation_type: c.relation_type,
      }));
    }

    const unready = pairs.filter(p => !p.segmented);
    const alreadyAligned = pairs.filter(p => p.aligned);

    if (resultDiv && !btn.dataset.confirmed) {
      // Show pre-flight summary dialog
      const pairRows = pairs.map(p => {
        const segIcon = p.segmented ? "✓" : "⚠";
        const alnIcon = p.aligned ? "⇄" : "○";
        const segCls  = p.segmented ? "prep-fam-ok" : "prep-fam-ratio-warn";
        return `<tr>
          <td>#${familyRootId} ↔ #${p.doc_id}</td>
          <td>${this._esc(p.lang)}</td>
          <td title="${this._esc(p.title)}">${this._esc(this._truncateMid(p.title, 25))}</td>
          <td class="${segCls}">${segIcon}</td>
          <td>${alnIcon}</td>
        </tr>`;
      }).join("");

      const warnHtml = unready.length > 0
        ? `<p class="prep-fam-ratio-warn">⚠ ${unready.length} enfant(s) non segmenté(s) — seront ignorés (skip_unready).</p>`
        : "";
      const replaceHtml = alreadyAligned.length > 0
        ? `<p class="prep-seg-family-confirm" style="margin:4px 0">
             ${alreadyAligned.length} paire(s) déjà alignée(s). Remplacer les liens existants ?
             <label style="display:inline-flex;align-items:center;gap:4px;margin-left:6px">
               <input type="checkbox" id="aln-replace-chk"> Remplacer
             </label>
           </p>`
        : "";

      setHtml(resultDiv, raw(`
        <div class="prep-seg-family-confirm">
          <p><strong>Paires à aligner (stratégie : position)</strong></p>
          <table class="prep-fam-pairs-table" style="margin-bottom:6px">
            <thead><tr><th>Paire</th><th>Langue</th><th>Titre</th><th title="Segmenté">Seg.</th><th title="Aligné">Aln.</th></tr></thead>
            <tbody>${pairRows}</tbody>
          </table>
          ${warnHtml}
          ${replaceHtml}
          <div class="prep-btn-row" style="gap:0.5rem;flex-wrap:wrap;margin-top:6px">
            <button id="aln-confirm-btn" class="btn btn-primary btn-sm">⇄ Lancer l'alignement</button>
            <button id="aln-cancel-btn" class="btn btn-ghost btn-sm">Annuler</button>
          </div>
        </div>`));

      resultDiv.querySelector("#aln-cancel-btn")?.addEventListener("click", () => {
        resultDiv.innerHTML = "";
      });
      resultDiv.querySelector("#aln-confirm-btn")?.addEventListener("click", async () => {
        const replaceExisting = (resultDiv.querySelector<HTMLInputElement>("#aln-replace-chk"))?.checked ?? false;
        btn.dataset.confirmed = "1";
        resultDiv.innerHTML = "";
        await this._doAlignFamily(familyRootId, replaceExisting, resultDiv, btn);
        delete btn.dataset.confirmed;
      });
      return;
    }

    await this._doAlignFamily(familyRootId, false, resultDiv, btn);
  }

  private async _doAlignFamily(
    familyRootId: number,
    replaceExisting: boolean,
    resultDiv: HTMLDivElement | null,
    btn: HTMLButtonElement,
  ): Promise<void> {
    if (!this._conn) return;

    btn.disabled = true;
    btn.textContent = "⇄ Alignement…";
    if (resultDiv) resultDiv.innerHTML = `<p class="prep-seg-family-loading">Alignement en cours…</p>`;

    try {
      const res = await alignFamily(this._conn, familyRootId, {
        strategy: "position",
        replace_existing: replaceExisting,
        preserve_accepted: true,
        skip_unready: true,
      });

      if (resultDiv) {
        const rows = res.results.map(r => alnResultRow(r)).join("");
        const { aligned, skipped, errors, total_links_created } = res.summary;
        const parts: string[] = [];
        if (aligned > 0) parts.push(`<span class="prep-fam-ok">${aligned} paire(s) alignée(s)</span>`);
        if (skipped > 0) parts.push(`<span class="prep-fam-todo">${skipped} ignorée(s)</span>`);
        if (errors  > 0) parts.push(`<span class="prep-fam-ratio-warn">${errors} erreur(s)</span>`);
        parts.push(`${total_links_created} lien(s) créé(s)`);

        setHtml(resultDiv, raw(`
          <div class="prep-seg-family-report">
            <p class="prep-seg-report-summary">${parts.join(" · ")}</p>
            <table class="prep-fam-pairs-table">
              <thead><tr><th>Paire</th><th>Statut</th><th>Liens</th><th>Avert.</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`));
      }

      // Refresh family data
      this._familiesLoaded = false;
      if (this._conn) {
        this._families = await getFamilies(this._conn);
        this._familiesLoaded = true;
        this._renderDocList();
        if (this._selectedDoc) this._renderEditPanel();
      }

      this._log(`✓ Famille #${familyRootId} alignée : ${res.summary.total_links_created} lien(s) créé(s).`);
    } catch (err) {
      const msg = err instanceof SidecarError ? err.message : String(err);
      if (resultDiv) resultDiv.innerHTML = `<p class="prep-fam-ratio-warn">Erreur : ${_escHtmlMeta(msg)}</p>`;
      this._log(`Erreur alignement famille : ${msg}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "⇄ Aligner la famille";
    }
  }

  // ── Sprint 7 — Curation propagée ──────────────────────────────────────────

  private async _curationFamilyFlow(familyRootId: number, btn: HTMLButtonElement): Promise<void> {
    if (!this._conn) return;
    const resultDiv = this._editPanelEl.querySelector<HTMLElement>("#curation-family-result");
    if (!resultDiv) return;

    btn.disabled = true;
    btn.textContent = "Chargement…";
    resultDiv.innerHTML = `<p class="prep-seg-family-loading">Vérification de la curation…</p>`;

    try {
      const status = await getFamilyCurationStatus(this._conn, familyRootId);

      if (status.total_pending === 0) {
        resultDiv.innerHTML = `
          <div class="prep-curation-ok-msg">
            ✅ Toutes les unités alignées sont à jour — aucune révision de curation en attente.
          </div>`;
        btn.textContent = "📋 Curation";
        btn.disabled = false;
        return;
      }

      setHtml(resultDiv, raw(curationStatusHtml(status.children, familyRootId)));
      this._wireCurationButtons(resultDiv, familyRootId);
      btn.textContent = `📋 Curation (${status.total_pending})`;
    } catch (err) {
      resultDiv.innerHTML = `<p class="prep-fam-ratio-warn">Erreur curation : ${_escHtmlMeta(err instanceof SidecarError ? err.message : String(err))}</p>`;
      btn.textContent = "📋 Curation";
    } finally {
      btn.disabled = false;
    }
  }

  private _wireCurationButtons(container: HTMLElement, familyRootId: number): void {
    container.querySelectorAll<HTMLButtonElement>(".prep-curation-ack-link-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!this._conn) return;
        const linkId = Number(btn.dataset.linkId);
        btn.disabled = true;
        btn.textContent = "…";
        try {
          await acknowledgeSourceChange(this._conn, { link_ids: [linkId] });
          const row = btn.closest("tr");
          if (row) row.remove();
        } catch { btn.disabled = false; btn.textContent = "✓ Lu"; }
      });
    });

    container.querySelectorAll<HTMLButtonElement>(".prep-curation-ack-doc-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!this._conn) return;
        const docId = Number(btn.dataset.docId);
        btn.disabled = true;
        btn.textContent = "Acquittement…";
        try {
          await acknowledgeSourceChange(this._conn, { target_doc_id: docId });
          // Refresh the full curation block
          const famBtn = this._editPanelEl.querySelector<HTMLButtonElement>("#curation-family-btn");
          if (famBtn) void this._curationFamilyFlow(familyRootId, famBtn);
        } catch { btn.disabled = false; btn.textContent = "✓ Acquitter tout"; }
      });
    });
  }

  private _renderRelationsList(): void {
    const container = this._editPanelEl.querySelector<HTMLElement>("#relations-list");
    if (!container) return;
    if (this._relations.length === 0) {
      container.innerHTML = `<p class="empty-hint" style="margin-top:0.5rem;font-size:0.82rem">Aucune relation définie.</p>`;
      return;
    }
    container.innerHTML = "";
    for (const rel of this._relations) {
      const targetDoc = this._docs.find(d => d.doc_id === rel.target_doc_id);
      const targetLabel = targetDoc
        ? `#${targetDoc.doc_id} ${this._esc(targetDoc.title)} (${this._esc(targetDoc.language)})`
        : `doc #${rel.target_doc_id}`;

      const row = document.createElement("div");
      row.style.cssText = [
        "display:flex;align-items:center;gap:0.6rem;font-size:0.82rem",
        "padding:0.3rem 0.5rem;border-radius:4px;background:#f8f9fa",
        "border:1px solid var(--color-border);margin-bottom:0.3rem",
      ].join(";");
      setHtml(row, raw(`
        <span style="font-weight:600;color:#4a6fa5;white-space:nowrap">${this._esc(rel.relation_type)}</span>
        <span style="color:var(--color-muted)">→</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${targetLabel}</span>
        ${rel.note ? `<span style="font-style:italic;color:var(--color-muted);font-size:0.78rem">${this._esc(rel.note)}</span>` : ""}
        <button class="btn btn-danger btn-sm del-rel-btn" data-id="${rel.id}" aria-label="Supprimer cette relation" title="Supprimer cette relation">✕</button>
      `));
      row.querySelector(".del-rel-btn")!.addEventListener("click", () => this._deleteRelation(rel.id));
      container.appendChild(row);
    }
  }

  private async _saveDoc(): Promise<void> {
    if (!this._conn || !this._selectedDoc) return;
    const title = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-title")!).value.trim();
    const language = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-lang")!).value.trim();
    const doc_role = (this._editPanelEl.querySelector<HTMLSelectElement>("#edit-role")!).value;
    const resource_type = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-restype")!).value.trim() || undefined;
    const workflow_status = this._workflowStatusFromForm();
    const validated_run_id = this._validatedRunIdFromForm();
    const author_lastname = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-lastname")!).value.trim() || null;
    const author_firstname = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-firstname")!).value.trim() || null;
    const doc_date = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-doc-date")!).value.trim() || null;
    const translator_lastname = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-translator-lastname")!).value.trim() || null;
    const translator_firstname = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-translator-firstname")!).value.trim() || null;
    const work_title = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-work-title")!).value.trim() || null;
    const pub_place = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-pub-place")!).value.trim() || null;
    const publisher = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-publisher")!).value.trim() || null;

    const btn = this._editPanelEl.querySelector<HTMLButtonElement>("#save-doc-btn")!;
    btn.disabled = true;
    try {
      const res = await updateDocument(this._conn, {
        doc_id: this._selectedDoc.doc_id,
        title: title || undefined,
        language: language || undefined,
        doc_role: doc_role || undefined,
        resource_type,
        workflow_status,
        ...(workflow_status === "validated" && validated_run_id
          ? { validated_run_id }
          : {}),
        author_lastname,
        author_firstname,
        doc_date,
        translator_lastname,
        translator_firstname,
        work_title,
        pub_place,
        publisher,
      });
      const updated = res.doc;
      this._applyUpdatedDoc(updated);
      this._log(`✓ Document #${updated.doc_id} mis à jour.`);
    } catch (err) {
      this._log(`Erreur sauvegarde: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      btn.disabled = false;
    }
  }

  private async _setWorkflowStatus(status: WorkflowStatus): Promise<void> {
    if (!this._conn || !this._selectedDoc) return;
    const validated_run_id = this._validatedRunIdFromForm();
    const btnId = status === "validated" ? "#mark-validated-btn" : "#mark-review-btn";
    const btn = this._editPanelEl.querySelector<HTMLButtonElement>(btnId);
    if (btn) btn.disabled = true;
    try {
      const res = await updateDocument(this._conn, {
        doc_id: this._selectedDoc.doc_id,
        workflow_status: status,
        ...(status === "validated" && validated_run_id ? { validated_run_id } : {}),
      });
      this._applyUpdatedDoc(res.doc);
      this._log(
        status === "validated"
          ? `✓ Document #${res.doc.doc_id} validé.`
          : `✓ Document #${res.doc.doc_id} marqué à revoir.`,
      );
    } catch (err) {
      this._log(`Erreur workflow: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  private async _addRelation(): Promise<void> {
    if (!this._conn || !this._selectedDoc) return;
    const rel_type = (this._editPanelEl.querySelector<HTMLSelectElement>("#rel-type")!).value;
    const target_sel = this._editPanelEl.querySelector<HTMLSelectElement>("#rel-target-sel");
    const target_str = target_sel?.value?.trim() ?? "";
    const note = (this._editPanelEl.querySelector<HTMLInputElement>("#rel-note")!).value.trim() || undefined;
    const target_doc_id = parseInt(target_str);
    if (!target_str || isNaN(target_doc_id)) {
      this._log("Sélectionnez un document cible.", true);
      return;
    }
    if (target_doc_id === this._selectedDoc.doc_id) {
      this._log("Un document ne peut pas être sa propre cible.", true);
      return;
    }
    try {
      await setDocRelation(this._conn, {
        doc_id: this._selectedDoc.doc_id,
        relation_type: rel_type,
        target_doc_id,
        note,
      });
      // Auto-assign doc_role based on relation type
      if (rel_type === "translation_of" || rel_type === "excerpt_of") {
        const childRole  = rel_type === "translation_of" ? "translation" : "excerpt";
        const parentRole = "original";
        const childDoc   = this._selectedDoc;
        const parentDoc  = this._docs.find(d => d.doc_id === target_doc_id);
        if (!["original", "translation", "excerpt"].includes(childDoc.doc_role ?? "")) {
          await updateDocument(this._conn, { doc_id: childDoc.doc_id, doc_role: childRole });
          childDoc.doc_role = childRole;
        }
        if (parentDoc && !["original", "translation", "excerpt"].includes(parentDoc.doc_role ?? "")) {
          await updateDocument(this._conn, { doc_id: parentDoc.doc_id, doc_role: parentRole });
          parentDoc.doc_role = parentRole;
        }
      }
      const res = await getDocRelations(this._conn, this._selectedDoc.doc_id);
      this._relations = res.relations;
      this._allRelationsLoaded = false;
      this._familiesLoaded = false;
      this._renderRelationsList();
      if (this._hierarchyView && this._conn) {
        this._allRelations = await getAllDocRelations(this._conn);
        this._families = await getFamilies(this._conn);
        this._allRelationsLoaded = true;
        this._familiesLoaded = true;
      }
      this._renderDocList();
      this._log(`✓ Relation ${rel_type} → doc #${target_doc_id} ajoutée.`);
    } catch (err) {
      this._log(`Erreur ajout relation: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private async _deleteRelation(id: number): Promise<void> {
    if (!this._conn || !this._selectedDoc) return;
    const ok = await modalConfirm({
      message: "Supprimer cette relation ?",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDocRelation(this._conn, id);
      this._relations = this._relations.filter(r => r.id !== id);
      if (this._conn && this._hierarchyView) {
        this._allRelations = await getAllDocRelations(this._conn);
        this._families = await getFamilies(this._conn);
        this._allRelationsLoaded = true;
        this._familiesLoaded = true;
      } else {
        this._allRelationsLoaded = false;
        this._familiesLoaded = false;
      }
      this._renderRelationsList();
      this._renderDocList();
      this._log(`✓ Relation #${id} supprimée.`);
    } catch (err) {
      this._log(`Erreur suppression: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  // ── Bulk update ─────────────────────────────────────────────────────────────

  private async _runBulkUpdate(): Promise<void> {
    if (!this._conn || this._docs.length === 0) return;
    const doc_role = (this._root.querySelector<HTMLSelectElement>("#bulk-role")!).value || undefined;
    const resource_type = (this._root.querySelector<HTMLInputElement>("#bulk-restype")!).value.trim() || undefined;
    if (!doc_role && !resource_type) return;

    const msg = `Appliquer ${doc_role ? `doc_role="${doc_role}"` : ""} ${resource_type ? `resource_type="${resource_type}"` : ""} à ${this._docs.length} documents ?`;
    const ok = await modalConfirm({ message: msg, confirmLabel: "Appliquer", danger: false });
    if (!ok) return;

    const updates = this._docs.map(d => ({
      doc_id: d.doc_id,
      ...(doc_role ? { doc_role } : {}),
      ...(resource_type ? { resource_type } : {}),
    }));

    const btn = this._root.querySelector<HTMLButtonElement>("#bulk-apply-btn")!;
    btn.disabled = true;
    try {
      const res = await bulkUpdateDocuments(this._conn, updates);
      this._log(`✓ ${res.updated} document(s) mis à jour.`);
      await this._refreshDocList();
    } catch (err) {
      this._log(`Erreur bulk update: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      btn.disabled = false;
    }
  }

  private async _runBatchRoleUpdate(): Promise<void> {
    if (!this._conn || this._selectedDocIds.size === 0) return;
    const sel = this._root.querySelector<HTMLSelectElement>("#meta-batch-role-sel")!;
    const doc_role = sel.value;
    if (!doc_role || !DOC_ROLES.includes(doc_role)) return;
    const updates = [...this._selectedDocIds].map(doc_id => ({ doc_id, doc_role }));
    const btn = this._root.querySelector<HTMLButtonElement>("#meta-batch-role-btn")!;
    btn.disabled = true;
    try {
      const res = await bulkUpdateDocuments(this._conn, updates);
      this._log(`✓ ${res.updated} document(s) — rôle défini : "${doc_role}".`);
      await this._refreshDocList();
    } catch (err) {
      this._log(`Erreur batch rôle: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      this._renderBatchBar();
    }
  }

  private async _runBatchDelete(): Promise<void> {
    if (!this._conn || this._selectedDocIds.size === 0) return;
    const ids = [...this._selectedDocIds];
    const n = ids.length;
    const label = n === 1 ? "ce document" : `ces ${n} documents`;
    const confirmed = await modalConfirm({
      title: `Supprimer ${label} ?`,
      message: `Cette action est irréversible : toutes les unités, les alignements et les relations associés seront également supprimés.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!confirmed) return;

    const btn = this._root?.querySelector<HTMLButtonElement>("#meta-batch-delete-btn");
    if (btn) btn.disabled = true;
    try {
      const res = await deleteDocuments(this._conn, ids);
      this._selectedDocIds.clear();
      this._selectedDoc = null;
      this._log(`✓ ${res.deleted} document(s) supprimé(s).`);
      await this._refreshDocList();
      // Si le panneau d'audit est ouvert, le relancer pour refléter les suppressions
      if (this._auditPanel.isOpen()) {
        await this._runAudit();
      }
    } catch (err) {
      this._log(`Erreur suppression : ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      this._renderBatchBar();
    }
  }

  // ── Validate metadata ───────────────────────────────────────────────────────

  private async _runValidate(): Promise<void> {
    if (!this._conn) return;
    try {
      const res = await validateMeta(this._conn);
      const invalid = res.results.filter(r => !r.is_valid);
      const warned = res.results.filter(r => r.warnings.length > 0);
      if (warned.length === 0) {
        this._log(`✓ Validation: ${res.docs_validated} docs, aucun problème.`);
      } else {
        this._log(`⚠ Validation: ${res.docs_validated} docs — ${invalid.length} invalides, ${warned.length} avec avertissements.`);
        for (const r of warned) {
          for (const w of r.warnings) {
            this._log(`  doc #${r.doc_id}: ${w}`, !r.is_valid);
          }
        }
      }
    } catch (err) {
      this._log(`Erreur validation: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    }
  }

  private async _runAnnotateDoc(): Promise<void> {
    if (!this._conn || !this._selectedDoc) return;
    const doc = this._selectedDoc;
    const btn = this._editPanelEl.querySelector<HTMLButtonElement>("#annotate-doc-btn");
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    try {
      const job = await annotate(this._conn, { doc_id: doc.doc_id });
      this._log(`⏳ Annotation soumise pour doc #${doc.doc_id} (job ${job.job_id}).`);
      this._showToast?.(`✓ Annotation lancée pour #${doc.doc_id}`);

      if (this._jobCenter) {
        this._jobCenter.trackJob(job.job_id, `Annotation #${doc.doc_id}`, (done) => {
          if (done.status === "done") {
            const result = (done.result ?? {}) as Record<string, unknown>;
            const tokens = Number(result.tokens_written ?? 0);
            this._log(`✓ Annotation terminée pour #${doc.doc_id} (${tokens} token(s)).`);
            this._showToast?.(`✓ Annotation #${doc.doc_id} terminée (${tokens} token(s)).`);
            void this._refreshDocList();
          } else if (done.status === "canceled") {
            this._log(`↩ Annotation annulée pour #${doc.doc_id}.`, true);
            this._showToast?.(`↩ Annotation #${doc.doc_id} annulée.`, true);
          } else {
            this._log(`✗ Annotation en erreur pour #${doc.doc_id}: ${done.error ?? "erreur inconnue"}`, true);
            this._showToast?.(`✗ Annotation #${doc.doc_id} en erreur`, true);
          }
          const annotateBtn = this._editPanelEl.querySelector<HTMLButtonElement>("#annotate-doc-btn");
          if (annotateBtn) annotateBtn.disabled = false;
        });
      } else if (btn) {
        btn.disabled = false;
      }
    } catch (err) {
      this._log(`Erreur annotation: ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Impossible de lancer l'annotation", true);
      if (btn) btn.disabled = false;
    }
  }

  private async _runDbBackup(): Promise<void> {
    if (!this._conn) return;
    const btn = this._root.querySelector<HTMLButtonElement>("#db-backup-btn");
    const status = this._root.querySelector<HTMLElement>("#db-backup-status");
    if (!btn || !status) return;
    btn.disabled = true;
    status.textContent = "Sauvegarde en cours…";
    status.style.color = "var(--color-muted)";
    try {
      const res = await backupDatabase(this._conn);
      const file = res.backup_path.split(/[\\/]/).pop() ?? res.backup_path;
      status.textContent = `Dernière sauvegarde: ${file}`;
      status.style.color = "var(--color-ok)";
      this._log(`✓ Sauvegarde DB créée: ${res.backup_path}`);
    } catch (err) {
      status.textContent = "Erreur de sauvegarde";
      status.style.color = "var(--color-danger)";
      this._log(`Erreur sauvegarde DB: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      btn.disabled = false;
    }
  }

  private async _runDbExport(): Promise<void> {
    if (!this._conn) return;
    const btn = this._root.querySelector<HTMLButtonElement>("#db-export-btn");
    const status = this._root.querySelector<HTMLElement>("#db-backup-status");
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    let outPath: string | null;
    try {
      outPath = await dialogSave({
        title: "Exporter le corpus",
        defaultPath: `corpus_${stamp}.db`,
        filters: [{ name: "Base de données AGRAFES", extensions: ["db"] }],
      });
    } catch {
      btn.disabled = false;
      return;
    }
    if (!outPath) { btn.disabled = false; return; }
    if (status) { status.textContent = "Export en cours…"; status.style.color = "var(--color-muted)"; }
    try {
      const res = await backupDatabase(this._conn, { out_path: outPath });
      const file = res.backup_path.split(/[\\/]/).pop() ?? res.backup_path;
      if (status) { status.textContent = `Exporté: ${file}`; status.style.color = "var(--color-ok)"; }
      this._log(`✓ Corpus exporté: ${res.backup_path}`);
    } catch (err) {
      const msg = err instanceof SidecarError && err.httpStatus === 409
        ? "Fichier déjà existant — choisissez un autre nom"
        : (err instanceof SidecarError ? err.message : String(err));
      if (status) { status.textContent = "Erreur d'export"; status.style.color = "var(--color-danger)"; }
      this._log(`Erreur export corpus: ${msg}`, true);
    } finally {
      btn.disabled = false;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  setLogEl(el: HTMLElement): void {
    this._logEl = el;
  }

  private _log(msg: string, isError = false): void {
    const line = document.createElement("div");
    line.className = "log-line" + (isError ? " log-error" : "");
    line.dataset.source = "documents";
    line.textContent = `[${new Date().toLocaleTimeString()}] [Docs] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
    if (isError) {
      this._lastErrorMsg = msg;
    } else if (msg.startsWith("✓")) {
      this._lastErrorMsg = null;
    }
    this._refreshRuntimeState();
  }

  private _updateDocCount(): void {
    if (!this._docCountEl) return;
    const total = this._docs.length;
    const shown = this._filteredDocs().length;
    if (this._docFilter || this._statusFilter !== "all") {
      this._docCountEl.textContent = `${shown} / ${total} document${total > 1 ? "s" : ""}`;
    } else {
      this._docCountEl.textContent = `${total} document${total > 1 ? "s" : ""}`;
    }
    // Update KPI bar
    if (this._kpiBarEl) {
      const validated = this._docs.filter(d => this._workflowStatus(d) === "validated").length;
      const todo      = total - validated;
      const langs     = new Set(this._docs.map(d => d.language)).size;
      const set = (id: string, text: string) => {
        const el = this._kpiBarEl.querySelector(`#${id}`);
        if (el) el.textContent = text;
      };
      set("meta-kpi-total", `${total} doc${total !== 1 ? "s" : ""}`);
      set("prep-meta-kpi-ok",    `${validated} validé${validated !== 1 ? "s" : ""}`);
      set("prep-meta-kpi-warn",  `${todo} à traiter`);
      set("meta-kpi-langs", `${langs} langue${langs !== 1 ? "s" : ""}`);
    }
    this._refreshRuntimeState();
  }

  private _filteredDocs(): DocumentRecord[] {
    let docs = this._docs;
    if (this._statusFilter !== "all") {
      docs = docs.filter(doc => {
        const wf = this._workflowStatus(doc);
        if (this._statusFilter === "ok") return wf === "validated";
        if (this._statusFilter === "todo") return wf === "draft" || wf === "review";
        return true;
      });
    }
    if (this._docFilter) {
      const q = this._docFilter;
      docs = docs.filter((doc) => {
        const title   = (doc.title ?? "").toLowerCase();
        const lang    = (doc.language ?? "").toLowerCase();
        const role    = (doc.doc_role ?? "").toLowerCase();
        const restype = (doc.resource_type ?? "").toLowerCase();
        const id      = String(doc.doc_id);
        return title.includes(q) || lang.includes(q) || role.includes(q) || restype.includes(q) || id.includes(q);
      });
    }
    docs = [...docs].sort(this._docComparator());
    return docs;
  }

  private _docComparator(): (a: DocumentRecord, b: DocumentRecord) => number {
    const dir = this._sortDir === "asc" ? 1 : -1;
    const col = this._sortCol;
    return (a, b) => {
      switch (col) {
        case "id":     return dir * (a.doc_id - b.doc_id);
        case "title":  return dir * compareDocsByTitle(a, b);
        case "lang":   return dir * compareLocale(a.language, b.language);
        case "role":   return dir * compareLocale(a.doc_role, b.doc_role);
        case "status": return dir * compareLocale(this._workflowStatus(a), this._workflowStatus(b));
        default:       return 0;
      }
    };
  }

  private _esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /** Middle-truncate long titles: "Lorem ipsum…sit amet" — preserves start and end. */
  private _truncateMid(text: string, maxChars = 42): string {
    if (!text || text.length <= maxChars) return text;
    const tail = Math.max(8, Math.floor(maxChars * 0.35));
    const head = maxChars - tail - 1; // 1 for the ellipsis
    return text.slice(0, head) + "…" + text.slice(-tail);
  }

  private _workflowStatus(doc: DocumentRecord): WorkflowStatus {
    if (doc.workflow_status === "review" || doc.workflow_status === "validated") return doc.workflow_status;
    return "draft";
  }

  private _workflowStatusFromForm(): WorkflowStatus {
    const raw = (this._editPanelEl.querySelector<HTMLSelectElement>("#edit-workflow-status")?.value ?? "draft") as WorkflowStatus;
    if (raw === "review" || raw === "validated") return raw;
    return "draft";
  }

  private _validatedRunIdFromForm(): string | undefined {
    const runId = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-validated-run-id")?.value ?? "").trim();
    return runId || undefined;
  }

  private _workflowLabel(status: WorkflowStatus): string {
    if (status === "review") return "À revoir";
    if (status === "validated") return "Validé";
    return "Brouillon";
  }

  private _applyUpdatedDoc(updated: DocumentRecord): void {
    this._selectedDoc = { ...this._selectedDoc, ...updated };
    const idx = this._docs.findIndex(d => d.doc_id === updated.doc_id);
    if (idx >= 0) this._docs[idx] = { ...this._docs[idx], ...updated };
    this._renderDocList();
    this._renderEditPanel();
  }

  private _hasBulkDraftValues(): boolean {
    const role    = this._root.querySelector<HTMLSelectElement>("#bulk-role");
    const restype = this._root.querySelector<HTMLInputElement>("#bulk-restype");
    return Boolean((role?.value ?? "").trim() || (restype?.value ?? "").trim());
  }

  private _isSelectedDocDirty(): boolean {
    if (!this._selectedDoc || !this._editPanelEl) return false;
    const title           = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-title")?.value ?? "").trim();
    const language        = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-lang")?.value ?? "").trim();
    const docRole         = (this._editPanelEl.querySelector<HTMLSelectElement>("#edit-role")?.value ?? "").trim();
    const resourceType    = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-restype")?.value ?? "").trim();
    const workflow        = (this._editPanelEl.querySelector<HTMLSelectElement>("#edit-workflow-status")?.value ?? "draft").trim();
    const validatedRunId  = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-validated-run-id")?.value ?? "").trim();
    const authorLastname       = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-lastname")?.value ?? "").trim();
    const authorFirstname      = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-firstname")?.value ?? "").trim();
    const docDate              = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-doc-date")?.value ?? "").trim();
    const translatorLastname   = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-translator-lastname")?.value ?? "").trim();
    const translatorFirstname  = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-translator-firstname")?.value ?? "").trim();
    const workTitle            = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-work-title")?.value ?? "").trim();
    const pubPlace             = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-pub-place")?.value ?? "").trim();
    const publisher            = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-publisher")?.value ?? "").trim();

    const baseTitle               = (this._selectedDoc.title ?? "").trim();
    const baseLanguage            = (this._selectedDoc.language ?? "").trim();
    // If doc_role is not in the select options, the browser picks the first option.
    // Normalize base to match what the select actually shows.
    const rawDocRole = (this._selectedDoc.doc_role ?? "unknown").trim();
    const baseDocRole = DOC_ROLES.includes(rawDocRole) ? rawDocRole : DOC_ROLES[0];
    const baseResourceType        = (this._selectedDoc.resource_type ?? "").trim();
    const baseWorkflow            = this._workflowStatus(this._selectedDoc);
    const baseValidatedRunId      = (this._selectedDoc.validated_run_id ?? "").trim();
    const baseAuthorLastname      = (this._selectedDoc.author_lastname ?? "").trim();
    const baseAuthorFirstname     = (this._selectedDoc.author_firstname ?? "").trim();
    const baseDocDate             = (this._selectedDoc.doc_date ?? "").trim();
    const baseTranslatorLastname  = (this._selectedDoc.translator_lastname ?? "").trim();
    const baseTranslatorFirstname = (this._selectedDoc.translator_firstname ?? "").trim();
    const baseWorkTitle           = (this._selectedDoc.work_title ?? "").trim();
    const basePubPlace            = (this._selectedDoc.pub_place ?? "").trim();
    const basePublisher           = (this._selectedDoc.publisher ?? "").trim();

    return (
      title !== baseTitle ||
      language !== baseLanguage ||
      docRole !== baseDocRole ||
      resourceType !== baseResourceType ||
      workflow !== baseWorkflow ||
      validatedRunId !== baseValidatedRunId ||
      authorLastname !== baseAuthorLastname ||
      authorFirstname !== baseAuthorFirstname ||
      docDate !== baseDocDate ||
      translatorLastname !== baseTranslatorLastname ||
      translatorFirstname !== baseTranslatorFirstname ||
      workTitle !== baseWorkTitle ||
      pubPlace !== basePubPlace ||
      publisher !== basePublisher
    );
  }

  private _hasPendingRelationDraft(): boolean {
    if (!this._editPanelEl) return false;
    const relTarget = (this._editPanelEl.querySelector<HTMLSelectElement>("#rel-target-sel")?.value ?? "").trim();
    const relNote   = (this._editPanelEl.querySelector<HTMLInputElement>("#rel-note")?.value ?? "").trim();
    return Boolean(relTarget || relNote);
  }

  private _setRuntimeState(kind: "ok" | "info" | "warn" | "error", text: string): void {
    if (!this._stateEl) return;
    this._stateEl.className = `prep-runtime-state prep-state-${kind}`;
    this._stateEl.textContent = text;
  }

  private _refreshRuntimeState(): void {
    if (!this._stateEl) return;
    if (!this._conn) {
      this._setRuntimeState("error", "Sidecar indisponible. Ouvrez ou créez un corpus.");
      return;
    }
    if (this._isBusy) {
      this._setRuntimeState("info", "Chargement en cours…");
      return;
    }
    if (this._lastErrorMsg) {
      this._setRuntimeState("error", `Dernière erreur: ${this._lastErrorMsg}`);
      return;
    }
    if (this.hasPendingChanges()) {
      this._setRuntimeState("warn", "Modifications locales non enregistrées.");
      return;
    }
    this._setRuntimeState("ok", `${this._docs.length} document(s) chargés. Prêt.`);
  }

  // ── Corpus audit ─────────────────────────────────────────────────────────────

  private async _runAudit(): Promise<void> {
    if (!this._conn) {
      this._setRuntimeState("error", "Sidecar indisponible.");
      return;
    }
    const btn = this._root.querySelector<HTMLButtonElement>("#audit-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Audit en cours…"; }
    try {
      this._auditPanel.render(await getCorpusAudit(this._conn, this._auditRatioThreshold));
    } catch (err) {
      this._lastErrorMsg = err instanceof SidecarError ? err.message : String(err);
      this._refreshRuntimeState();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "🔍 Audit corpus"; }
    }
  }

  private async _auditSegmentFamilies(familyRootIds: number[]): Promise<void> {
    if (!this._conn) return;
    for (const id of familyRootIds) {
      try {
        await segmentFamily(this._conn, id, { force: false });
      } catch { /* continue to next */ }
    }
    this._log(`✓ Segmentation demandée pour ${familyRootIds.length} famille(s). Rafraîchissement de l'audit…`);
    await this._runAudit();
  }

  private async _auditAlignFamilies(familyRootIds: number[]): Promise<void> {
    if (!this._conn) return;
    for (const id of familyRootIds) {
      try {
        await alignFamily(this._conn, id, { strategy: "position", skip_unready: true });
      } catch { /* continue to next */ }
    }
    this._log(`✓ Alignement demandé pour ${familyRootIds.length} famille(s). Rafraîchissement de l'audit…`);
    await this._runAudit();
  }

  // ── Audit helpers ─────────────────────────────────────────────────────────

  /**
   * Toggle a group of ids in the shared selection and refresh the doc list /
   * batch bar. Returns the new "is now selected" state so the audit panel can
   * sync its own checkboxes and button labels (it owns that DOM).
   */
  private _auditSelectIds(ids: number[]): boolean {
    // Toggle: if all ids are already selected → deselect, otherwise select all
    const allSelected = ids.every(id => this._selectedDocIds.has(id));
    if (allSelected) {
      ids.forEach(id => this._selectedDocIds.delete(id));
    } else {
      ids.forEach(id => this._selectedDocIds.add(id));
    }

    this._renderDocList();
    this._renderBatchBar();

    // Scroll so the user sees the batch bar when selecting
    if (!allSelected) this._batchBarEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });

    return !allSelected;
  }

  /** Add/remove a single doc from the shared selection (one audit-row checkbox). */
  private _auditToggleOne(docId: number, checked: boolean): void {
    if (checked) this._selectedDocIds.add(docId);
    else this._selectedDocIds.delete(docId);
    this._renderBatchBar();
    if (checked) this._batchBarEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  private _auditNavToDoc(docId: number): void {
    const doc = this._docs.find(d => d.doc_id === docId);
    if (!doc) return;
    this._selectedDoc = doc;
    this._renderDocList();
    this._renderEditPanel();
    this._editPanelEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  dispose(): void { /* nothing to clean up */ }
}

function _escHtmlMeta(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
