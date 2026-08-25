import { describe, it, expect } from "vitest";
import { buildMatrixGridHtml } from "../alignMatrixGrid.ts";
import { buildMatrixView } from "../alignMatrix.ts";
import type { AlignMatrix } from "../sidecarClient.ts";

const SAMPLE: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  language_doc_ids: [2, 3],
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
    expect(html).toMatch(/<th[^>]*>fr\b/); // may carry the « ↗ Segmenter » shortcut after the label
    expect(html).toMatch(/<th[^>]*>en\b/);
  });

  it("puts a « ↗ Segmenter » header shortcut on the hub and each translation, with its doc id", () => {
    const html = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html).toContain('class="prep-matrix-seg-btn" data-seg-doc="2"'); // hub (fr) doc
    expect(html).toContain('class="prep-matrix-seg-btn" data-seg-doc="3"'); // en translation doc
  });

  it("omits the header shortcut when a doc id is missing (older sidecar)", () => {
    // A payload predating hub_doc_id / language_doc_ids → no shortcut to a doc it can't name.
    const noDocIds = { headers: SAMPLE.headers, languages: SAMPLE.languages, rows: SAMPLE.rows } as AlignMatrix;
    const html = buildMatrixGridHtml(buildMatrixView(noDocIds));
    expect(html).not.toContain("prep-matrix-seg-btn");
  });

  it("tags cells by status (ok / empty / grouped)", () => {
    const html = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html).toContain("prep-matrix-cell--ok");
    expect(html).toContain("prep-matrix-cell--empty");
    expect(html).toContain("prep-matrix-cell--grouped");
  });

  it("le 2-1 est peint une seule fois, à cheval sur ses lignes", () => {
    const html = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    // Une cellule à cheval, et le texte partagé n'apparaît qu'UNE fois : c'est le doublon
    // qui déroutait les utilisateurs qui disparaît.
    expect(html).toContain('rowspan="2"');
    expect(html.split("SHARED").length - 1).toBe(1);
    expect(html).toContain("1 trad &#8596; 2 segments");
    // Le geste reste offert, sur la frontière basse du groupe (ligne 3, index 3).
    expect(html).toContain('class="prep-matrix-cut-btn" data-cut-row="3"');
  });

  it("marks rows with warnings and paragraph starts", () => {
    const html = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html).toContain("prep-matrix-row--warn");
    expect(html).toContain("prep-matrix-row--para-start");
  });

  it("R6: renders a clickable ¶ toggle per hub row, highlighting paragraph starts", () => {
    const withUnits: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en"],
      languages: ["fr", "en"],
      hub_doc_id: 2,
      language_doc_ids: [2, 3],
      hub_unit_ids: [10, 11, 12],
      rows: [
        ["1", 1, "FR1", "EN1"],
        ["1", 2, "FR2", "EN2"],
        ["2", 3, "FR3", "EN3"],
      ],
    };
    const html = buildMatrixGridHtml(buildMatrixView(withUnits));
    // A ¶ toggle per hub row, addressed by row index (resolved through the view).
    expect(html).toContain('class="prep-matrix-para-btn prep-matrix-para-btn--start" data-para-row="0"');
    expect(html).toContain('class="prep-matrix-para-btn" data-para-row="1"'); // mid-paragraph: plain
    expect(html).toContain('prep-matrix-para-btn--start" data-para-row="2"'); // ¶2 start
    // The mid-paragraph row is NOT a boundary.
    expect(html).not.toMatch(/prep-matrix-para-btn--start" data-para-row="1"/);
  });

  it("R6: no ¶ toggle when hub_unit_ids are absent (older sidecar)", () => {
    const html = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html).not.toContain("prep-matrix-para-btn");
  });

  it("R6: no ¶ toggle on a paratext hub row (blank ¶ — out of text scope, engine would 400)", () => {
    // hub_units is not filtered by text_start_n, so a paratext segment reaches the grid with a
    // real hub_unit_id but a BLANK paragraph. It must not carry a clickable ¶ (would always error).
    const withParatext: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en"],
      languages: ["fr", "en"],
      hub_doc_id: 2,
      language_doc_ids: [2, 3],
      hub_unit_ids: [99, 101],
      rows: [
        ["", 1, "TITRE (paratexte)", ""], // paratext: blank ¶
        ["1", 2, "FR1", "EN1"],           // first real text segment
      ],
    };
    const html = buildMatrixGridHtml(buildMatrixView(withParatext));
    // Exactly one ¶ toggle — on the text row (index 1), never the paratext row (index 0).
    // Count data-para-row (unique per button); the class alone double-matches on a --start button.
    expect(html.match(/data-para-row=/g) ?? []).toHaveLength(1);
    expect(html).toContain('data-para-row="1"');
    expect(html).not.toContain('data-para-row="0"');
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

  it("T6.2: 🔎 « Révision fine » on linked cells only, with their cell coordinates", () => {
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
    // Only the linked (ok) cell offers the handoff — not the empty one.
    expect(html.match(/prep-matrix-review-btn/g) ?? []).toHaveLength(1);
    expect(html).toContain('class="prep-matrix-review-btn" data-cut-row="0" data-cut-col="0"');
    // Old sidecar (no cell_links): no link to review → no button.
    const html2 = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html2).not.toContain("prep-matrix-review-btn");
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

  it("D-W8: [non traduit] cell — token, ∅ set button on empty cells, clear on per-cell marks", () => {
    const withStatuses: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en"],
      languages: ["fr", "en"],
      hub_doc_id: 2,
      hub_unit_ids: [11, 12, 13],
      language_doc_ids: [2, 3],
      rows: [
        ["1", 1, "FR1", ""],
        ["1", 2, "FR2", "[non traduit]"],
        ["1", 3, "FR3", "[non traduit]"],
      ],
      cell_links: [[[]], [[]], [[]]],
      hub_unit_statuses: [null, null, "non_traduit"],
      cell_statuses: [[null], ["non_traduit"], [null]],
      addition_rows: [],
      uncovered: [[]],
    };
    const html = buildMatrixGridHtml(buildMatrixView(withStatuses));
    expect(html).toContain("prep-matrix-cell--non-traduit");
    // Empty cell (row 0) offers the SET gesture; the per-cell mark (row 1) its CLEAR;
    // the hub-global mark (row 2) is managed source-side → no button.
    expect(html).toContain('data-nt-action="set" data-cut-row="0"');
    expect(html).toContain('data-nt-action="clear" data-cut-row="1"');
    expect(html).not.toContain('data-nt-action="clear" data-cut-row="2"');
    expect((html.match(/prep-matrix-nt-btn/g) ?? [])).toHaveLength(2);
    // Old sidecar (no status axes): no ∅ affordance on empty cells.
    const html2 = buildMatrixGridHtml(buildMatrixView(SAMPLE));
    expect(html2).not.toContain("prep-matrix-nt-btn");
  });

  it("D8: a flux addition row renders [ajout] with its ↺ and blank sibling cells", () => {
    const withAddition: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en", "ro"],
      languages: ["fr", "en", "ro"],
      hub_doc_id: 2,
      hub_unit_ids: [11, null],
      language_doc_ids: [2, 3, 4],
      rows: [
        ["1", 1, "FR1", "EN1", "RO1"],
        ["", "", "[ajout]", "added text", ""],
      ],
      cell_links: [[[{ link_id: 1, target_unit_id: 91, char_start: null, char_end: null, target_text_raw: "EN1" }], []], [[], []]],
      hub_unit_statuses: [null, null],
      cell_statuses: [[null, null], [null, null]],
      addition_rows: [{ row: 1, doc_id: 3, unit_id: 95, n: 5 }],
      uncovered: [[], []],
    };
    const html = buildMatrixGridHtml(buildMatrixView(withAddition));
    expect(html).toContain("prep-matrix-row--addition");
    expect(html).toContain("[ajout]");
    expect(html).toContain("added text");
    expect(html).toContain('data-add-row="1"');
    expect((html.match(/prep-matrix-unadd-btn/g) ?? [])).toHaveLength(1);
    // The RO cell of the addition row is a blank, not an ∅ hole.
    expect(html).toContain("prep-matrix-cell--blank");
  });

  it("D-W14: column header carries the « N hors matrice » badge when units are uncovered", () => {
    const withOrphans: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en"],
      languages: ["fr", "en"],
      hub_doc_id: 2,
      hub_unit_ids: [11],
      language_doc_ids: [2, 3],
      rows: [["1", 1, "FR1", "EN1"]],
      cell_links: [[[{ link_id: 1, target_unit_id: 91, char_start: null, char_end: null, target_text_raw: "EN1" }]]],
      hub_unit_statuses: [null],
      cell_statuses: [[null]],
      addition_rows: [],
      uncovered: [[{ unit_id: 97, n: 7, text_raw: "orphan" }]],
    };
    const html = buildMatrixGridHtml(buildMatrixView(withOrphans));
    expect(html).toContain("prep-matrix-uncovered-btn");
    expect(html).toContain('data-uncovered-col="0"');
    expect(html).toContain("1 hors matrice");
    // No badge when everything is covered.
    const covered = { ...withOrphans, uncovered: [[]] };
    expect(buildMatrixGridHtml(buildMatrixView(covered))).not.toContain("prep-matrix-uncovered-btn");
  });

  it("R6a: no ∅ button on an « empty » cell that still HOLDS links (the server would 409)", () => {
    const linkedButEmpty: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en"],
      languages: ["fr", "en"],
      hub_doc_id: 2,
      hub_unit_ids: [11, 12],
      language_doc_ids: [2, 3],
      // Row 1's cell has a link whose cut window slices to nothing → projected text "".
      rows: [["1", 1, "FR1", "EN1"], ["1", 2, "FR2", ""]],
      cell_links: [
        [[{ link_id: 1, target_unit_id: 91, char_start: null, char_end: null, target_text_raw: "EN1" }]],
        [[{ link_id: 2, target_unit_id: 92, char_start: 3, char_end: 3, target_text_raw: "EN2" }]],
      ],
      hub_unit_statuses: [null, null],
      cell_statuses: [[null], [null]],
      addition_rows: [],
      uncovered: [[]],
    };
    const html = buildMatrixGridHtml(buildMatrixView(linkedButEmpty));
    expect(html).toContain("prep-matrix-cell--empty");
    expect(html).not.toContain("prep-matrix-nt-btn");
  });

  it("G5: an « empty » cell that HOLDS a link keeps ↺ and ✕ (else the link is a dead-end)", () => {
    const linkedButEmpty: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en"], languages: ["fr", "en"],
      hub_doc_id: 2, hub_unit_ids: [11, 12], language_doc_ids: [2, 3],
      rows: [["1", 1, "FR1", "EN1"], ["1", 2, "FR2", ""]],
      cell_links: [
        [[{ link_id: 1, target_unit_id: 91, char_start: null, char_end: null, target_text_raw: "EN1" }]],
        [[{ link_id: 2, target_unit_id: 92, char_start: 3, char_end: 3, target_text_raw: "EN2" }]],
      ],
      hub_unit_statuses: [null, null], cell_statuses: [[null], [null]], addition_rows: [], uncovered: [[]],
    };
    const html = buildMatrixGridHtml(buildMatrixView(linkedButEmpty));
    // The cut-to-nothing link on row 1 must be undoable (↺) and removable (✕) from the grid.
    expect(html).toContain('prep-matrix-uncut-btn" data-cut-row="1"');
    expect(html).toContain('prep-matrix-remove-btn" data-cut-row="1"');
  });

  it("G4: ＝ Rattacher is offered on a whole-link cell but NOT on a cut-link cell", () => {
    const m: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en"], languages: ["fr", "en"],
      hub_doc_id: 2, hub_unit_ids: [11, 12], language_doc_ids: [2, 3],
      rows: [["1", 1, "FR1", "As far"], ["1", 2, "FR2", "back"]],
      cell_links: [
        [[{ link_id: 1, target_unit_id: 90, char_start: 0, char_end: 6, target_text_raw: "As far back" }]], // CUT
        [[{ link_id: 2, target_unit_id: 91, char_start: null, char_end: null, target_text_raw: "back" }]],   // whole
      ],
      hub_unit_statuses: [null, null], cell_statuses: [[null], [null]], addition_rows: [], uncovered: [[]],
    };
    const html = buildMatrixGridHtml(buildMatrixView(m));
    expect(html).toContain('prep-matrix-attach-btn" data-cut-row="1"');       // whole link → ＝
    expect(html).not.toContain('prep-matrix-attach-btn" data-cut-row="0"');   // cut link → no ＝ (↺ first)
  });

  it("R6b: the [ajout] row's ↺ sits in the addition's OWN column, even when its text is empty", () => {
    const emptyAddition: AlignMatrix = {
      headers: ["paragraphe", "segment", "fr", "en", "ro"],
      languages: ["fr", "en", "ro"],
      hub_doc_id: 2,
      hub_unit_ids: [11, null],
      language_doc_ids: [2, 3, 4],
      rows: [
        ["1", 1, "FR1", "EN1", "RO1"],
        ["", "", "[ajout]", "", ""],   // ajout unit whose text_raw is empty
      ],
      cell_links: [[[], []], [[], []]],
      hub_unit_statuses: [null, null],
      cell_statuses: [[null, null], [null, null]],
      addition_rows: [{ row: 1, doc_id: 4, unit_id: 95, n: 5 }],  // RO column
      uncovered: [[], []],
    };
    const html = buildMatrixGridHtml(buildMatrixView(emptyAddition));
    // Exactly one ↺, and it must exist even though every cell of the row is textless —
    // otherwise the gesture would be irreversible from the grid.
    expect((html.match(/prep-matrix-unadd-btn/g) ?? [])).toHaveLength(1);
    expect(html).toContain('data-add-row="1"');
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
