/**
 * features/metaPanel.ts — Metadata side panel open/close and content rendering.
 *
 * Sprint F additions:
 *  - Card active state: markActiveCard() called on open/close.
 *  - Prev/next navigation: navigate through state.hits[] from within the panel.
 *  - Extrait toggle: "Voir la suite / Réduire" for long texts.
 *  - Other occurrences counter: computed from state.hits (no extra API call).
 *  - Document position indicator: §external_id · unité N / total.
 *
 * Sprint I additions:
 *  - Contexte local: section "Contexte local" with prev/current/next units from GET /unit/context.
 *  - Navigation documentaire locale (← Unité préc. / Unitée suiv. →) distincte de la navigation entre hits.
 */

import type { QueryHit, UnitContextResponse } from "../lib/sidecarClient";
import { getUnitContext } from "../lib/sidecarClient";
import { state } from "../state";
import { elt } from "../ui/dom";
import { docsById, renderChips } from "./filters";
import { doSearch } from "./query";
import { markActiveCard } from "../ui/results";

// ─── Module state ─────────────────────────────────────────────────────────────

/** unit_id of the hit currently shown in the panel, or null if closed. */
let _currentUnitId: number | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function openMetaPanel(hit: QueryHit): void {
  const panel = document.getElementById("meta-panel");
  const backdrop = document.getElementById("meta-backdrop");
  const body = document.getElementById("meta-body");
  const foot = document.getElementById("meta-foot");
  if (!panel || !backdrop || !body || !foot) return;

  _currentUnitId = hit.unit_id;
  markActiveCard(hit.unit_id);

  _renderPanelContent(hit, body, foot);

  panel.classList.add("open");
  backdrop.classList.add("open");
}

export function closeMetaPanel(): void {
  document.getElementById("meta-panel")?.classList.remove("open");
  document.getElementById("meta-backdrop")?.classList.remove("open");
  markActiveCard(null);
  _currentUnitId = null;
}

// ─── Content rendering ────────────────────────────────────────────────────────

function _renderPanelContent(hit: QueryHit, body: HTMLElement, foot: HTMLElement): void {
  const doc = docsById.get(hit.doc_id);

  const field = (label: string, value: string, mono = true): HTMLElement => {
    const f = elt("div", { class: "meta-field" });
    f.appendChild(elt("span", { class: "meta-lbl" }, label));
    f.appendChild(elt("span", { class: `meta-val${mono ? "" : " is-text"}` }, value || "—"));
    return f;
  };

  // Extract plain text from hit (strip << >> markers, fallback to KWIC concat)
  const hitText = (hit.text ?? hit.text_norm ?? "").replace(/<<|>>/g, "").trim() ||
    `${hit.left ?? ""} ${hit.match ?? ""} ${hit.right ?? ""}`.trim();

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

  // Document position: §external_id · unité N / total
  if (hit.external_id != null || doc?.unit_count) {
    const posRow = elt("div", { class: "meta-field" });
    posRow.appendChild(elt("span", { class: "meta-lbl" }, "Position"));
    const posParts: string[] = [];
    if (hit.external_id != null) posParts.push(`§${hit.external_id}`);
    if (doc?.unit_count) posParts.push(`/ ${doc.unit_count} unités`);
    posRow.appendChild(elt("span", { class: "meta-doc-position" }, posParts.join(" ")));
    body.appendChild(posRow);
  }

  if (hit.external_id != null) {
    body.appendChild(field("ID externe", String(hit.external_id)));
  }

  // Other occurrences in current results from same document
  const sameDocHits = state.hits.filter(h => h.doc_id === hit.doc_id);
  const otherCount = sameDocHits.length - 1; // exclude current hit
  const hitIndexInDoc = sameDocHits.findIndex(h => h.unit_id === hit.unit_id) + 1;
  const occRow = elt("div", { style: "margin-top:4px" });

  if (otherCount > 0) {
    const occBtn = elt(
      "button",
      { class: "meta-hit-counter", title: `Filtrer sur ce document pour voir toutes les occurrences` },
      `${otherCount} autre${otherCount > 1 ? "s" : ""} occurrence${otherCount > 1 ? "s" : ""} dans ce document (résultats chargés · hit ${hitIndexInDoc}/${sameDocHits.length})`
    ) as HTMLButtonElement;
    occBtn.addEventListener("click", () => {
      state.filterDocId = String(hit.doc_id);
      const inp = document.getElementById("filter-docid") as HTMLInputElement | null;
      if (inp) inp.value = String(hit.doc_id);
      renderChips();
      closeMetaPanel();
      if (state.currentQuery) void doSearch(state.currentQuery);
    });
    occRow.appendChild(occBtn);
  } else {
    occRow.appendChild(elt("span", { class: "meta-hit-counter no-others" }, "Seule occurrence dans les résultats chargés"));
  }
  body.appendChild(occRow);

  // ── Section : Extrait ───────────────────────────────────────────────────────
  if (hitText) {
    body.appendChild(elt("div", { class: "meta-section-head" }, "Extrait"));

    const EXCERPT_LIMIT = 400;
    const isTruncated = hitText.length > EXCERPT_LIMIT;
    const excerptDiv = elt("div", { class: "meta-excerpt" },
      isTruncated ? hitText.slice(0, EXCERPT_LIMIT) + "…" : hitText
    );
    body.appendChild(excerptDiv);

    if (isTruncated) {
      let expanded = false;
      const toggleBtn = elt("button", { class: "meta-excerpt-toggle", type: "button" }, "Voir la suite →") as HTMLButtonElement;
      toggleBtn.addEventListener("click", () => {
        expanded = !expanded;
        excerptDiv.textContent = expanded ? hitText : hitText.slice(0, EXCERPT_LIMIT) + "…";
        toggleBtn.textContent = expanded ? "← Réduire" : "Voir la suite →";
      });
      body.appendChild(toggleBtn);
    }
  }

  // ── Section : Contexte local (Sprint I) ───────────────────────────────────────
  const contextWrap = elt("div", { id: "meta-local-context", class: "meta-context-wrap" });
  contextWrap.appendChild(elt("div", { class: "meta-section-head" }, "Contexte local (voisinage documentaire)"));
  contextWrap.appendChild(elt("div", { class: "meta-context-loading" }, "Chargement du voisinage…"));
  body.appendChild(contextWrap);
  void loadUnitContext(hit.unit_id, body);

  // ── Footer ──────────────────────────────────────────────────────────────────
  foot.innerHTML = "";

  // Primary: filter + search in this document
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

  // Secondary: copy hit text
  const copyTextBtn = elt("button", { class: "btn btn-secondary", type: "button" }, "Copier le texte") as HTMLButtonElement;
  copyTextBtn.title = "Copier l'extrait dans le presse-papier";
  copyTextBtn.addEventListener("click", () => {
    void navigator.clipboard?.writeText(hitText).then(() => {
      copyTextBtn.textContent = "✓ Copié !";
      setTimeout(() => { copyTextBtn.textContent = "Copier le texte"; }, 1500);
    });
  });

  const closeBtn = elt("button", { class: "btn btn-ghost", type: "button" }, "Fermer") as HTMLButtonElement;
  closeBtn.addEventListener("click", closeMetaPanel);

  foot.appendChild(filterDocBtn);
  foot.appendChild(copyTextBtn);
  foot.appendChild(closeBtn);

  // ── Prev/Next navigation row ─────────────────────────────────────────────────
  const currentIndex = state.hits.findIndex(h => h.unit_id === hit.unit_id);
  const total = state.hits.length;

  const navRow = elt("div", { class: "meta-nav-row" });

  const prevBtn = elt("button", { class: "meta-nav-btn", type: "button" }, "← Précédent") as HTMLButtonElement;
  prevBtn.disabled = currentIndex <= 0;
  prevBtn.title = currentIndex > 0
    ? `Résultat précédent : ${state.hits[currentIndex - 1]?.title ?? ""}`
    : "Pas de résultat précédent";
  prevBtn.addEventListener("click", () => {
    if (currentIndex > 0) _navigateTo(currentIndex - 1);
  });

  const posLabel = elt("span", { class: "meta-nav-pos" },
    total > 0 ? `${currentIndex + 1} / ${total}${state.hasMore ? "+" : ""}` : "—"
  );

  const nextBtn = elt("button", { class: "meta-nav-btn", type: "button" }, "Suivant →") as HTMLButtonElement;
  const hasNext = currentIndex >= 0 && currentIndex < total - 1;
  nextBtn.disabled = !hasNext;
  nextBtn.title = hasNext
    ? `Résultat suivant : ${state.hits[currentIndex + 1]?.title ?? ""}`
    : state.hasMore ? "Chargez plus de résultats pour continuer" : "Pas de résultat suivant";
  nextBtn.addEventListener("click", () => {
    if (hasNext) _navigateTo(currentIndex + 1);
  });

  navRow.appendChild(prevBtn);
  navRow.appendChild(posLabel);
  navRow.appendChild(nextBtn);
  foot.appendChild(navRow);
}

const EXCERPT_TRUNCATE_CONTEXT = 200;

function _syntheticHit(docId: number, unitId: number, text: string): QueryHit {
  const doc = docsById.get(docId);
  return {
    doc_id: docId,
    unit_id: unitId,
    external_id: null,
    language: doc?.language ?? "",
    title: doc?.title ?? "",
    text,
    text_norm: text,
  };
}

function loadUnitContext(unitId: number, body: HTMLElement): void {
  if (!state.conn) return;
  getUnitContext(state.conn, unitId)
    .then((ctx) => renderLocalContext(body, ctx))
    .catch(() => {
      const wrap = body.querySelector("#meta-local-context") as HTMLElement | null;
      if (!wrap) return;
      const loading = wrap.querySelector(".meta-context-loading");
      if (loading) {
        loading.textContent = "Contexte indisponible.";
        (loading as HTMLElement).classList.add("meta-context-error");
      }
    });
}

function renderLocalContext(body: HTMLElement, ctx: UnitContextResponse): void {
  const wrap = body.querySelector("#meta-local-context") as HTMLElement | null;
  if (!wrap) return;
  const loading = wrap.querySelector(".meta-context-loading");
  if (loading) loading.remove();
  const existingContent = wrap.querySelector(".meta-context-content");
  if (existingContent) existingContent.remove();

  const content = elt("div", { class: "meta-context-content" });

  const posLine = elt("div", { class: "meta-context-pos-line" });
  posLine.appendChild(elt("span", { class: "meta-context-pos" }, `§ ${ctx.unit_index} / ${ctx.total_units}`));
  content.appendChild(posLine);

  if (ctx.prev) {
    const prevBlock = elt("div", { class: "meta-context-block meta-context-prev" });
    prevBlock.appendChild(elt("div", { class: "meta-context-label" }, "Unité précédente"));
    const prevText = elt("div", { class: "meta-context-text" }, ctx.prev.text.slice(0, EXCERPT_TRUNCATE_CONTEXT) + (ctx.prev.text.length > EXCERPT_TRUNCATE_CONTEXT ? "…" : ""));
    prevBlock.appendChild(prevText);
    content.appendChild(prevBlock);
  }

  const curBlock = elt("div", { class: "meta-context-block meta-context-current" });
  curBlock.appendChild(elt("div", { class: "meta-context-label" }, "Unité courante (hit)"));
  const curText = elt("div", { class: "meta-context-text" }, ctx.current.text.slice(0, EXCERPT_TRUNCATE_CONTEXT) + (ctx.current.text.length > EXCERPT_TRUNCATE_CONTEXT ? "…" : ""));
  curBlock.appendChild(curText);
  content.appendChild(curBlock);

  if (ctx.next) {
    const nextBlock = elt("div", { class: "meta-context-block meta-context-next" });
    nextBlock.appendChild(elt("div", { class: "meta-context-label" }, "Unité suivante"));
    const nextText = elt("div", { class: "meta-context-text" }, ctx.next.text.slice(0, EXCERPT_TRUNCATE_CONTEXT) + (ctx.next.text.length > EXCERPT_TRUNCATE_CONTEXT ? "…" : ""));
    nextBlock.appendChild(nextText);
    content.appendChild(nextBlock);
  }

  const navLine = elt("div", { class: "meta-context-nav-line" });
  const prevUnitBtn = elt("button", { class: "meta-context-nav-btn", type: "button" }, "← Unité préc.") as HTMLButtonElement;
  prevUnitBtn.disabled = !ctx.prev;
  prevUnitBtn.title = ctx.prev ? "Afficher l'unité précédente dans le document" : "Pas d'unité précédente";
  prevUnitBtn.addEventListener("click", () => {
    if (ctx.prev) _navigateToUnit(ctx.doc_id, ctx.prev.unit_id, ctx.prev.text, body);
  });
  const nextUnitBtn = elt("button", { class: "meta-context-nav-btn", type: "button" }, "Unité suiv. →") as HTMLButtonElement;
  nextUnitBtn.disabled = !ctx.next;
  nextUnitBtn.title = ctx.next ? "Afficher l'unité suivante dans le document" : "Pas d'unité suivante";
  nextUnitBtn.addEventListener("click", () => {
    if (ctx.next) _navigateToUnit(ctx.doc_id, ctx.next.unit_id, ctx.next.text, body);
  });
  navLine.appendChild(prevUnitBtn);
  navLine.appendChild(elt("span", { class: "meta-context-nav-sep" }, " "));
  navLine.appendChild(nextUnitBtn);
  content.appendChild(navLine);

  wrap.appendChild(content);
}

function _navigateToUnit(docId: number, unitId: number, text: string, body: HTMLElement): void {
  const foot = document.getElementById("meta-foot");
  if (!foot) return;
  const synthetic = _syntheticHit(docId, unitId, text);
  _currentUnitId = unitId;
  const inHits = state.hits.find((h) => h.unit_id === unitId);
  if (inHits) markActiveCard(unitId);
  else markActiveCard(null);
  const card = document.querySelector(`[data-unit-id="${unitId}"]`) as HTMLElement | null;
  card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  _renderPanelContent(synthetic, body, foot);
}

/** Navigate to a hit by its index in state.hits, re-rendering the panel in-place. */
function _navigateTo(index: number): void {
  const hit = state.hits[index];
  if (!hit) return;

  const body = document.getElementById("meta-body");
  const foot = document.getElementById("meta-foot");
  if (!body || !foot) return;

  _currentUnitId = hit.unit_id;
  markActiveCard(hit.unit_id);

  // Scroll the result card into view (soft)
  const card = document.querySelector(`[data-unit-id="${hit.unit_id}"]`) as HTMLElement | null;
  card?.scrollIntoView({ behavior: "smooth", block: "nearest" });

  _renderPanelContent(hit, body, foot);
}

/** Returns the unit_id currently shown in the panel, or null if closed. */
export function getCurrentPanelUnitId(): number | null {
  return _currentUnitId;
}
