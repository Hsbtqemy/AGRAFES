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
    // and used to be reported as a plain « ✓ aligné ». The caller passes the pre-run link
    // count — the engine cannot tell « already linked » from « matched nothing ».
    const line = alignRunSummary(res({ total_links_created: 0 }), { replace_existing: false }, 12);
    expect(line).toContain("Aucun lien ajouté");
    expect(line).toContain("Recalcul global");
    expect(line.startsWith("✓")).toBe(false);
  });

  it("on a family with NO link, a fruitless run blames the MODE, not « déjà liés »", () => {
    // The engine marks a pair « aligned » as soon as it ran without raising, so a strategy
    // that matched nothing (external_id on a corpus without [N]) looks identical to an
    // already-aligned family — except for the pre-run count (revue tranche 5).
    const line = alignRunSummary(
      res({ total_links_created: 0, aligned: 1, total_pairs: 1 }),
      { replace_existing: false, strategy: "external_id" },
      0,
    );
    expect(line).not.toContain("déjà");
    expect(line).not.toContain("Recalcul global");
    expect(line).toContain("external_id");
    expect(line).toContain("n'a apparié aucun segment");
  });

  it("a run where NO pair could align is not the footgun — and is not a success either", () => {
    const line = alignRunSummary(res({ total_links_created: 0, aligned: 0 }), { replace_existing: true });
    expect(line).not.toContain("Aucun lien ajouté");
    expect(line).toContain("Aucune paire alignée");
    expect(line.startsWith("✓")).toBe(false);
  });

  it("never blames « segments déjà liés » when the real cause is unsegmented pairs", () => {
    // 0 links created because the children are NOT SEGMENTED (skipped), not because they
    // were already aligned — the footgun message would hide the actual reason.
    const line = alignRunSummary(
      res({ total_links_created: 0, aligned: 0, skipped: 2 }), { replace_existing: false });
    expect(line).not.toContain("déjà liés");
    expect(line).toContain("2 paires ignorées (non segmentée");
  });

  it("surfaces skipped (unsegmented) pairs and errors alongside a real result", () => {
    const line = alignRunSummary(res({ skipped: 1, errors: 1 }), {});
    expect(line).toContain("1 paire ignorée");
    expect(line).toContain("1 en erreur");
    expect(line).toContain("12 liens créés");
  });

  it("the footgun message still fires when pairs DID align but nothing was added", () => {
    const line = alignRunSummary(res({ total_links_created: 0, aligned: 2 }), { replace_existing: false }, 5);
    expect(line).toContain("Aucun lien ajouté");
    expect(line).toContain("Recalcul global");
  });
});

describe("buildAlignRerunConfirmHtml — le choix qui était silencieux", () => {
  it("offers « compléter » and « recalcul global », and names the existing link count", () => {
    const html = buildAlignRerunConfirmHtml(42);
    expect(html).toContain("42");
    expect(html).toContain("matrix-align-complete");
    expect(html).toContain("matrix-align-recalc");
    expect(html).toContain("matrix-align-cancel");
    expect(html).toContain("supprime les liens puis réaligne");
  });

  it("does not promise « n'ajoute que les liens manquants » — the engine does no such thing", () => {
    // With replace_existing:false the aligner RE-RUNS the whole strategy and only dedupes
    // on the exact (pivot, target) unique index: another strategy piles new links on top.
    // The old wording was simply false (revue tranche 5).
    const html = buildAlignRerunConfirmHtml(3);
    expect(html).not.toContain("liens manquants");
    expect(html).toContain("garde les liens existants");
    // The count includes rejected links — they still hold their row in the unique index.
    expect(html).toContain("rejetés compris");
  });
});
