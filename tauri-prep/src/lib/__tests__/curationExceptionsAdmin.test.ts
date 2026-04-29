import { describe, it, expect } from "vitest";
import {
  filterExceptions,
  groupExceptionsByDoc,
  buildExcDocOptions,
  formatExcAdminRow,
  formatExcAdminList,
} from "../curationExceptionsAdmin.ts";
import type { CurateException } from "../sidecarClient.ts";

// ─── Test fixtures ───────────────────────────────────────────────────────────

function makeExc(overrides: Partial<CurateException> = {}): CurateException {
  return {
    id: 1,
    unit_id: 100,
    kind: "ignore",
    override_text: null,
    note: null,
    created_at: "2026-04-29T10:00:00",
    doc_id: 1,
    doc_title: "Doc One",
    unit_text: "Sample unit text",
    ...overrides,
  };
}

// ─── filterExceptions ────────────────────────────────────────────────────────

describe("filterExceptions", () => {
  const all = [
    makeExc({ unit_id: 1, kind: "ignore", doc_id: 10 }),
    makeExc({ unit_id: 2, kind: "override", doc_id: 10 }),
    makeExc({ unit_id: 3, kind: "ignore", doc_id: 20 }),
    makeExc({ unit_id: 4, kind: "override", doc_id: 20 }),
  ];

  it("Invariant 1 — kind='all' passthrough", () => {
    expect(filterExceptions(all, "all", 0)).toEqual(all);
  });

  it("Invariant 1 — kind='ignore' strict", () => {
    const r = filterExceptions(all, "ignore", 0);
    expect(r.map(e => e.unit_id)).toEqual([1, 3]);
  });

  it("Invariant 1 — kind='override' strict", () => {
    const r = filterExceptions(all, "override", 0);
    expect(r.map(e => e.unit_id)).toEqual([2, 4]);
  });

  it("Invariant 2 — docFilter=0 passthrough sur doc", () => {
    expect(filterExceptions(all, "all", 0).length).toBe(4);
  });

  it("Invariant 2 — docFilter=N filtre exact", () => {
    const r = filterExceptions(all, "all", 10);
    expect(r.map(e => e.unit_id)).toEqual([1, 2]);
  });

  it("Invariant 2 — docFilter ignore les exc sans doc_id", () => {
    const list = [makeExc({ unit_id: 99, doc_id: undefined }), ...all];
    const r = filterExceptions(list, "all", 10);
    expect(r.map(e => e.unit_id)).toEqual([1, 2]);
  });

  it("Invariant 3 — kind ∩ docFilter combinés", () => {
    const r = filterExceptions(all, "override", 20);
    expect(r.map(e => e.unit_id)).toEqual([4]);
  });

  it("liste vide → liste vide", () => {
    expect(filterExceptions([], "all", 0)).toEqual([]);
    expect(filterExceptions([], "ignore", 5)).toEqual([]);
  });
});

// ─── groupExceptionsByDoc ────────────────────────────────────────────────────

describe("groupExceptionsByDoc", () => {
  it("Invariant 4 — ordre préservé dans chaque groupe", () => {
    const list = [
      makeExc({ unit_id: 1, doc_id: 10 }),
      makeExc({ unit_id: 2, doc_id: 20 }),
      makeExc({ unit_id: 3, doc_id: 10 }),
      makeExc({ unit_id: 4, doc_id: 10 }),
    ];
    const grouped = groupExceptionsByDoc(list);
    expect(grouped.get("10")!.map(e => e.unit_id)).toEqual([1, 3, 4]);
    expect(grouped.get("20")!.map(e => e.unit_id)).toEqual([2]);
  });

  it("Invariant 4 — doc_id undefined → clé '?'", () => {
    const list = [
      makeExc({ unit_id: 1, doc_id: undefined }),
      makeExc({ unit_id: 2, doc_id: 10 }),
      makeExc({ unit_id: 3, doc_id: undefined }),
    ];
    const grouped = groupExceptionsByDoc(list);
    expect(grouped.get("?")!.map(e => e.unit_id)).toEqual([1, 3]);
    expect(grouped.get("10")!.map(e => e.unit_id)).toEqual([2]);
  });

  it("liste vide → Map vide", () => {
    expect(groupExceptionsByDoc([]).size).toBe(0);
  });
});

// ─── buildExcDocOptions ──────────────────────────────────────────────────────

describe("buildExcDocOptions", () => {
  it("Invariant 5 — dédup par doc_id", () => {
    const list = [
      makeExc({ unit_id: 1, doc_id: 10, doc_title: "A" }),
      makeExc({ unit_id: 2, doc_id: 10, doc_title: "A" }),
      makeExc({ unit_id: 3, doc_id: 20, doc_title: "B" }),
    ];
    const opts = buildExcDocOptions(list);
    expect(opts.size).toBe(2);
    expect(opts.get(10)).toBe("A");
    expect(opts.get(20)).toBe("B");
  });

  it("Invariant 5 — tri ascendant par doc_id", () => {
    const list = [
      makeExc({ unit_id: 1, doc_id: 30, doc_title: "C" }),
      makeExc({ unit_id: 2, doc_id: 10, doc_title: "A" }),
      makeExc({ unit_id: 3, doc_id: 20, doc_title: "B" }),
    ];
    const opts = buildExcDocOptions(list);
    expect([...opts.keys()]).toEqual([10, 20, 30]);
  });

  it("Invariant 5 — fallback 'Document #N' si doc_title null", () => {
    const list = [
      makeExc({ unit_id: 1, doc_id: 42, doc_title: null }),
    ];
    const opts = buildExcDocOptions(list);
    expect(opts.get(42)).toBe("Document #42");
  });

  it("Invariant 5 — fallback 'Document #N' si doc_title vide", () => {
    const list = [
      makeExc({ unit_id: 1, doc_id: 42, doc_title: "" }),
    ];
    const opts = buildExcDocOptions(list);
    expect(opts.get(42)).toBe("Document #42");
  });

  it("Invariant 5 — last-write-wins si même doc_id avec titres divergents", () => {
    // Préserve le comportement original (Map.set overwrite). Cas pathologique
    // mais possible si le sidecar enrichit différemment selon l'exception.
    const list = [
      makeExc({ unit_id: 1, doc_id: 10, doc_title: "Premier" }),
      makeExc({ unit_id: 2, doc_id: 10, doc_title: "Dernier" }),
    ];
    const opts = buildExcDocOptions(list);
    expect(opts.get(10)).toBe("Dernier");
  });

  it("ignore les exc sans doc_id", () => {
    const list = [
      makeExc({ unit_id: 1, doc_id: undefined }),
      makeExc({ unit_id: 2, doc_id: 5 }),
    ];
    const opts = buildExcDocOptions(list);
    expect(opts.size).toBe(1);
    expect(opts.get(5)).toBeDefined();
  });
});

// ─── formatExcAdminRow ───────────────────────────────────────────────────────

describe("formatExcAdminRow — invariants markup", () => {
  it("Invariant 6 — kind='ignore' : pas d'edit btn ni textarea ni override block", () => {
    const html = formatExcAdminRow(makeExc({ kind: "ignore" }), false);
    expect(html).not.toContain("prep-exc-row-edit-start");
    expect(html).not.toContain("prep-exc-edit-textarea");
    expect(html).not.toContain("prep-exc-override-text");
    expect(html).toContain("exc-kind-ignore");
  });

  it("Invariant 7 — kind='override' non-editing : edit btn + override block", () => {
    const html = formatExcAdminRow(
      makeExc({ kind: "override", override_text: "fix" }), false);
    expect(html).toContain("prep-exc-row-edit-start");
    expect(html).toContain("prep-exc-override-text");
    expect(html).toContain(">fix</");
    expect(html).not.toContain("prep-exc-edit-textarea");
  });

  it("Invariant 8 — kind='override' editing : textarea, PAS de bouton edit", () => {
    const html = formatExcAdminRow(
      makeExc({ kind: "override", override_text: "fix" }), true);
    expect(html).toContain("prep-exc-edit-textarea");
    expect(html).toContain("prep-exc-row-edit-save");
    expect(html).toContain("prep-exc-row-edit-cancel");
    expect(html).not.toContain("prep-exc-row-edit-start");
  });

  it("Invariant 8 — editing ignoré pour kind='ignore'", () => {
    const html = formatExcAdminRow(makeExc({ kind: "ignore" }), true);
    expect(html).not.toContain("prep-exc-edit-textarea");
  });

  it("Invariant 9 — doc_id undefined → pas de bouton 'ouvrir dans Curation'", () => {
    const html = formatExcAdminRow(makeExc({ doc_id: undefined }), false);
    expect(html).not.toContain("prep-exc-row-open-curation");
  });

  it("Invariant 9 — doc_id défini → bouton open présent", () => {
    const html = formatExcAdminRow(makeExc({ doc_id: 5 }), false);
    expect(html).toContain("prep-exc-row-open-curation");
  });

  it("Invariant 10 — escape HTML sur override_text", () => {
    const html = formatExcAdminRow(
      makeExc({ kind: "override", override_text: "<script>alert('x')</script>" }),
      false);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("Invariant 10 — escape HTML sur unit_text", () => {
    const html = formatExcAdminRow(
      makeExc({ unit_text: "a <b> & \"c\"" }), false);
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp;");
  });

  it("Invariant 10 — escape HTML sur override_text en mode editing (textarea)", () => {
    const html = formatExcAdminRow(
      makeExc({ kind: "override", override_text: "<x>" }), true);
    expect(html).toContain("&lt;x&gt;");
    expect(html).not.toContain("<x>");
  });

  it("data-exc-unit-id présent", () => {
    const html = formatExcAdminRow(makeExc({ unit_id: 777 }), false);
    expect(html).toContain('data-exc-unit-id="777"');
  });

  it("created_at tronqué à 16 chars + remplacement T→space", () => {
    const html = formatExcAdminRow(
      makeExc({ created_at: "2026-04-29T10:30:45.123Z" }), false);
    expect(html).toContain("2026-04-29 10:30");
  });

  it("unit_text absent → pas de bloc preview", () => {
    const html = formatExcAdminRow(makeExc({ unit_text: null }), false);
    expect(html).not.toContain("prep-exc-unit-preview-block");
  });

  it("unit_text > 80 chars tronqué", () => {
    const long = "a".repeat(120);
    const html = formatExcAdminRow(makeExc({ unit_text: long }), false);
    // 80 a's + ellipsis
    expect(html).toContain("a".repeat(80) + "…");
  });
});

// ─── formatExcAdminList ──────────────────────────────────────────────────────

describe("formatExcAdminList", () => {
  it("Invariant 11 — totalIsEmpty=true → 'Aucune exception persistée'", () => {
    const html = formatExcAdminList([], {
      editingUnitId: null, showDocHeads: true, totalIsEmpty: true });
    expect(html).toContain("Aucune exception persistée");
  });

  it("Invariant 12 — filtered vide mais total non-vide → 'Aucun résultat'", () => {
    const html = formatExcAdminList([], {
      editingUnitId: null, showDocHeads: true, totalIsEmpty: false });
    expect(html).toContain("Aucun résultat pour ce filtre");
    expect(html).not.toContain("Aucune exception persistée");
  });

  it("Invariant 13 — showDocHeads=true affiche les heads", () => {
    const list = [
      makeExc({ unit_id: 1, doc_id: 10, doc_title: "Doc Ten" }),
      makeExc({ unit_id: 2, doc_id: 20, doc_title: "Doc Twenty" }),
    ];
    const html = formatExcAdminList(list, {
      editingUnitId: null, showDocHeads: true, totalIsEmpty: false });
    expect(html).toContain("prep-exc-admin-doc-head");
    expect(html).toContain(">Doc Ten<");
    expect(html).toContain(">Doc Twenty<");
  });

  it("Invariant 13 — showDocHeads=false n'affiche PAS les heads", () => {
    const list = [
      makeExc({ unit_id: 1, doc_id: 10, doc_title: "Doc Ten" }),
    ];
    const html = formatExcAdminList(list, {
      editingUnitId: null, showDocHeads: false, totalIsEmpty: false });
    expect(html).not.toContain("prep-exc-admin-doc-head");
  });

  it("Invariant 13 — head escape HTML", () => {
    const list = [
      makeExc({ unit_id: 1, doc_id: 10, doc_title: "<evil>" }),
    ];
    const html = formatExcAdminList(list, {
      editingUnitId: null, showDocHeads: true, totalIsEmpty: false });
    expect(html).toContain("&lt;evil&gt;");
    expect(html).not.toContain("<evil>");
  });

  it("editingUnitId actif → seule cette row a le textarea", () => {
    const list = [
      makeExc({ unit_id: 1, kind: "override", override_text: "a" }),
      makeExc({ unit_id: 2, kind: "override", override_text: "b" }),
    ];
    const html = formatExcAdminList(list, {
      editingUnitId: 1, showDocHeads: false, totalIsEmpty: false });
    // 1 textarea seulement
    const taCount = (html.match(/prep-exc-edit-textarea/g) || []).length;
    expect(taCount).toBe(1);
    expect(html).toContain('id="exc-edit-1"');
  });

  it("doc_title undefined → pas de head même si showDocHeads=true", () => {
    // Cas du sidecar legacy sans enrichment
    const list = [
      makeExc({ unit_id: 1, doc_id: 10, doc_title: undefined }),
    ];
    const html = formatExcAdminList(list, {
      editingUnitId: null, showDocHeads: true, totalIsEmpty: false });
    expect(html).not.toContain("prep-exc-admin-doc-head");
  });
});
