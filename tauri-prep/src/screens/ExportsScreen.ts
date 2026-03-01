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
  getJob,
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
  private _pkgDocSelEl!: HTMLSelectElement;
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
        <p class="hint">Exporte un ou plusieurs documents au format TEI "analyse" (UTF-8). Un fichier XML par document.</p>
        <div class="form-row">
          <label>Portée (documents)
            <select id="tei-doc-sel" multiple style="height:90px;min-width:220px">
              <option value="__all__" selected>— Tous les documents —</option>
            </select>
          </label>
          <div style="display:flex;flex-direction:column;gap:0.5rem;align-self:flex-start;padding-top:1.2rem">
            <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer">
              <input id="tei-include-structure" type="checkbox" />
              Inclure unités structurelles (<code>&lt;head&gt;</code>)
            </label>
            <label style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.84rem">
              Relation inter-documents
              <select id="tei-relation-type" style="padding:0.2rem 0.4rem;border:1px solid #dee2e6;border-radius:4px">
                <option value="none">Aucune</option>
                <option value="translation_of">translation_of</option>
                <option value="excerpt_of">excerpt_of</option>
              </select>
            </label>
          </div>
        </div>
        <div id="tei-recap" style="display:none;font-size:0.83rem;margin-top:0.4rem;padding:0.4rem 0.6rem;background:#f0fff4;border-radius:4px;border:1px solid #c6efce;color:#1a7f4e"></div>
        <div class="btn-row" style="margin-top:0.6rem">
          <button id="tei-export-btn" class="btn btn-primary btn-sm" disabled>Choisir dossier et exporter…</button>
        </div>
      </div>

      <!-- Publication Package Export -->
      <div class="card">
        <h3>Package publication <span class="badge-preview">ZIP</span></h3>
        <p class="hint">Génère un fichier ZIP contenant les TEI, un manifeste JSON, les checksums SHA-256 et un README. Idéal pour l'archivage et la diffusion.</p>
        <div class="form-row">
          <label>Portée (documents)
            <select id="pkg-doc-sel" multiple style="height:90px;min-width:220px">
              <option value="__all__" selected>— Tous les documents —</option>
            </select>
          </label>
          <div style="display:flex;flex-direction:column;gap:0.5rem;align-self:flex-start;padding-top:1.2rem">
            <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer">
              <input id="pkg-include-structure" type="checkbox" />
              Inclure unités structurelles (<code>&lt;head&gt;</code>)
            </label>
            <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer">
              <input id="pkg-include-alignment" type="checkbox" />
              Inclure alignements acceptés (<code>&lt;linkGrp&gt;</code>)
            </label>
          </div>
        </div>
        <div class="form-row" style="margin-top:0.5rem">
          <label style="font-size:0.84rem">Profil TEI
            <select id="pkg-tei-profile" style="padding:3px 8px;border:1px solid #dee2e6;border-radius:4px;margin-left:0.4rem">
              <option value="generic">Generic</option>
              <option value="parcolab_like">ParCoLab-like (enrichi)</option>
            </select>
          </label>
        </div>
        <div class="btn-row" style="margin-top:0.6rem">
          <button id="pkg-export-btn" class="btn btn-success btn-sm" disabled>Choisir fichier et exporter package…</button>
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

      <!-- QA Report Export -->
      <div class="card">
        <h3>Rapport QA corpus <span class="badge-preview">JSON/HTML</span></h3>
        <p class="hint">Génère un rapport de qualité : intégrité des identifiants, unités vides, couverture des alignements, collisions et préparation TEI (métadonnées). Consultez le rapport avant publication.</p>
        <div class="form-row">
          <label>Format
            <select id="qa-report-fmt">
              <option value="json">JSON</option>
              <option value="html">HTML</option>
            </select>
          </label>
          <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
            <input type="checkbox" id="qa-strict-mode">
            Mode strict
            <span title="En mode strict, les avertissements (collisions, trous d'import, métadonnées optionnelles, relations) deviennent bloquants." style="color:#6c757d;cursor:help">ⓘ</span>
          </label>
          <div style="align-self:flex-end">
            <button id="qa-report-btn" class="btn btn-primary btn-sm" disabled>Choisir fichier et exporter rapport QA…</button>
          </div>
        </div>
        <div id="qa-gate-banner" style="display:none;margin-top:0.5rem;padding:0.4rem 0.75rem;border-radius:4px;font-size:0.83rem"></div>
      </div>

      <!-- Log -->
      <div class="card">
        <h3>Journal</h3>
        <div id="export-log" class="log-pane"></div>
      </div>
    `;

    this._logEl = root.querySelector("#export-log")!;
    this._docSelEl = root.querySelector<HTMLSelectElement>("#tei-doc-sel")!;
    this._pkgDocSelEl = root.querySelector<HTMLSelectElement>("#pkg-doc-sel")!;
    this._pivotSelEl = root.querySelector<HTMLSelectElement>("#align-csv-pivot")!;
    this._targetSelEl = root.querySelector<HTMLSelectElement>("#align-csv-target")!;

    root.querySelector("#tei-export-btn")!.addEventListener("click", () => this._runTeiExport());
    root.querySelector("#pkg-export-btn")!.addEventListener("click", () => this._runPackageExport());
    root.querySelector("#align-csv-btn")!.addEventListener("click", () => this._runAlignCsvExport());
    root.querySelector("#report-export-btn")!.addEventListener("click", () => this._runRunReportExport());
    root.querySelector("#qa-report-btn")!.addEventListener("click", () => this._runQaReportExport());

    this._refreshDocs();
    return root;
  }

  // ── Doc refresh ─────────────────────────────────────────────────────────────

  private async _refreshDocs(): Promise<void> {
    const teiBtns = this._root.querySelectorAll<HTMLButtonElement>("#tei-export-btn, #pkg-export-btn, #align-csv-btn, #report-export-btn, #qa-report-btn");
    if (!this._conn) {
      teiBtns.forEach(b => b.disabled = true);
      return;
    }
    try {
      this._docs = await listDocuments(this._conn);
    } catch {
      this._docs = [];
    }
    teiBtns.forEach(b => (b.disabled = false));
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

    // Package multi-select
    const allOptionPkg = document.createElement("option");
    allOptionPkg.value = "__all__";
    allOptionPkg.textContent = "— Tous les documents —";
    allOptionPkg.selected = true;
    this._pkgDocSelEl.innerHTML = "";
    this._pkgDocSelEl.appendChild(allOptionPkg);
    for (const d of this._docs) {
      const opt = document.createElement("option");
      opt.value = String(d.doc_id);
      opt.textContent = `#${d.doc_id} ${d.title} (${d.language})`;
      this._pkgDocSelEl.appendChild(opt);
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

    const params: Record<string, unknown> = { out_dir: outDir, include_structure: includeStructure };
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
    this._log(`Rapport QA: génération en cours (format ${fmt}, politique: ${qaPolicy})…`);

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
          banner.innerHTML = `${gateIcon} <strong>${gate === "ok" ? "Prêt pour publication" : gate === "blocking" ? "Bloquant" : "Avertissements"}</strong>${policyBadge}`
            + (issues.length ? `<ul style="margin:0.3rem 0 0 1rem">${issues.map(i => `<li>${i}</li>`).join("")}</ul>` : "");
          this._log(`Rapport QA exporté → ${outPath} (gate: ${gate}, politique: ${qaPolicy})`);
          btn.disabled = false;
        } else if (rec.status === "error" || rec.status === "canceled") {
          this._log(`Erreur rapport QA: ${rec.error ?? rec.status}`, true);
          btn.disabled = false;
        } else {
          setTimeout(() => void poll(), 1000);
        }
      };
      setTimeout(() => void poll(), 500);
    } catch (err) {
      this._log(`Erreur rapport QA: ${err instanceof SidecarError ? err.message : String(err)}`, true);
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
