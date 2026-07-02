/**
 * ui/roleStatus.ts — pure helpers to label peritext role + translation status
 * on concordancer hits (refonte R4.3).
 *
 * The concordancer is intentionally decoupled from the role catalogue (which
 * lives in Prep): a hit carries `unit_role` as a raw slug and `unit_status` as
 * an enum. We map the known structure roles / statuses to fixed French labels
 * and fall back to the raw slug for anything custom. No DOM, no I/O — the badge
 * DOM lives in results.ts. Tests: ui/__tests__/roleStatus.test.ts.
 */

// Known structure roles seeded by the importers / marker-lift (R4.2).
const ROLE_LABELS: Record<string, string> = {
  titre: "Titre",
  chapeau: "Chapeau",
  intertitre: "Intertitre",
};
// The unit_status enum (R4.1).
const STATUS_LABELS: Record<string, string> = {
  non_traduit: "non traduit",
  ajout: "ajout",
};
// Status → CSS modifier suffix (avoids emitting a class from an arbitrary value).
const STATUS_MODIFIER: Record<string, string> = {
  non_traduit: "nt",
  ajout: "add",
};

/** Display label for a role slug ("titre" → "Titre"); unknown slug → verbatim. */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Display label for a status enum ("non_traduit" → "non traduit"); unknown → verbatim. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** CSS modifier for a status ("nt"/"add"); "" for unknown values (neutral style). */
export function statusModifier(status: string): string {
  return STATUS_MODIFIER[status] ?? "";
}

export interface RoleStatusBadge {
  kind: "role" | "status";
  /** Raw slug/enum value. */
  value: string;
  /** Human label. */
  label: string;
  /** Tooltip text. */
  title: string;
}

/**
 * Build the badges to show for a unit-like object (hit or aligned unit).
 * Role first, then status. Empty/null fields are skipped, so ordinary units
 * produce no badges at all.
 */
export function unitBadges(u: { unit_role?: string | null; unit_status?: string | null }): RoleStatusBadge[] {
  const out: RoleStatusBadge[] = [];
  if (u.unit_role) {
    out.push({
      kind: "role",
      value: u.unit_role,
      label: roleLabel(u.unit_role),
      title: `Rôle péritextuel : ${roleLabel(u.unit_role)}`,
    });
  }
  if (u.unit_status) {
    out.push({
      kind: "status",
      value: u.unit_status,
      label: statusLabel(u.unit_status),
      title: `Statut de traduction : ${statusLabel(u.unit_status)}`,
    });
  }
  return out;
}
