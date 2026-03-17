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
import { getUnitContext, queryFacets } from "../lib/sidecarClient";
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

  // ── Section : Lecture locale (Sprint J) ────────────────────────────────────────
  const contextWrap = elt("div", { id: "meta-local-context", class: "meta-context-wrap" });
  contextWrap.appendChild(elt("div", { class: "meta-section-head" }, "Lecture locale"));
  contextWrap.appendChild(elt("div", { class: "meta-context-loading" }, "Chargement…"));
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

  // ── Intra-document hit navigation (Sprint L/M) ───────────────────────────
  const docNavRow = _buildDocNavRow(hit);
  if (docNavRow) {
    foot.appendChild(docNavRow);
    // Sprint M: async enrich with exact backend count (non-blocking)
    void _enrichDocCount(hit, docNavRow);
  }
}

// ─── Reading window constants ─────────────────────────────────────────────────

/** Default reading window on each side of the current unit. */
const READER_WINDOW = 3;
/** Max characters shown per unit row in the reading strip. */
const READER_TEXT_CAP = 180;

// ─── Reading window size (session state, not persisted) ───────────────────────

/** Current reading window depth — toggled between ±3 and ±6 by the user. */
let _readerWindow: 3 | 6 = READER_WINDOW;

// ─── Local context loading ────────────────────────────────────────────────────

function loadUnitContext(unitId: number, body: HTMLElement): void {
  if (!state.conn) return;
  getUnitContext(state.conn, unitId, _readerWindow)
    .then((ctx) => renderLocalContext(body, ctx))
    .catch(() => {
      const wrap = body.querySelector("#meta-local-context") as HTMLElement | null;
      if (!wrap) return;
      const loading = wrap.querySelector(".meta-context-loading");
      if (loading) {
        loading.textContent = "Lecture locale indisponible.";
        (loading as HTMLElement).classList.add("meta-context-error");
      }
    });
}

/**
 * Render (or replace) the reading strip inside #meta-local-context.
 *
 * Sprint J: each item is a clickable row that recentres the strip.
 * Sprint K additions:
 *  - Rows that are also search hits get class `.is-hit` + amber dot marker.
 *  - Window depth toggle (±3 / ±6) in the header.
 *  - Legend when at least one hit is visible in the strip.
 */
function renderLocalContext(body: HTMLElement, ctx: UnitContextResponse): void {
  const wrap = body.querySelector("#meta-local-context") as HTMLElement | null;
  if (!wrap) return;
  wrap.querySelector(".meta-context-loading")?.remove();
  wrap.querySelector(".meta-context-content")?.remove();

  // Build a fast lookup of loaded hit unit_ids
  const hitIds = new Set(state.hits.map(h => h.unit_id));

  const content = elt("div", { class: "meta-context-content" });

  // ── Header: position · scope badge · window toggle ────────────────────────
  const header = elt("div", { class: "meta-reader-header" });
  header.appendChild(elt("span", { class: "meta-context-pos" }, `§ ${ctx.unit_index} / ${ctx.total_units}`));

  // Window depth toggle (±3 / ±6)
  const winCtl = elt("div", { class: "meta-reader-win-ctl" });
  for (const w of [3, 6] as const) {
    const btn = elt("button", {
      class: `meta-reader-win-btn${_readerWindow === w ? " active" : ""}`,
      type: "button",
      title: `Afficher ±${w} unités de contexte`,
    }, `±${w}`) as HTMLButtonElement;
    btn.addEventListener("click", () => {
      if (_readerWindow === w) return;
      _readerWindow = w;
      void _reloadReader(ctx.doc_id, ctx.unit_id, body);
    });
    winCtl.appendChild(btn);
  }
  header.appendChild(winCtl);
  content.appendChild(header);

  // ── Reading strip ─────────────────────────────────────────────────────────
  const strip = elt("div", { class: "meta-reader" }) as HTMLElement;
  let currentEl: HTMLElement | null = null;
  let anyHitInStrip = false;

  for (const item of ctx.items) {
    const isCurrent = item.is_current;
    const isHit = hitIds.has(item.unit_id);
    if (isHit) anyHitInStrip = true;

    let rowClass = "meta-reader-row";
    if (isCurrent) rowClass += " is-current";
    if (isHit) rowClass += " is-hit";

    const titleParts: string[] = [];
    if (isCurrent) titleParts.push("Passage courant");
    if (isHit && !isCurrent) titleParts.push("Hit de recherche");
    if (!isCurrent) titleParts.push("Recentrer la lecture sur cette unité");

    const rowAttrs: Record<string, string> = {
      class: rowClass,
      title: titleParts.join(" · "),
    };
    if (!isCurrent) { rowAttrs.role = "button"; rowAttrs.tabindex = "0"; }
    const row = elt("div", rowAttrs) as HTMLElement;

    // Amber hit-dot marker (shown on all hit rows, including current)
    if (isHit) {
      row.appendChild(elt("span", { class: "meta-reader-hit-dot", "aria-label": "hit de recherche" }, "●"));
    }

    const truncated = item.text.length > READER_TEXT_CAP
      ? item.text.slice(0, READER_TEXT_CAP) + "…"
      : item.text;
    row.appendChild(elt("span", { class: "meta-reader-text" }, truncated));

    if (!isCurrent) {
      const recentre = (): void => { void _reloadReader(ctx.doc_id, item.unit_id, body); };
      row.addEventListener("click", recentre);
      row.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") {
          e.preventDefault();
          recentre();
        }
      });
    }

    strip.appendChild(row);
    if (isCurrent) currentEl = row;
  }
  content.appendChild(strip);

  // ── Legend (only when at least one hit is visible in the strip) ───────────
  if (anyHitInStrip) {
    const legend = elt("div", { class: "meta-reader-legend" });
    legend.appendChild(elt("span", { class: "meta-reader-legend-dot" }, "●"));
    legend.appendChild(document.createTextNode(" Hit de recherche"));
    content.appendChild(legend);
  }

  // ── Boundary hint ─────────────────────────────────────────────────────────
  const atDocStart = ctx.window_before < _readerWindow;
  const atDocEnd = ctx.window_after < _readerWindow;
  if (atDocStart || atDocEnd) {
    const hint = elt("div", { class: "meta-reader-boundary" });
    hint.textContent = atDocStart && atDocEnd
      ? "Document entier affiché"
      : atDocStart ? "Début du document" : "Fin du document";
    content.appendChild(hint);
  }

  wrap.appendChild(content);

  // Auto-scroll so the current row is centred in the strip
  requestAnimationFrame(() => {
    currentEl?.scrollIntoView({ block: "center", behavior: "instant" });
  });
}

/**
 * Reload only the reading strip centred on a different unit.
 * Does NOT reload the full panel — the metadata sections stay on the original hit.
 * This is intentional: the strip is for reading local context, not for navigating.
 *
 * Sprint K: also highlights the result card when the recentred unit is a loaded hit.
 */
async function _reloadReader(docId: number, unitId: number, body: HTMLElement): Promise<void> {
  if (!state.conn) return;
  // Highlight result card if this unit is in the current hit list, silently otherwise
  const inHits = state.hits.find(h => h.unit_id === unitId);
  if (inHits) markActiveCard(unitId);
  try {
    const ctx = await getUnitContext(state.conn, unitId, _readerWindow);
    renderLocalContext(body, ctx);
  } catch {
    // strip stays unchanged on error
  }
}

/**
 * Async enrich the intra-doc nav row with an exact occurrence count from the backend
 * (Sprint M). Uses POST /query/facets with doc_id filter — no new endpoint needed.
 *
 * Updates the position label to show "Hit X / Y chargés · Z au total" and appends
 * a "Voir les Z occurrences →" button when the loaded count is less than the real total.
 * Silently exits on error so the row remains functional with its initial loaded data.
 */
async function _enrichDocCount(hit: QueryHit, row: HTMLElement): Promise<void> {
  if (!state.conn || !state.currentQuery) return;

  const sameDocHits = state.hits.filter(h => h.doc_id === hit.doc_id);
  const loaded = sameDocHits.length;
  const docIdx = sameDocHits.findIndex(h => h.unit_id === hit.unit_id);
  if (docIdx < 0) return;

  let total: number;
  try {
    // Pass current global filters but force doc_id to the hit's document
    const res = await queryFacets(state.conn, {
      q: state.currentQuery,
      doc_id: hit.doc_id,
      language: state.filterLang || undefined,
      doc_role: state.filterRole || undefined,
      resource_type: state.filterResourceType || undefined,
      top_docs_limit: 1,
    });
    total = res.total_hits;
  } catch {
    return; // keep the row as-is
  }

  const posEl = row.querySelector(".meta-doc-nav-pos") as HTMLElement | null;
  if (!posEl) return;

  if (total <= loaded) {
    // All hits already loaded — replace "Y+" with exact total, no action needed
    posEl.textContent = `Hit ${docIdx + 1} / ${total}`;
    posEl.title = `${total} occurrence(s) dans ce document pour la requête courante`;
  } else {
    // More hits exist than loaded — make the gap explicit
    posEl.textContent = `Hit ${docIdx + 1} / ${loaded} chargés`;
    posEl.title = `${loaded} occurrence(s) chargée(s) · ${total} réelles dans ce document`;
    const totalSpan = elt("span", { class: "meta-doc-nav-total" }, ` · ${total} au total`);
    posEl.appendChild(totalSpan);

    // Action: relance the search scoped to this document
    const loadAllBtn = elt("button", {
      class: "meta-doc-load-all-btn",
      type: "button",
      title: `Relancer la recherche sur ce document pour accéder aux ${total} occurrences`,
    }, `Voir les ${total} occurrences →`) as HTMLButtonElement;
    loadAllBtn.addEventListener("click", () => {
      state.filterDocId = String(hit.doc_id);
      const inp = document.getElementById("filter-docid") as HTMLInputElement | null;
      if (inp) inp.value = String(hit.doc_id);
      renderChips();
      closeMetaPanel();
      if (state.currentQuery) void doSearch(state.currentQuery);
    });
    row.appendChild(loadAllBtn);
  }
}

/**
 * Build the intra-document hit navigation row (Sprint L).
 *
 * Returns null when the current document has only one loaded hit
 * (no point showing disabled buttons in that case).
 *
 * Buttons call _navigateTo with the global index of the target hit,
 * which reloads the full panel including the reading strip and card sync.
 */
function _buildDocNavRow(hit: QueryHit): HTMLElement | null {
  const sameDocHits = state.hits.filter(h => h.doc_id === hit.doc_id);
  if (sameDocHits.length <= 1) return null;

  const docIdx = sameDocHits.findIndex(h => h.unit_id === hit.unit_id);
  if (docIdx < 0) return null;

  const total = sameDocHits.length;
  const hasPrev = docIdx > 0;
  const hasNext = docIdx < total - 1;
  const moreExist = state.hasMore;

  const row = elt("div", { class: "meta-doc-nav-row" });

  // Label making the scope of this row explicit
  row.appendChild(elt("span", { class: "meta-doc-nav-label" }, "Dans ce document"));

  const prevDocBtn = elt("button", {
    class: "meta-doc-nav-btn",
    type: "button",
    title: hasPrev
      ? `Occurrence précédente dans ce document${moreExist ? " (chargés)" : ""}`
      : "Première occurrence chargée dans ce document",
  }, "← Préc.") as HTMLButtonElement;
  prevDocBtn.disabled = !hasPrev;
  prevDocBtn.addEventListener("click", () => {
    const target = sameDocHits[docIdx - 1];
    const gi = state.hits.indexOf(target);
    if (gi >= 0) _navigateTo(gi);
  });

  const posLabel = elt("span", { class: "meta-doc-nav-pos" });
  posLabel.textContent = `Hit ${docIdx + 1} / ${total}${moreExist ? "+" : ""}`;
  posLabel.title = moreExist
    ? "Position parmi les hits chargés dans ce document (d'autres peuvent exister)"
    : "Position parmi les hits de ce document";

  const nextDocBtn = elt("button", {
    class: "meta-doc-nav-btn",
    type: "button",
    title: hasNext
      ? `Occurrence suivante dans ce document${moreExist ? " (chargés)" : ""}`
      : "Dernière occurrence chargée dans ce document",
  }, "Suiv. →") as HTMLButtonElement;
  nextDocBtn.disabled = !hasNext;
  nextDocBtn.addEventListener("click", () => {
    const target = sameDocHits[docIdx + 1];
    const gi = state.hits.indexOf(target);
    if (gi >= 0) _navigateTo(gi);
  });

  row.appendChild(prevDocBtn);
  row.appendChild(posLabel);
  row.appendChild(nextDocBtn);
  return row;
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
