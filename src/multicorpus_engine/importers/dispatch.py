"""Central mode→importer dispatch.

Single source of truth for routing an import *mode* to its importer. Shared by
the CLI (``import`` and ``import-remote``); the sidecar's ``/import`` handler is
expected to converge on this helper (see docs/TICKET_SHAREDOCS_INGESTION_P2_SIDECAR.md)
so the mode→importer mapping lives in exactly one place.

Lazy imports keep each importer's optional dependencies (python-docx, defusedxml,
…) off the import path for modes that do not need them.
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Optional

#: Import modes accepted by :func:`dispatch_import` — kept in sync with the CLI
#: ``--mode`` choices.
IMPORT_MODES = (
    "docx_numbered_lines",
    "txt_numbered_lines",
    "docx_paragraphs",
    "odt_paragraphs",
    "odt_numbered_lines",
    "tei",
    "conllu",
)


def dispatch_import(
    conn: sqlite3.Connection,
    *,
    mode: str,
    path: str | Path,
    language: Optional[str],
    title: Optional[str] = None,
    doc_role: str = "standalone",
    resource_type: Optional[str] = None,
    tei_unit: str = "p",
    column_index: Optional[int] = None,
    run_id: Optional[str] = None,
    run_logger: Optional[logging.Logger] = None,
):
    """Route to the importer for *mode* and return its ``ImportReport``.

    The ``ImportReport`` exposes ``doc_id`` (via ``to_dict()``), which callers
    use to attach provenance after the import.

    Raises ``ValueError`` for an unknown *mode*. ``column_index`` and ``tei_unit``
    are only meaningful for ``docx_numbered_lines`` and ``tei`` respectively; they
    are ignored for the other modes.
    """
    if mode == "docx_numbered_lines":
        from .docx_numbered_lines import import_docx_numbered_lines
        return import_docx_numbered_lines(
            conn=conn, path=path, language=language, title=title,
            doc_role=doc_role, resource_type=resource_type,
            column_index=column_index, run_id=run_id, run_logger=run_logger,
        )
    if mode == "txt_numbered_lines":
        from .txt import import_txt_numbered_lines
        return import_txt_numbered_lines(
            conn=conn, path=path, language=language, title=title,
            doc_role=doc_role, resource_type=resource_type,
            run_id=run_id, run_logger=run_logger,
        )
    if mode == "docx_paragraphs":
        from .docx_paragraphs import import_docx_paragraphs
        return import_docx_paragraphs(
            conn=conn, path=path, language=language, title=title,
            doc_role=doc_role, resource_type=resource_type,
            run_id=run_id, run_logger=run_logger,
        )
    if mode == "odt_paragraphs":
        from .odt_paragraphs import import_odt_paragraphs
        return import_odt_paragraphs(
            conn=conn, path=path, language=language, title=title,
            doc_role=doc_role, resource_type=resource_type,
            run_id=run_id, run_logger=run_logger,
        )
    if mode == "odt_numbered_lines":
        from .odt_numbered_lines import import_odt_numbered_lines
        return import_odt_numbered_lines(
            conn=conn, path=path, language=language, title=title,
            doc_role=doc_role, resource_type=resource_type,
            run_id=run_id, run_logger=run_logger,
        )
    if mode == "tei":
        from .tei_importer import import_tei
        return import_tei(
            conn=conn, path=path, language=language, title=title,
            doc_role=doc_role, resource_type=resource_type,
            unit_element=tei_unit, run_id=run_id, run_logger=run_logger,
        )
    if mode == "conllu":
        from .conllu import import_conllu
        return import_conllu(
            conn=conn, path=path, language=language, title=title,
            doc_role=doc_role, resource_type=resource_type,
            run_id=run_id, run_logger=run_logger,
        )
    raise ValueError(f"Unknown import mode: {mode!r}")
