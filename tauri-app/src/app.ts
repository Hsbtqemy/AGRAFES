/**
 * app.ts — Concordancier V0 main application entrypoint.
 *
 * Thin orchestrator: builds UI, resolves initial DB path, starts the sidecar,
 * and wires the cross-module dependency injection calls.
 *
 * All feature logic lives in features/, ui/ and bootstrap.ts.
 */

import { state } from "./state";
import { buildUI } from "./ui/buildUI";
import { updateStatus } from "./ui/status";
import { setMetaOpener, setRerenderCallback } from "./ui/results";
import { renderResults, disposeQuery } from "./features/query";
import { openMetaPanel } from "./features/metaPanel";
import {
  resolveInitialDbPath,
  startSidecar,
  initDeepLinkRuntimeListener,
  disposeBootstrap,
} from "./bootstrap";
import { elt } from "./ui/dom";

// ─── Dependency injection (breaks circular imports) ───────────────────────────

// results.ts needs to call renderResults (from query.ts) and openMetaPanel (from metaPanel.ts)
// but cannot import them directly without creating circular chains.
// These two calls wire them up after all modules are loaded.
setMetaOpener(openMetaPanel);
setRerenderCallback(renderResults);

// ─── Entrypoint ───────────────────────────────────────────────────────────────

export async function initApp(container: HTMLElement): Promise<void> {
  buildUI(container);

  const startup = await resolveInitialDbPath();
  const dbPath = startup.path;
  state.dbPath = dbPath;
  updateStatus();

  await startSidecar(dbPath);
  await initDeepLinkRuntimeListener();

  if (state.status === "ready") {
    if (startup.source === "deep-link") {
      const area = document.getElementById("results-area");
      if (area) {
        const notice = elt("div", { class: "error-banner" });
        notice.style.background = "#eef7ff";
        notice.style.borderColor = "#b6daf9";
        notice.style.color = "#1e4a80";
        notice.textContent = "DB ouverte via deep-link agrafes://open-db.";
        area.prepend(notice);
      }
    }
    (document.getElementById("search-btn") as HTMLButtonElement).disabled = false;
  }
}

/** Disconnect the IntersectionObserver and clear module-level resources. Called by tauri-shell on unmount. */
export function disposeApp(): void {
  disposeQuery();
  disposeBootstrap();
}
