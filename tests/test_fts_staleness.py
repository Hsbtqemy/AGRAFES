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

# ── index illisible : « rien a reindexer » vs « je ne peux pas savoir » (FTS-01) ──


def _retirer_declaration_fts(conn: sqlite3.Connection) -> None:
    """Retire la table virtuelle du schema en laissant ses cinq tables d'ombre.

    C'est l'empreinte exacte relevee sur deux instantanes du corpus (30 juin et
    17 aout 2026) : les tables `fts_units_*` sont toutes la, `integrity_check`
    repond `ok`, et pourtant toute lecture de `fts_units` leve `no such table`.
    C'est la panne qui passe inapercue a un controle naif.
    """
    conn.execute("PRAGMA writable_schema = ON")
    conn.execute("DELETE FROM sqlite_master WHERE type = 'table' AND name = 'fts_units'")
    conn.execute("PRAGMA writable_schema = OFF")
    conn.commit()


def test_index_readable_on_healthy_corpus(indexed_corpus, db_conn):
    from multicorpus_engine.indexer import index_readable

    assert index_readable(db_conn) is True


def test_broken_index_is_not_reported_as_up_to_date(indexed_corpus, db_conn, tmp_path):
    """Le piege que ce lot corrige, assere en trois temps."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.indexer import index_readable, stale_doc_ids

    _retirer_declaration_fts(db_conn)
    db_conn.close()
    conn = get_connection(tmp_path / "test.db")  # le schema est en cache : il faut rouvrir

    # 1. les cinq tables d'ombre ont survecu, donc rien ne saute aux yeux
    ombres = [
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE name LIKE 'fts_units_%'"
        )
    ]
    assert len(ombres) == 5
    # 2. l'integrite SQLite reste bonne : un controle naif ne voit rien
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    # 3. et `stale_doc_ids` rend un ensemble VIDE, comme sur un index a jour
    assert stale_doc_ids(conn) == set()
    # C'est pour cela qu'il faut un second signal : sans lui, l'ecran affichait
    # « index a jour » sur une base dont l'index n'existe plus.
    assert index_readable(conn) is False
    conn.close()


def test_list_documents_says_when_the_index_cannot_be_read(indexed_corpus, db_conn, tmp_path):
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.services.documents_service import list_documents

    assert list_documents(db_conn)["fts_readable"] is True

    _retirer_declaration_fts(db_conn)
    db_conn.close()
    conn = get_connection(tmp_path / "test.db")
    payload = list_documents(conn)
    assert payload["fts_readable"] is False
    # Les documents restent listes : on signale, on ne casse pas l'ecran.
    assert payload["count"] == 2
    assert all(d["fts_stale"] is False for d in payload["documents"])
    conn.close()
