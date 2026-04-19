-- Migration 018: category field on unit_roles
--
-- category : 'structure' | 'text' (default 'text')
--   structure → roles for structural units (headings, paratext markers…)
--   text      → roles for content units (verse, dialogue, quote…)
--
-- Existing rows get 'text' by default.
-- Known structural role names are back-filled to 'structure'.

ALTER TABLE unit_roles ADD COLUMN category TEXT NOT NULL DEFAULT 'text';

UPDATE unit_roles
   SET category = 'structure'
 WHERE name IN ('titre', 'intertitre', 'dedicace', 'epigraphe', 'note', 'incipit',
                'paratext', 'colophon', 'preface', 'postface');
