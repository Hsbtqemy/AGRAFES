/**
 * markerLift.ts — pure helpers for the R4.2 marker-lift preview (RolesPane).
 *
 * The DOM/overlay + sidecar calls live in components/RolesPane.ts; this module
 * holds only the pure transforms (labels, summary line, conflict messages,
 * preview rows) so they can be unit-tested without a DOM. See
 * docs/DESIGN_R4_2_marker_lift.md and lib/sidecarClient.ts (liftMarkers).
 *
 * No DOM, no I/O. Tests: lib/__tests__/markerLift.test.ts.
 */

import type { LiftMarkersReport } from "./sidecarClient.ts";

// Human labels — mirror the allowlist of marker_lift.py (data-backed table §6).
const ROLE_LABELS: Record<string, string> = {
  titre: "Titre",
  chapeau: "Chapeau",
  intertitre: "Intertitre",
};
const STATUS_LABELS: Record<string, string> = {
  non_traduit: "non traduit",
  ajout: "ajout",
};

/** Display label for a unit_role value ("titre" → "Titre"); unknown → verbatim. */
export function liftRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Display label for a unit_status value ("non_traduit" → "non traduit"); unknown → verbatim. */
export function liftStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** French count with singular/plural forms. 0 and 1 take the singular. */
function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n > 1 ? plural_ : singular}`;
}

/** Is there anything for the apply to do? True iff at least one unit would change. */
export function liftHasWork(report: LiftMarkersReport): boolean {
  return report.units_affected > 0;
}

/**
 * Compact one-line summary of a (dry-run or applied) lift.
 * Empty pass → an explicit "nothing to lift" sentence.
 */
export function liftSummaryLine(report: LiftMarkersReport): string {
  if (report.units_affected === 0) {
    return "Aucun marqueur inline à lifter dans ce document.";
  }
  const parts = [
    plural(report.units_affected, "unité concernée", "unités concernées"),
    plural(report.roles_set, "rôle posé", "rôles posés"),
    plural(report.statuses_set, "statut posé", "statuts posés"),
    plural(report.cleaned, "texte nettoyé", "textes nettoyés"),
  ];
  if (report.conflicts.length) {
    parts.push(plural(report.conflicts.length, "conflit", "conflits"));
  }
  return parts.join(" · ");
}

/**
 * Human message per conflict — a manual value the lift preserves ("human wins").
 * Role/status codes are rendered with their display labels.
 */
export function liftConflictLines(report: LiftMarkersReport): string[] {
  return report.conflicts.map((c) => {
    const axis = c.field === "unit_role" ? "rôle" : "statut";
    const label = c.field === "unit_role" ? liftRoleLabel : liftStatusLabel;
    return `Unité ${c.n} : ${axis} « ${label(c.existing)} » conservé ` +
           `(le marqueur indiquait « ${label(c.marker)} »).`;
  });
}

/** A change row prepared for the preview table (labels resolved, empty flag). */
export interface LiftPreviewRow {
  n: number;
  before: string;
  after: string;
  /** Display label of the role the lift would set, or null if none / already set. */
  role: string | null;
  /** Display label of the status the lift would set, or null if none / already set. */
  status: string | null;
  /** true when the unit becomes a pure placeholder (after === "") → leaves the FTS. */
  emptied: boolean;
}

/** Map the raw changes into display rows (pure). Order is preserved (by unit n). */
export function liftPreviewRows(report: LiftMarkersReport): LiftPreviewRow[] {
  return report.changes.map((c) => ({
    n: c.n,
    before: c.text_norm_before ?? "",
    after: c.text_norm_after,
    role: c.role ? liftRoleLabel(c.role) : null,
    status: c.status ? liftStatusLabel(c.status) : null,
    emptied: c.text_norm_after.trim() === "",
  }));
}
