/**
 * MetadataScreen.ts — Corpus metadata panel (V0.4A).
 *
 * Tabs: Projet | Import | Actions | Métadonnées | Exports
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
  updateDocument,
  bulkUpdateDocuments,
  getDocRelations,
  setDocRelation,
  deleteDocRelation,
  validateMeta,
  type DocumentRecord,
  type DocRelationRecord,
  SidecarError,
} from "../lib/sidecarClient.ts";

const DOC_ROLES = ["standalone", "original", "translation", "excerpt", "unknown"];
const RELATION_TYPES = ["translation_of", "excerpt_of"];

export class MetadataScreen {
  private _conn: Conn | null = null;
  private _docs: DocumentRecord[] = [];
  private _selectedDoc: DocumentRecord | null = null;
  private _relations: DocRelationRecord[] = [];

  // DOM refs
  private _root!: HTMLElement;
  private _docListEl!: HTMLElement;
  private _editPanelEl!: HTMLElement;
  private _logEl!: HTMLElement;

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._selectedDoc = null;
    this._relations = [];
    if (this._root) {
      this._refreshDocList();
    }
  }

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen actions-screen";
    this._root = root;

    root.innerHTML = `
      <h2 class="screen-title">Métadonnées</h2>

      <!-- Bulk edit + Validate bar -->
      <div class="card">
        <h3>Édition en masse</h3>
        <div class="form-row">
          <label>Doc role (tous)
            <select id="bulk-role">
              <option value="">— ne pas changer —</option>
              ${DOC_ROLES.map(r => `<option value="${r}">${r}</option>`).join("")}
            </select>
          </label>
          <label>Resource type (tous)
            <input id="bulk-restype" type="text" placeholder="literary, legal, …" style="max-width:160px">
          </label>
          <div style="align-self:flex-end">
            <button id="bulk-apply-btn" class="btn btn-secondary btn-sm" disabled>Appliquer à tous</button>
            <button id="validate-btn" class="btn btn-secondary btn-sm" style="margin-left:0.4rem">Valider métadonnées</button>
          </div>
        </div>
      </div>

      <!-- Two-column layout: doc list + edit panel -->
      <div style="display:flex;gap:1rem;align-items:flex-start">

        <!-- Doc list -->
        <div class="card" style="flex:1;min-width:240px">
          <h3>Documents <button id="refresh-docs-btn" class="btn btn-secondary btn-sm">↻</button></h3>
          <div id="meta-doc-list" class="doc-list" style="max-height:400px;overflow-y:auto"></div>
        </div>

        <!-- Edit panel -->
        <div class="card" style="flex:2">
          <h3>Édition du document sélectionné</h3>
          <div id="meta-edit-panel">
            <p class="empty-hint">Sélectionnez un document dans la liste.</p>
          </div>
        </div>
      </div>

      <!-- Log -->
      <div class="card">
        <h3>Journal</h3>
        <div id="meta-log" class="log-pane"></div>
      </div>
    `;

    this._docListEl = root.querySelector("#meta-doc-list")!;
    this._editPanelEl = root.querySelector("#meta-edit-panel")!;
    this._logEl = root.querySelector("#meta-log")!;

    root.querySelector("#refresh-docs-btn")!.addEventListener("click", () => this._refreshDocList());
    root.querySelector("#bulk-apply-btn")!.addEventListener("click", () => this._runBulkUpdate());
    root.querySelector("#validate-btn")!.addEventListener("click", () => this._runValidate());

    // Enable bulk-apply when any bulk field has value
    const bulkRole = root.querySelector<HTMLSelectElement>("#bulk-role")!;
    const bulkRestype = root.querySelector<HTMLInputElement>("#bulk-restype")!;
    const bulkBtn = root.querySelector<HTMLButtonElement>("#bulk-apply-btn")!;
    const onBulkChange = () => {
      bulkBtn.disabled = !bulkRole.value && !bulkRestype.value.trim();
    };
    bulkRole.addEventListener("change", onBulkChange);
    bulkRestype.addEventListener("input", onBulkChange);

    this._refreshDocList();
    return root;
  }

  // ── Doc list ────────────────────────────────────────────────────────────────

  private async _refreshDocList(): Promise<void> {
    if (!this._conn) {
      this._docListEl.innerHTML = `<p class="empty-hint">Sidecar non connecté.</p>`;
      return;
    }
    try {
      this._docs = await listDocuments(this._conn);
    } catch (err) {
      this._log(`Erreur liste documents: ${err instanceof SidecarError ? err.message : String(err)}`, true);
      return;
    }
    this._renderDocList();
  }

  private _renderDocList(): void {
    if (this._docs.length === 0) {
      this._docListEl.innerHTML = `<p class="empty-hint">Aucun document.</p>`;
      return;
    }
    this._docListEl.innerHTML = "";
    for (const doc of this._docs) {
      const row = document.createElement("div");
      row.className = "meta-doc-row";
      row.style.cssText = "padding:0.35rem 0.5rem;cursor:pointer;border-bottom:1px solid var(--color-border);";
      if (this._selectedDoc?.doc_id === doc.doc_id) {
        row.style.background = "#e0ecff";
      }
      row.innerHTML = `
        <div style="font-weight:600;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._esc(doc.title)}</div>
        <div style="font-size:0.78rem;color:var(--color-muted)">#${doc.doc_id} · ${doc.language} · ${doc.unit_count} unités</div>
      `;
      row.addEventListener("click", () => this._selectDoc(doc));
      this._docListEl.appendChild(row);
    }
  }

  // ── Edit panel ──────────────────────────────────────────────────────────────

  private async _selectDoc(doc: DocumentRecord): Promise<void> {
    this._selectedDoc = doc;
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
          <input id="edit-restype" type="text" value="${this._esc(doc.resource_type ?? "")}" style="max-width:160px" placeholder="literary, legal, …">
        </label>
      </div>
      <div class="btn-row" style="margin-bottom:1rem">
        <button id="save-doc-btn" class="btn btn-primary btn-sm">Enregistrer</button>
      </div>

      <h4 style="font-size:0.88rem;font-weight:600;margin:0.5rem 0">Relations documentaires</h4>
      <div class="form-row" style="align-items:flex-end">
        <label>Type
          <select id="rel-type">
            ${RELATION_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select>
        </label>
        <label>Doc cible (id)
          <input id="rel-target" type="number" min="1" placeholder="doc_id" style="max-width:80px">
        </label>
        <label>Note
          <input id="rel-note" type="text" placeholder="optionnel" style="max-width:160px">
        </label>
        <button id="add-rel-btn" class="btn btn-secondary btn-sm">Ajouter</button>
      </div>
      <div id="relations-list"></div>
    `;

    this._renderRelationsList();

    this._editPanelEl.querySelector("#save-doc-btn")!.addEventListener("click", () => this._saveDoc());
    this._editPanelEl.querySelector("#add-rel-btn")!.addEventListener("click", () => this._addRelation());
  }

  private _renderRelationsList(): void {
    const container = this._editPanelEl.querySelector<HTMLElement>("#relations-list");
    if (!container) return;
    if (this._relations.length === 0) {
      container.innerHTML = `<p class="empty-hint" style="margin-top:0.5rem">Aucune relation.</p>`;
      return;
    }
    container.innerHTML = "";
    for (const rel of this._relations) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;padding:0.2rem 0;border-bottom:1px solid var(--color-border)";
      row.innerHTML = `
        <span style="flex:1">${this._esc(rel.relation_type)} → doc #${rel.target_doc_id}${rel.note ? ` <em>(${this._esc(rel.note)})</em>` : ""}</span>
        <button class="btn btn-danger btn-sm del-rel-btn" data-id="${rel.id}">✕</button>
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

    const btn = this._editPanelEl.querySelector<HTMLButtonElement>("#save-doc-btn")!;
    btn.disabled = true;
    try {
      const res = await updateDocument(this._conn, {
        doc_id: this._selectedDoc.doc_id,
        title: title || undefined,
        language: language || undefined,
        doc_role: doc_role || undefined,
        resource_type,
      });
      // Update local state
      const updated = res.doc;
      this._selectedDoc = { ...this._selectedDoc, ...updated };
      const idx = this._docs.findIndex(d => d.doc_id === updated.doc_id);
      if (idx >= 0) this._docs[idx] = { ...this._docs[idx], ...updated };
      this._renderDocList();
      this._log(`✓ Document #${updated.doc_id} mis à jour.`);
    } catch (err) {
      this._log(`Erreur sauvegarde: ${err instanceof SidecarError ? err.message : String(err)}`, true);
    } finally {
      btn.disabled = false;
    }
  }

  private async _addRelation(): Promise<void> {
    if (!this._conn || !this._selectedDoc) return;
    const rel_type = (this._editPanelEl.querySelector<HTMLSelectElement>("#rel-type")!).value;
    const target_str = (this._editPanelEl.querySelector<HTMLInputElement>("#rel-target")!).value.trim();
    const note = (this._editPanelEl.querySelector<HTMLInputElement>("#rel-note")!).value.trim() || undefined;
    const target_doc_id = parseInt(target_str);
    if (!target_str || isNaN(target_doc_id)) {
      this._log("Doc cible (id) invalide.", true);
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

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _log(msg: string, isError = false): void {
    const line = document.createElement("div");
    line.className = "log-line" + (isError ? " log-error" : "");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }

  private _esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}
