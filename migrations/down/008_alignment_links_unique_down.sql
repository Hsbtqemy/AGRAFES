-- Down-migration 008 : suppression de la contrainte unique sur alignment_links
--
-- Supprime uniquement l'index unique créé par 008.
-- Les données dédupliquées ne peuvent pas être reconstituées (les doublons
-- supprimés par DELETE sont définitivement perdus).

DROP INDEX IF EXISTS idx_alinks_pivot_target_unique;
