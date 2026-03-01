/**
 * app.ts — Concordancier V0 main application.
 *
 * Renders entirely into #app. No framework — plain TS DOM manipulation for
 * a minimal V0 with zero build overhead.
 *
 * Features:
 *  - Auto-start sidecar on launch (default DB or last-opened DB).
 *  - Search bar with segment/KWIC toggle and window slider.
 *  - Optional aligned/parallel view under hits (include_aligned).
 *  - Filter drawer: language, doc_role, resource_type, doc_id.
 *  - Result list: segment (text + refs) or KWIC (left / match / right).
 *  - Import dialog: choose file, mode, language.
 *  - "Open DB…" button to switch corpus.
 *  - Status indicator: starting / ready / error.
 */

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  type Conn,
  type QueryHit,
  SidecarError,
  ensureRunning,
  importFile,
  query,
  rebuildIndex,
  resetConnection,
  shutdownSidecar,
} from "./lib/sidecarClient";
import {
  getOrCreateDefaultDbPath,
  getCurrentDbPath,
  setCurrentDbPath,
} from "./lib/db";

// ─── State ────────────────────────────────────────────────────────────────────

type Status = "idle" | "starting" | "ready" | "error";

interface AppState {
  status: Status;
  statusMsg: string;
  dbPath: string | null;
  conn: Conn | null;
  hits: QueryHit[];
  isSearching: boolean;
  isImporting: boolean;
  isIndexing: boolean;
  showFilters: boolean;
  // query params
  mode: "segment" | "kwic";
  window: number;
  filterLang: string;
  filterRole: string;
  filterDocId: string;
  showAligned: boolean;
  expandedAlignedUnitIds: Set<number>;
  currentQuery: string;
  pageLimit: number;
  nextOffset: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  total: number | null;
}

const ALIGNED_LIMIT_DEFAULT = 20;
const PAGE_LIMIT_DEFAULT = 50;
const PAGE_LIMIT_ALIGNED = 20;

const state: AppState = {
  status: "idle",
  statusMsg: "",
  dbPath: null,
  conn: null,
  hits: [],
  isSearching: false,
  isImporting: false,
  isIndexing: false,
  showFilters: false,
  mode: "segment",
  window: 10,
  filterLang: "",
  filterRole: "",
  filterDocId: "",
  showAligned: false,
  expandedAlignedUnitIds: new Set<number>(),
  currentQuery: "",
  pageLimit: PAGE_LIMIT_DEFAULT,
  nextOffset: null,
  hasMore: false,
  loadingMore: false,
  total: null,
};

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
:root {
  --brand: #4361ee;
  --brand-dark: #3a56d4;
  --surface: #ffffff;
  --surface2: #f8f9fa;
  --border: #dee2e6;
  --text: #212529;
  --text-muted: #6c757d;
  --danger: #e63946;
  --success: #2dc653;
  --warning: #f4a261;
  --match-bg: #fff3cd;
  --match-color: #664d03;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  background: #f0f2f5;
  color: var(--text);
}

/* ─── Layout ─── */
#app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

.topbar {
  background: var(--brand);
  color: #fff;
  padding: 0 16px;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  box-shadow: 0 2px 4px rgba(0,0,0,.2);
}

.topbar h1 { font-size: 16px; font-weight: 700; margin: 0; letter-spacing: .5px; flex: 1; }

.db-badge {
  font-size: 11px;
  background: rgba(255,255,255,.2);
  padding: 2px 8px;
  border-radius: 12px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}

.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.starting { background: var(--warning); animation: pulse 1s infinite; }
.status-dot.ready    { background: var(--success); }
.status-dot.error    { background: var(--danger); }
.status-dot.idle     { background: rgba(255,255,255,.4); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: .4; }
}

/* ─── Toolbar ─── */
.toolbar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 10px 16px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.search-row {
  display: flex;
  gap: 8px;
  flex: 1;
  min-width: 260px;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  outline: none;
  transition: border-color .15s;
}
.search-input:focus { border-color: var(--brand); }

.btn {
  padding: 8px 14px;
  border: 1.5px solid transparent;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s, color .15s;
  white-space: nowrap;
}

.btn-primary { background: var(--brand); color: #fff; }
.btn-primary:hover { background: var(--brand-dark); }
.btn-primary:disabled { background: #a8b6f7; cursor: not-allowed; }

.btn-secondary { background: var(--surface2); color: var(--text); border-color: var(--border); }
.btn-secondary:hover { background: var(--border); }
.btn-secondary.active { background: var(--brand); color: #fff; border-color: var(--brand); }

.btn-ghost { background: transparent; color: var(--text-muted); border-color: var(--border); }
.btn-ghost:hover { background: var(--surface2); color: var(--text); }

.mode-group { display: flex; gap: 0; }
.mode-group .btn { border-radius: 0; border-right-width: 0; }
.mode-group .btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.mode-group .btn:last-child  { border-radius: 0 var(--radius) var(--radius) 0; border-right-width: 1.5px; }

.window-control {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}
.window-control input[type=range] { width: 80px; accent-color: var(--brand); }
.window-value { min-width: 24px; text-align: right; font-weight: 600; color: var(--text); }

/* ─── Filter drawer ─── */
.filter-drawer {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 10px 16px;
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.filter-drawer.hidden { display: none; }
.filter-group { display: flex; align-items: center; gap: 6px; }
.filter-group label { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
.filter-input {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  width: 100px;
  outline: none;
}
.filter-input:focus { border-color: var(--brand); }
.filter-clear {
  font-size: 11px;
  color: var(--brand);
  cursor: pointer;
  text-decoration: underline;
}

/* ─── Results area ─── */
.results-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted);
  padding: 0 2px;
}

.result-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 14px;
  box-shadow: var(--shadow);
  transition: border-color .15s;
}
.result-card:hover { border-color: var(--brand); }

.result-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 5px;
}
.result-meta .doc-title { font-weight: 600; color: var(--text); }

.result-text {
  font-size: 14px;
  line-height: 1.6;
}

.highlight { background: var(--match-bg); color: var(--match-color); border-radius: 2px; padding: 0 1px; }

/* KWIC layout */
.kwic-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 6px;
  align-items: center;
  font-size: 14px;
  line-height: 1.5;
}
.kwic-left  { text-align: right; color: var(--text-muted); }
.kwic-match { font-weight: 700; background: var(--match-bg); color: var(--match-color); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
.kwic-right { text-align: left; color: var(--text-muted); }

.aligned-toggle {
  min-width: 118px;
}

.aligned-block {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.aligned-empty {
  font-size: 12px;
  color: var(--text-muted);
}

.aligned-group {
  margin-top: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface2);
}

.aligned-group:first-child { margin-top: 0; }

.aligned-group-header {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.aligned-line {
  font-size: 13px;
  line-height: 1.45;
}

.aligned-ref {
  color: var(--text-muted);
  margin-right: 6px;
}

.load-more-wrap {
  display: flex;
  justify-content: center;
  margin-top: 10px;
}

.load-more-btn {
  min-width: 160px;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  gap: 8px;
  padding: 40px;
  text-align: center;
}
.empty-state .icon { font-size: 48px; opacity: .4; }
.empty-state h3 { margin: 0; font-size: 18px; color: var(--text); }
.empty-state p  { margin: 0; font-size: 13px; max-width: 340px; }

.error-banner {
  background: #fff5f5;
  border: 1px solid #ffc9c9;
  border-radius: var(--radius);
  padding: 10px 14px;
  color: var(--danger);
  font-size: 13px;
}

/* ─── Status bar ─── */
.statusbar {
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 4px 16px;
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
  flex-shrink: 0;
}

/* ─── Modal overlay ─── */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal-overlay.hidden { display: none; }

.modal {
  background: var(--surface);
  border-radius: 12px;
  padding: 24px;
  width: 420px;
  max-width: 95vw;
  box-shadow: 0 8px 24px rgba(0,0,0,.2);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.modal h2 { margin: 0; font-size: 18px; }
.modal-body { display: flex; flex-direction: column; gap: 12px; }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-group label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
.form-input, .form-select {
  padding: 8px 10px;
  border: 1.5px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  outline: none;
}
.form-input:focus, .form-select:focus { border-color: var(--brand); }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

.spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(255,255,255,.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .6s linear infinite;
  display: inline-block;
  vertical-align: middle;
}
@keyframes spin { to { transform: rotate(360deg); } }
`;

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function elt<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (string | HTMLElement)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) {
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

function injectStyles(): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ─── Render pieces ────────────────────────────────────────────────────────────

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderAlignedBlock(hit: QueryHit): HTMLElement {
  const block = elt("div", { class: "aligned-block" });
  const aligned = Array.isArray(hit.aligned) ? hit.aligned : [];
  if (aligned.length === 0) {
    block.appendChild(elt("div", { class: "aligned-empty" }, "Aucun alignement"));
    return block;
  }

  const groups = new Map<string, typeof aligned>();
  for (const item of aligned) {
    const key = `${item.doc_id}|${item.language}|${item.title}`;
    const current = groups.get(key);
    if (current) {
      current.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  for (const [key, items] of groups.entries()) {
    const [docId, language, title] = key.split("|");
    const card = elt("div", { class: "aligned-group" });
    card.appendChild(
      elt(
        "div",
        { class: "aligned-group-header" },
        `${language || "und"} · ${title || "(sans titre)"} · doc ${docId}`
      )
    );
    for (const item of items) {
      const row = elt("div", { class: "aligned-line" });
      if (item.external_id != null) {
        row.appendChild(elt("span", { class: "aligned-ref" }, `[${item.external_id}]`));
      }
      const text = item.text ?? item.text_norm ?? "";
      row.appendChild(elt("span", {}, text));
      card.appendChild(row);
    }
    block.appendChild(card);
  }
  return block;
}

function renderHit(hit: QueryHit, mode: "segment" | "kwic", showAligned: boolean): HTMLElement {
  const card = elt("div", { class: "result-card" });

  const meta = elt("div", { class: "result-meta" });
  const titleSpan = elt("span", { class: "doc-title" }, hit.title || "");
  meta.appendChild(titleSpan);
  if (hit.language) meta.appendChild(document.createTextNode(` · ${hit.language}`));
  if (hit.external_id != null) meta.appendChild(document.createTextNode(` · §${hit.external_id}`));
  card.appendChild(meta);

  if (mode === "kwic" && hit.left !== undefined) {
    const row = elt("div", { class: "kwic-row" });
    row.appendChild(elt("span", { class: "kwic-left" }, hit.left ?? ""));
    row.appendChild(elt("span", { class: "kwic-match" }, hit.match ?? ""));
    row.appendChild(elt("span", { class: "kwic-right" }, hit.right ?? ""));
    card.appendChild(row);
  } else {
    const textDiv = elt("div", { class: "result-text" });
    // text may already contain << >> markers from segment mode
    const raw = hit.text ?? hit.text_norm ?? "";
    textDiv.innerHTML = escapeHtml(raw)
      .replace(/&lt;&lt;(.*?)&gt;&gt;/g, '<span class="highlight">$1</span>');
    card.appendChild(textDiv);
  }

  if (showAligned) {
    const expanded = state.expandedAlignedUnitIds.has(hit.unit_id);
    const toggle = elt(
      "button",
      { class: "btn btn-secondary", type: "button" },
      expanded ? "Masquer traductions" : "Afficher traductions"
    ) as HTMLButtonElement;
    toggle.addEventListener("click", () => {
      if (state.expandedAlignedUnitIds.has(hit.unit_id)) {
        state.expandedAlignedUnitIds.delete(hit.unit_id);
      } else {
        state.expandedAlignedUnitIds.add(hit.unit_id);
      }
      renderResults();
    });
    card.appendChild(toggle);
    if (expanded) {
      card.appendChild(renderAlignedBlock(hit));
    }
  }

  return card;
}

function renderResults(): void {
  const hits = state.hits;
  const mode = state.mode;
  const showAligned = state.showAligned;
  const area = document.getElementById("results-area")!;
  area.innerHTML = "";

  if (hits.length === 0) {
    const empty = elt("div", { class: "empty-state" });
    empty.innerHTML = `<div class="icon">🔍</div><h3>Aucun résultat</h3><p>Essayez un autre terme ou ajustez les filtres.</p>`;
    area.appendChild(empty);
    return;
  }

  const header = elt("div", { class: "results-header" });
  const loadedLabel = `${hits.length} résultat${hits.length > 1 ? "s" : ""} chargé${hits.length > 1 ? "s" : ""}`;
  if (typeof state.total === "number") {
    header.textContent = `${loadedLabel} / ${state.total}`;
  } else {
    header.textContent = loadedLabel;
  }
  area.appendChild(header);

  for (const hit of hits) {
    area.appendChild(renderHit(hit, mode, showAligned));
  }

  if (state.hasMore) {
    const wrap = elt("div", { class: "load-more-wrap" });
    const btn = elt(
      "button",
      {
        class: "btn btn-secondary load-more-btn",
        type: "button",
      },
      state.loadingMore ? "Chargement…" : "Charger plus"
    ) as HTMLButtonElement;
    btn.disabled = state.loadingMore;
    btn.addEventListener("click", () => {
      void doLoadMore();
    });
    wrap.appendChild(btn);
    area.appendChild(wrap);
  }

  // Sentinel for IntersectionObserver auto-scroll
  const sentinel = elt("div", {
    id: "scroll-sentinel",
    style: state.hasMore ? "height:1px" : "display:none",
  });
  area.appendChild(sentinel);
  _reobserveSentinel();
}

// ─── IntersectionObserver (auto-scroll load-more) ─────────────────────────────

let _scrollObserver: IntersectionObserver | null = null;

function _reobserveSentinel(): void {
  if (_scrollObserver) {
    _scrollObserver.disconnect();
    _scrollObserver = null;
  }
  const sentinel = document.getElementById("scroll-sentinel");
  if (!sentinel || !state.hasMore) return;

  _scrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && state.hasMore && !state.loadingMore) {
        void doLoadMore();
      }
    },
    { root: document.getElementById("results-area"), threshold: 0.1 }
  );
  _scrollObserver.observe(sentinel);
}

function updateStatus(): void {
  const dot = document.getElementById("status-dot");
  const msg = document.getElementById("status-msg");
  if (dot) {
    dot.className = `status-dot ${state.status}`;
    dot.title = state.statusMsg;
  }
  if (msg) msg.textContent = state.statusMsg || state.status;

  const bar = document.getElementById("statusbar-msg");
  if (bar) {
    bar.textContent = state.dbPath
      ? `DB : ${state.dbPath}  ·  sidecar ${state.status}`
      : "Aucune DB ouverte";
  }

  const dbBadge = document.getElementById("db-badge");
  if (dbBadge) {
    const parts = (state.dbPath ?? "—").split(/[/\\]/);
    dbBadge.textContent = parts[parts.length - 1] ?? "—";
    dbBadge.title = state.dbPath ?? "";
  }
}

// ─── Import modal ─────────────────────────────────────────────────────────────

function showImportModal(): void {
  document.getElementById("import-modal")!.classList.remove("hidden");
}

function hideImportModal(): void {
  document.getElementById("import-modal")!.classList.add("hidden");
  (document.getElementById("import-path-input") as HTMLInputElement).value = "";
}

// ─── Main logic ───────────────────────────────────────────────────────────────

async function doSearch(q: string): Promise<void> {
  state.currentQuery = q.trim();
  state.pageLimit = state.showAligned ? PAGE_LIMIT_ALIGNED : PAGE_LIMIT_DEFAULT;
  state.nextOffset = null;
  state.hasMore = false;
  state.total = null;
  state.loadingMore = false;
  state.hits = [];
  state.expandedAlignedUnitIds.clear();
  if (!state.currentQuery) {
    renderResults();
    return;
  }
  await fetchQueryPage(false);
}

async function doLoadMore(): Promise<void> {
  if (!state.currentQuery || !state.hasMore || state.loadingMore) return;
  await fetchQueryPage(true);
}

async function fetchQueryPage(append: boolean): Promise<void> {
  if (!state.conn || !state.currentQuery) return;

  const offset = append ? (state.nextOffset ?? state.hits.length) : 0;
  const area = document.getElementById("results-area")!;

  if (append) {
    state.loadingMore = true;
    renderResults();
  } else {
    state.isSearching = true;
    (document.getElementById("search-btn") as HTMLButtonElement).disabled = true;
    area.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><h3>Recherche…</h3></div>`;
  }

  try {
    const res = await query(state.conn, {
      q: state.currentQuery,
      mode: state.mode,
      window: state.window,
      language: state.filterLang || undefined,
      doc_role: state.filterRole || undefined,
      doc_id: state.filterDocId ? parseInt(state.filterDocId, 10) : undefined,
      includeAligned: state.showAligned,
      alignedLimit: state.showAligned ? ALIGNED_LIMIT_DEFAULT : undefined,
      limit: state.pageLimit,
      offset,
    });

    const pageHits = Array.isArray(res.hits) ? res.hits : [];
    state.hits = append ? state.hits.concat(pageHits) : pageHits;

    if (typeof res.limit === "number") {
      state.pageLimit = res.limit;
    }
    if (typeof res.total === "number") {
      state.total = res.total;
    } else {
      state.total = null;
    }
    if (typeof res.next_offset === "number") {
      state.nextOffset = res.next_offset;
    } else {
      state.nextOffset = null;
    }
    if (typeof res.has_more === "boolean") {
      state.hasMore = res.has_more;
    } else {
      state.hasMore = state.nextOffset !== null;
    }

    if (state.showAligned && !append) {
      state.expandedAlignedUnitIds = new Set(state.hits.map((h) => h.unit_id));
    } else if (!state.showAligned) {
      state.expandedAlignedUnitIds.clear();
    }

    renderResults();
  } catch (err) {
    const errDiv = elt("div", { class: "error-banner" });
    errDiv.textContent = `Erreur : ${err instanceof SidecarError ? err.message : String(err)}`;
    if (append && state.hits.length > 0) {
      renderResults();
      area.prepend(errDiv);
    } else {
      area.innerHTML = "";
      area.appendChild(errDiv);
    }
  } finally {
    if (append) {
      state.loadingMore = false;
      renderResults();
    } else {
      state.isSearching = false;
      (document.getElementById("search-btn") as HTMLButtonElement).disabled = false;
    }
  }
}

async function doImport(
  filePath: string,
  mode: string,
  language: string,
  title: string
): Promise<void> {
  if (!state.conn) return;
  state.isImporting = true;
  const btn = document.getElementById("import-confirm-btn") as HTMLButtonElement;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Import…`;

  try {
    await importFile(state.conn, {
      mode: mode as "docx_numbered_lines" | "txt_numbered_lines" | "docx_paragraphs" | "tei",
      path: filePath,
      language: language || undefined,
      title: title || undefined,
    });
    // Auto-index after import
    await rebuildIndex(state.conn);
    hideImportModal();
    updateStatus();
    // Show index notice
    const notice = elt("div", { class: "error-banner" });
    notice.style.background = "#f0fff4";
    notice.style.borderColor = "#b2f2bb";
    notice.style.color = "#2dc653";
    notice.textContent = "Import + indexation réussis. Lancez une recherche.";
    const area = document.getElementById("results-area")!;
    area.innerHTML = "";
    area.appendChild(notice);
  } catch (err) {
    const errMsg = elt("p", { style: "color:var(--danger);font-size:13px;margin:0;" });
    errMsg.textContent = `Erreur : ${err instanceof SidecarError ? err.message : String(err)}`;
    document.getElementById("import-modal-error")!.replaceChildren(errMsg);
  } finally {
    state.isImporting = false;
    btn.disabled = false;
    btn.textContent = "Importer";
  }
}

async function doOpenDb(): Promise<void> {
  const selected = await openDialog({
    title: "Ouvrir un corpus (fichier .db)",
    filters: [{ name: "SQLite DB", extensions: ["db"] }],
    multiple: false,
  });
  if (!selected || Array.isArray(selected)) return;
  const newPath = selected;

  // Shutdown existing sidecar if any
  if (state.conn) {
    await shutdownSidecar(state.conn);
  }
  resetConnection();
  state.conn = null;
  setCurrentDbPath(newPath);
  state.dbPath = newPath;
  await startSidecar(newPath);
}

async function startSidecar(dbPath: string): Promise<void> {
  state.status = "starting";
  state.statusMsg = "Démarrage du sidecar…";
  updateStatus();

  try {
    const conn = await ensureRunning(dbPath);
    state.conn = conn;
    state.status = "ready";
    state.statusMsg = "Sidecar prêt";
    updateStatus();
    showReadyState();
  } catch (err) {
    state.status = "error";
    state.statusMsg =
      err instanceof SidecarError ? err.message : String(err);
    updateStatus();
    const area = document.getElementById("results-area");
    if (area) {
      area.innerHTML = "";
      const errDiv = elt("div", { class: "error-banner" });
      errDiv.textContent = `Impossible de démarrer le sidecar : ${state.statusMsg}`;
      area.appendChild(errDiv);
    }
  }
}

function showReadyState(): void {
  const area = document.getElementById("results-area")!;
  area.innerHTML = "";
  const empty = elt("div", { class: "empty-state" });
  empty.innerHTML = `<div class="icon">📖</div><h3>Sidecar prêt</h3><p>Tapez un terme dans la barre de recherche pour interroger le corpus.</p>`;
  area.appendChild(empty);
}

// ─── Build DOM ────────────────────────────────────────────────────────────────

function buildUI(container: HTMLElement): void {
  injectStyles();

  // ── Topbar ──
  const topbar = elt("div", { class: "topbar" });
  topbar.appendChild(elt("h1", {}, "Concordancier"));
  const dbBadge = elt("span", { class: "db-badge", id: "db-badge" }, "—");
  topbar.appendChild(dbBadge);
  const statusDot = elt("span", { class: "status-dot idle", id: "status-dot" });
  topbar.appendChild(statusDot);

  // ── Toolbar ──
  const toolbar = elt("div", { class: "toolbar" });

  // Search row
  const searchRow = elt("div", { class: "search-row" });
  const searchInput = elt("input", {
    type: "text",
    class: "search-input",
    id: "search-input",
    placeholder: "Rechercher dans le corpus (FTS5)…",
    autocomplete: "off",
  }) as HTMLInputElement;
  const searchBtn = elt("button", { class: "btn btn-primary", id: "search-btn", disabled: "disabled" }, "Chercher");
  searchRow.appendChild(searchInput);
  searchRow.appendChild(searchBtn);
  toolbar.appendChild(searchRow);

  // Mode toggle
  const modeGroup = elt("div", { class: "mode-group" });
  const segBtn = elt("button", { class: "btn btn-secondary active", id: "mode-seg" }, "Segment");
  const kwicBtn = elt("button", { class: "btn btn-secondary", id: "mode-kwic" }, "KWIC");
  modeGroup.appendChild(segBtn);
  modeGroup.appendChild(kwicBtn);
  toolbar.appendChild(modeGroup);

  const alignedToggleBtn = elt(
    "button",
    { class: "btn btn-secondary aligned-toggle", id: "aligned-toggle-btn", type: "button" },
    "Alignés: off"
  ) as HTMLButtonElement;
  toolbar.appendChild(alignedToggleBtn);

  // Window slider (hidden by default)
  const windowCtrl = elt("div", { class: "window-control", id: "window-ctrl", style: "display:none" });
  windowCtrl.appendChild(document.createTextNode("Fenêtre "));
  const rangeInput = elt("input", { type: "range", min: "3", max: "25", value: "10", id: "window-range" }) as HTMLInputElement;
  const windowValue = elt("span", { class: "window-value", id: "window-value" }, "10");
  windowCtrl.appendChild(rangeInput);
  windowCtrl.appendChild(windowValue);
  toolbar.appendChild(windowCtrl);

  // Filter + Import + OpenDB buttons
  const filterBtn = elt("button", { class: "btn btn-ghost", id: "filter-btn" }, "⚙ Filtres");
  const importBtn = elt("button", { class: "btn btn-ghost", id: "import-btn" }, "⬆ Importer…");
  const openDbBtn = elt("button", { class: "btn btn-ghost", id: "open-db-btn" }, "📂 Ouvrir DB…");
  toolbar.appendChild(filterBtn);
  toolbar.appendChild(importBtn);
  toolbar.appendChild(openDbBtn);

  // ── Filter drawer ──
  const filterDrawer = elt("div", { class: "filter-drawer hidden", id: "filter-drawer" });
  const fg1 = elt("div", { class: "filter-group" });
  fg1.appendChild(elt("label", {}, "Langue"));
  fg1.appendChild(elt("input", { type: "text", class: "filter-input", id: "filter-lang", placeholder: "fr, en…" }));
  const fg2 = elt("div", { class: "filter-group" });
  fg2.appendChild(elt("label", {}, "Rôle"));
  fg2.appendChild(elt("input", { type: "text", class: "filter-input", id: "filter-role", placeholder: "original…" }));
  const fg3 = elt("div", { class: "filter-group" });
  fg3.appendChild(elt("label", {}, "Doc ID"));
  fg3.appendChild(elt("input", { type: "number", class: "filter-input", id: "filter-docid", placeholder: "1" }));
  const clearBtn = elt("span", { class: "filter-clear", id: "filter-clear" }, "Effacer tout");
  filterDrawer.appendChild(fg1);
  filterDrawer.appendChild(fg2);
  filterDrawer.appendChild(fg3);
  filterDrawer.appendChild(clearBtn);

  // ── Results area ──
  const resultsArea = elt("div", { class: "results-area", id: "results-area" });
  const empty = elt("div", { class: "empty-state" });
  empty.innerHTML = `<div class="icon">⏳</div><h3>Démarrage…</h3><p>Connexion au sidecar en cours.</p>`;
  resultsArea.appendChild(empty);

  // ── Status bar ──
  const statusbar = elt("div", { class: "statusbar" });
  statusbar.appendChild(elt("span", { id: "statusbar-msg" }, "Initialisation…"));
  statusbar.appendChild(elt("span", { id: "status-msg" }, "idle"));

  // ── Import modal ──
  const importModal = elt("div", { class: "modal-overlay hidden", id: "import-modal" });
  const modal = elt("div", { class: "modal" });
  modal.appendChild(elt("h2", {}, "Importer un document"));
  const modalBody = elt("div", { class: "modal-body" });

  const pathGroup = elt("div", { class: "form-group" });
  pathGroup.appendChild(elt("label", {}, "Fichier source"));
  const pathRow = elt("div", { style: "display:flex;gap:8px" });
  const pathInput = elt("input", { type: "text", class: "form-input", id: "import-path-input", placeholder: "/chemin/vers/fichier.docx", style: "flex:1" }) as HTMLInputElement;
  const browseBtn = elt("button", { class: "btn btn-secondary", id: "import-browse-btn" }, "Parcourir…");
  pathRow.appendChild(pathInput);
  pathRow.appendChild(browseBtn);
  pathGroup.appendChild(pathRow);
  modalBody.appendChild(pathGroup);

  const modeGroup2 = elt("div", { class: "form-group" });
  modeGroup2.appendChild(elt("label", {}, "Mode d'import"));
  const modeSelect = elt("select", { class: "form-select", id: "import-mode-select" }) as HTMLSelectElement;
  for (const [val, lbl] of [
    ["docx_numbered_lines", "DOCX lignes numérotées [n]"],
    ["docx_paragraphs", "DOCX paragraphes"],
    ["txt_numbered_lines", "TXT lignes numérotées"],
    ["tei", "TEI XML"],
  ]) {
    modeSelect.appendChild(elt("option", { value: val }, lbl));
  }
  modeGroup2.appendChild(modeSelect);
  modalBody.appendChild(modeGroup2);

  const langGroup = elt("div", { class: "form-group" });
  langGroup.appendChild(elt("label", {}, "Langue (code ISO)"));
  langGroup.appendChild(elt("input", { type: "text", class: "form-input", id: "import-lang-input", placeholder: "fr" }));
  modalBody.appendChild(langGroup);

  const titleGroup = elt("div", { class: "form-group" });
  titleGroup.appendChild(elt("label", {}, "Titre (optionnel)"));
  titleGroup.appendChild(elt("input", { type: "text", class: "form-input", id: "import-title-input", placeholder: "Mon corpus" }));
  modalBody.appendChild(titleGroup);

  const modalError = elt("div", { id: "import-modal-error" });
  modalBody.appendChild(modalError);

  modal.appendChild(modalBody);

  const modalActions = elt("div", { class: "modal-actions" });
  const cancelBtn = elt("button", { class: "btn btn-secondary", id: "import-cancel-btn" }, "Annuler");
  const confirmBtn = elt("button", { class: "btn btn-primary", id: "import-confirm-btn" }, "Importer");
  modalActions.appendChild(cancelBtn);
  modalActions.appendChild(confirmBtn);
  modal.appendChild(modalActions);
  importModal.appendChild(modal);

  // ── Assemble ──
  container.appendChild(topbar);
  container.appendChild(toolbar);
  container.appendChild(filterDrawer);
  container.appendChild(resultsArea);
  container.appendChild(statusbar);
  container.appendChild(importModal);

  // ── Event listeners ──

  const refreshAlignedToggle = (): void => {
    alignedToggleBtn.textContent = state.showAligned ? "Alignés: on" : "Alignés: off";
    alignedToggleBtn.classList.toggle("active", state.showAligned);
  };
  refreshAlignedToggle();

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void doSearch(searchInput.value);
  });
  searchBtn.addEventListener("click", () => void doSearch(searchInput.value));

  segBtn.addEventListener("click", () => {
    state.mode = "segment";
    segBtn.classList.add("active");
    kwicBtn.classList.remove("active");
    (document.getElementById("window-ctrl") as HTMLElement).style.display = "none";
  });
  kwicBtn.addEventListener("click", () => {
    state.mode = "kwic";
    kwicBtn.classList.add("active");
    segBtn.classList.remove("active");
    (document.getElementById("window-ctrl") as HTMLElement).style.display = "flex";
  });

  rangeInput.addEventListener("input", () => {
    state.window = parseInt(rangeInput.value, 10);
    windowValue.textContent = rangeInput.value;
  });

  alignedToggleBtn.addEventListener("click", () => {
    state.showAligned = !state.showAligned;
    if (!state.showAligned) {
      state.expandedAlignedUnitIds.clear();
    }
    refreshAlignedToggle();
    const q = searchInput.value.trim();
    if (q) {
      void doSearch(q);
    } else {
      renderResults();
    }
  });

  filterBtn.addEventListener("click", () => {
    state.showFilters = !state.showFilters;
    filterDrawer.classList.toggle("hidden", !state.showFilters);
    filterBtn.classList.toggle("active", state.showFilters);
  });

  (document.getElementById("filter-lang")! as HTMLInputElement).addEventListener("input", (e) => {
    state.filterLang = (e.target as HTMLInputElement).value.trim();
  });
  (document.getElementById("filter-role")! as HTMLInputElement).addEventListener("input", (e) => {
    state.filterRole = (e.target as HTMLInputElement).value.trim();
  });
  (document.getElementById("filter-docid")! as HTMLInputElement).addEventListener("input", (e) => {
    state.filterDocId = (e.target as HTMLInputElement).value.trim();
  });
  document.getElementById("filter-clear")!.addEventListener("click", () => {
    state.filterLang = "";
    state.filterRole = "";
    state.filterDocId = "";
    (document.getElementById("filter-lang") as HTMLInputElement).value = "";
    (document.getElementById("filter-role") as HTMLInputElement).value = "";
    (document.getElementById("filter-docid") as HTMLInputElement).value = "";
  });

  importBtn.addEventListener("click", () => {
    if (state.status !== "ready") return;
    showImportModal();
  });
  openDbBtn.addEventListener("click", () => void doOpenDb());

  cancelBtn.addEventListener("click", hideImportModal);
  importModal.addEventListener("click", (e) => {
    if (e.target === importModal) hideImportModal();
  });

  browseBtn.addEventListener("click", async () => {
    const sel = await openDialog({
      title: "Choisir un fichier à importer",
      filters: [
        { name: "DOCX / TXT / TEI", extensions: ["docx", "txt", "xml"] },
        { name: "Tous les fichiers", extensions: ["*"] },
      ],
      multiple: false,
    });
    if (sel && !Array.isArray(sel)) {
      (document.getElementById("import-path-input") as HTMLInputElement).value = sel;
    }
  });

  confirmBtn.addEventListener("click", () => {
    const filePath = (document.getElementById("import-path-input") as HTMLInputElement).value.trim();
    const mode = (document.getElementById("import-mode-select") as HTMLSelectElement).value;
    const lang = (document.getElementById("import-lang-input") as HTMLInputElement).value.trim();
    const title = (document.getElementById("import-title-input") as HTMLInputElement).value.trim();
    if (!filePath) {
      document.getElementById("import-modal-error")!.innerHTML =
        `<p style="color:var(--danger);font-size:13px;margin:0;">Veuillez sélectionner un fichier.</p>`;
      return;
    }
    document.getElementById("import-modal-error")!.innerHTML = "";
    void doImport(filePath, mode, lang, title);
  });
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

export async function initApp(container: HTMLElement): Promise<void> {
  buildUI(container);

  const dbPath = await getOrCreateDefaultDbPath();
  state.dbPath = dbPath;
  updateStatus();

  // Enable search button once sidecar is ready (done in startSidecar callback)
  await startSidecar(dbPath);

  if (state.status === "ready") {
    (document.getElementById("search-btn") as HTMLButtonElement).disabled = false;
    searchInput?.focus();
  }
}

// Helper to focus search input after init
const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
