/**
 * alignCellCut.ts — pure logic + HTML for the matrix-cell « ✂ Couper » gestures
 * (R3.3 tranches 3b + D-W12, docs/DESIGN_alignment_workspace §3.2/§3.4).
 *
 * Resolution works on the matrix's own `cell_links` (A2, sidecar ≥ 1.6.54): a column
 * is the per-row list of links behind one translation — exactly what the cells
 * display (rejected excluded server-side), no audit round-trip, no parallel-array
 * indexing. Two gestures resolve here:
 *
 * - **Fused cut** (3b): a ⚠ cell shares an uncut target with the row above (2-1) —
 *   find the two links to slice.
 * - **Straddle cut** (D-W12 « couper à cheval ») : any cell whose translation spills
 *   over the neighbouring hub segment — the missing link is CREATED toward the
 *   neighbour, then both links get complementary slices. On-demand: no ⚠ needed,
 *   the human reading the matrix is the detector.
 *
 * The two-panel move-only picker (§3.2, D-W9 one contiguous point) renders both:
 * top panel = the slice for the upper segment, bottom = the lower one; clicking a
 * word moves the boundary — never typed, so `top + bottom == original` holds by
 * construction. No DOM, no sidecar here.
 */

import type { MatrixCellLink } from "./sidecarClient.ts";
import { cutOffsets, codePointLength, codePointSlice } from "./alignBeads.ts";
import { escHtml as _esc } from "./diff.ts";

/** One translation column of the matrix: cell_links[row][col] for a fixed col. */
export type CellLinkColumn = ReadonlyArray<readonly MatrixCellLink[]>;

// ─── Viable cut points (F7) ──────────────────────────────────────────────────────

/**
 * Word boundaries where BOTH slices keep visible text. `cutOffsets` alone admits a
 * degenerate cut when text_raw carries leading/trailing whitespace (offset 1 on
 * " Hello world" → a whitespace-only head slice, projected as an empty cell ∅ —
 * the very slice §3.2 forbids). Every consumer (resolvers, suggestion, panels)
 * goes through this filter.
 */
export function viableCutOffsets(text: string): number[] {
  const len = codePointLength(text);
  return cutOffsets(text).filter(
    (o) => codePointSlice(text, 0, o).trim() !== "" && codePointSlice(text, o, len).trim() !== "",
  );
}

// ─── Resolution : fused cell → the 2 links of its 2-1 bead (3b) ──────────────────

export type CellCutResolution =
  | { links: [MatrixCellLink, MatrixCellLink]; error?: undefined }
  | { links?: undefined; error: string };

/**
 * From one translation column, find the two links behind the fused cell at `row`:
 * the single uncut target unit shared with the row above. Returns them ordered
 * [above, row] — the order `buildCutActions` expects (first link keeps the head
 * slice). Errors are user-facing French messages (v1 scope: exactly one shared
 * target, 2-1 only, not already cut, at least one viable boundary).
 */
export function resolveFusedCellLinks(column: CellLinkColumn, row: number): CellCutResolution {
  if (row < 1 || row >= column.length) return { error: "Cellule hors de la matrice." };
  const above = column[row - 1] ?? [];
  const cur = column[row] ?? [];
  if (above.length === 0 || cur.length === 0) {
    return { error: "Liens d'alignement introuvables pour cette cellule." };
  }
  const aboveTargets = new Set(above.map((l) => l.target_unit_id));
  const shared = [...new Set(cur.map((l) => l.target_unit_id))].filter((t) => aboveTargets.has(t));
  if (shared.length === 0) {
    return { error: "Les deux lignes pointent vers des traductions distinctes — rien à couper ici." };
  }
  if (shared.length > 1) {
    return { error: "Appariement ambigu (plusieurs traductions partagées) — passer par la Révision fine." };
  }
  const holders = column.reduce(
    (n, links) => n + links.filter((l) => l.target_unit_id === shared[0]).length, 0);
  if (holders > 2) {
    return {
      error: `Cette traduction couvre ${holders} segments du moyeu — la coupe ne gère que le cas 2-1 pour l'instant.`,
    };
  }
  const la = above.find((l) => l.target_unit_id === shared[0])!;
  const lb = cur.find((l) => l.target_unit_id === shared[0])!;
  if (la.char_start != null || lb.char_start != null) {
    return { error: "Cette traduction est déjà coupée — annuler d'abord la coupe (↺, Révision fine)." };
  }
  if (viableCutOffsets(la.target_text_raw ?? "").length === 0) {
    return { error: "Traduction d'un seul mot — aucun point de coupe possible." };
  }
  return { links: [la, lb] };
}

// ─── Resolution : straddle cut toward a neighbour (D-W12 « couper à cheval ») ─────

export type StraddleDirection = "up" | "down";

export type StraddleResolution =
  | { link: MatrixCellLink; neighborRow: number; error?: undefined }
  | { link?: undefined; neighborRow?: undefined; error: string };

/**
 * Resolve « couper à cheval » on the cell at `row`: its (single, uncut) translation
 * spills over the neighbouring hub segment (`up` = the HEAD belongs to row-1,
 * `down` = the TAIL belongs to row+1). The gesture then creates the missing link
 * toward the neighbour and slices both — this resolver only vets the preconditions:
 * one uncut link, an existing neighbour row, the neighbour not already holding this
 * target (that shape is the fused case → « ✂ Couper » classique), and a viable
 * boundary.
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
  if (cur.length > 1) {
    return { error: "Cellule à plusieurs traductions (bead) — passer par la Révision fine pour ce cas." };
  }
  const link = cur[0];
  if (link.char_start != null) {
    return { error: "Cette traduction est déjà coupée — annuler d'abord la coupe (↺, Révision fine)." };
  }
  const neighbor = column[neighborRow] ?? [];
  if (neighbor.some((l) => l.target_unit_id === link.target_unit_id)) {
    return { error: "Le segment voisin partage déjà cette traduction — utiliser « ✂ Couper » sur la cellule ⚠." };
  }
  if (viableCutOffsets(link.target_text_raw ?? "").length === 0) {
    return { error: "Traduction d'un seul mot — aucun point de coupe possible." };
  }
  return { link, neighborRow };
}

// ─── Suggestion : pre-filled cut point (§3.2 « suggestion qu'on ajuste ») ────────

/**
 * Suggested cut offset: split the target proportionally to the two hub segments'
 * lengths, snapped to the nearest viable word boundary. `null` when the target has
 * no viable boundary (single word).
 */
export function suggestCutOffset(
  targetRaw: string,
  hubTextAbove: string,
  hubTextRow: string,
): number | null {
  const offs = viableCutOffsets(targetRaw);
  if (offs.length === 0) return null;
  const a = codePointLength(hubTextAbove);
  const b = codePointLength(hubTextRow);
  const ratio = a + b > 0 ? a / (a + b) : 0.5;
  const ideal = codePointLength(targetRaw) * ratio;
  let best = offs[0];
  for (const o of offs) {
    if (Math.abs(o - ideal) < Math.abs(best - ideal)) best = o;
  }
  return best;
}

// ─── Two-panel picker HTML (§3.2, move-only) ─────────────────────────────────────

export interface CutPanelsLabels {
  /** 1-based hub segment numbers, for the panel headers. */
  topSeg: number;
  topHub: string;
  bottomSeg: number;
  bottomHub: string;
}

/**
 * The two panels at cut `offset`: each word is a button carrying in
 * `data-cut-offset` the boundary that *moves it to the other panel* (click a top
 * word → it and the following words go down; click a bottom word → it and the
 * preceding words come up). Only boundaries keeping both slices non-blank are
 * clickable (F7); the first and last words are fixed (an empty slice is not a
 * cut). All corpus text is escaped; inject via `setHtml(raw(...))`.
 */
export function buildCutPanelsHtml(
  targetRaw: string,
  offset: number,
  labels: CutPanelsLabels,
): string {
  const starts = [0, ...cutOffsets(targetRaw)];
  const len = codePointLength(targetRaw);
  const viable = new Set(viableCutOffsets(targetRaw));

  const word = (i: number, newOffset: number | null): string => {
    const text = codePointSlice(targetRaw, starts[i], starts[i + 1] ?? len).trim();
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
      // Clicking a top word moves the boundary *before* it (word 0 excluded).
      top.push(word(i, i === 0 ? null : starts[i]));
    } else {
      // Clicking a bottom word moves the boundary *after* it (last word excluded).
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
