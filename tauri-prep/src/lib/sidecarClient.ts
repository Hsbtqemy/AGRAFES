/**
 * sidecarClient.ts — Persistent sidecar HTTP client for ConcordancierPrep V0.
 *
 * Same portfile / spawn / token pattern as tauri-app, extended with:
 *  - listDocuments()  → GET /documents
 *  - curate()         → POST /curate
 *  - segment()        → POST /segment
 *  - align()          → POST /align
 *  - validateMeta()   → POST /validate-meta
 *  - annotate()       → POST /annotate (async job accepted)
 *  - getJob()         → GET /jobs/<id>
 */

import { Command, type Child } from "@tauri-apps/plugin-shell";
import { exists } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { resolveResource } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

/** Force le flush immédiat du pipe stdout sous Windows (évite les blocages). */
const SIDECAR_SPAWN_OPTIONS = {
  env: { PYTHONUNBUFFERED: "1" },
};

function utf8DecodeStream(chunk: Uint8Array, decoder: TextDecoder): string {
  return decoder.decode(chunk, { stream: true });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocumentRecord {
  doc_id: number;
  title: string;
  language: string;
  doc_role: string | null;
  resource_type: string | null;
  workflow_status?: "draft" | "review" | "validated";
  validated_at?: string | null;
  validated_run_id?: string | null;
  /** Absolute path recorded at import (for duplicate detection in Prep). */
  source_path?: string | null;
  /** SHA-256 hex of source file at import. */
  source_hash?: string | null;
  /** Number of token rows available for this document. */
  token_count?: number;
  /** Lightweight annotation state derived from token presence. */
  annotation_status?: "missing" | "annotated";
  author_lastname?: string | null;
  author_firstname?: string | null;
  /** Free-form date string: "2024", "2024-03", "2024-03-15", etc. */
  doc_date?: string | null;
  translator_lastname?: string | null;
  translator_firstname?: string | null;
  /** Titre de l'œuvre (identique VO et traduction, ex. "Les Misérables"). */
  work_title?: string | null;
  /** Lieu de publication (ex. "Paris"). */
  pub_place?: string | null;
  /** Éditeur / édition (ex. "Gallimard"). */
  publisher?: string | null;
  unit_count: number;
  /** First unit n that belongs to the main text (units with n < text_start_n are paratext). Null = no boundary. */
  text_start_n?: number | null;
}

export interface DocumentPreviewLine {
  unit_id: number;
  n: number;
  external_id?: number | null;
  text: string;
  text_raw?: string | null;
  unit_role?: string | null;
}

export interface DocumentPreviewResponse {
  ok: boolean;
  doc: DocumentRecord;
  lines: DocumentPreviewLine[];
  count: number;
  total_lines: number;
  limit: number;
}

const _HI_RE = /<hi\b([^>]*)>(.*?)<\/hi>/gs;
const _REND_RE = /\brend=["']([^"']*)["']/;

/**
 * Convert text_raw <hi rend="…"> markup to safe HTML for display.
 * Falls back to escaping text_norm if text_raw is absent or plain.
 *
 * text_raw is already XML-escaped by the importer (& → &amp; etc.), so
 * text segments are injected directly — no double-escaping. Only the
 * <hi> wrapper tags are replaced by semantic HTML equivalents.
 *
 * Supported rend tokens: italic → <em>, bold → <strong>,
 * underline → <u>, strikethrough → <s>, superscript → <sup>, subscript → <sub>.
 */
export function richTextToHtml(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.includes("<hi")) return _esc(fallback);
  let result = "";
  let last = 0;
  let m: RegExpExecArray | null;
  _HI_RE.lastIndex = 0;
  while ((m = _HI_RE.exec(raw)) !== null) {
    // text_raw segments are already XML-escaped — inject as-is
    result += raw.slice(last, m.index);
    const rend = (_REND_RE.exec(m[1]) ?? [])[1] ?? "";
    const tokens = rend.split(/\s+/).filter(Boolean);
    const content = m[2]; // already XML-escaped
    result += _wrapHiTokens(tokens, content);
    last = m.index + m[0].length;
  }
  result += raw.slice(last);
  return result;
}

function _esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _wrapHiTokens(tokens: string[], content: string): string {
  const _MAP: Record<string, [string, string]> = {
    italic:        ["<em>",     "</em>"],
    bold:          ["<strong>", "</strong>"],
    underline:     ["<u>",      "</u>"],
    strikethrough: ["<s>",      "</s>"],
    superscript:   ["<sup>",    "</sup>"],
    subscript:     ["<sub>",    "</sub>"],
  };
  let open = "", close = "";
  for (const tok of tokens) {
    const pair = _MAP[tok];
    if (pair) { open += pair[0]; close = pair[1] + close; }
  }
  return open + content + close;
}

export interface TokenRecord {
  token_id: number;
  doc_id: number;
  unit_id: number;
  unit_n: number;
  external_id: number | null;
  sent_id: number;
  position: number;
  word: string | null;
  lemma: string | null;
  upos: string | null;
  xpos: string | null;
  feats: string | null;
  misc: string | null;
}

export interface TokensListOptions {
  doc_id: number;
  unit_id?: number;
  limit?: number;
  offset?: number;
}

export interface TokensListResponse {
  ok: boolean;
  doc_id: number;
  unit_id?: number | null;
  tokens: TokenRecord[];
  count: number;
  total: number;
  limit: number;
  offset: number;
  next_offset: number | null;
  has_more: boolean;
}

export interface TokenUpdateOptions {
  token_id: number;
  word?: string | null;
  lemma?: string | null;
  upos?: string | null;
  xpos?: string | null;
  feats?: string | null;
  misc?: string | null;
}

/** Métadonnées corpus (table `corpus_info`, une ligne par base). */
export interface CorpusInfoRecord {
  title: string | null;
  description: string | null;
  meta: Record<string, unknown>;
  updated_at: string | null;
}

export interface AuditMissingFieldsEntry {
  doc_id: number;
  title: string;
  missing: string[];
}
export interface AuditEmptyDocEntry {
  doc_id: number;
  title: string;
}
export interface AuditDuplicateHashEntry {
  hash_prefix: string;
  doc_ids: number[];
}
export interface AuditDuplicateFilenameEntry {
  filename: string;
  doc_ids: number[];
}
export interface AuditDuplicateTitleEntry {
  title: string;
  doc_ids: number[];
}
// ── Sprint 4 — Family audit types ─────────────────────────────────────────

export interface FamilyAuditEntry {
  parent_id: number;
  parent_title: string;
  child_id: number;
  child_title: string;
  child_lang: string;
  relation_type: string;
}
export interface FamilyAuditOrphan extends FamilyAuditEntry {
  issue: string;
}
export interface FamilyAuditUnsegmented extends FamilyAuditEntry {
  child_segmented: boolean;
  parent_segmented: boolean;
}
export interface FamilyAuditUnaligned extends FamilyAuditEntry {
  parent_segs: number;
  child_segs: number;
}
export interface FamilyAuditRatioWarning extends FamilyAuditEntry {
  parent_segs: number;
  child_segs: number;
  ratio_pct: number;
}
export interface FamilyAuditData {
  ratio_threshold_pct: number;
  total_family_issues: number;
  orphan_docs: FamilyAuditOrphan[];
  unsegmented_children: FamilyAuditUnsegmented[];
  unaligned_pairs: FamilyAuditUnaligned[];
  ratio_warnings: FamilyAuditRatioWarning[];
}

export interface CorpusAuditResult {
  total_docs: number;
  total_issues: number;
  missing_fields: AuditMissingFieldsEntry[];
  empty_documents: AuditEmptyDocEntry[];
  duplicate_hashes: AuditDuplicateHashEntry[];
  duplicate_filenames: AuditDuplicateFilenameEntry[];
  duplicate_titles: AuditDuplicateTitleEntry[];
  families: FamilyAuditData;
}

// ---------------------------------------------------------------------------
// Segment preview (in-memory, no DB writes)
// ---------------------------------------------------------------------------
export interface SegmentPreviewSegment {
  n: number;
  text: string;
  source_unit_n: number;
  external_id?: number | null;
}

export interface SegmentPreviewResponse {
  ok: boolean;
  doc_id: number;
  mode: "sentences" | "markers";
  units_input: number;
  units_output: number;
  segment_pack: string;
  segments: SegmentPreviewSegment[];
  warnings: string[];
  calibrate_to?: number | null;
  calibrate_ratio_pct?: number | null;
}

export async function segmentPreview(
  conn: Conn,
  opts: {
    doc_id: number;
    mode?: "sentences" | "markers";
    lang?: string;
    pack?: string;
    limit?: number;
    calibrate_to?: number;
  },
): Promise<SegmentPreviewResponse> {
  return conn.post("/segment/preview", opts) as Promise<SegmentPreviewResponse>;
}

// ---------------------------------------------------------------------------
// Marker detection (read-only scan)
// ---------------------------------------------------------------------------
export interface DetectMarkersResponse {
  ok: boolean;
  doc_id: number;
  detected: boolean;
  total_units: number;
  marked_units: number;
  marker_ratio: number;
  sample: { n: number; text: string }[];
  first_markers: number[];
}

export async function detectMarkers(
  conn: Conn,
  doc_id: number,
): Promise<DetectMarkersResponse> {
  return conn.post("/segment/detect_markers", { doc_id }) as Promise<DetectMarkersResponse>;
}

export interface StructureSection {
  n: number;
  text: string;
  role: string | null;
  line_count: number;
}

export interface StructureSectionsResponse {
  ok: boolean;
  doc_id: number;
  reference_doc_id: number;
  ref_sections: StructureSection[];
  target_sections: StructureSection[];
}

export async function structureSections(
  conn: Conn,
  doc_id: number,
  reference_doc_id: number,
): Promise<StructureSectionsResponse> {
  return conn.post("/segment/structure_sections", { doc_id, reference_doc_id }) as Promise<StructureSectionsResponse>;
}

export interface StructureDiffSection {
  status: "matched" | "missing_in_target" | "extra_in_target";
  ref_n: number | null;
  ref_text: string | null;
  ref_role: string | null;
  target_n: number | null;
  target_text: string | null;
  target_role: string | null;
  ref_line_count: number;
  target_line_count: number;
}

export interface StructureDiffResponse {
  ok: boolean;
  doc_id: number;
  reference_doc_id: number;
  sections: StructureDiffSection[];
  ref_structure_count: number;
  target_structure_count: number;
  matched_count: number;
  missing_count: number;
  extra_count: number;
  no_structure?: boolean;
}

export async function structureDiff(
  conn: Conn,
  doc_id: number,
  reference_doc_id: number,
): Promise<StructureDiffResponse> {
  return conn.post("/segment/structure_diff", { doc_id, reference_doc_id }) as Promise<StructureDiffResponse>;
}

export interface PropagateSectionSegment {
  n: number;
  text: string;
}

export interface PropagateSection {
  status: "pre" | "matched" | "extra_in_target" | "missing_in_target";
  header_text: string | null;
  header_role: string | null;
  ref_count: number;
  raw_count: number;
  result_count: number;
  adjusted: boolean;
  delta: number;
  segments: PropagateSectionSegment[];
}

export interface PropagatePreviewResponse {
  ok: boolean;
  doc_id: number;
  reference_doc_id: number;
  sections: PropagateSection[];
  total_segments: number;
  warnings: string[];
  segment_pack: string;
}

export async function segmentPropagatePreview(
  conn: Conn,
  opts: { doc_id: number; reference_doc_id: number; lang?: string; pack?: string; section_mapping?: [number, number][] },
): Promise<PropagatePreviewResponse> {
  return conn.post("/segment/propagate_preview", opts) as Promise<PropagatePreviewResponse>;
}

export interface ZoneLine {
  n: number;
  text: string;
}

export interface ZoneLinesResponse {
  ok: boolean;
  doc_id: number;
  lines: ZoneLine[];
}

export async function zoneLines(
  conn: Conn,
  doc_id: number,
  from_n: number | null,
  to_n: number | null,
): Promise<ZoneLinesResponse> {
  return conn.post("/segment/zone_lines", { doc_id, from_n, to_n }) as Promise<ZoneLinesResponse>;
}

export interface InsertStructureUnitResponse {
  ok: boolean;
  doc_id: number;
  inserted_n: number;
  text: string;
}

export interface ApplyPropagatedUnit {
  type: "line" | "structure";
  text: string;
  role?: string;
}

export interface ApplyPropagatedResponse {
  ok: boolean;
  doc_id: number;
  units_written: number;
  fts_stale: boolean;
}

export async function applyPropagated(
  conn: Conn,
  doc_id: number,
  units: ApplyPropagatedUnit[],
): Promise<ApplyPropagatedResponse> {
  return conn.post("/segment/apply_propagated", { doc_id, units }) as Promise<ApplyPropagatedResponse>;
}

export interface DeleteStructureUnitResponse {
  ok: boolean;
  doc_id: number;
  deleted_n: number;
  text: string;
}

export async function deleteStructureUnit(
  conn: Conn,
  doc_id: number,
  n: number,
): Promise<DeleteStructureUnitResponse> {
  return conn.post("/segment/delete_structure_unit", { doc_id, n }) as Promise<DeleteStructureUnitResponse>;
}

export async function insertStructureUnit(
  conn: Conn,
  doc_id: number,
  before_n: number,
  text: string,
  role?: string,
): Promise<InsertStructureUnitResponse> {
  return conn.post("/segment/insert_structure_unit", { doc_id, before_n, text, role }) as Promise<InsertStructureUnitResponse>;
}

// ---------------------------------------------------------------------------
// Unit editing — merge and split
// ---------------------------------------------------------------------------

export interface UnitsMergeResponse {
  ok: boolean;
  doc_id: number;
  merged_n: number;
  deleted_n: number;
  text: string;
}

export async function mergeUnits(
  conn: Conn,
  opts: { doc_id: number; n1: number; n2: number },
): Promise<UnitsMergeResponse> {
  return conn.post("/units/merge", opts) as Promise<UnitsMergeResponse>;
}

export interface UnitsSplitResponse {
  ok: boolean;
  doc_id: number;
  unit_n: number;
  new_unit_n: number;
  text_a: string;
  text_b: string;
}

export async function splitUnit(
  conn: Conn,
  opts: { doc_id: number; unit_n: number; text_a: string; text_b: string },
): Promise<UnitsSplitResponse> {
  return conn.post("/units/split", opts) as Promise<UnitsSplitResponse>;
}

// ---------------------------------------------------------------------------

export interface ImportOptions {
  mode:
    | "docx_numbered_lines"
    | "txt_numbered_lines"
    | "docx_paragraphs"
    | "odt_paragraphs"
    | "odt_numbered_lines"
    | "tei"
    | "conllu";
  path: string;
  language?: string;
  title?: string;
  doc_role?: string;
  resource_type?: string;
  tei_unit?: "p" | "s";
  check_filename?: boolean;
  /** When set, creates a translation_of relation to this parent after import. */
  family_root_doc_id?: number;
}

export interface ImportResponse {
  ok: boolean;
  doc_id: number;
  units_line?: number;
  units_total?: number;
  /** True when a translation_of relation was freshly inserted. */
  relation_created?: boolean;
  /** Id of the doc_relations row (new or pre-existing). */
  relation_id?: number;
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
  /** If true, clear previous links for this pivot↔target scope before re-running alignment. */
  replace_existing?: boolean;
  /**
   * With replace_existing=true, keep already accepted links and treat them as protected.
   * Defaults to true on server side.
   */
  preserve_accepted?: boolean;
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
  replace_existing?: boolean;
  preserve_accepted?: boolean;
  deleted_before?: number;
  preserved_before?: number;
  total_links_created?: number;
  total_effective_links?: number;
  reports: AlignReport[];
}

// ─── Curate Preview types ─────────────────────────────────────────────────────

export interface CuratePreviewOptions {
  doc_id: number;
  rules: CurateRule[];
  limit_examples?: number;
  /**
   * Level 8C: when provided, this unit_id is guaranteed to appear in examples
   * even if it would normally be beyond limit_examples, has a persistent 'ignore'
   * exception, or produces no diff.  The example is annotated with `preview_reason`.
   */
  force_unit_id?: number;
}

export interface CuratePreviewExample {
  unit_id: number;
  external_id: number | null;
  before: string;
  after: string;
  /** Indices (0-based) into the rules array that caused this unit to change. */
  matched_rule_ids?: number[];
  /**
   * Client-side editorial status — never sent by the server, never persisted.
   * Reserved for Level 3 local review workflow.
   * Default (absent) is implicitly "pending".
   */
  status?: "pending" | "accepted" | "ignored";
  /**
   * 0-based position of this unit in the document's unit list (ordered by n).
   * Sent by the server since Level 3C.
   */
  unit_index?: number;
  /**
   * text_norm of the immediately preceding unit (trimmed to 300 chars).
   * null/absent when this unit is the first in the document.
   */
  context_before?: string | null;
  /**
   * text_norm of the immediately following unit (trimmed to 300 chars).
   * null/absent when this unit is the last in the document.
   */
  context_after?: string | null;
  /**
   * User-supplied replacement text for this unit's result (client-side only, never from server).
   * When set, overrides the server's `after` both in the UI and at apply time.
   * null / absent = no override (use server's `after`).
   */
  manual_after?: string | null;
  /**
   * True when the user has entered a manual override for this unit.
   * Client-side only — never sent to or read from the server.
   */
  is_manual_override?: boolean;
  /**
   * True when the server signals that this unit has a persistent 'ignore' exception
   * in curation_exceptions (Level 7B).  Set from the server's example payload
   * when is_exception_override is absent and the unit appears in the exception map.
   * For ignore exceptions the unit is excluded from examples — this flag is
   * populated client-side after loading the exceptions list.
   */
  is_exception_ignored?: boolean;
  /**
   * When the server signals that this unit has a persistent 'override' exception
   * (curation_exceptions.kind = 'override'), this field holds the stored text.
   * The server includes is_exception_override = true in the example payload.
   */
  exception_override?: string;
  /**
   * Set by the server on examples generated from a persistent 'override' exception
   * (Level 7B).  When true, the "after" value is the persisted override_text, not
   * the automatic rule result.
   */
  is_exception_override?: boolean;
  /**
   * Level 8C: why this example is present in the preview.
   *   "standard"        — normal inclusion within limit_examples
   *   "forced"          — unit was requested via force_unit_id and is a normal diff
   *   "forced_ignored"  — unit was requested but has a persistent 'ignore' exception;
   *                       included for inspection only; changes are NOT applied
   *   "forced_no_change"— unit was requested but produces no diff with current rules
   */
  preview_reason?: "standard" | "forced" | "forced_ignored" | "forced_no_change";
}

/**
 * A persistent local curation exception stored in curation_exceptions (Level 7B).
 */
export interface CurateException {
  id: number;
  unit_id: number;
  kind: "ignore" | "override";
  override_text: string | null;
  note: string | null;
  created_at: string;
  /** Enriched by Level 8A — may be absent on very old sidecar versions. */
  doc_id?: number;
  doc_title?: string | null;
  unit_text?: string | null;
}

export interface CuratePreviewStats {
  units_total: number;
  units_changed: number;
  replacements_total: number;
  /** Number of units silenced by a persistent 'ignore' exception (Level 7B). */
  units_exception_ignored?: number;
}

export interface CuratePreviewResponse {
  ok: boolean;
  doc_id: number;
  stats: CuratePreviewStats;
  examples: CuratePreviewExample[];
  /** Total number of active exceptions for this document (Level 7B). */
  exceptions_active?: number;
  /**
   * Level 8C: when force_unit_id was supplied, indicates whether that unit
   * was found in the document and injected into examples.
   */
  forced_unit_found?: boolean | null;
  fts_stale: boolean;
}

// ─── Align Audit types ────────────────────────────────────────────────────────

export interface AlignExplain {
  strategy: string;
  notes: string[];
}

export interface AlignAuditOptions {
  pivot_doc_id: number;
  target_doc_id: number;
  limit?: number;
  offset?: number;
  external_id?: number;
  status?: "accepted" | "rejected" | "unreviewed";
  /** V1.2: attach explain object (strategy + notes) to each link */
  include_explain?: boolean;
}

export interface AlignLinkRecord {
  link_id: number;
  external_id: number | null;
  pivot_unit_id: number;
  target_unit_id: number;
  pivot_text: string;
  target_text: string;
  status: "accepted" | "rejected" | null;
  /** Present when include_explain=true */
  explain?: AlignExplain;
}

// ─── V0.4A — Metadata types ───────────────────────────────────────────────────

export interface DocumentUpdateOptions {
  doc_id: number;
  title?: string;
  language?: string;
  doc_role?: string;
  resource_type?: string;
  workflow_status?: "draft" | "review" | "validated";
  validated_run_id?: string | null;
  author_lastname?: string | null;
  author_firstname?: string | null;
  doc_date?: string | null;
  translator_lastname?: string | null;
  translator_firstname?: string | null;
  /** Titre de l'œuvre (identique VO et traduction, ex. "Les Misérables"). */
  work_title?: string | null;
  /** Lieu de publication (ex. "Paris"). */
  pub_place?: string | null;
  /** Éditeur / édition (ex. "Gallimard"). */
  publisher?: string | null;
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

export interface DbBackupOptions {
  out_dir?: string;
  /** Exact destination path (e.g. /path/to/corpus.db). Mutually exclusive with out_dir. Returns 409 if file exists. */
  out_path?: string;
}

export interface DbBackupResponse {
  ok: boolean;
  source_db_path: string;
  backup_path: string;
  file_size_bytes: number;
  created_at: string;
}

// ─── V0.4B — Export types ─────────────────────────────────────────────────────

export interface ExportTeiOptions {
  out_dir: string;
  doc_ids?: number[];
  /** Emit <head> elements for structure units in addition to body units. Default false. */
  include_structure?: boolean;
  /** Filter listRelation output: none|translation_of|excerpt_of|all. */
  relation_type?: "none" | "translation_of" | "excerpt_of" | "all";
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

export interface AlignLinkCreateOptions {
  pivot_unit_id: number;
  target_unit_id: number;
  status?: "accepted" | "rejected" | null;
}

export interface AlignLinkCreateResponse {
  link_id: number;
  pivot_unit_id: number;
  target_unit_id: number;
  pivot_doc_id: number;
  target_doc_id: number;
  status: "accepted" | "rejected" | null;
  created: number;
}

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

export interface AnnotateOptions {
  doc_id?: number;
  all_docs?: boolean;
  model?: string;
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
  put(path: string, body: unknown): Promise<unknown>;
}

// ─── Internal state ───────────────────────────────────────────────────────────

let _conn: Conn | null = null;
let _connDbPath: string | null = null;
let _spawnedChild: Child | null = null;
const SIDECAR_PROGRAM = "multicorpus";
const SPAWN_TOKEN_PORTFILE_RETRY_COUNT = 8;
const SPAWN_TOKEN_PORTFILE_RETRY_DELAY_MS = 150;
const IS_WINDOWS_RUNTIME =
  typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
const SIDECAR_HEALTH_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 45000 : 15000;
const SIDECAR_HEALTH_INITIAL_DELAY_MS = IS_WINDOWS_RUNTIME ? 1200 : 0;
const SIDECAR_HEALTH_POLL_INTERVAL_MS = 350;
const SIDECAR_STARTUP_JSON_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 90000 : 12000;
type LoopbackHttpBackendMode = "auto" | "global_this_only" | "tauri_only";
// "tauri_only": bypasses globalThis.fetch for loopback (avoids WebView2 mixed-content
// hang when fetching http:// from https://tauri.localhost). reqwest/WinHTTP natively
// bypasses system proxy for loopback — no proxy issue on machines with or without proxy.
const SIDECAR_LOOPBACK_HTTP_BACKEND_MODE: LoopbackHttpBackendMode = "tauri_only";
const SIDECAR_GLOBAL_FETCH_TIMEOUT_MS = IS_WINDOWS_RUNTIME ? 1200 : 1500;
type SidecarFetchInit = Parameters<typeof tauriFetch>[1] & RequestInit;

// ─── Helpers ─────────────────────────────────────────────────────────────────

type SidecarLogLevel = "info" | "warn" | "error";

function sidecarLog(level: SidecarLogLevel, message: string, detail?: unknown): void {
  const prefix = `[prep-sidecar ${new Date().toISOString()}] ${message}`;
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

function headersToRecord(
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

function errToString(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ─── Loopback helpers ─────────────────────────────────────────────────────────

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

async function sidecarFetch(url: string, init?: SidecarFetchInit): Promise<Response> {
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

// ─── Sidecar path diagnostic ──────────────────────────────────────────────────

function expectedSidecarResourceName(): string {
  if (IS_WINDOWS_RUNTIME) {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isArm64 = /\b(arm64|aarch64)\b/i.test(ua);
    const triple = isArm64 ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    return `${SIDECAR_PROGRAM}-${triple}.exe`;
  }
  return SIDECAR_PROGRAM;
}

async function resolveExpectedSidecarPathForLogs(): Promise<string | null> {
  try {
    return await resolveResource(expectedSidecarResourceName());
  } catch {
    return null;
  }
}

function parseStartupPort(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

function parseToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function portfilePath(dbPath: string): string {
  const sep = dbPath.includes("/") ? "/" : "\\";
  const dir = dbPath.includes(sep)
    ? dbPath.substring(0, dbPath.lastIndexOf(sep))
    : ".";
  return `${dir}${sep}.agrafes_sidecar.json`;
}

async function readPortfile(portfile: string): Promise<Record<string, unknown> | null> {
  try {
    // Use the raw Rust command to bypass Tauri FS scope restrictions.
    // Portfiles live next to the user's DB file which can be anywhere on disk.
    const raw = await invoke<string>("read_text_file_raw", { path: portfile });
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface PollHealthOptions {
  maxMs?: number;
  initialDelayMs?: number;
  intervalMs?: number;
  perAttemptTimeoutMs?: number;
}

async function pollHealth(baseUrl: string, options: PollHealthOptions = {}): Promise<boolean> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function _rawPost(url: string, token: string | null, path: string, body: unknown): Promise<unknown> {
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
    const msg =
      (json.error_message as string) ||
      (json.error as string) ||
      `HTTP ${res.status}`;
    throw new SidecarError(msg, res.status);
  }
  return json;
}

async function _rawPut(url: string, token: string | null, path: string, body: unknown): Promise<unknown> {
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
    const msg =
      (json.error_message as string) ||
      (json.error as string) ||
      `HTTP ${res.status}`;
    throw new SidecarError(msg, res.status);
  }
  return json;
}

async function _rawGet(url: string, token: string | null, path: string): Promise<unknown> {
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

function makeConn(baseUrl: string, token: string | null): Conn {
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

// ─── Public error class ───────────────────────────────────────────────────────

export class SidecarError extends Error {
  constructor(message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "SidecarError";
  }
}

// ─── Core: ensureRunning ──────────────────────────────────────────────────────

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

async function _spawnSidecar(dbPath: string): Promise<Conn> {
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
  _notifyRustRegistry(_conn);
  return _conn;
}

function _readFirstJsonFromCommand(command: {
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

// ─── API methods ─────────────────────────────────────────────────────────────

export async function getHealth(conn: Conn): Promise<HealthInfo> {
  return conn.get("/health") as Promise<HealthInfo>;
}

export async function listDocuments(conn: Conn): Promise<DocumentRecord[]> {
  const res = (await conn.get("/documents")) as { documents: DocumentRecord[] };
  return res.documents;
}

/** A single text unit (line) returned by GET /units. */
export interface UnitRecord {
  unit_id: number;
  n: number;
  text_norm: string | null;
  unit_type: string;
  unit_role: string | null;
}

/**
 * Returns all units for a document (all unit_types), ordered by n.
 * No pagination — use for moderate-sized documents (≤ tens of thousands of lines).
 */
export async function listUnits(conn: Conn, docId: number): Promise<UnitRecord[]> {
  const res = await conn.get(
    `/units?doc_id=${encodeURIComponent(String(docId))}`,
  ) as { units: UnitRecord[]; count: number; doc_id: number };
  return res.units;
}

/** A convention role (unit_role) as returned by GET /conventions. */
export interface ConventionRole {
  name: string;
  label: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
}

/** Returns all convention roles defined for this corpus, ordered by sort_order. */
export async function listConventions(conn: Conn): Promise<ConventionRole[]> {
  const res = await conn.get("/conventions") as { conventions: ConventionRole[] };
  return res.conventions;
}

/** Create a new convention role. Throws on name conflict (409). */
export async function createConvention(
  conn: Conn,
  options: { name: string; label: string; color?: string; icon?: string; sort_order?: number },
): Promise<ConventionRole> {
  const res = await conn.post("/conventions", options) as { convention: ConventionRole };
  return res.convention;
}

/** Update label, color, icon or sort_order of an existing convention. */
export async function updateConvention(
  conn: Conn,
  name: string,
  patch: { label?: string; color?: string; icon?: string; sort_order?: number },
): Promise<ConventionRole> {
  const res = await conn.put(`/conventions/${encodeURIComponent(name)}`, patch) as { convention: ConventionRole };
  return res.convention;
}

/** Delete a convention role. Assigned units lose their role (set to NULL). */
export async function deleteConvention(
  conn: Conn,
  name: string,
): Promise<{ deleted: string }> {
  return conn.post("/conventions/delete", { name }) as Promise<{ deleted: string }>;
}

/**
 * Assigns (or clears) a convention role on one or more units.
 * Pass role=null to clear the role.
 */
export async function bulkSetRole(
  conn: Conn,
  docId: number,
  unitNs: number[],
  role: string | null,
): Promise<{ updated: number }> {
  return conn.post("/units/bulk_set_role", {
    doc_id: docId,
    unit_ns: unitNs,
    role: role ?? "",
  }) as Promise<{ updated: number }>;
}

/**
 * Set (or clear) the paratextual boundary for a document.
 * textStartN — 1-based unit n where actual text begins; null to clear.
 */
export async function setTextStart(
  conn: Conn,
  docId: number,
  textStartN: number | null,
): Promise<{ updated: number }> {
  return conn.post("/documents/set_text_start", {
    doc_id: docId,
    text_start_n: textStartN,
  }) as Promise<{ updated: number }>;
}

export async function getDocumentPreview(
  conn: Conn,
  doc_id: number,
  limit = 6
): Promise<DocumentPreviewResponse> {
  const qs = new URLSearchParams({
    doc_id: String(doc_id),
    limit: String(limit),
  });
  return conn.get(`/documents/preview?${qs.toString()}`) as Promise<DocumentPreviewResponse>;
}

export async function listTokens(
  conn: Conn,
  opts: TokensListOptions,
): Promise<TokensListResponse> {
  const qs = new URLSearchParams({
    doc_id: String(opts.doc_id),
    limit: String(opts.limit ?? 200),
    offset: String(opts.offset ?? 0),
  });
  if (opts.unit_id !== undefined) qs.set("unit_id", String(opts.unit_id));
  return conn.get(`/tokens?${qs.toString()}`) as Promise<TokensListResponse>;
}

export async function updateToken(
  conn: Conn,
  opts: TokenUpdateOptions,
): Promise<{ updated: number; token: TokenRecord }> {
  return conn.post("/tokens/update", opts) as Promise<{ updated: number; token: TokenRecord }>;
}

export async function getCorpusInfo(conn: Conn): Promise<CorpusInfoRecord> {
  const res = (await conn.get("/corpus/info")) as { corpus: CorpusInfoRecord };
  return res.corpus;
}

export async function updateCorpusInfo(
  conn: Conn,
  patch: {
    title?: string | null;
    description?: string | null;
    meta?: Record<string, unknown> | null;
  },
): Promise<CorpusInfoRecord> {
  const res = (await conn.post("/corpus/info", patch)) as { corpus: CorpusInfoRecord };
  return res.corpus;
}

export async function getCorpusAudit(
  conn: Conn,
  ratioThresholdPct = 15,
): Promise<CorpusAuditResult> {
  return conn.get(
    `/corpus/audit?ratio_threshold_pct=${ratioThresholdPct}`,
  ) as Promise<CorpusAuditResult>;
}

export async function importFile(conn: Conn, opts: ImportOptions): Promise<ImportResponse> {
  return conn.post("/import", opts) as Promise<ImportResponse>;
}

// ─── Import preview ───────────────────────────────────────────────────────────

export interface ConlluPreviewRow {
  sent: number;
  id: string;
  form: string;
  lemma: string;
  upos: string;
}

export interface ConlluStats {
  sentences: number;
  tokens: number;
  skipped_ranges: number;
  skipped_empty_nodes: number;
  malformed_lines: number;
  sample_rows: ConlluPreviewRow[];
}

export interface ImportPreviewUnit {
  n: number;
  external_id: string | number | null;
  unit_type: string;
  text_raw: string;
}

export interface ImportPreviewResponse {
  mode: string;
  conllu_stats: ConlluStats | null;
  // text-mode fields (DOCX / ODT / TXT / TEI)
  units?: ImportPreviewUnit[];
  units_total?: number;
  truncated?: boolean;
}

export async function previewImport(
  conn: Conn,
  opts: { path: string; mode: string; limit?: number },
): Promise<ImportPreviewResponse> {
  return conn.post("/import/preview", opts) as Promise<ImportPreviewResponse>;
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

export async function annotate(
  conn: Conn,
  opts: AnnotateOptions
): Promise<JobRecord> {
  const res = (await conn.post("/annotate", opts)) as {
    job: JobRecord;
    status: string;
  };
  return res.job;
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

export async function deleteDocuments(conn: Conn, docIds: number[]): Promise<{ deleted: number; doc_ids: number[] }> {
  return conn.post("/documents/delete", { doc_ids: docIds }) as Promise<{ deleted: number; doc_ids: number[] }>;
}

export async function getDocRelations(conn: Conn, doc_id: number): Promise<DocRelationsResponse> {
  return conn.get(`/doc_relations?doc_id=${doc_id}`) as Promise<DocRelationsResponse>;
}

export async function getAllDocRelations(conn: Conn): Promise<DocRelationRecord[]> {
  const res = (await conn.get("/doc_relations/all")) as { relations: DocRelationRecord[] };
  return res.relations;
}

export interface FamilyChildEntry {
  doc_id: number;
  relation_type: string;
  doc: DocumentRecord | null;
  segmented: boolean;
  seg_count: number;
  aligned_to_parent: boolean;
}

export interface FamilyRatioWarning {
  child_doc_id: number;
  parent_segs: number;
  child_segs: number;
  ratio_pct: number;
}

export interface FamilyStats {
  total_docs: number;
  segmented_docs: number;
  parent_seg_count: number;
  aligned_pairs: number;
  total_pairs: number;
  validated_docs: number;
  completion_pct: number;
  ratio_warnings: FamilyRatioWarning[];
}

export interface FamilyRecord {
  family_id: number;
  parent: DocumentRecord | null;
  children: FamilyChildEntry[];
  stats: FamilyStats;
}

export async function getFamilies(conn: Conn): Promise<FamilyRecord[]> {
  const res = (await conn.get("/families")) as { families: FamilyRecord[] };
  return res.families;
}

// ─── Sprint 2 — Segmentation famille ─────────────────────────────────────────

export interface FamilySegmentOptions {
  pack?: "auto" | "default" | "fr_strict" | "en_strict";
  /** Re-segment even already-segmented docs */
  force?: boolean;
  /** Per-doc language override: { [doc_id]: lang } */
  lang_map?: Record<string, string>;
}

export interface FamilySegmentDocResult {
  doc_id: number;
  status: "segmented" | "skipped" | "error";
  units_input: number;
  units_output: number;
  segment_pack: string | null;
  warnings: string[];
  calibrate_ratio_pct?: number;
}

export interface FamilySegmentSummary {
  total: number;
  segmented: number;
  skipped: number;
  errors: number;
}

export interface FamilySegmentResponse {
  family_root_id: number;
  fts_stale: boolean;
  results: FamilySegmentDocResult[];
  summary: FamilySegmentSummary;
}

export async function segmentFamily(
  conn: Conn,
  familyRootId: number,
  opts: FamilySegmentOptions = {},
): Promise<FamilySegmentResponse> {
  return conn.post(
    `/families/${familyRootId}/segment`,
    opts,
  ) as Promise<FamilySegmentResponse>;
}

// ─── Sprint 3 — Alignement famille ───────────────────────────────────────────

export interface FamilyAlignOptions {
  strategy?: "external_id" | "position" | "similarity" | "external_id_then_position";
  sim_threshold?: number;
  /** Delete previous links before aligning */
  replace_existing?: boolean;
  /** Keep accepted links when replace_existing=true */
  preserve_accepted?: boolean;
  /** Skip pairs where child is not segmented instead of returning an error */
  skip_unready?: boolean;
}

export interface FamilyAlignPairResult {
  pivot_doc_id: number;
  target_doc_id: number;
  target_lang: string;
  relation_type: string;
  run_id: string | null;
  status: "aligned" | "skipped" | "conflict" | "error";
  links_created: number;
  deleted_before: number;
  preserved_before: number;
  warnings: string[];
}

export interface FamilyAlignSummary {
  total_pairs: number;
  aligned: number;
  skipped: number;
  conflicts: number;
  errors: number;
  total_links_created: number;
}

export interface FamilyAlignResponse {
  family_root_id: number;
  strategy: string;
  results: FamilyAlignPairResult[];
  summary: FamilyAlignSummary;
}

export async function alignFamily(
  conn: Conn,
  familyRootId: number,
  opts: FamilyAlignOptions = {},
): Promise<FamilyAlignResponse> {
  return conn.post(
    `/families/${familyRootId}/align`,
    opts,
  ) as Promise<FamilyAlignResponse>;
}

// ─── Sprint 5 — Export TMX et bilingue ───────────────────────────────────────

export interface ExportTmxOptions {
  /** Required for single-pair export (omit if using family_id) */
  pivot_doc_id?: number;
  target_doc_id?: number;
  /** Export all parent↔child pairs in one TMX file */
  family_id?: number;
  /** Absolute path for the output .tmx file */
  out_path?: string;
  /** Directory; file named automatically if out_path not given */
  out_dir?: string;
}

export interface ExportTmxResponse {
  ok: boolean;
  out_path: string;
  tu_count: number;
  pairs: [number, number][];
}

export interface ExportBilingualOptions {
  pivot_doc_id: number;
  target_doc_id: number;
  format?: "html" | "txt";
  /** Required unless preview_only=true */
  out_path?: string;
  /** Return JSON pairs without writing a file */
  preview_only?: boolean;
  preview_limit?: number;
}

export interface BilingualPreviewPair {
  pivot_text: string;
  target_text: string;
}

export interface ExportBilingualResponse {
  ok: boolean;
  /** Present when preview_only=false */
  out_path?: string;
  /** Present when preview_only=true */
  preview?: BilingualPreviewPair[];
  pair_count: number;
  format?: string;
  pivot_doc_id?: number;
  target_doc_id?: number;
  pivot_lang?: string;
  target_lang?: string;
}

export async function exportTmx(
  conn: Conn,
  opts: ExportTmxOptions,
): Promise<ExportTmxResponse> {
  return conn.post("/export/tmx", opts) as Promise<ExportTmxResponse>;
}

export async function exportBilingual(
  conn: Conn,
  opts: ExportBilingualOptions,
): Promise<ExportBilingualResponse> {
  return conn.post("/export/bilingual", opts) as Promise<ExportBilingualResponse>;
}

export async function setDocRelation(conn: Conn, opts: DocRelationSetOptions): Promise<{ action: string; id: number }> {
  return conn.post("/doc_relations/set", opts) as Promise<{ action: string; id: number }>;
}

export async function deleteDocRelation(conn: Conn, id: number): Promise<{ deleted: number }> {
  return conn.post("/doc_relations/delete", { id }) as Promise<{ deleted: number }>;
}

export async function backupDatabase(conn: Conn, opts: DbBackupOptions = {}): Promise<DbBackupResponse> {
  return conn.post("/db/backup", opts) as Promise<DbBackupResponse>;
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

export async function createAlignLink(conn: Conn, opts: AlignLinkCreateOptions): Promise<AlignLinkCreateResponse> {
  return conn.post("/align/link/create", opts) as Promise<AlignLinkCreateResponse>;
}

export async function updateAlignLinkStatus(conn: Conn, opts: AlignLinkUpdateStatusOptions): Promise<{ link_id: number; status: string | null; updated: number }> {
  return conn.post("/align/link/update_status", opts) as Promise<{ link_id: number; status: string | null; updated: number }>;
}

export async function deleteAlignLink(conn: Conn, opts: AlignLinkDeleteOptions): Promise<{ link_id: number; deleted: number }> {
  return conn.post("/align/link/delete", opts) as Promise<{ link_id: number; deleted: number }>;
}

export async function retargetAlignLink(conn: Conn, opts: AlignLinkRetargetOptions): Promise<{ link_id: number; new_target_unit_id: number; updated: number }> {
  return conn.post("/align/link/retarget", opts) as Promise<{ link_id: number; new_target_unit_id: number; updated: number }>;
}

// ─── V1.3 — Batch align link update ──────────────────────────────────────────

export async function batchUpdateAlignLinks(
  conn: Conn,
  actions: AlignBatchAction[]
): Promise<AlignBatchUpdateResponse> {
  return conn.post("/align/links/batch_update", { actions }) as Promise<AlignBatchUpdateResponse>;
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

/** Persisted run row (``runs`` table): align, import, index, … */
export interface RunRecord {
  run_id: string;
  kind: string;
  created_at: string;
  params?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
}

export async function listRuns(
  conn: Conn,
  opts: { kind?: string; limit?: number } = {}
): Promise<{ runs: RunRecord[]; limit: number }> {
  const p = new URLSearchParams();
  if (opts.kind) p.set("kind", opts.kind);
  if (opts.limit !== undefined) p.set("limit", String(opts.limit));
  const qs = p.size > 0 ? `?${p.toString()}` : "";
  return conn.get(`/runs${qs}`) as Promise<{ runs: RunRecord[]; limit: number }>;
}

// ─── V1.3 — Batch align link operations ──────────────────────────────────────

export interface AlignBatchAction {
  action: "set_status" | "delete";
  link_id: number;
  /** Required for set_status; null resets to unreviewed */
  status?: "accepted" | "rejected" | null;
}

export interface AlignBatchUpdateResponse {
  ok: boolean;
  applied: number;
  deleted: number;
  errors: Array<{ index: number; link_id: number | null; error: string }>;
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

// ─── V1.4 — Retarget candidates ───────────────────────────────────────────────

export interface RetargetCandidate {
  target_unit_id: number;
  external_id: number | null;
  target_text: string;
  score: number;
  reason: string;
}

export interface RetargetCandidatesOptions {
  pivot_unit_id: number;
  target_doc_id: number;
  limit?: number;
  window?: number;
}

export interface RetargetCandidatesResponse {
  pivot: { unit_id: number; external_id: number | null; text: string };
  candidates: RetargetCandidate[];
}

export async function retargetCandidates(
  conn: Conn,
  opts: RetargetCandidatesOptions
): Promise<RetargetCandidatesResponse> {
  return conn.post("/align/retarget_candidates", opts) as Promise<RetargetCandidatesResponse>;
}

// ── V1.5 — Collision resolver ────────────────────────────────────────────────

export interface CollisionLink {
  link_id: number;
  target_unit_id: number;
  target_external_id: number | null;
  target_text: string;
  status: string | null;
}

export interface CollisionGroup {
  pivot_unit_id: number;
  pivot_external_id: number | null;
  pivot_text: string;
  links: CollisionLink[];
}

export interface ListCollisionsOptions {
  pivot_doc_id: number;
  target_doc_id: number;
  limit?: number;
  offset?: number;
}

export interface ListCollisionsResponse {
  ok: boolean;
  total_collisions: number;
  collisions: CollisionGroup[];
  has_more: boolean;
  next_offset: number;
}

export interface CollisionResolveAction {
  action: "keep" | "delete" | "reject" | "unreviewed";
  link_id: number;
}

export interface CollisionResolveResponse {
  ok: boolean;
  applied: number;
  deleted: number;
  errors: Array<{ index: number; link_id: number; error: string }>;
}

export async function listCollisions(
  conn: Conn,
  opts: ListCollisionsOptions
): Promise<ListCollisionsResponse> {
  return conn.post("/align/collisions", opts) as Promise<ListCollisionsResponse>;
}

export async function resolveCollisions(
  conn: Conn,
  actions: CollisionResolveAction[]
): Promise<CollisionResolveResponse> {
  return conn.post("/align/collisions/resolve", { actions }) as Promise<CollisionResolveResponse>;
}

// ─── Curation exceptions (Level 7B) ──────────────────────────────────────────

export interface CurateExceptionsListResponse {
  ok: boolean;
  exceptions: CurateException[];
  count: number;
}

export interface CurateExceptionSetOptions {
  unit_id: number;
  kind: "ignore" | "override";
  override_text?: string;
  note?: string;
}

export interface CurateExceptionSetResponse {
  ok: boolean;
  unit_id: number;
  kind: "ignore" | "override";
  override_text: string | null;
  note: string | null;
  action: string;
}

export interface CurateExceptionDeleteResponse {
  ok: boolean;
  unit_id: number;
  deleted: boolean;
}

/** List all curation exceptions for a given doc_id (or all if omitted). */
export async function listCurateExceptions(
  conn: Conn,
  doc_id?: number,
): Promise<CurateExceptionsListResponse> {
  return conn.post("/curate/exceptions", doc_id !== undefined ? { doc_id } : {}) as Promise<CurateExceptionsListResponse>;
}

/** Create or replace a curation exception (INSERT OR REPLACE). */
export async function setCurateException(
  conn: Conn,
  opts: CurateExceptionSetOptions,
): Promise<CurateExceptionSetResponse> {
  return conn.post("/curate/exceptions/set", opts) as Promise<CurateExceptionSetResponse>;
}

/** Delete the curation exception for a unit_id. */
export async function deleteCurateException(
  conn: Conn,
  unit_id: number,
): Promise<CurateExceptionDeleteResponse> {
  return conn.post("/curate/exceptions/delete", { unit_id }) as Promise<CurateExceptionDeleteResponse>;
}

// ─── Level 9A — Exceptions export ────────────────────────────────────────────

export interface ExportCurateExceptionsOptions {
  /** Absolute path chosen via save dialog. */
  out_path: string;
  /** "json" | "csv" */
  format: "json" | "csv";
  /** When provided, export only that document's exceptions; else export all. */
  doc_id?: number;
}

export interface ExportCurateExceptionsResponse {
  ok: boolean;
  out_path: string;
  count: number;
  format: string;
}

/** Export curation exceptions to a JSON or CSV file. */
export async function exportCurateExceptions(
  conn: Conn,
  opts: ExportCurateExceptionsOptions,
): Promise<ExportCurateExceptionsResponse> {
  return conn.post("/curate/exceptions/export", opts) as Promise<ExportCurateExceptionsResponse>;
}

// ─── Level 10A/10B — Apply history ───────────────────────────────────────────

/**
 * Canonical schema for a curation apply event.
 * Used both in-memory (frontend session) and as a DB record (via sidecar).
 * When loaded from the DB, `id` is set; in-memory events have `id` undefined.
 */
export interface CurateApplyEvent {
  /** Set when loaded from DB. Absent for in-memory session events. */
  id?: number;
  applied_at: string;
  scope: "doc" | "all";
  doc_id: number | null;
  doc_title?: string | null;
  docs_curated: number;
  units_modified: number;
  units_skipped: number;
  ignored_count?: number;
  manual_override_count?: number;
  preview_displayed_count?: number;
  preview_units_changed?: number;
  preview_truncated?: boolean;
}

export interface ApplyHistoryListResponse {
  ok: boolean;
  events: CurateApplyEvent[];
  count: number;
}

export interface RecordApplyHistoryResponse {
  ok: boolean;
  id: number;
}

export interface ExportApplyHistoryOptions {
  out_path: string;
  format: "json" | "csv";
  doc_id?: number;
}

export interface ExportApplyHistoryResponse {
  ok: boolean;
  out_path: string;
  count: number;
  format: string;
}

/** Persist one apply event in the sidecar DB. Fire-and-forget safe. */
export async function recordApplyHistory(
  conn: Conn,
  event: CurateApplyEvent,
): Promise<RecordApplyHistoryResponse> {
  return conn.post("/curate/apply-history/record", event) as Promise<RecordApplyHistoryResponse>;
}

/** List recent apply events (newest first). Optional doc_id and limit. */
export async function listApplyHistory(
  conn: Conn,
  opts: { doc_id?: number; limit?: number } = {},
): Promise<ApplyHistoryListResponse> {
  return conn.post("/curate/apply-history", opts) as Promise<ApplyHistoryListResponse>;
}

/** Export apply history to JSON or CSV via sidecar file write. */
export async function exportApplyHistory(
  conn: Conn,
  opts: ExportApplyHistoryOptions,
): Promise<ExportApplyHistoryResponse> {
  return conn.post("/curate/apply-history/export", opts) as Promise<ExportApplyHistoryResponse>;
}

export async function shutdownSidecar(conn: Conn): Promise<void> {
  try { await conn.post("/shutdown", {}); } catch { /* best-effort */ }
  _conn = null;
  _connDbPath = null;
  _spawnedChild = null;
  _notifyRustRegistry(null);
}

/** Returns the active connection info (base_url + token) or null. Used by the
 *  Rust layer to POST /shutdown on window close. */
export function getActiveConn(): { baseUrl: string; token: string | null } | null {
  if (!_conn) return null;
  return { baseUrl: _conn.baseUrl, token: _conn.token };
}

/** Push the current connection info to the Rust SidecarRegistry so it can
 *  POST /shutdown on WindowEvent::Destroyed even if JS is already torn down. */
function _notifyRustRegistry(conn: Conn | null): void {
  try {
    if (conn) {
      void invoke("register_sidecar", { baseUrl: conn.baseUrl, token: conn.token ?? null });
    } else {
      void invoke("register_sidecar", { baseUrl: "", token: null });
    }
  } catch { /* best-effort */ }
}

// ─── Sprint 7 — Curation propagée ────────────────────────────────────────────

export interface CurationPendingLink {
  link_id: number;
  external_id: number;
  pivot_unit_id: number;
  pivot_text: string;
  target_unit_id: number;
  target_text: string;
  source_changed_at: string;
}

export interface CurationChildStatus {
  doc_id: number;
  title: string | null;
  language: string | null;
  pending_count: number;
  pending: CurationPendingLink[];
}

export interface FamilyCurationStatusResponse {
  family_root_id: number;
  total_pending: number;
  children: CurationChildStatus[];
}

export async function getFamilyCurationStatus(
  conn: Conn,
  familyRootId: number,
): Promise<FamilyCurationStatusResponse> {
  return conn.get(`/families/${familyRootId}/curation_status`) as Promise<FamilyCurationStatusResponse>;
}

export async function acknowledgeSourceChange(
  conn: Conn,
  opts: { link_ids?: number[]; target_doc_id?: number },
): Promise<{ acknowledged: number }> {
  return conn.post("/align/link/acknowledge_source_change", opts) as Promise<{ acknowledged: number }>;
}

export function resetConnection(): void {
  _conn = null;
  _connDbPath = null;
}

export async function updateUnitText(
  conn: Conn,
  unitId: number,
  text_raw: string,
  text_norm?: string,
): Promise<{ unit_id: number; doc_id: number; n: number; text_raw: string; text_norm: string }> {
  const body: Record<string, unknown> = { unit_id: unitId, text_raw };
  if (text_norm !== undefined) body.text_norm = text_norm;
  return conn.post("/units/update_text", body) as Promise<{ unit_id: number; doc_id: number; n: number; text_raw: string; text_norm: string }>;
}

