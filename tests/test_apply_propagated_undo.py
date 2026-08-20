"""ALI-10, reliquat — `POST /segment/apply_propagated` laisse une trace et se défait.

D-2 avait câblé les six chemins qui passent par l'une des deux fonctions de
resegmentation. Celui-ci n'en passe par aucune : il reconstruit le document depuis une
liste d'unités fournie, avec son propre DELETE. Il détruisait donc les unités **et**
les liens d'alignement du document sans laisser la moindre trace.

Deux choses le distinguent des six autres, et toutes deux ont demandé un correctif hors
de ce handler :

* il embrasse aussi les unités ``structure``, alors que ``_undo_resegment`` réinsérait
  en ``unit_type = 'line'`` **en dur** — juste tant que seule la resegmentation était
  journalisée, faux dès que ce chemin l'est ;
* le recorder de production omettait ``text_source`` de son ``context_json``, si bien
  que **toute** annulation de resegmentation rendait l'unité sans sa provenance
  d'import. Le test qui semblait couvrir le cas (``test_undo.py``) passe par une
  doublure de recorder qui, elle, transmet le payload verbatim.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.action_history import collect_links_for_document
from multicorpus_engine.sidecar import make_resegment_recorder
from multicorpus_engine.undo import execute_undo

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "t.db")
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _doc(conn: sqlite3.Connection, title: str, lang: str) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, source_path, source_hash, created_at)"
        " VALUES (?, ?, ?, ?, '2024-01-01T00:00:00')",
        (title, lang, f"{title}.txt", title),
    )
    return int(cur.lastrowid)


def _unit(conn: sqlite3.Connection, doc: int, n: int, text: str,
          *, utype: str = "line", source: str | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm, text_source)"
        " VALUES (?, ?, ?, ?, ?, ?)", (doc, utype, n, text, text.lower(), source),
    )
    return int(cur.lastrowid)


def _apply_propagated(conn: sqlite3.Connection, doc_id: int,
                      units: list[tuple[str, str]]) -> int | None:
    """Rejoue le cœur du handler : lire, détruire, réinsérer, enregistrer.

    Le handler HTTP est un adaptateur (validation + verrou) ; c'est cette séquence qui
    porte la sémantique, et c'est elle qu'il faut pouvoir prouver sans sidecar.
    """
    text_start_n = conn.execute(
        "SELECT text_start_n FROM documents WHERE doc_id = ?", (doc_id,)
    ).fetchone()[0]
    start_n = text_start_n if text_start_n is not None else 1

    from multicorpus_engine.action_history import insert_link_snapshots

    archived_links = collect_links_for_document(conn, doc_id)
    units_before_rows = conn.execute(
        "SELECT unit_id, unit_type, n, external_id, text_raw, text_norm,"
        " unit_role, meta_json, text_source FROM units"
        " WHERE doc_id = ? AND unit_type IN ('line', 'structure')"
        + (" AND n >= ?" if text_start_n is not None else "")
        + " ORDER BY n",
        (doc_id, text_start_n) if text_start_n is not None else (doc_id,),
    ).fetchall()

    conn.execute(
        "DELETE FROM alignment_links WHERE pivot_doc_id = ? OR target_doc_id = ?",
        (doc_id, doc_id),
    )
    if text_start_n is not None:
        conn.execute(
            "DELETE FROM units WHERE doc_id = ? AND unit_type IN ('line','structure')"
            " AND n >= ?", (doc_id, text_start_n),
        )
    else:
        conn.execute(
            "DELETE FROM units WHERE doc_id = ? AND unit_type IN ('line','structure')",
            (doc_id,),
        )
    conn.executemany(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm,"
        " unit_role, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(doc_id, utype, start_n + i, None, text, text, None, None)
         for i, (utype, text) in enumerate(units)],
    )

    action_id = None
    if units_before_rows:
        new_rows = conn.execute(
            "SELECT unit_id, n FROM units WHERE doc_id = ?"
            " AND unit_type IN ('line','structure')"
            + (" AND n >= ?" if text_start_n is not None else "")
            + " ORDER BY n",
            (doc_id, text_start_n) if text_start_n is not None else (doc_id,),
        ).fetchall()
        action_id = make_resegment_recorder(conn)({
            "doc_id": doc_id, "pack": "propagate", "lang": "und",
            "text_start_n": text_start_n,
            "units_before": [
                {
                    "unit_id": int(r["unit_id"]), "unit_type": r["unit_type"],
                    "n": int(r["n"]), "external_id": r["external_id"],
                    "text_raw": r["text_raw"], "text_norm": r["text_norm"],
                    "unit_role": r["unit_role"], "meta_json": r["meta_json"],
                    "text_source": r["text_source"],
                }
                for r in units_before_rows
            ],
            "created_unit_ids": [int(r["unit_id"]) for r in new_rows],
            "new_units_n": [int(r["n"]) for r in new_rows],
        })
        if action_id is not None and archived_links:
            insert_link_snapshots(int(action_id), archived_links, conn=conn)
    conn.commit()
    return action_id


def test_the_gesture_leaves_an_action_where_it_left_nothing(db: sqlite3.Connection) -> None:
    doc = _doc(db, "FR", "fr")
    _unit(db, doc, 1, "Un. Deux.")
    db.commit()

    action_id = _apply_propagated(db, doc, [("line", "Un."), ("line", "Deux.")])

    assert action_id is not None
    row = db.execute(
        "SELECT action_type, doc_id FROM prep_action_history WHERE action_id = ?",
        (action_id,),
    ).fetchone()
    assert (row[0], row[1]) == ("resegment", doc)


def test_undo_restores_the_units_and_their_alignment(db: sqlite3.Connection) -> None:
    """Ce que l'archive des liens seule n'aurait pas suffi à rendre : un lien restitué
    sur un ``unit_id`` mort est écarté par la garde FK. C'est parce que
    ``_undo_resegment`` réinsère les unités avec leur id d'origine que ça recolle."""
    src, tgt = _doc(db, "FR", "fr"), _doc(db, "EN", "en")
    u_src = _unit(db, src, 1, "Un. Deux.")
    u_tgt = _unit(db, tgt, 1, "One. Two.")
    db.execute(
        "INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id,"
        " pivot_doc_id, target_doc_id, created_at, status)"
        " VALUES ('r', ?, ?, 1, ?, ?, '2024-01-01T00:00:00', 'accepted')",
        (u_src, u_tgt, src, tgt),
    )
    db.commit()

    action_id = _apply_propagated(db, src, [("line", "Un."), ("line", "Deux.")])
    assert db.execute("SELECT COUNT(*) FROM alignment_links").fetchone()[0] == 0

    execute_undo(db, action_id)
    db.commit()

    unites = db.execute(
        "SELECT unit_id, text_raw FROM units WHERE doc_id = ? ORDER BY n", (src,)
    ).fetchall()
    assert [(r[0], r[1]) for r in unites] == [(u_src, "Un. Deux.")]
    lien = db.execute(
        "SELECT pivot_unit_id, target_unit_id, status FROM alignment_links"
    ).fetchall()
    assert [tuple(r) for r in lien] == [(u_src, u_tgt, "accepted")]


def test_a_structure_unit_comes_back_as_a_structure_unit(db: sqlite3.Connection) -> None:
    """Le défaut que ce chemin met au jour dans ``_undo_resegment``.

    Il réinsérait en ``unit_type = 'line'`` **en dur** — exact tant que seule la
    resegmentation était journalisée, puisqu'elle ne touche que des lignes. Ici un
    intertitre reviendrait converti en ligne, sans un mot.
    """
    doc = _doc(db, "FR", "fr")
    inter = _unit(db, doc, 1, "CHAPITRE PREMIER", utype="structure")
    _unit(db, doc, 2, "Un. Deux.")
    db.commit()

    action_id = _apply_propagated(db, doc, [("line", "Un."), ("line", "Deux.")])
    execute_undo(db, action_id)
    db.commit()

    assert db.execute(
        "SELECT unit_type FROM units WHERE unit_id = ?", (inter,)
    ).fetchone()[0] == "structure"


def test_undo_restores_the_import_provenance(db: sqlite3.Connection) -> None:
    """``text_source`` ne vit que dans le ``context_json`` — la table d'instantanés n'a
    pas de colonne ``_before`` pour lui. Le recorder de production l'omettait, donc
    TOUTE annulation de resegmentation rendait l'unité sans sa provenance d'import."""
    doc = _doc(db, "FR", "fr")
    u = _unit(db, doc, 1, "Un. Deux.", source="ORIGINAL-IMPORT")
    db.commit()

    action_id = _apply_propagated(db, doc, [("line", "Un."), ("line", "Deux.")])
    execute_undo(db, action_id)
    db.commit()

    assert db.execute(
        "SELECT text_source FROM units WHERE unit_id = ?", (u,)
    ).fetchone()[0] == "ORIGINAL-IMPORT"


def test_the_archive_stops_at_the_paratext_boundary(db: sqlite3.Connection) -> None:
    """Le prédicat de lecture doit être celui du DELETE, à la lettre. Une archive plus
    large ressusciterait du paratexte que le geste n'a jamais touché — c'est le piège
    aperçu/apply déjà rencontré deux fois sur ``text_start_n``."""
    doc = _doc(db, "FR", "fr")
    para = _unit(db, doc, 1, "Titre de couverture")
    _unit(db, doc, 2, "Un. Deux.")
    db.execute("UPDATE documents SET text_start_n = 2 WHERE doc_id = ?", (doc,))
    db.commit()

    action_id = _apply_propagated(db, doc, [("line", "Un."), ("line", "Deux.")])
    context = json.loads(db.execute(
        "SELECT context_json FROM prep_action_history WHERE action_id = ?", (action_id,)
    ).fetchone()[0])

    archives = [u["unit_id"] for u in context["units_before"]]
    assert para not in archives
    assert db.execute(
        "SELECT COUNT(*) FROM units WHERE unit_id = ?", (para,)
    ).fetchone()[0] == 1        # jamais supprimé, donc rien à restituer
