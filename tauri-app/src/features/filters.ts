/**
 * features/filters.ts — Document filter dropdowns, chips bar, and doc lookup map.
 */

import type { DocumentRecord } from "../lib/sidecarClient";
import { listDocuments } from "../lib/sidecarClient";
import { state } from "../state";
import { elt } from "../ui/dom";

/** Fast doc lookup for meta panel (populated when docs are loaded). */
export const docsById: Map<number, DocumentRecord> = new Map();

export async function loadDocsForFilters(): Promise<void> {
  if (!state.conn) return;
  try {
    state.docs = await listDocuments(state.conn);
    docsById.clear();
    for (const doc of state.docs) docsById.set(doc.doc_id, doc);
    populateFilterDropdowns();
  } catch {
    // non-critical — filters stay free-text
  }
}

export function populateFilterDropdowns(): void {
  const langs = [...new Set(state.docs.map(d => d.language).filter(Boolean))].sort();
  const roles = [...new Set(state.docs.map(d => d.doc_role).filter((r): r is string => r != null))].sort();
  const resTypes = [...new Set(state.docs.map(d => d.resource_type).filter((r): r is string => r != null))].sort();

  fillSelect("filter-lang-sel", langs, state.filterLang);
  fillSelect("filter-role-sel", roles, state.filterRole);
  fillSelect("filter-restype-sel", resTypes, state.filterResourceType);
}

function fillSelect(id: string, values: string[], currentVal: string): void {
  const sel = document.getElementById(id) as HTMLSelectElement | null;
  if (!sel) return;
  const prev = sel.value || currentVal;
  sel.innerHTML = `<option value="">Tous</option>`;
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    if (v === prev) opt.selected = true;
    sel.appendChild(opt);
  }
}

export function renderChips(): void {
  const bar = document.getElementById("chips-bar");
  if (!bar) return;
  bar.innerHTML = "";

  const add = (label: string, value: string, clear: () => void): void => {
    const chip = elt("div", { class: "chip" });
    chip.appendChild(document.createTextNode(`${label}: ${value}`));
    const removeBtn = elt("button", { class: "chip-remove", title: "Supprimer ce filtre", type: "button" }, "\u00d7") as HTMLButtonElement;
    removeBtn.addEventListener("click", () => { clear(); renderChips(); });
    chip.appendChild(removeBtn);
    bar.appendChild(chip);
  };

  if (state.filterLang) add("Langue", state.filterLang, () => {
    state.filterLang = "";
    const s = document.getElementById("filter-lang-sel") as HTMLSelectElement | null;
    if (s) s.value = "";
  });
  if (state.filterRole) add("Rôle", state.filterRole, () => {
    state.filterRole = "";
    const s = document.getElementById("filter-role-sel") as HTMLSelectElement | null;
    if (s) s.value = "";
  });
  if (state.filterResourceType) add("Type", state.filterResourceType, () => {
    state.filterResourceType = "";
    const s = document.getElementById("filter-restype-sel") as HTMLSelectElement | null;
    if (s) s.value = "";
  });
  if (state.filterDocId) add("Doc ID", state.filterDocId, () => {
    state.filterDocId = "";
    const inp = document.getElementById("filter-docid") as HTMLInputElement | null;
    if (inp) inp.value = "";
  });

  bar.style.display = bar.children.length > 0 ? "" : "none";
}
