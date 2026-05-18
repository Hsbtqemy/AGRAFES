"""Tests for indexer.stale_doc_ids — derived FTS staleness per document.

Drives the « ↻ index périmé » chip in MetadataScreen (HANDOFF_PREP § 6
Tier A #4). Staleness is derived live from units ↔ fts_units, never
persisted — so these tests pin the derivation logic.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from tests.conftest import make_docx


@pytest.fixture()
def indexed_corpus(db_conn: sqlite3.Connection, tmp_path: Path) -> dict:
    """Two FR docs imported + indexed (FTS in sync)."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.indexer import build_index

    p1 = tmp_path / "a.docx"
    p1.write_bytes(make_docx(["[1] Le chat dort.", "[2] Il pleut."]))
    p2 = tmp_path / "b.docx"
    p2.write_bytes(make_docx(["[1] Hello world.", "[2] Second line."]))
    r1 = import_docx_numbered_lines(conn=db_conn, path=p1, language="fr", title="Doc A")
    r2 = import_docx_numbered_lines(conn=db_conn, path=p2, language="en", title="Doc B")
    build_index(db_conn)
    return {"doc_a": r1.doc_id, "doc_b": r2.doc_id}


def test_freshly_indexed_corpus_has_no_stale_docs(indexed_corpus, db_conn):
    from multicorpus_engine.indexer import stale_doc_ids

    assert stale_doc_ids(db_conn) == set()


def test_text_norm_change_makes_doc_stale(indexed_corpus, db_conn):
    """Mutating a unit's text_norm without reindexing → doc becomes stale,
    and ONLY that doc."""
    from multicorpus_engine.indexer import stale_doc_ids

    doc_a = indexed_corpus["doc_a"]
    db_conn.execute(
        "UPDATE units SET text_norm = ? WHERE doc_id = ? AND n = 1",
        ("Le chat DORT (curé).", doc_a),
    )
    db_conn.commit()

    stale = stale_doc_ids(db_conn)
    assert doc_a in stale
    assert indexed_corpus["doc_b"] not in stale


def test_new_unit_not_in_index_makes_doc_stale(indexed_corpus, db_conn):
    """A line unit absent from fts_units → doc stale."""
    from multicorpus_engine.indexer import stale_doc_ids

    doc_b = indexed_corpus["doc_b"]
    db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (?, 'line', 99, ?, ?)",
        (doc_b, "[3] Added later.", "Added later."),
    )
    db_conn.commit()

    assert doc_b in stale_doc_ids(db_conn)


def test_reindex_clears_staleness(indexed_corpus, db_conn):
    """After a mutation + reindex, no doc is stale again."""
    from multicorpus_engine.indexer import build_index, stale_doc_ids

    doc_a = indexed_corpus["doc_a"]
    db_conn.execute(
        "UPDATE units SET text_norm = 'changed' WHERE doc_id = ? AND n = 1",
        (doc_a,),
    )
    db_conn.commit()
    assert stale_doc_ids(db_conn) == {doc_a}

    build_index(db_conn)
    assert stale_doc_ids(db_conn) == set()


def test_structure_units_do_not_affect_staleness(indexed_corpus, db_conn):
    """Only 'line' units are indexed ; mutating a 'structure' unit's
    text_norm must NOT make the doc stale."""
    from multicorpus_engine.indexer import stale_doc_ids

    doc_a = indexed_corpus["doc_a"]
    # Insert a structure unit (not indexed) and mutate it.
    db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (?, 'structure', 50, 'Titre', 'Titre')",
        (doc_a,),
    )
    db_conn.commit()
    assert stale_doc_ids(db_conn) == set()


def test_empty_doc_is_never_stale(db_conn, tmp_path):
    """A document with zero line units has nothing to index → not stale."""
    from multicorpus_engine.indexer import stale_doc_ids

    db_conn.execute(
        "INSERT INTO documents (title, language, created_at) VALUES (?, ?, ?)",
        ("Empty", "fr", "2026-05-18T00:00:00Z"),
    )
    db_conn.commit()
    assert stale_doc_ids(db_conn) == set()
