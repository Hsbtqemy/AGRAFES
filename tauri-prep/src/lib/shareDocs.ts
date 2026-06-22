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

/** Import format implied by a file extension or targeted by an import mode (P4D). */
export type ImportFormat = "docx" | "odt" | "txt" | "tei" | "conllu" | "unknown";

/** Format implied by a filename extension (selection info — never parses content). */
export function detectFormatFromName(name: string): ImportFormat {
  const n = (name ?? "").trim().toLowerCase();
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".odt")) return "odt";
  if (n.endsWith(".txt")) return "txt";
  if (n.endsWith(".xml") || n.endsWith(".tei")) return "tei";
  if (n.endsWith(".conllu")) return "conllu";
  return "unknown";
}

/** Format an import mode targets (e.g. `docx_numbered_lines` → "docx"). */
export function modeFormat(mode: string): ImportFormat {
  const m = (mode ?? "").trim();
  if (m.startsWith("docx")) return "docx";
  if (m.startsWith("odt")) return "odt";
  if (m.startsWith("txt")) return "txt";
  if (m === "tei") return "tei";
  if (m === "conllu") return "conllu";
  return "unknown";
}

/**
 * Whether *name*'s format is compatible with the chosen import *mode*. Only the
 * **format** is checked (extension) — NOT the segmentation style (numbered vs
 * paragraphs), which can't be known without parsing. An unknown extension is a
 * mismatch (it would error at import).
 */
export function fileMatchesMode(name: string, mode: string): boolean {
  const f = detectFormatFromName(name);
  return f !== "unknown" && f === modeFormat(mode);
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

/**
 * Build the Nextcloud / ShareDocs personal WebDAV root for *hostOrUrl* + *user*
 * (P4B preset). *hostOrUrl* may be a bare host ("dav.huma-num.fr"), a full URL, or
 * a deep URL — only its origin is kept (scheme defaults to https). Returns
 * `<origin>/remote.php/dav/files/<user>/`, or "" when either input is empty or the
 * host is unparseable (the caller then keeps the field untouched). The result is a
 * plain saisie aid — the connector stays generic WebDAV (no Nextcloud coupling).
 */
export function buildNextcloudRoot(hostOrUrl: string, user: string): string {
  const h = (hostOrUrl ?? "").trim();
  const u = (user ?? "").trim();
  if (!h || !u) return "";
  let origin: string;
  try {
    const withScheme = /^https?:\/\//i.test(h) ? h : `https://${h}`;
    origin = new URL(withScheme).origin;
  } catch {
    return "";
  }
  if (!origin || origin === "null") return "";
  return `${origin}/remote.php/dav/files/${encodeURIComponent(u)}/`;
}

/**
 * True when *value* already carries a non-root path (e.g. a deep folder URL),
 * as opposed to a bare host / root. Used by the P4B preset to confirm before it
 * would overwrite a path the user already typed. Tolerant: a bare host or an
 * unparseable value is "no path" (false).
 */
export function urlHasPath(value: string): boolean {
  const v = (value ?? "").trim();
  if (!v) return false;
  try {
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    return new URL(withScheme).pathname.length > 1; // "/" → none; "/foo" → deep
  } catch {
    return false;
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

/**
 * A remote file resolved for import with its per-file detected params (Phase 5).
 * `mode`/`language` come from importDetect (extension → mode, name → langue).
 */
export interface DetectedImportFile {
  href: string;
  name: string;
  parentUrl: string;
  mode: string;
  language: string;
}

/**
 * A single /import-remote submission grouped by (parentUrl, mode, language). Unlike
 * {@link ImportGroup} (P4C, one mode for the whole cart), each group here carries its
 * own detected mode + language, so a bilingual / mixed-format folder fans out into
 * several submissions (DESIGN §11.3).
 */
export interface DetectedImportGroup {
  url: string;
  hrefs: string[];
  mode: string;
  language: string;
  label: string;
}

/**
 * Group per-file-detected files into import submissions keyed by
 * (parentUrl, mode, language) — one `import-remote` call per group, each sending
 * the group's `hrefs`. Insertion order of first occurrence is preserved. Files must
 * already be filtered (unknown extensions dropped upstream).
 */
export function groupDetectedFiles(files: DetectedImportFile[]): DetectedImportGroup[] {
  const byKey = new Map<string, DetectedImportGroup>();
  for (const f of files) {
    const key = `${f.parentUrl} ${f.mode} ${f.language}`;
    let g = byKey.get(key);
    if (!g) {
      g = { url: f.parentUrl, hrefs: [], mode: f.mode, language: f.language, label: "" };
      byKey.set(key, g);
    }
    g.hrefs.push(f.href);
  }
  const groups = [...byKey.values()];
  for (const g of groups) {
    const n = g.hrefs.length;
    g.label = `${folderLabel(g.url)} · ${g.mode} · ${g.language} (${n} fichier${n > 1 ? "s" : ""})`;
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
