import { describe, it, expect } from "vitest";
import {
  buildVerdictHtml,
  buildQueueWarningHtml,
  verdictNeedsAttention,
  verdictForChoice,
  type FileVerdict,
} from "../importVerdictTemplate.ts";
import type { ImportPlan } from "../importDetect.ts";

const plan = (p: Partial<ImportPlan>): ImportPlan => ({
  mode: "docx_paragraphs", verdict: "ok", reason: "aucun marqueur", ...p,
});

const OK: FileVerdict = {
  plan: plan({}), modeLabel: "Paragraphes", searchable: 17,
};

describe("buildVerdictHtml", () => {
  it("dit le mode, le compte et le motif", () => {
    const html = buildVerdictHtml(OK);
    expect(html).toContain("Paragraphes");
    expect(html).toContain("17 trouvables");
    expect(html).toContain("aucun marqueur");
  });

  it("dit « rien de trouvable » plutôt que « 0 »", () => {
    // C'est le cas mesuré de bout en bout : l'import annonce `ok`, écrit 17 unités,
    // et rien n'est jamais trouvable. Un zéro dans une colonne se lit de travers ;
    // une phrase, non.
    const html = buildVerdictHtml({
      ...OK, searchable: 0, plan: plan({ verdict: "no_mode", reason: "aucun mode" }),
    });
    expect(html).toContain("rien de trouvable");
    expect(html).toContain("imp-verdict-bad");
  });

  it("n'affiche AUCUN compte quand il n'est pas exact", () => {
    // L'analyse ne lit le fichier qu'une fois, en paragraphes. Sur un document
    // numéroté elle sait qu'il sera trouvable, pas combien : un chiffre pris à
    // l'autre mode serait faux.
    const html = buildVerdictHtml({
      plan: plan({ mode: "docx_numbered_lines", reason: "marqueurs [n] détectés" }),
      modeLabel: "Lignes numérotées [n]", searchable: null,
    });
    expect(html).toContain("marqueurs [n]");
    expect(html).not.toContain("trouvable");
  });

  it("distingue l'attente de l'absence de verdict", () => {
    expect(buildVerdictHtml(null)).toContain("analyse…");
  });

  it("marque d'un avertissement l'ancre perdue et la colonne manquante", () => {
    for (const v of ["numbering_lost", "column_needed"] as const) {
      expect(buildVerdictHtml({ ...OK, plan: plan({ verdict: v }) })).toContain("imp-verdict-warn");
    }
  });

  it("échappe le motif et le libellé", () => {
    const html = buildVerdictHtml({
      plan: plan({ reason: '<img src=x onerror="alert(1)">' }),
      modeLabel: "<b>x</b>", searchable: 1,
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="');
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;img");
  });
});

describe("verdictNeedsAttention", () => {
  it("seul « ok » n'en demande pas", () => {
    expect(verdictNeedsAttention("ok")).toBe(false);
    for (const v of ["no_mode", "column_needed", "numbering_lost"] as const) {
      expect(verdictNeedsAttention(v)).toBe(true);
    }
  });
});

describe("buildQueueWarningHtml", () => {
  it("se tait quand tout va bien", () => {
    expect(buildQueueWarningHtml([OK, OK])).toBeNull();
    expect(buildQueueWarningHtml([])).toBeNull();
  });

  it("compte les fichiers qui n'auraient rien de trouvable", () => {
    const bad = { ...OK, plan: plan({ verdict: "no_mode" }) };
    const html = buildQueueWarningHtml([OK, bad, bad])!;
    expect(html).toContain("2 fichiers");
    expect(html).toContain("imp-queue-warn-bad");
  });

  it("nomme séparément la colonne manquante — ce n'est pas une perte", () => {
    const html = buildQueueWarningHtml([{ ...OK, plan: plan({ verdict: "column_needed" }) }])!;
    expect(html).toContain("colonne");
    expect(html).not.toContain("imp-queue-warn-bad");
  });

  it("accorde le singulier", () => {
    const html = buildQueueWarningHtml([{ ...OK, plan: plan({ verdict: "no_mode" }) }])!;
    expect(html).toContain("1 fichier</strong> n'aurait");
  });

  it("ignore les fichiers pas encore analysés", () => {
    expect(buildQueueWarningHtml([null, null])).toBeNull();
  });

  it("cumule les trois natures de problème en une phrase", () => {
    const html = buildQueueWarningHtml([
      { ...OK, plan: plan({ verdict: "no_mode" }) },
      { ...OK, plan: plan({ verdict: "column_needed" }) },
      { ...OK, plan: plan({ verdict: "numbering_lost" }) },
    ])!;
    expect(html).toContain("trouvable");
    expect(html).toContain("colonne");
    expect(html).toContain("ancre");
    expect(html.split(" ; ")).toHaveLength(3);
  });
});

describe("verdictForChoice", () => {
  const deduced = plan({ mode: "docx_numbered_lines", reason: "marqueurs [n] détectés" });

  it("laisse le verdict intact quand le choix suit la déduction", () => {
    const v = verdictForChoice(deduced, "docx_numbered_lines", "Lignes numérotées [n]", "Lignes numérotées [n]", 48);
    expect(v.plan.reason).toBe("marqueurs [n] détectés");
    expect(v.searchable).toBe(48);
  });

  it("ne justifie JAMAIS un mode par le motif de l'autre", () => {
    // Sans ça, la ligne afficherait « Paragraphes · marqueurs [n] détectés » —
    // un motif qui justifie exactement le choix contraire.
    const v = verdictForChoice(deduced, "docx_paragraphs", "Paragraphes", "Lignes numérotées [n]", 48);
    expect(v.modeLabel).toBe("Paragraphes");
    expect(v.plan.reason).not.toContain("marqueurs [n] détectés");
    expect(v.plan.reason).toContain("choisi à la main");
    expect(v.plan.reason).toContain("Lignes numérotées [n]");
  });

  it("retire le compte, mesuré sur l'autre mode", () => {
    expect(verdictForChoice(deduced, "docx_paragraphs", "Paragraphes", "Lignes numérotées [n]", 48).searchable)
      .toBeNull();
  });

  it("garde un verdict plus grave que « ok » quand il y en avait un", () => {
    const bloque = plan({ mode: "docx_paragraphs", verdict: "no_mode", reason: "rien" });
    expect(verdictForChoice(bloque, "docx_numbered_lines", "N", "P", null).plan.verdict).toBe("no_mode");
  });
});
