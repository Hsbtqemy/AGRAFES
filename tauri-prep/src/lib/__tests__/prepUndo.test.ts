import { describe, it, expect } from "vitest";
import {
  ELIGIBILITY_REASONS,
  PREP_ACTION_TYPES,
  formatUndoActionLabel,
  formatUndoTooltip,
  formatUndoUnavailableReason,
  isUndoDisabled,
} from "../prepUndo.ts";

// Invariant 1 : formatUndoActionLabel suit la description backend.
describe("formatUndoActionLabel", () => {
  it("eligible avec description → préfixe glyph + description telle quelle", () => {
    const elig = {
      eligible: true,
      description: "Apply 3 règles · 47 unités modifiées",
      action_type: "curation_apply" as const,
    };
    expect(formatUndoActionLabel(elig)).toBe(
      "↶ Annuler : Apply 3 règles · 47 unités modifiées",
    );
  });

  it("eligible mais description absente → label générique", () => {
    expect(formatUndoActionLabel({ eligible: true })).toBe("↶ Annuler");
  });

  it("non éligible → label générique sans description", () => {
    expect(
      formatUndoActionLabel({ eligible: false, description: "ignored" }),
    ).toBe("↶ Annuler");
  });
});

// Invariant 2 : reasons inconnues → message générique avec code.
describe("formatUndoUnavailableReason", () => {
  it("no_action → message dédié", () => {
    expect(formatUndoUnavailableReason("no_action")).toMatch(/Aucune action/);
  });

  it("no_snapshots → message dédié", () => {
    expect(formatUndoUnavailableReason("no_snapshots")).toMatch(/antérieure/);
  });

  it("structural_dependency → message dédié", () => {
    expect(formatUndoUnavailableReason("structural_dependency")).toMatch(/plus récente/);
  });

  it("reason inconnue → message générique avec code", () => {
    expect(formatUndoUnavailableReason("zzz_unknown")).toBe(
      "Annulation impossible (zzz_unknown).",
    );
  });

  it("undefined → message générique sans code", () => {
    expect(formatUndoUnavailableReason(undefined)).toBe("Annulation impossible.");
  });

  it("chaque reason connue a une branche dédiée", () => {
    for (const reason of ELIGIBILITY_REASONS) {
      const msg = formatUndoUnavailableReason(reason);
      // Une branche dédiée ne contient PAS le code reason brut.
      expect(msg).not.toContain(`(${reason})`);
    }
  });
});

// Invariant 3 : tooltip combine label + horodatage / reason.
describe("formatUndoTooltip", () => {
  it("eligible avec performed_at → label + horodatage", () => {
    const tooltip = formatUndoTooltip({
      eligible: true,
      description: "Coupure u.42",
      performed_at: "2026-04-30T10:12:33Z",
    });
    expect(tooltip).toContain("Annuler : Coupure u.42");
    expect(tooltip).toContain("2026-04-30T10:12:33Z");
  });

  it("eligible sans performed_at → label seul", () => {
    const tooltip = formatUndoTooltip({
      eligible: true,
      description: "x",
    });
    expect(tooltip).toBe("↶ Annuler : x");
  });

  it("non éligible → reason explicite", () => {
    expect(
      formatUndoTooltip({ eligible: false, reason: "no_action" }),
    ).toMatch(/Aucune action/);
  });
});

// Invariant 4 : types alignés sur la CHECK constraint backend.
describe("type constants", () => {
  it("PREP_ACTION_TYPES couvre toutes les valeurs CHECK", () => {
    expect(PREP_ACTION_TYPES).toEqual([
      "curation_apply",
      "merge_units",
      "split_unit",
      "resegment",
      "undo",
    ]);
  });

  it("ELIGIBILITY_REASONS contient les codes émis V1", () => {
    expect(ELIGIBILITY_REASONS).toContain("no_action");
    expect(ELIGIBILITY_REASONS).toContain("no_snapshots");
  });
});

describe("isUndoDisabled", () => {
  it("null / undefined → disabled", () => {
    expect(isUndoDisabled(null)).toBe(true);
    expect(isUndoDisabled(undefined)).toBe(true);
  });

  it("eligible:false → disabled", () => {
    expect(isUndoDisabled({ eligible: false, reason: "no_action" })).toBe(true);
  });

  it("eligible:true → enabled", () => {
    expect(isUndoDisabled({ eligible: true })).toBe(false);
  });
});
