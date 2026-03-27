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
  enqueueJob,
  getJob,
  exportConllu,
  type DocumentRecord,
  SidecarError,
} from "../lib/sidecarClient.ts";
import { save, open } from "@tauri-apps/plugin-dialog";
import type { JobCenter } from "../components/JobCenter.ts";
import { initCardAccordions } from "../lib/uiAccordions.ts";

function _escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export class ExportsScreen {
  private _conn: Conn | null = null;
  private _docs: DocumentRecord[] = [];
  private _jobCenter: JobCenter | null = null;
  private _showToast: ((msg: string, isError?: boolean) => void) | null = null;
  private _isBusy = false;
  private _lastErrorMsg: string | null = null;

  // DOM refs
  private _root!: HTMLElement;
  private _logEl!: HTMLElement;
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

  setJobCenter(jc: JobCenter, showToast: (msg: string, isError?: boolean) => void): void {
    this._jobCenter = jc;
    this._showToast = showToast;
  }

  /** Register a callback invoked when the user clicks "Voir dans Documents". */
  setOnOpenDocuments(cb: () => void): void {
    this._onOpenDocuments = cb;
  }

  private _onOpenDocuments: (() => void) | null = null;

  setConn(conn: Conn | null): void {
    this._conn = conn;
    if (this._root) this._refreshDocs();
    this._refreshRuntimeState();
  }

  render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "screen exports-screen";
    this._root = root;

    root.innerHTML = `
      <!-- EXP-1: Head card enrichie -->
      <div class="card exp-head-card">
        <div class="exp-head-top">
          <div>
            <h2 class="screen-title">Exporter</h2>
            <p class="exp-head-desc">Livrer (TEI) · partager (CSV/Excel) · archiver (Package ZIP)</p>
          </div>
          <div id="exp-state-banner" class="runtime-state state-info" aria-live="polite">
            En attente de connexion sidecar…
          </div>
        </div>
        <div class="exp-head-actions">
          <span id="exp-run-pill" class="chip">—</span>
          <button class="btn btn-sm exp-back-btn">← Alignement</button>
        </div>
      </div>

      <!-- EXP-4: KPI strip display-only -->
      <div class="exp-kpi-strip">
        <div class="exp-kpi"><label>Documents</label><span id="exp-kpi-docs">0</span></div>
        <div class="exp-kpi"><label>Sélectionnés</label><span id="exp-kpi-sel">—</span></div>
        <div class="exp-kpi"><label>Jeu de données</label><span id="exp-kpi-stage">—</span></div>
        <div class="exp-kpi"><label>Format</label><span id="exp-kpi-fmt">—</span></div>
      </div>

      <!-- EXP-2: Workspace 2-col -->
      <div class="card exp-v2-card">
        <div class="exp-workspace">

          <!-- LEFT: doc selection -->
          <div class="exp-col-docs">
            <div class="exp-doc-toolbar">
              <div style="display:flex;align-items:center;gap:8px">
                <h3>Documents source</h3>
                <span id="v2-doc-summary" class="chip">0 doc</span>
              </div>
              <div class="btn-row" style="margin:0">
                <button id="v2-doc-select-all-btn" class="btn btn-secondary btn-sm">Tout sélectionner</button>
                <button id="v2-doc-clear-btn" class="btn btn-secondary btn-sm">Effacer</button>
              </div>
            </div>
            <!-- EXP-3: hidden select (internal state) + visible table -->
            <select id="v2-doc-sel" multiple style="display:none" aria-hidden="true">
              <option value="__all__" selected>— Tous les documents —</option>
            </select>
            <!-- EXP-9: état vide -->
            <div id="exp-empty-hint" class="exp-empty-hint" style="display:none">
              Aucun document importé — allez d'abord dans <strong>Importer</strong>.
            </div>
            <!-- EXP-3: doc table -->
            <table id="exp-doc-grid" class="exp-doc-grid" style="display:none">
              <thead>
                <tr>
                  <th></th>
                  <th>ID</th>
                  <th>Titre</th>
                  <th>Langue</th>
                  <th>Rôle</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody id="exp-doc-body"></tbody>
            </table>
          </div>

          <!-- RIGHT: options + CTA -->
          <div class="exp-col-opts">
            <div class="exp-opts-meta">
              <label>Jeu de données
                <select id="v2-stage">
                  <option value="alignment" selected>Alignement</option>
                  <option value="publication">Publication</option>
                  <option value="segmentation">Segmentation</option>
                  <option value="curation">Curation</option>
                  <option value="runs">Historique des runs</option>
                  <option value="qa">Rapport QA</option>
                </select>
              </label>
              <label>Produit de sortie
                <select id="v2-product"></select>
              </label>
              <label>Format fichier
                <select id="v2-format"></select>
              </label>
            </div>

            <div id="v2-tei-options" class="form-row" style="margin-top:0.4rem;display:none">
              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
                <input id="v2-tei-include-structure" type="checkbox" />
                Inclure unités structurelles (<code>&lt;head&gt;</code>)
              </label>
              <label>Relation inter-documents (info)
                <select id="v2-tei-relation-type" style="min-width:180px">
                  <option value="none">Aucune</option>
                  <option value="translation_of">translation_of</option>
                  <option value="excerpt_of">excerpt_of</option>
                </select>
              </label>
            </div>

            <div id="v2-align-options" class="form-row" style="margin-top:0.4rem;display:none">
              <label>Pivot (optionnel)
                <select id="v2-align-pivot" style="min-width:170px">
                  <option value="">— tous —</option>
                </select>
              </label>
              <label>Cible (optionnel)
                <select id="v2-align-target" style="min-width:170px">
                  <option value="">— tous —</option>
                </select>
              </label>
              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
                <input id="v2-align-exceptions-only" type="checkbox" />
                Exceptions uniquement
              </label>
            </div>

            <div id="v2-package-options" class="form-row" style="margin-top:0.4rem;display:none">
              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
                <input id="v2-pkg-include-structure" type="checkbox" />
                Inclure unités structurelles
              </label>
              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
                <input id="v2-pkg-include-alignment" type="checkbox" />
                Inclure alignements acceptés
              </label>
              <label>Profil TEI
                <select id="v2-pkg-tei-profile" style="min-width:210px">
                  <option value="generic">Generic</option>
                  <option value="parcolab_like">ParCoLab-like (enrichi)</option>
                  <option value="parcolab_strict">ParCoLab strict (expert)</option>
                </select>
              </label>
            </div>

            <div id="v2-run-options" class="form-row" style="margin-top:0.4rem;display:none">
              <label>run_id (optionnel)
                <input id="v2-run-id" type="text" placeholder="ex: sidecar-align-..." style="min-width:280px"/>
              </label>
            </div>

            <div id="v2-qa-options" class="form-row" style="margin-top:0.4rem;display:none">
              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.84rem;cursor:pointer;align-self:flex-end">
                <input type="checkbox" id="v2-qa-strict-mode">
                Politique QA : Strict
              </label>
            </div>

            <div id="v2-pending-hint" style="display:none;margin-top:0.45rem;font-size:0.83rem;padding:0.4rem 0.6rem;background:#fff3cd;border-radius:4px;border:1px solid #ffe69c;color:#8a6116"></div>
            <div id="v2-summary-hint" class="hint" style="margin-top:0.45rem"></div>
            <!-- EXP-6: btn-sm supprimé -->
            <div id="exp-seg-guard" class="exp-seg-guard" style="display:none" aria-live="polite"></div>
            <div class="btn-row" style="margin-top:0.6rem">
              <button id="v2-run-btn" class="btn btn-primary" disabled>Choisir destination et lancer…</button>
            </div>
          </div>

        </div>
      </div>

      <!-- CQL Sprint E: CoNLL-U / Sketch Engine vertical export -->
      <div class="card" id="exp-conllu-card">
        <h3 style="margin:0 0 0.3rem">Export annoté — CoNLL-U &amp; Sketch Engine</h3>
        <p class="hint" style="margin:0 0 0.7rem">
          Exporte les tokens annotés (spaCy ou CoNLL-U importé) dans un format
          interopérable. Seuls les documents ayant des tokens sont inclus.
        </p>
        <div class="form-row" style="align-items:flex-end;gap:0.6rem;flex-wrap:wrap">
          <label>Format
            <select id="exp-conllu-fmt" class="form-select" style="min-width:14rem">
              <option value="conllu">CoNLL-U (.conllu) — Universal Dependencies</option>
              <option value="vertical">Vertical (.vert) — Sketch Engine / NoSketchEngine / CWB</option>
            </select>
          </label>
          <label>Documents
            <select id="exp-conllu-docs" class="form-select" style="min-width:12rem">
              <option value="__all__">— Tous les documents annotés —</option>
            </select>
          </label>
          <button id="exp-conllu-btn" class="btn btn-secondary" disabled>
            Choisir fichier et exporter…
          </button>
        </div>
        <div id="exp-conllu-status" class="hint" style="margin-top:0.45rem;min-height:1.2rem" aria-live="polite"></div>
      </div>

      <div class="card export-legacy-toggle-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.7rem;flex-wrap:wrap">
          <div>
            <h3 style="margin:0">Exports avancés / historiques</h3>
            <p class="hint" style="margin:0.2rem 0 0">Conservez cette zone fermée pour un parcours simplifié.</p>
          </div>
          <button id="exports-toggle-legacy-btn" class="btn btn-secondary btn-sm">Afficher les exports avancés</button>
        </div>
      </div>

      <div id="exports-legacy-container" style="display:none">
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
              <option value="parcolab_strict">ParCoLab strict (expert)</option>
            </select>
          </label>
        </div>
        <div id="pkg-strict-notice" style="display:none;margin-top:0.35rem;font-size:0.78rem;color:#b8590a;background:#fff3cd;border-radius:4px;padding:0.3rem 0.6rem">
          ⚠ Profil strict : peut bloquer l'export si des métadonnées sont incomplètes (title, language, date). Recommande la politique QA Strict.
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
            Politique QA : Strict
            <span title="Politique QA Strict : les avertissements (collisions, trous d'import, métadonnées optionnelles manquantes, relations) deviennent bloquants — recommandé avant publication TEI." style="color:#6c757d;cursor:help">ⓘ</span>
          </label>
          <div style="align-self:flex-end">
            <button id="qa-report-btn" class="btn btn-primary btn-sm" disabled>Choisir fichier et exporter rapport QA…</button>
          </div>
        </div>
        <div id="qa-gate-banner" style="display:none;margin-top:0.5rem;padding:0.4rem 0.75rem;border-radius:4px;font-size:0.83rem"></div>
      </div>
      </div>

      <section class="card export-log-card" data-collapsible="true" data-collapsed-default="true">
        <h3>Journal des exports</h3>
        <div id="export-log" class="log-pane"></div>
      </section>
    `;

    this._logEl = root.querySelector("#export-log")!;
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

    // EXP-1: head card — run pill + back button
    const runPill = root.querySelector<HTMLElement>("#exp-run-pill");
    if (runPill) {
      const runId = localStorage.getItem("agrafes.prep.workflow.run_id");
      if (runId) runPill.textContent = `run\u00a0: ${runId}`;
    }
    root.querySelector<HTMLButtonElement>(".exp-back-btn")?.addEventListener("click", () => {
      document.querySelector<HTMLElement>('.prep-nav-tree-link[data-nav="alignement"]')?.click();
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
    root.querySelector<HTMLButtonElement>("#exp-conllu-btn")!
      .addEventListener("click", () => void this._runConlluExport());

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
    this._refreshRuntimeState();
    return root;
  }

  private _toggleLegacyExports(): void {
    const isOpen = this._legacyContainer.style.display !== "none";
    this._legacyContainer.style.display = isOpen ? "none" : "block";
    this._legacyToggleBtn.textContent = isOpen
      ? "Afficher les exports avancés"
      : "Masquer les exports avancés";
  }

  // ── Doc refresh ─────────────────────────────────────────────────────────────

  private async _refreshDocs(): Promise<void> {
    const teiBtns = this._root.querySelectorAll<HTMLButtonElement>("#v2-run-btn, #tei-export-btn, #pkg-export-btn, #align-csv-btn, #report-export-btn, #qa-report-btn, #exp-conllu-btn");
    if (!this._conn) {
      teiBtns.forEach(b => b.disabled = true);
      this._refreshRuntimeState();
      return;
    }
    this._isBusy = true;
    this._refreshRuntimeState();
    try {
      this._docs = await listDocuments(this._conn);
      this._lastErrorMsg = null;
    } catch {
      this._docs = [];
      this._lastErrorMsg = "Impossible de charger la liste des documents.";
    } finally {
      this._isBusy = false;
    }
    teiBtns.forEach(b => (b.disabled = false));
    this._renderDocOptions();
    this._syncV2Ui();
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

    // CoNLL-U / vertical doc select (single-select; only annotated docs)
    const conlluSel = this._root.querySelector<HTMLSelectElement>("#exp-conllu-docs");
    if (conlluSel) {
      conlluSel.innerHTML = "";
      const allAnnotOpt = document.createElement("option");
      allAnnotOpt.value = "__all__";
      allAnnotOpt.textContent = "— Tous les documents annotés —";
      conlluSel.appendChild(allAnnotOpt);
      const annotated = this._docs.filter(d => (d.token_count ?? 0) > 0);
      for (const d of annotated) {
        const opt = document.createElement("option");
        opt.value = String(d.doc_id);
        opt.textContent = `#${d.doc_id} ${d.title} (${d.language}) · ${d.token_count} tokens`;
        conlluSel.appendChild(opt);
      }
      if (annotated.length === 0) {
        const noOpt = document.createElement("option");
        noOpt.disabled = true;
        noOpt.textContent = "Aucun document annoté — utilisez Annoter dans Documents";
        conlluSel.appendChild(noOpt);
      }
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
    body.innerHTML = this._docs.map(d => {
      const sel = selectedIds.includes(d.doc_id);
      const title = d.title.length > 40 ? d.title.slice(0, 40) + "…" : d.title;
      return `<tr class="exp-doc-row" data-doc-id="${d.doc_id}">
        <td><input type="checkbox" class="exp-doc-check" data-doc-id="${d.doc_id}"${sel ? " checked" : ""}></td>
        <td class="exp-doc-id">${d.doc_id}</td>
        <td class="exp-doc-title" title="${_escHtml(d.title)}">${_escHtml(title)}</td>
        <td class="exp-doc-lang">${d.language}</td>
        <td class="exp-doc-role">${d.doc_role ?? "—"}</td>
        <td><span class="chip">${statusLabel(d)}</span></td>
      </tr>`;
    }).join("");
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
    const fmt   = this._v2FormatEl?.selectedOptions[0]?.text ?? "—";
    setKpi("exp-kpi-stage", stage);
    setKpi("exp-kpi-fmt", fmt);
    this._updateSegGuard(selIds);
  }

  // D-1 + D-2: Segmentation guard — warn if selected docs have no units.
  private _updateSegGuard(selIds: number[] | undefined): void {
    const guardEl = this._root?.querySelector<HTMLElement>("#exp-seg-guard");
    if (!guardEl) return;

    const scope = selIds === undefined ? this._docs : this._docs.filter(d => selIds.includes(d.doc_id));
    const unseg = scope.filter(d => (d.unit_count ?? 0) === 0);

    if (unseg.length === 0) {
      guardEl.style.display = "none";
      guardEl.innerHTML = "";
      return;
    }

    const names = unseg.slice(0, 3).map(d => _escHtml(d.title)).join(", ");
    const more  = unseg.length > 3 ? ` +${unseg.length - 3}` : "";
    const navLink = this._onOpenDocuments
      ? `<button class="exp-guard-link" id="exp-guard-nav">Voir dans Documents →</button>`
      : "";

    guardEl.innerHTML = `
      <span class="exp-guard-icon">⚠</span>
      <span class="exp-guard-msg">
        <strong>${unseg.length} document(s) non segmenté(s)</strong> dans la sélection&nbsp;:
        ${names}${more}.
        L'export TEI de ces documents sera vide.
      </span>
      ${navLink}
    `;
    guardEl.style.display = "flex";

    guardEl.querySelector<HTMLButtonElement>("#exp-guard-nav")?.addEventListener("click", () => {
      this._onOpenDocuments?.();
    });
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
    const productByStage: Record<string, Array<{ value: string; label: string; pending?: boolean }>> = {
      alignment: [
        { value: "aligned_table", label: "Tableau segments alignés" },
        { value: "tei_xml", label: "TEI XML (documents sélectionnés)" },
      ],
      publication: [
        { value: "tei_package", label: "Package publication TEI (ZIP)" },
      ],
      segmentation: [
        { value: "tei_xml", label: "TEI XML (segments validés)" },
        { value: "readable_text", label: "Texte lisible" },
      ],
      curation: [
        { value: "tei_xml", label: "TEI XML (texte revu)" },
        { value: "readable_text", label: "Texte lisible" },
      ],
      runs: [
        { value: "run_report", label: "Rapport des runs" },
      ],
      qa: [
        { value: "qa_report", label: "Rapport QA corpus" },
      ],
    };

    const products = productByStage[stage] ?? productByStage.alignment;
    const product = this._setSelectOptions(
      this._v2ProductEl,
      products.map(p => ({ value: p.value, label: p.label })),
    );
    const productMeta = products.find(p => p.value === product);
    const productPending = Boolean(productMeta?.pending);

    const formatByProduct: Record<string, Array<{ value: string; label: string; pending?: boolean }>> = {
      aligned_table: [
        { value: "csv", label: "CSV" },
        { value: "tsv", label: "TSV" },
      ],
      tei_xml: [
        { value: "tei_dir", label: "Dossier TEI (un fichier/doc)" },
      ],
      tei_package: [
        { value: "zip", label: "ZIP" },
      ],
      run_report: [
        { value: "jsonl", label: "JSONL" },
        { value: "html", label: "HTML" },
      ],
      qa_report: [
        { value: "json", label: "JSON" },
        { value: "html", label: "HTML" },
      ],
      readable_text: [
        { value: "txt", label: "TXT" },
        { value: "docx", label: "DOCX" },
      ],
    };
    const formats = formatByProduct[product] ?? [];
    const format = this._setSelectOptions(
      this._v2FormatEl,
      formats.map(f => ({ value: f.value, label: f.label })),
    );
    const formatPending = Boolean(formats.find(f => f.value === format)?.pending);
    const isPending = productPending || formatPending;

    const teiOptions = this._root.querySelector<HTMLElement>("#v2-tei-options");
    const alignOptions = this._root.querySelector<HTMLElement>("#v2-align-options");
    const pkgOptions = this._root.querySelector<HTMLElement>("#v2-package-options");
    const runOptions = this._root.querySelector<HTMLElement>("#v2-run-options");
    const qaOptions = this._root.querySelector<HTMLElement>("#v2-qa-options");
    const v2TeiRelationTypeEl = this._root.querySelector<HTMLSelectElement>("#v2-tei-relation-type");
    const pendingHint = this._root.querySelector<HTMLElement>("#v2-pending-hint");
    const summaryHint = this._root.querySelector<HTMLElement>("#v2-summary-hint");

    if (teiOptions) teiOptions.style.display = product === "tei_xml" ? "flex" : "none";
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
    this._v2RunBtn.disabled = !this._conn || isPending || hasEmptySelection;
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
        const exportFmt = format === "docx" ? "docx" : "txt";
        const outDir = await open({ directory: true, title: `Choisir le dossier de sortie (${exportFmt.toUpperCase()})` });
        if (!outDir || typeof outDir !== "string") return;
        const params: Record<string, unknown> = { out_dir: outDir, format: exportFmt };
        if (doc_ids) params.doc_ids = doc_ids;

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
            setTimeout(() => void poll(), 1000);
          }
        };
        setTimeout(() => void poll(), 500);
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

  // ── CQL Sprint E: CoNLL-U / vertical Export ───────────────────────────────

  private async _runConlluExport(): Promise<void> {
    if (!this._conn) return;

    const fmtSel  = this._root.querySelector<HTMLSelectElement>("#exp-conllu-fmt");
    const docsSel = this._root.querySelector<HTMLSelectElement>("#exp-conllu-docs");
    const statusEl = this._root.querySelector<HTMLElement>("#exp-conllu-status");
    const btn     = this._root.querySelector<HTMLButtonElement>("#exp-conllu-btn");

    const fmt = (fmtSel?.value ?? "conllu") as "conllu" | "vertical";
    const ext = fmt === "conllu" ? "conllu" : "vert";
    const docsVal = docsSel?.value ?? "__all__";
    const doc_ids: number[] | undefined = docsVal === "__all__"
      ? undefined
      : [Number(docsVal)];

    const outPath = await save({
      title: "Enregistrer l'export annoté",
      filters: [{ name: fmt === "conllu" ? "CoNLL-U" : "Vertical", extensions: [ext] }],
      defaultPath: `corpus.${ext}`,
    });
    if (!outPath) return;

    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = "Export en cours…";

    try {
      const report = await exportConllu(this._conn, {
        format: fmt,
        doc_ids,
        out_path: outPath,
      });

      const skippedNote = report.skipped_unannotated.length > 0
        ? ` (${report.skipped_unannotated.length} doc(s) sans annotation ignoré(s))`
        : "";

      if (statusEl) {
        statusEl.textContent =
          `✓ ${report.docs_exported} document(s) · ${report.tokens_exported.toLocaleString("fr")} tokens · ` +
          `${report.sentences_exported.toLocaleString("fr")} phrases exportées${skippedNote}.`;
      }
      this._showToast?.(
        `Export ${fmt.toUpperCase()} : ${report.tokens_exported.toLocaleString("fr")} tokens dans ${report.docs_exported} document(s).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (statusEl) statusEl.textContent = `✗ ${msg}`;
      this._showToast?.(`Export CoNLL-U échoué : ${msg}`, true);
    } finally {
      if (btn) btn.disabled = false;
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
    if (isError) {
      this._lastErrorMsg = msg;
    } else if (msg.startsWith("✓")) {
      this._lastErrorMsg = null;
    }
    this._refreshRuntimeState();
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
    const hasReadableSelection = this._v2ProductEl?.value === "readable_text";
    if (hasReadableSelection) {
      this._setRuntimeState("info", "Produit texte lisible sélectionné (TXT/DOCX).");
      return;
    }
    this._setRuntimeState("ok", `${this._docs.length} document(s) disponibles pour export.`);
  }
}
