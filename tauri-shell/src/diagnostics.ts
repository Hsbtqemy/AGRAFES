/**
 * diagnostics.ts — Local-only system diagnostic collection and formatting.
 *
 * All functions are local-only: no network calls, no telemetry.
 * Pure functions (formatDiagnosticsText, redactPath) are testable in Node.js
 * without Tauri runtime.
 */

export interface SidecarHealth {
  running: boolean;
  host?: string;
  port?: number;
  engine_version?: string;
  contract_version?: string;
  token_required?: boolean;
  error?: string;
}

export interface DbDiag {
  active_basename: string | null;
  size_bytes: number | null;       // null if fs unavailable
  mru_count: number;
  pinned_count: number;
}

export interface PrefsDiag {
  last_qa_policy: string | null;
  last_tei_profile: string | null;
  onboarding_step: number | null;
}

export interface EnvDiag {
  platform: string;
  user_agent: string;
  tauri_available: boolean;
  window_size: { w: number; h: number };
  locale: string;
}

/** Le runtime Tauri est-il présent ?
 *
 *  **Le test précédent ne pouvait jamais rendre vrai.** Il interrogeait
 *  `window.__TAURI__`, qui est le global de Tauri **v1**. En v2 — la version de cette
 *  application (`@tauri-apps/api ^2.0.0`) — ce global n'est injecté que si
 *  `withGlobalTauri: true` figure dans `tauri.conf.json`, et il en est absent : le
 *  défaut est `false`. Le panneau Diagnostic affichait donc « Tauri runtime : no » en
 *  toutes circonstances, y compris pendant que l'application invoquait des commandes
 *  Rust. Constaté à l'écran le 2026-08-23, et déjà dans le rapport du 20 août — où il
 *  se lisait comme un incident ponctuel alors qu'il est permanent.
 *
 *  Ce que v2 injecte réellement est `__TAURI_INTERNALS__`, sur quoi repose l'`invoke`
 *  de `@tauri-apps/api/core` : sa présence est donc la mesure honnête de « le pont est
 *  là ». `__TAURI__` reste testé en repli, pour une build qui activerait le global.
 *
 *  Paramétré plutôt que lisant `window` en dur : c'est ce qui le rend testable sans DOM. */
export function isTauriRuntime(
  win: unknown = typeof window !== "undefined" ? window : undefined,
): boolean {
  if (win === null || typeof win !== "object") return false;
  return "__TAURI_INTERNALS__" in win || "__TAURI__" in win;
}

export interface Diag {
  collected_at: string;
  app_version: string;
  engine_version: string;
  contract_version: string;
  tei_profiles: string[];
  sidecar: SidecarHealth;
  environment: EnvDiag;
  db: DbDiag;
  prefs: PrefsDiag;
  log_tail: string[];    // last N log lines (no full paths)
  errors: string[];      // non-empty if collection had partial failures
}

// ── Constants ────────────────────────────────────────────────────────────────

export const APP_VERSION_DIAG = "0.1.28";  // fallback if Tauri API unavailable
// Repli quand le sidecar est réellement injoignable. Ces constantes valaient « 0.7.9 »
// et « 1.6.26 » — un numéro de moteur qui N'A JAMAIS EXISTÉ (le moteur n'a jamais dépassé
// 0.4.0) et une version de contrat périmée de quarante crans. Elles étaient imprimées
// telles quelles, sans marqueur : le panneau censé rapporter des faits en fabriquait.
// Un diagnostic qui ne sait pas doit le dire, jamais inventer une valeur plausible.
export const ENGINE_VERSION_DIAG = "inconnue (sidecar injoignable)";
export const CONTRACT_VERSION_DIAG = "inconnue (sidecar injoignable)";
export const TEI_PROFILES_DIAG = ["generic", "parcolab_like", "parcolab_strict"];

// localStorage keys (replicated from shell.ts to avoid circular imports)
const LS_DB_RECENT     = "agrafes.db.recent";
const LS_ONBOARDING    = "agrafes.onboarding.demo.step";

// ── Path redaction (pure function) ───────────────────────────────────────────

/**
 * Redact sensitive path segments: replace home dir and usernames with placeholders.
 * Only keeps the last 2 path components to avoid leaking full paths.
 */
export function redactPath(p: string | null | undefined): string {
  if (!p) return "(none)";
  const normalized = p.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  // Keep only last 2 segments (basename + parent)
  const safe = parts.slice(-2).join("/");
  return safe || "(none)";
}

// ── Sidecar health probe ──────────────────────────────────────────────────────

async function _probeSidecar(): Promise<SidecarHealth> {
  // Read portfile from localStorage (written by sidecarClient when sidecar starts)
  let port: number | null = null;
  try {
    const raw = localStorage.getItem("agrafes.sidecar.port");
    if (raw) port = parseInt(raw, 10) || null;
  } catch { /* */ }

  if (!port) {
    // Try ensureRunning-style: look for portfile via sidecarClient's shared state
    // We do a best-effort fetch on common localhost ports
    return { running: false };
  }

  // QA-13 — la sonde DOIT passer par la commande Rust, comme tout le reste du shell.
  // Un fetch() direct depuis le webview est bloqué par CORS (le sidecar n'émet aucun
  // en-tête Access-Control, et c'est cohérent : personne n'est censé l'appeler ainsi),
  // si bien que ce panneau annonçait « Running : no » pendant que l'application
  // dialoguait avec lui — puis repliait sur des versions EN DUR, imprimées comme si
  // elles avaient été mesurées.
  try {
    const { invoke } = await import("@tauri-apps/api/core")
      .catch(() => ({ invoke: null as unknown as typeof import("@tauri-apps/api/core").invoke }));
    if (!invoke) return { running: false, error: "Tauri runtime unavailable" };
    const res = await invoke<{ status: number; ok: boolean; body: string }>(
      "sidecar_fetch_loopback",
      { url: `http://127.0.0.1:${port}/health`, method: "GET" },
    );
    if (!res.ok) {
      return { running: true, host: "127.0.0.1", port, error: `HTTP ${res.status}` };
    }
    const data = JSON.parse(res.body) as Record<string, unknown>;
    return {
      running: true,
      host: "127.0.0.1",
      port,
      engine_version: String(data.version ?? "?"),
      contract_version: String(data.contract_version ?? "?"),
      token_required: Boolean(data.token_required),
    };
  } catch (err) {
    return { running: false, error: String(err) };
  }
}

// ── DB size probe (best-effort) ───────────────────────────────────────────────

async function _getDbSize(dbPath: string | null): Promise<number | null> {
  if (!dbPath) return null;
  try {
    const { stat } = await import("@tauri-apps/plugin-fs").catch(() => ({ stat: null }));
    if (!stat) return null;
    const info = await (stat as (p: string) => Promise<{ size: number }>)(dbPath);
    return info.size ?? null;
  } catch {
    return null;
  }
}

// ── LocalStorage prefs reader ────────────────────────────────────────────────

function _readPrefs(): PrefsDiag {
  const _get = (k: string): string | null => {
    try { return localStorage.getItem(k); } catch { return null; }
  };
  const _getInt = (k: string): number | null => {
    const v = _get(k); return v !== null ? parseInt(v, 10) || 0 : null;
  };

  return {
    last_qa_policy: _get("agrafes.last_qa_policy"),
    last_tei_profile: _get("agrafes.last_tei_profile"),
    onboarding_step: _getInt(LS_ONBOARDING),
  };
}

// ── MRU stats ────────────────────────────────────────────────────────────────

function _readMruStats(): { mru_count: number; pinned_count: number } {
  try {
    const raw = localStorage.getItem(LS_DB_RECENT) ?? "[]";
    const list = JSON.parse(raw) as Array<{ pinned?: boolean }>;
    return {
      mru_count: list.length,
      pinned_count: list.filter(e => e.pinned).length,
    };
  } catch {
    return { mru_count: 0, pinned_count: 0 };
  }
}

// ── Main collector ────────────────────────────────────────────────────────────

export async function collectDiagnostics(opts: {
  currentDbPath: string | null;
  sessionLog: ReadonlyArray<{ ts: string; level: string; cat: string; msg: string; detail?: string }>;
  logTailLines?: number;
}): Promise<Diag> {
  const errors: string[] = [];
  const { currentDbPath, sessionLog, logTailLines = 50 } = opts;

  // Sidecar health
  let sidecar: SidecarHealth = { running: false };
  try {
    sidecar = await _probeSidecar();
  } catch (e) {
    errors.push(`sidecar probe failed: ${e}`);
    sidecar = { running: false, error: String(e) };
  }

  // DB size
  let dbSize: number | null = null;
  try {
    dbSize = await _getDbSize(currentDbPath);
  } catch {
    // size unavailable — non-fatal
  }

  // MRU stats
  const mruStats = _readMruStats();

  // Prefs
  let prefs: PrefsDiag = { last_qa_policy: null, last_tei_profile: null, onboarding_step: null };
  try { prefs = _readPrefs(); } catch (e) { errors.push(`prefs read failed: ${e}`); }

  // Environment
  const env: EnvDiag = {
    platform: navigator.platform ?? "unknown",
    user_agent: navigator.userAgent ?? "unknown",
    tauri_available: isTauriRuntime(),
    window_size: { w: window.innerWidth, h: window.innerHeight },
    locale: navigator.language ?? "unknown",
  };

  // Log tail — strip detail lines with potential paths
  const logTail = sessionLog
    .slice(-logTailLines)
    .map(e => `[${e.ts}] [${e.level.toUpperCase()}] [${e.cat}] ${e.msg}`);

  // App version from Tauri runtime (supersedes hardcoded constant)
  let appVersion = APP_VERSION_DIAG;
  try {
    const { getVersion } = await import("@tauri-apps/api/app").catch(() => ({ getVersion: null }));
    if (getVersion) appVersion = await getVersion();
  } catch { /* non-fatal: keep fallback */ }

  return {
    collected_at: new Date().toISOString(),
    app_version: appVersion,
    engine_version: sidecar.engine_version ?? ENGINE_VERSION_DIAG,
    contract_version: sidecar.contract_version ?? CONTRACT_VERSION_DIAG,
    tei_profiles: TEI_PROFILES_DIAG,
    sidecar,
    environment: env,
    db: {
      active_basename: currentDbPath ? redactPath(currentDbPath) : null,
      size_bytes: dbSize,
      mru_count: mruStats.mru_count,
      pinned_count: mruStats.pinned_count,
    },
    prefs,
    log_tail: logTail,
    errors,
  };
}

// ── Formatter (pure function) ─────────────────────────────────────────────────

export function formatDiagnosticsText(diag: Diag): string {
  const hr = "─".repeat(48);
  const sec = (title: string): string => `\n${hr}\n## ${title}\n${hr}`;

  const fmtSize = (b: number | null): string => {
    if (b === null) return "N/A";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  const lines: string[] = [
    "=".repeat(48),
    "  AGRAFES — Diagnostic System Report",
    "=".repeat(48),
    `Collected: ${diag.collected_at}`,
    "",
    sec("Versions"),
    `App version      : v${diag.app_version}`,
    `Engine version   : ${diag.engine_version}`,
    `Contract version : ${diag.contract_version}`,
    `TEI profiles     : ${diag.tei_profiles.join(", ")}`,
    "",
    sec("Sidecar"),
    `Running          : ${diag.sidecar.running ? "yes" : "no"}`,
    ...(diag.sidecar.running ? [
      `Host/Port        : ${diag.sidecar.host ?? "?"}:${diag.sidecar.port ?? "?"}`,
      `Token required   : ${diag.sidecar.token_required ? "yes" : "no"}`,
    ] : []),
    ...(diag.sidecar.error ? [`Error            : ${diag.sidecar.error}`] : []),
    "",
    sec("Environment"),
    `Platform         : ${diag.environment.platform}`,
    `Locale           : ${diag.environment.locale}`,
    `Window size      : ${diag.environment.window_size.w}×${diag.environment.window_size.h}`,
    `Tauri runtime    : ${diag.environment.tauri_available ? "yes" : "no"}`,
    `User-Agent       : ${diag.environment.user_agent}`,
    "",
    sec("Database"),
    `Active DB        : ${diag.db.active_basename ?? "(none)"}`,
    `Size             : ${fmtSize(diag.db.size_bytes)}`,
    `MRU entries      : ${diag.db.mru_count} (${diag.db.pinned_count} pinned)`,
    "",
    sec("Preferences"),
    `QA policy        : ${diag.prefs.last_qa_policy ?? "(not set)"}`,
    `TEI profile      : ${diag.prefs.last_tei_profile ?? "(not set)"}`,
    `Onboarding step  : ${diag.prefs.onboarding_step ?? "(not set)"}`,
    "",
  ];

  if (diag.errors.length > 0) {
    lines.push(sec("Collection Errors"));
    diag.errors.forEach(e => lines.push(`  ! ${e}`));
    lines.push("");
  }

  if (diag.log_tail.length > 0) {
    lines.push(sec(`Session Log (last ${diag.log_tail.length} entries)`));
    diag.log_tail.forEach(l => lines.push(l));
    lines.push("");
  }

  lines.push("=".repeat(48));
  lines.push("  End of diagnostic report");
  lines.push("=".repeat(48));

  return lines.join("\n");
}

// ── Telemetry NDJSON aggregation (PURE — testable in Node) ──────────────────

export interface TelemetryRecord {
  ts: string;
  event: string;
  // Free-form payload fields; we use string/number/bool/null
  [key: string]: unknown;
}

export interface TelemetryStats {
  total_events: number;
  by_event: Record<string, number>;
  by_stage: Record<string, { completed: number; success: number; avg_duration_ms: number }>;
  caps_hit: Array<{ cap_name: string; count: number }>;
  top_errors: Array<{ error_class: string; count: number }>;
  parse_errors: number;
  first_ts: string | null;
  last_ts: string | null;
}

/**
 * Parse an NDJSON string into telemetry records. Robust to malformed lines:
 * any line that fails JSON.parse is counted but not blocking.
 */
export function parseTelemetryNdjson(content: string): { records: TelemetryRecord[]; parseErrors: number } {
  const records: TelemetryRecord[] = [];
  let parseErrors = 0;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && typeof obj.event === "string") {
        records.push(obj as TelemetryRecord);
      } else {
        parseErrors++;
      }
    } catch {
      parseErrors++;
    }
  }
  return { records, parseErrors };
}

/**
 * Aggregate telemetry records into stats. Pure function; no I/O.
 */
export function aggregateTelemetry(records: TelemetryRecord[], parseErrors = 0): TelemetryStats {
  const stats: TelemetryStats = {
    total_events: records.length,
    by_event: {},
    by_stage: {},
    caps_hit: [],
    top_errors: [],
    parse_errors: parseErrors,
    first_ts: null,
    last_ts: null,
  };

  // Per-event counters
  const stageDurations: Record<string, number[]> = {};
  const stageSuccess: Record<string, number> = {};
  const capsCount: Record<string, number> = {};
  const errorsCount: Record<string, number> = {};

  for (const rec of records) {
    stats.by_event[rec.event] = (stats.by_event[rec.event] || 0) + 1;

    if (typeof rec.ts === "string") {
      if (stats.first_ts === null || rec.ts < stats.first_ts) stats.first_ts = rec.ts;
      if (stats.last_ts === null || rec.ts > stats.last_ts) stats.last_ts = rec.ts;
    }

    if (rec.event === "stage_completed") {
      const stage = String(rec.stage ?? "unknown");
      const dur = typeof rec.duration_ms === "number" ? rec.duration_ms : 0;
      const success = rec.success === true;
      if (!stageDurations[stage]) stageDurations[stage] = [];
      stageDurations[stage].push(dur);
      if (success) stageSuccess[stage] = (stageSuccess[stage] || 0) + 1;
    } else if (rec.event === "cap_hit") {
      const cap = String(rec.cap_name ?? "unknown");
      capsCount[cap] = (capsCount[cap] || 0) + 1;
    } else if (rec.event === "error_user_facing") {
      const cls = String(rec.error_class ?? "unknown");
      errorsCount[cls] = (errorsCount[cls] || 0) + 1;
    }
  }

  // Build by_stage
  for (const stage of Object.keys(stageDurations)) {
    const durs = stageDurations[stage];
    const completed = durs.length;
    const success = stageSuccess[stage] || 0;
    const avg = completed > 0 ? Math.round(durs.reduce((a, b) => a + b, 0) / completed) : 0;
    stats.by_stage[stage] = { completed, success, avg_duration_ms: avg };
  }

  // caps_hit sorted by count desc
  stats.caps_hit = Object.entries(capsCount)
    .map(([cap_name, count]) => ({ cap_name, count }))
    .sort((a, b) => b.count - a.count);

  // top_errors: top 5 by count desc
  stats.top_errors = Object.entries(errorsCount)
    .map(([error_class, count]) => ({ error_class, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return stats;
}

/**
 * Format telemetry stats as a markdown-friendly text block. Used by the
 * Shell diagnostic UI. Honest about empty cases ("no events yet").
 */
export function formatTelemetryStats(stats: TelemetryStats): string {
  const lines: string[] = [];
  if (stats.total_events === 0) {
    lines.push("Aucun événement de télémétrie enregistré pour cette base.");
    if (stats.parse_errors > 0) {
      lines.push(`(${stats.parse_errors} ligne(s) malformée(s) ignorée(s))`);
    }
    return lines.join("\n");
  }

  lines.push(`Total : ${stats.total_events} événement(s)`);
  if (stats.first_ts && stats.last_ts) {
    lines.push(`Période : ${stats.first_ts} → ${stats.last_ts}`);
  }
  lines.push("");

  lines.push("── Répartition par event ──");
  Object.entries(stats.by_event)
    .sort((a, b) => b[1] - a[1])
    .forEach(([ev, n]) => lines.push(`  ${ev.padEnd(24)} ${n}`));
  lines.push("");

  if (Object.keys(stats.by_stage).length > 0) {
    lines.push("── Stages (durée moyenne, succès) ──");
    Object.entries(stats.by_stage).forEach(([stage, s]) => {
      lines.push(`  ${stage.padEnd(12)} ${s.completed} run(s) · ${s.avg_duration_ms} ms moy. · ${s.success}/${s.completed} succès`);
    });
    lines.push("");
  }

  if (stats.caps_hit.length > 0) {
    lines.push("── Caps atteints ──");
    stats.caps_hit.forEach(c => lines.push(`  ${c.cap_name.padEnd(24)} ${c.count}×`));
    lines.push("");
  }

  if (stats.top_errors.length > 0) {
    lines.push("── Top erreurs utilisateur ──");
    stats.top_errors.forEach(e => lines.push(`  ${e.error_class.padEnd(24)} ${e.count}×`));
    lines.push("");
  }

  if (stats.parse_errors > 0) {
    lines.push(`(${stats.parse_errors} ligne(s) malformée(s) ignorée(s))`);
  }

  return lines.join("\n");
}
