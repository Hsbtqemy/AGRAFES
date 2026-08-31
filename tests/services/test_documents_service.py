"""Direct unit tests for the documents service (audit P0-1 / A-01).

Exercises the extracted documents CRUD without any HTTP server. The migrated
schema already has the workflow columns + tokens table, so list_documents works
without the adapter's legacy backfill. HTTP adapters stay covered by
tests/contracts/test_sidecar_v04.py / test_sidecar_api_contract.py + the binary smoke
(GET /documents).
"""

from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.documents_service import (
    bulk_update_documents,
    delete_documents,
    document_stats,
    list_documents,
    update_document,
)
from multicorpus_engine.services.errors import (
    BadRequestError,
    NotFoundError,
    ValidationError,
)


def _mk_doc(conn: sqlite3.Connection, title: str = "D") -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES (?, 'fr', 'standalone', datetime('now'))",
        (title,),
    )
    conn.commit()
    return cur.lastrowid


# --- list -----------------------------------------------------------------------
def test_list_empty(db_conn: sqlite3.Connection) -> None:
    # `fts_readable` fait partie de la reponse depuis 1.6.84 (FTS-01) : une base
    # vide a bien un index lisible, simplement vide. Les deux branches du drapeau
    # sont exercees dans tests/test_fts_staleness.py.
    assert list_documents(db_conn) == {
        "documents": [], "count": 0, "fts_readable": True, "fts_repairable": False,
    }


def test_list_shapes_each_row(db_conn: sqlite3.Connection) -> None:
    _mk_doc(db_conn, "Doc A")
    out = list_documents(db_conn)
    assert out["count"] == 1
    doc = out["documents"][0]
    assert doc["title"] == "Doc A"
    assert doc["workflow_status"] == "draft"          # column default
    assert doc["unit_count"] == 0 and doc["token_count"] == 0
    assert doc["annotation_status"] == "missing"
    assert doc["fts_stale"] is False
    assert doc["curated_at"] is None and doc["aligned_count"] == 0
    for key in ("doc_id", "source_path", "source_hash", "text_start_n", "publisher"):
        assert key in doc


# --- curated_at / aligned_count (ACT-01) ----------------------------------------
# Les deux etats que la page Actions ne pouvait pas montrer. Aucun n'est une colonne :
# ils sont derives a la lecture, l'un de prep_action_history, l'autre de alignment_links.


def _mk_curation_action(
    conn: sqlite3.Connection,
    doc_id: int,
    performed_at: str,
    action_type: str = "curation_apply",
    reverted: int = 0,
) -> int:
    cur = conn.execute(
        "INSERT INTO prep_action_history"
        "  (doc_id, action_type, performed_at, description, reverted)"
        " VALUES (?, ?, ?, 'x', ?)",
        (doc_id, action_type, performed_at, reverted),
    )
    conn.commit()
    return cur.lastrowid


def _one(conn: sqlite3.Connection, doc_id: int) -> dict:
    return next(d for d in list_documents(conn)["documents"] if d["doc_id"] == doc_id)


def test_curated_at_reads_the_latest_apply(db_conn: sqlite3.Connection) -> None:
    doc_id = _mk_doc(db_conn)
    _mk_curation_action(db_conn, doc_id, "2026-01-01T00:00:00Z")
    _mk_curation_action(db_conn, doc_id, "2026-08-16T21:50:46Z")
    assert _one(db_conn, doc_id)["curated_at"] == "2026-08-16T21:50:46Z"


def test_curated_at_ignores_a_reverted_apply(db_conn: sqlite3.Connection) -> None:
    # Le temoin suit le TEXTE, pas l'historique : une passe annulee laisse le
    # document dans l'etat ou il etait avant elle, donc « jamais cure ».
    doc_id = _mk_doc(db_conn)
    _mk_curation_action(db_conn, doc_id, "2026-08-16T21:50:46Z", reverted=1)
    assert _one(db_conn, doc_id)["curated_at"] is None


def test_curated_at_ignores_other_action_types(db_conn: sqlite3.Connection) -> None:
    # prep_action_history porte aussi merge/split/resegment/update_text : aucun
    # d'eux n'est une curation, et confondre les deux peindrait « cure » sur tout
    # document simplement retouche a la main.
    doc_id = _mk_doc(db_conn)
    for kind in ("merge_units", "split_unit", "resegment", "update_text", "set_role"):
        _mk_curation_action(db_conn, doc_id, "2026-08-16T21:50:46Z", action_type=kind)
    assert _one(db_conn, doc_id)["curated_at"] is None


def test_curated_at_is_per_document(db_conn: sqlite3.Connection) -> None:
    # C'est ce que `curation_apply_history` (migration 007) ne sait PAS faire : son
    # doc_id est NULL des que la portee est « tout le corpus ». Ici chaque document
    # touche par un apply corpus-large a sa propre ligne.
    a, b, c = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B"), _mk_doc(db_conn, "C")
    _mk_curation_action(db_conn, a, "2026-03-01T00:00:00Z")
    _mk_curation_action(db_conn, b, "2026-03-01T00:00:00Z")
    assert _one(db_conn, a)["curated_at"] == "2026-03-01T00:00:00Z"
    assert _one(db_conn, b)["curated_at"] == "2026-03-01T00:00:00Z"
    assert _one(db_conn, c)["curated_at"] is None


def _mk_unit(conn: sqlite3.Connection, doc_id: int, n: int) -> int:
    cur = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (?, 'line', ?, 'x', 'x')",
        (doc_id, n),
    )
    return cur.lastrowid


def _mk_link(conn: sqlite3.Connection, pivot: int, target: int, n: int = 1) -> None:
    # alignment_links a des FK reelles vers units : un lien ne se fabrique pas sur
    # des unit_id inventes.
    pu, tu = _mk_unit(conn, pivot, n), _mk_unit(conn, target, n)
    conn.execute(
        "INSERT INTO alignment_links"
        "  (run_id, pivot_doc_id, pivot_unit_id, target_doc_id, target_unit_id,"
        "   external_id, created_at)"
        " VALUES ('r', ?, ?, ?, ?, ?, datetime('now'))",
        (pivot, pu, target, tu, n),
    )
    conn.commit()


def test_aligned_count_counts_both_directions(db_conn: sqlite3.Connection) -> None:
    # Un document peut etre cible sans jamais etre pivot : ne compter que
    # pivot_doc_id le declarerait « jamais aligne ».
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    _mk_link(db_conn, a, b, n=1)
    _mk_link(db_conn, a, b, n=2)
    assert _one(db_conn, a)["aligned_count"] == 2
    assert _one(db_conn, b)["aligned_count"] == 2


def test_aligned_count_covers_a_document_outside_any_family(
    db_conn: sqlite3.Connection,
) -> None:
    # La raison d'etre du champ : GET /families ne connait que les documents EN
    # famille (parent ou enfant). Ces deux-la n'ont aucune doc_relations, et leur
    # alignement serait donc invisible si on le lisait la-bas.
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    _mk_link(db_conn, a, b)
    assert db_conn.execute("SELECT COUNT(*) FROM doc_relations").fetchone()[0] == 0
    assert _one(db_conn, a)["aligned_count"] == 1


def test_derived_state_survives_a_base_without_the_tables(
    db_conn: sqlite3.Connection,
) -> None:
    # Une base ouverte avant la migration, ou reparee a la main, peut ne pas porter
    # ces tables : /documents doit repondre « aucun etat », pas echouer en entier.
    doc_id = _mk_doc(db_conn)
    db_conn.execute("DROP TABLE prep_action_history")
    db_conn.execute("DROP TABLE alignment_links")
    db_conn.commit()
    doc = _one(db_conn, doc_id)
    assert doc["curated_at"] is None and doc["aligned_count"] == 0


# --- stats (R1.2 — canvas stage strip) ------------------------------------------
def _mk_line(
    conn: sqlite3.Connection,
    doc_id: int,
    n: int,
    text: str = "x",
    external_id: int | None = None,
    meta_json: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)"
        " VALUES (?, 'line', ?, ?, ?, ?, ?)",
        (doc_id, n, external_id, text, text, meta_json),
    )
    conn.commit()


def test_stats_requires_doc_id(db_conn: sqlite3.Connection) -> None:
    for bad in (None, "", "   "):
        with pytest.raises(BadRequestError):
            document_stats(db_conn, bad)


def test_stats_rejects_non_integer(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        document_stats(db_conn, "abc")


def test_stats_unknown_doc(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        document_stats(db_conn, 999999)


def test_stats_shapes_counts(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn, "Doc")
    _mk_line(db_conn, d, 1, "Bonjour le monde.", external_id=5)
    _mk_line(db_conn, d, 2, "Court.", external_id=6, meta_json='{"parent_n": 1}')
    _mk_line(db_conn, d, 3, "Sans id.")
    db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (?, 'structure', 99, 'H', 'H')",
        (d,),
    )
    db_conn.commit()

    out = document_stats(db_conn, str(d))
    assert out["doc_id"] == d
    assert out["line_count"] == 3
    assert out["structure_count"] == 1
    assert out["external_id_count"] == 2
    assert out["parent_count"] == 1          # only the meta_json parent_n row
    assert out["aligned_count"] == 0
    assert out["max_text_len"] == len("Bonjour le monde.")
    assert out["avg_text_len"] > 0


# --- update ---------------------------------------------------------------------
def test_update_title(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn, "Old")
    out = update_document(db_conn, {"doc_id": d, "title": "New"})
    assert out == {"updated": 1, "doc": out["doc"]}
    assert out["doc"]["title"] == "New"


def test_update_requires_doc_id(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        update_document(db_conn, {"title": "x"})


def test_update_requires_a_field(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn)
    with pytest.raises(BadRequestError):
        update_document(db_conn, {"doc_id": d, "not_allowed": 1})


def test_update_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        update_document(db_conn, {"doc_id": 99999, "title": "x"})


def test_update_bad_workflow_status_has_details(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn)
    with pytest.raises(ValidationError) as ei:
        update_document(db_conn, {"doc_id": d, "workflow_status": "nope"})
    assert ei.value.details == {"supported_values": ["draft", "review", "validated"]}


def test_update_validated_sets_validated_at(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn)
    out = update_document(db_conn, {"doc_id": d, "workflow_status": "validated"})
    assert out["doc"]["workflow_status"] == "validated"
    assert out["doc"]["validated_at"]  # non-null timestamp set


def test_update_leaving_validated_clears_metadata(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn)
    update_document(db_conn, {"doc_id": d, "workflow_status": "validated", "validated_run_id": "r1"})
    out = update_document(db_conn, {"doc_id": d, "workflow_status": "draft"})
    assert out["doc"]["validated_at"] is None
    assert out["doc"]["validated_run_id"] is None


def test_update_validated_run_id_requires_validated(db_conn: sqlite3.Connection) -> None:
    d = _mk_doc(db_conn)
    with pytest.raises(ValidationError):
        update_document(db_conn, {"doc_id": d, "validated_run_id": "r1"})


# --- bulk update ----------------------------------------------------------------
def test_bulk_update(db_conn: sqlite3.Connection) -> None:
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    out = bulk_update_documents(db_conn, {"updates": [
        {"doc_id": a, "title": "A2"},
        {"doc_id": b, "language": "en"},
        {"doc_id": None, "title": "skip"},      # skipped (no doc_id)
        {"doc_id": a, "irrelevant": 1},         # skipped (no updatable field)
    ]})
    assert out["updated"] == 2


def test_bulk_update_bad_list(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        bulk_update_documents(db_conn, {"updates": []})


def test_bulk_update_bad_workflow_status(db_conn: sqlite3.Connection) -> None:
    a = _mk_doc(db_conn, "A")
    with pytest.raises(ValidationError):
        bulk_update_documents(db_conn, {"updates": [{"doc_id": a, "workflow_status": "bogus"}]})


def test_bulk_update_is_atomic_on_midbatch_failure(db_conn: sqlite3.Connection) -> None:
    """A failure mid-batch rolls back the earlier UPDATEs (audit SID-03)."""
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    with pytest.raises(ValidationError):
        bulk_update_documents(db_conn, {"updates": [
            {"doc_id": a, "title": "CHANGED"},           # applied first…
            {"doc_id": b, "workflow_status": "bogus"},   # …then this fails → rollback all
        ]})
    # The first UPDATE must not have persisted (would read "CHANGED" without the fix).
    title = db_conn.execute("SELECT title FROM documents WHERE doc_id = ?", (a,)).fetchone()[0]
    assert title == "A"


# --- delete ---------------------------------------------------------------------
def test_delete_removes_doc_units_relations(db_conn: sqlite3.Connection) -> None:
    a, b = _mk_doc(db_conn, "A"), _mk_doc(db_conn, "B")
    db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm) VALUES (?, 'line', 1, 'x', 'x')",
        (a,),
    )
    db_conn.execute(
        "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at)"
        " VALUES (?, 'translation_of', ?, datetime('now'))",
        (a, b),
    )
    db_conn.commit()

    data, telemetry = delete_documents(db_conn, {"doc_ids": [a]})
    assert data == {"deleted": 1, "doc_ids": [a]}
    assert db_conn.execute("SELECT 1 FROM documents WHERE doc_id=?", (a,)).fetchone() is None
    assert db_conn.execute("SELECT COUNT(*) FROM units WHERE doc_id=?", (a,)).fetchone()[0] == 0
    assert db_conn.execute("SELECT COUNT(*) FROM doc_relations WHERE doc_id=?", (a,)).fetchone()[0] == 0
    # telemetry: one entry per doc, with the expected keys
    assert telemetry == [{"doc_id": a, "had_curation": False, "had_alignment": False}]


def test_delete_bad_payload(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(BadRequestError):
        delete_documents(db_conn, {"doc_ids": []})
    with pytest.raises(BadRequestError):
        delete_documents(db_conn, {"doc_ids": ["not-int"]})
