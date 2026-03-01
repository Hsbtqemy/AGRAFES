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
  exportTei,
  exportAlignCsv,
  exportRunReport,
  enqueueJob,
  type DocumentRecord,
  SidecarError,
} from "../lib/sidecarClient.ts";
import { save, open } from "@tauri-apps/plugin-dialog";
import type { JobCenter } from "../components/JobCenter.ts";

export class ExportsScreen {
  private _conn: Conn | null = null;
  private _docs: DocumentRecord[] = [];
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;

  // DOM refs
  private _root!: HTMLElement;
  private _logEl!: HTMLElement;
  private _docSelEl!: HTMLSelectElement;
  private _pivotSelEl!: HTMLSelectElement;
  private _targetSelEl!: HTMLSelectElement;

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  setConn(conn: Conn | null): void {
    this._conn = conn;
    if (this._root) this._refreshDocs();
  }

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen actions-screen";
    this._root = root;

    root.innerHTML = `
      <h2 class="screen-title">Exports</h2>

      <!-- TEI Export -->
      <div class="card">
        <h3>Export TEI <span class="badge-preview">XML</span></h3>
        <p class="hint">Exporte un ou plusieurs documents au format TEI "analyse" (UTF-8).</p>
        <div class="form-row">
          <label>Documents
            <select id="tei-doc-sel" multiple style="height:90px;min-width:220px">
              <option value="__all__" selected>— Tous les documents —</option>
            </select>
          </label>
          <div style="align-self:flex-end">
            <button id="tei-export-btn" class="btn btn-primary btn-sm" disabled>Choisir dossier et exporter…</button>
          </div>
        </div>
      </div>

      <!-- Alignment CSV Export -->
      <div class="card">
        <h3>Export alignements <span class="badge-preview">CSV/TSV</span></h3>
        <p class="hint">Exporte les liens d'alignement vers un fichier CSV ou TSV.</p>
        <div class="form-row">
          <label>Pivot (optionnel)
            <select id="align-csv-pivot" style="min-width:160px">
              <option value="">— tous —</option>
            </select>
          </label>
          <label>Cible (optionnel)
            <select id="align-csv-target" style="min-width:160px">
              <option value="">— tous —</option>
            </select>
          </label>
          <label>Format
            <select id="align-csv-fmt">
              <option value=",">CSV (virgule)</option>
              <option value="&#9;">TSV (tabulation)</option>
            </select>
          </label>
          <div style="align-self:flex-end">
            <button id="align-csv-btn" class="btn btn-primary btn-sm" disabled>Choisir fichier et exporter…</button>
          </div>
        </div>
      </div>

      <!-- Run Report Export -->
      <div class="card">
        <h3>Rapport des runs <span class="badge-preview">JSONL/HTML</span></h3>
        <p class="hint">Exporte l'historique des opérations (import, index, align, curate…). Option: filtrer un run précis.</p>
        <div class="form-row">
          <label>run_id (optionnel)
            <input id="report-run-id" type="text" placeholder="ex: 4b23... ou sidecar-align-..." style="min-width:280px"/>
          </label>
          <label>Format
            <select id="report-fmt">
              <option value="jsonl">JSONL</option>
              <option value="html">HTML</option>
            </select>
          </label>
          <div style="align-self:flex-end">
            <button id="report-export-btn" class="btn btn-primary btn-sm" disabled>Choisir fichier et exporter…</button>
          </div>
        </div>
      </div>

      <!-- Log -->
      <div class="card">
        <h3>Journal</h3>
        <div id="export-log" class="log-pane"></div>
      </div>
    `;

    this._logEl = root.querySelector("#export-log")!;
    this._docSelEl = root.querySelector<HTMLSelectElement>("#tei-doc-sel")!;
    this._pivotSelEl = root.querySelector<HTMLSelectElement>("#align-csv-pivot")!;
    this._targetSelEl = root.querySelector<HTMLSelectElement>("#align-csv-target")!;

    root.querySelector("#tei-export-btn")!.addEventListener("click", () => this._runTeiExport());
    root.querySelector("#align-csv-btn")!.addEventListener("click", () => this._runAlignCsvExport());
    root.querySelector("#report-export-btn")!.addEventListener("click", () => this._runRunReportExport());

    this._refreshDocs();
    return root;
  }

  // ── Doc refresh ─────────────────────────────────────────────────────────────

  private async _refreshDocs(): Promise<void> {
    const teiBtns = this._root.querySelectorAll<HTMLButtonElement>("#tei-export-btn, #align-csv-btn, #report-export-btn");
    if (!this._conn) {
      teiBtns.forEach(b => b.disabled = true);
      return;
    }
    try {
      this._docs = await listDocuments(this._conn);
    } catch {
      this._docs = [];
    }
    teiBtns.forEach(b => b.disabled = false);
    this._renderDocOptions();
  }

  private _renderDocOptions(): void {
    // TEI multi-select
    const allOption = document.createElement("option");
    allOption.value = "__all__";
    allOption.textContent = "— Tous les documents —";
    allOption.selected = true;
    this._docSelEl.innerHTML = "";
    this._docSelEl.appendChild(allOption);
    for (const d of this._docs) {
      const opt = document.createElement("option");
      opt.value = String(d.doc_id);
      opt.textContent = `#${d.doc_id} ${d.title} (${d.language})`;
      this._docSelEl.appendChild(opt);
    }

    // Align CSV pivot/target selects
    const emptyOpt = () => {
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
  }

  // ── TEI Export ──────────────────────────────────────────────────────────────

  private async _runTeiExport(): Promise<void> {
    if (!this._conn) return;

    const selected = Array.from(this._docSelEl.selectedOptions).map(o => o.value);
    const doc_ids: number[] | undefined = selected.includes("__all__")
      ? undefined
      : selected.map(Number);

    const outDir = await open({ directory: true, title: "Choisir le dossier de sortie TEI" });
    if (!outDir || typeof outDir !== "string") return;

    const btn = this._root.querySelector<HTMLButtonElement>("#tei-export-btn")!;
    btn.disabled = true;
    this._log(`Export TEI vers ${outDir} (job asynchrone)…`);
    const params: Record<string, unknown> = { out_dir: outDir };
    if (doc_ids) params.doc_ids = doc_ids;
    try {
      const job = await enqueueJob(this._conn, "export_tei", params);
      this._jobCenter?.trackJob(job.job_id, `Export TEI → ${outDir}`, (done) => {
        if (done.status === "done") {
          const r = done.result as { count?: number; files_created?: string[] } | undefined;
          this._log(`✓ ${r?.count ?? "?"} fichier(s) TEI créé(s) dans ${outDir}`);
          for (const f of r?.files_created ?? []) this._log(`  • ${f}`);
          this._showToast?.(`✓ Export TEI : ${r?.count ?? "?"} fichier(s)`);
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

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _log(msg: string, isError = false): void {
    const line = document.createElement("div");
    line.className = "log-line" + (isError ? " log-error" : "");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    this._logEl.appendChild(line);
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }
}
