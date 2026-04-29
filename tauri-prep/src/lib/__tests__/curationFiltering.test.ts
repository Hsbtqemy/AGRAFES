import { describe, it, expect } from "vitest";
import { filterExamples, getRuleStats } from "../curationFiltering.ts";
import type { CuratePreviewExample } from "../sidecarClient.ts";

function ex(overrides: Partial<CuratePreviewExample> = {}): CuratePreviewExample {
  return {
    unit_id: 1,
    external_id: 1,
    before: "before",
    after: "after",
    matched_rule_ids: [],
    ...overrides,
  } as CuratePreviewExample;
}

// ─── filterExamples ──────────────────────────────────────────────────────────

describe("filterExamples", () => {
  const labels = ["Espaces", "Quotes", "Punct"];
  const examples = [
    ex({ unit_id: 1, matched_rule_ids: [0],     status: "pending" }),
    ex({ unit_id: 2, matched_rule_ids: [1],     status: "accepted" }),
    ex({ unit_id: 3, matched_rule_ids: [0, 2],  status: "ignored" }),
    ex({ unit_id: 4, matched_rule_ids: [],      status: "pending" }),
  ];

  it("Invariant 1 — ruleFilter=null passthrough", () => {
    const r = filterExamples(examples, null, null, labels);
    expect(r.map(e => e.unit_id)).toEqual([1, 2, 3, 4]);
  });

  it("Invariant 2 — ruleFilter='Espaces' → ex contenant 'Espaces'", () => {
    const r = filterExamples(examples, "Espaces", null, labels);
    expect(r.map(e => e.unit_id)).toEqual([1, 3]);
  });

  it("Invariant 2 — ruleFilter='Punct' → ex matchant Punct (3 a 0+2)", () => {
    const r = filterExamples(examples, "Punct", null, labels);
    expect(r.map(e => e.unit_id)).toEqual([3]);
  });

  it("Invariant 3 — statusFilter=null passthrough", () => {
    const r = filterExamples(examples, null, null, labels);
    expect(r).toHaveLength(4);
  });

  it("Invariant 3 — statusFilter='pending' strict", () => {
    const r = filterExamples(examples, null, "pending", labels);
    expect(r.map(e => e.unit_id)).toEqual([1, 4]);
  });

  it("Invariant 3 — statusFilter='accepted' strict", () => {
    const r = filterExamples(examples, null, "accepted", labels);
    expect(r.map(e => e.unit_id)).toEqual([2]);
  });

  it("Invariant 4 — status absent → traité comme 'pending'", () => {
    const list = [
      ex({ unit_id: 5, status: undefined }),
      ex({ unit_id: 6, status: "pending" }),
      ex({ unit_id: 7, status: "accepted" }),
    ];
    const r = filterExamples(list, null, "pending", labels);
    expect(r.map(e => e.unit_id)).toEqual([5, 6]);
  });

  it("Invariant 5 — matched_rule_ids absent → jamais matché par ruleFilter non-null", () => {
    const list = [ex({ unit_id: 9, matched_rule_ids: undefined })];
    expect(filterExamples(list, "Espaces", null, labels)).toHaveLength(0);
    expect(filterExamples(list, null, null, labels)).toHaveLength(1);
  });

  it("Invariant 6 — ruleLabels[idx] manquant → '' (n'égale aucun ruleFilter non-vide)", () => {
    const list = [ex({ unit_id: 1, matched_rule_ids: [99] })];
    expect(filterExamples(list, "Espaces", null, labels)).toHaveLength(0);
    // Mais si ruleFilter est "" string vide → c'est interprété comme falsy donc passthrough
    expect(filterExamples(list, "", null, labels)).toHaveLength(1);
  });

  it("Invariant 7 — combinaison rule ∩ status (AND)", () => {
    const r = filterExamples(examples, "Espaces", "ignored", labels);
    expect(r.map(e => e.unit_id)).toEqual([3]);
  });

  it("Invariant 7 — combinaison rule ∩ status sans match", () => {
    const r = filterExamples(examples, "Quotes", "ignored", labels);
    expect(r).toHaveLength(0);
  });

  it("liste vide → liste vide", () => {
    expect(filterExamples([], null, null, labels)).toEqual([]);
    expect(filterExamples([], "Espaces", "pending", labels)).toEqual([]);
  });

  it("ruleLabels vide → seul ruleFilter=null donne des résultats", () => {
    expect(filterExamples(examples, "Espaces", null, [])).toEqual([]);
    expect(filterExamples(examples, null, null, [])).toHaveLength(4);
  });
});

// ─── getRuleStats ────────────────────────────────────────────────────────────

describe("getRuleStats", () => {
  const labels = ["Espaces", "Quotes", "Punct"];

  it("compte simple — chaque ex compte 1× par label", () => {
    const examples = [
      ex({ matched_rule_ids: [0] }),
      ex({ matched_rule_ids: [0] }),
      ex({ matched_rule_ids: [1] }),
    ];
    const stats = getRuleStats(examples, labels);
    expect(stats.get("Espaces")).toBe(2);
    expect(stats.get("Quotes")).toBe(1);
    expect(stats.has("Punct")).toBe(false);
  });

  it("Invariant 8 — un ex avec 2 idx vers le même label compte 1×", () => {
    // Cas pathologique mais possible si ruleLabels a des doublons
    const dupLabels = ["A", "A", "B"];
    const examples = [ex({ matched_rule_ids: [0, 1] })];
    const stats = getRuleStats(examples, dupLabels);
    expect(stats.get("A")).toBe(1);
  });

  it("Invariant 8 — un ex avec idx distincts vers labels distincts compte 1× chaque", () => {
    const examples = [ex({ matched_rule_ids: [0, 2] })];
    const stats = getRuleStats(examples, labels);
    expect(stats.get("Espaces")).toBe(1);
    expect(stats.get("Punct")).toBe(1);
  });

  it("Invariant 9 — ruleLabels[idx] manquant → fallback 'règle N+1'", () => {
    const examples = [ex({ matched_rule_ids: [99] })];
    const stats = getRuleStats(examples, labels);
    expect(stats.get("règle 100")).toBe(1);
  });

  it("matched_rule_ids vide → pas de stats pour cet ex", () => {
    const examples = [ex({ matched_rule_ids: [] }), ex({ matched_rule_ids: [0] })];
    const stats = getRuleStats(examples, labels);
    expect(stats.get("Espaces")).toBe(1);
    expect(stats.size).toBe(1);
  });

  it("matched_rule_ids absent → pas de stats", () => {
    const examples = [ex({ matched_rule_ids: undefined })];
    const stats = getRuleStats(examples, labels);
    expect(stats.size).toBe(0);
  });

  it("liste vide → Map vide", () => {
    expect(getRuleStats([], labels).size).toBe(0);
  });
});
