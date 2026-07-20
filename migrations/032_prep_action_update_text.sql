-- Migration 032: allow action_type 'update_text' in prep_action_history
--
-- The "stylo" inline text correction (DESIGN_inline_text_correction.md, D-C7)
-- records an undoable `update_text` action when POST /units/update_text edits a
-- unit's text. Migration 019 froze action_type with a CHECK listing only
-- curation_apply / merge_units / split_unit / resegment / undo, so the new value
-- is rejected until the constraint is widened.
--
-- SQLite cannot ALTER a CHECK in place → standard table rebuild (as migration 029).
-- prep_action_history has children (prep_action_unit_snapshots FK ... ON DELETE
-- CASCADE) and a self-FK (reverted_by_id). With foreign_keys=ON (set on every
-- connection, db/connection.py), DROP TABLE runs an implicit DELETE that would
-- CASCADE-wipe every snapshot. So the rebuild is wrapped in foreign_keys=OFF/ON;
-- action_ids are preserved, so the by-name FKs (snapshots + self) re-resolve to the
-- renamed table with valid references. The copy is a no-op on a fresh database.

PRAGMA foreign_keys=OFF;

CREATE TABLE prep_action_history_new (
    action_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id           INTEGER NOT NULL,
    action_type      TEXT    NOT NULL CHECK (action_type IN (
                         'curation_apply', 'merge_units', 'split_unit',
                         'resegment', 'update_text', 'undo'
                     )),
    performed_at     TEXT    NOT NULL,
    description      TEXT    NOT NULL,
    context_json     TEXT,
    reverted         INTEGER NOT NULL DEFAULT 0,
    reverted_by_id   INTEGER NULL,
    FOREIGN KEY (doc_id)         REFERENCES documents(doc_id) ON DELETE CASCADE,
    FOREIGN KEY (reverted_by_id) REFERENCES prep_action_history(action_id) ON DELETE SET NULL
);

INSERT INTO prep_action_history_new
    (action_id, doc_id, action_type, performed_at, description,
     context_json, reverted, reverted_by_id)
    SELECT action_id, doc_id, action_type, performed_at, description,
           context_json, reverted, reverted_by_id
    FROM prep_action_history;

DROP TABLE prep_action_history;

ALTER TABLE prep_action_history_new RENAME TO prep_action_history;

CREATE INDEX IF NOT EXISTS idx_prep_action_doc
    ON prep_action_history(doc_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_prep_action_doc_type
    ON prep_action_history(doc_id, action_type, performed_at DESC);

PRAGMA foreign_keys=ON;
