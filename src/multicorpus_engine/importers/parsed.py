"""Shared parse-layer types (audit P0-1 / A-02).

Each importer exposes a ``parse_<mode>(path) -> ParsedDoc`` that turns a file into
units WITHOUT touching the DB. Two consumers share that single parsing logic:
  - the importer's write path (``import_<mode>``) inserts the units;
  - the sidecar ``/import/preview`` projects them via :func:`to_preview`.
This removes the duplicate parsing the preview used to reimplement (A-02).
"""

from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


def file_sha256(path: str | Path) -> str:
    """Streaming SHA-256 of a file (audit Q-03: one definition, was duplicated in
    5 importers as ``_compute_file_hash``)."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class ParsedUnit:
    """One parsed unit, before it is assigned a doc_id and written."""

    n: int
    unit_type: str  # "line" | "structure"
    text_raw: str
    text_norm: str
    external_id: Optional[int] = None
    meta_json: Optional[str] = None
    unit_role: Optional[str] = None


@dataclass
class ParsedDoc:
    """Result of parsing a source file: its units + document-level metadata."""

    units: list[ParsedUnit] = field(default_factory=list)
    doc_meta: dict[str, Any] = field(default_factory=dict)  # -> document.meta_json
    source_hash: str = ""
    stats: dict[str, Any] = field(default_factory=dict)  # parse-derived diagnostics (e.g. docx tables)


def insert_units(conn: sqlite3.Connection, doc_id: int, units: list[ParsedUnit]) -> None:
    """Insert parsed units for *doc_id* — **single source of truth** for the units write
    path (was duplicated across the importers as ad-hoc ``INSERT INTO units``).

    One ``executemany`` covering all columns ; ``unit_role`` defaults to ``NULL`` when the
    importer didn't set it. The caller owns the transaction (no commit/rollback here).

    ``text_source`` (ADR-043) is set to ``text_raw`` here — the verbatim import text,
    captured once and never overwritten by curate/resegment/merge/split.
    """
    conn.executemany(
        "INSERT INTO units"
        " (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json, unit_role, text_source)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (doc_id, u.unit_type, u.n, u.external_id, u.text_raw, u.text_norm,
             u.meta_json, u.unit_role, u.text_raw)
            for u in units
        ],
    )


def to_preview(units: list[ParsedUnit], limit: int) -> tuple[list[dict], int]:
    """Project parsed units to the /import/preview shape: (units[:limit], total)."""
    total = len(units)
    preview = [
        {
            "n": u.n,
            "external_id": u.external_id,
            "unit_type": u.unit_type,
            "text_raw": u.text_raw,
        }
        for u in units[:limit]
    ]
    return preview, total
