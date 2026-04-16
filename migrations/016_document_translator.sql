-- Migration 016: optional translator fields on documents
--
-- translator_lastname  : nom de famille du traducteur (TEXT, nullable)
-- translator_firstname : prénom du traducteur (TEXT, nullable)
--
-- Non-destructive: existing rows keep NULL values.

ALTER TABLE documents ADD COLUMN translator_lastname  TEXT;
ALTER TABLE documents ADD COLUMN translator_firstname TEXT;
