// @vitest-environment happy-dom
/**
 * Test for the extracted UPOS colouring + coloured-prose renderer (R5.2a). Guards the
 * shared piece the canvas annotation layer will reuse: colour mapping, the French
 * spacing rule, the per-unit paragraph structure, and the click hook.
 */
import { describe, it, expect } from "vitest";
import { UPOS_COLORS, uposColor, buildProseColored, type ProseToken } from "../annotationProse.ts";

let nextId = 1;
function tok(word: string, upos: string | null, lemma: string | null = word): ProseToken {
  return { token_id: nextId++, word, upos, lemma };
}

describe("uposColor", () => {
  it("returns the mapped colour for a known tag", () => {
    expect(uposColor("NOUN")).toBe(UPOS_COLORS.NOUN);
  });
  it("returns null for an unknown / absent tag", () => {
    expect(uposColor("ZZZ")).toBeNull();
    expect(uposColor(null)).toBeNull();
    expect(uposColor(undefined)).toBeNull();
  });
});

describe("buildProseColored", () => {
  it("renders one paragraph per unit", () => {
    const el = buildProseColored([[tok("Le", "DET")], [tok("Fin", "NOUN")]]);
    expect(el.className).toBe("annot-prose");
    expect(el.querySelectorAll("p.annot-prose-unit").length).toBe(2);
  });

  it("colours a known UPOS token and leaves an unknown one plain", () => {
    const el = buildProseColored([[tok("chat", "NOUN"), tok("xyz", null)]]);
    const spans = el.querySelectorAll<HTMLElement>(".annot-prose-token");
    expect(spans[0].classList.contains("annot-prose-token--colored")).toBe(true);
    expect(spans[0].style.getPropertyValue("--upos-color")).toBe(UPOS_COLORS.NOUN);
    expect(spans[1].classList.contains("annot-prose-token--colored")).toBe(false);
  });

  it("applies the French spacing rule (space between words, none before ',')", () => {
    const el = buildProseColored([[tok("le", "DET"), tok("chat", "NOUN"), tok(",", "PUNCT")]]);
    // "le chat," — a space node before "chat", none before the comma.
    expect(el.textContent).toBe("le chat,");
  });

  it("sets a title (upos · lemma when lemma differs) and the token id dataset", () => {
    const el = buildProseColored([[tok("mangé", "VERB", "manger")]]);
    const span = el.querySelector<HTMLElement>(".annot-prose-token")!;
    expect(span.title).toBe("VERB · manger");
    expect(span.dataset.tokenId).toBe(String(nextId - 1));
  });

  it("forwards clicks to onTokenClick with the token id", () => {
    const seen: number[] = [];
    const t = tok("clique", "VERB");
    const el = buildProseColored([[t]], { onTokenClick: (id) => seen.push(id) });
    el.querySelector<HTMLElement>(".annot-prose-token")!.click();
    expect(seen).toEqual([t.token_id]);
  });
});
