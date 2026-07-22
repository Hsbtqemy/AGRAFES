-- Migration 033: allow action_type 'set_role' in prep_action_history
--
-- Assigning a convention role (POST /units/set_role and /units/bulk_set_role) is
-- the dominant structural mutation at the canvas (retrait Segmentation, tranche 2
-- re-cadrée — cf. DESIGN_segmentation_retirement.md). It was NOT Mode-A-undoable
-- (raw UPDATE + commit, no prep_action). We now record an undoable `set_role`
-- action, but migration 019's CHECK froze action_type and 032 only added
-- 'update_text', so the new value is rejected until the constraint is widened.
--
-- SQLite cannot ALTER a CHECK in place → standard table rebuild (as migrations 029
-- and 032). prep_action_history has children (prep_action_unit_snapshots FK ...
-- ON DELETE CASCADE) and a self-FK (reverted_by_id). With foreign_keys=ON (set on
-- every connection, db/connection.py), DROP TABLE runs an implicit DELETE that
-- would CASCADE-wipe every snapshot. So the rebuild is wrapped in
-- foreign_keys=OFF/ON; action_ids are preserved, so the by-name FKs (snapshots +
-- self) re-resolve to the renamed table with valid references. No-op copy on a
-- fresh database.

PRAGMA foreign_keys=OFF;

CREATE TABLE prep_action_history_new (
    action_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id           INTEGER NOT NULL,
    action_type      TEXT    NOT NULL CHECK (action_type IN (
                         'curation_apply', 'merge_units', 'split_unit',
                         'resegment', 'update_text', 'set_role', 'undo'
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
