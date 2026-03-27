-- Down-migration 002 : suppression de l'index FTS5
--
-- Supprime la table FTS5 fts_units.
-- La restauration de l'index se fait en relançant POST /index (rebuild_index).
-- Aucune donnée de corpus n'est perdue.

DROP TABLE IF EXISTS fts_units;
