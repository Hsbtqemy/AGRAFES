/**
 * curationFiltering.ts — Pure helpers for filtering curation preview examples
 * by rule label and editorial status.
 *
 * Phase 5a of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM manipulation, no I/O.
 *
 * Invariants protégés par les tests __tests__/curationFiltering.test.ts :
 *   1. filterExamples : ruleFilter=null passthrough sur la règle
 *   2. filterExamples : ruleFilter=label garde uniquement les ex matchés par
 *      ce label (au moins un matched_rule_ids résolvant à ce label)
 *   3. filterExamples : statusFilter=null passthrough ; sinon strict
 *   4. filterExamples : status absent → traité comme "pending"
 *   5. filterExamples : matched_rule_ids absent → vide (jamais matché)
 *   6. filterExamples : ruleLabels[idx] manquant → résolution à "" (n'égale
 *      donc aucun ruleFilter non-vide)
 *   7. filterExamples : combinaison rule ∩ status (AND)
 *   8. getRuleStats : count = nombre d'exemples DISTINCTS matchés par le label
 *      (un même ex avec deux idx pointant vers le même label compte 1×)
 *   9. getRuleStats : ruleLabels[idx] manquant → fallback "règle N+1"
 *      (différent du fallback "" de filterExamples — préservé du legacy)
 */
import type { CuratePreviewExample } from "./sidecarClient.ts";

export type CurateStatusFilter = "pending" | "accepted" | "ignored" | null;

/**
 * Filter examples by rule label and/or editorial status. Pure.
 *
 * @param examples      Source list (typically all curate examples for a doc)
 * @param ruleFilter    null → pas de filtre règle ; sinon garde les ex dont
 *                      au moins un matched_rule_ids résout à ce label
 * @param statusFilter  null → pas de filtre statut ; sinon strict
 * @param ruleLabels    Mapping idx → label utilisé pour résoudre les
 *                      matched_rule_ids. Slot manquant → "" (jamais matché).
 */
export function filterExamples(
  examples: CuratePreviewExample[],
  ruleFilter: string | null,
  statusFilter: CurateStatusFilter,
  ruleLabels: string[],
): CuratePreviewExample[] {
  return examples.filter((ex) => {
    const ruleOk = !ruleFilter ||
      (ex.matched_rule_ids ?? []).some((idx) => (ruleLabels[idx] ?? "") === ruleFilter);
    const statusOk = !statusFilter || (ex.status ?? "pending") === statusFilter;
    return ruleOk && statusOk;
  });
}

/**
 * Compute occurrence counts per rule label. Pure.
 *
 * Counts each example at most once per label even if matched_rule_ids has
 * multiple indices pointing to the same label (preserves legacy behavior).
 *
 * @param examples    Source list
 * @param ruleLabels  Mapping idx → label. Slot manquant → fallback
 *                    "règle ${idx + 1}" (différent du fallback "" de
 *                    filterExamples — préserve le comportement legacy).
 * @returns           Map<label, count> de la fréquence de chaque règle
 */
export function getRuleStats(
  examples: CuratePreviewExample[],
  ruleLabels: string[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const ex of examples) {
    const seen = new Set<string>();
    for (const idx of (ex.matched_rule_ids ?? [])) {
      const label = ruleLabels[idx] ?? `règle ${idx + 1}`;
      if (!seen.has(label)) {
        seen.add(label);
        map.set(label, (map.get(label) ?? 0) + 1);
      }
    }
  }
  return map;
}
