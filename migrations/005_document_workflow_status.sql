-- Migration 005: document workflow status for Prep finalization UX
-- Adds lightweight, non-breaking status tracking fields on documents.
-- Status values are validated at application layer:
--   draft | review | validated

ALTER TABLE documents ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE documents ADD COLUMN validated_at TEXT;
ALTER TABLE documents ADD COLUMN validated_run_id TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_workflow_status
    ON documents (workflow_status);
