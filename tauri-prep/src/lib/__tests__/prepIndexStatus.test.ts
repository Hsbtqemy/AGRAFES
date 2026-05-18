import { describe, it, expect, beforeEach } from "vitest";
import {
  indexButtonState,
  isAutoReindexEnabled,
  setAutoReindexEnabled,
  AUTO_REINDEX_LS_KEY,
} from "../prepIndexStatus.ts";

describe("indexButtonState", () => {
  // Invariant — 0 périmé → bouton inactif, pas d'avertissement.
  it("0 doc périmé → disabled, non-stale, libellé « à jour »", () => {
    const s = indexButtonState(0);
    expect(s.disabled).toBe(true);
    expect(s.stale).toBe(false);
    expect(s.label).toContain("à jour");
  });

  it("compte négatif traité comme 0 (défensif)", () => {
    expect(indexButtonState(-3).disabled).toBe(true);
  });

  it("1 doc périmé → actif, stale, singulier", () => {
    const s = indexButtonState(1);
    expect(s.disabled).toBe(false);
    expect(s.stale).toBe(true);
    expect(s.label).toContain("(1 document)");
  });

  it("plusieurs docs périmés → actif, pluriel avec compte", () => {
    const s = indexButtonState(7);
    expect(s.disabled).toBe(false);
    expect(s.label).toContain("(7 documents)");
  });
});

// ─── Fake localStorage (environnement vitest = node) ──────────────────────────
function fakeStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as Storage;
}

describe("auto-reindex opt-in (localStorage)", () => {
  beforeEach(() => {
    (globalThis as { localStorage: Storage }).localStorage = fakeStorage();
  });

  it("désactivé par défaut", () => {
    expect(isAutoReindexEnabled()).toBe(false);
  });

  it("round-trip set → get", () => {
    setAutoReindexEnabled(true);
    expect(localStorage.getItem(AUTO_REINDEX_LS_KEY)).toBe("1");
    expect(isAutoReindexEnabled()).toBe(true);
    setAutoReindexEnabled(false);
    expect(isAutoReindexEnabled()).toBe(false);
  });
});
