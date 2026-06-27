/**
 * CurateExceptionsAdminPanel.ts — "Exceptions persistées" admin panel (Level 8A),
 * extracted from CurationView (U-02).
 *
 * Owns the persisted-exceptions panel end-to-end: its skeleton (built on `mount`),
 * its own state (filter / list / editing unit / doc-filter), lazy load, render (via
 * the pure helpers in `lib/curationExceptionsAdmin`), in-place override edit, delete
 * and export. Every effect that reaches the host's *live* curation state (reflecting
 * a delete/override onto the active preview + session summary) or navigates the
 * curation view is delegated through {@link CurateExceptionsAdminPanelDeps} — the
 * panel holds no shared mutable state.
 *
 * The host (CurationView) keeps `openInCuration` (it drives the doc selector +
 * preview machinery) and applies the shared-state effects via `onExceptionDeleted` /
 * `onExceptionUpdated`. The pure filter/group/format helpers are tested in
 * `lib/__tests__/curationExceptionsAdmin.test.ts`.
 */

import { setHtml, raw } from "../lib/safeHtml.ts";
import { escHtml as _escHtml } from "../lib/diff.ts";
import type {
  Conn,
  CurateException,
  ExportCurateExceptionsOptions,
} from "../lib/sidecarClient.ts";
import {
  listCurateExceptions,
  setCurateException,
  deleteCurateException,
  exportCurateExceptions,
  SidecarError,
} from "../lib/sidecarClient.ts";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import {
  filterExceptions,
  buildExcDocOptions,
  formatExcAdminList,
  type ExcKindFilter,
} from "../lib/curationExceptionsAdmin.ts";

/** Host-supplied reads + outward effects. The panel mutates no shared state itself. */
export interface CurateExceptionsAdminPanelDeps {
  /** Live engine connection (never cached). */
  getConn(): Conn | null;
  /** Append to the prep-pane log. */
  log(msg: string, isError?: boolean): void;
  /** Optional toast. */
  toast?(msg: string, isError?: boolean): void;
  /** Append to the curation activity log (preview/apply/warn). */
  pushLog(kind: "preview" | "apply" | "warn", msg: string): void;
  /** Host reflects a deleted exception onto its live preview state + session summary. */
  onExceptionDeleted(unitId: number): void;
  /** Host reflects an updated override onto its live preview state + session summary. */
  onExceptionUpdated(unitId: number, overrideText: string): void;
  /** Host navigates the curation view to the exception's document + unit. */
  openInCuration(exc: CurateException): void | Promise<void>;
}

export class CurateExceptionsAdminPanel {
  private _filter: "all" | "ignore" | "override" = "all";
  private _all: CurateException[] = [];
  private _editing: number | null = null;
  private _docFilter = 0;

  /**
   * @param _root the host `<details>` element (id `act-exc-admin-panel`); the panel
   *   fills it with its skeleton on {@link mount}.
   */
  constructor(
    private readonly _root: HTMLDetailsElement,
    private readonly _deps: CurateExceptionsAdminPanelDeps,
  ) {}

  private _q<T extends HTMLElement>(selector: string): T | null {
    return this._root.querySelector<T>(selector);
  }

  /** Build the skeleton into the host element and wire the panel's own listeners. */
  mount(): void {
    setHtml(this._root, raw(`
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
    `));

    this._q("#act-exc-admin-refresh")?.addEventListener("click", () => {
      void this.load();
    });
    // Lazy-load the first time the panel is opened.
    this._root.addEventListener("toggle", () => {
      if (this._root.open && this._all.length === 0) void this.load();
    });
    this._root.querySelectorAll<HTMLButtonElement>(".prep-exc-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const filter = btn.dataset.excFilter as "all" | "ignore" | "override" | undefined;
        if (filter) this._setFilter(filter);
      });
    });
    this._q("#act-exc-admin-list")?.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-exc-unit-id]");
      if (!row) return;
      const unitId = parseInt(row.dataset.excUnitId ?? "0");
      if (!unitId) return;
      if (target.closest(".prep-exc-row-delete")) {
        await this._delete(unitId);
      } else if (target.closest(".prep-exc-row-edit-start")) {
        this._enterEdit(unitId);
      } else if (target.closest(".prep-exc-row-edit-save")) {
        await this._saveEdit(unitId);
      } else if (target.closest(".prep-exc-row-edit-cancel")) {
        this._cancelEdit(unitId);
      } else if (target.closest(".prep-exc-row-open-curation")) {
        const exc = this._all.find((x) => x.unit_id === unitId);
        if (exc) await this._deps.openInCuration(exc);
      }
    });
    this._q<HTMLSelectElement>("#act-exc-doc-filter")?.addEventListener("change", (e) => {
      const val = (e.target as HTMLSelectElement).value;
      this._docFilter = val ? parseInt(val) : 0;
      this._render();
    });
    this._q("#act-exc-export-json")?.addEventListener("click", () => void this._runExport("json"));
    this._q("#act-exc-export-csv")?.addEventListener("click", () => void this._runExport("csv"));
  }

  /**
   * Called by the host after a preview: reload when the panel is open (the persisted
   * list may have changed), otherwise just reflect the live session-exception count
   * on the summary badge.
   */
  refreshAfterPreview(sessionExceptionCount: number): void {
    if (this._root.open) {
      void this.load();
      return;
    }
    const badge = this._q<HTMLElement>("#act-exc-admin-badge");
    if (badge && sessionExceptionCount > 0) {
      badge.textContent = String(sessionExceptionCount);
      badge.style.display = "inline-flex";
    }
  }

  async load(): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    const list = this._q<HTMLElement>("#act-exc-admin-list");
    if (!list) return;
    list.innerHTML = `<p class="empty-hint prep-exc-admin-loading">Chargement…</p>`;
    try {
      const res = await listCurateExceptions(conn);
      this._all = res.exceptions;
      this._editing = null;
      this._deps.pushLog("preview", `${res.count} exception(s) persistée(s) chargée(s) dans le panneau admin`);
      this._render();
    } catch (err) {
      list.innerHTML = `<p class="empty-hint" style="color:#b91c1c">Erreur lors du chargement : ${_escHtml(String(err))}</p>`;
    }
  }

  private _setFilter(f: "all" | "ignore" | "override"): void {
    this._filter = f;
    this._root.querySelectorAll<HTMLButtonElement>(".prep-exc-filter-btn").forEach((btn) => {
      btn.classList.toggle("prep-exc-filter-active", btn.dataset.excFilter === f);
    });
    this._render();
  }

  private _render(): void {
    // Filter/group/format délégués au helper pur (testé dans
    // __tests__/curationExceptionsAdmin.test.ts). Reste DOM-bound : mise à jour du
    // badge et reconstruction conditionnelle du <select> doc-filter (préserver la
    // valeur courante quand la liste change).
    const list = this._q<HTMLElement>("#act-exc-admin-list");
    const badge = this._q<HTMLElement>("#act-exc-admin-badge");
    if (!list) return;
    const all = this._all;
    if (badge) { badge.textContent = String(all.length); badge.style.display = all.length > 0 ? "inline-flex" : "none"; }
    const docSel = this._q<HTMLSelectElement>("#act-exc-doc-filter");
    if (docSel) {
      const knownDocs = buildExcDocOptions(all);
      const existingDocIds = new Set(Array.from(docSel.options).slice(1).map((o) => parseInt(o.value)));
      const newDocIds = new Set(knownDocs.keys());
      const needsRebuild = existingDocIds.size !== newDocIds.size || [...newDocIds].some((id) => !existingDocIds.has(id));
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
    const filtered = filterExceptions(all, this._filter as ExcKindFilter, this._docFilter);
    setHtml(list, raw(formatExcAdminList(filtered, {
      editingUnitId: this._editing,
      showDocHeads: this._docFilter === 0,
      totalIsEmpty: all.length === 0,
    })));
  }

  private async _delete(unitId: number): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    try {
      await deleteCurateException(conn, unitId);
      this._all = this._all.filter((e) => e.unit_id !== unitId);
      this._deps.log(`🔓 Exception persistée supprimée (panneau admin) – unité ${unitId}.`);
      this._deps.pushLog("apply", `Exception supprimée via admin – unité ${unitId}`);
      this._render();
      this._deps.onExceptionDeleted(unitId);
    } catch (err) {
      this._deps.log(`✗ Erreur lors de la suppression de l'exception ${unitId} : ${String(err)}`, true);
    }
  }

  private _enterEdit(unitId: number): void {
    this._editing = unitId;
    this._render();
    const ta = this._q<HTMLTextAreaElement>(`#exc-edit-${unitId}`);
    ta?.focus();
  }

  private async _saveEdit(unitId: number): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    const ta = this._q<HTMLTextAreaElement>(`#exc-edit-${unitId}`);
    const newText = ta?.value.trim() ?? "";
    if (!newText) { this._deps.log("⚠ Le texte override ne peut pas être vide.", true); return; }
    try {
      await setCurateException(conn, { unit_id: unitId, kind: "override", override_text: newText });
      const idx = this._all.findIndex((e) => e.unit_id === unitId);
      if (idx >= 0) this._all[idx] = { ...this._all[idx], override_text: newText };
      this._editing = null;
      this._deps.log(`🔒 Override persisté mis à jour – unité ${unitId}.`);
      this._deps.pushLog("apply", `Override persisté mis à jour via admin – unité ${unitId}`);
      this._render();
      this._deps.onExceptionUpdated(unitId, newText);
    } catch (err) {
      this._deps.log(`✗ Erreur lors de la mise à jour de l'override : ${String(err)}`, true);
    }
  }

  private _cancelEdit(unitId: number): void {
    if (this._editing === unitId) this._editing = null;
    this._render();
  }

  private async _runExport(fmt: "json" | "csv"): Promise<void> {
    const conn = this._deps.getConn();
    if (!conn) return;
    const docId = this._docFilter > 0 ? this._docFilter : undefined;
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
    const btnCsv = this._q<HTMLButtonElement>("#act-exc-export-csv");
    if (btnJson) btnJson.disabled = true;
    if (btnCsv) btnCsv.disabled = true;
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
      this._deps.log(`✓ Exceptions exportées (${fmt.toUpperCase()}) : ${res.count} → ${res.out_path}`);
      this._deps.toast?.(msg);
    } catch (err) {
      const msg = `✗ Erreur export : ${err instanceof SidecarError ? err.message : String(err)}`;
      if (resultEl) { resultEl.style.display = ""; resultEl.className = "prep-exc-export-result exc-export-error"; resultEl.textContent = msg; }
      this._deps.log(msg, true);
      this._deps.toast?.("✗ Erreur export exceptions", true);
    } finally {
      if (btnJson) btnJson.disabled = false;
      if (btnCsv) btnCsv.disabled = false;
    }
  }
}
