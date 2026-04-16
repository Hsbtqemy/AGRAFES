-- Migration 017: bibliographic fields on documents
--
-- work_title : titre de l'œuvre (identique en VO et traduction, ex. "Les Misérables")
-- pub_place  : lieu de publication (ex. "Paris", "Londres")
-- publisher  : éditeur / édition (ex. "Gallimard", "Penguin Classics")
--
-- Non-destructive: existing rows keep NULL values.

ALTER TABLE documents ADD COLUMN work_title TEXT;
ALTER TABLE documents ADD COLUMN pub_place  TEXT;
ALTER TABLE documents ADD COLUMN publisher  TEXT;
