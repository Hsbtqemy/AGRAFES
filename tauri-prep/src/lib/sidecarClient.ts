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

import { exists } from "@tauri-apps/plugin-fs";
import {
  ensureRunning,
  getActiveConn,
  resetConnection,
  shutdownSidecar,
  normalizeLoopbackHost,
  makeBaseUrl,
  isLoopbackUrl,
  SidecarError,
} from "../../../shared/sidecarCore";
import type { Conn } from "../../../shared/sidecarCore";

// Re-export the shared connection API so existing `from "./sidecarClient"` imports keep working.
export {
  ensureRunning,
  getActiveConn,
  resetConnection,
  shutdownSidecar,
  normalizeLoopbackHost,
  makeBaseUrl,
  isLoopbackUrl,
  SidecarError,
};
export type { Conn };

/** Force le flush immédiat du pipe stdout sous Windows (évite les blocages). */

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
  /**
   * True when the FTS index is stale for this doc — at least one line unit
   * is absent from / divergent in `fts_units`. Dérivé côté backend
   * (indexer.stale_doc_ids), pas un flag persisté.
   */
  fts_stale?: boolean;
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
  /**
   * For `docx_numbered_lines` ONLY — 1-based index of the column to extract
   * from tables (typical case: DOCX bilingue 2-col, set to 1 for the original
   * column or 2 for the translation). Leave undefined to keep the legacy
   * behavior (tables ignored). Ignored silently by other importers.
   */
  column_index?: number;
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
  /** Number of tables walked (>= 0 when column_index was set). */
  tables_processed?: number;
  /** Rows where the requested column did not exist (table too narrow / merged). */
  rows_skipped_short?: number;
  /** Nested sub-tables skipped during extraction. */
  nested_tables_skipped?: number;
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
  /** "structure" (titre, intertitre…) vs "text" (vers, dialogue…). Sidecar default = "text". */
  category?: "structure" | "text";
}

/** Returns all convention roles defined for this corpus, ordered by sort_order. */
export async function listConventions(conn: Conn): Promise<ConventionRole[]> {
  const res = await conn.get("/conventions") as { conventions: ConventionRole[] };
  return res.conventions;
}

/** Create a new convention role. Throws on name conflict (409). */
export async function createConvention(
  conn: Conn,
  options: { name: string; label: string; color?: string | null; icon?: string | null; sort_order?: number; category?: "structure" | "text" },
): Promise<ConventionRole> {
  const res = await conn.post("/conventions", options) as { convention: ConventionRole };
  return res.convention;
}

/** Update label, color, icon, sort_order or category of an existing convention. */
export async function updateConvention(
  conn: Conn,
  name: string,
  patch: { label?: string; color?: string | null; icon?: string | null; sort_order?: number; category?: "structure" | "text" },
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

/**
 * Assigns (or clears) a convention role on units identified by primary key.
 * Pass roleName=null to clear the role. Used by the Roles tab of SegmentationView.
 */
export async function bulkSetUnitRole(
  conn: Conn,
  unitIds: number[],
  roleName: string | null,
): Promise<{ updated: number }> {
  return conn.post("/units/bulk_set_role", {
    unit_ids: unitIds,
    role_name: roleName ?? "",
  }) as Promise<{ updated: number }>;
}

/** Alias of setTextStart kept for naming parity with the ported conventions module. */
export async function setDocumentTextStart(
  conn: Conn,
  docId: number,
  textStartN: number | null,
): Promise<{ updated: number }> {
  return setTextStart(conn, docId, textStartN);
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

// ─── ShareDocs / WebDAV ingestion (Phase 3) ───────────────────────────────────
// Credentials live in component state only (memory). They are sent in the body
// on each call and never persisted to disk / localStorage / config.

export type WebdavAuthMode = "anonymous" | "basic" | "bearer";

export interface WebdavAuth {
  mode: WebdavAuthMode;
  user?: string;
  password?: string;
  token?: string;
}

export interface RemoteEntry {
  name: string;
  href: string;
  is_dir: boolean;
  size: number | null;
  modified: string | null;
  content_type: string | null;
}

export interface ImportRemoteOptions {
  url: string;
  mode: string;
  language?: string;
  include?: string;
  /** Explicit file selection (P4C): import only these hrefs (intersected with the
   *  folder listing server-side). Omit to import the whole folder. */
  hrefs?: string[];
  auth?: WebdavAuth;
  doc_role?: string;
  resource_type?: string;
  max_file_mb?: number;
}

export type RemoteFileStatus =
  | "imported"
  | "skipped-duplicate"
  | "skipped-filtered"
  | "skipped-oversize"
  | "error";

export interface RemoteFileResult {
  source_url: string;
  name: string;
  status: RemoteFileStatus;
  doc_id: number | null;
  run_id?: string;
  source_hash?: string;
  units_total?: number | null;
  units_line?: number | null;
  size?: number | null;
  error?: string;
}

/** Batch report returned as the async job's `result` when /import-remote finishes. */
export interface ImportRemoteReport {
  url: string;
  mode: string;
  total: number;
  imported: number;
  skipped_duplicate: number;
  skipped_filtered: number;
  skipped_oversize: number;
  errors: number;
  files: RemoteFileResult[];
}

/** Browse a WebDAV collection (PROPFIND, Depth:1). Read-only, no token. */
export async function webdavList(
  conn: Conn,
  opts: { url: string; auth?: WebdavAuth }
): Promise<RemoteEntry[]> {
  const res = (await conn.post("/webdav/list", opts)) as { entries?: RemoteEntry[] };
  // Defensive: a 200 with an unexpected body must not crash the caller's spread.
  return Array.isArray(res?.entries) ? res.entries : [];
}

/**
 * Start a batch ingestion of a WebDAV folder. Returns the async job; poll it via
 * {@link getJob} (or hand the id to JobCenter) — the final `result` is an
 * {@link ImportRemoteReport}.
 */
export async function importRemote(conn: Conn, opts: ImportRemoteOptions): Promise<JobRecord> {
  const res = (await conn.post("/import-remote", opts)) as { job: JobRecord };
  return res.job;
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

// ---------------------------------------------------------------------------
// Prep undo (Mode A) — backbone : table prep_action_history (migration 019)
// ---------------------------------------------------------------------------
export interface PrepUndoEligibilityResponse {
  eligible: boolean;
  reason?: string;
  action_id?: number;
  action_type?: "curation_apply" | "merge_units" | "split_unit" | "resegment" | "undo";
  description?: string;
  performed_at?: string;
  warnings?: string[];
}

export interface PrepUndoResponse {
  undo_action_id: number;
  reverted_action_id: number;
  reverted_action_type:
    | "curation_apply"
    | "merge_units"
    | "split_unit"
    | "resegment";
  units_restored: number;
  alignments_reflagged: number;
  fts_stale: boolean;
}

export async function prepUndoEligibility(
  conn: Conn,
  doc_id: number,
): Promise<PrepUndoEligibilityResponse> {
  return conn.post("/prep/undo/eligibility", { doc_id }) as Promise<PrepUndoEligibilityResponse>;
}

export async function prepUndo(
  conn: Conn,
  doc_id: number,
): Promise<PrepUndoResponse> {
  return conn.post("/prep/undo", { doc_id }) as Promise<PrepUndoResponse>;
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

/** Returns the active connection (or null). Used by the Rust layer to
 *  POST /shutdown on window close. */

/** Push the current connection info to the Rust SidecarRegistry so it can
 *  POST /shutdown on WindowEvent::Destroyed even if JS is already torn down. */

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

/** Global summary of alignment links whose pivot source changed since alignment. */
export interface AlignSourceChangedSummary {
  total: number;
  docs: { target_doc_id: number; target_title: string | null; count: number }[];
}

export async function getAlignSourceChangedSummary(
  conn: Conn,
): Promise<AlignSourceChangedSummary> {
  return conn.get("/align/source_changed_summary") as Promise<AlignSourceChangedSummary>;
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
