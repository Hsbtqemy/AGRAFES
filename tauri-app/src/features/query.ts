/**
 * features/query.ts — Search orchestration: doSearch, fetchQueryPage, renderResults,
 * pagination (doLoadMore) and IntersectionObserver for auto-scroll.
 *
 * Groups rendering orchestration with query logic to avoid circular imports between
 * renderResults and fetchQueryPage.
 *
 * Performance note: fetchQueryPage distinguishes two render paths:
 *   - New search (append=false): full renderResults() — clears and recreates the DOM.
 *   - Pagination append (append=true): appendResultCards() — only adds new nodes,
 *     updates the header count and footer in-place. Eliminates 2 of 3 full rerenders.
 *     Exception: when sortMode="by-doc", falls back to full renderResults() to
 *     maintain grouping integrity.
 *
 * Sprint G additions:
 *   - computeHitStats(): per-document and per-language counts from loaded hits.
 *   - applySortToHits(): stable sort by doc_id + position for "by-doc" mode.
 *   - renderResults() enriched: analytics summary, top-doc facets, sort toggle,
 *     document group separators.
 */

import { query, queryFacets, SidecarError } from "../lib/sidecarClient";
import { state, ALIGNED_LIMIT_DEFAULT, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_ALIGNED } from "../state";
import { elt } from "../ui/dom";
import { renderHit, VIRT_DOM_CAP } from "../ui/results";
import { buildFtsQuery } from "./search";
import { renderChips } from "./filters";
import { syncDocSelectorUI, saveDocSelectorState } from "./docSelector";
import type { QueryHit, FacetDocEntry } from "../lib/sidecarClient";

/** Set filterDocIds to a single-doc restriction and sync the selector UI. */
export function _setDocFilter(docIds: number[]): void {
  state.filterDocIds = docIds;
  saveDocSelectorState(state.dbPath ?? "");
  syncDocSelectorUI();
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export async function doLoadMore(): Promise<void> {
  if (!state.currentQuery || !state.hasMore || state.loadingMore) return;
  await fetchQueryPage(true);
}

// ─── Analytics helpers ────────────────────────────────────────────────────────

interface DocStat { title: string; count: number; }

interface HitStats {
  docCountMap: Map<number, DocStat>;
  langSet: Set<string>;
  topDocs: Array<{ docId: number; title: string; count: number }>;
}

/** Compute per-document and per-language counts from the loaded hits. O(n). */
function computeHitStats(hits: QueryHit[]): HitStats {
  const docCountMap = new Map<number, DocStat>();
  const langSet = new Set<string>();
  for (const h of hits) {
    const entry = docCountMap.get(h.doc_id);
    if (entry) {
      entry.count++;
    } else {
      docCountMap.set(h.doc_id, { title: h.title || `Doc #${h.doc_id}`, count: 1 });
    }
    if (h.language) langSet.add(h.language);
  }
  const topDocs = [...docCountMap.entries()]
    .map(([docId, { title, count }]) => ({ docId, title, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return { docCountMap, langSet, topDocs };
}

/**
 * Returns a sorted copy of hits when sortMode="by-doc".
 * Primary key: doc_id. Secondary key: external_id (document position) or unit_id.
 * Returns the original array unchanged in "natural" mode (no copy cost).
 */
function applySortToHits(hits: QueryHit[]): QueryHit[] {
  if (state.sortMode !== "by-doc") return hits;
  return [...hits].sort((a, b) => {
    if (a.doc_id !== b.doc_id) return a.doc_id - b.doc_id;
    const posA = a.external_id ?? a.unit_id;
    const posB = b.external_id ?? b.unit_id;
    return posA - posB;
  });
}

// ─── Filter helpers ───────────────────────────────────────────────────────────

/** Returns true if any documentary filter is currently active. */
function hasActiveFilters(): boolean {
  return !!(state.filterLang || state.filterRole || state.filterDocIds !== null || state.filterResourceType || state.filterFamilyId !== null);
}

/** Builds a short summary of active filters for display. */
function activeFiltersSummary(): string {
  const parts: string[] = [];
  if (state.filterLang) parts.push(`Langue : ${state.filterLang}`);
  if (state.filterRole) parts.push(`Rôle : ${state.filterRole}`);
  if (state.filterResourceType) parts.push(`Type : ${state.filterResourceType}`);
  if (state.filterFamilyId !== null) {
    const fam = state.families.find(f => f.family_id === state.filterFamilyId);
    const label = fam?.parent?.title ?? `Famille #${state.filterFamilyId}`;
    parts.push(`Famille : ${label}${state.filterFamilyPivotOnly ? " (original uniquement)" : ""}`);
  }
  if (state.filterDocIds !== null) {
    const n = state.filterDocIds.length;
    const total = state.docs.length;
    parts.push(n === 1
      ? `Doc : ${state.docs.find(d => d.doc_id === state.filterDocIds![0])?.title ?? `#${state.filterDocIds[0]}`}`
      : `Docs : ${n} / ${total}`
    );
  }
  return parts.join(" · ");
}

// ─── Backend facets ───────────────────────────────────────────────────────────

/**
 * Fire-and-forget: fetches exact facet counts from the backend after the first
 * page has loaded. Stores result in state.facets and updates analytics UI in-place.
 * Gracefully skipped if the query has changed before the response arrives.
 */
async function _fetchAndApplyFacets(forQuery: string): Promise<void> {
  if (!state.conn || !forQuery) return;
  try {
    const facets = await queryFacets(state.conn, {
      q: forQuery,
      language: state.filterLang || undefined,
      doc_ids: state.filterDocIds ?? undefined,
      doc_role: state.filterRole || undefined,
      resource_type: state.filterResourceType || undefined,
      top_docs_limit: 10,
    });
    // Discard if the query has changed while we were waiting
    if (state.currentQuery !== forQuery) return;
    state.facets = facets;
    state.facetsQuery = forQuery;
    _updateAnalyticsUI(facets);
  } catch {
    // Non-critical — UI falls back to front-computed facets from loaded hits
  }
}

/**
 * Updates the analytics area in-place when backend facets arrive.
 * Avoids a full renderResults() call (no card recreation).
 */
function _updateAnalyticsUI(facets: { total_hits: number; distinct_docs: number; distinct_langs: number; top_docs: FacetDocEntry[] }): void {
  const area = document.getElementById("results-area");
  if (!area) return;

  // Update header count to show exact total from backend
  const headerLeft = area.querySelector<HTMLElement>(".results-header-left");
  if (headerLeft) {
    const n = state.hits.length;
    const loadedLabel = `${n} résultat${n > 1 ? "s" : ""}`;
    headerLeft.textContent = `${loadedLabel} / ${facets.total_hits}`;
    headerLeft.title = `${facets.total_hits} unités correspondantes au total dans le corpus`;
  }

  // Update analytics summary line with backend counts
  const analyticsEl = area.querySelector<HTMLElement>(".analytics-summary");
  if (analyticsEl) {
    const parts = [`${facets.distinct_docs} document${facets.distinct_docs !== 1 ? "s" : ""}`];
    if (facets.distinct_langs > 1) parts.push(`${facets.distinct_langs} langues`);
    parts.push(`${facets.total_hits} hit${facets.total_hits !== 1 ? "s" : ""} au total`);
    analyticsEl.textContent = parts.join(" · ");
    analyticsEl.title = "Données exactes sur l'ensemble de la requête (backend)";
  }

  // Rebuild top-doc facet chips with exact backend counts
  const facetsRow = area.querySelector<HTMLElement>(".results-facets");
  if (facetsRow && facets.top_docs.length >= 2 && state.filterDocIds === null) {
    // Keep label, replace chips
    const label = facetsRow.querySelector(".results-facets-label");
    facetsRow.innerHTML = "";
    if (label) facetsRow.appendChild(label.cloneNode(true));
    else facetsRow.appendChild(elt("span", { class: "results-facets-label" }, "Docs :"));

    for (const { doc_id: docId, title, count } of facets.top_docs) {
      const chip = elt("button", {
        class: "facet-chip",
        type: "button",
        title: `Chercher dans ce document : ${title}`,
      }) as HTMLButtonElement;
      const displayTitle = title.length > 22 ? title.slice(0, 22) + "…" : title;
      chip.appendChild(elt("span", { class: "facet-chip-title" }, displayTitle));
      chip.appendChild(elt("span", { class: "facet-chip-count" }, String(count)));
      chip.addEventListener("click", () => {
        _setDocFilter([docId]);
        renderChips();
        if (state.currentQuery) void doSearch(state.currentQuery);
      });
      facetsRow.appendChild(chip);
    }
    // Add scope label when there are more docs not shown
    if (facets.distinct_docs > facets.top_docs.length) {
      facetsRow.appendChild(elt("span", { class: "results-facets-label" }, `+${facets.distinct_docs - facets.top_docs.length} docs`));
    }
  }
}

// ─── Footer builder ───────────────────────────────────────────────────────────

/** Builds and appends the load-more footer (button or end-msg + sentinel). */
function appendFooter(area: HTMLElement): void {
  if (state.hasMore) {
    const wrap = elt("div", { class: "load-more-wrap" });
    const btn = elt(
      "button",
      { class: "btn btn-secondary load-more-btn", type: "button" },
      "Charger plus"
    ) as HTMLButtonElement;
    btn.addEventListener("click", () => { void doLoadMore(); });
    wrap.appendChild(btn);
    area.appendChild(wrap);
  } else if (state.hits.length > 0) {
    const endMsg = elt("div", { class: "results-end-msg" });
    endMsg.textContent = typeof state.total === "number"
      ? `✓ Tous les ${state.total} résultats sont affichés.`
      : "✓ Fin de la liste.";
    area.appendChild(endMsg);
  }

  const sentinel = elt("div", {
    id: "scroll-sentinel",
    style: state.hasMore ? "height:1px" : "display:none",
  });
  area.appendChild(sentinel);
  reobserveSentinel();
}

// ─── Results rendering ────────────────────────────────────────────────────────

/**
 * Full rerender: clears the results area and recreates all visible cards.
 * Used for new searches, mode changes, toggle re-renders, and sort changes.
 *
 * Sprint G: enriched with analytics summary, top-doc facets, sort toggle,
 * and document group separators in "by-doc" sort mode.
 */
export function renderResults(): void {
  const hits = state.hits;
  const mode = state.mode;
  const showAligned = state.showAligned;
  const area = document.getElementById("results-area")!;
  area.innerHTML = "";

  if (hits.length === 0) {
    const empty = elt("div", { class: "empty-state" });
    if (hasActiveFilters()) {
      empty.innerHTML = `<div class="icon">🔎</div><h3>Aucun résultat</h3><p>Aucun passage ne correspond aux filtres actifs.<br><small>${activeFiltersSummary()}</small></p>`;
    } else {
      empty.innerHTML = `<div class="icon">🔍</div><h3>Aucun résultat</h3><p>Essayez un autre terme de recherche.</p>`;
    }
    area.appendChild(empty);
    return;
  }

  // Compute analytics once for header + facets + group headers
  const stats = computeHitStats(hits);
  const docCount = stats.docCountMap.size;
  const langCount = stats.langSet.size;

  // ── Enriched header: count + mode badge + active filters + sort toggle ──
  const header = elt("div", { class: "results-header" });

  const leftSide = elt("div", { class: "results-header-left" });
  const loadedLabel = `${hits.length} résultat${hits.length > 1 ? "s" : ""}`;
  const freshFacets = state.facets && state.facetsQuery === state.currentQuery ? state.facets : null;
  const totalDisplay = freshFacets?.total_hits ?? (typeof state.total === "number" ? state.total : null);
  leftSide.textContent = totalDisplay !== null
    ? `${loadedLabel} / ${totalDisplay}`
    : loadedLabel;
  if (freshFacets) {
    leftSide.title = `${freshFacets.total_hits} unités correspondantes au total dans le corpus`;
  }
  header.appendChild(leftSide);

  const rightSide = elt("div", { class: "results-header-right" });
  const modeBadge = elt("span", { class: `mode-badge mode-badge--${mode}` }, mode === "kwic" ? "KWIC" : "Segment");
  rightSide.appendChild(modeBadge);

  const summary = activeFiltersSummary();
  if (summary) {
    const filterSummary = elt("span", { class: "results-filter-summary", title: summary }, `· ${summary}`);
    rightSide.appendChild(filterSummary);
  }

  // Sort toggle — only meaningful when multiple documents are present
  if (docCount > 1) {
    const isByDoc = state.sortMode === "by-doc";
    const sortBtn = elt("button", {
      class: `sort-toggle-btn${isByDoc ? " active" : ""}`,
      type: "button",
      title: isByDoc
        ? "Masquer les séparateurs de groupes documentaires"
        : "Afficher des séparateurs par document (le moteur trie déjà par doc · position)",
    }, isByDoc ? "✓ Par doc" : "🗂 Par doc") as HTMLButtonElement;
    sortBtn.addEventListener("click", () => {
      state.sortMode = state.sortMode === "by-doc" ? "natural" : "by-doc";
      renderResults();
    });
    rightSide.appendChild(sortBtn);
  } else if (state.sortMode === "by-doc") {
    // Single doc — reset sort silently (no longer meaningful)
    state.sortMode = "natural";
  }

  header.appendChild(rightSide);
  area.appendChild(header);

  // ── Analytics summary ──
  // Prefer backend facets (exact, sur l'ensemble de la requête) when available
  // and fresh for the current query; fall back to front-computed stats otherwise.
  const backendFacets = (state.facets && state.facetsQuery === state.currentQuery)
    ? state.facets
    : null;

  const analyticsLine = elt("div", { class: "analytics-summary" });
  if (backendFacets) {
    const parts = [`${backendFacets.distinct_docs} document${backendFacets.distinct_docs !== 1 ? "s" : ""}`];
    if (backendFacets.distinct_langs > 1) parts.push(`${backendFacets.distinct_langs} langues`);
    parts.push(`${backendFacets.total_hits} hits au total`);
    analyticsLine.textContent = parts.join(" · ");
    analyticsLine.title = "Données exactes sur l'ensemble de la requête";
  } else {
    const parts = [`${docCount} document${docCount !== 1 ? "s" : ""}`];
    if (langCount > 1) parts.push(`${langCount} langues`);
    const scopeLabel = state.hasMore
      ? `${hits.length} hits chargés (calcul exact en cours…)`
      : `${hits.length} hit${hits.length !== 1 ? "s" : ""} chargés`;
    parts.push(scopeLabel);
    analyticsLine.textContent = parts.join(" · ");
    analyticsLine.title = "Estimé sur les hits chargés — les données exactes arrivent en arrière-plan";
  }
  area.appendChild(analyticsLine);

  // ── Top-doc facets ──
  // Use backend top_docs when fresh (exact per-doc counts); front-computed otherwise.
  const topDocsToShow = backendFacets
    ? backendFacets.top_docs.map(d => ({ docId: d.doc_id, title: d.title, count: d.count }))
    : stats.topDocs;
  const effectiveDocCount = backendFacets ? backendFacets.distinct_docs : docCount;

  if (effectiveDocCount > 1 && state.filterDocIds === null && topDocsToShow.length >= 2) {
    const facetsRow = elt("div", { class: "results-facets" });
    facetsRow.appendChild(elt("span", { class: "results-facets-label" }, "Docs :"));

    for (const { docId, title, count } of topDocsToShow) {
      const chip = elt("button", {
        class: "facet-chip",
        type: "button",
        title: `Chercher dans ce document : ${title}${backendFacets ? ` · ${count} hits au total` : ""}`,
      }) as HTMLButtonElement;

      const displayTitle = title.length > 22 ? title.slice(0, 22) + "…" : title;
      chip.appendChild(elt("span", { class: "facet-chip-title" }, displayTitle));
      chip.appendChild(elt("span", { class: "facet-chip-count" }, String(count)));

      chip.addEventListener("click", () => {
        _setDocFilter([docId]);
        renderChips();
        if (state.currentQuery) void doSearch(state.currentQuery);
      });

      facetsRow.appendChild(chip);
    }

    if (!backendFacets && state.hasMore) {
      facetsRow.appendChild(elt("span", { class: "results-facets-label", style: "font-style:italic" }, "(sur hits chargés)"));
    } else if (backendFacets && effectiveDocCount > topDocsToShow.length) {
      facetsRow.appendChild(elt("span", { class: "results-facets-label" }, `+${effectiveDocCount - topDocsToShow.length} docs`));
    }

    area.appendChild(facetsRow);
  }

  // ── JS-layer virtual list cap ──
  const sortedHits = applySortToHits(hits);
  const hiddenCount = Math.max(0, sortedHits.length - VIRT_DOM_CAP);
  if (hiddenCount > 0) {
    const info = elt("div", { class: "virt-top-info" });
    info.textContent = `▲ Affichage des ${VIRT_DOM_CAP} derniers résultats parmi ${sortedHits.length} chargés — les résultats plus anciens sont temporairement masqués pour préserver la fluidité.`;
    area.appendChild(info);
  }
  const visibleHits = hiddenCount > 0 ? sortedHits.slice(hiddenCount) : sortedHits;

  // ── Cards with optional document group headers ──
  let lastDocId: number | null = null;
  for (const hit of visibleHits) {
    if (state.sortMode === "by-doc" && hit.doc_id !== lastDocId) {
      const docStat = stats.docCountMap.get(hit.doc_id);
      const sep = elt("div", { class: "doc-group-header" });
      sep.appendChild(elt("span", { class: "doc-group-title" }, hit.title || `Doc #${hit.doc_id}`));
      const hitCount = docStat?.count ?? 1;
      sep.appendChild(elt("span", { class: "doc-group-count" }, `${hitCount} hit${hitCount !== 1 ? "s" : ""}`));
      area.appendChild(sep);
      lastDocId = hit.doc_id;
    }
    area.appendChild(renderHit(hit, mode, showAligned));
  }

  appendFooter(area);
}

/**
 * Frugal append: adds only the newly fetched cards to the DOM without recreating
 * existing cards. Updates the header count and footer in-place.
 *
 * Exception: when sortMode="by-doc", falls back to full renderResults() to maintain
 * grouping integrity (new hits may belong to existing document groups).
 */
function appendResultCards(prevCount: number): void {
  // In by-doc mode, sorted grouping must be rebuilt — fall back to full rerender
  if (state.sortMode === "by-doc") {
    renderResults();
    return;
  }

  const area = document.getElementById("results-area");
  // Safety: if area is not in the expected state, fall back to full rerender
  if (!area || area.children.length === 0) {
    renderResults();
    return;
  }

  const newHits = state.hits.slice(prevCount);
  if (newHits.length === 0) return;

  // Auto-expand new hits in non-parallel aligned mode
  if (state.showAligned && !state.showParallel) {
    for (const h of newHits) state.expandedAlignedUnitIds.add(h.unit_id);
  }

  // Update count in the results header (left side only)
  const headerLeft = area.querySelector<HTMLElement>(".results-header-left");
  if (headerLeft) {
    const n = state.hits.length;
    const loadedLabel = `${n} résultat${n > 1 ? "s" : ""}`;
    headerLeft.textContent = typeof state.total === "number"
      ? `${loadedLabel} / ${state.total}`
      : loadedLabel;
  }

  // Update analytics summary scope label
  const analyticsEl = area.querySelector<HTMLElement>(".analytics-summary");
  if (analyticsEl) {
    const docCount = new Set(state.hits.map(h => h.doc_id)).size;
    const langCount = new Set(state.hits.filter(h => h.language).map(h => h.language)).size;
    const parts = [`${docCount} document${docCount !== 1 ? "s" : ""}`];
    if (langCount > 1) parts.push(`${langCount} langues`);
    const scope = state.hasMore ? `${state.hits.length} hits chargés (suite disponible)` : `${state.hits.length} hits chargés`;
    parts.push(scope);
    analyticsEl.textContent = parts.join(" · ");
  }

  // Remove old footer (sentinel + load-more-wrap + end-msg)
  area.querySelector("#scroll-sentinel")?.remove();
  area.querySelector(".load-more-wrap")?.remove();
  area.querySelector(".results-end-msg")?.remove();

  // Append new hit cards directly — no cap applied during append
  const { mode, showAligned } = state;
  for (const hit of newHits) {
    area.appendChild(renderHit(hit, mode, showAligned));
  }

  appendFooter(area);
}

// ─── IntersectionObserver ─────────────────────────────────────────────────────

let _scrollObserver: IntersectionObserver | null = null;

function reobserveSentinel(): void {
  if (_scrollObserver) {
    _scrollObserver.disconnect();
    _scrollObserver = null;
  }
  const sentinel = document.getElementById("scroll-sentinel");
  if (!sentinel || !state.hasMore) return;

  _scrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && state.hasMore && !state.loadingMore) {
        void doLoadMore();
      }
    },
    { root: document.getElementById("results-area"), threshold: 0.1 }
  );
  _scrollObserver.observe(sentinel);
}

/** Disconnect the IntersectionObserver. Called by disposeApp. */
export function disposeQuery(): void {
  _scrollObserver?.disconnect();
  _scrollObserver = null;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function doSearch(rawQ: string): Promise<void> {
  const isRegex = state.builderMode === "regex";

  if (isRegex) {
    state.regexPattern = rawQ.trim();
    state.currentQuery = "";
  } else {
    state.regexPattern = "";
    state.currentQuery = buildFtsQuery(rawQ);
  }

  state.pageLimit = state.showAligned ? PAGE_LIMIT_ALIGNED : PAGE_LIMIT_DEFAULT;
  state.nextOffset = null;
  state.hasMore = false;
  state.total = null;
  state.loadingMore = false;
  state.hits = [];
  state.expandedAlignedUnitIds.clear();
  // Invalidate stale backend facets when launching a new query
  state.facets = null;
  state.facetsQuery = "";

  if (!state.currentQuery && !state.regexPattern) {
    renderResults();
    return;
  }
  await fetchQueryPage(false);
  // Fire facets fetch only for FTS mode (regex has an exact total from the backend)
  if (state.currentQuery && !state.regexPattern) void _fetchAndApplyFacets(state.currentQuery);
}

export async function fetchQueryPage(append: boolean): Promise<void> {
  if (!state.conn || (!state.currentQuery && !state.regexPattern)) return;

  const offset = append ? (state.nextOffset ?? state.hits.length) : 0;
  const prevCount = state.hits.length;
  const area = document.getElementById("results-area")!;

  if (append) {
    state.loadingMore = true;
    const loadMoreBtn = area.querySelector<HTMLButtonElement>(".load-more-btn");
    if (loadMoreBtn) {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = "Chargement…";
    }
  } else {
    state.isSearching = true;
    (document.getElementById("search-btn") as HTMLButtonElement).disabled = true;
    area.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><h3>Recherche…</h3></div>`;
  }

  try {
    const inFamilyMode = state.filterFamilyId !== null;
    const res = await query(state.conn, {
      q: state.currentQuery,
      mode: state.mode,
      window: state.window,
      language: state.filterLang || undefined,
      doc_role: state.filterRole || undefined,
      resource_type: state.filterResourceType || undefined,
      // Family filter takes precedence over manual doc_ids
      doc_ids: inFamilyMode ? undefined : (state.filterDocIds ?? undefined),
      familyId: inFamilyMode ? state.filterFamilyId! : undefined,
      pivotOnly: inFamilyMode ? state.filterFamilyPivotOnly : undefined,
      // In family mode, always show aligned; otherwise honour the toggle
      includeAligned: inFamilyMode || state.showAligned,
      alignedLimit: (inFamilyMode || state.showAligned) ? ALIGNED_LIMIT_DEFAULT : undefined,
      case_sensitive: state.caseSensitive || undefined,
      limit: state.pageLimit,
      offset,
      regex_pattern: state.regexPattern || undefined,
    });

    const pageHits = Array.isArray(res.hits) ? res.hits : [];
    state.hits = append ? state.hits.concat(pageHits) : pageHits;

    if (typeof res.limit === "number") state.pageLimit = res.limit;

    if (typeof res.total === "number") {
      state.total = res.total;
    } else {
      state.total = null;
    }

    if (typeof res.next_offset === "number") {
      state.nextOffset = res.next_offset;
    } else {
      state.nextOffset = null;
    }

    state.hasMore = typeof res.has_more === "boolean"
      ? res.has_more
      : state.nextOffset !== null;

    const autoExpand = state.showAligned || state.filterFamilyId !== null;
    if (autoExpand && !append) {
      state.expandedAlignedUnitIds = new Set(state.hits.map((h) => h.unit_id));
    } else if (!autoExpand) {
      state.expandedAlignedUnitIds.clear();
    }

    if (append) {
      appendResultCards(prevCount);
    } else {
      renderResults();
    }
  } catch (err) {
    const errDiv = elt("div", { class: "error-banner" });
    errDiv.textContent = `Erreur : ${err instanceof SidecarError ? err.message : String(err)}`;
    if (append && state.hits.length > 0) {
      const loadMoreBtn = area.querySelector<HTMLButtonElement>(".load-more-btn");
      if (loadMoreBtn) {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = "Charger plus";
      }
      area.prepend(errDiv);
    } else {
      area.innerHTML = "";
      area.appendChild(errDiv);
    }
  } finally {
    if (append) {
      state.loadingMore = false;
    } else {
      state.isSearching = false;
      (document.getElementById("search-btn") as HTMLButtonElement).disabled = false;
    }
  }
}
