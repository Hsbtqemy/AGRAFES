import { describe, it, expect } from "vitest";
import { formatSessionSummary, type SessionSummaryInput } from "../curationSessionSummary.ts";

const LABELS = { pending: "En attente", accepted: "Acceptée", ignored: "Ignorée" };

function makeInput(overrides: Partial<SessionSummaryInput> = {}): SessionSummaryInput {
  return {
    counts: { pending: 0, accepted: 0, ignored: 0 },
    activeStatusFilter: null,
    statusLabels: LABELS,
    isAllMode: false,
    restoredCount: 0,
    savedCount: 0,
    manualOverrideCount: 0,
    exceptionCount: 0,
    ...overrides,
  };
}

describe("formatSessionSummary — chips", () => {
  it("rend les trois chips avec compteurs et libellés", () => {
    const html = formatSessionSummary(makeInput({ counts: { pending: 2, accepted: 5, ignored: 1 } }));
    expect(html).toContain('data-sf="pending"');
    expect(html).toContain('data-sf="accepted"');
    expect(html).toContain('data-sf="ignored"');
    expect(html).toContain("<strong>2</strong>");
    expect(html).toContain("<strong>5</strong>");
    expect(html).toContain("<strong>1</strong>");
    expect(html).toContain("En attente");
    expect(html).toContain("Acceptée");
    expect(html).toContain("Ignorée");
  });

  it("filtre inactif → title 'Filtrer : …', pas de classe active, pas de note de filtre", () => {
    const html = formatSessionSummary(makeInput());
    expect(html).toContain("Filtrer : En attente");
    expect(html).not.toContain("prep-session-chip-active");
    expect(html).not.toContain("prep-session-filter-note");
  });

  it("filtre actif → chip active + title 'Effacer ce filtre' + note de filtre", () => {
    const html = formatSessionSummary(makeInput({ activeStatusFilter: "accepted" }));
    expect(html).toContain('prep-session-accepted prep-session-chip-active');
    expect(html).toContain("Effacer ce filtre");
    expect(html).toContain("prep-session-filter-note");
  });
});

describe("formatSessionSummary — notes conditionnelles", () => {
  it("note corrections manuelles uniquement si > 0", () => {
    expect(formatSessionSummary(makeInput({ manualOverrideCount: 0 }))).not.toContain("prep-session-override-note");
    const html = formatSessionSummary(makeInput({ manualOverrideCount: 3 }));
    expect(html).toContain("prep-session-override-note");
    expect(html).toContain("3 correction(s) manuelle(s)");
  });

  it("note exceptions uniquement si > 0", () => {
    expect(formatSessionSummary(makeInput({ exceptionCount: 0 }))).not.toContain("prep-session-exception-note");
    const html = formatSessionSummary(makeInput({ exceptionCount: 2 }));
    expect(html).toContain("prep-session-exception-note");
    expect(html).toContain("2 exception(s) persistée(s)");
  });
});

describe("formatSessionSummary — bandeau restauration / reset", () => {
  it("restoredCount === 0 → ligne de reset, pas de bandeau de restauration", () => {
    const html = formatSessionSummary(makeInput({ restoredCount: 0 }));
    expect(html).toContain("prep-session-reset-row");
    expect(html).toContain("Effacer la review sauvegardée");
    expect(html).not.toContain("prep-session-restore-notice");
  });

  it("restoredCount > 0, savedCount égal → texte court sans 'sur N sauvegardé(s)'", () => {
    const html = formatSessionSummary(makeInput({ restoredCount: 4, savedCount: 4 }));
    expect(html).toContain("prep-session-restore-notice");
    expect(html).toContain("4 statut(s) restauré(s)");
    expect(html).not.toContain("sauvegardé(s)");
  });

  it("restoredCount > 0, savedCount supérieur → texte 'sur N sauvegardé(s)'", () => {
    const html = formatSessionSummary(makeInput({ restoredCount: 4, savedCount: 7 }));
    expect(html).toContain("4 statut(s) restauré(s) sur 7 sauvegardé(s)");
  });
});

describe("formatSessionSummary — isAllMode", () => {
  it("ajoute la mention portée globale dans le bandeau de restauration", () => {
    const html = formatSessionSummary(makeInput({ restoredCount: 2, savedCount: 2, isAllMode: true }));
    expect(html).toContain("(sélection modifiée depuis la preview)");
  });

  it("ajoute le badge portée globale dans la ligne de reset", () => {
    const html = formatSessionSummary(makeInput({ restoredCount: 0, isAllMode: true }));
    expect(html).toContain("prep-session-all-note");
    expect(html).toContain("Portée globale");
  });

  it("scope document → aucune mention de portée globale", () => {
    const html = formatSessionSummary(makeInput({ restoredCount: 0, isAllMode: false }));
    expect(html).not.toContain("prep-session-all-note");
    expect(html).not.toContain("(sélection modifiée");
  });
});
