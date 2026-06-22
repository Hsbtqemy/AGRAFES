/**
 * shareDocs.ts — pure helpers for the ShareDocs / WebDAV import screen (Phase 3).
 *
 * No DOM, no IO — UI-agnostic formatting + small policy helpers, so the screen's
 * logic is unit-testable in isolation (Vitest). The screen itself only does DOM
 * wiring + sidecar calls.
 */

import type {
  ImportRemoteReport,
  RemoteEntry,
  RemoteFileStatus,
  WebdavAuth,
  WebdavAuthMode,
} from "./sidecarClient.ts";

/**
 * Build the auth object from raw form fields, keeping only the fields relevant to
 * *mode* (we never send a password in bearer mode, etc.). Returns the object that
 * goes in the request body; it is never persisted (memory-only, Phase 3 decision).
 */
export function buildWebdavAuth(
  mode: WebdavAuthMode,
  fields: { user?: string; password?: string; token?: string }
): WebdavAuth {
  if (mode === "basic") {
    return { mode, user: (fields.user ?? "").trim(), password: fields.password ?? "" };
  }
  if (mode === "bearer") {
    return { mode, token: (fields.token ?? "").trim() };
  }
  return { mode: "anonymous" };
}

/**
 * Whether an import mode requires a language. Every mode except TEI (which
 * carries its own xml:lang) needs one — without it a non-TEI import fails on the
 * `documents.language` NOT NULL constraint. Mirrors the CLI / sidecar guard.
 */
export function languageRequiredForMode(mode: string): boolean {
  return mode !== "tei";
}

/** Client-side mirror of the server's auth requirement, for an early UX guard. */
export function authIsComplete(auth: WebdavAuth): boolean {
  if (auth.mode === "basic") return Boolean(auth.user && auth.password);
  if (auth.mode === "bearer") return Boolean(auth.token);
  return true; // anonymous needs nothing
}

/**
 * Stable OS-keychain account key for a remembered ShareDocs credential (Phase 4A).
 * Keyed by server origin + auth mode + username so distinct servers/accounts never
 * collide. Only the secret (password / token) is ever stored under this key — the
 * non-secret fields live in localStorage. Falls back to the trimmed raw URL when the
 * URL is unparsable, so the key stays deterministic. See DESIGN §9.2.
 */
export function keyringAccount(url: string, mode: WebdavAuthMode, user: string): string {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = (url ?? "").trim();
  }
  return `${origin}|${mode}|${(user ?? "").trim()}`;
}

/**
 * The secret to store in the keychain for this auth, or null when there is none
 * (anonymous, or an empty secret). Basic → password, bearer → token.
 */
export function authSecret(auth: WebdavAuth): string | null {
  if (auth.mode === "basic") return auth.password ? auth.password : null;
  if (auth.mode === "bearer") return auth.token ? auth.token : null;
  return null;
}

/** Human-readable file size; the server may report null (size unknown). */
export function formatRemoteSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Kio", "Mio", "Gio", "Tio"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** One-line summary of a batch report (e.g. "5 fichiers : 3 importés, 1 doublon, 1 erreur"). */
export function summarizeReport(r: ImportRemoteReport): string {
  const parts: string[] = [`${r.imported} importé${r.imported > 1 ? "s" : ""}`];
  if (r.skipped_duplicate) parts.push(`${r.skipped_duplicate} doublon${r.skipped_duplicate > 1 ? "s" : ""}`);
  if (r.skipped_filtered) parts.push(`${r.skipped_filtered} filtré${r.skipped_filtered > 1 ? "s" : ""}`);
  if (r.skipped_oversize) parts.push(`${r.skipped_oversize} trop volumineux`);
  if (r.errors) parts.push(`${r.errors} erreur${r.errors > 1 ? "s" : ""}`);
  return `${r.total} fichier${r.total > 1 ? "s" : ""} : ${parts.join(", ")}`;
}

/** Badge kind (CSS suffix) for a per-file status. */
export function statusBadgeKind(status: RemoteFileStatus): "ok" | "warn" | "error" | "muted" {
  switch (status) {
    case "imported":
      return "ok";
    case "error":
      return "error";
    case "skipped-duplicate":
      return "muted";
    default:
      return "warn"; // skipped-filtered / skipped-oversize
  }
}

/** Human label (FR) for a per-file status. */
export function statusLabel(status: RemoteFileStatus): string {
  switch (status) {
    case "imported":
      return "Importé";
    case "skipped-duplicate":
      return "Doublon";
    case "skipped-filtered":
      return "Filtré";
    case "skipped-oversize":
      return "Trop volumineux";
    case "error":
      return "Erreur";
    default:
      return status;
  }
}

/** Normalize a folder URL so it ends with exactly one trailing slash (collection). */
export function normalizeFolderUrl(url: string): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/** Last path segment of a folder URL, decoded, for a compact label. */
export function folderLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const last = path.split("/").pop() ?? "";
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

/** One item in the ShareDocs selection cart (P4C). */
export interface SelectedRemoteItem {
  href: string;
  name: string;
  parentUrl: string;
  is_dir: boolean;
}

/** A single /import-remote submission derived from the cart. */
export interface ImportGroup {
  url: string;
  hrefs?: string[];
  label: string;
}

/**
 * Group a selection cart into import submissions (P4C). Each selected folder
 * becomes a whole-folder import (no `hrefs`); the remaining selected files are
 * grouped by parent folder into an `hrefs` submission. A file directly inside a
 * selected folder is dropped — the folder import already covers it. Because
 * import-remote is Depth:1, a file in a *sub*-folder of a selected folder is NOT
 * covered and is therefore kept.
 */
export function groupSelectionForImport(items: SelectedRemoteItem[]): ImportGroup[] {
  const folders = items.filter((i) => i.is_dir);
  const selectedFolderHrefs = new Set(folders.map((f) => f.href));
  const groups: ImportGroup[] = folders.map((f) => ({ url: f.href, label: f.name }));

  const byParent = new Map<string, SelectedRemoteItem[]>();
  for (const it of items) {
    if (it.is_dir) continue;
    if (selectedFolderHrefs.has(it.parentUrl)) continue; // covered by a selected folder
    const arr = byParent.get(it.parentUrl) ?? [];
    arr.push(it);
    byParent.set(it.parentUrl, arr);
  }
  for (const [parentUrl, files] of byParent) {
    groups.push({
      url: parentUrl,
      hrefs: files.map((f) => f.href),
      label: `${folderLabel(parentUrl)} (${files.length} fichier${files.length > 1 ? "s" : ""})`,
    });
  }
  return groups;
}

/** Merge two batch reports (P4C aggregates the reports of several submissions). */
export function mergeReports(
  a: ImportRemoteReport | null,
  b: ImportRemoteReport,
): ImportRemoteReport {
  if (!a) return b;
  return {
    url: a.url,
    mode: a.mode,
    total: a.total + b.total,
    imported: a.imported + b.imported,
    skipped_duplicate: a.skipped_duplicate + b.skipped_duplicate,
    skipped_filtered: a.skipped_filtered + b.skipped_filtered,
    skipped_oversize: a.skipped_oversize + b.skipped_oversize,
    errors: a.errors + b.errors,
    files: [...a.files, ...b.files],
  };
}

/** Folders first, then files, each alphabetical (locale-aware, case-insensitive). */
export function sortRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
}

/**
 * decodeURIComponent that never throws — a server-supplied href may contain a
 * lone '%' (legal in some WebDAV hrefs) which would otherwise raise URIError and
 * abort rendering of an otherwise-valid listing. Falls back to the raw string.
 */
export function safeDecodeUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * Structural guard for an async job's `result` before treating it as a batch
 * report — the job result is typed `Record<string, unknown>`, so a shape drift
 * (older sidecar, partial result) must not surface as "undefined fichier".
 */
export function isImportRemoteReport(x: unknown): x is ImportRemoteReport {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.total === "number" &&
    typeof r.imported === "number" &&
    Array.isArray(r.files)
  );
}
