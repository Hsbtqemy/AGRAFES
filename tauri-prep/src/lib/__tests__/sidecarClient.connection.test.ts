/**
 * Connection-layer integration tests for sidecarClient.ts (audit T-05).
 *
 * These pin the behaviour of the sidecar *connection* logic — the code that
 * U-01 must later unify across tauri-app and tauri-prep (PR2). The module
 * imports Tauri plugins at top level, so we mock them and drive the connection
 * paths through the Rust command seam (everything funnels through invoke):
 *   - invoke("read_sidecar_portfile")  → portfile JSON      (readPortfile)
 *   - invoke("sidecar_fetch_loopback") → {status,ok,body}   (sidecarFetch; the
 *     loopback backend mode is "tauri_only", so HTTP goes via this command)
 *   - invoke("register_sidecar")       → registry notify     (_notifyRustRegistry)
 *
 * Covered: pure URL helpers, SidecarError, getActiveConn/resetConnection,
 * shutdownSidecar, and ensureRunning's reuse paths (portfile + in-memory),
 * incl. the token-parsing and registry-notify behaviour PR2 will merge.
 * Not covered (documented gap): the spawn path (_spawnSidecar → Command.sidecar
 * + child stdout) — needs a process-spawn harness, deferred.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { sidecar: vi.fn() } }));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ resolveResource: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

import {
  type Conn,
  ensureRunning,
  getActiveConn,
  isLoopbackUrl,
  makeBaseUrl,
  normalizeLoopbackHost,
  resetConnection,
  SidecarError,
  shutdownSidecar,
} from "../sidecarClient";

/**
 * Wire the invoke() seam: portfile payload, loopback /health response, and
 * no-op log/registry commands. A null portfile makes readPortfile fail.
 */
function wireSidecar(
  portfile: Record<string, unknown> | null,
  health: Record<string, unknown> = { ok: true, token_required: false },
): void {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "read_sidecar_portfile") {
      if (portfile === null) throw new Error("no portfile");
      return JSON.stringify(portfile);
    }
    if (cmd === "sidecar_fetch_loopback") {
      return { status: 200, ok: true, body: JSON.stringify(health) };
    }
    return undefined; // write_sidecar_log, register_sidecar, …
  });
}

const PORTFILE = { host: "127.0.0.1", port: 8765, token: "abc", db_path: "/data/corpus.db" };

beforeEach(() => {
  vi.clearAllMocks();
  resetConnection();
  wireSidecar(null);
});

// ─── Pure URL helpers ─────────────────────────────────────────────────────────

describe("normalizeLoopbackHost", () => {
  it("defaults blank/empty to 127.0.0.1", () => {
    expect(normalizeLoopbackHost(null)).toBe("127.0.0.1");
    expect(normalizeLoopbackHost(undefined)).toBe("127.0.0.1");
    expect(normalizeLoopbackHost("")).toBe("127.0.0.1");
    expect(normalizeLoopbackHost("   ")).toBe("127.0.0.1");
  });

  it("maps loopback aliases to 127.0.0.1", () => {
    expect(normalizeLoopbackHost("localhost")).toBe("127.0.0.1");
    expect(normalizeLoopbackHost("0.0.0.0")).toBe("127.0.0.1");
    expect(normalizeLoopbackHost("::1")).toBe("127.0.0.1");
    expect(normalizeLoopbackHost("LOCALHOST")).toBe("127.0.0.1");
  });

  it("unbrackets IPv6 and leaves real hosts untouched", () => {
    expect(normalizeLoopbackHost("[::1]")).toBe("127.0.0.1");
    expect(normalizeLoopbackHost("192.168.1.5")).toBe("192.168.1.5");
  });
});

describe("makeBaseUrl", () => {
  it("builds an http URL with the normalized host and port", () => {
    expect(makeBaseUrl("localhost", 8765)).toBe("http://127.0.0.1:8765");
    expect(makeBaseUrl(null, 1234)).toBe("http://127.0.0.1:1234");
    expect(makeBaseUrl("192.168.0.2", 9000)).toBe("http://192.168.0.2:9000");
  });
});

describe("isLoopbackUrl", () => {
  it("recognizes loopback URLs only", () => {
    expect(isLoopbackUrl("http://127.0.0.1:8765")).toBe(true);
    expect(isLoopbackUrl("http://localhost:8765")).toBe(true);
    expect(isLoopbackUrl("http://192.168.0.2:8765")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("does NOT match bracketed IPv6 loopback (known quirk)", () => {
    // URL.hostname keeps the brackets ("[::1]"), but isLoopbackUrl compares
    // against the bare "::1" — so an IPv6 loopback URL is not recognized.
    // Pinned here as real behavior; note the asymmetry with
    // normalizeLoopbackHost, which DOES unbracket "[::1]" → 127.0.0.1.
    expect(isLoopbackUrl("http://[::1]:8765")).toBe(false);
  });
});

describe("SidecarError", () => {
  it("carries the message and optional HTTP status", () => {
    const e = new SidecarError("boom", 409);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("SidecarError");
    expect(e.message).toBe("boom");
    expect(e.httpStatus).toBe(409);
    expect(new SidecarError("x").httpStatus).toBeUndefined();
  });
});

// ─── Connection state ─────────────────────────────────────────────────────────

describe("getActiveConn / resetConnection", () => {
  it("returns null with no active connection", () => {
    expect(getActiveConn()).toBeNull();
  });

  it("resetConnection clears the active connection", async () => {
    wireSidecar(PORTFILE);
    await ensureRunning("/data/corpus.db");
    expect(getActiveConn()).not.toBeNull();
    resetConnection();
    expect(getActiveConn()).toBeNull();
  });
});

describe("shutdownSidecar", () => {
  it("POSTs /shutdown, clears state, and notifies the Rust registry", async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const fakeConn = { baseUrl: "http://127.0.0.1:9", token: "t", get: vi.fn(), post, put: vi.fn() };

    await shutdownSidecar(fakeConn as unknown as Conn);

    expect(post).toHaveBeenCalledWith("/shutdown", {});
    expect(getActiveConn()).toBeNull();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("register_sidecar", { baseUrl: "", token: null });
  });

  it("swallows a failing /shutdown (best-effort) and still clears state", async () => {
    const post = vi.fn().mockRejectedValue(new Error("refused"));
    const fakeConn = { baseUrl: "http://127.0.0.1:9", token: null, get: vi.fn(), post, put: vi.fn() };

    await expect(shutdownSidecar(fakeConn as unknown as Conn)).resolves.toBeUndefined();
    expect(getActiveConn()).toBeNull();
  });
});

// ─── ensureRunning — reuse paths ──────────────────────────────────────────────

describe("ensureRunning (portfile reuse)", () => {
  it("reuses a healthy portfile sidecar serving the same DB", async () => {
    wireSidecar({ ...PORTFILE, token: "  abc  " });

    const conn = await ensureRunning("/data/corpus.db");

    expect(conn.baseUrl).toBe("http://127.0.0.1:8765");
    expect(conn.token).toBe("abc"); // parseToken trims "  abc  "
    expect(getActiveConn()).toBe(conn);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("register_sidecar", {
      baseUrl: "http://127.0.0.1:8765",
      token: "abc",
    });
  });

  it("treats a blank portfile token as null (parseToken)", async () => {
    wireSidecar({ ...PORTFILE, token: "   " });

    const conn = await ensureRunning("/data/corpus.db");

    expect(conn.token).toBeNull();
  });

  it("normalizes the host from the portfile", async () => {
    wireSidecar({ ...PORTFILE, host: "localhost", port: 7000 });

    const conn = await ensureRunning("/data/corpus.db");

    expect(conn.baseUrl).toBe("http://127.0.0.1:7000");
  });
});

describe("ensureRunning (in-memory reuse)", () => {
  it("returns the cached connection without re-reading the portfile", async () => {
    wireSidecar(PORTFILE);
    const first = await ensureRunning("/data/corpus.db");

    vi.mocked(invoke).mockClear();
    const second = await ensureRunning("/data/corpus.db");

    expect(second).toBe(first); // same cached Conn instance
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("read_sidecar_portfile", expect.anything());
  });
});
