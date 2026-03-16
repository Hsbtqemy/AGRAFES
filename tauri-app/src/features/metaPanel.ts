/**
 * features/metaPanel.ts — Metadata side panel open/close and content rendering.
 */

import type { QueryHit } from "../lib/sidecarClient";
import { state } from "../state";
import { elt } from "../ui/dom";
import { docsById, renderChips } from "./filters";
import { doSearch } from "./query";

export function openMetaPanel(hit: QueryHit): void {
  const panel = document.getElementById("meta-panel");
  const backdrop = document.getElementById("meta-backdrop");
  const body = document.getElementById("meta-body");
  const foot = document.getElementById("meta-foot");
  if (!panel || !backdrop || !body || !foot) return;

  const doc = docsById.get(hit.doc_id);

  const field = (label: string, value: string, mono = true): HTMLElement => {
    const f = elt("div", { class: "meta-field" });
    f.appendChild(elt("span", { class: "meta-lbl" }, label));
    f.appendChild(elt("span", { class: `meta-val${mono ? "" : " is-text"}` }, value || "—"));
    return f;
  };

  body.innerHTML = "";

  // ── Section : Document ──────────────────────────────────────────────────────
  body.appendChild(elt("div", { class: "meta-section-head" }, "Document"));
  body.appendChild(field("Titre", hit.title, false));
  body.appendChild(field("Langue", hit.language));
  body.appendChild(field("Rôle", doc?.doc_role ?? "—"));
  body.appendChild(field("Type", doc?.resource_type ?? "—"));
  body.appendChild(field("Unités totales", doc ? String(doc.unit_count) : "—"));

  // ── Section : Unité ─────────────────────────────────────────────────────────
  body.appendChild(elt("div", { class: "meta-section-head" }, "Unité"));
  body.appendChild(field("unit_id", String(hit.unit_id)));
  body.appendChild(field("doc_id", String(hit.doc_id)));
  if (hit.external_id != null) {
    body.appendChild(field("ID externe", String(hit.external_id)));
  }

  foot.innerHTML = "";

  // Primary action: filter on this document
  const filterDocBtn = elt("button", { class: "btn btn-primary", type: "button" }, "Chercher dans ce document") as HTMLButtonElement;
  filterDocBtn.title = `Limiter la recherche au document #${hit.doc_id}`;
  filterDocBtn.addEventListener("click", () => {
    state.filterDocId = String(hit.doc_id);
    const docIdInput = document.getElementById("filter-docid") as HTMLInputElement | null;
    if (docIdInput) docIdInput.value = String(hit.doc_id);
    renderChips();
    closeMetaPanel();
    if (state.currentQuery) void doSearch(state.currentQuery);
  });

  // Secondary: copy doc_id
  const copyDocId = elt("button", { class: "btn btn-secondary", type: "button" }, "Copier doc_id") as HTMLButtonElement;
  copyDocId.addEventListener("click", () => { void navigator.clipboard?.writeText(String(hit.doc_id)); });
  const closeBtn = elt("button", { class: "btn btn-ghost", type: "button" }, "Fermer") as HTMLButtonElement;
  closeBtn.addEventListener("click", closeMetaPanel);
  foot.appendChild(filterDocBtn);
  foot.appendChild(copyDocId);
  foot.appendChild(closeBtn);

  panel.classList.add("open");
  backdrop.classList.add("open");
}

export function closeMetaPanel(): void {
  document.getElementById("meta-panel")?.classList.remove("open");
  document.getElementById("meta-backdrop")?.classList.remove("open");
}
