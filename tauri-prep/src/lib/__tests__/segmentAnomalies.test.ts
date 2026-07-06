import { describe, it, expect } from "vitest";
import {
  SHORT_SEGMENT_MAX_LEN,
  orphanRegexForLang,
  isShortText,
  isOrphanText,
  computeAnomalyView,
  type AnomalyInput,
} from "../segmentAnomalies.ts";

describe("orphanRegexForLang", () => {
  it("flags a leading closing mark for the default (French) set, allowing leading whitespace", () => {
    const re = orphanRegexForLang("fr");
    expect(re.test("» bonjour")).toBe(true);
    expect(re.test("  ) suite")).toBe(true); // leading whitespace tolerated
    expect(re.test("] fin")).toBe(true);
    expect(re.test("” clos")).toBe(true);
    expect(re.test("’ clos")).toBe(true);
  });

  it("does NOT flag an opening guillemet or normal text (French)", () => {
    const re = orphanRegexForLang("fr");
    expect(re.test("« ouverture")).toBe(false); // opening mark is legitimate
    expect(re.test("‹ ouverture")).toBe(false);
    expect(re.test("Une phrase normale.")).toBe(false);
  });

  it("adds the reversed guillemets « ‹ › only for German", () => {
    const de = orphanRegexForLang("de-DE");
    expect(de.test("« reversed")).toBe(true);
    expect(de.test("‹ reversed")).toBe(true);
    expect(de.test("› reversed")).toBe(true);
    expect(de.test("» base")).toBe(true); // base set still applies
  });

  it("treats unknown/empty language as the default set", () => {
    expect(orphanRegexForLang(null).test("» x")).toBe(true);
    expect(orphanRegexForLang("").test("« x")).toBe(false);
  });
});

describe("isShortText / isOrphanText", () => {
  it("short is ≤ 5 chars (boundary)", () => {
    expect(SHORT_SEGMENT_MAX_LEN).toBe(5);
    expect(isShortText("")).toBe(true);
    expect(isShortText("12345")).toBe(true);
    expect(isShortText("123456")).toBe(false);
  });
  it("isOrphanText delegates to the language-aware regex", () => {
    expect(isOrphanText("» x", "fr")).toBe(true);
    expect(isOrphanText("« x", "fr")).toBe(false);
    expect(isOrphanText("« x", "de")).toBe(true);
  });
});

describe("computeAnomalyView", () => {
  const units: AnomalyInput[] = [
    { text: "Bonjour le monde.", isLine: true },   // 0 — normal
    { text: "»", isLine: true },                    // 1 — orphan AND short (len 1)
    { text: "Une phrase normale ici.", isLine: true }, // 2 — normal
    { text: "OK", isLine: true },                   // 3 — short (len 2)
    { text: "Titre", isLine: false },               // 4 — structure (len 5) → never flagged
  ];

  it("counts short/orphan over line units only (structure ignored)", () => {
    const v = computeAnomalyView(units, { short: false, orphan: false }, "fr");
    expect(v.shortCount).toBe(2);  // idx 1 and 3; idx 4 "Titre" is structure → excluded
    expect(v.orphanCount).toBe(1); // idx 1
    expect(v.anyFilterActive).toBe(false);
    expect(v.rows.every((r) => r.cls === null && r.visible)).toBe(true); // no filter → all shown, undecorated
  });

  it("orphan filter surfaces the orphan target + its ±1 neighbours, hides the rest", () => {
    const v = computeAnomalyView(units, { short: false, orphan: true }, "fr");
    expect(v.rows[1].cls).toBe("orphan");
    expect(v.rows[0].cls).toBe("context");
    expect(v.rows[2].cls).toBe("context");
    expect(v.rows[3].visible).toBe(false); // not a target nor a neighbour of one
    expect(v.rows[4].visible).toBe(false);
  });

  it("short filter surfaces both short targets and their neighbours", () => {
    const v = computeAnomalyView(units, { short: true, orphan: false }, "fr");
    expect(v.rows[1].cls).toBe("short");  // orphan filter off → classed as short
    expect(v.rows[3].cls).toBe("short");
    expect(v.rows.every((r) => r.visible)).toBe(true); // neighbours cover every index here
  });

  it("orphan class wins over short when a unit is both and both filters are active", () => {
    const v = computeAnomalyView(units, { short: true, orphan: true }, "fr");
    expect(v.rows[1].cls).toBe("orphan"); // idx 1 is short+orphan → orphan precedence
    expect(v.rows[3].cls).toBe("short");
  });
});
