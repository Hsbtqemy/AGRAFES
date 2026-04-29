/**
 * curationDiagPanel.ts — Pure HTML formatters for the curation diagnostics
 * header panel and the changed-units minimap.
 *
 * Phase 5d of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM manipulation, no I/O, no event handlers — caller is responsible for
 * assigning to innerHTML and wiring click/keydown listeners.
 *
 * Invariants protégés par les tests __tests__/curationDiagPanel.test.ts :
 *   1. formatMinimap : total=0 → 0 changed bars (density=0)
 *   2. formatMinimap : changed>=total → density capped 1 → all bars changed
 *   3. formatMinimap : changedBars = Math.round(density * bars)
 *   4. formatMinimap : nombre total de bars = paramètre bars (default 12)
 *   5. formatNoChangesDiag : message standard avec total inséré
 *   6. formatChangesSummary : nombres bruts injectés (pas d'escape — purs nombres)
 *   7. formatTruncationNotice : retourne "" si shown >= totalChanged
 *   8. formatRuleChips : retourne "" si stats vide
 *   9. formatRuleChips : tri descendant par count, escape HTML sur labels
 *  10. formatRuleChips : title du chip mentionne "(dans l'échantillon courant)"
 *      si isTruncated, sinon non
 *  11. formatGotoFirstAction : retourne "" si shown=0
 *  12. formatImpactNotice : statique, toujours le même HTML
 */
import { escHtml } from "./diff.ts";

/**
 * Build the changed-units minimap as a row of bar divs. Pure.
 *
 * Density = changed/total clamped to [0,1] ; converted to bar count via round.
 *
 * @param changed  Number of changed units in the document
 * @param total    Total units in the document (0 → all bars empty)
 * @param bars     Total bars rendered (default 12)
 */
export function formatMinimap(changed: number, total: number, bars: number = 12): string {
  const density = total > 0 ? Math.min(changed / total, 1) : 0;
  const changedBars = Math.round(density * bars);
  return Array.from({ length: bars }, (_, i) =>
    `<div class="prep-mm${i < changedBars ? " changed" : ""}"></div>`,
  ).join("");
}

/** "✓ Aucune modification" diag block. Pure. */
export function formatNoChangesDiag(total: number): string {
  return `<div class="prep-curate-diag"><strong>✓ Aucune modification</strong>${total} unités analysées, corpus propre.</div>`;
}

/**
 * "X unité(s) modifiée(s)" summary header. Pure.
 *
 * Uses the legacy entity encoding (`&#233;`, `&#160;`, etc.) for consistency
 * with the rest of CurationView output.
 */
export function formatChangesSummary(changed: number, total: number, replacements: number): string {
  return `<div class="prep-curate-diag warn curate-diag-summary"><strong>${changed} unit&#233;(s) modifi&#233;e(s)</strong>${replacements} remplacement(s) sur ${total} unit&#233;s.</div>`;
}

/**
 * Truncation banner — shown only when shown < totalChanged.
 * Returns empty string otherwise. Pure.
 */
export function formatTruncationNotice(shown: number, totalChanged: number): string {
  if (shown >= totalChanged) return "";
  return `<div class="prep-curate-diag curate-diag-notice">&#9432;&#160;Preview limit&#233;e &#224; ${shown}&#160;exemples sur&#160;${totalChanged} modifications r&#233;elles. Les compteurs par r&#232;gle ci-dessous concernent uniquement l&#8217;&#233;chantillon affich&#233;.</div>`;
}

/**
 * Rule filter chips block. Pure.
 *
 * Renders a clickable chip per rule, sorted by count descending. The caller
 * is responsible for attaching click/keydown listeners by querying for
 * `.prep-curate-diag-rule-chip[data-rule-label]`.
 *
 * Returns empty string when ruleStats is empty.
 *
 * @param ruleStats     Map<label, count> from getRuleStats
 * @param isTruncated   Si true, ajoute un scope-note précisant que les
 *                      counts portent sur l'échantillon courant
 */
export function formatRuleChips(ruleStats: Map<string, number>, isTruncated: boolean): string {
  if (ruleStats.size === 0) return "";
  const scopeNote = isTruncated ? `<span class="prep-diag-scope-note">dans l&#8217;&#233;chantillon courant</span>` : "";
  const chipsInner = [...ruleStats.entries()].sort((a, b) => b[1] - a[1])
    .map(([label, count]) =>
      `<span class="chip prep-curate-diag-rule-chip" data-rule-label="${escHtml(label)}" role="button" tabindex="0"` +
      ` title="Filtrer sur : ${escHtml(label)}${isTruncated ? " (dans l’échantillon courant)" : ""}"` +
      `>${escHtml(label)}<span class="prep-diag-rule-count">${count}</span></span>`,
    ).join("");
  return `<div class="prep-curate-diag curate-diag-rules"><strong>Filtrer par r&#232;gle</strong>${scopeNote}<div class="prep-chip-row prep-diag-rule-chips" style="margin-top:5px">${chipsInner}</div></div>`;
}

/**
 * "→ Première modification" goto button. Pure.
 * Returns empty string when shown=0. Caller wires the click handler on
 * `#act-diag-goto-first`.
 */
export function formatGotoFirstAction(shown: number): string {
  if (shown <= 0) return "";
  return `<div class="prep-curate-diag curate-diag-action" id="act-diag-goto-first" role="button" tabindex="0"><strong>&#8594; Premi&#232;re modification</strong><span style="font-size:11px;color:var(--prep-muted)">${shown} exemple(s) &#8212; cliquer pour naviguer</span></div>`;
}

/** Static "Impact segmentation" notice. Pure. */
export function formatImpactNotice(): string {
  return `<div class="prep-curate-diag"><strong>Impact segmentation</strong>V&#233;rifiez la preview avant d&#8217;appliquer.</div>`;
}
