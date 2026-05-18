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

  // curation_apply — index périmé + traductions → reindex puis alignement.
  it("curation_apply + ftsStale + hasRelations → [reindex, alignement]", () => {
    const r = computeNextSteps({ completed: "curation_apply", ftsStale: true, hasRelations: true });
    expect(r.suggestions.map(s => s.target)).toEqual(["reindex", "alignement"]);
  });

  // curation_apply — doc avec traductions, index à jour → alignement seul.
  it("curation_apply + hasRelations (index OK) → alignement seul", () => {
    const r = computeNextSteps({ completed: "curation_apply", hasRelations: true });
    expect(r.suggestions.map(s => s.target)).toEqual(["alignement"]);
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

  it("segment_validate + hasRelations → [curation, alignement]", () => {
    const r = computeNextSteps({ completed: "segment_validate", hasRelations: true });
    expect(r.suggestions.map(s => s.target)).toEqual(["curation", "alignement"]);
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
