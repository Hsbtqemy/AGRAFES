import { describe, it, expect } from "vitest";
import { segStructureMatcherHtml } from "../segStructureMatcher.ts";
import type { DocumentRecord } from "../sidecarClient.ts";

const doc = (title: string): DocumentRecord => ({ title }) as unknown as DocumentRecord;
const res = (ref: number, tgt: number) => ({
  ref_sections: Array(ref).fill(0),
  target_sections: Array(tgt).fill(0),
});

describe("segStructureMatcherHtml", () => {
  it("affiche les titres ref/courant + le compte de sections (pluriel)", () => {
    const html = segStructureMatcherHtml(doc("Réf"), 1, doc("Cur"), 2, res(2, 3));
    expect(html).toContain("Référence — Réf");
    expect(html).toContain("2 sections");
    expect(html).toContain("Document courant — Cur");
    expect(html).toContain("3 sections");
    expect(html).toContain('id="act-matcher-ref"');
    expect(html).toContain('id="act-matcher-tgt"');
  });

  it("singulier « section » quand le compte vaut 1", () => {
    const html = segStructureMatcherHtml(doc("R"), 1, doc("C"), 2, res(1, 1));
    expect(html).toContain("1 section<");
    expect(html).not.toContain("1 sections");
  });

  it("repli « #id » quand le document est introuvable", () => {
    const html = segStructureMatcherHtml(undefined, 7, undefined, 9, res(0, 0));
    expect(html).toContain("Référence — #7");
    expect(html).toContain("Document courant — #9");
  });

  it("échappe les titres", () => {
    expect(segStructureMatcherHtml(doc("A<b>"), 1, doc("C"), 2, res(1, 1))).toContain("A&lt;b&gt;");
  });
});
