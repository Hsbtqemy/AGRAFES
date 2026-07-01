import { describe, it, expect } from "vitest";
import {
  deriveCoarseBlocks,
  blockIndexByUnitId,
} from "../coarseGrain.ts";
import type { UnitRecord } from "../sidecarClient.ts";

function line(n: number, overrides: Partial<UnitRecord> = {}): UnitRecord {
  return {
    unit_id: n * 10, n, text_norm: "x", text_raw: "x",
    unit_type: "line", unit_role: null, parent_n: null, ...overrides,
  };
}

// ─── derived regime (no parent_n) ─────────────────────────────────────────────

describe("deriveCoarseBlocks — derived regime", () => {
  it("docx paragraphs: one line is one coarse block", () => {
    const blocks = deriveCoarseBlocks([line(1), line(2), line(3)]);
    expect(blocks.map((b) => b.anchorN)).toEqual([1, 2, 3]);
    expect(blocks.every((b) => b.kind === "line" && b.fineCount === 1)).toBe(true);
  });

  it("detects a composite ¤ line and its fine cardinality", () => {
    const b = deriveCoarseBlocks([line(1, { text_raw: "Un¤Deux¤Trois" })])[0];
    expect(b.kind).toBe("composite");
    expect(b.fineCount).toBe(3);
  });

  it("classifies an intertitre line as a heading block", () => {
    const blocks = deriveCoarseBlocks([line(1, { unit_role: "intertitre" }), line(2)]);
    expect(blocks[0].kind).toBe("heading");
    expect(blocks[0].role).toBe("intertitre");
    expect(blocks[1].kind).toBe("line");
  });

  it("a section (structure unit) does not absorb its body lines", () => {
    const struct = line(1, { unit_type: "structure", unit_role: "section", text_raw: "H" });
    const blocks = deriveCoarseBlocks([struct, line(2), line(3), line(4)]);
    expect(blocks[0].kind).toBe("heading");
    expect(blocks[0].memberNs).toEqual([]);
    expect(blocks.filter((b) => b.kind === "line")).toHaveLength(3);
  });
});

// ─── anchored regime (parent_n present) ───────────────────────────────────────

describe("deriveCoarseBlocks — anchored regime", () => {
  it("groups sentences under their paragraph anchor", () => {
    const blocks = deriveCoarseBlocks([
      line(1, { parent_n: 1 }),
      line(2, { parent_n: 1 }),
      line(3, { parent_n: 2 }),
    ]);
    expect(blocks.map((b) => b.anchorN)).toEqual([1, 2]);
    expect(blocks[0].kind).toBe("sentence-grouped");
    expect(blocks[0].memberNs).toEqual([1, 2]);
    expect(blocks[0].fineCount).toBe(2);
    // a paragraph that produced a single sentence reads as a plain line
    expect(blocks[1].kind).toBe("line");
  });

  it("normalises unsorted input", () => {
    const blocks = deriveCoarseBlocks([line(3), line(1), line(2)]);
    expect(blocks.map((b) => b.anchorN)).toEqual([1, 2, 3]);
  });
});

// ─── blockIndexByUnitId ───────────────────────────────────────────────────────

describe("blockIndexByUnitId", () => {
  it("maps every member unit_id to its block index", () => {
    const blocks = deriveCoarseBlocks([
      line(1, { parent_n: 1 }),
      line(2, { parent_n: 1 }),
      line(3, { parent_n: 2 }),
    ]);
    const idx = blockIndexByUnitId(blocks);
    expect(idx.get(10)).toBe(0); // uid = n*10
    expect(idx.get(20)).toBe(0);
    expect(idx.get(30)).toBe(1);
  });
});
