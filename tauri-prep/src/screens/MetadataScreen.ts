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
  private _selectedDoc: DocumentRecord | null = null;
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
  private _isBusy = false;
  private _lastErrorMsg: string | null = null;

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._docFilter = "";
    this._selectedDoc = null;
    this._relations = [];
    this._previewLines = [];
    this._previewTotalLines = 0;
    this._previewError = null;
    this._previewDocId = null;
    this._previewLoading = false;
    if (this._root) {
      const filterInput = this._root.querySelector<HTMLInputElement>("#meta-doc-filter");
      if (filterInput) filterInput.value = "";
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
      <h2 class="screen-title">Documents</h2>

      <section class="card" data-collapsible="true" data-collapsed-default="true">
        <h3>État de session</h3>
        <div id="meta-state-banner" class="runtime-state state-info" aria-live="polite">
          En attente de connexion sidecar…
        </div>
      </section>

      <section class="card" data-collapsible="true">
        <div class="meta-toolbar-head">
          <h3 style="margin:0">Gestion corpus</h3>
          <span id="meta-doc-count" class="hint" style="margin:0">0 document</span>
        </div>
        <div class="btn-row" style="margin-bottom:0.55rem; align-items:center">
          <button id="db-backup-btn" class="btn btn-secondary btn-sm">Sauvegarder la DB</button>
          <button id="validate-btn" class="btn btn-secondary btn-sm">Valider métadonnées</button>
          <span id="db-backup-status" class="hint" style="margin:0">Aucune sauvegarde récente</span>
        </div>
        <details class="meta-bulk-disclosure">
          <summary>Édition en masse</summary>
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
        </details>
      </section>

      <div class="meta-layout">
        <section class="card meta-list-card" data-collapsible="true">
          <h3>Documents <button id="refresh-docs-btn" class="btn btn-secondary btn-sm" aria-label="Rafraîchir la liste des documents" title="Rafraîchir la liste des documents">↻</button></h3>
          <div class="form-row" style="margin:0 0 0.45rem">
            <label style="margin:0;min-width:250px">Recherche
              <input id="meta-doc-filter" type="text" placeholder="Titre, langue, #doc_id…" />
            </label>
          </div>
          <div id="meta-doc-list" class="doc-list meta-doc-list"></div>
        </section>

        <section class="card meta-edit-card" data-collapsible="true">
          <h3>Édition du document sélectionné</h3>
          <div id="meta-edit-panel">
            <p class="empty-hint">Sélectionnez un document dans la liste.</p>
          </div>
        </section>
      </div>

      <section class="card meta-log-card" data-collapsible="true" data-collapsed-default="true">
        <h3>Journal des actions documents</h3>
        <div id="meta-log" class="log-pane"></div>
      </section>
    `;

    this._docListEl = root.querySelector("#meta-doc-list")!;
    this._editPanelEl = root.querySelector("#meta-edit-panel")!;
    this._logEl = root.querySelector("#meta-log")!;
    this._docCountEl = root.querySelector("#meta-doc-count")!;
    this._stateEl = root.querySelector("#meta-state-banner")!;

    root.querySelector("#refresh-docs-btn")!.addEventListener("click", () => this._refreshDocList());
    root.querySelector("#meta-doc-filter")!.addEventListener("input", (e) => {
      this._docFilter = ((e.target as HTMLInputElement).value ?? "").trim().toLowerCase();
      this._renderDocList();
    });
    root.querySelector("#bulk-apply-btn")!.addEventListener("click", () => this._runBulkUpdate());
    root.querySelector("#validate-btn")!.addEventListener("click", () => this._runValidate());
    root.querySelector("#db-backup-btn")!.addEventListener("click", () => void this._runDbBackup());

    // Enable bulk-apply when any bulk field has value
    const bulkRole = root.querySelector<HTMLSelectElement>("#bulk-role")!;
    const bulkRestype = root.querySelector<HTMLInputElement>("#bulk-restype")!;
    const bulkBtn = root.querySelector<HTMLButtonElement>("#bulk-apply-btn")!;
    const onBulkChange = () => {
      bulkBtn.disabled = !bulkRole.value && !bulkRestype.value.trim();
    };
    bulkRole.addEventListener("change", onBulkChange);
    bulkRestype.addEventListener("input", onBulkChange);

    initCardAccordions(root);
    this._refreshDocList();
    return root;
  }

  // ── Doc list ────────────────────────────────────────────────────────────────

  private async _refreshDocList(): Promise<void> {
    if (!this._conn) {
      this._docListEl.innerHTML = `<p class="empty-hint">Sidecar non connecté.</p>`;
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
      this._docListEl.innerHTML = `<p class="empty-hint">Aucun document.</p>`;
      return;
    }
    const docs = this._filteredDocs();
    if (docs.length === 0) {
      this._docListEl.innerHTML = `<p class="empty-hint">Aucun document ne correspond à la recherche.</p>`;
      return;
    }
    this._docListEl.innerHTML = "";
    for (const doc of docs) {
      const row = document.createElement("div");
      row.className = "meta-doc-row";
      if (this._selectedDoc?.doc_id === doc.doc_id) {
        row.classList.add("is-active");
      }
      const wfStatus = this._workflowStatus(doc);
      const wfLabel = this._workflowLabel(wfStatus);
      const validatedMeta = wfStatus === "validated" && doc.validated_at
        ? `<span class="wf-meta">validé ${this._esc(new Date(doc.validated_at).toLocaleDateString())}</span>`
        : "";
      row.innerHTML = `
        <div class="meta-doc-title">${this._esc(doc.title)}</div>
        <div class="meta-doc-meta">
          <span>#${doc.doc_id} · ${this._esc(doc.language)} · ${doc.unit_count} unités</span>
          <span class="wf-pill wf-${wfStatus}">${wfLabel}</span>
          ${validatedMeta}
        </div>
      `;
      row.addEventListener("click", () => this._selectDoc(doc));
      this._docListEl.appendChild(row);
    }
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
    if (this._docFilter) {
      this._docCountEl.textContent = `${shown} / ${total} document${total > 1 ? "s" : ""}`;
    } else {
      this._docCountEl.textContent = `${total} document${total > 1 ? "s" : ""}`;
    }
    this._refreshRuntimeState();
  }

  private _filteredDocs(): DocumentRecord[] {
    if (!this._docFilter) return this._docs;
    const q = this._docFilter;
    return this._docs.filter((doc) => {
      const title = (doc.title ?? "").toLowerCase();
      const lang = (doc.language ?? "").toLowerCase();
      const role = (doc.doc_role ?? "").toLowerCase();
      const restype = (doc.resource_type ?? "").toLowerCase();
      const id = String(doc.doc_id);
      return (
        title.includes(q) ||
        lang.includes(q) ||
        role.includes(q) ||
        restype.includes(q) ||
        id.includes(q)
      );
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
    const role = this._root.querySelector<HTMLSelectElement>("#bulk-role");
    const restype = this._root.querySelector<HTMLInputElement>("#bulk-restype");
    return Boolean((role?.value ?? "").trim() || (restype?.value ?? "").trim());
  }

  private _isSelectedDocDirty(): boolean {
    if (!this._selectedDoc || !this._editPanelEl) return false;
    const title = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-title")?.value ?? "").trim();
    const language = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-lang")?.value ?? "").trim();
    const docRole = (this._editPanelEl.querySelector<HTMLSelectElement>("#edit-role")?.value ?? "").trim();
    const resourceType = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-restype")?.value ?? "").trim();
    const workflow = (this._editPanelEl.querySelector<HTMLSelectElement>("#edit-workflow-status")?.value ?? "draft").trim();
    const validatedRunId = (this._editPanelEl.querySelector<HTMLInputElement>("#edit-validated-run-id")?.value ?? "").trim();

    const baseTitle = (this._selectedDoc.title ?? "").trim();
    const baseLanguage = (this._selectedDoc.language ?? "").trim();
    const baseDocRole = (this._selectedDoc.doc_role ?? "unknown").trim();
    const baseResourceType = (this._selectedDoc.resource_type ?? "").trim();
    const baseWorkflow = this._workflowStatus(this._selectedDoc);
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
    const relNote = (this._editPanelEl.querySelector<HTMLInputElement>("#rel-note")?.value ?? "").trim();
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
}
