-- Migration 025: document_tags — filterable document labels (refonte R6.2)
--
-- A namespaced N-N label on documents. `kind` is a free-text axis (genre, thème…) that
-- emerges from usage — no fixed vocabulary, since this is a general multi-corpus tool and
-- the analyst defines their own axes; `value` is the label within that axis. The
-- (doc_id, kind, value) triple is the natural key → PRIMARY KEY makes `add` idempotent
-- (INSERT OR IGNORE). ON DELETE CASCADE removes a document's tags when it is deleted
-- (foreign_keys=ON, like curation_exceptions). Used by the concordancier `tags` filter
-- (grouped by kind) and the Prep tag picker.

CREATE TABLE IF NOT EXISTS document_tags (
    doc_id  INTEGER NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    kind    TEXT    NOT NULL,
    value   TEXT    NOT NULL,
    PRIMARY KEY (doc_id, kind, value)
);

CREATE INDEX IF NOT EXISTS idx_document_tags_kv
    ON document_tags (kind, value);
