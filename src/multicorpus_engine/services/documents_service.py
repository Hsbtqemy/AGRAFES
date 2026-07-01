"""Documents domain service — audit P0-1 / A-01.

CRUD over the ``documents`` table (metadata + workflow status), extracted verbatim
from the sidecar ``_handle_documents*`` handlers. Pure w.r.t. transport: each
function takes a connection + request inputs, mutates the DB, returns response
*data*. The sidecar adapter owns the write-lock (writes), the HTTP envelope, the
schema backfill (``_ensure_*`` — they manage schema + take the lock) and the
``doc_deleted`` telemetry emit (server-coupled). Error mapping is per-type:
``BadRequestError`` -> ERR_BAD_REQUEST, ``ValidationError`` -> ERR_VALIDATION,
``NotFoundError`` -> ERR_NOT_FOUND — exactly the codes the handlers used.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from ..indexer import stale_doc_ids
from ..runs import utcnow_iso
from .errors import BadRequestError, NotFoundError, ValidationError
from .validation import Field, validate

DOC_WORKFLOW_STATUSES = {"draft", "review", "validated"}

# Columns a client may set via update / bulk_update.
_UPDATABLE = {
    "title", "language", "doc_role", "resource_type",
    "workflow_status", "validated_run_id",
    "author_lastname", "author_firstname", "doc_date",
    "translator_lastname", "translator_firstname",
    "work_title", "pub_place", "publisher",
}

_NO_FIELDS_MSG = (
    "No updatable fields provided "
    "(allowed: title, language, doc_role, resource_type, workflow_status, validated_run_id, "
    "author_lastname, author_firstname, doc_date, translator_lastname, translator_firstname, "
    "work_title, pub_place, publisher)"
)

_LIST_SQL = """
    SELECT d.doc_id, d.title, d.language, d.doc_role, d.resource_type,
           d.workflow_status, d.validated_at, d.validated_run_id,
           d.source_path, d.source_hash,
           COALESCE(uc.unit_count, 0) AS unit_count,
           COALESCE(tc.token_count, 0) AS token_count,
           CASE WHEN COALESCE(tc.token_count, 0) > 0 THEN 'annotated' ELSE 'missing' END AS annotation_status,
           d.author_lastname, d.author_firstname, d.doc_date,
           d.text_start_n,
           d.translator_lastname, d.translator_firstname,
           d.work_title, d.pub_place, d.publisher
    FROM documents d
    LEFT JOIN (
        SELECT doc_id, COUNT(*) AS unit_count
        FROM units
        WHERE unit_type = 'line'
        GROUP BY doc_id
    ) uc ON uc.doc_id = d.doc_id
    LEFT JOIN (
        SELECT u.doc_id, COUNT(t.token_id) AS token_count
        FROM units u
        JOIN tokens t ON t.unit_id = u.unit_id
        GROUP BY u.doc_id
    ) tc ON tc.doc_id = d.doc_id
    ORDER BY d.doc_id
"""

_UPDATED_DOC_SQL = """
    SELECT doc_id, title, language, doc_role, resource_type,
           workflow_status, validated_at, validated_run_id,
           author_lastname, author_firstname, doc_date,
           translator_lastname, translator_firstname,
           work_title, pub_place, publisher
    FROM documents
    WHERE doc_id = ?
"""


def list_documents(conn: sqlite3.Connection) -> dict[str, Any]:
    """List every document with derived counts + FTS staleness (GET /documents).

    The caller must run the schema backfill (``_ensure_document_workflow_columns`` /
    ``_ensure_tokens_table``) first; those manage schema and hold the lock.
    """
    rows = conn.execute(_LIST_SQL).fetchall()
    stale_ids = stale_doc_ids(conn)  # derived, no persisted flag
    documents = [
        {
            "doc_id": r[0], "title": r[1], "language": r[2], "doc_role": r[3],
            "resource_type": r[4], "workflow_status": r[5], "validated_at": r[6],
            "validated_run_id": r[7], "source_path": r[8], "source_hash": r[9],
            "unit_count": r[10], "token_count": r[11], "annotation_status": r[12],
            "author_lastname": r[13], "author_firstname": r[14], "doc_date": r[15],
            "text_start_n": r[16], "translator_lastname": r[17],
            "translator_firstname": r[18], "work_title": r[19], "pub_place": r[20],
            "publisher": r[21], "fts_stale": r[0] in stale_ids,
        }
        for r in rows
    ]
    return {"documents": documents, "count": len(documents)}


_STATS_LINE_SQL = """
    SELECT COUNT(*) AS line_count,
           COALESCE(SUM(CASE WHEN external_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS external_id_count,
           COALESCE(SUM(CASE WHEN meta_json LIKE '%"parent_n"%' THEN 1 ELSE 0 END), 0) AS parent_count,
           COALESCE(MAX(LENGTH(text_raw)), 0) AS max_text_len,
           COALESCE(CAST(ROUND(AVG(LENGTH(text_raw))) AS INTEGER), 0) AS avg_text_len
    FROM units
    WHERE doc_id = ? AND unit_type = 'line'
"""


def document_stats(conn: sqlite3.Connection, doc_id_str: Any) -> dict[str, Any]:
    """Per-document stage stats for the canvas state strip (GET /documents/stats, R1.2).

    Read-only. Lets the front derive a document's *stage* (brut / grossier / fin /
    aligné) and the presence of the coarse parent grain without loading every unit:
    line/structure counts, external_id coverage (numbered → key-alignable), parent
    pointer count (``meta_json.parent_n`` — populated by R2), alignment-link count,
    and text-length stats (grossier vs fin). Raises BadRequestError (missing/invalid
    doc_id) or NotFoundError (unknown doc_id) — the codes the GET adapter maps.
    """
    if doc_id_str is None or str(doc_id_str).strip() == "":
        raise BadRequestError("doc_id query parameter is required")
    try:
        doc_id = int(doc_id_str)
    except (TypeError, ValueError):
        raise BadRequestError("doc_id must be an integer")

    if conn.execute("SELECT 1 FROM documents WHERE doc_id = ?", (doc_id,)).fetchone() is None:
        raise NotFoundError(f"Document doc_id={doc_id} not found")

    line = conn.execute(_STATS_LINE_SQL, (doc_id,)).fetchone()
    structure_count = conn.execute(
        "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'structure'", (doc_id,)
    ).fetchone()[0]
    aligned_count = conn.execute(
        "SELECT COUNT(*) FROM alignment_links WHERE pivot_doc_id = ? OR target_doc_id = ?",
        (doc_id, doc_id),
    ).fetchone()[0]

    return {
        "doc_id": doc_id,
        "line_count": line[0],
        "external_id_count": line[1],
        "parent_count": line[2],
        "max_text_len": line[3],
        "avg_text_len": line[4],
        "structure_count": structure_count,
        "aligned_count": aligned_count,
    }


def _coerce_workflow_fields(fields: dict) -> None:
    """Validate + normalise workflow_status / validated_run_id in-place (shared by
    update and bulk_update). Raises ValidationError on any rule violation."""
    workflow_status = fields.get("workflow_status")
    if workflow_status is not None:
        if not isinstance(workflow_status, str) or workflow_status not in DOC_WORKFLOW_STATUSES:
            raise ValidationError(
                "workflow_status must be one of: draft, review, validated",
                details={"supported_values": sorted(DOC_WORKFLOW_STATUSES)},
            )
        if workflow_status == "validated":
            fields.setdefault("validated_at", utcnow_iso())
            if "validated_run_id" in fields and fields["validated_run_id"] is not None:
                if not isinstance(fields["validated_run_id"], str) or not fields["validated_run_id"].strip():
                    raise ValidationError("validated_run_id must be a non-empty string or null")
                fields["validated_run_id"] = fields["validated_run_id"].strip()
        else:
            # Leaving validated state clears validation metadata.
            fields["validated_at"] = None
            fields["validated_run_id"] = None
    elif "validated_run_id" in fields:
        raise ValidationError("validated_run_id can only be set when workflow_status='validated'")


_UPDATE_DOC_SCHEMA = (Field("doc_id", required=True, error=BadRequestError),)


def update_document(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Update one document's metadata (POST /documents/update).

    Raises BadRequestError (no doc_id / no fields), ValidationError (workflow rules)
    or NotFoundError (unknown doc_id).
    """
    doc_id = validate(body, _UPDATE_DOC_SCHEMA)["doc_id"]
    updates = {k: v for k, v in body.items() if k in _UPDATABLE}
    if not updates:
        raise BadRequestError(_NO_FIELDS_MSG)

    _coerce_workflow_fields(updates)

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    params = list(updates.values()) + [doc_id]
    cur = conn.execute(f"UPDATE documents SET {set_clause} WHERE doc_id = ?", params)
    conn.commit()
    if cur.rowcount == 0:
        raise NotFoundError(f"Document doc_id={doc_id} not found")

    row = conn.execute(_UPDATED_DOC_SQL, (doc_id,)).fetchone()
    doc = {
        "doc_id": row[0], "title": row[1], "language": row[2], "doc_role": row[3],
        "resource_type": row[4], "workflow_status": row[5], "validated_at": row[6],
        "validated_run_id": row[7], "author_lastname": row[8], "author_firstname": row[9],
        "doc_date": row[10], "translator_lastname": row[11], "translator_firstname": row[12],
        "work_title": row[13], "pub_place": row[14], "publisher": row[15],
    }
    return {"updated": 1, "doc": doc}


_BULK_UPDATE_SCHEMA = (Field("updates", list, required=True, min=1, error=BadRequestError),)


def bulk_update_documents(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Update many documents in one transaction (POST /documents/bulk_update).

    Items with no doc_id or no updatable field are skipped. Raises BadRequestError
    (bad list) or ValidationError (workflow rules). Atomic: a ValidationError raised
    mid-loop rolls the whole batch back (audit SID-03 — the original handler left
    the earlier UPDATEs dangling in an uncommitted transaction on the shared conn).
    """
    updates_list = validate(body, _BULK_UPDATE_SCHEMA)["updates"]

    total_updated = 0
    try:
        for item in updates_list:
            doc_id = item.get("doc_id")
            if doc_id is None:
                continue
            fields = {k: v for k, v in item.items() if k in _UPDATABLE}
            if not fields:
                continue
            _coerce_workflow_fields(fields)
            set_clause = ", ".join(f"{k} = ?" for k in fields)
            params = list(fields.values()) + [doc_id]
            cur = conn.execute(f"UPDATE documents SET {set_clause} WHERE doc_id = ?", params)
            total_updated += cur.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"updated": total_updated}


_DELETE_DOCS_SCHEMA = (
    Field("doc_ids", list, required=True, min=1, items=int, error=BadRequestError),
)


def delete_documents(conn: sqlite3.Connection, body: dict) -> tuple[dict[str, Any], list[dict]]:
    """Delete documents + all linked data (POST /documents/delete).

    Returns ``(data, telemetry_entries)`` — the caller (adapter) emits the
    ``doc_deleted`` telemetry (server-coupled) post-commit. Raises BadRequestError
    on a bad ``doc_ids`` payload.
    """
    doc_ids = validate(body, _DELETE_DOCS_SCHEMA)["doc_ids"]
    placeholders = ",".join("?" * len(doc_ids))

    # Telemetry preview: collect had_curation/had_alignment BEFORE delete.
    telemetry_pre: list[dict] = []
    try:
        for did in doc_ids:
            had_cur = conn.execute(
                "SELECT 1 FROM curation_apply_history WHERE doc_id = ? LIMIT 1", (did,)
            ).fetchone() is not None
            had_align = conn.execute(
                "SELECT 1 FROM alignment_links WHERE pivot_doc_id = ? OR target_doc_id = ? LIMIT 1",
                (did, did),
            ).fetchone() is not None
            telemetry_pre.append(
                {"doc_id": did, "had_curation": had_cur, "had_alignment": had_align}
            )
    except Exception:  # noqa: BLE001
        pass  # telemetry must never block the delete

    # Atomic cascade: any failure mid-way rolls the whole delete back rather than
    # leaving partial deletions dangling in an uncommitted transaction on the
    # shared connection (audit SID-03).
    try:
        # 1. Collect unit_ids before deletion (needed for FTS cleanup).
        unit_ids: list[int] = [
            row[0] for row in conn.execute(
                f"SELECT unit_id FROM units WHERE doc_id IN ({placeholders})", doc_ids
            ).fetchall()
        ]
        # 2. alignment_links — pivot_doc_id / target_doc_id directly.
        conn.execute(
            f"DELETE FROM alignment_links"
            f" WHERE pivot_doc_id IN ({placeholders}) OR target_doc_id IN ({placeholders})",
            doc_ids + doc_ids,
        )
        # 3. FTS index — BEFORE units are deleted (rowid = unit_id).
        if unit_ids:
            fts_ph = ",".join("?" * len(unit_ids))
            try:
                conn.execute(f"DELETE FROM fts_units WHERE rowid IN ({fts_ph})", unit_ids)
            except Exception:
                pass  # FTS table may not exist
        # 4. Units — curation_exceptions cascade automatically (ON DELETE CASCADE).
        conn.execute(f"DELETE FROM units WHERE doc_id IN ({placeholders})", doc_ids)
        # 5. Doc relations.
        conn.execute(
            f"DELETE FROM doc_relations"
            f" WHERE doc_id IN ({placeholders}) OR target_doc_id IN ({placeholders})",
            doc_ids + doc_ids,
        )
        # 6. Curation apply history (doc_id without FK — orphaned rows).
        try:
            conn.execute(
                f"DELETE FROM curation_apply_history WHERE doc_id IN ({placeholders})", doc_ids
            )
        except Exception:
            pass  # table may not exist in older DBs
        # 7. Documents.
        cur = conn.execute(f"DELETE FROM documents WHERE doc_id IN ({placeholders})", doc_ids)
        deleted = cur.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    return {"deleted": deleted, "doc_ids": doc_ids}, telemetry_pre
