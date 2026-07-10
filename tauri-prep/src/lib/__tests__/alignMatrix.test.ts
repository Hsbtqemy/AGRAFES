import { describe, it, expect } from "vitest";
import { buildMatrixView, matrixSummaryLine } from "../alignMatrix.ts";
import type { AlignMatrix, MatrixCellLink } from "../sidecarClient.ts";

function lk(link_id: number, target: number, over: Partial<MatrixCellLink> = {}): MatrixCellLink {
  return { link_id, target_unit_id: target, char_start: null, char_end: null, target_text_raw: "t", ...over };
}

// Mirror of the Le Clézio shape: FR hub + EN + RO, with an empty EN cell and an uncut
// 2-1 fusion (EN_shared repeated on seg 3 & 4).
const SAMPLE: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en", "ro"],
  languages: ["fr", "en", "ro"],
  hub_doc_id: 2,
  rows: [
    ["1", 1, "FR1", "EN1", "RO1"],
    ["1", 2, "FR2", "", "RO2"],
    ["1", 3, "FR3", "EN_shared", "RO3"],
    ["1", 4, "FR4", "EN_shared", "RO4"],
    ["2", 5, "FR5", "EN5", "RO5"],
  ],
};

describe("buildMatrixView", () => {
  it("splits hub language from translation columns", () => {
    const v = buildMatrixView(SAMPLE);
    expect(v.hubLang).toBe("fr");
    expect(v.translationLangs).toEqual(["en", "ro"]);
    expect(v.rows).toHaveLength(5);
  });

  it("marks an empty translation cell as ∅ (empty)", () => {
    const v = buildMatrixView(SAMPLE);
    const enCell = v.rows[1].cells.find((c) => c.lang === "en")!;
    expect(enCell.status).toBe("empty");
    expect(v.rows[1].hasWarning).toBe(true);
  });

  it("marks a repeated non-empty cell as fused (the uncut 2-1)", () => {
    const v = buildMatrixView(SAMPLE);
    // first EN_shared occurrence is ok, the second (row 4) is fused
    expect(v.rows[2].cells.find((c) => c.lang === "en")!.status).toBe("ok");
    expect(v.rows[3].cells.find((c) => c.lang === "en")!.status).toBe("fused");
    // ro on the same rows differs → not fused
    expect(v.rows[3].cells.find((c) => c.lang === "ro")!.status).toBe("ok");
  });

  it("leaves a clean 1-1 row without warnings", () => {
    const v = buildMatrixView(SAMPLE);
    expect(v.rows[0].hasWarning).toBe(false);
    expect(v.rows[0].cells.every((c) => c.status === "ok")).toBe(true);
  });

  it("computes completeness (warnings = empty + fused)", () => {
    const v = buildMatrixView(SAMPLE);
    // 5 rows × 2 langs = 10 cells ; warnings = 1 empty + 1 fused = 2 → 80 %
    expect(v.stats.totalCells).toBe(10);
    expect(v.stats.warningCells).toBe(2);
    expect(v.stats.completionPct).toBe(80);
  });

  it("flags paragraph starts for visual grouping", () => {
    const v = buildMatrixView(SAMPLE);
    expect(v.rows[0].paragraphStart).toBe(true); // first ¶
    expect(v.rows[1].paragraphStart).toBe(false); // still ¶1
    expect(v.rows[4].paragraphStart).toBe(true); // ¶2 opens
  });

  it("does not treat two consecutive empties as fused", () => {
    const v = buildMatrixView({
      headers: ["paragraphe", "segment", "fr", "en"],
      languages: ["fr", "en"],
      hub_doc_id: 1,
      rows: [
        ["1", 1, "FR1", ""],
        ["1", 2, "FR2", ""],
      ],
    });
    expect(v.rows[0].cells[0].status).toBe("empty");
    expect(v.rows[1].cells[0].status).toBe("empty");
    expect(v.stats.warningCells).toBe(2);
  });

  it("handles an empty matrix as 100 % complete", () => {
    const v = buildMatrixView({ headers: ["paragraphe", "segment", "fr"], languages: ["fr"], hub_doc_id: 1, rows: [] });
    expect(v.stats.totalCells).toBe(0);
    expect(v.stats.completionPct).toBe(100);
    expect(v.translationLangs).toEqual([]);
  });
});

describe("buildMatrixView — topological statuses (cell_links, A2)", () => {
  const base = {
    headers: ["paragraphe", "segment", "fr", "en"],
    languages: ["fr", "en"],
    hub_doc_id: 1,
    hub_unit_ids: [11, 12],
    language_doc_ids: [1, 2],
  };

  it("flags a shared UNCUT target as fused even when the projected texts differ", () => {
    // The Le Clézio under-detection (revue 3b A2): row 1 reads "T1 T2", row 2 "T2" —
    // texts differ, but target 92 is shared uncut → fused, invisible to the heuristic.
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "T1 T2"], ["1", 2, "FR2", "T2"]],
      cell_links: [[[lk(1, 91), lk(2, 92)]], [[lk(3, 92)]]],
    } as AlignMatrix);
    expect(v.hasCellLinks).toBe(true);
    expect(v.rows[1].cells[0].status).toBe("fused");
  });

  it("does NOT flag identical texts on distinct target units (refrain false positive)", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "— Oui."], ["1", 2, "FR2", "— Oui."]],
      cell_links: [[[lk(1, 91)]], [[lk(2, 92)]]],
    } as AlignMatrix);
    expect(v.rows[1].cells[0].status).toBe("ok");
    expect(v.stats.warningCells).toBe(0);
  });

  it("a CUT pair reads ok — the fusion is resolved", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "head"], ["1", 2, "FR2", "tail"]],
      cell_links: [
        [[lk(1, 91, { char_start: 0, char_end: 5 })]],
        [[lk(2, 91, { char_start: 5, char_end: 9 })]],
      ],
    } as AlignMatrix);
    expect(v.rows[1].cells[0].status).toBe("ok");
  });

  it("carries the identities: hubUnitId per row, links per cell, translationDocIds", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "EN1"], ["1", 2, "FR2", "EN2"]],
      cell_links: [[[lk(1, 91)]], [[lk(2, 92)]]],
    } as AlignMatrix);
    expect(v.rows.map((r) => r.hubUnitId)).toEqual([11, 12]);
    expect(v.rows[0].cells[0].links.map((l) => l.link_id)).toEqual([1]);
    expect(v.translationDocIds).toEqual([2]);
  });

  it("without cell_links the text heuristic still applies (old sidecar fallback)", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "SAME"], ["1", 2, "FR2", "SAME"]],
    } as AlignMatrix);
    expect(v.hasCellLinks).toBe(false);
    expect(v.rows[1].cells[0].status).toBe("fused");
  });
});

describe("matrixSummaryLine", () => {
  it("renders the completeness strip", () => {
    const line = matrixSummaryLine(buildMatrixView(SAMPLE));
    expect(line).toContain("8/10");
    expect(line).toContain("2 à réparer");
    expect(line).toContain("80%");
  });
});
