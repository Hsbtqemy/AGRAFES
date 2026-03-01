/**
 * shell.ts — AGRAFES Shell V0.2
 *
 * V0.1: permanent header + tabs (Explorer / Constituer) + lifecycle + accents.
 * V0.2 additions:
 *   - DB state unique  : `_currentDbPath` as single source of truth
 *   - DB badge         : header shows "DB: <basename>" or "DB: (aucune)"
 *   - Switch DB        : "Changer…" button → Tauri file picker (.db)
 *   - Persistance      : localStorage for last_mode + last_db_path
 *   - Deep-link boot   : location.hash (#explorer/#constituer/#home) or ?mode=
 *   - Module wrappers  : explorerModule / constituerModule via mount/dispose
 *   - Toast            : animated notification on DB change
 *
 * Layout (index.html):
 *   #shell-header  fixed 44px — brand + tabs + db zone (always visible)
 *   #app           padding-top:44px — module mount point; replaced on each navigation
 */

import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import type { ShellContext } from "./context.ts";

// ─── CSS ─────────────────────────────────────────────────────────────────────

const SHELL_CSS = `
  /* ── Accent tokens ─────────────────────────────────────────── */
  :root {
    --accent:            #2c5f9e;
    --accent-header-bg:  #1a1a2e;
  }
  body[data-mode="explorer"] {
    --accent:            #2c5f9e;
    --accent-header-bg:  #1e4a80;
  }
  body[data-mode="constituer"] {
    --accent:            #1a7f4e;
    --accent-header-bg:  #145a38;
  }

  /* ── Shell header ──────────────────────────────────────────── */
  #shell-header {
    background: var(--accent-header-bg);
    display: flex;
    align-items: center;
    padding: 0;
    gap: 0;
    transition: background 0.22s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.18);
  }

  .shell-brand {
    font-size: 0.95rem;
    font-weight: 700;
    color: #fff;
    cursor: pointer;
    user-select: none;
    letter-spacing: 0.5px;
    padding: 0 1rem;
    height: 44px;
    display: flex;
    align-items: center;
    border-right: 1px solid rgba(255,255,255,0.15);
    margin-right: 0.25rem;
    transition: background 0.15s;
  }
  .shell-brand:hover { background: rgba(255,255,255,0.08); }

  .shell-tabs {
    display: flex;
    height: 44px;
    gap: 0;
  }

  .shell-tab {
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    color: rgba(255,255,255,0.65);
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0 1.15rem;
    height: 100%;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .shell-tab:hover {
    color: #fff;
    background: rgba(255,255,255,0.08);
  }
  .shell-tab.active {
    color: #fff;
    font-weight: 700;
    border-bottom-color: rgba(255,255,255,0.88);
    background: rgba(255,255,255,0.12);
  }
  .shell-tab-badge {
    font-size: 0.7rem;
    opacity: 0.5;
  }

  /* ── DB zone (right side of header) ────────────────────────── */
  .shell-db-zone {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.75rem;
    height: 44px;
    border-left: 1px solid rgba(255,255,255,0.12);
  }

  .shell-db-badge {
    font-size: 0.75rem;
    color: rgba(255,255,255,0.6);
    font-family: ui-monospace, "SF Mono", monospace;
    white-space: nowrap;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shell-db-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px;
    color: rgba(255,255,255,0.85);
    font-size: 0.75rem;
    padding: 3px 9px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .shell-db-btn:hover {
    background: rgba(255,255,255,0.18);
    border-color: rgba(255,255,255,0.35);
  }

  /* ── Home screen ───────────────────────────────────────────── */
  .shell-home-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 44px);
    background: #f0f2f5;
    padding: 2rem;
  }

  .shell-home-title {
    font-size: 2.2rem;
    font-weight: 700;
    color: #1a1a2e;
    margin: 0 0 0.35rem;
    letter-spacing: -0.5px;
  }

  .shell-home-subtitle {
    font-size: 0.95rem;
    color: #6c757d;
    margin: 0 0 2.5rem;
  }

  .shell-cards {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .shell-card {
    background: #fff;
    border: 1px solid #dde1e8;
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    padding: 2rem 2.5rem;
    width: 240px;
    cursor: pointer;
    transition: box-shadow 0.18s, transform 0.12s, border-color 0.18s;
    text-align: center;
    user-select: none;
  }
  .shell-card:hover {
    transform: translateY(-3px);
  }
  .shell-card-explorer:hover {
    box-shadow: 0 6px 20px rgba(44,95,158,0.22);
    border-color: #2c5f9e;
  }
  .shell-card-constituer:hover {
    box-shadow: 0 6px 20px rgba(26,127,78,0.22);
    border-color: #1a7f4e;
  }
  .shell-card-badge {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 20px;
    margin-bottom: 0.75rem;
  }
  .shell-card-badge-explorer {
    background: #dbeafe;
    color: #1e4a80;
  }
  .shell-card-badge-constituer {
    background: #d1fae5;
    color: #145a38;
  }
  .shell-card-icon { font-size: 2.2rem; margin-bottom: 0.4rem; }
  .shell-card h2 { font-size: 1.05rem; font-weight: 600; margin: 0 0 0.4rem; color: #1a1a2e; }
  .shell-card p { font-size: 0.82rem; color: #6c757d; margin: 0; line-height: 1.4; }

  /* ── Loading indicator ─────────────────────────────────────── */
  .shell-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 44px);
    font-size: 0.95rem;
    color: #6c757d;
    gap: 0.5rem;
  }
  .shell-loading-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: shell-pulse 1.2s ease-in-out infinite;
  }
  .shell-loading-dot:nth-child(2) { animation-delay: 0.2s; }
  .shell-loading-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes shell-pulse {
    0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
    40%           { opacity: 1;    transform: scale(1.15); }
  }

  /* ── Toast ─────────────────────────────────────────────────── */
  .shell-toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%) translateY(0);
    background: #1a1a2e;
    color: #fff;
    font-size: 0.85rem;
    padding: 0.55rem 1.25rem;
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.28);
    z-index: 99999;
    pointer-events: none;
    opacity: 1;
    transition: opacity 0.4s, transform 0.4s;
  }
  .shell-toast.shell-toast-hide {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
  }
`;

// ─── Storage keys ─────────────────────────────────────────────────────────────

const LS_MODE  = "agrafes.lastMode";
const LS_DB    = "agrafes.lastDbPath";

// ─── State ────────────────────────────────────────────────────────────────────

type Mode = "home" | "explorer" | "constituer";

let _currentMode: Mode = "home";
let _currentDbPath: string | null = null;
let _currentDispose: (() => void) | null = null;
let _navigating = false;
const _dbListeners: Set<(path: string | null) => void> = new Set();

// ─── ShellContext factory ─────────────────────────────────────────────────────

function _makeContext(): ShellContext {
  return {
    getDbPath() { return _currentDbPath; },
    onDbChange(cb) {
      _dbListeners.add(cb);
      return () => _dbListeners.delete(cb);
    },
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function _loadPersisted(): { mode: Mode; dbPath: string | null } {
  const raw = localStorage.getItem(LS_MODE);
  const mode: Mode = (raw === "explorer" || raw === "constituer" || raw === "home")
    ? raw
    : "home";
  const dbPath = localStorage.getItem(LS_DB) ?? null;
  return { mode, dbPath };
}

function _persist(): void {
  localStorage.setItem(LS_MODE, _currentMode);
  if (_currentDbPath) localStorage.setItem(LS_DB, _currentDbPath);
  else localStorage.removeItem(LS_DB);
}

// ─── Deep-link resolution ─────────────────────────────────────────────────────

function _resolveDeepLink(): Mode | null {
  // Check location.hash: #explorer, #constituer, #home
  const hash = location.hash.replace(/^#/, "").trim().toLowerCase();
  if (hash === "explorer" || hash === "constituer" || hash === "home") return hash as Mode;

  // Check ?mode= query param
  const params = new URLSearchParams(location.search);
  const q = (params.get("mode") ?? "").trim().toLowerCase();
  if (q === "explorer" || q === "constituer" || q === "home") return q as Mode;

  return null;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function initShell(): Promise<void> {
  _injectCSS();

  // Restore persisted state
  const { mode: savedMode, dbPath: savedDb } = _loadPersisted();
  _currentDbPath = savedDb;

  // Deep-link overrides saved mode
  const deepLink = _resolveDeepLink();
  const startMode: Mode = deepLink ?? savedMode;

  _buildHeader();
  _installKeyboardShortcuts();
  document.body.dataset.mode = startMode;
  await _setMode(startMode);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

function _injectCSS(): void {
  if (document.getElementById("shell-css")) return;
  const style = document.createElement("style");
  style.id = "shell-css";
  style.textContent = SHELL_CSS;
  document.head.appendChild(style);
}

// ─── Header ───────────────────────────────────────────────────────────────────

function _buildHeader(): void {
  const header = document.getElementById("shell-header")!;
  header.innerHTML = "";

  // Brand — click goes home (does NOT reset DB)
  const brand = document.createElement("span");
  brand.className = "shell-brand";
  brand.textContent = "AGRAFES";
  brand.addEventListener("click", () => _setMode("home"));
  header.appendChild(brand);

  // Tabs
  const tabs = document.createElement("div");
  tabs.className = "shell-tabs";
  tabs.appendChild(_makeTab("Explorer",   "⌘1", "explorer"));
  tabs.appendChild(_makeTab("Constituer", "⌘2", "constituer"));
  header.appendChild(tabs);

  // DB zone (right-aligned via margin-left:auto in CSS)
  const dbZone = document.createElement("div");
  dbZone.className = "shell-db-zone";

  const badge = document.createElement("span");
  badge.id = "shell-db-badge";
  badge.className = "shell-db-badge";
  badge.textContent = _dbBadgeText();
  dbZone.appendChild(badge);

  const btn = document.createElement("button");
  btn.id = "shell-db-btn";
  btn.className = "shell-db-btn";
  btn.textContent = "Changer\u2026";
  btn.addEventListener("click", () => { void _onChangeDb(); });
  dbZone.appendChild(btn);

  header.appendChild(dbZone);
}

function _makeTab(label: string, shortcut: string, mode: Mode): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "shell-tab";
  btn.dataset.mode = mode;
  btn.innerHTML = `${label}<span class="shell-tab-badge">${shortcut}</span>`;
  btn.addEventListener("click", () => _setMode(mode));
  return btn;
}

function _updateHeaderTabs(mode: Mode): void {
  document.querySelectorAll(".shell-tab").forEach((btn) => {
    const el = btn as HTMLElement;
    el.classList.toggle("active", el.dataset.mode === mode);
  });
}

function _dbBadgeText(): string {
  if (!_currentDbPath) return "DB: (aucune)";
  const parts = _currentDbPath.replace(/\\/g, "/").split("/");
  return `DB: ${parts[parts.length - 1]}`;
}

function _updateDbBadge(): void {
  const badge = document.getElementById("shell-db-badge");
  if (badge) badge.textContent = _dbBadgeText();
}

// ─── DB change ────────────────────────────────────────────────────────────────

async function _onChangeDb(): Promise<void> {
  let picked: string | string[] | null;
  try {
    picked = await dialogOpen({
      title: "Ouvrir une base de données SQLite",
      filters: [{ name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] }],
      multiple: false,
    });
  } catch (err) {
    console.warn("[shell] dialog cancelled or failed:", err);
    return;
  }

  const newPath = Array.isArray(picked) ? picked[0] : picked;
  if (!newPath || newPath === _currentDbPath) return;

  _currentDbPath = newPath;
  _persist();
  _updateDbBadge();

  // Notify module listeners (e.g. future in-module reactions)
  _dbListeners.forEach(cb => cb(_currentDbPath));

  // Show toast
  const parts = newPath.replace(/\\/g, "/").split("/");
  _showToast(`DB active\u00a0: ${parts[parts.length - 1]}`);

  // If a module is currently mounted, re-mount it with the new DB
  if (_currentMode !== "home") {
    await _setMode(_currentMode);
  }
}

// ─── Router / lifecycle ───────────────────────────────────────────────────────

async function _setMode(mode: Mode): Promise<void> {
  if (_navigating) return;
  _navigating = true;

  _currentMode = mode;
  document.body.dataset.mode = mode;
  _updateHeaderTabs(mode);
  _persist();

  // Dispose current module (best-effort)
  try { _currentDispose?.(); } catch { /* ignore */ }
  _currentDispose = null;

  try {
    if (mode === "home") {
      _renderHome(_freshContainer());
      return;
    }

    _showLoading(_freshContainer());
    const ctx = _makeContext();

    if (mode === "explorer") {
      const mod = await import("./modules/explorerModule.ts");
      const fresh = _freshContainer();
      await mod.mount(fresh, ctx);
      _currentDispose = () => mod.dispose();
    } else {
      const mod = await import("./modules/constituerModule.ts");
      _freshContainer(); // swap out spinner; prep finds #app by id
      await mod.mount(document.getElementById("app")!, ctx);
      _currentDispose = () => mod.dispose();
    }
  } catch (err) {
    console.error("[shell] navigation error:", err);
    const c = document.getElementById("app");
    if (c) c.innerHTML = `<div style="padding:2rem;color:#c0392b">Erreur de chargement du module.<br><code>${String(err)}</code></div>`;
  } finally {
    _navigating = false;
  }
}

/** Replace #app with a new empty div#app — breaks all DOM event listeners on old element. */
function _freshContainer(): HTMLElement {
  const old = document.getElementById("app")!;
  const fresh = document.createElement("div");
  fresh.id = "app";
  fresh.style.paddingTop = "44px";
  fresh.style.minHeight = "100vh";
  old.replaceWith(fresh);
  return fresh;
}

// ─── Home screen ──────────────────────────────────────────────────────────────

function _renderHome(container: HTMLElement): void {
  const wrap = document.createElement("div");
  wrap.className = "shell-home-wrap";
  wrap.innerHTML = `
    <h1 class="shell-home-title">AGRAFES</h1>
    <p class="shell-home-subtitle">Choisissez un module</p>
    <div class="shell-cards">
      <div class="shell-card shell-card-explorer" id="shell-btn-explorer">
        <div class="shell-card-icon">&#128269;</div>
        <span class="shell-card-badge shell-card-badge-explorer">Explorer</span>
        <h2>Explorer AGRAFES</h2>
        <p>Interroger vos corpus multilingues, KWIC, r&eacute;sultats align&eacute;s.</p>
      </div>
      <div class="shell-card shell-card-constituer" id="shell-btn-constituer">
        <div class="shell-card-icon">&#128221;</div>
        <span class="shell-card-badge shell-card-badge-constituer">Constituer</span>
        <h2>Constituer son corpus</h2>
        <p>Importer, aligner, corriger et exporter vos corpus.</p>
      </div>
    </div>
  `;
  container.appendChild(wrap);

  wrap.querySelector("#shell-btn-explorer")!
    .addEventListener("click", () => _setMode("explorer"));
  wrap.querySelector("#shell-btn-constituer")!
    .addEventListener("click", () => _setMode("constituer"));
}

// ─── Loading indicator ────────────────────────────────────────────────────────

function _showLoading(container: HTMLElement): void {
  container.innerHTML = `
    <div class="shell-loading">
      <div class="shell-loading-dot"></div>
      <div class="shell-loading-dot"></div>
      <div class="shell-loading-dot"></div>
    </div>
  `;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function _showToast(msg: string, durationMs = 3000): void {
  const existing = document.getElementById("shell-toast");
  existing?.remove();

  const toast = document.createElement("div");
  toast.id = "shell-toast";
  toast.className = "shell-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("shell-toast-hide");
    setTimeout(() => toast.remove(), 450);
  }, durationMs);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

function _installKeyboardShortcuts(): void {
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === "1") { e.preventDefault(); void _setMode("explorer"); }
    else if (e.key === "2") { e.preventDefault(); void _setMode("constituer"); }
    else if (e.key === "0") { e.preventDefault(); void _setMode("home"); }
  });
}
