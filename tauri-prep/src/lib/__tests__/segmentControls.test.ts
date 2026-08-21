import { describe, it, expect } from "vitest";
import type { SegmentPreviewSegment } from "../sidecarClient.ts";
import {
  buildSegmentParams,
  groupSegmentsBySource,
  anomalySummaryLine,
  segmentSummaryLine,
  needsAlignmentConfirm,
  alignmentLossNote,
  cutDissolvedNote,
  surfaceHint,
  defaultAbbreviations,
  parseAbbreviations,
  autoSplitText,
  type CustomSpecState,
} from "../segmentControls.ts";

describe("buildSegmentParams", () => {
  it("maps Phrases / Balises to built-in presets", () => {
    expect(buildSegmentParams("phrases")).toEqual({ preset: "phrases" });
    expect(buildSegmentParams("balises")).toEqual({ preset: "balises" });
  });

  it("Brut and Tours request no fine segmentation params", () => {
    expect(buildSegmentParams("actuel")).toEqual({});
    expect(buildSegmentParams("tours")).toEqual({}); // Tours is a coarse regroup, own endpoint
  });

  it("builds a terminator spec from the custom terminator set + extra abbreviations", () => {
    const custom: CustomSpecState = {
      terminators: [".!?", ";:"], requireUppercase: false, wordMode: false, abbreviations: ["cap", "pág"],
    };
    expect(buildSegmentParams("custom", custom)).toEqual({
      spec: {
        kind: "terminator", terminators: ".!?;:", require_uppercase_after: false,
        protect_abbreviations: ["cap", "pág"], label: "custom",
      },
    });
  });

  it("custom word mode → whitespace spec (terminators + abbreviations ignored)", () => {
    const custom: CustomSpecState = {
      terminators: [".!?"], requireUppercase: true, wordMode: true, abbreviations: ["cap"],
    };
    expect(buildSegmentParams("custom", custom)).toEqual({ spec: { kind: "whitespace", label: "mots" } });
  });

  it("custom with no state falls back to a bare terminator spec (no capital condition)", () => {
    expect(buildSegmentParams("custom")).toEqual({
      spec: {
        kind: "terminator", terminators: ".!?", require_uppercase_after: false,
        protect_abbreviations: [], label: "custom",
      },
    });
  });
});

describe("defaultAbbreviations", () => {
  it("pre-fills the doc language pack, empty for unknown languages", () => {
    expect(defaultAbbreviations("fr")).toEqual(["ann", "chap", "env", "etc", "par"]);
    expect(defaultAbbreviations("en-US")).toEqual(["approx", "dept", "misc", "chap"]);
    expect(defaultAbbreviations("es")).toEqual([]);
    expect(defaultAbbreviations(null)).toEqual([]);
  });
});

describe("parseAbbreviations", () => {
  it("splits on commas / spaces / semicolons and strips trailing dots", () => {
    expect(parseAbbreviations("cap, pág;  art. \n etc.")).toEqual(["cap", "pág", "art", "etc"]);
  });
  it("empty / whitespace input → empty list", () => {
    expect(parseAbbreviations("   ")).toEqual([]);
    expect(parseAbbreviations("")).toEqual([]);
  });
});

describe("groupSegmentsBySource", () => {
  const seg = (n: number, text: string, src: number): SegmentPreviewSegment => ({
    n, text, source_unit_n: src, external_id: null,
  });

  it("groups consecutive segments by source unit, preserving order", () => {
    const groups = groupSegmentsBySource([
      seg(1, "A.", 1), seg(2, "B.", 1), seg(3, "C.", 2), seg(4, "D.", 3), seg(5, "E.", 3),
    ]);
    expect(groups.map((g) => g.source_unit_n)).toEqual([1, 2, 3]);
    expect(groups[0].segments.map((s) => s.text)).toEqual(["A.", "B."]);
    expect(groups[2].segments).toHaveLength(2);
  });

  it("empty input → empty grouping", () => {
    expect(groupSegmentsBySource([])).toEqual([]);
  });

  it("does not merge non-adjacent repeats of the same source (defensive)", () => {
    const groups = groupSegmentsBySource([seg(1, "A", 1), seg(2, "B", 2), seg(3, "C", 1)]);
    expect(groups.map((g) => g.source_unit_n)).toEqual([1, 2, 1]);
  });
});

describe("segmentSummaryLine", () => {
  it("agrees plurals in French", () => {
    expect(segmentSummaryLine(1, 1)).toBe("1 unité → 1 segment");
    expect(segmentSummaryLine(2, 5)).toBe("2 unités → 5 segments");
  });
});

describe("needsAlignmentConfirm", () => {
  it("only confirms when there is an alignment to lose", () => {
    expect(needsAlignmentConfirm(0)).toBe(false);
    expect(needsAlignmentConfirm(null)).toBe(false);
    expect(needsAlignmentConfirm(undefined)).toBe(false);
    expect(needsAlignmentConfirm(3)).toBe(true);
  });
});

describe("surfaceHint", () => {
  it("returns a distinct hint per surface", () => {
    const hints = new Set([
      surfaceHint("phrases"), surfaceHint("balises"), surfaceHint("custom"), surfaceHint("tours"),
    ]);
    expect(hints.size).toBe(4);
  });
});

describe("autoSplitText", () => {
  it("splits at the last space before the midpoint, trimming both halves", () => {
    // len 11, midpoint = ceil(11/2) = 6; last space before index 6 is index 5.
    expect(autoSplitText("hello world")).toEqual({ a: "hello", b: "world" });
  });

  it("falls back to the raw midpoint when there is no space before it", () => {
    // "abcdefgh" len 8, midpoint 4, no space → cut at 4.
    expect(autoSplitText("abcdefgh")).toEqual({ a: "abcd", b: "efgh" });
  });

  it("keeps the whole text in the first half when a leading space is the only one", () => {
    // lastIndexOf(" ", mid) === 0 is not > 0 → falls back to midpoint.
    const { a, b } = autoSplitText(" trailing");
    expect(a + b).toContain("trailing");
  });
});


describe("alignmentLossNote — dire ce qui a été détruit, après, et exactement", () => {
  it("se tait quand rien n'a été détruit", () => {
    expect(alignmentLossNote(0)).toBe("");
  });

  it("se tait sur un sidecar antérieur à 1.6.68 (champ absent)", () => {
    // Silence plutôt qu'un « 0 lien » trompeur : on ne sait pas, on ne dit rien.
    expect(alignmentLossNote(undefined)).toBe("");
    expect(alignmentLossNote(null)).toBe("");
  });

  it("annonce le compte EXACT du geste, pas celui du document", () => {
    // Le reliquat au dossier demandait de câbler needsAlignmentConfirm sur la fusion.
    // Sur le corpus de référence, cela aurait annoncé « ce document a 5 770 liens,
    // fusionner les effacera » avant d'en détruire deux. C'est ce mensonge-là que ce
    // message remplace.
    expect(alignmentLossNote(2)).toContain("2 liens");
    expect(alignmentLossNote(2)).not.toContain("5770");
  });

  it("accorde le singulier", () => {
    expect(alignmentLossNote(1)).toContain("1 lien d’alignement retiré —");
    expect(alignmentLossNote(1)).not.toContain("liens");
  });

  it("rappelle que l'annulation les rend — c'est vrai depuis la migration 035", () => {
    expect(alignmentLossNote(3)).toContain("« Annuler » les rend");
  });
});

describe("cutDissolvedNote — une coupe ne doit pas disparaître en silence (D-1)", () => {
  it("se tait quand aucune coupe n'était en jeu — le cas courant", () => {
    expect(cutDissolvedNote(0)).toBe("");
    expect(cutDissolvedNote(undefined)).toBe("");
    expect(cutDissolvedNote(null)).toBe("");
  });

  it("annonce la dissolution d'une coupe simple", () => {
    expect(cutDissolvedNote(1)).toContain("La coupe de cette phrase a été retirée");
    expect(cutDissolvedNote(1)).not.toContain("segments la partageaient");
  });

  it("dit combien de segments se partageaient la phrase", () => {
    // Une coupe répartit UNE phrase sur plusieurs lignes moyeu : effacer les bornes les
    // rend toutes entières d'un coup, et l'utilisateur doit savoir que ça a bougé ailleurs.
    expect(cutDissolvedNote(3)).toContain("3 segments la partageaient");
  });
});

describe("anomalySummaryLine — ce qu'un découpage coûterait, lu avant de l'appliquer", () => {
  it("accorde le pluriel des deux familles", () => {
    expect(anomalySummaryLine(1, 0)).toBe("1 segment court");
    expect(anomalySummaryLine(3, 0)).toBe("3 segments courts");
    expect(anomalySummaryLine(0, 1)).toBe("1 ponctuation orpheline");
    expect(anomalySummaryLine(0, 2)).toBe("2 ponctuations orphelines");
  });

  it("joint les deux familles quand les deux sont présentes", () => {
    expect(anomalySummaryLine(3, 1)).toBe("3 segments courts · 1 ponctuation orpheline");
  });

  it("dit explicitement le cas propre plutôt que de se taire", () => {
    // Le vide se confondrait avec « pas calculé », alors qu'on veut justement voir le
    // compte tomber à mesure qu'on règle les terminateurs et les abréviations.
    expect(anomalySummaryLine(0, 0)).toBe("aucune anomalie détectée");
  });
});
