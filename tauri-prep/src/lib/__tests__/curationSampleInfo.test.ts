import { describe, it, expect } from "vitest";
import { buildSampleInfo } from "../curationSampleInfo.ts";

describe("buildSampleInfo", () => {
  it("Invariant 1 — shown=0 → null", () => {
    expect(buildSampleInfo(0, 100, 5000)).toBeNull();
  });

  it("Invariant 2 — changed=0 → null", () => {
    expect(buildSampleInfo(50, 0, 5000)).toBeNull();
  });

  it("Invariant 1+2 — les deux à 0 → null", () => {
    expect(buildSampleInfo(0, 0, 5000)).toBeNull();
  });

  it("Invariant 3 — shown < changed → truncated", () => {
    const r = buildSampleInfo(100, 250, 5000);
    expect(r).not.toBeNull();
    expect(r!.className).toContain("curate-sample-truncated");
    expect(r!.className).not.toContain("curate-sample-full");
    expect(r!.html).toContain("100");
    expect(r!.html).toContain("250");
    expect(r!.html).toContain("5000");
  });

  it("Invariant 3 — previewLimit reflété dans le HTML truncated", () => {
    const r = buildSampleInfo(50, 100, 1234);
    expect(r!.html).toContain("1234");
  });

  it("Invariant 4 — shown === changed → full", () => {
    const r = buildSampleInfo(42, 42, 5000);
    expect(r!.className).toContain("curate-sample-full");
    expect(r!.className).not.toContain("curate-sample-truncated");
    expect(r!.html).toContain("42");
    expect(r!.html).toContain("compl"); // "complète" (entity ou littéral)
  });

  it("Invariant 4 — shown > changed → full (edge case legacy)", () => {
    const r = buildSampleInfo(100, 50, 5000);
    expect(r!.className).toContain("curate-sample-full");
  });

  it("Invariant 4 — HTML full ne mentionne PAS previewLimit", () => {
    const r = buildSampleInfo(42, 42, 5000);
    expect(r!.html).not.toContain("5000");
  });

  it("Invariant 5 — className toujours préfixé prep-curate-sample-info", () => {
    expect(buildSampleInfo(50, 100, 5000)!.className).toMatch(/^prep-curate-sample-info\b/);
    expect(buildSampleInfo(100, 100, 5000)!.className).toMatch(/^prep-curate-sample-info\b/);
  });

  it("HTML truncated contient les balises strong attendues", () => {
    const r = buildSampleInfo(10, 20, 5000);
    expect(r!.html).toContain("<strong>10</strong>");
    expect(r!.html).toContain("<strong>20</strong>");
  });

  it("HTML truncated contient le span scope-note", () => {
    const r = buildSampleInfo(10, 20, 5000);
    expect(r!.html).toContain('class="sample-scope-note"');
  });

  it("HTML full contient le span scope-note", () => {
    const r = buildSampleInfo(20, 20, 5000);
    expect(r!.html).toContain('class="sample-scope-note"');
  });
});
