import { describe, it, expect } from "vitest";
import type { AlignLinkRecord } from "../sidecarClient.ts";
import {
  groupLinksIntoBeads,
  isMultiBead,
  codePointSlice,
  codePointLength,
  linkTargetDisplay,
  beadIsCut,
  cutOffsets,
  buildCutActions,
  buildClearCutActions,
} from "../alignBeads.ts";

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

describe("codePointSlice", () => {
  it("slices ASCII by index", () => {
    expect(codePointSlice("abcdef", 0, 3)).toBe("abc");
    expect(codePointSlice("abcdef", 3, 6)).toBe("def");
  });

  it("slices by code points, not UTF-16 units (non-BMP safe)", () => {
    // "a😀b": the emoji is ONE code point but TWO UTF-16 units — String.slice(0,2)
    // would split it; codePointSlice keeps it whole.
    expect(codePointSlice("a😀b", 0, 2)).toBe("a😀");
    expect(codePointSlice("a😀b", 2, 3)).toBe("b");
  });
});

describe("linkTargetDisplay", () => {
  const withSpan = (raw: string, s: number | null, e: number | null) =>
    ({ ...lk(1, 9, 17, 2), target_text: "NORMALISED", target_text_raw: raw, target_char_start: s, target_char_end: e });

  it("returns the cut slice of text_raw when offsets are set", () => {
    expect(linkTargetDisplay(withSpan("I can hear it: the sound.", 0, 13))).toBe("I can hear it");
    expect(linkTargetDisplay(withSpan("I can hear it: the sound.", 13, 25))).toBe(": the sound.");
  });

  it("falls back to the normalised target_text when uncut (unchanged behaviour)", () => {
    expect(linkTargetDisplay(withSpan("verbatim", null, null))).toBe("NORMALISED");
  });
});

describe("beadIsCut", () => {
  const seg = (link_id: number, s: number | null = null, e: number | null = null) =>
    ({ ...lk(link_id, link_id, 17, 2), target_text_raw: "I can hear it: the sound.", target_char_start: s, target_char_end: e });

  it("is false for an uncut bead, true once a link carries a target span", () => {
    expect(beadIsCut(groupLinksIntoBeads([seg(9), seg(10)])[0])).toBe(false);
    expect(beadIsCut(groupLinksIntoBeads([seg(9, 0, 13), seg(10, 13, 25)])[0])).toBe(true);
  });
});

describe("codePointLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(codePointLength("abc")).toBe(3);
    expect(codePointLength("a😀b")).toBe(3); // emoji = 1 code point (2 UTF-16 units)
  });
});

describe("cutOffsets", () => {
  it("offers a cut at the start of each word after the first", () => {
    expect(cutOffsets("a b c")).toEqual([2, 4]);       // "a "|"b "|"c"
    expect(cutOffsets("hello world")).toEqual([6]);    // "hello "|"world"
  });
  it("no cut for a single word or empty text", () => {
    expect(cutOffsets("single")).toEqual([]);
    expect(cutOffsets("")).toEqual([]);
  });
  it("collapses runs of whitespace to one boundary (at the next word)", () => {
    expect(cutOffsets("a   b")).toEqual([4]); // one cut, at 'b'
  });
});

describe("buildCutActions", () => {
  const p = (link_id: number, pivot: number) => lk(link_id, pivot, 17, 2);

  it("cuts a 2-1 into complementary set_target_span actions", () => {
    expect(buildCutActions([p(101, 9), p(102, 10)], 13, 25)).toEqual([
      { action: "set_target_span", link_id: 101, char_start: 0, char_end: 13 },
      { action: "set_target_span", link_id: 102, char_start: 13, char_end: 25 },
    ]);
  });

  it("returns [] for a non-2-1 bead (B2 scope)", () => {
    expect(buildCutActions([p(101, 9)], 5, 10)).toEqual([]);
    expect(buildCutActions([p(101, 9), p(102, 10), p(103, 11)], 5, 30)).toEqual([]);
  });
});

describe("buildClearCutActions", () => {
  it("clears the span on every link of the bead", () => {
    expect(buildClearCutActions([lk(101, 9, 17, 2), lk(102, 10, 17, 2)])).toEqual([
      { action: "clear_target_span", link_id: 101 },
      { action: "clear_target_span", link_id: 102 },
    ]);
  });
});
