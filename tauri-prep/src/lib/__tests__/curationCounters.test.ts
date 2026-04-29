import { describe, it, expect } from "vitest";
import {
  getStatusCounts,
  countManualOverrides,
  hasAnyManualOverride,
} from "../curationCounters.ts";
import type { CuratePreviewExample } from "../sidecarClient.ts";

function ex(overrides: Partial<CuratePreviewExample> = {}): CuratePreviewExample {
  return {
    unit_id: 1,
    external_id: 1,
    before: "before",
    after: "after",
    ...overrides,
  } as CuratePreviewExample;
}

// ─── getStatusCounts ─────────────────────────────────────────────────────────

describe("getStatusCounts", () => {
  it("compte basique", () => {
    const list = [
      ex({ status: "accepted" }),
      ex({ status: "ignored" }),
      ex({ status: "pending" }),
      ex({ status: "accepted" }),
    ];
    expect(getStatusCounts(list)).toEqual({ pending: 1, accepted: 2, ignored: 1 });
  });

  it("Invariant 1 — status absent → pending", () => {
    const list = [
      ex({ status: undefined }),
      ex({ status: undefined }),
    ];
    expect(getStatusCounts(list)).toEqual({ pending: 2, accepted: 0, ignored: 0 });
  });

  it("Invariant 1 — status inconnu → pending (else branch)", () => {
    const list = [
      ex({ status: "weird" as never }),
      ex({ status: "" as never }),
    ];
    // status="" → ?? "pending" garde "" qui tombe dans le else → pending++
    expect(getStatusCounts(list).pending).toBe(2);
  });

  it("Invariant 2 — somme === total", () => {
    const list = [
      ex({ status: "accepted" }), ex({ status: "ignored" }),
      ex({ status: "pending" }), ex({ status: undefined }),
      ex({ status: "accepted" }),
    ];
    const c = getStatusCounts(list);
    expect(c.pending + c.accepted + c.ignored).toBe(list.length);
  });

  it("liste vide → tout à 0", () => {
    expect(getStatusCounts([])).toEqual({ pending: 0, accepted: 0, ignored: 0 });
  });
});

// ─── countManualOverrides ────────────────────────────────────────────────────

describe("countManualOverrides", () => {
  it("Invariant 3 — truthy check (true compte)", () => {
    const list = [
      ex({ is_manual_override: true }),
      ex({ is_manual_override: true }),
      ex({ is_manual_override: false }),
      ex({ is_manual_override: undefined }),
    ];
    expect(countManualOverrides(list)).toBe(2);
  });

  it("Invariant 3 — false et undefined ne comptent pas", () => {
    const list = [
      ex({ is_manual_override: false }),
      ex({ is_manual_override: undefined }),
    ];
    expect(countManualOverrides(list)).toBe(0);
  });

  it("liste vide → 0", () => {
    expect(countManualOverrides([])).toBe(0);
  });
});

// ─── hasAnyManualOverride ────────────────────────────────────────────────────

describe("hasAnyManualOverride", () => {
  it("Invariant 4 — true si au moins un truthy", () => {
    expect(hasAnyManualOverride([
      ex({ is_manual_override: false }),
      ex({ is_manual_override: true }),
    ])).toBe(true);
  });

  it("Invariant 4 — false si aucun truthy", () => {
    expect(hasAnyManualOverride([
      ex({ is_manual_override: false }),
      ex({ is_manual_override: undefined }),
    ])).toBe(false);
  });

  it("liste vide → false", () => {
    expect(hasAnyManualOverride([])).toBe(false);
  });

  it("Invariant 4 — équivalent à countManualOverrides > 0", () => {
    const cases: CuratePreviewExample[][] = [
      [],
      [ex({ is_manual_override: true })],
      [ex({ is_manual_override: false })],
      [ex({ is_manual_override: true }), ex({ is_manual_override: false })],
    ];
    for (const list of cases) {
      expect(hasAnyManualOverride(list)).toBe(countManualOverrides(list) > 0);
    }
  });
});
