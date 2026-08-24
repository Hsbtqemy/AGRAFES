import { describe, it, expect } from "vitest";
import { richTextToHtml } from "../sidecarClient.ts";

/**
 * `richTextToHtml` renders the <hi rend="…"> markup the DOCX/ODT importers store in
 * text_raw — but only while that markup still describes the line's current text.
 *
 * The pairs below are the engine's own truth: each `norm` was produced by running
 * `unicode_policy.normalize()` on its `raw` in Python, which is exactly what the
 * importer stores in text_norm. They pin the JS fold against the ADR-003 policy.
 */
const ENGINE_PAIRS: Array<{ raw: string; norm: string }> = [
  { raw: 'un <hi rend="italic">mot</hi> ici', norm: "un mot ici" },
  { raw: 'espace insécable et <hi rend="bold">gras</hi>', norm: "espace insécable et gras" },
  { raw: 'coupure¤segment <hi rend="italic">it</hi>', norm: "coupure segment it" },
  { raw: 'soft­hyphen <hi rend="italic">et</hi> zwsp​ici', norm: "softhyphen et zwspici" },
  { raw: 'The <hi rend="italic">Observer</hi>,  14 Aug 2022', norm: "The Observer,  14 Aug 2022" },
];

describe("richTextToHtml — rendu du balisage <hi>", () => {
  it("rend chaque token rend en son équivalent sémantique", () => {
    expect(richTextToHtml('a <hi rend="italic">b</hi>', "a b")).toBe("a <em>b</em>");
    expect(richTextToHtml('a <hi rend="bold">b</hi>', "a b")).toBe("a <strong>b</strong>");
    expect(richTextToHtml('a <hi rend="underline">b</hi>', "a b")).toBe("a <u>b</u>");
    expect(richTextToHtml('a <hi rend="strikethrough">b</hi>', "a b")).toBe("a <s>b</s>");
    expect(richTextToHtml('a <hi rend="superscript">b</hi>', "a b")).toBe("a <sup>b</sup>");
    expect(richTextToHtml('a <hi rend="subscript">b</hi>', "a b")).toBe("a <sub>b</sub>");
  });

  it("imbrique les tokens cumulés d'un même <hi>", () => {
    expect(richTextToHtml('<hi rend="bold italic">x</hi>', "x")).toBe("<strong><em>x</em></strong>");
  });

  it("échappe le repli quand text_raw ne porte aucun balisage", () => {
    expect(richTextToHtml("a & b", "a & b")).toBe("a &amp; b");
    expect(richTextToHtml(null, "<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });
});

describe("richTextToHtml — garde d'obsolescence (§4)", () => {
  it("rend le balisage tant que text_raw décrit encore le texte courant", () => {
    for (const { raw, norm } of ENGINE_PAIRS) {
      expect(richTextToHtml(raw, norm)).toMatch(/<(em|strong)>/);
    }
  });

  it("rend le texte corrigé, pas le verbatim périmé, quand les deux ont divergé", () => {
    // Cas réel (unité 245582 du corpus) : la curation a resserré la double espace
    // dans text_norm ; text_raw garde le verbatim d'import, italique compris.
    const raw = 'The <hi rend="italic">Observer</hi>,  14 Aug 2022';
    const corrected = "The Observer, 14 Aug 2022";
    const out = richTextToHtml(raw, corrected);
    expect(out).toBe("The Observer, 14 Aug 2022");
    expect(out).not.toContain("<em>");   // l'italique tombe…
    expect(out).not.toContain(",  14");  // …mais la correction s'affiche
  });

  it("n'échappe jamais le balisage périmé sous forme de tags visibles", () => {
    const out = richTextToHtml('un <hi rend="italic">mot</hi> ici', "un mot corrigé ici");
    expect(out).toBe("un mot corrigé ici");
    expect(out).not.toContain("&lt;hi");
  });

  it("laisse passer un écart purement normalisable (le balisage reste vrai)", () => {
    // NBSP côté verbatim, espace ASCII côté text_norm : normalize() les confond,
    // la ligne n'a pas été corrigée — l'italique doit survivre.
    expect(richTextToHtml('a <hi rend="italic">b</hi>', "a b")).toBe("a <em>b</em>");
  });

  it("rend le repli « original d'import » qui se compare à lui-même", () => {
    // SegmentPane passe text_source des deux côtés : rien à quoi comparer,
    // la garde ne doit pas manger le balisage.
    const src = 'l’<hi rend="italic">Observer</hi> d’origine';
    expect(richTextToHtml(src, src)).toBe("l’<em>Observer</em> d’origine");
  });
  it("n'injecte pas de balisage vivant venu d'un import verbatim (txt/TEI)", () => {
    // Un .txt qui contient litteralement "<hi" : le texte n'a pas ete echappe par
    // l'importateur, donc rien ne doit etre injecte tel quel.
    const raw = '<hi rend="italic">x</hi><script>alert(1)</script>';
    const out = richTextToHtml(raw, raw);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("garde le rendu riche quand le texte est echappe comme le fait l'importateur", () => {
    // Meme contenu, mais passe par para_to_rich_text : les chevrons sont des entites.
    const raw = '<hi rend="italic">x</hi>&lt;script&gt;';
    expect(richTextToHtml(raw, "x&lt;script&gt;")).toBe("<em>x</em>&lt;script&gt;");
  });
});
