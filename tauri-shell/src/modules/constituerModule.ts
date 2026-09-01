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
// Prep design-system CSS is imported EAGERLY at the shell entry (src/main.ts) so
// the whole shell — including the home screen and Explorer — is styled from first
// paint, not only after this lazily-imported module loads. Do not re-import it here.

// ─── Module state ──────────────────────────────────────────────────────────────

let _mounted = false;
let _prepApp: App | null = null;
let _outerContainer: HTMLElement | null = null;

// ─── CSS ───────────────────────────────────────────────────────────────────────

const CONSTITUER_CSS = `
/* Le wrapper direct (#con-prep-wrapper = #app de prep) est une colonne flex bornée
   en hauteur, comme en autonome (index.html #app{height:100%;display:flex}). Ainsi la
   chaîne de hauteur de prep se résout : .prep-shell{flex:1} borne, .prep-main scrolle
   EN INTERNE, et le rail de nav (.prep-nav) reste un side-rail permanent (« sticky »
   par architecture) au lieu de défiler avec la page. .con-subcontent garde overflow:auto
   en filet (si un écran déborde), mais le scroll normal se fait dans .prep-main. */
.con-subcontent {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  position: relative;
}
.con-subcontent > .con-prep-wrapper {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
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

// ─── Commandes (CHR-01) ────────────────────────────────────────────────────────
// Le pont shell → prep. Le shell ne connaît pas `App` ; il passe par ici, et la
// surface se limite aux deux gestes remontés au niveau de la base : la Fiche
// corpus (menu de la base) et le Journal (icône du header). Chacune est sans
// effet si le module n'est pas monté — le shell peut appeler sans vérifier.

/** Vrai si l'app prep est montée et prête à recevoir une commande. */
export function isMounted(): boolean {
  return _mounted && _prepApp !== null;
}

/** Ouvre la Fiche corpus de la base active. */
export function openCorpusInfo(): void {
  _prepApp?.openCorpusInfo();
}

/** Ouvre ou ferme le tiroir du Journal. Renvoie son état après bascule. */
export function toggleJournal(): boolean {
  return _prepApp?.toggleJournal() ?? false;
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
