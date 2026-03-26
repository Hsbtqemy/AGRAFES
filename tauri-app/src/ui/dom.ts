/**
 * ui/dom.ts — DOM utility helpers and global CSS injection.
 */

// ─── DOM helpers ──────────────────────────────────────────────────────────────

export function elt<K extends keyof HTMLElementTagNameMap>(
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

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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

/* ─── Doc Selector ─── */
.doc-sel-mount {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
  max-width: 280px;
}
.doc-sel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.doc-sel-label {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}
.doc-sel-btns { display: flex; gap: 4px; }
.doc-sel-btn {
  font-size: 10px;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
}
.doc-sel-btn:hover { border-color: var(--brand); color: var(--brand); }
.doc-sel-list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
}
.doc-sel-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text);
  transition: background 0.1s;
}
.doc-sel-row:hover { background: var(--surface); }
.doc-sel-row input[type=checkbox] {
  flex-shrink: 0;
  accent-color: var(--brand);
  cursor: pointer;
}
.doc-sel-lang {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--brand);
  color: #fff;
  line-height: 1.4;
}
.doc-sel-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.doc-sel-empty {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}
.chip--warn {
  border-color: #e67e22;
  color: #e67e22;
  background: #fff8f0;
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

/* Case-sensitive toggle button */
.case-sensitive-btn {
  font-family: ui-serif, Georgia, serif;
  font-weight: 700;
  letter-spacing: -0.03em;
  padding: 4px 9px;
  font-size: 0.85rem;
}
.case-sensitive-btn.active {
  background: color-mix(in srgb, var(--brand) 12%, var(--surface));
  color: var(--brand);
  border-color: var(--brand);
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

.aligned-source-changed-badge {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 5px;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  color: #92400e;
  cursor: help;
  vertical-align: middle;
}

/* Post-filter: when .filter-source-changed is on results-area, hide lines without badge */
.results-area.filter-source-changed .aligned-line:not(:has(.aligned-source-changed-badge)) {
  display: none;
}
.results-area.filter-source-changed .aligned-group:not(:has(.aligned-source-changed-badge)) {
  display: none;
}

.source-changed-btn { font-size: 0.78rem; }
.source-changed-btn.active {
  background: #fef9c3;
  border-color: #fde68a;
  color: #92400e;
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

/* ─── Query builder panel ─── */
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

/* ─── History dropdown + Export menu ─── */
.hist-wrap, .export-wrap {
  position: relative;
  display: inline-flex;
}
.hist-panel, .export-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 6px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.16);
  z-index: 9000;
  display: none;
  min-width: 300px;
}
.hist-panel.open, .export-menu.open { display: block; }
.export-menu { min-width: 140px; }
.hist-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 6px;
  border-bottom: 1px solid #e9ecef;
  font-size: 0.82rem;
  font-weight: 600;
  color: #495057;
}
.hist-list {
  max-height: 320px;
  overflow-y: auto;
}
.hist-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid #f0f2f5;
  transition: background 0.12s;
}
.hist-item:hover { background: #f8f9fa; }
.hist-item-text { flex: 1; min-width: 0; }
.hist-item-fts { font-size: 0.82rem; font-family: ui-monospace, monospace; color: var(--brand); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hist-item-meta { font-size: 0.75rem; color: #6c757d; margin-top: 2px; }
.hist-item-time { font-size: 0.72rem; color: #adb5bd; flex-shrink: 0; margin-top: 2px; }
.hist-empty { padding: 14px 12px; font-size: 0.83rem; color: #6c757d; text-align: center; }
.hist-item-pinned { background: #fff8e1 !important; border-left: 3px solid #f59e0b; }
.hist-item-pinned:hover { background: #fff3cd !important; }
.hist-pin-btn {
  background: none; border: none; cursor: pointer; font-size: 0.85rem; padding: 0 3px;
  opacity: 0.4; transition: opacity 0.12s; flex-shrink: 0;
}
.hist-pin-btn:hover { opacity: 1; }
.hist-pin-btn.pinned { opacity: 1; }
.hist-divider { font-size: 0.7rem; color: #adb5bd; padding: 4px 12px 2px; text-transform: uppercase; letter-spacing: 0.04em; }

/* ─── Help popover ─── */
.help-wrap { position: relative; display: inline-flex; }
.help-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.16);
  z-index: 9000;
  display: none;
  min-width: 360px;
  max-width: 420px;
  padding: 0;
  font-size: 0.82rem;
}
.help-popover.open { display: block; }
.help-popover-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px 6px; border-bottom: 1px solid #e9ecef;
  font-size: 0.84rem; font-weight: 600; color: #495057;
}
.help-popover-body { padding: 10px 12px; max-height: 360px; overflow-y: auto; }
.help-section { margin-bottom: 10px; }
.help-section-title { font-weight: 600; font-size: 0.79rem; color: #6c757d; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.help-ex {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 0; border-bottom: 1px solid #f0f2f5;
}
.help-ex:last-child { border-bottom: none; }
.help-ex-code { font-family: ui-monospace,monospace; font-size: 0.8rem; color: var(--brand); flex: 1; }
.help-ex-desc { font-size: 0.77rem; color: #6c757d; flex: 1; }
.help-ex-copy {
  background: none; border: 1px solid #dee2e6; border-radius: 3px;
  font-size: 0.72rem; padding: 1px 6px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
  transition: background 0.1s;
}
.help-ex-copy:hover { background: #f0f2f5; }
.help-passthrough-note {
  font-size: 0.79rem; color: #6c757d; background: #f8f9fa; border-radius: 4px;
  padding: 6px 10px; margin-top: 6px; border: 1px solid #dee2e6;
}
.export-menu-item {
  display: block;
  width: 100%;
  padding: 9px 16px;
  background: none;
  border: none;
  text-align: left;
  font-size: 0.83rem;
  cursor: pointer;
  color: #1a1a2e;
  transition: background 0.12s;
  white-space: nowrap;
}
.export-menu-item:hover { background: #f0f2f5; }

/* ─── FTS preview bar + chips bar ─── */
.fts-preview-bar {
  background: #f8f9fa;
  border-bottom: 1px solid var(--border);
  padding: 4px 16px;
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.fts-preview-label { white-space: nowrap; font-weight: 600; }
.fts-preview-code {
  font-family: ui-monospace, monospace;
  color: var(--brand);
  word-break: break-all;
}
.chips-bar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 5px 16px;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: #dbeafe;
  color: #1e4a80;
  border-radius: 20px;
  padding: 2px 6px 2px 10px;
  font-size: 11px;
  white-space: nowrap;
}
.chip-remove {
  background: none;
  border: none;
  color: #1e4a80;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  display: flex;
  align-items: center;
}
.chip-remove:hover { color: #c0392b; }

/* ─── Metadata side panel ─── */
.meta-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.18); z-index: 200;
  display: none; cursor: default;
}
.meta-backdrop.open { display: block; }
.meta-panel {
  position: fixed; top: 0; right: 0; width: 340px; max-width: 95vw; height: 100vh;
  background: var(--surface); border-left: 1px solid var(--border);
  box-shadow: -2px 0 16px rgba(0,0,0,0.14);
  display: flex; flex-direction: column; z-index: 201;
  transform: translateX(110%); transition: transform 0.22s ease;
}
.meta-panel.open { transform: translateX(0); }
.meta-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--border);
  background: var(--surface2); flex-shrink: 0;
}
.meta-panel-head h4 { margin: 0; font-size: 13px; }
.meta-body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.meta-foot { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap; }
.meta-field { display: flex; flex-direction: column; gap: 1px; }
.meta-lbl { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.meta-val { font-size: 13px; color: var(--text); word-break: break-word; font-family: ui-monospace, monospace; }
.meta-val.is-text { font-family: inherit; }
.meta-section-head {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--text-muted); padding: 4px 0 2px; border-bottom: 1px solid var(--border);
  margin-top: 4px;
}
.hit-meta-btn {
  border: none; background: none; color: var(--text-muted); font-size: 13px;
  cursor: pointer; padding: 0 4px; line-height: 1; flex-shrink: 0; margin-left: 4px;
}
.hit-meta-btn:hover { color: var(--brand); }

/* ─── Parallel view ─── */
.parallel-card {
  overflow: hidden;        /* clearfix — gives card the height of the tallest column */
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 10px;
  flex-shrink: 0;
}
.parallel-pivot {
  float: left;
  width: 50%;
  padding: 10px 12px;
  border-right: 1px solid var(--border);
  box-sizing: border-box;
  overflow-wrap: break-word;
  word-break: break-word;
}
.parallel-aligned {
  float: left;
  width: 50%;
  background: var(--surface2);
  padding: 10px 12px;
  box-sizing: border-box;
  overflow-wrap: break-word;
  word-break: break-word;
  max-height: 480px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.parallel-pivot .result-meta { font-size: 11px; color: var(--text-muted); margin-bottom: 5px; }
.parallel-pivot .result-text {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
  overflow-wrap: break-word;
  word-break: break-word;
}

/* KWIC excerpt in pivot column */
.parallel-kwic {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 4px;
  font-size: 13px;
  line-height: 1.55;
}
.parallel-kwic-left  { color: var(--text-muted); text-align: right; flex: 1 1 35%; min-width: 0; overflow-wrap: break-word; }
.parallel-kwic-match { font-weight: 700; background: var(--match-bg); color: var(--match-color); padding: 0 4px; border-radius: 3px; white-space: nowrap; flex-shrink: 0; }
.parallel-kwic-right { color: var(--text-muted); flex: 1 1 35%; min-width: 0; overflow-wrap: break-word; }

.parallel-aligned-header {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
}
.parallel-aligned-group { margin-bottom: 8px; }
.parallel-aligned-group + .parallel-aligned-group { padding-top: 6px; border-top: 1px dashed var(--border); }
.parallel-aligned-group:last-child { margin-bottom: 0; }
.parallel-lang-header {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 3px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.parallel-lang-badge {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  background: var(--brand);
  color: #fff;
  border-radius: 3px;
  padding: 0 4px;
  line-height: 1.6;
}
.parallel-line {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  overflow-wrap: break-word;
  word-break: break-word;
}
.parallel-ref { font-size: 11px; color: var(--text-muted); margin-right: 3px; }
.parallel-empty { font-size: 12px; color: var(--text-muted); font-style: italic; margin-top: 4px; }
.parallel-more-btn { font-size: 11px; color: var(--brand); cursor: pointer; background: none; border: none; padding: 2px 0; display: block; margin-top: 3px; }

/* ── Toast notification ── */
.app-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: #1f2937;
  color: #f9fafb;
  font-size: 13px;
  padding: 8px 14px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,.25);
  opacity: 0;
  transform: translateY(6px);
  transition: opacity .18s, transform .18s;
  pointer-events: none;
  z-index: 9999;
}
.app-toast.visible {
  opacity: 1;
  transform: translateY(0);
}

/* ─── Sprint G — Analytics, facets, sort, document groups ─── */

.analytics-summary {
  font-size: 11px;
  color: var(--text-muted);
  padding: 2px 0 3px;
  letter-spacing: 0.01em;
}

.results-facets {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  padding: 5px 0 7px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.results-facets-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-right: 2px;
  white-space: nowrap;
  flex-shrink: 0;
}
.facet-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 2px 8px 2px 9px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  max-width: 200px;
}
.facet-chip:hover {
  background: var(--brand-light, #dbeafe);
  border-color: var(--brand);
}
.facet-chip-title {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.facet-chip-count {
  background: var(--brand);
  color: #fff;
  border-radius: 8px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
  line-height: 1.5;
}

.sort-toggle-btn {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.sort-toggle-btn:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.sort-toggle-btn.active {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
}

.doc-group-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  background: var(--surface2);
  border-left: 3px solid var(--brand);
  border-radius: 0 4px 4px 0;
  padding: 4px 10px;
  margin: 10px 0 4px;
  gap: 8px;
}
.doc-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-group-count {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* ─── Sprint F — Document exploration ─── */

/* Card active state: subtle left border when its meta panel is open */
.result-card.card--active {
  border-left: 3px solid var(--brand);
  background: var(--surface2);
}
.parallel-card.card--active {
  border-left: 3px solid var(--brand);
  background: var(--surface2);
}

/* Meta panel prev/next navigation row (global hits) */
.meta-nav-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0 2px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
  flex-wrap: wrap;
}
.meta-nav-btn {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text);
  padding: 3px 10px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.meta-nav-btn:hover:not(:disabled) {
  background: var(--brand-light, #e0edff);
  border-color: var(--brand);
}
.meta-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.meta-nav-pos {
  font-size: 11px;
  color: var(--text-muted);
  flex: 1;
  text-align: center;
}

/* ─── Sprint L: intra-document hit navigation row ─── */

.meta-doc-nav-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 0 2px;
  border-top: 1px dashed var(--border);
  margin-top: 3px;
  flex-wrap: wrap;
}
.meta-doc-nav-label {
  font-size: 10px;
  color: var(--text-muted);
  width: 100%;
  margin-bottom: 2px;
  font-style: italic;
}
.meta-doc-nav-btn {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text);
  padding: 2px 8px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.meta-doc-nav-btn:hover:not(:disabled) {
  background: color-mix(in srgb, #e67e22 15%, var(--surface));
  border-color: #e67e22;
  color: #e67e22;
}
.meta-doc-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.meta-doc-nav-pos {
  font-size: 11px;
  color: var(--text-muted);
  flex: 1;
  text-align: center;
  cursor: default;
}
/* Sprint M: exact total suffix inside the position label */
.meta-doc-nav-total {
  color: #e67e22;
  font-weight: 500;
}
/* Sprint M: "Voir les N occurrences" action button */
.meta-doc-load-all-btn {
  width: 100%;
  margin-top: 4px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(230, 126, 34, 0.5);
  background: color-mix(in srgb, #e67e22 8%, var(--surface));
  color: #e67e22;
  cursor: pointer;
  text-align: center;
  transition: background 0.12s, border-color 0.12s;
}
.meta-doc-load-all-btn:hover {
  background: color-mix(in srgb, #e67e22 18%, var(--surface));
  border-color: #e67e22;
}

/* Hit counter (other occurrences in same doc) */
.meta-hit-counter {
  font-size: 11px;
  color: var(--brand);
  font-style: italic;
  margin-top: 2px;
  cursor: pointer;
  text-decoration: underline dotted;
}
.meta-hit-counter.no-others {
  color: var(--text-muted);
  text-decoration: none;
  cursor: default;
}

/* Position in document (unit index / total) */
.meta-doc-position {
  font-size: 11px;
  color: var(--text-muted);
  padding: 1px 5px;
  background: var(--surface2);
  border-radius: 3px;
  border: 1px solid var(--border);
  display: inline-block;
  margin-left: 4px;
}

/* Extrait toggle button */
.meta-excerpt-toggle {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--brand);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline dotted;
}

/* ─── Alignements section in meta panel ─── */
.meta-aligned-group {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 12px;
}
.meta-aligned-group + .meta-aligned-group { margin-top: 6px; }
.meta-aligned-group-header {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 5px;
}
.meta-aligned-group-title {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta-aligned-row {
  line-height: 1.5;
  color: var(--text);
  word-break: break-word;
}
.meta-aligned-ref {
  font-size: 10px;
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
}
/* Small inline copy button (used in meta panel aligned groups) */
.meta-copy-micro {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s;
  line-height: 1;
}
.meta-copy-micro:hover { color: var(--brand); border-color: var(--brand); }

/* Small copy icon button in parallel card aligned group headers */
.parallel-group-copy-btn {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1px solid transparent;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.15s, border-color 0.15s;
  line-height: 1;
}
.parallel-lang-header:hover .parallel-group-copy-btn,
.parallel-group-copy-btn:focus-visible {
  opacity: 1;
  border-color: var(--border);
}

/* ─── Sprint I — Contexte local (voisinage documentaire) ─── */
.meta-context-wrap {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.meta-context-loading {
  font-size: 12px;
  color: var(--text-muted);
}
.meta-context-loading.meta-context-error {
  color: var(--danger, #c00);
}
.meta-context-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.meta-context-pos-line {
  font-size: 11px;
  color: var(--text-muted);
}
.meta-context-pos {
  font-family: ui-monospace, monospace;
  padding: 1px 5px;
  background: var(--surface2);
  border-radius: 3px;
  border: 1px solid var(--border);
}
.meta-context-block {
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface2);
}
.meta-context-block.meta-context-current {
  border-color: var(--brand, #0066cc);
  background: color-mix(in srgb, var(--brand, #0066cc) 12%, transparent);
  font-weight: 500;
}
.meta-context-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}
.meta-context-text {
  word-break: break-word;
  line-height: 1.35;
}
.meta-context-nav-line {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.meta-context-nav-btn {
  font-size: 11px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface2);
  color: var(--text);
  cursor: pointer;
}
.meta-context-nav-btn:hover:not(:disabled) {
  background: var(--surface3);
}
.meta-context-nav-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.meta-context-nav-sep {
  min-width: 4px;
}

/* ─── Sprint E — Large corpus notice ─── */
.large-corpus-notice {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 8px;
  margin-bottom: 4px;
}

/* ─── Sprint D — Result cards actions ─── */
.card-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.card-action-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-muted);
  padding: 2px 8px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  white-space: nowrap;
  line-height: 1.6;
}
.card-action-btn:hover {
  background: var(--surface2);
  color: var(--brand);
  border-color: var(--brand);
}
.card-action-btn.copied {
  color: var(--success);
  border-color: var(--success);
}

/* ─── Results header enrichi ─── */
.results-header { justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.results-header-left { font-size: 12px; color: var(--text-muted); }
.results-header-right { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.mode-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.mode-badge--kwic { background: #ede9fe; border-color: #c4b5fd; color: #6d28d9; }
.mode-badge--segment { background: #e0f2fe; border-color: #7dd3fc; color: #0369a1; }
.results-filter-summary {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.results-end-msg {
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  padding: 10px 0 4px;
  border-top: 1px dashed var(--border);
  margin-top: 4px;
}

/* ─── Meta panel excerpt ─── */
.meta-excerpt {
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  word-break: break-word;
  white-space: pre-wrap;
  min-height: 80px;
  max-height: 200px;
  overflow-y: auto;
}

/* ─── Sprint I/J — Local context + reading strip ─── */

.meta-context-wrap {
  margin-top: 8px;
}
.meta-context-loading {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
  padding: 4px 0;
}
.meta-context-error {
  color: var(--danger, #c0392b);
}
.meta-context-pos {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  display: inline-block;
}

/* ─── Sprint J/K: reading strip ─── */

.meta-reader-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}
.meta-reader {
  overflow-y: auto;
  max-height: 260px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  scroll-behavior: smooth;
}
.meta-reader-row {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  transition: background 0.12s;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  line-height: 1.45;
}
.meta-reader-row:last-child {
  border-bottom: none;
}
.meta-reader-row:not(.is-current) {
  cursor: pointer;
}
.meta-reader-row:not(.is-current):hover {
  background: var(--surface2);
}
.meta-reader-row:not(.is-current):focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: -2px;
}
/* Current unit — brand accent */
.meta-reader-row.is-current {
  background: color-mix(in srgb, var(--brand) 10%, var(--surface));
  border-left: 3px solid var(--brand);
  padding-left: 8px;
}
/* Hit unit (non-current) — amber left accent */
.meta-reader-row.is-hit:not(.is-current) {
  border-left: 2px solid rgba(230, 126, 34, 0.55);
  padding-left: 9px;
}
/* Both current AND hit — keep brand left, add amber right accent */
.meta-reader-row.is-current.is-hit {
  border-right: 2px solid rgba(230, 126, 34, 0.6);
}
.meta-reader-text {
  font-size: 12px;
  color: var(--text);
  word-break: break-word;
  white-space: pre-wrap;
  flex: 1;
}
.meta-reader-row.is-current .meta-reader-text {
  font-weight: 500;
}
.meta-reader-row:not(.is-current) .meta-reader-text {
  color: var(--text-muted);
}
/* Amber hit-dot marker */
.meta-reader-hit-dot {
  font-size: 8px;
  color: #e67e22;
  flex-shrink: 0;
  margin-top: 4px;
  line-height: 1;
}
/* Legend shown below strip when hits are present */
.meta-reader-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
  padding: 3px 8px 4px;
  border-top: 1px solid var(--border);
  font-style: italic;
}
.meta-reader-legend-dot {
  color: #e67e22;
  font-size: 9px;
}
/* Window depth toggle (±3 / ±6) */
.meta-reader-win-ctl {
  display: flex;
  gap: 2px;
  margin-left: auto;
}
.meta-reader-win-btn {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.meta-reader-win-btn:hover:not(.active) {
  border-color: var(--brand);
  color: var(--brand);
}
.meta-reader-win-btn.active {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
}
.meta-reader-boundary {
  font-size: 10px;
  color: var(--text-muted);
  text-align: center;
  padding: 4px 6px;
  font-style: italic;
  border-top: 1px solid var(--border);
  margin-top: 2px;
}
`;


export function injectStyles(): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
}
