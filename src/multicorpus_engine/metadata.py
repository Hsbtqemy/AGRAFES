"""Metadata schema and validation for documents.

Validates document metadata and returns structured warnings.
Does NOT block operations — the sidecar returns warnings as advisory.
See docs/DECISIONS.md ADR-010.

Field classification (D1):
  Obligatoire  → is_valid=False when missing; blocks workflow validation
  Recommandé   → warning, non-blocking; affects corpus quality
  Optionnel    → not checked; stored transparently

  title          obligatoire  — human identifier, required for Concordancier display
  language       obligatoire  — required for multilingual concordance and alignment
  doc_role       recommandé   — alignment needs pivot/translation distinction
  resource_type  recommandé   — enables corpus filtering
  author_lastname recommandé  — enables citation formatting (F1)
  doc_date       optionnel    — stored if present, not required
  author_firstname optionnel
  source_path    technique    — set automatically at import, not user-facing
  source_hash    technique    — set automatically at import, not user-facing
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field


_DOC_ROLE_VALUES = frozenset(
    {"original", "translation", "excerpt", "standalone", "unknown"}
)

_RESOURCE_TYPE_VALUES = frozenset(
    {"text", "corpus", "parallel", "monolingual", "reference", "other"}
)

# BCP-47-like: 2–3 letter code, optional subtag
_LANGUAGE_RE = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")

# Flexible date: "2024", "2024-03", "2024-03-15"
_DATE_RE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")


@dataclass
class MetaValidationResult:
    doc_id: int
    title: str
    warnings: list[str] = field(default_factory=list)
    is_valid: bool = True  # False only if an obligatoire field is missing/invalid

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
            warnings=[f"Document doc_id={doc_id} introuvable"],
            is_valid=False,
        )

    title = (row["title"] or "").strip()
    warnings: list[str] = []
    is_valid = True

    # ── Obligatoires ────────────────────────────────────────────────────────
    if not title:
        warnings.append("Titre manquant (obligatoire)")
        is_valid = False

    language = (row["language"] or "").strip()
    if not language:
        warnings.append("Langue manquante (obligatoire)")
        is_valid = False
    elif not _LANGUAGE_RE.match(language):
        warnings.append(
            f"Code langue « {language} » invalide — utiliser un code BCP-47 (ex. fr, en, de)"
        )
        is_valid = False

    # ── Recommandés ─────────────────────────────────────────────────────────
    doc_role = (row["doc_role"] or "").strip()
    if not doc_role or doc_role == "standalone":
        # "standalone" is the schema default — warn only if language suggests a translation
        # but role wasn't explicitly set (standalone is fine for monolingual corpora).
        # Only warn if doc_role is completely absent.
        if not doc_role:
            warnings.append(
                "Rôle du document non défini (recommandé : original, translation, standalone…)"
            )
    elif doc_role not in _DOC_ROLE_VALUES:
        warnings.append(
            f"Rôle « {doc_role} » non reconnu "
            f"(valeurs : {', '.join(sorted(_DOC_ROLE_VALUES))})"
        )

    resource_type = (row["resource_type"] or "").strip()
    if not resource_type:
        warnings.append("Type de ressource non défini (recommandé : text, corpus, parallel…)")
    elif resource_type not in _RESOURCE_TYPE_VALUES:
        warnings.append(
            f"Type de ressource « {resource_type} » non reconnu "
            f"(valeurs : {', '.join(sorted(_RESOURCE_TYPE_VALUES))})"
        )

    author_lastname = (row["author_lastname"] or "").strip() if _col_exists(row, "author_lastname") else ""
    if not author_lastname:
        warnings.append("Nom d'auteur non renseigné (recommandé pour les citations)")

    # ── Optionnels : validation de format si présents ────────────────────────
    doc_date = (row["doc_date"] or "").strip() if _col_exists(row, "doc_date") else ""
    if doc_date and not _DATE_RE.match(doc_date):
        warnings.append(
            f"Format de date « {doc_date} » non reconnu — utiliser AAAA, AAAA-MM ou AAAA-MM-JJ"
        )

    # ── Sanity : unités indexées ─────────────────────────────────────────────
    line_count = conn.execute(
        "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line'",
        (doc_id,),
    ).fetchone()[0]
    if line_count == 0:
        warnings.append("Aucune unité indexée — lancer l'import ou vérifier le fichier source")

    return MetaValidationResult(
        doc_id=doc_id,
        title=title or f"#doc{doc_id}",
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


def _col_exists(row: sqlite3.Row, col: str) -> bool:
    """Return True if *col* is present in the sqlite3.Row (migration-safe)."""
    try:
        _ = row[col]
        return True
    except IndexError:
        return False
