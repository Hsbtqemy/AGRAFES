/**
 * ConcordancierScreen.ts — Recherche CQL token-level dans tauri-prep.
 *
 * Sprint C du backlog CQL : interface KWIC pour la recherche par attributs
 * linguistiques (lemme, POS, feats…) dans la table tokens.
 *
 * Fonctionnalités :
 *  - Champ CQL + aide syntaxique dépliable
 *  - Sélecteur de fenêtre contextuelle (±3 / 5 / 10 / 20 tokens)
 *  - Tableau KWIC paginé (50 / 100 / 200 résultats par page)
 *  - Export CSV / TXT / DOCX / ODT via POST /export/kwic
 */

import type { Conn, KwicHit } from "../lib/sidecarClient.ts";
import { runTokenQuery, exportKwic, listDocuments } from "../lib/sidecarClient.ts";
import type { JobCenter } from "../components/JobCenter.ts";
import { showToast } from "../components/JobCenter.ts";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";

// ─── State ────────────────────────────────────────────────────────────────────

interface ScreenState {
  cql: string;
  window: number;
  limit: number;
  offset: number;
  total: number;
  hits: KwicHit[];
  loading: boolean;
  error: string | null;
  filterDocIds: number[];
}

// ─── ConcordancierScreen ──────────────────────────────────────────────────────

export class ConcordancierScreen {
  private _conn: Conn | null = null;
  private _jobCenter: JobCenter | null = null;
  private _el: HTMLElement | null = null;

  private _state: ScreenState = {
    cql: "",
    window: 5,
    limit: 50,
    offset: 0,
    total: 0,
    hits: [],
    loading: false,
    error: null,
    filterDocIds: [],
  };

  // ── Injections ──────────────────────────────────────────────────────────────

  setConn(conn: Conn | null): void {
    this._conn = conn;
    this._refreshDocFilter();
  }

  setJobCenter(jc: JobCenter, _toast: typeof showToast): void {
    this._jobCenter = jc;
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  render(): HTMLElement {
    const el = document.createElement("div");
    el.className = "concordancier-screen";
    el.id = "concordancier-screen";

    el.innerHTML = `
      <div class="cql-header">
        <h2 class="cql-title">Concordancier CQL</h2>
        <p class="cql-subtitle">
          Recherche token par token — attributs : <code>word</code>, <code>lemma</code>,
          <code>upos</code>, <code>xpos</code>, <code>feats</code>, <code>misc</code>
        </p>
      </div>

      <div class="cql-toolbar">
        <div class="cql-input-row">
          <textarea id="cql-input" class="cql-input" rows="2"
            placeholder='[lemma="manger"][upos="ADV"]'
            spellcheck="false"></textarea>
          <button id="cql-search-btn" class="btn btn-primary cql-search-btn">Rechercher</button>
        </div>

        <details class="cql-help">
          <summary>Aide syntaxique CQL</summary>
          <div class="cql-help-body">
            <table class="cql-help-table">
              <tr><th>Syntaxe</th><th>Signification</th></tr>
              <tr><td><code>[lemma="aller"]</code></td><td>Token dont le lemme = "aller"</td></tr>
              <tr><td><code>[upos="VERB"]</code></td><td>Token dont le POS universel = VERB</td></tr>
              <tr><td><code>[word="les" %c]</code></td><td>Insensible à la casse (%c)</td></tr>
              <tr><td><code>[lemma="être.*"]</code></td><td>Valeur comme regex Python</td></tr>
              <tr><td><code>[upos="VERB" &amp; lemma="all.*"]</code></td><td>ET logique</td></tr>
              <tr><td><code>[upos="VERB" | upos="AUX"]</code></td><td>OU logique</td></tr>
              <tr><td><code>[upos="DET"][upos="NOUN"]</code></td><td>Séquence de 2 tokens</td></tr>
            </table>
            <p class="cql-help-note">
              Attributs disponibles : <code>word</code>, <code>lemma</code>, <code>upos</code>,
              <code>xpos</code>, <code>feats</code>, <code>misc</code>
            </p>
          </div>
        </details>

        <div class="cql-options-row">
          <label class="cql-option-label">
            Fenêtre
            <select id="cql-window-sel" class="cql-select cql-select-sm">
              <option value="3">± 3</option>
              <option value="5" selected>± 5</option>
              <option value="10">± 10</option>
              <option value="20">± 20</option>
            </select>
          </label>

          <label class="cql-option-label">
            Par page
            <select id="cql-limit-sel" class="cql-select cql-select-sm">
              <option value="50" selected>50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </label>

          <label class="cql-option-label">
            Document
            <select id="cql-doc-sel" class="cql-select">
              <option value="">Tous les documents</option>
            </select>
          </label>

          <div class="cql-export-row">
            <span class="cql-option-label">Exporter :</span>
            <button id="cql-export-csv"  class="btn btn-ghost btn-sm" title="Export CSV (tabulation)">CSV</button>
            <button id="cql-export-txt"  class="btn btn-ghost btn-sm" title="Export texte brut">TXT</button>
            <button id="cql-export-docx" class="btn btn-ghost btn-sm" title="Export Word (nœud en gras)">DOCX</button>
            <button id="cql-export-odt"  class="btn btn-ghost btn-sm" title="Export LibreOffice (nœud en gras)">ODT</button>
          </div>
        </div>
      </div>

      <div id="cql-status" class="cql-status"></div>
      <div id="cql-results" class="cql-results"></div>
      <div id="cql-pagination" class="cql-pagination"></div>
    `;

    this._el = el;
    this._bindEvents();
    this._refreshDocFilter();
    return el;
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  private _bindEvents(): void {
    const el = this._el!;

    el.querySelector<HTMLButtonElement>("#cql-search-btn")!
      .addEventListener("click", () => void this._doSearch(true));

    el.querySelector<HTMLTextAreaElement>("#cql-input")!
      .addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void this._doSearch(true);
        }
      });

    el.querySelector<HTMLSelectElement>("#cql-window-sel")!
      .addEventListener("change", (e) => {
        this._state.window = Number((e.target as HTMLSelectElement).value);
      });

    el.querySelector<HTMLSelectElement>("#cql-limit-sel")!
      .addEventListener("change", (e) => {
        this._state.limit = Number((e.target as HTMLSelectElement).value);
      });

    el.querySelector<HTMLSelectElement>("#cql-doc-sel")!
      .addEventListener("change", (e) => {
        const v = (e.target as HTMLSelectElement).value;
        this._state.filterDocIds = v ? [Number(v)] : [];
      });

    el.querySelector<HTMLButtonElement>("#cql-export-csv")!
      .addEventListener("click", () => void this._doExport("csv"));
    el.querySelector<HTMLButtonElement>("#cql-export-txt")!
      .addEventListener("click", () => void this._doExport("txt"));
    el.querySelector<HTMLButtonElement>("#cql-export-docx")!
      .addEventListener("click", () => void this._doExport("docx"));
    el.querySelector<HTMLButtonElement>("#cql-export-odt")!
      .addEventListener("click", () => void this._doExport("odt"));
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  private async _doSearch(reset: boolean): Promise<void> {
    if (!this._conn) { showToast("Ouvrez une base de données d'abord."); return; }
    if (!this._el) return;

    const cql = (this._el.querySelector<HTMLTextAreaElement>("#cql-input")!.value ?? "").trim();
    if (!cql) { this._setStatus("Saisissez une requête CQL."); return; }

    if (reset) {
      this._state.cql = cql;
      this._state.offset = 0;
      this._state.hits = [];
    }

    this._state.loading = true;
    this._setStatus("Recherche en cours\u2026");
    this._renderResults();
    this._renderPagination();

    try {
      const resp = await runTokenQuery(this._conn, {
        cql: this._state.cql,
        window: this._state.window,
        doc_ids: this._state.filterDocIds.length ? this._state.filterDocIds : undefined,
        limit: this._state.limit,
        offset: this._state.offset,
      });

      this._state.hits = reset ? resp.hits : [...this._state.hits, ...resp.hits];
      this._state.total = resp.total;
      this._state.error = null;

      if (resp.total === 0) {
        this._setStatus("Aucun résultat.");
      } else {
        this._setStatus(
          `${resp.total.toLocaleString("fr")} occurrence(s) — page ${Math.floor(this._state.offset / this._state.limit) + 1}`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._state.error = msg;
      this._setStatus(`Erreur : ${msg}`, true);
    } finally {
      this._state.loading = false;
      this._renderResults();
      this._renderPagination();
    }
  }

  private async _doExport(fmt: "csv" | "txt" | "docx" | "odt"): Promise<void> {
    if (!this._conn) { showToast("Ouvrez une base de données d'abord."); return; }

    const cql = (this._el?.querySelector<HTMLTextAreaElement>("#cql-input")?.value ?? "").trim();
    if (!cql) { showToast("Saisissez une requête CQL avant d'exporter."); return; }

    const EXT: Record<string, string> = { csv: "csv", txt: "txt", docx: "docx", odt: "odt" };
    const savePath = await dialogSave({
      title: "Enregistrer les résultats KWIC",
      filters: [{ name: fmt.toUpperCase(), extensions: [EXT[fmt]] }],
      defaultPath: `kwic_results.${EXT[fmt]}`,
    });
    if (!savePath) return;

    try {
      const res = await exportKwic(this._conn, {
        cql,
        window: this._state.window,
        doc_ids: this._state.filterDocIds.length ? this._state.filterDocIds : undefined,
        format: fmt,
        out_path: savePath,
      });
      showToast(`\u2713 ${res.count} résultat(s) exporté(s) en ${fmt.toUpperCase()}`);
    } catch (err) {
      showToast(`\u2717 Export échoué : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── UI helpers ───────────────────────────────────────────────────────────────

  private _setStatus(msg: string, isError = false): void {
    const el = this._el?.querySelector<HTMLElement>("#cql-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "cql-status" + (isError ? " cql-status--error" : "");
  }

  private _renderResults(): void {
    const el = this._el?.querySelector<HTMLElement>("#cql-results");
    if (!el) return;

    if (this._state.loading && this._state.hits.length === 0) {
      el.innerHTML = '<div class="cql-spinner">Chargement\u2026</div>';
      return;
    }

    if (this._state.hits.length === 0) {
      el.innerHTML = "";
      return;
    }

    const table = document.createElement("table");
    table.className = "cql-kwic-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th class="cql-col-doc">Document</th>
          <th class="cql-col-pos">Ligne</th>
          <th class="cql-col-left">← Contexte</th>
          <th class="cql-col-node">Nœud</th>
          <th class="cql-col-right">Contexte →</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");

    for (const hit of this._state.hits) {
      const tr = document.createElement("tr");
      tr.className = "cql-kwic-row";

      const tdDoc = document.createElement("td");
      tdDoc.className = "cql-col-doc";
      tdDoc.title = `doc_id: ${hit.doc_id}`;
      tdDoc.textContent = hit.doc_title || `#${hit.doc_id}`;

      const tdPos = document.createElement("td");
      tdPos.className = "cql-col-pos";
      tdPos.textContent = String(hit.unit_position + 1);

      const tdLeft = document.createElement("td");
      tdLeft.className = "cql-col-left";
      tdLeft.textContent = hit.left.join(" ");

      const tdNode = document.createElement("td");
      tdNode.className = "cql-col-node";
      const nodeSpan = document.createElement("strong");
      nodeSpan.textContent = hit.node.join(" ");
      tdNode.appendChild(nodeSpan);

      const tdRight = document.createElement("td");
      tdRight.className = "cql-col-right";
      tdRight.textContent = hit.right.join(" ");

      tr.appendChild(tdDoc);
      tr.appendChild(tdPos);
      tr.appendChild(tdLeft);
      tr.appendChild(tdNode);
      tr.appendChild(tdRight);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    el.innerHTML = "";
    el.appendChild(table);
  }

  private _renderPagination(): void {
    const el = this._el?.querySelector<HTMLElement>("#cql-pagination");
    if (!el) return;
    el.innerHTML = "";

    const { hits, total, offset, limit, loading } = this._state;
    if (total === 0) return;

    const row = document.createElement("div");
    row.className = "cql-pagination-row";

    const info = document.createElement("span");
    info.className = "cql-pagination-info";
    info.textContent = `${hits.length} / ${total.toLocaleString("fr")} occurrences`;
    row.appendChild(info);

    const hasMore = offset + limit < total;
    if (hasMore && !loading) {
      const nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-secondary btn-sm";
      nextBtn.textContent = "Charger plus\u2026";
      nextBtn.addEventListener("click", () => {
        this._state.offset = hits.length;
        void this._doSearch(false);
      });
      row.appendChild(nextBtn);
    }

    if (hits.length > 0) {
      const prevBtn = document.createElement("button");
      prevBtn.className = "btn btn-ghost btn-sm";
      prevBtn.textContent = "\u21ba Réinitialiser";
      prevBtn.addEventListener("click", () => {
        this._state.hits = [];
        this._state.offset = 0;
        this._state.total = 0;
        this._setStatus("");
        this._renderResults();
        this._renderPagination();
      });
      row.appendChild(prevBtn);
    }

    el.appendChild(row);
  }

  // ── Document filter ──────────────────────────────────────────────────────────

  private _refreshDocFilter(): void {
    if (!this._conn || !this._el) return;
    listDocuments(this._conn).then(docs => {
      const sel = this._el?.querySelector<HTMLSelectElement>("#cql-doc-sel");
      if (!sel) return;
      const prev = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      for (const doc of docs) {
        const opt = document.createElement("option");
        opt.value = String(doc.doc_id);
        opt.textContent = `[${doc.language}] ${doc.title}`;
        sel.appendChild(opt);
      }
      if (prev) sel.value = prev;
    }).catch(() => { /* best-effort */ });
  }

  /** Called when the tab becomes active. */
  onActivate(): void {
    this._refreshDocFilter();
  }
}
