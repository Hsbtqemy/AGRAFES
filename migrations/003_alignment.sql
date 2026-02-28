-- Migration 003: Alignment tables (Increment 2)
-- doc_relations: meta-links between documents (translation_of, excerpt_of)
-- alignment_links: unit-level 1-1 links created by align_by_external_id

CREATE TABLE IF NOT EXISTS doc_relations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id          INTEGER NOT NULL REFERENCES documents(doc_id),
    relation_type   TEXT NOT NULL,      -- translation_of | excerpt_of
    target_doc_id   INTEGER NOT NULL REFERENCES documents(doc_id),
    note            TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doc_relations_doc
    ON doc_relations (doc_id, relation_type);

CREATE TABLE IF NOT EXISTS alignment_links (
    link_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT NOT NULL,
    pivot_unit_id   INTEGER NOT NULL REFERENCES units(unit_id),
    target_unit_id  INTEGER NOT NULL REFERENCES units(unit_id),
    external_id     INTEGER NOT NULL,   -- the shared external_id anchor
    pivot_doc_id    INTEGER NOT NULL,
    target_doc_id   INTEGER NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alinks_pivot
    ON alignment_links (pivot_unit_id);

CREATE INDEX IF NOT EXISTS idx_alinks_target
    ON alignment_links (target_unit_id);

CREATE INDEX IF NOT EXISTS idx_alinks_ext
    ON alignment_links (external_id);

CREATE INDEX IF NOT EXISTS idx_alinks_docs
    ON alignment_links (pivot_doc_id, target_doc_id);
