/**
 * alignCellCut.ts — pure logic + HTML for the matrix-cell cut gestures
 * (R3.3 tranches 3b + D-W12/D-W13, docs/DESIGN_alignment_workspace §3.2/§3.4/§3.5).
 *
 * D-W13 : every cut operates inside the link's current WINDOW
 * (`[char_start, char_end]`, the whole text being just `[0, len]`) — cuts iterate,
 * a 3-piece sentence is 2 gestures. Resolution works on the matrix's own
 * `cell_links` (A2): a column is the per-row list of links behind one translation.
 *
 * - **Fused cut** : a ⚠ cell shares a target with IDENTICAL windows with the row
 *   above — cutting partitions the whole same-window group between the rows above
 *   the clicked cell (head) and the clicked cell + below (tail); the tail part
 *   stays fused among itself and is re-cut by the next gesture (N-1 = N-1 gestures).
 * - **Straddle cut** (« couper à cheval ») : any single-link cell — cut or not —
 *   spills part of its window over the neighbouring hub segment; the missing link
 *   is created (inheriting the sibling's external_id) then both get complementary
 *   sub-windows.
 * - **Cell ↺** : the target becomes whole again — clear every cut on that target
 *   across the column, deleting the gesture-created (`manual`) links, never the
 *   aligner's. The exact inverse of any cut sequence, in one atomic batch.
 *
 * The two-panel move-only picker (§3.2, D-W9 one contiguous point) renders the
 * window's words only; `top + bottom == window` holds by construction. No DOM,
 * no sidecar here.
 */

import type { MatrixCellLink } from "./sidecarClient.ts";
import type { AlignBatchAction } from "./sidecarClient.ts";
import { cutOffsets, codePointLength, codePointSlice } from "./alignBeads.ts";
import { escHtml as _esc } from "./diff.ts";

/** One translation column of the matrix: cell_links[row][col] for a fixed col. */
export type CellLinkColumn = ReadonlyArray<readonly MatrixCellLink[]>;

// ─── Windows (D-W13) ─────────────────────────────────────────────────────────────

/** The link's current slice of its target, numeric ([0, len] when uncut). */
export function linkWindow(l: MatrixCellLink): [number, number] {
  const len = codePointLength(l.target_text_raw ?? "");
  return [l.char_start ?? 0, l.char_end ?? len];
}

function _sameWindow(a: MatrixCellLink, b: MatrixCellLink): boolean {
  const [as, ae] = linkWindow(a);
  const [bs, be] = linkWindow(b);
  return as === bs && ae === be;
}

/** True when the two cells share a target unit with IDENTICAL windows (⚠ fused). */
export function cellsShareFusedTarget(
  cur: readonly MatrixCellLink[], above: readonly MatrixCellLink[],
): boolean {
  return cur.some((l) =>
    above.some((a) => a.target_unit_id === l.target_unit_id && _sameWindow(a, l)));
}

// ─── Viable cut points (F7, windowed) ────────────────────────────────────────────

/**
 * Word boundaries strictly inside `(ws, we)` where BOTH sub-slices keep visible
 * text (a whitespace-only slice would project as an empty cell ∅ — forbidden by
 * §3.2). Every consumer (resolvers, suggestion, panels) goes through this filter.
 */
export function viableCutOffsetsIn(text: string, ws: number, we: number): number[] {
  return cutOffsets(text).filter(
    (o) => o > ws && o < we
      && codePointSlice(text, ws, o).trim() !== ""
      && codePointSlice(text, o, we).trim() !== "",
  );
}

/** Whole-text variant (window = [0, len]). */
export function viableCutOffsets(text: string): number[] {
  return viableCutOffsetsIn(text, 0, codePointLength(text));
}

// ─── Resolution : fused ⚠ cell → partition of its same-window group ─────────────

export type FusedCutResolution =
  | {
      /** Same-window group members strictly above the clicked row — take the head. */
      above: MatrixCellLink[];
      /** The clicked row's member and those below — take the tail (stay fused together). */
      below: MatrixCellLink[];
      window: [number, number];
      targetRaw: string;
      error?: undefined;
    }
  | { above?: undefined; below?: undefined; window?: undefined; targetRaw?: undefined; error: string };

/**
 * Resolve the fused cut at `row`: the boundary lands BETWEEN this row and the
 * previous one — every same-window holder above keeps `[ws, x]`, the clicked row
 * and every holder below keep `[x, we]`. A plain 2-1 is the group of two.
 */
export function resolveFusedCellLinks(column: CellLinkColumn, row: number): FusedCutResolution {
  if (row < 1 || row >= column.length) return { error: "Cellule hors de la matrice." };
  const aboveCell = column[row - 1] ?? [];
  const cur = column[row] ?? [];
  if (aboveCell.length === 0 || cur.length === 0) {
    return { error: "Liens d'alignement introuvables pour cette cellule." };
  }
  const shared = [...new Set(
    cur.filter((l) => aboveCell.some((a) => a.target_unit_id === l.target_unit_id && _sameWindow(a, l)))
      .map((l) => l.target_unit_id),
  )];
  if (shared.length === 0) {
    return { error: "Les deux lignes pointent vers des traductions distinctes — rien à couper ici." };
  }
  if (shared.length > 1) {
    return { error: "Appariement ambigu (plusieurs traductions partagées) — passer par la Révision fine." };
  }
  const ref = cur.find((l) => l.target_unit_id === shared[0])!;
  const [ws, we] = linkWindow(ref);
  // The partition group: every link on this target with the SAME window, row by row.
  const above: MatrixCellLink[] = [];
  const below: MatrixCellLink[] = [];
  column.forEach((links, i) => {
    for (const l of links) {
      if (l.target_unit_id === shared[0] && _sameWindow(l, ref)) {
        (i < row ? above : below).push(l);
      }
    }
  });
  if (above.length === 0 || below.length === 0) {
    return { error: "Liens d'alignement introuvables pour cette cellule." };
  }
  const raw = ref.target_text_raw ?? "";
  if (viableCutOffsetsIn(raw, ws, we).length === 0) {
    return { error: "Aucun point de coupe possible dans cette tranche (un seul mot)." };
  }
  return { above, below, window: [ws, we], targetRaw: raw };
}

// ─── Resolution : straddle cut toward a neighbour (D-W12/13 « couper à cheval ») ──

export type StraddleDirection = "up" | "down";

export type StraddleResolution =
  | { link: MatrixCellLink; neighborRow: number; window: [number, number]; error?: undefined }
  | { link?: undefined; neighborRow?: undefined; window?: undefined; error: string };

/**
 * Resolve « couper à cheval » on the cell at `row`: part of a link's window spills
 * over the neighbouring hub segment (`up` = the HEAD belongs to row-1, `down` = the
 * TAIL belongs to row+1). The gesture creates the missing link toward the neighbour
 * and partitions the window. Iterative (D-W13): the link may already carry a cut —
 * the gesture splits its current slice. On a multi-link cell the DIRECTION picks the
 * edge link (§3.5): « down » cuts the LAST link in reading order, « up » the FIRST —
 * only an edge link can spill across that boundary (pushing a link OVER another one
 * would be a reordering, out of the contiguous model — D-W9).
 */
export function resolveStraddleCut(
  column: CellLinkColumn, row: number, direction: StraddleDirection,
): StraddleResolution {
  if (row < 0 || row >= column.length) return { error: "Cellule hors de la matrice." };
  const neighborRow = direction === "up" ? row - 1 : row + 1;
  if (neighborRow < 0 || neighborRow >= column.length) {
    return { error: direction === "up" ? "Pas de segment au-dessus." : "Pas de segment en dessous." };
  }
  const cur = column[row] ?? [];
  if (cur.length === 0) return { error: "Cellule sans traduction alignée — rien à couper." };
  const link = direction === "up" ? cur[0] : cur[cur.length - 1];
  const neighbor = column[neighborRow] ?? [];
  if (neighbor.some((l) => l.target_unit_id === link.target_unit_id)) {
    return cellsShareFusedTarget(cur, neighbor)
      ? { error: "Le segment voisin partage déjà cette traduction — utiliser « ✂ Couper » sur la cellule ⚠." }
      : { error: "Le segment voisin porte déjà une part de cette traduction — annuler la coupe (↺) puis recouper." };
  }
  const [ws, we] = linkWindow(link);
  if (viableCutOffsetsIn(link.target_text_raw ?? "", ws, we).length === 0) {
    return { error: "Aucun point de coupe possible dans cette tranche (un seul mot)." };
  }
  return { link, neighborRow, window: [ws, we] };
}

// ─── Resolution : cell ↺ → the target becomes whole again (D-W13) ────────────────

export type UncutResolution =
  | { clears: MatrixCellLink[]; deletes: MatrixCellLink[]; error?: undefined }
  | { clears?: undefined; deletes?: undefined; error: string };

/**
 * The cell's cut translations, one entry per distinct target, each with the slice
 * the cell displays for it — feeds the ↺ chooser on a multi-cut cell (§3.5).
 */
export function cellCutTargets(
  cell: readonly MatrixCellLink[],
): Array<{ target_unit_id: number; slice: string }> {
  const seen = new Set<number>();
  const out: Array<{ target_unit_id: number; slice: string }> = [];
  for (const l of cell) {
    if (l.char_start == null || seen.has(l.target_unit_id)) continue;
    seen.add(l.target_unit_id);
    const [ws, we] = linkWindow(l);
    out.push({ target_unit_id: l.target_unit_id, slice: codePointSlice(l.target_text_raw ?? "", ws, we).trim() });
  }
  return out;
}

/**
 * Resolve the cell ↺ at `row`: pick the cell's cut target (`targetUnitId` when the
 * cell carries several — the chooser's pick), gather every link on it across the
 * column — the whole cut sequence — and split them into `clears` (aligner links:
 * clear_target_span) and `deletes` (gesture-created `manual` links carrying a cut).
 * If ONLY manual links hold the target (hand-built alignment), nothing is deleted —
 * everything is cleared, so the target is never orphaned.
 */
export function resolveCellUncut(
  column: CellLinkColumn, row: number, targetUnitId?: number,
): UncutResolution {
  const cur = column[row] ?? [];
  let cutTargets = [...new Set(cur.filter((l) => l.char_start != null).map((l) => l.target_unit_id))];
  if (targetUnitId !== undefined) cutTargets = cutTargets.filter((t) => t === targetUnitId);
  if (cutTargets.length === 0) return { error: "Aucune coupe à annuler sur cette cellule." };
  if (cutTargets.length > 1) {
    return { error: "Plusieurs traductions coupées sur cette cellule — préciser laquelle." };
  }
  const group = column.flatMap((links) => links.filter((l) => l.target_unit_id === cutTargets[0]));
  const cutLinks = group.filter((l) => l.char_start != null);
  const hasAlignerLink = group.some((l) => l.manual !== true);
  const deletes = hasAlignerLink ? cutLinks.filter((l) => l.manual === true) : [];
  const clears = cutLinks.filter((l) => !deletes.includes(l));
  return { clears, deletes };
}

/** Atomic batch for the ↺: clear the aligner links' cuts, delete the manual ones. */
export function buildUncutActions(res: { clears: MatrixCellLink[]; deletes: MatrixCellLink[] }): AlignBatchAction[] {
  return [
    ...res.clears.map((l) => ({ action: "clear_target_span" as const, link_id: l.link_id })),
    ...res.deletes.map((l) => ({ action: "delete" as const, link_id: l.link_id })),
  ];
}

// ─── Cell bead (D-W16) ───────────────────────────────────────────────────────────

/**
 * `set_bead` for every link a gesture leaves on ONE cell — a cell holding several
 * links is one bead (1 hub segment ↔ N target sentences), not a collision. Without
 * this the gesture-created (`manual`, bead-less) link sat next to the aligner's beaded
 * one and the detector flagged a phantom collision in Qualité / Révision fine.
 *
 * `[]` for a cell that ends with a single link: it is already its own bead, and the
 * server would only rewrite the row for nothing.
 */
export function buildCellBeadActions(cellLinks: ReadonlyArray<Pick<MatrixCellLink, "link_id">>): AlignBatchAction[] {
  if (cellLinks.length < 2) return [];
  return cellLinks.map((l) => ({ action: "set_bead" as const, link_id: l.link_id }));
}

// ─── Resolution : ⭙ Fusionner — absorb the neighbouring sentence (D-W16) ─────────

export type MergeResolution =
  | {
      /** The link to move onto THIS hub row (delete it, re-create it on this pivot). */
      link: MatrixCellLink;
      /** Row it currently lives on — the cell that will be emptied. */
      neighborRow: number;
      error?: undefined;
    }
  | { link?: undefined; neighborRow?: undefined; error: string };

/**
 * « ⭙ Fusionner » — the exact inverse of ✂ Couper: instead of splitting one target
 * across two hub rows, PULL the neighbour's target sentence into this row (the real
 * case when the translation is more finely segmented than the source: 1 FR segment ↔
 * 2 EN sentences).
 *
 * Direction picks the EDGE link of the neighbour cell (§3.5 rule): absorbing the row
 * BELOW takes its first link (reading order), the row ABOVE its last — only an edge
 * link touches the boundary.
 *
 * Refused when the neighbour's link carries a cut: absorbing a *slice* of a shared
 * target would mix the two mechanics — ↺ first, then merge.
 */
export function resolveCellMerge(
  column: CellLinkColumn, row: number, direction: StraddleDirection,
): MergeResolution {
  if (row < 0 || row >= column.length) return { error: "Cellule hors de la matrice." };
  const neighborRow = direction === "up" ? row - 1 : row + 1;
  if (neighborRow < 0 || neighborRow >= column.length) {
    return { error: direction === "up" ? "Pas de segment au-dessus." : "Pas de segment en dessous." };
  }
  const neighbor = column[neighborRow] ?? [];
  if (neighbor.length === 0) {
    return { error: "Le segment voisin n'a aucune traduction à absorber." };
  }
  // Edge link: the one that touches the boundary between the two rows.
  const link = direction === "up" ? neighbor[neighbor.length - 1] : neighbor[0];
  if (link.char_start != null) {
    return {
      error: "La traduction voisine est coupée — annuler la coupe (↺) avant de fusionner.",
    };
  }
  const cur = column[row] ?? [];
  if (cur.some((l) => l.target_unit_id === link.target_unit_id)) {
    return { error: "Cette traduction est déjà rattachée à ce segment." };
  }
  return { link, neighborRow };
}

// ─── Partition actions (D-W13 — the write behind both cut gestures) ─────────────

/**
 * Actions partitioning the window `[ws, we]` at `cutOffset`: every `above` link
 * gets `[ws, cutOffset]`, every `below` link `[cutOffset, we]`. Returns [] on a
 * degenerate offset (an empty slice is not a cut — §3.2 conservation) or an empty
 * side.
 */
export function buildPartitionActions(
  above: ReadonlyArray<Pick<MatrixCellLink, "link_id">>,
  below: ReadonlyArray<Pick<MatrixCellLink, "link_id">>,
  cutOffset: number, ws: number, we: number,
): AlignBatchAction[] {
  if (above.length === 0 || below.length === 0) return [];
  if (cutOffset <= ws || cutOffset >= we) return [];
  return [
    ...above.map((l) => ({ action: "set_target_span" as const, link_id: l.link_id, char_start: ws, char_end: cutOffset })),
    ...below.map((l) => ({ action: "set_target_span" as const, link_id: l.link_id, char_start: cutOffset, char_end: we })),
  ];
}

// ─── Suggestion : pre-filled cut point (§3.2 « suggestion qu'on ajuste ») ────────

/**
 * Suggested cut offset inside the window: split proportionally to the two hub
 * sides' lengths, snapped to the nearest viable boundary. `null` when the window
 * has no viable boundary.
 */
export function suggestCutOffset(
  targetRaw: string,
  hubTextAbove: string,
  hubTextRow: string,
  window?: [number, number],
): number | null {
  const [ws, we] = window ?? [0, codePointLength(targetRaw)];
  const offs = viableCutOffsetsIn(targetRaw, ws, we);
  if (offs.length === 0) return null;
  const a = codePointLength(hubTextAbove);
  const b = codePointLength(hubTextRow);
  const ratio = a + b > 0 ? a / (a + b) : 0.5;
  const ideal = ws + (we - ws) * ratio;
  let best = offs[0];
  for (const o of offs) {
    if (Math.abs(o - ideal) < Math.abs(best - ideal)) best = o;
  }
  return best;
}

// ─── Two-panel picker HTML (§3.2, move-only, windowed) ───────────────────────────

export interface CutPanelsLabels {
  /** 1-based hub segment numbers, for the panel headers. */
  topSeg: number;
  topHub: string;
  bottomSeg: number;
  bottomHub: string;
}

/**
 * The window's words split at cut `offset`: each word is a button carrying in
 * `data-cut-offset` the boundary that *moves it to the other panel*. Only
 * boundaries keeping both slices non-blank are clickable (F7); the window's edge
 * words are fixed (an empty slice is not a cut). All corpus text is escaped;
 * inject via `setHtml(raw(...))`.
 */
export function buildCutPanelsHtml(
  targetRaw: string,
  offset: number,
  labels: CutPanelsLabels,
  window?: [number, number],
): string {
  const [ws, we] = window ?? [0, codePointLength(targetRaw)];
  const starts = [ws, ...cutOffsets(targetRaw).filter((o) => o > ws && o < we)];
  const viable = new Set(viableCutOffsetsIn(targetRaw, ws, we));

  const word = (i: number, newOffset: number | null): string => {
    const text = codePointSlice(targetRaw, starts[i], starts[i + 1] ?? we).trim();
    if (newOffset === null || !viable.has(newOffset)) {
      return `<span class="prep-matrix-cut-word prep-matrix-cut-word--fixed">${_esc(text)}</span>`;
    }
    return `<button type="button" class="prep-matrix-cut-word" data-cut-offset="${newOffset}"`
      + ` title="D&#233;placer vers l'autre panneau">${_esc(text)}</button>`;
  };

  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] < offset) {
      // Clicking a top word moves the boundary *before* it (the window's first word excluded).
      top.push(word(i, i === 0 ? null : starts[i]));
    } else {
      // Clicking a bottom word moves the boundary *after* it (the window's last word excluded).
      bottom.push(word(i, i === starts.length - 1 ? null : starts[i + 1]));
    }
  }

  const panel = (kind: "top" | "bottom", seg: number, hub: string, words: string[]): string =>
    `<div class="prep-matrix-cut-panel" data-panel="${kind}">`
    + `<div class="prep-matrix-cut-panel-head" title="${_esc(hub)}">`
    + `<span class="prep-matrix-cut-panel-seg">seg ${seg}</span> ${_esc(hub)}</div>`
    + `<div class="prep-matrix-cut-panel-body">${words.join(" ")}</div>`
    + `</div>`;

  return panel("top", labels.topSeg, labels.topHub, top)
    + `<div class="prep-matrix-cut-sep" aria-hidden="true">&#9986;</div>`
    + panel("bottom", labels.bottomSeg, labels.bottomHub, bottom);
}
