/**
 * annotationProse.ts — shared UPOS colouring + coloured-prose renderer, extracted from
 * AnnotationView (R5.2a) so the canvas annotation layer and the legacy screen render
 * identically. The colour map feeds both the read-mode prose *and* the interlinear grid
 * UPOS badge; `buildProseColored` is the read-mode prose DOM, verbatim, with the token
 * click wired through a caller-supplied hook (the view decides what a click does).
 */

import { needsSpaceBefore } from "../lib/annotationSpacing.ts";

/** UPOS tag → display colour. Single source shared by prose and interlinear grid. */
export const UPOS_COLORS: Record<string, string> = {
  NOUN: "#4e9af1", VERB: "#e07b39", ADJ: "#8e6bbf",
  ADV: "#3aab6d", PRON: "#c9a227", DET: "#5bb8c4",
  ADP: "#b0b0b0", CCONJ: "#b0b0b0", SCONJ: "#b0b0b0",
  PUNCT: "#cccccc", NUM: "#c94040", PROPN: "#2e7dbf",
  AUX: "#d97ab8", PART: "#b0b0b0", INTJ: "#e04444",
  SYM: "#999", X: "#bbb",
};

/** Colour for a UPOS tag, or null when the tag is unknown / absent. */
export function uposColor(upos: string | null | undefined): string | null {
  return upos && UPOS_COLORS[upos] ? UPOS_COLORS[upos] : null;
}

/** The UPOS tag set (sorted), single source for the token editor's dropdown. */
export const UPOS_TAGS: readonly string[] = Object.keys(UPOS_COLORS).sort();

/** The token fields the coloured-prose renderer needs (structurally compatible with
 *  the fuller AnnotToken). */
export interface ProseToken {
  token_id: number;
  word: string;
  upos: string | null;
  lemma: string | null;
}

export interface ProseOptions {
  /** Called when a token span is clicked (e.g. to switch to the interlinear editor). */
  onTokenClick?: (tokenId: number, token: ProseToken) => void;
}

/**
 * Build the coloured token spans for ONE unit as an inline fragment (no wrapper). The
 * French spacing rule inserts space text-nodes between tokens, UPOS colours are set,
 * and clicks are forwarded to `onTokenClick` if provided. Used both by the block prose
 * renderer below and by the canvas annotation layer, which injects it inline into a
 * unit row (R5.2b).
 */
export function buildProseUnitInline(tokens: ProseToken[], opts: ProseOptions = {}): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const needsSpace = i > 0 && needsSpaceBefore(tokens[i - 1].word, tok.word);
    if (needsSpace) frag.appendChild(document.createTextNode(" "));
    const span = document.createElement("span");
    span.className = "annot-prose-token";
    span.textContent = tok.word;
    span.title = [tok.upos, tok.lemma !== tok.word ? tok.lemma : null].filter(Boolean).join(" · ") || tok.word;
    span.dataset.tokenId = String(tok.token_id);
    const color = uposColor(tok.upos);
    if (color) {
      span.style.setProperty("--upos-color", color);
      span.classList.add("annot-prose-token--colored");
    }
    if (opts.onTokenClick) {
      span.addEventListener("click", (e) => {
        e.stopPropagation(); // a token click opens its editor — don't toggle row selection
        opts.onTokenClick!(tok.token_id, tok);
      });
    }
    frag.appendChild(span);
  }
  return frag;
}

/**
 * Build the `.annot-prose` DOM for a document's tokens. `unitsInOrder` is the tokens
 * grouped by unit (in reading order), each unit already flattened across its sentences.
 * One `<p class="annot-prose-unit">` per unit, each filled by {@link buildProseUnitInline}.
 */
export function buildProseColored(unitsInOrder: ProseToken[][], opts: ProseOptions = {}): HTMLElement {
  const prose = document.createElement("div");
  prose.className = "annot-prose";
  for (const allTokens of unitsInOrder) {
    const para = document.createElement("p");
    para.className = "annot-prose-unit";
    para.appendChild(buildProseUnitInline(allTokens, opts));
    prose.appendChild(para);
  }
  return prose;
}
