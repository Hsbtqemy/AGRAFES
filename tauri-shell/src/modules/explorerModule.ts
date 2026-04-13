/**
 * explorerModule.ts — Shell wrapper for Explorer (Concordancier + Recherche grammaticale).
 *
 * Two sub-tabs share the Explorer top-level mode:
 *   - "concordancier"  → tauri-app (initApp / disposeApp)
 *   - "recherche"      → rechercheModule (mount / dispose)
 *
 * Sub-tab state is persisted in localStorage so the user returns to the
 * last active sub-tab on reload.
 */

import type { ShellContext } from "../context.ts";
import { setCurrentDbPath } from "../../../tauri-app/src/lib/db.ts";
import { initApp, disposeApp } from "../../../tauri-app/src/app.ts";

// ─── Sub-tab state ─────────────────────────────────────────────────────────────

const LS_SUBTAB = "agrafes.explorer.subtab";
type ExplorerTab = "concordancier" | "recherche" | "conventions";

let _mounted = false;
let _switching = false;
let _activeTab: ExplorerTab = "concordancier";
let _subDispose: (() => void) | null = null;
let _subContainer: HTMLElement | null = null;
let _tabBar: HTMLElement | null = null;
let _savedCtx: ShellContext | null = null;
// Reference to the active recherche module (set when sub-tab is mounted)
let _rechercheRef: { prefill: (cql: string) => void } | null = null;
// Pending CQL to inject once recherche sub-tab finishes mounting
let _pendingPrefill: string | null = null;
// Global event listener for window bridge
let _bridgeHandler: ((e: Event) => void) | null = null;

// ─── CSS ───────────────────────────────────────────────────────────────────────

const EXPLORER_CSS = `
/* ── Sub-tab bar ── */
.exp-subtab-bar {
  display: flex;
  height: 38px;
  background: #0f2347;
  border-top: 1px solid rgba(255,255,255,0.12);
  border-bottom: 2px solid rgba(255,255,255,0.15);
  padding: 0 0.5rem;
  gap: 0;
  align-items: stretch;
  flex-shrink: 0;
}
.exp-subtab {
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
.exp-subtab:hover {
  color: #fff;
  background: rgba(255,255,255,0.1);
}
.exp-subtab.active {
  color: #fff;
  font-weight: 700;
  border-bottom-color: #60a5fa;
  background: rgba(96,165,250,0.12);
}

/* ── Sub-content area fills remaining height ── */
.exp-subcontent {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}
/* Ensure children that use height:100% get a definite reference */
.exp-subcontent > * {
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

  // Reset and read persisted sub-tab
  _activeTab = "concordancier";
  try {
    const raw = localStorage.getItem(LS_SUBTAB);
    if (raw === "concordancier" || raw === "recherche" || raw === "conventions") _activeTab = raw;
  } catch { /* ignore */ }

  // Give the container a definite height so flex children resolve height:100%.
  // _freshContainer sets min-height:100vh + padding-top:44px (inline style).
  // We override to height:100vh with box-sizing:border-box so padding is included.
  container.style.height = "100vh";
  container.style.boxSizing = "border-box";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.overflow = "hidden";

  // Inject sub-tab CSS once (idempotent)
  if (!document.getElementById("exp-subtab-css")) {
    const style = document.createElement("style");
    style.id = "exp-subtab-css";
    style.textContent = EXPLORER_CSS;
    document.head.appendChild(style);
  }

  // Sub-tab bar
  _tabBar = document.createElement("div");
  _tabBar.className = "exp-subtab-bar";
  _tabBar.innerHTML = `
    <button class="exp-subtab${_activeTab === "concordancier" ? " active" : ""}" data-tab="concordancier">
      &#128269; Concordancier
    </button>
    <button class="exp-subtab${_activeTab === "recherche" ? " active" : ""}" data-tab="recherche">
      &#128270; Recherche grammaticale
    </button>
    <button class="exp-subtab${_activeTab === "conventions" ? " active" : ""}" data-tab="conventions">
      &#127991; Conventions
    </button>
  `;
  container.appendChild(_tabBar);

  // Sub-content area
  _subContainer = document.createElement("div");
  _subContainer.className = "exp-subcontent";
  container.appendChild(_subContainer);

  // Wire tab clicks — guard against double-click races
  _tabBar.querySelectorAll<HTMLButtonElement>(".exp-subtab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as ExplorerTab;
      if (tab === _activeTab || _switching) return;
      void _switchTab(tab);
    });
  });

  // Mount initial sub-tab
  await _mountTab(_activeTab);
  _mounted = true;

  // Window bridge: listen for CustomEvent("agrafes:cql-prefill", { detail: { cql } })
  // Allows the concordancer or any other part of the app to trigger a CQL search.
  _bridgeHandler = (e: Event) => {
    const cql = (e as CustomEvent<{ cql: string }>).detail?.cql;
    if (typeof cql === "string" && cql.trim()) void _goToRecherche(cql.trim());
  };
  window.addEventListener("agrafes:cql-prefill", _bridgeHandler);
}

export function dispose(): void {
  if (!_mounted) return;
  _disposeSubModule();
  if (_bridgeHandler) {
    window.removeEventListener("agrafes:cql-prefill", _bridgeHandler);
    _bridgeHandler = null;
  }
  _mounted = false;
  _switching = false;
  _subContainer = null;
  _tabBar = null;
  _savedCtx = null;
  _rechercheRef = null;
  _pendingPrefill = null;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

async function _switchTab(tab: ExplorerTab): Promise<void> {
  if (!_tabBar || !_subContainer || _switching) return;
  _switching = true;

  try {
    // Update active class
    _tabBar.querySelectorAll<HTMLButtonElement>(".exp-subtab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
      btn.disabled = true;
    });

    _activeTab = tab;
    try { localStorage.setItem(LS_SUBTAB, tab); } catch { /* ignore */ }

    // Tear down current sub-module
    _disposeSubModule();
    _subContainer.innerHTML = "";

    // Mount new sub-module
    await _mountTab(tab);
  } finally {
    // Re-enable tab buttons
    _tabBar?.querySelectorAll<HTMLButtonElement>(".exp-subtab").forEach(btn => {
      btn.disabled = false;
    });
    _switching = false;
  }
}

async function _mountTab(tab: ExplorerTab): Promise<void> {
  if (!_subContainer || !_savedCtx) return;

  _rechercheRef = null;

  if (tab === "concordancier") {
    const dbPath = _savedCtx.getDbPath();
    if (dbPath) setCurrentDbPath(dbPath);

    // buildUI() appends its children (topbar, toolbar, resultsArea…) directly into
    // the container it receives.  Without a flex-column parent, resultsArea.flex:1
    // does not expand and all children get height:100% from .exp-subcontent > *.
    // Wrap in a dedicated div that acts as the #app surrogate.
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;height:100%;overflow:hidden;";
    _subContainer.appendChild(wrap);

    await initApp(wrap);
    _subDispose = () => { try { disposeApp(); } catch { /* ignore */ } };
    _maybeShowWelcomeHint(wrap);
  } else if (tab === "conventions") {
    const mod = await import("./conventionsModule.ts");
    await mod.mount(_subContainer, _savedCtx);
    _subDispose = () => { mod.dispose(); };
  } else {
    const mod = await import("./rechercheModule.ts");
    await mod.mount(_subContainer, _savedCtx);
    _rechercheRef = { prefill: mod.prefill };
    _subDispose = () => { mod.dispose(); };

    // Inject any pending prefill (set before the tab was mounted)
    if (_pendingPrefill) {
      const cql = _pendingPrefill;
      _pendingPrefill = null;
      mod.prefill(cql);
    }
  }
}

function _disposeSubModule(): void {
  _rechercheRef = null;
  if (_subDispose) {
    try { _subDispose(); } catch { /* ignore */ }
    _subDispose = null;
  }
}

/**
 * Switch to the Recherche sub-tab and inject *cql*.
 * If the tab is already active, calls prefill directly.
 * If not, sets _pendingPrefill so it fires after mount.
 */
async function _goToRecherche(cql: string): Promise<void> {
  if (_activeTab === "recherche") {
    if (_rechercheRef) {
      // Tab fully mounted — inject immediately.
      _rechercheRef.prefill(cql);
    } else {
      // Tab is currently mounting (_switching=true). Store for _mountTab to consume.
      _pendingPrefill = cql;
    }
  } else {
    _pendingPrefill = cql;
    await _switchTab("recherche");
  }
}

// ─── Welcome hint (concordancier only) ────────────────────────────────────────

function _maybeShowWelcomeHint(container: HTMLElement): void {
  let prefill: string | null = null;
  try { prefill = sessionStorage.getItem("agrafes.explorer.prefill"); } catch { /* */ }
  if (!prefill) return;

  try { sessionStorage.removeItem("agrafes.explorer.prefill"); } catch { /* */ }

  const tryFill = (attempts: number): void => {
    const input = container.querySelector<HTMLInputElement>(
      "input[type='text'], input[type='search'], .search-input, #search-input, #query-input"
    );
    if (input) {
      input.value = prefill!;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const hint = document.createElement("div");
      hint.style.cssText = [
        "position:fixed;bottom:5rem;left:50%;transform:translateX(-50%)",
        "background:#0369a1;color:#fff;font-size:0.82rem;padding:0.4rem 1rem",
        "border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,0.2);z-index:99999",
        "pointer-events:none;opacity:1;transition:opacity 0.4s",
      ].join(";");
      hint.textContent = `Astuce : la barre de recherche est pré-remplie avec « ${prefill} ». Appuyez Entrée pour chercher.`;
      document.body.appendChild(hint);
      const onKeydown = (e: KeyboardEvent): void => {
        if (e.key === "Enter") removeHint();
      };
      const removeHint = (): void => {
        hint.style.opacity = "0";
        setTimeout(() => hint.remove(), 450);
        input.removeEventListener("keydown", onKeydown);
      };
      input.addEventListener("keydown", onKeydown);
      setTimeout(removeHint, 8000);
    } else if (attempts > 0) {
      setTimeout(() => tryFill(attempts - 1), 300);
    }
  };
  setTimeout(() => tryFill(10), 200);
}
