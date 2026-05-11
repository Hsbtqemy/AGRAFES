import { describe, it, expect } from "vitest";
import { compareDocsByTitle, compareLocale, type DocLike } from "../docSort.ts";

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
