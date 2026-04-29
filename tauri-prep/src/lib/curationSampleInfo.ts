/**
 * curationSampleInfo.ts — Pure helpers for the "X / Y modifications affichées"
 * banner above the curation diff list.
 *
 * Phase 5c of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM manipulation, no I/O.
 *
 * Invariants protégés par les tests __tests__/curationSampleInfo.test.ts :
 *   1. shown=0 → null (banner hidden)
 *   2. changed=0 → null (banner hidden)
 *   3. shown < changed → état "truncated" : className contient
 *      curate-sample-truncated, HTML mentionne previewLimit
 *   4. shown >= changed → état "full" : className contient curate-sample-full,
 *      HTML mentionne "liste complète" (edge case shown > changed traité comme
 *      "full" — préserve le comportement legacy)
 *   5. classNames toujours préfixés par "prep-curate-sample-info"
 */

export interface SampleInfoBanner {
  /** Full className string for the banner element. */
  className: string;
  /** HTML string for innerHTML of the banner. */
  html: string;
}

/**
 * Build the sample info banner state. Pure.
 *
 * Returns null when the banner should be hidden (shown=0 or changed=0).
 * Caller is responsible for the DOM mutation (className + innerHTML or
 * style.display = "none").
 *
 * @param shown         Number of preview examples actually rendered
 * @param changed       Total number of changed units detected by the sidecar
 * @param previewLimit  Cap configured for sidecar preview (typically 5000) —
 *                      mentioned in the truncated banner only
 */
export function buildSampleInfo(
  shown: number,
  changed: number,
  previewLimit: number,
): SampleInfoBanner | null {
  if (changed === 0 || shown === 0) return null;
  if (shown < changed) {
    return {
      className: "prep-curate-sample-info curate-sample-truncated",
      html:
        `&#9432;&#160;<strong>${shown}</strong> modification(s) affich&#233;e(s) sur <strong>${changed}</strong> au total ` +
        `&#8212; <span class="sample-scope-note">preview limit&#233;e &#224; ${previewLimit}&#160;exemples</span>`,
    };
  }
  return {
    className: "prep-curate-sample-info curate-sample-full",
    html:
      `&#10003;&#160;${shown} modification(s) affich&#233;e(s) ` +
      `&#8212; <span class="sample-scope-note">liste compl&#232;te</span>`,
  };
}
