-- Migration 002: FTS5 index
-- Creates fts_units as a regular (non-content) FTS5 table so we have
-- explicit control over which units are indexed (line units only, not structure).
-- The rowid of each FTS row equals unit_id from the units table, enabling JOINs.

CREATE VIRTUAL TABLE IF NOT EXISTS fts_units USING fts5(
    text_norm,
    tokenize='unicode61'
);
