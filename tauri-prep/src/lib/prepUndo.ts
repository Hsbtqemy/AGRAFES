/**
 * prepUndo.ts — Pure helpers for the Mode A undo button.
 *
 * Backbone : table prep_action_history (cf. migration 019) + snapshots.
 * Documente le format `context_json` par action_type tel qu'écrit côté
 * backend (`src/multicorpus_engine/sidecar.py` + `undo.py`). La docstring
 * SQL de la migration référence ce fichier comme source de vérité.
 *
 * Aucune dépendance DOM ni I/O. Tests Vitest dans
 * `__tests__/prepUndo.test.ts`.
 *
 * Invariants protégés par les tests :
 *   1. formatUndoActionLabel utilise la description backend telle quelle,
 *      préfixée du glyph "↶ ", sans interpoler de variable côté client.
 *   2. formatUndoUnavailableReason a une branche par reason connue, et
 *      retombe sur un message générique pour les codes inconnus (futur-proof).
 *   3. formatUndoTooltip combine label + reason quand non éligible, sinon
 *      label + horodatage relatif court.
 *   4. Les types ActionType / EligibilityReason ne sont pas re-exportés
 *      sous des alias trompeurs ; la liste reflète exactement les valeurs
 *      acceptées par la CHECK constraint de migration 019.
 */

// ─── Constantes alignées sur le backend ────────────────────────────────────

/** action_type values produced by the backend (matches CHECK constraint). */
export const PREP_ACTION_TYPES = [
  "curation_apply",
  "merge_units",
  "split_unit",
  "resegment",
  "undo",
] as const;

export type PrepActionType = (typeof PREP_ACTION_TYPES)[number];

/** Eligibility reasons returned by /prep/undo/eligibility when not eligible. */
export const ELIGIBILITY_REASONS = [
  "no_action",
  "no_snapshots",
  "structural_dependency",
  "unit_diverged",
  "latest_already_reverted",
] as const;

export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

// ─── Shapes (mirror backend payloads) ──────────────────────────────────────

/**
 * Shape of /prep/undo/eligibility response.
 *
 * When `eligible === false`, only `reason` is guaranteed.
 * When `eligible === true`, `action_id`, `action_type`, `description`,
 * `performed_at` are present. `warnings` is an empty array in V1.
 */
export interface UndoEligibility {
  eligible: boolean;
  reason?: string;
  action_id?: number;
  action_type?: PrepActionType;
  description?: string;
  performed_at?: string;
  warnings?: string[];
}

/** Shape of /prep/undo response on success. */
export interface UndoResult {
  undo_action_id: number;
  reverted_action_id: number;
  reverted_action_type: PrepActionType;
  units_restored: number;
  alignments_reflagged: number;
  fts_stale: boolean;
}

/**
 * Shape of context_json per action_type. Documented as the authoritative
 * source — anytime the backend changes a field name, update here too.
 */
export interface CurationApplyContext {
  rules_count: number;
  rules_signature?: string | null;
  scope: "doc" | "all";
  apply_context?: Record<string, unknown>;
}

export interface MergeUnitsContext {
  merged_unit_ids: [number, number];
  kept_unit_id: number;
  deleted_unit_id: number;
  n1: number;
  n2: number;
  kept_external_id_before: number | null;
  deleted_external_id_before: number | null;
}

export interface SplitUnitContext {
  split_unit_id: number;
  split_unit_n: number;
  created_unit_id: number;
  created_unit_n: number;
  external_id_before: number | null;
}

export interface ResegmentContext {
  pack: string;
  lang: string;
  text_start_n: number | null;
  calibrate_to?: number | null;
  units_deleted_after_ids: number[];
  units_created_after_json: { unit_id: number; n: number }[];
  units_before: {
    unit_id: number;
    n: number;
    external_id: number | null;
    text_raw: string | null;
    text_norm: string | null;
    unit_role: string | null;
    meta_json: string | null;
  }[];
}

// ─── Formatting helpers (pure) ─────────────────────────────────────────────

const UNDO_GLYPH = "↶"; // ↶

/**
 * Returns the user-facing label for the Annuler button when `eligibility`
 * is undo-able. The backend's `description` already encodes the action's
 * specifics ("Apply 3 règles · 47 unités modifiées", "Fusion u.42 + u.43",
 * etc.) — we just prefix the undo glyph.
 */
export function formatUndoActionLabel(eligibility: UndoEligibility): string {
  if (!eligibility.eligible || !eligibility.description) {
    return `${UNDO_GLYPH} Annuler`;
  }
  return `${UNDO_GLYPH} Annuler : ${eligibility.description}`;
}

/**
 * Returns the tooltip for the Annuler button.
 * Eligible → "Annuler : <description> · <horodatage>".
 * Not eligible → message expliquant pourquoi (cf. formatUndoUnavailableReason).
 */
export function formatUndoTooltip(eligibility: UndoEligibility): string {
  if (eligibility.eligible) {
    const ts = eligibility.performed_at ? ` · ${eligibility.performed_at}` : "";
    return `${formatUndoActionLabel(eligibility)}${ts}`;
  }
  return formatUndoUnavailableReason(eligibility.reason);
}

/**
 * Branche par reason. Reasons inconnues → message générique (futur-proof).
 */
export function formatUndoUnavailableReason(reason: string | undefined): string {
  switch (reason) {
    case "no_action":
      return "Aucune action récente à annuler.";
    case "no_snapshots":
      return "Action antérieure à la mise à jour : non annulable.";
    case "structural_dependency":
      return "Une action plus récente bloque l'annulation. " +
             "Annule d'abord les actions postérieures.";
    case "unit_diverged":
      return "L'état d'au moins une unité a divergé depuis l'action — " +
             "annulation refusée pour préserver les modifications.";
    case "latest_already_reverted":
      return "La dernière action a déjà été annulée.";
    case undefined:
    case null:
    case "":
      return "Annulation impossible.";
    default:
      return `Annulation impossible (${reason}).`;
  }
}

/**
 * Disabled-state predicate. Wraps `eligible` to centralise the negation
 * (avoids `!elig.eligible` scattered through view code).
 */
export function isUndoDisabled(eligibility: UndoEligibility | null | undefined): boolean {
  return !eligibility || !eligibility.eligible;
}
