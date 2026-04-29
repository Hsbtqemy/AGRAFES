/**
 * curationCounters.ts — Pure helpers for counting editorial states across
 * curation preview examples.
 *
 * Phase 5b of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM manipulation, no I/O.
 *
 * Invariants protégés par les tests __tests__/curationCounters.test.ts :
 *   1. getStatusCounts : status absent ou inconnu → "pending"
 *   2. getStatusCounts : pending + accepted + ignored === total
 *   3. countManualOverrides : truthy check sur is_manual_override (boolean
 *      strict OU undefined → on suit la sémantique JS truthy du legacy)
 *   4. hasAnyManualOverride : équivalent à countManualOverrides > 0 mais
 *      court-circuité (Array.some) — utile pour de gros datasets
 */
import type { CuratePreviewExample } from "./sidecarClient.ts";

export interface StatusCounts {
  pending: number;
  accepted: number;
  ignored: number;
}

/**
 * Count examples by editorial status. Pure.
 *
 * Status absent ou inconnu (non-"accepted"/"ignored") → comptabilisé comme
 * "pending" (préserve le comportement legacy : status === undefined ou status
 * === null compte en pending, et tout autre string non-reconnu aussi).
 */
export function getStatusCounts(examples: CuratePreviewExample[]): StatusCounts {
  let pending = 0, accepted = 0, ignored = 0;
  for (const ex of examples) {
    const s = ex.status ?? "pending";
    if (s === "accepted") accepted++;
    else if (s === "ignored") ignored++;
    else pending++;
  }
  return { pending, accepted, ignored };
}

/**
 * Count examples flagged as manual override. Pure.
 * Truthy check sur is_manual_override (préserve le comportement legacy).
 */
export function countManualOverrides(examples: CuratePreviewExample[]): number {
  return examples.filter((ex) => ex.is_manual_override).length;
}

/**
 * Returns true if at least one example has is_manual_override truthy. Pure.
 * Court-circuité (Array.some) pour éviter le scan complet.
 */
export function hasAnyManualOverride(examples: CuratePreviewExample[]): boolean {
  return examples.some((ex) => ex.is_manual_override);
}
