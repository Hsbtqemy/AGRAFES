/**
 * ui/status.ts — Status bar updates and toast notifications.
 */

import { state } from "../state";
import { elt } from "./dom";

export function updateStatus(): void {
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

  const searchBtn = document.getElementById("search-btn") as HTMLButtonElement | null;
  if (searchBtn) {
    if (state.status === "ready") {
      searchBtn.removeAttribute("title");
    } else {
      searchBtn.title = state.status === "starting"
        ? "Sidecar en cours de démarrage…"
        : "Sidecar non disponible — ouvrez une base de données.";
    }
  }
}

/**
 * Display a brief, auto-dismissing toast in the bottom-right corner.
 * Used to give feedback when an action is blocked (e.g. sidecar not ready).
 */
export function showToast(msg: string, durationMs = 3000): void {
  let toast = document.getElementById("app-toast") as HTMLElement | null;
  if (!toast) {
    toast = elt("div", { id: "app-toast", class: "app-toast" });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("visible");
  clearTimeout((toast as HTMLElement & { _timer?: ReturnType<typeof setTimeout> })._timer);
  (toast as HTMLElement & { _timer?: ReturnType<typeof setTimeout> })._timer =
    setTimeout(() => toast!.classList.remove("visible"), durationMs);
}
