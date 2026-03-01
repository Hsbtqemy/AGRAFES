/**
 * sidecarClient.ts — Persistent sidecar HTTP client for ConcordancierPrep V0.
 *
 * Same portfile / spawn / token pattern as tauri-app, extended with:
 *  - listDocuments()  → GET /documents
 *  - curate()         → POST /curate
 *  - segment()        → POST /segment
 *  - align()          → POST /align
 *  - validateMeta()   → POST /validate-meta
 *  - getJob()         → GET /jobs/<id>
 */

import { Command, type Child } from "@tauri-apps/plugin-shell";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { fetch } from "@tauri-apps/plugin-http";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocumentRecord {
  doc_id: number;
  title: string;
  language: string;
  doc_role: string | null;
  resource_type: string | null;
  unit_count: number;
}

export interface ImportOptions {
  mode: "docx_numbered_lines" | "txt_numbered_lines" | "docx_paragraphs" | "tei";
  path: string;
  language?: string;
  title?: string;
  doc_role?: string;
  resource_type?: string;
  tei_unit?: "p" | "s";
}

export interface ImportResponse {
  ok: boolean;
  doc_id: number;
  units_line?: number;
  units_total?: number;
}

export interface IndexResponse {
  ok: boolean;
  units_indexed: number;
}

export interface CurateRule {
  pattern: string;
  replacement: string;
  flags?: string;
  description?: string;
}

export interface CurateOptions {
  rules: CurateRule[];
  doc_id?: number;
}

export interface CurateResponse {
  ok: boolean;
  docs_curated: number;
  units_modified: number;
  fts_stale: boolean;
}

export interface SegmentOptions {
  doc_id: number;
  lang?: string;
  pack?: "auto" | "default" | "fr_strict" | "en_strict";
}

export interface SegmentResponse {
  ok: boolean;
  doc_id: number;
  units_input: number;
  units_output: number;
  segment_pack?: string;
  fts_stale: boolean;
  warnings: string[];
}

export interface AlignOptions {
  pivot_doc_id: number;
  target_doc_ids: number[];
  strategy?: "external_id" | "position" | "similarity" | "external_id_then_position";
  debug_align?: boolean;
  relation_type?: string;
  sim_threshold?: number;
  run_id?: string;
}

export interface AlignDebugSimilarityStats {
  score_mean?: number;
  score_min?: number;
  score_max?: number;
  [key: string]: unknown;
}

export interface AlignDebugSampleLink {
  pivot_unit_id?: number;
  target_unit_id?: number;
  external_id?: number | null;
  [key: string]: unknown;
}

export interface AlignDebugPayload {
  strategy?: string;
  link_sources?: Record<string, unknown>;
  similarity_stats?: AlignDebugSimilarityStats;
  sample_links?: AlignDebugSampleLink[];
  [key: string]: unknown;
}

export interface AlignReport {
  target_doc_id: number;
  links_created: number;
  links_skipped?: number;
  debug?: AlignDebugPayload;
}

export interface AlignResponse {
  ok: boolean;
  run_id: string;
  strategy: string;
  debug_align?: boolean;
  pivot_doc_id: number;
  total_links_created?: number;
  reports: AlignReport[];
}

// ─── Curate Preview types ─────────────────────────────────────────────────────

export interface CuratePreviewOptions {
  doc_id: number;
  rules: CurateRule[];
  limit_examples?: number;
}

export interface CuratePreviewExample {
  unit_id: number;
  external_id: number | null;
  before: string;
  after: string;
}

export interface CuratePreviewStats {
  units_total: number;
  units_changed: number;
  replacements_total: number;
}

export interface CuratePreviewResponse {
  ok: boolean;
  doc_id: number;
  stats: CuratePreviewStats;
  examples: CuratePreviewExample[];
  fts_stale: boolean;
}

// ─── Align Audit types ────────────────────────────────────────────────────────

export interface AlignAuditOptions {
  pivot_doc_id: number;
  target_doc_id: number;
  limit?: number;
  offset?: number;
  external_id?: number;
  status?: "accepted" | "rejected" | "unreviewed";
}

export interface AlignLinkRecord {
  link_id: number;
  external_id: number | null;
  pivot_unit_id: number;
  target_unit_id: number;
  pivot_text: string;
  target_text: string;
  status: "accepted" | "rejected" | null;
}

// ─── V0.4A — Metadata types ───────────────────────────────────────────────────

export interface DocumentUpdateOptions {
  doc_id: number;
  title?: string;
  language?: string;
  doc_role?: string;
  resource_type?: string;
}

export interface DocRelationRecord {
  id: number;
  doc_id: number;
  relation_type: string;
  target_doc_id: number;
  note: string | null;
  created_at: string;
}

export interface DocRelationsResponse {
  ok: boolean;
  doc_id: number;
  relations: DocRelationRecord[];
  count: number;
}

export interface DocRelationSetOptions {
  doc_id: number;
  relation_type: string;
  target_doc_id: number;
  note?: string;
}

// ─── V0.4B — Export types ─────────────────────────────────────────────────────

export interface ExportTeiOptions {
  out_dir: string;
  doc_ids?: number[];
}

export interface ExportTeiResponse {
  ok: boolean;
  files_created: string[];
  count: number;
}

export interface ExportAlignCsvOptions {
  out_path: string;
  pivot_doc_id?: number;
  target_doc_id?: number;
  delimiter?: string;
}

export interface ExportAlignCsvResponse {
  ok: boolean;
  out_path: string;
  rows_written: number;
}

export interface ExportRunReportOptions {
  out_path: string;
  run_id?: string;
  format?: "jsonl" | "html";
}

export interface ExportRunReportResponse {
  ok: boolean;
  out_path: string;
  runs_exported: number;
  format: string;
}

// ─── V0.4C — Align link edit types ───────────────────────────────────────────

export interface AlignLinkUpdateStatusOptions {
  link_id: number;
  status: "accepted" | "rejected" | null;
}

export interface AlignLinkDeleteOptions {
  link_id: number;
}

export interface AlignLinkRetargetOptions {
  link_id: number;
  new_target_unit_id: number;
}

export interface AlignAuditResponse {
  ok: boolean;
  pivot_doc_id: number;
  target_doc_id: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
  stats: { links_returned: number };
  links: AlignLinkRecord[];
}

export interface ValidateMetaResponse {
  ok: boolean;
  docs_validated: number;
  results: Array<{
    doc_id: number;
    is_valid: boolean;
    warnings: string[];
  }>;
}

export interface JobRecord {
  job_id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error" | "canceled";
  progress_pct: number;
  progress_message?: string;
  result?: Record<string, unknown>;
  error?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
}

export interface HealthInfo {
  version: string;
  pid: number;
  started_at: string;
  host: string;
  port: number;
}

// ─── Connection handle ────────────────────────────────────────────────────────

export interface Conn {
  baseUrl: string;
  token: string | null;
  post(path: string, body: unknown): Promise<unknown>;
  get(path: string): Promise<unknown>;
}

// ─── Internal state ───────────────────────────────────────────────────────────

let _conn: Conn | null = null;
let _spawnedChild: Child | null = null;
const SIDECAR_PROGRAM = "multicorpus";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function portfilePath(dbPath: string): string {
  const sep = dbPath.includes("/") ? "/" : "\\";
  const dir = dbPath.includes(sep)
    ? dbPath.substring(0, dbPath.lastIndexOf(sep))
    : ".";
  return `${dir}/.agrafes_sidecar.json`;
}

async function readPortfile(portfile: string): Promise<Record<string, unknown> | null> {
  try {
    if (!(await exists(portfile))) return null;
    const raw = await readTextFile(portfile);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function pollHealth(baseUrl: string, maxMs = 15000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>;
        if (json.ok === true || json.status === "ok") return true;
      }
    } catch {
      // still starting
    }
    await sleep(300);
  }
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
      const res = await fetch(`${baseUrl}${path}`, {
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
    async get(path: string): Promise<unknown> {
      const headers: Record<string, string> = {};
      if (token) headers["X-Agrafes-Token"] = token;
      const res = await fetch(`${baseUrl}${path}`, { headers });
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

export async function ensureRunning(dbPath: string): Promise<Conn> {
  // 1. Reuse live in-memory connection
  if (_conn) {
    try {
      await _conn.get("/health");
      return _conn;
    } catch {
      _conn = null;
    }
  }

  // 2. Portfile discovery
  const pf = portfilePath(dbPath);
  const pfData = await readPortfile(pf);
  if (pfData) {
    const host = (pfData.host as string) ?? "127.0.0.1";
    const port = pfData.port as number;
    const token = (pfData.token as string | null) ?? null;
    if (typeof port === "number" && port > 0) {
      const baseUrl = `http://${host}:${port}`;
      try {
        const res = await fetch(`${baseUrl}/health`);
        const json = (await res.json()) as Record<string, unknown>;
        if (res.ok && json.ok === true) {
          _conn = makeConn(baseUrl, token);
          return _conn;
        }
      } catch {
        // stale portfile — fall through to spawn
      }
    }
  }

  // 3. Spawn new sidecar
  return _spawnSidecar(dbPath);
}

async function _spawnSidecar(dbPath: string): Promise<Conn> {
  if (_spawnedChild) {
    try { await _spawnedChild.kill(); } catch { /* ignore */ }
    _spawnedChild = null;
  }

  const command = Command.sidecar(SIDECAR_PROGRAM, [
    "serve", "--db", dbPath, "--host", "127.0.0.1", "--port", "0", "--token", "auto",
  ]);
  const firstJsonPromise = _readFirstJsonFromCommand(command);

  let child: Child;
  try {
    child = await command.spawn();
  } catch (err) {
    throw new SidecarError(`Sidecar spawn failed: ${String(err)}`);
  }
  _spawnedChild = child;

  const started = await firstJsonPromise;
  const host = (started.host as string) ?? "127.0.0.1";
  const port = started.port as number;
  if (!Number.isFinite(port) || port <= 0) {
    throw new SidecarError("Sidecar startup payload missing valid port");
  }

  const baseUrl = `http://${host}:${port}`;
  if (!(await pollHealth(baseUrl))) {
    throw new SidecarError("Sidecar did not become healthy within timeout");
  }

  const pf = portfilePath(dbPath);
  const pfData = await readPortfile(pf);
  const token = pfData ? ((pfData.token as string | null) ?? null) : null;

  _conn = makeConn(baseUrl, token);
  return _conn;
}

function _readFirstJsonFromCommand(command: {
  stdout: { on(event: "data", cb: (chunk: string) => void): void };
  on(event: "error", cb: (err: unknown) => void): void;
}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let depth = 0;
    let started = false;
    const timer = setTimeout(
      () => reject(new SidecarError("Timeout waiting for sidecar startup JSON")),
      12000
    );

    command.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      for (const ch of chunk) {
        if (ch === "{") { depth += 1; started = true; }
        else if (ch === "}") {
          depth -= 1;
          if (started && depth === 0) {
            clearTimeout(timer);
            try { resolve(JSON.parse(buffer.trim()) as Record<string, unknown>); }
            catch (e) { reject(new SidecarError(`Failed to parse startup JSON: ${e}`)); }
            return;
          }
        }
      }
    });

    command.on("error", (err: unknown) => {
      clearTimeout(timer);
      reject(new SidecarError(`Sidecar process error: ${String(err)}`));
    });
  });
}

// ─── API methods ─────────────────────────────────────────────────────────────

export async function getHealth(conn: Conn): Promise<HealthInfo> {
  return conn.get("/health") as Promise<HealthInfo>;
}

export async function listDocuments(conn: Conn): Promise<DocumentRecord[]> {
  const res = (await conn.get("/documents")) as { documents: DocumentRecord[] };
  return res.documents;
}

export async function importFile(conn: Conn, opts: ImportOptions): Promise<ImportResponse> {
  return conn.post("/import", opts) as Promise<ImportResponse>;
}

export async function rebuildIndex(conn: Conn): Promise<IndexResponse> {
  return conn.post("/index", {}) as Promise<IndexResponse>;
}

export async function curate(conn: Conn, opts: CurateOptions): Promise<CurateResponse> {
  return conn.post("/curate", opts) as Promise<CurateResponse>;
}

export async function segment(conn: Conn, opts: SegmentOptions): Promise<SegmentResponse> {
  return conn.post("/segment", opts) as Promise<SegmentResponse>;
}

export async function align(conn: Conn, opts: AlignOptions): Promise<AlignResponse> {
  return conn.post("/align", opts) as Promise<AlignResponse>;
}

export async function validateMeta(
  conn: Conn,
  doc_id?: number
): Promise<ValidateMetaResponse> {
  const body: Record<string, unknown> = {};
  if (doc_id !== undefined) body.doc_id = doc_id;
  return conn.post("/validate-meta", body) as Promise<ValidateMetaResponse>;
}

export async function getJob(conn: Conn, jobId: string): Promise<JobRecord> {
  const res = (await conn.get(`/jobs/${jobId}`)) as { job: JobRecord };
  return res.job;
}

export async function curatePreview(
  conn: Conn,
  opts: CuratePreviewOptions
): Promise<CuratePreviewResponse> {
  return conn.post("/curate/preview", opts) as Promise<CuratePreviewResponse>;
}

export async function alignAudit(
  conn: Conn,
  opts: AlignAuditOptions
): Promise<AlignAuditResponse> {
  return conn.post("/align/audit", opts) as Promise<AlignAuditResponse>;
}

// ─── V0.4A — Metadata API ────────────────────────────────────────────────────

export async function updateDocument(conn: Conn, opts: DocumentUpdateOptions): Promise<{ updated: number; doc: DocumentRecord }> {
  return conn.post("/documents/update", opts) as Promise<{ updated: number; doc: DocumentRecord }>;
}

export async function bulkUpdateDocuments(conn: Conn, updates: DocumentUpdateOptions[]): Promise<{ updated: number }> {
  return conn.post("/documents/bulk_update", { updates }) as Promise<{ updated: number }>;
}

export async function getDocRelations(conn: Conn, doc_id: number): Promise<DocRelationsResponse> {
  return conn.get(`/doc_relations?doc_id=${doc_id}`) as Promise<DocRelationsResponse>;
}

export async function setDocRelation(conn: Conn, opts: DocRelationSetOptions): Promise<{ action: string; id: number }> {
  return conn.post("/doc_relations/set", opts) as Promise<{ action: string; id: number }>;
}

export async function deleteDocRelation(conn: Conn, id: number): Promise<{ deleted: number }> {
  return conn.post("/doc_relations/delete", { id }) as Promise<{ deleted: number }>;
}

// ─── V0.4B — Exports API ─────────────────────────────────────────────────────

export async function exportTei(conn: Conn, opts: ExportTeiOptions): Promise<ExportTeiResponse> {
  return conn.post("/export/tei", opts) as Promise<ExportTeiResponse>;
}

export async function exportAlignCsv(conn: Conn, opts: ExportAlignCsvOptions): Promise<ExportAlignCsvResponse> {
  return conn.post("/export/align_csv", opts) as Promise<ExportAlignCsvResponse>;
}

export async function exportRunReport(conn: Conn, opts: ExportRunReportOptions): Promise<ExportRunReportResponse> {
  return conn.post("/export/run_report", opts) as Promise<ExportRunReportResponse>;
}

// ─── V0.4C — Align link edit API ─────────────────────────────────────────────

export async function updateAlignLinkStatus(conn: Conn, opts: AlignLinkUpdateStatusOptions): Promise<{ link_id: number; status: string | null; updated: number }> {
  return conn.post("/align/link/update_status", opts) as Promise<{ link_id: number; status: string | null; updated: number }>;
}

export async function deleteAlignLink(conn: Conn, opts: AlignLinkDeleteOptions): Promise<{ link_id: number; deleted: number }> {
  return conn.post("/align/link/delete", opts) as Promise<{ link_id: number; deleted: number }>;
}

export async function retargetAlignLink(conn: Conn, opts: AlignLinkRetargetOptions): Promise<{ link_id: number; new_target_unit_id: number; updated: number }> {
  return conn.post("/align/link/retarget", opts) as Promise<{ link_id: number; new_target_unit_id: number; updated: number }>;
}

// ─── V0.5 — Job enqueue / cancel / list ──────────────────────────────────────

export async function enqueueJob(
  conn: Conn,
  kind: string,
  params: Record<string, unknown> = {}
): Promise<JobRecord> {
  const res = (await conn.post("/jobs/enqueue", { kind, params })) as {
    job: JobRecord;
    status: string;
  };
  return res.job;
}

export async function cancelJob(conn: Conn, jobId: string): Promise<void> {
  await conn.post(`/jobs/${jobId}/cancel`, {});
}

export async function listJobs(
  conn: Conn,
  opts: { status?: string; limit?: number; offset?: number } = {}
): Promise<{ jobs: JobRecord[]; total: number; has_more: boolean }> {
  const p = new URLSearchParams();
  if (opts.status) p.set("status", opts.status);
  if (opts.limit !== undefined) p.set("limit", String(opts.limit));
  if (opts.offset !== undefined) p.set("offset", String(opts.offset));
  const qs = p.size > 0 ? `?${p.toString()}` : "";
  return conn.get(`/jobs${qs}`) as Promise<{
    jobs: JobRecord[];
    total: number;
    has_more: boolean;
  }>;
}

// ─── V1.1 — Align quality ─────────────────────────────────────────────────────

export interface AlignQualityStats {
  total_pivot_units: number;
  total_target_units: number;
  total_links: number;
  covered_pivot_units: number;
  covered_target_units: number;
  coverage_pct: number;
  orphan_pivot_count: number;
  orphan_target_count: number;
  collision_count: number;
  status_counts: { unreviewed: number; accepted: number; rejected: number };
}

export interface AlignQualityOrphan {
  unit_id: number;
  external_id: number | null;
  text: string | null;
}

export interface AlignQualityResponse {
  pivot_doc_id: number;
  target_doc_id: number;
  run_id: string | null;
  stats: AlignQualityStats;
  sample_orphan_pivot: AlignQualityOrphan[];
  sample_orphan_target: AlignQualityOrphan[];
}

export async function alignQuality(
  conn: Conn,
  pivot_doc_id: number,
  target_doc_id: number,
  run_id?: string
): Promise<AlignQualityResponse> {
  const body: Record<string, unknown> = { pivot_doc_id, target_doc_id };
  if (run_id) body.run_id = run_id;
  return conn.post("/align/quality", body) as Promise<AlignQualityResponse>;
}

export async function shutdownSidecar(conn: Conn): Promise<void> {
  try { await conn.post("/shutdown", {}); } catch { /* best-effort */ }
  _conn = null;
  _spawnedChild = null;
}

export function resetConnection(): void {
  _conn = null;
}
