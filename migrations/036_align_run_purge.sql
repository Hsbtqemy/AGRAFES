-- Migration 036: archive the links an alignment run purges, so a run is reversible
-- (ALI-17 / ALI-10 / audit §10 et §11).
--
-- Migration 035 gave prep actions a link archive, but it cannot own this one: its
-- action_id is NOT NULL and points at prep_action_history, whose doc_id is a SINGLE
-- document — while an alignment run spans a pivot AND N targets (the Modiano family
-- is three translations in one run). Undo there is also linear *per document*, so a
-- family-wide run folded into one document's stack would be hostage to that
-- document's other actions. Two structurally different owners → two tables, one
-- shared discipline.
--
-- Only a run with replace_existing=true destroys anything; a "compléter" run adds and
-- costs zero storage. Measured on the reference corpus: 15 destructive runs out of 53.
--
-- Same columns as prep_action_link_snapshots and for the same reason: link_id and
-- run_id are archived, so the restitution is IDENTICAL rather than an approximate
-- re-creation. src_run_id is the run that had CREATED the purged link; run_id here is
-- the run that purged it — the two are different, and confusing them would make an
-- undo delete the wrong generation.

CREATE TABLE IF NOT EXISTS align_run_purge (
    run_id             TEXT    NOT NULL,   -- the run that PURGED this link
    link_id            INTEGER NOT NULL,
    src_run_id         TEXT    NOT NULL,   -- the run that had CREATED it
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
    PRIMARY KEY (run_id, link_id)
);

-- Undoing a run deletes the links it created: alignment_links.run_id has no index of
-- its own (idx_alinks_bead is partial on (run_id, bead_id) WHERE bead_id IS NOT NULL,
-- unusable here), so that DELETE scans the table. Negligible at 9 602 rows, not on a
-- large corpus — hence this index, which also serves "which runs touched this pair".
CREATE INDEX IF NOT EXISTS idx_alinks_run
    ON alignment_links(run_id);

CREATE INDEX IF NOT EXISTS idx_align_run_purge_pair
    ON align_run_purge(pivot_doc_id, target_doc_id);
