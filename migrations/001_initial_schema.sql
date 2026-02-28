-- Migration 001: Initial schema
-- Creates core tables: documents, units, runs

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    doc_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    language        TEXT NOT NULL,
    doc_role        TEXT NOT NULL DEFAULT 'standalone',
    resource_type   TEXT,
    meta_json       TEXT,
    source_path     TEXT,
    source_hash     TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
    unit_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id      INTEGER NOT NULL REFERENCES documents(doc_id),
    unit_type   TEXT NOT NULL,       -- line | structure
    n           INTEGER NOT NULL,    -- order within document (1-based)
    external_id INTEGER,             -- extracted from [n] prefix; NULL for structure
    text_raw    TEXT NOT NULL,
    text_norm   TEXT NOT NULL,
    meta_json   TEXT
);

CREATE INDEX IF NOT EXISTS idx_units_doc_extid
    ON units (doc_id, external_id);

CREATE INDEX IF NOT EXISTS idx_units_doc_n
    ON units (doc_id, n);

CREATE TABLE IF NOT EXISTS runs (
    run_id      TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,       -- init | import | index | query
    params_json TEXT,
    stats_json  TEXT,
    created_at  TEXT NOT NULL
);
