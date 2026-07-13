import { describe, it, expect } from "vitest";
import {
  ALIGN_DEFAULTS, STRATEGY_LABELS, buildAlignAdvancedHtml, buildAlignRerunConfirmHtml,
  alignRunSummary,
} from "../alignRunBar.ts";
import type { FamilyAlignResponse } from "../sidecarClient.ts";

function res(over: Partial<FamilyAlignResponse["summary"]> = {}): FamilyAlignResponse {
  return {
    family_root_id: 1,
    strategy: "length_bounded",
    results: [],
    summary: {
      total_pairs: 2, aligned: 2, skipped: 0, conflicts: 0, errors: 0,
      total_links_created: 12, ...over,
    },
  };
}

describe("le défaut assumé (§4 — le mode n'est plus un prérequis)", () => {
  it("aligns on lengths/DP, keeps validated links, never wipes without being asked", () => {
    expect(ALIGN_DEFAULTS.strategy).toBe("length_bounded");
    expect(ALIGN_DEFAULTS.preserve_accepted).toBe(true);
    expect(ALIGN_DEFAULTS.replace_existing).toBe(false);
  });

  it("the « Avancé » disclosure is folded away and pre-selects the default", () => {
    const html = buildAlignAdvancedHtml();
    expect(html).toContain("hidden");
    expect(html).toContain('value="length_bounded" selected');
    // Every strategy is offered, each with a plain-language hint.
    for (const s of STRATEGY_LABELS) expect(html).toContain(`value="${s.value}"`);
    expect(html).toContain(STRATEGY_LABELS[0].hint);
  });
});

describe("alignRunSummary — dire ce que le run a fait, et ce qu'il n'a PAS fait", () => {
  it("reports the links and pairs of a real run", () => {
    const line = alignRunSummary(res(), { replace_existing: false });
    expect(line).toContain("12 liens créés");
    expect(line).toContain("2/2 paires");
  });

  it("a run that created NOTHING on an aligned family says so (the silent footgun)", () => {
    // Without replace_existing the aligner keeps existing links: 0 created is the NORM,
    // and used to be reported as a plain « ✓ aligné ».
    const line = alignRunSummary(res({ total_links_created: 0 }), { replace_existing: false });
    expect(line).toContain("Aucun lien ajouté");
    expect(line).toContain("Recalcul global");
    expect(line.startsWith("✓")).toBe(false);
  });

  it("0 created WITH a recalc is a genuine (if empty) result, not the footgun message", () => {
    const line = alignRunSummary(res({ total_links_created: 0, aligned: 0 }), { replace_existing: true });
    expect(line).not.toContain("Aucun lien ajouté");
    expect(line.startsWith("✓")).toBe(true);
  });

  it("surfaces skipped (unsegmented) pairs and errors", () => {
    const line = alignRunSummary(res({ skipped: 1, errors: 1 }), {});
    expect(line).toContain("1 ignorée");
    expect(line).toContain("1 en erreur");
  });
});

describe("buildAlignRerunConfirmHtml — le choix qui était silencieux", () => {
  it("offers « compléter » and « recalcul global », and names the existing link count", () => {
    const html = buildAlignRerunConfirmHtml(42);
    expect(html).toContain("42");
    expect(html).toContain("matrix-align-complete");
    expect(html).toContain("matrix-align-recalc");
    expect(html).toContain("matrix-align-cancel");
    expect(html).toContain("remise à plat");
  });
});
