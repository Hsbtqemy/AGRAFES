import { describe, it, expect } from "vitest";
import {
  CURATE_PRESETS,
  parseAdvancedCurateRules,
  getPunctLangFromValue,
} from "../curationPresets.ts";

// ─── CURATE_PRESETS structural invariants ────────────────────────────────────

describe("CURATE_PRESETS — structure", () => {
  it("contient les 8 presets stables (clés API gelées)", () => {
    const expectedKeys = ["spaces", "quotes", "punctuation_fr", "punctuation_en",
                          "punctuation", "invisibles", "numbering", "custom"];
    for (const k of expectedKeys) {
      expect(CURATE_PRESETS).toHaveProperty(k);
    }
  });

  it("chaque preset a un label string non vide", () => {
    for (const [key, preset] of Object.entries(CURATE_PRESETS)) {
      expect(preset.label, `preset ${key} label`).toBeTypeOf("string");
      expect(preset.label.length, `preset ${key} label not empty`).toBeGreaterThan(0);
    }
  });

  it("chaque rule a pattern et replacement (sauf custom qui est vide)", () => {
    for (const [key, preset] of Object.entries(CURATE_PRESETS)) {
      if (key === "custom") {
        expect(preset.rules.length).toBe(0);
        continue;
      }
      expect(preset.rules.length, `${key} non vide`).toBeGreaterThan(0);
      for (const rule of preset.rules) {
        expect(rule.pattern, `${key} pattern`).toBeTypeOf("string");
        expect(typeof rule.replacement, `${key} replacement`).toBe("string");
      }
    }
  });
});

// ─── CURATE_PRESETS — patterns compilent comme regex JS valides ─────────────

describe("CURATE_PRESETS — regex validity", () => {
  it("tous les patterns sont des regex JS valides", () => {
    for (const [key, preset] of Object.entries(CURATE_PRESETS)) {
      for (const rule of preset.rules) {
        const flags = rule.flags ?? "";
        expect(() => new RegExp(rule.pattern, flags), `${key}: ${rule.pattern}`).not.toThrow();
      }
    }
  });
});

// ─── CURATE_PRESETS — application JS-side donne des résultats sensés ────────
// Note : les presets sont conçus pour être appliqués côté backend Python avec
// le translator JS→Python ; ici on teste le comportement JS-side comme garde-fou
// que le pattern est au moins syntaxiquement correct et matche ce qu'on veut.

function applyRule(text: string, rule: { pattern: string; replacement: string; flags?: string }): string {
  return text.replace(new RegExp(rule.pattern, rule.flags ?? ""), rule.replacement);
}

describe("CURATE_PRESETS — comportement JS-side", () => {
  it("spaces: doubles espaces → un seul", () => {
    const rule = CURATE_PRESETS.spaces.rules[0];
    expect(applyRule("foo  bar", rule)).toBe("foo bar");
    expect(applyRule("foo   bar", rule)).toBe("foo bar");
  });

  it("quotes: courbes → droites", () => {
    const apostropheRule = CURATE_PRESETS.quotes.rules[0];
    expect(applyRule("l’enfant", apostropheRule)).toBe("l'enfant");
    expect(applyRule("d‘un", apostropheRule)).toBe("d'un");
  });

  it("invisibles: BOM et zero-width supprimés", () => {
    const rule = CURATE_PRESETS.invisibles.rules[0];
    expect(applyRule("﻿hello", rule)).toBe("hello");
    expect(applyRule("a​b", rule)).toBe("ab");
  });

  it("numbering: 1. → [1]", () => {
    const rule = CURATE_PRESETS.numbering.rules[0];
    expect(applyRule("1. premier", rule)).toBe("[1] premier");
  });
});

// ─── CURATE_PRESETS — invariant idempotence ─────────────────────────────────
// Invariant non-négociable (cf. HANDOFF_PREP § 5) : appliquer un preset deux
// fois doit donner le même résultat qu'une fois. Sinon le pipeline oscille
// et la curation devient impossible à raisonner.
//
// Note : on teste ici les patterns CÔTÉ JS uniquement (donc replacement
// littéral, pas de translator $→\g<>). Pour les presets sans backreference
// l'idempotence est testable directement. Pour ceux avec backreference (FR,
// EN), le replacement JS « $1 » ne fait PAS la backreference côté JS — c'est
// le translator backend qui s'en charge. On les exclut donc des tests
// d'idempotence ici (le backend a ses propres tests).

function applyPresetJs(text: string, presetKey: string): string {
  const preset = CURATE_PRESETS[presetKey];
  let out = text;
  for (const rule of preset.rules) {
    out = out.replace(new RegExp(rule.pattern, rule.flags ?? ""), rule.replacement);
  }
  return out;
}

describe("CURATE_PRESETS — idempotence (apply 2× = apply 1×)", () => {
  // Presets sans backreference : testables directement côté JS.
  const idempotentPresets = ["spaces", "quotes", "invisibles"];

  for (const key of idempotentPresets) {
    it(`${key} — idempotent sur texte typique`, () => {
      const samples = [
        "Hello world",
        "Foo  bar  baz",   // doubles espaces
        "« Madone »",      // guillemets FR avec espaces variés (NBSP + space)
        "‘word’ \"another\"",
        "Texte avec​zero-width﻿ et BOM",
      ];
      for (const src of samples) {
        const once = applyPresetJs(src, key);
        const twice = applyPresetJs(once, key);
        expect(twice, `${key}: «${src}» → 1× ≠ 2×`).toBe(once);
      }
    });
  }

  it("quotes — la NNBSP insérée n'est pas re-réinsérée au 2e pass", () => {
    // Cas spécifique : le preset quotes met du NNBSP autour des chevrons.
    // Si la classe de match ne contenait QUE NBSP (sans NNBSP), le 2e pass
    // verrait «   mot   » et essaierait de matcher « avec aucun
    // espace puis   → re-replacement → doublon.
    const src = "«Madone»";
    const once = applyPresetJs(src, "quotes");
    const twice = applyPresetJs(once, "quotes");
    expect(once).toBe("« Madone »");
    expect(twice).toBe(once);
  });
});

// ─── CURATE_PRESETS — réversibilité spaces n'écrase pas les NBSP ─────────────
// Invariant explicite (cf. HANDOFF_PREP § 5 décisions héritées) : le preset
// `spaces` ne doit JAMAIS détruire les NBSP intentionnelles. Cf. fix v0.1.40.

describe("CURATE_PRESETS — invariant NBSP préservées dans spaces", () => {
  it("preset spaces ne contient aucune règle qui matche \\u00A0 ou \\u202F", () => {
    for (const rule of CURATE_PRESETS.spaces.rules) {
      // Les patterns de spaces utilisent [ \\t]{2,} ou ^\\s+|\\s+$. Le \\s
      // matche les NBSP/NNBSP en JavaScript regex. Mais ces patterns sont
      // ancrés sur les bornes ou sur runs longs : ils ne touchent pas les
      // NBSP isolées en milieu de texte, qui sont l'usage typographique.
      const text = "foo bar baz";
      const result = applyRule(text, rule);
      // NBSP et NNBSP isolées préservées
      expect(result).toContain(" ");
      expect(result).toContain(" ");
    }
  });
});

// ─── parseAdvancedCurateRules ────────────────────────────────────────────────

describe("parseAdvancedCurateRules", () => {
  it("vide → []", () => {
    expect(parseAdvancedCurateRules("")).toEqual([]);
    expect(parseAdvancedCurateRules("   ")).toEqual([]);
    expect(parseAdvancedCurateRules("\n\t  \n")).toEqual([]);
  });

  it("JSON malformé → [] (jamais throw)", () => {
    expect(parseAdvancedCurateRules("not json")).toEqual([]);
    expect(parseAdvancedCurateRules("{")).toEqual([]);
    expect(parseAdvancedCurateRules("[invalid")).toEqual([]);
  });

  it("non-array → [] (objet, string, number)", () => {
    expect(parseAdvancedCurateRules('{"foo":"bar"}')).toEqual([]);
    expect(parseAdvancedCurateRules('"a string"')).toEqual([]);
    expect(parseAdvancedCurateRules('42')).toEqual([]);
    expect(parseAdvancedCurateRules('null')).toEqual([]);
  });

  it("array vide → []", () => {
    expect(parseAdvancedCurateRules("[]")).toEqual([]);
  });

  it("array de règles valides → forwardées", () => {
    const input = '[{"pattern":"foo","replacement":"bar"}]';
    const result = parseAdvancedCurateRules(input);
    expect(result).toEqual([{ pattern: "foo", replacement: "bar" }]);
  });

  it("ne valide PAS la forme individuelle des rules (délégué au backend)", () => {
    // Le frontend forwarde tel quel ; le backend `rules_from_list` valide.
    const input = '[{"foo":"bar"},{"baz":"qux"}]';
    const result = parseAdvancedCurateRules(input);
    expect(result.length).toBe(2);
  });
});

// ─── getPunctLangFromValue ───────────────────────────────────────────────────

describe("getPunctLangFromValue", () => {
  it('"fr" → "fr"', () => expect(getPunctLangFromValue("fr")).toBe("fr"));
  it('"en" → "en"', () => expect(getPunctLangFromValue("en")).toBe("en"));
  it('autre value → ""', () => {
    expect(getPunctLangFromValue("de")).toBe("");
    expect(getPunctLangFromValue("FR")).toBe("");  // strict case match
    expect(getPunctLangFromValue("")).toBe("");
  });
  it("null → \"\"", () => expect(getPunctLangFromValue(null)).toBe(""));
  it("undefined → \"\"", () => expect(getPunctLangFromValue(undefined)).toBe(""));
});
