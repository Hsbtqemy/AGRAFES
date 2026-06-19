/**
 * sidecarClient core — shared sidecar connection/transport/lifecycle (U-01).
 *
 * Extracted from the per-app sidecar clients (canonical = tauri-prep) so that
 * tauri-app (Explorer) and tauri-prep (Constituer) share ONE connection cache,
 * transport and lifecycle. App- and prep-specific HTTP *endpoints* stay in their
 * respective clients, which import this module. Connection behaviour is pinned by
 * sidecarCore.connection.test.ts.
 */
import { Command, type Child } from "@tauri-apps/plugin-shell";
import { exists } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { resolveResource } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

export const SIDECAR_SPAWN_OPTIONS = {
  env: { PYTHONUNBUFFERED: "1" },
};

export function utf8DecodeStream(chunk: Uint8Array, decoder: TextDecoder): string {
  return decoder.decode(chunk, { stream: true });
}

export interface Conn {
  baseUrl: string;
  token: string | null;
  post(path: string, body: unknown): Promise<unknown>;
  get(path: string): Promise<unknown>;
  put(path: string, body: unknown): Promise<unknown>;
}

let _conn: Conn | null = null;

let _connDbPath: string | null = null;

let _spawnedChild: Child | null = null;

export const SIDECAR_PROGRAM = "multicorpus";

export const SPAWN_TOKEN_PORTFILE_RETRY_COUNT = 8;

export const SPAWN_TOKEN_PORTFILE_RETRY_DELAY_MS = 150;

export const IS_WINDOWS_RUNTIME =
  typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);

export const SIDECAR_HEALTH_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 45000 : 15000;

export const SIDECAR_HEALTH_INITIAL_DELAY_MS = IS_WINDOWS_RUNTIME ? 1200 : 0;

export const SIDECAR_HEALTH_POLL_INTERVAL_MS = 350;

export const SIDECAR_STARTUP_JSON_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 90000 : 12000;

export type LoopbackHttpBackendMode = "auto" | "global_this_only" | "tauri_only";

export const SIDECAR_LOOPBACK_HTTP_BACKEND_MODE: LoopbackHttpBackendMode = "tauri_only";

export const SIDECAR_GLOBAL_FETCH_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 1200 : 1500;

export type SidecarFetchInit = Parameters<typeof tauriFetch>[1] & RequestInit;

export type SidecarLogLevel = "info" | "warn" | "error";

export function sidecarLog(level: SidecarLogLevel, message: string, detail?: unknown): void {
  const prefix = `[sidecar ${new Date().toISOString()}] ${message}`;
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

export function headersToRecord(
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

export function errToString(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
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

export async function sidecarFetch(url: string, init?: SidecarFetchInit): Promise<Response> {
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

export async function resolveExpectedSidecarPathForLogs(): Promise<string | null> {
  try {
    return await resolveResource(expectedSidecarResourceName());
  } catch {
    return null;
  }
}

export function parseStartupPort(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

export function parseToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function _persistSidecarPort(port: number): void {
  try {
    localStorage.setItem("agrafes.sidecar.port", String(port));
  } catch {
    /* localStorage unavailable in some contexts */
  }
}

export function portfilePath(dbPath: string): string {
  const sep = dbPath.includes("/") ? "/" : "\\";
  const dir = dbPath.includes(sep)
    ? dbPath.substring(0, dbPath.lastIndexOf(sep))
    : ".";
  return `${dir}${sep}.agrafes_sidecar.json`;
}

export async function readPortfile(portfile: string): Promise<Record<string, unknown> | null> {
  try {
    // Use the raw Rust command to bypass Tauri FS scope restrictions.
    // Portfiles live next to the user's DB file which can be anywhere on disk.
    const raw = await invoke<string>("read_sidecar_portfile", { path: portfile });
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface PollHealthOptions {
  maxMs?: number;
  initialDelayMs?: number;
  intervalMs?: number;
  perAttemptTimeoutMs?: number;
}

export async function pollHealth(baseUrl: string, options: PollHealthOptions = {}): Promise<boolean> {
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

export async function _rawPost(url: string, token: string | null, path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (token) headers["X-Agrafes-Token"] = token;
  const res = await sidecarFetch(`${url}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    const rawMsg =
      (json.error_message as string) ||
      (json.error as string) ||
      `HTTP ${res.status}`;
    const msg = rawMsg.length > 300 ? rawMsg.slice(0, 300) + "…" : rawMsg;
    throw new SidecarError(msg, res.status);
  }
  return json;
}

export async function _rawPut(url: string, token: string | null, path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (token) headers["X-Agrafes-Token"] = token;
  const res = await sidecarFetch(`${url}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    const rawMsg =
      (json.error_message as string) ||
      (json.error as string) ||
      `HTTP ${res.status}`;
    const msg = rawMsg.length > 300 ? rawMsg.slice(0, 300) + "…" : rawMsg;
    throw new SidecarError(msg, res.status);
  }
  return json;
}

export async function _rawGet(url: string, token: string | null, path: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (token) headers["X-Agrafes-Token"] = token;
  const res = await sidecarFetch(`${url}${path}`, { headers });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error_message as string) || `HTTP ${res.status}`;
    throw new SidecarError(msg, res.status);
  }
  return json;
}

export function makeConn(baseUrl: string, token: string | null): Conn {
  return {
    baseUrl,
    token,
    async post(path: string, body: unknown): Promise<unknown> {
      try {
        return await _rawPost(baseUrl, token, path, body);
      } catch (err) {
        // Network error (not HTTP): connection refused → sidecar restarted.
        // Reconnect once transparently.
        if (!(err instanceof SidecarError) && _connDbPath && _conn?.baseUrl === baseUrl) {
          sidecarLog("warn", `post ${path}: network error; reconnecting once`, errToString(err));
          _conn = null;
          try {
            const fresh = await ensureRunning(_connDbPath);
            return await _rawPost(fresh.baseUrl, fresh.token, path, body);
          } catch (reconnErr) {
            sidecarLog("error", `post ${path}: reconnect failed`, errToString(reconnErr));
          }
        }
        throw err;
      }
    },
    async get(path: string): Promise<unknown> {
      try {
        return await _rawGet(baseUrl, token, path);
      } catch (err) {
        if (!(err instanceof SidecarError) && _connDbPath && _conn?.baseUrl === baseUrl) {
          sidecarLog("warn", `get ${path}: network error; reconnecting once`, errToString(err));
          _conn = null;
          try {
            const fresh = await ensureRunning(_connDbPath);
            return await _rawGet(fresh.baseUrl, fresh.token, path);
          } catch (reconnErr) {
            sidecarLog("error", `get ${path}: reconnect failed`, errToString(reconnErr));
          }
        }
        throw err;
      }
    },
    async put(path: string, body: unknown): Promise<unknown> {
      try {
        return await _rawPut(baseUrl, token, path, body);
      } catch (err) {
        if (!(err instanceof SidecarError) && _connDbPath && _conn?.baseUrl === baseUrl) {
          sidecarLog("warn", `put ${path}: network error; reconnecting once`, errToString(err));
          _conn = null;
          try {
            const fresh = await ensureRunning(_connDbPath);
            return await _rawPut(fresh.baseUrl, fresh.token, path, body);
          } catch (reconnErr) {
            sidecarLog("error", `put ${path}: reconnect failed`, errToString(reconnErr));
          }
        }
        throw err;
      }
    },
  };
}

export class SidecarError extends Error {
  constructor(message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "SidecarError";
  }
}

export async function ensureRunning(dbPath: string): Promise<Conn> {
  sidecarLog("info", `ensureRunning called (db=${dbPath})`);

  // 1. Reuse live in-memory connection — only if it serves the same DB
  if (_conn && _connDbPath === dbPath) {
    try {
      await _conn.get("/health");
      // If token was null at spawn time (portfile not yet ready), try to recover it now
      if (_conn.token === null) {
        const pfData = await readPortfile(portfilePath(dbPath));
        const freshToken = pfData ? parseToken(pfData.token) : null;
        if (freshToken !== null) {
          sidecarLog("info", "recovered missing token from portfile; refreshing connection");
          _conn = makeConn(_conn.baseUrl, freshToken);
          _connDbPath = dbPath;
        }
      }
      sidecarLog("info", "reusing in-memory sidecar connection");
      const reusedPort = _conn.baseUrl.match(/:(\d+)$/);
      if (reusedPort) _persistSidecarPort(Number(reusedPort[1]));
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
    // started for corpus.db would otherwise be reused for agrafes_demo.db, returning
    // the wrong documents.
    const pfDbPath = typeof pfData.db_path === "string" ? pfData.db_path : null;
    if (pfDbPath !== null && pfDbPath !== dbPath) {
      sidecarLog("info", `portfile serves a different DB (${pfDbPath}); shutting it down before spawning for ${dbPath}`);
      // Best-effort graceful shutdown of the stale sidecar so it doesn't leak.
      const staleHost = (pfData.host as string) ?? "127.0.0.1";
      const stalePort = pfData.port as number;
      const staleToken = parseToken(pfData.token);
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
      const token = parseToken(pfData.token);
      if (typeof port === "number" && port > 0) {
        const baseUrl = makeBaseUrl(host, port);
        try {
          const res = await sidecarFetch(`${baseUrl}/health`);
          const json = (await res.json()) as Record<string, unknown>;
          if (res.ok && json.ok === true) {
            if (token === null && json.token_required === true) {
              sidecarLog("warn", "portfile has no token but sidecar requires one; falling through to spawn", {
                baseUrl,
              });
              // Fall through to spawn so we get a fresh token from stdout
            } else {
              sidecarLog("info", `reusing sidecar from portfile (${baseUrl})`, {
                tokenPresent: token !== null,
                tokenLength: token?.length ?? 0,
              });
              _conn = makeConn(baseUrl, token);
              _connDbPath = dbPath;
              _persistSidecarPort(port);
              _notifyRustRegistry(_conn);
              return _conn;
            }
          }
          sidecarLog("warn", `portfile sidecar not healthy (${baseUrl})`, json);
        } catch (err) {
          sidecarLog("warn", `portfile sidecar health check failed (${baseUrl})`, errToString(err));
          // stale portfile — fall through to spawn
        }
      }
    }
  }

  // 3. Spawn new sidecar
  sidecarLog("info", "spawning new sidecar process");
  return _spawnSidecar(dbPath);
}

export async function _spawnSidecar(dbPath: string): Promise<Conn> {
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

  const startupToken = parseToken(started.token);
  // Prefer the portfile path reported by the sidecar (authoritative) over our computed one
  const pf = (typeof started.portfile === "string" && started.portfile.length > 0)
    ? started.portfile
    : portfilePath(dbPath);
  let pfData = await readPortfile(pf);
  let portfileToken = pfData ? parseToken(pfData.token) : null;
  if (startupToken === null && portfileToken === null) {
    for (let i = 0; i < SPAWN_TOKEN_PORTFILE_RETRY_COUNT; i += 1) {
      await sleep(SPAWN_TOKEN_PORTFILE_RETRY_DELAY_MS);
      pfData = await readPortfile(pf);
      portfileToken = pfData ? parseToken(pfData.token) : null;
      if (portfileToken !== null) break;
    }
  }
  const token = startupToken ?? portfileToken ?? null;

  const tokenSource =
    startupToken !== null ? "startup_payload" :
    portfileToken !== null ? "portfile" :
    "missing";
  if (tokenSource === "missing") {
    sidecarLog("warn", "token missing after startup + portfile retries", {
      baseUrl,
      retryCount: SPAWN_TOKEN_PORTFILE_RETRY_COUNT,
      retryDelayMs: SPAWN_TOKEN_PORTFILE_RETRY_DELAY_MS,
    });
  }
  sidecarLog("info", `sidecar healthy at ${baseUrl} (token=${token ? "present" : "absent"})`, {
    tokenSource,
    tokenLength: token?.length ?? 0,
  });

  _conn = makeConn(baseUrl, token);
  _connDbPath = dbPath;
  _persistSidecarPort(port);
  _notifyRustRegistry(_conn);
  return _conn;
}

export function _readFirstJsonFromCommand(command: {
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

export async function shutdownSidecar(conn: Conn): Promise<void> {
  try { await conn.post("/shutdown", {}); } catch { /* best-effort */ }
  _conn = null;
  _connDbPath = null;
  _spawnedChild = null;
  _notifyRustRegistry(null);
}

export function getActiveConn(): Conn | null {
  return _conn;
}

export function _notifyRustRegistry(conn: Conn | null): void {
  try {
    if (conn) {
      void invoke("register_sidecar", { baseUrl: conn.baseUrl, token: conn.token ?? null });
    } else {
      void invoke("register_sidecar", { baseUrl: "", token: null });
    }
  } catch { /* best-effort */ }
}

export function resetConnection(): void {
  _conn = null;
  _connDbPath = null;
}

// ─── Misc core utils (moved with the connection core) ─────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function expectedSidecarResourceName(): string {
  if (IS_WINDOWS_RUNTIME) {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isArm64 = /\b(arm64|aarch64)\b/i.test(ua);
    const triple = isArm64 ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    return `${SIDECAR_PROGRAM}-${triple}.exe`;
  }
  return SIDECAR_PROGRAM;
}
