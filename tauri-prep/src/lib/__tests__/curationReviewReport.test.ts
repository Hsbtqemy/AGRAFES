import { describe, it, expect } from "vitest";
import {
  buildReviewReportPayload,
  buildReviewReportCsv,
  type ReviewReportContext,
} from "../curationReviewReport.ts";
import type { CuratePreviewExample, CurateException } from "../sidecarClient.ts";

// ─── Test fixtures ───────────────────────────────────────────────────────────

function makeExample(overrides: Partial<CuratePreviewExample> = {}): CuratePreviewExample {
  return {
    unit_id: 1,
    external_id: null,
    before: "avant",
    after: "après",
    ...overrides,
  } as CuratePreviewExample;
}

function makeException(overrides: Partial<CurateException> = {}): CurateException {
  return {
    id: 1,
    unit_id: 1,
    kind: "ignore",
    override_text: null,
    note: null,
    created_at: "2026-04-29T10:00:00.000Z",
    ...overrides,
  } as CurateException;
}

function makeContext(overrides: Partial<ReviewReportContext> = {}): ReviewReportContext {
  return {
    docId: 7,
    docTitle: "Doc 7",
    examples: [],
    globalChanged: 0,
    unitsTotal: 0,
    ruleLabels: [],
    exceptions: new Map(),
    lastApplyResult: null,
    exportedAt: "2026-06-26T12:00:00.000Z",
    ...overrides,
  };
}

// ─── buildReviewReportPayload ───────────────────────────────────────────────

describe("buildReviewReportPayload", () => {
  it("exported_at provient du contexte, jamais d'une horloge interne", () => {
    const p = buildReviewReportPayload(makeContext({ exportedAt: "2030-01-01T00:00:00.000Z" })) as Record<string, unknown>;
    expect(p.exported_at).toBe("2030-01-01T00:00:00.000Z");
    expect(p.report_type).toBe("curation_review_session");
  });

  it("compte pending/accepted/ignored et manual_overrides", () => {
    const examples = [
      makeExample({ unit_id: 1, status: "accepted" }),
      makeExample({ unit_id: 2, status: "ignored" }),
      makeExample({ unit_id: 3 }), // status absent → pending implicite
      makeExample({ unit_id: 4, status: "pending", is_manual_override: true }),
    ];
    const p = buildReviewReportPayload(makeContext({ examples })) as { summary: Record<string, number> };
    expect(p.summary).toEqual({ pending: 2, accepted: 1, ignored: 1, manual_overrides: 1 });
  });

  it("truncated=true et note de troncature en tête quand globalChanged > items", () => {
    const examples = [makeExample({ unit_id: 1 })];
    const p = buildReviewReportPayload(makeContext({ examples, globalChanged: 10 })) as {
      sample: { truncated: boolean }; notes: string[];
    };
    expect(p.sample.truncated).toBe(true);
    expect(p.notes[0]).toContain("Preview tronquée");
    expect(p.notes[0]).toContain("1 item(s) affichés sur 10");
  });

  it("truncated=false et pas de note de troncature quand tout est affiché", () => {
    const examples = [makeExample({ unit_id: 1 }), makeExample({ unit_id: 2 })];
    const p = buildReviewReportPayload(makeContext({ examples, globalChanged: 2 })) as {
      sample: { truncated: boolean }; notes: string[];
    };
    expect(p.sample.truncated).toBe(false);
    expect(p.notes.some(n => n.includes("Preview tronquée"))).toBe(false);
    // La note "session en mémoire" est toujours présente.
    expect(p.notes.some(n => n.includes("session courante"))).toBe(true);
  });

  it("effective_after = manual_after si override manuel, sinon after", () => {
    const examples = [
      makeExample({ unit_id: 1, after: "auto", is_manual_override: true, manual_after: "manuel" }),
      makeExample({ unit_id: 2, after: "auto2", is_manual_override: false }),
      // override manuel mais manual_after absent → fallback sur after
      makeExample({ unit_id: 3, after: "auto3", is_manual_override: true }),
    ];
    const p = buildReviewReportPayload(makeContext({ examples })) as { items: Array<{ effective_after: string }> };
    expect(p.items.map(i => i.effective_after)).toEqual(["manuel", "auto2", "auto3"]);
  });

  it("matched_rules mappe les index sur les labels, fallback hors plage", () => {
    const examples = [makeExample({ unit_id: 1, matched_rule_ids: [0, 2] })];
    const ruleLabels = ["Règle A"]; // index 2 est hors plage
    const p = buildReviewReportPayload(makeContext({ examples, ruleLabels })) as {
      items: Array<{ matched_rules: string[] }>;
    };
    expect(p.items[0].matched_rules).toEqual(["Règle A", "règle 3"]);
  });

  it("joint l'exception persistée uniquement si l'unité en possède une", () => {
    const examples = [makeExample({ unit_id: 1 }), makeExample({ unit_id: 2 })];
    const exceptions = new Map<number, CurateException>([
      [1, makeException({ unit_id: 1, kind: "override", override_text: "X" })],
    ]);
    const p = buildReviewReportPayload(makeContext({ examples, exceptions })) as {
      items: Array<{ persistent_exception: { kind: string; text: string | null } | null }>;
    };
    expect(p.items[0].persistent_exception).toEqual({ kind: "override", text: "X" });
    expect(p.items[1].persistent_exception).toBeNull();
  });

  it("propage doc_id/doc_title et copie défensive des rules", () => {
    const ruleLabels = ["A", "B"];
    const p = buildReviewReportPayload(makeContext({ docId: 42, docTitle: "T", ruleLabels })) as {
      doc_id: number | null; doc_title: string | null; rules: string[];
    };
    expect(p.doc_id).toBe(42);
    expect(p.doc_title).toBe("T");
    expect(p.rules).toEqual(["A", "B"]);
    expect(p.rules).not.toBe(ruleLabels); // copie, pas la référence
  });
});

// ─── buildReviewReportCsv ────────────────────────────────────────────────────

describe("buildReviewReportCsv", () => {
  it("émet l'en-tête de colonnes en première ligne", () => {
    const csv = buildReviewReportCsv(makeContext());
    const header = csv.split("\n")[0];
    expect(header).toBe("unit_id,unit_index,status,is_manual_override,before,after,effective_after,matched_rules,preview_reason,context_before,context_after,persistent_exception_kind");
  });

  it("une ligne par exemple, avec valeurs par défaut", () => {
    const examples = [makeExample({ unit_id: 5, unit_index: 2, before: "a", after: "b" })];
    const csv = buildReviewReportCsv(makeContext({ examples }));
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("5,2,pending,false,a,b,b,,standard,,,");
  });

  it("échappe les champs contenant virgule, guillemet ou retour ligne", () => {
    const examples = [makeExample({ unit_id: 1, before: 'a,b', after: 'c"d', context_before: "e\nf" })];
    const csv = buildReviewReportCsv(makeContext({ examples }));
    const row = csv.split("\n").slice(1).join("\n");
    expect(row).toContain('"a,b"');
    expect(row).toContain('"c""d"');
    expect(row).toContain('"e\nf"');
  });

  it("effective_after et matched_rules cohérents avec le JSON", () => {
    const examples = [makeExample({ unit_id: 1, after: "auto", is_manual_override: true, manual_after: "man", matched_rule_ids: [0, 9] })];
    const ruleLabels = ["R1"];
    const csv = buildReviewReportCsv(makeContext({ examples, ruleLabels }));
    const cells = csv.split("\n")[1].split(",");
    // is_manual_override (col 3) → true ; effective_after (col 6) → man
    expect(cells[3]).toBe("true");
    expect(cells[6]).toBe("man");
    // matched_rules (col 7) groupe label + fallback "r10" joints par "; " ;
    // pas de guillemets car le séparateur "; " ne contient pas de virgule.
    expect(cells[7]).toBe("R1; r10");
  });

  it("persistent_exception_kind reflète l'exception persistée", () => {
    const examples = [makeExample({ unit_id: 1 }), makeExample({ unit_id: 2 })];
    const exceptions = new Map<number, CurateException>([
      [2, makeException({ unit_id: 2, kind: "override", override_text: "z" })],
    ]);
    const csv = buildReviewReportCsv(makeContext({ examples, exceptions }));
    const lines = csv.split("\n");
    expect(lines[1].split(",").pop()).toBe(""); // unité 1 : pas d'exception
    expect(lines[2].split(",").pop()).toBe("override"); // unité 2
  });
});
