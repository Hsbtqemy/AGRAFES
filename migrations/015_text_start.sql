-- Migration 015: documents.text_start_n — paratextual boundary marker
-- Records the unit n (1-based order) at which the "real" text begins.
-- Units with n < text_start_n are considered paratextual:
--   - still visible everywhere text appears
--   - excluded from alignment quality/coverage metrics
--   - alignment position strategy uses text_start_n as offset baseline
-- NULL = no boundary defined (all units treated as body text).

ALTER TABLE documents ADD COLUMN text_start_n INTEGER NULL;
