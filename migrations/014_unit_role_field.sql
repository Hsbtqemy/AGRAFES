-- Migration 014: units.unit_role — per-segment convention assignment
-- Each unit can be assigned a role from unit_roles (NULL = no convention).
-- The role is per-document: pivot and translations are independent.
-- ON DELETE SET NULL: deleting a role un-assigns it from all units.

ALTER TABLE units ADD COLUMN unit_role TEXT
    REFERENCES unit_roles(name) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_units_role
    ON units (unit_role)
    WHERE unit_role IS NOT NULL;
