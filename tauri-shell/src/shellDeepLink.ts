/**
 * shellDeepLink.ts — Deep-link URL parsing and startup resolution.
 *
 * All functions here are pure URL/location parsers or thin async wrappers.
 * No DOM manipulation. Imports only from shellState.
 */

import { getCurrent as getCurrentDeepLinks, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { shellState, DEEP_LINK_SCHEME } from "./shellState.ts";
import type { Mode, DeepLinkPayload } from "./shellState.ts";

// ─── Pure URL helpers ─────────────────────────────────────────────────────────

export function normalizeMode(raw: string | null | undefined): Mode | null {
  const mode = (raw ?? "").trim().toLowerCase();
  if (mode === "explorer" || mode === "constituer" || mode === "home" || mode === "publish") {
    return mode;
  }
  return null;
}

export function isDbPathCandidate(path: string): boolean {
  return /\.(db|sqlite|sqlite3)$/i.test(path);
}

export function parseOpenDbDeepLink(uri: string): DeepLinkPayload | null {
  try {
    const u = new URL(uri);
    const protocol = u.protocol.toLowerCase();
    if (protocol !== `${DEEP_LINK_SCHEME}:` && protocol !== "agrafes:") return null;

    const hostPath = (u.hostname || u.pathname || "").replace(/^\/+/, "").toLowerCase();
    if (hostPath && hostPath !== "open-db" && hostPath !== "open") return null;

    const dbRaw = (
      u.searchParams.get("path") ??
      u.searchParams.get("db") ??
      u.searchParams.get("open_db") ?? ""
    ).trim();
    const mode = normalizeMode(u.searchParams.get("mode"));
    return { mode, dbPath: dbRaw && isDbPathCandidate(dbRaw) ? dbRaw : null };
  } catch {
    return null;
  }
}

export function firstDeepLinkPayload(urls: readonly string[]): DeepLinkPayload | null {
  for (const raw of urls) {
    const parsed = parseOpenDbDeepLink(raw);
    if (parsed && (parsed.dbPath || parsed.mode)) return parsed;
  }
  return null;
}

export function modeFromLocation(): Mode | null {
  const hashMode = normalizeMode(location.hash.replace(/^#/, ""));
  if (hashMode) return hashMode;
  const queryMode = normalizeMode(new URLSearchParams(location.search).get("mode"));
  if (queryMode) return queryMode;
  return null;
}

export function dbPathFromLocationSearch(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = (
      params.get("open_db") ?? params.get("db") ?? params.get("path") ?? ""
    ).trim();
    if (!raw || !isDbPathCandidate(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

// ─── Startup payload resolution ───────────────────────────────────────────────

export async function resolveStartupDeepLinkPayload(): Promise<DeepLinkPayload> {
  const fromLocation: DeepLinkPayload = {
    mode: normalizeMode(new URLSearchParams(window.location.search).get("mode")),
    dbPath: dbPathFromLocationSearch(),
  };
  if (fromLocation.mode || fromLocation.dbPath) return fromLocation;

  try {
    const initialLinks = await getCurrentDeepLinks();
    const fromPlugin = firstDeepLinkPayload(initialLinks ?? []);
    if (fromPlugin) return fromPlugin;
  } catch {
    // no deep-link payload at startup (normal path)
  }
  return { mode: null, dbPath: null };
}

// ─── Runtime listener ─────────────────────────────────────────────────────────

/**
 * Install the runtime deep-link listener.
 * onPayload is called whenever a valid deep-link arrives at runtime.
 */
export async function initDeepLinkRuntimeListener(
  onPayload: (payload: DeepLinkPayload) => Promise<void>,
): Promise<void> {
  try {
    shellState.deepLinkUnlisten = await onOpenUrl((urls) => {
      const payload = firstDeepLinkPayload(urls);
      if (!payload || (!payload.mode && !payload.dbPath)) return;
      void onPayload(payload).catch((err: unknown) => {
        console.error("[shell] deep-link handler error:", err);
      });
    });
  } catch {
    shellState.deepLinkUnlisten = null;
  }
}
