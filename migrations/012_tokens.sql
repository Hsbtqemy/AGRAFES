-- Migration 012: token-level storage for CQL/search-on-annotations
-- Adds a `tokens` table linked to `units` (one row per token).

CREATE TABLE IF NOT EXISTS tokens (
    token_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id    INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
    sent_id    INTEGER NOT NULL,
    position   INTEGER NOT NULL,
    word       TEXT,
    lemma      TEXT,
    upos       TEXT,
    xpos       TEXT,
    feats      TEXT,
    misc       TEXT
);

CREATE INDEX IF NOT EXISTS idx_tokens_unit
    ON tokens (unit_id);

CREATE INDEX IF NOT EXISTS idx_tokens_lemma
    ON tokens (lemma);

CREATE INDEX IF NOT EXISTS idx_tokens_upos
    ON tokens (upos);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_unit_sent_pos
    ON tokens (unit_id, sent_id, position);
