/**
 * conventionsUnitList.ts — Pure helpers for the unit list of the Roles tab
 * (SegmentationView): textual search of candidate units, paratext flagging,
 * role badge resolution and summary counters.
 *
 * No DOM, no I/O. Tested by __tests__/conventionsUnitList.test.ts.
 *
 * Invariants protégés par les tests :
 *   1. foldText : insensible casse + accents ("Épître" ~ "epitre").
 *   2. filterUnits : query vide → liste inchangée ; sinon sous-correspondance
 *      sur text_norm repliée.
 *   3. isParatext : true ssi text_start_n défini ET n < text_start_n.
 *   4. resolveRoleBadge : rôle inconnu → null ; rôle connu → label/color/icon.
 *   5. summarizeUnits : compteurs total / withRole / matched cohérents.
 */
import type { ConventionRole, UnitRecord } from "./sidecarClient.ts";

// ─── Text folding (case + accent insensitive) ────────────────────────────────

/**
 * Fold a string for accent/case-insensitive comparison: lowercase + strip
 * combining diacritics via NFD normalisation. Pure.
 */
export function foldText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// ─── Search / filtering ──────────────────────────────────────────────────────

/**
 * Filter units of the current document by a textual query against text_norm.
 * Query is matched accent/case-insensitively. An empty/blank query returns the
 * input list unchanged (same reference semantics not guaranteed — a new array
 * may be returned). Pure.
 */
export function filterUnits(units: UnitRecord[], query: string): UnitRecord[] {
  const q = foldText(query.trim());
  if (!q) return units;
  return units.filter((u) => foldText(u.text_norm).includes(q));
}

// ─── Paratext boundary ───────────────────────────────────────────────────────

/**
 * True if the unit sits before the paratext/text boundary (text_start_n).
 * No boundary defined (null/undefined) → never paratext. Pure.
 */
export function isParatext(unitN: number, textStartN: number | null | undefined): boolean {
  return textStartN != null && unitN < textStartN;
}

// ─── Role badge resolution ───────────────────────────────────────────────────

export interface RoleBadge {
  label: string;
  color: string;
  icon: string | null;
}

/**
 * Resolve the badge for a unit's role against the catalogue.
 * Returns null when the unit has no role or the role is unknown. Pure.
 */
export function resolveRoleBadge(
  roleName: string | null | undefined,
  roles: ConventionRole[],
): RoleBadge | null {
  if (!roleName) return null;
  const role = roles.find((r) => r.name === roleName);
  if (!role) return null;
  return {
    label: role.label,
    color: role.color ?? "#374151",
    icon: role.icon ?? null,
  };
}

// ─── Summary counters ────────────────────────────────────────────────────────

export interface UnitListSummary {
  /** Total units in the current document. */
  total: number;
  /** Units that have a (non-null) role assigned. */
  withRole: number;
  /** Units kept after applying the current search filter. */
  matched: number;
}

/**
 * Compute the summary counters shown in the Roles toolbar ("N/M unités").
 * `filtered` is the result of filterUnits(units, query). Pure.
 */
export function summarizeUnits(units: UnitRecord[], filtered: UnitRecord[]): UnitListSummary {
  return {
    total: units.length,
    withRole: units.filter((u) => !!u.unit_role).length,
    matched: filtered.length,
  };
}
