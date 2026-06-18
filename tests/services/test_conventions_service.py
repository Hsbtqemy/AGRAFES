"""Direct unit tests for the conventions service (audit P0-1 / A-01).

These exercise the extracted unit_roles CRUD without any HTTP server — the point
of the service-layer extraction. The migrated schema has the `category` column
(migration 018), so the category-column path is the one under test here; the
no-column fallback is legacy-only defensive code.
"""

from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.conventions_service import (
    create_convention,
    delete_convention,
    list_conventions,
    update_convention,
)
from multicorpus_engine.services.errors import (
    ConflictError,
    NotFoundError,
    ValidationError,
)


# --- create ---------------------------------------------------------------------
def test_create_returns_convention(db_conn: sqlite3.Connection) -> None:
    conv = create_convention(
        db_conn, {"name": "mycustom", "label": "My Custom", "category": "structure"}
    )
    assert isinstance(conv["role_id"], int)
    assert conv["name"] == "mycustom"
    assert conv["label"] == "My Custom"
    assert conv["color"] == "#6366f1"           # default applied
    assert conv["category"] == "structure"       # stored (category column present)
    assert conv["created_at"]                     # NOT NULL default populated


def test_create_conflict(db_conn: sqlite3.Connection) -> None:
    create_convention(db_conn, {"name": "dup", "label": "Dup"})
    with pytest.raises(ConflictError):
        create_convention(db_conn, {"name": "dup", "label": "Dup again"})


@pytest.mark.parametrize("body", [
    {"label": "no name"},                         # missing name
    {"name": "x", "label": ""},                   # missing label
    {"name": "bad name!", "label": "L"},          # invalid chars in name
])
def test_create_validation(db_conn: sqlite3.Connection, body: dict) -> None:
    with pytest.raises(ValidationError):
        create_convention(db_conn, body)


def test_create_category_coerced_to_text(db_conn: sqlite3.Connection) -> None:
    conv = create_convention(db_conn, {"name": "weird", "label": "W", "category": "bogus"})
    assert conv["category"] == "text"


# --- list -----------------------------------------------------------------------
def test_list_reflects_created(db_conn: sqlite3.Connection) -> None:
    before = len(list_conventions(db_conn))
    create_convention(db_conn, {"name": "listme", "label": "List Me"})
    convs = list_conventions(db_conn)
    assert len(convs) == before + 1
    names = {c["name"] for c in convs}
    assert "listme" in names
    # every row is fully shaped
    for c in convs:
        assert set(c) == {
            "role_id", "name", "label", "color", "icon",
            "sort_order", "category", "created_at",
        }


# --- update ---------------------------------------------------------------------
def test_update_changes_fields(db_conn: sqlite3.Connection) -> None:
    create_convention(db_conn, {"name": "up", "label": "Old", "color": "#000000"})
    conv = update_convention(db_conn, "up", {"label": "New", "color": "#ffffff"})
    assert conv["label"] == "New"
    assert conv["color"] == "#ffffff"
    # persisted
    again = update_convention(db_conn, "up", {"sort_order": 5})
    assert again["sort_order"] == 5
    assert again["label"] == "New"


def test_update_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        update_convention(db_conn, "ghost", {"label": "x"})


def test_update_requires_path_name(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(ValidationError):
        update_convention(db_conn, "", {"label": "x"})


def test_update_no_updatable_field(db_conn: sqlite3.Connection) -> None:
    create_convention(db_conn, {"name": "nofields", "label": "L"})
    with pytest.raises(ValidationError):
        update_convention(db_conn, "nofields", {"irrelevant": 1})


def test_update_category_coerced(db_conn: sqlite3.Connection) -> None:
    create_convention(db_conn, {"name": "catup", "label": "L"})
    conv = update_convention(db_conn, "catup", {"category": "nonsense"})
    assert conv["category"] == "text"


# --- delete ---------------------------------------------------------------------
def test_delete_removes_role_and_clears_units(db_conn: sqlite3.Connection) -> None:
    create_convention(db_conn, {"name": "mytag", "label": "My Tag"})
    cur = db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('D', 'fr', 'standalone', datetime('now'))"
    )
    doc_id = cur.lastrowid
    db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm, unit_role)"
        " VALUES (?, 'line', 1, 'x', 'x', 'mytag')",
        (doc_id,),
    )
    db_conn.commit()

    assert delete_convention(db_conn, {"name": "mytag"}) == "mytag"
    assert db_conn.execute("SELECT 1 FROM unit_roles WHERE name='mytag'").fetchone() is None
    # the unit that carried the role is cleared to NULL, not deleted
    role = db_conn.execute("SELECT unit_role FROM units WHERE doc_id=?", (doc_id,)).fetchone()[0]
    assert role is None


def test_delete_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        delete_convention(db_conn, {"name": "ghost"})


def test_delete_name_required(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(ValidationError):
        delete_convention(db_conn, {})
