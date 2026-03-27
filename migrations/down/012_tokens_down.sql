-- Down-migration 012 : suppression de la table tokens (CQL)
--
-- ATTENTION : perd toutes les annotations linguistiques (lemme, POS, feats)
-- importées via CoNLL-U ou générées par spaCy.
-- La réindexation CQL nécessitera un ré-import complet.

DROP INDEX IF EXISTS idx_tokens_lemma;
DROP INDEX IF EXISTS idx_tokens_upos;
DROP INDEX IF EXISTS idx_tokens_unit;
DROP TABLE IF EXISTS tokens;
