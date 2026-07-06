"""R5.4a — resegment_document driven by a configurable SegmentSpec (DB path).

The pure split primitives are covered in ``test_segment_spec.py``; here we prove
that passing a ``spec`` all the way through ``resegment_document`` rewrites the
stored line units accordingly (words / accumulated clause terminators) and that
the report echoes the spec's label. ``spec=None`` stays the historical sentence
split (covered elsewhere) — these tests exercise the *new* branch end to end.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.segmenter import (
    SegmentSpec,
    resegment_document,
    resolve_preset,
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


def _texts(conn: sqlite3.Connection, doc_id: int) -> list[str]:
    rows = conn.execute(
        "SELECT text_norm FROM units WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
        (doc_id,),
    ).fetchall()
    return [r["text_norm"] for r in rows]


def test_resegment_document_with_whitespace_spec_splits_words(db: sqlite3.Connection) -> None:
    doc = _doc(db)
    _units(db, doc, ["le chat noir", "un chien"])

    report = resegment_document(db, doc, spec=resolve_preset("mots"))

    assert _texts(db, doc) == ["le", "chat", "noir", "un", "chien"]
    assert report.units_output == 5
    assert report.segment_pack == "mots"  # report echoes the spec label, not a lang pack


def test_resegment_document_with_accumulated_terminators_splits_clauses(
    db: sqlite3.Connection,
) -> None:
    doc = _doc(db)
    _units(db, doc, ["Il pleut ; il fait froid : rentrons. La suite."])

    spec = SegmentSpec(
        kind="terminator",
        terminators=".!?;:",
        require_uppercase_after=False,
        label="clauses",
    )
    report = resegment_document(db, doc, spec=spec)

    assert _texts(db, doc) == [
        "Il pleut ;",
        "il fait froid :",
        "rentrons.",
        "La suite.",
    ]
    assert report.segment_pack == "clauses"


def test_resegment_document_default_spec_unchanged_sentence_split(db: sqlite3.Connection) -> None:
    # Guard: the no-spec path is still the historical sentence split (byte-identical
    # counterpart of test_resegment_parent), so the additive branch didn't leak.
    doc = _doc(db)
    _units(db, doc, ["Première phrase. Deuxième phrase."])

    report = resegment_document(db, doc, lang="fr")

    assert _texts(db, doc) == ["Première phrase.", "Deuxième phrase."]
    assert report.segment_pack == "fr_strict"
