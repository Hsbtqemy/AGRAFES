/**
 * shellState.ts — Shared mutable state, types, and constants for the AGRAFES shell.
 *
 * All shell modules import from here to avoid circular dependencies.
 * No imports from other shell modules allowed in this file.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Mode = "home" | "explorer" | "constituer" | "publish";

export interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  cat: string;
  msg: string;
  detail?: string;
}

export interface MruEntry {
  path: string;
  label: string;           // basename
  last_opened_at: string;  // ISO timestamp
  pinned?: boolean;
  missing?: boolean;       // set after async file-existence check
}

export interface DeepLinkPayload {
  mode: Mode | null;
  dbPath: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const LS_MODE            = "agrafes.lastMode";
export const LS_DB              = "agrafes.lastDbPath";
export const LS_PRESETS_GLOBAL  = "agrafes.presets.global";
export const LS_PRESETS_PREP    = "agrafes.prep.presets";   // source for migration
export const LS_ONBOARDING_STEP = "agrafes.onboarding.demo.step";
export const LS_DB_RECENT       = "agrafes.db.recent";
export const LS_CRASH_MARKER    = "agrafes.session.crash_marker";

export const MRU_MAX           = 10;
export const DEEP_LINK_SCHEME  = "agrafes-shell";
export const SESSION_LOG_MAX   = 500;

// ─── Mutable state ────────────────────────────────────────────────────────────

export const shellState = {
  currentMode:     "home" as Mode,
  currentDbPath:   null as string | null,
  currentDispose:  null as (() => void) | null,
  navigating:      false,
  pendingDbRemount: false,
  dbListeners:     new Set<(path: string | null) => void>(),
  deepLinkUnlisten: null as (() => void) | null,
  sessionLog:      [] as LogEntry[],
};
