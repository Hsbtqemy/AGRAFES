-- Migration 011: source_changed_at on alignment_links
--
-- When a pivot unit (original) is modified by curation, sidecar sets
-- source_changed_at on every alignment_link where pivot_unit_id = that unit.
-- NULL  = pivot has not changed since the link was created / last acknowledged.
-- TEXT  = ISO-8601 datetime of the last pivot modification that was propagated.
--
-- The field is cleared (set back to NULL) when a user explicitly acknowledges
-- the change via POST /align/link/acknowledge_source_change.

ALTER TABLE alignment_links ADD COLUMN source_changed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_alinks_source_changed
    ON alignment_links (source_changed_at)
    WHERE source_changed_at IS NOT NULL;
