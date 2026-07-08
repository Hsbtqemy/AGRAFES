import { describe, it, expect } from "vitest";
import { buildMatrixView, matrixSummaryLine } from "../alignMatrix.ts";
import type { AlignMatrix } from "../sidecarClient.ts";

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

describe("matrixSummaryLine", () => {
  it("renders the completeness strip", () => {
    const line = matrixSummaryLine(buildMatrixView(SAMPLE));
    expect(line).toContain("8/10");
    expect(line).toContain("2 à réparer");
    expect(line).toContain("80%");
  });
});
