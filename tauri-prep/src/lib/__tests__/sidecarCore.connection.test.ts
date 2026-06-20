/**
 * Connection-layer integration tests for shared/sidecarCore.ts (audit T-05).
 *
 * These pin the behaviour of the shared sidecar *connection* core (U-01) that
 * both tauri-app (Explorer) and tauri-prep (Constituer) import — tested here
 * directly against sidecarCore, independent of either client, so the suite
 * still applies if Explorer ever ships standalone. The module imports Tauri
 * plugins at top level, so we mock them and drive the connection paths through
 * the Rust command seam (everything funnels through invoke):
 *   - invoke("read_sidecar_portfile")  → portfile JSON      (readPortfile)
 *   - invoke("sidecar_fetch_loopback") → {status,ok,body}   (sidecarFetch; the
 *     loopback backend mode is "tauri_only", so HTTP goes via this command)
 *   - invoke("register_sidecar")       → registry notify     (_notifyRustRegistry)
 *
 * Covered: pure URL helpers, SidecarError, getActiveConn/resetConnection,
 * shutdownSidecar, ensureRunning's *reuse* paths (portfile + in-memory +
 * DB-switch), and the *spawn* (cold-start) path — happy path (startup JSON →
 * connect, token parsed, registry notified) + killing a prior child before
 * re-spawn — via a fake Command (makeFakeCommand). Together these guard both
 * sides (reuse + spawn) of the shared connection lifecycle.
 *
 * Still NOT covered (documented gap): spawn-failure (leaves the startup-JSON
 * reader's ~12 s timeout pending — see note at the spawn block), the
 * different-DB portfile stale-shutdown path, and unhealthy / token-required
 * fall-throughs. Note: spawn tests set the module-level _spawnedChild, which
 * resetConnection() does not clear — harmless across the reuse tests (they
 * never spawn).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { sidecar: vi.fn() } }));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ resolveResource: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { Command } from "@tauri-apps/plugin-shell";

import {
  type Conn,
  ensureRunning,
  getActiveConn,
  isLoopbackUrl,
  makeBaseUrl,
  normalizeLoopbackHost,
  resetConnection,
  SIDECAR_STARTUP_JSON_TIMEOUT_MS,
  SidecarError,
  shutdownSidecar,
} from "../../../../shared/sidecarCore";

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

/**
 * Build a fake Tauri Command for the spawn path. The startup JSON is emitted to
 * the stdout reader (registered by _readFirstJsonFromCommand before spawn) as
 * soon as spawn() is called, mirroring the real sidecar printing its port/token.
 */
function makeFakeCommand(startup: Record<string, unknown>) {
  let stdoutCb: ((c: string) => void) | undefined;
  const child = { pid: 4242, kill: vi.fn().mockResolvedValue(undefined) };
  return {
    _child: child,
    stdout: { on: (ev: string, cb: (c: string) => void) => { if (ev === "data") stdoutCb = cb; } },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    spawn: vi.fn(async () => {
      stdoutCb?.(JSON.stringify(startup)); // sidecar prints startup payload
      return child;
    }),
  };
}

/** Like makeFakeCommand but never emits a startup payload — drives the
 *  startup-JSON timeout (reap-on-failed-spawn, R-01c). */
function makeSilentCommand() {
  const child = { pid: 5151, kill: vi.fn().mockResolvedValue(undefined) };
  return {
    _child: child,
    stdout: { on: vi.fn() }, // never delivers "data" → no startup JSON
    stderr: { on: vi.fn() },
    on: vi.fn(),
    spawn: vi.fn(async () => child),
  };
}

// prep's vitest environment is "node" (no DOM), so localStorage is absent —
// the port-persistence path no-ops there via its try/catch. Provide a minimal
// in-memory stub so the port-write is observable in these tests.
const _localStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string): string | null => (k in _localStore ? _localStore[k] : null),
  setItem: (k: string, v: string): void => { _localStore[k] = v; },
  removeItem: (k: string): void => { delete _localStore[k]; },
  clear: (): void => { for (const k of Object.keys(_localStore)) delete _localStore[k]; },
});

beforeEach(() => {
  vi.clearAllMocks();
  resetConnection();
  localStorage.clear();
  wireSidecar(null);
  vi.mocked(resolveResource).mockResolvedValue("/fake/sidecar");
  vi.mocked(exists).mockResolvedValue(false);
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
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("register_sidecar", { baseUrl: "", token: null, pid: null });
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
      pid: null, // reuse + this portfile carries no pid
    });
  });

  it("registers the portfile pid so the reap fallback covers reused sidecars (R-01d)", async () => {
    // A sidecar adopted via portfile (not spawned this session) has no _spawnedChild
    // handle; without the portfile pid the Rust PID-kill fallback couldn't reap it.
    wireSidecar({ ...PORTFILE, pid: 9999 });

    await ensureRunning("/data/corpus.db");

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("register_sidecar", {
      baseUrl: "http://127.0.0.1:8765",
      token: "abc",
      pid: 9999,
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

  it("persists the port to localStorage for the shell diagnostics", async () => {
    wireSidecar({ ...PORTFILE, port: 7321 });

    await ensureRunning("/data/corpus.db");

    expect(localStorage.getItem("agrafes.sidecar.port")).toBe("7321");
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

  it("re-persists the port on in-memory reuse (survives a cleared store)", async () => {
    wireSidecar(PORTFILE);
    await ensureRunning("/data/corpus.db"); // establishes + persists port 8765
    localStorage.clear();                   // simulate the key being lost mid-session
    await ensureRunning("/data/corpus.db"); // in-memory reuse re-writes it
    expect(localStorage.getItem("agrafes.sidecar.port")).toBe("8765");
  });

  it("drops the cached connection when the DB path changes", async () => {
    // Guards the "wrong DB" prevention: a connection cached for one corpus must
    // not be reused for another. (The portfile is shared per-directory.)
    wireSidecar({ ...PORTFILE, db_path: "/data/a.db" });
    const connA = await ensureRunning("/data/a.db");

    wireSidecar({ host: "127.0.0.1", port: 9999, token: "b", db_path: "/data/b.db" });
    const connB = await ensureRunning("/data/b.db");

    expect(connB).not.toBe(connA);
    expect(connB.baseUrl).toBe("http://127.0.0.1:9999");
    expect(getActiveConn()).toBe(connB);
  });
});

// ─── ensureRunning — spawn (cold start) ───────────────────────────────────────

describe("ensureRunning (spawn / cold start)", () => {
  it("spawns a sidecar when no portfile exists and connects from startup JSON", async () => {
    wireSidecar(null); // no portfile → fall through to spawn
    const cmd = makeFakeCommand({
      host: "127.0.0.1", port: 8765, token: "  abc  ", portfile: "/data/.agrafes_sidecar.json",
    });
    vi.mocked(Command.sidecar).mockReturnValue(cmd as never);

    const conn = await ensureRunning("/data/corpus.db");

    expect(vi.mocked(Command.sidecar)).toHaveBeenCalledTimes(1);
    expect(cmd.spawn).toHaveBeenCalledTimes(1);
    expect(conn.baseUrl).toBe("http://127.0.0.1:8765");
    expect(conn.token).toBe("abc"); // parseToken trims the startup-payload token
    expect(getActiveConn()).toBe(conn);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("register_sidecar", {
      baseUrl: "http://127.0.0.1:8765",
      token: "abc",
      pid: 4242, // makeFakeCommand's child pid — registered for the reap fallback
    });
  });

  it("kills a previously-spawned child before spawning a new one", async () => {
    const cmd1 = makeFakeCommand({ host: "127.0.0.1", port: 8765, token: "a", portfile: "/a/.agrafes_sidecar.json" });
    const cmd2 = makeFakeCommand({ host: "127.0.0.1", port: 8766, token: "b", portfile: "/b/.agrafes_sidecar.json" });
    vi.mocked(Command.sidecar).mockReturnValueOnce(cmd1 as never).mockReturnValueOnce(cmd2 as never);

    await ensureRunning("/a/corpus.db");                  // spawn 1 → _spawnedChild = child1
    const conn2 = await ensureRunning("/b/corpus.db");    // DB change → spawn 2, kills child1

    expect(cmd1._child.kill).toHaveBeenCalledTimes(1);
    expect(conn2.baseUrl).toBe("http://127.0.0.1:8766");
  });

  it("persists the spawned port to localStorage", async () => {
    wireSidecar(null);
    const cmd = makeFakeCommand({ host: "127.0.0.1", port: 9123, token: "t", portfile: "/data/.agrafes_sidecar.json" });
    vi.mocked(Command.sidecar).mockReturnValue(cmd as never);

    await ensureRunning("/data/corpus.db");

    expect(localStorage.getItem("agrafes.sidecar.port")).toBe("9123");
  });

  it("coalesces concurrent ensureRunning calls for the same DB into one spawn (R-01c)", async () => {
    wireSidecar(null); // no portfile → both calls would spawn without single-flight
    const cmd = makeFakeCommand({ host: "127.0.0.1", port: 8765, token: "t", portfile: "/data/.agrafes_sidecar.json" });
    vi.mocked(Command.sidecar).mockReturnValue(cmd as never);

    // Fire two concurrently (mirrors the 4 parallel screen-load GETs that drove
    // the spawn-storm): the second must ride the first's in-flight promise.
    const [a, b] = await Promise.all([
      ensureRunning("/data/corpus.db"),
      ensureRunning("/data/corpus.db"),
    ]);

    expect(a).toBe(b);                                            // same coalesced Conn
    expect(vi.mocked(Command.sidecar)).toHaveBeenCalledTimes(1);  // ONE spawn, not two
    expect(cmd.spawn).toHaveBeenCalledTimes(1);
  });

  it("reaps the spawned child when no startup payload ever arrives (R-01c)", async () => {
    vi.useFakeTimers();
    try {
      wireSidecar(null);
      const cmd = makeSilentCommand();
      vi.mocked(Command.sidecar).mockReturnValue(cmd as never);

      const p = ensureRunning("/data/corpus.db");
      p.catch(() => { /* expected rejection — avoid unhandled */ });

      // Drive the startup-JSON timeout; the post-spawn catch must reap the child.
      await vi.advanceTimersByTimeAsync(SIDECAR_STARTUP_JSON_TIMEOUT_MS + 100);

      await expect(p).rejects.toThrow();
      expect(cmd._child.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Transport (conn.get / conn.post) — shared HTTP semantics ─────────────────
//
// makeConn's transport (in shared/sidecarCore, _rawGet/_rawPost/_rawPut) is what
// every endpoint in both clients relies on. These pin the semantics that must
// hold: JSON envelope, SidecarError mapping, token header, and reconnect-once.

describe("connection transport", () => {
  /** Establish a live _conn (portfile reuse) with the given token. */
  async function connect(token: string): Promise<Conn> {
    wireSidecar({ ...PORTFILE, token });
    return ensureRunning("/data/corpus.db");
  }

  /** Route invoke: portfile + /health always healthy; other URLs via `onFetch`. */
  function routeFetch(onFetch: (url: string, args: Record<string, unknown>) => unknown): void {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args) => {
      if (cmd === "read_sidecar_portfile") return JSON.stringify(PORTFILE);
      if (cmd === "sidecar_fetch_loopback") {
        const a = (args ?? {}) as Record<string, unknown>;
        const url = String(a.url ?? "");
        if (url.endsWith("/health")) {
          return { status: 200, ok: true, body: JSON.stringify({ ok: true, token_required: false }) };
        }
        return onFetch(url, a);
      }
      return undefined;
    });
  }

  it("returns the parsed JSON envelope on success", async () => {
    const conn = await connect("abc");
    routeFetch(() => ({ status: 200, ok: true, body: JSON.stringify({ ok: true, value: 42 }) }));

    await expect(conn.post("/echo", { a: 1 })).resolves.toEqual({ ok: true, value: 42 });
  });

  it("maps a non-ok response to SidecarError (message + status)", async () => {
    const conn = await connect("abc");
    routeFetch(() => ({ status: 409, ok: false, body: JSON.stringify({ ok: false, error_message: "conflict" }) }));

    const err = (await conn.post("/x", {}).catch((e) => e)) as SidecarError;
    expect(err).toBeInstanceOf(SidecarError);
    expect(err.message).toBe("conflict");
    expect(err.httpStatus).toBe(409);
  });

  it("injects the X-Agrafes-Token header when a token is present", async () => {
    const conn = await connect("secret-tok");
    let seenHeaders: Record<string, string> | undefined;
    routeFetch((_url, args) => {
      seenHeaders = args.headers as Record<string, string>;
      return { status: 200, ok: true, body: JSON.stringify({ ok: true }) };
    });

    await conn.get("/whoami");
    expect(seenHeaders?.["X-Agrafes-Token"]).toBe("secret-tok");
  });

  it("reconnects once after a network error, then retries the call", async () => {
    const conn = await connect("abc");
    let dataAttempts = 0;
    routeFetch(() => {
      dataAttempts += 1;
      if (dataAttempts === 1) throw new Error("ECONNREFUSED"); // transport-level failure
      return { status: 200, ok: true, body: JSON.stringify({ ok: true, recovered: true }) };
    });

    await expect(conn.post("/x", {})).resolves.toEqual({ ok: true, recovered: true });
    expect(dataAttempts).toBe(2); // failed once → reconnect → retried once
  });
});
