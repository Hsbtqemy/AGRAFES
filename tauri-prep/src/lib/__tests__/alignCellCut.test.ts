import { describe, it, expect } from "vitest";
import {
  resolveFusedCellLinks, resolveStraddleCut, resolveCellUncut, resolveCellMerge,
  cellCutTargets, buildPartitionActions, buildUncutActions, buildCellBeadActions,
  suggestCutOffset, buildCutPanelsHtml, buildCellSplitPanelsHtml, resolveCellSplit,
  cellRemovableTranslations,
  viableCutOffsets, viableCutOffsetsIn, linkWindow, cellsShareFusedTarget,
  cellMergeReversalNoteHtml,
} from "../alignCellCut.ts";
import type { CellLinkColumn } from "../alignCellCut.ts";
import { codePointSlice, codePointLength, cutOffsets } from "../alignBeads.ts";
import type { MatrixCellLink } from "../sidecarClient.ts";

function lk(
  link_id: number, target: number,
  over: Partial<MatrixCellLink> = {},
): MatrixCellLink {
  return {
    link_id,
    target_unit_id: target,
    char_start: null,
    char_end: null,
    target_text_raw: "shared text",
    ...over,
  };
}

describe("linkWindow / cellsShareFusedTarget (D-W13)", () => {
  it("an uncut link's window is [0, len]; identical windows read fused", () => {
    expect(linkWindow(lk(1, 90, { target_text_raw: "ab cd" }))).toEqual([0, 5]);
    expect(cellsShareFusedTarget([lk(1, 90)], [lk(2, 90)])).toBe(true);
  });

  it("same target with DIFFERENT windows (a resolved cut) is not fused", () => {
    const head = lk(1, 90, { char_start: 0, char_end: 6 });
    const tail = lk(2, 90, { char_start: 6, char_end: 11 });
    expect(cellsShareFusedTarget([tail], [head])).toBe(false);
  });

  it("a partly-partitioned N-1 keeps its fused tail (identical sub-windows)", () => {
    const t1 = lk(2, 90, { char_start: 6, char_end: 11 });
    const t2 = lk(3, 90, { char_start: 6, char_end: 11 });
    expect(cellsShareFusedTarget([t2], [t1])).toBe(true);
  });
});

describe("resolveFusedCellLinks (partition of the same-window group)", () => {
  const T = 90;

  it("resolves a 2-1 pair: above/below sides + whole-text window", () => {
    const column: CellLinkColumn = [[lk(1, T)], [lk(2, T)]];
    const res = resolveFusedCellLinks(column, 1);
    expect(res.error).toBeUndefined();
    expect(res.above!.map((l) => l.link_id)).toEqual([1]);
    expect(res.below!.map((l) => l.link_id)).toEqual([2]);
    expect(res.window).toEqual([0, 11]); // "shared text"
  });

  it("a 3-1 partitions instead of refusing (D-W13): boundary lands before the clicked row", () => {
    const column: CellLinkColumn = [[lk(1, T)], [lk(2, T)], [lk(3, T)]];
    const at1 = resolveFusedCellLinks(column, 1);
    expect(at1.above!.map((l) => l.link_id)).toEqual([1]);
    expect(at1.below!.map((l) => l.link_id)).toEqual([2, 3]);
    const at2 = resolveFusedCellLinks(column, 2);
    expect(at2.above!.map((l) => l.link_id)).toEqual([1, 2]);
    expect(at2.below!.map((l) => l.link_id)).toEqual([3]);
  });

  it("re-cuts the still-fused tail of a partial partition, inside ITS window", () => {
    const raw = "one two three four";
    const column: CellLinkColumn = [
      [lk(1, T, { target_text_raw: raw, char_start: 0, char_end: 4 })],
      [lk(2, T, { target_text_raw: raw, char_start: 4, char_end: 18 })],
      [lk(3, T, { target_text_raw: raw, char_start: 4, char_end: 18 })],
    ];
    const res = resolveFusedCellLinks(column, 2);
    expect(res.error).toBeUndefined();
    // Only the same-window tail pair is partitioned — the head link is untouched.
    expect(res.above!.map((l) => l.link_id)).toEqual([2]);
    expect(res.below!.map((l) => l.link_id)).toEqual([3]);
    expect(res.window).toEqual([4, 18]);
  });

  it("rejects distinct targets, ambiguity, and windowless single words", () => {
    expect(resolveFusedCellLinks([[lk(1, 90)], [lk(2, 91)]], 1).error).toMatch(/distinctes/);
    const ambiguous: CellLinkColumn = [
      [lk(1, 90), lk(2, 91)],
      [lk(3, 90), lk(4, 91)],
    ];
    expect(resolveFusedCellLinks(ambiguous, 1).error).toMatch(/ambigu/);
    const single: CellLinkColumn = [
      [lk(1, T, { target_text_raw: "Indivisible" })], [lk(2, T, { target_text_raw: "Indivisible" })],
    ];
    expect(resolveFusedCellLinks(single, 1).error).toMatch(/un seul mot/);
    expect(resolveFusedCellLinks([[], [lk(1, T)]], 1).error).toMatch(/introuvables/);
    expect(resolveFusedCellLinks([[lk(1, T)], [lk(2, T)]], 0).error).toMatch(/hors/);
  });
});

describe("resolveStraddleCut (D-W12/13 « couper à cheval », fenêtré)", () => {
  const RAW = "As far back as I can remember";

  it("resolves down with the whole-text window on an uncut link", () => {
    const column: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: RAW })],
      [lk(2, 91, { target_text_raw: "It is the sound" })],
    ];
    const res = resolveStraddleCut(column, 0, "down");
    expect(res.error).toBeUndefined();
    expect(res.link!.link_id).toBe(1);
    expect(res.neighborRow).toBe(1);
    expect(res.window).toEqual([0, codePointLength(RAW)]);
  });

  it("iterates: a CUT link re-cuts inside its current slice (D-W13)", () => {
    const column: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: RAW, char_start: 12, char_end: 30 })],
      [lk(2, 91, { target_text_raw: "It is the sound" })],
    ];
    const res = resolveStraddleCut(column, 0, "down");
    expect(res.error).toBeUndefined();
    expect(res.window).toEqual([12, 30]);
  });

  it("rejects when there is no neighbour in that direction", () => {
    const column: CellLinkColumn = [[lk(1, 90, { target_text_raw: RAW })]];
    expect(resolveStraddleCut(column, 0, "up").error).toMatch(/au-dessus/);
    expect(resolveStraddleCut(column, 0, "down").error).toMatch(/en dessous/);
  });

  it("redirects when the neighbour already holds the target", () => {
    // Same window → the fused ✂ gesture; different window → undo-then-recut.
    const fused: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: RAW })],
      [lk(2, 90, { target_text_raw: RAW })],
    ];
    expect(resolveStraddleCut(fused, 1, "up").error).toMatch(/cellule ⚠/);
    const boundary: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: RAW, char_start: 0, char_end: 12 })],
      [lk(2, 90, { target_text_raw: RAW, char_start: 12, char_end: 30 })],
    ];
    expect(resolveStraddleCut(boundary, 1, "up").error).toMatch(/déjà une part/);
  });

  it("multi-link cell: the direction picks the EDGE link (§3.5) — the Le Clézio mixed shape", () => {
    // Row 1 = [tail of EN1 (cut, target 90), own EN2 (target 91)] between two neighbours.
    const column: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: RAW, char_start: 0, char_end: 12 })],
      [
        lk(7, 90, { target_text_raw: RAW, char_start: 12, char_end: 30, manual: true }),
        lk(2, 91, { target_text_raw: "It is the sound" }),
      ],
      [lk(3, 92, { target_text_raw: "the tireless sound" })],
    ];
    // Down → the LAST link (own EN2) toward the row below.
    const down = resolveStraddleCut(column, 1, "down");
    expect(down.error).toBeUndefined();
    expect(down.link!.link_id).toBe(2);
    // Up → the FIRST link (the tail) — but the row above already holds its head:
    // boundary adjustment, not a straddle.
    expect(resolveStraddleCut(column, 1, "up").error).toMatch(/déjà une part/);
  });

  it("rejects empty cells and windowless single words", () => {
    expect(resolveStraddleCut([[], [lk(1, 90)]], 0, "down").error).toMatch(/sans traduction/);
    const single: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: "Indivisible" })], [lk(2, 91)],
    ];
    expect(resolveStraddleCut(single, 0, "down").error).toMatch(/un seul mot/);
  });
});

describe("resolveCellSplit — coupe généralisée à toute la cellule (D-W17)", () => {
  // seg 69 (row 1) = two whole EN sentences; neighbours are translated (the Beigbeder shape).
  const A = "one two three", B = "alpha beta"; // word starts: A→4,8 ; B→6
  const col = (): CellLinkColumn => [
    [lk(10, 68, { target_text_raw: "x y" })],
    [lk(11, 71, { target_text_raw: A }), lk(12, 72, { target_text_raw: B })],
    [lk(13, 73, { target_text_raw: "p q" })],
  ];

  it("« couper après le point » = a UNIT-boundary cut MOVES the whole sentence, no split", () => {
    // Cut at the boundary before link B (offset 0 of B) — the canonical Beigbeder fix.
    const r = resolveCellSplit(col(), 1, "down", 1, 0);
    expect(r.error).toBeUndefined();
    expect(r.split).toBeNull();
    expect(r.moves!.map((l) => l.link_id)).toEqual([12]);
    expect(r.neighborRow).toBe(2);
    // Same result reached from the boundary AFTER link A (offset = len(A)).
    const r2 = resolveCellSplit(col(), 1, "down", 0, A.length);
    expect(r2.split).toBeNull();
    expect(r2.moves!.map((l) => l.link_id)).toEqual([12]);
  });

  it("a cut INSIDE a link splits it and moves every whole link beyond (down)", () => {
    const r = resolveCellSplit(col(), 1, "down", 0, 4); // inside A, at "one|two three"
    expect(r.split!.link.link_id).toBe(11);
    expect(r.split!.at).toBe(4);
    expect(r.moves!.map((l) => l.link_id)).toEqual([12]); // B moves whole too
  });

  it("a cut inside the LAST link is the plain straddle split (nothing else moves)", () => {
    const r = resolveCellSplit(col(), 1, "down", 1, 6); // inside B, "alpha|beta"
    expect(r.split!.link.link_id).toBe(12);
    expect(r.moves).toEqual([]);
  });

  it("« up » sends the HEAD upward: boundary and in-link cases", () => {
    // Boundary before B / after A → move A up whole.
    expect(resolveCellSplit(col(), 1, "up", 1, 0).moves!.map((l) => l.link_id)).toEqual([11]);
    expect(resolveCellSplit(col(), 1, "up", 0, A.length).moves!.map((l) => l.link_id)).toEqual([11]);
    // Inside B → split B (tail stays, head goes), A moves up too.
    const r = resolveCellSplit(col(), 1, "up", 1, 6);
    expect(r.split!.link.link_id).toBe(12);
    expect(r.moves!.map((l) => l.link_id)).toEqual([11]);
  });

  it("refuses to empty the cell (moving everything is not a cut)", () => {
    expect(resolveCellSplit(col(), 1, "down", 0, 0).error).toMatch(/Tout partirait/);
    expect(resolveCellSplit(col(), 1, "up", 1, B.length).error).toMatch(/Tout partirait/);
  });

  it("refuses moving nothing, an invalid split offset, the matrix edges", () => {
    expect(resolveCellSplit(col(), 1, "down", 1, B.length).error).toMatch(/Rien à déplacer/);
    expect(resolveCellSplit(col(), 1, "down", 0, 5).error).toMatch(/invalide/); // 5 is mid-word
    expect(resolveCellSplit(col(), 0, "up", 0, 0).error).toMatch(/au-dessus/);
    expect(resolveCellSplit(col(), 2, "down", 0, 0).error).toMatch(/en dessous/);
  });

  it("refuses when the neighbour already holds a target being moved (unique index)", () => {
    const clash: CellLinkColumn = [
      [lk(10, 68, { target_text_raw: "x y" })],
      [lk(11, 71, { target_text_raw: A }), lk(12, 72, { target_text_raw: B })],
      [lk(13, 72, { target_text_raw: B })], // seg 70 already holds target 72
    ];
    expect(resolveCellSplit(clash, 1, "down", 1, 0).error).toMatch(/déjà cette traduction/);
  });
});

describe("buildCellSplitPanelsHtml — picker plein-cellule (D-W17)", () => {
  const labels = { topSeg: 69, topHub: "seg 69 FR", bottomSeg: 70, bottomHub: "seg 70 FR" };
  // Two whole EN sentences on one cell (the Beigbeder shape), cut at the unit boundary.
  const cell = [
    lk(11, 71, { target_text_raw: "The terrorist cult." }),
    lk(12, 72, { target_text_raw: "Ask any surfer :" }),
  ];

  it("lays out the words of EVERY link, with a unit-boundary marker between them", () => {
    // Cut at the boundary before link 1 (offset 0 of link 1): link 0 stays on top.
    const html = buildCellSplitPanelsHtml(cell, 1, 0, labels);
    expect(html).toContain("The");
    expect(html).toContain("Ask");
    expect(html).toContain("prep-matrix-cut-unitsep"); // the ‧ between the two units
    // Everything from link 0 is in the top panel, link 1 in the bottom.
    expect(html.indexOf("terrorist")).toBeLessThan(html.indexOf('data-panel="bottom"'));
    expect(html.indexOf("Ask")).toBeGreaterThan(html.indexOf('data-panel="bottom"'));
  });

  it("a bottom word carries (data-cut-link, data-cut-offset) of its OWN link", () => {
    const html = buildCellSplitPanelsHtml(cell, 1, 0, labels);
    // « surfer » is inside link 1 — clicking it moves the cut after it, in link 1.
    expect(html).toMatch(/data-cut-link="1" data-cut-offset="\d+"[^>]*>surfer/);
  });

  it("fixes the cell's very first and very last words (an empty side is not a cut)", () => {
    const html = buildCellSplitPanelsHtml(cell, 1, 0, labels);
    // "The" (global first) and ":" (global last) are non-clickable spans.
    expect(html).toMatch(/prep-matrix-cut-word--fixed">The/);
    expect(html).toMatch(/prep-matrix-cut-word--fixed">:/);
  });

  it("escapes corpus text and hub labels (imported docs are untrusted)", () => {
    const evil = [lk(1, 90, { target_text_raw: "<script>x</script> ok" })];
    const html = buildCellSplitPanelsHtml(evil, 0, 0, { ...labels, topHub: "<img onerror=1>" });
    expect(html).not.toContain("<script>x");
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("cellRemovableTranslations — ✕ retirer (D-W18)", () => {
  it("lists each translation of the cell, whole links removable, cut ones blocked", () => {
    const cell = [
      lk(11, 90, { target_text_raw: "to stay on the surface." }),                 // whole → removable
      lk(12, 91, { target_text_raw: "Surfing is just sliding." }),                // whole → removable
      lk(13, 92, { target_text_raw: "I decree. I cast.", char_start: 0, char_end: 9 }), // cut → blocked
    ];
    const out = cellRemovableTranslations(cell);
    expect(out.map((t) => t.link_id)).toEqual([11, 12, 13]);
    expect(out.map((t) => t.removable)).toEqual([true, true, false]);
    expect(out[0].text).toBe("to stay on the surface.");
    expect(out[2].text).toBe("I decree."); // the slice, trimmed
    expect(out[2].target_unit_id).toBe(92);
  });

  it("an empty cell yields no candidates", () => {
    expect(cellRemovableTranslations([])).toEqual([]);
  });
});

describe("resolveCellUncut / buildUncutActions (D-W13 ↺)", () => {
  const RAW = "As far back as I can remember";

  it("clears the aligner links and deletes the gesture-created manual ones", () => {
    const column: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: RAW, char_start: 0, char_end: 12 })],
      [lk(7, 90, { target_text_raw: RAW, char_start: 12, char_end: 30, manual: true }),
        lk(2, 91, { target_text_raw: "It is the sound" })],
    ];
    const res = resolveCellUncut(column, 1);
    expect(res.error).toBeUndefined();
    expect(res.clears!.map((l) => l.link_id)).toEqual([1]);
    expect(res.deletes!.map((l) => l.link_id)).toEqual([7]);
    // The ↺ also UNGROUPS what the cut had grouped (revue T4) — it is the exact inverse.
    expect(buildUncutActions({ clears: res.clears!, deletes: res.deletes! })).toEqual([
      { action: "clear_target_span", link_id: 1 },
      { action: "delete", link_id: 7 },
      { action: "clear_bead", link_id: 1 },
    ]);
  });

  it("works from ANY cell of the cut sequence (here the head cell)", () => {
    const column: CellLinkColumn = [
      [lk(1, 90, { char_start: 0, char_end: 6 })],
      [lk(7, 90, { char_start: 6, char_end: 11, manual: true })],
    ];
    const res = resolveCellUncut(column, 0);
    expect(res.clears!.map((l) => l.link_id)).toEqual([1]);
    expect(res.deletes!.map((l) => l.link_id)).toEqual([7]);
  });

  it("never orphans a hand-built target: all-manual groups are cleared, not deleted", () => {
    const column: CellLinkColumn = [
      [lk(5, 90, { char_start: 0, char_end: 6, manual: true })],
      [lk(6, 90, { char_start: 6, char_end: 11, manual: true })],
    ];
    const res = resolveCellUncut(column, 1);
    expect(res.deletes).toEqual([]);
    expect(res.clears!.map((l) => l.link_id)).toEqual([5, 6]);
  });

  it("rejects cells without a cut; a multi-cut cell needs the target specified", () => {
    expect(resolveCellUncut([[lk(1, 90)]], 0).error).toMatch(/Aucune coupe/);
    const two: CellLinkColumn = [[
      lk(1, 90, { char_start: 0, char_end: 6 }),
      lk(2, 91, { char_start: 0, char_end: 6 }),
    ]];
    expect(resolveCellUncut(two, 0).error).toMatch(/préciser laquelle/);
  });

  it("multi-cut cell: cellCutTargets lists the slices, an explicit target scopes the undo (§3.5)", () => {
    const RAWB = "It is the sound";
    const column: CellLinkColumn = [
      [lk(1, 90, { target_text_raw: RAW, char_start: 0, char_end: 12 })],
      [
        lk(7, 90, { target_text_raw: RAW, char_start: 12, char_end: 29, manual: true }),
        lk(2, 91, { target_text_raw: RAWB, char_start: 0, char_end: 5 }),
      ],
      [lk(8, 91, { target_text_raw: RAWB, char_start: 5, char_end: 15, manual: true })],
    ];
    const targets = cellCutTargets(column[1]);
    expect(targets.map((t) => t.target_unit_id)).toEqual([90, 91]);
    expect(targets[0].slice).toBe("as I can remember");
    expect(targets[1].slice).toBe("It is");
    // Undo scoped to one sequence leaves the other untouched.
    const r90 = resolveCellUncut(column, 1, 90);
    expect(r90.clears!.map((l) => l.link_id)).toEqual([1]);
    expect(r90.deletes!.map((l) => l.link_id)).toEqual([7]);
    const r91 = resolveCellUncut(column, 1, 91);
    expect(r91.clears!.map((l) => l.link_id)).toEqual([2]);
    expect(r91.deletes!.map((l) => l.link_id)).toEqual([8]);
  });
});

describe("buildPartitionActions (D-W13)", () => {
  it("assigns [ws,x] to every above link and [x,we] to every below link", () => {
    expect(buildPartitionActions([{ link_id: 1 }], [{ link_id: 2 }, { link_id: 3 }], 6, 0, 18)).toEqual([
      { action: "set_target_span", link_id: 1, char_start: 0, char_end: 6 },
      { action: "set_target_span", link_id: 2, char_start: 6, char_end: 18 },
      { action: "set_target_span", link_id: 3, char_start: 6, char_end: 18 },
    ]);
  });

  it("refuses degenerate offsets (empty slice) and empty sides", () => {
    expect(buildPartitionActions([{ link_id: 1 }], [{ link_id: 2 }], 0, 0, 10)).toEqual([]);
    expect(buildPartitionActions([{ link_id: 1 }], [{ link_id: 2 }], 10, 0, 10)).toEqual([]);
    expect(buildPartitionActions([{ link_id: 1 }], [{ link_id: 2 }], 3, 4, 10)).toEqual([]);
    expect(buildPartitionActions([], [{ link_id: 2 }], 5, 0, 10)).toEqual([]);
  });
});

describe("viableCutOffsets / viableCutOffsetsIn (F7, fenêtré)", () => {
  it("drops boundaries that leave a whitespace-only slice", () => {
    expect(cutOffsets(" Hello world")).toEqual([1, 7]);
    expect(viableCutOffsets(" Hello world")).toEqual([7]);
    expect(viableCutOffsets(" Hello")).toEqual([]);
  });

  it("windows restrict the candidates to the slice", () => {
    const raw = "one two three four"; // word starts: 4, 8, 14
    expect(viableCutOffsetsIn(raw, 0, 18)).toEqual([4, 8, 14]);
    expect(viableCutOffsetsIn(raw, 4, 18)).toEqual([8, 14]);
    expect(viableCutOffsetsIn(raw, 4, 14)).toEqual([8]);
    expect(viableCutOffsetsIn(raw, 4, 8)).toEqual([]);
  });
});

describe("suggestCutOffset (fenêtré)", () => {
  it("splits proportionally to the hub texts, snapped to a word boundary", () => {
    expect(suggestCutOffset("aa bb cc dd", "xxxxxxxxx", "xxx")).toBe(9);
    expect(suggestCutOffset("aa bb cc dd", "xxx", "xxx")).toBe(6);
    expect(suggestCutOffset("Indivisible", "a", "b")).toBeNull();
  });

  it("suggests inside the window on a re-cut", () => {
    const raw = "one two three four";
    // Window = the tail [4, 18]; equal hubs → ideal 11 → nearest of {8, 14} = 8... |8-11|=3, |14-11|=3 → first wins (8).
    expect(suggestCutOffset(raw, "xxx", "xxx", [4, 18])).toBe(8);
  });

  it("never pre-selects a blank-slice offset (F7)", () => {
    expect(suggestCutOffset(" Hello world", "x", "xxxxxxxxxxxxxxxxxxxx")).toBe(7);
    expect(suggestCutOffset(" Hello", "x", "xxxxxxxxxx")).toBeNull();
  });

  it("conservation guard — the two slices always rebuild the original (code points)", () => {
    const target = "un 🐈 deux trois";
    for (const off of cutOffsets(target)) {
      const rebuilt = codePointSlice(target, 0, off) + codePointSlice(target, off, codePointLength(target));
      expect(rebuilt).toBe(target);
    }
  });
});

describe("buildCutPanelsHtml (fenêtré)", () => {
  const labels = { topSeg: 3, topHub: "Moyeu 3", bottomSeg: 4, bottomHub: "Moyeu 4" };

  it("renders the two panels split at the offset, with the hub labels", () => {
    const html = buildCutPanelsHtml("one two three", 4, labels);
    expect(html).toContain('data-panel="top"');
    expect(html).toContain('data-panel="bottom"');
    expect(html).toContain("seg 3");
    expect(html).toContain("seg 4");
    expect(html.indexOf("one")).toBeLessThan(html.indexOf('data-panel="bottom"'));
    expect(html.indexOf("three")).toBeGreaterThan(html.indexOf('data-panel="bottom"'));
  });

  it("renders only the window's words on a re-cut", () => {
    const html = buildCutPanelsHtml("one two three four", 8, labels, [4, 18]);
    expect(html).not.toContain("one"); // outside the window
    expect(html).toContain("two");
    expect(html).toContain("four");
    // Clickable boundaries: 8 belongs to the current split, 14 moves it.
    expect(html).toContain('data-cut-offset="14"');
    expect(html).not.toContain('data-cut-offset="4"'); // window edge — empty slice
  });

  it("keeps the window's first and last words fixed (an empty slice is not a cut)", () => {
    const html = buildCutPanelsHtml("one two", 4, labels);
    expect(html).not.toContain("data-cut-offset");
    expect(html).toContain("prep-matrix-cut-word--fixed");
  });

  it("escapes corpus text (imported docs are untrusted)", () => {
    const html = buildCutPanelsHtml("<script>bad()</script> ok", 23, {
      ...labels, topHub: "<img src=x onerror=alert(1)>",
    });
    expect(html).not.toContain("<script>bad");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("does not offer a blank-slice boundary as clickable (F7)", () => {
    const html = buildCutPanelsHtml(" Hello world", 7, labels);
    expect(html).not.toContain('data-cut-offset="1"');
    expect(html).toContain("Hello");
    expect(html).toContain("world");
  });
});

describe("resolveCellMerge — ⭙ Fusionner (D-W16)", () => {
  it("absorbs the NEXT row's edge link (translation segmented finer than the source)", () => {
    // FR1 ↔ EN1 ; FR2 ↔ EN2 — but EN2 really belongs to FR1: merge « down » on row 0.
    const column: CellLinkColumn = [[lk(1, 91)], [lk(2, 92), lk(3, 93)]];
    const res = resolveCellMerge(column, 0, "down");
    expect(res.error).toBeUndefined();
    // The EDGE link (§3.5): absorbing downwards takes the neighbour's FIRST link.
    expect(res.link!.link_id).toBe(2);
    expect(res.neighborRow).toBe(1);
  });

  it("absorbs the PREVIOUS row's LAST link when merging up", () => {
    const column: CellLinkColumn = [[lk(1, 91), lk(2, 92)], [lk(3, 93)]];
    const res = resolveCellMerge(column, 1, "up");
    expect(res.link!.link_id).toBe(2);
    expect(res.neighborRow).toBe(0);
  });

  it("refuses to absorb a CUT link — the two mechanics must not mix", () => {
    const column: CellLinkColumn = [
      [lk(1, 91, { char_start: 0, char_end: 5 })],
      [lk(2, 91, { char_start: 5, char_end: 11 })],
    ];
    const res = resolveCellMerge(column, 0, "down");
    expect(res.error).toContain("coupée");
    expect(res.link).toBeUndefined();
  });

  it("refuses an empty neighbour and the matrix edges", () => {
    const column: CellLinkColumn = [[lk(1, 91)], []];
    expect(resolveCellMerge(column, 0, "down").error).toContain("aucune traduction");
    expect(resolveCellMerge(column, 0, "up").error).toContain("Pas de segment au-dessus");
    expect(resolveCellMerge(column, 1, "down").error).toContain("Pas de segment en dessous");
  });

  it("refuses a target already attached to this cell", () => {
    const column: CellLinkColumn = [[lk(1, 91)], [lk(2, 91)]];
    expect(resolveCellMerge(column, 0, "down").error).toContain("déjà rattachée");
  });
});

describe("buildCellBeadActions — le bead de cellule (D-W16)", () => {
  it("groups the cell a gesture produced (aligner link + the link it created)", () => {
    // The gesture's own link is `manual` — a cell whose OTHER links are a single aligner
    // link is exactly the 1 hub ↔ N targets shape the bead exists for.
    expect(buildCellBeadActions([lk(4, 91), lk(7, 92, { manual: true })])).toEqual([
      { action: "set_bead", link_id: 4 },
      { action: "set_bead", link_id: 7 },
    ]);
  });

  it("leaves a single-link cell alone — it is already its own bead", () => {
    expect(buildCellBeadActions([lk(4, 91)])).toEqual([]);
    expect(buildCellBeadActions([])).toEqual([]);
  });
});

describe("revue 2026-07-13 — le bead ne doit pas étouffer une vraie collision (T1/T2/T4)", () => {
  it("T1: ne groupe PAS une cellule qui portait déjà 2 liens d'aligneur (collision réelle)", () => {
    // Two aligner links (manual falsy) + the link our gesture just created: the cell was
    // ALREADY a genuine collision → grouping it would erase the alert for good.
    const cell = [lk(1, 91), lk(2, 92), lk(3, 93, { manual: true })];
    expect(buildCellBeadActions(cell)).toEqual([]);
  });

  it("T1: groupe bien la cellule que le geste a produite (1 lien aligneur + les nôtres)", () => {
    const cell = [lk(1, 91), lk(7, 92, { manual: true }), lk(8, 93, { manual: true })];
    expect(buildCellBeadActions(cell).map((a) => a.link_id)).toEqual([1, 7, 8]);
  });

  it("T2: refuse d'absorber une cible partagée avec une autre ligne (fusion ⚠)", () => {
    // Rows 0 and 1 share target 90 (unresolved fusion); row 2 tries to absorb it upwards.
    const column: CellLinkColumn = [[lk(1, 90)], [lk(2, 90)], [lk(3, 92)]];
    const res = resolveCellMerge(column, 2, "up");
    expect(res.error).toContain("partagée");
    expect(res.link).toBeUndefined();
  });

  it("T3: une cellule VIDE peut absorber la phrase du voisin (la fusion reste réversible)", () => {
    const column: CellLinkColumn = [[], [lk(2, 92)]];
    const res = resolveCellMerge(column, 0, "down");
    expect(res.error).toBeUndefined();
    expect(res.link!.link_id).toBe(2);
  });

  it("T4: le ↺ dégroupe les liens qu'il laisse en place (le bead n'est plus en écriture seule)", () => {
    const kept = lk(1, 90, { char_start: 0, char_end: 5 });
    const gesture = lk(7, 90, { char_start: 5, char_end: 11, manual: true });
    expect(buildUncutActions({ clears: [kept], deletes: [gesture] })).toEqual([
      { action: "clear_target_span", link_id: 1 },
      { action: "delete", link_id: 7 },
      { action: "clear_bead", link_id: 1 },
    ]);
  });
});

describe("cellMergeReversalNoteHtml — dire comment revenir, et ce qui ne revient pas", () => {
  const html = cellMergeReversalNoteHtml();

  it("nomme le geste du retour", () => {
    expect(html).toContain("⭙");
    expect(html).toContain("segment voisin");
  });

  it("ne promet pas une réversibilité qu'on n'a pas", () => {
    // Le sous-titre disait « réversible — ⭙ dans l'autre sens » et s'arrêtait là.
    // La phrase revient, sa provenance non : le lien détruit est parti avec son
    // run_id d'aligneur et son statut (audit §11.17).
    expect(html).toContain("lien manuel neuf");
    expect(html).toContain("ne reviennent pas");
  });

  it("nomme le piège — c'est lui qui a coûté un cas réel", () => {
    expect(html).toContain("＝ Rattacher");
    expect(html).toContain("deux");
  });
});
