/**
 * prepNextStep.ts — Pure helper for the « étape suivante » contextual banner.
 *
 * HANDOFF_PREP friction Tier A #3 : « Pas de feedback étape suivante entre les
 * écrans. L'utilisateur termine sa curation, puis ne sait pas s'il doit aller
 * à Aligner, à Métadonnées, ou à Reindex FTS. »
 *
 * Invariants protégés
 *  1. Le pipeline n'est PAS linéaire ni bloquant (HANDOFF §3 « aucun ordre
 *     n'est bloquant »). Ce helper *suggère*, il ne contraint rien.
 *  2. Toujours au moins une suggestion ; la première est `primary`.
 *  3. Pas de DOM, pas d'IO — calcul pur, testable Vitest.
 *  4. La suggestion dépend de l'état réel observé (index périmé, présence de
 *     traductions) et non d'un ordre figé arbitraire.
 */

/** Cible de navigation d'une suggestion d'étape suivante. */
export type PrepNavTarget =
  | "segmentation"
  | "curation"
  | "alignement"
  | "annoter"
  | "reindex"
  | "export";

/** Action de pipeline qui vient de se terminer avec succès. */
export type PrepCompletedAction =
  | "curation_apply"
  | "segment_validate"
  | "align_run";

export interface NextStepInput {
  /** L'action qui vient de réussir. */
  completed: PrepCompletedAction;
  /** L'index FTS est devenu périmé suite à l'action (curation modifie text_norm). */
  ftsStale?: boolean;
  /** Le document courant participe à une famille (traduction / extrait). */
  hasRelations?: boolean;
}

export interface NextStepSuggestion {
  target: PrepNavTarget;
  /** Libellé du bouton, ex. « Aller à l'Alignement → ». */
  buttonLabel: string;
  /** true = action principale (mise en avant), false = secondaire. */
  primary: boolean;
}

export interface NextStepResult {
  /** Titre du bandeau, ex. « Curation appliquée — et ensuite ? ». */
  headline: string;
  /** Suggestions ordonnées ; la première est toujours `primary`. */
  suggestions: NextStepSuggestion[];
}

const BUTTON_LABELS: Record<PrepNavTarget, string> = {
  segmentation: "Aller à la Segmentation →",
  curation: "Aller à la Curation →",
  alignement: "Aller à l'Alignement →",
  annoter: "Aller à l'Annotation →",
  reindex: "Mettre à jour l'index FTS",
  export: "Aller à l'Export →",
};

const HEADLINES: Record<PrepCompletedAction, string> = {
  curation_apply: "Curation appliquée — et ensuite ?",
  segment_validate: "Segmentation validée — et ensuite ?",
  align_run: "Alignement terminé — et ensuite ?",
};

/** Construit une suggestion ; la mise en avant `primary` est fixée par le caller. */
function step(target: PrepNavTarget, primary: boolean): NextStepSuggestion {
  return { target, buttonLabel: BUTTON_LABELS[target], primary };
}

/**
 * Calcule les étapes suivantes suggérées après une action de pipeline réussie.
 *
 * Règles (toutes non-bloquantes — pure guidance) :
 *  - curation_apply : si l'index est périmé → réindexer (priorité, sinon le
 *    concordancier sert du texte d'avant curation) ; puis Alignement si le doc
 *    a des traductions (la source a changé, il faut re-vérifier les liens) ;
 *    sinon Export (doc isolé : la chaîne est finie).
 *  - segment_validate : Curation (workflow segment-first, HANDOFF §3) ; +
 *    Alignement en secondaire si le doc a des traductions.
 *  - align_run : Export (les collisions se revoient dans AlignPanel même).
 */
export function computeNextSteps(input: NextStepInput): NextStepResult {
  const suggestions: NextStepSuggestion[] = [];

  if (input.completed === "curation_apply") {
    if (input.ftsStale) suggestions.push(step("reindex", false));
    if (input.hasRelations) suggestions.push(step("alignement", false));
    else suggestions.push(step("export", false));
  } else if (input.completed === "segment_validate") {
    suggestions.push(step("curation", false));
    if (input.hasRelations) suggestions.push(step("alignement", false));
  } else {
    // align_run
    suggestions.push(step("export", false));
  }

  // Invariant 2 : la première suggestion est toujours primary.
  if (suggestions.length > 0) suggestions[0].primary = true;

  return { headline: HEADLINES[input.completed], suggestions };
}
