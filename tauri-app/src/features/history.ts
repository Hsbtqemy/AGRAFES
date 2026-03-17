/**
 * features/history.ts — Search history persistence (localStorage) and panel rendering.
 */

import { state } from "../state";
import { elt } from "../ui/dom";
import { doSearch } from "./query";
import { renderChips, clearDocSelector } from "./filters";
import { syncDocSelectorUI, saveDocSelectorState } from "./docSelector";
import { updateFtsPreview } from "./search";

// ─── Types + constants ────────────────────────────────────────────────────────

export interface HistoryItem {
  ts: number;
  raw: string;
  fts: string;
  mode: string;
  filters: {
    lang: string;
    role: string;
    resourceType: string;
    /** @deprecated use docIds */ docId?: string;
    docIds: number[] | null;
  };
  aligned: boolean;
  parallel: boolean;
  pinned?: boolean;
}

const LS_HISTORY = "agrafes.explorer.history";
const MAX_HISTORY = 10;

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function saveToHistory(raw: string, fts: string): void {
  if (!raw.trim()) return;
  const item: HistoryItem = {
    ts: Date.now(),
    raw,
    fts,
    mode: state.builderMode,
    filters: {
      lang: state.filterLang,
      role: state.filterRole,
      resourceType: state.filterResourceType,
      docIds: state.filterDocIds,
    },
    aligned: state.showAligned,
    parallel: state.showParallel,
    pinned: false,
  };
  const hist = loadHistory().filter(h => h.pinned || !(h.raw === raw && h.fts === fts));
  hist.unshift(item);
  const pinned = hist.filter(h => h.pinned).slice(0, 3);
  const unpinned = hist.filter(h => !h.pinned).slice(0, MAX_HISTORY);
  try { localStorage.setItem(LS_HISTORY, JSON.stringify([...pinned, ...unpinned])); } catch { /* ignore */ }
}

export function loadHistory(): HistoryItem[] {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) ?? "[]") as HistoryItem[]; }
  catch { return []; }
}

export function clearHistory(): void {
  const pinned = loadHistory().filter(h => h.pinned);
  try { localStorage.setItem(LS_HISTORY, JSON.stringify(pinned)); } catch { /* ignore */ }
}

export function clearAllHistory(): void {
  localStorage.removeItem(LS_HISTORY);
}

export function togglePin(raw: string, fts: string): void {
  const hist = loadHistory();
  const idx = hist.findIndex(h => h.raw === raw && h.fts === fts);
  if (idx === -1) return;
  hist[idx].pinned = !hist[idx].pinned;
  const pinned = hist.filter(h => h.pinned).slice(0, 3);
  const unpinned = hist.filter(h => !h.pinned).slice(0, MAX_HISTORY);
  try { localStorage.setItem(LS_HISTORY, JSON.stringify([...pinned, ...unpinned])); } catch { /* ignore */ }
}

// ─── Relative time ────────────────────────────────────────────────────────────

export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "< 1 min";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h`;
  return `${Math.floor(diff / 86_400_000)} j`;
}

// ─── Panel rendering ──────────────────────────────────────────────────────────

export function renderHistPanel(panel: HTMLElement, searchInput: HTMLInputElement): void {
  panel.innerHTML = "";

  const header = elt("div", { class: "hist-panel-header" });
  header.appendChild(document.createTextNode("Historique des recherches"));
  const headerBtns = elt("div", { style: "display:flex;gap:4px" });
  const clearBtn = elt("button", { class: "btn btn-ghost", style: "font-size:0.75rem;padding:2px 8px" }, "Vider");
  clearBtn.title = "Effacer l'historique (garde les favoris ⭐)";
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearHistory();
    renderHistPanel(panel, searchInput);
  });
  const clearAllBtn = elt("button", { class: "btn btn-ghost", style: "font-size:0.75rem;padding:2px 8px" }, "Tout effacer");
  clearAllBtn.title = "Effacer tout l'historique y compris les favoris";
  clearAllBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearAllHistory();
    renderHistPanel(panel, searchInput);
  });
  headerBtns.appendChild(clearBtn);
  headerBtns.appendChild(clearAllBtn);
  header.appendChild(headerBtns);
  panel.appendChild(header);

  const hist = loadHistory();
  const pinned = hist.filter(h => h.pinned);
  const unpinned = hist.filter(h => !h.pinned);
  const list = elt("div", { class: "hist-list" });

  if (hist.length === 0) {
    list.appendChild(elt("div", { class: "hist-empty" }, "Aucune recherche enregistrée"));
  } else {
    const renderItem = (item: HistoryItem): void => {
      const row = elt("div", { class: "hist-item" + (item.pinned ? " hist-item-pinned" : "") });

      const pinBtn = elt("button", {
        class: "hist-pin-btn" + (item.pinned ? " pinned" : ""),
        title: item.pinned ? "Désépingler" : "Épingler comme favori",
        type: "button",
      }, item.pinned ? "⭐" : "☆") as HTMLButtonElement;
      pinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePin(item.raw, item.fts);
        renderHistPanel(panel, searchInput);
      });

      const textDiv = elt("div", { class: "hist-item-text" });
      textDiv.appendChild(elt("div", { class: "hist-item-fts" }, item.fts || item.raw));
      const chips: string[] = [];
      if (item.filters.lang) chips.push(`lang:${item.filters.lang}`);
      if (item.filters.role) chips.push(`rôle:${item.filters.role}`);
      if (item.filters.resourceType) chips.push(`type:${item.filters.resourceType}`);
      if (item.aligned) chips.push("alignés");
      textDiv.appendChild(elt("div", { class: "hist-item-meta" }, chips.join(" · ") || "\u00a0"));
      const timeEl = elt("div", { class: "hist-item-time" }, relTime(item.ts));

      row.appendChild(pinBtn);
      row.appendChild(textDiv);
      row.appendChild(timeEl);

      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".hist-pin-btn")) return;
        panel.classList.remove("open");
        searchInput.value = item.raw;
        state.filterLang = item.filters.lang;
        state.filterRole = item.filters.role;
        state.filterResourceType = item.filters.resourceType;
        // Restore docIds — cast to permissive type to handle legacy entries
        const f = item.filters as { lang: string; role: string; resourceType: string; docId?: string; docIds?: number[] | null };
        if (f.docIds !== undefined) {
          state.filterDocIds = f.docIds;
        } else if (f.docId) {
          state.filterDocIds = [parseInt(f.docId, 10)];
        } else {
          state.filterDocIds = null;
        }
        saveDocSelectorState(state.dbPath ?? "");
        syncDocSelectorUI();
        state.showAligned = item.aligned;
        state.showParallel = item.parallel;
        state.builderMode = item.mode as typeof state.builderMode;
        // Sync builder radio buttons to the restored mode.
        const restoredRadio = document.querySelector<HTMLInputElement>(
          `input[name='builder-mode'][value='${state.builderMode}']`
        );
        if (restoredRadio) restoredRadio.checked = true;
        // Show/hide the NEAR N control based on restored mode.
        const nearCtrl = document.getElementById("near-n-ctrl") as HTMLElement | null;
        if (nearCtrl) nearCtrl.style.display = state.builderMode === "near" ? "flex" : "none";
        updateFtsPreview(item.raw);
        renderChips();
        void doSearch(item.raw);
      });
      list.appendChild(row);
    };

    if (pinned.length > 0) {
      list.appendChild(elt("div", { class: "hist-divider" }, "⭐ Favoris"));
      for (const item of pinned) renderItem(item);
    }
    if (unpinned.length > 0) {
      if (pinned.length > 0) list.appendChild(elt("div", { class: "hist-divider" }, "Récents"));
      for (const item of unpinned) renderItem(item);
    }
  }
  panel.appendChild(list);
}
