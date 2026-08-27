import { describe, it, expect } from "vitest";
import {
  buildModeComparisonHtml,
  type ModeComparisonRow,
} from "../importModeComparisonTemplate.ts";

const PARA: ModeComparisonRow = {
  mode: "docx_paragraphs", label: "Paragraphes",
  units: 48, searchable: 48, sample: "Texte 1",
};
const NUM: ModeComparisonRow = {
  mode: "docx_numbered_lines", label: "Lignes numérotées [n]",
  units: 48, searchable: 0, sample: "Texte 1",
};

describe("buildModeComparisonHtml", () => {
  it("rend une ligne par mode, avec les trois comptes", () => {
    const html = buildModeComparisonHtml({
      rows: [PARA, NUM], currentMode: "docx_paragraphs", bestMode: "docx_paragraphs",
    });
    expect(html).toContain("Paragraphes");
    expect(html).toContain("Lignes numérotées [n]");
    // Le cas qui justifie l'écran : même total, verdicts opposés.
    expect(html).toContain(">48<");
    expect(html).toContain(">0<");
  });

  it("marque le mode recommandé et le mode courant", () => {
    const html = buildModeComparisonHtml({
      rows: [PARA, NUM], currentMode: "docx_numbered_lines", bestMode: "docx_paragraphs",
    });
    expect(html).toContain("recommandé");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("imp-cmp-row-current");
  });

  it("dit qu'aucun mode ne lit le document plutôt que d'en pré-sélectionner un", () => {
    // Verdict, pas échec : c'est ainsi qu'un défaut de capacité devient visible au
    // lieu de se cacher derrière un mauvais choix.
    const html = buildModeComparisonHtml({
      rows: [{ ...PARA, units: 0, searchable: 0, sample: "" }, NUM],
      currentMode: "docx_paragraphs", bestMode: null,
    });
    expect(html).toContain("Aucun mode ne lit ce document");
    expect(html).not.toContain("recommandé");
  });

  it("signale un mode illisible sans perdre les autres", () => {
    const html = buildModeComparisonHtml({
      rows: [PARA, { ...NUM, failed: true }],
      currentMode: "docx_paragraphs", bestMode: "docx_paragraphs",
    });
    expect(html).toContain("illisible");
    expect(html).toContain("Paragraphes");
  });

  it("dit « rien » quand un mode ne rend aucune unité", () => {
    const html = buildModeComparisonHtml({
      rows: [{ ...PARA, units: 0, searchable: 0, sample: "" }],
      currentMode: "docx_paragraphs", bestMode: null,
    });
    expect(html).toContain("rien");
  });

  it("échappe le texte de l'échantillon et le nom du mode", () => {
    const html = buildModeComparisonHtml({
      rows: [{ ...PARA, sample: '<img src=x onerror="alert(1)">', label: "<b>x</b>" }],
      currentMode: "docx_paragraphs", bestMode: "docx_paragraphs",
    });
    // Ce qui compte n'est pas que la sous-chaîne « onerror= » disparaisse — elle reste,
    // inerte, dans un nœud texte — mais que rien ne puisse OUVRIR une balise ni SORTIR
    // d'un attribut : le chevron et le guillemet sont échappés.
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="');
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&quot;");
  });

  it("tronque un échantillon long sans couper le titre complet", () => {
    const long = "a".repeat(200);
    const html = buildModeComparisonHtml({
      rows: [{ ...PARA, sample: long }], currentMode: "docx_paragraphs", bestMode: "docx_paragraphs",
    });
    expect(html).toContain("…");
    expect(html).toContain(`title="${long}"`);
  });

  it("rend une chaîne vide sans ligne — rien à comparer", () => {
    expect(buildModeComparisonHtml({ rows: [], currentMode: "x", bestMode: null })).toBe("");
  });
});
