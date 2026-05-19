import { describe, it, expect } from "vitest";
import {
  STRUCTURE_DEFAULTS,
  splitRolesByCategory,
  dormantStructureSuggestions,
  isSafeHexColor,
  safeColor,
  validateRoleForm,
} from "../conventionsRoles.ts";
import type { ConventionRole } from "../sidecarClient.ts";

function role(overrides: Partial<ConventionRole> = {}): ConventionRole {
  return {
    name: "r",
    label: "R",
    color: "#123456",
    icon: null,
    sort_order: 0,
    ...overrides,
  };
}

// ─── STRUCTURE_DEFAULTS ──────────────────────────────────────────────────────

describe("STRUCTURE_DEFAULTS", () => {
  it("contient 8 suggestions structurelles", () => {
    expect(STRUCTURE_DEFAULTS).toHaveLength(8);
  });
  it("a des slugs uniques", () => {
    const names = STRUCTURE_DEFAULTS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ─── splitRolesByCategory ────────────────────────────────────────────────────

describe("splitRolesByCategory", () => {
  it("range les rôles par catégorie", () => {
    const { structure, text } = splitRolesByCategory([
      role({ name: "titre", category: "structure" }),
      role({ name: "vers", category: "text" }),
    ]);
    expect(structure.map((r) => r.name)).toEqual(["titre"]);
    expect(text.map((r) => r.name)).toEqual(["vers"]);
  });
  it("category absente → text (défaut sidecar)", () => {
    const { structure, text } = splitRolesByCategory([role({ name: "x" })]);
    expect(structure).toHaveLength(0);
    expect(text.map((r) => r.name)).toEqual(["x"]);
  });
});

// ─── dormantStructureSuggestions ─────────────────────────────────────────────

describe("dormantStructureSuggestions", () => {
  it("catalogue vide → toutes les suggestions sont dormantes", () => {
    expect(dormantStructureSuggestions([])).toHaveLength(STRUCTURE_DEFAULTS.length);
  });
  it("exclut les défauts déjà actifs en structure", () => {
    const d = dormantStructureSuggestions([role({ name: "titre", category: "structure" })]);
    expect(d.some((s) => s.name === "titre")).toBe(false);
    expect(d).toHaveLength(STRUCTURE_DEFAULTS.length - 1);
  });
  it("un rôle texte du même nom ne masque pas la suggestion", () => {
    const d = dormantStructureSuggestions([role({ name: "titre", category: "text" })]);
    expect(d.some((s) => s.name === "titre")).toBe(true);
  });
});

// ─── isSafeHexColor / safeColor ──────────────────────────────────────────────

describe("isSafeHexColor", () => {
  it("accepte #RGB / #RRGGBB / #RRGGBBAA", () => {
    expect(isSafeHexColor("#abc")).toBe(true);
    expect(isSafeHexColor("#1e40af")).toBe(true);
    expect(isSafeHexColor("#1e40afff")).toBe(true);
  });
  it("rejette les valeurs non-hex et nulles", () => {
    expect(isSafeHexColor("red")).toBe(false);
    expect(isSafeHexColor("")).toBe(false);
    expect(isSafeHexColor(null)).toBe(false);
    expect(isSafeHexColor("javascript:alert(1)")).toBe(false);
  });
});

describe("safeColor", () => {
  it("renvoie la couleur si valide, le fallback sinon", () => {
    expect(safeColor("#1e40af")).toBe("#1e40af");
    expect(safeColor("nope", "#000000")).toBe("#000000");
  });
});

// ─── validateRoleForm ────────────────────────────────────────────────────────

describe("validateRoleForm", () => {
  it("name + label valides → ok", () => {
    expect(validateRoleForm({ name: "titre", label: "Titre" }).ok).toBe(true);
  });
  it("name manquant → erreur", () => {
    const v = validateRoleForm({ name: "  ", label: "Titre" });
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/identifiant/i);
  });
  it("label manquant → erreur", () => {
    const v = validateRoleForm({ name: "titre", label: "" });
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/libellé/i);
  });
  it("couleur invalide → erreur", () => {
    const v = validateRoleForm({ name: "titre", label: "Titre", color: "bleu" });
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/hexadécimal/i);
  });
  it("couleur vide → ok (optionnelle)", () => {
    expect(validateRoleForm({ name: "titre", label: "Titre", color: "" }).ok).toBe(true);
  });
});
