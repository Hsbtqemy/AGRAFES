import { describe, it, expect } from "vitest";
import {
  foldText,
  filterUnits,
  isParatext,
  resolveRoleBadge,
  summarizeUnits,
} from "../conventionsUnitList.ts";
import type { ConventionRole, UnitRecord } from "../sidecarClient.ts";

function unit(overrides: Partial<UnitRecord> = {}): UnitRecord {
  return {
    unit_id: 1,
    n: 1,
    text_norm: "",
    unit_type: "text",
    unit_role: null,
    ...overrides,
  };
}

function role(overrides: Partial<ConventionRole> = {}): ConventionRole {
  return { name: "r", label: "R", color: "#123456", icon: null, sort_order: 0, ...overrides };
}

// ─── foldText ────────────────────────────────────────────────────────────────

describe("foldText", () => {
  it("insensible à la casse et aux accents", () => {
    expect(foldText("Épître")).toBe(foldText("epitre"));
    expect(foldText("CHAPITRE")).toBe("chapitre");
  });
  it("null/undefined → chaîne vide", () => {
    expect(foldText(null)).toBe("");
    expect(foldText(undefined)).toBe("");
  });
});

// ─── filterUnits ─────────────────────────────────────────────────────────────

describe("filterUnits", () => {
  const units = [
    unit({ unit_id: 1, text_norm: "Chapter One" }),
    unit({ unit_id: 2, text_norm: "Un récit ordinaire" }),
    unit({ unit_id: 3, text_norm: "CHAPITRE deux" }),
  ];

  it("query vide → liste inchangée", () => {
    expect(filterUnits(units, "")).toBe(units);
    expect(filterUnits(units, "   ")).toBe(units);
  });
  it("filtre sur sous-correspondance, insensible casse/accents", () => {
    expect(filterUnits(units, "chapit").map((u) => u.unit_id)).toEqual([3]);
    expect(filterUnits(units, "RECIT").map((u) => u.unit_id)).toEqual([2]);
  });
  it("aucune correspondance → liste vide", () => {
    expect(filterUnits(units, "zzz")).toHaveLength(0);
  });
});

// ─── isParatext ──────────────────────────────────────────────────────────────

describe("isParatext", () => {
  it("pas de borne → jamais paratexte", () => {
    expect(isParatext(1, null)).toBe(false);
    expect(isParatext(1, undefined)).toBe(false);
  });
  it("n < text_start_n → paratexte", () => {
    expect(isParatext(2, 5)).toBe(true);
    expect(isParatext(5, 5)).toBe(false);
    expect(isParatext(9, 5)).toBe(false);
  });
});

// ─── resolveRoleBadge ────────────────────────────────────────────────────────

describe("resolveRoleBadge", () => {
  const roles = [role({ name: "titre", label: "Titre", color: "#1e40af", icon: "◈" })];

  it("pas de rôle → null", () => {
    expect(resolveRoleBadge(null, roles)).toBeNull();
  });
  it("rôle inconnu → null", () => {
    expect(resolveRoleBadge("inexistant", roles)).toBeNull();
  });
  it("rôle connu → badge résolu", () => {
    expect(resolveRoleBadge("titre", roles)).toEqual({
      label: "Titre",
      color: "#1e40af",
      icon: "◈",
    });
  });
  it("couleur nulle → fallback", () => {
    const badge = resolveRoleBadge("x", [role({ name: "x", color: null })]);
    expect(badge?.color).toBe("#374151");
  });
});

// ─── summarizeUnits ──────────────────────────────────────────────────────────

describe("summarizeUnits", () => {
  it("compteurs total / withRole / matched cohérents", () => {
    const units = [
      unit({ unit_id: 1, unit_role: "titre" }),
      unit({ unit_id: 2, unit_role: null }),
      unit({ unit_id: 3, unit_role: "vers" }),
    ];
    const filtered = [units[0], units[2]];
    expect(summarizeUnits(units, filtered)).toEqual({ total: 3, withRole: 2, matched: 2 });
  });
  it("liste vide → tout à zéro", () => {
    expect(summarizeUnits([], [])).toEqual({ total: 0, withRole: 0, matched: 0 });
  });
});
