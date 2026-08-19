-- Migration 035: archive the alignment links a prep action destroys (ALI-03 / audit §11).
--
-- Mode A undo could restore a unit's text, role and meta_json — never a link.
-- undo.py touched alignment_links in exactly two ways, UPDATE … source_changed_at
-- and DELETE; there was no INSERT anywhere, and prep_action_unit_snapshots carries
-- only unit-scoped "before" columns. So « fusionner deux unités puis annuler »
-- returned the units and lost their alignment for good, silently.
--
-- This is the missing half: one row per destroyed link, keyed on the action, same
-- shape and lifecycle as prep_action_unit_snapshots (migration 019) — composite PK,
-- ON DELETE CASCADE on the action.
--
-- Every column of alignment_links is archived, link_id and run_id included. That is
-- what allows an *identical* restitution rather than an approximate re-creation (the
-- flaw ALI-20 reports about ＝ Rattacher): link_id is INTEGER PRIMARY KEY AUTOINCREMENT,
-- and AUTOINCREMENT never reuses a freed rowid, so the archived id is still available
-- when the undo runs. source_changed_at is archived too — a link that was already
-- flagged stale must come back stale, not look freshly verified.
--
-- Additive only: new table, no rebuild, no CHECK to widen. Empty on every existing
-- database, so the migration is a no-op for actions recorded before it.

CREATE TABLE IF NOT EXISTS prep_action_link_snapshots (
    action_id          INTEGER NOT NULL,
    link_id            INTEGER NOT NULL,
    run_id             TEXT    NOT NULL,
    pivot_unit_id      INTEGER NOT NULL,
    target_unit_id     INTEGER NOT NULL,
    external_id        INTEGER NOT NULL,
    pivot_doc_id       INTEGER NOT NULL,
    target_doc_id      INTEGER NOT NULL,
    created_at         TEXT    NOT NULL,
    status             TEXT    NULL,
    source_changed_at  TEXT    NULL,
    bead_id            INTEGER NULL,
    bead_uid           TEXT    NULL,
    target_char_start  INTEGER NULL,
    target_char_end    INTEGER NULL,
    PRIMARY KEY (action_id, link_id),
    FOREIGN KEY (action_id) REFERENCES prep_action_history(action_id) ON DELETE CASCADE
);

-- The undo path reads every snapshot of one action; the pair columns serve the
-- « what did this action cost on that pair » question without a scan.
CREATE INDEX IF NOT EXISTS idx_prep_link_snap_pair
    ON prep_action_link_snapshots(pivot_doc_id, target_doc_id);
