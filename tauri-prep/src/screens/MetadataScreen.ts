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
  getDocRelations,
  setDocRelation,
  deleteDocRelation,
  backupDatabase,
  validateMeta,
  type DocumentRecord,
  type DocumentPreviewLine,
  type DocRelationRecord,
  SidecarError,
} from "../lib/sidecarClient.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";

const DOC_ROLES = ["standalone", "original", "translation", "excerpt", "unknown"];
const RELATION_TYPES = ["translation_of", "excerpt_of"];
const WORKFLOW_STATUS = ["draft", "review", "validated"] as const;
type WorkflowStatus = (typeof WORKFLOW_STATUS)[number];

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
          </div>
        </div>
      </div>

      <!-- 2-col workspace -->
      <div class="meta-layout">

        <!-- Left column: document list (not collapsible — always visible) -->
        <section class="card meta-list-card">
          <div class="meta-list-head">
            <div class="meta-list-head-left">
              <h3 style="margin:0">Documents</h3>
              <button id="refresh-docs-btn" class="btn btn-secondary btn-sm"
                aria-label="Rafraîchir la liste des documents" title="Rafraîchir la liste">↻</button>
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
          </div>
          <div class="meta-doc-list-wrap">
            <table class="meta-doc-table" aria-label="Documents du corpus">
              <thead>
                <tr>
                  <th class="col-check">
                    <input id="meta-select-all" type="checkbox" aria-label="Sélectionner tout" />
                  </th>
                  <th class="col-id">ID</th>
                  <th class="col-title">Titre</th>
                  <th class="col-lang">Langue</th>
                  <th class="col-role">Rôle</th>
                  <th class="col-status">Statut</th>
                </tr>
              </thead>
              <tbody id="meta-doc-list"></tbody>
            </table>
          </div>
          <div id="meta-batch-bar" class="meta-batch-bar">
            <span id="meta-batch-meta" class="meta-batch-meta">0 sélectionné</span>
            <div class="meta-batch-actions">
              <button id="meta-batch-role-btn" class="btn btn-secondary btn-sm" disabled>Définir rôle</button>
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
    root.querySelector("#validate-btn")!.addEventListener("click", () => this._runValidate());
    root.querySelector("#db-backup-btn")!.addEventListener("click", () => void this._runDbBackup());

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
        <td class="col-title" title="${this._esc(doc.title)}">${this._esc(doc.title)}</td>
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
      </div>

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
      this._renderRelationsList();
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
      this._renderRelationsList();
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
    if (!this._docFilter) return docs;
    const q = this._docFilter;
    return docs.filter((doc) => {
      const title   = (doc.title ?? "").toLowerCase();
      const lang    = (doc.language ?? "").toLowerCase();
      const role    = (doc.doc_role ?? "").toLowerCase();
      const restype = (doc.resource_type ?? "").toLowerCase();
      const id      = String(doc.doc_id);
      return title.includes(q) || lang.includes(q) || role.includes(q) || restype.includes(q) || id.includes(q);
    });
  }

  private _esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
    const title          = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-title")?.value ?? "").trim();
    const language       = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-lang")?.value ?? "").trim();
    const docRole        = (this._editPanelEl.querySelector<HTMLSelectElement>("#edit-role")?.value ?? "").trim();
    const resourceType   = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-restype")?.value ?? "").trim();
    const workflow       = (this._editPanelEl.querySelector<HTMLSelectElement>("#edit-workflow-status")?.value ?? "draft").trim();
    const validatedRunId = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-validated-run-id")?.value ?? "").trim();

    const baseTitle          = (this._selectedDoc.title ?? "").trim();
    const baseLanguage       = (this._selectedDoc.language ?? "").trim();
    const baseDocRole        = (this._selectedDoc.doc_role ?? "unknown").trim();
    const baseResourceType   = (this._selectedDoc.resource_type ?? "").trim();
    const baseWorkflow       = this._workflowStatus(this._selectedDoc);
    const baseValidatedRunId = (this._selectedDoc.validated_run_id ?? "").trim();

    return (
      title !== baseTitle ||
      language !== baseLanguage ||
      docRole !== baseDocRole ||
      resourceType !== baseResourceType ||
      workflow !== baseWorkflow ||
      validatedRunId !== baseValidatedRunId
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

  dispose(): void { /* nothing to clean up */ }
}
