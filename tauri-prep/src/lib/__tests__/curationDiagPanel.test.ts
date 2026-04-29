import { describe, it, expect } from "vitest";
import {
  buildMinimapHtml,
  formatNoChangesDiag,
  formatChangesSummary,
  formatTruncationNotice,
  formatRuleChips,
  formatGotoFirstAction,
  formatImpactNotice,
} from "../curationDiagPanel.ts";

// ─── buildMinimapHtml ────────────────────────────────────────────────────────

describe("buildMinimapHtml", () => {
  it("Invariant 1 — total=0 → 0 changed bars", () => {
    const html = buildMinimapHtml(5, 0);
    expect((html.match(/changed/g) || [])).toHaveLength(0);
  });

  it("Invariant 2 — changed >= total → tous bars changed", () => {
    const html = buildMinimapHtml(100, 50);  // density capped à 1
    expect((html.match(/changed/g) || [])).toHaveLength(12);
  });

  it("Invariant 3 — changedBars = round(density * bars)", () => {
    // density = 5/10 = 0.5, bars=12 → round(6) = 6
    const html = buildMinimapHtml(5, 10);
    expect((html.match(/changed/g) || [])).toHaveLength(6);
  });

  it("Invariant 4 — bars total = paramètre (default 12)", () => {
    const html = buildMinimapHtml(0, 100);
    expect((html.match(/<div class="prep-mm/g) || [])).toHaveLength(12);
  });

  it("Invariant 4 — bars custom respecté", () => {
    const html = buildMinimapHtml(10, 20, 5);
    expect((html.match(/<div class="prep-mm/g) || [])).toHaveLength(5);
  });

  it("changed=0 → 0 changed bars", () => {
    const html = buildMinimapHtml(0, 100);
    expect((html.match(/changed/g) || [])).toHaveLength(0);
  });
});

// ─── formatNoChangesDiag ─────────────────────────────────────────────────────

describe("formatNoChangesDiag", () => {
  it("Invariant 5 — total inséré dans le message", () => {
    const html = formatNoChangesDiag(42);
    expect(html).toContain("42 unités analysées");
    expect(html).toContain("✓ Aucune modification");
  });

  it("total=0 → 0 unités analysées", () => {
    expect(formatNoChangesDiag(0)).toContain("0 unités analysées");
  });
});

// ─── formatChangesSummary ────────────────────────────────────────────────────

describe("formatChangesSummary", () => {
  it("Invariant 6 — nombres bruts injectés", () => {
    const html = formatChangesSummary(5, 100, 17);
    expect(html).toContain("5 unit&#233;(s) modifi&#233;e(s)");
    expect(html).toContain("17 remplacement(s) sur 100");
  });

  it("classes warn et curate-diag-summary présentes", () => {
    const html = formatChangesSummary(1, 1, 1);
    expect(html).toContain("warn");
    expect(html).toContain("curate-diag-summary");
  });
});

// ─── formatTruncationNotice ──────────────────────────────────────────────────

describe("formatTruncationNotice", () => {
  it("Invariant 7 — shown >= totalChanged → ''", () => {
    expect(formatTruncationNotice(50, 50)).toBe("");
    expect(formatTruncationNotice(100, 50)).toBe("");
  });

  it("Invariant 7 — shown < totalChanged → notice", () => {
    const html = formatTruncationNotice(50, 100);
    expect(html).toContain("Preview limit");
    expect(html).toContain("50");
    expect(html).toContain("100");
  });

  it("classe curate-diag-notice présente", () => {
    const html = formatTruncationNotice(10, 20);
    expect(html).toContain("curate-diag-notice");
  });
});

// ─── formatRuleChips ─────────────────────────────────────────────────────────

describe("formatRuleChips", () => {
  it("Invariant 8 — Map vide → ''", () => {
    expect(formatRuleChips(new Map(), false)).toBe("");
    expect(formatRuleChips(new Map(), true)).toBe("");
  });

  it("Invariant 9 — tri descendant par count", () => {
    const stats = new Map<string, number>([
      ["A", 5],
      ["B", 20],
      ["C", 1],
    ]);
    const html = formatRuleChips(stats, false);
    const idxA = html.indexOf('data-rule-label="A"');
    const idxB = html.indexOf('data-rule-label="B"');
    const idxC = html.indexOf('data-rule-label="C"');
    expect(idxB).toBeLessThan(idxA);
    expect(idxA).toBeLessThan(idxC);
  });

  it("Invariant 9 — escape HTML sur labels", () => {
    const stats = new Map([["<script>", 1]]);
    const html = formatRuleChips(stats, false);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("Invariant 10 — isTruncated=true → title contient 'échantillon courant'", () => {
    const stats = new Map([["X", 1]]);
    const html = formatRuleChips(stats, true);
    expect(html).toContain("dans l’échantillon courant");
    expect(html).toContain("prep-diag-scope-note");
  });

  it("Invariant 10 — isTruncated=false → title sans 'échantillon courant'", () => {
    const stats = new Map([["X", 1]]);
    const html = formatRuleChips(stats, false);
    expect(html).not.toContain("dans l’échantillon courant");
    expect(html).not.toContain("prep-diag-scope-note");
  });

  it("count rendu dans .prep-diag-rule-count", () => {
    const stats = new Map([["A", 7]]);
    const html = formatRuleChips(stats, false);
    expect(html).toMatch(/prep-diag-rule-count">7</);
  });
});

// ─── formatGotoFirstAction ───────────────────────────────────────────────────

describe("formatGotoFirstAction", () => {
  it("Invariant 11 — shown=0 → ''", () => {
    expect(formatGotoFirstAction(0)).toBe("");
  });

  it("Invariant 11 — shown<0 → ''", () => {
    expect(formatGotoFirstAction(-5)).toBe("");
  });

  it("shown>0 → bouton avec id et nombre", () => {
    const html = formatGotoFirstAction(42);
    expect(html).toContain('id="act-diag-goto-first"');
    expect(html).toContain("42 exemple(s)");
  });
});

// ─── formatImpactNotice ──────────────────────────────────────────────────────

describe("formatImpactNotice", () => {
  it("Invariant 12 — toujours le même HTML", () => {
    const a = formatImpactNotice();
    const b = formatImpactNotice();
    expect(a).toBe(b);
    expect(a).toContain("Impact segmentation");
  });
});
