"""Shared parse-layer types (audit P0-1 / A-02).

Each importer exposes a ``parse_<mode>(path) -> ParsedDoc`` that turns a file into
units WITHOUT touching the DB. Two consumers share that single parsing logic:
  - the importer's write path (``import_<mode>``) inserts the units;
  - the sidecar ``/import/preview`` projects them via :func:`to_preview`.
This removes the duplicate parsing the preview used to reimplement (A-02).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


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
