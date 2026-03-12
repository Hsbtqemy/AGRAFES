/**
 * sidecarClient.ts — Persistent sidecar HTTP client for Concordancier V0.
 *
 * Responsibilities:
 *  - ensureRunning(dbPath): spawn sidecar if not already running, return Conn.
 *  - Reuse existing sidecar via portfile discovery.
 *  - Inject X-Agrafes-Token on write endpoints.
 *  - Surface clean error messages (no stacktraces) to the UI.
 *
 * Sidecar portfile: <db_dir>/.agrafes_sidecar.json
 * Spawn command: multicorpus serve --db <dbPath> --host 127.0.0.1 --port 0 --token auto
 */

import { Command, type Child } from "@tauri-apps/plugin-shell";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { resolveResource } from "@tauri-apps/api/path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueryHit {
  doc_id: number;
  unit_id: number;
  external_id: number | null;
  language: string;
  title: string;
  // segment mode
  text?: string;
  text_norm?: string;
  // kwic mode
  left?: string;
  match?: string;
  right?: string;
  // aligned view
  aligned?: AlignedUnit[];
}

export interface AlignedUnit {
  unit_id: number;
  doc_id: number;
  external_id: number | null;
  language: string;
  title: string;
  text?: string;
  text_norm: string;
}

export interface QueryOptions {
  q: string;
  mode?: "segment" | "kwic";
  window?: number;
  language?: string;
  doc_id?: number;
  doc_role?: string;
  resource_type?: string;
  includeAligned?: boolean;
  alignedLimit?: number;
  include_aligned?: boolean;
  all_occurrences?: boolean;
  limit?: number;
  offset?: number;
}

export interface QueryResponse {
  ok: boolean;
  status: string;
  count: number;
  hits: QueryHit[];
  limit?: number;
  offset?: number;
  next_offset?: number | null;
  has_more?: boolean;
  total?: number | null;
}

export interface ImportOptions {
  mode: "docx_numbered_lines" | "txt_numbered_lines" | "docx_paragraphs" | "tei";
  path: string;
  language?: string;
  title?: string;
  doc_role?: string;
  resource_type?: string;
}

export interface ImportResponse {
  ok: boolean;
  doc_id: number;
  units_line: number;
  units_total: number;
}

export interface IndexResponse {
  ok: boolean;
  units_indexed: number;
}

export interface DocumentRecord {
  doc_id: number;
  title: string;
  language: string;
  doc_role: string | null;
  resource_type: string | null;
  unit_count: number;
}

// ─── Connection handle ────────────────────────────────────────────────────────

export interface Conn {
  baseUrl: string;
  token: string | null;
  /** POST a write operation (injects token header if present). */
  post(path: string, body: unknown): Promise<unknown>;
  /** POST a read-only operation (no token required). */
  get(path: string): Promise<unknown>;
}

// ─── Internal state ───────────────────────────────────────────────────────────

let _conn: Conn | null = null;
let _spawnedChild: Child | null = null;
const SIDECAR_PROGRAM = "multicorpus";
const IS_WINDOWS_RUNTIME =
  typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
const SIDECAR_HEALTH_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 45000 : 15000;
const SIDECAR_HEALTH_INITIAL_DELAY_MS = IS_WINDOWS_RUNTIME ? 1200 : 0;
const SIDECAR_HEALTH_POLL_INTERVAL_MS = 350;
const SIDECAR_STARTUP_JSON_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 20000 : 12000;

type SidecarLogLevel = "info" | "warn" | "error";
type SidecarFetchInit = Parameters<typeof tauriFetch>[1] & RequestInit;

function sidecarLog(level: SidecarLogLevel, message: string, detail?: unknown): void {
  const prefix = `[sidecar-client ${new Date().toISOString()}] ${message}`;
  if (level === "error") {
    if (detail !== undefined) console.error(prefix, detail);
    else console.error(prefix);
    return;
  }
  if (level === "warn") {
    if (detail !== undefined) console.warn(prefix, detail);
    else console.warn(prefix);
    return;
  }
  if (detail !== undefined) console.info(prefix, detail);
  else console.info(prefix);
}

function errToString(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function expectedSidecarResourceName(): string {
  if (IS_WINDOWS_RUNTIME) {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isArm64 = /\b(arm64|aarch64)\b/i.test(ua);
    const triple = isArm64 ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    return `${SIDECAR_PROGRAM}-${triple}.exe`;
  }
  return SIDECAR_PROGRAM;
}

async function resolveExpectedSidecarPathForLogs(): Promise<string | null> {
  try {
    return await resolveResource(expectedSidecarResourceName());
  } catch {
    return null;
  }
}

export function normalizeLoopbackHost(host: string | null | undefined): string {
  const raw = (host ?? "").trim();
  if (!raw) return "127.0.0.1";

  const unbracketed = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  const lowered = unbracketed.toLowerCase();
  if (lowered === "localhost" || lowered === "0.0.0.0" || lowered === "::1") {
    return "127.0.0.1";
  }
  return unbracketed;
}

export function makeBaseUrl(host: string | null | undefined, port: number): string {
  return `http://${normalizeLoopbackHost(host)}:${port}`;
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

async function sidecarFetch(url: string, init?: SidecarFetchInit): Promise<Response> {
  if (isLoopbackUrl(url)) {
    if (typeof globalThis.fetch === "function") {
      try {
        return await globalThis.fetch(url, init);
      } catch (err) {
        sidecarLog(
          "warn",
          `loopback fetch via globalThis.fetch failed for ${url}; fallback to tauri fetch`,
          errToString(err)
        );
      }
    }
  }
  return tauriFetch(url, init);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function portfilePath(dbPath: string): string {
  // Place portfile next to the DB file
  const dir = dbPath.includes("/")
    ? dbPath.substring(0, dbPath.lastIndexOf("/"))
    : dbPath.includes("\\")
    ? dbPath.substring(0, dbPath.lastIndexOf("\\"))
    : ".";
  return `${dir}/.agrafes_sidecar.json`;
}

async function readPortfile(portfile: string): Promise<Record<string, unknown> | null> {
  try {
    if (!(await exists(portfile))) return null;
    const raw = await readTextFile(portfile);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseStartupPort(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

interface PollHealthOptions {
  maxMs?: number;
  initialDelayMs?: number;
  intervalMs?: number;
}

async function pollHealth(baseUrl: string, options: PollHealthOptions = {}): Promise<boolean> {
  const maxMs = options.maxMs ?? SIDECAR_HEALTH_TIMEOUT_MS;
  const initialDelayMs = options.initialDelayMs ?? SIDECAR_HEALTH_INITIAL_DELAY_MS;
  const intervalMs = options.intervalMs ?? SIDECAR_HEALTH_POLL_INTERVAL_MS;

  if (initialDelayMs > 0) {
    sidecarLog(
      "info",
      `health polling initial delay ${initialDelayMs}ms before first ping (${baseUrl}/health)`
    );
    await sleep(initialDelayMs);
  }

  const deadline = Date.now() + maxMs;
  let attempts = 0;
  let lastError = "";

  while (Date.now() < deadline) {
    attempts += 1;
    const attemptStarted = Date.now();
    try {
      const res = await sidecarFetch(`${baseUrl}/health`);
      const elapsedMs = Date.now() - attemptStarted;

      let json: Record<string, unknown> | null = null;
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch (jsonErr) {
        lastError = `attempt ${attempts}: invalid JSON (${errToString(jsonErr)})`;
        sidecarLog("warn", `${baseUrl}/health attempt #${attempts} invalid JSON (${elapsedMs}ms)`);
      }

      if (res.ok) {
        if (json && (json.ok === true || json.status === "ok")) {
          sidecarLog("info", `${baseUrl}/health attempt #${attempts} OK (${elapsedMs}ms)`);
          return true;
        }
        lastError = `attempt ${attempts}: HTTP ${res.status} but payload is not healthy`;
        sidecarLog(
          "warn",
          `${baseUrl}/health attempt #${attempts} not healthy (${elapsedMs}ms)`,
          json
        );
      } else {
        lastError = `attempt ${attempts}: HTTP ${res.status}`;
        sidecarLog(
          "warn",
          `${baseUrl}/health attempt #${attempts} HTTP ${res.status} (${elapsedMs}ms)`,
          json
        );
      }
    } catch (err) {
      const elapsedMs = Date.now() - attemptStarted;
      lastError = `attempt ${attempts}: ${errToString(err)}`;
      sidecarLog(
        "warn",
        `${baseUrl}/health attempt #${attempts} failed (${elapsedMs}ms)`,
        errToString(err)
      );
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  sidecarLog(
    "error",
    `health timeout after ${maxMs}ms (${attempts} attempts) for ${baseUrl}/health; last error: ${lastError || "(none)"}`
  );
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeConn(baseUrl: string, token: string | null): Conn {
  return {
    baseUrl,
    token,
    async post(path: string, body: unknown): Promise<unknown> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
      };
      if (token) headers["X-Agrafes-Token"] = token;
      const res = await sidecarFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok || json.ok === false) {
        const msg =
          (json.error_message as string) ||
          (json.error as string) ||
          `HTTP ${res.status}`;
        throw new SidecarError(msg, res.status);
      }
      return json;
    },
    async get(path: string): Promise<unknown> {
      const res = await sidecarFetch(`${baseUrl}${path}`);
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const msg = (json.error_message as string) || `HTTP ${res.status}`;
        throw new SidecarError(msg, res.status);
      }
      return json;
    },
  };
}

// ─── Public error class ───────────────────────────────────────────────────────

export class SidecarError extends Error {
  constructor(message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "SidecarError";
  }
}

// ─── Core: ensureRunning ──────────────────────────────────────────────────────

/**
 * Ensure the sidecar is running for the given DB path.
 *
 * Flow:
 * 1. Check if we already have a live connection (in-memory cache).
 * 2. Try to read portfile and verify /health.
 * 3. If neither works, spawn a new sidecar process.
 */
export async function ensureRunning(dbPath: string): Promise<Conn> {
  sidecarLog("info", `ensureRunning called (db=${dbPath})`);

  // 1. In-memory: reuse if /health still OK
  if (_conn) {
    try {
      await _conn.get("/health");
      sidecarLog("info", "reusing in-memory sidecar connection");
      return _conn;
    } catch (err) {
      sidecarLog("warn", "in-memory sidecar connection is stale; reconnecting", errToString(err));
      _conn = null;
    }
  }

  // 2. Portfile discovery
  const pf = portfilePath(dbPath);
  sidecarLog("info", `checking sidecar portfile at ${pf}`);
  const pfData = await readPortfile(pf);
  if (pfData) {
    const host = (pfData.host as string) ?? "127.0.0.1";
    const port = pfData.port as number;
    const token = (pfData.token as string | null) ?? null;
    if (typeof port === "number" && port > 0) {
      const baseUrl = makeBaseUrl(host, port);
      try {
        const res = await sidecarFetch(`${baseUrl}/health`);
        const json = (await res.json()) as Record<string, unknown>;
        if (res.ok && json.ok === true) {
          sidecarLog("info", `reusing sidecar from portfile (${baseUrl})`);
          _conn = makeConn(baseUrl, token);
          return _conn;
        }
        sidecarLog("warn", `portfile sidecar not healthy (${baseUrl})`, json);
      } catch (err) {
        sidecarLog("warn", `portfile sidecar health check failed (${baseUrl})`, errToString(err));
        // portfile stale — fall through to spawn
      }
    }
  }

  // 3. Spawn
  sidecarLog("info", "spawning new sidecar process");
  return _spawnSidecar(dbPath);
}

async function _spawnSidecar(dbPath: string): Promise<Conn> {
  // Kill previous orphan if any
  if (_spawnedChild) {
    try {
      await _spawnedChild.kill();
    } catch {
      /* ignore */
    }
    _spawnedChild = null;
  }

  const sidecarArgs = [
    "serve",
    "--db",
    dbPath,
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--token",
    "auto",
  ];

  const expectedSidecarPath = await resolveExpectedSidecarPathForLogs();
  if (expectedSidecarPath) {
    const expectedExists = await exists(expectedSidecarPath).catch(() => false);
    sidecarLog(
      "info",
      `resolved sidecar path candidate: ${expectedSidecarPath} (exists=${expectedExists})`
    );
  } else {
    sidecarLog("warn", "could not resolve sidecar resource path candidate");
  }

  const command = Command.sidecar(SIDECAR_PROGRAM, sidecarArgs);
  const commandDebug = command as unknown as {
    program?: string;
    args?: string[];
    options?: { cwd?: string };
  };
  const spawnRequestedAtMs = Date.now();
  sidecarLog("info", "spawn config", {
    at: new Date(spawnRequestedAtMs).toISOString(),
    program: commandDebug.program ?? SIDECAR_PROGRAM,
    args: commandDebug.args ?? sidecarArgs,
    cwd: commandDebug.options?.cwd ?? null,
    dbPath,
  });

  command.stderr.on("data", (chunk: string) => {
    const stderrLine = chunk.trim();
    if (stderrLine) sidecarLog("warn", "sidecar stderr", stderrLine);
  });

  const firstJsonPromise = _readFirstJsonFromCommand(command, SIDECAR_STARTUP_JSON_TIMEOUT_MS);

  let child: Child;
  const spawnStartedAt = Date.now();
  try {
    child = await command.spawn();
  } catch (err) {
    sidecarLog("error", "sidecar spawn failed", errToString(err));
    throw new SidecarError(`Sidecar process error: ${String(err)}`);
  }
  _spawnedChild = child;
  command.on("close", (terminated) => {
    sidecarLog("warn", "sidecar process closed", {
      pid: child.pid,
      code: terminated.code,
      signal: terminated.signal,
      closedAt: new Date().toISOString(),
    });
  });
  sidecarLog("info", `sidecar spawned (pid=${child.pid}) after ${Date.now() - spawnStartedAt}ms`);

  const started = await firstJsonPromise;
  sidecarLog("info", "startup payload selected", started);

  const host = (started.host as string) ?? "127.0.0.1";
  const port = parseStartupPort(started.port);
  if (port === null) {
    sidecarLog("error", "startup payload rejected (invalid port)", started);
    throw new SidecarError("Sidecar startup payload missing valid port");
  }

  const baseUrl = makeBaseUrl(host, port);
  sidecarLog("info", `polling sidecar health on ${baseUrl}/health`, {
    timeoutMs: SIDECAR_HEALTH_TIMEOUT_MS,
    initialDelayMs: SIDECAR_HEALTH_INITIAL_DELAY_MS,
    intervalMs: SIDECAR_HEALTH_POLL_INTERVAL_MS,
  });

  const healthy = await pollHealth(baseUrl, {
    maxMs: SIDECAR_HEALTH_TIMEOUT_MS,
    initialDelayMs: SIDECAR_HEALTH_INITIAL_DELAY_MS,
    intervalMs: SIDECAR_HEALTH_POLL_INTERVAL_MS,
  });
  if (!healthy) {
    throw new SidecarError(
      `Sidecar did not become healthy within timeout (${SIDECAR_HEALTH_TIMEOUT_MS}ms)`
    );
  }

  // Read token from portfile (authoritative source)
  const pf = portfilePath(dbPath);
  const pfData = await readPortfile(pf);
  const token = pfData ? ((pfData.token as string | null) ?? null) : null;
  sidecarLog("info", `sidecar healthy at ${baseUrl} (token=${token ? "present" : "absent"})`);

  _conn = makeConn(baseUrl, token);
  return _conn;
}

/** Read first JSON line from command stdout. Call before spawn(); resolve after spawn(). */
function _readFirstJsonFromCommand(command: {
  stdout: { on(event: "data", cb: (chunk: string) => void): void };
  on(event: "error", cb: (err: unknown) => void): void;
  on(event: "close", cb: (payload: { code: number | null; signal: number | null }) => void): void;
}, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let rawBuffer = "";
    let currentJson = "";
    let depth = 0;
    let seenCandidates = 0;
    let lastCandidate: Record<string, unknown> | null = null;
    let resolved = false;
    const waitStartedAtMs = Date.now();
    const waitDeadlineAtMs = waitStartedAtMs + timeoutMs;
    sidecarLog("info", "waiting for sidecar startup JSON", {
      timeoutMs,
      startedAt: new Date(waitStartedAtMs).toISOString(),
      deadlineAt: new Date(waitDeadlineAtMs).toISOString(),
    });

    const tryResolveCandidate = (rawJson: string): void => {
      if (resolved) return;
      try {
        const candidate = JSON.parse(rawJson) as Record<string, unknown>;
        seenCandidates += 1;
        lastCandidate = candidate;
        sidecarLog("info", "startup payload candidate", candidate);

        const port = parseStartupPort(candidate.port);
        if (port === null) {
          sidecarLog("warn", "startup payload rejected (invalid port)", candidate);
          return;
        }

        candidate.port = port;
        resolved = true;
        clearTimeout(timer);
        resolve(candidate);
      } catch (e) {
        sidecarLog("warn", "ignoring unparsable startup JSON candidate", {
          error: errToString(e),
          raw: rawJson.slice(0, 800),
        });
      }
    };

    const timer = setTimeout(
      () => {
        sidecarLog(
          "error",
          "timeout waiting for startup JSON with valid port",
          {
            seenCandidates,
            lastCandidate,
            rawPreview: rawBuffer.trim().slice(0, 800),
            startedAt: new Date(waitStartedAtMs).toISOString(),
            timedOutAt: new Date().toISOString(),
            deadlineAt: new Date(waitDeadlineAtMs).toISOString(),
            elapsedMs: Date.now() - waitStartedAtMs,
          }
        );
        reject(new SidecarError("Timeout waiting for sidecar startup JSON with valid port"));
      },
      timeoutMs
    );

    command.stdout.on("data", (chunk: string) => {
      rawBuffer += chunk;
      for (const ch of chunk) {
        if (ch === "{") {
          if (depth === 0) currentJson = "{";
          else currentJson += ch;
          depth += 1;
        } else if (ch === "}") {
          if (depth <= 0) continue;
          currentJson += ch;
          depth -= 1;
          if (depth === 0 && currentJson.trim().length > 0) {
            tryResolveCandidate(currentJson.trim());
            currentJson = "";
            if (resolved) return;
          }
        } else if (depth > 0) {
          currentJson += ch;
        }
      }
    });

    command.on("error", (err: unknown) => {
      clearTimeout(timer);
      sidecarLog("error", "sidecar command emitted error before healthy", errToString(err));
      reject(new SidecarError(`Sidecar process error: ${String(err)}`));
    });

    command.on("close", (payload) => {
      sidecarLog("warn", "sidecar command close event while waiting for startup payload", {
        code: payload.code,
        signal: payload.signal,
        seenCandidates,
        lastCandidate,
        closedAt: new Date().toISOString(),
      });
    });
  });
}

// ─── High-level API methods ───────────────────────────────────────────────────

export async function query(
  conn: Conn,
  opts: QueryOptions
): Promise<QueryResponse> {
  const includeAligned = opts.includeAligned ?? opts.include_aligned ?? false;
  const payload: Record<string, unknown> = {
    q: opts.q,
    mode: opts.mode ?? "segment",
  };
  if (opts.window !== undefined) payload.window = opts.window;
  if (opts.language) payload.language = opts.language;
  if (opts.doc_id !== undefined) payload.doc_id = opts.doc_id;
  if (opts.doc_role) payload.doc_role = opts.doc_role;
  if (opts.resource_type) payload.resource_type = opts.resource_type;
  if (includeAligned) payload.include_aligned = true;
  if (includeAligned && opts.alignedLimit !== undefined) {
    payload.aligned_limit = opts.alignedLimit;
  }
  if (opts.all_occurrences) payload.all_occurrences = opts.all_occurrences;
  if (opts.limit !== undefined) payload.limit = opts.limit;
  if (opts.offset !== undefined) payload.offset = opts.offset;

  return conn.post("/query", payload) as Promise<QueryResponse>;
}

export async function importFile(
  conn: Conn,
  opts: ImportOptions
): Promise<ImportResponse> {
  return conn.post("/import", opts) as Promise<ImportResponse>;
}

export async function rebuildIndex(conn: Conn): Promise<IndexResponse> {
  return conn.post("/index", {}) as Promise<IndexResponse>;
}

export async function listDocuments(conn: Conn): Promise<DocumentRecord[]> {
  const res = (await conn.get("/documents")) as { documents: DocumentRecord[] };
  return res.documents;
}

export async function shutdownSidecar(conn: Conn): Promise<void> {
  try {
    await conn.post("/shutdown", {});
  } catch {
    // best-effort
  }
  _conn = null;
  _spawnedChild = null;
}

/** Reset in-memory state (e.g. after switching DB). */
export function resetConnection(): void {
  _conn = null;
}
