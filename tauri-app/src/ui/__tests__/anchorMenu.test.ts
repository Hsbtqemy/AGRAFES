/**
 * Tests de `shared/anchorMenu.ts` — la géométrie de recadrage des menus flottants.
 *
 * Seule `clampToBounds` est testée : c'est la partie pure. Les deux applicateurs
 * (`clampAnchoredMenu`, `clampFixedMenu`) ne font qu'écrire le résultat dans un
 * style, et ce qu'ils écrivent se vérifie en rendu, pas ici.
 *
 * Les cas nommés « mesuré » rejouent les débordements relevés en rendu réel le
 * 2026-08-21 (Chrome headless sur le vrai `buildUI()`), consignés dans
 * `pilotage/qa/menus-flottants.md`.
 */
import { describe, expect, it } from "vitest";
import { clampToBounds, DEFAULT_PAD, type Rect } from "../../../../shared/anchorMenu";

const rect = (left: number, top: number, right: number, bottom: number): Rect =>
  ({ left, top, right, bottom });

/** Le cadre de l'application : une fenêtre de W×H ancrée en 0,0. */
const cadre = (w: number, h: number): Rect => rect(0, 0, w, h);

describe("clampToBounds — rien à faire", () => {
  it("laisse un menu déjà à l'intérieur strictement immobile", () => {
    const r = clampToBounds(rect(100, 100, 300, 250), cadre(1200, 760));
    expect(r).toEqual({ dx: 0, dy: 0, maxWidth: null, maxHeight: null });
  });

  it("ne bouge pas un menu posé exactement sur la marge", () => {
    const r = clampToBounds(rect(8, 8, 200, 200), cadre(1200, 760));
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
  });
});

describe("clampToBounds — glissement horizontal", () => {
  it("ramène un menu qui sort à droite, marge comprise", () => {
    const r = clampToBounds(rect(1000, 100, 1300, 300), cadre(1200, 760));
    expect(r.dx).toBe(-108);          // 1300 → 1192
    expect(r.dy).toBe(0);
    expect(r.maxWidth).toBeNull();
  });

  it("ramène un menu qui sort à gauche", () => {
    const r = clampToBounds(rect(-50, 100, 200, 300), cadre(1200, 760));
    expect(r.dx).toBe(58);            // −50 → 8
  });

  it("mesuré : le menu Export à 800 de large (x=[−177..98])", () => {
    const r = clampToBounds(rect(-177, 140, 97, 311), cadre(800, 520));
    expect(r.dx).toBe(185);
    expect(r.maxWidth).toBeNull();    // 274 px tiennent dans 800 − 16
  });

  it("mesuré : le popover d'aide à la taille par défaut (x=[926..1286])", () => {
    const r = clampToBounds(rect(926, 94, 1286, 493), cadre(1200, 760));
    expect(r.dx).toBe(-94);           // 1286 → 1192
  });

  it("mesuré : le panneau d'historique à 1440 (x=[−204..96])", () => {
    const r = clampToBounds(rect(-204, 140, 96, 494), cadre(1440, 900));
    expect(r.dx).toBe(212);
  });
});

describe("clampToBounds — glissement vertical", () => {
  it("remonte un menu qui sort en bas", () => {
    const r = clampToBounds(rect(100, 500, 300, 700), cadre(1200, 608));
    expect(r.dy).toBe(-100);          // 700 → 600
    expect(r.dx).toBe(0);
  });

  it("mesuré : le popover de token, 107 px sous le bord bas", () => {
    const r = clampToBounds(rect(600, 540, 780, 715), cadre(1182, 608));
    expect(r.dy).toBe(-115);          // 715 → 600, marge comprise
  });

  it("redescend un menu qui sort en haut", () => {
    const r = clampToBounds(rect(100, -30, 300, 120), cadre(1200, 760));
    expect(r.dy).toBe(38);
  });
});

describe("clampToBounds — plus grand que le cadre", () => {
  it("borne la largeur et cale au bord au lieu de glisser sans fin", () => {
    const r = clampToBounds(rect(50, 100, 1400, 300), cadre(800, 600));
    expect(r.maxWidth).toBe(784);     // 800 − 2×8
    expect(r.dx).toBe(-42);           // 50 → 8
  });

  it("borne la hauteur — c'est le cas du popover d'aide en fenêtre courte", () => {
    const r = clampToBounds(rect(100, 94, 460, 493), cadre(800, 380));
    expect(r.maxHeight).toBe(364);    // 380 − 2×8
    expect(r.dy).toBe(-86);           // 94 → 8
  });

  it("borne les deux axes à la fois", () => {
    const r = clampToBounds(rect(0, 0, 2000, 2000), cadre(500, 400));
    expect(r.maxWidth).toBe(484);
    expect(r.maxHeight).toBe(384);
    expect(r.dx).toBe(8);
    expect(r.dy).toBe(8);
  });

  it("sur un cadre plus étroit que ses marges, c'est la marge qui cède, pas le menu", () => {
    // Sans cette règle la borne vaudrait 10 − 2×8 = −6, ramenée à 0 : un menu
    // invisible. On préfère rendre les 10 px disponibles.
    const r = clampToBounds(rect(0, 0, 100, 100), cadre(10, 10));
    expect(r.maxWidth).toBe(10);
    expect(r.maxHeight).toBe(10);
    expect(r.dx).toBe(0);
  });

  it("ne renvoie jamais une borne négative", () => {
    const r = clampToBounds(rect(0, 0, 100, 100), cadre(0, 0));
    expect(r.maxWidth).toBe(0);
    expect(r.maxHeight).toBe(0);
  });
});

describe("clampToBounds — cadre et marge", () => {
  it("mesure contre le cadre fourni, pas contre le viewport", () => {
    // Un hôte décalé : le menu est dans la fenêtre mais hors de son conteneur.
    const r = clampToBounds(rect(120, 100, 380, 300), rect(200, 0, 600, 400));
    expect(r.dx).toBe(88);            // 120 → 208
  });

  it("respecte une marge explicite", () => {
    const r = clampToBounds(rect(1000, 100, 1300, 300), cadre(1200, 760), 0);
    expect(r.dx).toBe(-100);          // 1300 → 1200, sans marge
  });

  it("la marge par défaut vaut 8", () => {
    expect(DEFAULT_PAD).toBe(8);
  });

  it("arrondit toujours vers l'intérieur du cadre, jamais vers le débordement", () => {
    // Les rects réels sont fractionnaires. Arrondir au plus proche laisserait
    // jusqu'à un demi-pixel dehors ; on arrondit franc.
    const droite = clampToBounds(rect(1000, 100, 1300.4, 300), cadre(1200, 760));
    expect(droite.dx).toBe(-109);
    expect(1300.4 + droite.dx).toBeLessThanOrEqual(1192);

    const gauche = clampToBounds(rect(-50.4, 100, 200, 300), cadre(1200, 760));
    expect(gauche.dx).toBe(59);
    expect(-50.4 + gauche.dx).toBeGreaterThanOrEqual(8);
  });

  it("borne à un nombre entier de pixels", () => {
    const r = clampToBounds(rect(0, 0, 900, 900), { left: 0, top: 0, right: 800.6, bottom: 600.6 });
    expect(Number.isInteger(r.maxWidth)).toBe(true);
    expect(Number.isInteger(r.maxHeight)).toBe(true);
  });

  it("corrige les deux axes en un seul appel", () => {
    const r = clampToBounds(rect(-40, 500, 260, 700), cadre(1200, 608));
    expect(r.dx).toBe(48);
    expect(r.dy).toBe(-100);
  });
});
