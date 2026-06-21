"""Conventions (unit_roles) domain service — audit P0-1 / A-01.

CRUD over the ``unit_roles`` table, extracted verbatim from the sidecar
``_handle_conventions_*`` handlers so the validation + SQL live here (and can be
tested without a running HTTP server). Each function is pure w.r.t. transport: it
takes a connection + the request inputs, mutates the DB, and returns response
*data* — no HTTP envelope. The sidecar adapter owns the write-lock and maps
:class:`ServiceError` to wire codes, so responses stay byte-identical.

The per-function ``category`` fallbacks intentionally differ (matching the
original handlers): ``list``/``update`` fall back to ``"text"`` for a
non-structure role on a pre-``category`` schema, whereas ``create`` falls back to
the supplied (coerced) input category.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from .errors import ConflictError, NotFoundError, ValidationError
from .validation import Field, validate

# Role names treated as "structure" when the unit_roles table predates the
# `category` column (schema tolerance). Canonical home for this set.
STRUCTURE_ROLE_NAMES = frozenset({
    "titre", "intertitre", "dedicace", "epigraphe", "incipit",
    "colophon", "preface", "postface", "note", "paratext",
})


def _has_category(conn: sqlite3.Connection) -> bool:
    """True if the unit_roles table has the (newer) ``category`` column."""
    return "category" in {
        row[1] for row in conn.execute("PRAGMA table_info(unit_roles)").fetchall()
    }


def _project(row: sqlite3.Row, category: str) -> dict[str, Any]:
    """Shape one unit_roles row as a convention dict (category passed explicitly
    because the fallback rule differs per operation)."""
    return {
        "role_id": row["role_id"],
        "name": row["name"],
        "label": row["label"],
        "color": row["color"],
        "icon": row["icon"],
        "sort_order": row["sort_order"],
        "category": category,
        "created_at": row["created_at"],
    }


def list_conventions(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return every unit role (GET /conventions)."""
    has_cat = _has_category(conn)
    if has_cat:
        rows = conn.execute(
            "SELECT role_id, name, label, color, icon, sort_order, category, created_at"
            " FROM unit_roles ORDER BY sort_order ASC, role_id ASC"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT role_id, name, label, color, icon, sort_order, created_at"
            " FROM unit_roles ORDER BY sort_order ASC, role_id ASC"
        ).fetchall()

    def _cat(r: sqlite3.Row) -> str:
        if has_cat:
            return r["category"] or "text"
        return "structure" if r["name"] in STRUCTURE_ROLE_NAMES else "text"

    return [_project(r, _cat(r)) for r in rows]


_CREATE_CONVENTION_SCHEMA = (
    Field("name", str, strip=True),
    Field("label", str, strip=True),
)


def create_convention(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Create a new unit role (POST /conventions). Returns the created convention.

    Raises ValidationError (bad input) or ConflictError (name already exists).
    """
    clean = validate(body, _CREATE_CONVENTION_SCHEMA)
    name = clean["name"]
    label = clean["label"]
    color = (body.get("color") or "#6366f1").strip()
    icon = body.get("icon")
    sort_order = body.get("sort_order", 0)
    category = (body.get("category") or "text").strip()
    if category not in ("structure", "text"):
        category = "text"

    # Format rule (alnum + hyphen + underscore) stays inline — out of the
    # structural validator's scope (it has no pattern/regex facet).
    if not name.replace("_", "").replace("-", "").isalnum():
        raise ValidationError(
            "name must contain only letters, digits, hyphens and underscores"
        )

    existing = conn.execute(
        "SELECT role_id FROM unit_roles WHERE name=?", (name,)
    ).fetchone()
    if existing:
        raise ConflictError(f"Convention '{name}' already exists")

    has_cat = _has_category(conn)
    if has_cat:
        conn.execute(
            "INSERT INTO unit_roles (name, label, color, icon, sort_order, category)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (name, label, color, icon, int(sort_order), category),
        )
    else:
        conn.execute(
            "INSERT INTO unit_roles (name, label, color, icon, sort_order)"
            " VALUES (?, ?, ?, ?, ?)",
            (name, label, color, icon, int(sort_order)),
        )
    conn.commit()

    sel_cols = "role_id, name, label, color, icon, sort_order, created_at"
    if has_cat:
        sel_cols = "role_id, name, label, color, icon, sort_order, category, created_at"
    row = conn.execute(
        f"SELECT {sel_cols} FROM unit_roles WHERE name=?", (name,)
    ).fetchone()
    row_cat = row["category"] if has_cat else (
        "structure" if name in STRUCTURE_ROLE_NAMES else category
    )
    return _project(row, row_cat)


def update_convention(
    conn: sqlite3.Connection, role_name: str, body: dict
) -> dict[str, Any]:
    """Update label/color/icon/sort_order (+category) of a role (PUT /conventions/<name>).

    Raises ValidationError (no path name / no updatable field) or NotFoundError.
    """
    if not role_name:
        raise ValidationError("role name required in path")

    row = conn.execute(
        "SELECT role_id FROM unit_roles WHERE name=?", (role_name,)
    ).fetchone()
    if not row:
        raise NotFoundError(f"Convention '{role_name}' not found")

    has_cat_up = _has_category(conn)
    updatable = ("label", "color", "icon", "sort_order") + (("category",) if has_cat_up else ())
    fields: list[str] = []
    params: list[object] = []
    for col in updatable:
        if col in body:
            val = body[col]
            if col == "category" and val not in ("structure", "text"):
                val = "text"
            fields.append(f"{col}=?")
            params.append(val)
    if not fields:
        raise ValidationError(
            "At least one of label, color, icon, sort_order, category must be provided"
        )

    params.append(role_name)
    conn.execute(f"UPDATE unit_roles SET {', '.join(fields)} WHERE name=?", params)
    conn.commit()

    sel_cols_up = "role_id, name, label, color, icon, sort_order, created_at"
    if has_cat_up:
        sel_cols_up = "role_id, name, label, color, icon, sort_order, category, created_at"
    updated = conn.execute(
        f"SELECT {sel_cols_up} FROM unit_roles WHERE name=?", (role_name,)
    ).fetchone()
    updated_cat = updated["category"] if has_cat_up else (
        "structure" if role_name in STRUCTURE_ROLE_NAMES else "text"
    )
    return _project(updated, updated_cat)


def delete_convention(conn: sqlite3.Connection, body: dict) -> str:
    """Delete a role; units carrying it become NULL (POST /conventions/delete).

    Returns the deleted name. Raises ValidationError or NotFoundError.
    """
    name = (body.get("name") or "").strip()
    if not name:
        raise ValidationError("name is required")

    row = conn.execute(
        "SELECT role_id FROM unit_roles WHERE name=?", (name,)
    ).fetchone()
    if not row:
        raise NotFoundError(f"Convention '{name}' not found")

    # ON DELETE SET NULL handles units via FK, but SQLite FK enforcement may be
    # off; clear manually to be safe (verbatim from the original handler).
    conn.execute("UPDATE units SET unit_role=NULL WHERE unit_role=?", (name,))
    conn.execute("DELETE FROM unit_roles WHERE name=?", (name,))
    conn.commit()
    return name
