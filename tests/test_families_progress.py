"""D-P9-1 — agrégat de progression par famille dans GET /families.

DESIGN_corpus_progress_rollup.md §2/§6 : `/families` gagne, par famille, l'axe
VÉRIFICATION (status_counts des liens) + le compte de COLLISIONS, agrégés au grain
famille (le moyeu = racine, donc pivot_doc_id = racine pour tous ses liens).

Test white-box du handler (comme test_fetch_aligned_pairs_excludes_rejected) : on
instancie `_CorpusHandler` sans la pile HTTP et on capture `_send_json`.
"""

from __future__ import annotations

import datetime
import sqlite3
import uuid
from pathlib import Path


def _call_families(db_conn: sqlite3.Connection) -> list[dict]:
    from multicorpus_engine.sidecar import _CorpusHandler

    handler = _CorpusHandler.__new__(_CorpusHandler)
    handler._conn = lambda: db_conn
    handler._ensure_document_workflow_columns = lambda: None
    captured: dict = {}
    handler._send_json = lambda data, status=200: captured.update(payload=data)
    handler._handle_families()
    return captured["payload"]["families"]


def test_families_status_counts_and_collisions(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.runs import create_run

    # Parent (moyeu) + 2 enfants.
    p = tmp_path / "p.txt"
    p.write_text("[1] Un.\n[2] Deux.\n[3] Trois.\n", encoding="utf-8")
    c1 = tmp_path / "c1.txt"
    c1.write_text("[1] One.\n[2] Two.\n[3] Three.\n", encoding="utf-8")
    c2 = tmp_path / "c2.txt"
    c2.write_text("[1] Eins.\n[2] Zwei.\n", encoding="utf-8")
    rp = import_txt_numbered_lines(db_conn, p, language="fr", title="Parent")
    r1 = import_txt_numbered_lines(db_conn, c1, language="en", title="Enfant1")
    r2 = import_txt_numbered_lines(db_conn, c2, language="de", title="Enfant2")

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for child in (r1.doc_id, r2.doc_id):
        db_conn.execute(
            "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at)"
            " VALUES (?, 'translation_of', ?, ?)",
            (child, rp.doc_id, now),
        )

    def units(doc_id: int) -> dict[int, int]:
        return {r[0]: r[1] for r in db_conn.execute(
            "SELECT external_id, unit_id FROM units WHERE doc_id=? AND unit_type='line'", (doc_id,))}
    up, u1, u2 = units(rp.doc_id), units(r1.doc_id), units(r2.doc_id)

    run_id = str(uuid.uuid4())
    create_run(db_conn, "align", {}, run_id=run_id)

    def link(pu: int, tu: int, tgt_doc: int, ext: int, status: str) -> None:
        db_conn.execute(
            f"INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
            f"pivot_doc_id,target_doc_id,created_at,status) VALUES (?,?,?,?,?,?,?,{status})",
            (run_id, pu, tu, ext, rp.doc_id, tgt_doc, now),
        )

    # Parent↔Enfant1 : accepté / non-révisé / rejeté (un de chaque).
    link(up[1], u1[1], r1.doc_id, 1, "'accepted'")
    link(up[2], u1[2], r1.doc_id, 2, "NULL")
    link(up[3], u1[3], r1.doc_id, 3, "'rejected'")
    # Parent↔Enfant2 : le MÊME segment pivot (up[1]) lié à 2 cibles distinctes = 1 collision.
    link(up[1], u2[1], r2.doc_id, 1, "NULL")
    link(up[1], u2[2], r2.doc_id, 1, "NULL")
    db_conn.commit()

    families = _call_families(db_conn)
    assert len(families) == 1
    stats = families[0]["stats"]

    # Vérification : accepté 1, rejeté 1, non-révisé 3 (E1: 1 + E2: 2).
    assert stats["status_counts"] == {"accepted": 1, "rejected": 1, "unreviewed": 3}
    # Collision : up[1] → 2 beads distincts sur Enfant2 → 1 (Enfant1 sans collision).
    assert stats["collision_count"] == 1


def test_families_rejected_excluded_from_collisions(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Un lien rejeté ne crée pas de collision (prédicat F8, comme le panneau /align/collisions)."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.runs import create_run

    p = tmp_path / "p.txt"
    p.write_text("[1] Un.\n", encoding="utf-8")
    c1 = tmp_path / "c1.txt"
    c1.write_text("[1] One.\n[2] Uno.\n", encoding="utf-8")
    rp = import_txt_numbered_lines(db_conn, p, language="fr", title="P")
    r1 = import_txt_numbered_lines(db_conn, c1, language="en", title="C1")
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    db_conn.execute(
        "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at)"
        " VALUES (?, 'translation_of', ?, ?)", (r1.doc_id, rp.doc_id, now))
    up = {r[0]: r[1] for r in db_conn.execute(
        "SELECT external_id, unit_id FROM units WHERE doc_id=? AND unit_type='line'", (rp.doc_id,))}
    u1 = {r[0]: r[1] for r in db_conn.execute(
        "SELECT external_id, unit_id FROM units WHERE doc_id=? AND unit_type='line'", (r1.doc_id,))}
    run_id = str(uuid.uuid4())
    create_run(db_conn, "align", {}, run_id=run_id)
    # up[1] lié à 2 cibles, mais l'une est REJETÉE → un seul bead vivant → PAS de collision.
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,"
        "target_doc_id,created_at,status) VALUES (?,?,?,?,?,?,?,'accepted')",
        (run_id, up[1], u1[1], 1, rp.doc_id, r1.doc_id, now))
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,"
        "target_doc_id,created_at,status) VALUES (?,?,?,?,?,?,?,'rejected')",
        (run_id, up[1], u1[2], 1, rp.doc_id, r1.doc_id, now))
    db_conn.commit()

    stats = _call_families(db_conn)[0]["stats"]
    assert stats["collision_count"] == 0, "le lien rejeté ne compte pas comme collision"
    assert stats["status_counts"] == {"accepted": 1, "rejected": 1, "unreviewed": 0}


def _one_child_family(db_conn, tmp_path, *, parent_lines: str, child_lines: str):
    """Helper : importe parent A + enfant B, déclare B translation_of A. Renvoie (rA, rB)."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines

    pa = tmp_path / "a.txt"
    pa.write_text(parent_lines, encoding="utf-8")
    pb = tmp_path / "b.txt"
    pb.write_text(child_lines, encoding="utf-8")
    rA = import_txt_numbered_lines(db_conn, pa, language="fr", title="A")
    rB = import_txt_numbered_lines(db_conn, pb, language="en", title="B")
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    db_conn.execute(
        "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at)"
        " VALUES (?, 'translation_of', ?, ?)", (rB.doc_id, rA.doc_id, now))
    return rA, rB


def _units(db_conn, doc_id: int) -> dict[int, int]:
    return {r[0]: r[1] for r in db_conn.execute(
        "SELECT external_id, unit_id FROM units WHERE doc_id=? AND unit_type='line'", (doc_id,))}


def _link(db_conn, run_id, pv, tg, pdoc, tdoc, ext, status_sql):
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    db_conn.execute(
        f"INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        f"pivot_doc_id,target_doc_id,created_at,status) VALUES (?,?,?,?,?,?,?,{status_sql})",
        (run_id, pv, tg, ext, pdoc, tdoc, now))


def test_families_counts_reverse_oriented_links(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Revue adverse Q1 — un lien pivot=ENFANT (aligné B→A puis B déclaré enfant de A) doit
    être compté en vérification, comme il l'est déjà en couverture (aligned_pairs normalise)."""
    from multicorpus_engine.runs import create_run

    rA, rB = _one_child_family(db_conn, tmp_path, parent_lines="[1] Un.\n[2] Deux.\n",
                               child_lines="[1] One.\n[2] Two.\n")
    uA, uB = _units(db_conn, rA.doc_id), _units(db_conn, rB.doc_id)
    run_id = str(uuid.uuid4())
    create_run(db_conn, "align", {}, run_id=run_id)
    # Liens INVERSES : pivot = B (l'enfant), cible = A (la racine).
    _link(db_conn, run_id, uB[1], uA[1], rB.doc_id, rA.doc_id, 1, "'accepted'")
    _link(db_conn, run_id, uB[2], uA[2], rB.doc_id, rA.doc_id, 2, "NULL")
    db_conn.commit()

    stats = _call_families(db_conn)[0]["stats"]
    # RED sur l'ancien code (filtre pivot IN {racine}) : ces liens pivot=B seraient à 0.
    assert stats["status_counts"] == {"accepted": 1, "rejected": 0, "unreviewed": 1}
    assert stats["aligned_pairs"] == 1  # la couverture les crédite déjà → cohérence des 2 axes


def test_families_excludes_links_to_non_children(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Revue adverse Q3 — un lien racine→doc HORS famille ne doit pas gonfler le compte."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.runs import create_run

    rA, rB = _one_child_family(db_conn, tmp_path, parent_lines="[1] Un.\n",
                               child_lines="[1] One.\n")
    # Doc étranger Z, SANS relation de famille.
    pz = tmp_path / "z.txt"
    pz.write_text("[1] Zzz.\n", encoding="utf-8")
    rZ = import_txt_numbered_lines(db_conn, pz, language="de", title="Z")
    uA, uB, uZ = _units(db_conn, rA.doc_id), _units(db_conn, rB.doc_id), _units(db_conn, rZ.doc_id)
    run_id = str(uuid.uuid4())
    create_run(db_conn, "align", {}, run_id=run_id)
    _link(db_conn, run_id, uA[1], uB[1], rA.doc_id, rB.doc_id, 1, "'accepted'")   # famille A↔B
    _link(db_conn, run_id, uA[1], uZ[1], rA.doc_id, rZ.doc_id, 1, "'accepted'")   # A→Z hors-famille
    db_conn.commit()

    stats = _call_families(db_conn)[0]["stats"]
    # RED sur l'ancien code (pivot IN {A}, sans filtre cible) : compterait 2.
    assert stats["status_counts"] == {"accepted": 1, "rejected": 0, "unreviewed": 0}
