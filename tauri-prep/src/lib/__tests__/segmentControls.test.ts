import { describe, it, expect } from "vitest";
import type { SegmentPreviewSegment } from "../sidecarClient.ts";
import {
  buildSegmentParams,
  groupSegmentsBySource,
  segmentSummaryLine,
  needsAlignmentConfirm,
  surfaceHint,
  defaultAbbreviations,
  parseAbbreviations,
  autoSplitText,
  type CustomSpecState,
} from "../segmentControls.ts";

describe("buildSegmentParams", () => {
  it("maps Phrases / Balises to built-in presets", () => {
    expect(buildSegmentParams("phrases")).toEqual({ preset: "phrases" });
    expect(buildSegmentParams("balises")).toEqual({ preset: "balises" });
  });

  it("Brut and Tours request no fine segmentation params", () => {
    expect(buildSegmentParams("brut")).toEqual({});
    expect(buildSegmentParams("tours")).toEqual({}); // Tours is a coarse regroup, own endpoint
  });

  it("builds a terminator spec from the custom terminator set + extra abbreviations", () => {
    const custom: CustomSpecState = {
      terminators: [".!?", ";:"], requireUppercase: false, wordMode: false, abbreviations: ["cap", "pág"],
    };
    expect(buildSegmentParams("custom", custom)).toEqual({
      spec: {
        kind: "terminator", terminators: ".!?;:", require_uppercase_after: false,
        protect_abbreviations: ["cap", "pág"], label: "custom",
      },
    });
  });

  it("custom word mode → whitespace spec (terminators + abbreviations ignored)", () => {
    const custom: CustomSpecState = {
      terminators: [".!?"], requireUppercase: true, wordMode: true, abbreviations: ["cap"],
    };
    expect(buildSegmentParams("custom", custom)).toEqual({ spec: { kind: "whitespace", label: "mots" } });
  });

  it("custom with no state falls back to a bare terminator spec (no capital condition)", () => {
    expect(buildSegmentParams("custom")).toEqual({
      spec: {
        kind: "terminator", terminators: ".!?", require_uppercase_after: false,
        protect_abbreviations: [], label: "custom",
      },
    });
  });
});

describe("defaultAbbreviations", () => {
  it("pre-fills the doc language pack, empty for unknown languages", () => {
    expect(defaultAbbreviations("fr")).toEqual(["ann", "chap", "env", "etc", "par"]);
    expect(defaultAbbreviations("en-US")).toEqual(["approx", "dept", "misc", "chap"]);
    expect(defaultAbbreviations("es")).toEqual([]);
    expect(defaultAbbreviations(null)).toEqual([]);
  });
});

describe("parseAbbreviations", () => {
  it("splits on commas / spaces / semicolons and strips trailing dots", () => {
    expect(parseAbbreviations("cap, pág;  art. \n etc.")).toEqual(["cap", "pág", "art", "etc"]);
  });
  it("empty / whitespace input → empty list", () => {
    expect(parseAbbreviations("   ")).toEqual([]);
    expect(parseAbbreviations("")).toEqual([]);
  });
});

describe("groupSegmentsBySource", () => {
  const seg = (n: number, text: string, src: number): SegmentPreviewSegment => ({
    n, text, source_unit_n: src, external_id: null,
  });

  it("groups consecutive segments by source unit, preserving order", () => {
    const groups = groupSegmentsBySource([
      seg(1, "A.", 1), seg(2, "B.", 1), seg(3, "C.", 2), seg(4, "D.", 3), seg(5, "E.", 3),
    ]);
    expect(groups.map((g) => g.source_unit_n)).toEqual([1, 2, 3]);
    expect(groups[0].segments.map((s) => s.text)).toEqual(["A.", "B."]);
    expect(groups[2].segments).toHaveLength(2);
  });

  it("empty input → empty grouping", () => {
    expect(groupSegmentsBySource([])).toEqual([]);
  });

  it("does not merge non-adjacent repeats of the same source (defensive)", () => {
    const groups = groupSegmentsBySource([seg(1, "A", 1), seg(2, "B", 2), seg(3, "C", 1)]);
    expect(groups.map((g) => g.source_unit_n)).toEqual([1, 2, 1]);
  });
});

describe("segmentSummaryLine", () => {
  it("agrees plurals in French", () => {
    expect(segmentSummaryLine(1, 1)).toBe("1 unité → 1 segment");
    expect(segmentSummaryLine(2, 5)).toBe("2 unités → 5 segments");
  });
});

describe("needsAlignmentConfirm", () => {
  it("only confirms when there is an alignment to lose", () => {
    expect(needsAlignmentConfirm(0)).toBe(false);
    expect(needsAlignmentConfirm(null)).toBe(false);
    expect(needsAlignmentConfirm(undefined)).toBe(false);
    expect(needsAlignmentConfirm(3)).toBe(true);
  });
});

describe("surfaceHint", () => {
  it("returns a distinct hint per surface", () => {
    const hints = new Set([
      surfaceHint("phrases"), surfaceHint("balises"), surfaceHint("custom"), surfaceHint("tours"),
    ]);
    expect(hints.size).toBe(4);
  });
});

describe("autoSplitText", () => {
  it("splits at the last space before the midpoint, trimming both halves", () => {
    // len 11, midpoint = ceil(11/2) = 6; last space before index 6 is index 5.
    expect(autoSplitText("hello world")).toEqual({ a: "hello", b: "world" });
  });

  it("falls back to the raw midpoint when there is no space before it", () => {
    // "abcdefgh" len 8, midpoint 4, no space → cut at 4.
    expect(autoSplitText("abcdefgh")).toEqual({ a: "abcd", b: "efgh" });
  });

  it("keeps the whole text in the first half when a leading space is the only one", () => {
    // lastIndexOf(" ", mid) === 0 is not > 0 → falls back to midpoint.
    const { a, b } = autoSplitText(" trailing");
    expect(a + b).toContain("trailing");
  });
});

