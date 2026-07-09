/**
 * alignCellCut.ts — pure logic + HTML for the matrix-cell « ✂ Couper » gesture
 * (R3.3 tranche 3b, docs/DESIGN_alignment_workspace §3.2).
 *
 * A ⚠ *fused* cell repeats the previous row's translation: one target unit is linked
 * to two hub segments (an uncut 2-1 bead). This module resolves that cell — via the
 * tranche-3a identifiers (hub_unit_ids / language_doc_ids) and the `/align/audit`
 * links — into the exact 2 links to cut, suggests a cut point, and renders the
 * **two-panel move-only picker** decided in §3.2 (D-W9 : one contiguous cut point):
 * top panel = the slice that stays on the upper hub segment, bottom panel = the
 * slice for the lower one; clicking a word moves the boundary — the text is never
 * typed, so `top + bottom == original` holds by construction (conservation guard,
 * offsets stay valid for `set_target_span`). No DOM, no sidecar here.
 */

import type { AlignLinkRecord } from "./sidecarClient.ts";
import { cutOffsets, codePointLength, codePointSlice } from "./alignBeads.ts";
import { escHtml as _esc } from "./diff.ts";

// ─── Resolution : fused cell → the 2 links of its 2-1 bead ──────────────────────

export type CellCutResolution =
  | { links: [AlignLinkRecord, AlignLinkRecord]; error?: undefined }
  | { links?: undefined; error: string };

/**
 * From the pair's audit links, find the two links behind a fused cell: the single
 * target unit shared by `hubUnitAbove` (the row whose text the cell repeats) and
 * `hubUnitRow` (the ⚠ row). Returns them ordered [above, row] — the order
 * `buildCutActions` expects (first link keeps the head slice). Errors are
 * user-facing French messages (v1 scope: exactly one shared target, 2-1 only,
 * not already cut, at least one word boundary).
 */
export function resolveFusedCellLinks(
  all: readonly AlignLinkRecord[],
  hubUnitAbove: number,
  hubUnitRow: number,
): CellCutResolution {
  const ofAbove = all.filter((l) => l.pivot_unit_id === hubUnitAbove);
  const ofRow = all.filter((l) => l.pivot_unit_id === hubUnitRow);
  if (ofAbove.length === 0 || ofRow.length === 0) {
    return { error: "Liens d'alignement introuvables pour cette cellule." };
  }
  const aboveTargets = new Set(ofAbove.map((l) => l.target_unit_id));
  const shared = [...new Set(ofRow.map((l) => l.target_unit_id))].filter((t) => aboveTargets.has(t));
  if (shared.length === 0) {
    return {
      error:
        "Les deux lignes pointent vers des traductions distinctes (textes identiques"
        + " mais unités différentes) — rien à couper.",
    };
  }
  if (shared.length > 1) {
    return { error: "Appariement ambigu (plusieurs traductions partagées) — passer par la Révision fine." };
  }
  const holders = all.filter((l) => l.target_unit_id === shared[0]);
  if (holders.length > 2) {
    return {
      error: `Cette traduction couvre ${holders.length} segments du moyeu — la coupe ne gère que le cas 2-1 pour l'instant.`,
    };
  }
  const la = ofAbove.find((l) => l.target_unit_id === shared[0])!;
  const lb = ofRow.find((l) => l.target_unit_id === shared[0])!;
  if (la.target_char_start != null || lb.target_char_start != null) {
    return { error: "Cette traduction est déjà coupée — annuler d'abord la coupe (↺, Révision fine)." };
  }
  const rawText = la.target_text_raw;
  if (rawText == null || cutOffsets(rawText).length === 0) {
    return { error: "Traduction d'un seul mot — aucun point de coupe possible." };
  }
  return { links: [la, lb] };
}

// ─── Suggestion : pre-filled cut point (§3.2 « suggestion qu'on ajuste ») ────────

/**
 * Suggested cut offset: split the target proportionally to the two hub segments'
 * lengths, snapped to the nearest word boundary. `null` when the target has no
 * boundary (single word).
 */
export function suggestCutOffset(
  targetRaw: string,
  hubTextAbove: string,
  hubTextRow: string,
): number | null {
  const offs = cutOffsets(targetRaw);
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
 * preceding words come up). The first and last words are fixed (an empty slice is
 * not a cut). All corpus text is escaped; inject via `setHtml(raw(...))`.
 */
export function buildCutPanelsHtml(
  targetRaw: string,
  offset: number,
  labels: CutPanelsLabels,
): string {
  const starts = [0, ...cutOffsets(targetRaw)];
  const len = codePointLength(targetRaw);

  const word = (i: number, newOffset: number | null): string => {
    const text = codePointSlice(targetRaw, starts[i], starts[i + 1] ?? len).trim();
    if (newOffset === null) {
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
