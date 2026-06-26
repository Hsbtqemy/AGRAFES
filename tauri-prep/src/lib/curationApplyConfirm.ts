/**
 * curationApplyConfirm.ts — Pure builder for the curation apply-confirm message.
 *
 * Phase 2 of the CurationView decomposition (cf. HANDOFF_PREP § 7 backlog).
 * No DOM, no I/O. Returns the plain-text confirmation message shown in the
 * apply-confirm modal; the caller (CurationView._showCurateApplyConfirm) renders
 * it line-by-line.
 *
 * Invariants protégés par les tests __tests__/curationApplyConfirm.test.ts :
 *   1. Sans review locale (examples vide) → message court "toutes appliquées".
 *   2. Avec review → résumé acceptées/en attente/ignorées ; mention "ne seront
 *      PAS appliquées" uniquement si ignored > 0.
 *   3. Preview tronquée (examples < globalChanged) → bloc d'avertissement
 *      "preview partielle" avec le nombre hors échantillon et les ignorées.
 *   4. Note d'effacement de session : "par document" si scope corpus
 *      (currentDocId undefined), "pour ce document" sinon.
 *   5. Corrections manuelles : ventilation diff vs texte brut selon que le
 *      unit_id provient d'un example override (manual_after non nul) ou non.
 */
import type { CuratePreviewExample } from "./sidecarClient.ts";
import { getStatusCounts } from "./curationCounters.ts";

export interface ApplyConfirmInput {
  /** Human label for the apply scope, e.g. "doc #3" or "tous les documents". */
  label: string;
  /** Unit ids the user marked ignored (excluded from apply). */
  ignoredUnitIds: number[];
  /** Manual overrides being applied (diff-panel edits + raw-text edits). */
  manualOverrides: Array<{ unit_id: number; text: string }>;
  /** Current preview examples (the in-memory review session). */
  examples: CuratePreviewExample[];
  /** Real number of changed units in the document (for truncation detection). */
  globalChanged: number;
  /** Current curation doc id, or undefined for the corpus-wide scope. */
  currentDocId: number | undefined;
}

/**
 * Build the apply-confirmation message (plain text, newline-separated). Pure.
 */
export function buildApplyConfirmMessage(input: ApplyConfirmInput): string {
  const { label, ignoredUnitIds, manualOverrides, examples, globalChanged, currentDocId } = input;
  const hasReview = examples.length > 0;
  const isTruncated = examples.length < globalChanged;
  const counts = hasReview ? getStatusCounts(examples) : null;
  let msg = `Appliquer la curation sur ${label} ?\nCette opération modifie text_norm en base.\n`;
  if (hasReview && counts) {
    msg += `\nRésumé de la session de review :\n  • Acceptées    : ${counts.accepted}\n  • En attente   : ${counts.pending}\n  • Ignorées     : ${counts.ignored}`;
    if (counts.ignored > 0) msg += ` → ne seront PAS appliquées`;
    msg += `\n`;
    if (isTruncated) {
      const unreviewed = globalChanged - examples.length;
      msg += `\n⚠ Attention — preview partielle :\n  ${unreviewed} modification(s) hors échantillon n'ont pas été examinées.\n  Elles seront appliquées normalement (aucun statut local disponible).\n  Seules les ${ignoredUnitIds.length} unités ignorées dans l'échantillon seront exclues.`;
    } else {
      if (counts.ignored > 0) msg += `\nL'application exclura ${counts.ignored} unité(s) ignorée(s).`;
      else msg += `\nToutes les modifications seront appliquées (aucune ignorée).`;
    }
  } else {
    msg += `\nAucune review locale — toutes les modifications seront appliquées.`;
  }
  if (currentDocId === undefined) msg += `\n\n📌 Toutes les sessions de review sauvegardées par document seront effacées après application.`;
  else msg += `\n\n📌 La session de review sauvegardée pour ce document sera effacée après application.`;
  if (manualOverrides.length > 0) {
    const fromExamplesIds = new Set(examples.filter(ex => ex.is_manual_override === true && ex.manual_after != null && ex.unit_id !== undefined).map(ex => ex.unit_id));
    const diffCount = manualOverrides.filter(o => fromExamplesIds.has(o.unit_id)).length;
    const rawCount = manualOverrides.length - diffCount;
    if (rawCount > 0 && diffCount > 0) msg += `\n✏ ${manualOverrides.length} correction(s) manuelle(s) : ${diffCount} via panneau diff, ${rawCount} directement dans le texte.`;
    else if (rawCount > 0) msg += `\n✏ ${rawCount} correction(s) saisie(s) directement dans le panneau texte.`;
    else msg += `\n✏ ${manualOverrides.length} correction(s) manuelle(s) seront appliquées à la place de la proposition automatique.`;
  }
  return msg;
}
