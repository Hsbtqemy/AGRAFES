/**
 * constituerModule.ts — Shell wrapper for Prep + Conventions.
 *
 * Two sub-tabs:
 *   - "preparer"    → tauri-prep (App)
 *   - "conventions" → conventionsModule (rôles d'unités + text_start_n)
 *
 * Sub-tab state is persisted in localStorage.
 */

import type { ShellContext } from "../context.ts";
import { setCurrentDbPath } from "../../../tauri-prep/src/lib/db.ts";
import { App } from "../../../tauri-prep/src/app.ts";
// Prep CSS is managed by Vite: bundled into this chunk automatically.
import "../../../tauri-prep/src/ui/tokens.css";
import "../../../tauri-prep/src/ui/base.css";
import "../../../tauri-prep/src/ui/components.css";
import "../../../tauri-prep/src/ui/prep-vnext.css";
import "../../../tauri-prep/src/ui/app.css";
import "../../../tauri-prep/src/ui/job-center.css";

// ─── Sub-tab state ─────────────────────────────────────────────────────────────

const LS_SUBTAB = "agrafes.constituer.subtab";
type ConstituerTab = "preparer" | "conventions";

let _mounted = false;
let _switching = false;
let _activeTab: ConstituerTab = "preparer";
let _subDispose: (() => void) | null = null;
let _subContainer: HTMLElement | null = null;
let _tabBar: HTMLElement | null = null;
let _savedCtx: ShellContext | null = null;
let _prepApp: App | null = null;
let _outerContainer: HTMLElement | null = null;

// ─── CSS ───────────────────────────────────────────────────────────────────────

const CONSTITUER_CSS = `
/* ── Sub-tab bar (green accent matching "constituer" mode) ── */
.con-subtab-bar {
  display: flex;
  height: 38px;
  background: #0d3d27;
  border-top: 1px solid rgba(255,255,255,0.10);
  border-bottom: 2px solid rgba(255,255,255,0.13);
  padding: 0 0.5rem;
  gap: 0;
  align-items: stretch;
  flex-shrink: 0;
}
.con-subtab {
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  color: rgba(255,255,255,0.72);
  font-size: 0.82rem;
  font-weight: 500;
  padding: 0 1.1rem;
  cursor: pointer;
  transition: color 0.14s, border-color 0.14s, background 0.14s;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.con-subtab:hover {
  color: #fff;
  background: rgba(255,255,255,0.09);
}
.con-subtab.active {
  color: #fff;
  font-weight: 700;
  border-bottom-color: #4ade80;
  background: rgba(74,222,128,0.10);
}
.con-subcontent {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}
.con-subcontent > * {
  height: 100%;
}
`;

// ─── Public API ────────────────────────────────────────────────────────────────

export async function mount(
  container: HTMLElement,
  ctx: ShellContext
): Promise<void> {
  _savedCtx = ctx;
  _switching = false;
  _prepApp = null;
  // The shell passes container with id="app". Transfer that id to the sub-content
  // div when prep is active (tauri-prep's App._buildUI() uses getElementById("app")).
  // Remove it from the outer container to avoid duplicate ids in the DOM.
  _outerContainer = container;
  container.removeAttribute("id");

  // Read persisted sub-tab
  _activeTab = "preparer";
  try {
    const raw = localStorage.getItem(LS_SUBTAB);
    if (raw === "preparer" || raw === "conventions") _activeTab = raw;
  } catch { /* ignore */ }

  container.style.height = "100vh";
  container.style.boxSizing = "border-box";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.overflow = "hidden";

  // Inject sub-tab CSS once
  if (!document.getElementById("con-subtab-css")) {
    const style = document.createElement("style");
    style.id = "con-subtab-css";
    style.textContent = CONSTITUER_CSS;
    document.head.appendChild(style);
  }

  // Sub-tab bar
  _tabBar = document.createElement("div");
  _tabBar.className = "con-subtab-bar";
  _tabBar.innerHTML = `
    <button class="con-subtab${_activeTab === "preparer" ? " active" : ""}" data-tab="preparer">
      &#128196; Préparer
    </button>
    <button class="con-subtab${_activeTab === "conventions" ? " active" : ""}" data-tab="conventions">
      &#127991; Conventions
    </button>
  `;
  container.appendChild(_tabBar);

  // Sub-content area
  _subContainer = document.createElement("div");
  _subContainer.className = "con-subcontent";
  container.appendChild(_subContainer);

  // Wire tab clicks
  _tabBar.querySelectorAll<HTMLButtonElement>(".con-subtab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as ConstituerTab;
      if (tab === _activeTab || _switching) return;
      void _switchTab(tab);
    });
  });

  await _mountTab(_activeTab);
  _mounted = true;
}

export function dispose(): void {
  if (!_mounted) return;
  _disposeSubModule();
  try { _prepApp?.dispose(); } catch { /* ignore */ }
  // Restore id="app" on the outer container so the shell and other modules
  // can find it via getElementById("app") after navigation.
  if (_outerContainer) { _outerContainer.id = "app"; _outerContainer = null; }
  _mounted = false;
  _switching = false;
  _subContainer = null;
  _tabBar = null;
  _savedCtx = null;
  _prepApp = null;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

async function _switchTab(tab: ConstituerTab): Promise<void> {
  if (!_tabBar || !_subContainer || _switching) return;
  _switching = true;

  try {
    _tabBar.querySelectorAll<HTMLButtonElement>(".con-subtab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
      btn.disabled = true;
    });

    _activeTab = tab;
    try { localStorage.setItem(LS_SUBTAB, tab); } catch { /* ignore */ }

    _disposeSubModule();
    _subContainer.innerHTML = "";

    await _mountTab(tab);
  } finally {
    _tabBar?.querySelectorAll<HTMLButtonElement>(".con-subtab").forEach(btn => {
      btn.disabled = false;
    });
    _switching = false;
  }
}

async function _mountTab(tab: ConstituerTab): Promise<void> {
  if (!_subContainer || !_savedCtx) return;

  if (tab === "preparer") {
    const dbPath = _savedCtx.getDbPath();
    if (dbPath) setCurrentDbPath(dbPath);
    // tauri-prep's App._buildUI() mounts into document.getElementById("app").
    // Give _subContainer that id so prep finds it; the outer container's id
    // was already removed in mount() to avoid duplicate ids.
    _subContainer!.id = "app";
    _prepApp = new App();
    await _prepApp.init();
    _subDispose = () => {
      if (_prepApp) {
        try { _prepApp.dispose(); } catch { /* ignore */ }
        _prepApp = null;
      }
      if (_subContainer) _subContainer.removeAttribute("id");
    };
  } else {
    const mod = await import("./conventionsModule.ts");
    await mod.mount(_subContainer, _savedCtx);
    _subDispose = () => { mod.dispose(); };
  }
}

function _disposeSubModule(): void {
  if (_subDispose) {
    try { _subDispose(); } catch { /* ignore */ }
    _subDispose = null;
  }
}
