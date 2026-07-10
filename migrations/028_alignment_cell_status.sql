-- Migration 028: alignment_cell_statuses — per-cell « non traduit » (R3.3, D-W8)
--
-- The matrix workspace (docs/DESIGN_alignment_workspace.md §3.3, D-W8 resolved
-- 2026-07-10) needs "this hub segment is deliberately untranslated in THIS
-- language" — a status on the (hub unit × target document) pair. The existing
-- units.unit_status axis (023) is global to the unit: right for a source unit
-- untranslated everywhere (marker-lift), wrong for an N-language matrix where
-- EN omits and RO does not. Both axes coexist: the projection reads the global
-- axis (whole row) AND this table (single cell).
--
-- One row = one marked cell; absence = normal. The enum is validated in the
-- service layer (like 023 — no DB CHECK, adding a value later stays a
-- service-only change); v1 has a single value, 'non_traduit'. A marked cell
-- displays the [non traduit] token (D10) and counts as done (D-W5).

CREATE TABLE IF NOT EXISTS alignment_cell_statuses (
    pivot_unit_id   INTEGER NOT NULL REFERENCES units(unit_id),
    target_doc_id   INTEGER NOT NULL REFERENCES documents(doc_id),
    status          TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (pivot_unit_id, target_doc_id)
);

CREATE INDEX IF NOT EXISTS idx_acell_status_doc
    ON alignment_cell_statuses (target_doc_id);
