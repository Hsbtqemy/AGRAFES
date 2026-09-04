import { describe, it, expect } from "vitest";
import {
  compareDocsByTitle, compareLocale, compareFamiliesByTitle, type DocLike,
} from "../../../../shared/docSort.ts";

const d = (doc_id: number, title: string | null | undefined): DocLike =>
  ({ doc_id, title });

describe("compareDocsByTitle", () => {
  // Invariant 1 — Insensible à la casse.
  it("trie 'abc' === 'ABC' en primaire (tie-break sur doc_id)", () => {
    const arr = [d(2, "ABC"), d(1, "abc")];
    arr.sort(compareDocsByTitle);
    expect(arr.map(x => x.doc_id)).toEqual([1, 2]);
  });

  // Invariant 2 — Insensible aux accents.
  it("trie 'élève' === 'eleve' en primaire", () => {
    const arr = [d(5, "élève"), d(3, "eleve")];
    arr.sort(compareDocsByTitle);
    expect(arr.map(x => x.doc_id)).toEqual([3, 5]);
  });

  // Invariant 3 — Titre null/undefined comparé comme chaîne vide.
  it("titre null tombe en tête (chaîne vide)", () => {
    const arr = [d(1, "Banane"), d(2, null), d(3, "Abricot")];
    arr.sort(compareDocsByTitle);
    // null → "" vient avant n'importe quel titre non vide
    expect(arr.map(x => x.doc_id)).toEqual([2, 3, 1]);
  });

  it("titre undefined équivalent à null", () => {
    const arr = [d(1, "Bxxxx"), d(2, undefined)];
    arr.sort(compareDocsByTitle);
    expect(arr.map(x => x.doc_id)).toEqual([2, 1]);
  });

  // Invariant 4 — Stabilité sur égalité de titre.
  it("titres égaux → ordre stable sur doc_id ascendant", () => {
    const arr = [d(5, "même"), d(2, "même"), d(8, "même")];
    arr.sort(compareDocsByTitle);
    expect(arr.map(x => x.doc_id)).toEqual([2, 5, 8]);
  });

  // Invariant 5 — Tri numérique sur fallback "Doc #N".
  it("'Doc 2' vient avant 'Doc 10' avec numeric:true", () => {
    const arr = [
      d(1, "Doc 10"),
      d(2, "Doc 2"),
      d(3, "Doc 1"),
    ];
    arr.sort(compareDocsByTitle);
    expect(arr.map(x => x.doc_id)).toEqual([3, 2, 1]);
  });

  // Tri général alphabétique FR.
  it("tri alphabétique FR sur un mix réaliste", () => {
    const arr = [
      d(10, "Zola"),
      d(20, "Éluard"),
      d(30, "Apollinaire"),
      d(40, "Émile"),
    ];
    arr.sort(compareDocsByTitle);
    expect(arr.map(x => x.title)).toEqual([
      "Apollinaire", "Éluard", "Émile", "Zola",
    ]);
  });

  // Pas de mutation collatérale.
  it("ne mute pas a/b et reste déterministe sur appels répétés", () => {
    const a = d(1, "Foo");
    const b = d(2, "Bar");
    const r1 = compareDocsByTitle(a, b);
    const r2 = compareDocsByTitle(a, b);
    expect(r1).toBe(r2);
    expect(a.title).toBe("Foo");
    expect(b.title).toBe("Bar");
  });
});

describe("compareLocale", () => {
  it("trie alphabétique FR insensible casse+accents", () => {
    const arr = ["Zola", "abricot", "Éluard"];
    arr.sort(compareLocale);
    expect(arr).toEqual(["abricot", "Éluard", "Zola"]);
  });

  it("null/undefined traité comme chaîne vide (vient en tête)", () => {
    expect(compareLocale(null, "abc")).toBeLessThan(0);
    expect(compareLocale("abc", undefined)).toBeGreaterThan(0);
    expect(compareLocale(null, undefined)).toBe(0);
  });

  it("respecte numeric:true (Doc 2 avant Doc 10)", () => {
    const arr = ["Doc 10", "Doc 2", "Doc 1"];
    arr.sort(compareLocale);
    expect(arr).toEqual(["Doc 1", "Doc 2", "Doc 10"]);
  });

  it("strings égales → 0 (pas de tie-break ici, c'est au caller)", () => {
    expect(compareLocale("foo", "foo")).toBe(0);
    expect(compareLocale("Foo", "foo")).toBe(0); // sensitivity base
  });
});

describe("l'ordre rendu par /documents n'est pas un ordre d'affichage", () => {
  it("range les titres alphabétiquement quel que soit l'ordre d'import", () => {
    // `/documents` trie par doc_id — l'ordre d'IMPORT. Sur le corpus de travail,
    // ça donnait « Beigbeder-Francs_EN, Houellebecq-Carte_FR, … » : illisible dès
    // qu'il y a plus d'une poignée de documents. Trouvé en QA le 2026-08-21, dans la
    // recherche grammaticale ; le concordancier avait le même défaut.
    const commeLApi: DocLike[] = [
      { doc_id: 364, title: "Rankin-Naming_FR.docx" },
      { doc_id: 366, title: "asimov-Foundation_FR.docx" },   // casse indifférente
      { doc_id: 367, title: "Élan_FR.docx" },                // accent indifférent
      { doc_id: 411, title: "Beigbeder-Francs_EN.docx" },
    ];
    expect([...commeLApi].sort(compareDocsByTitle).map(d => d.doc_id))
      .toEqual([366, 411, 367, 364]);
  });
});

describe("compareFamiliesByTitle", () => {
  // Le serveur rend les familles dans l'ordre des `doc_id` de moyeu, c'est-à-dire dans
  // l'ordre des imports. Mesuré sur la base de travail : alphabétique PAR LOT, donc les
  // deux premières de l'alphabet arrivent en 14e et 15e position sur 20. Quatre écrans
  // montrent cette liste ; ils trient tous avec ce comparateur.
  const fam = (family_id: number, title: string | null) =>
    ({ family_id, parent: title === null ? null : { title } });

  it("trie par titre de moyeu, insensible casse et accents", () => {
    const tri = [fam(1, "Zola"), fam(2, "élan"), fam(3, "Asimov"), fam(4, "ELAN")]
      .sort(compareFamiliesByTitle).map((f) => f.family_id);
    expect(tri).toEqual([3, 2, 4, 1]);
  });

  it("départage sur family_id, donc l'ordre est stable", () => {
    const tri = [fam(9, "Corpus"), fam(2, "Corpus"), fam(5, "Corpus")]
      .sort(compareFamiliesByTitle).map((f) => f.family_id);
    expect(tri).toEqual([2, 5, 9]);
  });

  it("une famille sans moyeu compte comme titre vide, et vient en tête", () => {
    const tri = [fam(1, "Asimov"), fam(2, null)]
      .sort(compareFamiliesByTitle).map((f) => f.family_id);
    expect(tri).toEqual([2, 1]);
  });
});
