-- Migration 009: corpus-level metadata (title, description, flexible meta_json)

CREATE TABLE IF NOT EXISTS corpus_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT,
    description TEXT,
    meta_json TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO corpus_info (id, title, description, meta_json, updated_at)
VALUES (1, NULL, NULL, NULL, datetime('now'));
