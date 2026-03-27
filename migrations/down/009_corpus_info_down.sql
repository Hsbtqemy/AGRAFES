-- Down-migration 009 : suppression des métadonnées corpus
--
-- Perd le titre, la description et le meta_json du corpus.

DROP TABLE IF EXISTS corpus_info;
