/**
 * shellLogger.ts — Session logger, crash marker, error capture, log export.
 *
 * Imports only from shellState (no circular deps).
 */

import { shellState, SESSION_LOG_MAX, LS_CRASH_MARKER } from "./shellState.ts";
import type { LogEntry } from "./shellState.ts";

declare const APP_VERSION: string;

// ─── Session logger ───────────────────────────────────────────────────────────

export function shellLog(
  level: LogEntry["level"],
  cat: string,
  msg: string,
  detail?: string,
): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, cat, msg, detail };
  shellState.sessionLog.push(entry);
  if (shellState.sessionLog.length > SESSION_LOG_MAX) shellState.sessionLog.shift();
  if (level === "error") console.error(`[shell][${cat}]`, msg, detail ?? "");
  else if (level === "warn") console.warn(`[shell][${cat}]`, msg, detail ?? "");
}

export function formatLog(): string {
  const header = [
    "=== AGRAFES Shell Session Log ===",
    `Generated: ${new Date().toISOString()}`,
    `App version: ${typeof APP_VERSION !== "undefined" ? APP_VERSION : "?"}`,
    `Platform: ${navigator.platform}`,
    `UserAgent: ${navigator.userAgent}`,
    `DB active: ${shellState.currentDbPath ?? "(none)"}`,
    `Last mode: ${shellState.currentMode}`,
    "=".repeat(40),
    "",
  ].join("\n");

  const entries = shellState.sessionLog.map(e =>
    `[${e.ts}] [${e.level.toUpperCase()}] [${e.cat}] ${e.msg}${e.detail ? "\n  " + e.detail : ""}`
  ).join("\n");

  return header + entries;
}

// ─── Crash marker ─────────────────────────────────────────────────────────────

export function writeCrashMarker(): void {
  try { localStorage.setItem(LS_CRASH_MARKER, new Date().toISOString()); } catch { /* */ }
}

export function clearCrashMarker(): void {
  try { localStorage.removeItem(LS_CRASH_MARKER); } catch { /* */ }
}

export function readCrashMarker(): string | null {
  try { return localStorage.getItem(LS_CRASH_MARKER); } catch { return null; }
}

// ─── Global error capture ─────────────────────────────────────────────────────

export function installErrorCapture(): void {
  window.onerror = (msg, src, line, col, err) => {
    shellLog("error", "uncaught", String(msg), `${src}:${line}:${col} — ${err?.stack ?? ""}`);
    return false;
  };
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error
      ? e.reason.message + "\n" + (e.reason.stack ?? "")
      : String(e.reason);
    shellLog("error", "unhandledrejection", "Unhandled promise rejection", reason);
  });
}

// ─── Log export bundle ────────────────────────────────────────────────────────

export async function exportLogBundle(showToast: (msg: string, ms?: number) => void): Promise<void> {
  shellLog("info", "log_export", "User requested log bundle export");
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const outPath = await save({
      title: "Enregistrer les logs AGRAFES",
      defaultPath: `agrafes-logs-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: "Texte", extensions: ["txt"] }],
    });
    if (!outPath) return;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(outPath, formatLog());
    showToast(`Logs exportés → ${outPath.replace(/\\/g, "/").split("/").pop() ?? outPath}`, 4000);
    shellLog("info", "log_export", `Logs written to ${outPath}`);
  } catch (err) {
    showToast(`Erreur export logs : ${String(err)}`, 5000);
    shellLog("error", "log_export", "Export failed", String(err));
  }
}

// ─── Crash recovery banner ────────────────────────────────────────────────────

export function showCrashRecoveryBanner(
  crashTs: string,
  esc: (s: string) => string,
  onExport: () => void,
): void {
  const banner = document.createElement("div");
  banner.id = "shell-crash-banner";
  banner.style.cssText = [
    "position:fixed;top:0;left:0;right:0;z-index:99998",
    "background:#c0392b;color:#fff;padding:0.5rem 1rem",
    "display:flex;align-items:center;gap:0.75rem;font-size:0.84rem",
    "box-shadow:0 2px 8px rgba(0,0,0,0.25)",
  ].join(";");

  const date = new Date(crashTs);
  const dateStr = Number.isNaN(date.getTime()) ? crashTs : date.toLocaleString();

  banner.innerHTML = `
    <span style="font-size:1.1rem">⚠</span>
    <span><strong>AGRAFES s'est fermé de façon inattendue</strong> (${esc(dateStr)})</span>
    <button id="crash-export-logs" style="margin-left:auto;background:#fff;color:#c0392b;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-weight:600;font-size:0.79rem">
      Exporter logs…
    </button>
    <button id="crash-dismiss" style="background:none;border:1px solid rgba(255,255,255,0.5);border-radius:4px;padding:4px 10px;color:#fff;cursor:pointer;font-size:0.79rem">
      Ignorer
    </button>
  `;

  banner.querySelector("#crash-export-logs")!.addEventListener("click", onExport);
  banner.querySelector("#crash-dismiss")!.addEventListener("click", () => banner.remove());
  document.body.prepend(banner);
  shellLog("warn", "crash_recovery", `Crash detected from previous session: ${crashTs}`);
}
