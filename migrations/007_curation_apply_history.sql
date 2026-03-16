-- Migration 007: curation apply history
--
-- Durable record of every successful curation apply.
-- Written by the sidecar at the frontend's request (POST /curate/apply-history/record)
-- immediately after each successful job completion.
--
-- Fields sourced from the frontend session at submit time:
--   scope, doc_id, doc_title, ignored_count, manual_override_count,
--   preview_displayed_count, preview_units_changed, preview_truncated
--
-- Fields sourced from the sidecar job result:
--   applied_at, docs_curated, units_modified, units_skipped

CREATE TABLE IF NOT EXISTS curation_apply_history (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    applied_at              TEXT    NOT NULL,
    scope                   TEXT    NOT NULL CHECK (scope IN ('doc', 'all')),
    doc_id                  INTEGER,              -- NULL when scope = 'all'
    doc_title               TEXT,                 -- denormalised snapshot (may be NULL)
    docs_curated            INTEGER NOT NULL DEFAULT 0,
    units_modified          INTEGER NOT NULL DEFAULT 0,
    units_skipped           INTEGER NOT NULL DEFAULT 0,
    ignored_count           INTEGER,
    manual_override_count   INTEGER,
    preview_displayed_count INTEGER,
    preview_units_changed   INTEGER,
    preview_truncated       INTEGER NOT NULL DEFAULT 0  -- 0 = false, 1 = true
);

CREATE INDEX IF NOT EXISTS idx_cah_applied_at ON curation_apply_history(applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_cah_doc_id     ON curation_apply_history(doc_id);
