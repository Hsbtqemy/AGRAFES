import { describe, it, expect } from "vitest";
import {
  ELIGIBILITY_REASONS,
  PREP_ACTION_TYPES,
  formatUndoActionLabel,
  formatUndoTooltip,
  formatUndoUnavailableReason,
  isUndoDisabled,
} from "../prepUndo.ts";

// Invariant 1 : formatUndoActionLabel suit la description backend.
describe("formatUndoActionLabel", () => {
  it("eligible avec description → préfixe glyph + description telle quelle", () => {
    const elig = {
      eligible: true,
      description: "Apply 3 règles · 47 unités modifiées",
      action_type: "curation_apply" as const,
    };
    expect(formatUndoActionLabel(elig)).toBe(
      "↶ Annuler : Apply 3 règles · 47 unités modifiées",
    );
  });

  it("eligible mais description absente → label générique", () => {
    expect(formatUndoActionLabel({ eligible: true })).toBe("↶ Annuler");
  });

  it("non éligible → label générique sans description", () => {
    expect(
      formatUndoActionLabel({ eligible: false, description: "ignored" }),
    ).toBe("↶ Annuler");
  });
});

// Invariant 2 : reasons inconnues → message générique avec code.
describe("formatUndoUnavailableReason", () => {
  it("no_action → message dédié", () => {
    expect(formatUndoUnavailableReason("no_action")).toMatch(/Aucune action/);
  });

  it("no_snapshots → message dédié", () => {
    expect(formatUndoUnavailableReason("no_snapshots")).toMatch(/antérieure/);
  });

  it("structural_dependency → message dédié", () => {
    expect(formatUndoUnavailableReason("structural_dependency")).toMatch(/plus récente/);
  });

  it("reason inconnue → message générique avec code", () => {
    expect(formatUndoUnavailableReason("zzz_unknown")).toBe(
      "Annulation impossible (zzz_unknown).",
    );
  });

  it("undefined → message générique sans code", () => {
    expect(formatUndoUnavailableReason(undefined)).toBe("Annulation impossible.");
  });

  it("chaque reason connue a une branche dédiée", () => {
    for (const reason of ELIGIBILITY_REASONS) {
      const msg = formatUndoUnavailableReason(reason);
      // Une branche dédiée ne contient PAS le code reason brut.
      expect(msg).not.toContain(`(${reason})`);
    }
  });
});

// Invariant 3 : tooltip combine label + horodatage / reason.
describe("formatUndoTooltip", () => {
  it("eligible avec performed_at → label + horodatage", () => {
    const tooltip = formatUndoTooltip({
      eligible: true,
      description: "Coupure u.42",
      performed_at: "2026-04-30T10:12:33Z",
    });
    expect(tooltip).toContain("Annuler : Coupure u.42");
    expect(tooltip).toContain("2026-04-30T10:12:33Z");
  });

  it("eligible sans performed_at → label seul", () => {
    const tooltip = formatUndoTooltip({
      eligible: true,
      description: "x",
    });
    expect(tooltip).toBe("↶ Annuler : x");
  });

  it("non éligible → reason explicite", () => {
    expect(
      formatUndoTooltip({ eligible: false, reason: "no_action" }),
    ).toMatch(/Aucune action/);
  });
});

// Invariant 4 : types alignés sur la CHECK constraint backend.
describe("type constants", () => {
  it("PREP_ACTION_TYPES couvre toutes les valeurs CHECK", () => {
    expect(PREP_ACTION_TYPES).toEqual([
      "curation_apply",
      "merge_units",
      "split_unit",
      "resegment",
      "undo",
    ]);
  });

  it("ELIGIBILITY_REASONS contient les codes émis V1", () => {
    expect(ELIGIBILITY_REASONS).toContain("no_action");
    expect(ELIGIBILITY_REASONS).toContain("no_snapshots");
  });
});

describe("isUndoDisabled", () => {
  it("null / undefined → disabled", () => {
    expect(isUndoDisabled(null)).toBe(true);
    expect(isUndoDisabled(undefined)).toBe(true);
  });

  it("eligible:false → disabled", () => {
    expect(isUndoDisabled({ eligible: false, reason: "no_action" })).toBe(true);
  });

  it("eligible:true → enabled", () => {
    expect(isUndoDisabled({ eligible: true })).toBe(false);
  });
});

// ─── Soak transition helpers (pure) ────────────────────────────────────────

import {
  buttonStateFromEligibility,
  transitionEvent,
  type UndoButtonState,
} from "../prepUndo.ts";

describe("buttonStateFromEligibility", () => {
  it("null/undefined → idle", () => {
    expect(buttonStateFromEligibility(null)).toEqual({ kind: "idle" });
    expect(buttonStateFromEligibility(undefined)).toEqual({ kind: "idle" });
  });

  it("eligible:false sans reason → unavailable reason='unknown'", () => {
    expect(buttonStateFromEligibility({ eligible: false }))
      .toEqual({ kind: "unavailable", reason: "unknown" });
  });

  it("eligible:false avec reason → unavailable avec reason", () => {
    expect(buttonStateFromEligibility({ eligible: false, reason: "no_action" }))
      .toEqual({ kind: "unavailable", reason: "no_action" });
  });

  it("eligible:true avec action_id+action_type → eligible", () => {
    expect(buttonStateFromEligibility({
      eligible: true,
      action_id: 42,
      action_type: "curation_apply",
    })).toEqual({
      kind: "eligible",
      action_type: "curation_apply",
      action_id: 42,
    });
  });

  it("eligible:true sans action_id → idle (cas dégénéré, jamais émis)", () => {
    expect(buttonStateFromEligibility({ eligible: true }))
      .toEqual({ kind: "idle" });
  });
});

describe("transitionEvent", () => {
  // Anti-bruit central : aucune émission si l'état n'a pas changé matériellement.

  it("idle → idle : null (mount sans doc)", () => {
    expect(transitionEvent({ kind: "idle" }, { kind: "idle" })).toBe(null);
  });

  it("undefined → idle : null", () => {
    expect(transitionEvent(undefined, { kind: "idle" })).toBe(null);
  });

  it("idle → eligible : eligible_view émis", () => {
    const ev = transitionEvent(
      { kind: "idle" },
      { kind: "eligible", action_type: "merge_units", action_id: 7 },
    );
    expect(ev).toEqual({
      event: "prep_undo_eligible_view",
      payload: { action_type: "merge_units", action_id: 7 },
    });
  });

  it("eligible identique → null (re-render)", () => {
    const prev: UndoButtonState = { kind: "eligible", action_type: "merge_units", action_id: 7 };
    const next: UndoButtonState = { kind: "eligible", action_type: "merge_units", action_id: 7 };
    expect(transitionEvent(prev, next)).toBe(null);
  });

  it("eligible avec action_id différent → eligible_view émis (action sous-jacente changée)", () => {
    const prev: UndoButtonState = { kind: "eligible", action_type: "merge_units", action_id: 7 };
    const next: UndoButtonState = { kind: "eligible", action_type: "curation_apply", action_id: 8 };
    const ev = transitionEvent(prev, next);
    expect(ev?.event).toBe("prep_undo_eligible_view");
    expect(ev?.payload.action_id).toBe(8);
    expect(ev?.payload.action_type).toBe("curation_apply");
  });

  it("idle → unavailable : unavailable_view émis", () => {
    const ev = transitionEvent(
      { kind: "idle" },
      { kind: "unavailable", reason: "no_action" },
    );
    expect(ev).toEqual({
      event: "prep_undo_unavailable_view",
      payload: { reason: "no_action" },
    });
  });

  it("unavailable avec reason identique → null", () => {
    const prev: UndoButtonState = { kind: "unavailable", reason: "no_action" };
    const next: UndoButtonState = { kind: "unavailable", reason: "no_action" };
    expect(transitionEvent(prev, next)).toBe(null);
  });

  it("unavailable avec reason différente → unavailable_view émis", () => {
    const prev: UndoButtonState = { kind: "unavailable", reason: "no_action" };
    const next: UndoButtonState = { kind: "unavailable", reason: "structural_dependency" };
    const ev = transitionEvent(prev, next);
    expect(ev?.event).toBe("prep_undo_unavailable_view");
    expect(ev?.payload.reason).toBe("structural_dependency");
  });

  it("eligible → unavailable → eligible : 3 events distincts (transitions matérielles)", () => {
    const s0: UndoButtonState = { kind: "eligible", action_type: "curation_apply", action_id: 1 };
    const s1: UndoButtonState = { kind: "unavailable", reason: "no_action" };
    const s2: UndoButtonState = { kind: "eligible", action_type: "merge_units", action_id: 2 };

    expect(transitionEvent(undefined, s0)?.event).toBe("prep_undo_eligible_view");
    expect(transitionEvent(s0, s1)?.event).toBe("prep_undo_unavailable_view");
    expect(transitionEvent(s1, s2)?.event).toBe("prep_undo_eligible_view");
  });

  it("eligible → idle : null (pas d'event en idle, anti-bruit)", () => {
    const prev: UndoButtonState = { kind: "eligible", action_type: "curation_apply", action_id: 1 };
    expect(transitionEvent(prev, { kind: "idle" })).toBe(null);
  });

  it("unavailable → idle : null", () => {
    const prev: UndoButtonState = { kind: "unavailable", reason: "no_action" };
    expect(transitionEvent(prev, { kind: "idle" })).toBe(null);
  });
});
