-- Migration 019: prep action history + per-unit snapshots (Mode A undo backbone)
--
-- Forward-only durable history of destructive prep actions, with the snapshots
-- needed to revert them. Designed for Mode A (immediate undo via "Annuler"
-- button) and reused as-is for Mode B (targeted historical rollback) without
-- schema change.
--
-- Coexists with the legacy `curation_apply_history` table (migration 007),
-- which keeps powering the existing apply-history panel. No data is migrated
-- between the two.
--
-- action_type values populated in V1:
--   'curation_apply'  — POST /curate
--   'merge_units'     — POST /units/merge
--   'split_unit'      — POST /units/split
--   'resegment'       — POST /segment (when applied to a doc that already had units)
--   'undo'            — emitted by POST /prep/undo to record the revert itself;
--                       never returned as the "next undo-able" action.
--
-- context_json shape per action_type (documented authoritatively in TS in
-- tauri-prep/src/lib/prepUndo.ts; this comment is informational):
--   curation_apply : { rules_signature, apply_context: {...frontend payload} }
--   merge_units    : { merged_unit_ids: [int, int], created_unit_id: int }
--   split_unit     : { split_unit_id: int, created_unit_ids: [int, int] }
--   resegment      : { mode, pack, calibrate_to?,
--                      units_created_after_json: [{unit_id, n, external_id, unit_type, unit_role, meta_json}],
--                      units_deleted_after_ids: [int, ...] }
--   undo           : { reverted_action_id: int, reverted_action_type: str }

CREATE TABLE IF NOT EXISTS prep_action_history (
    action_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id           INTEGER NOT NULL,
    action_type      TEXT    NOT NULL CHECK (action_type IN (
                         'curation_apply', 'merge_units', 'split_unit',
                         'resegment', 'undo'
                     )),
    performed_at     TEXT    NOT NULL,                -- ISO 8601 UTC
    description      TEXT    NOT NULL,                -- short UI label
    context_json     TEXT,                            -- per-action payload (see header)
    reverted         INTEGER NOT NULL DEFAULT 0,      -- 0|1
    reverted_by_id   INTEGER NULL,                    -- FK self → the undo action
    FOREIGN KEY (doc_id)         REFERENCES documents(doc_id) ON DELETE CASCADE,
    FOREIGN KEY (reverted_by_id) REFERENCES prep_action_history(action_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_prep_action_doc
    ON prep_action_history(doc_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_prep_action_doc_type
    ON prep_action_history(doc_id, action_type, performed_at DESC);

-- Per-unit snapshots captured *before* the action mutated each unit.
-- One row per unit that existed before the action (not for units the action
-- creates ex nihilo — those are tracked in context_json.units_created_after_json
-- when relevant).
CREATE TABLE IF NOT EXISTS prep_action_unit_snapshots (
    action_id        INTEGER NOT NULL,
    unit_id          INTEGER NOT NULL,
    text_raw_before  TEXT    NULL,        -- NULL when the action does not touch text_raw
    text_norm_before TEXT    NOT NULL,
    unit_role_before TEXT    NULL,
    meta_json_before TEXT    NULL,
    PRIMARY KEY (action_id, unit_id),
    FOREIGN KEY (action_id) REFERENCES prep_action_history(action_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prep_snap_unit
    ON prep_action_unit_snapshots(unit_id);
