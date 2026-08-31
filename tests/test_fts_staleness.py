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

    sain = list_documents(db_conn)
    assert sain["fts_readable"] is True
    # « reparable » ne veut pas dire « a reparer » : un index qui se lit n'a rien
    # a reparer, et l'ecran ne doit surtout pas proposer de bouton.
    assert sain["fts_repairable"] is False

    _retirer_declaration_fts(db_conn)
    db_conn.close()
    conn = get_connection(tmp_path / "test.db")
    payload = list_documents(conn)
    assert payload["fts_readable"] is False
    # Celle-ci se repare depuis l'application : c'est la panne de trois des quatre
    # instantanes abimes, et `build_index` la corrige (voir le test dedie).
    assert payload["fts_repairable"] is True
    # Les documents restent listes : on signale, on ne casse pas l'ecran.
    assert payload["count"] == 2
    assert all(d["fts_stale"] is False for d in payload["documents"])
    conn.close()


def test_page_corruption_is_not_announced_as_repairable(db_conn, tmp_path):
    """L'autre panne : illisible AUSSI, mais aucune voie SQL ne la repare.

    Six mesurees le 25 aout, toutes mortes. Annoncer `fts_repairable: true` ici
    ferait proposer un bouton qui mourrait au clic.
    """
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.services.documents_service import list_documents
    from tests.conftest import corrupt_fts_pages

    _remplir_index(db_conn)
    db_conn.close()
    if corrupt_fts_pages(tmp_path / "test.db") is None:
        pytest.skip("aucune page ne reproduit la signature du 25 aout sur ce build SQLite")

    conn = get_connection(tmp_path / "test.db")
    payload = list_documents(conn)
    assert payload["fts_readable"] is False
    assert payload["fts_repairable"] is False
    assert payload["count"] == 1
    conn.close()


def test_a_locked_database_is_not_announced_as_repairable(db_conn, tmp_path):
    """Le piege qu'un `isinstance(exc, OperationalError)` aurait laisse passer.

    Un verrou rend `OperationalError`, comme la declaration absente. Classer sur le
    type d'exception aurait donc annonce « reparable » sur une base simplement
    occupee, et le bouton aurait propose de reconstruire l'index pour rien. La
    classification interroge le schema : `fts_units` est-il declare ?
    """
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.indexer import classify_index_failure

    verrou = sqlite3.OperationalError("database is locked")
    assert classify_index_failure(db_conn, verrou) == "corrupted"

    _retirer_declaration_fts(db_conn)
    db_conn.close()
    conn = get_connection(tmp_path / "test.db")
    assert classify_index_failure(conn, verrou) == "declaration-missing"
    conn.close()


def _remplir_index(conn, n: int = 1200) -> None:
    """Un corpus assez gros pour que l'index s'etale sur des dizaines de pages :
    sans profondeur, aucune page corrompue ne peut se cacher derriere la premiere."""
    from multicorpus_engine.indexer import build_index

    conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('Doc', 'fr', 'standalone', datetime('now'))"
    )
    doc_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.executemany(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (?, 'line', ?, ?, ?)",
        [
            (doc_id, i, f"Une phrase de test numero {i} avec assez de mots pour peser.",
             f"une phrase de test numero {i} avec assez de mots pour peser")
            for i in range(1, n + 1)
        ],
    )
    conn.commit()
    build_index(conn)


def test_index_readable_catches_corruption_past_the_first_row(db_conn, tmp_path):
    """La panne du 25 aout : la premiere ligne se lit, le parcours complet non.

    C'est le cas que la premiere version d'`index_readable` ratait. Elle sondait
    `SELECT rowid ... LIMIT 1`, sur l'affirmation — ecrite, jamais mesuree — que
    « les deux pannes levent des la premiere lecture ». La base PRE-REBUILD du
    25 aout la dement : sa page abimee est loin dans le fichier (arbre 12,
    page 55999), la premiere ligne revient intacte, et la sonde repondait donc
    « lisible » sur la base meme dont le symptome etait « internal error »
    partout. Ce test tient le cas qui echoue, pas seulement celui qui passe.
    """
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.indexer import index_readable, stale_doc_ids
    from tests.conftest import corrupt_fts_pages

    _remplir_index(db_conn)
    db_conn.close()
    page = corrupt_fts_pages(tmp_path / "test.db")
    if page is None:
        pytest.skip("aucune page ne reproduit la signature du 25 aout sur ce build SQLite")

    conn = get_connection(tmp_path / "test.db")
    # 1. la sonde d'avant ne voit rien : la premiere ligne se lit encore
    assert conn.execute("SELECT rowid FROM fts_units LIMIT 1").fetchone() is not None
    # 2. et `stale_doc_ids` rend un ensemble VIDE, comme sur un index a jour
    assert stale_doc_ids(conn) == set()
    # 3. seul un parcours complet atteint la page abimee
    assert index_readable(conn) is False
    conn.close()


def test_reindex_repairs_a_missing_declaration(indexed_corpus, db_conn, tmp_path):
    """Le bouton « reindexer » doit pouvoir reparer la panne de trois instantanes sur quatre.

    Avant le 31 aout il ne le pouvait pas, et personne ne l'avait mesure : le
    `DROP TABLE IF EXISTS fts_units` de `_recreate_fts_table` ne fait rien quand la
    declaration a deja quitte le schema, les cinq tables d'ombre survivent, et le
    CREATE qui suit echoue sur « table 'fts_units_data' already exists ». La branche
    qui nettoie les ombres n'etait atteinte que lorsque le DROP *echoue*.
    """
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.indexer import build_index, index_readable

    _retirer_declaration_fts(db_conn)
    db_conn.close()
    conn = get_connection(tmp_path / "test.db")
    attendu = conn.execute(
        "SELECT COUNT(*) FROM units WHERE unit_type = 'line'"
    ).fetchone()[0]
    assert attendu > 0
    assert index_readable(conn) is False
    # les cinq ombres sont la : c'est exactement ce qui faisait echouer le CREATE
    ombres = [
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE name LIKE 'fts_units_%'"
        )
    ]
    assert len(ombres) == 5

    assert build_index(conn) == attendu

    assert index_readable(conn) is True
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert conn.execute("SELECT COUNT(*) FROM fts_units").fetchone()[0] == attendu
    conn.close()
