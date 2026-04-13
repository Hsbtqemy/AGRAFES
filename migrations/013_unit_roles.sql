-- Migration 013: unit_roles — convention system
-- Stores user-defined segment role/convention types per corpus.
-- Each DB (corpus) has its own set of roles.

CREATE TABLE IF NOT EXISTS unit_roles (
    role_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,  -- machine key: "intertitre", "dedicace"
    label      TEXT    NOT NULL,         -- display label: "Intertitre", "Dédicace"
    color      TEXT    NOT NULL DEFAULT '#6366f1',  -- hex color for badge
    icon       TEXT,                     -- optional emoji/symbol, e.g. "📌"
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_unit_roles_name
    ON unit_roles (name);
