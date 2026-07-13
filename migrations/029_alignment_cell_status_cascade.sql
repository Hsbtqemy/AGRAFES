-- Migration 029: alignment_cell_statuses — ON DELETE CASCADE (fix R1, revue 2026-07-13)
--
-- Migration 028 declared the FKs to units/documents with NO delete action, while
-- PRAGMA foreign_keys=ON is set on every connection (db/connection.py, sidecar.py).
-- One marked cell was therefore enough to make the pre-existing delete paths raise
-- IntegrityError: /documents/delete (the documents became undeletable), and — worse —
-- /segment, /units/merge and /prep/undo, which delete the doc's alignment_links
-- BEFORE deleting its units: the FK error struck mid-transaction, no handler rolled
-- back, and the pending family-wide link deletion was silently committed by the next
-- successful write. Sibling tables (006 curation_exceptions, 012 tokens, 019
-- prep_action_history, 025 document_tags) all cascade — and cascade is also the right
-- semantics here, not merely the safe one: a « non traduit » mark on a hub unit or a
-- translation document that no longer exists means nothing.
--
-- 028 is already applied on QA databases (schema_migrations carries its version), so
-- amending it in place would never re-run. Standard SQLite table rebuild instead:
-- create the corrected table, copy the rows, drop the old one, rename. The table is
-- tiny (one row per deliberately-untranslated cell) and the copy is a no-op on a
-- fresh database.

CREATE TABLE IF NOT EXISTS alignment_cell_statuses_new (
    pivot_unit_id   INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
    target_doc_id   INTEGER NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    status          TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (pivot_unit_id, target_doc_id)
);

INSERT OR IGNORE INTO alignment_cell_statuses_new (pivot_unit_id, target_doc_id, status, created_at)
    SELECT pivot_unit_id, target_doc_id, status, created_at FROM alignment_cell_statuses;

DROP TABLE alignment_cell_statuses;

ALTER TABLE alignment_cell_statuses_new RENAME TO alignment_cell_statuses;

CREATE INDEX IF NOT EXISTS idx_acell_status_doc
    ON alignment_cell_statuses (target_doc_id);
