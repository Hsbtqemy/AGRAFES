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
import { invoke } from "@tauri-apps/api/core";

/** Force le flush immédiat du pipe stdout sous Windows (évite les blocages). */
const SIDECAR_SPAWN_OPTIONS = {
  env: { PYTHONUNBUFFERED: "1" },
};

function utf8DecodeStream(chunk: Uint8Array, decoder: TextDecoder): string {
  return decoder.decode(chunk, { stream: true });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueryHit {
  doc_id: number;
  unit_id: number;
  external_id: number | null;
  language: string;
  title: string;
  source_db_path?: string;
  source_db_name?: string;
  source_db_index?: number;
  // segment mode
  text?: string;
  text_norm?: string;
  // kwic mode
  left?: string;
  match?: string;
  right?: string;
  // aligned view
  aligned?: AlignedUnit[];
  // token-query mode (CQL)
  sent_id?: number;
  start_position?: number;
  end_position?: number;
  tokens?: TokenRecord[];
  context_tokens?: TokenRecord[];
}

export interface TokenRecord {
  token_id: number;
  position: number;
  word?: string | null;
  lemma?: string | null;
  upos?: string | null;
  xpos?: string | null;
  feats?: string | null;
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
  /** One language code or a list of codes. Empty array or undefined = no filter. */
  language?: string | string[];
  doc_id?: number;
  /** Multi-doc filter — takes priority over doc_id when provided. */
  doc_ids?: number[];
  /** Optional federated DB query scope (multiple database paths in one /query request). */
  dbPaths?: string[];
  doc_role?: string;
  resource_type?: string;
  includeAligned?: boolean;
  alignedLimit?: number;
  include_aligned?: boolean;
  all_occurrences?: boolean;
  case_sensitive?: boolean;
  limit?: number;
  offset?: number;
  /** Restrict the query to a document family (parent + all children). Forces include_aligned. */
  familyId?: number;
  /** When familyId is set, search only in the pivot (parent) document. */
  pivotOnly?: boolean;
  /** When set, bypass FTS and use a full-scan Python regex instead. */
  regex_pattern?: string;
  /** Filter by author (LIKE search on author_lastname or author_firstname). */
  author?: string;
  /** Filter documents whose title contains this substring (LIKE). */
  title_search?: string;
  /** Filter documents with doc_date >= this value (string comparison). */
  doc_date_from?: string;
  /** Filter documents with doc_date <= this value (string comparison). */
  doc_date_to?: string;
  /** Filter by source file extension, e.g. ".docx", ".txt", ".tei". */
  source_ext?: string;
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
  family_id?: number | null;
  family_doc_ids?: number[] | null;
  pivot_only?: boolean | null;
  federated?: boolean | null;
  db_paths?: string[] | null;
  db_count?: number | null;
}

export interface TokenQueryOptions {
  cql: string;
  mode?: "segment" | "kwic";
  window?: number;
  /** One language code or a list of codes. Empty array or undefined = no filter. */
  language?: string | string[];
  /** Multi-doc filter. */
  doc_ids?: number[];
  limit?: number;
  offset?: number;
}

export interface TokenQueryResponse {
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
  mode:
    | "docx_numbered_lines"
    | "txt_numbered_lines"
    | "docx_paragraphs"
    | "odt_paragraphs"
    | "odt_numbered_lines"
    | "tei";
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
  source_path?: string | null;
  source_hash?: string | null;
  unit_count: number;
}

export interface QueryFacetsOptions {
  q: string;
  language?: string | string[];
  doc_id?: number;
  /** Multi-doc filter — takes priority over doc_id when provided. */
  doc_ids?: number[];
  doc_role?: string;
  resource_type?: string;
  author?: string;
  title_search?: string;
  doc_date_from?: string;
  doc_date_to?: string;
  source_ext?: string;
  /** How many top documents to return (max 50, default 10). */
  top_docs_limit?: number;
}

/** One entry in the top_docs list returned by /query/facets. */
export interface FacetDocEntry {
  doc_id: number;
  title: string;
  language: string;
  count: number;
}

/**
 * Response from POST /query/facets.
 * All counts are exact (computed server-side over the full FTS index),
 * not estimates based on loaded hits.
 */
export interface QueryFacetsResponse {
  total_hits: number;
  distinct_docs: number;
  distinct_langs: number;
  top_docs: FacetDocEntry[];
}

/** One unit in a GET /unit/context reading window. */
export interface UnitContextItem {
  unit_id: number;
  text: string;
  /** True for the unit that was requested; false for context neighbours. */
  is_current: boolean;
}

/**
 * Response from GET /unit/context?unit_id=N&window=N (Sprint J).
 *
 * ``items`` is the full ordered reading window: ``window_before`` units before
 * the current unit, the current unit itself (``is_current=true``), and
 * ``window_after`` units after it.  ``window_before`` / ``window_after`` may be
 * less than the requested ``window`` at document boundaries.
 */
export interface UnitContextResponse {
  doc_id: number;
  unit_id: number;
  /** 1-based ordinal among line units in this document. */
  unit_index: number;
  total_units: number;
  window_before: number;
  window_after: number;
  items: UnitContextItem[];
}

// ─── Connection handle ────────────────────────────────────────────────────────

export interface Conn {
  baseUrl: string;
  token: string | null;
  /** POST a write operation (injects token header if present). */
  post(path: string, body: unknown): Promise<unknown>;
  /** PUT a write operation (injects token header if present). */
  put(path: string, body: unknown): Promise<unknown>;
  /** POST a read-only operation (no token required). */
  get(path: string): Promise<unknown>;
}

// ─── Internal state ───────────────────────────────────────────────────────────

let _conn: Conn | null = null;
let _connDbPath: string | null = null;
let _spawnedChild: Child | null = null;
const SIDECAR_PROGRAM = "multicorpus";
const IS_WINDOWS_RUNTIME =
  typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
const SIDECAR_HEALTH_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 45000 : 15000;
const SIDECAR_HEALTH_INITIAL_DELAY_MS = IS_WINDOWS_RUNTIME ? 1200 : 0;
const SIDECAR_HEALTH_POLL_INTERVAL_MS = 350;
/** Cold start PyInstaller + migrations SQLite peuvent dépasser 20s sous Windows. */
const SIDECAR_STARTUP_JSON_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 90000 : 12000;
type LoopbackHttpBackendMode = "auto" | "global_this_only" | "tauri_only";
// "tauri_only": bypasses globalThis.fetch for loopback (avoids WebView2 mixed-content
// hang when fetching http:// from https://tauri.localhost). reqwest/WinHTTP natively
// bypasses system proxy for loopback — no proxy issue on machines with or without proxy.
const SIDECAR_LOOPBACK_HTTP_BACKEND_MODE: LoopbackHttpBackendMode = "tauri_only";
const SIDECAR_GLOBAL_FETCH_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 1200 : 1500;

type SidecarLogLevel = "info" | "warn" | "error";
type SidecarFetchInit = Parameters<typeof tauriFetch>[1] & RequestInit;

function sidecarLog(level: SidecarLogLevel, message: string, detail?: unknown): void {
  const prefix = `[sidecar-client ${new Date().toISOString()}] ${message}`;
  const detailStr =
    detail !== undefined
      ? ` | ${(() => { try { return JSON.stringify(detail); } catch { return String(detail); } })()}`
      : "";
  if (level === "error") {
    if (detail !== undefined) console.error(prefix, detail);
    else console.error(prefix);
  } else if (level === "warn") {
    if (detail !== undefined) console.warn(prefix, detail);
    else console.warn(prefix);
  } else {
    if (detail !== undefined) console.info(prefix, detail);
    else console.info(prefix);
  }
  // Best-effort file logging for diagnosis (AppData\com.agrafes.shell\sidecar-debug.log)
  invoke("write_sidecar_log", {
    message: `${level.toUpperCase()} ${prefix}${detailStr}`,
  }).catch(() => {});
}

function headersToRecord(
  headers: HeadersInit | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    const rec: Record<string, string> = {};
    headers.forEach((v, k) => {
      rec[k] = v;
    });
    return rec;
  }
  if (Array.isArray(headers)) {
    const rec: Record<string, string> = {};
    for (const [k, v] of headers as [string, string][]) {
      rec[k] = v;
    }
    return rec;
  }
  return headers as Record<string, string>;
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
  const method = (init?.method ?? "GET").toUpperCase();
  const loopback = isLoopbackUrl(url);
  const mode = loopback ? SIDECAR_LOOPBACK_HTTP_BACKEND_MODE : "tauri_only";

  if (mode !== "tauri_only") {
    if (typeof globalThis.fetch === "function") {
      sidecarLog("info", "sidecarFetch loopback attempt via globalThis.fetch", {
        method,
        url,
        mode,
        timeoutMs: SIDECAR_GLOBAL_FETCH_TIMEOUT_MS,
      });
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let abortController: AbortController | null = null;
      let didTimeout = false;
      try {
        if (typeof AbortController !== "undefined") {
          abortController = new AbortController();
          timeoutHandle = setTimeout(() => {
            didTimeout = true;
            abortController?.abort();
          }, SIDECAR_GLOBAL_FETCH_TIMEOUT_MS);
        }
        const response = await globalThis.fetch(url, {
          ...init,
          signal: abortController?.signal ?? init?.signal,
        });
        sidecarLog("info", "sidecarFetch loopback globalThis.fetch success", {
          method,
          url,
          mode,
          status: response.status,
          ok: response.ok,
        });
        return response;
      } catch (err) {
        sidecarLog("warn", "sidecarFetch loopback globalThis.fetch failed", {
          method,
          url,
          mode,
          timedOut: didTimeout,
          error: errToString(err),
        });
        if (mode === "global_this_only") throw err;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    } else {
      sidecarLog("warn", "sidecarFetch loopback globalThis.fetch unavailable", { method, url, mode });
      if (mode === "global_this_only") {
        throw new Error("globalThis.fetch unavailable in global_this_only mode");
      }
    }

    sidecarLog("info", "sidecarFetch loopback fallback attempt via tauriFetch", { method, url, mode });
    try {
      const response = await tauriFetch(url, init);
      sidecarLog("info", "sidecarFetch loopback tauriFetch success", {
        method,
        url,
        mode,
        status: response.status,
        ok: response.ok,
      });
      return response;
    } catch (err) {
      sidecarLog("error", "sidecarFetch loopback tauriFetch failed", {
        method,
        url,
        mode,
        error: errToString(err),
      });
      throw err;
    }
  }

  // Loopback: use the Rust sidecar_fetch_loopback command (bypasses plugin-http scope entirely)
  if (loopback) {
    sidecarLog("info", "sidecarFetch loopback via sidecar_fetch_loopback command", {
      method,
      url,
    });
    try {
      const result = await invoke<{ status: number; ok: boolean; body: string }>(
        "sidecar_fetch_loopback",
        {
          url,
          method,
          body: typeof init?.body === "string" ? init.body : undefined,
          headers: headersToRecord(init?.headers),
        }
      );
      sidecarLog("info", "sidecarFetch loopback command success", {
        method,
        url,
        status: result.status,
        ok: result.ok,
      });
      return new Response(result.body, { status: result.status });
    } catch (err) {
      sidecarLog("error", "sidecarFetch loopback command failed", {
        method,
        url,
        error: errToString(err),
      });
      throw err;
    }
  }

  // Non-loopback: use tauriFetch via Tauri HTTP plugin
  sidecarLog("info", "sidecarFetch non-loopback via tauriFetch", { method, url, mode });
  try {
    const response = await tauriFetch(url, init);
    sidecarLog("info", "sidecarFetch non-loopback tauriFetch success", {
      method,
      url,
      mode,
      status: response.status,
      ok: response.ok,
    });
    return response;
  } catch (err) {
    sidecarLog("error", "sidecarFetch non-loopback tauriFetch failed", {
      method,
      url,
      mode,
      error: errToString(err),
    });
    throw err;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function portfilePath(dbPath: string): string {
  // Place portfile next to the DB file — use the same separator as the path
  const sep = dbPath.includes("\\") ? "\\" : "/";
  const dir = dbPath.includes(sep)
    ? dbPath.substring(0, dbPath.lastIndexOf(sep))
    : ".";
  return `${dir}${sep}.agrafes_sidecar.json`;
}

async function readPortfile(portfile: string): Promise<Record<string, unknown> | null> {
  try {
    // Use the raw Rust command to bypass Tauri FS scope restrictions.
    // Portfiles live next to the user's DB file which can be anywhere on disk.
    const raw = await invoke<string>("read_text_file_raw", { path: portfile });
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
  perAttemptTimeoutMs?: number;
}

async function pollHealth(baseUrl: string, options: PollHealthOptions = {}): Promise<boolean> {
  const maxMs = options.maxMs ?? SIDECAR_HEALTH_TIMEOUT_MS;
  const initialDelayMs = options.initialDelayMs ?? SIDECAR_HEALTH_INITIAL_DELAY_MS;
  const intervalMs = options.intervalMs ?? SIDECAR_HEALTH_POLL_INTERVAL_MS;
  const perAttemptTimeoutMs = options.perAttemptTimeoutMs ?? 3500;
  const healthUrl = `${baseUrl}/health`;
  const pollStartedAt = Date.now();

  sidecarLog("info", "health polling started", {
    baseUrl,
    healthUrl,
    loopbackBackendMode: SIDECAR_LOOPBACK_HTTP_BACKEND_MODE,
    globalFetchTimeoutMs: SIDECAR_GLOBAL_FETCH_TIMEOUT_MS,
    timeoutMs: maxMs,
    initialDelayMs,
    intervalMs,
    perAttemptTimeoutMs,
    startedAt: new Date(pollStartedAt).toISOString(),
  });

  if (initialDelayMs > 0) {
    sidecarLog(
      "info",
      `health polling initial delay ${initialDelayMs}ms before first ping (${healthUrl})`
    );
    await sleep(initialDelayMs);
  }

  const deadline = Date.now() + maxMs;
  let attempts = 0;
  let lastError = "";

  while (Date.now() < deadline) {
    attempts += 1;
    const attemptStarted = Date.now();
    sidecarLog("info", "health polling attempt started", {
      baseUrl,
      healthUrl,
      attempt: attempts,
      attemptStartedAt: new Date(attemptStarted).toISOString(),
      elapsedSincePollStartMs: attemptStarted - pollStartedAt,
    });
    try {
      const fetchPromise = sidecarFetch(healthUrl);
      const timeoutPromise = sleep(perAttemptTimeoutMs).then(() => {
        throw new Error(`sidecarFetch per-attempt timeout (${perAttemptTimeoutMs}ms)`);
      });
      const res = await Promise.race([fetchPromise, timeoutPromise]);
      const elapsedMs = Date.now() - attemptStarted;
      const totalElapsedMs = Date.now() - pollStartedAt;

      let json: Record<string, unknown> | null = null;
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch (jsonErr) {
        lastError = `attempt ${attempts}: invalid JSON (${errToString(jsonErr)})`;
        sidecarLog("warn", "health polling attempt invalid JSON", {
          baseUrl,
          healthUrl,
          attempt: attempts,
          elapsedMs,
          totalElapsedMs,
          error: errToString(jsonErr),
        });
      }

      if (res.ok) {
        if (json && (json.ok === true || json.status === "ok")) {
          sidecarLog("info", "health polling attempt OK", {
            baseUrl,
            healthUrl,
            attempt: attempts,
            status: res.status,
            elapsedMs,
            totalElapsedMs,
            payload: json,
          });
          return true;
        }
        lastError = `attempt ${attempts}: HTTP ${res.status} but payload is not healthy`;
        sidecarLog("warn", "health polling attempt payload not healthy", {
          baseUrl,
          healthUrl,
          attempt: attempts,
          status: res.status,
          elapsedMs,
          totalElapsedMs,
          payload: json,
        });
      } else {
        lastError = `attempt ${attempts}: HTTP ${res.status}`;
        sidecarLog("warn", "health polling attempt HTTP error", {
          baseUrl,
          healthUrl,
          attempt: attempts,
          status: res.status,
          elapsedMs,
          totalElapsedMs,
          payload: json,
        });
      }
    } catch (err) {
      const elapsedMs = Date.now() - attemptStarted;
      const totalElapsedMs = Date.now() - pollStartedAt;
      lastError = `attempt ${attempts}: ${errToString(err)}`;
      sidecarLog("warn", "health polling attempt failed", {
        baseUrl,
        healthUrl,
        attempt: attempts,
        elapsedMs,
        totalElapsedMs,
        error: errToString(err),
      });
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  sidecarLog(
    "error",
    `health timeout after ${maxMs}ms (${attempts} attempts) for ${healthUrl}; last error: ${lastError || "(none)"}`
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
    async put(path: string, body: unknown): Promise<unknown> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
      };
      if (token) headers["X-Agrafes-Token"] = token;
      const res = await sidecarFetch(`${baseUrl}${path}`, {
        method: "PUT",
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

  // 1. In-memory: reuse only if it serves the same DB
  if (_conn && _connDbPath === dbPath) {
    try {
      await _conn.get("/health");
      // If token was null at spawn time (portfile not yet ready), try to recover it now
      if (_conn.token === null) {
        const pfData = await readPortfile(portfilePath(dbPath));
        const freshToken = pfData ? (pfData.token as string | null) ?? null : null;
        if (freshToken) {
          sidecarLog("info", "recovered missing token from portfile; refreshing connection");
          _conn = makeConn(_conn.baseUrl, freshToken);
          _connDbPath = dbPath;
        }
      }
      sidecarLog("info", "reusing in-memory sidecar connection");
      return _conn;
    } catch (err) {
      sidecarLog("warn", "in-memory sidecar connection is stale; reconnecting", errToString(err));
      _conn = null;
      _connDbPath = null;
    }
  } else if (_conn && _connDbPath !== dbPath) {
    sidecarLog("info", `DB path changed (${_connDbPath} → ${dbPath}); dropping old connection`);
    _conn = null;
    _connDbPath = null;
  }

  // 2. Portfile discovery
  const pf = portfilePath(dbPath);
  sidecarLog("info", `checking sidecar portfile at ${pf}`);
  const pfData = await readPortfile(pf);
  if (pfData) {
    // Verify the running sidecar serves the requested DB.
    // The portfile is shared by all DB files in the same directory, so a sidecar
    // started for corpus.db would otherwise be reused for agrafes_demo.db.
    const pfDbPath = typeof pfData.db_path === "string" ? pfData.db_path : null;
    if (pfDbPath !== null && pfDbPath !== dbPath) {
      sidecarLog("info", `portfile serves a different DB (${pfDbPath}); shutting it down before spawning for ${dbPath}`);
      // Best-effort graceful shutdown of the stale sidecar so it doesn't leak.
      const staleHost = (pfData.host as string) ?? "127.0.0.1";
      const stalePort = pfData.port as number;
      const staleToken = (pfData.token as string | null) ?? null;
      if (typeof stalePort === "number" && stalePort > 0) {
        const staleUrl = makeBaseUrl(staleHost, stalePort);
        try {
          const staleConn = makeConn(staleUrl, staleToken);
          await staleConn.post("/shutdown", {});
          sidecarLog("info", `gracefully stopped stale sidecar for ${pfDbPath}`);
        } catch {
          // Non-fatal — the new sidecar will overwrite the portfile
        }
      }
      // Fall through to spawn
    } else {
      const host = (pfData.host as string) ?? "127.0.0.1";
      const port = pfData.port as number;
      const token = (pfData.token as string | null) ?? null;
      if (typeof port === "number" && port > 0) {
        const baseUrl = makeBaseUrl(host, port);
        try {
          const res = await sidecarFetch(`${baseUrl}/health`);
          const json = (await res.json()) as Record<string, unknown>;
          if (res.ok && json.ok === true) {
            if (!token && json.token_required === true) {
              sidecarLog("warn", "portfile has no token but sidecar requires one; falling through to spawn", {
                baseUrl,
              });
              // Fall through to spawn so we get a fresh token from stdout
            } else {
              sidecarLog("info", `reusing sidecar from portfile (${baseUrl})`);
              _conn = makeConn(baseUrl, token);
              _connDbPath = dbPath;
              return _conn;
            }
          }
          sidecarLog("warn", `portfile sidecar not healthy (${baseUrl})`, json);
        } catch (err) {
          sidecarLog("warn", `portfile sidecar health check failed (${baseUrl})`, errToString(err));
          // portfile stale — fall through to spawn
        }
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

  const command = Command.sidecar(SIDECAR_PROGRAM, sidecarArgs, SIDECAR_SPAWN_OPTIONS);
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

  const stderrDec = new TextDecoder("utf-8", { fatal: false });
  command.stderr.on("data", (chunk: string | Uint8Array) => {
    const stderrLine = (
      typeof chunk === "string" ? chunk : utf8DecodeStream(chunk, stderrDec)
    ).trim();
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

  // Read token from portfile — prefer the path reported by the sidecar (authoritative)
  const pf = (typeof started.portfile === "string" && started.portfile.length > 0)
    ? started.portfile
    : portfilePath(dbPath);
  const pfData = await readPortfile(pf);
  const token = pfData ? ((pfData.token as string | null) ?? null) : null;
  sidecarLog("info", `sidecar healthy at ${baseUrl} (token=${token ? "present" : "absent"})`);

  _conn = makeConn(baseUrl, token);
  _connDbPath = dbPath;
  return _conn;
}

/** Read first JSON line from command stdout. Call before spawn(); resolve after spawn(). */
function _readFirstJsonFromCommand(command: {
  stdout: { on(event: "data", cb: (chunk: string | Uint8Array) => void): void };
  on(event: "error", cb: (err: unknown) => void): void;
  on(event: "close", cb: (payload: { code: number | null; signal: number | null }) => void): void;
}, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const stdoutDec = new TextDecoder("utf-8", { fatal: false });
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

    command.stdout.on("data", (chunk: string | Uint8Array) => {
      const textChunk = typeof chunk === "string"
        ? chunk
        : utf8DecodeStream(chunk, stdoutDec);
      rawBuffer += textChunk;
      for (const ch of textChunk) {
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
      const closeInfo = {
        code: payload.code,
        signal: payload.signal,
        seenCandidates,
        lastCandidate,
        closedAt: new Date().toISOString(),
      };
      sidecarLog("warn", "sidecar command close event while waiting for startup payload", closeInfo);
      if (!resolved) {
        clearTimeout(timer);
        const msg = `Sidecar exited (code=${payload.code ?? "null"}) before outputting startup JSON`;
        sidecarLog("error", msg, closeInfo);
        reject(new SidecarError(msg));
      }
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
  if (opts.language) {
    const langs = Array.isArray(opts.language) ? opts.language.filter(Boolean) : [opts.language];
    if (langs.length > 0) payload.language = langs.length === 1 ? langs[0] : langs;
  }
  if (opts.doc_ids !== undefined && opts.doc_ids.length > 0) {
    payload.doc_ids = opts.doc_ids;
  } else if (opts.doc_id !== undefined) {
    payload.doc_id = opts.doc_id;
  }
  if (opts.dbPaths !== undefined && opts.dbPaths.length > 0) {
    payload.db_paths = opts.dbPaths;
  }
  if (opts.doc_role) payload.doc_role = opts.doc_role;
  if (opts.resource_type) payload.resource_type = opts.resource_type;
  if (includeAligned) payload.include_aligned = true;
  if (includeAligned && opts.alignedLimit !== undefined) {
    payload.aligned_limit = opts.alignedLimit;
  }
  if (opts.all_occurrences) payload.all_occurrences = opts.all_occurrences;
  if (opts.case_sensitive) payload.case_sensitive = true;
  if (opts.limit !== undefined) payload.limit = opts.limit;
  if (opts.offset !== undefined) payload.offset = opts.offset;
  if (opts.familyId !== undefined) {
    payload.family_id = opts.familyId;
    payload.include_aligned = true;
    if (opts.pivotOnly) payload.pivot_only = true;
  }
  if (opts.regex_pattern) payload.regex_pattern = opts.regex_pattern;
  if (opts.author) payload.author = opts.author;
  if (opts.title_search) payload.title_search = opts.title_search;
  if (opts.doc_date_from) payload.doc_date_from = opts.doc_date_from;
  if (opts.doc_date_to) payload.doc_date_to = opts.doc_date_to;
  if (opts.source_ext) payload.source_ext = opts.source_ext;

  return conn.post("/query", payload) as Promise<QueryResponse>;
}

export async function tokenQuery(
  conn: Conn,
  opts: TokenQueryOptions
): Promise<TokenQueryResponse> {
  const payload: Record<string, unknown> = {
    cql: opts.cql,
    mode: opts.mode ?? "kwic",
  };
  if (opts.window !== undefined) payload.window = opts.window;
  if (opts.language) {
    const langs = Array.isArray(opts.language) ? opts.language.filter(Boolean) : [opts.language];
    if (langs.length > 0) payload.language = langs.length === 1 ? langs[0] : langs;
  }
  if (opts.doc_ids !== undefined && opts.doc_ids.length > 0) payload.doc_ids = opts.doc_ids;
  if (opts.limit !== undefined) payload.limit = opts.limit;
  if (opts.offset !== undefined) payload.offset = opts.offset;
  return conn.post("/token_query", payload) as Promise<TokenQueryResponse>;
}

/**
 * POST /query/facets — compute lightweight facet summary for a query.
 *
 * Returns exact counts (total_hits, distinct_docs, distinct_langs, top_docs)
 * computed server-side in a single GROUP BY pass over the FTS index.
 * Much cheaper than fetching all pages of results.
 *
 * Note: total_hits counts matching *units*, not KWIC occurrences.
 */
export async function queryFacets(
  conn: Conn,
  opts: QueryFacetsOptions
): Promise<QueryFacetsResponse> {
  const payload: Record<string, unknown> = { q: opts.q };
  if (opts.language) {
    const langs = Array.isArray(opts.language) ? opts.language.filter(Boolean) : [opts.language];
    if (langs.length > 0) payload.language = langs.length === 1 ? langs[0] : langs;
  }
  if (opts.doc_ids !== undefined && opts.doc_ids.length > 0) {
    payload.doc_ids = opts.doc_ids;
  } else if (opts.doc_id !== undefined) {
    payload.doc_id = opts.doc_id;
  }
  if (opts.doc_role) payload.doc_role = opts.doc_role;
  if (opts.resource_type) payload.resource_type = opts.resource_type;
  if (opts.author) payload.author = opts.author;
  if (opts.title_search) payload.title_search = opts.title_search;
  if (opts.doc_date_from) payload.doc_date_from = opts.doc_date_from;
  if (opts.doc_date_to) payload.doc_date_to = opts.doc_date_to;
  if (opts.source_ext) payload.source_ext = opts.source_ext;
  if (opts.top_docs_limit !== undefined) payload.top_docs_limit = opts.top_docs_limit;
  return conn.post("/query/facets", payload) as Promise<QueryFacetsResponse>;
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

// ─── Document families ────────────────────────────────────────────────────────

export interface FamilyChild {
  doc_id: number;
  relation_type: string;
  doc: {
    doc_id: number;
    title: string | null;
    language: string | null;
    doc_role: string | null;
    workflow_status: string | null;
  } | null;
  segmented: boolean;
  seg_count: number;
  aligned_to_parent: boolean;
}

export interface FamilyStats {
  total_docs: number;
  segmented_docs: number;
  parent_seg_count: number;
  aligned_pairs: number;
  total_pairs: number;
  completion_pct: number;
}

export interface FamilyRecord {
  family_id: number;
  parent: {
    doc_id: number;
    title: string | null;
    language: string | null;
    doc_role: string | null;
  } | null;
  children: FamilyChild[];
  stats: FamilyStats;
}

export async function listFamilies(conn: Conn): Promise<FamilyRecord[]> {
  const res = (await conn.get("/families")) as { families: FamilyRecord[]; count: number };
  return res.families;
}

/**
 * GET /unit/context?unit_id=N&window=W — reading window around a unit (Sprint J).
 *
 * ``window`` controls how many units to include on each side (default 3, max 10).
 * Response contains an ``items`` array with ``is_current`` tagged on the pivot unit.
 */
export async function getUnitContext(
  conn: Conn,
  unitId: number,
  window = 3
): Promise<UnitContextResponse> {
  const path = `/unit/context?unit_id=${encodeURIComponent(String(unitId))}&window=${window}`;
  return conn.get(path) as Promise<UnitContextResponse>;
}

export async function shutdownSidecar(conn: Conn): Promise<void> {
  try {
    await conn.post("/shutdown", {});
  } catch {
    // best-effort
  }
  _conn = null;
  _connDbPath = null;
  _spawnedChild = null;
}

/** Reset in-memory state (e.g. after switching DB). */
export function resetConnection(): void {
  _conn = null;
  _connDbPath = null;
}

// ─── Stats (lexical frequency) ────────────────────────────────────────────────

export interface StatsSlot {
  doc_ids?: number[] | null;
  language?: string | null;
  doc_role?: string | null;
  resource_type?: string | null;
  family_id?: number | null;
  top_n?: number;
  min_length?: number;
}

export interface StatsWord {
  word: string;
  count: number;
  freq_pct: number;
}

export interface StatsResult {
  label: string;
  total_tokens: number;
  vocabulary_size: number;
  total_units: number;
  total_docs: number;
  avg_tokens_per_unit: number;
  top_words: StatsWord[];
  rare_words: StatsWord[];
}

export interface StatsCompareWord {
  word: string;
  count_a: number;
  count_b: number;
  freq_a: number;
  freq_b: number;
  ratio: number | null;
}

export interface StatsCompareResult {
  label_a: string;
  label_b: string;
  summary_a: StatsResult;
  summary_b: StatsResult;
  comparison: StatsCompareWord[];
}

export async function fetchLexicalStats(
  conn: Conn,
  slot: StatsSlot,
  label = "",
): Promise<StatsResult> {
  return conn.post("/stats/lexical", { slot, label }) as Promise<StatsResult>;
}

export async function fetchStatsCompare(
  conn: Conn,
  slotA: StatsSlot,
  slotB: StatsSlot,
  labelA = "A",
  labelB = "B",
): Promise<StatsCompareResult> {
  return conn.post("/stats/compare", {
    a: slotA, b: slotB, label_a: labelA, label_b: labelB,
  }) as Promise<StatsCompareResult>;
}

// ─── Conventions (unit roles) ─────────────────────────────────────────────────

export interface UnitRole {
  name: string;
  label: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
}

export async function listConventions(conn: Conn): Promise<UnitRole[]> {
  const res = (await conn.get("/conventions")) as { roles: UnitRole[] };
  return res.roles;
}

export async function createConvention(
  conn: Conn,
  role: { name: string; label: string; color?: string | null; icon?: string | null; sort_order?: number }
): Promise<UnitRole> {
  const res = (await conn.post("/conventions", role)) as { role: UnitRole };
  return res.role;
}

export async function updateConvention(
  conn: Conn,
  name: string,
  fields: { label?: string; color?: string | null; icon?: string | null; sort_order?: number }
): Promise<UnitRole> {
  const res = (await conn.put(`/conventions/${encodeURIComponent(name)}`, fields)) as { role: UnitRole };
  return res.role;
}

export async function deleteConvention(conn: Conn, name: string): Promise<void> {
  await conn.post("/conventions/delete", { name });
}

export async function setUnitRole(
  conn: Conn,
  unitId: number,
  roleName: string | null
): Promise<void> {
  await conn.post("/units/set_role", { unit_id: unitId, role_name: roleName });
}

export async function bulkSetUnitRole(
  conn: Conn,
  unitIds: number[],
  roleName: string | null
): Promise<void> {
  await conn.post("/units/bulk_set_role", { unit_ids: unitIds, role_name: roleName });
}

export async function setDocumentTextStart(
  conn: Conn,
  docId: number,
  textStartN: number | null
): Promise<void> {
  await conn.post("/documents/set_text_start", { doc_id: docId, text_start_n: textStartN });
}
