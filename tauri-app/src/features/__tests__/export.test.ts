/**
 * Tests for the export serializers (export.ts, U-03).
 *
 * The five formatters + escCsv are pure (hits -> string); exported solely to be
 * testable (the only production edit is adding `export`). exportHits itself is
 * dialog/fs I/O and is left to integration. No DOM, no state.
 */
import { describe, expect, it } from "vitest";
import {
  escCsv,
  toJsonlSimple,
  toJsonlParallel,
  toCsvFlat,
  toCsvLong,
  toCsvFamily,
} from "../export";
import type { QueryHit, AlignedUnit } from "../../lib/sidecarClient";

function hit(overrides: Partial<QueryHit> = {}): QueryHit {
  return { doc_id: 1, unit_id: 10, external_id: null, language: "fr", title: "Doc A", ...overrides };
}
function aligned(overrides: Partial<AlignedUnit> = {}): AlignedUnit {
  return { doc_id: 2, unit_id: 20, external_id: null, language: "en", title: "Doc B", text_norm: "norm", ...overrides };
}

// ─── escCsv ──────────────────────────────────────────────────────────────────

describe("escCsv", () => {
  it("passe une valeur simple sans guillemets", () => {
    expect(escCsv("abc")).toBe("abc");
    expect(escCsv(42)).toBe("42");
  });
  it("null / undefined → chaîne vide", () => {
    expect(escCsv(null)).toBe("");
    expect(escCsv(undefined)).toBe("");
  });
  it("virgule → entouré de guillemets", () => {
    expect(escCsv("a,b")).toBe('"a,b"');
  });
  it("guillemet → doublé et entouré", () => {
    expect(escCsv('a"b')).toBe('"a""b"');
  });
  it("retour ligne → entouré de guillemets", () => {
    expect(escCsv("a\nb")).toBe('"a\nb"');
    expect(escCsv("a\r\nb")).toBe('"a\r\nb"');
  });
});

// ─── toJsonlSimple ───────────────────────────────────────────────────────────

describe("toJsonlSimple", () => {
  it("une ligne JSON par hit, round-trippable", () => {
    const out = toJsonlSimple([hit({ doc_id: 1 }), hit({ doc_id: 2 })]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).doc_id).toBe(1);
    expect(JSON.parse(lines[1]).doc_id).toBe(2);
  });
});

// ─── toJsonlParallel ─────────────────────────────────────────────────────────

describe("toJsonlParallel", () => {
  it("structure pivot + aligned, texte aligné retombe sur text_norm", () => {
    const h = hit({ text: "pivot text", aligned: [aligned({ text: undefined, text_norm: "fromNorm" })] });
    const obj = JSON.parse(toJsonlParallel([h]));
    expect(obj.pivot.doc_id).toBe(1);
    expect(obj.pivot.text).toBe("pivot text");
    expect(obj.aligned).toHaveLength(1);
    expect(obj.aligned[0].text).toBe("fromNorm");
  });
  it("aucun aligné → aligned: []", () => {
    const obj = JSON.parse(toJsonlParallel([hit({ aligned: undefined })]));
    expect(obj.aligned).toEqual([]);
  });
});

// ─── toCsvFlat ───────────────────────────────────────────────────────────────

describe("toCsvFlat", () => {
  it("en-tête de base + colonnes al{i}_* jusqu'au max d'alignés, lignes en CRLF", () => {
    const h1 = hit({ doc_id: 1, aligned: [aligned({ language: "en", title: "B", unit_id: 20, external_id: 5, text: "al text" })] });
    const h2 = hit({ doc_id: 2, aligned: [] });
    const lines = toCsvFlat([h1, h2]).split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0].startsWith("doc_id,title,language,unit_id,external_id,text,left,match,right")).toBe(true);
    expect(lines[0]).toContain("al1_lang");
    expect(lines[0]).not.toContain("al2_lang"); // maxAl = 1
    expect(lines[1]).toContain("al text");
  });
  it("texte aligné retombe sur text_norm quand text absent", () => {
    const h = hit({ aligned: [aligned({ text: undefined, text_norm: "NORMED" })] });
    expect(toCsvFlat([h]).split("\r\n")[1]).toContain("NORMED");
  });
});

// ─── toCsvLong ───────────────────────────────────────────────────────────────

describe("toCsvLong", () => {
  it("une ligne par unité alignée", () => {
    const h = hit({ aligned: [aligned({ title: "B1" }), aligned({ title: "B2" })] });
    const lines = toCsvLong([h]).split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 aligned rows
    expect(lines[1]).toContain("B1");
    expect(lines[2]).toContain("B2");
  });
  it("aucun aligné → une seule ligne avec cellules alignées vides", () => {
    const lines = toCsvLong([hit({ aligned: [] })]).split("\r\n");
    expect(lines).toHaveLength(2); // header + 1 row
  });
});

// ─── toCsvFamily ─────────────────────────────────────────────────────────────

describe("toCsvFamily", () => {
  it("une colonne par document enfant unique (LANG · titre)", () => {
    const h1 = hit({ doc_id: 1, text: "pivot1", aligned: [aligned({ doc_id: 2, language: "en", title: "EN doc", text: "english" })] });
    const h2 = hit({ doc_id: 1, text: "pivot2", aligned: [aligned({ doc_id: 3, language: "de", title: "DE doc", text: "deutsch" })] });
    const lines = toCsvFamily([h1, h2]).split("\r\n");
    expect(lines[0]).toContain("EN · EN doc");
    expect(lines[0]).toContain("DE · DE doc");
    expect(lines).toHaveLength(3); // header + 2 pivot rows
  });
  it("plusieurs alignés pour une même clé enfant → joints par ' / '", () => {
    const h = hit({
      aligned: [
        aligned({ doc_id: 2, language: "en", title: "B", text: "one" }),
        aligned({ doc_id: 2, language: "en", title: "B", text: "two" }),
      ],
    });
    expect(toCsvFamily([h])).toContain("one / two");
  });
  it("texte pivot retombe sur 'left <<match>> right' quand text absent", () => {
    const h = hit({ text: undefined, left: "L", match: "M", right: "R", aligned: [aligned()] });
    expect(toCsvFamily([h])).toContain("L <<M>> R");
  });
});
