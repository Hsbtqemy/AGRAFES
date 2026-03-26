/**
 * shellMru.ts — Most-Recently-Used DB list: load, save, build UI section.
 *
 * Pure data functions (loadMru, saveMru, addToMru, …) have no side effects.
 * UI functions (buildMruSection, rebuildMruMenu, checkMruPaths) accept
 * callbacks for shell-level actions to avoid circular imports with shell.ts.
 *
 * Imports only from shellState.
 */

import { shellState, LS_DB_RECENT, MRU_MAX } from "./shellState.ts";
import type { MruEntry } from "./shellState.ts";

// ─── Pure data helpers ────────────────────────────────────────────────────────

export function loadMru(): MruEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LS_DB_RECENT) ?? "[]") as MruEntry[];
  } catch { return []; }
}

export function saveMru(list: MruEntry[]): void {
  try { localStorage.setItem(LS_DB_RECENT, JSON.stringify(list)); } catch { /* */ }
}

export function pathLabel(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

export function addToMru(path: string): void {
  const label = pathLabel(path);
  const now = new Date().toISOString();
  let list = loadMru().filter(e => e.path !== path);
  list.unshift({ path, label, last_opened_at: now });
  if (list.length > MRU_MAX) list = list.slice(0, MRU_MAX);
  saveMru(list);
}

export function removeFromMru(path: string): void {
  saveMru(loadMru().filter(e => e.path !== path));
}

export function togglePinMru(path: string): void {
  saveMru(loadMru().map(e => e.path === path ? { ...e, pinned: !e.pinned } : e));
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

export interface MruCallbacks {
  closeDbMenu: () => void;
  onChangeDb: (path: string) => void;
  switchDb: (path: string) => void;
  esc: (s: string) => string;
}

export function buildMruSection(cb: MruCallbacks): HTMLElement {
  const list = loadMru();
  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "shell-mru-section";
    return empty;
  }

  const section = document.createElement("div");
  section.className = "shell-mru-section";

  const sep = document.createElement("div");
  sep.className = "shell-db-menu-sep";
  section.appendChild(sep);

  const heading = document.createElement("div");
  heading.className = "shell-mru-heading";
  heading.textContent = "Récents";
  section.appendChild(heading);

  // Pinned first, then by last_opened_at desc
  const sorted = [...list].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.last_opened_at.localeCompare(a.last_opened_at);
  });

  for (const entry of sorted) {
    const row = document.createElement("div");
    row.className = `shell-mru-row${entry.missing ? " missing" : ""}`;

    const nameBtn = document.createElement("button");
    nameBtn.className = "shell-mru-name";
    nameBtn.title = entry.path;
    nameBtn.innerHTML = `${entry.pinned ? "📌 " : ""}${cb.esc(entry.label)}${
      entry.missing ? ' <span class="shell-mru-missing-badge">introuvable</span>' : ""
    }`;
    nameBtn.addEventListener("click", () => {
      cb.closeDbMenu();
      if (entry.missing) {
        cb.onChangeDb(entry.path);
      } else {
        cb.switchDb(entry.path);
      }
    });
    row.appendChild(nameBtn);

    const actions = document.createElement("div");
    actions.className = "shell-mru-actions";

    const pinBtn = document.createElement("button");
    pinBtn.className = "shell-mru-action";
    pinBtn.title = entry.pinned ? "Désépingler" : "Épingler";
    pinBtn.textContent = entry.pinned ? "📌" : "📍";
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePinMru(entry.path);
      rebuildMruMenu(cb);
    });
    actions.appendChild(pinBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "shell-mru-action";
    delBtn.title = "Retirer des récents";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeFromMru(entry.path);
      rebuildMruMenu(cb);
    });
    actions.appendChild(delBtn);

    row.appendChild(actions);
    section.appendChild(row);
  }
  return section;
}

/** Rebuild only the MRU section inside the DB menu (without full header rebuild). */
export function rebuildMruMenu(cb: MruCallbacks): void {
  const menu = document.getElementById("shell-db-menu");
  if (!menu) return;
  const section = menu.querySelector(".shell-mru-section");
  if (section) section.replaceWith(buildMruSection(cb));
}

/** Async: mark entries as missing if the file does not exist, then rebuild. */
export async function checkMruPaths(cb: MruCallbacks): Promise<void> {
  const { exists } = await import("@tauri-apps/plugin-fs").catch(() => ({ exists: null }));
  if (!exists) return;
  const list = loadMru();
  let changed = false;
  for (const entry of list) {
    try {
      const ok = await exists(entry.path);
      if (entry.missing !== !ok) { entry.missing = !ok; changed = true; }
    } catch { entry.missing = false; }
  }
  if (changed) { saveMru(list); rebuildMruMenu(cb); }
}
