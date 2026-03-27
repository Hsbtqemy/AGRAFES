-- Down-migration 003 : suppression des tables d'alignement
--
-- ATTENTION : supprime tous les liens d'alignement et toutes les relations
-- entre documents (doc_relations). Ces données ne sont pas récupérables
-- sans restauration depuis une sauvegarde.

DROP INDEX IF EXISTS idx_alinks_docs;
DROP INDEX IF EXISTS idx_alinks_ext;
DROP INDEX IF EXISTS idx_alinks_target;
DROP INDEX IF EXISTS idx_alinks_pivot;
DROP TABLE IF EXISTS alignment_links;

DROP INDEX IF EXISTS idx_doc_relations_doc;
DROP TABLE IF EXISTS doc_relations;
