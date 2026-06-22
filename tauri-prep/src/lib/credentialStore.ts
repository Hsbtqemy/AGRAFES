/**
 * credentialStore.ts — persistence for ShareDocs / WebDAV credentials (Phase 4A).
 *
 * Split by sensitivity:
 *   - the **secret** (WebDAV password / bearer token) goes to the **OS keychain**
 *     via the shell's Rust `keyring_*` commands (never plaintext on disk);
 *   - the **non-secret** prefs (URL, auth mode, username, "remember" flag) go to
 *     `localStorage`, the established Prep persistence pattern.
 *
 * Every keychain call degrades gracefully: if the command/keychain is unavailable
 * (Prep standalone with no such command, Linux without libsecret, a locked vault),
 * we fall back to memory-only — `secureGet` returns null, `secureSet` returns false,
 * `secureDelete` is a no-op — and the connection flow continues. See DESIGN §9.2.
 */

import { invoke } from "@tauri-apps/api/core";
import type { WebdavAuthMode } from "./sidecarClient.ts";

/** Keychain service namespace; the account key is built by `keyringAccount`. */
const KEYRING_SERVICE = "agrafes.sharedocs";

/** localStorage key for the last non-secret connection prefs. */
const LS_LAST_CONN = "agrafes.prep.sharedocs.lastConn";

/** Non-secret connection prefs persisted in localStorage (never the secret). */
export interface RememberedConn {
  url: string;
  mode: WebdavAuthMode;
  user: string;
  remember: boolean;
}

function isMode(v: unknown): v is WebdavAuthMode {
  return v === "anonymous" || v === "basic" || v === "bearer";
}

/** Last non-secret prefs, or null when absent/corrupt. */
export function loadLastConn(): RememberedConn | null {
  try {
    const raw = localStorage.getItem(LS_LAST_CONN);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<RememberedConn>;
    if (typeof o.url !== "string" || !isMode(o.mode)) return null;
    return {
      url: o.url,
      mode: o.mode,
      user: typeof o.user === "string" ? o.user : "",
      remember: o.remember === true,
    };
  } catch {
    return null;
  }
}

/** Persist the non-secret prefs (no-op on storage failure). */
export function saveLastConn(c: RememberedConn): void {
  try {
    localStorage.setItem(
      LS_LAST_CONN,
      JSON.stringify({ url: c.url, mode: c.mode, user: c.user, remember: c.remember }),
    );
  } catch {
    /* localStorage unavailable / quota — non-secret prefs are best-effort */
  }
}

/** Forget the non-secret prefs. */
export function clearLastConn(): void {
  try {
    localStorage.removeItem(LS_LAST_CONN);
  } catch {
    /* ignore */
  }
}

/** Read a secret from the OS keychain. Returns null when absent or unavailable. */
export async function secureGet(account: string): Promise<string | null> {
  try {
    const v = await invoke<string | null>("keyring_get", { service: KEYRING_SERVICE, account });
    return v ?? null;
  } catch {
    return null; // keychain/command unavailable → memory-only
  }
}

/** Store a secret in the OS keychain. Returns false when it could not be stored. */
export async function secureSet(account: string, secret: string): Promise<boolean> {
  try {
    await invoke("keyring_set", { service: KEYRING_SERVICE, account, secret });
    return true;
  } catch {
    return false;
  }
}

/** Remove a secret from the OS keychain (idempotent; ignores failure). */
export async function secureDelete(account: string): Promise<void> {
  try {
    await invoke("keyring_delete", { service: KEYRING_SERVICE, account });
  } catch {
    /* ignore — best-effort forget */
  }
}
