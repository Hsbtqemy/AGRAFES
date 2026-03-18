/**
 * docSelector.ts — Multi-document selector embedded in the filter drawer.
 *
 * Shows a scrollable checklist of all documents, with "Tous / Aucun" shortcuts.
 * Selection is inclusive: checked = included in next search.
 * Persists per-DB selection in localStorage.
 */

import type { DocumentRecord } from "../lib/sidecarClient";
import { state } from "../state";
import { elt } from "../ui/dom";

const LS_KEY_PREFIX = "agrafes.docsel.";

// ─── Persistence ─────────────────────────────────────────────────────────────

function _lsKey(dbPath: string): string {
  return LS_KEY_PREFIX + btoa(encodeURIComponent(dbPath));
}

export function saveDocSelectorState(dbPath: string): void {
  if (!dbPath) return;
  const key = _lsKey(dbPath);
  if (state.filterDocIds === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify(state.filterDocIds));
  }
}

export function loadDocSelectorState(
  docs: DocumentRecord[],
  dbPath: string
): void {
  if (!dbPath) return;
  const raw = localStorage.getItem(_lsKey(dbPath));
  if (!raw) {
    state.filterDocIds = null;
    return;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(x => typeof x === "number")) {
      const allIds = new Set(docs.map(d => d.doc_id));
      const valid = (parsed as number[]).filter(id => allIds.has(id));
      // If all docs are still selected (or nothing was saved), treat as null (no filter)
      state.filterDocIds = valid.length === docs.length ? null : valid;
      return;
    }
  } catch {
    /* ignore */
  }
  state.filterDocIds = null;
}

// ─── Mount ────────────────────────────────────────────────────────────────────

/**
 * Mount the doc selector into #doc-selector-mount.
 * @param docs        Full list of documents from the sidecar.
 * @param dbPath      Current DB path — used as localStorage key.
 * @param onChanged   Callback after every selection change (e.g. renderChips).
 */
export function mountDocSelector(
  docs: DocumentRecord[],
  dbPath: string,
  onChanged: () => void
): void {
  const mount = document.getElementById("doc-selector-mount");
  if (!mount) return;
  mount.innerHTML = "";

  if (docs.length === 0) {
    mount.appendChild(elt("span", { class: "doc-sel-empty" }, "Aucun document indexé"));
    return;
  }

  // ── Header: label + Tous / Aucun shortcuts ──
  const header = elt("div", { class: "doc-sel-header" });
  header.appendChild(elt("label", { class: "doc-sel-label" }, "Documents"));

  const btnWrap = elt("div", { class: "doc-sel-btns" });
  const allBtn = elt("button", { class: "doc-sel-btn", type: "button" }, "Tous") as HTMLButtonElement;
  const noneBtn = elt("button", { class: "doc-sel-btn", type: "button" }, "Aucun") as HTMLButtonElement;
  btnWrap.appendChild(allBtn);
  btnWrap.appendChild(noneBtn);
  header.appendChild(btnWrap);
  mount.appendChild(header);

  // ── Scrollable checklist ──
  const list = elt("div", { class: "doc-sel-list" });
  const checkboxes: HTMLInputElement[] = [];

  for (const doc of docs) {
    const row = elt("label", { class: "doc-sel-row", title: doc.title || `Doc #${doc.doc_id}` });
    const cb = elt("input", { type: "checkbox" }) as HTMLInputElement;
    cb.dataset.docId = String(doc.doc_id);
    cb.checked = state.filterDocIds === null || state.filterDocIds.includes(doc.doc_id);

    const lang = elt(
      "span",
      { class: "doc-sel-lang" },
      (doc.language?.slice(0, 2) ?? "??").toUpperCase()
    );
    const titleEl = elt("span", { class: "doc-sel-title" });
    const raw = doc.title || `Doc #${doc.doc_id}`;
    titleEl.textContent = raw.length > 38 ? raw.slice(0, 37) + "…" : raw;

    row.appendChild(cb);
    row.appendChild(lang);
    row.appendChild(titleEl);
    list.appendChild(row);
    checkboxes.push(cb);

    cb.addEventListener("change", () => {
      _syncFromCheckboxes(checkboxes, docs, dbPath);
      onChanged();
    });
  }

  mount.appendChild(list);

  // ── Shortcuts ──
  allBtn.addEventListener("click", () => {
    checkboxes.forEach(cb => { cb.checked = true; });
    state.filterDocIds = null;
    saveDocSelectorState(dbPath);
    onChanged();
  });

  noneBtn.addEventListener("click", () => {
    checkboxes.forEach(cb => { cb.checked = false; });
    state.filterDocIds = [];
    saveDocSelectorState(dbPath);
    onChanged();
  });
}

// ─── Sync helpers ─────────────────────────────────────────────────────────────

function _syncFromCheckboxes(
  checkboxes: HTMLInputElement[],
  docs: DocumentRecord[],
  dbPath: string
): void {
  const selected = checkboxes
    .filter(cb => cb.checked)
    .map(cb => parseInt(cb.dataset.docId!, 10));
  state.filterDocIds = selected.length === docs.length ? null : selected;
  saveDocSelectorState(dbPath);
}

/**
 * Sync the checkboxes UI to the current state.filterDocIds value.
 * Call after externally mutating state.filterDocIds (e.g. from meta panel or facet chips).
 */
export function syncDocSelectorUI(): void {
  const mount = document.getElementById("doc-selector-mount");
  if (!mount) return;
  mount.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach(cb => {
    const docId = parseInt(cb.dataset.docId!, 10);
    cb.checked = state.filterDocIds === null || state.filterDocIds.includes(docId);
  });
}

/** Reset selection to "all" and persist. */
export function clearDocSelector(dbPath: string): void {
  state.filterDocIds = null;
  saveDocSelectorState(dbPath);
  syncDocSelectorUI();
}
