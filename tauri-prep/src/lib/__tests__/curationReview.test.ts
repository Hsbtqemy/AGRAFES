import { describe, it, expect } from "vitest";
import { loadCurateReviewState, saveCurateReviewState, type StoredCurateReviewState } from "../curationReview.ts";

// ─── Fake localStorage ────────────────────────────────────────────────────────

function fakeStorage(init: Record<string, string> = {}): Storage {
  const store = { ...init };
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as Storage;
}

function baseState(overrides: Partial<StoredCurateReviewState> = {}): StoredCurateReviewState {
  return {
    version: 5,
    docId: 42,
    rulesSignature: "abc12345",
    updatedAt: Date.now(),
    unitsTotal: 100,
    unitsChanged: 30,
    sampleFingerprint: "fp-struct",
    sampleTextFingerprint: "fp-text",
    statuses: { "1": "accepted", "2": "ignored" },
    ...overrides,
  };
}

// ─── loadCurateReviewState ────────────────────────────────────────────────────

describe("loadCurateReviewState", () => {
  it("round-trip v5 : save → load → mêmes données", () => {
    const storage = fakeStorage();
    const state = baseState();
    saveCurateReviewState("test-key", state, storage);
    const loaded = loadCurateReviewState("test-key", "abc12345", storage);
    expect(loaded).not.toBeNull();
    expect(loaded!.statuses).toEqual({ "1": "accepted", "2": "ignored" });
    expect(loaded!.docId).toBe(42);
    expect(loaded!.version).toBe(5);
  });

  it("signature différente → retourne null", () => {
    const storage = fakeStorage();
    saveCurateReviewState("key", baseState({ rulesSignature: "abc12345" }), storage);
    const result = loadCurateReviewState("key", "different-sig", storage);
    expect(result).toBeNull();
  });

  it("JSON malformé → retourne null sans throw", () => {
    const storage = fakeStorage({ "bad-key": "{not valid json" });
    expect(() => loadCurateReviewState("bad-key", "abc12345", storage)).not.toThrow();
    expect(loadCurateReviewState("bad-key", "abc12345", storage)).toBeNull();
  });

  it("clé absente → retourne null", () => {
    const storage = fakeStorage();
    expect(loadCurateReviewState("missing", "sig", storage)).toBeNull();
  });

  it("version inconnue (v99) → retourne null", () => {
    const storage = fakeStorage();
    const state = baseState({ version: 99 as never });
    storage.setItem("key", JSON.stringify(state));
    expect(loadCurateReviewState("key", "abc12345", storage)).toBeNull();
  });

  it("version 1 → acceptée", () => {
    const storage = fakeStorage();
    const state = baseState({ version: 1 });
    storage.setItem("key", JSON.stringify(state));
    const result = loadCurateReviewState("key", "abc12345", storage);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
  });

  it("statuses null → retourne null", () => {
    const storage = fakeStorage();
    const state = { ...baseState(), statuses: null } as unknown as StoredCurateReviewState;
    storage.setItem("key", JSON.stringify(state));
    expect(loadCurateReviewState("key", "abc12345", storage)).toBeNull();
  });
});

// ─── saveCurateReviewState ────────────────────────────────────────────────────

describe("saveCurateReviewState", () => {
  it("statuses tous vides → clé supprimée (pas écrite)", () => {
    const storage = fakeStorage({ "key": "old" });
    saveCurateReviewState("key", baseState({ statuses: {}, overrides: {} }), storage);
    expect(storage.getItem("key")).toBeNull();
  });

  it("statuses non-vides → clé écrite", () => {
    const storage = fakeStorage();
    saveCurateReviewState("key", baseState(), storage);
    expect(storage.getItem("key")).not.toBeNull();
  });

  it("overrides non-vides mais statuses vides → clé écrite", () => {
    const storage = fakeStorage();
    saveCurateReviewState("key", baseState({ statuses: {}, overrides: { "3": "texte" } }), storage);
    expect(storage.getItem("key")).not.toBeNull();
  });

  it("no-op silencieux si setItem throw (quota)", () => {
    const storage = fakeStorage();
    const storageThrow = {
      ...storage,
      setItem: () => { throw new DOMException("QuotaExceeded"); },
    };
    expect(() => saveCurateReviewState("key", baseState(), storageThrow)).not.toThrow();
  });
});
