import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  clearLastConn,
  loadLastConn,
  saveLastConn,
  secureDelete,
  secureGet,
  secureSet,
} from "../credentialStore.ts";

const LS_KEY = "agrafes.prep.sharedocs.lastConn";

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

beforeEach(() => {
  (globalThis as { localStorage: Storage }).localStorage = fakeStorage();
  vi.mocked(invoke).mockReset();
});

describe("non-secret prefs (localStorage)", () => {
  it("round-trips a remembered connection", () => {
    saveLastConn({ url: "https://x/d/", mode: "basic", user: "alice", remember: true });
    expect(loadLastConn()).toEqual({
      url: "https://x/d/",
      mode: "basic",
      user: "alice",
      remember: true,
    });
  });

  it("returns null when nothing is stored", () => {
    expect(loadLastConn()).toBeNull();
  });

  it("clearLastConn forgets the prefs", () => {
    saveLastConn({ url: "https://x/d/", mode: "bearer", user: "", remember: true });
    clearLastConn();
    expect(loadLastConn()).toBeNull();
  });

  it("ignores corrupt JSON and invalid mode", () => {
    localStorage.setItem(LS_KEY, "{not json");
    expect(loadLastConn()).toBeNull();
    localStorage.setItem(LS_KEY, JSON.stringify({ url: "x", mode: "weird" }));
    expect(loadLastConn()).toBeNull();
  });

  it("never writes a password or token to disk", () => {
    saveLastConn({ url: "https://x/d/", mode: "basic", user: "alice", remember: true });
    const raw = localStorage.getItem(LS_KEY) ?? "";
    expect(raw).not.toContain("password");
    expect(raw).not.toContain("token");
  });
});

describe("secret accessors (OS keychain via invoke)", () => {
  it("secureGet returns the stored secret and calls the right command", async () => {
    vi.mocked(invoke).mockResolvedValue("s3cret");
    await expect(secureGet("acc")).resolves.toBe("s3cret");
    expect(invoke).toHaveBeenCalledWith("keyring_get", {
      service: "agrafes.sharedocs",
      account: "acc",
    });
  });

  it("secureGet maps an absent entry (null) to null", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(secureGet("acc")).resolves.toBeNull();
  });

  it("secureGet degrades to null when the command is unavailable", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no such command"));
    await expect(secureGet("acc")).resolves.toBeNull();
  });

  it("secureSet returns true on success, false on failure", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await expect(secureSet("acc", "s")).resolves.toBe(true);
    vi.mocked(invoke).mockRejectedValueOnce(new Error("locked"));
    await expect(secureSet("acc", "s")).resolves.toBe(false);
  });

  it("secureDelete never throws even when the command fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("boom"));
    await expect(secureDelete("acc")).resolves.toBeUndefined();
  });
});
