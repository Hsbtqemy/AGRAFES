import { describe, it, expect } from "vitest";
import {
  liftRoleLabel,
  liftStatusLabel,
  liftHasWork,
  liftSummaryLine,
  liftConflictLines,
  liftPreviewRows,
} from "../markerLift.ts";
import type { LiftMarkersReport } from "../sidecarClient.ts";

function report(overrides: Partial<LiftMarkersReport> = {}): LiftMarkersReport {
  return {
    doc_id: 1,
    dry_run: true,
    units_scanned: 0,
    units_affected: 0,
    roles_set: 0,
    statuses_set: 0,
    cleaned: 0,
    roles_created: [],
    conflicts: [],
    changes: [],
    ...overrides,
  };
}

describe("labels", () => {
  it("maps known role/status codes to display labels", () => {
    expect(liftRoleLabel("titre")).toBe("Titre");
    expect(liftRoleLabel("chapeau")).toBe("Chapeau");
    expect(liftRoleLabel("intertitre")).toBe("Intertitre");
    expect(liftStatusLabel("non_traduit")).toBe("non traduit");
    expect(liftStatusLabel("ajout")).toBe("ajout");
  });

  it("falls back to the raw code for unknown values", () => {
    expect(liftRoleLabel("mystere")).toBe("mystere");
    expect(liftStatusLabel("autre")).toBe("autre");
  });
});

describe("liftHasWork", () => {
  it("is false on an empty pass, true when a unit is affected", () => {
    expect(liftHasWork(report())).toBe(false);
    expect(liftHasWork(report({ units_affected: 1 }))).toBe(true);
  });
});

describe("liftSummaryLine", () => {
  it("returns the nothing-to-lift sentence when no unit is affected", () => {
    expect(liftSummaryLine(report())).toBe(
      "Aucun marqueur inline à lifter dans ce document.",
    );
  });

  it("pluralises counts and omits conflicts when there are none", () => {
    const line = liftSummaryLine(report({
      units_affected: 3, roles_set: 2, statuses_set: 1, cleaned: 3,
    }));
    expect(line).toBe(
      "3 unités concernées · 2 rôles posés · 1 statut posé · 3 textes nettoyés",
    );
    expect(line).not.toContain("conflit");
  });

  it("uses singular forms for a count of one", () => {
    const line = liftSummaryLine(report({
      units_affected: 1, roles_set: 1, statuses_set: 0, cleaned: 1,
    }));
    expect(line).toBe(
      "1 unité concernée · 1 rôle posé · 0 statut posé · 1 texte nettoyé",
    );
  });

  it("appends the conflict count when present", () => {
    const line = liftSummaryLine(report({
      units_affected: 2, roles_set: 1, statuses_set: 0, cleaned: 2,
      conflicts: [{ n: 4, field: "unit_role", existing: "titre", marker: "chapeau" }],
    }));
    expect(line).toContain("1 conflit");
    expect(line.endsWith("1 conflit")).toBe(true);
  });
});

describe("liftConflictLines", () => {
  it("renders a role conflict with display labels", () => {
    const lines = liftConflictLines(report({
      conflicts: [{ n: 12, field: "unit_role", existing: "titre", marker: "chapeau" }],
    }));
    expect(lines).toEqual([
      "Unité 12 : rôle « Titre » conservé (le marqueur indiquait « Chapeau »).",
    ]);
  });

  it("renders a status conflict with status labels", () => {
    const lines = liftConflictLines(report({
      conflicts: [{ n: 7, field: "unit_status", existing: "ajout", marker: "non_traduit" }],
    }));
    expect(lines).toEqual([
      "Unité 7 : statut « ajout » conservé (le marqueur indiquait « non traduit »).",
    ]);
  });
});

describe("liftPreviewRows", () => {
  it("resolves role/status labels and flags placeholder-emptied units", () => {
    const rows = liftPreviewRows(report({
      changes: [
        { n: 2, unit_id: 20, role: "titre", status: null,
          text_norm_before: "David Goldblatt [T]", text_norm_after: "David Goldblatt" },
        { n: 3, unit_id: 21, role: "chapeau", status: "non_traduit",
          text_norm_before: "[non traduit] [Ch]", text_norm_after: "" },
      ],
    }));
    expect(rows[0]).toEqual({
      n: 2, before: "David Goldblatt [T]", after: "David Goldblatt",
      role: "Titre", status: null, emptied: false,
    });
    expect(rows[1]).toEqual({
      n: 3, before: "[non traduit] [Ch]", after: "",
      role: "Chapeau", status: "non traduit", emptied: true,
    });
  });

  it("leaves role/status null when the change set none (conflict or absent)", () => {
    const rows = liftPreviewRows(report({
      changes: [
        { n: 5, unit_id: 30, role: null, status: null,
          text_norm_before: "Titre [Ch]", text_norm_after: "Titre" },
      ],
    }));
    expect(rows[0].role).toBeNull();
    expect(rows[0].status).toBeNull();
    expect(rows[0].emptied).toBe(false);
  });

  it("treats a null text_norm_before as an empty string", () => {
    const rows = liftPreviewRows(report({
      changes: [
        { n: 1, unit_id: 10, role: "titre", status: null,
          text_norm_before: null, text_norm_after: "X" },
      ],
    }));
    expect(rows[0].before).toBe("");
  });
});
