"""Document tags domain service (refonte R6.2).

Namespaced N-N labels on documents (``document_tags``: doc_id, kind, value). Both
``kind`` (the axis: genre, thème…) and ``value`` are free-text — the axes emerge from
usage, no fixed vocabulary (a general multi-corpus tool lets the analyst define their
own). Pure w.r.t. transport: each function takes a connection + inputs, mutates the DB,
and returns response *data*; the sidecar adapter owns the write-lock, the HTTP envelope,
and the typed-error → wire-code mapping (ValidationError → BAD_REQUEST, NotFoundError →
NOT_FOUND).
"""
from __future__ import annotations

import sqlite3
from typing import Any

from .errors import NotFoundError, ValidationError
from .validation import Field, validate


def list_tags(conn: sqlite3.Connection, doc_id: Any = None) -> list[dict[str, Any]]:
    """List tags (GET /tags). With ``doc_id`` → that document's (kind, value) pairs (the
    Prep picker); without → every distinct (kind, value) in the corpus (filter autocomplete
    + facet options). Read-only. Raises ValidationError on a non-integer ``doc_id``."""
    if doc_id is None or str(doc_id).strip() == "":
        rows = conn.execute(
            "SELECT DISTINCT kind, value FROM document_tags ORDER BY kind, value"
        ).fetchall()
    else:
        try:
            did = int(doc_id)
        except (TypeError, ValueError):
            raise ValidationError("doc_id must be an integer")
        rows = conn.execute(
            "SELECT kind, value FROM document_tags WHERE doc_id = ? ORDER BY kind, value",
            (did,),
        ).fetchall()
    return [{"kind": r["kind"], "value": r["value"]} for r in rows]


_TAG_SCHEMA = (
    Field("doc_id", int, coerce=True),
    Field("kind", str, strip=True),   # required + strip → blank rejected as "kind is required"
    Field("value", str, strip=True),
)


def add_tag(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Attach a (kind, value) tag to a document (POST /documents/tags/add). Idempotent —
    a duplicate is a no-op (INSERT OR IGNORE). Raises ValidationError (bad input) or
    NotFoundError (unknown doc)."""
    clean = validate(body, _TAG_SCHEMA)
    doc_id, kind, value = clean["doc_id"], clean["kind"], clean["value"]
    if conn.execute("SELECT 1 FROM documents WHERE doc_id = ?", (doc_id,)).fetchone() is None:
        raise NotFoundError(f"Document doc_id={doc_id} not found")
    cur = conn.execute(
        "INSERT OR IGNORE INTO document_tags (doc_id, kind, value) VALUES (?, ?, ?)",
        (doc_id, kind, value),
    )
    conn.commit()
    return {"doc_id": doc_id, "kind": kind, "value": value, "added": cur.rowcount}


def remove_tag(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Remove a (kind, value) tag from a document (POST /documents/tags/remove). An absent
    tag → ``deleted`` = 0 (not an error). Raises ValidationError on bad input."""
    clean = validate(body, _TAG_SCHEMA)
    cur = conn.execute(
        "DELETE FROM document_tags WHERE doc_id = ? AND kind = ? AND value = ?",
        (clean["doc_id"], clean["kind"], clean["value"]),
    )
    conn.commit()
    return {"deleted": cur.rowcount}
