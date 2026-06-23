-- Migration 021: text_source_before snapshot column (ADR-043 Phase 2b)
--
-- Mode A undo for merge/split restores each touched unit from its pre-action
-- snapshot row in prep_action_unit_snapshots (migration 019). ADR-043 makes
-- merge concatenate the verbatim import originals (text_source) and split make
-- both halves inherit the parent's original. To revert those operations
-- byte-for-byte, the snapshot must also capture text_source as it stood before
-- the action.
--
-- Nullable: NULL means "the unit had no separate import original" (text_raw was
-- the original) OR the snapshot predates this migration. Undo restores the
-- column verbatim, so a NULL snapshot restores text_source = NULL.
--
-- resegment undo does NOT use this column: it snapshots text_source inside
-- context_json.units_before (ADR-043 P2), so no schema change was needed there.

ALTER TABLE prep_action_unit_snapshots ADD COLUMN text_source_before TEXT;
