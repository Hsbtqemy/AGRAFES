-- Migration 023: units.unit_status — per-unit translation status (refonte R4.1)
--
-- Orthogonal to unit_role (013/014): unit_role is the *peritextual type* (title,
-- chapô, intertitre — a user-defined FK vocabulary), unit_status is the fixed
-- *translation status* axis. NULL = normal/translated (the default); a source unit
-- deliberately left untranslated is 'non_traduit', a target unit added by the
-- translator is 'ajout'. The enum is validated in the service layer (like the
-- alignment status enum) — no DB CHECK, so adding a value later stays a service-only
-- change. This axis lets "all untranslated chapôs" be a structured role+status
-- query instead of free-text "[non traduit]" polluting the FTS index.

ALTER TABLE units ADD COLUMN unit_status TEXT;

CREATE INDEX IF NOT EXISTS idx_units_status
    ON units (unit_status)
    WHERE unit_status IS NOT NULL;
