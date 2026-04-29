import { describe, it, expect } from "vitest";
import {
  formatDiffEmptyMessage,
  formatDiffStatusBadge,
  formatDiffOverrideBadge,
  formatDiffExceptionBadge,
  formatDiffForcedBadge,
  getRuleLabelsForExample,
  formatDiffRuleBadges,
  getDiffRowClasses,
  formatDiffPaginationLabel,
  formatDiffRowTitle,
} from "../curationDiffList.ts";
import type { CuratePreviewExample } from "../sidecarClient.ts";

function ex(overrides: Partial<CuratePreviewExample> = {}): CuratePreviewExample {
  return {
    unit_id: 1, external_id: 1, before: "a", after: "b",
    matched_rule_ids: [],
    ...overrides,
  } as CuratePreviewExample;
}

// ─── formatDiffEmptyMessage ─────────────────────────────────────────────────

describe("formatDiffEmptyMessage", () => {
  it("Invariant 1 — ruleFilter prioritaire", () => {
    const html = formatDiffEmptyMessage("Espaces", 100);
    expect(html).toContain("Espaces");
    expect(html).toContain("diff-pane-clear-filter");
  });

  it("Invariant 1 — escape HTML sur ruleFilter", () => {
    const html = formatDiffEmptyMessage("<x>", 100);
    expect(html).not.toContain("<x>");
    expect(html).toContain("&lt;x&gt;");
  });

  it("Invariant 2 — !ruleFilter && totalChanged=0 → 'document propre'", () => {
    const html = formatDiffEmptyMessage(null, 0);
    expect(html).toContain("document propre");
    expect(html).not.toContain("clear-filter");
  });

  it("Invariant 3 — !ruleFilter && totalChanged>0 → 'Aucun exemple'", () => {
    const html = formatDiffEmptyMessage(null, 50);
    expect(html).toContain("Aucun exemple");
    expect(html).not.toContain("document propre");
  });

  it("wrapper p.empty-hint avec padding", () => {
    expect(formatDiffEmptyMessage(null, 0)).toContain('class="empty-hint" style="padding:8px"');
  });
});

// ─── formatDiffStatusBadge ───────────────────────────────────────────────────

describe("formatDiffStatusBadge", () => {
  it("Invariant 4 — pending → ''", () => {
    expect(formatDiffStatusBadge("pending", "En attente")).toBe("");
  });

  it("Invariant 5 — accepted → ✓", () => {
    const html = formatDiffStatusBadge("accepted", "Acceptée");
    expect(html).toContain("✓");
    expect(html).toContain("prep-diff-status-accepted");
  });

  it("Invariant 5 — ignored → ✗", () => {
    const html = formatDiffStatusBadge("ignored", "Ignorée");
    expect(html).toContain("✗");
    expect(html).toContain("prep-diff-status-ignored");
  });

  it("Invariant 4 — escape HTML sur statusLabel", () => {
    const html = formatDiffStatusBadge("accepted", "<x>");
    expect(html).toContain("&lt;x&gt;");
  });
});

// ─── formatDiffOverrideBadge ─────────────────────────────────────────────────

describe("formatDiffOverrideBadge", () => {
  it("Invariant 6 — true → ✏", () => {
    expect(formatDiffOverrideBadge(true)).toContain("✏");
  });

  it("Invariant 6 — false/undefined → ''", () => {
    expect(formatDiffOverrideBadge(false)).toBe("");
    expect(formatDiffOverrideBadge(undefined)).toBe("");
  });
});

// ─── formatDiffExceptionBadge ────────────────────────────────────────────────

describe("formatDiffExceptionBadge", () => {
  it("Invariant 7 — ni ignored ni override → ''", () => {
    expect(formatDiffExceptionBadge(false, false)).toBe("");
    expect(formatDiffExceptionBadge(undefined, undefined)).toBe("");
  });

  it("Invariant 7 — ignored prioritaire pour le title", () => {
    const html = formatDiffExceptionBadge(true, true);
    expect(html).toContain("ignoré durablement");
    expect(html).not.toContain("override durable");
  });

  it("override seul → title override", () => {
    const html = formatDiffExceptionBadge(false, true);
    expect(html).toContain("override durable");
  });

  it("ignored seul → title ignoré", () => {
    const html = formatDiffExceptionBadge(true, false);
    expect(html).toContain("ignoré durablement");
  });

  it("badge contient l'icône cadenas", () => {
    expect(formatDiffExceptionBadge(true, false)).toContain("🔒");
  });
});

// ─── formatDiffForcedBadge ───────────────────────────────────────────────────

describe("formatDiffForcedBadge", () => {
  it("Invariant 8 — null/undefined → ''", () => {
    expect(formatDiffForcedBadge(null)).toBe("");
    expect(formatDiffForcedBadge(undefined)).toBe("");
  });

  it("Invariant 8 — 'standard' → ''", () => {
    expect(formatDiffForcedBadge("standard")).toBe("");
  });

  it("Invariant 8 — 'forced' → title + classe forced", () => {
    const html = formatDiffForcedBadge("forced");
    expect(html).toContain("prep-diff-forced-forced");
    expect(html).toContain("Ouverture ciblée depuis Exceptions");
  });

  it("Invariant 8 — 'forced_ignored' → title spécifique", () => {
    const html = formatDiffForcedBadge("forced_ignored");
    expect(html).toContain("neutralisée par exception ignore");
  });

  it("Invariant 8 — 'forced_no_change' → title spécifique", () => {
    const html = formatDiffForcedBadge("forced_no_change");
    expect(html).toContain("aucune modification active");
  });
});

// ─── getRuleLabelsForExample ─────────────────────────────────────────────────

describe("getRuleLabelsForExample", () => {
  const labels = ["Espaces", "Quotes", "Punct"];

  it("Invariant 9 — dedup", () => {
    const dupLabels = ["A", "A", "B"];
    const e = ex({ matched_rule_ids: [0, 1, 2] });
    const out = getRuleLabelsForExample(e, dupLabels);
    expect(out).toEqual(["A", "B"]);
  });

  it("Invariant 9 — fallback 'r${idx+1}'", () => {
    const e = ex({ matched_rule_ids: [99] });
    expect(getRuleLabelsForExample(e, labels)).toEqual(["r100"]);
  });

  it("matched_rule_ids absent → []", () => {
    expect(getRuleLabelsForExample(ex({ matched_rule_ids: undefined }), labels)).toEqual([]);
  });

  it("matched_rule_ids vide → []", () => {
    expect(getRuleLabelsForExample(ex({ matched_rule_ids: [] }), labels)).toEqual([]);
  });

  it("ordre préservé (premier hit per label)", () => {
    const e = ex({ matched_rule_ids: [2, 0, 1] });
    expect(getRuleLabelsForExample(e, labels)).toEqual(["Punct", "Espaces", "Quotes"]);
  });
});

// ─── formatDiffRuleBadges ────────────────────────────────────────────────────

describe("formatDiffRuleBadges", () => {
  it("Invariant 10 — labels vides → badge unknown '—'", () => {
    const html = formatDiffRuleBadges([]);
    expect(html).toContain("prep-diff-rule-badge-unknown");
    expect(html).toContain("—");
  });

  it("Invariant 10 — escape HTML sur labels", () => {
    const html = formatDiffRuleBadges(["<x>"]);
    expect(html).toContain("&lt;x&gt;");
    expect(html).not.toContain("<span class=\"prep-diff-rule-badge\"><x>");
  });

  it("plusieurs labels → join par espace", () => {
    const html = formatDiffRuleBadges(["A", "B"]);
    const badgeCount = (html.match(/prep-diff-rule-badge\b(?!-)/g) || []).length;
    expect(badgeCount).toBe(2);
  });
});

// ─── getDiffRowClasses ───────────────────────────────────────────────────────

describe("getDiffRowClasses", () => {
  it("Invariant 11 — pending sans forced → []", () => {
    expect(getDiffRowClasses(ex({ status: "pending" }))).toEqual([]);
    expect(getDiffRowClasses(ex({ status: undefined }))).toEqual([]);
  });

  it("Invariant 11 — accepted → ['diff-accepted']", () => {
    expect(getDiffRowClasses(ex({ status: "accepted" }))).toEqual(["diff-accepted"]);
  });

  it("Invariant 11 — ignored → ['diff-ignored']", () => {
    expect(getDiffRowClasses(ex({ status: "ignored" }))).toEqual(["diff-ignored"]);
  });

  it("Invariant 11 — preview_reason='forced' → diff-forced-row", () => {
    const r = getDiffRowClasses(ex({ preview_reason: "forced" } as never));
    expect(r).toContain("diff-forced-row");
    expect(r).not.toContain("diff-forced-ignored");
  });

  it("Invariant 11 — preview_reason='forced_ignored' → row + ignored", () => {
    const r = getDiffRowClasses(ex({ preview_reason: "forced_ignored" } as never));
    expect(r).toContain("diff-forced-row");
    expect(r).toContain("diff-forced-ignored");
  });

  it("Invariant 11 — preview_reason='forced_no_change' → row + no-change", () => {
    const r = getDiffRowClasses(ex({ preview_reason: "forced_no_change" } as never));
    expect(r).toContain("diff-forced-row");
    expect(r).toContain("diff-forced-no-change");
  });

  it("Invariant 11 — combinaison status + forced", () => {
    const r = getDiffRowClasses(ex({ status: "ignored", preview_reason: "forced" } as never));
    expect(r).toContain("diff-ignored");
    expect(r).toContain("diff-forced-row");
  });

  it("Invariant 11 — preview_reason='standard' → ignoré", () => {
    expect(getDiffRowClasses(ex({ preview_reason: "standard" } as never))).toEqual([]);
  });
});

// ─── formatDiffPaginationLabel ───────────────────────────────────────────────

describe("formatDiffPaginationLabel", () => {
  it("Invariant 12 — totalChanged > shown → suffixe", () => {
    const txt = formatDiffPaginationLabel(0, 5, 100, 500);
    expect(txt).toContain("Page 1 / 5");
    expect(txt).toContain("100 exemples chargés");
    expect(txt).toContain("sur 500 total");
  });

  it("Invariant 12 — totalChanged = shown → pas de suffixe", () => {
    const txt = formatDiffPaginationLabel(2, 3, 100, 100);
    expect(txt).toContain("Page 3 / 3");
    expect(txt).not.toContain("total");
  });

  it("Invariant 12 — totalChanged < shown → pas de suffixe", () => {
    const txt = formatDiffPaginationLabel(0, 1, 50, 30);
    expect(txt).not.toContain("total");
  });
});

// ─── formatDiffRowTitle ──────────────────────────────────────────────────────

describe("formatDiffRowTitle", () => {
  it("Invariant 13 — ruleCount=1 → singulier", () => {
    expect(formatDiffRowTitle(1)).toBe("Cliquer pour sélectionner cette modification");
  });

  it("Invariant 13 — ruleCount=0 → singulier (legacy : pas de pluriel à 0)", () => {
    expect(formatDiffRowTitle(0)).toBe("Cliquer pour sélectionner cette modification");
  });

  it("Invariant 13 — ruleCount>1 → pluriel avec count", () => {
    expect(formatDiffRowTitle(3)).toContain("3 règles");
  });
});
