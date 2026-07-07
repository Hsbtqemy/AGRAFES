import { describe, it, expect } from "vitest";
import type { AlignLinkRecord } from "../sidecarClient.ts";
import { groupLinksIntoBeads, isMultiBead } from "../alignBeads.ts";

/** Minimal link builder — only the fields the grouping reads. */
const lk = (
  link_id: number,
  pivot_unit_id: number,
  target_unit_id: number,
  bead_id: number | null = null,
): AlignLinkRecord => ({
  link_id,
  external_id: null,
  pivot_unit_id,
  target_unit_id,
  pivot_text: `p${pivot_unit_id}`,
  target_text: `t${target_unit_id}`,
  status: null,
  bead_id,
});

describe("groupLinksIntoBeads", () => {
  it("keeps null-bead links as separate singletons", () => {
    const groups = groupLinksIntoBeads([lk(1, 1, 1), lk(2, 2, 2)]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.links.length === 1)).toBe(true);
    expect(groups.every((g) => g.sharedSide === null)).toBe(true);
    expect(groups.every((g) => !isMultiBead(g))).toBe(true);
  });

  it("groups an N-1 bead and shares the target (the EN17 2→1 case)", () => {
    // FR9↔EN17, FR10↔EN17 sharing bead 2 → 2 pivots, 1 target.
    const groups = groupLinksIntoBeads([lk(10, 9, 17, 2), lk(11, 10, 17, 2)]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.links).toHaveLength(2);
    expect(g.pivots).toBe(2);
    expect(g.targets).toBe(1);
    expect(g.sharedSide).toBe("target");
    expect(isMultiBead(g)).toBe(true);
  });

  it("groups a 1-M bead and shares the pivot", () => {
    // one FR pivot split into two EN targets sharing bead 5.
    const groups = groupLinksIntoBeads([lk(1, 3, 20, 5), lk(2, 3, 21, 5)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pivots).toBe(1);
    expect(groups[0].targets).toBe(2);
    expect(groups[0].sharedSide).toBe("pivot");
  });

  it("a 2-2 bead has no single shared side (positional pairs)", () => {
    const groups = groupLinksIntoBeads([lk(1, 1, 1, 7), lk(2, 2, 2, 7)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pivots).toBe(2);
    expect(groups[0].targets).toBe(2);
    expect(groups[0].sharedSide).toBeNull();
    expect(isMultiBead(groups[0])).toBe(true);
  });

  it("mixes beads and singletons in reading order", () => {
    const groups = groupLinksIntoBeads([
      lk(1, 7, 15, 1), lk(2, 8, 16, 1),   // 2-2 bead 1
      lk(3, 11, 18),                       // singleton
      lk(4, 9, 17, 2), lk(5, 10, 17, 2),   // 2-1 bead 2
    ]);
    expect(groups.map((g) => g.links.length)).toEqual([2, 1, 2]);
    expect(groups.map((g) => g.sharedSide)).toEqual([null, null, "target"]);
  });

  it("does not merge non-adjacent repeats of the same bead_id (defensive)", () => {
    const groups = groupLinksIntoBeads([lk(1, 1, 1, 3), lk(2, 2, 2), lk(3, 3, 3, 3)]);
    expect(groups.map((g) => g.links.length)).toEqual([1, 1, 1]);
  });

  it("empty input → empty grouping", () => {
    expect(groupLinksIntoBeads([])).toEqual([]);
  });
});
