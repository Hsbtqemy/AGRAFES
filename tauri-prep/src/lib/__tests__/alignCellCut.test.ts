import { describe, it, expect } from "vitest";
import {
  resolveFusedCellLinks, resolveStraddleCut, suggestCutOffset, buildCutPanelsHtml, viableCutOffsets,
} from "../alignCellCut.ts";
import type { CellLinkColumn } from "../alignCellCut.ts";
import { codePointSlice, codePointLength, cutOffsets } from "../alignBeads.ts";
import type { MatrixCellLink } from "../sidecarClient.ts";

function lk(
  link_id: number, target: number,
  over: Partial<MatrixCellLink> = {},
): MatrixCellLink {
  return {
    link_id,
    target_unit_id: target,
    char_start: null,
    char_end: null,
    target_text_raw: "shared text",
    ...over,
  };
}

describe("resolveFusedCellLinks (via cell_links)", () => {
  const T = 90;

  it("resolves a 2-1 pair ordered [above, row]", () => {
    const column: CellLinkColumn = [[lk(1, T)], [lk(2, T)]];
    const res = resolveFusedCellLinks(column, 1);
    expect(res.error).toBeUndefined();
    expect(res.links!.map((l) => l.link_id)).toEqual([1, 2]);
  });

  it("rejects when the rows point to distinct target units", () => {
    const column: CellLinkColumn = [[lk(1, 90)], [lk(2, 91)]];
    expect(resolveFusedCellLinks(column, 1).error).toMatch(/distinctes/);
  });

  it("rejects a 3-1 fusion counted across the whole column (v1 = 2-1 only)", () => {
    const column: CellLinkColumn = [[lk(1, T)], [lk(2, T)], [lk(3, T)]];
    expect(resolveFusedCellLinks(column, 2).error).toMatch(/3 segments/);
  });

  it("rejects an already-cut pair", () => {
    const column: CellLinkColumn = [
      [lk(1, T, { char_start: 0, char_end: 6 })],
      [lk(2, T, { char_start: 6, char_end: 11 })],
    ];
    expect(resolveFusedCellLinks(column, 1).error).toMatch(/déjà coupée/);
  });

  it("rejects a single-word target — including behind leading whitespace (F7)", () => {
    const one: CellLinkColumn = [
      [lk(1, T, { target_text_raw: "Indivisible" })], [lk(2, T, { target_text_raw: "Indivisible" })],
    ];
    expect(resolveFusedCellLinks(one, 1).error).toMatch(/seul mot/);
    const padded: CellLinkColumn = [
      [lk(1, T, { target_text_raw: " Hello" })], [lk(2, T, { target_text_raw: " Hello" })],
    ];
    expect(resolveFusedCellLinks(padded, 1).error).toMatch(/seul mot/);
  });

  it("rejects a cell without links, and row 0", () => {
    expect(resolveFusedCellLinks([[], [lk(1, T)]], 1).error).toMatch(/introuvables/);
    expect(resolveFusedCellLinks([[lk(1, T)], [lk(2, T)]], 0).error).toMatch(/hors/);
  });
});

describe("resolveStraddleCut (D-W12 « couper à cheval »)", () => {
  const RAW = "As far back as I can remember";

  it("resolves down: the tail belongs to the next segment", () => {
    const column: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: RAW })],
      [lk(2, 91, { target_text_raw: "It is the sound" })],
    ];
    const res = resolveStraddleCut(column, 0, "down");
    expect(res.error).toBeUndefined();
    expect(res.link!.link_id).toBe(1);
    expect(res.neighborRow).toBe(1);
  });

  it("resolves up symmetrically", () => {
    const column: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: "It is the sound" })],
      [lk(2, 91, { target_text_raw: RAW })],
    ];
    const res = resolveStraddleCut(column, 1, "up");
    expect(res.error).toBeUndefined();
    expect(res.link!.link_id).toBe(2);
    expect(res.neighborRow).toBe(0);
  });

  it("rejects when there is no neighbour in that direction", () => {
    const column: CellLinkColumn = [[lk(1, 90, { target_text_raw: RAW })]];
    expect(resolveStraddleCut(column, 0, "up").error).toMatch(/au-dessus/);
    expect(resolveStraddleCut(column, 0, "down").error).toMatch(/en dessous/);
  });

  it("redirects to the fused gesture when the neighbour already shares the target", () => {
    const column: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: RAW })],
      [lk(2, 90, { target_text_raw: RAW })],
    ];
    expect(resolveStraddleCut(column, 1, "up").error).toMatch(/partage déjà/);
  });

  it("rejects multi-link cells, cut links, empty cells and single words", () => {
    const two: CellLinkColumn = [[lk(1, 90), lk(2, 91)], [lk(3, 92)]];
    expect(resolveStraddleCut(two, 0, "down").error).toMatch(/plusieurs traductions/);
    const cut: CellLinkColumn = [
      [lk(1, 90, { char_start: 0, char_end: 6 })], [lk(2, 91)],
    ];
    expect(resolveStraddleCut(cut, 0, "down").error).toMatch(/déjà coupée/);
    expect(resolveStraddleCut([[], [lk(1, 90)]], 0, "down").error).toMatch(/sans traduction/);
    const single: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: "Indivisible" })], [lk(2, 91)],
    ];
    expect(resolveStraddleCut(single, 0, "down").error).toMatch(/seul mot/);
  });
});

describe("viableCutOffsets (F7 — no blank slice)", () => {
  it("drops boundaries that leave a whitespace-only slice", () => {
    expect(cutOffsets(" Hello world")).toEqual([1, 7]);
    expect(viableCutOffsets(" Hello world")).toEqual([7]);
  });

  it("a single word behind leading whitespace has NO viable cut", () => {
    expect(viableCutOffsets(" Hello")).toEqual([]);
  });

  it("keeps all boundaries of a clean multi-word text", () => {
    expect(viableCutOffsets("aa bb cc")).toEqual([3, 6]);
  });
});

describe("suggestCutOffset", () => {
  it("splits proportionally to the hub texts, snapped to a word boundary", () => {
    // Hub above ≈ 3× hub row → ideal cut around 3/4 of the target.
    expect(suggestCutOffset("aa bb cc dd", "xxxxxxxxx", "xxx")).toBe(9);
  });

  it("falls back to the middle when hub lengths are equal", () => {
    expect(suggestCutOffset("aa bb cc dd", "xxx", "xxx")).toBe(6);
  });

  it("returns null for a single word", () => {
    expect(suggestCutOffset("Indivisible", "a", "b")).toBeNull();
  });

  it("never pre-selects a blank-slice offset, even when it is the nearest (F7)", () => {
    expect(suggestCutOffset(" Hello world", "x", "xxxxxxxxxxxxxxxxxxxx")).toBe(7);
    expect(suggestCutOffset(" Hello", "x", "xxxxxxxxxx")).toBeNull();
  });

  it("conservation guard — the two slices always rebuild the original (code points)", () => {
    const target = "un 🐈 deux trois";
    for (const off of cutOffsets(target)) {
      const rebuilt = codePointSlice(target, 0, off) + codePointSlice(target, off, codePointLength(target));
      expect(rebuilt).toBe(target);
    }
  });
});

describe("buildCutPanelsHtml", () => {
  const labels = { topSeg: 3, topHub: "Moyeu 3", bottomSeg: 4, bottomHub: "Moyeu 4" };

  it("renders the two panels split at the offset, with the hub labels", () => {
    const html = buildCutPanelsHtml("one two three", 4, labels);
    expect(html).toContain('data-panel="top"');
    expect(html).toContain('data-panel="bottom"');
    expect(html).toContain("seg 3");
    expect(html).toContain("seg 4");
    expect(html.indexOf("one")).toBeLessThan(html.indexOf('data-panel="bottom"'));
    expect(html.indexOf("three")).toBeGreaterThan(html.indexOf('data-panel="bottom"'));
  });

  it("carries move offsets: a top word moves the boundary before it, a bottom word after it", () => {
    const html = buildCutPanelsHtml("one two three four", 8, labels); // top = "one two"
    expect(html).toContain('data-cut-offset="4"');
    expect(html).toContain('data-cut-offset="14"');
  });

  it("keeps the first and last words fixed (an empty slice is not a cut)", () => {
    const html = buildCutPanelsHtml("one two", 4, labels);
    expect(html).not.toContain("data-cut-offset");
    expect(html).toContain("prep-matrix-cut-word--fixed");
  });

  it("escapes corpus text (imported docs are untrusted)", () => {
    const html = buildCutPanelsHtml("<script>bad()</script> ok", 23, {
      ...labels, topHub: "<img src=x onerror=alert(1)>",
    });
    expect(html).not.toContain("<script>bad");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("does not offer a blank-slice boundary as clickable (F7)", () => {
    const html = buildCutPanelsHtml(" Hello world", 7, labels);
    expect(html).not.toContain('data-cut-offset="1"');
    expect(html).toContain("Hello");
    expect(html).toContain("world");
  });
});
