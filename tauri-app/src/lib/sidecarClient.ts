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
import { fetch } from "@tauri-apps/plugin-http";

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

async function pollHealth(baseUrl: string, maxMs = 15000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>;
        if (json.ok === true || json.status === "ok") return true;
      }
    } catch {
      // still starting
    }
    await sleep(300);
  }
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
      const res = await fetch(`${baseUrl}${path}`, {
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
      const res = await fetch(`${baseUrl}${path}`);
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
  // 1. In-memory: reuse if /health still OK
  if (_conn) {
    try {
      await _conn.get("/health");
      return _conn;
    } catch {
      _conn = null;
    }
  }

  // 2. Portfile discovery
  const pf = portfilePath(dbPath);
  const pfData = await readPortfile(pf);
  if (pfData) {
    const host = (pfData.host as string) ?? "127.0.0.1";
    const port = pfData.port as number;
    const token = (pfData.token as string | null) ?? null;
    if (typeof port === "number" && port > 0) {
      const baseUrl = `http://${host}:${port}`;
      try {
        const res = await fetch(`${baseUrl}/health`);
        const json = (await res.json()) as Record<string, unknown>;
        if (res.ok && json.ok === true) {
          _conn = makeConn(baseUrl, token);
          return _conn;
        }
      } catch {
        // portfile stale — fall through to spawn
      }
    }
  }

  // 3. Spawn
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

  const command = Command.sidecar(SIDECAR_PROGRAM, sidecarArgs);
  const firstJsonPromise = _readFirstJsonFromCommand(command);

  let child: Child;
  try {
    child = await command.spawn();
  } catch (err) {
    throw new SidecarError(`Sidecar process error: ${String(err)}`);
  }
  _spawnedChild = child;

  const started = await firstJsonPromise;

  const host = (started.host as string) ?? "127.0.0.1";
  const port = started.port as number;
  if (!Number.isFinite(port) || port <= 0) {
    throw new SidecarError("Sidecar startup payload missing valid port");
  }

  const baseUrl = `http://${host}:${port}`;
  const healthy = await pollHealth(baseUrl);
  if (!healthy) {
    throw new SidecarError("Sidecar did not become healthy within timeout");
  }

  // Read token from portfile (authoritative source)
  const pf = portfilePath(dbPath);
  const pfData = await readPortfile(pf);
  const token = pfData ? ((pfData.token as string | null) ?? null) : null;

  _conn = makeConn(baseUrl, token);
  return _conn;
}

/** Read first JSON line from command stdout. Call before spawn(); resolve after spawn(). */
function _readFirstJsonFromCommand(command: {
  stdout: { on(event: "data", cb: (chunk: string) => void): void };
  on(event: "error", cb: (err: unknown) => void): void;
}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let depth = 0;
    let started = false;
    const timer = setTimeout(
      () => reject(new SidecarError("Timeout waiting for sidecar startup JSON")),
      12000
    );

    command.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      for (const ch of chunk) {
        if (ch === "{") {
          depth += 1;
          started = true;
        } else if (ch === "}") {
          depth -= 1;
          if (started && depth === 0) {
            clearTimeout(timer);
            try {
              resolve(JSON.parse(buffer.trim()) as Record<string, unknown>);
            } catch (e) {
              reject(new SidecarError(`Failed to parse sidecar startup JSON: ${e}`));
            }
            return;
          }
        }
      }
    });

    command.on("error", (err: unknown) => {
      clearTimeout(timer);
      reject(new SidecarError(`Sidecar process error: ${String(err)}`));
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
