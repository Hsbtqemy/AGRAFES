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
import { buildFtsQuery, isSimpleInput } from "../search";

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
