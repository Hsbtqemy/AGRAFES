/**
 * sidecarClient.ts — Persistent sidecar HTTP client for Concordancier V0.
 *
 * Responsibilities:
 *  - ensureRunning(dbPath): spawn sidecar if not already running, return Conn.
 *  - Reuse existing sidecar via portfile discovery.
 *  - Inject X-Agrafes-Token on write endpoints.
 *  - Surface clean error messages (no stacktraces) to the UI.
 *
 * Sidecar portfile: <db_dir>/.agrafes_sidecar.json
 * Spawn command: multicorpus serve --db <dbPath> --host 127.0.0.1 --port 0 --token auto
 */

import {
  SidecarError,
  ensureRunning,
  getActiveConn,
  isLoopbackUrl,
  makeBaseUrl,
  normalizeLoopbackHost,
  resetConnection,
  shutdownSidecar,
} from "../../../shared/sidecarCore";
import type { Conn } from "../../../shared/sidecarCore";

// Re-export the shared connection API so existing `from "./sidecarClient"` imports keep working.
export {
  SidecarError,
  ensureRunning,
  getActiveConn,
  isLoopbackUrl,
  makeBaseUrl,
  normalizeLoopbackHost,
  resetConnection,
  shutdownSidecar,
};
export type { Conn };

/** Force le flush immédiat du pipe stdout sous Windows (évite les blocages). */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueryHit {
  doc_id: number;
  unit_id: number;
  external_id: number | null;
  language: string;
  title: string;
  source_db_path?: string;
  source_db_name?: string;
  source_db_index?: number;
  // segment mode
  text?: string;
  text_norm?: string;
  // kwic mode
  left?: string;
  match?: string;
  right?: string;
  // aligned view
  aligned?: AlignedUnit[];
  // token-query mode (CQL)
  sent_id?: number;
  start_position?: number;
  end_position?: number;
  tokens?: TokenRecord[];
  context_tokens?: TokenRecord[];
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

export interface AlignedUnit {
  unit_id: number;
  doc_id: number;
  external_id: number | null;
  language: string;
  title: string;
  text?: string;
  text_norm: string;
}

export interface QueryOptions {
  q: string;
  mode?: "segment" | "kwic";
  window?: number;
  /** One language code or a list of codes. Empty array or undefined = no filter. */
  language?: string | string[];
  doc_id?: number;
  /** Multi-doc filter — takes priority over doc_id when provided. */
  doc_ids?: number[];
  /** Optional federated DB query scope (multiple database paths in one /query request). */
  dbPaths?: string[];
  doc_role?: string;
  resource_type?: string;
  includeAligned?: boolean;
  alignedLimit?: number;
  include_aligned?: boolean;
  all_occurrences?: boolean;
  case_sensitive?: boolean;
  limit?: number;
  offset?: number;
  /** Restrict the query to a document family (parent + all children). Forces include_aligned. */
  familyId?: number;
  /** When familyId is set, search only in the pivot (parent) document. */
  pivotOnly?: boolean;
  /** When set, bypass FTS and use a full-scan Python regex instead. */
  regex_pattern?: string;
  /** Filter by author (LIKE search on author_lastname or author_firstname). */
  author?: string;
  /** Filter documents whose title contains this substring (LIKE). */
  title_search?: string;
  /** Filter documents with doc_date >= this value (string comparison). */
  doc_date_from?: string;
  /** Filter documents with doc_date <= this value (string comparison). */
  doc_date_to?: string;
  /** Filter by source file extension, e.g. ".docx", ".txt", ".tei". */
  source_ext?: string;
}

export interface QueryResponse {
  ok: boolean;
  status: string;
  count: number;
  hits: QueryHit[];
  limit?: number;
  offset?: number;
  next_offset?: number | null;
  has_more?: boolean;
  total?: number | null;
  family_id?: number | null;
  family_doc_ids?: number[] | null;
  pivot_only?: boolean | null;
  federated?: boolean | null;
  db_paths?: string[] | null;
  db_count?: number | null;
}

export interface TokenQueryOptions {
  cql: string;
  mode?: "segment" | "kwic";
  window?: number;
  /** One language code or a list of codes. Empty array or undefined = no filter. */
  language?: string | string[];
  /** Multi-doc filter. */
  doc_ids?: number[];
  limit?: number;
  offset?: number;
}

export interface TokenQueryResponse {
  ok: boolean;
  status: string;
  count: number;
  hits: QueryHit[];
  limit?: number;
  offset?: number;
  next_offset?: number | null;
  has_more?: boolean;
  total?: number | null;
}

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

export interface QueryFacetsOptions {
  q: string;
  language?: string | string[];
  doc_id?: number;
  /** Multi-doc filter — takes priority over doc_id when provided. */
  doc_ids?: number[];
  doc_role?: string;
  resource_type?: string;
  author?: string;
  title_search?: string;
  doc_date_from?: string;
  doc_date_to?: string;
  source_ext?: string;
  /** How many top documents to return (max 50, default 10). */
  top_docs_limit?: number;
}

/** One entry in the top_docs list returned by /query/facets. */
export interface FacetDocEntry {
  doc_id: number;
  title: string;
  language: string;
  count: number;
}

/**
 * Response from POST /query/facets.
 * All counts are exact (computed server-side over the full FTS index),
 * not estimates based on loaded hits.
 */
export interface QueryFacetsResponse {
  total_hits: number;
  distinct_docs: number;
  distinct_langs: number;
  top_docs: FacetDocEntry[];
}

/** One unit in a GET /unit/context reading window. */
export interface UnitContextItem {
  unit_id: number;
  text: string;
  /** True for the unit that was requested; false for context neighbours. */
  is_current: boolean;
}

/**
 * Response from GET /unit/context?unit_id=N&window=N (Sprint J).
 *
 * ``items`` is the full ordered reading window: ``window_before`` units before
 * the current unit, the current unit itself (``is_current=true``), and
 * ``window_after`` units after it.  ``window_before`` / ``window_after`` may be
 * less than the requested ``window`` at document boundaries.
 */
export interface UnitContextResponse {
  doc_id: number;
  unit_id: number;
  /** 1-based ordinal among line units in this document. */
  unit_index: number;
  total_units: number;
  window_before: number;
  window_after: number;
  items: UnitContextItem[];
}

// ─── High-level API methods ───────────────────────────────────────────────────

export async function query(
  conn: Conn,
  opts: QueryOptions
): Promise<QueryResponse> {
  const includeAligned = opts.includeAligned ?? opts.include_aligned ?? false;
  const payload: Record<string, unknown> = {
    q: opts.q,
    mode: opts.mode ?? "segment",
  };
  if (opts.window !== undefined) payload.window = opts.window;
  if (opts.language) {
    const langs = Array.isArray(opts.language) ? opts.language.filter(Boolean) : [opts.language];
    if (langs.length > 0) payload.language = langs.length === 1 ? langs[0] : langs;
  }
  if (opts.doc_ids !== undefined && opts.doc_ids.length > 0) {
    payload.doc_ids = opts.doc_ids;
  } else if (opts.doc_id !== undefined) {
    payload.doc_id = opts.doc_id;
  }
  if (opts.dbPaths !== undefined && opts.dbPaths.length > 0) {
    payload.db_paths = opts.dbPaths;
  }
  if (opts.doc_role) payload.doc_role = opts.doc_role;
  if (opts.resource_type) payload.resource_type = opts.resource_type;
  if (includeAligned) payload.include_aligned = true;
  if (includeAligned && opts.alignedLimit !== undefined) {
    payload.aligned_limit = opts.alignedLimit;
  }
  if (opts.all_occurrences) payload.all_occurrences = opts.all_occurrences;
  if (opts.case_sensitive) payload.case_sensitive = true;
  if (opts.limit !== undefined) payload.limit = opts.limit;
  if (opts.offset !== undefined) payload.offset = opts.offset;
  if (opts.familyId !== undefined) {
    payload.family_id = opts.familyId;
    payload.include_aligned = true;
    if (opts.pivotOnly) payload.pivot_only = true;
  }
  if (opts.regex_pattern) payload.regex_pattern = opts.regex_pattern;
  if (opts.author) payload.author = opts.author;
  if (opts.title_search) payload.title_search = opts.title_search;
  if (opts.doc_date_from) payload.doc_date_from = opts.doc_date_from;
  if (opts.doc_date_to) payload.doc_date_to = opts.doc_date_to;
  if (opts.source_ext) payload.source_ext = opts.source_ext;

  return conn.post("/query", payload) as Promise<QueryResponse>;
}

export async function tokenQuery(
  conn: Conn,
  opts: TokenQueryOptions
): Promise<TokenQueryResponse> {
  const payload: Record<string, unknown> = {
    cql: opts.cql,
    mode: opts.mode ?? "kwic",
  };
  if (opts.window !== undefined) payload.window = opts.window;
  if (opts.language) {
    const langs = Array.isArray(opts.language) ? opts.language.filter(Boolean) : [opts.language];
    if (langs.length > 0) payload.language = langs.length === 1 ? langs[0] : langs;
  }
  if (opts.doc_ids !== undefined && opts.doc_ids.length > 0) payload.doc_ids = opts.doc_ids;
  if (opts.limit !== undefined) payload.limit = opts.limit;
  if (opts.offset !== undefined) payload.offset = opts.offset;
  return conn.post("/token_query", payload) as Promise<TokenQueryResponse>;
}

/**
 * POST /query/facets — compute lightweight facet summary for a query.
 *
 * Returns exact counts (total_hits, distinct_docs, distinct_langs, top_docs)
 * computed server-side in a single GROUP BY pass over the FTS index.
 * Much cheaper than fetching all pages of results.
 *
 * Note: total_hits counts matching *units*, not KWIC occurrences.
 */
export async function queryFacets(
  conn: Conn,
  opts: QueryFacetsOptions
): Promise<QueryFacetsResponse> {
  const payload: Record<string, unknown> = { q: opts.q };
  if (opts.language) {
    const langs = Array.isArray(opts.language) ? opts.language.filter(Boolean) : [opts.language];
    if (langs.length > 0) payload.language = langs.length === 1 ? langs[0] : langs;
  }
  if (opts.doc_ids !== undefined && opts.doc_ids.length > 0) {
    payload.doc_ids = opts.doc_ids;
  } else if (opts.doc_id !== undefined) {
    payload.doc_id = opts.doc_id;
  }
  if (opts.doc_role) payload.doc_role = opts.doc_role;
  if (opts.resource_type) payload.resource_type = opts.resource_type;
  if (opts.author) payload.author = opts.author;
  if (opts.title_search) payload.title_search = opts.title_search;
  if (opts.doc_date_from) payload.doc_date_from = opts.doc_date_from;
  if (opts.doc_date_to) payload.doc_date_to = opts.doc_date_to;
  if (opts.source_ext) payload.source_ext = opts.source_ext;
  if (opts.top_docs_limit !== undefined) payload.top_docs_limit = opts.top_docs_limit;
  return conn.post("/query/facets", payload) as Promise<QueryFacetsResponse>;
}

export async function importFile(conn: Conn, opts: ImportOptions): Promise<ImportResponse> {
  return conn.post("/import", opts) as Promise<ImportResponse>;
}

export async function rebuildIndex(conn: Conn): Promise<IndexResponse> {
  return conn.post("/index", {}) as Promise<IndexResponse>;
}

export async function listDocuments(conn: Conn): Promise<DocumentRecord[]> {
  const res = (await conn.get("/documents")) as { documents: DocumentRecord[] };
  return res.documents;
}

// ─── Document families ────────────────────────────────────────────────────────

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

export interface FamilyChildEntry {
  doc_id: number;
  relation_type: string;
  doc: DocumentRecord | null;
  segmented: boolean;
  seg_count: number;
  aligned_to_parent: boolean;
}

export interface FamilyRecord {
  family_id: number;
  parent: DocumentRecord | null;
  children: FamilyChildEntry[];
  stats: FamilyStats;
}

export async function listFamilies(conn: Conn): Promise<FamilyRecord[]> {
  const res = (await conn.get("/families")) as { families: FamilyRecord[]; count: number };
  return res.families;
}

/**
 * GET /unit/context?unit_id=N&window=W — reading window around a unit (Sprint J).
 *
 * ``window`` controls how many units to include on each side (default 3, max 10).
 * Response contains an ``items`` array with ``is_current`` tagged on the pivot unit.
 */
export async function getUnitContext(
  conn: Conn,
  unitId: number,
  window = 3
): Promise<UnitContextResponse> {
  const path = `/unit/context?unit_id=${encodeURIComponent(String(unitId))}&window=${window}`;
  return conn.get(path) as Promise<UnitContextResponse>;
}

/** Reset in-memory state (e.g. after switching DB). */

/** Return the active connection (null if no sidecar running). */

// ─── Stats (lexical frequency) ────────────────────────────────────────────────

export interface StatsSlot {
  doc_ids?: number[] | null;
  language?: string | null;
  doc_role?: string | null;
  resource_type?: string | null;
  family_id?: number | null;
  top_n?: number;
  min_length?: number;
}

export interface StatsWord {
  word: string;
  count: number;
  freq_pct: number;
}

export interface StatsResult {
  label: string;
  total_tokens: number;
  vocabulary_size: number;
  total_units: number;
  total_docs: number;
  avg_tokens_per_unit: number;
  top_words: StatsWord[];
  rare_words: StatsWord[];
}

export interface StatsCompareWord {
  word: string;
  count_a: number;
  count_b: number;
  freq_a: number;
  freq_b: number;
  ratio: number | null;
}

export interface StatsCompareResult {
  label_a: string;
  label_b: string;
  summary_a: StatsResult;
  summary_b: StatsResult;
  comparison: StatsCompareWord[];
}

export async function fetchLexicalStats(
  conn: Conn,
  slot: StatsSlot,
  label = "",
): Promise<StatsResult> {
  return conn.post("/stats/lexical", { slot, label }) as Promise<StatsResult>;
}

export async function fetchStatsCompare(
  conn: Conn,
  slotA: StatsSlot,
  slotB: StatsSlot,
  labelA = "A",
  labelB = "B",
): Promise<StatsCompareResult> {
  return conn.post("/stats/compare", {
    a: slotA, b: slotB, label_a: labelA, label_b: labelB,
  }) as Promise<StatsCompareResult>;
}

// ─── Conventions (unit roles) ─────────────────────────────────────────────────

export async function setUnitRole(
  conn: Conn,
  unitId: number,
  roleName: string | null
): Promise<void> {
  await conn.post("/units/set_role", { unit_id: unitId, role_name: roleName });
}
