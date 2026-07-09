import { describe, it, expect } from "vitest";
import { resolveFusedCellLinks, suggestCutOffset, buildCutPanelsHtml, viableCutOffsets } from "../alignCellCut.ts";
import { codePointSlice, codePointLength, cutOffsets } from "../alignBeads.ts";
import type { AlignLinkRecord } from "../sidecarClient.ts";

function link(over: Partial<AlignLinkRecord> & Pick<AlignLinkRecord, "link_id" | "pivot_unit_id" | "target_unit_id">): AlignLinkRecord {
  return {
    external_id: null,
    pivot_text: "",
    target_text: "shared text",
    target_text_raw: "shared text",
    status: null,
    ...over,
  } as AlignLinkRecord;
}

describe("resolveFusedCellLinks", () => {
  const A = 10, B = 11, T = 90;

  it("resolves a 2-1 bead ordered [above, row]", () => {
    // Audit order deliberately reversed vs hub order — resolution must reorder.
    const links = [
      link({ link_id: 2, pivot_unit_id: B, target_unit_id: T }),
      link({ link_id: 1, pivot_unit_id: A, target_unit_id: T }),
    ];
    const res = resolveFusedCellLinks(links, A, B);
    expect(res.error).toBeUndefined();
    expect(res.links!.map((l) => l.link_id)).toEqual([1, 2]);
  });

  it("rejects when the rows point to distinct target units (identical texts)", () => {
    const links = [
      link({ link_id: 1, pivot_unit_id: A, target_unit_id: 90 }),
      link({ link_id: 2, pivot_unit_id: B, target_unit_id: 91 }),
    ];
    expect(resolveFusedCellLinks(links, A, B).error).toMatch(/distinctes/);
  });

  it("rejects a 3-1 fusion (v1 = 2-1 only)", () => {
    const links = [
      link({ link_id: 1, pivot_unit_id: 9, target_unit_id: T }),
      link({ link_id: 2, pivot_unit_id: A, target_unit_id: T }),
      link({ link_id: 3, pivot_unit_id: B, target_unit_id: T }),
    ];
    expect(resolveFusedCellLinks(links, A, B).error).toMatch(/3 segments/);
  });

  it("rejects an already-cut bead", () => {
    const links = [
      link({ link_id: 1, pivot_unit_id: A, target_unit_id: T, target_char_start: 0, target_char_end: 6 }),
      link({ link_id: 2, pivot_unit_id: B, target_unit_id: T, target_char_start: 6, target_char_end: 11 }),
    ];
    expect(resolveFusedCellLinks(links, A, B).error).toMatch(/déjà coupée/);
  });

  it("rejects a single-word target (no cut point)", () => {
    const links = [
      link({ link_id: 1, pivot_unit_id: A, target_unit_id: T, target_text_raw: "Indivisible" }),
      link({ link_id: 2, pivot_unit_id: B, target_unit_id: T, target_text_raw: "Indivisible" }),
    ];
    expect(resolveFusedCellLinks(links, A, B).error).toMatch(/seul mot/);
  });

  it("rejects a single word behind leading whitespace — cutOffsets alone would let it through (F7)", () => {
    const links = [
      link({ link_id: 1, pivot_unit_id: A, target_unit_id: T, target_text_raw: " Hello" }),
      link({ link_id: 2, pivot_unit_id: B, target_unit_id: T, target_text_raw: " Hello" }),
    ];
    expect(resolveFusedCellLinks(links, A, B).error).toMatch(/seul mot/);
  });

  it("rejects when a row has no link at all", () => {
    const links = [link({ link_id: 1, pivot_unit_id: A, target_unit_id: T })];
    expect(resolveFusedCellLinks(links, A, B).error).toMatch(/introuvables/);
  });
});

describe("viableCutOffsets (F7 — no blank slice)", () => {
  it("drops boundaries that leave a whitespace-only slice", () => {
    // cutOffsets(' Hello world') = [1, 7]; offset 1 would cut a blank head slice.
    expect(cutOffsets(" Hello world")).toEqual([1, 7]);
    expect(viableCutOffsets(" Hello world")).toEqual([7]);
  });

  it("a single word behind leading whitespace has NO viable cut", () => {
    expect(cutOffsets(" Hello")).toEqual([1]);
    expect(viableCutOffsets(" Hello")).toEqual([]);
  });

  it("keeps all boundaries of a clean multi-word text", () => {
    expect(viableCutOffsets("aa bb cc")).toEqual([3, 6]);
  });
});

describe("suggestCutOffset", () => {
  it("splits proportionally to the hub texts, snapped to a word boundary", () => {
    // Hub above ≈ 3× hub row → ideal cut around 3/4 of the target.
    const target = "aa bb cc dd";
    const off = suggestCutOffset(target, "xxxxxxxxx", "xxx");
    expect(off).toBe(9); // boundary before "dd" (offsets are 3, 6, 9)
  });

  it("falls back to the middle when hub lengths are equal", () => {
    expect(suggestCutOffset("aa bb cc dd", "xxx", "xxx")).toBe(6);
  });

  it("returns null for a single word", () => {
    expect(suggestCutOffset("Indivisible", "a", "b")).toBeNull();
  });

  it("never pre-selects a blank-slice offset, even when it is the nearest (F7)", () => {
    // Tiny upper hub → ideal cut near 0 → nearest RAW offset would be 1 (blank head).
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
    // top = "one", bottom = "two three"
    expect(html.indexOf("one")).toBeLessThan(html.indexOf('data-panel="bottom"'));
    expect(html.indexOf("three")).toBeGreaterThan(html.indexOf('data-panel="bottom"'));
  });

  it("carries move offsets: a top word moves the boundary before it, a bottom word after it", () => {
    const html = buildCutPanelsHtml("one two three four", 8, labels); // top = "one two"
    // "two" (top, starts at 4) → data-cut-offset=4 ; "three" (bottom) → after it = 14.
    expect(html).toContain('data-cut-offset="4"');
    expect(html).toContain('data-cut-offset="14"');
  });

  it("keeps the first and last words fixed (an empty slice is not a cut)", () => {
    const html = buildCutPanelsHtml("one two", 4, labels);
    // Both panels hold a single word → neither is clickable.
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
    // ' Hello world' at the only viable offset (7): the raw boundary 1 (before
    // 'Hello', blank head slice) must render as fixed, not as a cut target.
    const html = buildCutPanelsHtml(" Hello world", 7, labels);
    expect(html).not.toContain('data-cut-offset="1"');
    expect(html).toContain("Hello");
    expect(html).toContain("world");
  });
});
