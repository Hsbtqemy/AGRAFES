import { describe, it, expect } from "vitest";
import { collectIgnoredUnitIds, collectManualOverrides } from "../curationApplyInputs.ts";
import type { CuratePreviewExample } from "../sidecarClient.ts";

function makeExample(overrides: Partial<CuratePreviewExample> = {}): CuratePreviewExample {
  return {
    unit_id: 1,
    external_id: null,
    before: "a",
    after: "b",
    ...overrides,
  } as CuratePreviewExample;
}

describe("collectIgnoredUnitIds", () => {
  it("garde uniquement les examples status='ignored'", () => {
    const examples = [
      makeExample({ unit_id: 1, status: "ignored" }),
      makeExample({ unit_id: 2, status: "accepted" }),
      makeExample({ unit_id: 3 }), // pending implicite
      makeExample({ unit_id: 4, status: "ignored" }),
    ];
    expect(collectIgnoredUnitIds(examples)).toEqual([1, 4]);
  });

  it("liste vide si aucun ignoré", () => {
    expect(collectIgnoredUnitIds([makeExample({ status: "accepted" })])).toEqual([]);
  });
});

describe("collectManualOverrides", () => {
  it("retient les overrides d'examples (is_manual_override + manual_after)", () => {
    const examples = [
      makeExample({ unit_id: 1, is_manual_override: true, manual_after: "X" }),
      makeExample({ unit_id: 2, is_manual_override: false }),
      makeExample({ unit_id: 3, is_manual_override: true }), // manual_after absent → exclu
    ];
    expect(collectManualOverrides(examples, new Map())).toEqual([{ unit_id: 1, text: "X" }]);
  });

  it("ajoute les overrides bruts non couverts par un example", () => {
    const examples = [makeExample({ unit_id: 1, is_manual_override: true, manual_after: "X" })];
    const raw = new Map<number, string>([[1, "RAW-déjà-couvert"], [2, "Y"], [3, "Z"]]);
    const result = collectManualOverrides(examples, raw);
    // l'example (1) d'abord, puis les bruts non couverts (2, 3) ; unit 1 brut ignoré
    expect(result).toEqual([
      { unit_id: 1, text: "X" },
      { unit_id: 2, text: "Y" },
      { unit_id: 3, text: "Z" },
    ]);
  });

  it("dédup : un unit_id couvert par un example n'est pas repris depuis allOverrides", () => {
    const examples = [makeExample({ unit_id: 5, is_manual_override: true, manual_after: "fromExample" })];
    const raw = new Map<number, string>([[5, "fromRaw"]]);
    const result = collectManualOverrides(examples, raw);
    expect(result).toEqual([{ unit_id: 5, text: "fromExample" }]);
  });

  it("vide quand ni examples ni overrides bruts", () => {
    expect(collectManualOverrides([], new Map())).toEqual([]);
  });
});
