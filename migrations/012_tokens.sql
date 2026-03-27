-- Migration 012 — Token table for CQL (Corpus Query Language) support.
--
-- Stores one row per token, linked to its parent unit.
-- Populated by the CoNLL-U importer (Sprint A) and the spaCy annotator (Sprint B).
-- Indexed on lemma and upos for fast CQL attribute queries.

CREATE TABLE IF NOT EXISTS tokens (
    token_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id    INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
    sent_id    INTEGER NOT NULL,   -- sentence index within the unit (0-based, for `within s`)
    position   INTEGER NOT NULL,   -- token position within the sentence (0-based)
    word       TEXT,               -- surface form
    lemma      TEXT,
    upos       TEXT,               -- Universal POS tag (NOUN, VERB, ADJ…)
    xpos       TEXT,               -- language-specific POS tag
    feats      TEXT,               -- morphological features (CoNLL-U string or JSON)
    misc       TEXT                -- MISC field from CoNLL-U
);

CREATE INDEX IF NOT EXISTS idx_tokens_unit  ON tokens (unit_id);
CREATE INDEX IF NOT EXISTS idx_tokens_lemma ON tokens (lemma);
CREATE INDEX IF NOT EXISTS idx_tokens_upos  ON tokens (upos);
CREATE INDEX IF NOT EXISTS idx_tokens_word  ON tokens (word);
