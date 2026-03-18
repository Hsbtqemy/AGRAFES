/**
 * state.ts — Shared application state singleton and type definitions.
 * All modules import { state } from here; mutation is intentional (no framework).
 */

import type { Conn, QueryHit, DocumentRecord, QueryFacetsResponse } from "./lib/sidecarClient";

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
  filterLang: string;
  filterRole: string;
  /** null = all documents (no filter); number[] = restrict to these doc_ids. */
  filterDocIds: number[] | null;
  filterResourceType: string;
  showAligned: boolean;
  expandedAlignedUnitIds: Set<number>;
  currentQuery: string;
  pageLimit: number;
  nextOffset: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  total: number | null;
  // query builder
  builderMode: "simple" | "phrase" | "and" | "or" | "near";
  nearN: number;
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
  filterLang: "",
  filterRole: "",
  filterDocIds: null,
  filterResourceType: "",
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
  showParallel: false,
  caseSensitive: false,
  sortMode: "natural",
  facets: null,
  facetsQuery: "",
};
