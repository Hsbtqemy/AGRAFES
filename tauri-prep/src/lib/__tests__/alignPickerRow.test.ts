import { describe, it, expect } from "vitest";
import { buildPickerRowHtml } from "../alignPickerRow.ts";
import type { RetargetCandidate } from "../sidecarClient.ts";

const cand = (target_unit_id: number, over: Partial<RetargetCandidate> = {}): RetargetCandidate =>
  ({ target_unit_id, target_text: `t${target_unit_id}`, score: 0.5, reason: "r", external_id: `e${target_unit_id}`, ...over } as RetargetCandidate);

describe("buildPickerRowHtml", () => {
  it("shows the loading state when candidates is null", () => {
    const html = buildPickerRowHtml({ pivotUnitId: 1, pivotText: "p", asTableRow: false, candidates: null, alreadyLinked: new Set() });
    expect(html).toContain("prep-align-picker-loading");
    expect(html).toContain('id="picker-cands-1"');
    expect(html).toContain('data-picker-for="1"');
  });

  it("shows the empty state when there are no candidates", () => {
    const html = buildPickerRowHtml({ pivotUnitId: 1, pivotText: "p", asTableRow: false, candidates: [], alreadyLinked: new Set() });
    expect(html).toContain("prep-align-picker-empty");
  });

  it("renders a candidate button (no conflict) with its uid and score", () => {
    const html = buildPickerRowHtml({ pivotUnitId: 1, pivotText: "p", asTableRow: false, candidates: [cand(7, { score: 0.42 })], alreadyLinked: new Set() });
    expect(html).toContain('data-uid="7"');
    expect(html).toContain("42%");
    expect(html).not.toContain('data-conflict="1"');
    expect(html).not.toContain("prep-align-picker-cand--conflict");
  });

  it("marks a candidate already linked to the pivot as a conflict", () => {
    const html = buildPickerRowHtml({ pivotUnitId: 1, pivotText: "p", asTableRow: false, candidates: [cand(7)], alreadyLinked: new Set([7]) });
    expect(html).toContain("prep-align-picker-cand--conflict");
    expect(html).toContain('data-conflict="1"');
    // Pin the LONG conflict tooltip (its distinctive ASCII tail). This is the
    // documented drift vs _activateRetarget's shorter inline variant — a future
    // "fix" that shortens it must update this test deliberately, not silently.
    expect(html).toContain("supprimera le lien existant");
    // A conflicting candidate shows no percentage score (replaced by the warning).
    expect(html).not.toContain("%");
  });

  it("adds ARIA row/cell roles only when asTableRow is true", () => {
    const asRow = buildPickerRowHtml({ pivotUnitId: 1, pivotText: "p", asTableRow: true, candidates: [], alreadyLinked: new Set() });
    const asDiv = buildPickerRowHtml({ pivotUnitId: 1, pivotText: "p", asTableRow: false, candidates: [], alreadyLinked: new Set() });
    expect(asRow).toContain('role="row"');
    expect(asRow).toContain('role="cell"');
    expect(asDiv).not.toContain('role="row"');
    expect(asDiv).not.toContain('role="cell"');
  });

  it("escapes HTML in pivot text and candidate fields", () => {
    const html = buildPickerRowHtml({ pivotUnitId: 1, pivotText: "<b>p</b>", asTableRow: false, candidates: [cand(7, { target_text: "<x>" })], alreadyLinked: new Set() });
    expect(html).toContain("&lt;b&gt;p&lt;/b&gt;");
    expect(html).toContain("&lt;x&gt;");
    expect(html).not.toContain("<b>p</b>");
  });
});
