/**
 * bootstrap.ts — Sidecar lifecycle: start, health, DB switch, deep-link handling.
 */

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrent as getCurrentDeepLinks, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  ensureRunning,
  SidecarError,
  shutdownSidecar,
  resetConnection,
} from "./lib/sidecarClient";
import { getOrCreateDefaultDbPath, setCurrentDbPath } from "./lib/db";
import { state, DEEP_LINK_SCHEME } from "./state";
import { elt } from "./ui/dom";
import { updateStatus, showToast } from "./ui/status";
import { loadDocsForFilters } from "./features/filters";

// ─── Deep-link unlisten handle ────────────────────────────────────────────────

let _deepLinkUnlisten: (() => void) | null = null;

export function disposeBootstrap(): void {
  if (_deepLinkUnlisten) {
    _deepLinkUnlisten();
    _deepLinkUnlisten = null;
  }
}

// ─── DB path helpers ──────────────────────────────────────────────────────────

function isDbPathCandidate(path: string): boolean {
  return /\.(db|sqlite|sqlite3)$/i.test(path);
}

function parseOpenDbDeepLink(uri: string): string | null {
  try {
    const u = new URL(uri);
    if (u.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
    const hostPath = (u.hostname || u.pathname || "").replace(/^\/+/, "").toLowerCase();
    if (hostPath !== "open-db") return null;
    const dbPath = (u.searchParams.get("path") ?? u.searchParams.get("db") ?? "").trim();
    if (!dbPath || !isDbPathCandidate(dbPath)) return null;
    return dbPath;
  } catch {
    return null;
  }
}

function firstDeepLinkDbPath(urls: readonly string[]): string | null {
  for (const raw of urls) {
    const parsed = parseOpenDbDeepLink(raw);
    if (parsed) return parsed;
  }
  return null;
}

function dbPathFromUrlSearch(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get("open_db") ?? params.get("db") ?? params.get("path") ?? "").trim();
    if (!raw || !isDbPathCandidate(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function resolveInitialDbPath(): Promise<{ path: string; source: "deep-link" | "default" }> {
  const fromSearch = dbPathFromUrlSearch();
  if (fromSearch) {
    setCurrentDbPath(fromSearch);
    return { path: fromSearch, source: "deep-link" };
  }
  try {
    const initialLinks = await getCurrentDeepLinks();
    const deepLinkedPath = firstDeepLinkDbPath(initialLinks ?? []);
    if (deepLinkedPath) {
      setCurrentDbPath(deepLinkedPath);
      return { path: deepLinkedPath, source: "deep-link" };
    }
  } catch {
    // no deep-link payload available at startup (normal path)
  }
  const fallback = await getOrCreateDefaultDbPath();
  return { path: fallback, source: "default" };
}

// ─── Sidecar lifecycle ────────────────────────────────────────────────────────

export async function startSidecar(dbPath: string): Promise<void> {
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
    state.statusMsg = err instanceof SidecarError ? err.message : String(err);
    updateStatus();
    const area = document.getElementById("results-area");
    if (area) {
      area.innerHTML = "";
      const errDiv = elt("div", { class: "error-banner" });
      const errMsg = elt("span");
      errMsg.textContent = `Impossible de démarrer le sidecar : ${state.statusMsg}`;
      const retryBtn = elt("button", { class: "btn btn-secondary", style: "margin-left:12px;font-size:12px;" }, "Réessayer");
      retryBtn.addEventListener("click", () => {
        if (state.dbPath) void startSidecar(state.dbPath);
      });
      errDiv.appendChild(errMsg);
      errDiv.appendChild(retryBtn);
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
  void loadDocsForFilters();
  (document.getElementById("search-input") as HTMLInputElement | null)?.focus();
}

export async function switchDbPath(
  newPath: string,
  source: "dialog" | "deep-link" = "dialog",
): Promise<void> {
  if (!newPath || !isDbPathCandidate(newPath)) return;
  if (state.dbPath === newPath && state.conn) return;

  if (state.conn) {
    try {
      await shutdownSidecar(state.conn);
    } catch {
      // Sidecar may already be dead — proceed with reset regardless
    }
  }
  resetConnection();
  state.conn = null;
  setCurrentDbPath(newPath);
  state.dbPath = newPath;
  await startSidecar(newPath);

  if (source === "deep-link" && state.status === "ready") {
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
}

export async function doOpenDb(): Promise<void> {
  const selected = await openDialog({
    title: "Ouvrir un corpus (fichier .db)",
    filters: [{ name: "SQLite DB", extensions: ["db"] }],
    multiple: false,
  });
  if (!selected || Array.isArray(selected)) return;
  await switchDbPath(selected);
}

export async function initDeepLinkRuntimeListener(): Promise<void> {
  try {
    _deepLinkUnlisten = await onOpenUrl((urls) => {
      const deepLinkedPath = firstDeepLinkDbPath(urls);
      if (!deepLinkedPath) return;
      void switchDbPath(deepLinkedPath, "deep-link").catch((err: unknown) => {
        showToast(`Erreur deep-link : ${err instanceof SidecarError ? (err as SidecarError).message : String(err)}`);
      });
    });
  } catch {
    _deepLinkUnlisten = null;
  }
}
