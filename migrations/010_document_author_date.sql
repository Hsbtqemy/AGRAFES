-- Migration 010: optional author and date fields on documents
--
-- author_lastname  : nom de famille de l'auteur principal (TEXT, nullable)
-- author_firstname : prénom de l'auteur principal (TEXT, nullable)
-- doc_date         : date du document (texte libre : "2024", "2024-03", "2024-03-15", nullable)
--
-- Non-destructive: existing rows keep NULL values for all three columns.

ALTER TABLE documents ADD COLUMN author_lastname  TEXT;
ALTER TABLE documents ADD COLUMN author_firstname TEXT;
ALTER TABLE documents ADD COLUMN doc_date         TEXT;
