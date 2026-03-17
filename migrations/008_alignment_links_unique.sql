-- Migration 008: Deduplicate alignment_links and add unique constraint
-- Keeps the oldest link (smallest link_id) for each (pivot_unit_id, target_unit_id) pair.

DELETE FROM alignment_links
WHERE link_id NOT IN (
    SELECT MIN(link_id)
    FROM alignment_links
    GROUP BY pivot_unit_id, target_unit_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alinks_pivot_target_unique
    ON alignment_links (pivot_unit_id, target_unit_id);
