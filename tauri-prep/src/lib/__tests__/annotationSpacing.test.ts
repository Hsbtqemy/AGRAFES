import { describe, it, expect } from "vitest";
import { needsSpaceBefore, tokensToPlain } from "../annotationSpacing.ts";

const GUILLEMET_OPEN = "«";  // «
const GUILLEMET_CLOSE = "»"; // »

describe("needsSpaceBefore", () => {
  it("inserts a space between two ordinary words", () => {
    expect(needsSpaceBefore("le", "monde")).toBe(true);
  });

  it("suppresses the space before closing punctuation", () => {
    for (const p of [".", ",", ":", ";", "!", "?", ")", "]", "}", GUILLEMET_CLOSE]) {
      expect(needsSpaceBefore("mot", p)).toBe(false);
    }
  });

  it("suppresses the space after opening punctuation", () => {
    for (const p of ["(", "[", "{", GUILLEMET_OPEN]) {
      expect(needsSpaceBefore(p, "mot")).toBe(false);
    }
  });

  it("treats curly apostrophes as no-space on BOTH sides (dual membership)", () => {
    for (const ap of ["’", "‘"]) {
      expect(needsSpaceBefore("mot", ap)).toBe(false); // no space before '
      expect(needsSpaceBefore(ap, "mot")).toBe(false); // no space after  '
    }
  });
});

describe("tokensToPlain", () => {
  const plain = (words: string[]): string => tokensToPlain(words.map(word => ({ word })));

  it("returns an empty string for no tokens", () => {
    expect(tokensToPlain([])).toBe("");
  });

  it("joins ordinary words with single spaces", () => {
    expect(plain(["Bonjour", "le", "monde"])).toBe("Bonjour le monde");
  });

  it("attaches closing punctuation without a leading space", () => {
    expect(plain(["Bonjour", ",", "monde", "."])).toBe("Bonjour, monde.");
  });

  it("attaches a word after opening punctuation without a space", () => {
    expect(plain(["(", "trois", ")"])).toBe("(trois)");
  });

  it("keeps no space inside French guillemets", () => {
    expect(plain([GUILLEMET_OPEN, "citation", GUILLEMET_CLOSE])).toBe(GUILLEMET_OPEN + "citation" + GUILLEMET_CLOSE);
  });

  it("never prefixes the first token with a space", () => {
    expect(plain([",", "x"])).toBe(", x");
  });
});
