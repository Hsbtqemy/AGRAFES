import { describe, it, expect } from "vitest";
import { familyPanelHtml, hierFamilySignalsHtml } from "../familyView.ts";
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

describe("familyPanelHtml — deep-links D-P9-2b (la conséquence EST la feature)", () => {
  it("« à réviser » et collisions sont des boutons deep-link vers la Révision fine famille", () => {
    const html = familyPanelHtml(DOC, [fam({
      status_counts: { accepted: 1, rejected: 0, unreviewed: 3 }, collision_count: 2,
    })]);
    // Le badge vérification (unreviewed > 0) devient un bouton « review » scopé sur la famille.
    expect(html).toMatch(/<button[^>]*class="prep-fam-deeplink prep-fam-verif"[^>]*data-deeplink="review"[^>]*data-family-id="2"/);
    // Le badge collision aussi.
    expect(html).toMatch(/<button[^>]*class="prep-fam-deeplink prep-fam-collisions"[^>]*data-deeplink="review"[^>]*data-family-id="2"/);
  });

  it("une couverture incomplète est un bouton deep-link vers la matrice", () => {
    const html = familyPanelHtml(DOC, [fam({ aligned_pairs: 1, total_pairs: 3 })]);
    expect(html).toMatch(/<button[^>]*class="prep-fam-deeplink prep-fam-coverage"[^>]*data-deeplink="matrix"[^>]*data-family-id="2"/);
    expect(html).toContain("1/3 paires alignées");
  });

  it("aucun deep-link quand rien n'est actionnable (couvert, tout révisé, sans collision)", () => {
    const html = familyPanelHtml(DOC, [fam({
      aligned_pairs: 2, total_pairs: 2,
      status_counts: { accepted: 5, rejected: 0, unreviewed: 0 }, collision_count: 0,
    })]);
    // Ni bouton (aucun signal actionnable) — que des spans informatifs.
    expect(html).not.toContain("prep-fam-deeplink");
    expect(html).toContain("2/2 paires alignées");
    expect(html).toContain("✓ 5 révisé(s)");
  });
});

function stats(over: Partial<FamilyStats> = {}): FamilyStats {
  return {
    total_docs: 2, segmented_docs: 2, parent_seg_count: 10,
    aligned_pairs: 1, total_pairs: 1, validated_docs: 0, completion_pct: 100,
    ratio_warnings: [], ...over,
  };
}

describe("hierFamilySignalsHtml — résumé compact hiérarchie D-P9-3", () => {
  it("rend les signaux actionnables (⚠ à réviser · ⨯ collisions) avec le détail en infobulle", () => {
    const html = hierFamilySignalsHtml(stats({
      status_counts: { accepted: 5, rejected: 1, unreviewed: 3 }, collision_count: 2,
    }));
    expect(html).toContain('class="prep-hier-toreview">⚠ 3');
    expect(html).toContain('class="prep-hier-collisions">⨯ 2');
    // Détail complet (dont révisés / rejetés) dans le title, pas inline.
    expect(html).toMatch(/title="✓ 5 révisé\(s\) · 3 à réviser · 1 rejeté\(s\) · 2 collision\(s\)"/);
  });

  it("n'affiche que les signaux > 0 (à réviser seul, sans collision)", () => {
    const html = hierFamilySignalsHtml(stats({
      status_counts: { accepted: 2, rejected: 0, unreviewed: 4 }, collision_count: 0,
    }));
    expect(html).toContain("⚠ 4");
    expect(html).not.toContain("prep-hier-collisions");
  });

  it("vide quand rien n'est actionnable (tout révisé, sans collision)", () => {
    expect(hierFamilySignalsHtml(stats({
      status_counts: { accepted: 6, rejected: 0, unreviewed: 0 }, collision_count: 0,
    }))).toBe("");
  });

  it("vide si le sidecar est antérieur à D-P9-1 (status_counts absent)", () => {
    expect(hierFamilySignalsHtml(stats())).toBe("");
  });
});
