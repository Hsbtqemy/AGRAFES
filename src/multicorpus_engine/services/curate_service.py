"""Curation domain service (CRUD subset) — audit P0-1 / A-01.

The curation-exceptions and apply-history CRUD, extracted verbatim from the
sidecar ``_handle_curate_*`` handlers. Pure w.r.t. transport: each function takes
a connection + the request body and returns response *data*. The adapter owns the
write-lock and the HTTP envelope, mapping BadRequestError -> ERR_BAD_REQUEST and
NotFoundError -> ERR_NOT_FOUND (the codes these endpoints used).

Out of scope for this tranche (kept as handlers): ``curate_preview`` (server-coupled),
the ``*_export`` handlers (bulky inline formatting + file writes), and ``curate``
(delegates to curation.py) — of which only the undo recorder lives here, because the
synchronous and asynchronous curate paths must build the same one.
"""

from __future__ import annotations

import sqlite3
from typing import Any, Callable

from ..action_history import (
    ACTION_CURATION_APPLY,
    insert_unit_snapshots,
    record_prep_action,
)
from .errors import BadRequestError, NotFoundError

_EXC_SELECT = (
    "SELECT ce.id, ce.unit_id, ce.kind, ce.override_text, ce.note, ce.created_at,"
    "       u.doc_id,"
    "       COALESCE(d.title, '') AS doc_title,"
    "       SUBSTR(u.text_norm, 1, 200)  AS unit_text"
    " FROM curation_exceptions ce"
    " JOIN units u    ON u.unit_id = ce.unit_id"
    " JOIN documents d ON d.doc_id  = u.doc_id"
)


def _int_or(value: object, default: int | None) -> int | None:
    """Coerce an OPTIONAL integer, falling back to *default* on a bad/absent value."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _req_int(value: object, field: str) -> int:
    """Coerce a REQUIRED integer (SID-12): a non-int value raises BadRequestError
    (-> 400) rather than letting a bare int() raise ValueError/TypeError, which the
    adapter (catching only BadRequestError/NotFoundError) would surface as a 500."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise BadRequestError(f"{field} must be an integer") from None


def _exc_row(row: tuple) -> dict[str, Any]:
    return {
        "id": row[0], "unit_id": row[1], "kind": row[2], "override_text": row[3],
        "note": row[4], "created_at": row[5], "doc_id": row[6],
        "doc_title": row[7] or None, "unit_text": row[8] or None,
    }


def list_exceptions(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """All curation exceptions, optionally filtered by doc_id (GET/POST /curate/exceptions)."""
    doc_id = body.get("doc_id")
    if doc_id is not None:
        rows = conn.execute(
            _EXC_SELECT + " WHERE u.doc_id = ? ORDER BY ce.unit_id", (_req_int(doc_id, "doc_id"),)
        ).fetchall()
    else:
        rows = conn.execute(_EXC_SELECT + " ORDER BY u.doc_id, ce.unit_id").fetchall()
    exceptions = [_exc_row(r) for r in rows]
    return {"exceptions": exceptions, "count": len(exceptions)}


def set_exception(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Create or replace a curation exception for a unit_id (POST /curate/exceptions/set).

    Raises BadRequestError (missing unit_id/kind, override without text) or
    NotFoundError (unit_id does not exist).
    """
    unit_id = body.get("unit_id")
    kind = body.get("kind")
    if unit_id is None or kind not in ("ignore", "override"):
        raise BadRequestError("unit_id (int) and kind ('ignore'|'override') are required")
    unit_id = _req_int(unit_id, "unit_id")
    override_text = body.get("override_text")
    if kind == "override" and not override_text:
        raise BadRequestError("override_text is required when kind = 'override'")
    note = body.get("note")

    row = conn.execute("SELECT unit_id FROM units WHERE unit_id = ?", (unit_id,)).fetchone()
    if not row:
        raise NotFoundError(f"unit_id {unit_id} not found")

    conn.execute(
        """
        INSERT INTO curation_exceptions (unit_id, kind, override_text, note, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(unit_id) DO UPDATE SET
            kind = excluded.kind,
            override_text = excluded.override_text,
            note = excluded.note,
            created_at = excluded.created_at
        """,
        (unit_id, kind, override_text, note),
    )
    conn.commit()
    return {
        "unit_id": unit_id, "kind": kind, "override_text": override_text,
        "note": note, "action": "set",
    }


def delete_exception(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Delete the curation exception for a unit_id (POST /curate/exceptions/delete).

    Raises BadRequestError if unit_id is missing. Returns ``deleted`` (bool).
    """
    unit_id = body.get("unit_id")
    if unit_id is None:
        raise BadRequestError("unit_id is required")
    unit_id = _req_int(unit_id, "unit_id")
    cur = conn.execute("DELETE FROM curation_exceptions WHERE unit_id = ?", (unit_id,))
    conn.commit()
    return {"unit_id": unit_id, "deleted": cur.rowcount > 0}


def record_apply_history(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Insert one apply event into curation_apply_history (POST /curate/apply-history).

    The sidecar trusts all fields (sourced from the frontend session) — no validation.
    """
    scope = body.get("scope", "all")
    if scope not in ("doc", "all"):
        scope = "all"
    doc_id = body.get("doc_id")
    if doc_id is not None:
        doc_id = _req_int(doc_id, "doc_id")

    cur = conn.execute(
        """
        INSERT INTO curation_apply_history
          (applied_at, scope, doc_id, doc_title,
           docs_curated, units_modified, units_skipped,
           ignored_count, manual_override_count,
           preview_displayed_count, preview_units_changed, preview_truncated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            body.get("applied_at") or "unknown",
            scope,
            doc_id,
            body.get("doc_title"),
            _int_or(body.get("docs_curated"), 0),
            _int_or(body.get("units_modified"), 0),
            _int_or(body.get("units_skipped"), 0),
            _int_or(body.get("ignored_count"), None),
            _int_or(body.get("manual_override_count"), None),
            _int_or(body.get("preview_displayed_count"), None),
            _int_or(body.get("preview_units_changed"), None),
            1 if body.get("preview_truncated") else 0,
        ),
    )
    conn.commit()
    return {"id": cur.lastrowid}


def list_apply_history(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """List recent apply events, optionally filtered by doc_id/scope (limit<=200)."""
    doc_id = body.get("doc_id")
    scope = body.get("scope")
    limit = min(_int_or(body.get("limit", 50), 50), 200)

    sql = (
        "SELECT id, applied_at, scope, doc_id, doc_title,"
        "       docs_curated, units_modified, units_skipped,"
        "       ignored_count, manual_override_count,"
        "       preview_displayed_count, preview_units_changed, preview_truncated"
        " FROM curation_apply_history"
    )
    conditions: list[str] = []
    params: list[object] = []
    if doc_id is not None:
        conditions.append("doc_id = ?")
        params.append(_req_int(doc_id, "doc_id"))
    if scope is not None:
        conditions.append("scope = ?")
        params.append(scope)
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY applied_at DESC LIMIT ?"
    params.append(limit)

    rows = conn.execute(sql, params).fetchall()
    events = [
        {
            "id": row[0], "applied_at": row[1], "scope": row[2], "doc_id": row[3],
            "doc_title": row[4], "docs_curated": row[5], "units_modified": row[6],
            "units_skipped": row[7], "ignored_count": row[8], "manual_override_count": row[9],
            "preview_displayed_count": row[10], "preview_units_changed": row[11],
            "preview_truncated": bool(row[12]),
        }
        for row in rows
    ]
    return {"events": events, "count": len(events)}


# --- Mode A undo: the recorder both curate paths must pass -------------------

Recorder = Callable[[int, list[tuple[int, str, str]]], "int | None"]


def apply_recorder(
    conn: sqlite3.Connection,
    *,
    rules_count: int,
    scope: str,
    rules_signature: str | None = None,
    apply_context: dict | None = None,
) -> Recorder:
    """Build the ``record_action`` callback curate_document/curate_all_documents expect.

    Called inside the curation transaction, before the UPDATE, with the
    ``(unit_id, before, after)`` triples of the units about to change. Inserts the
    prep_action_history row plus its unit snapshots *without committing* — the
    commit belongs to curate_document.

    Shared on purpose. The synchronous ``POST /curate`` built this closure inline
    while the asynchronous ``kind='curate'`` job passed no recorder at all, so a
    curation run through the job path was neither undoable (Mode A) nor visible in
    the ``curated_at`` field ``GET /documents`` derives from this very table.
    """

    def _record(d_id: int, triples: list[tuple[int, str, str]]) -> int | None:
        if not triples:
            return None
        description = (
            f"Apply {rules_count} règle{'s' if rules_count > 1 else ''} · "
            f"{len(triples)} unité{'s' if len(triples) > 1 else ''} modifiée"
            f"{'s' if len(triples) > 1 else ''}"
        )
        context: dict = {
            "rules_count":     rules_count,
            "rules_signature": rules_signature,
            "scope":           scope,
        }
        if apply_context is not None:
            context["apply_context"] = apply_context
        action_id = record_prep_action(
            conn,
            doc_id=d_id,
            action_type=ACTION_CURATION_APPLY,
            description=description,
            context=context,
        )
        insert_unit_snapshots(
            conn,
            action_id,
            [
                {"unit_id": uid, "text_norm_before": before}
                for (uid, before, _after) in triples
            ],
        )
        return action_id

    return _record
