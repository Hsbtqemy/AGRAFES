-- Migration 004: add status column to alignment_links
-- NULL = unreviewed (default), 'accepted', 'rejected'
-- Non-destructive: existing rows stay untouched (status remains NULL).

ALTER TABLE alignment_links ADD COLUMN status TEXT;

CREATE INDEX IF NOT EXISTS idx_alinks_status
    ON alignment_links (status);
