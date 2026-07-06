import { describe, it, expect } from "vitest";
import type { SegmentPreviewSegment } from "../sidecarClient.ts";
import {
  buildSegmentParams,
  groupSegmentsBySource,
  segmentSummaryLine,
  needsAlignmentConfirm,
  surfaceHint,
  type CustomSpecState,
} from "../segmentControls.ts";

describe("buildSegmentParams", () => {
  it("maps Phrases / Balises to built-in presets", () => {
    expect(buildSegmentParams("phrases")).toEqual({ preset: "phrases" });
    expect(buildSegmentParams("balises")).toEqual({ preset: "balises" });
  });

  it("Brut requests no segmentation params (it is the current state)", () => {
    expect(buildSegmentParams("brut")).toEqual({});
  });

  it("builds a terminator spec from the custom terminator set", () => {
    const custom: CustomSpecState = { terminators: [".!?", ";:"], requireUppercase: false, wordMode: false };
    expect(buildSegmentParams("custom", custom)).toEqual({
      spec: { kind: "terminator", terminators: ".!?;:", require_uppercase_after: false, label: "custom" },
    });
  });

  it("custom word mode → whitespace spec (terminators ignored)", () => {
    const custom: CustomSpecState = { terminators: [".!?"], requireUppercase: true, wordMode: true };
    expect(buildSegmentParams("custom", custom)).toEqual({ spec: { kind: "whitespace", label: "mots" } });
  });

  it("custom with no state falls back to the phrases-like default terminator spec", () => {
    expect(buildSegmentParams("custom")).toEqual({
      spec: { kind: "terminator", terminators: ".!?", require_uppercase_after: true, label: "custom" },
    });
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
    const hints = new Set([surfaceHint("phrases"), surfaceHint("balises"), surfaceHint("custom")]);
    expect(hints.size).toBe(3);
  });
});

