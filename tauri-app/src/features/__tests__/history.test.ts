/**
 * Tests for the search-history persistence helpers (history.ts, U-03).
 *
 * localStorage-backed (happy-dom provides it, cleared per test); saveToHistory
 * reads the shared state singleton (reset per test). relTime reads Date.now(),
 * pinned with fake timers for determinism.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../state";
import {
  saveToHistory,
  loadHistory,
  clearHistory,
  clearAllHistory,
  togglePin,
  relTime,
} from "../history";

const LS_KEY = "agrafes.explorer.history";

function resetState(): void {
  state.builderMode = "simple";
  state.filterLangs = [];
  state.filterRole = "";
  state.filterResourceType = "";
  state.filterFederatedDbPaths = [];
  state.filterDocIds = null;
  state.showAligned = false;
  state.showParallel = false;
}

beforeEach(() => {
  localStorage.clear();
  resetState();
});

// ─── saveToHistory + loadHistory ─────────────────────────────────────────────

describe("saveToHistory + loadHistory", () => {
  it("ignore une requête vide ou blanche", () => {
    saveToHistory("   ", "");
    expect(loadHistory()).toEqual([]);
  });

  it("enregistre une requête en tête de liste (non épinglée)", () => {
    saveToHistory("liberté", "liberté");
    const h = loadHistory();
    expect(h).toHaveLength(1);
    expect(h[0].raw).toBe("liberté");
    expect(h[0].fts).toBe("liberté");
    expect(h[0].pinned).toBe(false);
  });

  it("capture le mode et les filtres depuis state", () => {
    state.builderMode = "phrase";
    state.filterLangs = ["fr", "en"];
    state.filterRole = "source";
    state.showAligned = true;
    saveToHistory("q", "q");
    const item = loadHistory()[0];
    expect(item.mode).toBe("phrase");
    expect(item.filters.lang).toBe("fr,en");
    expect(item.filters.role).toBe("source");
    expect(item.aligned).toBe(true);
  });

  it("déduplique : ré-enregistrer une requête la remonte sans doublon", () => {
    saveToHistory("a", "a");
    saveToHistory("b", "b");
    saveToHistory("a", "a");
    expect(loadHistory().map((i) => i.raw)).toEqual(["a", "b"]);
  });

  it("plafonne les non-épinglés à 10 (les plus récents conservés)", () => {
    for (let i = 0; i < 15; i++) saveToHistory(`q${i}`, `q${i}`);
    const h = loadHistory();
    expect(h).toHaveLength(10);
    expect(h[0].raw).toBe("q14");
    expect(h.some((i) => i.raw === "q0")).toBe(false);
  });
});

// ─── togglePin ───────────────────────────────────────────────────────────────

describe("togglePin", () => {
  it("épingle puis désépingle un item existant", () => {
    saveToHistory("a", "a");
    togglePin("a", "a");
    expect(loadHistory().find((i) => i.raw === "a")?.pinned).toBe(true);
    togglePin("a", "a");
    expect(loadHistory().find((i) => i.raw === "a")?.pinned).toBe(false);
  });

  it("requête inconnue → no-op", () => {
    saveToHistory("a", "a");
    togglePin("zzz", "zzz");
    expect(loadHistory()[0].pinned).toBe(false);
  });

  it("un item épinglé survit au plafonnement des non-épinglés", () => {
    saveToHistory("keep", "keep");
    togglePin("keep", "keep");
    for (let i = 0; i < 15; i++) saveToHistory(`q${i}`, `q${i}`);
    expect(loadHistory().some((i) => i.raw === "keep" && i.pinned)).toBe(true);
  });
});

// ─── clearHistory / clearAllHistory ──────────────────────────────────────────

describe("clearHistory / clearAllHistory", () => {
  it("clearHistory conserve les épinglés et retire le reste", () => {
    saveToHistory("pinme", "pinme");
    togglePin("pinme", "pinme");
    saveToHistory("temp", "temp");
    clearHistory();
    expect(loadHistory().map((i) => i.raw)).toEqual(["pinme"]);
  });

  it("clearAllHistory vide tout, y compris les épinglés", () => {
    saveToHistory("a", "a");
    togglePin("a", "a");
    clearAllHistory();
    expect(loadHistory()).toEqual([]);
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });
});

// ─── loadHistory robustness ──────────────────────────────────────────────────

describe("loadHistory robustesse", () => {
  it("clé absente → []", () => {
    expect(loadHistory()).toEqual([]);
  });

  it("JSON corrompu → [] sans crash", () => {
    localStorage.setItem(LS_KEY, "{not valid json");
    expect(loadHistory()).toEqual([]);
  });
});

// ─── relTime ─────────────────────────────────────────────────────────────────

describe("relTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const now = (): number => Date.now();

  it("< 1 minute", () => expect(relTime(now() - 30_000)).toBe("< 1 min"));
  it("minutes", () => expect(relTime(now() - 5 * 60_000)).toBe("5 min"));
  it("heures", () => expect(relTime(now() - 3 * 3_600_000)).toBe("3 h"));
  it("jours", () => expect(relTime(now() - 2 * 86_400_000)).toBe("2 j"));
});
