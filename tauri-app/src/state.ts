/**
 * state.ts — Shared application state singleton and type definitions.
 * All modules import { state } from here; mutation is intentional (no framework).
 */

import type { Conn, QueryHit, DocumentRecord, QueryFacetsResponse, FamilyRecord } from "./lib/sidecarClient";

export type Status = "idle" | "starting" | "ready" | "error";

export interface AppState {
  status: Status;
  statusMsg: string;
  dbPath: string | null;
  conn: Conn | null;
  hits: QueryHit[];
  docs: DocumentRecord[];
  isSearching: boolean;
  isImporting: boolean;
  showFilters: boolean;
  showBuilder: boolean;
  // query params
  mode: "segment" | "kwic";
  window: number;
  /** Selected language codes. Empty array = no filter (all languages). */
  filterLangs: string[];
  filterRole: string;
  /** null = all documents (no filter); number[] = restrict to these doc_ids. */
  filterDocIds: number[] | null;
  filterResourceType: string;
  /** null = no family filter; number = restrict to this family_id for cross-family concordancer. */
  filterFamilyId: number | null;
  /** Restrict family search to pivot document only (original). */
  filterFamilyPivotOnly: boolean;
  /** Cached list of families for the family selector. */
  families: FamilyRecord[];
  /** Sprint 7: show only aligned units where source_changed_at is set. */
  filterSourceChanged: boolean;
  /** Filter by author substring (matches author_lastname or author_firstname). */
  filterAuthor: string;
  /** Filter by title substring. */
  filterTitleSearch: string;
  /** Filter by doc_date >= value (string). */
  filterDateFrom: string;
  /** Filter by doc_date <= value (string). */
  filterDateTo: string;
  /** Filter by source file extension (e.g. ".docx"). */
  filterSourceExt: string;
  /** Extra DB paths for federated /query (the current DB is added automatically). */
  filterFederatedDbPaths: string[];
  showAligned: boolean;
  expandedAlignedUnitIds: Set<number>;
  currentQuery: string;
  pageLimit: number;
  nextOffset: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  total: number | null;
  // query builder
  builderMode: "simple" | "phrase" | "and" | "or" | "near" | "regex" | "cql";
  nearN: number;
  /** When builderMode === "regex", stores the raw regex pattern (no FTS query is built). */
  regexPattern: string;
  /** Last /token_query total matched token count (hits total × sequence length), if in CQL mode. */
  cqlTokensMatchedTotal: number | null;
  // parallel KWIC
  showParallel: boolean;
  // Case-sensitive search post-filter
  caseSensitive: boolean;
  // Sprint G: sort mode applied to loaded hits at render time
  sortMode: "natural" | "by-doc";
  // Sprint H: backend facets (null = not loaded or invalidated)
  facets: QueryFacetsResponse | null;
  /** The query string for which state.facets was computed — used for stale-check. */
  facetsQuery: string;
}

export const ALIGNED_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_ALIGNED = 20;
export const DEEP_LINK_SCHEME = "agrafes";

export const state: AppState = {
  status: "idle",
  statusMsg: "",
  dbPath: null,
  conn: null,
  hits: [],
  docs: [],
  isSearching: false,
  isImporting: false,
  showFilters: false,
  showBuilder: false,
  mode: "segment",
  window: 10,
  filterLangs: [],
  filterRole: "",
  filterDocIds: null,
  filterResourceType: "",
  filterFamilyId: null,
  filterFamilyPivotOnly: false,
  families: [],
  filterSourceChanged: false,
  filterAuthor: "",
  filterTitleSearch: "",
  filterDateFrom: "",
  filterDateTo: "",
  filterSourceExt: "",
  filterFederatedDbPaths: [],
  showAligned: false,
  expandedAlignedUnitIds: new Set<number>(),
  currentQuery: "",
  pageLimit: PAGE_LIMIT_DEFAULT,
  nextOffset: null,
  hasMore: false,
  loadingMore: false,
  total: null,
  builderMode: "simple",
  nearN: 5,
  regexPattern: "",
  cqlTokensMatchedTotal: null,
  showParallel: false,
  caseSensitive: false,
  sortMode: "natural",
  facets: null,
  facetsQuery: "",
};
