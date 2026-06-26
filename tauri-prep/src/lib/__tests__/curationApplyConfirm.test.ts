import { describe, it, expect } from "vitest";
import { buildApplyConfirmMessage, type ApplyConfirmInput } from "../curationApplyConfirm.ts";
import type { CuratePreviewExample } from "../sidecarClient.ts";

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

function makeInput(overrides: Partial<ApplyConfirmInput> = {}): ApplyConfirmInput {
  return {
    label: "doc #3",
    ignoredUnitIds: [],
    manualOverrides: [],
    examples: [],
    globalChanged: 0,
    currentDocId: 3,
    ...overrides,
  };
}

// ─── No review ───────────────────────────────────────────────────────────────

describe("buildApplyConfirmMessage — sans review locale", () => {
  it("message court quand examples est vide", () => {
    const msg = buildApplyConfirmMessage(makeInput());
    expect(msg).toContain("Appliquer la curation sur doc #3 ?");
    expect(msg).toContain("Aucune review locale — toutes les modifications seront appliquées.");
    expect(msg).not.toContain("Résumé de la session de review");
  });
});

// ─── With review ───────────────────────────────────────────────────────────────

describe("buildApplyConfirmMessage — avec review", () => {
  it("affiche le résumé acceptées/en attente/ignorées", () => {
    const examples = [
      makeExample({ unit_id: 1, status: "accepted" }),
      makeExample({ unit_id: 2, status: "pending" }),
      makeExample({ unit_id: 3, status: "ignored" }),
    ];
    const msg = buildApplyConfirmMessage(makeInput({ examples, globalChanged: 3, ignoredUnitIds: [3] }));
    expect(msg).toContain("Résumé de la session de review");
    expect(msg).toContain("• Acceptées    : 1");
    expect(msg).toContain("• En attente   : 1");
    expect(msg).toContain("• Ignorées     : 1");
    // ignored > 0 → mention "ne seront PAS appliquées" + exclusion
    expect(msg).toContain("→ ne seront PAS appliquées");
    expect(msg).toContain("L'application exclura 1 unité(s) ignorée(s).");
  });

  it("aucune ignorée → pas de mention d'exclusion, message 'aucune ignorée'", () => {
    const examples = [makeExample({ unit_id: 1, status: "accepted" })];
    const msg = buildApplyConfirmMessage(makeInput({ examples, globalChanged: 1 }));
    expect(msg).not.toContain("ne seront PAS appliquées");
    expect(msg).toContain("Toutes les modifications seront appliquées (aucune ignorée).");
  });

  it("preview tronquée → bloc d'avertissement avec le nombre hors échantillon", () => {
    const examples = [
      makeExample({ unit_id: 1, status: "accepted" }),
      makeExample({ unit_id: 2, status: "ignored" }),
    ];
    const msg = buildApplyConfirmMessage(makeInput({ examples, globalChanged: 10, ignoredUnitIds: [2] }));
    expect(msg).toContain("⚠ Attention — preview partielle");
    expect(msg).toContain("8 modification(s) hors échantillon"); // 10 - 2
    expect(msg).toContain("Seules les 1 unités ignorées dans l'échantillon seront exclues.");
    // En mode tronqué, on n'émet pas la phrase "L'application exclura ..."
    expect(msg).not.toContain("L'application exclura");
  });
});

// ─── Session erase note ──────────────────────────────────────────────────────

describe("buildApplyConfirmMessage — note d'effacement de session", () => {
  it("scope corpus (currentDocId undefined) → 'par document'", () => {
    const msg = buildApplyConfirmMessage(makeInput({ currentDocId: undefined, label: "tous les documents" }));
    expect(msg).toContain("Toutes les sessions de review sauvegardées par document seront effacées");
  });

  it("scope document → 'pour ce document'", () => {
    const msg = buildApplyConfirmMessage(makeInput({ currentDocId: 3 }));
    expect(msg).toContain("La session de review sauvegardée pour ce document sera effacée");
  });
});

// ─── Manual overrides breakdown ──────────────────────────────────────────────

describe("buildApplyConfirmMessage — corrections manuelles", () => {
  it("ventile diff vs texte brut", () => {
    // unit 1 = override via panneau diff (présent dans examples avec manual_after)
    // unit 2 = saisie directe (pas d'example override correspondant)
    const examples = [
      makeExample({ unit_id: 1, status: "accepted", is_manual_override: true, manual_after: "X" }),
    ];
    const manualOverrides = [
      { unit_id: 1, text: "X" },
      { unit_id: 2, text: "Y" },
    ];
    const msg = buildApplyConfirmMessage(makeInput({ examples, globalChanged: 1, manualOverrides }));
    expect(msg).toContain("2 correction(s) manuelle(s) : 1 via panneau diff, 1 directement dans le texte.");
  });

  it("uniquement texte brut", () => {
    const manualOverrides = [{ unit_id: 99, text: "Z" }];
    const msg = buildApplyConfirmMessage(makeInput({ manualOverrides }));
    expect(msg).toContain("1 correction(s) saisie(s) directement dans le panneau texte.");
  });

  it("uniquement diff", () => {
    const examples = [makeExample({ unit_id: 5, status: "accepted", is_manual_override: true, manual_after: "M" })];
    const manualOverrides = [{ unit_id: 5, text: "M" }];
    const msg = buildApplyConfirmMessage(makeInput({ examples, globalChanged: 1, manualOverrides }));
    expect(msg).toContain("1 correction(s) manuelle(s) seront appliquées à la place de la proposition automatique.");
  });

  it("aucune correction manuelle → pas de ligne ✏", () => {
    const msg = buildApplyConfirmMessage(makeInput());
    expect(msg).not.toContain("✏");
  });
});
