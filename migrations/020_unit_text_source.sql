-- Migration 020: units.text_source — immutable original import text (ADR-043, P1)
-- Captured once at import (= text_raw at import time) by importers/parsed.insert_units
-- (and the CoNLL-U importer). Never overwritten by curate/resegment/merge/split, so the
-- verbatim import text stays recoverable even after a destructive resegmentation.
-- NULL for rows imported before this migration (and, until P2, for units created by
-- resegment/merge/split/undo) → readers fall back to text_raw. Recovery-only: not FTS-
-- indexed, not queried.

ALTER TABLE units ADD COLUMN text_source TEXT;
