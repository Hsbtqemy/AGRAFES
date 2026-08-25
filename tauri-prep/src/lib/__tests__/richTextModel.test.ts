import { describe, it, expect } from "vitest";
import {
  parseRich, renderRich, applyMark, hasMark, clearMarks, canStyle,
  domOffsetToPlain, domLength,
} from "../richTextModel.ts";

describe("parseRich / renderRich — aller-retour", () => {
  it("sépare le texte nu de son style, caractère par caractère", () => {
    const m = parseRich('un <hi rend="italic">mot</hi> ici');
    expect(m.plain).toBe("un mot ici");
    expect(m.marks.join("|")).toBe("|||italic|italic|italic||||");
  });

  it("refait le texte balisé à l'identique", () => {
    for (const raw of [
      "texte nu",
      'un <hi rend="italic">mot</hi> ici',
      '<hi rend="bold italic">tout</hi>',
      'a<hi rend="bold">b</hi>c<hi rend="bold">d</hi>e',
    ]) {
      expect(renderRich(parseRich(raw))).toBe(raw);
    }
  });

  it("refusionne les caractères de même style en une seule balise", () => {
    const raw = '<hi rend="italic">a</hi><hi rend="italic">b</hi>';
    expect(renderRich(parseRich(raw))).toBe('<hi rend="italic">ab</hi>');
  });

  it("hérite du style sur un <hi> imbriqué", () => {
    const m = parseRich('<hi rend="bold">a<hi rend="italic">b</hi></hi>');
    expect(m.plain).toBe("ab");
    expect(m.marks).toEqual(["bold", "bold italic"]);
  });
});

describe("applyMark — poser et retirer", () => {
  it("pose l'italique sur une plage du texte nu", () => {
    expect(applyMark("un mot ici", 3, 6, "italic", true)).toBe('un <hi rend="italic">mot</hi> ici');
  });

  it("retire l'italique d'une plage déjà stylée", () => {
    expect(applyMark('un <hi rend="italic">mot</hi> ici', 3, 6, "italic", false)).toBe("un mot ici");
  });

  it("cumule deux styles sur la même plage, tokens triés comme à l'import", () => {
    const once = applyMark("mot", 0, 3, "italic", true);
    expect(applyMark(once, 0, 3, "bold", true)).toBe('<hi rend="bold italic">mot</hi>');
  });

  it("découpe tout seul un chevauchement partiel", () => {
    // gras sur [0,5), italique sur [3,8) — trois zones, sans décision à prendre (D-R2).
    const g = applyMark("abcdefghij", 0, 5, "bold", true);
    expect(applyMark(g, 3, 8, "italic", true)).toBe(
      '<hi rend="bold">abc</hi><hi rend="bold italic">de</hi><hi rend="italic">fgh</hi>ij',
    );
  });

  it("transporte sans y toucher un style qu'on ne sait pas éditer", () => {
    // D-R1 n'ouvre que l'italique et le gras ; le souligné importé doit survivre (§6).
    const raw = '<hi rend="underline">abc</hi>def';
    expect(applyMark(raw, 4, 6, "italic", true)).toBe(
      '<hi rend="underline">abc</hi>d<hi rend="italic">ef</hi>',
    );
  });

  it("est idempotent : reposer le même style ne change rien", () => {
    const once = applyMark("un mot ici", 3, 6, "italic", true);
    expect(applyMark(once, 3, 6, "italic", true)).toBe(once);
  });

  it("laisse le texte intact sur une plage vide ou hors bornes", () => {
    expect(applyMark("abc", 2, 2, "italic", true)).toBe("abc");
    expect(applyMark("abc", 5, 9, "italic", true)).toBe("abc");
  });

  it("ne change jamais les caractères, seulement les balises", () => {
    const raw = "un mot ici";
    const styled = applyMark(raw, 3, 6, "bold", true);
    expect(parseRich(styled).plain).toBe(raw); // invariant : text_norm reste valable
  });
});

describe("hasMark — état du bouton bascule", () => {
  it("vrai quand toute la plage porte le style", () => {
    expect(hasMark('a<hi rend="italic">bc</hi>d', 1, 3, "italic")).toBe(true);
  });

  it("faux quand la plage n'est que partiellement stylée", () => {
    expect(hasMark('a<hi rend="italic">bc</hi>d', 1, 4, "italic")).toBe(false);
  });

  it("faux sur une plage vide", () => {
    expect(hasMark('<hi rend="italic">abc</hi>', 2, 2, "italic")).toBe(false);
  });
});

describe("clearMarks / canStyle", () => {
  it("retire tout le balisage d'une ligne", () => {
    expect(clearMarks('a<hi rend="bold italic">bc</hi>d')).toBe("abcd");
  });

  it("refuse de styliser une ligne portant un chevron nu", () => {
    expect(canStyle("un mot ici")).toBe(true);
    expect(canStyle('<hi rend="italic">a</hi>b')).toBe(true);
    expect(canStyle("a < b")).toBe(false); // text_raw deviendrait ambigu
  });

  it("accepte une ligne dont les chevrons sont échappés", () => {
    expect(canStyle("a &lt; b")).toBe(true);
  });
});

describe("domOffsetToPlain — le piège des entités (§5a)", () => {
  it("est l'identité sur un texte sans entité", () => {
    expect(domOffsetToPlain("un mot ici", 3)).toBe(3);
    expect(domLength("un mot ici")).toBe(10);
  });

  it("retraduit un offset situé après une esperluette échappée", () => {
    // Le DOM affiche « a & b » (5 caractères) ; le texte nu porte « a &amp; b » (9).
    const plain = "a &amp; b";
    expect(domLength(plain)).toBe(5);
    expect(domOffsetToPlain(plain, 0)).toBe(0);
    expect(domOffsetToPlain(plain, 2)).toBe(2);   // juste avant l'esperluette
    expect(domOffsetToPlain(plain, 3)).toBe(7);   // juste après : 5 caractères consommés
    expect(domOffsetToPlain(plain, 5)).toBe(9);   // fin de ligne
  });

  it("styliser après une entité vise le bon fragment", () => {
    const plain = "a &amp; b";
    const start = domOffsetToPlain(plain, 4); // « b » à l'écran
    const end = domOffsetToPlain(plain, 5);
    expect(applyMark(plain, start, end, "italic", true)).toBe('a &amp; <hi rend="italic">b</hi>');
  });
});

describe("robustesse — balisage mal formé et lignes non stylables", () => {
  it("survit à une fermeture orpheline", () => {
    const m = parseRich("ab</hi>cd");
    expect(m.plain).toBe("abcd");
    expect(m.marks.every((x) => x === "")).toBe(true);
  });

  it("survit à une ouverture jamais fermée", () => {
    const m = parseRich('ab<hi rend="italic">cd');
    expect(m.plain).toBe("abcd");
    expect(m.marks).toEqual(["", "", "italic", "italic"]);
  });

  it("ne fabrique pas un balisage que le rendu refuserait d'afficher", () => {
    // Chevron nu → la garde de provenance de richTextToHtml échapperait toute la ligne,
    // donc la stylisation serait invisible : le modèle refuse de la produire.
    const raw = "a < b";
    expect(applyMark(raw, 0, 1, "italic", true)).toBe(raw);
  });
});
