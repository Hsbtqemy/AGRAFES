"""Units domain service (non-merge/split subset) — audit P0-1 / A-01.

Role assignment, text edits and listing for units, extracted verbatim from the
sidecar ``_handle_units_*`` handlers. Pure w.r.t. transport. The adapter owns the
write-lock (writes only — ``list_units`` is a lock-free read like the original)
and the HTTP envelope, mapping BadRequestError -> ERR_BAD_REQUEST and
NotFoundError -> ERR_NOT_FOUND (the codes these endpoints used).

Out of scope (kept as handlers): ``units/merge`` and ``units/split`` — complex,
they renumber + re-link alignments/tokens (closer to the align/segment risk tier).
"""

from __future__ import annotations

import sqlite3
from typing import Any, Optional

from .errors import BadRequestError, NotFoundError
from .validation import Field, validate


def _role_exists(conn: sqlite3.Connection, role: str) -> bool:
    return conn.execute("SELECT 1 FROM unit_roles WHERE name=?", (role,)).fetchone() is not None


def list_units(
    conn: sqlite3.Connection, doc_id_raw: Optional[str], unit_type: Optional[str]
) -> dict[str, Any]:
    """List a document's units with their role (GET /units?doc_id=N[&unit_type=]).

    ``doc_id_raw`` is the raw query-param value. Raises BadRequestError.
    """
    if not doc_id_raw:
        raise BadRequestError("doc_id is required")
    try:
        doc_id = int(doc_id_raw)
    except (TypeError, ValueError):
        raise BadRequestError("doc_id must be an integer")

    # text_raw + text_source are emitted so the UI can detect a destructive
    # rewrite (text_source != text_raw) and offer to reveal the import original
    # (ADR-043 P3). Raw column values, nullable — the display gate lives client-side.
    # parent_n (R2.3, refonte deux-grains) is the coarse paragraph anchor persisted in
    # meta_json by resegmentation (R2.1). Read straight out of the JSON with
    # json_extract so the canvas can group sentences under their ¶ client-side; null
    # when the doc was never fine-segmented (each line is then its own coarse block).
    _COLS = (
        "unit_id, n, text_norm, unit_type, unit_role, text_raw, text_source,"
        " json_extract(meta_json, '$.parent_n') AS parent_n"
    )
    if unit_type:
        rows = conn.execute(
            f"SELECT {_COLS} FROM units WHERE doc_id=? AND unit_type=? ORDER BY n",
            (doc_id, unit_type),
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT {_COLS} FROM units WHERE doc_id=? ORDER BY n",
            (doc_id,),
        ).fetchall()

    units = [
        {
            "unit_id": r[0], "n": r[1], "text_norm": r[2], "unit_type": r[3],
            "unit_role": r[4], "text_raw": r[5], "text_source": r[6],
            "parent_n": r[7],
        }
        for r in rows
    ]
    return {"units": units, "count": len(units), "doc_id": doc_id}


_SET_ROLE_SCHEMA = (
    Field("doc_id", int, coerce=True, error=BadRequestError),
    Field("unit_n", int, coerce=True, error=BadRequestError),
)


def set_unit_role(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Assign (or clear) a convention role on one unit (POST /units/set_role).

    Raises BadRequestError (missing/non-int ids) or NotFoundError (role or unit).
    """
    ids = validate(body, _SET_ROLE_SCHEMA)
    doc_id = ids["doc_id"]
    unit_n = ids["unit_n"]
    role = body.get("role")  # None or "" -> clear

    role = (role or "").strip() or None  # normalise empty string -> None

    if role is not None and not _role_exists(conn, role):
        raise NotFoundError(f"Convention '{role}' not found")

    row = conn.execute(
        "SELECT unit_id FROM units WHERE doc_id=? AND n=?", (doc_id, unit_n)
    ).fetchone()
    if not row:
        raise NotFoundError(f"Unit n={unit_n} not found for doc_id={doc_id}")

    conn.execute("UPDATE units SET unit_role=? WHERE doc_id=? AND n=?", (role, doc_id, unit_n))
    conn.commit()
    return {"doc_id": doc_id, "unit_n": unit_n, "unit_role": role}


def bulk_set_unit_role(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Assign (or clear) a role on many units (POST /units/bulk_set_role).

    Two calling conventions:
      A) {unit_ids: [int], role_name: str|null}  — by primary key
      B) {doc_id: int, unit_ns: [int], role: str|null}  — legacy, by (doc, n)
    Raises BadRequestError / NotFoundError. Empty id list -> {"updated": 0}.
    """
    unit_ids_raw = body.get("unit_ids")
    if unit_ids_raw is not None:
        # Format A — unit_ids + role_name
        if not isinstance(unit_ids_raw, list):
            raise BadRequestError("unit_ids must be an array")
        try:
            unit_ids = [int(i) for i in unit_ids_raw]
        except (TypeError, ValueError):
            raise BadRequestError("unit_ids values must be integers")
        role = (body.get("role_name") or "").strip() or None
        if not unit_ids:
            return {"updated": 0}
        if role is not None and not _role_exists(conn, role):
            raise NotFoundError(f"Convention '{role}' not found")
        placeholders = ",".join("?" * len(unit_ids))
        result = conn.execute(
            f"UPDATE units SET unit_role=? WHERE unit_id IN ({placeholders})",
            [role, *unit_ids],
        )
        conn.commit()
        return {"updated": result.rowcount}

    # Format B — doc_id + unit_ns + role (legacy)
    doc_id = body.get("doc_id")
    unit_ns_raw = body.get("unit_ns")
    if doc_id is None or unit_ns_raw is None:
        raise BadRequestError("unit_ids (or doc_id and unit_ns) are required")
    if not isinstance(unit_ns_raw, list):
        raise BadRequestError("unit_ns must be an array")
    try:
        doc_id = int(doc_id)
        unit_ns = [int(n) for n in unit_ns_raw]
    except (TypeError, ValueError):
        raise BadRequestError("doc_id and unit_ns values must be integers")
    if not unit_ns:
        return {"updated": 0}
    role = (body.get("role") or "").strip() or None
    if role is not None and not _role_exists(conn, role):
        raise NotFoundError(f"Convention '{role}' not found")
    placeholders = ",".join("?" * len(unit_ns))
    result = conn.execute(
        f"UPDATE units SET unit_role=? WHERE doc_id=? AND n IN ({placeholders})",
        [role, doc_id, *unit_ns],
    )
    conn.commit()
    return {"updated": result.rowcount}


_UPDATE_TEXT_SCHEMA = (Field("unit_id", int, coerce=True, error=BadRequestError),)


def update_unit_text(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Update text_raw and/or text_norm for one unit (POST /units/update_text).

    At least one of text_raw / text_norm is required; if only text_raw is given it
    is mirrored to text_norm. Reindexes FTS (best-effort). Raises BadRequestError
    or NotFoundError (unknown unit_id).
    """
    unit_id = validate(body, _UPDATE_TEXT_SCHEMA)["unit_id"]

    text_raw = body.get("text_raw")
    text_norm = body.get("text_norm")
    if text_raw is None and text_norm is None:
        raise BadRequestError("At least one of text_raw or text_norm must be provided")
    for field, val in (("text_raw", text_raw), ("text_norm", text_norm)):
        if val is not None and not isinstance(val, str):
            raise BadRequestError(f"{field} must be a string")

    if text_raw is not None and text_norm is None:
        text_norm = text_raw  # mirror

    updates: dict[str, str] = {}
    if text_raw is not None:
        updates["text_raw"] = text_raw
    if text_norm is not None:
        updates["text_norm"] = text_norm

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    params = [*updates.values(), unit_id]
    cur = conn.execute(f"UPDATE units SET {set_clause} WHERE unit_id = ?", params)
    if cur.rowcount == 0:
        raise NotFoundError(f"Unknown unit_id: {unit_id}")
    # Invalidate / refresh FTS entry for this unit (best-effort). Only ``line``
    # units are indexed: never (re)insert a ``structure`` unit into FTS (ENG-04).
    # The DELETE runs unconditionally so any stale/orphan row is still cleared.
    try:
        conn.execute("DELETE FROM fts_units WHERE rowid = ?", (unit_id,))
        if "text_norm" in updates:
            ut = conn.execute(
                "SELECT unit_type FROM units WHERE unit_id = ?", (unit_id,)
            ).fetchone()
            if ut is not None and ut[0] == "line":
                conn.execute(
                    "INSERT INTO fts_units(rowid, text_norm) VALUES (?, ?)",
                    (unit_id, updates["text_norm"]),
                )
    except Exception:
        pass  # FTS update is best-effort
    conn.commit()
    row = conn.execute(
        "SELECT unit_id, doc_id, n, external_id, text_raw, text_norm FROM units WHERE unit_id = ?",
        (unit_id,),
    ).fetchone()
    return {
        "unit_id": row[0], "doc_id": row[1], "n": row[2],
        "external_id": row[3], "text_raw": row[4], "text_norm": row[5],
    }
