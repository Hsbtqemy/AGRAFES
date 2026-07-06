import { describe, it, expect } from "vitest";
import { resolveCoarseBoundary, regroupByBoundary, type CoarseUnit } from "../coarseRegroup.ts";

const u = (n: number, text: string, isLine = true): CoarseUnit => ({ n, text, isLine });

describe("resolveCoarseBoundary", () => {
  it("tours preset matches dialogue dashes at line start only", () => {
    const b = resolveCoarseBoundary("tours");
    expect(b.exec("— Bonjour")?.index).toBe(0); // em dash
    expect(b.exec("– Salut")?.index).toBe(0);   // en dash
    expect(b.exec("   — indenté")?.index).toBe(0);
    expect(b.test("pas de tiret")).toBe(false);
    expect(b.test("- ascii hyphen")).toBe(false);
  });

  it("defaults to tours", () => {
    expect(resolveCoarseBoundary().exec("— x")?.index).toBe(0);
  });

  it("throws on an unknown preset", () => {
    expect(() => resolveCoarseBoundary("nope")).toThrow(/inconnu/);
  });

  it("custom pattern wins over preset", () => {
    const b = resolveCoarseBoundary("tours", "^[A-Z]+:");
    expect(b.test("BOB: salut")).toBe(true);
  });

  it("throws on an overlong or invalid pattern", () => {
    expect(() => resolveCoarseBoundary(null, "a".repeat(501))).toThrow(/trop long/);
    expect(() => resolveCoarseBoundary(null, "(")).toThrow(/invalide/);
  });
});

describe("regroupByBoundary", () => {
  it("groups dialogue turns like the engine", () => {
    const b = resolveCoarseBoundary("tours");
    const blocks = regroupByBoundary([
      u(1, "— Bonjour, dit-il."),
      u(2, "Comment vas-tu ?"),
      u(3, "— Bien, merci."),
      u(4, "Et toi ?"),
    ], b);
    expect(blocks.map((bl) => [bl.anchorN, bl.memberNs])).toEqual([[1, [1, 2]], [3, [3, 4]]]);
  });

  it("first unit always anchors; structure units are ignored", () => {
    const b = resolveCoarseBoundary("tours");
    const blocks = regroupByBoundary([
      u(1, "Préambule sans tiret."),
      u(2, "Titre", false), // structure → ignored
      u(3, "— Un tour."),
    ], b);
    expect(blocks.map((bl) => bl.memberNs)).toEqual([[1], [3]]);
  });

  it("emulates Python re.match anchoring: a mid-text dash does NOT open a block", () => {
    const b = resolveCoarseBoundary(null, "[—–]"); // custom pattern without ^
    const blocks = regroupByBoundary([
      u(1, "— vrai tour"),
      u(2, "texte avec — un tiret au milieu"),
    ], b);
    expect(blocks.length).toBe(1); // line 2 continues block 1 (would be 2 with plain .test)
    expect(blocks[0].memberNs).toEqual([1, 2]);
  });
});
