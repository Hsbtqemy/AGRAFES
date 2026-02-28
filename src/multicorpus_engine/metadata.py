"""Metadata schema and validation for documents.

Validates document metadata and returns warnings for missing or suspicious fields.
Does NOT block operations — warnings are advisory only.
See docs/DECISIONS.md ADR-010.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field


_DOC_ROLE_VALUES = frozenset(
    {"original", "translation", "excerpt", "standalone", "unknown"}
)

_REQUIRED_FIELDS = ["title", "language"]
_RECOMMENDED_FIELDS = ["source_path", "source_hash", "doc_role", "resource_type"]


@dataclass
class MetaValidationResult:
    doc_id: int
    title: str
    warnings: list[str] = field(default_factory=list)
    is_valid: bool = True  # False only if required field missing

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "title": self.title,
            "is_valid": self.is_valid,
            "warnings": self.warnings,
        }


def validate_document(conn: sqlite3.Connection, doc_id: int) -> MetaValidationResult:
    """Validate metadata for a single document. Returns warnings, never raises."""
    row = conn.execute(
        "SELECT * FROM documents WHERE doc_id = ?", (doc_id,)
    ).fetchone()
    if row is None:
        return MetaValidationResult(
            doc_id=doc_id,
            title="<not found>",
            warnings=[f"Document doc_id={doc_id} does not exist"],
            is_valid=False,
        )

    title = row["title"] or ""
    warnings: list[str] = []
    is_valid = True

    # Required fields
    for field_name in _REQUIRED_FIELDS:
        val = row[field_name]
        if not val or (isinstance(val, str) and not val.strip()):
            warnings.append(f"Required field '{field_name}' is empty")
            is_valid = False

    # Recommended fields
    for field_name in _RECOMMENDED_FIELDS:
        val = row[field_name]
        if not val or (isinstance(val, str) and not val.strip()):
            warnings.append(f"Recommended field '{field_name}' is empty")

    # doc_role validity
    doc_role = row["doc_role"]
    if doc_role and doc_role not in _DOC_ROLE_VALUES:
        warnings.append(
            f"doc_role={doc_role!r} is not a recognised value "
            f"(expected one of {sorted(_DOC_ROLE_VALUES)})"
        )

    # Unit count sanity
    line_count = conn.execute(
        "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line'",
        (doc_id,),
    ).fetchone()[0]
    if line_count == 0:
        warnings.append("Document has no line units (nothing indexed in FTS)")

    return MetaValidationResult(
        doc_id=doc_id,
        title=title,
        warnings=warnings,
        is_valid=is_valid,
    )


def validate_all_documents(
    conn: sqlite3.Connection,
) -> list[MetaValidationResult]:
    """Validate metadata for every document in the DB."""
    doc_ids = [
        row[0] for row in conn.execute("SELECT doc_id FROM documents ORDER BY doc_id")
    ]
    return [validate_document(conn, doc_id) for doc_id in doc_ids]
