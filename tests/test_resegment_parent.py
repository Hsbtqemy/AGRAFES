"""R2.1 (refonte deux-grains) — resegmentation persists the coarse parent.

Both sentence (``resegment_document``) and marker (``resegment_document_markers``)
resegmentation record each fine unit's parent ordinal in ``meta_json.parent_n``,
so the *paragraph ⊃ sentence* hierarchy survives without a migration. The source
unit is deleted by the resegment, so ``parent_n`` is a **logical** key (the source
position), not a foreign key.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.segmenter import (
    resegment_document,
    resegment_document_markers,
)

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "test.db")
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _doc(conn: sqlite3.Connection) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, source_path, source_hash, created_at)"
        " VALUES ('Doc', 'fr', 'x.txt', 'abc', '2024-01-01T00:00:00')",
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def _units(conn: sqlite3.Connection, doc_id: int, texts: list[str]) -> None:
    for i, text in enumerate(texts, start=1):
        conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
            " VALUES (?, 'line', ?, ?, ?)",
            (doc_id, i, text, text),
        )
    conn.commit()


def _parents(conn: sqlite3.Connection, doc_id: int) -> list[int]:
    rows = conn.execute(
        "SELECT meta_json FROM units WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
        (doc_id,),
    ).fetchall()
    return [json.loads(r["meta_json"])["parent_n"] for r in rows]


def test_resegment_document_persists_parent_n(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    _units(db, doc, [
        "Première phrase. Deuxième phrase.",  # source n=1 → 2 sentences
        "Seule phrase ici.",                   # source n=2 → 1 sentence
    ])
    resegment_document(db, doc, lang="fr")

    parents = _parents(db, doc)
    # every sentence carries a parent_n; children of one source share it and stay grouped
    assert len(parents) == 3
    assert parents == [1, 1, 2]


def test_resegment_markers_persists_parent_n(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    _units(db, doc, [
        "[1] Un. [2] Deux.",  # source n=1 → 2 marked segments
        "[3] Trois.",          # source n=2 → 1 marked segment
    ])
    resegment_document_markers(db, doc)

    parents = _parents(db, doc)
    assert len(parents) >= 2
    assert parents == sorted(parents)          # grouped by source order
    assert all(p in (1, 2) for p in parents)
    assert 2 in parents                        # source n=2 produced ≥1 segment
