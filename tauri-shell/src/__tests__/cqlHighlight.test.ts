import { describe, it, expect } from "vitest";
import { tokenizeCql, cqlTokensToHtml, cqlToHtml } from "../modules/cqlHighlight.ts";

function kinds(src: string): string[] {
  return tokenizeCql(src).map((t) => `${t.kind}:${t.text}`);
}

describe("tokenizeCql", () => {
  it("classifies a simple attribute clause", () => {
    expect(kinds('[upos="VERB"]')).toEqual([
      "bracket:[", 'attr:upos', "op:=", 'string:"VERB"', "bracket:]",
    ]);
  });

  it("round-trips the whole source (concatenation is lossless)", () => {
    const src = '[lemma="être"]{1,2}[upos="NOUN"] within s';
    expect(tokenizeCql(src).map((t) => t.text).join("")).toBe(src);
  });

  it("recognises quantifiers, wildcard, within and the %c flag", () => {
    expect(kinds('[]{2,3} within')).toEqual([
      "bracket:[", "bracket:]", "quant:{2,3}", "plain: ", "keyword:within",
    ]);
    expect(kinds('[word="le"%c]')).toEqual([
      "bracket:[", "attr:word", "op:=", 'string:"le"', "flag:%c", "bracket:]",
    ]);
  });

  it("does not mistake upos/xpos for the pos attribute", () => {
    expect(tokenizeCql("upos xpos pos").filter((t) => t.kind === "attr").map((t) => t.text))
      .toEqual(["upos", "xpos", "pos"]);
  });

  it("tolerates an unclosed string while typing", () => {
    expect(kinds('[lemma="ch')).toEqual(["bracket:[", "attr:lemma", "op:=", 'string:"ch']);
  });

  it("treats a malformed quantifier as plain text", () => {
    // '{a}' is not digits/commas → not a quant
    expect(tokenizeCql("{a}").every((t) => t.kind === "plain" || t.kind === "bracket")).toBe(true);
    expect(tokenizeCql("{a}").map((t) => t.text).join("")).toBe("{a}");
  });
});

describe("cqlTokensToHtml", () => {
  it("escapes HTML and wraps typed tokens in cqlhl-* spans", () => {
    const html = cqlToHtml('[word="a<b"]');
    expect(html).toContain('<span class="cqlhl-bracket">[</span>');
    expect(html).toContain('<span class="cqlhl-attr">word</span>');
    expect(html).toContain("a&lt;b"); // escaped inside the string span
    expect(html).not.toContain("a<b");
  });

  it("renders plain text without a span", () => {
    expect(cqlTokensToHtml([{ text: "  ", kind: "plain" }])).toBe("  ");
  });
});
