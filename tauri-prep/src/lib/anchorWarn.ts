/**
 * anchorWarn.ts — pure builders for the upstream-anchoring warning (chantier 1,
 * DESIGN_upstream_anchoring §4/§5). Reads the matrix payload's `anchor_status`
 * (1.6.59, ∥ `languages`, index 0 = hub) and turns each at-risk document into a
 * non-blocking notice, with the remedy oriented by shape (§5).
 *
 * M1 (revue 2026-07-17) — the warning is STRATEGY-AWARE. `anchored` alone is not enough:
 * the default `length_bounded` (and `similarity`) recalibrate the aligner ONLY on
 * `parent_n` (the ¶ tier), never on `external_id`. So a `value`/`position` anchor gives
 * FALSE reassurance under those strategies — two `docx_paragraphs` of 10 vs 12 ¶ (position,
 * no parent_n) would align by Gale–Church on mismatched block counts and drift, silently.
 * The « identity » strategies (`external_id*`, `position`) DO consume `[N]`/position, so the
 * anchor genuinely protects there. The filet reflects that split.
 *
 * The warning is advisory (D-U1): it never blocks the run — « Aligner quand même » proceeds.
 * No DOM, no side effects: the view injects the HTML via `setHtml(raw(...))` and wires the gate.
 */

import { escHtml as _esc } from "./diff.ts";
import type { AlignMatrix, AnchorStatus } from "./sidecarClient.ts";
import type { AlignStrategy } from "./alignRunBar.ts";

/**
 * Why a column is flagged (M1):
 * - `unanchored` — the document carries NO anchor at all (`kind: null`): it drifts under
 *   every strategy.
 * - `unused-anchor` — it carries a `[N]`/position anchor that the chosen length/similarity
 *   strategy does not exploit, and it is not ¶-paired nor parallel to the hub: false
 *   reassurance, likely drift.
 */
export type AnchorReason = "unanchored" | "unused-anchor";

export interface AnchorWarning {
  /** Language label of the flagged document. */
  lang: string;
  /** The hub (index 0) drifts EVERY column — worded and prioritised differently. */
  isHub: boolean;
  /** Anchor kind of the flagged doc (null for `unanchored`). */
  kind: AnchorStatus["kind"];
  /** Number of line units — orients the `unanchored` remedy (0 / 1 / n). */
  lineCount: number;
  /** Why it is flagged. */
  reason: AnchorReason;
  /** The oriented remedy hint. */
  remedy: string;
}

/**
 * Strategies whose drift the aligner bounds only via `parent_n` (the ¶ tier); a `[N]`/
 * position anchor is NOT consumed, so it does not protect. The « identity » strategies
 * (`external_id`, `external_id_then_position`, `position`) consume `[N]`/position instead,
 * so an anchored doc is genuinely safe there — only a truly unanchored one is flagged.
 */
const LENGTH_CAMP: ReadonlySet<AlignStrategy> = new Set<AlignStrategy>([
  "length_bounded",
  "similarity",
]);

/** The remedy for an UNANCHORED document, chosen by shape (§5). Pure. */
export function anchorRemedy(lineCount: number): string {
  if (lineCount === 0) {
    // 0 ligne = 100 % structure : ni blob, ni multi-lignes — le remède « extraire » (m2/m3)
    // n'a aucune cible ; il faut d'abord produire des unités-ligne.
    return "aucune ligne alignable — le document ne porte que de la structure : le ré-importer / re-segmenter pour produire des lignes";
  }
  if (lineCount <= 1) {
    // blob mono-unité. « extraire ses paragraphes » (R2.3) n'est PAS construit (m3) — on ne
    // propose que le geste réel : ré-importer découpé.
    return "texte en un seul bloc — le ré-importer découpé (paragraphes ou [N])";
  }
  return "ni numéros [N] ni paragraphes — ré-importer numéroté, ou regrouper les lignes par une frontière (couche Segmentation)";
}

/** The remedy for a `[N]`/position anchor unused by the chosen length strategy (M1). */
function unusedAnchorRemedy(kind: AnchorStatus["kind"]): string {
  if (kind === "value") {
    return "choisis « Avancé → external_id » (exact pour les [N]), ou regroupe les deux textes en paragraphes";
  }
  return "regroupe les deux textes en paragraphes (couche Segmentation), ou vérifie qu'ils ont le même nombre de segments";
}

/**
 * The at-risk documents of a loaded matrix, given the strategy about to run (§4, M1). Empty
 * ⇒ nothing to warn. Reads the additive `anchor_status`: on an older sidecar (< 1.6.59) it is
 * absent → no signal, no warning (fail-open). The hub (index 0) is included.
 */
export function anchorWarnings(
  matrix: Pick<AlignMatrix, "languages" | "anchor_status">,
  strategy: AlignStrategy,
): AnchorWarning[] {
  const st = matrix.anchor_status;
  if (!st) return [];
  const hub = st[0];
  const lengthCamp = LENGTH_CAMP.has(strategy);
  const out: AnchorWarning[] = [];
  matrix.languages.forEach((lang, i) => {
    const a: AnchorStatus | undefined = st[i];
    if (!a) return;
    const isHub = i === 0;
    let reason: AnchorReason | null = null;
    if (!a.anchored) {
      reason = "unanchored";
    } else if (lengthCamp && !isHub && hub && hub.anchored) {
      // The doc IS anchored, but under length/similarity only a ¶ pairing (or an equal
      // segment count = parallel) bounds the drift; a [N]/position anchor is not consumed.
      // If the hub itself is unanchored, its own strong warning already covers the drift —
      // don't pile a redundant per-column notice on top.
      const paired = hub.kind === "paragraph" && a.kind === "paragraph";
      // « comptes de segments égaux ⇒ positionnellement parallèle » ne vaut QUE pour une ancre
      // positionnelle (position/paragraph). Une ancre `value` ([N]) est par définition NON
      // positionnelle (les marqueurs s'apparient « quel que soit l'ordre », §2) : des [N]
      // décalés à comptes égaux dérivent sous « longueur » (qui ignore external_id) — revue
      // du fix M1, risque 1. Ne jamais laisser un compte égal taire une ancre value.
      const parallel = hub.line_count === a.line_count
        && a.kind !== "value" && hub.kind !== "value";
      if (!paired && !parallel) reason = "unused-anchor";
    }
    if (reason) {
      out.push({
        lang, isHub, kind: a.kind, lineCount: a.line_count, reason,
        remedy: reason === "unanchored" ? anchorRemedy(a.line_count) : unusedAnchorRemedy(a.kind),
      });
    }
  });
  return out;
}

/** One warning line (escaped), worded by reason. */
function warningLine(w: AnchorWarning): string {
  const who = w.isHub
    ? `Le moyeu <strong>${_esc(w.lang)}</strong>`
    : `<strong>${_esc(w.lang)}</strong>`;
  const plural = w.lineCount > 1 ? "s" : "";
  if (w.reason === "unused-anchor") {
    const by = w.kind === "value" ? "des numéros [N]" : "la position";
    return `<li>${who} est ancré par ${by}, mais l'alignement « longueur » ne l'exploite pas`
      + ` (${w.lineCount} segment${plural}) — dérive possible.`
      + ` <span class="prep-matrix-anchor-remedy">Remède&nbsp;: ${_esc(w.remedy)}.</span></li>`;
  }
  const drift = w.isHub ? "tout l'alignement dérivera" : "cette colonne dérivera";
  return `<li>${who} n'est ancré par rien (${w.lineCount} ligne${plural}) — ${drift}.`
    + ` <span class="prep-matrix-anchor-remedy">Remède&nbsp;: ${_esc(w.remedy)}.</span></li>`;
}

/** The passive notice (no buttons) shown above the grid on load. Empty string when clean. */
export function buildAnchorNoticeHtml(warnings: AnchorWarning[]): string {
  if (warnings.length === 0) return "";
  return `<div class="prep-matrix-anchor-notice" role="note">`
    + `<span class="prep-matrix-anchor-icon" aria-hidden="true">&#9888;</span>`
    + `<div class="prep-matrix-anchor-body"><strong>Alignement risqué.</strong> `
    + `Selon la stratégie choisie, certains textes ne sont pas protégés de la dérive&nbsp;:`
    + `<ul class="prep-matrix-anchor-list">${warnings.map(warningLine).join("")}</ul></div>`
    + `</div>`;
}

/** The gate (notice + « Aligner quand même » / « Annuler ») shown before a risky run. */
export function buildAnchorGateHtml(warnings: AnchorWarning[]): string {
  return `<div class="prep-matrix-anchor-gate" role="group" aria-label="Alignement risqué — ancrage">`
    + buildAnchorNoticeHtml(warnings)
    + `<div class="prep-matrix-anchor-actions">`
    + `<button type="button" id="matrix-anchor-proceed" class="btn btn-secondary btn-sm">Aligner quand même</button>`
    + `<button type="button" id="matrix-anchor-cancel" class="btn btn-ghost btn-sm">Annuler</button>`
    + `</div></div>`;
}
