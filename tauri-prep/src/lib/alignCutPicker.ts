/**
 * alignCutPicker.ts — pure HTML for the inline "couper" picker (R3.3 §D9, B2).
 *
 * Renders the target text of the CUT PLANE (`target_text` = text_norm since 1.6.69,
 * ALI-01 tranche 2) with a clickable "✂" marker at
 * each cut position (a whitespace word boundary, `cutOffsets`). Each marker carries its
 * **code-point** offset in `data-cut-offset`; clicking one cuts a 2-1 bead there
 * (`buildCutActions`). Pure builder — no DOM, no sidecar; the caller (AlignPanel) wraps
 * it with source labels + a cancel affordance and binds the clicks. Injected via the
 * safe sink `setHtml(raw(...))`.
 */
import { escHtml } from "./diff.ts";
import { cutOffsets } from "./alignBeads.ts";

/**
 * The tokenised target with a cut marker at each candidate boundary. The text is
 * escaped character-by-character; the markers are the only interactive elements.
 */
export function buildCutPickerHtml(targetText: string): string {
  const offsets = new Set(cutOffsets(targetText));
  const cps = Array.from(targetText);
  const parts: string[] = [];
  for (let i = 0; i < cps.length; i++) {
    if (offsets.has(i)) {
      parts.push(
        `<button type="button" class="prep-align-cut-gap" data-cut-offset="${i}"` +
        ` title="Couper ici" aria-label="Couper à la position ${i}">&#9986;</button>`,
      );
    }
    parts.push(escHtml(cps[i]));
  }
  return `<span class="prep-align-cut-text">${parts.join("")}</span>`;
}
