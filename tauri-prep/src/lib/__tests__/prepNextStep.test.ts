import { describe, it, expect } from "vitest";
import { computeNextSteps } from "../prepNextStep.ts";

describe("computeNextSteps", () => {
  // Invariant 2 — toujours ≥ 1 suggestion, la première est primary.
  it("garantit au moins une suggestion primary partout", () => {
    const cases = [
      computeNextSteps({ completed: "curation_apply" }),
      computeNextSteps({ completed: "segment_validate" }),
      computeNextSteps({ completed: "align_run" }),
    ];
    for (const r of cases) {
      expect(r.suggestions.length).toBeGreaterThan(0);
      expect(r.suggestions[0].primary).toBe(true);
      expect(r.suggestions.filter(s => s.primary)).toHaveLength(1);
    }
  });

  // curation_apply — index périmé prime sur tout.
  it("curation_apply + ftsStale → réindexer en primary", () => {
    const r = computeNextSteps({ completed: "curation_apply", ftsStale: true });
    expect(r.suggestions[0].target).toBe("reindex");
    expect(r.suggestions[0].primary).toBe(true);
  });

  // curation_apply — index périmé + traductions → reindex puis Alignement (= matrice, T6.1).
  it("curation_apply + ftsStale + hasRelations → [reindex, matrice]", () => {
    const r = computeNextSteps({ completed: "curation_apply", ftsStale: true, hasRelations: true });
    expect(r.suggestions.map(s => s.target)).toEqual(["reindex", "matrice"]);
  });

  // curation_apply — doc avec traductions, index à jour → Alignement (matrice, surface primaire) seul.
  it("curation_apply + hasRelations (index OK) → matrice (Alignement) seul", () => {
    const r = computeNextSteps({ completed: "curation_apply", hasRelations: true });
    // T6.1 — « Aller à l'Alignement » route vers la matrice, pas l'ex-AlignPanel (Révision fine).
    expect(r.suggestions.map(s => s.target)).toEqual(["matrice"]);
    expect(r.suggestions[0].buttonLabel).toContain("Alignement");
  });

  // curation_apply — doc isolé, index à jour → export (chaîne finie).
  it("curation_apply doc isolé index OK → export", () => {
    const r = computeNextSteps({ completed: "curation_apply" });
    expect(r.suggestions.map(s => s.target)).toEqual(["export"]);
  });

  // curation_apply — doc isolé, index périmé → reindex puis export.
  it("curation_apply doc isolé + ftsStale → [reindex, export]", () => {
    const r = computeNextSteps({ completed: "curation_apply", ftsStale: true });
    expect(r.suggestions.map(s => s.target)).toEqual(["reindex", "export"]);
  });

  // segment_validate — workflow segment-first → curation.
  it("segment_validate → curation en primary", () => {
    const r = computeNextSteps({ completed: "segment_validate" });
    expect(r.suggestions[0].target).toBe("curation");
  });

  it("segment_validate + hasRelations → [curation, matrice]", () => {
    const r = computeNextSteps({ completed: "segment_validate", hasRelations: true });
    expect(r.suggestions.map(s => s.target)).toEqual(["curation", "matrice"]);
  });

  // align_run → export.
  it("align_run → export", () => {
    const r = computeNextSteps({ completed: "align_run" });
    expect(r.suggestions.map(s => s.target)).toEqual(["export"]);
  });

  it("expose un headline par action", () => {
    expect(computeNextSteps({ completed: "curation_apply" }).headline).toContain("Curation");
    expect(computeNextSteps({ completed: "segment_validate" }).headline).toContain("Segmentation");
    expect(computeNextSteps({ completed: "align_run" }).headline).toContain("Alignement");
  });
});
