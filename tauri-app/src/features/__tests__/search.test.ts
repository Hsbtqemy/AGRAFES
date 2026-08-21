/**
 * Tests for the REAL features/search.ts (buildFtsQuery + isSimpleInput).
 *
 * Replaces scripts/test_buildFtsQuery.mjs, which tested a *copy* of the logic
 * (decoupled from the source, and with a different signature). Here we import the
 * actual functions, which read state.builderMode / state.nearN and may call
 * showBuilderWarn (DOM) — hence the happy-dom environment (vite.config.ts).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { state } from "../../state";
import { buildFtsQuery, isSimpleInput, validateCqlSyntax } from "../search";

beforeEach(() => {
  state.builderMode = "simple";
  state.nearN = 5;
});

describe("isSimpleInput (FTS expression detection)", () => {
  it.each([
    ["foo AND bar", true],
    ["foo OR bar", true],
    ["NOT foo", true],
    ["NEAR(foo bar, 5)", true],
    ['"expression exacte"', true],
    ["chat", false],
    ["chat chien", false],
    ["black and white", false], // lowercase 'and' is not the operator
  ])("%j -> %s", (raw, expected) => {
    expect(isSimpleInput(raw as string)).toBe(expected);
  });
});

describe("buildFtsQuery", () => {
  it("simple: passthrough + trim", () => {
    state.builderMode = "simple";
    expect(buildFtsQuery("chat")).toBe("chat");
    expect(buildFtsQuery("  chat  ")).toBe("chat");
    expect(buildFtsQuery("foo AND bar")).toBe("foo AND bar");
  });

  it("regex / cql: handled by backend -> empty string", () => {
    state.builderMode = "regex";
    expect(buildFtsQuery("chat")).toBe("");
    state.builderMode = "cql";
    expect(buildFtsQuery('[lemma="chat"]')).toBe("");
  });

  it("phrase: wrap in quotes; double-quotes -> single", () => {
    state.builderMode = "phrase";
    expect(buildFtsQuery("le chat")).toBe('"le chat"');
    expect(buildFtsQuery("chat")).toBe('"chat"');
    expect(buildFtsQuery("l'avion")).toBe('"l\'avion"');
    // already an FTS expression -> bypass (warns via showBuilderWarn, no-op headless)
    expect(buildFtsQuery("foo AND bar")).toBe("foo AND bar");
  });

  it("and: join tokens with AND", () => {
    state.builderMode = "and";
    expect(buildFtsQuery("chat chien")).toBe("chat AND chien");
    expect(buildFtsQuery("a b c")).toBe("a AND b AND c");
    expect(buildFtsQuery("chat")).toBe("chat");        // single token
    expect(buildFtsQuery("foo OR bar")).toBe("foo OR bar");  // bypass FTS
  });

  it("or: join tokens with OR", () => {
    state.builderMode = "or";
    expect(buildFtsQuery("chat chien")).toBe("chat OR chien");
    expect(buildFtsQuery("foo AND bar")).toBe("foo AND bar");  // bypass FTS
  });

  it("near: NEAR(tokens, N) with >=2 tokens", () => {
    state.builderMode = "near";
    state.nearN = 5;
    expect(buildFtsQuery("chat chien")).toBe("NEAR(chat chien, 5)");
    state.nearN = 3;
    expect(buildFtsQuery("a b c")).toBe("NEAR(a b c, 3)");
    // single token -> fallback (warns, no-op headless)
    expect(buildFtsQuery("chat")).toBe("chat");
    // already FTS -> bypass
    expect(buildFtsQuery("NEAR(a b, 3)")).toBe("NEAR(a b, 3)");
    // empty -> ""
    expect(buildFtsQuery("")).toBe("");
  });
});

describe("validateCqlSyntax — nommer le vrai problème", () => {
  it("distingue un attribut inconnu d'un prédicat mal formé", () => {
    // Vu en QA le 2026-08-21 : `[mot="chat"]` — la faute la plus probable en français
    // — rendait « Prédicat invalide » suivi du conseil « utilisez des clauses entre
    // crochets ». L'utilisateur EN AVAIT MIS : le conseil se lisait comme un
    // contresens, et le vrai problème (le nom de l'attribut) n'était pas nommé.
    const err = validateCqlSyntax('[mot="chat"]');
    expect(err).toContain("Attribut inconnu");
    expect(err).toContain("mot");
    expect(err).toContain("word, lemma, pos, upos, xpos, feats");
  });

  it("laisse les six attributs valides passer", () => {
    for (const attr of ["word", "lemma", "pos", "upos", "xpos", "feats"]) {
      expect(validateCqlSyntax(`[${attr}="chat"]`)).toBeNull();
    }
  });

  it("garde le message générique quand le prédicat n'a pas de nom d'attribut", () => {
    // `"chat"` seul n'est pas un `attr = valeur` : rien à nommer.
    expect(validateCqlSyntax('["chat"]')).toContain("Prédicat invalide");
  });

  it("ne déclare PAS inconnu un attribut valide — le piège de la première version", () => {
    // Elle disait « Attribut inconnu « word » » sur ces deux-là, où l'attribut est
    // parfaitement valide. Un message faux est pire que le message générique.
    for (const q of ['[word=chat]', '[word="chat" %x]']) {
      const err = validateCqlSyntax(q);
      expect(err).not.toBeNull();
      expect(err).not.toContain("Attribut inconnu");
    }
  });

  it("nomme le vrai fautif : les guillemets manquants", () => {
    expect(validateCqlSyntax('[word=chat]')).toContain("entre guillemets");
  });

  it("nomme le vrai fautif : le drapeau", () => {
    const err = validateCqlSyntax('[word="chat" %x]');
    expect(err).toContain("%c");
  });

  it("l'attribut inconnu est reconnu quelle que soit sa casse", () => {
    // Le moteur accepte `[Word="chat"]` (vérifié sur cql_parser) : le client aussi,
    // donc la comparaison doit être insensible à la casse des DEUX côtés.
    expect(validateCqlSyntax('[Word="chat"]')).toBeNull();
    expect(validateCqlSyntax('[Mot="chat"]')).toContain("Attribut inconnu");
  });
});
