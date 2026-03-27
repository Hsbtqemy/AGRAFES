/**
 * ConcordancierScreen.ts — Recherche CQL token-level dans tauri-prep.
 *
 * Sprint C : mode séquences fixes (SQL joins).
 * Sprint D : wildcard [], répétitions {m,n}, within s,
 *            validation syntaxique côté client, aide enrichie.
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
  withinS: boolean;
}

// ─── CQL client-side syntax check ─────────────────────────────────────────────

/** Very lightweight client-side CQL validator.
 *  Returns null if the query looks valid, or an error message.
 */
function _validateCqlSyntax(cql: string): string | null {
  const trimmed = cql.trim();
  if (!trimmed) return "La requête est vide.";
  if (!trimmed.includes("[")) return "La requête doit contenir au moins un token entre crochets [ ].";

  // Check balanced brackets
  let depth = 0;
  for (const ch of trimmed) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (depth < 0) return "Crochet fermant ] non précédé d'un ouvrant.";
  }
  if (depth !== 0) return `${depth} crochet(s) ouvrant(s) [ non fermé(s).`;

  // Check balanced braces for quantifiers
  let braceDepth = 0;
  for (const ch of trimmed) {
    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    if (braceDepth < 0) return "Accolade fermante } sans ouvrante.";
  }
  if (braceDepth !== 0) return "Accolade ouvrante { non fermée.";

  // Check balanced quotes
  const quoteCount = (trimmed.match(/(?<!\\)"/g) ?? []).length;
  if (quoteCount % 2 !== 0) return "Guillemet double non fermé.";

  // Check known attributes (best-effort)
  const attrMatches = trimmed.matchAll(/\[([A-Za-z_][A-Za-z0-9_]*)\s*=/g);
  const validAttrs = new Set(["word", "lemma", "upos", "xpos", "feats", "misc"]);
  for (const m of attrMatches) {
    const attr = m[1];
    if (!validAttrs.has(attr)) {
      return `Attribut inconnu : "${attr}". Valides : ${[...validAttrs].join(", ")}.`;
    }
  }

  return null; // valid
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
    withinS: false,
  };

  // ── History ─────────────────────────────────────────────────────────────────

  private _history: string[] = [];
  private readonly _MAX_HISTORY = 20;

  private _pushHistory(cql: string): void {
    this._history = [cql, ...this._history.filter(h => h !== cql)].slice(0, this._MAX_HISTORY);
    this._renderHistory();
  }

  private _renderHistory(): void {
    const sel = this._el?.querySelector<HTMLSelectElement>("#cql-history-sel");
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    for (const h of this._history) {
      const opt = document.createElement("option");
      opt.value = h;
      opt.textContent = h.length > 60 ? h.slice(0, 57) + "…" : h;
      sel.appendChild(opt);
    }
  }

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
          Recherche token par token — attributs :
          <code>word</code>, <code>lemma</code>, <code>upos</code>,
          <code>xpos</code>, <code>feats</code>, <code>misc</code>
        </p>
      </div>

      <div class="cql-toolbar">
        <div class="cql-input-row">
          <textarea id="cql-input" class="cql-input" rows="2"
            placeholder='[lemma="manger"][upos="ADV"]'
            spellcheck="false"
            aria-label="Requête CQL"
            aria-describedby="cql-syntax-error"></textarea>
          <button id="cql-search-btn" class="btn btn-primary cql-search-btn"
            title="Lancer la recherche (Ctrl+Entrée)">Rechercher</button>
        </div>

        <div id="cql-syntax-error" class="cql-syntax-error" role="alert" aria-live="polite"></div>

        <details class="cql-help">
          <summary>Aide syntaxique CQL</summary>
          <div class="cql-help-body">
            <div class="cql-help-cols">
              <div>
                <h4 class="cql-help-section">Sprint C — séquences</h4>
                <table class="cql-help-table">
                  <tr><th>Syntaxe</th><th>Signification</th></tr>
                  <tr><td><code>[lemma="aller"]</code></td><td>Lemme exact</td></tr>
                  <tr><td><code>[upos="VERB"]</code></td><td>POS universel</td></tr>
                  <tr><td><code>[word="les" %c]</code></td><td>Insensible à la casse</td></tr>
                  <tr><td><code>[lemma="être.*"]</code></td><td>Regex Python</td></tr>
                  <tr><td><code>[upos="VERB" &amp; lemma="all.*"]</code></td><td>ET logique</td></tr>
                  <tr><td><code>[upos="VERB" | upos="AUX"]</code></td><td>OU logique</td></tr>
                  <tr><td><code>[upos="DET"][upos="NOUN"]</code></td><td>Séquence 2 tokens</td></tr>
                </table>
              </div>
              <div>
                <h4 class="cql-help-section">Sprint D — répétitions &amp; wildcards</h4>
                <table class="cql-help-table">
                  <tr><th>Syntaxe</th><th>Signification</th></tr>
                  <tr><td><code>[]</code></td><td>N'importe quel token</td></tr>
                  <tr><td><code>[upos="NOUN"]{2}</code></td><td>Exactement 2 fois</td></tr>
                  <tr><td><code>[]{0,4}</code></td><td>Entre 0 et 4 tokens quelconques</td></tr>
                  <tr><td><code>[upos="ADJ"]{1,3}</code></td><td>1 à 3 adjectifs</td></tr>
                  <tr><td><code>… within s</code></td><td>Tout dans la même phrase</td></tr>
                </table>
                <p class="cql-help-note" style="margin-top:0.5rem">
                  <strong>Exemple :</strong><br>
                  <code>[lemma="it" %c][]{0,3}[word="that" %c] within s</code><br>
                  <em>it … that dans la même phrase</em>
                </p>
              </div>
            </div>
            <p class="cql-help-note" style="margin-top:0.6rem">
              Attributs : <code>word</code>, <code>lemma</code>, <code>upos</code>,
              <code>xpos</code>, <code>feats</code>, <code>misc</code> |
              Max répétition : 50 | Répétition 0 = élément optionnel
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

          <label class="cql-option-label cql-checkbox-label">
            <input type="checkbox" id="cql-within-s" class="cql-checkbox">
            within s <span class="cql-badge-info" title="Tous les tokens matchés doivent être dans la même phrase (sent_id)">?</span>
          </label>

          <label class="cql-option-label">
            Document
            <select id="cql-doc-sel" class="cql-select">
              <option value="">Tous les documents</option>
            </select>
          </label>

          <label class="cql-option-label">
            Historique
            <select id="cql-history-sel" class="cql-select cql-select-hist" title="Réutiliser une requête précédente">
              <option value="">— Requêtes récentes —</option>
            </select>
          </label>
        </div>

        <div class="cql-export-row">
          <span class="cql-option-label">Exporter :</span>
          <button id="cql-export-csv"  class="btn btn-ghost btn-sm">CSV</button>
          <button id="cql-export-txt"  class="btn btn-ghost btn-sm">TXT</button>
          <button id="cql-export-docx" class="btn btn-ghost btn-sm">DOCX</button>
          <button id="cql-export-odt"  class="btn btn-ghost btn-sm">ODT</button>
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

    const textarea = el.querySelector<HTMLTextAreaElement>("#cql-input")!;
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this._doSearch(true);
      }
    });
    textarea.addEventListener("input", () => this._liveValidate());

    el.querySelector<HTMLSelectElement>("#cql-window-sel")!
      .addEventListener("change", (e) => {
        this._state.window = Number((e.target as HTMLSelectElement).value);
      });

    el.querySelector<HTMLSelectElement>("#cql-limit-sel")!
      .addEventListener("change", (e) => {
        this._state.limit = Number((e.target as HTMLSelectElement).value);
      });

    el.querySelector<HTMLInputElement>("#cql-within-s")!
      .addEventListener("change", (e) => {
        this._state.withinS = (e.target as HTMLInputElement).checked;
      });

    el.querySelector<HTMLSelectElement>("#cql-doc-sel")!
      .addEventListener("change", (e) => {
        const v = (e.target as HTMLSelectElement).value;
        this._state.filterDocIds = v ? [Number(v)] : [];
      });

    el.querySelector<HTMLSelectElement>("#cql-history-sel")!
      .addEventListener("change", (e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (!v) return;
        const ta = el.querySelector<HTMLTextAreaElement>("#cql-input");
        if (ta) { ta.value = v; this._liveValidate(); }
        (e.target as HTMLSelectElement).value = "";
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

  // ── Live validation ──────────────────────────────────────────────────────────

  private _liveValidate(): void {
    const cql = (this._el?.querySelector<HTMLTextAreaElement>("#cql-input")?.value ?? "").trim();
    const errEl = this._el?.querySelector<HTMLElement>("#cql-syntax-error");
    if (!errEl) return;
    if (!cql) { errEl.textContent = ""; errEl.hidden = true; return; }
    const err = _validateCqlSyntax(cql);
    if (err) {
      errEl.textContent = "⚠ " + err;
      errEl.hidden = false;
    } else {
      errEl.textContent = "";
      errEl.hidden = true;
    }
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  private async _doSearch(reset: boolean): Promise<void> {
    if (!this._conn) { showToast("Ouvrez une base de données d'abord."); return; }
    if (!this._el) return;

    if (reset) {
      // Fresh search: read textarea, validate, build CQL string with within_s.
      const cql = (this._el.querySelector<HTMLTextAreaElement>("#cql-input")?.value ?? "").trim();
      if (!cql) { this._setStatus("Saisissez une requête CQL."); return; }

      const syntaxErr = _validateCqlSyntax(cql);
      if (syntaxErr) {
        this._setStatus("Erreur de syntaxe : " + syntaxErr, true);
        return;
      }

      const withinS = this._state.withinS;
      const effectiveCql = withinS
        ? (cql.endsWith(" within s") ? cql : cql + " within s")
        : cql.replace(/ within s$/i, "");

      this._state.cql = effectiveCql;
      this._state.offset = 0;
      this._state.hits = [];
      this._pushHistory(cql);
    }

    // Pagination ("Charger plus"): reuse this._state.cql as-is.

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
          `${resp.total.toLocaleString("fr")} occurrence(s)` +
          (this._state.withinS ? " · within s actif" : "")
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

    // Prefer the already-validated state CQL (set by the last search).
    // Fall back to the textarea only if no search has been run yet.
    let effectiveCql = this._state.cql;
    if (!effectiveCql) {
      const rawCql = (this._el?.querySelector<HTMLTextAreaElement>("#cql-input")?.value ?? "").trim();
      if (!rawCql) { showToast("Lancez une recherche avant d'exporter."); return; }
      const syntaxErr = _validateCqlSyntax(rawCql);
      if (syntaxErr) { showToast("Syntaxe CQL invalide : " + syntaxErr); return; }
      const withinS = this._state.withinS;
      effectiveCql = withinS
        ? (rawCql.endsWith(" within s") ? rawCql : rawCql + " within s")
        : rawCql;
    }

    const EXT: Record<string, string> = { csv: "csv", txt: "txt", docx: "docx", odt: "odt" };
    const savePath = await dialogSave({
      title: "Enregistrer les résultats KWIC",
      filters: [{ name: fmt.toUpperCase(), extensions: [EXT[fmt]] }],
      defaultPath: `kwic_results.${EXT[fmt]}`,
    });
    if (!savePath) return;

    try {
      const res = await exportKwic(this._conn, {
        cql: effectiveCql,
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
    table.setAttribute("role", "grid");
    table.innerHTML = `
      <thead>
        <tr>
          <th class="cql-col-doc" scope="col">Document</th>
          <th class="cql-col-pos" scope="col">Ligne</th>
          <th class="cql-col-left" scope="col">← Contexte</th>
          <th class="cql-col-node" scope="col">Nœud</th>
          <th class="cql-col-right" scope="col">Contexte →</th>
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
      const resetBtn = document.createElement("button");
      resetBtn.className = "btn btn-ghost btn-sm";
      resetBtn.textContent = "\u21ba Réinitialiser";
      resetBtn.addEventListener("click", () => {
        this._state.hits = [];
        this._state.offset = 0;
        this._state.total = 0;
        this._setStatus("");
        this._renderResults();
        this._renderPagination();
      });
      row.appendChild(resetBtn);
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
        const annotBadge = (doc.token_count ?? 0) > 0 ? " ✓" : "";
        opt.textContent = `[${doc.language}] ${doc.title}${annotBadge}`;
        if ((doc.token_count ?? 0) === 0) opt.style.color = "#9ca3af";
        sel.appendChild(opt);
      }
      if (prev) sel.value = prev;
    }).catch(() => { /* best-effort */ });
  }

  /** Called when the tab becomes active. */
  onActivate(): void {
    this._refreshDocFilter();
    this._liveValidate();
  }
}
