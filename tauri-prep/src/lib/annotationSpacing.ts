/**
 * annotationSpacing.ts - French-spacing rule for reconstructing text from
 * annotated tokens, extracted from AnnotationView (U-02). needsSpaceBefore is the
 * single source of the rule, now shared by tokensToPlain AND the read-mode prose
 * renderer (which previously inlined a copy). The punctuation Sets moved
 * byte-identical (« » ' ' guillemets/quotes).
 */

export const PUNCT_NO_SPACE_BEFORE = new Set([".", ",", ":", ";", "!", "?", ")", "]", "}", "\u00bb", "\u2019", "\u2018"]);
export const PUNCT_NO_SPACE_AFTER  = new Set(["(", "[", "{", "\u00ab", "\u2018", "\u2019"]);

/** Does `word` need a leading space after `prevWord`? (no space before closing
 *  punctuation, no space after opening punctuation). */
export function needsSpaceBefore(prevWord: string, word: string): boolean {
  return !PUNCT_NO_SPACE_BEFORE.has(word) && !PUNCT_NO_SPACE_AFTER.has(prevWord);
}

/** Reconstruct plain text from tokens, applying the French spacing rule. */
export function tokensToPlain(tokens: { word: string }[]): string {
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i].word;
    out += (i > 0 && needsSpaceBefore(tokens[i - 1].word, word) ? " " : "") + word;
  }
  return out;
}
