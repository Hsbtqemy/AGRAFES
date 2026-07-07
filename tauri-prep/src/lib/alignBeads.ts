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
import type { AlignLinkRecord } from "./sidecarClient.ts";

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
