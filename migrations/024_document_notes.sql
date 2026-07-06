-- Migration 024: documents.notes — free-text "notes to self" at the document level (refonte R6.1)
--
-- Distinct from doc_relations.note (a note *about the relation between two documents*): this is a
-- free-text memo on the document itself. Metadata, not content → NOT indexed in FTS. The relation
-- note keeps its own column; the front relabels its input to remove the ambiguity.
--
-- Non-destructive: existing rows keep NULL.

ALTER TABLE documents ADD COLUMN notes TEXT;
