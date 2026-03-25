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

import type { Conn } from "../lib/sidecarClient.ts";
import {
  listDocuments,
  getDocumentPreview,
  updateDocument,
  bulkUpdateDocuments,
  deleteDocuments,
  getDocRelations,
  getAllDocRelations,
  getFamilies,
  segmentFamily,
  alignFamily,
  exportTmx,
  exportBilingual,
  setDocRelation,
  deleteDocRelation,
  backupDatabase,
  validateMeta,
  getCorpusAudit,
  type DocumentRecord,
  type DocumentPreviewLine,
  type DocRelationRecord,
  type CorpusAuditResult,
  type FamilyRecord,
  type FamilySegmentDocResult,
  type FamilyAlignPairResult,
  type FamilyAuditData,
  type BilingualPreviewPair,
  SidecarError,
} from "../lib/sidecarClient.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";

const DOC_ROLES = ["standalone", "original", "translation", "excerpt", "unknown"];
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
  private _previewLines: DocumentPreviewLine[] = [];
  private _previewTotalLines = 0;
  private _previewLimit = 6;
  private _previewLoading = false;
  private _previewError: string | null = null;
  private _previewDocId: number | null = null;

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
  private _logEl!: HTMLElement;
  private _docCountEl!: HTMLElement;
  private _stateEl!: HTMLElement;
  private _kpiBarEl!: HTMLElement;
  private _batchBarEl!: HTMLElement;
  private _batchMetaEl!: HTMLElement;
  private _selectAllEl!: HTMLInputElement;
  private _isBusy = false;
  private _lastErrorMsg: string | null = null;
  private _lastRefreshAt = 0;
  private _auditResult: CorpusAuditResult | null = null;
  private _auditPanelEl!: HTMLElement;
  private _auditRatioThreshold = 15;
  private _sortCol: SortCol = "id";
  private _sortDir: "asc" | "desc" = "asc";

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._docFilter = "";
    this._statusFilter = "all";
    this._selectedDoc = null;
    this._selectedDocIds = new Set();
    this._relations = [];
    this._previewLines = [];
    this._previewTotalLines = 0;
    this._previewError = null;
    this._previewDocId = null;
    this._previewLoading = false;
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

    root.innerHTML = `
      <!-- Head card: title + state banner + KPI bar + corpus actions -->
      <div class="card meta-screen-head">
        <div class="meta-head-top">
          <div>
            <h2 class="screen-title" style="margin:0 0 4px">Documents</h2>
            <p class="meta-head-desc">Sélectionnez un document pour éditer ses métadonnées ou utilisez l'édition en masse.</p>
          </div>
          <div id="meta-state-banner" class="runtime-state state-info" aria-live="polite">
            En attente de connexion sidecar…
          </div>
        </div>
        <div class="meta-head-bottom">
          <div id="meta-kpi-bar" class="meta-kpi-bar">
            <span id="meta-kpi-total"  class="meta-kpi">0 doc</span>
            <span id="meta-kpi-ok"    class="meta-kpi meta-kpi-ok">0 validés</span>
            <span id="meta-kpi-warn"  class="meta-kpi meta-kpi-warn">0 à traiter</span>
            <span id="meta-kpi-langs" class="meta-kpi">0 langues</span>
          </div>
          <div class="meta-head-actions">
            <button id="db-backup-btn" class="btn btn-secondary btn-sm">Sauvegarder la DB</button>
            <span id="db-backup-status" class="hint" style="margin:0">Aucune sauvegarde récente</span>
            <button id="validate-btn" class="btn btn-secondary btn-sm">Valider métadonnées</button>
            <button id="audit-btn" class="btn btn-secondary btn-sm">🔍 Audit corpus</button>
            <label class="audit-ratio-label" title="Seuil d'avertissement pour le ratio de segments parent/enfant">
              Seuil ratio
              <input id="audit-ratio-input" type="number" min="1" max="100" value="15"
                     class="audit-ratio-input" style="width:52px">%
            </label>
          </div>
        </div>
        <!-- Audit panel — shown after clicking "Audit corpus" -->
        <div id="meta-audit-panel" class="meta-audit-panel" hidden></div>
      </div>

      <!-- 2-col workspace -->
      <div class="meta-layout">

        <!-- Left column: document list (not collapsible — always visible) -->
        <section class="card meta-list-card">
          <div class="meta-list-head">
            <div class="meta-list-head-left">
              <h3 style="margin:0">Documents</h3>
              <button id="refresh-docs-btn" class="btn btn-secondary btn-sm meta-refresh-btn"
                aria-label="Actualiser la liste des documents" title="Recharger la liste depuis la base">↻ Actualiser</button>
            </div>
            <span id="meta-doc-count" class="hint" style="margin:0">0 document</span>
          </div>
          <div class="meta-list-toolbar">
            <input id="meta-doc-filter" type="text"
              placeholder="Titre, langue, #id…" class="meta-filter-input" />
            <select id="meta-status-filter" class="meta-filter-select">
              <option value="all">Tous statuts</option>
              <option value="ok">Validé</option>
              <option value="todo">Brouillon / À revoir</option>
            </select>
            <button id="meta-reset-filter" class="btn btn-secondary btn-sm"
              aria-label="Réinitialiser les filtres" title="Réinitialiser">↺</button>
            <button id="meta-hierarchy-btn" class="btn btn-secondary btn-sm"
              title="Basculer entre vue liste et vue hiérarchique" aria-pressed="false">🌿 Hiérarchie</button>
          </div>
          <div class="meta-doc-list-wrap">
            <table class="meta-doc-table" aria-label="Documents du corpus">
              <thead>
                <tr>
                  <th class="col-check">
                    <input id="meta-select-all" type="checkbox" aria-label="Sélectionner tout" />
                  </th>
                  <th class="col-id sortable-th" data-sort="id">ID <span class="sort-ind" aria-hidden="true"></span></th>
                  <th class="col-title sortable-th" data-sort="title">Titre <span class="sort-ind" aria-hidden="true"></span></th>
                  <th class="col-lang sortable-th" data-sort="lang">Langue <span class="sort-ind" aria-hidden="true"></span></th>
                  <th class="col-role sortable-th" data-sort="role">Rôle <span class="sort-ind" aria-hidden="true"></span></th>
                  <th class="col-status sortable-th" data-sort="status">Statut <span class="sort-ind" aria-hidden="true"></span></th>
                </tr>
              </thead>
              <tbody id="meta-doc-list"></tbody>
            </table>
          </div>
          <div id="meta-batch-bar" class="meta-batch-bar">
            <span id="meta-batch-meta" class="meta-batch-meta">0 sélectionné</span>
            <div class="meta-batch-actions">
              <button id="meta-batch-role-btn" class="btn btn-secondary btn-sm" disabled>Définir rôle</button>
              <button id="meta-batch-delete-btn" class="btn btn-danger btn-sm" disabled>🗑 Supprimer</button>
            </div>
          </div>
        </section>

        <!-- Right column: edit panel -->
        <section class="card meta-edit-card" data-collapsible="true">
          <h3>Édition du document sélectionné</h3>
          <div id="meta-edit-panel">
            <p class="empty-hint">Sélectionnez un document dans la liste.</p>
          </div>
        </section>
      </div>

      <!-- Bulk update (collapsed by default) -->
      <section class="card" data-collapsible="true" data-collapsed-default="true">
        <h3>Édition en masse</h3>
        <div class="form-row" style="margin-top:0.55rem">
          <label>Doc role (tous)
            <select id="bulk-role">
              <option value="">— ne pas changer —</option>
              ${DOC_ROLES.map(r => `<option value="${r}">${r}</option>`).join("")}
            </select>
          </label>
          <label>Resource type (tous)
            <input id="bulk-restype" type="text" placeholder="littérature, article, discours…" style="max-width:220px">
          </label>
          <div style="align-self:flex-end">
            <button id="bulk-apply-btn" class="btn btn-secondary btn-sm" disabled>Appliquer à tous</button>
          </div>
        </div>
      </section>

      <!-- Log (collapsed by default) -->
      <section class="card meta-log-card" data-collapsible="true" data-collapsed-default="true">
        <h3>Journal des actions documents</h3>
        <div id="meta-log" class="log-pane"></div>
      </section>
    `;

    this._docListEl   = root.querySelector("#meta-doc-list")!;
    this._editPanelEl = root.querySelector("#meta-edit-panel")!;
    this._logEl       = root.querySelector("#meta-log")!;
    this._docCountEl  = root.querySelector("#meta-doc-count")!;
    this._stateEl     = root.querySelector("#meta-state-banner")!;
    this._kpiBarEl    = root.querySelector("#meta-kpi-bar")!;
    this._batchBarEl  = root.querySelector("#meta-batch-bar")!;
    this._batchMetaEl = root.querySelector("#meta-batch-meta")!;
    this._selectAllEl = root.querySelector<HTMLInputElement>("#meta-select-all")!;

    root.querySelector("#refresh-docs-btn")!.addEventListener("click", () => this._refreshDocList());
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
    root.querySelector("#meta-batch-role-btn")!.addEventListener("click", () => void this._runBatchRoleUpdate());
    root.querySelector("#meta-batch-delete-btn")!.addEventListener("click", () => void this._runBatchDelete());
    root.querySelector("#validate-btn")!.addEventListener("click", () => this._runValidate());
    root.querySelector("#db-backup-btn")!.addEventListener("click", () => void this._runDbBackup());
    root.querySelector("#audit-btn")!.addEventListener("click", () => void this._runAudit());
    root.querySelector<HTMLInputElement>("#audit-ratio-input")?.addEventListener("change", (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      if (!isNaN(v) && v >= 1 && v <= 100) this._auditRatioThreshold = v;
    });
    this._auditPanelEl = root.querySelector<HTMLElement>("#meta-audit-panel")!;
    root.querySelector("#meta-hierarchy-btn")!.addEventListener("click", () => void this._toggleHierarchyView());

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
      this._docListEl.innerHTML = `<tr><td colspan="6" class="meta-empty-cell">Sidecar non connecté.</td></tr>`;
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

  private _renderDocList(): void {
    this._updateDocCount();

    if (this._hierarchyView) {
      // Disable sort indicators in hierarchy mode
      this._root.querySelectorAll<HTMLElement>("th[data-sort]").forEach(th => {
        th.classList.remove("sort-active");
        const ind = th.querySelector<HTMLElement>(".sort-ind");
        if (ind) ind.textContent = "";
      });
      this._renderHierarchyList();
      return;
    }

    // Refresh sort indicators on column headers
    this._root.querySelectorAll<HTMLElement>("th[data-sort]").forEach(th => {
      const isActive = th.dataset.sort === this._sortCol;
      th.classList.toggle("sort-active", isActive);
      const ind = th.querySelector<HTMLElement>(".sort-ind");
      if (ind) ind.textContent = isActive ? (this._sortDir === "asc" ? " ↑" : " ↓") : " ⇅";
    });
    if (this._docs.length === 0) {
      this._docListEl.innerHTML = `<tr><td colspan="6" class="meta-empty-cell">Aucun document.</td></tr>`;
      this._renderBatchBar();
      return;
    }
    const docs = this._filteredDocs();
    if (docs.length === 0) {
      this._docListEl.innerHTML = `<tr><td colspan="6" class="meta-empty-cell">Aucun document ne correspond aux filtres.</td></tr>`;
      this._renderBatchBar();
      return;
    }
    this._docListEl.innerHTML = "";
    for (const doc of docs) {
      const tr = document.createElement("tr");
      tr.className = "meta-doc-row";
      if (this._selectedDoc?.doc_id === doc.doc_id) tr.classList.add("is-active");
      const isChecked = this._selectedDocIds.has(doc.doc_id);
      const wfStatus = this._workflowStatus(doc);
      const wfLabel  = this._workflowLabel(wfStatus);
      tr.innerHTML = `
        <td class="col-check">
          <input class="meta-row-check" type="checkbox" data-id="${doc.doc_id}"
            ${isChecked ? "checked" : ""} aria-label="Sélectionner doc ${doc.doc_id}" />
        </td>
        <td class="col-id">#${doc.doc_id}</td>
        <td class="col-title" title="${this._esc(doc.title)}">${this._esc(this._truncateMid(doc.title))}</td>
        <td class="col-lang">${this._esc(doc.language)}</td>
        <td class="col-role">${this._esc(doc.doc_role ?? "—")}</td>
        <td class="col-status"><span class="wf-pill wf-${wfStatus}">${wfLabel}</span></td>
      `;
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
    }
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

    if (this._docs.length === 0) {
      this._docListEl.innerHTML = `<tr><td colspan="6" class="meta-empty-cell">Aucun document.</td></tr>`;
      return;
    }

    const appendRow = (doc: DocumentRecord, depth = 0, relationLabel?: string, completionPct?: number) => {
      const tr = document.createElement("tr");
      tr.className = "meta-doc-row";
      if (depth > 0) tr.classList.add("tree-child");
      if (this._selectedDoc?.doc_id === doc.doc_id) tr.classList.add("is-active");
      const isChecked = this._selectedDocIds.has(doc.doc_id);
      const wfStatus = this._workflowStatus(doc);
      const wfLabel  = this._workflowLabel(wfStatus);
      const indent   = depth > 0 ? `<span class="tree-connector" aria-hidden="true">└</span>` : "";
      const relBadge = relationLabel
        ? `<span class="tree-rel-badge">${this._esc(this._relLabel(relationLabel))}</span>`
        : "";
      const pctBadge = completionPct !== undefined
        ? `<span class="family-pct-badge family-pct-${this._completionTier(completionPct)}"
              title="Famille : ${completionPct} % traité">${completionPct} %</span>`
        : "";
      tr.innerHTML = `
        <td class="col-check">
          <input class="meta-row-check" type="checkbox" data-id="${doc.doc_id}"
            ${isChecked ? "checked" : ""} aria-label="Sélectionner doc ${doc.doc_id}" />
        </td>
        <td class="col-id">#${doc.doc_id}</td>
        <td class="col-title tree-title-cell" title="${this._esc(doc.title)}" style="padding-left:${0.5 + depth * 1.4}rem">
          ${indent}${relBadge}${this._esc(this._truncateMid(doc.title))}${pctBadge}
        </td>
        <td class="col-lang">${this._esc(doc.language)}</td>
        <td class="col-role">${this._esc(doc.doc_role ?? "—")}</td>
        <td class="col-status"><span class="wf-pill wf-${wfStatus}">${wfLabel}</span></td>
      `;
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
      tr.className = "tree-section-header";
      tr.innerHTML = `<td colspan="6" class="tree-section-label">${this._esc(label)} <span class="tree-section-count">${count}</span></td>`;
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
    const roleBtn = this._root?.querySelector<HTMLButtonElement>("#meta-batch-role-btn");
    if (roleBtn) roleBtn.disabled = count < 2;
    const deleteBtn = this._root?.querySelector<HTMLButtonElement>("#meta-batch-delete-btn");
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
    this._selectedDoc = doc;
    this._previewDocId = doc.doc_id;
    this._previewLoading = true;
    this._previewError = null;
    this._previewLines = [];
    this._previewTotalLines = 0;
    this._renderDocList();
    // Load relations
    if (this._conn) {
      try {
        const res = await getDocRelations(this._conn, doc.doc_id);
        this._relations = res.relations;
      } catch {
        this._relations = [];
      }
    }
    this._renderEditPanel();
    void this._loadDocPreview(doc.doc_id);
  }

  private _renderEditPanel(): void {
    const doc = this._selectedDoc;
    if (!doc) {
      this._editPanelEl.innerHTML = `<p class="empty-hint">Sélectionnez un document dans la liste.</p>`;
      return;
    }

    // ── Author propagation context ──────────────────────────────────────────
    // Parent: a doc that THIS doc is a translation/excerpt of
    const parentRel = this._relations.find(r =>
      r.relation_type === "translation_of" || r.relation_type === "excerpt_of"
    );
    const parentDoc = parentRel ? this._docs.find(d => d.doc_id === parentRel.target_doc_id) : null;
    const parentHasAuthor = parentDoc && (parentDoc.author_lastname || parentDoc.author_firstname);

    // Children: docs that are translations/excerpts of THIS doc (from _allRelations if loaded)
    const childDocIds = this._allRelationsLoaded
      ? this._allRelations
          .filter(r =>
            r.target_doc_id === doc.doc_id &&
            (r.relation_type === "translation_of" || r.relation_type === "excerpt_of")
          )
          .map(r => r.doc_id)
      : [];

    const inheritHtml = parentHasAuthor
      ? `<div class="author-inherit-banner">
          <span class="author-inherit-from">
            De l'original #${parentDoc!.doc_id} :
            <strong>${this._esc([parentDoc!.author_lastname, parentDoc!.author_firstname].filter(Boolean).join(", "))}</strong>
          </span>
          <button id="inherit-author-btn" class="btn btn-secondary btn-sm author-inherit-btn"
            title="Copier le nom et prénom de l'auteur depuis l'original">← Hériter</button>
        </div>`
      : "";

    const propagateHtml = childDocIds.length > 0
      ? `<button id="propagate-author-btn" class="btn btn-secondary btn-sm"
            title="Appliquer le nom et prénom de l'auteur à toutes les traductions/extraits"
            data-child-ids="${childDocIds.join(",")}">
            → Propager aux ${childDocIds.length} traduction${childDocIds.length > 1 ? "s" : ""}
          </button>`
      : (this._allRelationsLoaded ? "" :
          `<button id="propagate-author-btn" class="btn btn-secondary btn-sm"
              title="Charger les traductions et appliquer le nom et prénom de l'auteur"
              data-child-ids="">→ Propager…</button>`);

    this._editPanelEl.innerHTML = `
      <div class="form-row">
        <label style="flex:2">Titre
          <input id="edit-title" type="text" value="${this._esc(doc.title)}">
        </label>
        <label>Langue
          <input id="edit-lang" type="text" value="${this._esc(doc.language)}" style="max-width:80px">
        </label>
      </div>
      <div class="form-row">
        <label style="flex:1.2">Nom de l'auteur
          <input id="edit-author-lastname" type="text" value="${this._esc(doc.author_lastname ?? "")}" placeholder="Dupont">
        </label>
        <label style="flex:1.2">Prénom de l'auteur
          <input id="edit-author-firstname" type="text" value="${this._esc(doc.author_firstname ?? "")}" placeholder="Marie">
        </label>
        <label>Date
          <input id="edit-doc-date" type="text" value="${this._esc(doc.doc_date ?? "")}" placeholder="2024 ou 2024-03-15" style="max-width:130px">
        </label>
      </div>
      ${inheritHtml}
      <div class="form-row">
        <label>Rôle
          <select id="edit-role">
            ${DOC_ROLES.map(r => `<option value="${r}"${r === doc.doc_role ? " selected" : ""}>${r}</option>`).join("")}
          </select>
        </label>
        <label>Resource type
          <input id="edit-restype" type="text" value="${this._esc(doc.resource_type ?? "")}" style="max-width:220px" placeholder="littérature, article, discours…">
        </label>
      </div>
      <div class="form-row">
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
      <div class="form-row" style="margin-top:-0.2rem">
        <div class="hint" style="margin:0">
          ${doc.validated_at ? `Dernière validation: ${this._esc(new Date(doc.validated_at).toLocaleString())}` : "Dernière validation: —"}
        </div>
      </div>
      <div class="btn-row" style="margin-bottom:1rem">
        <button id="save-doc-btn" class="btn btn-primary btn-sm">Enregistrer</button>
        <button id="mark-review-btn" class="btn btn-secondary btn-sm">Marquer à revoir</button>
        <button id="mark-validated-btn" class="btn btn-secondary btn-sm">Valider ce document</button>
        ${propagateHtml}
      </div>

      ${this._familyPanelHtml(doc)}

      <h4 style="font-size:0.88rem;font-weight:600;margin:0.5rem 0 0.3rem">Relations documentaires</h4>
      <p style="font-size:0.78rem;color:var(--color-muted);margin:0 0 0.5rem">
        Définissez comment ce document est lié à un autre (traduction, extrait…).
        Ces relations apparaîtront dans le <code>&lt;teiHeader&gt;</code> à l'export.
      </p>
      <div class="form-row" style="align-items:flex-end">
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
              .map(d => `<option value="${d.doc_id}">#${d.doc_id} ${this._esc(d.title)} (${this._esc(d.language)})</option>`)
              .join("")}
          </select>
        </label>
        <label>Note
          <input id="rel-note" type="text" placeholder="optionnel" style="max-width:130px">
        </label>
        <button id="add-rel-btn" class="btn btn-secondary btn-sm" style="align-self:flex-end">＋ Ajouter</button>
      </div>
      <div id="relations-list" style="margin-top:0.4rem"></div>

      <div class="meta-preview">
        <div class="meta-preview-head">
          <h4 style="font-size:0.88rem;font-weight:600;margin:0">Aperçu rapide du contenu</h4>
          <span class="hint" style="margin:0">${this._previewLimit} lignes max</span>
        </div>
        <div id="meta-preview-panel"></div>
      </div>
    `;

    this._renderRelationsList();
    this._renderPreviewPanel();

    this._editPanelEl.querySelector("#save-doc-btn")!.addEventListener("click", () => this._saveDoc());
    this._editPanelEl.querySelector("#mark-review-btn")!.addEventListener("click", () => this._setWorkflowStatus("review"));
    this._editPanelEl.querySelector("#mark-validated-btn")!.addEventListener("click", () => this._setWorkflowStatus("validated"));
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

    this._editPanelEl.querySelectorAll<HTMLButtonElement>(".fam-export-pair-btn")
      .forEach(btn => {
        btn.addEventListener("click", () => {
          const pivotId  = Number(btn.dataset.pivot);
          const targetId = Number(btn.dataset.target);
          const pivotLang  = btn.dataset.pivotLang  ?? "und";
          const targetLang = btn.dataset.targetLang ?? "und";
          void this._showExportPairDialog(pivotId, targetId, pivotLang, targetLang);
        });
      });
  }

  private _familyPanelHtml(doc: DocumentRecord): string {
    const family = this._families.find(f => f.family_id === doc.doc_id);
    if (!family) return "";

    const { stats } = family;
    const tier = this._completionTier(stats.completion_pct);

    const pairRows = family.children.map(c => {
      const segIcon  = c.segmented       ? "✓" : "○";
      const segClass = c.segmented       ? "fam-ok" : "fam-todo";
      const alnIcon  = c.aligned_to_parent ? "✓" : "○";
      const alnClass = c.aligned_to_parent ? "fam-ok" : "fam-todo";
      const childTitle = c.doc ? this._esc(this._truncateMid(c.doc.title, 28)) : `doc #${c.doc_id}`;
      const childLang  = c.doc ? this._esc(c.doc.language) : "?";
      const exportDisabled = c.aligned_to_parent ? "" : "disabled title=\"Aligner la paire d'abord\"";
      return `
        <tr class="fam-pair-row">
          <td class="fam-pair-lang">${childLang}</td>
          <td class="fam-pair-title" title="${c.doc ? this._esc(c.doc.title) : ""}">${childTitle}</td>
          <td class="fam-pair-icon ${segClass}" title="Segmenté">${segIcon}</td>
          <td class="fam-pair-icon ${alnClass}" title="Aligné">${alnIcon}</td>
          <td class="fam-pair-export">
            <button class="btn btn-xs fam-export-pair-btn"
                    data-pivot="${family.family_id}" data-target="${c.doc_id}"
                    data-pivot-lang="${this._esc(family.parent?.language ?? 'und')}"
                    data-target-lang="${childLang}"
                    ${exportDisabled}>↗ Export</button>
          </td>
        </tr>`;
    }).join("");

    const ratioWarnings = stats.ratio_warnings.length > 0
      ? `<p class="fam-ratio-warn">⚠ ${stats.ratio_warnings.length} paire(s) avec ratio de segments suspect (&gt;15 %)</p>`
      : "";

    return `
      <div class="family-panel">
        <div class="family-panel-head">
          <span class="fam-title">📁 Famille documentaire</span>
          <span class="family-pct-badge family-pct-${tier}">${stats.completion_pct} %</span>
        </div>
        <div class="fam-stats-row">
          <span>${stats.total_docs} doc(s)</span>
          <span>${stats.segmented_docs}/${stats.total_docs} segmentés</span>
          <span>${stats.aligned_pairs}/${stats.total_pairs} paires alignées</span>
          <span>${stats.validated_docs} validé(s)</span>
        </div>
        <table class="fam-pairs-table">
          <thead><tr>
            <th>Langue</th><th>Traduction / Extrait</th>
            <th title="Segmenté">Seg.</th><th title="Aligné">Aln.</th><th></th>
          </tr></thead>
          <tbody>${pairRows}</tbody>
        </table>
        ${ratioWarnings}
        <div class="fam-actions">
          <button id="seg-family-btn" class="btn btn-secondary btn-sm"
                  data-family-id="${family.family_id}">⟳ Segmenter la famille</button>
          <button id="aln-family-btn" class="btn btn-secondary btn-sm"
                  data-family-id="${family.family_id}"
                  data-pairs="${this._esc(JSON.stringify(family.children.map(c => ({
                    doc_id: c.doc_id,
                    lang: c.doc?.language ?? "?",
                    title: c.doc?.title ?? `#${c.doc_id}`,
                    segmented: c.segmented,
                    aligned: c.aligned_to_parent,
                    relation_type: c.relation_type,
                  }))))}"
                  >⇄ Aligner la famille</button>
        </div>
        <div id="seg-family-result"></div>
        <div id="aln-family-result"></div>
        <div id="export-pair-dialog"></div>
      </div>`;
  }

  private _inheritAuthorFromParent(): void {
    const parentRel = this._relations.find(r =>
      r.relation_type === "translation_of" || r.relation_type === "excerpt_of"
    );
    const parent = parentRel ? this._docs.find(d => d.doc_id === parentRel.target_doc_id) : null;
    if (!parent) return;

    const lastnameEl  = this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-lastname");
    const firstnameEl = this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-firstname");
    if (lastnameEl)  lastnameEl.value  = parent.author_lastname  ?? "";
    if (firstnameEl) firstnameEl.value = parent.author_firstname ?? "";

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

    const lastname  = this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-lastname")?.value.trim() || null;
    const firstname = this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-firstname")?.value.trim() || null;

    if (!lastname && !firstname) {
      this._log("Aucun auteur renseigné sur ce document — rien à propager.", true);
      return;
    }

    if (!confirm(`Appliquer "${[lastname, firstname].filter(Boolean).join(", ")}" comme auteur sur ${childIds.length} document(s) enfant(s) ?`)) return;

    btn.disabled = true;
    btn.textContent = "Propagation…";
    try {
      const updates = childIds.map(id => ({
        doc_id: id,
        author_lastname: lastname,
        author_firstname: firstname,
      }));
      await bulkUpdateDocuments(this._conn, updates);
      // Update in-memory cache
      for (const id of childIds) {
        const idx = this._docs.findIndex(d => d.doc_id === id);
        if (idx >= 0) {
          this._docs[idx] = { ...this._docs[idx], author_lastname: lastname, author_firstname: firstname };
        }
      }
      btn.textContent = `✓ Propagé à ${childIds.length} doc(s)`;
      this._log(`✓ Auteur propagé à ${childIds.length} document(s) enfant(s).`);
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
        resultDiv.innerHTML = `
          <div class="seg-family-confirm">
            <p>⚠ <strong>${alreadyDone} doc(s)</strong> déjà segmenté(s) dans cette famille.
               Resegmenter effacera les alignements existants pour ces documents.</p>
            <div class="btn-row" style="gap:0.5rem;flex-wrap:wrap">
              <button id="seg-skip-btn" class="btn btn-secondary btn-sm">Passer les existants</button>
              <button id="seg-force-btn" class="btn btn-danger btn-sm">Re-segmenter tout</button>
              <button id="seg-cancel-btn" class="btn btn-ghost btn-sm">Annuler</button>
            </div>
          </div>`;

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
    if (resultDiv) resultDiv.innerHTML = `<p class="seg-family-loading">Segmentation en cours…</p>`;

    try {
      const res = await segmentFamily(this._conn, familyRootId, { force });

      if (resultDiv) {
        const rows = res.results.map(r => this._segResultRow(r)).join("");
        const { segmented, skipped, errors } = res.summary;
        const parts: string[] = [];
        if (segmented > 0) parts.push(`<span class="fam-ok">${segmented} segmenté(s)</span>`);
        if (skipped  > 0) parts.push(`<span class="fam-todo">${skipped} ignoré(s)</span>`);
        if (errors   > 0) parts.push(`<span class="fam-ratio-warn">${errors} erreur(s)</span>`);

        resultDiv.innerHTML = `
          <div class="seg-family-report">
            <p class="seg-report-summary">${parts.join(" · ")}</p>
            <table class="fam-pairs-table">
              <thead><tr><th>Doc</th><th>Statut</th><th>Unités</th><th>Avertissements</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      }

      // Refresh family panel data
      this._familiesLoaded = false;
      if (this._hierarchyView) this._renderDocList();
      if (this._conn) {
        this._families = await getFamilies(this._conn);
        this._familiesLoaded = true;
        this._renderDocList();
        // Re-render the edit panel to update completion badge
        if (this._selectedDoc) this._renderEditPanel(this._selectedDoc);
      }

      this._log(`✓ Famille #${familyRootId} segmentée : ${res.summary.segmented} doc(s) traité(s).`);
    } catch (err) {
      const msg = err instanceof SidecarError ? err.message : String(err);
      if (resultDiv) resultDiv.innerHTML = `<p class="fam-ratio-warn">Erreur : ${msg}</p>`;
      this._log(`Erreur segmentation famille : ${msg}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "⟳ Segmenter la famille";
    }
  }

  private _segResultRow(r: FamilySegmentDocResult): string {
    const statusLabel = r.status === "segmented" ? "✓ Segmenté"
      : r.status === "skipped" ? "— Ignoré"
      : "✕ Erreur";
    const statusClass = r.status === "segmented" ? "fam-ok"
      : r.status === "skipped" ? "fam-todo"
      : "fam-ratio-warn";
    const warns = r.warnings.length > 0
      ? `<span title="${this._esc(r.warnings.join(" | "))}">⚠ ${r.warnings.length}</span>`
      : "—";
    const ratio = r.calibrate_ratio_pct != null
      ? ` <em>(±${r.calibrate_ratio_pct} %)</em>` : "";
    return `
      <tr>
        <td>#${r.doc_id}</td>
        <td class="${statusClass}">${statusLabel}</td>
        <td>${r.units_input} → ${r.units_output}${ratio}</td>
        <td>${warns}</td>
      </tr>`;
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
        const segCls  = p.segmented ? "fam-ok" : "fam-ratio-warn";
        return `<tr>
          <td>#${familyRootId} ↔ #${p.doc_id}</td>
          <td>${this._esc(p.lang)}</td>
          <td title="${this._esc(p.title)}">${this._esc(this._truncateMid(p.title, 25))}</td>
          <td class="${segCls}">${segIcon}</td>
          <td>${alnIcon}</td>
        </tr>`;
      }).join("");

      const warnHtml = unready.length > 0
        ? `<p class="fam-ratio-warn">⚠ ${unready.length} enfant(s) non segmenté(s) — seront ignorés (skip_unready).</p>`
        : "";
      const replaceHtml = alreadyAligned.length > 0
        ? `<p class="seg-family-confirm" style="margin:4px 0">
             ${alreadyAligned.length} paire(s) déjà alignée(s). Remplacer les liens existants ?
             <label style="display:inline-flex;align-items:center;gap:4px;margin-left:6px">
               <input type="checkbox" id="aln-replace-chk"> Remplacer
             </label>
           </p>`
        : "";

      resultDiv.innerHTML = `
        <div class="seg-family-confirm">
          <p><strong>Paires à aligner (stratégie : position)</strong></p>
          <table class="fam-pairs-table" style="margin-bottom:6px">
            <thead><tr><th>Paire</th><th>Langue</th><th>Titre</th><th title="Segmenté">Seg.</th><th title="Aligné">Aln.</th></tr></thead>
            <tbody>${pairRows}</tbody>
          </table>
          ${warnHtml}
          ${replaceHtml}
          <div class="btn-row" style="gap:0.5rem;flex-wrap:wrap;margin-top:6px">
            <button id="aln-confirm-btn" class="btn btn-primary btn-sm">⇄ Lancer l'alignement</button>
            <button id="aln-cancel-btn" class="btn btn-ghost btn-sm">Annuler</button>
          </div>
        </div>`;

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
    if (resultDiv) resultDiv.innerHTML = `<p class="seg-family-loading">Alignement en cours…</p>`;

    try {
      const res = await alignFamily(this._conn, familyRootId, {
        strategy: "position",
        replace_existing: replaceExisting,
        preserve_accepted: true,
        skip_unready: true,
      });

      if (resultDiv) {
        const rows = res.results.map(r => this._alnResultRow(r)).join("");
        const { aligned, skipped, errors, total_links_created } = res.summary;
        const parts: string[] = [];
        if (aligned > 0) parts.push(`<span class="fam-ok">${aligned} paire(s) alignée(s)</span>`);
        if (skipped > 0) parts.push(`<span class="fam-todo">${skipped} ignorée(s)</span>`);
        if (errors  > 0) parts.push(`<span class="fam-ratio-warn">${errors} erreur(s)</span>`);
        parts.push(`${total_links_created} lien(s) créé(s)`);

        resultDiv.innerHTML = `
          <div class="seg-family-report">
            <p class="seg-report-summary">${parts.join(" · ")}</p>
            <table class="fam-pairs-table">
              <thead><tr><th>Paire</th><th>Statut</th><th>Liens</th><th>Avert.</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      }

      // Refresh family data
      this._familiesLoaded = false;
      if (this._conn) {
        this._families = await getFamilies(this._conn);
        this._familiesLoaded = true;
        this._renderDocList();
        if (this._selectedDoc) this._renderEditPanel(this._selectedDoc);
      }

      this._log(`✓ Famille #${familyRootId} alignée : ${res.summary.total_links_created} lien(s) créé(s).`);
    } catch (err) {
      const msg = err instanceof SidecarError ? err.message : String(err);
      if (resultDiv) resultDiv.innerHTML = `<p class="fam-ratio-warn">Erreur : ${msg}</p>`;
      this._log(`Erreur alignement famille : ${msg}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "⇄ Aligner la famille";
    }
  }

  private _alnResultRow(r: FamilyAlignPairResult): string {
    const statusLabel = r.status === "aligned"   ? "✓ Aligné"
      : r.status === "skipped"   ? "— Ignoré"
      : r.status === "conflict"  ? "⚡ Conflit"
      : "✕ Erreur";
    const statusClass = r.status === "aligned"  ? "fam-ok"
      : r.status === "skipped"  ? "fam-todo"
      : "fam-ratio-warn";
    const warns = r.warnings.length > 0
      ? `<span title="${this._esc(r.warnings.join(" | "))}">⚠ ${r.warnings.length}</span>`
      : "—";
    return `
      <tr>
        <td>#${r.pivot_doc_id} ↔ #${r.target_doc_id} (${this._esc(r.target_lang)})</td>
        <td class="${statusClass}">${statusLabel}</td>
        <td>${r.links_created}</td>
        <td>${warns}</td>
      </tr>`;
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
      row.innerHTML = `
        <span style="font-weight:600;color:#4a6fa5;white-space:nowrap">${this._esc(rel.relation_type)}</span>
        <span style="color:var(--color-muted)">→</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${targetLabel}</span>
        ${rel.note ? `<span style="font-style:italic;color:var(--color-muted);font-size:0.78rem">${this._esc(rel.note)}</span>` : ""}
        <button class="btn btn-danger btn-sm del-rel-btn" data-id="${rel.id}" aria-label="Supprimer cette relation" title="Supprimer cette relation">✕</button>
      `;
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
    if (!confirm("Supprimer cette relation ?")) return;
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
    if (!confirm(msg)) return;

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
    if (!this._conn || this._selectedDocIds.size < 2) return;
    const roleList = DOC_ROLES.join(" | ");
    const chosen = prompt(`Rôle pour les ${this._selectedDocIds.size} documents sélectionnés :\n(${roleList})`);
    if (!chosen) return;
    const doc_role = chosen.trim();
    if (!DOC_ROLES.includes(doc_role)) {
      alert(`Rôle invalide : "${doc_role}"\nValeurs acceptées : ${roleList}`);
      return;
    }
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
    const confirmed = confirm(
      `Supprimer ${label} du corpus ?\n\nCette action est irréversible : toutes les unités, les alignements et les relations associés seront également supprimés.`
    );
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
      if (this._auditPanelEl && !this._auditPanelEl.hidden) {
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

  private async _loadDocPreview(docId: number): Promise<void> {
    if (!this._conn) return;
    this._previewLoading = true;
    this._previewError = null;
    this._renderPreviewPanel();
    try {
      const res = await getDocumentPreview(this._conn, docId, this._previewLimit);
      if (this._selectedDoc?.doc_id !== docId) return;
      this._previewDocId = docId;
      this._previewLines = res.lines ?? [];
      this._previewTotalLines = res.total_lines ?? this._previewLines.length;
      this._previewError = null;
    } catch (err) {
      if (this._selectedDoc?.doc_id !== docId) return;
      this._previewLines = [];
      this._previewTotalLines = 0;
      this._previewError = err instanceof SidecarError ? err.message : String(err);
    } finally {
      if (this._selectedDoc?.doc_id === docId) {
        this._previewLoading = false;
        this._renderPreviewPanel();
      }
    }
  }

  private _renderPreviewPanel(): void {
    const panel = this._editPanelEl.querySelector<HTMLElement>("#meta-preview-panel");
    if (!panel || !this._selectedDoc) return;

    if (this._previewLoading) {
      panel.innerHTML = `<p class="empty-hint">Chargement de l'aperçu…</p>`;
      return;
    }
    if (this._previewError) {
      panel.innerHTML = `<p class="empty-hint" style="color:var(--color-danger)">Aperçu indisponible: ${this._esc(this._previewError)}</p>`;
      return;
    }
    if (this._previewLines.length === 0) {
      panel.innerHTML = `<p class="empty-hint">Aucune ligne disponible pour ce document.</p>`;
      return;
    }

    const count = this._previewLines.length;
    const suffix = this._previewTotalLines > count ? ` / ${this._previewTotalLines} lignes` : "";
    panel.innerHTML = `
      <p class="hint" style="margin:0 0 0.35rem">Extrait affiché: ${count}${suffix}</p>
      <div class="meta-preview-lines">
        ${this._previewLines.map((line) => {
          const marker = line.external_id != null ? `[${String(line.external_id).padStart(4, "0")}]` : `[n${line.n}]`;
          return `<div class="meta-preview-line"><span class="meta-preview-marker">${marker}</span> <span>${this._esc(line.text)}</span></div>`;
        }).join("")}
      </div>
    `;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _log(msg: string, isError = false): void {
    const line = document.createElement("div");
    line.className = "log-line" + (isError ? " log-error" : "");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
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
      set("meta-kpi-ok",    `${validated} validé${validated !== 1 ? "s" : ""}`);
      set("meta-kpi-warn",  `${todo} à traiter`);
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
    // Sort
    const dir = this._sortDir === "asc" ? 1 : -1;
    const col = this._sortCol;
    docs = [...docs].sort((a, b) => {
      switch (col) {
        case "id":     return dir * (a.doc_id - b.doc_id);
        case "title":  return dir * (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" });
        case "lang":   return dir * (a.language ?? "").localeCompare(b.language ?? "", undefined, { sensitivity: "base" });
        case "role":   return dir * (a.doc_role ?? "").localeCompare(b.doc_role ?? "", undefined, { sensitivity: "base" });
        case "status": return dir * this._workflowStatus(a).localeCompare(this._workflowStatus(b));
        default:       return 0;
      }
    });
    return docs;
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
    const authorLastname  = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-lastname")?.value ?? "").trim();
    const authorFirstname = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-author-firstname")?.value ?? "").trim();
    const docDate         = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-doc-date")?.value ?? "").trim();

    const baseTitle           = (this._selectedDoc.title ?? "").trim();
    const baseLanguage        = (this._selectedDoc.language ?? "").trim();
    const baseDocRole         = (this._selectedDoc.doc_role ?? "unknown").trim();
    const baseResourceType    = (this._selectedDoc.resource_type ?? "").trim();
    const baseWorkflow        = this._workflowStatus(this._selectedDoc);
    const baseValidatedRunId  = (this._selectedDoc.validated_run_id ?? "").trim();
    const baseAuthorLastname  = (this._selectedDoc.author_lastname ?? "").trim();
    const baseAuthorFirstname = (this._selectedDoc.author_firstname ?? "").trim();
    const baseDocDate         = (this._selectedDoc.doc_date ?? "").trim();

    return (
      title !== baseTitle ||
      language !== baseLanguage ||
      docRole !== baseDocRole ||
      resourceType !== baseResourceType ||
      workflow !== baseWorkflow ||
      validatedRunId !== baseValidatedRunId ||
      authorLastname !== baseAuthorLastname ||
      authorFirstname !== baseAuthorFirstname ||
      docDate !== baseDocDate
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
    this._stateEl.className = `runtime-state state-${kind}`;
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
      this._auditResult = await getCorpusAudit(this._conn, this._auditRatioThreshold);
      this._renderAuditPanel();
    } catch (err) {
      this._lastErrorMsg = err instanceof SidecarError ? err.message : String(err);
      this._refreshRuntimeState();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "🔍 Audit corpus"; }
    }
  }

  private _renderAuditPanel(): void {
    const panel = this._auditPanelEl;
    if (!panel) return;
    const r = this._auditResult;
    if (!r) { panel.hidden = true; return; }

    panel.innerHTML = "";
    panel.hidden = false;

    // ── Header ────────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = r.total_issues === 0 ? "audit-header audit-header-ok" : "audit-header audit-header-warn";

    const headerText = document.createElement("span");
    headerText.textContent = r.total_issues === 0
      ? `✅ Corpus sain — ${r.total_docs} document(s), aucun problème détecté.`
      : `⚠️ ${r.total_issues} problème(s) sur ${r.total_docs} document(s)`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "audit-close-btn";
    closeBtn.title = "Fermer";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => { panel.hidden = true; this._auditResult = null; });

    header.appendChild(headerText);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // ── Sections ──────────────────────────────────────────────────────────────
    if (r.missing_fields.length > 0) {
      panel.appendChild(this._auditSimpleSection(
        "Champs manquants",
        r.missing_fields.map(e => ({ docId: e.doc_id, extra: e.missing.join(", ") })),
      ));
    }
    if (r.empty_documents.length > 0) {
      panel.appendChild(this._auditSimpleSection(
        "Documents vides (0 unité importée)",
        r.empty_documents.map(e => ({ docId: e.doc_id, extra: "" })),
      ));
    }
    if (r.duplicate_hashes.length > 0) {
      panel.appendChild(this._auditGroupSection(
        "Doublons de contenu (même fichier importé plusieurs fois)",
        r.duplicate_hashes.map(g => ({ label: `hash ${g.hash_prefix}…`, ids: g.doc_ids })),
      ));
    }
    if (r.duplicate_filenames.length > 0) {
      panel.appendChild(this._auditGroupSection(
        "Doublons de nom de fichier",
        r.duplicate_filenames.map(g => ({ label: g.filename, ids: g.doc_ids })),
      ));
    }
    if (r.duplicate_titles.length > 0) {
      panel.appendChild(this._auditGroupSection(
        "Doublons de titre",
        r.duplicate_titles.map(g => ({ label: `«${g.title}»`, ids: g.doc_ids })),
      ));
    }

    // ── Families section ─────────────────────────────────────────────────
    if (r.families && r.families.total_family_issues > 0) {
      panel.appendChild(this._auditFamiliesSection(r.families));
    } else if (r.families && r.families.total_family_issues === 0 && (
      r.families.orphan_docs.length + r.families.unsegmented_children.length +
      r.families.unaligned_pairs.length + r.families.ratio_warnings.length
    ) === 0) {
      // All families healthy — show positive badge only if there are any relations
      const anyFamilies = this._families.length > 0;
      if (anyFamilies) {
        const ok = document.createElement("div");
        ok.className = "audit-family-ok";
        ok.textContent = `✅ Toutes les familles documentaires sont en ordre (seuil ratio : ${r.families.ratio_threshold_pct} %)`;
        panel.appendChild(ok);
      }
    }
  }

  private _auditFamiliesSection(fam: FamilyAuditData): HTMLDetailsElement {
    const details = document.createElement("details");
    details.className = "audit-section audit-section-family";
    details.open = true;

    const summary = document.createElement("summary");
    summary.className = "audit-section-summary";
    summary.innerHTML = `
      <span class="audit-section-label">📁 Familles documentaires</span>
      <span class="audit-issue-badge">${fam.total_family_issues}</span>
      <span class="audit-section-meta">(seuil ratio : ${fam.ratio_threshold_pct} %)</span>`;
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "audit-section-body";

    // Orphan docs
    if (fam.orphan_docs.length > 0) {
      body.appendChild(this._auditFamSubsection(
        `Docs orphelins — parent absent du corpus (${fam.orphan_docs.length})`,
        fam.orphan_docs.map(e => ({
          docId: e.child_id,
          extra: `parent attendu : #${e.parent_id}`,
          actionNav: e.child_id,
        })),
        null, null,
      ));
    }

    // Unsegmented children
    if (fam.unsegmented_children.length > 0) {
      const familyRootIds = [...new Set(fam.unsegmented_children.map(e => e.parent_id))];
      body.appendChild(this._auditFamSubsection(
        `Docs non segmentés dans une famille (${fam.unsegmented_children.length})`,
        fam.unsegmented_children.map(e => ({
          docId: e.child_id,
          extra: `${!e.child_segmented ? "enfant non segmenté" : "parent non segmenté"}`,
          actionNav: e.parent_id,
        })),
        { label: "Segmenter les familles", action: () => void this._auditSegmentFamilies(familyRootIds) },
        null,
      ));
    }

    // Unaligned pairs
    if (fam.unaligned_pairs.length > 0) {
      const familyRootIds = [...new Set(fam.unaligned_pairs.map(e => e.parent_id))];
      body.appendChild(this._auditFamSubsection(
        `Paires segmentées mais non alignées (${fam.unaligned_pairs.length})`,
        fam.unaligned_pairs.map(e => ({
          docId: e.child_id,
          extra: `#${e.parent_id} ↔ #${e.child_id} · ${e.parent_segs} vs ${e.child_segs} seg.`,
          actionNav: e.parent_id,
        })),
        null,
        { label: "Aligner les familles", action: () => void this._auditAlignFamilies(familyRootIds) },
      ));
    }

    // Ratio warnings
    if (fam.ratio_warnings.length > 0) {
      body.appendChild(this._auditFamSubsection(
        `Ratios de segments suspects > ${fam.ratio_threshold_pct} % (${fam.ratio_warnings.length})`,
        fam.ratio_warnings.map(e => ({
          docId: e.child_id,
          extra: `±${e.ratio_pct} % · #${e.parent_id}: ${e.parent_segs} seg. | #${e.child_id}: ${e.child_segs} seg.`,
          actionNav: e.parent_id,
        })),
        null, null,
      ));
    }

    details.appendChild(body);
    return details;
  }

  private _auditFamSubsection(
    title: string,
    items: { docId: number; extra: string; actionNav: number }[],
    segAction: { label: string; action: () => void } | null,
    alnAction: { label: string; action: () => void } | null,
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "audit-fam-subsection";

    const head = document.createElement("div");
    head.className = "audit-fam-subsection-head";

    const titleEl = document.createElement("span");
    titleEl.className = "audit-fam-subsection-title";
    titleEl.textContent = title;
    head.appendChild(titleEl);

    if (segAction) {
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary btn-xs";
      btn.textContent = `⟳ ${segAction.label}`;
      btn.addEventListener("click", segAction.action);
      head.appendChild(btn);
    }
    if (alnAction) {
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary btn-xs";
      btn.textContent = `⇄ ${alnAction.label}`;
      btn.addEventListener("click", alnAction.action);
      head.appendChild(btn);
    }
    wrap.appendChild(head);

    items.forEach(item => {
      const row = this._auditDocRow(item.docId, item.extra, undefined);
      // Override nav button to go to parent (family root)
      const navBtn = row.querySelector<HTMLButtonElement>(".audit-doc-nav-btn");
      if (navBtn) {
        navBtn.title = `Ouvrir le document parent #${item.actionNav}`;
        navBtn.onclick = () => this._auditNavToDoc(item.actionNav);
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  // ── Sprint 5: export par paire ───────────────────────────────────────────────

  private async _showExportPairDialog(
    pivotId: number,
    targetId: number,
    pivotLang: string,
    targetLang: string,
  ): Promise<void> {
    if (!this._conn) return;
    const container = this._editPanelEl.querySelector<HTMLDivElement>("#export-pair-dialog");
    if (!container) return;

    // Suggested default out_path (desktop or documents folder heuristic)
    const suggestedPath = `export_${pivotLang}_${targetLang}_${pivotId}_${targetId}`;

    container.innerHTML = `
      <div class="export-pair-dialog">
        <div class="export-pair-head">
          <strong>↗ Exporter la paire #${pivotId} ↔ #${targetId}</strong>
          <button id="export-close-btn" class="audit-close-btn" title="Fermer">✕</button>
        </div>
        <div class="export-pair-body">
          <div class="form-row" style="flex-wrap:wrap;gap:0.5rem">
            <label>Format
              <select id="export-format-sel" style="width:90px">
                <option value="html">HTML</option>
                <option value="txt">TXT</option>
                <option value="tmx">TMX</option>
              </select>
            </label>
            <label style="flex:2">Chemin de sortie
              <input id="export-out-path" type="text"
                     placeholder="${suggestedPath}.html"
                     style="width:100%;font-size:0.8rem">
            </label>
          </div>
          <div class="btn-row" style="gap:0.5rem;margin-top:0.4rem">
            <button id="export-preview-btn" class="btn btn-secondary btn-sm">👁 Prévisualiser</button>
            <button id="export-save-btn" class="btn btn-primary btn-sm">↗ Enregistrer</button>
          </div>
          <div id="export-preview-area" style="margin-top:0.5rem"></div>
          <div id="export-status" style="font-size:0.8rem;margin-top:0.4rem"></div>
        </div>
      </div>`;

    const formatSel  = container.querySelector<HTMLSelectElement>("#export-format-sel")!;
    const outInput   = container.querySelector<HTMLInputElement>("#export-out-path")!;
    const previewArea = container.querySelector<HTMLDivElement>("#export-preview-area")!;
    const statusEl   = container.querySelector<HTMLDivElement>("#export-status")!;

    // Update placeholder when format changes
    formatSel.addEventListener("change", () => {
      const ext = formatSel.value === "tmx" ? "tmx" : formatSel.value;
      if (!outInput.value || outInput.value === outInput.placeholder) {
        outInput.placeholder = `${suggestedPath}.${ext}`;
        outInput.value = "";
      }
    });

    container.querySelector("#export-close-btn")?.addEventListener("click", () => {
      container.innerHTML = "";
    });

    container.querySelector("#export-preview-btn")?.addEventListener("click", async () => {
      const fmt = formatSel.value;
      if (fmt === "tmx") {
        statusEl.textContent = "Prévisualisation non disponible pour TMX — utilisez Enregistrer.";
        return;
      }
      statusEl.textContent = "Chargement de la prévisualisation…";
      previewArea.innerHTML = "";
      try {
        const res = await exportBilingual(this._conn!, {
          pivot_doc_id: pivotId,
          target_doc_id: targetId,
          format: fmt as "html" | "txt",
          preview_only: true,
          preview_limit: 15,
        });
        statusEl.textContent = `${res.pair_count} paires alignées.`;
        previewArea.innerHTML = this._renderBilingualPreview(
          res.preview ?? [], pivotLang, targetLang, res.pair_count,
        );
      } catch (err) {
        statusEl.textContent = `Erreur : ${err instanceof SidecarError ? err.message : String(err)}`;
      }
    });

    container.querySelector("#export-save-btn")?.addEventListener("click", async () => {
      const fmt     = formatSel.value;
      const outPath = outInput.value.trim();
      if (!outPath) {
        statusEl.textContent = "⚠ Indiquez un chemin de sortie.";
        return;
      }
      statusEl.textContent = "Export en cours…";
      try {
        if (fmt === "tmx") {
          const res = await exportTmx(this._conn!, {
            pivot_doc_id: pivotId,
            target_doc_id: targetId,
            out_path: outPath,
          });
          statusEl.innerHTML = `✅ TMX enregistré : <code>${this._esc(res.out_path)}</code> · ${res.tu_count} TU(s)`;
        } else {
          const res = await exportBilingual(this._conn!, {
            pivot_doc_id: pivotId,
            target_doc_id: targetId,
            format: fmt as "html" | "txt",
            out_path: outPath,
          });
          statusEl.innerHTML = `✅ Fichier enregistré : <code>${this._esc(res.out_path ?? "")}</code> · ${res.pair_count} paires`;
        }
      } catch (err) {
        statusEl.textContent = `Erreur : ${err instanceof SidecarError ? err.message : String(err)}`;
      }
    });
  }

  private _renderBilingualPreview(
    pairs: BilingualPreviewPair[],
    srcLang: string,
    tgtLang: string,
    totalCount: number,
  ): string {
    if (pairs.length === 0) return `<p class="empty-hint">Aucune paire alignée.</p>`;
    const rows = pairs.map(p => `
      <tr>
        <td>${this._esc(p.pivot_text)}</td>
        <td>${this._esc(p.target_text)}</td>
      </tr>`).join("");
    const more = totalCount > pairs.length
      ? `<p class="hint" style="margin:4px 0">… et ${totalCount - pairs.length} paire(s) de plus.</p>`
      : "";
    return `
      <table class="bilingual-preview-table">
        <thead><tr>
          <th>${this._esc(srcLang)}</th>
          <th>${this._esc(tgtLang)}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${more}`;
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

  private _auditSelectIds(ids: number[], feedbackBtn?: HTMLButtonElement): void {
    // Toggle: if all ids are already selected → deselect, otherwise select all
    const allSelected = ids.every(id => this._selectedDocIds.has(id));
    if (allSelected) {
      ids.forEach(id => this._selectedDocIds.delete(id));
    } else {
      ids.forEach(id => this._selectedDocIds.add(id));
    }

    // Update checkboxes inside the audit panel without rebuilding it
    this._auditPanelEl?.querySelectorAll<HTMLInputElement>(".audit-doc-check").forEach(cb => {
      const id = Number(cb.dataset.docId);
      if (id && ids.includes(id)) cb.checked = this._selectedDocIds.has(id);
    });

    // Update button label to reflect current state
    if (feedbackBtn) {
      const isNowSelected = !allSelected;
      feedbackBtn.textContent = isNowSelected
        ? (ids.length === 1 ? "Désélectionner" : "Tout désélectionner")
        : (ids.length === 1 ? "Sélectionner" : "Tout sélectionner");
    }

    this._renderDocList();
    this._renderBatchBar();

    // Scroll so the user sees the batch bar when selecting
    if (!allSelected) this._batchBarEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  private _auditNavToDoc(docId: number): void {
    const doc = this._docs.find(d => d.doc_id === docId);
    if (!doc) return;
    this._selectedDoc = doc;
    this._renderDocList();
    this._renderEditPanel();
    this._editPanelEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /** One doc row: [ ☐ ] [#id] [title…………] [lang · role] [→] */
  private _auditDocRow(docId: number, extra: string, onToggle?: () => void): HTMLElement {
    const doc = this._docs.find(d => d.doc_id === docId);
    const title = doc?.title ?? `doc #${docId}`;
    const lang  = doc?.language ?? "";
    const role  = doc?.doc_role ?? "";

    const row = document.createElement("div");
    row.className = "audit-doc-row";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "audit-doc-check";
    cb.dataset.docId = String(docId);
    cb.checked = this._selectedDocIds.has(docId);
    cb.title = "Ajouter / retirer de la sélection";
    cb.addEventListener("change", () => {
      if (cb.checked) this._selectedDocIds.add(docId);
      else            this._selectedDocIds.delete(docId);
      this._renderBatchBar();
      if (cb.checked) this._batchBarEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      onToggle?.();
    });

    const idBadge = document.createElement("span");
    idBadge.className = "audit-doc-id-badge";
    idBadge.textContent = `#${docId}`;

    const titleEl = document.createElement("span");
    titleEl.className = "audit-doc-title-cell";
    titleEl.textContent = this._truncateMid(title, 44);
    titleEl.title = title;

    const metaEl = document.createElement("span");
    metaEl.className = "audit-doc-meta";
    metaEl.textContent = extra || [lang, role].filter(Boolean).join(" · ");

    const navBtn = document.createElement("button");
    navBtn.className = "audit-doc-nav-btn";
    navBtn.textContent = "→";
    navBtn.title = `Ouvrir la fiche du document #${docId}`;
    navBtn.addEventListener("click", () => this._auditNavToDoc(docId));

    row.appendChild(cb);
    row.appendChild(idBadge);
    row.appendChild(titleEl);
    row.appendChild(metaEl);
    row.appendChild(navBtn);
    return row;
  }

  /** Section with one row per document (missing fields, empty docs). */
  private _auditSimpleSection(
    title: string,
    items: { docId: number; extra: string }[],
  ): HTMLDetailsElement {
    const allIds = items.map(i => i.docId);
    const details = document.createElement("details");
    details.className = "audit-section";
    details.open = items.length <= 15;

    const summary = this._auditSummary(title, items.length,
      `${items.length} document${items.length > 1 ? "s" : ""}`, allIds);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "audit-section-body";
    items.forEach(item => body.appendChild(this._auditDocRow(item.docId, item.extra)));
    details.appendChild(body);
    return details;
  }

  /** Section with group cards (duplicate hashes / filenames / titles). */
  private _auditGroupSection(
    title: string,
    groups: { label: string; ids: number[] }[],
  ): HTMLDetailsElement {
    const PAGE = 20;
    const totalDocs = groups.reduce((s, g) => s + g.ids.length, 0);
    const allIds = groups.flatMap(g => g.ids);

    const details = document.createElement("details");
    details.className = "audit-section";
    details.open = groups.length <= 5;

    const summary = this._auditSummary(title, groups.length,
      `${groups.length} groupe${groups.length > 1 ? "s" : ""} · ${totalDocs} documents`, allIds);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "audit-section-body";

    const makeCard = (g: { label: string; ids: number[] }): HTMLElement => {
      const card = document.createElement("div");
      card.className = "audit-group-card";

      const head = document.createElement("div");
      head.className = "audit-group-head";

      const labelEl = document.createElement("span");
      labelEl.className = "audit-group-label";
      labelEl.textContent = g.label;
      labelEl.title = g.label;

      const countEl = document.createElement("span");
      countEl.className = "audit-group-count";
      countEl.textContent = `${g.ids.length} copie${g.ids.length > 1 ? "s" : ""}`;

      const selBtn = document.createElement("button");
      selBtn.className = "audit-sel-btn audit-sel-btn-sm";
      selBtn.textContent = "Sélectionner";
      selBtn.title = "Ajouter ce groupe à la sélection (puis Supprimer dans la barre)";
      const updateSelBtn = () => {
        const allSel = g.ids.every(id => this._selectedDocIds.has(id));
        selBtn.textContent = allSel ? "Tout désélectionner" : "Sélectionner";
      };
      selBtn.addEventListener("click", () => { this._auditSelectIds(g.ids, selBtn); updateSelBtn(); });

      head.appendChild(labelEl);
      head.appendChild(countEl);
      head.appendChild(selBtn);
      card.appendChild(head);

      g.ids.forEach(id => card.appendChild(this._auditDocRow(id, "", updateSelBtn)));
      return card;
    };

    const firstPage = groups.slice(0, PAGE);
    const rest = groups.slice(PAGE);
    firstPage.forEach(g => body.appendChild(makeCard(g)));

    if (rest.length > 0) {
      let offset = 0;
      const moreBtn = document.createElement("button");
      moreBtn.className = "audit-show-more-btn";
      const updateMoreBtn = () => {
        const remaining = rest.length - offset;
        moreBtn.textContent = `Afficher ${Math.min(PAGE, remaining)} groupe${remaining > 1 ? "s" : ""} de plus… (${remaining} restant${remaining > 1 ? "s" : ""})`;
      };
      updateMoreBtn();
      moreBtn.addEventListener("click", () => {
        const batch = rest.slice(offset, offset + PAGE);
        batch.forEach(g => body.insertBefore(makeCard(g), moreBtn));
        offset += batch.length;
        if (offset >= rest.length) moreBtn.remove();
        else updateMoreBtn();
      });
      body.appendChild(moreBtn);
    }

    details.appendChild(body);
    return details;
  }

  /** Shared <summary> element for audit sections. */
  private _auditSummary(title: string, count: number, metaText: string, allIds: number[]): HTMLElement {
    const summary = document.createElement("summary");
    summary.className = "audit-section-head";

    const badge = document.createElement("span");
    badge.className = "audit-badge audit-badge-warn";
    badge.textContent = String(count);

    const titleEl = document.createElement("strong");
    titleEl.textContent = title;

    const meta = document.createElement("span");
    meta.className = "audit-section-meta";
    meta.textContent = metaText;

    const selAllBtn = document.createElement("button");
    selAllBtn.className = "audit-sel-btn";
    selAllBtn.textContent = "Tout sélectionner";
    selAllBtn.title = "Ajouter tous ces documents à la sélection pour action groupée";
    selAllBtn.addEventListener("click", e => {
      e.stopPropagation(); // prevent <details> toggle
      this._auditSelectIds(allIds, selAllBtn);
    });

    summary.appendChild(badge);
    summary.appendChild(titleEl);
    summary.appendChild(meta);
    summary.appendChild(selAllBtn);
    return summary;
  }

  dispose(): void { /* nothing to clean up */ }
}
