-- Migration 030: backfill the cell bead of gesture-created links (D-W16)
--
-- The collision detector (sidecar.py, qa_report.py) counts DISTINCT beads per
-- (pivot_unit_id, target_doc_id):
--     COUNT(DISTINCT COALESCE(bead_uid, 'L' || link_id)) > 1  AND not all accepted
-- The « couper à cheval » gesture (D-W12) adds a manual link on the neighbouring cell
-- next to the aligner's link, WITHOUT a bead_uid — the aligner link has one, the manual
-- one does not, so the cell reads as 2 distinct beads and gets flagged as a COLLISION.
-- Every straddle cut performed so far seeded such a phantom alert (reproduced).
--
-- A matrix cell holding several links is ONE bead (1 hub segment ↔ N target sentences,
-- D-W16): its bead identity is the cell itself, `cell#<pivot_unit_id>#<target_doc_id>`
-- (the same value align_links_service.cell_bead_uid derives, so this backfill and the
-- gestures agree). Going forward the gestures set it themselves; this catches up the
-- cells they already produced.
--
-- NARROW BY DESIGN — it must never silence a LEGITIMATE aligner collision (a real
-- ambiguity for the human to arbitrate). Only cells bearing the gesture signature are
-- touched: at least one ACTIVE link that is both run_id='manual' AND cut
-- (target_char_start IS NOT NULL) — i.e. a link this tool created *and* sliced. Rejected
-- links are dead (ALN-03) and neither qualify a cell nor get grouped.

UPDATE alignment_links
   SET bead_uid = 'cell#' || pivot_unit_id || '#' || target_doc_id
 WHERE (status IS NULL OR status <> 'rejected')
   AND EXISTS (
        SELECT 1 FROM alignment_links g
         WHERE g.pivot_unit_id = alignment_links.pivot_unit_id
           AND g.target_doc_id = alignment_links.target_doc_id
           AND (g.status IS NULL OR g.status <> 'rejected')
           AND g.run_id = 'manual'
           AND g.target_char_start IS NOT NULL
   )
   AND (
        SELECT COUNT(*) FROM alignment_links c
         WHERE c.pivot_unit_id = alignment_links.pivot_unit_id
           AND c.target_doc_id = alignment_links.target_doc_id
           AND (c.status IS NULL OR c.status <> 'rejected')
   ) > 1;
