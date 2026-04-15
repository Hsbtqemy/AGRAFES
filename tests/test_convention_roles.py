"""Tests for convention role persistence across curation and segmentation.

Covers:
- unit_role survives curation (text_norm is updated, unit_role untouched)
- unit_role is re-applied (best-effort) after resegment_document
- unit_role is re-applied (best-effort) after resegment_document_markers
- roles_reapplied count is correct in SegmentationReport
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.curation import CurationRule, curate_document
from multicorpus_engine.segmenter import (
    resegment_document,
    resegment_document_markers,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).parent.parent
_MIGRATIONS_DIR = _REPO_ROOT / "migrations"


@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "test.db")
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _insert_doc(conn: sqlite3.Connection, title: str = "Doc") -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, source_path, source_hash, created_at)"
        " VALUES (?, 'fr', 'x.txt', 'abc', '2024-01-01T00:00:00')",
        (title,),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def _insert_units(conn: sqlite3.Connection, doc_id: int, texts: list[str]) -> list[int]:
    """Insert line units and return their unit_ids."""
    ids = []
    for i, text in enumerate(texts, start=1):
        cur = conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
            " VALUES (?, 'line', ?, ?, ?)",
            (doc_id, i, text, text),
        )
        ids.append(cur.lastrowid)
    conn.commit()
    return ids  # type: ignore[return-value]


def _insert_role(conn: sqlite3.Connection, name: str, label: str) -> None:
    conn.execute(
        "INSERT INTO unit_roles (name, label, color, sort_order, created_at)"
        " VALUES (?, ?, '#6366f1', 0, '2024-01-01T00:00:00')",
        (name, label),
    )
    conn.commit()


def _set_role(conn: sqlite3.Connection, doc_id: int, n: int, role: str) -> None:
    conn.execute(
        "UPDATE units SET unit_role = ? WHERE doc_id = ? AND n = ?",
        (role, doc_id, n),
    )
    conn.commit()


def _get_role(conn: sqlite3.Connection, doc_id: int, n: int) -> str | None:
    row = conn.execute(
        "SELECT unit_role FROM units WHERE doc_id = ? AND n = ?",
        (doc_id, n),
    ).fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------------------
# Curation
# ---------------------------------------------------------------------------


def test_curation_preserves_unit_role(db: sqlite3.Connection) -> None:
    """Curation modifies text_norm but must not touch unit_role."""
    doc_id = _insert_doc(db)
    _insert_units(db, doc_id, ["bonjour monde", "au revoir"])
    _insert_role(db, "titre", "Titre")
    _set_role(db, doc_id, 1, "titre")

    rules = [CurationRule(pattern=r"bonjour", replacement="Bonjour")]
    report = curate_document(db, doc_id, rules)

    assert report.units_modified == 1
    # unit_role on n=1 must still be "titre"
    assert _get_role(db, doc_id, 1) == "titre"
    # unit n=2 has no role — still None
    assert _get_role(db, doc_id, 2) is None
    # text_norm was updated
    row = db.execute(
        "SELECT text_norm FROM units WHERE doc_id = ? AND n = 1", (doc_id,)
    ).fetchone()
    assert row[0] == "Bonjour monde"


# ---------------------------------------------------------------------------
# resegment_document
# ---------------------------------------------------------------------------


def test_resegment_document_reapplies_role_on_first_segment(db: sqlite3.Connection) -> None:
    """After resegment, the unit_role is re-applied to the first sentence of the original unit."""
    doc_id = _insert_doc(db)
    # One unit that will split into two sentences
    _insert_units(db, doc_id, ["Bonjour le monde. Il fait beau.", "Au revoir."])
    _insert_role(db, "intro", "Introduction")
    _set_role(db, doc_id, 1, "intro")

    report = resegment_document(db, doc_id, lang="fr", pack="default")

    # Original n=1 produced >= 2 sentences; n=1 had role "intro"
    # New n=1 (first sentence of original n=1) should have role "intro"
    assert _get_role(db, doc_id, 1) == "intro"
    # Role should NOT bleed to n=2 (second sentence from same original unit)
    assert _get_role(db, doc_id, 2) is None
    assert report.roles_reapplied == 1


def test_resegment_document_reapplies_multiple_roles(db: sqlite3.Connection) -> None:
    """Multiple units with roles are all re-applied."""
    doc_id = _insert_doc(db)
    _insert_units(db, doc_id, [
        "Titre du texte.",
        "Première phrase. Deuxième phrase.",
        "Note de bas de page.",
    ])
    _insert_role(db, "titre", "Titre")
    _insert_role(db, "note", "Note")
    _set_role(db, doc_id, 1, "titre")
    _set_role(db, doc_id, 3, "note")

    report = resegment_document(db, doc_id, lang="fr", pack="default")

    assert report.roles_reapplied == 2
    # New n=1 comes from old n=1 (single sentence) → "titre"
    assert _get_role(db, doc_id, 1) == "titre"
    # Old n=3 was a single sentence; its new position depends on how many
    # sentences old n=2 produced. We just verify "note" exists somewhere.
    roles = [
        db.execute(
            "SELECT unit_role FROM units WHERE doc_id = ? AND n = ?", (doc_id, n)
        ).fetchone()[0]
        for n in range(1, report.units_output + 1)
    ]
    assert "note" in roles


def test_resegment_document_no_roles_no_reapply(db: sqlite3.Connection) -> None:
    """When no roles are assigned, roles_reapplied is 0."""
    doc_id = _insert_doc(db)
    _insert_units(db, doc_id, ["Bonjour. Au revoir."])

    report = resegment_document(db, doc_id, lang="fr")
    assert report.roles_reapplied == 0


# ---------------------------------------------------------------------------
# resegment_document_markers
# ---------------------------------------------------------------------------


def test_resegment_markers_reapplies_role(db: sqlite3.Connection) -> None:
    """After marker-based resegmentation, unit_role is re-applied to first segment."""
    doc_id = _insert_doc(db)
    _insert_units(db, doc_id, [
        "[1] Premier segment. [2] Deuxième segment.",
        "[3] Troisième segment.",
    ])
    _insert_role(db, "paratexte", "Paratexte")
    _set_role(db, doc_id, 1, "paratexte")

    report = resegment_document_markers(db, doc_id)

    assert report.roles_reapplied == 1
    # Old n=1 → first segment produced = new n=1
    assert _get_role(db, doc_id, 1) == "paratexte"
    # New n=2 (second segment of old n=1) must have no role
    assert _get_role(db, doc_id, 2) is None
    # New n=3 (from old n=2) must have no role
    assert _get_role(db, doc_id, 3) is None


def test_resegment_markers_no_roles(db: sqlite3.Connection) -> None:
    doc_id = _insert_doc(db)
    _insert_units(db, doc_id, ["[1] Alpha. [2] Beta."])

    report = resegment_document_markers(db, doc_id)
    assert report.roles_reapplied == 0
