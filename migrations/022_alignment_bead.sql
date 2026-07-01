-- Migration 022: bead_id on alignment_links
--
-- Groups the 1-1 rows that together form one N-M alignment bead (1-2, 2-1, 2-2)
-- produced by the length_bounded (Gale-Church) aligner (refonte R3.2). All rows of
-- one bead share the same bead_id *within a run_id*.
--
-- NULL = a standalone 1-1 link (legacy, manual, or a plain 1-1 bead): each such
-- row is its own bead. Collision detection treats same-(run_id, bead_id) rows as a
-- single intended bead — not an error — so a translator's sentence split/merge is
-- no longer indistinguishable from a mis-alignment.

ALTER TABLE alignment_links ADD COLUMN bead_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_alinks_bead
    ON alignment_links (run_id, bead_id)
    WHERE bead_id IS NOT NULL;
