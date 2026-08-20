import { describe, it, expect } from "vitest";
import {
  ALIGN_DEFAULTS, STRATEGY_LABELS, buildAlignAdvancedHtml, buildAlignRerunConfirmHtml,
  alignRunSummary, undoableRunIds, formatRunUndoOutcome, buildRunUndoOfferHtml,
  saveRunOffer, loadRunOffer, clearRunOffer, RUN_UNDO_KEY,
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


// ─── ↺ Annuler ce run (ALI-17) ───────────────────────────────────────────────

function pair(over: Partial<FamilyAlignResponse["results"][number]> = {}) {
  return {
    pivot_doc_id: 1, target_doc_id: 2, target_lang: "en", relation_type: "translation",
    run_id: "run-1", status: "aligned" as const, links_created: 5,
    deleted_before: 0, preserved_before: 0, warnings: [],
    ...over,
  };
}

describe("undoableRunIds — un run de famille, c'est un run PAR PAIRE", () => {
  it("rend un id par paire réellement alignée", () => {
    const r = res();
    r.results = [pair({ run_id: "a" }), pair({ run_id: "b" }), pair({ run_id: "c" })];
    expect(undoableRunIds(r)).toEqual(["a", "b", "c"]);
  });

  it("ignore les paires qui n'ont pas tourné — rien à y annuler", () => {
    const r = res();
    r.results = [
      pair({ run_id: "a" }),
      pair({ run_id: null, status: "skipped" }),
      pair({ run_id: "c", status: "error" }),
    ];
    expect(undoableRunIds(r)).toEqual(["a"]);
  });

  it("ne propose rien quand aucune paire n'a tourné", () => {
    expect(undoableRunIds(res())).toEqual([]);
  });
});

describe("formatRunUndoOutcome — les trois quantités ne disent pas la même chose", () => {
  it("résume un run annulé sans réserve", () => {
    const s = formatRunUndoOutcome([
      { ok: true, links_deleted: 12, links_kept: 0, links_restored: 8, links_not_restored: 0 },
    ]);
    expect(s).toBe("↺ Run annulé : 12 liens retirés, 8 rendus");
  });

  it("distingue le lien VALIDÉ conservé de la restitution qui n'a pas eu lieu", () => {
    const s = formatRunUndoOutcome([
      { ok: true, links_deleted: 3, links_kept: 1, links_restored: 2, links_not_restored: 1 },
    ]);
    expect(s).toContain("1 validé conservé");
    expect(s).toContain("1 non rendu");
  });

  it("dit l'échec partiel au lieu de le taire — on ne s'arrête pas à la première paire", () => {
    const s = formatRunUndoOutcome([
      { ok: true, links_deleted: 4, links_restored: 4 },
      { ok: false, error: "A later run (run-b) has already replaced the links" },
      { ok: true, links_deleted: 2, links_restored: 2 },
    ]);
    expect(s).toContain("2 paires annulées, 1 refusée");
    expect(s).toContain("run-b");
  });

  it("un refus total se lit comme un refus, pas comme un succès à zéro", () => {
    const s = formatRunUndoOutcome([{ ok: false, error: "Unknown run" }]);
    expect(s.startsWith("✗")).toBe(true);
    expect(s).toContain("Unknown run");
  });
});

describe("buildRunUndoOfferHtml", () => {
  it("annonce combien de paires le bouton va annuler", () => {
    const h = buildRunUndoOfferHtml("✓ 12 liens créés", 3);
    expect(h).toContain("matrix-run-undo");
    expect(h).toContain("annule les <strong>3</strong> paires");
  });

  it("reste au singulier pour une paire", () => {
    expect(buildRunUndoOfferHtml("✓", 1)).toContain("annule ce run");
  });

  it("échappe le résumé — il vient du moteur, pas de nous", () => {
    const h = buildRunUndoOfferHtml('<img src=x onerror="alert(1)">', 1);
    expect(h).not.toContain("<img");
    expect(h).toContain("&lt;img");
  });
});

describe("survie de l'offre a un rechargement (ALI-17)", () => {
  function store() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  }
  const DB = "C:/Users/x/Documents/corpus.WORKCOPY.db";
  const offer = {
    dbPath: DB, familyId: 373,
    runIds: ["a", "b", "c"], summary: "✓ 5616 liens", at: "2026-08-19T18:00:00Z",
  };

  it("rend l'offre au meme corpus et a la meme famille", () => {
    const s = store();
    saveRunOffer(s, offer);
    expect(loadRunOffer(s, DB, 373)).toEqual(offer);
  });

  it("ne la rend PAS a une autre famille", () => {
    const s = store();
    saveRunOffer(s, offer);
    expect(loadRunOffer(s, DB, 999)).toBeNull();
  });

  it("ne la rend PAS a un autre corpus — un run n'appartient pas a une autre base", () => {
    const s = store();
    saveRunOffer(s, offer);
    expect(loadRunOffer(s, "C:/autre/corpus.db", 373)).toBeNull();
  });

  it("la clé est le CHEMIN de la base, pas l'URL du sidecar — le port change a chaque relance", () => {
    const s = store();
    saveRunOffer(s, offer);
    // Le sidecar a redemarre sur un autre port : l'offre doit survivre, c'est le meme corpus.
    expect(loadRunOffer(s, DB, 373)).not.toBeNull();
    expect(JSON.stringify(offer)).not.toContain("127.0.0.1");
  });

  it("ne propose rien quand la base n'est pas identifiee", () => {
    const s = store();
    saveRunOffer(s, offer);
    expect(loadRunOffer(s, null, 373)).toBeNull();
  });

  it("s'efface quand on la consomme", () => {
    const s = store();
    saveRunOffer(s, offer);
    clearRunOffer(s);
    expect(loadRunOffer(s, DB, 373)).toBeNull();
  });

  it("survit a un contenu illisible sans jeter", () => {
    const s = store();
    s.setItem(RUN_UNDO_KEY, "{pas du json");
    expect(loadRunOffer(s, DB, 373)).toBeNull();
  });
});
