/**
 * features/filters.ts — Document filter dropdowns, chips bar, and doc lookup map.
 */

import type { DocumentRecord, FamilyRecord } from "../lib/sidecarClient";
import { listDocuments, listFamilies } from "../lib/sidecarClient";
import { state } from "../state";
import { elt } from "../ui/dom";
import {
  mountDocSelector,
  loadDocSelectorState,
  clearDocSelector,
} from "./docSelector";

/** Fast doc lookup for meta panel (populated when docs are loaded). */
export const docsById: Map<number, DocumentRecord> = new Map();

/**
 * Threshold above which a soft notice is shown in the filter area warning that
 * the corpus is large and some filter interactions may be slower.
 */
const LARGE_CORPUS_WARN = 2000;

export async function loadDocsForFilters(): Promise<void> {
  if (!state.conn) return;
  try {
    state.docs = await listDocuments(state.conn);
    docsById.clear();
    for (const doc of state.docs) docsById.set(doc.doc_id, doc);
    populateFilterDropdowns();
    _setLargeCorpusNotice(state.docs.length);
    // Restore saved doc selection, then mount the selector
    const dbPath = state.dbPath ?? "";
    loadDocSelectorState(state.docs, dbPath);
    mountDocSelector(state.docs, dbPath, () => renderChips());
  } catch {
    // non-critical — filters stay operational
  }
}

/** Load families from the backend and populate the family filter dropdown. */
export async function loadFamiliesForFilter(): Promise<void> {
  if (!state.conn) return;
  try {
    state.families = await listFamilies(state.conn);
    populateFamilyFilterDropdown(state.families);
  } catch {
    // non-critical
  }
}

export function populateFamilyFilterDropdown(families: FamilyRecord[]): void {
  const sel = document.getElementById("filter-family-sel") as HTMLSelectElement | null;
  if (!sel) return;
  sel.innerHTML = `<option value="">Toutes les familles</option>`;
  for (const fam of families) {
    const label = fam.parent?.title
      ? `${fam.parent.title} (${fam.stats.total_docs} docs)`
      : `Famille #${fam.family_id} (${fam.stats.total_docs} docs)`;
    const opt = document.createElement("option");
    opt.value = String(fam.family_id);
    opt.textContent = label;
    if (fam.family_id === state.filterFamilyId) opt.selected = true;
    sel.appendChild(opt);
  }
}

export { clearDocSelector };

/** Shows or hides a soft corpus-size notice near the document filters. */
function _setLargeCorpusNotice(count: number): void {
  const existing = document.getElementById("large-corpus-notice");
  if (count <= LARGE_CORPUS_WARN) {
    existing?.remove();
    return;
  }
  if (existing) return; // already displayed
  const bar = document.getElementById("chips-bar");
  if (!bar?.parentElement) return;
  const notice = document.createElement("div");
  notice.id = "large-corpus-notice";
  notice.className = "large-corpus-notice";
  notice.title = `${count} documents indexés dans ce corpus`;
  notice.textContent = `ℹ ${count} documents — le filtre par doc_id est recommandé pour cibler un document précis.`;
  bar.parentElement.insertBefore(notice, bar);
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

  // Family filter chip
  if (state.filterFamilyId !== null) {
    const fam = state.families.find(f => f.family_id === state.filterFamilyId);
    const label = fam?.parent?.title ?? `Famille #${state.filterFamilyId}`;
    add("Famille", label + (state.filterFamilyPivotOnly ? " (original)" : ""), () => {
      state.filterFamilyId = null;
      state.filterFamilyPivotOnly = false;
      const s = document.getElementById("filter-family-sel") as HTMLSelectElement | null;
      if (s) s.value = "";
      const cb = document.getElementById("filter-family-pivot-only") as HTMLInputElement | null;
      if (cb) cb.checked = false;
    });
  }

  // Doc selection chip — shown when a subset (not all) is selected
  if (state.filterDocIds !== null) {
    const total = state.docs.length;
    const n = state.filterDocIds.length;
    if (n === 0) {
      // Nothing selected — warn the user
      const chip = elt("div", { class: "chip chip--warn" });
      chip.appendChild(document.createTextNode("Docs: aucun sélectionné ⚠"));
      const removeBtn = elt("button", { class: "chip-remove", title: "Sélectionner tous les documents", type: "button" }, "\u00d7") as HTMLButtonElement;
      removeBtn.addEventListener("click", () => {
        clearDocSelector(state.dbPath ?? "");
        renderChips();
      });
      chip.appendChild(removeBtn);
      bar.appendChild(chip);
    } else {
      const label = n === 1
        ? (state.docs.find(d => d.doc_id === state.filterDocIds![0])?.title ?? `Doc #${state.filterDocIds[0]}`)
        : `${n} / ${total} docs`;
      add("Docs", label, () => {
        clearDocSelector(state.dbPath ?? "");
      });
    }
  }

  bar.style.display = bar.children.length > 0 ? "" : "none";
}
