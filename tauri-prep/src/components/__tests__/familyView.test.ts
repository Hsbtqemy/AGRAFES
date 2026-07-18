import { describe, it, expect } from "vitest";
import { familyPanelHtml } from "../familyView.ts";
import type { DocumentRecord, FamilyRecord, FamilyStats } from "../../lib/sidecarClient.ts";

const DOC = { doc_id: 2, title: "Le Livre", language: "fr" } as DocumentRecord;

function fam(over: Partial<FamilyStats> = {}): FamilyRecord {
  const stats: FamilyStats = {
    total_docs: 2, segmented_docs: 2, parent_seg_count: 10,
    aligned_pairs: 1, total_pairs: 1, validated_docs: 0, completion_pct: 100,
    ratio_warnings: [], ...over,
  };
  return {
    family_id: 2,
    parent: { doc_id: 2, title: "Le Livre", language: "fr" } as DocumentRecord,
    children: [],
    stats,
  };
}

describe("familyPanelHtml — signaux D-P9", () => {
  it("affiche la vérification + les collisions (et remplace « validé(s) »)", () => {
    const html = familyPanelHtml(DOC, [fam({
      status_counts: { accepted: 5, rejected: 1, unreviewed: 3 }, collision_count: 2,
    })]);
    expect(html).toContain("✓ 5 révisé(s)");
    expect(html).toContain("3 à réviser");
    expect(html).toContain("1 rejeté(s)");
    expect(html).toContain("⨯ 2 collision(s)");
    // D-P9d — « N validé(s) » (workflow_status) est remplacé par l'axe vérification dérivé.
    expect(html).not.toContain("validé(s)");
  });

  it("masque « à réviser » / « rejeté » / collisions quand ils sont à zéro", () => {
    const html = familyPanelHtml(DOC, [fam({
      status_counts: { accepted: 4, rejected: 0, unreviewed: 0 }, collision_count: 0,
    })]);
    expect(html).toContain("✓ 4 révisé(s)");
    expect(html).not.toContain("prep-fam-toreview");   // pas de « N à réviser » rendu
    expect(html).not.toContain("rejeté(s)");
    expect(html).not.toContain("prep-fam-collisions");  // pas de badge collision
  });

  it("repli sur « N validé(s) » si le sidecar est antérieur à D-P9-1 (status_counts absent)", () => {
    const html = familyPanelHtml(DOC, [fam({ validated_docs: 2 })]);
    expect(html).toContain("2 validé(s)");
    expect(html).not.toContain("révisé(s)");
  });
});
