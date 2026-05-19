/**
 * constituerModule.ts — Shell wrapper for the Prep app.
 *
 * Historiquement, ce module portait deux sous-onglets (« préparer » / «
 * conventions »). Les conventions (rôles d'unités) ont été fusionnées dans la
 * sous-vue Segmentation de prep (onglet « Rôles ») — cf. ticket
 * TICKET_CONVENTIONS_IN_SEGMENTATION. « préparer » étant devenu l'unique
 * contenu, la barre de sous-onglets a été supprimée : `constituer` monte
 * désormais directement l'app prep.
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

// ─── Module state ──────────────────────────────────────────────────────────────

let _mounted = false;
let _prepApp: App | null = null;
let _outerContainer: HTMLElement | null = null;

// ─── CSS ───────────────────────────────────────────────────────────────────────

const CONSTITUER_CSS = `
/* Le wrapper direct (#con-prep-wrapper) prend la hauteur naturelle de son
   contenu ; le scroll se fait au niveau de .con-subcontent. */
.con-subcontent {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  position: relative;
}
.con-subcontent > .con-prep-wrapper {
  min-height: 100%;
}
/* Dans le contexte shell, 44px sont consommés hors de .con-subcontent par le
   header shell fixe (la barre de sous-onglets de 38px ayant été supprimée).
   Le calc() de .prep-seg-split-layout est conçu pour le mode autonome
   (100vh = toute la fenêtre) ; ici la fenêtre utile est 100vh - 44px. */
.con-subcontent .prep-seg-split-layout {
  height: calc(100vh - var(--prep-topbar-h, 54px) - 254px);
}
`;

// ─── Public API ────────────────────────────────────────────────────────────────

export async function mount(
  container: HTMLElement,
  ctx: ShellContext
): Promise<void> {
  // Defensive cleanup: if HMR reset module state without calling dispose(), the
  // outer container may still hold stale content and lost its id="app". Clear it.
  if (container.children.length > 0) {
    container.innerHTML = "";
  }
  _prepApp = null;

  // The shell passes container with id="app". Transfer that id to the sub-content
  // div so tauri-prep's App._buildUI() (uses getElementById("app")) mounts there.
  _outerContainer = container;
  container.removeAttribute("id");

  // Do NOT set height: shell navigation has already set height=calc(100vh-44px)
  // on this element with paddingTop=44px (from _freshContainer).
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.overflow = "hidden";

  // Inject layout CSS once
  if (!document.getElementById("con-layout-css")) {
    const style = document.createElement("style");
    style.id = "con-layout-css";
    style.textContent = CONSTITUER_CSS;
    document.head.appendChild(style);
  }

  // Sub-content area — single wrapper, no sub-tab bar.
  const subContainer = document.createElement("div");
  subContainer.className = "con-subcontent";
  container.appendChild(subContainer);

  const dbPath = ctx.getDbPath();
  if (dbPath) setCurrentDbPath(dbPath);

  // tauri-prep's App._buildUI() mounts into document.getElementById("app").
  // We use a wrapper div so that .con-subcontent > .con-prep-wrapper { height:
  // 100% } targets only this single child.
  const wrapper = document.createElement("div");
  wrapper.className = "con-prep-wrapper";
  wrapper.id = "app";
  wrapper.style.paddingTop = "0"; // override index.html #app { padding-top: 44px }
  subContainer.appendChild(wrapper);

  _prepApp = new App();
  await _prepApp.init();
  _mounted = true;
}

export function dispose(): void {
  // Always restore id="app" on the outer container — even if _mounted is false
  // (e.g. after Vite HMR resets module-level state without calling dispose()).
  if (_outerContainer) { _outerContainer.id = "app"; _outerContainer = null; }
  if (!_mounted) return;
  try { _prepApp?.dispose(); } catch { /* ignore */ }
  _prepApp = null;
  _mounted = false;
}
