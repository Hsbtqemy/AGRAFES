-- Migration 006: persistent local curation exceptions
--
-- Stores per-unit editorial decisions that survive session restarts and
-- influence both preview (filtering) and apply (curate_document).
--
-- kind = 'ignore'   : never apply any curation rule to this unit
-- kind = 'override' : always write override_text to text_norm for this unit,
--                     regardless of the active rules
--
-- The UNIQUE index on unit_id means only one active exception per unit.
-- A subsequent SET call (INSERT OR REPLACE) silently replaces the previous one.

CREATE TABLE IF NOT EXISTS curation_exceptions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id       INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
    kind          TEXT    NOT NULL CHECK (kind IN ('ignore', 'override')),
    override_text TEXT,             -- non-NULL when kind = 'override'
    note          TEXT,             -- optional free-text comment
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_curation_exceptions_unit
    ON curation_exceptions(unit_id);
