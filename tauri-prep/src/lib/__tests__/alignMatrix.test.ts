import { describe, it, expect } from "vitest";
import { buildMatrixView, matrixSummaryLine, resolveStyloTarget } from "../alignMatrix.ts";
import type { AlignMatrix, MatrixCellLink } from "../sidecarClient.ts";

function lk(link_id: number, target: number, over: Partial<MatrixCellLink> = {}): MatrixCellLink {
  return {
    link_id, target_unit_id: target, char_start: null, char_end: null,
    target_text_raw: "t", ...over,
    // ALI-01 tranche 2 : le plan des offsets ET de l'affichage est `text_norm`.
    // Les fixtures le refletent en le calquant sur le raw par defaut ; les tests qui
    // veulent distinguer les deux plans passent explicitement `target_text_norm`.
    target_text_norm: over.target_text_norm ?? over.target_text_raw ?? "t",
  };
}

// Mirror of the Le Clézio shape: FR hub + EN + RO, with an empty EN cell and an uncut
// 2-1 fusion (EN_shared repeated on seg 3 & 4).
const SAMPLE: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en", "ro"],
  languages: ["fr", "en", "ro"],
  hub_doc_id: 2,
  rows: [
    ["1", 1, "FR1", "EN1", "RO1"],
    ["1", 2, "FR2", "", "RO2"],
    ["1", 3, "FR3", "EN_shared", "RO3"],
    ["1", 4, "FR4", "EN_shared", "RO4"],
    ["2", 5, "FR5", "EN5", "RO5"],
  ],
};

describe("buildMatrixView", () => {
  it("splits hub language from translation columns", () => {
    const v = buildMatrixView(SAMPLE);
    expect(v.hubLang).toBe("fr");
    expect(v.translationLangs).toEqual(["en", "ro"]);
    expect(v.rows).toHaveLength(5);
  });

  it("marks an empty translation cell as ∅ (empty)", () => {
    const v = buildMatrixView(SAMPLE);
    const enCell = v.rows[1].cells.find((c) => c.lang === "en")!;
    expect(enCell.status).toBe("empty");
    expect(v.rows[1].hasWarning).toBe(true);
  });

  it("groupe le 2-1 non coupé : la traduction est portée UNE fois, à cheval", () => {
    const v = buildMatrixView(SAMPLE);
    // EN_shared couvre les segments 3 et 4 : la première ligne porte le groupe, la
    // seconde est absorbée. Avant, les deux affichaient le même texte avec un ⚠ —
    // un doublon présenté comme une faute, alors que c'est le cas normal d'une
    // traduction qui n'a pas coupé au même endroit que la source.
    const g = v.rows[2].cells.find((c) => c.lang === "en")!;
    expect(g.status).toBe("grouped");
    expect(g.groupSize).toBe(2);
    expect(v.rows[3].cells.find((c) => c.lang === "en")!.status).toBe("continuation");
    // ro on the same rows differs → not grouped
    expect(v.rows[3].cells.find((c) => c.lang === "ro")!.status).toBe("ok");
  });

  it("un groupe n'est PAS une alerte : la ligne absorbée ne porte pas de ⚠", () => {
    const v = buildMatrixView(SAMPLE);
    expect(v.rows[2].hasWarning).toBe(false);
    expect(v.rows[3].hasWarning).toBe(false);
  });

  it("leaves a clean 1-1 row without warnings", () => {
    const v = buildMatrixView(SAMPLE);
    expect(v.rows[0].hasWarning).toBe(false);
    expect(v.rows[0].cells.every((c) => c.status === "ok")).toBe(true);
  });

  it("compte les groupes à part : « à réparer » ne retient que ce qui l'est vraiment", () => {
    const v = buildMatrixView(SAMPLE);
    // 5 lignes × 2 langues = 10 cellules. Une seule est à réparer (la cellule EN vide) ;
    // le 2-1 est un groupe, pas un trou. Le compteur disait 2 « à réparer » — sur le
    // corpus de référence, il en annonçait 179 dont 176 étaient des groupes.
    expect(v.stats.totalCells).toBe(10);
    expect(v.stats.warningCells).toBe(1);
    expect(v.stats.groupedCells).toBe(1);
    expect(v.stats.completionPct).toBe(90);
  });

  it("flags paragraph starts for visual grouping", () => {
    const v = buildMatrixView(SAMPLE);
    expect(v.rows[0].paragraphStart).toBe(true); // first ¶
    expect(v.rows[1].paragraphStart).toBe(false); // still ¶1
    expect(v.rows[4].paragraphStart).toBe(true); // ¶2 opens
  });

  it("does not treat two consecutive empties as fused", () => {
    const v = buildMatrixView({
      headers: ["paragraphe", "segment", "fr", "en"],
      languages: ["fr", "en"],
      hub_doc_id: 1,
      rows: [
        ["1", 1, "FR1", ""],
        ["1", 2, "FR2", ""],
      ],
    });
    expect(v.rows[0].cells[0].status).toBe("empty");
    expect(v.rows[1].cells[0].status).toBe("empty");
    expect(v.stats.warningCells).toBe(2);
  });

  it("handles an empty matrix as 100 % complete", () => {
    const v = buildMatrixView({ headers: ["paragraphe", "segment", "fr"], languages: ["fr"], hub_doc_id: 1, rows: [] });
    expect(v.stats.totalCells).toBe(0);
    expect(v.stats.completionPct).toBe(100);
    expect(v.translationLangs).toEqual([]);
  });
});

describe("buildMatrixView — topological statuses (cell_links, A2)", () => {
  const base = {
    headers: ["paragraphe", "segment", "fr", "en"],
    languages: ["fr", "en"],
    hub_doc_id: 1,
    hub_unit_ids: [11, 12],
    language_doc_ids: [1, 2],
  };

  it("flags a shared UNCUT target as fused even when the projected texts differ", () => {
    // The Le Clézio under-detection (revue 3b A2): row 1 reads "T1 T2", row 2 "T2" —
    // texts differ, but target 92 is shared uncut → fused, invisible to the heuristic.
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "T1 T2"], ["1", 2, "FR2", "T2"]],
      cell_links: [[[lk(1, 91), lk(2, 92)]], [[lk(3, 92)]]],
    } as AlignMatrix);
    expect(v.hasCellLinks).toBe(true);
    expect(v.rows[0].cells[0].status).toBe("grouped");
    expect(v.rows[1].cells[0].status).toBe("continuation");
  });

  it("does NOT flag identical texts on distinct target units (refrain false positive)", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "— Oui."], ["1", 2, "FR2", "— Oui."]],
      cell_links: [[[lk(1, 91)]], [[lk(2, 92)]]],
    } as AlignMatrix);
    expect(v.rows[1].cells[0].status).toBe("ok");
    expect(v.stats.warningCells).toBe(0);
  });

  it("a CUT pair reads ok — the fusion is resolved", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "head"], ["1", 2, "FR2", "tail"]],
      cell_links: [
        [[lk(1, 91, { char_start: 0, char_end: 5 })]],
        [[lk(2, 91, { char_start: 5, char_end: 9 })]],
      ],
    } as AlignMatrix);
    expect(v.rows[1].cells[0].status).toBe("ok");
  });

  it("a partly-partitioned N-1 keeps its ⚠ on the still-fused tail (identical windows, D-W13)", () => {
    const v = buildMatrixView({
      ...base,
      hub_unit_ids: [11, 12, 13],
      rows: [["1", 1, "FR1", "head"], ["1", 2, "FR2", "tail"], ["1", 3, "FR3", "tail"]],
      cell_links: [
        [[lk(1, 91, { char_start: 0, char_end: 5 })]],
        [[lk(2, 91, { char_start: 5, char_end: 9 })]],
        [[lk(3, 91, { char_start: 5, char_end: 9 })]],
      ],
    } as AlignMatrix);
    // La première frontière est résolue (fenêtres distinctes) ; la queue reste partagée
    // — donc groupée, et toujours signalée comme telle (D-W13). Ce qui change est le mot,
    // pas la détection : elle porte le ✂ « Répartir » au lieu d'un ⚠ « à réparer ».
    expect(v.rows[1].cells[0].status).toBe("grouped");
    expect(v.rows[1].cells[0].groupSize).toBe(2);
    expect(v.rows[2].cells[0].status).toBe("continuation");
  });

  it("carries the identities: hubUnitId per row, links per cell, translationDocIds", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "EN1"], ["1", 2, "FR2", "EN2"]],
      cell_links: [[[lk(1, 91)]], [[lk(2, 92)]]],
    } as AlignMatrix);
    expect(v.rows.map((r) => r.hubUnitId)).toEqual([11, 12]);
    expect(v.rows[0].cells[0].links.map((l) => l.link_id)).toEqual([1]);
    expect(v.translationDocIds).toEqual([2]);
  });

  it("without cell_links the text heuristic still applies (old sidecar fallback)", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "SAME"], ["1", 2, "FR2", "SAME"]],
    } as AlignMatrix);
    expect(v.hasCellLinks).toBe(false);
    expect(v.rows[0].cells[0].status).toBe("grouped");
    expect(v.rows[1].cells[0].status).toBe("continuation");
  });
});

describe("buildMatrixView — statuts D-W8/D8/D-W14 (1.6.56)", () => {
  const base = {
    headers: ["paragraphe", "segment", "fr", "en"],
    languages: ["fr", "en"],
    hub_doc_id: 1,
    hub_unit_ids: [11, 12],
    language_doc_ids: [1, 2],
  };

  it("a per-cell mark reads non_traduit (axis cell) and counts as DONE", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "EN1"], ["1", 2, "FR2", "[non traduit]"]],
      cell_links: [[[lk(1, 91)]], [[]]],
      hub_unit_statuses: [null, null],
      cell_statuses: [[null], ["non_traduit"]],
      addition_rows: [],
      uncovered: [[]],
    } as AlignMatrix);
    expect(v.hasStatuses).toBe(true);
    const cell = v.rows[1].cells[0];
    expect(cell.status).toBe("non_traduit");
    expect(cell.nonTraduitAxis).toBe("cell");
    expect(v.rows[1].hasWarning).toBe(false);
    // D-W5: 2 cells, 0 warnings → 100 %.
    expect(v.stats.warningCells).toBe(0);
    expect(v.stats.completionPct).toBe(100);
  });

  it("a hub-global mark reads non_traduit (axis hub) on the linkless cell", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "EN1"], ["1", 2, "FR2", "[non traduit]"]],
      cell_links: [[[lk(1, 91)]], [[]]],
      hub_unit_statuses: [null, "non_traduit"],
      cell_statuses: [[null], [null]],
      addition_rows: [],
      uncovered: [[]],
    } as AlignMatrix);
    expect(v.rows[1].cells[0].status).toBe("non_traduit");
    expect(v.rows[1].cells[0].nonTraduitAxis).toBe("hub");
  });

  it("real aligned text wins over a contradictory status (axis null)", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "EN1"], ["1", 2, "FR2", "EN2"]],
      cell_links: [[[lk(1, 91)]], [[lk(2, 92)]]],
      hub_unit_statuses: [null, "non_traduit"],
      cell_statuses: [[null], [null]],
      addition_rows: [],
      uncovered: [[]],
    } as AlignMatrix);
    expect(v.rows[1].cells[0].status).toBe("ok");
    expect(v.rows[1].cells[0].nonTraduitAxis).toBe(null);
  });

  it("carries flux addition rows (D8) and EXCLUDES them from the stats", () => {
    const v = buildMatrixView({
      ...base,
      hub_unit_ids: [11, null, 12],
      rows: [
        ["1", 1, "FR1", "EN1"],
        ["", "", "[ajout]", "added by translator"],
        ["1", 2, "FR2", "EN2"],
      ],
      cell_links: [[[lk(1, 91)]], [[]], [[lk(2, 92)]]],
      hub_unit_statuses: [null, null, null],
      cell_statuses: [[null], [null], [null]],
      addition_rows: [{ row: 1, doc_id: 2, unit_id: 95, n: 5 }],
      uncovered: [[]],
    } as AlignMatrix);
    const add = v.rows[1];
    expect(add.addition).toEqual({ docId: 2, unitId: 95, n: 5 });
    expect(add.hubUnitId).toBe(null);
    expect(add.hasWarning).toBe(false);
    expect(add.paragraphStart).toBe(false);
    // Stats count HUB rows only: 2 × 1 lang, no warnings.
    expect(v.stats.totalCells).toBe(2);
    expect(v.stats.warningCells).toBe(0);
  });

  it("fused detection compares against the previous HUB row across an addition row", () => {
    const v = buildMatrixView({
      ...base,
      hub_unit_ids: [11, null, 12],
      rows: [
        ["1", 1, "FR1", "SHARED"],
        ["", "", "[ajout]", "added"],
        ["1", 2, "FR2", "SHARED"],
      ],
      cell_links: [[[lk(1, 91)]], [[]], [[lk(2, 91)]]],
      hub_unit_statuses: [null, null, null],
      cell_statuses: [[null], [null], [null]],
      addition_rows: [{ row: 1, doc_id: 2, unit_id: 95, n: 5 }],
      uncovered: [[]],
    } as AlignMatrix);
    expect(v.rows[2].cells[0].status).toBe("fused");
  });

  it("surfaces uncovered units (D-W14) in stats and the summary line", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", "EN1"], ["1", 2, "FR2", "EN2"]],
      cell_links: [[[lk(1, 91)]], [[lk(2, 92)]]],
      hub_unit_statuses: [null, null],
      cell_statuses: [[null], [null]],
      addition_rows: [],
      uncovered: [[{ unit_id: 97, n: 7, text_raw: "orphan" }, { unit_id: 98, n: 8, text_raw: "o2" }]],
    } as AlignMatrix);
    expect(v.uncovered[0].map((u) => u.unit_id)).toEqual([97, 98]);
    expect(v.stats.uncoveredUnits).toBe(2);
    expect(matrixSummaryLine(v)).toContain("2 hors matrice");
  });

  it("without the status axes (old sidecar) hasStatuses is false and nothing changes", () => {
    const v = buildMatrixView({
      ...base,
      rows: [["1", 1, "FR1", ""], ["1", 2, "FR2", "EN2"]],
      cell_links: [[[]], [[lk(2, 92)]]],
    } as AlignMatrix);
    expect(v.hasStatuses).toBe(false);
    expect(v.rows[0].cells[0].status).toBe("empty");
    expect(v.stats.uncoveredUnits).toBe(0);
  });
});

describe("matrixSummaryLine", () => {
  it("renders the completeness strip", () => {
    const line = matrixSummaryLine(buildMatrixView(SAMPLE));
    expect(line).toContain("9/10");
    expect(line).toContain("1 à réparer");
    // Les groupes sont nommés À CÔTÉ du compte, jamais dedans : les taire ferait passer
    // pour « aligné » ce que personne n'a regardé, les compter comme fautes crierait au loup.
    expect(line).toContain("1 groupée");
    expect(line).toContain("90%");
    expect(line).not.toContain("hors matrice");
  });
});

// ─── Stylo : le texte d'amorçage (ALI-01 tranche 1) ─────────────────────────────
//
// Le défaut corrigé ici a détruit du texte sur le corpus de référence : l'éditeur était
// amorcé avec la PROJECTION (`text_raw`) alors qu'il écrit `text_norm`, donc une seconde
// correction repartait du texte d'origine et écrasait la première (audit §11.12).

const STYLO: AlignMatrix = {
  headers: ["paragraphe", "segment", "fr", "en"],
  languages: ["fr", "en"],
  hub_doc_id: 2,
  //          la grille montre le RAW, non corrigé
  rows: [["1", 1, "Sais - tu ?", "Do you know ?"]],
  hub_unit_ids: [10],
  //                  et voici la correction déjà enregistrée
  hub_text_norms: ["Sais-tu ?"],
  cell_links: [[[
    { link_id: 1, target_unit_id: 20, char_start: null, char_end: null,
      target_text_raw: "Do you know ?", target_text_norm: "Do you know?" },
  ]]],
};

describe("resolveStyloTarget — on repart du texte qu'on édite, pas de celui qu'on affiche", () => {
  it("amorce la colonne moyeu depuis text_norm, jamais depuis la projection", () => {
    const t = resolveStyloTarget(buildMatrixView(STYLO), 0, "hub");
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.unitId).toBe(10);
    expect(t.text).toBe("Sais-tu ?");        // la correction précédente est là
    expect(t.text).not.toBe("Sais - tu ?");  // …et le texte d'origine n'y est pas
  });

  it("amorce une cellule de traduction depuis target_text_norm", () => {
    const t = resolveStyloTarget(buildMatrixView(STYLO), 0, "0");
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.unitId).toBe(20);
    expect(t.text).toBe("Do you know?");
  });

  it("REFUSE plutôt que de retomber sur la projection quand le norm manque", () => {
    // Sidecar antérieur à 1.6.67 : le payload ne transporte que le raw. Retomber dessus
    // rendrait le geste destructif — mieux vaut pas de stylo qu'un stylo qui efface.
    const old: AlignMatrix = {
      ...STYLO,
      hub_text_norms: undefined,
      cell_links: [[[
        { link_id: 1, target_unit_id: 20, char_start: null, char_end: null,
          target_text_raw: "Do you know ?" },
      ]]],
    };
    const v = buildMatrixView(old);
    expect(v.hasTextNorm).toBe(false);
    for (const col of ["hub", "0"]) {
      const t = resolveStyloTarget(v, 0, col);
      expect(t.ok).toBe(false);
      if (t.ok) return;
      expect(t.reason).toBe("no-norm");
    }
  });

  it("refuse une cellule coupée ou multi-liens — aucune unité unique à éditer", () => {
    const cut: AlignMatrix = {
      ...STYLO,
      cell_links: [[[
        { link_id: 1, target_unit_id: 20, char_start: 0, char_end: 5,
          target_text_raw: "Do you know ?", target_text_norm: "Do you know?" },
      ]]],
    };
    const t = resolveStyloTarget(buildMatrixView(cut), 0, "0");
    expect(t.ok).toBe(false);
    if (t.ok) return;
    expect(t.reason).toBe("not-editable");
  });

  it("refuse une ligne d'ajout : elle n'a pas de segment moyeu", () => {
    const add: AlignMatrix = {
      ...STYLO,
      rows: [["", 0, "[ajout]", "Added"]],
      hub_unit_ids: [null],
      hub_text_norms: [null],
      addition_rows: [{ row: 0, doc_id: 3, unit_id: 99, n: 4 }],
      cell_links: [[[]]],
    };
    const t = resolveStyloTarget(buildMatrixView(add), 0, "hub");
    expect(t.ok).toBe(false);
    if (t.ok) return;
    expect(t.reason).toBe("no-unit");
  });

  it("hasTextNorm est vrai dès que le payload porte hub_text_norms", () => {
    expect(buildMatrixView(STYLO).hasTextNorm).toBe(true);
  });
});
