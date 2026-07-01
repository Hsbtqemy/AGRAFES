/**
 * Tests for the pure-ish query helpers exported from features/query.ts (U-03).
 *
 * computeHitStats / applySortToHits are pure over their hits argument;
 * hasActiveFilters / activeFiltersSummary are pure over the shared state
 * singleton (reset before each test). happy-dom is the global env (vite.config).
 * These were exported solely to be testable — same pattern as buildFtsQuery in
 * search.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../../state";
import {
  computeHitStats,
  applySortToHits,
  hasActiveFilters,
  activeFiltersSummary,
} from "../query";
import type { QueryHit, FamilyRecord } from "../../lib/sidecarClient";

function hit(overrides: Partial<QueryHit> = {}): QueryHit {
  return { doc_id: 1, unit_id: 1, external_id: null, language: "fr", title: "Doc 1", ...overrides };
}

function makeFamily(id: number, title: string): FamilyRecord {
  return {
    family_id: id,
    parent: { doc_id: id, title, language: "fr", doc_role: null, resource_type: null },
    children: [],
    stats: {},
  } as unknown as FamilyRecord;
}

function resetState(): void {
  state.filterLangs = [];
  state.filterRole = "";
  state.filterResourceType = "";
  state.filterUnitStatus = "";
  state.filterFamilyId = null;
  state.filterFamilyPivotOnly = false;
  state.filterDocIds = null;
  state.filterAuthor = "";
  state.filterTitleSearch = "";
  state.filterDateFrom = "";
  state.filterDateTo = "";
  state.filterSourceExt = "";
  state.filterFederatedDbPaths = [];
  state.families = [];
  state.docs = [];
  state.dbPath = null;
  state.builderMode = "simple";
  state.sortMode = "natural";
}

beforeEach(resetState);

// ─── computeHitStats ─────────────────────────────────────────────────────────

describe("computeHitStats", () => {
  it("compte les hits par document et collecte les langues distinctes", () => {
    const s = computeHitStats([
      hit({ doc_id: 1, language: "fr" }),
      hit({ doc_id: 1, language: "fr" }),
      hit({ doc_id: 2, language: "en" }),
    ]);
    expect(s.docCountMap.get(1)?.count).toBe(2);
    expect(s.docCountMap.get(2)?.count).toBe(1);
    expect([...s.langSet].sort()).toEqual(["en", "fr"]);
  });

  it("topDocs triés par count décroissant et plafonnés à 5", () => {
    const hits: QueryHit[] = [];
    for (let d = 1; d <= 7; d++) for (let i = 0; i < d; i++) hits.push(hit({ doc_id: d, title: `Doc ${d}` }));
    const s = computeHitStats(hits);
    expect(s.topDocs).toHaveLength(5);
    expect(s.topDocs.map((t) => t.docId)).toEqual([7, 6, 5, 4, 3]);
    expect(s.topDocs[0].count).toBe(7);
  });

  it("title vide → fallback 'Doc #id'", () => {
    const s = computeHitStats([hit({ doc_id: 9, title: "" })]);
    expect(s.docCountMap.get(9)?.title).toBe("Doc #9");
  });

  it("aucun hit → structures vides", () => {
    const s = computeHitStats([]);
    expect(s.docCountMap.size).toBe(0);
    expect(s.langSet.size).toBe(0);
    expect(s.topDocs).toHaveLength(0);
  });
});

// ─── applySortToHits ─────────────────────────────────────────────────────────

describe("applySortToHits", () => {
  it("mode 'natural' → renvoie le tableau original (pas de copie)", () => {
    state.sortMode = "natural";
    const hits = [hit({ doc_id: 2 }), hit({ doc_id: 1 })];
    expect(applySortToHits(hits)).toBe(hits);
  });

  it("mode 'by-doc' → copie triée par doc_id puis external_id", () => {
    state.sortMode = "by-doc";
    const hits = [
      hit({ doc_id: 2, unit_id: 50, external_id: null }),
      hit({ doc_id: 1, unit_id: 99, external_id: 5 }),
      hit({ doc_id: 1, unit_id: 10, external_id: 2 }),
    ];
    const sorted = applySortToHits(hits);
    expect(sorted).not.toBe(hits);
    expect(sorted.map((h) => [h.doc_id, h.external_id ?? h.unit_id])).toEqual([[1, 2], [1, 5], [2, 50]]);
  });

  it("external_id null → tri secondaire sur unit_id", () => {
    state.sortMode = "by-doc";
    const hits = [
      hit({ doc_id: 1, unit_id: 30, external_id: null }),
      hit({ doc_id: 1, unit_id: 10, external_id: null }),
    ];
    expect(applySortToHits(hits).map((h) => h.unit_id)).toEqual([10, 30]);
  });
});

// ─── hasActiveFilters ────────────────────────────────────────────────────────

describe("hasActiveFilters", () => {
  it("aucun filtre → false", () => {
    expect(hasActiveFilters()).toBe(false);
  });

  it.each([
    ["filterRole", () => { state.filterRole = "source"; }],
    ["filterUnitStatus", () => { state.filterUnitStatus = "non_traduit"; }],
    ["filterLangs", () => { state.filterLangs = ["fr"]; }],
    ["filterDocIds (même vide)", () => { state.filterDocIds = []; }],
    ["filterAuthor", () => { state.filterAuthor = "Hugo"; }],
    ["filterDateFrom", () => { state.filterDateFrom = "1800"; }],
    ["filterSourceExt", () => { state.filterSourceExt = ".docx"; }],
  ])("un filtre actif (%s) → true", (_label, set) => {
    set();
    expect(hasActiveFilters()).toBe(true);
  });
});

// ─── activeFiltersSummary ────────────────────────────────────────────────────

describe("activeFiltersSummary", () => {
  it("aucun filtre → chaîne vide", () => {
    expect(activeFiltersSummary()).toBe("");
  });

  it("joint les filtres actifs par ' · ' dans l'ordre canonique", () => {
    state.filterLangs = ["fr", "en"];
    state.filterRole = "source";
    state.filterAuthor = "Hugo";
    expect(activeFiltersSummary()).toBe("Langue : fr, en · Rôle : source · Auteur : Hugo");
  });

  it("plage de dates avec borne manquante → '…'", () => {
    state.filterDateFrom = "1800";
    expect(activeFiltersSummary()).toBe("Date : 1800 – …");
  });

  it("famille résout le titre du parent (+ original uniquement)", () => {
    state.filterFamilyId = 3;
    state.filterFamilyPivotOnly = true;
    state.families = [makeFamily(3, "Notre-Dame")];
    expect(activeFiltersSummary()).toContain("Famille : Notre-Dame (original uniquement)");
  });

  it("famille absente du cache → fallback 'Famille #id'", () => {
    state.filterFamilyId = 42;
    expect(activeFiltersSummary()).toContain("Famille : Famille #42");
  });
});
