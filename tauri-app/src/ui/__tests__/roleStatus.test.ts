/**
 * Tests for ui/roleStatus.ts (R4.3) — the pure label/badge helpers that let the
 * concordancer display peritext role + translation status without knowing the
 * Prep role catalogue.
 */
import { describe, expect, it } from "vitest";
import { roleLabel, statusLabel, statusModifier, unitBadges } from "../roleStatus";

describe("roleLabel / statusLabel", () => {
  it("maps known roles and statuses to display labels", () => {
    expect(roleLabel("titre")).toBe("Titre");
    expect(roleLabel("chapeau")).toBe("Chapeau");
    expect(roleLabel("intertitre")).toBe("Intertitre");
    expect(statusLabel("non_traduit")).toBe("non traduit");
    expect(statusLabel("ajout")).toBe("ajout");
  });

  it("falls back to the raw slug for custom roles / unknown statuses", () => {
    expect(roleLabel("epigraphe")).toBe("epigraphe");
    expect(statusLabel("bizarre")).toBe("bizarre");
  });
});

describe("statusModifier", () => {
  it("returns the css modifier for known statuses, empty for unknown", () => {
    expect(statusModifier("non_traduit")).toBe("nt");
    expect(statusModifier("ajout")).toBe("add");
    expect(statusModifier("bizarre")).toBe("");
  });
});

describe("unitBadges", () => {
  it("returns no badge when the unit has neither role nor status", () => {
    expect(unitBadges({})).toEqual([]);
    expect(unitBadges({ unit_role: null, unit_status: null })).toEqual([]);
  });

  it("emits role first then status, with labels and tooltips", () => {
    const badges = unitBadges({ unit_role: "titre", unit_status: "non_traduit" });
    expect(badges.map((b) => b.kind)).toEqual(["role", "status"]);
    expect(badges[0]).toMatchObject({ value: "titre", label: "Titre" });
    expect(badges[0].title).toContain("Rôle");
    expect(badges[1]).toMatchObject({ value: "non_traduit", label: "non traduit" });
    expect(badges[1].title).toContain("Statut");
  });

  it("emits a status-only badge when there is no role", () => {
    const badges = unitBadges({ unit_status: "ajout" });
    expect(badges).toHaveLength(1);
    expect(badges[0]).toMatchObject({ kind: "status", value: "ajout", label: "ajout" });
  });
});
