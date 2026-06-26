/**
 * curationApplyInputs.ts — Pure collectors for the curation apply inputs.
 *
 * Phase 2 of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM, no I/O. Compute, from the in-memory review session, the two inputs
 * the apply flow needs: the ignored unit ids (excluded) and the effective
 * manual overrides (diff-panel edits + raw-text edits, deduplicated).
 *
 * Invariants protégés par les tests __tests__/curationApplyInputs.test.ts :
 *   1. collectIgnoredUnitIds garde uniquement les examples status="ignored".
 *   2. collectManualOverrides retient les examples avec is_manual_override===true
 *      ET manual_after non nul ET unit_id défini, en utilisant manual_after.
 *   3. Les overrides bruts (allOverrides) sont ajoutés SAUF si leur unit_id est
 *      déjà couvert par un override d'example (dédup sample ↔ raw).
 *   4. Ordre : les overrides d'examples d'abord, puis les bruts non couverts.
 */
import type { CuratePreviewExample } from "./sidecarClient.ts";

/** Unit ids the user marked ignored (excluded at apply time). Pure. */
export function collectIgnoredUnitIds(examples: CuratePreviewExample[]): number[] {
  return examples.filter(ex => ex.status === "ignored").map(ex => ex.unit_id);
}

/**
 * Effective manual overrides: diff-panel edits (from examples) plus raw-text
 * edits (from allOverrides) that aren't already covered by a sample override.
 * Pure.
 *
 * @param examples      Preview examples (source of diff-panel overrides).
 * @param allOverrides  Raw-text overrides keyed by unit_id.
 */
export function collectManualOverrides(
  examples: CuratePreviewExample[],
  allOverrides: Map<number, string>,
): Array<{ unit_id: number; text: string }> {
  const fromExamples = examples
    .filter(ex => ex.is_manual_override === true && ex.manual_after != null && ex.unit_id !== undefined)
    .map(ex => ({ unit_id: ex.unit_id, text: ex.manual_after! }));
  const sampleIds = new Set(fromExamples.map(o => o.unit_id));
  const fromRaw: Array<{ unit_id: number; text: string }> = [];
  allOverrides.forEach((text, uid) => { if (!sampleIds.has(uid)) fromRaw.push({ unit_id: uid, text }); });
  return [...fromExamples, ...fromRaw];
}
