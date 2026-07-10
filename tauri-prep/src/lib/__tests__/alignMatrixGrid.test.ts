import { describe, it, expect } from "vitest";
import { buildMatrixGridHtml } from "../alignMatrixGrid.ts";
import { buildMatrixView } from "../alignMatrix.ts";
import type { AlignMatrix } from "../sidecarClient.ts";

const SAMPLE: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  rows: [
    ["1", 1, "FR1", "EN1"],
    ["1", 2, "FR2", ""],
    ["1", 3, "FR3", "SHARED"],
    ["1", 4, "FR4", "SHARED"],
  ],
};

describe("buildMatrixGridHtml", () => {
  it("renders a header with hub + translation languages", () => {
    const html = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html).toContain("prep-matrix-th--hub");
    expect(html).toMatch(/<th[^>]*>fr<\/th>/);
    expect(html).toMatch(/<th[^>]*>en<\/th>/);
  });

  it("tags cells by status (ok / empty / fused)", () => {
    const html = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html).toContain("prep-matrix-cell--ok");
    expect(html).toContain("prep-matrix-cell--empty");
    expect(html).toContain("prep-matrix-cell--fused");
  });

  it("marks rows with warnings and paragraph starts", () => {
    const html = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html).toContain("prep-matrix-row--warn");
    expect(html).toContain("prep-matrix-row--para-start");
  });

  it("puts a « ✂ Couper » button on fused cells only, with its cell coordinates (3b)", () => {
    const html = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    // Exactly one fused cell: row index 3 (the repeat of "SHARED"), translation column 0.
    const matches = html.match(/prep-matrix-cut-btn/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(html).toContain('data-cut-row="3"');
    expect(html).toContain('data-cut-col="0"');
  });

  it("D-W12: on-demand ✂ on aligned cells only when cell_links are present", () => {
    const withLinks: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en"],
      languages: ["fr", "en"],
      hub_doc_id: 2,
      hub_unit_ids: [11, 12],
      language_doc_ids: [2, 3],
      rows: [["1", 1, "FR1", "EN1"], ["1", 2, "FR2", ""]],
      cell_links: [
        [[{ link_id: 1, target_unit_id: 91, char_start: null, char_end: null, target_text_raw: "EN1" }]],
        [[]],
      ],
    };
    const html = buildMatrixGridHtml(buildMatrixView(withLinks));
    // Only the aligned (ok) cell gets the straddle affordance — not the empty one.
    expect(html.match(/prep-matrix-cut-any-btn/g) ?? []).toHaveLength(1);
    expect(html).toContain('data-cut-row="0"');
    // Old sidecar (no cell_links): the gesture cannot resolve → no affordance at all.
    const html2 = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html2).not.toContain("prep-matrix-cut-any-btn");
  });

  it("D-W13: ↺ on cells whose links carry a cut", () => {
    const withCut: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en"],
      languages: ["fr", "en"],
      hub_doc_id: 2,
      hub_unit_ids: [11, 12],
      language_doc_ids: [2, 3],
      rows: [["1", 1, "FR1", "head"], ["1", 2, "FR2", "tail"]],
      cell_links: [
        [[{ link_id: 1, target_unit_id: 91, char_start: 0, char_end: 5, target_text_raw: "head tail" }]],
        [[{ link_id: 7, target_unit_id: 91, char_start: 5, char_end: 9, target_text_raw: "head tail", manual: true }]],
      ],
    };
    const html = buildMatrixGridHtml(buildMatrixView(withCut));
    expect(html.match(/prep-matrix-uncut-btn/g) ?? []).toHaveLength(2); // both cut cells
    // No ↺ without a cut.
    const html2 = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html2).not.toContain("prep-matrix-uncut-btn");
  });

  it("escapes corpus text (imported docs are untrusted)", () => {
    const evil: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en"],
      languages: ["fr", "en"],
      hub_doc_id: 2,
      rows: [["1", 1, "<img src=x onerror=alert(1)>", "<script>bad()</script>"]],
    };
    const html = buildMatrixGridHtml(buildMatrixView(evil));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>bad");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
  });
});
