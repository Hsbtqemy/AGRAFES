import { describe, it, expect } from "vitest";
import {
  filterApplyHistoryByScope,
  mergeApplyHistory,
  formatApplyHistoryRow,
  formatApplyHistoryList,
} from "../curationApplyHistory.ts";
import type { CurateApplyEvent } from "../sidecarClient.ts";

// ─── Test fixtures ───────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<CurateApplyEvent> = {}): CurateApplyEvent {
  return {
    applied_at: "2026-04-29T10:00:00.000Z",
    scope: "doc",
    doc_id: 1,
    docs_curated: 1,
    units_modified: 5,
    units_skipped: 2,
    ...overrides,
  } as CurateApplyEvent;
}

// ─── filterApplyHistoryByScope ──────────────────────────────────────────────

describe("filterApplyHistoryByScope", () => {
  const events = [
    makeEvent({ scope: "doc", applied_at: "T1" }),
    makeEvent({ scope: "all", applied_at: "T2" }),
    makeEvent({ scope: "doc", applied_at: "T3" }),
  ];

  it("'doc' garde uniquement scope=doc", () => {
    const r = filterApplyHistoryByScope(events, "doc");
    expect(r.map(e => e.applied_at)).toEqual(["T1", "T3"]);
  });

  it("'all' garde uniquement scope=all", () => {
    const r = filterApplyHistoryByScope(events, "all");
    expect(r.map(e => e.applied_at)).toEqual(["T2"]);
  });

  it("'' (empty) garde tout (passthrough)", () => {
    expect(filterApplyHistoryByScope(events, "")).toEqual(events);
  });

  it("liste vide → liste vide pour tout filtre", () => {
    expect(filterApplyHistoryByScope([], "")).toEqual([]);
    expect(filterApplyHistoryByScope([], "doc")).toEqual([]);
    expect(filterApplyHistoryByScope([], "all")).toEqual([]);
  });
});

// ─── mergeApplyHistory — invariants centraux ─────────────────────────────────

describe("mergeApplyHistory — invariants", () => {
  // Invariant 1 : ne jamais perdre un event session non-présent en DB
  it("Invariant 1 — append-only sur les events session non-présents en DB", () => {
    const session = [makeEvent({ id: undefined, applied_at: "T_session_1" })];
    const db: CurateApplyEvent[] = [];
    const merged = mergeApplyHistory(session, db);
    expect(merged).toHaveLength(1);
    expect(merged[0].applied_at).toBe("T_session_1");
  });

  // Invariant 2 : dedup par applied_at, DB gagne (synchro réussie)
  it("Invariant 2 — dedup par applied_at : DB version remplace session", () => {
    const session = [makeEvent({ id: undefined, applied_at: "T1", units_modified: 99 })];
    const db = [makeEvent({ id: 42, applied_at: "T1", units_modified: 5 })];
    const merged = mergeApplyHistory(session, db);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(42);
    expect(merged[0].units_modified).toBe(5);
  });

  // Invariant 3 : session events appear FIRST in merged
  it("Invariant 3 — session-first dans la liste mergée", () => {
    const session = [
      makeEvent({ id: undefined, applied_at: "T_session_1" }),
      makeEvent({ id: undefined, applied_at: "T_session_2" }),
    ];
    const db = [
      makeEvent({ id: 1, applied_at: "T_db_1" }),
      makeEvent({ id: 2, applied_at: "T_db_2" }),
    ];
    const merged = mergeApplyHistory(session, db);
    expect(merged.map(e => e.applied_at)).toEqual([
      "T_session_1", "T_session_2", "T_db_1", "T_db_2",
    ]);
  });

  // Invariant 4 : cap respecté
  it("Invariant 4 — cap respecté (default 50)", () => {
    const session = Array.from({ length: 30 }, (_, i) =>
      makeEvent({ id: undefined, applied_at: `T_s${i}` }));
    const db = Array.from({ length: 30 }, (_, i) =>
      makeEvent({ id: i, applied_at: `T_db${i}` }));
    const merged = mergeApplyHistory(session, db);
    expect(merged).toHaveLength(50);  // 30 session + 20 first db
  });

  it("Invariant 4 bis — cap custom respecté", () => {
    const session = [makeEvent({ id: undefined, applied_at: "T_s" })];
    const db = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ id: i, applied_at: `T_db${i}` }));
    const merged = mergeApplyHistory(session, db, { cap: 3 });
    expect(merged).toHaveLength(3);
    expect(merged[0].applied_at).toBe("T_s");
    expect(merged[1].applied_at).toBe("T_db0");
    expect(merged[2].applied_at).toBe("T_db1");
  });

  // Invariant 5 : filtrage par scope sur DB uniquement (préserve comportement
  // original asymétrique — session events sont volatiles, UX a toujours
  // montré tous les events session quel que soit le filtre. Si on veut
  // changer ça, follow-up séparé.)
  it("Invariant 5 — scope='doc' filtre DB uniquement, pas session", () => {
    const session = [
      makeEvent({ id: undefined, applied_at: "T_s_doc", scope: "doc" }),
      makeEvent({ id: undefined, applied_at: "T_s_all", scope: "all" }),
    ];
    const db = [
      makeEvent({ id: 1, applied_at: "T_db_doc", scope: "doc" }),
      makeEvent({ id: 2, applied_at: "T_db_all", scope: "all" }),
    ];
    const merged = mergeApplyHistory(session, db, { scope: "doc" });
    // Les 2 events session apparaissent (asymétrie préservée), DB filtrée.
    expect(merged.map(e => e.applied_at)).toEqual(["T_s_doc", "T_s_all", "T_db_doc"]);
  });

  it("Invariant 5 bis — scope='' (vide) ne filtre rien", () => {
    const session = [makeEvent({ id: undefined, applied_at: "T_s", scope: "doc" })];
    const db = [makeEvent({ id: 1, applied_at: "T_db", scope: "all" })];
    const merged = mergeApplyHistory(session, db, { scope: "" });
    expect(merged).toHaveLength(2);
  });

  it("listes vides → liste vide", () => {
    expect(mergeApplyHistory([], [])).toEqual([]);
  });

  it("DB seul → events DB seuls (pas de session)", () => {
    const db = [makeEvent({ id: 1, applied_at: "T1" })];
    const merged = mergeApplyHistory([], db);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(1);
  });
});

// ─── formatApplyHistoryRow — invariants HTML ────────────────────────────────

describe("formatApplyHistoryRow — invariants markup", () => {
  // Invariant 6 : robustesse fields manquants
  it("Invariant 6 — applied_at manquant → fallback —", () => {
    const ev = makeEvent({ applied_at: "" });
    const html = formatApplyHistoryRow(ev);
    expect(html).toContain("—");
  });

  it("Invariant 6 — doc_title et doc_id null → fallback —", () => {
    const ev = makeEvent({ doc_title: null, doc_id: null });
    const html = formatApplyHistoryRow(ev);
    // Le label affiché contient "—"
    expect(html).toMatch(/prep-apply-hist-doc[^>]*>—</);
  });

  it("Invariant 6 — doc_title null mais doc_id défini → #id", () => {
    const ev = makeEvent({ doc_title: null, doc_id: 42 });
    const html = formatApplyHistoryRow(ev);
    expect(html).toMatch(/prep-apply-hist-doc[^>]*>#42</);
  });

  it("Invariant 6 — units_modified/units_skipped 0 affichés", () => {
    const ev = makeEvent({ units_modified: 0, units_skipped: 0 });
    const html = formatApplyHistoryRow(ev);
    expect(html).toContain("0 mod. / 0 saut.");
  });

  it("Invariant 6 — ignored_count/manual_override_count undefined → pas de section extras", () => {
    const ev = makeEvent({ ignored_count: undefined, manual_override_count: undefined });
    const html = formatApplyHistoryRow(ev);
    expect(html).not.toContain("prep-apply-hist-extras");
  });

  // Invariant 7 : session marker
  it("Invariant 7 — id=undefined → classe apply-hist-row--session", () => {
    const ev = makeEvent({ id: undefined });
    const html = formatApplyHistoryRow(ev);
    expect(html).toContain("apply-hist-row--session");
  });

  it("Invariant 7 bis — id défini → pas de classe session", () => {
    const ev = makeEvent({ id: 42 });
    const html = formatApplyHistoryRow(ev);
    expect(html).not.toContain("apply-hist-row--session");
  });

  it("scope='doc' → label 'Document'", () => {
    const html = formatApplyHistoryRow(makeEvent({ scope: "doc" }));
    expect(html).toContain(">Document</");
    expect(html).toContain("apply-hist-scope--doc");
  });

  it("scope='all' → label 'Corpus'", () => {
    const html = formatApplyHistoryRow(makeEvent({ scope: "all" }));
    expect(html).toContain(">Corpus</");
    expect(html).toContain("apply-hist-scope--all");
  });

  it("ignored_count > 0 → section extras avec 'ign.'", () => {
    const html = formatApplyHistoryRow(makeEvent({ ignored_count: 3 }));
    expect(html).toContain("3 ign.");
  });

  it("manual_override_count > 0 → section extras avec 'man.'", () => {
    const html = formatApplyHistoryRow(makeEvent({ manual_override_count: 2 }));
    expect(html).toContain("2 man.");
  });

  it("ignored_count ET manual_override_count > 0 → joined par ' / '", () => {
    const html = formatApplyHistoryRow(makeEvent({ ignored_count: 3, manual_override_count: 2 }));
    expect(html).toContain("3 ign. / 2 man.");
  });
});

// ─── formatApplyHistoryList ──────────────────────────────────────────────────

describe("formatApplyHistoryList", () => {
  it("liste vide → empty-hint", () => {
    const html = formatApplyHistoryList([]);
    expect(html).toContain("empty-hint");
    expect(html).toContain("Aucun apply enregistré");
  });

  it("liste non-vide → concat des rows (pas de wrapper)", () => {
    const events = [
      makeEvent({ id: 1, applied_at: "T1" }),
      makeEvent({ id: 2, applied_at: "T2" }),
    ];
    const html = formatApplyHistoryList(events);
    // 2 occurrences de prep-apply-hist-row
    const rowCount = (html.match(/prep-apply-hist-row/g) || []).length;
    expect(rowCount).toBe(2);
    expect(html).not.toContain("empty-hint");
  });
});
