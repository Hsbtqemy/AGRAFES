/**
 * curationDiffList.ts — Pure helpers for the curation diff list rendering.
 *
 * Phase 5e of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM manipulation, no I/O, no event handlers. The big DOM construction
 * (table/tbody/tr + click listeners + pagination buttons) stays in
 * CurationView ; this module covers the pure HTML/string fragments.
 *
 * Invariants protégés par les tests __tests__/curationDiffList.test.ts :
 *   1. formatDiffEmptyMessage : ruleFilter prioritaire (escape sur le label)
 *   2. formatDiffEmptyMessage : !ruleFilter && totalChanged===0 → "document propre"
 *   3. formatDiffEmptyMessage : !ruleFilter && totalChanged>0 → "Aucun exemple"
 *   4. formatDiffStatusBadge : status="pending" → "" ; sinon HTML escape sur label
 *   5. formatDiffStatusBadge : icône ✓ pour accepted, ✗ pour ignored
 *   6. formatDiffOverrideBadge : truthy → ✏, sinon ""
 *   7. formatDiffExceptionBadge : ignored prioritaire sur override pour le title
 *   8. formatDiffForcedBadge : "standard" ou null → "" ; sinon classe + title
 *   9. getRuleLabelsForExample : dedup (Set), fallback "r${idx+1}"
 *  10. formatDiffRuleBadges : empty labels → badge "—" unknown ; sinon escape
 *  11. getDiffRowClasses : ["diff-row"] base + status + forced selon l'ex
 *  12. formatDiffPaginationLabel : suffixe "sur N total" si totalChanged > shown
 *  13. formatDiffRowTitle : pluriel selon ruleCount
 */
import type { CuratePreviewExample } from "./sidecarClient.ts";
import { escHtml } from "./diff.ts";

/** Empty-state message HTML inside the diff list panel. Pure. */
export function formatDiffEmptyMessage(
  activeRuleFilter: string | null,
  totalChanged: number,
): string {
  let msg: string;
  if (activeRuleFilter) {
    msg = `Aucune modification pour &#171;&#160;${escHtml(activeRuleFilter)}&#160;&#187; dans cet &#233;chantillon. <button class="prep-btn-inline-link" id="diff-pane-clear-filter">Effacer le filtre</button>`;
  } else if (totalChanged === 0) {
    msg = `&#10003;&#160;Aucune modification &#8212; document propre.`;
  } else {
    msg = `Aucun exemple dans cet &#233;chantillon.`;
  }
  return `<p class="empty-hint" style="padding:8px">${msg}</p>`;
}

/** Status badge ✓/✗ for accepted/ignored ; "" for pending. Pure. */
export function formatDiffStatusBadge(
  status: "pending" | "accepted" | "ignored",
  statusLabel: string,
): string {
  if (status === "pending") return "";
  const icon = status === "accepted" ? "✓" : "✗";
  return `<span class="prep-diff-status-badge prep-diff-status-${status}" title="${escHtml(statusLabel)}">${icon}</span>`;
}

/** Manual override pen badge ; "" if not override. Pure. */
export function formatDiffOverrideBadge(isManualOverride: boolean | undefined): string {
  return isManualOverride
    ? `<span class="prep-diff-override-badge" title="Modifié manuellement">✏</span>`
    : "";
}

/** Exception lock badge ; "" if neither flag set. Ignored has title priority. Pure. */
export function formatDiffExceptionBadge(
  isExceptionIgnored: boolean | undefined,
  isExceptionOverride: boolean | undefined,
): string {
  if (!isExceptionIgnored && !isExceptionOverride) return "";
  const title = isExceptionIgnored
    ? "Exception persistée : ignoré durablement"
    : "Exception persistée : override durable";
  return `<span class="prep-diff-exception-badge" title="${title}">🔒</span>`;
}

/** Forced-open badge ; "" if reason missing or "standard". Pure. */
export function formatDiffForcedBadge(forcedReason: string | null | undefined): string {
  if (!forcedReason || forcedReason === "standard") return "";
  const title = forcedReason === "forced"
    ? "Ouverture ciblée depuis Exceptions"
    : forcedReason === "forced_ignored"
      ? "Ouverture ciblée — neutralisée par exception ignore"
      : "Ouverture ciblée — aucune modification active";
  return `<span class="prep-diff-forced-badge prep-diff-forced-${forcedReason}" title="${title}">↗</span>`;
}

/**
 * Resolve and dedup rule labels for an example. Pure.
 *
 * Fallback "r${idx+1}" pour les indices hors range — identique au comportement
 * legacy (différent de getRuleStats qui utilise "règle ${idx+1}", préservé
 * volontairement par fidélité au code original).
 */
export function getRuleLabelsForExample(
  ex: CuratePreviewExample,
  ruleLabels: string[],
): string[] {
  return [...new Set((ex.matched_rule_ids ?? []).map((idx) => ruleLabels[idx] ?? `r${idx + 1}`))];
}

/** Rule badges cell HTML. "—" unknown badge if labels empty. Pure. */
export function formatDiffRuleBadges(ruleLabels: string[]): string {
  if (ruleLabels.length === 0) {
    return `<span class="prep-diff-rule-badge prep-diff-rule-badge-unknown">—</span>`;
  }
  return ruleLabels.map((l) => `<span class="prep-diff-rule-badge">${escHtml(l)}</span>`).join(" ");
}

/**
 * Compute additional row classes (beyond the base "diff-row"). Pure.
 *
 * @returns Array of classes to apply via classList.add. Does NOT include
 *          "diff-row" itself — caller adds that statically.
 */
export function getDiffRowClasses(ex: CuratePreviewExample): string[] {
  const out: string[] = [];
  const st = ex.status ?? "pending";
  if (st !== "pending") out.push(`diff-${st}`);
  const forced = ex.preview_reason;
  if (forced && forced !== "standard") {
    out.push("diff-forced-row");
    if (forced === "forced_ignored") out.push("diff-forced-ignored");
    if (forced === "forced_no_change") out.push("diff-forced-no-change");
  }
  return out;
}

/** Pagination label text. "Page X / Y (...)". Pure. */
export function formatDiffPaginationLabel(
  page: number,
  totalPages: number,
  examplesShown: number,
  totalChanged: number,
): string {
  const suffix = totalChanged > examplesShown ? ` sur ${totalChanged} total` : "";
  return `Page ${page + 1} / ${totalPages}  (${examplesShown} exemples chargés${suffix})`;
}

/** Row title attribute (singular/plural based on rule count). Pure. */
export function formatDiffRowTitle(ruleCount: number): string {
  return ruleCount > 1
    ? `Modification par ${ruleCount} règles — cliquer pour sélectionner`
    : "Cliquer pour sélectionner cette modification";
}
