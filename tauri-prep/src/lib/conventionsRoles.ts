/**
 * conventionsRoles.ts — Pure helpers for the role catalogue of the Roles tab
 * (SegmentationView). Ported from the Shell module conventionsModule.ts.
 *
 * No DOM, no I/O. Tested by __tests__/conventionsRoles.test.ts.
 *
 * Invariants protégés par les tests :
 *   1. STRUCTURE_DEFAULTS : 8 suggestions structurelles, slugs uniques.
 *   2. splitRolesByCategory : category absente → "text" (défaut sidecar).
 *   3. dormantStructureSuggestions : exclut les défauts déjà actifs (par name).
 *   4. validateRoleForm : name + label requis, couleur hex optionnelle validée.
 *   5. isSafeHexColor / safeColor : seuls #RGB..#RRGGBBAA acceptés.
 */
import type { ConventionRole } from "./sidecarClient.ts";

// ─── Structure defaults (dormant suggestions) ────────────────────────────────

export interface StructureSuggestion {
  name: string;
  label: string;
  color: string;
  icon: string;
  sort_order: number;
}

export const STRUCTURE_DEFAULTS: StructureSuggestion[] = [
  { name: "titre",      label: "Titre",      color: "#1e40af", icon: "◈",  sort_order: 0 },
  { name: "intertitre", label: "Intertitre", color: "#9333ea", icon: "§",  sort_order: 1 },
  { name: "dedicace",   label: "Dédicace",   color: "#be185d", icon: "✦",  sort_order: 2 },
  { name: "epigraphe",  label: "Épigraphe",  color: "#0369a1", icon: "❝",  sort_order: 3 },
  { name: "incipit",    label: "Incipit",    color: "#047857", icon: "↳",  sort_order: 4 },
  { name: "colophon",   label: "Colophon",   color: "#92400e", icon: "⌛", sort_order: 5 },
  { name: "preface",    label: "Préface",    color: "#374151", icon: "»",  sort_order: 6 },
  { name: "note",       label: "Note",       color: "#b45309", icon: "†",  sort_order: 7 },
];

// ─── Catalogue partitioning ──────────────────────────────────────────────────

export interface SplitRoles {
  structure: ConventionRole[];
  text: ConventionRole[];
}

/**
 * Names of the roles the catalogue declares structural — the front mirror of the
 * engine's `coarse_grain.structural_roles_for(conn)`. Pass it to `deriveCoarseBlocks`
 * (or any section-wall test) so a *custom* structural role counts and a role the user
 * moved out of the category stops counting.
 *
 * Returns an empty set when the catalogue is empty — including when it has simply not
 * loaded yet, which the caller cannot distinguish. Callers must therefore keep the
 * module default as a fallback on an empty catalogue: a corpus with no role at all has
 * no unit carrying one, so falling back is inert there and correct while loading.
 */
export function structuralRoleNames(roles: ConventionRole[]): ReadonlySet<string> {
  return new Set(
    roles.filter((r) => (r.category ?? "text") === "structure").map((r) => r.name),
  );
}

/**
 * Partition the role catalogue into the "structure" and "text" sections.
 * A role with no category is treated as "text" (sidecar default).
 */
/**
 * The structural set to actually use: the catalogue when it declares one, the caller's
 * fallback otherwise. An empty catalogue means either "not loaded yet" or "no role
 * defined" — indistinguishable here, and the fallback is right in both cases (no role
 * defined ⇒ no unit carries one ⇒ the fallback never fires).
 */
export function structuralRoleNamesOr(
  roles: ConventionRole[],
  fallback: ReadonlySet<string>,
): ReadonlySet<string> {
  const catalogue = structuralRoleNames(roles);
  return catalogue.size > 0 ? catalogue : fallback;
}

export function splitRolesByCategory(roles: ConventionRole[]): SplitRoles {
  const structure: ConventionRole[] = [];
  const text: ConventionRole[] = [];
  for (const r of roles) {
    if ((r.category ?? "text") === "structure") structure.push(r);
    else text.push(r);
  }
  return { structure, text };
}

/**
 * Structure defaults not yet present in the active catalogue (by name).
 * These render as dormant suggestion rows the user can activate.
 */
export function dormantStructureSuggestions(roles: ConventionRole[]): StructureSuggestion[] {
  const activeNames = structuralRoleNames(roles);
  return STRUCTURE_DEFAULTS.filter((s) => !activeNames.has(s.name));
}

// ─── Colour validation ───────────────────────────────────────────────────────

/** True if the value is a CSS hex colour (#RGB, #RRGGBB or #RRGGBBAA). */
export function isSafeHexColor(color: string | null | undefined): boolean {
  return !!color && /^#[0-9a-fA-F]{3,8}$/.test(color);
}

/** Returns the colour if it is a safe hex value, otherwise the fallback. */
export function safeColor(color: string | null | undefined, fallback = "#475569"): string {
  return isSafeHexColor(color) ? (color as string) : fallback;
}

// ─── Role form validation ────────────────────────────────────────────────────

export interface RoleFormInput {
  name: string;
  label: string;
  color?: string | null;
  icon?: string | null;
  sort_order?: number;
}

export interface RoleFormValidation {
  ok: boolean;
  /** First error message (French, user-facing), or null when ok. */
  error: string | null;
}

/**
 * Validate the role create/edit form. Pure — mirrors the legacy dialog checks:
 *   - name required (slug, immutable once created),
 *   - label required,
 *   - color optional but, when present, must be a valid hex value.
 */
export function validateRoleForm(input: RoleFormInput): RoleFormValidation {
  const name = (input.name ?? "").trim();
  const label = (input.label ?? "").trim();
  if (!name) return { ok: false, error: "L'identifiant est requis." };
  if (!label) return { ok: false, error: "Le libellé est requis." };
  const color = (input.color ?? "").trim();
  if (color && !isSafeHexColor(color)) {
    return { ok: false, error: "La couleur doit être un code hexadécimal (ex. #3b82f6)." };
  }
  return { ok: true, error: null };
}
