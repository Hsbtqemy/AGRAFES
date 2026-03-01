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
  type DocumentRecord,
  SidecarError,
  ensureRunning,
  importFile,
  listDocuments,
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
  docs: DocumentRecord[];
  isSearching: boolean;
  isImporting: boolean;
  isIndexing: boolean;
  showFilters: boolean;
  showBuilder: boolean;
  // query params
  mode: "segment" | "kwic";
  window: number;
  filterLang: string;
  filterRole: string;
  filterDocId: string;
  filterResourceType: string;
  showAligned: boolean;
  expandedAlignedUnitIds: Set<number>;
  currentQuery: string;
  pageLimit: number;
  nextOffset: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  total: number | null;
  // query builder
  builderMode: "simple" | "phrase" | "and" | "or" | "near";
  nearN: number;
  // parallel KWIC (V2.3)
  showParallel: boolean;
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
  docs: [],
  isSearching: false,
  isImporting: false,
  isIndexing: false,
  showFilters: false,
  showBuilder: false,
  mode: "segment",
  window: 10,
  filterLang: "",
  filterRole: "",
  filterDocId: "",
  filterResourceType: "",
  showAligned: false,
  expandedAlignedUnitIds: new Set<number>(),
  currentQuery: "",
  pageLimit: PAGE_LIMIT_DEFAULT,
  nextOffset: null,
  hasMore: false,
  loadingMore: false,
  total: null,
  builderMode: "simple",
  nearN: 5,
  showParallel: false,
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
  /* CSS virtual list: browser skips layout/paint for off-screen cards */
  content-visibility: auto;
  contain-intrinsic-size: auto 160px;
}
.result-card:hover { border-color: var(--brand); }

.virt-top-info {
  padding: 6px 10px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  background: var(--surface-alt, #f8f8f8);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 4px;
}

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

/* ─── Query builder panel (V2.2) ─── */
.builder-panel {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 8px 16px;
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.builder-panel.hidden { display: none; }
.builder-group { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.builder-group label { color: var(--text-muted); white-space: nowrap; }
.builder-radio { display: flex; gap: 4px; }
.builder-radio label {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 7px;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
  user-select: none;
}
.builder-radio label:has(input:checked) {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
}
.builder-radio input[type=radio] { display: none; }
.near-n-ctrl { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-muted); }
.near-n-ctrl input { width: 44px; padding: 2px 5px; border: 1px solid var(--border); border-radius: 4px; font-size: 11px; }
.filter-select { padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px; outline: none; }
.filter-select:focus { border-color: var(--brand); }
.builder-warn { font-size: 11px; color: var(--warning, #d97706); background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; padding: 3px 8px; margin-top: 4px; }

/* ─── Parallel KWIC (V2.3) ─── */
.parallel-card { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 8px; }
.parallel-pivot { background: var(--surface); padding: 8px 10px; border-right: 1px solid var(--border); }
.parallel-aligned { background: var(--surface2); padding: 8px 10px; }
.parallel-pivot .result-meta,
.parallel-aligned .parallel-lang-header { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.parallel-aligned-group { margin-bottom: 6px; }
.parallel-aligned-group:last-child { margin-bottom: 0; }
.parallel-lang-header { font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 2px; }
.parallel-line { font-size: 13px; line-height: 1.45; }
.parallel-more-btn { font-size: 11px; color: var(--brand); cursor: pointer; background: none; border: none; padding: 0; }
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

// ─── Sprint 2.3 — Parallel KWIC ──────────────────────────────────────────────

const PARALLEL_COLLAPSE_N = 5;

/** Maximum number of hit cards to keep in DOM at any time (JS-layer virtual list). */
const VIRT_DOM_CAP = 150;

/**
 * Render a hit in parallel two-column layout:
 * left = pivot (hit), right = aligned segments grouped by language+doc.
 */
function renderParallelHit(hit: QueryHit, mode: "segment" | "kwic"): HTMLElement {
  const card = elt("div", { class: "parallel-card" });

  // ── Pivot column ──
  const pivotCol = elt("div", { class: "parallel-pivot" });
  const meta = elt("div", { class: "result-meta" });
  const titleSpan = elt("span", { class: "doc-title" }, hit.title || "");
  meta.appendChild(titleSpan);
  if (hit.language) meta.appendChild(document.createTextNode(` · ${hit.language}`));
  if (hit.external_id != null) meta.appendChild(document.createTextNode(` · §${hit.external_id}`));
  pivotCol.appendChild(meta);

  if (mode === "kwic" && hit.left !== undefined) {
    const row = elt("div", { class: "kwic-row" });
    row.appendChild(elt("span", { class: "kwic-left" }, hit.left ?? ""));
    row.appendChild(elt("span", { class: "kwic-match" }, hit.match ?? ""));
    row.appendChild(elt("span", { class: "kwic-right" }, hit.right ?? ""));
    pivotCol.appendChild(row);
  } else {
    const textDiv = elt("div", { class: "result-text" });
    const raw = hit.text ?? hit.text_norm ?? "";
    textDiv.innerHTML = escapeHtml(raw)
      .replace(/&lt;&lt;(.*?)&gt;&gt;/g, '<span class="highlight">$1</span>');
    pivotCol.appendChild(textDiv);
  }
  card.appendChild(pivotCol);

  // ── Aligned column ──
  const alignedCol = elt("div", { class: "parallel-aligned" });
  const aligned = Array.isArray(hit.aligned) ? hit.aligned : [];

  if (aligned.length === 0) {
    alignedCol.appendChild(elt("div", { class: "aligned-empty" }, "Aucun alignement"));
  } else {
    const groups = new Map<string, typeof aligned>();
    for (const item of aligned) {
      const key = `${item.language ?? "und"}|${item.doc_id}|${item.title ?? ""}`;
      const cur = groups.get(key);
      if (cur) cur.push(item); else groups.set(key, [item]);
    }
    for (const [key, items] of groups.entries()) {
      const [lang, , title] = key.split("|");
      const grp = elt("div", { class: "parallel-aligned-group" });
      grp.appendChild(elt("div", { class: "parallel-lang-header" }, `${lang} · ${title || "(sans titre)"}`));
      const visible = items.slice(0, PARALLEL_COLLAPSE_N);
      const hidden = items.slice(PARALLEL_COLLAPSE_N);
      for (const item of visible) {
        const row = elt("div", { class: "parallel-line" });
        if (item.external_id != null) row.appendChild(elt("span", { class: "aligned-ref" }, `[${item.external_id}] `));
        row.appendChild(document.createTextNode(item.text ?? item.text_norm ?? ""));
        grp.appendChild(row);
      }
      if (hidden.length > 0) {
        const moreWrap = elt("div", {});
        const moreBtn = elt("button", { class: "parallel-more-btn" }, `Voir ${hidden.length} de plus…`) as HTMLButtonElement;
        moreBtn.addEventListener("click", () => {
          for (const item of hidden) {
            const row = elt("div", { class: "parallel-line" });
            if (item.external_id != null) row.appendChild(elt("span", { class: "aligned-ref" }, `[${item.external_id}] `));
            row.appendChild(document.createTextNode(item.text ?? item.text_norm ?? ""));
            grp.insertBefore(row, moreWrap);
          }
          moreWrap.remove();
        });
        moreWrap.appendChild(moreBtn);
        grp.appendChild(moreWrap);
      }
      alignedCol.appendChild(grp);
    }
  }
  card.appendChild(alignedCol);
  return card;
}

function renderHit(hit: QueryHit, mode: "segment" | "kwic", showAligned: boolean): HTMLElement {
  // Parallel mode: show aligned content always visible alongside pivot
  if (showAligned && state.showParallel) {
    return renderParallelHit(hit, mode);
  }

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

  // JS-layer virtual list: cap DOM nodes at VIRT_DOM_CAP to prevent layout thrash
  // on large result sets. Oldest hits are omitted from DOM (still in state.hits).
  const hiddenCount = Math.max(0, hits.length - VIRT_DOM_CAP);
  if (hiddenCount > 0) {
    const info = elt("div", { class: "virt-top-info" });
    info.textContent = `▲ ${hiddenCount} résultat${hiddenCount > 1 ? "s" : ""} précédent${hiddenCount > 1 ? "s" : ""} non affiché${hiddenCount > 1 ? "s" : ""} (${hits.length} chargé${hits.length > 1 ? "s" : ""} au total)`;
    area.appendChild(info);
  }
  const visibleHits = hiddenCount > 0 ? hits.slice(hiddenCount) : hits;

  for (const hit of visibleHits) {
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

// ─── Query builder ───────────────────────────────────────────────────────────

/**
 * Detect if raw input already looks like an FTS5 expression (operators/quotes present).
 * When true, skip builder transformation and pass through as-is.
 */
export function isSimpleInput(raw: string): boolean {
  return /\b(AND|OR|NOT|NEAR)\b|"/.test(raw.trim());
}

/** Show a transient warning below the builder panel. */
function _showBuilderWarn(msg: string): void {
  const el = document.getElementById("builder-warn");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; el.textContent = ""; }, 4000);
}

/**
 * Build a FTS5 query string from raw input + builder mode.
 * - simple: pass through as-is
 * - phrase: wrap in double quotes (escapes internal quotes to single-quote)
 * - and:    join tokens with AND
 * - or:     join tokens with OR
 * - near:   NEAR(t1 t2 …, N) — requires ≥2 tokens
 *
 * Safety: if raw already contains FTS operators/quotes, bypass transformation.
 */
export function buildFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  const mode = state.builderMode;
  if (mode === "simple") return trimmed;

  // Guard: if input already looks like a hand-crafted FTS query, skip transformation
  if (isSimpleInput(trimmed)) {
    _showBuilderWarn("Requête FTS détectée — transformation annulée (mode simple forcé).");
    return trimmed;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";

  if (mode === "phrase") {
    // Escape any internal double-quotes to avoid malformed FTS phrase
    const escaped = trimmed.replace(/"/g, "'");
    return `"${escaped}"`;
  }
  if (mode === "and") return tokens.join(" AND ");
  if (mode === "or") return tokens.join(" OR ");
  if (mode === "near") {
    if (tokens.length < 2) {
      _showBuilderWarn("NEAR requiert au moins 2 mots. Requête passée telle quelle.");
      return tokens[0] ?? "";
    }
    return `NEAR(${tokens.join(" ")}, ${state.nearN})`;
  }
  return trimmed;
}

/** Load documents into state.docs and populate filter dropdowns. */
async function loadDocsForFilters(): Promise<void> {
  if (!state.conn) return;
  try {
    state.docs = await listDocuments(state.conn);
    _populateFilterDropdowns();
  } catch {
    // non-critical — filters stay free-text
  }
}

function _populateFilterDropdowns(): void {
  const langs = [...new Set(state.docs.map(d => d.language).filter(Boolean))].sort();
  const roles = [...new Set(state.docs.map(d => d.doc_role).filter((r): r is string => r != null))].sort();
  const resTypes = [...new Set(state.docs.map(d => d.resource_type).filter((r): r is string => r != null))].sort();

  _fillSelect("filter-lang-sel", langs, state.filterLang);
  _fillSelect("filter-role-sel", roles, state.filterRole);
  _fillSelect("filter-restype-sel", resTypes, state.filterResourceType);
}

function _fillSelect(id: string, values: string[], currentVal: string): void {
  const sel = document.getElementById(id) as HTMLSelectElement | null;
  if (!sel) return;
  const prev = sel.value || currentVal;
  sel.innerHTML = `<option value="">Tous</option>`;
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    if (v === prev) opt.selected = true;
    sel.appendChild(opt);
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

async function doSearch(rawQ: string): Promise<void> {
  state.currentQuery = buildFtsQuery(rawQ);
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
      resource_type: state.filterResourceType || undefined,
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
  // Populate filter dropdowns from document list
  void loadDocsForFilters();
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

  const parallelToggleBtn = elt(
    "button",
    { class: "btn btn-secondary", id: "parallel-toggle-btn", type: "button", style: "display:none" },
    "Parallèle: off"
  ) as HTMLButtonElement;
  toolbar.appendChild(parallelToggleBtn);

  // Window slider (hidden by default)
  const windowCtrl = elt("div", { class: "window-control", id: "window-ctrl", style: "display:none" });
  windowCtrl.appendChild(document.createTextNode("Fenêtre "));
  const rangeInput = elt("input", { type: "range", min: "3", max: "25", value: "10", id: "window-range" }) as HTMLInputElement;
  const windowValue = elt("span", { class: "window-value", id: "window-value" }, "10");
  windowCtrl.appendChild(rangeInput);
  windowCtrl.appendChild(windowValue);
  toolbar.appendChild(windowCtrl);

  // Filter + Builder + Import + OpenDB buttons
  const filterBtn = elt("button", { class: "btn btn-ghost", id: "filter-btn" }, "⚙ Filtres");
  const builderBtn = elt("button", { class: "btn btn-ghost", id: "builder-btn" }, "✏ Requête");
  const importBtn = elt("button", { class: "btn btn-ghost", id: "import-btn" }, "⬆ Importer…");
  const openDbBtn = elt("button", { class: "btn btn-ghost", id: "open-db-btn" }, "📂 Ouvrir DB…");
  toolbar.appendChild(filterBtn);
  toolbar.appendChild(builderBtn);
  toolbar.appendChild(importBtn);
  toolbar.appendChild(openDbBtn);

  // ── Filter drawer (dropdowns from /documents) ──
  const filterDrawer = elt("div", { class: "filter-drawer hidden", id: "filter-drawer" });

  const fg1 = elt("div", { class: "filter-group" });
  fg1.appendChild(elt("label", {}, "Langue"));
  const langSel = elt("select", { class: "filter-select", id: "filter-lang-sel" }) as HTMLSelectElement;
  langSel.innerHTML = `<option value="">Tous</option>`;
  fg1.appendChild(langSel);

  const fg2 = elt("div", { class: "filter-group" });
  fg2.appendChild(elt("label", {}, "Rôle"));
  const roleSel = elt("select", { class: "filter-select", id: "filter-role-sel" }) as HTMLSelectElement;
  roleSel.innerHTML = `<option value="">Tous</option>`;
  fg2.appendChild(roleSel);

  const fg2b = elt("div", { class: "filter-group" });
  fg2b.appendChild(elt("label", {}, "Type ressource"));
  const restypeSel = elt("select", { class: "filter-select", id: "filter-restype-sel" }) as HTMLSelectElement;
  restypeSel.innerHTML = `<option value="">Tous</option>`;
  fg2b.appendChild(restypeSel);

  const fg3 = elt("div", { class: "filter-group" });
  fg3.appendChild(elt("label", {}, "Doc ID"));
  fg3.appendChild(elt("input", { type: "number", class: "filter-input", id: "filter-docid", placeholder: "1" }));

  const clearBtn = elt("span", { class: "filter-clear", id: "filter-clear" }, "Effacer tout");
  filterDrawer.appendChild(fg1);
  filterDrawer.appendChild(fg2);
  filterDrawer.appendChild(fg2b);
  filterDrawer.appendChild(fg3);
  filterDrawer.appendChild(clearBtn);

  // ── Query builder panel ──
  const builderPanel = elt("div", { class: "builder-panel hidden", id: "builder-panel" });

  // Mode radio
  const modeGrp = elt("div", { class: "builder-group" });
  modeGrp.appendChild(elt("label", {}, "Mode :"));
  const radioWrap = elt("div", { class: "builder-radio" });
  for (const [val, lbl] of [
    ["simple", "Simple"],
    ["phrase", "Expression exacte"],
    ["and", "ET (AND)"],
    ["or", "OU (OR)"],
    ["near", "NEAR"],
  ] as const) {
    const lbEl = document.createElement("label");
    const inp = elt("input", { type: "radio", name: "builder-mode", value: val }) as HTMLInputElement;
    if (val === "simple") inp.checked = true;
    inp.addEventListener("change", () => {
      state.builderMode = val;
      (document.getElementById("near-n-ctrl") as HTMLElement).style.display = val === "near" ? "flex" : "none";
    });
    lbEl.appendChild(inp);
    lbEl.appendChild(document.createTextNode(lbl));
    radioWrap.appendChild(lbEl);
  }
  modeGrp.appendChild(radioWrap);
  builderPanel.appendChild(modeGrp);

  // NEAR N control
  const nearCtrl = elt("div", { class: "near-n-ctrl", id: "near-n-ctrl", style: "display:none" });
  nearCtrl.appendChild(document.createTextNode("N ="));
  const nearInput = elt("input", { type: "number", min: "1", max: "50", value: "5", id: "near-n-input" }) as HTMLInputElement;
  nearInput.addEventListener("input", () => {
    state.nearN = Math.max(1, parseInt(nearInput.value, 10) || 5);
  });
  nearCtrl.appendChild(nearInput);
  builderPanel.appendChild(nearCtrl);

  // Builder warning (shown on bypass or NEAR<2)
  const builderWarn = elt("div", { id: "builder-warn", class: "builder-warn", style: "display:none" });
  builderPanel.appendChild(builderWarn);

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
  container.appendChild(builderPanel);
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

  const refreshParallelToggle = (): void => {
    parallelToggleBtn.textContent = state.showParallel ? "Parallèle: on" : "Parallèle: off";
    parallelToggleBtn.classList.toggle("active", state.showParallel);
    // Only visible when aligned mode is active
    parallelToggleBtn.style.display = state.showAligned ? "" : "none";
  };
  refreshParallelToggle();

  alignedToggleBtn.addEventListener("click", () => {
    state.showAligned = !state.showAligned;
    if (!state.showAligned) {
      state.expandedAlignedUnitIds.clear();
      state.showParallel = false;
    }
    refreshAlignedToggle();
    refreshParallelToggle();
    const q = searchInput.value.trim();
    if (q) {
      void doSearch(q);
    } else {
      renderResults();
    }
  });

  parallelToggleBtn.addEventListener("click", () => {
    state.showParallel = !state.showParallel;
    refreshParallelToggle();
    renderResults();
  });

  filterBtn.addEventListener("click", () => {
    state.showFilters = !state.showFilters;
    filterDrawer.classList.toggle("hidden", !state.showFilters);
    filterBtn.classList.toggle("active", state.showFilters);
  });

  builderBtn.addEventListener("click", () => {
    state.showBuilder = !state.showBuilder;
    builderPanel.classList.toggle("hidden", !state.showBuilder);
    builderBtn.classList.toggle("active", state.showBuilder);
  });

  langSel.addEventListener("change", () => { state.filterLang = langSel.value; });
  roleSel.addEventListener("change", () => { state.filterRole = roleSel.value; });
  restypeSel.addEventListener("change", () => { state.filterResourceType = restypeSel.value; });

  (document.getElementById("filter-docid")! as HTMLInputElement).addEventListener("input", (e) => {
    state.filterDocId = (e.target as HTMLInputElement).value.trim();
  });
  document.getElementById("filter-clear")!.addEventListener("click", () => {
    state.filterLang = "";
    state.filterRole = "";
    state.filterDocId = "";
    state.filterResourceType = "";
    langSel.value = "";
    roleSel.value = "";
    restypeSel.value = "";
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
