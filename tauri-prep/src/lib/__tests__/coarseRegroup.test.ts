import { describe, it, expect } from "vitest";
import {
  resolveCoarseBoundary, regroupByBoundary, previewCoarseRegroup, coarseRegroupGuard,
  currentParagraphs, type CoarseUnit, type CoarseAnchoredUnit,
} from "../coarseRegroup.ts";

const u = (n: number, text: string, isLine = true): CoarseUnit => ({ n, text, isLine });

/** A line unit with its stored parent_n (null = ungrouped). */
const a = (n: number, text: string, parentN: number | null = null): CoarseAnchoredUnit =>
  ({ n, text, isLine: true, parentN });

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

describe("currentParagraphs", () => {
  it("groups by effective anchor and drops the singletons", () => {
    const paras = currentParagraphs([a(1, "x"), a(2, "y", 1), a(3, "z"), a(4, "w", 3)]);
    expect([...paras.entries()]).toEqual([[1, [1, 2]], [3, [3, 4]]]);
  });

  it("a 1:1 parent_n is NOT paragraph work — mesuré sur Beigbeder-Francs_EN", () => {
    // 1267 unités toutes ancrées, chaque parent_n égal au n de l'unité : autant d'ancres
    // que de segments, et zéro regroupement. Compter les ancres annoncerait 1266 segments
    // perdus là où rien n'est groupé avec rien.
    const units = Array.from({ length: 20 }, (_, i) => a(i + 1, `ligne ${i + 1}`, i + 1));
    expect(currentParagraphs(units).size).toBe(0);
  });

  it("ignores structure units", () => {
    const paras = currentParagraphs([
      a(1, "x"),
      { n: 2, text: "Titre", isLine: false, parentN: 1 },
      a(3, "z", 1),
    ]);
    expect([...paras.values()]).toEqual([[1, 3]]);
  });
});

describe("previewCoarseRegroup (QA-06 — aperçu à blanc)", () => {
  const tours = resolveCoarseBoundary("tours");

  it("counts the engine's writes AND the paragraphs actually undone", () => {
    // Blocs : [1,2] ancré en 1, [3,4] ancré en 3. Le ¶ courant [3,4] est reproduit à
    // l'identique → il survit. n=4 porte déjà parent_n=3 → non réécrit, comme le moteur.
    const p = previewCoarseRegroup([
      a(1, "Tout est provisoire."),
      a(2, "Il faut aimer."),
      a(3, "— Bien sûr."),
      a(4, "…répondit-elle.", 3),
    ], tours);
    expect(p).toEqual({
      blocks: 2, unitsGrouped: 4, unitsChanged: 3,
      paragraphsTotal: 1, paragraphsLost: 0, segmentsAffected: 0,
    });
  });

  it("counts a paragraph absorbed into a larger block as lost", () => {
    // ¶ manuel [2,3] ancré en 2 ; « tours » n'ouvre qu'un bloc [1,2,3] → la frontière
    // en 2 disparaît. 2 segments concernés, pas 1 (le seul qui porte l'ancre).
    const p = previewCoarseRegroup([
      a(1, "— Un tour."),
      a(2, "Suite."),
      a(3, "Fin du ¶ manuel.", 2),
    ], tours);
    expect(p.blocks).toBe(1);
    expect(p.paragraphsTotal).toBe(1);
    expect(p.paragraphsLost).toBe(1);
    expect(p.segmentsAffected).toBe(2);
  });

  it("counts a paragraph split in two as lost", () => {
    const p = previewCoarseRegroup([
      a(1, "Ouverture."),
      a(2, "— Un tour.", 1), // ¶ courant [1,2,3], mais n=2 ouvre un nouveau bloc
      a(3, "Suite.", 1),
    ], tours);
    expect(p.paragraphsLost).toBe(1);
    expect(p.segmentsAffected).toBe(3);
  });

  it("reports zero loss when the grouping is already the one asked for", () => {
    const p = previewCoarseRegroup([
      a(1, "— Un tour.", 1),
      a(2, "Suite.", 1),
      a(3, "— Autre tour.", 3),
    ], tours);
    expect(p.unitsChanged).toBe(0);
    expect(p.paragraphsLost).toBe(0);
  });

  it("ignores structure units, like the engine's regroup", () => {
    const p = previewCoarseRegroup([
      a(1, "— Un tour."),
      { n: 2, text: "Titre", isLine: false, parentN: null },
      a(3, "— Autre tour."),
    ], tours);
    expect(p.unitsGrouped).toBe(2);
    expect(p.blocks).toBe(2);
  });
});

describe("coarseRegroupGuard (QA-06 — garde-fou conditionnel)", () => {
  it("stays silent when no paragraph work is at stake", () => {
    // Le patron de needsAlignmentConfirm : rien à perdre, rien à demander.
    const g = coarseRegroupGuard([a(1, "— Un tour."), a(2, "Suite.")]);
    expect(g.confirm).toBe(false);
    expect(g.message).toBe("");
    expect(g.preview?.unitsChanged).toBe(2); // le moteur écrirait pourtant deux unités
  });

  it("stays silent on a 1:1 parent_n — des ancres, pas des paragraphes", () => {
    const g = coarseRegroupGuard(
      Array.from({ length: 20 }, (_, i) => a(i + 1, `ligne ${i + 1}`, i + 1)),
    );
    expect(g.confirm).toBe(false);
    expect(g.preview?.unitsChanged).toBeGreaterThan(0); // des écritures, aucune perte
  });

  it("stays silent when the paragraphs already match the boundary (re-run)", () => {
    const g = coarseRegroupGuard([a(1, "— Un tour.", 1), a(2, "Suite.", 1)]);
    expect(g.confirm).toBe(false);
  });

  it("asks, and names paragraphs, segments and tours, when a ¶ would be undone", () => {
    const g = coarseRegroupGuard([
      a(1, "— Un tour."),
      a(2, "Suite."),
      a(3, "Fin du ¶ manuel.", 2),
    ]);
    expect(g.confirm).toBe(true);
    expect(g.message).toContain("en 1 tour.");                 // ce qu'on obtiendrait
    expect(g.message).toContain("1 paragraphe sur 1");         // ce qu'on défait
    expect(g.message).toContain("2 segments concernés");       // l'étendue réelle
    expect(g.message).toContain("Annuler");                    // le geste reste réversible
  });

  it("ne compte pas le ¶ que le motif reproduit à l'identique", () => {
    // ¶ [1,2,3] et ¶ [4,5]. « tours » rend [1], [2,3], [4,5] : le second est reproduit
    // membre pour membre, il survit. Seul le premier est défait — annoncer 2 serait
    // annoncer la mauvaise grandeur, le défaut que cet audit ne cesse de retrouver.
    const g = coarseRegroupGuard([
      a(1, "Ouverture."),
      a(2, "— Un tour.", 1),
      a(3, "Suite.", 1),
      a(4, "— Autre tour."),
      a(5, "Queue.", 4),
    ]);
    expect(g.confirm).toBe(true);
    expect(g.preview).toMatchObject({ paragraphsTotal: 2, paragraphsLost: 1, segmentsAffected: 3 });
    expect(g.message).toContain("1 paragraphe sur 2 — 3 segments concernés");
  });

  it("pluralises the three counts independently", () => {
    const g = coarseRegroupGuard([
      a(1, "— A."), a(2, "— B.", 1),   // ¶ [1,2]
      a(3, "— C."), a(4, "— D.", 3),   // ¶ [3,4]
    ]);
    expect(g.confirm).toBe(true);
    expect(g.message).toContain("en 4 tours.");
    expect(g.message).toContain("2 paragraphes sur 2");
    expect(g.message).toContain("4 segments concernés");
  });

  it("honours a custom pattern over the preset", () => {
    const g = coarseRegroupGuard(
      [a(1, "BOB : salut"), a(2, "Suite."), a(3, "Ancré ailleurs.", 2)],
      { pattern: "^[A-Z]+ :" },
    );
    expect(g.confirm).toBe(true);
    expect(g.preview?.blocks).toBe(1);
  });

  it("asks anyway when the pattern is unreadable HERE but paragraphs are in place", () => {
    // (?P<x>…) compile en Python, pas en JS : ne pas pouvoir lire le motif n'autorise
    // pas à laisser passer l'écrasement en silence. Le moteur reste l'autorité.
    const g = coarseRegroupGuard([a(1, "Ligne."), a(2, "Groupée.", 1)], { pattern: "(?P<t>—)" });
    expect(g.confirm).toBe(true);
    expect(g.preview).toBeNull();
    expect(g.message).toContain("ne peut pas être vérifié ici");
    expect(g.message).toContain("1 paragraphe déjà en place");
  });

  it("stays silent on an unreadable pattern when no paragraph is in place", () => {
    const g = coarseRegroupGuard([a(1, "Ligne."), a(2, "Autre.")], { pattern: "(" });
    expect(g.confirm).toBe(false);
    expect(g.preview).toBeNull();
  });
});

