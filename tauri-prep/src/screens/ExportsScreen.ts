/**
 * ExportsScreen.ts — Corpus export panel (V0.4B).
 *
 * Features:
 *   - Export TEI: choose docs (all or selected) + output directory (dialog)
 *   - Export Alignment CSV/TSV: pivot/target doc filter + output file (dialog)
 *   - Export Run Report: JSONL or HTML + output file (dialog)
 */

import type { Conn } from "../lib/sidecarClient.ts";
import {
  listDocuments,
  getFamilies,
  enqueueJob,
  getJob,
  type DocumentRecord,
  type FamilyRecord,
  SidecarError,
} from "../lib/sidecarClient.ts";
import { save, open } from "@tauri-apps/plugin-dialog";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";
import { setHtml, raw } from "../lib/safeHtml.ts";
import { exportsScreenTemplate } from "../lib/exportsScreenTemplate.ts";
import { productsForStage, formatsForProduct } from "../lib/exportV2Options.ts";

function _escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface ExportWorkflowPrefill {
  stage?: "alignment" | "publication" | "segmentation" | "curation" | "runs" | "qa";
  product?: "aligned_table" | "tei_xml" | "tei_package" | "run_report" | "qa_report" | "readable_text";
  format?: "csv" | "tsv" | "tei_dir" | "zip" | "jsonl" | "html" | "json" | "txt" | "docx" | "odt";
  docIds?: number[];
  pivotDocId?: number;
  targetDocId?: number;
  runId?: string;
  exceptionsOnly?: boolean;
  strictMode?: boolean;
}

export class ExportsScreen {
  private _conn: Conn | null = null;
  private _docs: DocumentRecord[] = [];
  private _families: FamilyRecord[] = [];
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;
  private _isBusy = false;
  private _lastErrorMsg: string | null = null;
  private _pollTimerId: ReturnType<typeof setTimeout> | null = null;

  // DOM refs
  private _root!: HTMLElement;
  private _logEl: HTMLElement = document.createElement("div");
  private _stateEl!: HTMLElement;
  private _docSelEl!: HTMLSelectElement;
  private _pkgDocSelEl!: HTMLSelectElement;
  private _pivotSelEl!: HTMLSelectElement;
  private _targetSelEl!: HTMLSelectElement;
  private _v2DocSelEl!: HTMLSelectElement;
  private _v2StageEl!: HTMLSelectElement;
  private _v2ProductEl!: HTMLSelectElement;
  private _v2FormatEl!: HTMLSelectElement;
  private _v2DocSummaryEl!: HTMLElement;
  private _v2DocSelectAllBtn!: HTMLButtonElement;
  private _v2DocClearBtn!: HTMLButtonElement;
  private _v2PivotEl!: HTMLSelectElement;
  private _v2TargetEl!: HTMLSelectElement;
  private _v2RunIdEl!: HTMLInputElement;
  private _v2StrictEl!: HTMLInputElement;
  private _v2RunBtn!: HTMLButtonElement;
  private _legacyContainer!: HTMLElement;
  private _legacyToggleBtn!: HTMLButtonElement;
  private _pendingWorkflowPrefill: ExportWorkflowPrefill | null = null;

  // Bilingue / TMX card
  private _bilFamilySelEl!: HTMLSelectElement;
  private _bilPivotSelEl!: HTMLSelectElement;
  private _bilTargetSelEl!: HTMLSelectElement;
  private _bilFmtEl!: HTMLSelectElement;
  private _bilRunBtn!: HTMLButtonElement;
  private _bilPreviewBtn!: HTMLButtonElement;

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    if (this._root) this._refreshDocs();
    this._refreshRuntimeState();
  }

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen prep-exports-screen";
    this._root = root;

    setHtml(root, raw(exportsScreenTemplate()));
    this._stateEl = root.querySelector("#exp-state-banner")!;
    this._docSelEl = root.querySelector<HTMLSelectElement>("#tei-doc-sel")!;
    this._pkgDocSelEl = root.querySelector<HTMLSelectElement>("#pkg-doc-sel")!;
    this._pivotSelEl = root.querySelector<HTMLSelectElement>("#align-csv-pivot")!;
    this._targetSelEl = root.querySelector<HTMLSelectElement>("#align-csv-target")!;
    this._v2DocSelEl = root.querySelector<HTMLSelectElement>("#v2-doc-sel")!;
    this._v2StageEl = root.querySelector<HTMLSelectElement>("#v2-stage")!;
    this._v2ProductEl = root.querySelector<HTMLSelectElement>("#v2-product")!;
    this._v2FormatEl = root.querySelector<HTMLSelectElement>("#v2-format")!;
    this._v2DocSummaryEl = root.querySelector<HTMLElement>("#v2-doc-summary")!;
    this._v2DocSelectAllBtn = root.querySelector<HTMLButtonElement>("#v2-doc-select-all-btn")!;
    this._v2DocClearBtn = root.querySelector<HTMLButtonElement>("#v2-doc-clear-btn")!;
    this._v2PivotEl = root.querySelector<HTMLSelectElement>("#v2-align-pivot")!;
    this._v2TargetEl = root.querySelector<HTMLSelectElement>("#v2-align-target")!;
    this._v2RunIdEl = root.querySelector<HTMLInputElement>("#v2-run-id")!;
    this._v2StrictEl = root.querySelector<HTMLInputElement>("#v2-qa-strict-mode")!;
    this._v2RunBtn = root.querySelector<HTMLButtonElement>("#v2-run-btn")!;
    this._legacyContainer = root.querySelector<HTMLElement>("#exports-legacy-container")!;
    this._legacyToggleBtn = root.querySelector<HTMLButtonElement>("#exports-toggle-legacy-btn")!;
    this._bilFamilySelEl = root.querySelector<HTMLSelectElement>("#bil-family-sel")!;
    this._bilPivotSelEl = root.querySelector<HTMLSelectElement>("#bil-pivot-sel")!;
    this._bilTargetSelEl = root.querySelector<HTMLSelectElement>("#bil-target-sel")!;
    this._bilFmtEl = root.querySelector<HTMLSelectElement>("#bil-fmt")!;
    this._bilRunBtn = root.querySelector<HTMLButtonElement>("#bil-run-btn")!;
    this._bilPreviewBtn = root.querySelector<HTMLButtonElement>("#bil-preview-btn")!;

    // EXP-1: head card — run pill + back button
    const runPill = root.querySelector<HTMLElement>("#exp-run-pill");
    if (runPill) {
      const runId = localStorage.getItem("agrafes.prep.workflow.run_id");
      if (runId) runPill.textContent = `run\u00a0: ${runId}`;
    }
    root.querySelector<HTMLButtonElement>(".exp-back-btn")?.addEventListener("click", () => {
      document.querySelector<HTMLElement>('.prep-nav-tree-link[data-nav="alignement"]')?.click();
    });
    root.querySelector<HTMLButtonElement>("#exp-refresh-btn")?.addEventListener("click", () => {
      void this._refreshDocs();
    });

    root.querySelector("#v2-run-btn")!.addEventListener("click", () => this._runUnifiedExport());
    root.querySelector("#v2-stage")!.addEventListener("change", () => this._syncV2Ui());
    root.querySelector("#v2-product")!.addEventListener("change", () => this._syncV2Ui());
    this._v2DocSelEl.addEventListener("change", () => this._handleV2DocSelectionChange());
    this._v2DocSelectAllBtn.addEventListener("click", () => this._selectAllV2Docs());
    this._v2DocClearBtn.addEventListener("click", () => this._clearV2DocSelection());
    this._legacyToggleBtn.addEventListener("click", () => this._toggleLegacyExports());
    root.querySelector("#tei-export-btn")!.addEventListener("click", () => this._runTeiExport());
    root.querySelector("#pkg-export-btn")!.addEventListener("click", () => this._runPackageExport());
    root.querySelector("#align-csv-btn")!.addEventListener("click", () => this._runAlignCsvExport());
    root.querySelector("#report-export-btn")!.addEventListener("click", () => this._runRunReportExport());
    root.querySelector("#qa-report-btn")!.addEventListener("click", () => this._runQaReportExport());
    this._bilFamilySelEl.addEventListener("change", () => this._onBilFamilyChange());
    this._bilPivotSelEl.addEventListener("change", () => this._syncBilBtn());
    this._bilTargetSelEl.addEventListener("change", () => this._syncBilBtn());
    this._bilFmtEl.addEventListener("change", () => this._syncBilBtn());
    this._bilPreviewBtn.addEventListener("click", () => void this._runBilPreview());
    this._bilRunBtn.addEventListener("click", () => void this._runExportBilTmx());

    // Show/hide strict notice when TEI profile changes
    root.querySelector("#pkg-tei-profile")?.addEventListener("change", (e) => {
      const notice = root.querySelector<HTMLElement>("#pkg-strict-notice");
      if (notice) notice.style.display = (e.target as HTMLSelectElement).value === "parcolab_strict" ? "block" : "none";
    });
    root.querySelector("#v2-pkg-tei-profile")?.addEventListener("change", (e) => {
      const hint = root.querySelector<HTMLElement>("#v2-summary-hint");
      if (!hint) return;
      const strict = (e.target as HTMLSelectElement).value === "parcolab_strict";
      if (strict) {
        hint.textContent = "Profil strict: peut bloquer l’export si des métadonnées sont incomplètes.";
      } else {
        this._syncV2Ui();
      }
    });

    initCardAccordions(root);
    this._refreshDocs();
    this._syncV2Ui();
    this._applyPendingWorkflowPrefillIfAny();
    this._refreshRuntimeState();
    return root;
  }

  applyWorkflowPrefill(prefill: ExportWorkflowPrefill): void {
    this._pendingWorkflowPrefill = prefill;
    this._applyPendingWorkflowPrefillIfAny();
  }

  private _applyPendingWorkflowPrefillIfAny(): void {
    if (!this._root || !this._pendingWorkflowPrefill) return;
    const prefill = this._pendingWorkflowPrefill;

    if (prefill.stage) {
      this._v2StageEl.value = prefill.stage;
    }
    this._syncV2Ui();

    if (prefill.product) {
      const hasProduct = Array.from(this._v2ProductEl.options).some((o) => o.value === prefill.product);
      if (hasProduct) this._v2ProductEl.value = prefill.product;
    }
    this._syncV2Ui();

    if (prefill.format) {
      const hasFormat = Array.from(this._v2FormatEl.options).some((o) => o.value === prefill.format);
      if (hasFormat) this._v2FormatEl.value = prefill.format;
    }

    const needsDocSelectors = Boolean(
      (Array.isArray(prefill.docIds) && prefill.docIds.length > 0)
      || typeof prefill.pivotDocId === "number"
      || typeof prefill.targetDocId === "number",
    );
    const docSelectorsReady = this._docs.length > 0 && this._v2DocSelEl.options.length > 1;
    if (needsDocSelectors && !docSelectorsReady) {
      // Defer until documents are loaded into selector options.
      this._syncV2Ui();
      return;
    }

    if (Array.isArray(prefill.docIds) && prefill.docIds.length > 0) {
      const wanted = new Set(prefill.docIds.map((v) => String(v)));
      for (const opt of Array.from(this._v2DocSelEl.options)) {
        if (opt.value === "__all__") {
          opt.selected = false;
          continue;
        }
        opt.selected = wanted.has(opt.value);
      }
    }

    if (typeof prefill.pivotDocId === "number") {
      const pivotValue = String(prefill.pivotDocId);
      if (Array.from(this._v2PivotEl.options).some((o) => o.value === pivotValue)) {
        this._v2PivotEl.value = pivotValue;
      }
    }
    if (typeof prefill.targetDocId === "number") {
      const targetValue = String(prefill.targetDocId);
      if (Array.from(this._v2TargetEl.options).some((o) => o.value === targetValue)) {
        this._v2TargetEl.value = targetValue;
      }
    }
    if (typeof prefill.exceptionsOnly === "boolean") {
      const excEl = this._root.querySelector<HTMLInputElement>("#v2-align-exceptions-only");
      if (excEl) excEl.checked = prefill.exceptionsOnly;
    }
    if (typeof prefill.runId === "string") {
      this._v2RunIdEl.value = prefill.runId;
    }
    if (typeof prefill.strictMode === "boolean") {
      this._v2StrictEl.checked = prefill.strictMode;
    }

    this._handleV2DocSelectionChange();
    this._renderDocTable();
    this._syncV2Ui();
    this._pendingWorkflowPrefill = null;
    this._showToast?.("Préremplissage export appliqué.");
  }

  private _toggleLegacyExports(): void {
    const wasHidden = this._legacyContainer.hidden;
    this._legacyContainer.hidden = !wasHidden;
    const nowOpen = !this._legacyContainer.hidden;
    this._legacyToggleBtn.setAttribute("aria-expanded", nowOpen ? "true" : "false");
    this._legacyToggleBtn.textContent = nowOpen
      ? "Masquer les exports avanc\u00e9s"
      : "Afficher les exports avanc\u00e9s";
  }

  // ── Doc refresh ─────────────────────────────────────────────────────────────

  private async _refreshDocs(): Promise<void> {
    const teiBtns = this._root.querySelectorAll<HTMLButtonElement>("#v2-run-btn, #tei-export-btn, #pkg-export-btn, #align-csv-btn, #report-export-btn, #qa-report-btn");
    if (!this._conn) {
      teiBtns.forEach(b => b.disabled = true);
      this._refreshRuntimeState();
      return;
    }
    this._isBusy = true;
    this._refreshRuntimeState();
    try {
      [this._docs, this._families] = await Promise.all([
        listDocuments(this._conn),
        getFamilies(this._conn).catch(() => [] as FamilyRecord[]),
      ]);
      this._lastErrorMsg = null;
    } catch {
      this._docs = [];
      this._families = [];
      this._lastErrorMsg = "Impossible de charger la liste des documents.";
    } finally {
      this._isBusy = false;
    }
    teiBtns.forEach(b => (b.disabled = false));
    this._renderDocOptions();
    this._syncV2Ui();
    this._applyPendingWorkflowPrefillIfAny();
    this._refreshRuntimeState();
  }

  private _renderDocOptions(): void {
    const allOption = (): HTMLOptionElement => {
      const o = document.createElement("option");
      o.value = "__all__";
      o.textContent = "— Tous les documents —";
      o.selected = true;
      return o;
    };

    // TEI multi-select
    this._docSelEl.innerHTML = "";
    this._docSelEl.appendChild(allOption());
    for (const d of this._docs) {
      const opt = document.createElement("option");
      opt.value = String(d.doc_id);
      opt.textContent = `#${d.doc_id} ${d.title} (${d.language})`;
      this._docSelEl.appendChild(opt);
    }

    // Package multi-select
    this._pkgDocSelEl.innerHTML = "";
    this._pkgDocSelEl.appendChild(allOption());
    for (const d of this._docs) {
      const opt = document.createElement("option");
      opt.value = String(d.doc_id);
      opt.textContent = `#${d.doc_id} ${d.title} (${d.language})`;
      this._pkgDocSelEl.appendChild(opt);
    }

    // V2 multi-select
    this._v2DocSelEl.innerHTML = "";
    this._v2DocSelEl.appendChild(allOption());
    for (const d of this._docs) {
      const opt = document.createElement("option");
      opt.value = String(d.doc_id);
      opt.textContent = `#${d.doc_id} ${d.title} (${d.language})`;
      this._v2DocSelEl.appendChild(opt);
    }

    // Align CSV pivot/target selects
    const emptyOpt = (): HTMLOptionElement => {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "— tous —";
      return o;
    };
    this._pivotSelEl.innerHTML = "";
    this._pivotSelEl.appendChild(emptyOpt());
    this._targetSelEl.innerHTML = "";
    this._targetSelEl.appendChild(emptyOpt());
    for (const d of this._docs) {
      const label = `#${d.doc_id} ${d.title}`;
      const op = document.createElement("option");
      op.value = String(d.doc_id);
      op.textContent = label;
      const ot = op.cloneNode(true) as HTMLOptionElement;
      this._pivotSelEl.appendChild(op);
      this._targetSelEl.appendChild(ot);
    }

    this._v2PivotEl.innerHTML = "";
    this._v2PivotEl.appendChild(emptyOpt());
    this._v2TargetEl.innerHTML = "";
    this._v2TargetEl.appendChild(emptyOpt());
    for (const d of this._docs) {
      const label = `#${d.doc_id} ${d.title}`;
      const op = document.createElement("option");
      op.value = String(d.doc_id);
      op.textContent = label;
      const ot = op.cloneNode(true) as HTMLOptionElement;
      this._v2PivotEl.appendChild(op);
      this._v2TargetEl.appendChild(ot);
    }

    // Bilingue/TMX: family selector
    this._bilFamilySelEl.innerHTML = '<option value="">— paire directe —</option>';
    for (const f of this._families) {
      if (!f.parent) continue;
      const opt = document.createElement("option");
      opt.value = String(f.family_id);
      opt.textContent = `#${f.family_id} ${f.parent.title} (${f.stats.total_docs} docs)`;
      this._bilFamilySelEl.appendChild(opt);
    }

    // Bilingue/TMX: pivot + target from all docs
    const chooseOpt = (): HTMLOptionElement => {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "— choisir —";
      return o;
    };
    this._bilPivotSelEl.innerHTML = "";
    this._bilPivotSelEl.appendChild(chooseOpt());
    this._bilTargetSelEl.innerHTML = "";
    this._bilTargetSelEl.appendChild(chooseOpt());
    for (const d of this._docs) {
      const label = `#${d.doc_id} ${d.title} (${d.language})`;
      const op = document.createElement("option");
      op.value = String(d.doc_id);
      op.textContent = label;
      const ot = op.cloneNode(true) as HTMLOptionElement;
      this._bilPivotSelEl.appendChild(op);
      this._bilTargetSelEl.appendChild(ot);
    }
    this._syncBilBtn();

    this._renderDocTable();
    this._updateKpiStrip();
  }

  // ── Unified V2 export flow ─────────────────────────────────────────────────

  private _selectedDocIds(selectEl: HTMLSelectElement): number[] | undefined {
    const selected = Array.from(selectEl.selectedOptions).map((o) => o.value);
    if (selected.includes("__all__")) return undefined;
    if (selected.length === 0) return [];
    const ids = selected.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
    return ids;
  }

  private _handleV2DocSelectionChange(): void {
    const values = Array.from(this._v2DocSelEl.selectedOptions).map((opt) => opt.value);
    if (values.includes("__all__") && values.length > 1) {
      for (const opt of Array.from(this._v2DocSelEl.options)) {
        opt.selected = opt.value === "__all__";
      }
    }
    this._syncV2Ui();
  }

  private _selectAllV2Docs(): void {
    let selectedAny = false;
    for (const opt of Array.from(this._v2DocSelEl.options)) {
      if (opt.value === "__all__") {
        opt.selected = false;
        continue;
      }
      opt.selected = true;
      selectedAny = true;
    }
    // Fallback: if no document row exists yet, keep "all corpus" selected.
    if (!selectedAny) {
      for (const opt of Array.from(this._v2DocSelEl.options)) {
        opt.selected = opt.value === "__all__";
      }
    }
    this._root?.querySelectorAll<HTMLInputElement>(".exp-doc-check").forEach(cb => { cb.checked = true; });
    this._syncV2Ui();
    this._updateKpiStrip();
  }

  private _clearV2DocSelection(): void {
    for (const opt of Array.from(this._v2DocSelEl.options)) {
      opt.selected = false;
    }
    this._root?.querySelectorAll<HTMLInputElement>(".exp-doc-check").forEach(cb => { cb.checked = false; });
    this._syncV2Ui();
    this._updateKpiStrip();
  }

  // EXP-3: render visible doc table (display-only, hidden select remains source of truth)
  private _renderDocTable(): void {
    const body = this._root?.querySelector<HTMLElement>("#exp-doc-body");
    const emptyHint = this._root?.querySelector<HTMLElement>("#exp-empty-hint");
    const grid = this._root?.querySelector<HTMLElement>("#exp-doc-grid");
    if (!body) return;
    const selectedIds = this._selectedDocIds(this._v2DocSelEl) ?? this._docs.map(d => d.doc_id);
    if (this._docs.length === 0) {
      if (emptyHint) emptyHint.style.display = "";
      if (grid) grid.style.display = "none";
      return;
    }
    if (emptyHint) emptyHint.style.display = "none";
    if (grid) grid.style.display = "";
    const statusLabel = (d: DocumentRecord): string => {
      switch (d.workflow_status) {
        case "validated": return "Validé";
        case "review":    return "Révision";
        case "draft":     return "Brouillon";
        default:          return "—";
      }
    };
    setHtml(body, raw(this._docs.map(d => {
      const sel = selectedIds.includes(d.doc_id);
      const title = d.title.length > 40 ? d.title.slice(0, 40) + "…" : d.title;
      return `<tr class="exp-doc-row" data-doc-id="${d.doc_id}">
        <td><input type="checkbox" class="exp-doc-check" data-doc-id="${d.doc_id}"${sel ? " checked" : ""}></td>
        <td class="exp-doc-id">${d.doc_id}</td>
        <td class="exp-doc-title" title="${_escHtml(d.title)}">${_escHtml(title)}</td>
        <td class="exp-doc-lang">${_escHtml(d.language)}</td>
        <td class="exp-doc-role">${_escHtml(d.doc_role ?? "—")}</td>
        <td><span class="chip">${statusLabel(d)}</span></td>
      </tr>`;
    }).join("")));
    body.querySelectorAll<HTMLInputElement>(".exp-doc-check").forEach(cb => {
      cb.addEventListener("change", () => this._onDocCheckChange(Number(cb.dataset.docId), cb.checked));
    });
  }

  private _onDocCheckChange(docId: number, checked: boolean): void {
    const opt = this._v2DocSelEl?.querySelector<HTMLOptionElement>(`option[value="${docId}"]`);
    if (opt) opt.selected = checked;
    this._handleV2DocSelectionChange();
    this._updateKpiStrip();
  }

  // EXP-4: update KPI strip display-only
  private _updateKpiStrip(): void {
    if (!this._root) return;
    const setKpi = (id: string, v: string) => {
      const el = this._root.querySelector(`#${id}`);
      if (el) el.textContent = v;
    };
    setKpi("exp-kpi-docs", String(this._docs.length));
    const selIds = this._selectedDocIds(this._v2DocSelEl);
    setKpi("exp-kpi-sel", selIds === undefined ? String(this._docs.length) : selIds.length > 0 ? String(selIds.length) : "—");
    const stage = this._v2StageEl?.selectedOptions[0]?.text ?? "—";
    const product = this._v2ProductEl?.selectedOptions[0]?.text ?? "—";
    const fmt   = this._v2FormatEl?.selectedOptions[0]?.text ?? "—";
    setKpi("exp-kpi-stage", stage);
    setKpi("exp-kpi-product", product);
    setKpi("exp-kpi-fmt", fmt);
  }

  private _setSelectOptions(
    selectEl: HTMLSelectElement,
    options: Array<{ value: string; label: string }>,
    preferred?: string,
  ): string {
    const current = preferred ?? selectEl.value;
    selectEl.innerHTML = "";
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      selectEl.appendChild(o);
    }
    const exists = options.some(o => o.value === current);
    selectEl.value = exists ? current : options[0]?.value ?? "";
    return selectEl.value;
  }

  private _syncV2Ui(): void {
    if (!this._root) return;

    const stage = this._v2StageEl.value;

    const products = productsForStage(stage);
    const product = this._setSelectOptions(
      this._v2ProductEl,
      products.map(p => ({ value: p.value, label: p.label })),
    );
    const productMeta = products.find(p => p.value === product);
    const productPending = Boolean(productMeta?.pending);

    const formats = formatsForProduct(product);
    const format = this._setSelectOptions(
      this._v2FormatEl,
      formats.map(f => ({ value: f.value, label: f.label })),
    );
    const formatPending = Boolean(formats.find(f => f.value === format)?.pending);
    const isPending = productPending || formatPending;

    const teiOptions = this._root.querySelector<HTMLElement>("#v2-tei-options");
    const readableOptions = this._root.querySelector<HTMLElement>("#v2-readable-options");
    const alignOptions = this._root.querySelector<HTMLElement>("#v2-align-options");
    const pkgOptions = this._root.querySelector<HTMLElement>("#v2-package-options");
    const runOptions = this._root.querySelector<HTMLElement>("#v2-run-options");
    const qaOptions = this._root.querySelector<HTMLElement>("#v2-qa-options");
    const v2TeiRelationTypeEl = this._root.querySelector<HTMLSelectElement>("#v2-tei-relation-type");
    const pendingHint = this._root.querySelector<HTMLElement>("#v2-pending-hint");
    const summaryHint = this._root.querySelector<HTMLElement>("#v2-summary-hint");

    if (teiOptions) teiOptions.style.display = product === "tei_xml" ? "flex" : "none";
    if (readableOptions) readableOptions.style.display = product === "readable_text" ? "flex" : "none";
    if (v2TeiRelationTypeEl) v2TeiRelationTypeEl.disabled = product !== "tei_xml";
    if (alignOptions) alignOptions.style.display = product === "aligned_table" ? "flex" : "none";
    if (pkgOptions) pkgOptions.style.display = product === "tei_package" ? "flex" : "none";
    if (runOptions) runOptions.style.display = product === "run_report" ? "flex" : "none";
    if (qaOptions) qaOptions.style.display = product === "qa_report" ? "flex" : "none";

    if (pendingHint) {
      if (isPending) {
        pendingHint.style.display = "block";
        pendingHint.textContent = "Ce couple produit/format est prévu en V2, mais n'est pas encore branché côté moteur.";
      } else {
        pendingHint.style.display = "none";
      }
    }
    const selectedIds = this._selectedDocIds(this._v2DocSelEl);
    const hasEmptySelection = Array.isArray(selectedIds) && selectedIds.length === 0;
    const noDocsInCorpus = this._docs.length === 0;

    if (this._v2DocSummaryEl) {
      if (selectedIds === undefined) {
        this._v2DocSummaryEl.textContent = `Portée actuelle: tous les documents (${this._docs.length}).`;
      } else if (hasEmptySelection) {
        this._v2DocSummaryEl.textContent = "Portée actuelle: aucun document sélectionné.";
      } else {
        const titles = this._docs
          .filter((doc) => selectedIds.includes(doc.doc_id))
          .map((doc) => `#${doc.doc_id} ${doc.title}`);
        const compact = titles.slice(0, 2).join(" · ");
        const suffix = titles.length > 2 ? ` +${titles.length - 2}` : "";
        this._v2DocSummaryEl.textContent = `Portée actuelle: ${selectedIds.length} document(s) (${compact}${suffix}).`;
      }
    }

    if (summaryHint) {
      const stageLabel = this._v2StageEl.selectedOptions[0]?.textContent ?? stage;
      const productLabel = this._v2ProductEl.selectedOptions[0]?.textContent ?? product;
      const formatLabel = this._v2FormatEl.selectedOptions[0]?.textContent ?? format;
      const scopeLabel = hasEmptySelection
        ? "aucune portée"
        : selectedIds === undefined
          ? `tous (${this._docs.length})`
          : `${selectedIds.length} document(s)`;
      summaryHint.textContent = `Sélection courante: ${scopeLabel} · ${stageLabel} → ${productLabel} → ${formatLabel}.`;
    }
    this._v2RunBtn.disabled = !this._conn || isPending || hasEmptySelection || noDocsInCorpus;
    this._updateKpiStrip();
    this._refreshRuntimeState();
  }

  private async _runUnifiedExport(): Promise<void> {
    if (!this._conn) return;

    const product = this._v2ProductEl.value;
    const format = this._v2FormatEl.value;
    if (product.startsWith("pending_") || format.endsWith("_pending")) {
      this._showToast?.("Format non implémenté pour le moment", true);
      return;
    }

    const doc_ids = this._selectedDocIds(this._v2DocSelEl);
    if (Array.isArray(doc_ids) && doc_ids.length === 0) {
      this._showToast?.("Sélectionnez au moins un document.", true);
      return;
    }
    this._v2RunBtn.disabled = true;
    let keepDisabledUntilCallback = false;

    try {
      if (product === "tei_xml") {
        const outDir = await open({ directory: true, title: "Choisir le dossier de sortie TEI" });
        if (!outDir || typeof outDir !== "string") return;
        const includeStructure = (this._root.querySelector<HTMLInputElement>("#v2-tei-include-structure")?.checked) ?? false;
        const relationType = (this._root.querySelector<HTMLSelectElement>("#v2-tei-relation-type")?.value) ?? "none";
        const params: Record<string, unknown> = {
          out_dir: outDir,
          include_structure: includeStructure,
          relation_type: relationType,
        };
        if (doc_ids) params.doc_ids = doc_ids;

        this._log(`Export V2 TEI → ${outDir} (${doc_ids?.length ?? this._docs.length} doc(s))…`);
        const job = await enqueueJob(this._conn, "export_tei", params);
        if (this._jobCenter) {
          keepDisabledUntilCallback = true;
          this._jobCenter.trackJob(job.job_id, `Export V2 TEI`, (done) => {
            if (done.status === "done") {
              const r = done.result as { count?: number; files_created?: string[] } | undefined;
              this._log(`✓ Export TEI terminé (${r?.count ?? 0} fichier(s))${relationType !== "none" ? ` · relation: ${relationType}` : ""}`);
              this._showToast?.(`✓ Export TEI (${r?.count ?? 0})`);
            } else {
              this._log(`Erreur export V2 TEI: ${done.error ?? done.status}`, true);
              this._showToast?.("✗ Erreur export TEI", true);
            }
            this._v2RunBtn.disabled = false;
            this._syncV2Ui();
          });
        } else {
          this._log(`Job ${job.job_id} soumis (suivi asynchrone indisponible).`);
          this._showToast?.("✓ Job export TEI soumis");
        }
        return;
      }

      if (product === "aligned_table") {
        const delimiter = format === "tsv" ? "\t" : ",";
        const ext = delimiter === "\t" ? "tsv" : "csv";
        const outPath = await save({
          title: "Enregistrer le fichier d'alignement",
          defaultPath: `alignements.${ext}`,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        });
        if (!outPath) return;
        const pivot_doc_id = this._v2PivotEl.value ? Number(this._v2PivotEl.value) : undefined;
        const target_doc_id = this._v2TargetEl.value ? Number(this._v2TargetEl.value) : undefined;
        const exceptionsOnly = (this._root.querySelector<HTMLInputElement>("#v2-align-exceptions-only")?.checked) ?? false;
        const params: Record<string, unknown> = { out_path: outPath, delimiter };
        if (pivot_doc_id !== undefined) params.pivot_doc_id = pivot_doc_id;
        if (target_doc_id !== undefined) params.target_doc_id = target_doc_id;
        if (exceptionsOnly) params.exceptions_only = true;

        this._log(`Export V2 alignements → ${outPath}…`);
        const job = await enqueueJob(this._conn, "export_align_csv", params);
        if (this._jobCenter) {
          keepDisabledUntilCallback = true;
          this._jobCenter.trackJob(job.job_id, "Export V2 alignements", (done) => {
            if (done.status === "done") {
              const r = done.result as { rows_written?: number; out_path?: string } | undefined;
              this._log(`✓ ${r?.rows_written ?? "?"} liens exportés → ${r?.out_path ?? outPath}`);
              this._showToast?.(`✓ Export alignements (${r?.rows_written ?? "?"})`);
            } else {
              this._log(`Erreur export V2 alignements: ${done.error ?? done.status}`, true);
              this._showToast?.("✗ Erreur export alignements", true);
            }
            this._v2RunBtn.disabled = false;
            this._syncV2Ui();
          });
        } else {
          this._log(`Job ${job.job_id} soumis (suivi asynchrone indisponible).`);
          this._showToast?.("✓ Job export alignements soumis");
        }
        return;
      }

      if (product === "tei_package") {
        const outPath = await save({
          title: "Enregistrer le package de publication",
          defaultPath: `agrafes_publication_${new Date().toISOString().slice(0, 10)}.zip`,
          filters: [{ name: "ZIP", extensions: ["zip"] }],
        });
        if (!outPath) return;
        const includeStructure = (this._root.querySelector<HTMLInputElement>("#v2-pkg-include-structure")?.checked) ?? false;
        const includeAlignment = (this._root.querySelector<HTMLInputElement>("#v2-pkg-include-alignment")?.checked) ?? false;
        const teiProfile = (this._root.querySelector<HTMLSelectElement>("#v2-pkg-tei-profile")?.value) ?? "generic";
        const params: Record<string, unknown> = {
          out_path: outPath,
          include_structure: includeStructure,
          include_alignment: includeAlignment,
          tei_profile: teiProfile,
        };
        if (doc_ids) params.doc_ids = doc_ids;

        this._log(`Export V2 package TEI → ${outPath}…`);
        const job = await enqueueJob(this._conn, "export_tei_package", params);
        if (this._jobCenter) {
          keepDisabledUntilCallback = true;
          this._jobCenter.trackJob(job.job_id, "Export V2 package", (done) => {
            if (done.status === "done") {
              const r = done.result as { doc_count?: number; zip_path?: string } | undefined;
              this._log(`✓ Package TEI créé (${r?.doc_count ?? 0} doc(s)) → ${r?.zip_path ?? outPath}`);
              this._showToast?.(`✓ Package TEI (${r?.doc_count ?? 0} doc(s))`);
            } else {
              this._log(`Erreur export V2 package: ${done.error ?? done.status}`, true);
              this._showToast?.("✗ Erreur package TEI", true);
            }
            this._v2RunBtn.disabled = false;
            this._syncV2Ui();
          });
        } else {
          this._log(`Job ${job.job_id} soumis (suivi asynchrone indisponible).`);
          this._showToast?.("✓ Job package TEI soumis");
        }
        return;
      }

      if (product === "readable_text") {
        const exportFmt = format === "docx" || format === "odt" ? format : "txt";
        const outDir = await open({ directory: true, title: `Choisir le dossier de sortie (${exportFmt.toUpperCase()})` });
        if (!outDir || typeof outDir !== "string") return;
        const params: Record<string, unknown> = { out_dir: outDir, format: exportFmt };
        if (doc_ids) params.doc_ids = doc_ids;
        // ADR-043 P3: optional source-field choice (text_norm default / text_raw / text_source).
        const sourceField = this._root?.querySelector<HTMLSelectElement>("#v2-readable-source-field")?.value;
        if (sourceField && sourceField !== "text_norm") params.source_field = sourceField;

        this._log(`Export V2 texte lisible (${exportFmt.toUpperCase()}) → ${outDir}…`);
        const job = await enqueueJob(this._conn, "export_readable_text", params);
        if (this._jobCenter) {
          keepDisabledUntilCallback = true;
          this._jobCenter.trackJob(job.job_id, `Export V2 texte (${exportFmt.toUpperCase()})`, (done) => {
            if (done.status === "done") {
              const r = done.result as { count?: number; files_created?: string[] } | undefined;
              this._log(`✓ Export texte terminé (${r?.count ?? 0} fichier(s))`);
              this._showToast?.(`✓ Export texte (${r?.count ?? 0})`);
            } else {
              this._log(`Erreur export V2 texte: ${done.error ?? done.status}`, true);
              this._showToast?.("✗ Erreur export texte", true);
            }
            this._v2RunBtn.disabled = false;
            this._syncV2Ui();
          });
        } else {
          this._log(`Job ${job.job_id} soumis (suivi asynchrone indisponible).`);
          this._showToast?.("✓ Job export texte soumis");
        }
        return;
      }

      if (product === "run_report") {
        const fmt = format === "html" ? "html" : "jsonl";
        const ext = fmt === "html" ? "html" : "jsonl";
        const outPath = await save({
          title: "Enregistrer le rapport des runs",
          defaultPath: `runs_report.${ext}`,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        });
        if (!outPath) return;
        const runIdFilter = this._v2RunIdEl.value.trim();
        const params: Record<string, unknown> = { out_path: outPath, format: fmt };
        if (runIdFilter) params.run_id = runIdFilter;

        this._log(`Export V2 rapport runs → ${outPath}${runIdFilter ? ` (run_id=${runIdFilter})` : ""}…`);
        const job = await enqueueJob(this._conn, "export_run_report", params);
        if (this._jobCenter) {
          keepDisabledUntilCallback = true;
          this._jobCenter.trackJob(job.job_id, "Export V2 runs", (done) => {
            if (done.status === "done") {
              const r = done.result as { runs_exported?: number; out_path?: string } | undefined;
              this._log(`✓ ${r?.runs_exported ?? "?"} run(s) exporté(s) → ${r?.out_path ?? outPath}`);
              this._showToast?.(`✓ Rapport runs (${r?.runs_exported ?? "?"})`);
            } else {
              this._log(`Erreur export V2 runs: ${done.error ?? done.status}`, true);
              this._showToast?.("✗ Erreur rapport runs", true);
            }
            this._v2RunBtn.disabled = false;
            this._syncV2Ui();
          });
        } else {
          this._log(`Job ${job.job_id} soumis (suivi asynchrone indisponible).`);
          this._showToast?.("✓ Job rapport runs soumis");
        }
        return;
      }

      if (product === "qa_report") {
        const fmt = format === "html" ? "html" : "json";
        const ext = fmt === "html" ? "html" : "json";
        const outPath = await save({
          title: "Enregistrer le rapport QA",
          defaultPath: `agrafes_qa_report.${ext}`,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        });
        if (!outPath) return;
        const qaPolicy = this._v2StrictEl.checked ? "strict" : "lenient";
        this._log(`Export V2 QA → ${outPath} (politique: ${qaPolicy})…`);

        const conn = this._conn;
        const job = await enqueueJob(conn, "qa_report", {
          out_path: outPath,
          format: fmt,
          policy: qaPolicy,
        });
        keepDisabledUntilCallback = true;
        const poll = async (): Promise<void> => {
          const rec = await getJob(conn, job.job_id) as unknown as {
            status: string;
            result?: { gate_status: string; blocking?: string[]; warnings?: string[] };
            error?: string;
          };
          if (rec.status === "done" && rec.result) {
            const gate = rec.result.gate_status;
            const blocking = rec.result.blocking ?? [];
            const warnings = rec.result.warnings ?? [];
            const issues = [...blocking, ...warnings];
            this._log(`✓ Rapport QA exporté → ${outPath} (gate=${gate}, policy=${qaPolicy})`);
            if (issues.length > 0) this._log(`  ⚠ ${issues.length} item(s) QA signalé(s)`);
            this._showToast?.(`✓ Rapport QA (${gate})`);
            this._v2RunBtn.disabled = false;
            this._syncV2Ui();
          } else if (rec.status === "error" || rec.status === "canceled") {
            this._log(`Erreur export V2 QA: ${rec.error ?? rec.status}`, true);
            this._showToast?.("✗ Erreur rapport QA", true);
            this._v2RunBtn.disabled = false;
            this._syncV2Ui();
          } else {
            this._pollTimerId = setTimeout(() => void poll(), 1000);
          }
        };
        this._pollTimerId = setTimeout(() => void poll(), 500);
        return;
      }
    } catch (err) {
      this._log(`Erreur export V2: ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Erreur export", true);
    } finally {
      if (!keepDisabledUntilCallback && this._v2RunBtn.disabled) {
        this._v2RunBtn.disabled = false;
      }
      this._syncV2Ui();
    }
  }

  // ── TEI Export ──────────────────────────────────────────────────────────────

  private async _runTeiExport(): Promise<void> {
    if (!this._conn) return;

    const selected = Array.from(this._docSelEl.selectedOptions).map(o => o.value);
    const doc_ids: number[] | undefined = selected.includes("__all__")
      ? undefined
      : selected.map(Number);

    const includeStructure = (this._root.querySelector<HTMLInputElement>("#tei-include-structure")?.checked) ?? false;
    const relationType = (this._root.querySelector<HTMLSelectElement>("#tei-relation-type")?.value) ?? "none";

    const outDir = await open({ directory: true, title: "Choisir le dossier de sortie TEI" });
    if (!outDir || typeof outDir !== "string") return;

    const btn = this._root.querySelector<HTMLButtonElement>("#tei-export-btn")!;
    const recapEl = this._root.querySelector<HTMLElement>("#tei-recap");
    if (recapEl) recapEl.style.display = "none";
    btn.disabled = true;

    const nbDocs = doc_ids ? doc_ids.length : this._docs.length;
    this._log(`Export TEI vers ${outDir} (${nbDocs} doc(s), include_structure=${includeStructure})…`);

    const params: Record<string, unknown> = {
      out_dir: outDir,
      include_structure: includeStructure,
      relation_type: relationType,
    };
    if (doc_ids) params.doc_ids = doc_ids;

    try {
      const job = await enqueueJob(this._conn, "export_tei", params);
      this._jobCenter?.trackJob(job.job_id, `Export TEI → ${outDir}`, (done) => {
        if (done.status === "done") {
          const r = done.result as { count?: number; files_created?: string[] } | undefined;
          const count = r?.count ?? 0;
          this._log(`✓ ${count} fichier(s) TEI créé(s) dans ${outDir}`);
          for (const f of r?.files_created ?? []) this._log(`  • ${f}`);
          this._showToast?.(`✓ Export TEI : ${count} fichier(s)`);
          if (recapEl) {
            const relPart = relationType !== "none" ? ` · relation: ${relationType}` : "";
            const structPart = includeStructure ? " · structure incluse" : "";
            recapEl.textContent = `✓ ${count} fichier(s) TEI exporté(s) → ${outDir}${structPart}${relPart}`;
            recapEl.style.display = "block";
          }
        } else {
          this._log(`Erreur export TEI: ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur export TEI", true);
        }
        btn.disabled = false;
      });
    } catch (err) {
      this._log(`Erreur export TEI: ${err instanceof SidecarError ? err.message : String(err)}`, true);
      btn.disabled = false;
    }
  }

  // ── Publication Package Export ───────────────────────────────────────────────

  private async _runPackageExport(): Promise<void> {
    if (!this._conn) return;

    const selected = Array.from(this._pkgDocSelEl.selectedOptions).map(o => o.value);
    const doc_ids: number[] | undefined = selected.includes("__all__")
      ? undefined
      : selected.map(Number);

    const includeStructure = (this._root.querySelector<HTMLInputElement>("#pkg-include-structure")?.checked) ?? false;
    const includeAlignment = (this._root.querySelector<HTMLInputElement>("#pkg-include-alignment")?.checked) ?? false;
    const teiProfile = (this._root.querySelector<HTMLSelectElement>("#pkg-tei-profile")?.value) ?? "generic";

    const outPath = await save({
      title: "Enregistrer le package de publication",
      defaultPath: `agrafes_publication_${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (!outPath) return;

    const btn = this._root.querySelector<HTMLButtonElement>("#pkg-export-btn")!;
    btn.disabled = true;

    const nbDocs = doc_ids ? doc_ids.length : this._docs.length;
    this._log(`Package publication → ${outPath} (${nbDocs} doc(s))…`);

    const params: Record<string, unknown> = {
      out_path: outPath,
      include_structure: includeStructure,
      include_alignment: includeAlignment,
      tei_profile: teiProfile,
    };
    if (doc_ids) params.doc_ids = doc_ids;

    try {
      const job = await enqueueJob(this._conn, "export_tei_package", params);
      this._jobCenter?.trackJob(job.job_id, `Package publication → ${outPath}`, (done) => {
        if (done.status === "done") {
          const r = done.result as { doc_count?: number; zip_path?: string; warnings?: unknown[] } | undefined;
          const count = r?.doc_count ?? 0;
          const warns = r?.warnings ?? [];
          this._log(`✓ Package créé : ${count} doc(s) → ${r?.zip_path ?? outPath}`);
          if (warns.length > 0) {
            this._log(`  ⚠ ${warns.length} avertissement(s) — voir manifest.json`);
          }
          this._showToast?.(`✓ Package : ${count} doc(s) exporté(s)`);
        } else {
          this._log(`Erreur package: ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur package publication", true);
        }
        btn.disabled = false;
      });
    } catch (err) {
      this._log(`Erreur package: ${err instanceof SidecarError ? err.message : String(err)}`, true);
      btn.disabled = false;
    }
  }

  // ── Alignment CSV Export ─────────────────────────────────────────────────────

  private async _runAlignCsvExport(): Promise<void> {
    if (!this._conn) return;

    const pivot_doc_id = this._pivotSelEl.value ? Number(this._pivotSelEl.value) : undefined;
    const target_doc_id = this._targetSelEl.value ? Number(this._targetSelEl.value) : undefined;
    const delimiter = (this._root.querySelector<HTMLSelectElement>("#align-csv-fmt")!).value;
    const ext = delimiter === "\t" ? "tsv" : "csv";

    const outPath = await save({
      title: "Enregistrer le fichier d'alignement",
      defaultPath: `alignements.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!outPath) return;

    const btn = this._root.querySelector<HTMLButtonElement>("#align-csv-btn")!;
    btn.disabled = true;
    this._log(`Export alignements → ${outPath} (job asynchrone)…`);
    const params: Record<string, unknown> = { out_path: outPath, delimiter };
    if (pivot_doc_id !== undefined) params.pivot_doc_id = pivot_doc_id;
    if (target_doc_id !== undefined) params.target_doc_id = target_doc_id;
    try {
      const job = await enqueueJob(this._conn, "export_align_csv", params);
      this._jobCenter?.trackJob(job.job_id, `Export CSV alignements`, (done) => {
        if (done.status === "done") {
          const r = done.result as { rows_written?: number; out_path?: string } | undefined;
          this._log(`✓ ${r?.rows_written ?? "?"} liens exportés → ${r?.out_path ?? outPath}`);
          this._showToast?.(`✓ Export CSV : ${r?.rows_written ?? "?"} liens`);
        } else {
          this._log(`Erreur export alignements: ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur export CSV", true);
        }
        btn.disabled = false;
      });
    } catch (err) {
      this._log(`Erreur export alignements: ${err instanceof SidecarError ? err.message : String(err)}`, true);
      btn.disabled = false;
    }
  }

  // ── Run Report Export ────────────────────────────────────────────────────────

  private async _runRunReportExport(): Promise<void> {
    if (!this._conn) return;

    const fmt = (this._root.querySelector<HTMLSelectElement>("#report-fmt")!).value as "jsonl" | "html";
    const runIdFilter = (this._root.querySelector<HTMLInputElement>("#report-run-id")?.value ?? "").trim();
    const ext = fmt === "html" ? "html" : "jsonl";

    const outPath = await save({
      title: "Enregistrer le rapport des runs",
      defaultPath: `runs_report.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!outPath) return;

    const btn = this._root.querySelector<HTMLButtonElement>("#report-export-btn")!;
    btn.disabled = true;
    const runPart = runIdFilter ? ` (run_id=${runIdFilter})` : "";
    this._log(`Export rapport runs${runPart} → ${outPath} (job asynchrone)…`);
    try {
      const params: Record<string, unknown> = { out_path: outPath, format: fmt };
      if (runIdFilter) params.run_id = runIdFilter;
      const job = await enqueueJob(this._conn, "export_run_report", params);
      this._jobCenter?.trackJob(job.job_id, `Export rapport ${fmt}`, (done) => {
        if (done.status === "done") {
          const r = done.result as { runs_exported?: number; out_path?: string } | undefined;
          this._log(`✓ ${r?.runs_exported ?? "?"} run(s) exporté(s) → ${r?.out_path ?? outPath}`);
          this._showToast?.(`✓ Rapport : ${r?.runs_exported ?? "?"} run(s)`);
        } else {
          this._log(`Erreur export rapport: ${done.error ?? done.status}`, true);
          this._showToast?.("✗ Erreur export rapport", true);
        }
        btn.disabled = false;
      });
    } catch (err) {
      this._log(`Erreur export rapport: ${err instanceof SidecarError ? err.message : String(err)}`, true);
      btn.disabled = false;
    }
  }

  // ── QA Report ────────────────────────────────────────────────────────────────

  private async _runQaReportExport(): Promise<void> {
    const btn = this._root.querySelector<HTMLButtonElement>("#qa-report-btn")!;
    const banner = this._root.querySelector<HTMLElement>("#qa-gate-banner")!;
    const fmt = (this._root.querySelector<HTMLSelectElement>("#qa-report-fmt")!).value as "json" | "html";
    const strictMode = (this._root.querySelector<HTMLInputElement>("#qa-strict-mode")?.checked) ?? false;
    const qaPolicy = strictMode ? "strict" : "lenient";
    const ext = fmt === "html" ? "html" : "json";

    const outPath = await save({
      title: "Enregistrer le rapport QA",
      defaultPath: `agrafes_qa_report.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!outPath) return;

    btn.disabled = true;
    banner.style.display = "none";
    this._log(`Rapport QA: génération (format: ${fmt}, politique QA: ${qaPolicy === "strict" ? "Strict" : "Lenient"})…`);

    try {
      if (!this._conn) return;
      const conn = this._conn;
      const job = await enqueueJob(conn, "qa_report", {
        out_path: outPath,
        format: fmt,
        policy: qaPolicy,
      });
      this._log(`Job QA ${job.job_id} soumis, attente…`);

      // Poll
      const poll = async (): Promise<void> => {
        const rec = await getJob(conn, job.job_id) as unknown as {
          status: string;
          result?: { gate_status: string; blocking: string[]; warnings: string[] };
          error?: string;
        };

        if (rec.status === "done" && rec.result) {
          const gate = rec.result.gate_status;
          const blocking = rec.result.blocking ?? [];
          const warnings = rec.result.warnings ?? [];
          const gateColor = gate === "ok" ? "#1a7f4e" : gate === "blocking" ? "#c0392b" : "#b8590a";
          const gateBg = gate === "ok" ? "#d1fae5" : gate === "blocking" ? "#fde8e8" : "#fff3cd";
          const gateIcon = gate === "ok" ? "🟢" : gate === "blocking" ? "🔴" : "🟡";
          const issues = [...blocking, ...warnings];
          banner.style.cssText = `display:block;background:${gateBg};border:1px solid ${gateColor};border-radius:4px;padding:0.4rem 0.75rem;font-size:0.83rem;color:${gateColor}`;
          const policyBadge = `<span style="font-size:0.72rem;background:rgba(0,0,0,0.08);border-radius:3px;padding:1px 5px;margin-left:0.4rem">${qaPolicy === "strict" ? "Strict" : "Lenient"}</span>`;
          setHtml(banner, raw(`${gateIcon} <strong>${gate === "ok" ? "Prêt pour publication" : gate === "blocking" ? "Bloquant" : "Avertissements"}</strong>${policyBadge}`
            + (issues.length ? `<ul style="margin:0.3rem 0 0 1rem">${issues.map(i => `<li>${_escHtml(i)}</li>`).join("")}</ul>` : "")));
          this._log(`Rapport QA exporté → ${outPath} (gate: ${gate}, politique: ${qaPolicy})`);
          btn.disabled = false;
        } else if (rec.status === "error" || rec.status === "canceled") {
          this._log(`Erreur rapport QA: ${rec.error ?? rec.status}`, true);
          btn.disabled = false;
        } else {
          this._pollTimerId = setTimeout(() => void poll(), 1000);
        }
      };
      this._pollTimerId = setTimeout(() => void poll(), 500);
    } catch (err) {
      this._log(`Erreur rapport QA: ${err instanceof SidecarError ? err.message : String(err)}`, true);
      btn.disabled = false;
    }
  }

  // ── Bilingue / TMX ──────────────────────────────────────────────────────────

  private _onBilFamilyChange(): void {
    const familyId = this._bilFamilySelEl.value ? Number(this._bilFamilySelEl.value) : null;
    if (familyId !== null) {
      const fam = this._families.find(f => f.family_id === familyId);
      if (fam) {
        // Auto-select pivot = parent, target = first child
        this._bilPivotSelEl.value = String(fam.family_id);
        const firstChild = fam.children.find(c => c.doc !== null);
        if (firstChild?.doc) {
          this._bilTargetSelEl.value = String(firstChild.doc.doc_id);
        }
      }
    }
    this._syncBilBtn();
  }

  private _syncBilBtn(): void {
    const pivot = this._bilPivotSelEl.value;
    const target = this._bilTargetSelEl.value;
    const ready = Boolean(pivot && target && pivot !== target);
    this._bilRunBtn.disabled = !ready;
    this._bilPreviewBtn.disabled = !ready || this._bilFmtEl.value === "tmx";
  }

  private async _runBilPreview(): Promise<void> {
    if (!this._conn) return;
    const pivot_doc_id = Number(this._bilPivotSelEl.value);
    const target_doc_id = Number(this._bilTargetSelEl.value);
    const previewArea = this._root.querySelector<HTMLElement>("#bil-preview-area")!;
    previewArea.style.display = "none";
    previewArea.innerHTML = "";
    this._bilPreviewBtn.disabled = true;
    try {
      const res = await this._conn.post("/export/bilingual", {
        pivot_doc_id,
        target_doc_id,
        preview_only: true,
        preview_limit: 8,
      }) as { preview: { pivot_text: string; target_text: string }[]; pivot_lang: string; target_lang: string };
      if (!res.preview?.length) {
        previewArea.innerHTML = "<em>Aucune paire alignée trouvée.</em>";
      } else {
        const rows = res.preview.map(p =>
          `<tr><td style="padding:2px 8px 2px 0;vertical-align:top;border-right:1px solid #dee2e6">${_escHtml(p.pivot_text)}</td>`
          + `<td style="padding:2px 0 2px 8px;vertical-align:top">${_escHtml(p.target_text)}</td></tr>`
        ).join("");
        setHtml(previewArea, raw(`<table style="width:100%;border-collapse:collapse;font-size:0.82rem"><thead><tr>`
          + `<th style="text-align:left;padding-bottom:4px;border-right:1px solid #dee2e6;padding-right:8px">${_escHtml(res.pivot_lang)}</th>`
          + `<th style="text-align:left;padding-bottom:4px;padding-left:8px">${_escHtml(res.target_lang)}</th>`
          + `</tr></thead><tbody>${rows}</tbody></table>`));
      }
      previewArea.style.display = "";
    } catch (err) {
      previewArea.innerHTML = `<em style="color:#c0392b">Erreur aperçu : ${_escHtml(err instanceof SidecarError ? err.message : String(err))}</em>`;
      previewArea.style.display = "";
    } finally {
      this._syncBilBtn();
    }
  }

  private async _runExportBilTmx(): Promise<void> {
    if (!this._conn) return;
    const pivot_doc_id = Number(this._bilPivotSelEl.value);
    const target_doc_id = Number(this._bilTargetSelEl.value);
    const fmt = this._bilFmtEl.value as "tmx" | "html" | "txt";
    const isTmx = fmt === "tmx";
    const familyId = this._bilFamilySelEl.value ? Number(this._bilFamilySelEl.value) : null;
    const useFamilyTmx = isTmx && familyId !== null;
    const ext = isTmx ? "tmx" : fmt;
    const defaultName = useFamilyTmx
      ? `famille_${familyId}.tmx`
      : `export_${pivot_doc_id}_${target_doc_id}.${ext}`;
    const filterName = isTmx ? "TMX" : fmt === "html" ? "HTML" : "TXT";

    const outPath = await save({
      title: isTmx ? "Enregistrer le fichier TMX" : "Enregistrer le bilingue",
      defaultPath: defaultName,
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (!outPath) return;

    this._bilRunBtn.disabled = true;
    this._bilPreviewBtn.disabled = true;
    this._log(`Export ${isTmx ? "TMX" : `bilingue ${fmt}`} → ${outPath}…`);
    try {
      if (isTmx) {
        const body: Record<string, unknown> = { out_path: outPath };
        if (useFamilyTmx) {
          body.family_id = familyId;
        } else {
          body.pivot_doc_id = pivot_doc_id;
          body.target_doc_id = target_doc_id;
        }
        const res = await this._conn.post("/export/tmx", body) as { tu_count: number; out_path: string };
        this._log(`✓ ${res.tu_count} unités de traduction → ${res.out_path}`);
        this._showToast?.(`✓ TMX : ${res.tu_count} TU`);
      } else {
        const res = await this._conn.post("/export/bilingual", {
          pivot_doc_id,
          target_doc_id,
          format: fmt,
          out_path: outPath,
        }) as { pair_count: number; out_path: string };
        this._log(`✓ ${res.pair_count} paires exportées → ${res.out_path}`);
        this._showToast?.(`✓ Bilingue ${fmt} : ${res.pair_count} paires`);
      }
    } catch (err) {
      this._log(`Erreur export bilingue/TMX : ${err instanceof SidecarError ? err.message : String(err)}`, true);
      this._showToast?.("✗ Erreur export bilingue/TMX", true);
    } finally {
      this._syncBilBtn();
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  setLogEl(el: HTMLElement): void {
    this._logEl = el;
  }

  private _log(msg: string, isError = false): void {
    const line = document.createElement("div");
    line.className = "log-line" + (isError ? " log-error" : "");
    line.dataset.source = "export";
    line.textContent = `[${new Date().toLocaleTimeString()}] [Export] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
    if (isError) {
      this._lastErrorMsg = msg;
    } else if (msg.startsWith("✓")) {
      this._lastErrorMsg = null;
    }
    this._refreshRuntimeState();
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
    if (this._docs.length === 0) {
      this._setRuntimeState("warn", "Aucun document dans le corpus — importez des fichiers avant d\u0027exporter.");
      return;
    }
    const hasReadableSelection = this._v2ProductEl?.value === "readable_text";
    if (hasReadableSelection) {
      this._setRuntimeState("info", "Produit texte lisible sélectionné (TXT/DOCX).");
      return;
    }
    this._setRuntimeState("ok", `${this._docs.length} document(s) disponibles pour export.`);
  }

  dispose(): void {
    if (this._pollTimerId !== null) {
      clearTimeout(this._pollTimerId);
      this._pollTimerId = null;
    }
    this._conn = null;
    this._jobCenter = null;
    this._showToast = null;
    this._docs = [];
    this._families = [];
  }
}
