/**
 * rechercheModule.ts — Recherche grammaticale (CQL / token-level).
 *
 * Wraps POST /token_query with a CQL input, filters, paginated KWIC
 * interlinear display, and a distribution stats panel.
 */

import type { ShellContext } from "../context.ts";
import { validateCqlSyntax } from "../../../tauri-app/src/features/search.ts";
import { ensureRunning, SidecarError, type Conn } from "../../../tauri-prep/src/lib/sidecarClient.ts";

// ─── State ────────────────────────────────────────────────────────────────────

let _conn: Conn | null = null;
let _unsub: (() => void) | null = null;
let _mounted = false;

let _hits: _Hit[] = [];
let _total = 0;
let _offset = 0;
let _lastQuery: _QueryParams | null = null;
let _loading = false;

const PAGE_SIZE = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

interface _Token {
  token_id: number;
  position: number;
  word: string;
  lemma?: string | null;
  upos?: string | null;
  xpos?: string | null;
  feats?: string | null;
}

interface _Hit {
  doc_id: number;
  unit_id: number;
  title: string;
  language: string;
  text_norm: string;
  sent_id: number;
  start_position: number;
  end_position: number;
  tokens: _Token[];         // matched tokens (pivot)
  context_tokens: _Token[]; // full context window
  left?: string;
  match?: string;
  right?: string;
}

interface _QueryParams {
  cql: string;
  language: string | null;
  doc_ids: number[] | null;
  window: number;
}

// ─── UPOS palette (same as ActionsScreen) ─────────────────────────────────────

const UPOS_COLORS: Record<string, string> = {
  NOUN: "#4e9af1", VERB: "#e07b39", ADJ: "#8e6bbf",
  ADV: "#3aab6d", PRON: "#c9a227", DET: "#5bb8c4",
  ADP: "#b0b0b0", CCONJ: "#b0b0b0", SCONJ: "#b0b0b0",
  PUNCT: "#cccccc", NUM: "#c94040", PROPN: "#2e7dbf",
  AUX: "#d97ab8", PART: "#b0b0b0", INTJ: "#e04444",
  SYM: "#999", X: "#bbb",
};

// ─── Module lifecycle ─────────────────────────────────────────────────────────

export async function mount(container: HTMLElement, ctx: ShellContext): Promise<void> {
  _mounted = true;
  _hits = [];
  _total = 0;
  _offset = 0;
  _lastQuery = null;

  container.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = MODULE_CSS;
  container.appendChild(style);

  const root = document.createElement("div");
  root.className = "rech-root";
  container.appendChild(root);

  _renderShell(root);

  // Connect to sidecar when DB path available
  const dbPath = ctx.getDbPath();
  if (dbPath) await _connect(dbPath, root);

  _unsub = ctx.onDbChange(async (path) => {
    if (!_mounted) return;
    _conn = null;
    _hits = [];
    _total = 0;
    _offset = 0;
    _lastQuery = null;
    if (path) await _connect(path, root);
    else _setStatus(root, "Aucune base de données sélectionnée.", true);
  });
}

export function dispose(): void {
  _mounted = false;
  _unsub?.();
  _unsub = null;
  _conn = null;
}

// ─── Connection ───────────────────────────────────────────────────────────────

async function _connect(dbPath: string, root: HTMLElement): Promise<void> {
  _setStatus(root, "Connexion au sidecar…", false);
  try {
    _conn = await ensureRunning(dbPath);
    _setStatus(root, "", false);
    await _populateDocFilter(root);
  } catch (err) {
    _setStatus(root, `Connexion impossible : ${String(err)}`, true);
  }
}

// ─── Shell layout ─────────────────────────────────────────────────────────────

function _renderShell(root: HTMLElement): void {
  root.innerHTML = `
    <div class="rech-toolbar">
      <div class="rech-toolbar-top">
        <span class="rech-title">Recherche grammaticale</span>
        <span class="rech-status-bar" aria-live="polite"></span>
      </div>
      <div class="rech-toolbar-query">
        <textarea
          class="rech-cql-input"
          rows="1"
          spellcheck="false"
          placeholder='ex. [upos="VERB"]  ou  [upos="DET"][upos="NOUN"]'
          aria-label="Requête CQL"
        ></textarea>
        <button class="rech-btn-search">Rechercher</button>
        <button class="rech-btn-help" title="Aide CQL" aria-label="Aide sur la syntaxe CQL">?</button>
      </div>
      <div class="rech-toolbar-filters">
        <label class="rech-filter-label">Langue
          <select class="rech-filter-lang">
            <option value="">(toutes)</option>
          </select>
        </label>
        <label class="rech-filter-label">Documents
          <select class="rech-filter-docs" multiple size="1">
            <option value="">(tous)</option>
          </select>
        </label>
        <label class="rech-filter-label">Contexte
          <select class="rech-filter-window">
            <option value="5">5 tokens</option>
            <option value="10" selected>10 tokens</option>
            <option value="20">20 tokens</option>
          </select>
        </label>
        <label class="rech-filter-check">
          <input type="checkbox" class="rech-filter-within-s"> dans la phrase
        </label>
      </div>
      <div class="rech-examples">
        <span class="rech-examples-label">Exemples :</span>
        <button class="rech-eg" data-cql='[upos="VERB"]'>verbes</button>
        <button class="rech-eg" data-cql='[lemma="être"]'>formes d'être</button>
        <button class="rech-eg" data-cql='[upos="DET"][upos="NOUN"]'>DET + NOM</button>
        <button class="rech-eg" data-cql='[upos="ADJ"]{1,2}[upos="NOUN"]'>groupe nominal</button>
        <button class="rech-eg" data-cql='[upos="VERB"][] [upos="NOUN"] within s'>V __ N (phrase)</button>
      </div>
    </div>

    <div class="rech-help-panel" hidden>
      <div class="rech-help-inner">
        <button class="rech-help-close" aria-label="Fermer l'aide">✕</button>
        <h3>Syntaxe CQL</h3>
        <table class="rech-help-table">
          <thead><tr><th>Attribut</th><th>Description</th><th>Exemple</th></tr></thead>
          <tbody>
            <tr><td><code>word</code></td><td>Forme exacte</td><td><code>[word="Maison"]</code></td></tr>
            <tr><td><code>lemma</code></td><td>Lemme</td><td><code>[lemma="aller"]</code></td></tr>
            <tr><td><code>upos</code></td><td>Catégorie (Universal POS)</td><td><code>[upos="VERB"]</code></td></tr>
            <tr><td><code>xpos</code></td><td>Catégorie fine (treebank)</td><td><code>[xpos="VBC"]</code></td></tr>
            <tr><td><code>feats</code></td><td>Traits morphologiques</td><td><code>[feats=".*Tense=Past.*"]</code></td></tr>
          </tbody>
        </table>
        <table class="rech-help-table">
          <thead><tr><th>Opérateur</th><th>Sens</th><th>Exemple</th></tr></thead>
          <tbody>
            <tr><td><code>[]</code></td><td>N'importe quel token</td><td><code>[upos="VERB"][]</code></td></tr>
            <tr><td><code>{m,n}</code></td><td>Répétition m à n fois</td><td><code>[]{0,3}</code></td></tr>
            <tr><td><code>&amp;</code></td><td>ET dans un token</td><td><code>[upos="NOUN" &amp; lemma="temp.*"]</code></td></tr>
            <tr><td><code>%c</code></td><td>Insensible à la casse</td><td><code>[word="Maison" %c]</code></td></tr>
            <tr><td><code>within s</code></td><td>Dans la même phrase</td><td><code>[...][...] within s</code></td></tr>
          </tbody>
        </table>
        <p class="rech-help-hint">Les valeurs sont des expressions régulières Python (<code>re.fullmatch</code>).</p>
      </div>
    </div>

    <div class="rech-body">
      <div class="rech-results">
        <div class="rech-results-header" hidden>
          <span class="rech-total-label"></span>
          <button class="rech-btn-export" title="Exporter en CSV">↓ CSV</button>
        </div>
        <div class="rech-hits-list"></div>
        <div class="rech-load-more-wrap" hidden>
          <button class="rech-btn-more">Charger plus</button>
        </div>
        <div class="rech-empty" hidden>Aucune occurrence trouvée.</div>
        <div class="rech-spinner" hidden>
          <span class="rech-spinner-dot"></span> Recherche…
        </div>
      </div>
      <div class="rech-stats-panel">
        <div class="rech-stats-header">Distribution</div>
        <div class="rech-stats-group-row">
          <span class="rech-stats-group-label">Grouper par</span>
          <select class="rech-stats-group-by">
            <option value="lemma">Lemme</option>
            <option value="upos">UPOS</option>
            <option value="word">Forme</option>
          </select>
        </div>
        <div class="rech-stats-bars"></div>
        <div class="rech-stats-reset" hidden>
          <button class="rech-btn-reset-filter">Tout afficher</button>
        </div>
      </div>
    </div>
  `;

  _wireEvents(root);
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

function _wireEvents(root: HTMLElement): void {
  const input  = root.querySelector<HTMLTextAreaElement>(".rech-cql-input")!;
  const btn    = root.querySelector<HTMLButtonElement>(".rech-btn-search")!;
  const helpBtn= root.querySelector<HTMLButtonElement>(".rech-btn-help")!;
  const helpPan= root.querySelector<HTMLElement>(".rech-help-panel")!;
  const closeH = root.querySelector<HTMLButtonElement>(".rech-help-close")!;
  const moreBtn= root.querySelector<HTMLButtonElement>(".rech-btn-more")!;
  const groupSel= root.querySelector<HTMLSelectElement>(".rech-stats-group-by")!;
  const resetBtn= root.querySelector<HTMLButtonElement>(".rech-btn-reset-filter")!;
  const exportBtn= root.querySelector<HTMLButtonElement>(".rech-btn-export")!;

  // Auto-resize textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  // Submit on Enter (Shift+Enter = newline)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _doSearch(root, false); }
  });

  btn.addEventListener("click", () => _doSearch(root, false));
  moreBtn.addEventListener("click", () => _doSearch(root, true));

  helpBtn.addEventListener("click", () => { helpPan.hidden = !helpPan.hidden; });
  closeH.addEventListener("click", () => { helpPan.hidden = true; });

  // Example chips
  root.querySelectorAll<HTMLButtonElement>(".rech-eg").forEach(chip => {
    chip.addEventListener("click", () => {
      input.value = chip.dataset.cql ?? "";
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
  });

  // Stats group-by change
  groupSel.addEventListener("change", () => _renderStats(root));

  // Reset stats filter
  resetBtn.addEventListener("click", () => {
    root.dataset.statsFilter = "";
    root.querySelector<HTMLElement>(".rech-stats-reset")!.hidden = true;
    _renderHits(root, _hits);
    _renderStats(root);
  });

  // Export CSV
  exportBtn.addEventListener("click", () => _doExportCsv(root));
}

// ─── Populate document filter ─────────────────────────────────────────────────

async function _populateDocFilter(root: HTMLElement): Promise<void> {
  if (!_conn) return;
  try {
    const res = await _conn.get("/documents") as {
      documents?: Array<{ doc_id: number; title?: string; language?: string }>;
    };
    const docs = res.documents ?? [];

    // Languages
    const langSel = root.querySelector<HTMLSelectElement>(".rech-filter-lang")!;
    const langs = [...new Set(docs.map(d => d.language ?? "").filter(Boolean))].sort();
    langs.forEach(lang => {
      const opt = document.createElement("option");
      opt.value = lang; opt.textContent = lang;
      langSel.appendChild(opt);
    });

    // Documents
    const docSel = root.querySelector<HTMLSelectElement>(".rech-filter-docs")!;
    // Remove placeholder
    docSel.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = ""; allOpt.textContent = "(tous)"; allOpt.selected = true;
    docSel.appendChild(allOpt);
    docs.forEach(doc => {
      const opt = document.createElement("option");
      opt.value = String(doc.doc_id);
      opt.textContent = doc.title ?? `#${doc.doc_id}`;
      docSel.appendChild(opt);
    });
    // Make it a reasonable height
    docSel.size = Math.min(docs.length + 1, 4);
  } catch { /* non-fatal */ }
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function _doSearch(root: HTMLElement, loadMore: boolean): Promise<void> {
  if (!_conn) { _setStatus(root, "Non connecté.", true); return; }
  if (_loading) return;

  const input    = root.querySelector<HTMLTextAreaElement>(".rech-cql-input")!;
  const langSel  = root.querySelector<HTMLSelectElement>(".rech-filter-lang")!;
  const docSel   = root.querySelector<HTMLSelectElement>(".rech-filter-docs")!;
  const windowSel= root.querySelector<HTMLSelectElement>(".rech-filter-window")!;
  const withinCb = root.querySelector<HTMLInputElement>(".rech-filter-within-s")!;

  let cql = input.value.trim();
  if (!cql) { _setStatus(root, "Saisissez une requête CQL.", true); return; }

  // Inject "within s" suffix if checkbox checked and not already present
  if (withinCb.checked && !cql.includes("within s")) cql += " within s";

  const cqlErr = validateCqlSyntax(cql);
  if (cqlErr) {
    _setStatus(root, `CQL invalide : ${cqlErr} — utilisez des clauses entre crochets, ex. [word = "…"] ou [lemma = "…"].`, true);
    return;
  }

  const language = langSel.value || null;
  const selectedDocIds = Array.from(docSel.selectedOptions)
    .map(o => parseInt(o.value))
    .filter(v => !isNaN(v));
  const doc_ids = selectedDocIds.length > 0 ? selectedDocIds : null;
  const window = parseInt(windowSel.value) || 10;

  const params: _QueryParams = { cql, language, doc_ids, window };

  if (!loadMore) {
    // New query — reset state
    _hits = [];
    _total = 0;
    _offset = 0;
    _lastQuery = params;
    root.dataset.statsFilter = "";
    _renderHits(root, []);
    _renderStats(root);
  } else if (!_lastQuery) {
    return;
  }

  _loading = true;
  _showSpinner(root, true);
  _setStatus(root, "Recherche…", false);

  try {
    const payload: Record<string, unknown> = {
      cql: _lastQuery!.cql,
      mode: "kwic",
      window: _lastQuery!.window,
      limit: PAGE_SIZE,
      offset: _offset,
    };
    if (_lastQuery!.language) payload.language = _lastQuery!.language;
    if (_lastQuery!.doc_ids) payload.doc_ids = _lastQuery!.doc_ids;

    const res = await _conn.post("/token_query", payload) as {
      hits?: _Hit[];
      total?: number;
      has_more?: boolean;
      next_offset?: number | null;
    };

    const newHits = res.hits ?? [];
    _total = res.total ?? (_hits.length + newHits.length);
    _hits = loadMore ? [..._hits, ...newHits] : newHits;
    _offset = res.next_offset ?? _hits.length;

    _renderHits(root, _hits);
    _renderStats(root);
    _updateResultsHeader(root, _total);
    _showLoadMore(root, res.has_more ?? false);
    _setStatus(root, _total === 0 ? "" : `${_total} occurrence${_total > 1 ? "s" : ""}`, false);
    root.querySelector<HTMLElement>(".rech-empty")!.hidden = _hits.length > 0;
  } catch (err) {
    const msg = err instanceof SidecarError ? err.message : String(err);
    _setStatus(root, `Erreur : ${msg}`, true);
  } finally {
    _loading = false;
    _showSpinner(root, false);
  }
}

// ─── Render hits ──────────────────────────────────────────────────────────────

function _renderHits(root: HTMLElement, hits: _Hit[]): void {
  const list = root.querySelector<HTMLElement>(".rech-hits-list")!;
  list.innerHTML = "";

  const statsFilter = root.dataset.statsFilter ?? "";
  const groupBy = root.querySelector<HTMLSelectElement>(".rech-stats-group-by")?.value ?? "lemma";

  const filtered = statsFilter
    ? hits.filter(h => {
        const pivotTokens = _pivotTokens(h);
        return pivotTokens.some(t => {
          const val = groupBy === "lemma" ? (t.lemma ?? t.word)
                    : groupBy === "upos"  ? (t.upos ?? "")
                    : t.word;
          return val === statsFilter;
        });
      })
    : hits;

  for (const hit of filtered) {
    list.appendChild(_buildHitCard(hit));
  }
}

function _pivotTokens(hit: _Hit): _Token[] {
  // The pivot tokens are those within start_position..end_position in context_tokens
  return hit.context_tokens.filter(t =>
    t.position >= hit.start_position && t.position <= hit.end_position
  );
}

function _buildHitCard(hit: _Hit): HTMLElement {
  const card = document.createElement("div");
  card.className = "rech-hit";

  // Header: doc title + position info
  const header = document.createElement("div");
  header.className = "rech-hit-header";
  header.innerHTML =
    `<span class="rech-hit-doc">${_esc(hit.title)}</span>` +
    `<span class="rech-hit-lang">${_esc(hit.language || "")}</span>` +
    `<span class="rech-hit-loc">§ phrase ${hit.sent_id}</span>`;
  card.appendChild(header);

  // Interlinear KWIC row
  const kwicRow = document.createElement("div");
  kwicRow.className = "rech-kwic-row";

  // Split context_tokens into left / pivot / right
  const ctx = hit.context_tokens;
  const pivotStart = hit.start_position;
  const pivotEnd   = hit.end_position;

  const left   = ctx.filter(t => t.position < pivotStart);
  const pivot  = ctx.filter(t => t.position >= pivotStart && t.position <= pivotEnd);
  const right  = ctx.filter(t => t.position > pivotEnd);

  if (left.length)  kwicRow.appendChild(_buildTokenGroup(left, "left"));
  if (pivot.length) kwicRow.appendChild(_buildTokenGroup(pivot, "pivot"));
  if (right.length) kwicRow.appendChild(_buildTokenGroup(right, "right"));

  card.appendChild(kwicRow);
  return card;
}

function _buildTokenGroup(tokens: _Token[], role: "left" | "pivot" | "right"): HTMLElement {
  const group = document.createElement("div");
  group.className = `rech-kwic-group rech-kwic-${role}`;

  for (const tok of tokens) {
    const cell = document.createElement("div");
    cell.className = "rech-kwic-token";

    const wordEl = document.createElement("div");
    wordEl.className = "rech-kwic-word";
    wordEl.textContent = tok.word;

    const uposEl = document.createElement("div");
    uposEl.className = "rech-kwic-upos";
    const col = UPOS_COLORS[tok.upos ?? ""] ?? "#bbb";
    if (tok.upos) {
      uposEl.textContent = tok.upos;
      uposEl.style.background = col + (role === "pivot" ? "30" : "18");
      uposEl.style.color = col;
    }

    const lemmaEl = document.createElement("div");
    lemmaEl.className = "rech-kwic-lemma";
    const lemma = tok.lemma ?? "";
    lemmaEl.textContent = (lemma && lemma.toLowerCase() !== tok.word.toLowerCase()) ? lemma : "";

    cell.appendChild(wordEl);
    cell.appendChild(uposEl);
    cell.appendChild(lemmaEl);
    group.appendChild(cell);
  }

  return group;
}

// ─── Stats panel ──────────────────────────────────────────────────────────────

function _renderStats(root: HTMLElement): void {
  const bars   = root.querySelector<HTMLElement>(".rech-stats-bars")!;
  const groupBy= root.querySelector<HTMLSelectElement>(".rech-stats-group-by")!.value;
  const statsFilter = root.dataset.statsFilter ?? "";

  bars.innerHTML = "";

  if (_hits.length === 0) return;

  // Count pivot token values
  const counts = new Map<string, number>();
  for (const hit of _hits) {
    const pivotToks = _pivotTokens(hit);
    for (const tok of pivotToks) {
      const val = groupBy === "lemma" ? (tok.lemma ?? tok.word)
                : groupBy === "upos"  ? (tok.upos ?? "—")
                : tok.word;
      counts.set(val, (counts.get(val) ?? 0) + 1);
    }
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25);
  const max = sorted[0]?.[1] ?? 1;

  for (const [val, count] of sorted) {
    const pct = (count / max) * 100;
    const isActive = statsFilter === val;

    const row = document.createElement("div");
    row.className = "rech-stats-row" + (isActive ? " active" : "");
    row.title = `${val} — ${count} occurrence${count > 1 ? "s" : ""}`;

    const label = document.createElement("span");
    label.className = "rech-stats-val";
    label.textContent = val;

    const barWrap = document.createElement("div");
    barWrap.className = "rech-stats-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "rech-stats-bar";
    bar.style.width = pct.toFixed(1) + "%";
    if (groupBy === "upos") {
      const col = UPOS_COLORS[val] ?? "#7b3fa0";
      bar.style.background = col;
    }
    barWrap.appendChild(bar);

    const countEl = document.createElement("span");
    countEl.className = "rech-stats-count";
    countEl.textContent = String(count);

    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(countEl);

    row.addEventListener("click", () => {
      if (isActive) {
        root.dataset.statsFilter = "";
        root.querySelector<HTMLElement>(".rech-stats-reset")!.hidden = true;
      } else {
        root.dataset.statsFilter = val;
        root.querySelector<HTMLElement>(".rech-stats-reset")!.hidden = false;
      }
      _renderHits(root, _hits);
      _renderStats(root);
    });

    bars.appendChild(row);
  }
}

// ─── Export CSV ───────────────────────────────────────────────────────────────

async function _doExportCsv(root: HTMLElement): Promise<void> {
  if (!_conn || !_lastQuery) return;
  _setStatus(root, "Export CSV…", false);
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const outPath = await save({
      defaultPath: `token_query_${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!outPath) { _setStatus(root, "", false); return; }

    const payload: Record<string, unknown> = {
      cql: _lastQuery.cql,
      window: _lastQuery.window,
      out_path: outPath,
    };
    if (_lastQuery.language) payload.language = _lastQuery.language;
    if (_lastQuery.doc_ids)  payload.doc_ids  = _lastQuery.doc_ids;

    await _conn.post("/export/token_query_csv", payload);
    _setStatus(root, `✓ Exporté : ${outPath.split(/[\\/]/).pop()}`, false);
  } catch (err) {
    const msg = err instanceof SidecarError ? err.message : String(err);
    _setStatus(root, `✗ Export : ${msg}`, true);
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function _setStatus(root: HTMLElement, msg: string, isError: boolean): void {
  const el = root.querySelector<HTMLElement>(".rech-status-bar");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "var(--color-danger, #c0392b)" : "var(--color-muted, #888)";
}

function _showSpinner(root: HTMLElement, show: boolean): void {
  root.querySelector<HTMLElement>(".rech-spinner")!.hidden = !show;
  root.querySelector<HTMLButtonElement>(".rech-btn-search")!.disabled = show;
}

function _showLoadMore(root: HTMLElement, show: boolean): void {
  root.querySelector<HTMLElement>(".rech-load-more-wrap")!.hidden = !show;
}

function _updateResultsHeader(root: HTMLElement, total: number): void {
  const header = root.querySelector<HTMLElement>(".rech-results-header")!;
  header.hidden = total === 0;
  const label = root.querySelector<HTMLElement>(".rech-total-label")!;
  label.textContent = `${total} occurrence${total > 1 ? "s" : ""}`;
}

function _esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const MODULE_CSS = `
/* ── Root layout ── */
.rech-root {
  display: flex; flex-direction: column; height: 100%;
  font-family: inherit; color: var(--fg, #111);
  background: var(--bg, #f8f8f8);
}

/* ── Toolbar ── */
.rech-toolbar {
  background: var(--bg-card, #fff);
  border-bottom: 1px solid var(--border, #e0e0e0);
  padding: 12px 16px 8px;
  display: flex; flex-direction: column; gap: 8px;
  flex-shrink: 0;
}
.rech-toolbar-top {
  display: flex; align-items: center; gap: 12px;
}
.rech-title {
  font-size: 1rem; font-weight: 700; letter-spacing: -0.01em;
  color: var(--accent, #7b3fa0);
}
.rech-status-bar {
  font-size: 0.8rem; color: var(--color-muted, #888); flex: 1;
}
.rech-toolbar-query {
  display: flex; gap: 8px; align-items: flex-start;
}
.rech-cql-input {
  flex: 1; resize: none; overflow: hidden;
  font-family: "JetBrains Mono", "Fira Mono", monospace;
  font-size: 0.88rem; padding: 7px 10px;
  border: 1px solid var(--border, #ccc); border-radius: 5px;
  background: var(--bg, #fff); color: inherit;
  line-height: 1.5; min-height: 36px;
}
.rech-cql-input:focus { outline: 2px solid var(--accent, #7b3fa0); outline-offset: -1px; }
.rech-btn-search {
  padding: 7px 16px; border-radius: 5px; cursor: pointer;
  background: var(--accent, #7b3fa0); color: #fff;
  border: none; font-size: 0.88rem; font-weight: 600;
  white-space: nowrap;
}
.rech-btn-search:hover:not(:disabled) { filter: brightness(1.1); }
.rech-btn-search:disabled { opacity: 0.5; cursor: default; }
.rech-btn-help {
  padding: 7px 10px; border-radius: 5px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: var(--bg-accent, #f5f5f5); font-size: 0.88rem;
}
.rech-btn-help:hover { background: var(--bg-hover, #ebebeb); }

/* ── Filters ── */
.rech-toolbar-filters {
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
}
.rech-filter-label {
  display: flex; align-items: center; gap: 5px;
  font-size: 0.78rem; color: var(--color-muted, #888);
}
.rech-filter-label select {
  padding: 3px 6px; border: 1px solid var(--border, #ccc);
  border-radius: 4px; font-size: 0.8rem;
  background: var(--bg, #fff); color: inherit;
}
.rech-filter-check {
  display: flex; align-items: center; gap: 5px;
  font-size: 0.78rem; color: var(--color-muted, #888); cursor: pointer;
}

/* ── Example chips ── */
.rech-examples {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.rech-examples-label {
  font-size: 0.73rem; color: var(--color-muted, #aaa); white-space: nowrap;
}
.rech-eg {
  padding: 2px 8px; border-radius: 12px; cursor: pointer;
  border: 1px solid var(--accent, #7b3fa0); font-size: 0.73rem;
  background: transparent; color: var(--accent, #7b3fa0);
  transition: background 0.1s;
}
.rech-eg:hover { background: var(--accent, #7b3fa0); color: #fff; }

/* ── Help panel ── */
.rech-help-panel {
  background: var(--bg-card, #fff);
  border-bottom: 1px solid var(--border, #e0e0e0);
  padding: 16px; position: relative;
}
.rech-help-inner { max-width: 700px; }
.rech-help-close {
  position: absolute; top: 12px; right: 16px;
  background: none; border: none; font-size: 1rem; cursor: pointer;
  color: var(--color-muted, #888);
}
.rech-help-panel h3 { margin: 0 0 12px; font-size: 0.9rem; }
.rech-help-table {
  border-collapse: collapse; font-size: 0.78rem; margin-bottom: 10px; width: 100%;
}
.rech-help-table th {
  text-align: left; padding: 4px 8px;
  border-bottom: 1px solid var(--border, #ddd);
  color: var(--color-muted, #888);
}
.rech-help-table td { padding: 3px 8px; }
.rech-help-table code {
  background: var(--bg-accent, #f0f0f0); padding: 1px 4px;
  border-radius: 3px; font-size: 0.82em;
}
.rech-help-hint { font-size: 0.75rem; color: var(--color-muted, #888); margin: 0; }

/* ── Body: results + stats ── */
.rech-body {
  display: grid; grid-template-columns: 1fr 220px;
  flex: 1; overflow: hidden; min-height: 0;
}
.rech-results {
  overflow-y: auto; padding: 12px 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.rech-results-header {
  display: flex; align-items: center; gap: 12px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border, #eee);
}
.rech-total-label { font-size: 0.82rem; color: var(--color-muted, #888); flex: 1; }
.rech-btn-export {
  padding: 3px 10px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: var(--bg-accent, #f5f5f5); font-size: 0.78rem;
}
.rech-btn-export:hover { background: var(--bg-hover, #ebebeb); }
.rech-spinner {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.85rem; color: var(--color-muted, #888); padding: 16px 0;
}
.rech-spinner-dot {
  display: inline-block; width: 10px; height: 10px; border-radius: 50%;
  background: var(--accent, #7b3fa0);
  animation: rech-pulse 1s ease-in-out infinite;
}
@keyframes rech-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
.rech-empty {
  font-size: 0.85rem; color: var(--color-muted, #888); padding: 24px 0;
  text-align: center;
}
.rech-load-more-wrap { display: flex; justify-content: center; padding: 8px 0; }
.rech-btn-more {
  padding: 6px 20px; border-radius: 5px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: var(--bg-accent, #f5f5f5); font-size: 0.85rem;
}
.rech-btn-more:hover { background: var(--bg-hover, #ebebeb); }

/* ── Hit card ── */
.rech-hit {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border, #e8e8e8);
  border-radius: 6px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.rech-hit-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.75rem; color: var(--color-muted, #999);
}
.rech-hit-doc { font-weight: 600; color: var(--fg, #333); }
.rech-hit-lang {
  padding: 0 5px; border-radius: 3px;
  background: var(--accent, #7b3fa0); color: #fff;
  font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
}
.rech-hit-loc { margin-left: auto; font-style: italic; }

/* ── KWIC row ── */
.rech-kwic-row {
  display: flex; align-items: flex-start; gap: 0;
  overflow-x: auto;
  scrollbar-width: thin; scrollbar-color: #ddd transparent;
}
.rech-kwic-row::-webkit-scrollbar { height: 3px; }
.rech-kwic-row::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

.rech-kwic-group {
  display: flex; flex-wrap: nowrap; gap: 2px;
  padding: 2px 4px;
}
.rech-kwic-left  { opacity: 0.65; }
.rech-kwic-right { opacity: 0.65; }
.rech-kwic-pivot {
  background: #7b3fa011; border-radius: 5px;
  border-left: 2px solid var(--accent, #7b3fa0);
  border-right: 2px solid var(--accent, #7b3fa0);
  padding: 2px 6px;
}

/* ── Token cell (3 rows) ── */
.rech-kwic-token {
  display: flex; flex-direction: column;
  align-items: center; flex-shrink: 0;
  padding: 2px 4px; min-width: 28px;
}
.rech-kwic-word {
  height: 20px; display: flex; align-items: center; justify-content: center;
  font-size: 0.88rem; font-weight: 500; white-space: nowrap;
}
.rech-kwic-upos {
  height: 16px; display: flex; align-items: center; justify-content: center;
  font-size: 0.58rem; font-weight: 700; letter-spacing: 0.04em;
  border-radius: 3px; padding: 0 3px; white-space: nowrap; min-width: 18px;
}
.rech-kwic-lemma {
  height: 14px; display: flex; align-items: center; justify-content: center;
  font-size: 0.67rem; font-style: italic;
  color: var(--color-muted, #999); white-space: nowrap;
}

/* ── Stats panel ── */
.rech-stats-panel {
  border-left: 1px solid var(--border, #e0e0e0);
  overflow-y: auto; padding: 12px;
  background: var(--bg, #f8f8f8);
  display: flex; flex-direction: column; gap: 8px;
}
.rech-stats-header {
  font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--color-muted, #888);
}
.rech-stats-group-row {
  display: flex; align-items: center; gap: 6px; font-size: 0.75rem;
  color: var(--color-muted, #888);
}
.rech-stats-group-by {
  flex: 1; padding: 2px 4px; border: 1px solid var(--border, #ccc);
  border-radius: 3px; font-size: 0.75rem;
  background: var(--bg, #fff); color: inherit;
}
.rech-stats-bars { display: flex; flex-direction: column; gap: 4px; }
.rech-stats-row {
  display: grid; grid-template-columns: 70px 1fr 28px;
  align-items: center; gap: 4px;
  cursor: pointer; border-radius: 3px; padding: 2px 3px;
}
.rech-stats-row:hover { background: var(--bg-hover, #ebebeb); }
.rech-stats-row.active { background: #7b3fa015; }
.rech-stats-val {
  font-size: 0.75rem; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.rech-stats-bar-wrap {
  height: 8px; background: #e8e8e8; border-radius: 4px; overflow: hidden;
}
.rech-stats-bar {
  height: 100%; background: var(--accent, #7b3fa0);
  border-radius: 4px; transition: width 0.2s;
}
.rech-stats-count {
  font-size: 0.68rem; color: var(--color-muted, #aaa); text-align: right;
}
.rech-btn-reset-filter {
  font-size: 0.72rem; padding: 2px 8px; border-radius: 3px; cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: var(--bg-accent, #f5f5f5);
}
.rech-btn-reset-filter:hover { background: var(--bg-hover, #ebebeb); }
`;
