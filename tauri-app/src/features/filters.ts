/**
 * features/filters.ts — Document filter dropdowns, chips bar, and doc lookup map.
 */

import type { DocumentRecord, FamilyRecord, DocTag } from "../lib/sidecarClient";
import { listDocuments, listFamilies, listTags } from "../lib/sidecarClient";
import { compareDocsByTitle, compareLocale } from "../../../shared/docSort.ts";
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
    // `/documents` rend l'ordre doc_id, c'est-à-dire l'ordre d'import : illisible dès
    // qu'il y a plus d'une poignée de documents. Le tri est posé ICI plutôt qu'à chaque
    // affichage, pour que la liste déroulante, la checklist et `docsById` partagent le
    // même ordre.
    state.docs = [...await listDocuments(state.conn)].sort(compareDocsByTitle);
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
  // `sort()` nu classe par point de code : « Œuvre » passerait après « Zone », et les
  // libellés de type de ressource sont saisis en français. Même collator que les titres.
  const langs = [...new Set(state.docs.map(d => d.language).filter(Boolean))].sort(compareLocale);
  const roles = [...new Set(state.docs.map(d => d.doc_role).filter((r): r is string => r != null))].sort(compareLocale);
  const resTypes = [...new Set(state.docs.map(d => d.resource_type).filter((r): r is string => r != null))].sort(compareLocale);

  populateLangCheckboxes(langs);
  fillSelect("filter-role-sel", roles, state.filterRole);
  fillSelect("filter-restype-sel", resTypes, state.filterResourceType);
  // unit_status has fixed options (built in buildUI) — just restore the value.
  const statusSel = document.getElementById("filter-unitstatus-sel") as HTMLSelectElement | null;
  if (statusSel) statusSel.value = state.filterUnitStatus;
  void populateTagOptions();
}

/** Fetch the corpus's distinct tags (R6.2) and fill the tag filter dropdown. */
export async function populateTagOptions(): Promise<void> {
  const sel = document.getElementById("filter-tag-sel") as HTMLSelectElement | null;
  if (!sel || !state.conn) return;
  try {
    state.availableTags = await listTags(state.conn);
  } catch {
    state.availableTags = [];
  }
  sel.innerHTML = `<option value="">— étiquette —</option>`;
  state.availableTags.forEach((t: DocTag, i: number) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${t.kind}: ${t.value}`;
    sel.appendChild(opt);
  });
}

/** Add the tag currently selected in the dropdown to the active filter (R6.2). */
export function addSelectedTag(): void {
  const sel = document.getElementById("filter-tag-sel") as HTMLSelectElement | null;
  if (!sel || !sel.value) return;
  const t = state.availableTags[parseInt(sel.value, 10)];
  sel.value = "";
  if (!t) return;
  if (!state.filterTags.some(x => x.kind === t.kind && x.value === t.value)) {
    state.filterTags = [...state.filterTags, t];
    renderChips();
  }
}

/** Human label for a unit_status value (R4.1). */
export function unitStatusLabel(status: string): string {
  return status === "non_traduit" ? "Non traduit" : status === "ajout" ? "Ajout" : status;
}

/** Rebuild the language checkbox list and restore selected state. */
export function populateLangCheckboxes(langs?: string[]): void {
  const container = document.getElementById("filter-lang-checkboxes");
  if (!container) return;
  const available = langs ?? [...new Set(state.docs.map(d => d.language).filter(Boolean))].sort(compareLocale);
  container.innerHTML = "";
  for (const lang of available) {
    const id = `filter-lang-cb-${lang}`;
    const wrap = document.createElement("label");
    wrap.className = "lang-cb-label";
    wrap.htmlFor = id;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.value = lang;
    cb.checked = state.filterLangs.includes(lang);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (!state.filterLangs.includes(lang)) state.filterLangs = [...state.filterLangs, lang];
      } else {
        state.filterLangs = state.filterLangs.filter(l => l !== lang);
      }
      _updateLangBtnLabel();
      renderChips();
    });
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(" " + lang));
    container.appendChild(wrap);
  }
}

function _updateLangBtnLabel(): void {
  const btn = document.getElementById("filter-lang-btn");
  if (!btn) return;
  btn.textContent = state.filterLangs.length === 0
    ? "Langue ▾"
    : `Langue : ${state.filterLangs.join(", ")} ▾`;
  btn.classList.toggle("app-active", state.filterLangs.length > 0);
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
    const chip = elt("div", { class: "app-chip" });
    chip.appendChild(document.createTextNode(`${label}: ${value}`));
    const removeBtn = elt("button", { class: "app-chip-remove", title: "Supprimer ce filtre", type: "button" }, "\u00d7") as HTMLButtonElement;
    removeBtn.addEventListener("click", () => { clear(); renderChips(); });
    chip.appendChild(removeBtn);
    bar.appendChild(chip);
  };

  if (state.filterLangs.length > 0) {
    add("Langue", state.filterLangs.join(", "), () => {
      state.filterLangs = [];
      // Uncheck all lang checkboxes
      document.querySelectorAll<HTMLInputElement>("#filter-lang-checkboxes input[type=checkbox]").forEach(cb => { cb.checked = false; });
      const btn = document.getElementById("filter-lang-btn");
      if (btn) { btn.textContent = "Langue ▾"; btn.classList.remove("app-active"); }
    });
  }
  if (state.filterRole) add("Rôle", state.filterRole, () => {
    state.filterRole = "";
    const s = document.getElementById("filter-role-sel") as HTMLSelectElement | null;
    if (s) s.value = "";
  });
  if (state.filterUnitStatus) add("Statut", unitStatusLabel(state.filterUnitStatus), () => {
    state.filterUnitStatus = "";
    const s = document.getElementById("filter-unitstatus-sel") as HTMLSelectElement | null;
    if (s) s.value = "";
  });
  if (state.filterResourceType) add("Type", state.filterResourceType, () => {
    state.filterResourceType = "";
    const s = document.getElementById("filter-restype-sel") as HTMLSelectElement | null;
    if (s) s.value = "";
  });

  for (const tag of state.filterTags) {
    add("Étiquette", `${tag.kind}: ${tag.value}`, () => {
      state.filterTags = state.filterTags.filter(t => !(t.kind === tag.kind && t.value === tag.value));
    });
  }

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
      const chip = elt("div", { class: "app-chip app-chip--warn" });
      chip.appendChild(document.createTextNode("Docs: aucun sélectionné ⚠"));
      const removeBtn = elt("button", { class: "app-chip-remove", title: "Sélectionner tous les documents", type: "button" }, "\u00d7") as HTMLButtonElement;
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

  if (state.filterFederatedDbPaths.length > 0) {
    add("Fédération", `DB courante + ${state.filterFederatedDbPaths.length}`, () => {
      state.filterFederatedDbPaths = [];
      const ta = document.getElementById("filter-federated-dbs") as HTMLTextAreaElement | null;
      if (ta) ta.value = "";
    });
  }

  bar.style.display = bar.children.length > 0 ? "" : "none";
}
