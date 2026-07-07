/**
 * alignBeads.ts — pure grouping of alignment audit links into display "beads".
 *
 * A bead is a run of consecutive links sharing a non-null bead_id (an N-M
 * correspondence, R3.2/K3). This module decides, per bead, which side is *shared*
 * — the same unit repeated across the bead's links — so the renderer can show that
 * side ONCE and mark the others as a continuation, instead of duplicating the text
 * (the confusing "EN17 printed on both rows of a 2-1" case). No DOM, no sidecar.
 *
 * See docs/DESIGN_source_anchored_alignment.md §8 (bead 2→1 rendered en bloc).
 *
 * SCOPE / assumption: grouping is by `bead_id` only, which is unique *within a run*
 * (the collision key is run_id||'#'||bead_id, cf. K3). The audit view is not filtered
 * by run, so in the degenerate multi-run state (a `replace_existing=false` re-align
 * accumulating runs) two beads `runA#1` / `runB#1` could be over-grouped. The *span*
 * stays safe there — it hoists a side only when that side is a single shared unit
 * (`pivots===1` or `targets===1`), so it never hides *different* content, only an
 * identical unit; at worst the N→M badge count is off. The robust fix is to group by
 * the run-scoped `bead_uid` once the audit response exposes it (tranche 2).
 */
import type { AlignLinkRecord, AlignBatchAction } from "./sidecarClient.ts";

export interface BeadGroup {
  /** The bead's links, in display order. A singleton (bead_id null) → exactly 1 link. */
  links: AlignLinkRecord[];
  /** Distinct pivot units in the bead. */
  pivots: number;
  /** Distinct target units in the bead. */
  targets: number;
  /**
   * The side repeated across the bead's links, hoisted to the first row and marked
   * as a continuation on the rest: `"target"` for an N-1 (many pivots → one target),
   * `"pivot"` for a 1-M (one pivot → many targets). `null` for a singleton, or a
   * 2-2 (positional pairs — nothing single to hoist).
   */
  sharedSide: "pivot" | "target" | null;
}

/** True when the group is a real multi-link bead (not a singleton 1-1 link). */
export function isMultiBead(g: BeadGroup): boolean {
  return g.links.length > 1;
}

/**
 * Group consecutive links by their `bead_id`. Links without a bead_id each form
 * their own singleton group. The audit list is ordered by position, so a bead's
 * links are contiguous — a single forward pass suffices. Non-adjacent repeats of
 * the same bead_id are (defensively) kept as separate groups.
 */
export function groupLinksIntoBeads(links: readonly AlignLinkRecord[]): BeadGroup[] {
  const groups: BeadGroup[] = [];
  let cur: AlignLinkRecord[] | null = null;
  let curBead: number | null = null;

  const flush = () => {
    if (cur && cur.length) groups.push(_finalize(cur));
    cur = null;
    curBead = null;
  };

  for (const lk of links) {
    const bid = lk.bead_id ?? null;
    if (cur && bid !== null && bid === curBead) {
      cur.push(lk);
    } else {
      flush();
      cur = [lk];
      curBead = bid;
    }
  }
  flush();
  return groups;
}

function _finalize(links: AlignLinkRecord[]): BeadGroup {
  const pivots = new Set(links.map((l) => l.pivot_unit_id)).size;
  const targets = new Set(links.map((l) => l.target_unit_id)).size;
  let sharedSide: "pivot" | "target" | null = null;
  if (links.length > 1) {
    if (targets === 1 && pivots > 1) sharedSide = "target";
    else if (pivots === 1 && targets > 1) sharedSide = "pivot";
  }
  return { links, pivots, targets, sharedSide };
}

// ─── Source-anchored cut ("couper", R3.3 §D9) ────────────────────────────────

/**
 * Slice a string by CODE POINTS. The server stores cut offsets as code-point
 * indices (SQLite `length()` counts code points, matching Python `len()`); JS
 * `String.slice` counts UTF-16 code units, which differ only for non-BMP characters
 * (emoji, rare CJK) — so we go through `Array.from` to stay correct there too.
 */
export function codePointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join("");
}

/**
 * The target text to display for a link: the source-anchored **cut slice** of the
 * verbatim `target_text_raw` when the link carries a sub-span, otherwise the normal
 * (normalised) `target_text`. Backward-compatible: an uncut link renders exactly as
 * before.
 */
export function linkTargetDisplay(lk: AlignLinkRecord): string {
  const s = lk.target_char_start;
  const e = lk.target_char_end;
  if (s != null && e != null && lk.target_text_raw != null) {
    return codePointSlice(lk.target_text_raw, s, e);
  }
  return lk.target_text ?? "";
}

/**
 * True once a bead has been *resolved by cutting* — at least one link carries a
 * target sub-span. A cut bead renders as independent sliced 1-1 rows (each source
 * keeps its own slice of the target), not a shared-side block.
 */
export function beadIsCut(g: BeadGroup): boolean {
  return g.links.some((l) => l.target_char_start != null && l.target_char_end != null);
}

/** Number of CODE POINTS in a string (matches the server's offset unit). */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Code-point offsets where a cut may be placed in the verbatim target: at the start
 * of each word after the first (a whitespace → non-whitespace boundary). A cut at
 * offset X splits the text into `[0:X]` and `[X:]`. 0 and the length are excluded
 * (they would make an empty slice).
 */
export function cutOffsets(text: string): number[] {
  const cps = Array.from(text);
  const offsets: number[] = [];
  for (let i = 1; i < cps.length; i++) {
    if (/\s/.test(cps[i - 1]) && !/\s/.test(cps[i])) offsets.push(i);
  }
  return offsets;
}

/**
 * Actions to cut a target-shared **2-1** bead at code-point `cutOffset`: the first
 * source keeps `[0, cutOffset]`, the second `[cutOffset, textLen]` (positional — the
 * source order matches the target order, the source-anchored assumption). Returns []
 * for a non-2-1 bead (B2 scope) so the caller keeps the affordance off.
 */
export function buildCutActions(
  links: readonly AlignLinkRecord[], cutOffset: number, textLen: number,
): AlignBatchAction[] {
  if (links.length !== 2) return [];
  return [
    { action: "set_target_span", link_id: links[0].link_id, char_start: 0, char_end: cutOffset },
    { action: "set_target_span", link_id: links[1].link_id, char_start: cutOffset, char_end: textLen },
  ];
}

/** Actions to undo a cut — clear the sub-span on every link of the bead (whole unit again). */
export function buildClearCutActions(links: readonly AlignLinkRecord[]): AlignBatchAction[] {
  return links.map((l) => ({ action: "clear_target_span" as const, link_id: l.link_id }));
}
