-- Migration 026: bead_uid on alignment_links (provenance-independent bead identity)
--
-- R3.3 "alignment curation model" (docs/DESIGN_alignment_curation_model.md, decision K3).
-- Until now a bead is keyed by the couple (run_id, bead_id), so run_id doubles as
-- BOTH provenance (which alignment run / 'manual') AND bead-identity scope. That
-- coupling makes it impossible to group links across runs — e.g. a manual orphan
-- link (run_id='manual', bead_id NULL) with an auto bead (run_id=<uuid>) — which is
-- exactly the dominant real curation case (see the note's §0 LeClézio example).
--
-- bead_uid is a bead identity independent of run_id. NULL = singleton (legacy /
-- manual / plain 1-1), each such row its own bead. The collision-detection key
-- switches from
--     COALESCE(run_id || '#' || bead_id, 'L' || link_id)
-- to
--     COALESCE(bead_uid, 'L' || link_id)
-- on its three sites (qa_report.py, sidecar.py ×2).
--
-- Backfill reproduces the old key BYTE-IDENTICALLY (bead_uid = run_id||'#'||bead_id
-- wherever bead_id IS NOT NULL), so collision behaviour is unchanged on existing
-- data and on future auto-aligner rows; only the NEW capability (cross-run manual
-- grouping, a later slice) is unlocked. run_id stays on the table — provenance is
-- untouched; it merely stops carrying bead identity.

ALTER TABLE alignment_links ADD COLUMN bead_uid TEXT;

UPDATE alignment_links
   SET bead_uid = run_id || '#' || bead_id
 WHERE bead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alinks_bead_uid
    ON alignment_links (bead_uid)
    WHERE bead_uid IS NOT NULL;
