-- Down-migration 006 : suppression des exceptions de curation
--
-- ATTENTION : toutes les décisions éditoriales unitaires (ignore / override)
-- sont définitivement perdues.

DROP INDEX IF EXISTS idx_curation_exceptions_unit;
DROP TABLE IF EXISTS curation_exceptions;
