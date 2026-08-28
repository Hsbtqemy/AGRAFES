"""Import domain service (audit P0-1 tranche-1, A-01/A-02).

Domain logic extracted verbatim from the sidecar ``_handle_import`` handler so it
can be tested without a running HTTP server (unblocks T-02) and so the
mode->importer mapping lives in exactly one place (``dispatch_import``).

The function is pure w.r.t. transport: it takes a connection + the raw request
body, performs the import, records the run, optionally links a family relation,
and returns the response *data* (no HTTP envelope). The caller (the sidecar
adapter) owns the write-lock and maps :class:`ServiceError` to wire error codes.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from ..importers.dispatch import IMPORT_MODES, dispatch_import
from ..runs import create_run, update_run_stats
from .errors import NotFoundError, ValidationError


def import_document(conn: sqlite3.Connection, body: dict) -> dict[str, Any]:
    """Validate + run the import described by *body*; return the response data.

    Raises:
        ValidationError  bad input, unknown mode, or an importer
                         ``ValueError`` / ``FileNotFoundError`` (-> 400).
        NotFoundError    ``family_root_doc_id`` does not exist (-> 404).
    """
    mode = body.get("mode")
    # Normalise legacy/malformed mode values (e.g. "odt paragraphs" -> "odt_paragraphs").
    if isinstance(mode, str):
        mode = mode.strip().lower().replace(" ", "_").replace("-", "_")
    path = body.get("path")
    language = body.get("language")
    title = body.get("title")
    doc_role = body.get("doc_role", "standalone")
    resource_type = body.get("resource_type")
    tei_unit = body.get("tei_unit", "p")
    check_filename = bool(body.get("check_filename", False))

    # column_index: 2-col tables, honoré par les deux modes DOCX — lignes numérotées,
    # et paragraphes depuis IMPO-01, seule porte d'entrée d'un tableau non numéroté.
    # Validé ici, ignoré par les autres modes.
    column_index_raw = body.get("column_index")
    column_index: int | None = None
    if column_index_raw is not None:
        try:
            column_index = int(column_index_raw)
        except (TypeError, ValueError):
            raise ValidationError("column_index must be an integer >= 1 or null")
        if column_index < 1:
            raise ValidationError("column_index must be >= 1")

    family_root_doc_id = body.get("family_root_doc_id")
    if family_root_doc_id is not None:
        try:
            family_root_doc_id = int(family_root_doc_id)
        except (TypeError, ValueError):
            raise ValidationError("family_root_doc_id must be an integer")

    if not isinstance(mode, str) or not mode:
        raise ValidationError("mode is required and must be a string")
    if not isinstance(path, str) or not path:
        raise ValidationError("path is required and must be a string")
    if "\x00" in path:
        raise ValidationError("Invalid path")
    path = str(Path(path).resolve())
    if mode != "tei" and (not isinstance(language, str) or not language):
        raise ValidationError("language is required for non-TEI import modes")
    if mode not in IMPORT_MODES:
        raise ValidationError(f"Unsupported import mode: {mode!r}")

    params = {
        "mode": mode,
        "path": path,
        "language": language,
        "title": title,
        "doc_role": doc_role,
        "resource_type": resource_type,
        "tei_unit": tei_unit,
        "column_index": column_index,
    }

    run_id = create_run(conn, "import", params)
    try:
        report = dispatch_import(
            conn,
            mode=mode,
            path=path,
            language=language,
            title=title,
            doc_role=doc_role,
            resource_type=resource_type,
            tei_unit=tei_unit,
            column_index=column_index,
            run_id=run_id,
            check_filename=check_filename,
        )
    except (FileNotFoundError, ValueError) as exc:
        raise ValidationError(str(exc))

    stats = report.to_dict()
    update_run_stats(conn, run_id, stats)

    relation_created = False
    relation_id: int | None = None
    if family_root_doc_id is not None:
        new_doc_id = stats.get("doc_id")
        if isinstance(new_doc_id, int):
            parent_exists = conn.execute(
                "SELECT 1 FROM documents WHERE doc_id = ?", (family_root_doc_id,)
            ).fetchone()
            if not parent_exists:
                raise NotFoundError(f"family_root_doc_id {family_root_doc_id} not found")
            existing = conn.execute(
                """SELECT id FROM doc_relations
                   WHERE doc_id = ? AND target_doc_id = ?
                     AND relation_type = 'translation_of'""",
                (new_doc_id, family_root_doc_id),
            ).fetchone()
            if existing:
                relation_id = existing[0]
            else:
                # created_at is NOT NULL with no default (003_alignment.sql). The
                # original _handle_import INSERT omitted it, so this path always
                # raised IntegrityError (500) — a latent bug the service extraction
                # surfaced (T-02). Supply it like the other doc_relations inserts.
                cur = conn.execute(
                    """INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at)
                       VALUES (?, 'translation_of', ?, datetime('now'))""",
                    (new_doc_id, family_root_doc_id),
                )
                conn.commit()
                relation_id = cur.lastrowid
                relation_created = True

    return {
        "run_id": run_id,
        "mode": mode,
        "relation_created": relation_created,
        **({"relation_id": relation_id} if relation_id is not None else {}),
        **stats,
    }


def preview_text_units(
    fpath: "Path", mode: str, limit: int, column_index: "int | None" = None
) -> "tuple[list[dict], int, list[dict] | None, int, int]":
    """Parse a file without writing to DB. Returns (units[:limit], total_count).

    Each unit dict: { n, external_id, unit_type, text_raw }
    Supported modes: txt_numbered_lines, docx_numbered_lines, docx_paragraphs,
                     odt_numbered_lines, odt_paragraphs, tei.

    A-02: every mode goes through the importer's own ``parse_<mode>`` so the
    preview shows EXACTLY what an import would write — no parsing is
    reimplemented here.

    IMPO-01 : ``column_index`` manquait ici pour **tous** les modes, si bien
    qu'aucun aperçu d'une extraction par colonne n'était possible — l'aperçu
    montrait zéro unité là où l'import en écrivait des centaines. Il n'a de
    sens que pour les deux modes DOCX ; ailleurs il est ignoré, comme au
    dispatch.

    Sortie de ``sidecar.py`` le 28 août 2026 (SD-01) : elle ne touchait déjà jamais
    ``self``, et la sonde distante ``/webdav/probe`` doit l'appeler sur un fichier
    téléchargé en temporaire. Extraction **mécanique**, corps inchangé.

    Note de contrat : le ``ValueError`` du mode non supporté est aujourd'hui absorbé
    par le ``except Exception`` de ``_handle_import_preview``, qui répond **500**. Un
    nouvel appelant est libre de le mapper autrement ; ce n'est pas une erreur typée
    de ``services/errors.py`` parce que la rendre telle changerait le code de réponse
    historique de ``/import/preview``, que le gel du contrat protège.
    """
    from multicorpus_engine.importers import (
        docx_numbered_lines, docx_paragraphs,
        odt_numbered_lines, odt_paragraphs, tei_importer, txt,
    )
    from multicorpus_engine.importers.parsed import to_preview

    if mode in ("txt_numbered_lines", "txt"):
        parsed = txt.parse_txt_numbered_lines(fpath)
    elif mode in ("docx_numbered_lines", "docx"):
        parsed = docx_numbered_lines.parse_docx_numbered_lines(
            fpath, column_index=column_index
        )
    elif mode == "docx_paragraphs":
        parsed = docx_paragraphs.parse_docx_paragraphs(
            fpath, column_index=column_index
        )
    elif mode in ("odt_numbered_lines", "odt"):
        parsed = odt_numbered_lines.parse_odt_numbered_lines(fpath)
    elif mode == "odt_paragraphs":
        parsed = odt_paragraphs.parse_odt_paragraphs(fpath)
    elif mode == "tei":
        parsed = tei_importer.parse_tei(fpath)
    else:
        raise ValueError(f"Preview not supported for mode '{mode}'")

    units, total = to_preview(parsed.units, limit)
    # IMPO-01 — la forme des tables (`{columns, rows}` en ordre de lecture) ne
    # remonte que pour les modes qui savent en extraire une colonne, donc les deux
    # modes DOCX. `None` ailleurs : ne rien promettre qu'on ne sait pas honorer,
    # l'ODT portant des tables mais aucun parcours par colonne.
    tables = parsed.stats.get("tables") if isinstance(parsed.stats, dict) else None
    # IMPO-01 — les comptes par type, calculés sur TOUTES les unités et non sur les
    # `limit` rapatriées. Sans eux, l'aperçu comparatif devait redemander le document
    # entier par mode juste pour compter ses unités indexables : ~110 Ko de texte sur
    # la boucle locale, deux fois, pour deux entiers que le parse tient déjà.
    units_line = sum(1 for u in parsed.units if u.unit_type == "line")
    return units, total, tables, units_line, total - units_line
