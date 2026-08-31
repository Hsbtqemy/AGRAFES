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

import json
import sqlite3
from typing import Any, Optional

from ..indexer import index_failure, stale_doc_ids
from ..runs import utcnow_iso
from .errors import BadRequestError, NotFoundError, ValidationError
from .step_status_service import step_status_map
from .validation import Field, validate

DOC_WORKFLOW_STATUSES = {"draft", "review", "validated"}

# R6.3 — user-entered type-specific / ad-hoc metadata fields live under this key in
# documents.meta_json, kept apart from importer-written provenance keys (e.g. TXT's
# "encoding", CoNLL-U's "import_mode"/"sentences") so a metadata save never clobbers them.
_META_FIELDS_KEY = "fields"


def _parse_doc_meta(raw: Any) -> Optional[dict]:
    """Best-effort parse of a document's ``meta_json`` column into a dict.

    Returns None for NULL/empty/unparseable/non-object values (never raises) so the
    read path exposes ``meta_json: null`` rather than an empty object in that case.
    """
    if not raw:
        return None
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _clean_meta_fields(meta: dict) -> dict[str, str]:
    """Normalise a raw ``meta`` dict into the stored ``fields`` map.

    Fields are text-like: only scalar ``str``/``int``/``float`` values are kept (numbers
    stringified), trimmed, with empty/whitespace dropped. ``None`` (an explicit clear),
    ``bool`` (a JSON ``false`` must not become the truthy string ``"False"``) and
    containers (``list``/``dict`` — their Python repr is not valid data) are all dropped
    rather than stringified. Keys are stringified.
    """
    cleaned: dict[str, str] = {}
    for k, v in meta.items():
        if isinstance(v, bool) or not isinstance(v, (str, int, float)):
            continue
        s = (v if isinstance(v, str) else str(v)).strip()
        if s:
            cleaned[str(k)] = s
    return cleaned

# Columns a client may set via update / bulk_update.
_UPDATABLE = {
    "title", "language", "doc_role", "resource_type",
    "workflow_status", "validated_run_id",
    "author_lastname", "author_firstname", "doc_date",
    "translator_lastname", "translator_firstname",
    "work_title", "pub_place", "publisher",
    "notes",  # R6.1 — document-level free-text memo (≠ doc_relations.note)
}

_NO_FIELDS_MSG = (
    "No updatable fields provided "
    "(allowed: title, language, doc_role, resource_type, workflow_status, validated_run_id, "
    "author_lastname, author_firstname, doc_date, translator_lastname, translator_firstname, "
    "work_title, pub_place, publisher, notes)"
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
           d.work_title, d.pub_place, d.publisher, d.notes, d.meta_json
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
           work_title, pub_place, publisher, notes, meta_json
    FROM documents
    WHERE doc_id = ?
"""


# ACT-01 — les deux états par document que la liste ne savait pas montrer.
#
# `curated_at` : la curation n'a AUCUNE colonne dédiée, mais la trace existe déjà —
# `prep_action_history` est écrit par le moteur lui-même à chaque apply qui modifie du
# texte, sur les DEUX portées (un document, ou tout le corpus : `curate_all_documents`
# rappelle le même recorder par document). C'est ce qui la sépare de
# `curation_apply_history` (migration 007), dont le `doc_id` est NULL dès la portée
# « tout le corpus » et qui n'est écrite qu'à la demande du front. Une passe annulée
# (`reverted = 1`) ne compte pas : le témoin suit le texte, pas l'historique.
#
# Limite assumée : un apply qui ne change rien n'écrit pas de ligne, donc un document
# curé sans effet reste « jamais curé ». C'est le sens utile ici — ce qu'on lit est
# « ce texte a été modifié par la curation », pas « quelqu'un a cliqué Appliquer ».
_CURATED_AT_SQL = """
    SELECT doc_id, MAX(performed_at)
    FROM prep_action_history
    WHERE action_type = 'curation_apply' AND reverted = 0
    GROUP BY doc_id
"""

# `aligned_count` : nombre de liens touchant le document, dans un sens comme dans l'autre.
# Servi ici plutôt que déduit de /families, qui ne connaît que les documents EN famille —
# un document isolé y est simplement absent, donc muet sur son alignement.
_ALIGNED_COUNT_SQL = """
    SELECT doc_id, SUM(n) FROM (
        SELECT pivot_doc_id  AS doc_id, COUNT(*) AS n FROM alignment_links GROUP BY pivot_doc_id
        UNION ALL
        SELECT target_doc_id AS doc_id, COUNT(*) AS n FROM alignment_links GROUP BY target_doc_id
    ) GROUP BY doc_id
"""


def _derived_doc_state(conn: sqlite3.Connection) -> tuple[dict[int, str], dict[int, int]]:
    """(curated_at, aligned_count) par doc_id — deux agrégats, jamais d'exception.

    Les deux tables sont créées par migration, mais une base ouverte avant celle-ci
    (ou réparée à la main) peut ne pas les porter : l'absence d'état se lit alors
    « aucun », comme pour un corpus neuf, plutôt que de faire échouer tout /documents.
    """
    curated: dict[int, str] = {}
    aligned: dict[int, int] = {}
    try:
        curated = {int(r[0]): str(r[1]) for r in conn.execute(_CURATED_AT_SQL) if r[1]}
    except sqlite3.Error:
        pass
    try:
        aligned = {int(r[0]): int(r[1] or 0) for r in conn.execute(_ALIGNED_COUNT_SQL)}
    except sqlite3.Error:
        pass
    return curated, aligned


def list_documents(conn: sqlite3.Connection) -> dict[str, Any]:
    """List every document with derived counts + FTS staleness (GET /documents).

    The caller must run the schema backfill (``_ensure_document_workflow_columns`` /
    ``_ensure_tokens_table``) first; those manage schema and hold the lock.
    """
    rows = conn.execute(_LIST_SQL).fetchall()
    stale_ids = stale_doc_ids(conn)  # derived, no persisted flag
    curated_at, aligned_count = _derived_doc_state(conn)  # ACT-01, dérivés eux aussi
    # `stale_ids` vide veut dire deux choses opposées — rien à réindexer, ou index
    # illisible, `stale_doc_ids` avalant l'erreur SQL. Sans ce second signal, une base
    # abîmée s'affichait « ✓ Index à jour » (FTS-01).
    #
    # `fts_repairable` (1.6.86) tranche la question suivante, que le front ne peut pas
    # trancher seul : des deux pannes, une seule se répare depuis l'application. Le
    # moteur la nomme ici plutôt que d'exposer la taxonomie — l'écran a besoin de savoir
    # s'il peut proposer un bouton, pas de connaître les modes de défaillance de FTS5.
    fts_failure = index_failure(conn)  # une seule sonde pour les deux drapeaux
    fts_readable = fts_failure is None
    # La couche MANUELLE du statut par étape (ACT-01). Les deux autres états restent
    # dérivés de `unit_count`/`aligned_count`/`annotation_status`/`curated_at` ci-dessus ;
    # seul le `[X]` se stocke, et il arrive ici avec son verdict de péremption.
    #
    # Les quatre valeurs auxquelles chaque coche sera comparée sont DÉJÀ là — deux dans
    # `_LIST_SQL`, deux dans `_derived_doc_state`. On les passe plutôt que de les faire
    # recalculer : mesuré sur le corpus de travail au pire cas (232 coches), la lecture
    # tombe de 46 ms à quelques ms, et `/documents` de 208 ms à sa valeur sans coche.
    derived_for_marks = {
        r[0]: {
            "unit_count": r[10], "token_count": r[11],
            "aligned_count": aligned_count.get(r[0], 0),
            "curated_at": curated_at.get(r[0]),
        }
        for r in rows
    }
    step_status = step_status_map(conn, derived_for_marks)
    documents = [
        {
            "doc_id": r[0], "title": r[1], "language": r[2], "doc_role": r[3],
            "resource_type": r[4], "workflow_status": r[5], "validated_at": r[6],
            "validated_run_id": r[7], "source_path": r[8], "source_hash": r[9],
            "unit_count": r[10], "token_count": r[11], "annotation_status": r[12],
            "author_lastname": r[13], "author_firstname": r[14], "doc_date": r[15],
            "text_start_n": r[16], "translator_lastname": r[17],
            "translator_firstname": r[18], "work_title": r[19], "pub_place": r[20],
            "publisher": r[21], "notes": r[22], "meta_json": _parse_doc_meta(r[23]),
            "fts_stale": r[0] in stale_ids,
            "curated_at": curated_at.get(r[0]),
            "aligned_count": aligned_count.get(r[0], 0),
            "step_status": step_status.get(r[0], {}),
        }
        for r in rows
    ]
    return {
        "documents": documents,
        "count": len(documents),
        "fts_readable": fts_readable,
        # Faux quand l'index se lit : il n'y a alors rien à réparer. « Réparable » ne
        # veut pas dire « à réparer ».
        "fts_repairable": fts_failure == "declaration-missing",
    }


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

    Besides the flat ``_UPDATABLE`` columns, accepts an optional ``meta`` object
    (R6.3) — user-entered type-specific / ad-hoc fields. It is *merged* into
    ``documents.meta_json`` under the ``fields`` key, replacing that sub-object while
    preserving sibling provenance keys written by importers (e.g. ``encoding``). Empty
    values are dropped; an empty result clears the ``fields`` key.

    Raises BadRequestError (no doc_id / no fields / bad meta), ValidationError
    (workflow rules) or NotFoundError (unknown doc_id).
    """
    doc_id = validate(body, _UPDATE_DOC_SCHEMA)["doc_id"]
    updates = {k: v for k, v in body.items() if k in _UPDATABLE}

    meta_in = body.get("meta")
    if meta_in is not None and not isinstance(meta_in, dict):
        raise BadRequestError("meta must be an object")
    if not updates and meta_in is None:
        raise BadRequestError(_NO_FIELDS_MSG)

    _coerce_workflow_fields(updates)

    if meta_in is not None:
        row = conn.execute(
            "SELECT meta_json FROM documents WHERE doc_id = ?", (doc_id,)
        ).fetchone()
        existing = (_parse_doc_meta(row[0]) if row is not None else None) or {}
        cleaned = _clean_meta_fields(meta_in)
        if cleaned:
            existing[_META_FIELDS_KEY] = cleaned
        else:
            existing.pop(_META_FIELDS_KEY, None)
        # Column write goes through the same SET clause as the flat fields below.
        updates["meta_json"] = json.dumps(existing, ensure_ascii=False) if existing else None

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    params = list(updates.values()) + [doc_id]
    # Wrap the write so a bad param binding can't leave a dangling transaction on the
    # shared sidecar connection (audit SID-03 — matches bulk_update/delete discipline).
    try:
        cur = conn.execute(f"UPDATE documents SET {set_clause} WHERE doc_id = ?", params)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    if cur.rowcount == 0:
        raise NotFoundError(f"Document doc_id={doc_id} not found")

    row = conn.execute(_UPDATED_DOC_SQL, (doc_id,)).fetchone()
    doc = {
        "doc_id": row[0], "title": row[1], "language": row[2], "doc_role": row[3],
        "resource_type": row[4], "workflow_status": row[5], "validated_at": row[6],
        "validated_run_id": row[7], "author_lastname": row[8], "author_firstname": row[9],
        "doc_date": row[10], "translator_lastname": row[11], "translator_firstname": row[12],
        "work_title": row[13], "pub_place": row[14], "publisher": row[15], "notes": row[16],
        "meta_json": _parse_doc_meta(row[17]),
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
