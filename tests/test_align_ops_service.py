"""D-3 — les gestes de lot de l'Alignement sont annulables (migration 037).

Sept verbes de ``batch_update`` et quatre de ``collisions/resolve`` touchaient des
liens sans laisser la moindre trace. Ils ne touchent aucune unité, donc l'historique de
préparation — linéaire par document — n'avait rien à quoi les rattacher.

Ces tests couvrent la mécanique moteur. Le point qui les distingue des tests du run et
de ceux de l'archive de préparation : ici, **six verbes sur sept ne détruisent rien**,
ils mutent une ligne qui survit. Un ``INSERT OR IGNORE`` — la restitution des deux
autres archives — laisserait la mutation en place tout en rapportant « restauré ».
C'est ce que vérifie le premier test, et il échoue sur cette implémentation-là.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.services import align_links_service, align_ops_service
from multicorpus_engine.services.errors import ConflictError, NotFoundError

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


def _unit(conn: sqlite3.Connection, doc: int, n: int, text: str | None = None) -> int:
    body = text if text is not None else f"segment numero {n}"
    cur = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (?, 'line', ?, ?, ?)", (doc, n, body, body),
    )
    return int(cur.lastrowid)


def _link(conn: sqlite3.Connection, pdoc: int, tdoc: int, pu: int, tu: int,
          *, ext: int = 1, status: str | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id,"
        " pivot_doc_id, target_doc_id, created_at, status)"
        " VALUES ('run-1', ?, ?, ?, ?, ?, '2024-01-01T00:00:00', ?)",
        (pu, tu, ext, pdoc, tdoc, status),
    )
    return int(cur.lastrowid)


def _fixture(conn: sqlite3.Connection):
    """Un doc moyeu, un doc cible, deux paires liées."""
    p, t = _doc(conn, "FR", "fr"), _doc(conn, "EN", "en")
    pu1, pu2 = _unit(conn, p, 1), _unit(conn, p, 2)
    tu1, tu2 = _unit(conn, t, 1), _unit(conn, t, 2)
    l1 = _link(conn, p, t, pu1, tu1, ext=1)
    l2 = _link(conn, p, t, pu2, tu2, ext=2)
    conn.commit()
    return p, t, (pu1, pu2), (tu1, tu2), (l1, l2)


def _status(conn: sqlite3.Connection, link_id: int):
    row = conn.execute(
        "SELECT status FROM alignment_links WHERE link_id = ?", (link_id,)
    ).fetchone()
    return None if row is None else row[0]


# --- la mutation, cas majoritaire ------------------------------------------------

def test_undo_reverses_a_mutation_it_does_not_merely_leave_it(db: sqlite3.Connection) -> None:
    """Le test qui sépare cette archive des deux autres.

    Le lien SURVIT au geste : une restitution par ``INSERT OR IGNORE`` verrait la ligne
    déjà là, passerait son chemin, et rapporterait pourtant un succès. Le statut doit
    revenir à ``None``, pas rester à ``accepted``.
    """
    _, _, _, _, (l1, _) = _fixture(db)
    op = align_ops_service.archive_batch_op(db, [l1], action_types=["set_status"])
    db.execute("UPDATE alignment_links SET status='accepted' WHERE link_id=?", (l1,))
    db.commit()
    assert _status(db, l1) == "accepted"

    report = align_ops_service.undo_batch_op(db, op)
    db.commit()

    assert _status(db, l1) is None
    assert (report["updated"], report["reinserted"], report["skipped"]) == (1, 0, 0)


def test_undo_restores_a_cut_span(db: sqlite3.Connection) -> None:
    _, _, _, _, (l1, _) = _fixture(db)
    align_links_service.set_target_span(db, l1, 0, 7)
    db.commit()
    op = align_ops_service.archive_batch_op(db, [l1], action_types=["set_target_span"])
    align_links_service.set_target_span(db, l1, 2, 9)
    db.commit()

    align_ops_service.undo_batch_op(db, op)
    db.commit()

    row = db.execute(
        "SELECT target_char_start, target_char_end FROM alignment_links WHERE link_id=?", (l1,)
    ).fetchone()
    assert (row[0], row[1]) == (0, 7)


# --- la destruction --------------------------------------------------------------

def test_undo_reinserts_a_deleted_link_with_its_original_id(db: sqlite3.Connection) -> None:
    """``link_id`` archivé et rendu tel quel : AUTOINCREMENT ne recycle pas un rowid
    libéré, donc la restitution est identique et non une re-création approchée."""
    _, _, _, _, (l1, _) = _fixture(db)
    before = db.execute(
        "SELECT run_id, pivot_unit_id, target_unit_id, external_id, created_at"
        " FROM alignment_links WHERE link_id=?", (l1,)
    ).fetchone()
    op = align_ops_service.archive_batch_op(db, [l1], action_types=["delete"])
    db.execute("DELETE FROM alignment_links WHERE link_id=?", (l1,))
    db.commit()

    report = align_ops_service.undo_batch_op(db, op)
    db.commit()

    after = db.execute(
        "SELECT run_id, pivot_unit_id, target_unit_id, external_id, created_at"
        " FROM alignment_links WHERE link_id=?", (l1,)
    ).fetchone()
    assert tuple(after) == tuple(before)
    assert (report["updated"], report["reinserted"], report["skipped"]) == (0, 1, 0)


def test_a_link_whose_unit_vanished_is_skipped_not_fatal(db: sqlite3.Connection) -> None:
    """Une unité disparue lève FOREIGN KEY à la réinsertion. Comptée, jamais avalée —
    et surtout, elle ne doit pas faire échouer la restitution des autres liens."""
    p, t, (pu1, pu2), (tu1, tu2), (l1, l2) = _fixture(db)
    op = align_ops_service.archive_batch_op(db, [l1, l2], action_types=["delete"])
    db.execute("DELETE FROM alignment_links WHERE link_id IN (?, ?)", (l1, l2))
    db.execute("DELETE FROM units WHERE unit_id = ?", (tu2,))
    db.commit()

    report = align_ops_service.undo_batch_op(db, op)
    db.commit()

    assert (report["reinserted"], report["skipped"]) == (1, 1)
    assert _status(db, l1) is None            # revenu
    assert db.execute(
        "SELECT COUNT(*) FROM alignment_links WHERE link_id=?", (l2,)
    ).fetchone()[0] == 0                       # pas revenu, et pas d'exception


def test_a_reoccupied_pair_is_skipped_not_fatal(db: sqlite3.Connection) -> None:
    """La paire (pivot, cible) est unique depuis la migration 008. Si un lien plus jeune
    l'a reprise, on le laisse vivre et on le compte."""
    p, t, (pu1, _), (tu1, _), (l1, _) = _fixture(db)
    op = align_ops_service.archive_batch_op(db, [l1], action_types=["delete"])
    db.execute("DELETE FROM alignment_links WHERE link_id=?", (l1,))
    db.commit()
    neuf = _link(db, p, t, pu1, tu1, ext=9)    # même paire, autre lien
    db.commit()

    report = align_ops_service.undo_batch_op(db, op)
    db.commit()

    assert (report["reinserted"], report["skipped"]) == (0, 1)
    assert db.execute(
        "SELECT COUNT(*) FROM alignment_links WHERE link_id=?", (neuf,)
    ).fetchone()[0] == 1


# --- les deux refus --------------------------------------------------------------

def test_undoing_twice_is_refused(db: sqlite3.Connection) -> None:
    """L'opération est consommée : la garder laisserait un second undo ressusciter la
    même génération par-dessus celle qu'on vient de restituer."""
    _, _, _, _, (l1, _) = _fixture(db)
    op = align_ops_service.archive_batch_op(db, [l1], action_types=["set_status"])
    db.execute("UPDATE alignment_links SET status='rejected' WHERE link_id=?", (l1,))
    db.commit()
    align_ops_service.undo_batch_op(db, op)
    db.commit()

    with pytest.raises(NotFoundError):
        align_ops_service.undo_batch_op(db, op)


def test_a_later_gesture_on_the_same_links_blocks_the_undo(db: sqlite3.Connection) -> None:
    """Même discipline qu'ALI-03 : on ne défait pas par surprise une décision humaine
    postérieure. Le geste récent doit être annulé d'abord."""
    _, _, _, _, (l1, l2) = _fixture(db)
    op1 = align_ops_service.archive_batch_op(db, [l1, l2], action_types=["set_status"])
    db.execute("UPDATE alignment_links SET status='accepted'")
    db.commit()
    op2 = align_ops_service.archive_batch_op(db, [l2], action_types=["set_status"])
    db.execute("UPDATE alignment_links SET status='rejected' WHERE link_id=?", (l2,))
    db.commit()

    with pytest.raises(ConflictError):
        align_ops_service.undo_batch_op(db, op1)

    # Dans l'ordre, les deux passent.
    align_ops_service.undo_batch_op(db, op2)
    align_ops_service.undo_batch_op(db, op1)
    db.commit()
    assert _status(db, l1) is None and _status(db, l2) is None


def test_an_unknown_op_is_refused(db: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        align_ops_service.undo_batch_op(db, 4242)


# --- la tenue de la pile ---------------------------------------------------------

def test_a_batch_touching_nothing_opens_no_operation(db: sqlite3.Connection) -> None:
    _fixture(db)
    assert align_ops_service.archive_batch_op(db, [9999], action_types=["delete"]) is None
    assert db.execute("SELECT COUNT(*) FROM align_op").fetchone()[0] == 0


def test_discard_closes_an_operation_and_its_snapshots(db: sqlite3.Connection) -> None:
    """Un geste qui n'a rien changé ne doit pas laisser un « Annuler » qui ne défait
    rien — ni occuper une place de la pile bornée. CASCADE sur les instantanés."""
    _, _, _, _, (l1, _) = _fixture(db)
    op = align_ops_service.archive_batch_op(db, [l1], action_types=["set_status"])
    align_ops_service.discard_batch_op(db, op)
    db.commit()
    assert db.execute("SELECT COUNT(*) FROM align_op").fetchone()[0] == 0
    assert db.execute(
        "SELECT COUNT(*) FROM align_op_link_snapshots WHERE op_id=?", (op,)
    ).fetchone()[0] == 0


def test_the_stack_is_bounded(db: sqlite3.Connection) -> None:
    """Cette archive écrit à CHAQUE geste, « accepter » compris : sans borne elle
    croîtrait avec l'usage normal et non avec les accidents."""
    _, _, _, _, (l1, _) = _fixture(db)
    for _ in range(align_ops_service.ALIGN_OP_KEEP + 7):
        align_ops_service.archive_batch_op(db, [l1], action_types=["set_status"])
    db.commit()

    assert db.execute("SELECT COUNT(*) FROM align_op").fetchone()[0] == \
        align_ops_service.ALIGN_OP_KEEP
    # Les instantanés des opérations sorties de la pile partent avec elles (CASCADE) :
    # une archive orpheline ne serait jamais lue, et fausserait la garde de fraîcheur.
    orphelins = db.execute(
        "SELECT COUNT(*) FROM align_op_link_snapshots s"
        " WHERE NOT EXISTS (SELECT 1 FROM align_op o WHERE o.op_id = s.op_id)"
    ).fetchone()[0]
    assert orphelins == 0


# --- le libellé -------------------------------------------------------------------

def test_the_fallback_label_counts_what_was_archived_not_what_was_asked(
    db: sqlite3.Connection,
) -> None:
    """Un lot qui vise quatre liens dont deux ont disparu doit annoncer deux : sinon le
    bandeau promet plus qu'il ne peut rendre."""
    _, _, _, _, (l1, l2) = _fixture(db)
    op = align_ops_service.archive_batch_op(
        db, [l1, l2, 8001, 8002], action_types=["delete", "delete", "delete", "delete"]
    )
    db.commit()
    assert db.execute(
        "SELECT description FROM align_op WHERE op_id=?", (op,)
    ).fetchone()[0] == "suppression — 2 liens"


def test_a_compound_gesture_says_so(db: sqlite3.Connection) -> None:
    assert align_ops_service.default_description(["delete", "set_bead"], 3) \
        == "geste composé — 3 liens"
    assert align_ops_service.default_description(["set_target_span"], 1) == "coupe — 1 lien"


def test_an_explicit_label_wins(db: sqlite3.Connection) -> None:
    _, _, _, _, (l1, _) = _fixture(db)
    op = align_ops_service.archive_batch_op(
        db, [l1], label="⭙ Détacher", action_types=["delete"]
    )
    db.commit()
    assert db.execute(
        "SELECT description FROM align_op WHERE op_id=?", (op,)
    ).fetchone()[0] == "⭙ Détacher"


# --- le geste multi-requêtes (create puis batch_update) ---------------------------

def test_a_creation_is_undone_by_deleting_it(db: sqlite3.Connection) -> None:
    p, t, (pu1, pu2), (tu1, tu2), _ = _fixture(db)
    neuf = _link(db, p, t, pu2, tu1, ext=7)     # paire libre
    db.commit()
    op = align_ops_service.record_created_link(db, neuf)
    db.commit()

    report = align_ops_service.undo_batch_op(db, op)
    db.commit()

    assert report["deleted"] == 1
    assert db.execute(
        "SELECT COUNT(*) FROM alignment_links WHERE link_id=?", (neuf,)
    ).fetchone()[0] == 0


def test_the_two_halves_of_one_gesture_undo_together(db: sqlite3.Connection) -> None:
    """Le cas qui a motivé (a) : `create` puis `batch_update` sur UNE opération.

    Sans jointure, « Annuler » ne défaisait que la moitié batch — le lien supprimé
    revenait et le lien créé restait : le doublon exact d'ALI-22.
    """
    p, t, (pu1, pu2), (tu1, tu2), (l1, l2) = _fixture(db)
    cree = _link(db, p, t, pu2, tu1, ext=7)
    db.commit()
    op = align_ops_service.record_created_link(db, cree, label="＝ Rattacher")
    meme_op = align_ops_service.archive_batch_op(
        db, [l1], op_id=op, label="＝ Rattacher", action_types=["delete"]
    )
    assert meme_op == op                          # une seule opération, pas deux
    db.execute("DELETE FROM alignment_links WHERE link_id=?", (l1,))
    db.commit()

    report = align_ops_service.undo_batch_op(db, op)
    db.commit()

    assert (report["deleted"], report["reinserted"]) == (1, 1)
    assert db.execute(
        "SELECT COUNT(*) FROM alignment_links WHERE link_id=?", (cree,)
    ).fetchone()[0] == 0                          # la création est repartie
    assert db.execute(
        "SELECT COUNT(*) FROM alignment_links WHERE link_id=?", (l1,)
    ).fetchone()[0] == 1                          # la suppression est revenue


def test_the_creation_is_deleted_before_the_restitution(db: sqlite3.Connection) -> None:
    """L'ordre des deux passes, prouvé sur le cas qui le rend visible.

    Le geste supprime un lien puis en crée un autre SUR LA MÊME PAIRE. Restituer
    d'abord buterait sur la contrainte d'unicité (migration 008) et compterait le lien
    en « skipped » alors que la place se libère une ligne plus bas.
    """
    p, t, (pu1, _), (tu1, _), (l1, _) = _fixture(db)
    op = align_ops_service.archive_batch_op(db, [l1], action_types=["delete"])
    db.execute("DELETE FROM alignment_links WHERE link_id=?", (l1,))
    remplacant = _link(db, p, t, pu1, tu1, ext=8)   # même paire que l1
    align_ops_service.record_created_link(db, remplacant, op_id=op)
    db.commit()

    report = align_ops_service.undo_batch_op(db, op)
    db.commit()

    assert (report["deleted"], report["reinserted"], report["skipped"]) == (1, 1, 0)
    assert db.execute(
        "SELECT COUNT(*) FROM alignment_links WHERE link_id=?", (l1,)
    ).fetchone()[0] == 1


def test_the_first_snapshot_of_a_link_wins(db: sqlite3.Connection) -> None:
    """Deux requêtes du même geste touchent le même lien : l'instantané qui vaut est
    celui pris AVANT la première, pas l'état intermédiaire vu par la seconde."""
    _, _, _, _, (l1, _) = _fixture(db)
    op = align_ops_service.archive_batch_op(db, [l1], action_types=["set_status"])
    db.execute("UPDATE alignment_links SET status='accepted' WHERE link_id=?", (l1,))
    align_ops_service.archive_batch_op(db, [l1], op_id=op, action_types=["set_status"])
    db.execute("UPDATE alignment_links SET status='rejected' WHERE link_id=?", (l1,))
    db.commit()

    align_ops_service.undo_batch_op(db, op)
    db.commit()
    assert _status(db, l1) is None


def test_an_unknown_op_id_opens_a_fresh_one_rather_than_failing(
    db: sqlite3.Connection,
) -> None:
    """Un geste ne doit jamais échouer à cause de sa propre comptabilité d'annulation."""
    _, _, _, _, (l1, _) = _fixture(db)
    op = align_ops_service.archive_batch_op(
        db, [l1], op_id=9999, action_types=["set_status"]
    )
    db.commit()
    assert isinstance(op, int) and op != 9999


def test_discarding_never_closes_an_operation_it_only_joined(db: sqlite3.Connection) -> None:
    """La garde qui protège la première moitié d'un geste.

    `delete` rejoint l'opération d'un `create`, ne supprime rien, et veut refermer :
    s'il le faisait, la création partirait avec, et le geste deviendrait indéfaisable.
    """
    p, t, (_, pu2), (tu1, _), _ = _fixture(db)
    cree = _link(db, p, t, pu2, tu1, ext=7)
    db.commit()
    op = align_ops_service.record_created_link(db, cree)

    align_ops_service.discard_batch_op(db, op, joined=op)
    db.commit()
    assert db.execute("SELECT COUNT(*) FROM align_op WHERE op_id=?", (op,)).fetchone()[0] == 1

    # Une opération qu'on a bien ouverte soi-même, elle, se referme.
    align_ops_service.discard_batch_op(db, op, joined=None)
    db.commit()
    assert db.execute("SELECT COUNT(*) FROM align_op WHERE op_id=?", (op,)).fetchone()[0] == 0
