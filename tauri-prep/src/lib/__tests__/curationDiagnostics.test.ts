import { describe, it, expect } from "vitest";
import {
  appendCurateLogEntry,
  formatCurateLogEntry,
  formatCurateLog,
  countCurateWarnings,
  type CurateLogEntry,
} from "../curationDiagnostics.ts";

// ─── Test fixtures ───────────────────────────────────────────────────────────

const NOW = 1714389600000; // 2026-04-29T10:00:00Z fixe pour tests
function entry(overrides: Partial<CurateLogEntry> = {}): CurateLogEntry {
  return { ts: NOW - 30000, kind: "preview", msg: "test", ...overrides };
}

// ─── appendCurateLogEntry ────────────────────────────────────────────────────

describe("appendCurateLogEntry", () => {
  it("Invariant 1 — ordre LIFO (newest first)", () => {
    const log: CurateLogEntry[] = [];
    const r1 = appendCurateLogEntry(log, "preview", "first");
    const r2 = appendCurateLogEntry(r1, "apply", "second");
    expect(r2[0].msg).toBe("second");
    expect(r2[1].msg).toBe("first");
  });

  it("Invariant 2 — cap par défaut 10", () => {
    let log: CurateLogEntry[] = [];
    for (let i = 0; i < 15; i++) {
      log = appendCurateLogEntry(log, "preview", `msg${i}`);
    }
    expect(log).toHaveLength(10);
    expect(log[0].msg).toBe("msg14"); // newest first
    expect(log[9].msg).toBe("msg5");  // oldest still in
  });

  it("Invariant 2 — cap custom respecté", () => {
    let log: CurateLogEntry[] = [];
    for (let i = 0; i < 8; i++) {
      log = appendCurateLogEntry(log, "preview", `msg${i}`, 3);
    }
    expect(log).toHaveLength(3);
    expect(log[0].msg).toBe("msg7");
  });

  it("Invariant 3 — input non muté (immutable)", () => {
    const original: CurateLogEntry[] = [entry({ msg: "original" })];
    const before = [...original];
    const result = appendCurateLogEntry(original, "warn", "new");
    expect(original).toEqual(before);
    expect(result).not.toBe(original);
  });

  it("ts est généré (proche de Date.now)", () => {
    const t0 = Date.now();
    const log = appendCurateLogEntry([], "preview", "x");
    expect(log[0].ts).toBeGreaterThanOrEqual(t0);
    expect(log[0].ts).toBeLessThan(t0 + 1000);
  });
});

// ─── formatCurateLogEntry ────────────────────────────────────────────────────

describe("formatCurateLogEntry — invariants markup", () => {
  it("Invariant 4 — kind='warn' → classe prep-curate-log-warn", () => {
    const html = formatCurateLogEntry(entry({ kind: "warn" }), NOW);
    expect(html).toContain("prep-curate-log-warn");
    expect(html).not.toContain("prep-curate-log-apply");
  });

  it("Invariant 5 — kind='apply' → classe prep-curate-log-apply", () => {
    const html = formatCurateLogEntry(entry({ kind: "apply" }), NOW);
    expect(html).toContain("prep-curate-log-apply");
    expect(html).not.toContain("prep-curate-log-warn");
  });

  it("Invariant 6 — kind='preview' → pas de classe additionnelle", () => {
    const html = formatCurateLogEntry(entry({ kind: "preview" }), NOW);
    expect(html).not.toContain("prep-curate-log-warn");
    expect(html).not.toContain("prep-curate-log-apply");
    expect(html).toContain("prep-curate-qitem");
  });

  it("Invariant 7 — age < 60s → 'il y a Ns'", () => {
    const html = formatCurateLogEntry(entry({ ts: NOW - 30000 }), NOW);
    expect(html).toContain("il y a 30 s");
  });

  it("Invariant 7 — age = 0s → 'il y a 0 s'", () => {
    const html = formatCurateLogEntry(entry({ ts: NOW }), NOW);
    expect(html).toContain("il y a 0 s");
  });

  it("Invariant 7 — age >= 60s → format hh:mm", () => {
    const html = formatCurateLogEntry(entry({ ts: NOW - 120000 }), NOW);
    expect(html).not.toContain("il y a");
    // Format fr-FR hh:mm — au moins 5 chars de digit/séparateur
    expect(html).toMatch(/\d{2}[:h]\d{2}/);
  });

  it("Invariant 8 — escape HTML sur msg", () => {
    const html = formatCurateLogEntry(
      entry({ msg: "<script>alert('x')</script>" }), NOW);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("Invariant 8 — escape & et \"", () => {
    const html = formatCurateLogEntry(entry({ msg: 'a & b "c"' }), NOW);
    expect(html).toContain("a &amp; b");
    expect(html).toContain("&quot;c&quot;");
  });

  it("Invariant 9 — label kind='preview' → 'Prévisu'", () => {
    const html = formatCurateLogEntry(entry({ kind: "preview" }), NOW);
    expect(html).toContain(">Prévisu<");
  });

  it("Invariant 9 — label kind='apply' → 'Application'", () => {
    const html = formatCurateLogEntry(entry({ kind: "apply" }), NOW);
    expect(html).toContain(">Application<");
  });

  it("Invariant 9 — label kind='warn' → '⚠'", () => {
    const html = formatCurateLogEntry(entry({ kind: "warn" }), NOW);
    expect(html).toContain(">⚠<");
  });
});

// ─── formatCurateLog ─────────────────────────────────────────────────────────

describe("formatCurateLog", () => {
  it("Invariant 10 — log vide → empty-hint", () => {
    const html = formatCurateLog([], NOW);
    expect(html).toContain("empty-hint");
    expect(html).toContain("Aucune action enregistrée");
    expect(html).toContain('style="padding:10px"');
  });

  it("log non-vide → concat des entries (pas de wrapper)", () => {
    const log = [entry({ msg: "a" }), entry({ msg: "b" })];
    const html = formatCurateLog(log, NOW);
    const itemCount = (html.match(/prep-curate-qitem/g) || []).length;
    expect(itemCount).toBe(2);
    expect(html).not.toContain("empty-hint");
  });
});

// ─── countCurateWarnings ─────────────────────────────────────────────────────

describe("countCurateWarnings", () => {
  it("Invariant 11 — compte uniquement kind='warn'", () => {
    const log = [
      entry({ kind: "warn" }),
      entry({ kind: "apply" }),
      entry({ kind: "warn" }),
      entry({ kind: "preview" }),
    ];
    expect(countCurateWarnings(log)).toBe(2);
  });

  it("log vide → 0", () => {
    expect(countCurateWarnings([])).toBe(0);
  });

  it("aucun warn → 0", () => {
    const log = [entry({ kind: "preview" }), entry({ kind: "apply" })];
    expect(countCurateWarnings(log)).toBe(0);
  });
});
