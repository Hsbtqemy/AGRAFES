/**
 * anchorWarn.ts — pure builders for the upstream-anchoring warning (chantier 1,
 * DESIGN_upstream_anchoring §4/§5). Reads the matrix payload's `anchor_status`
 * (1.6.59, ∥ `languages`, index 0 = hub) and turns each UNANCHORED document into a
 * non-blocking notice: « ce texte n'est ancré par rien → l'alignement dérivera »,
 * with the remedy oriented by shape (§5 — a blob is extracted, a multi-line text is
 * numbered/regrouped). No DOM, no side effects: the view injects the HTML via the
 * safe `setHtml(raw(...))` sink and wires the gate's two buttons.
 *
 * The warning is advisory (D-U1): it never blocks the run — « Aligner quand même »
 * proceeds. Its whole point is that the user anchors FIRST instead of hand-repairing
 * a drifted matrix cell by cell downstream.
 */

import { escHtml as _esc } from "./diff.ts";
import type { AlignMatrix, AnchorStatus } from "./sidecarClient.ts";

export interface AnchorWarning {
  /** Language label of the unanchored document. */
  lang: string;
  /** The hub (index 0) drifts EVERY column — worded and prioritised differently. */
  isHub: boolean;
  /** Number of line units — 1 ⇒ blob (extract), > 1 ⇒ multi-line (number/regroup). */
  lineCount: number;
  /** The oriented remedy hint (§5). */
  remedy: string;
}

/** The remedy for an unanchored document, chosen by shape (§5). Pure. */
export function anchorRemedy(lineCount: number): string {
  if (lineCount <= 1) {
    // blob / copié-collé mono-unité → extraction 2-grain (R2.3, chantier 2)
    return "texte en un seul bloc — le ré-importer découpé (paragraphes ou [N]), ou extraire ses paragraphes";
  }
  // multi-lignes sans ancre → ré-import numéroté, ou regroupement par frontière (R5.4c)
  return "ni numéros [N] ni paragraphes — ré-importer numéroté, ou regrouper les lignes par une frontière (couche Segmentation)";
}

/**
 * The unanchored documents of a loaded matrix (§4). Empty ⇒ nothing to warn. Reads the
 * additive `anchor_status`: on an older sidecar (< 1.6.59) it is absent → no signal, no
 * warning (fail-open — never invent a warning we cannot substantiate). The hub (index 0)
 * is included: an unanchored hub drifts every translation.
 */
export function anchorWarnings(
  matrix: Pick<AlignMatrix, "languages" | "anchor_status">,
): AnchorWarning[] {
  const st = matrix.anchor_status;
  if (!st) return [];
  const out: AnchorWarning[] = [];
  matrix.languages.forEach((lang, i) => {
    const a: AnchorStatus | undefined = st[i];
    if (a && !a.anchored) {
      out.push({ lang, isHub: i === 0, lineCount: a.line_count, remedy: anchorRemedy(a.line_count) });
    }
  });
  return out;
}

/** One warning line (escaped). Hub drift is worded as global. */
function warningLine(w: AnchorWarning): string {
  const who = w.isHub
    ? `Le moyeu <strong>${_esc(w.lang)}</strong>`
    : `<strong>${_esc(w.lang)}</strong>`;
  const drift = w.isHub ? "tout l'alignement dérivera" : "cette colonne dérivera";
  const plural = w.lineCount > 1 ? "s" : "";
  return `<li>${who} n'est ancré par rien (${w.lineCount} ligne${plural}) — ${drift}.`
    + ` <span class="prep-matrix-anchor-remedy">Remède&nbsp;: ${_esc(w.remedy)}.</span></li>`;
}

/** The passive notice (no buttons) shown above the grid on load. Empty string when clean. */
export function buildAnchorNoticeHtml(warnings: AnchorWarning[]): string {
  if (warnings.length === 0) return "";
  return `<div class="prep-matrix-anchor-notice" role="note">`
    + `<span class="prep-matrix-anchor-icon" aria-hidden="true">&#9888;</span>`
    + `<div class="prep-matrix-anchor-body"><strong>Alignement risqué.</strong> `
    + `Un texte sans ancre fait dériver l'aligneur&nbsp;:`
    + `<ul class="prep-matrix-anchor-list">${warnings.map(warningLine).join("")}</ul></div>`
    + `</div>`;
}

/** The gate (notice + « Aligner quand même » / « Annuler ») shown before a risky run. */
export function buildAnchorGateHtml(warnings: AnchorWarning[]): string {
  return `<div class="prep-matrix-anchor-gate" role="group" aria-label="Texte non ancré — alignement risqué">`
    + buildAnchorNoticeHtml(warnings)
    + `<div class="prep-matrix-anchor-actions">`
    + `<button type="button" id="matrix-anchor-proceed" class="btn btn-secondary btn-sm">Aligner quand même</button>`
    + `<button type="button" id="matrix-anchor-cancel" class="btn btn-ghost btn-sm">Annuler</button>`
    + `</div></div>`;
}
