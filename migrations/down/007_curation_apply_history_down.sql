-- Down-migration 007 : suppression de l'historique des opérations de curation
--
-- Perte définitive du journal d'audit des applys de curation.

DROP INDEX IF EXISTS idx_cah_doc_id;
DROP INDEX IF EXISTS idx_cah_applied_at;
DROP TABLE IF EXISTS curation_apply_history;
