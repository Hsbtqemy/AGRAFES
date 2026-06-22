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

/** Client-side mirror of the server's auth requirement, for an early UX guard. */
export function authIsComplete(auth: WebdavAuth): boolean {
  if (auth.mode === "basic") return Boolean(auth.user && auth.password);
  if (auth.mode === "bearer") return Boolean(auth.token);
  return true; // anonymous needs nothing
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

/** Folders first, then files, each alphabetical (locale-aware, case-insensitive). */
export function sortRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
}
