/**
 * features/query.ts — Search orchestration: doSearch, fetchQueryPage, renderResults,
 * pagination (doLoadMore) and IntersectionObserver for auto-scroll.
 *
 * Groups rendering orchestration with query logic to avoid circular imports between
 * renderResults and fetchQueryPage.
 */

import { query, SidecarError } from "../lib/sidecarClient";
import { state, ALIGNED_LIMIT_DEFAULT, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_ALIGNED } from "../state";
import { elt } from "../ui/dom";
import { renderHit, VIRT_DOM_CAP } from "../ui/results";
import { buildFtsQuery } from "./search";

// ─── Pagination ───────────────────────────────────────────────────────────────

export async function doLoadMore(): Promise<void> {
  if (!state.currentQuery || !state.hasMore || state.loadingMore) return;
  await fetchQueryPage(true);
}

// ─── Results rendering ────────────────────────────────────────────────────────

export function renderResults(): void {
  const hits = state.hits;
  const mode = state.mode;
  const showAligned = state.showAligned;
  const area = document.getElementById("results-area")!;
  area.innerHTML = "";

  if (hits.length === 0) {
    const empty = elt("div", { class: "empty-state" });
    empty.innerHTML = `<div class="icon">🔍</div><h3>Aucun résultat</h3><p>Essayez un autre terme ou ajustez les filtres.</p>`;
    area.appendChild(empty);
    return;
  }

  const header = elt("div", { class: "results-header" });
  const loadedLabel = `${hits.length} résultat${hits.length > 1 ? "s" : ""} chargé${hits.length > 1 ? "s" : ""}`;
  if (typeof state.total === "number") {
    header.textContent = `${loadedLabel} / ${state.total}`;
  } else {
    header.textContent = loadedLabel;
  }
  area.appendChild(header);

  // JS-layer virtual list: cap DOM nodes at VIRT_DOM_CAP to prevent layout thrash
  const hiddenCount = Math.max(0, hits.length - VIRT_DOM_CAP);
  if (hiddenCount > 0) {
    const info = elt("div", { class: "virt-top-info" });
    info.textContent = `▲ ${hiddenCount} résultat${hiddenCount > 1 ? "s" : ""} précédent${hiddenCount > 1 ? "s" : ""} non affiché${hiddenCount > 1 ? "s" : ""} (${hits.length} chargé${hits.length > 1 ? "s" : ""} au total)`;
    area.appendChild(info);
  }
  const visibleHits = hiddenCount > 0 ? hits.slice(hiddenCount) : hits;

  for (const hit of visibleHits) {
    area.appendChild(renderHit(hit, mode, showAligned));
  }

  if (state.hasMore) {
    const wrap = elt("div", { class: "load-more-wrap" });
    const btn = elt(
      "button",
      {
        class: "btn btn-secondary load-more-btn",
        type: "button",
      },
      state.loadingMore ? "Chargement…" : "Charger plus"
    ) as HTMLButtonElement;
    btn.disabled = state.loadingMore;
    btn.addEventListener("click", () => {
      void doLoadMore();
    });
    wrap.appendChild(btn);
    area.appendChild(wrap);
  }

  // Sentinel for IntersectionObserver auto-scroll
  const sentinel = elt("div", {
    id: "scroll-sentinel",
    style: state.hasMore ? "height:1px" : "display:none",
  });
  area.appendChild(sentinel);
  reobserveSentinel();
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
  const fts = buildFtsQuery(rawQ);
  state.currentQuery = fts;
  state.pageLimit = state.showAligned ? PAGE_LIMIT_ALIGNED : PAGE_LIMIT_DEFAULT;
  state.nextOffset = null;
  state.hasMore = false;
  state.total = null;
  state.loadingMore = false;
  state.hits = [];
  state.expandedAlignedUnitIds.clear();
  if (!state.currentQuery) {
    renderResults();
    return;
  }
  await fetchQueryPage(false);
}

export async function fetchQueryPage(append: boolean): Promise<void> {
  if (!state.conn || !state.currentQuery) return;

  const offset = append ? (state.nextOffset ?? state.hits.length) : 0;
  const area = document.getElementById("results-area")!;

  if (append) {
    state.loadingMore = true;
    renderResults();
  } else {
    state.isSearching = true;
    (document.getElementById("search-btn") as HTMLButtonElement).disabled = true;
    area.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><h3>Recherche…</h3></div>`;
  }

  try {
    const res = await query(state.conn, {
      q: state.currentQuery,
      mode: state.mode,
      window: state.window,
      language: state.filterLang || undefined,
      doc_role: state.filterRole || undefined,
      resource_type: state.filterResourceType || undefined,
      doc_id: state.filterDocId ? parseInt(state.filterDocId, 10) : undefined,
      includeAligned: state.showAligned,
      alignedLimit: state.showAligned ? ALIGNED_LIMIT_DEFAULT : undefined,
      limit: state.pageLimit,
      offset,
    });

    const pageHits = Array.isArray(res.hits) ? res.hits : [];
    state.hits = append ? state.hits.concat(pageHits) : pageHits;

    if (typeof res.limit === "number") {
      state.pageLimit = res.limit;
    }
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
    if (typeof res.has_more === "boolean") {
      state.hasMore = res.has_more;
    } else {
      state.hasMore = state.nextOffset !== null;
    }

    if (state.showAligned && !append) {
      state.expandedAlignedUnitIds = new Set(state.hits.map((h) => h.unit_id));
    } else if (!state.showAligned) {
      state.expandedAlignedUnitIds.clear();
    }

    renderResults();
  } catch (err) {
    const errDiv = elt("div", { class: "error-banner" });
    errDiv.textContent = `Erreur : ${err instanceof SidecarError ? err.message : String(err)}`;
    if (append && state.hits.length > 0) {
      renderResults();
      area.prepend(errDiv);
    } else {
      area.innerHTML = "";
      area.appendChild(errDiv);
    }
  } finally {
    if (append) {
      state.loadingMore = false;
      renderResults();
    } else {
      state.isSearching = false;
      (document.getElementById("search-btn") as HTMLButtonElement).disabled = false;
    }
  }
}
