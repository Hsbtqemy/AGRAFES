-- Migration 031: repair the over-grouping of migration 030 (revue 2026-07-13, T1)
--
-- Migration 030 backfilled the cell bead on every ACTIVE link of a cell bearing the
-- gesture signature (≥1 manual+cut link). Its own header promised it would « NEVER
-- silence a legitimate aligner collision » — but nothing enforced that: on a cell where
-- a genuine aligner collision (≥2 aligner links the human must arbitrate) coexisted with
-- an old gesture link, 030 merged ALL of them into one derived bead and the collision
-- vanished from /align/collisions and the QA report, with no way back (no UI path calls
-- clear_bead). The dedicated test passed only because it put the legitimate collision on
-- a DIFFERENT pivot.
--
-- REPAIR (this migration): on every cell that 030 grouped (bead_uid LIKE 'cell#%') and
-- that holds MORE THAN ONE non-gesture (aligner) active link, restore each link's
-- original bead identity — which is fully recoverable: run_id and bead_id were never
-- touched, so the value is exactly the one migration 026 backfills
-- (run_id || '#' || bead_id, NULL when the link has no bead_id). The collision comes back
-- and stays for the human to arbitrate.
--
-- Cells legitimately grouped by a gesture (at most ONE aligner link + the gesture's own
-- manual links) keep their cell bead — that is the phantom-collision fix of D-W16.
--
-- Going forward the same guard lives in the gesture (buildCellBeadActions refuses a cell
-- with ≥2 aligner links) and in the backfill rule below, applied to fresh databases where
-- 030 runs first and this migration corrects it in the same startup.

UPDATE alignment_links
   SET bead_uid = CASE WHEN bead_id IS NOT NULL THEN run_id || '#' || bead_id END
 WHERE bead_uid LIKE 'cell#%'
   AND (
        SELECT COUNT(*) FROM alignment_links a
         WHERE a.pivot_unit_id = alignment_links.pivot_unit_id
           AND a.target_doc_id = alignment_links.target_doc_id
           AND (a.status IS NULL OR a.status <> 'rejected')
           AND a.run_id <> 'manual'
   ) > 1;
