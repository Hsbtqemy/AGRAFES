import { describe, it, expect } from "vitest";
import {
  rulesSignature,
  sampleFingerprint,
  sampleTextFingerprint,
} from "../curationFingerprint.ts";

// ─── rulesSignature ──────────────────────────────────────────────────────────

describe("rulesSignature", () => {
  it("mêmes règles, même ordre → même hash", () => {
    const rules = [
      { pattern: "foo", replacement: "bar", flags: "g", description: "" },
      { pattern: "baz", replacement: "", flags: "", description: "test" },
    ];
    expect(rulesSignature(rules)).toBe(rulesSignature(rules));
  });

  it("mêmes règles, ordre différent → même hash (canonique)", () => {
    const a = [
      { pattern: "foo", replacement: "bar" },
      { pattern: "baz", replacement: "qux" },
    ];
    const b = [
      { pattern: "baz", replacement: "qux" },
      { pattern: "foo", replacement: "bar" },
    ];
    expect(rulesSignature(a)).toBe(rulesSignature(b));
  });

  it("règles différentes → hash différent", () => {
    const a = [{ pattern: "foo", replacement: "bar" }];
    const b = [{ pattern: "foo", replacement: "baz" }];
    expect(rulesSignature(a)).not.toBe(rulesSignature(b));
  });

  it("règles vides → hash stable non-vide", () => {
    const h = rulesSignature([]);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(rulesSignature([])).toBe(h); // stable
  });

  it("retourne exactement 8 caractères hex", () => {
    const h = rulesSignature([{ pattern: "x" }]);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ─── sampleFingerprint ────────────────────────────────────────────────────────

describe("sampleFingerprint", () => {
  it("mêmes exemples → même empreinte", () => {
    const ex = [
      { unit_id: 1, matched_rule_ids: [0, 2] },
      { unit_id: 2, matched_rule_ids: [1] },
    ];
    expect(sampleFingerprint(ex)).toBe(sampleFingerprint(ex));
  });

  it("un exemple en moins → empreinte différente", () => {
    const full = [{ unit_id: 1, matched_rule_ids: [0] }, { unit_id: 2 }];
    const less = [{ unit_id: 1, matched_rule_ids: [0] }];
    expect(sampleFingerprint(full)).not.toBe(sampleFingerprint(less));
  });

  it("matched_rule_ids différents → empreinte différente", () => {
    const a = [{ unit_id: 1, matched_rule_ids: [0] }];
    const b = [{ unit_id: 1, matched_rule_ids: [1] }];
    expect(sampleFingerprint(a)).not.toBe(sampleFingerprint(b));
  });

  it("ordre des matched_rule_ids invariant (triés avant hash)", () => {
    const a = [{ unit_id: 1, matched_rule_ids: [2, 0, 1] }];
    const b = [{ unit_id: 1, matched_rule_ids: [0, 1, 2] }];
    expect(sampleFingerprint(a)).toBe(sampleFingerprint(b));
  });

  it("unit_id manquant (undefined) → exemple ignoré proprement", () => {
    const ex = [{ matched_rule_ids: [0] }, { unit_id: 1 }];
    // Pas de crash, et l'exemple sans unit_id n'est pas compté
    expect(() => sampleFingerprint(ex)).not.toThrow();
    expect(sampleFingerprint(ex)).toBe(sampleFingerprint([{ unit_id: 1 }]));
  });

  it("liste vide → hash stable", () => {
    expect(sampleFingerprint([])).toMatch(/^[0-9a-f]{8}$/);
    expect(sampleFingerprint([])).toBe(sampleFingerprint([]));
  });
});

// ─── sampleTextFingerprint ────────────────────────────────────────────────────

describe("sampleTextFingerprint", () => {
  it("mêmes `before` → même empreinte", () => {
    const ex = [{ unit_id: 1, before: "bonjour monde" }];
    expect(sampleTextFingerprint(ex)).toBe(sampleTextFingerprint(ex));
  });

  it("modification après la position 64 → même empreinte (borne intentionnelle)", () => {
    const base = "a".repeat(64);
    const a = [{ unit_id: 1, before: base + "X" }];
    const b = [{ unit_id: 1, before: base + "Y" }];
    expect(sampleTextFingerprint(a)).toBe(sampleTextFingerprint(b));
  });

  it("modification avant la position 64 → empreinte différente", () => {
    const a = [{ unit_id: 1, before: "bonjour monde" }];
    const b = [{ unit_id: 1, before: "bonsoir monde" }];
    expect(sampleTextFingerprint(a)).not.toBe(sampleTextFingerprint(b));
  });

  it("whitespace normalisé : espaces multiples ≡ espace simple", () => {
    const a = [{ unit_id: 1, before: "a  b" }];
    const b = [{ unit_id: 1, before: "a b" }];
    expect(sampleTextFingerprint(a)).toBe(sampleTextFingerprint(b));
  });

  it("unit_id manquant → ignoré proprement, pas de crash", () => {
    const ex = [{ before: "texte" }, { unit_id: 1, before: "autre" }];
    expect(() => sampleTextFingerprint(ex)).not.toThrow();
    expect(sampleTextFingerprint(ex)).toBe(
      sampleTextFingerprint([{ unit_id: 1, before: "autre" }])
    );
  });

  it("before absent (undefined) → traité comme chaîne vide", () => {
    const a = [{ unit_id: 1 }];
    const b = [{ unit_id: 1, before: "" }];
    expect(sampleTextFingerprint(a)).toBe(sampleTextFingerprint(b));
  });
});
