"""Document-relations domain service — audit P0-1 / A-01.

CRUD over the ``doc_relations`` table (the meta-links translation_of / excerpt_of
that bind documents into families), extracted verbatim from the sidecar
``_handle_doc_relations_*`` handlers. Pure w.r.t. transport: each function takes a
connection + request inputs, mutates the DB, and returns the response *data*. The
sidecar adapter owns the write-lock (writes only) and the HTTP envelope, and maps
:class:`ValidationError` to the endpoint's historic ``BAD_REQUEST`` wire code.

Reads (``get`` / ``list_all``) do NOT take the write-lock — matching the original
handlers.
"""

from __future__ import annotations

import sqlite3
from typing import Any, Optional

from .errors import ValidationError
from .validation import Field, validate

_SELECT_COLS = "id, doc_id, relation_type, target_doc_id, note, created_at"


def _row_to_relation(r: sqlite3.Row | tuple) -> dict[str, Any]:
    return {
        "id": r[0], "doc_id": r[1], "relation_type": r[2],
        "target_doc_id": r[3], "note": r[4], "created_at": r[5],
    }


def get_doc_relations(conn: sqlite3.Connection, doc_id_raw: Optional[str]) -> dict[str, Any]:
    """Relations declared *by* one document (GET /doc_relations?doc_id=).

    ``doc_id_raw`` is the raw query-param value (str or None). Raises
    ValidationError (required / not an integer).
    """
    if doc_id_raw is None:
        raise ValidationError("doc_id query param is required")
    try:
        doc_id = int(doc_id_raw)
    except (TypeError, ValueError):
        raise ValidationError("doc_id must be an integer")

    rows = conn.execute(
        f"SELECT {_SELECT_COLS} FROM doc_relations WHERE doc_id = ? ORDER BY id",
        (doc_id,),
    ).fetchall()
    relations = [_row_to_relation(r) for r in rows]
    return {"doc_id": doc_id, "relations": relations, "count": len(relations)}


def list_all_doc_relations(conn: sqlite3.Connection) -> dict[str, Any]:
    """Every doc_relation row in the corpus (GET /doc_relations/all)."""
    rows = conn.execute(
        f"SELECT {_SELECT_COLS} FROM doc_relations ORDER BY doc_id, id"
    ).fetchall()
    relations = [_row_to_relation(r) for r in rows]
    return {"relations": relations, "count": len(relations)}


def set_doc_relation(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Create or update a relation (POST /doc_relations/set).

    Upsert on (doc_id, relation_type, target_doc_id): if it exists, only the note
    is updated. Raises ValidationError if any of the three keys is missing.

    NOTE: this guard stays inline (not migrated to the A-03 validator). It is a
    *combined* cross-field check whose ``relation_type`` arm is a loose ``not x``
    truthy test, not a structural type/presence check — declaring it as a
    ``Field(str, strip=True)`` would tighten it (rejecting whitespace-only /
    non-string values that the legacy guard accepts, flipping 200 -> 400) and so
    would NOT be byte-identical. Combined/truthy guards are explicitly left inline.
    """
    doc_id = body.get("doc_id")
    relation_type = body.get("relation_type")
    target_doc_id = body.get("target_doc_id")
    if doc_id is None or not relation_type or target_doc_id is None:
        raise ValidationError("doc_id, relation_type, and target_doc_id are required")
    note = body.get("note")

    existing = conn.execute(
        "SELECT id FROM doc_relations WHERE doc_id = ? AND relation_type = ? AND target_doc_id = ?",
        (doc_id, relation_type, target_doc_id),
    ).fetchone()
    if existing:
        conn.execute("UPDATE doc_relations SET note = ? WHERE id = ?", (note, existing[0]))
        rel_id = existing[0]
        action = "updated"
    else:
        cur = conn.execute(
            "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, note, created_at)"
            " VALUES (?, ?, ?, ?, datetime('now'))",
            (doc_id, relation_type, target_doc_id, note),
        )
        rel_id = cur.lastrowid
        action = "created"
    conn.commit()
    return {
        "action": action, "id": rel_id, "doc_id": doc_id,
        "relation_type": relation_type, "target_doc_id": target_doc_id,
    }


_DELETE_RELATION_SCHEMA = (Field("id", required=True),)


def delete_doc_relation(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Delete a relation by id (POST /doc_relations/delete). Raises ValidationError
    if ``id`` is missing. Returns the number of rows deleted (0 if no match)."""
    rel_id = validate(body, _DELETE_RELATION_SCHEMA)["id"]
    cur = conn.execute("DELETE FROM doc_relations WHERE id = ?", (rel_id,))
    conn.commit()
    return {"deleted": cur.rowcount}
