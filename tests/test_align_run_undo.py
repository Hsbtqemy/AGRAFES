"""ALI-17 / §10 — un run d'alignement est réversible (migration 036).

Un run avec ``replace_existing=true`` purge puis reconstruit. Sans archive, la seule
sortie était de relancer un calcul — et l'audit a montré sur pièce que ça coûte le
travail manuel de la veille. Ces tests couvrent la mécanique moteur ; l'archivage à la
purge est exercé par les tests HTTP de l'aligneur.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.sidecar import (
    AlignRunUndoError,
    _archive_run_purge,
    undo_alignment_run,
)

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


def _unit(conn: sqlite3.Connection, doc: int, n: int) -> int:
    cur = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (?, 'line', ?, ?, ?)", (doc, n, f"s{n}", f"s{n}"),
    )
    return int(cur.lastrowid)


def _run(conn: sqlite3.Connection, run_id: str, created_at: str, kind: str = "align") -> None:
    conn.execute(
        "INSERT INTO runs (run_id, kind, params_json, stats_json, created_at)"
        " VALUES (?, ?, '{}', '{}', ?)", (run_id, kind, created_at),
    )


def _link(conn: sqlite3.Connection, run_id: str, pdoc: int, tdoc: int,
          pu: int, tu: int, *, ext: int = 1, status: str | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id,"
        " pivot_doc_id, target_doc_id, created_at, status)"
        " VALUES (?, ?, ?, ?, ?, ?, '2024-01-01T00:00:00', ?)",
        (run_id, pu, tu, ext, pdoc, tdoc, status),
    )
    return int(cur.lastrowid)


def _fixture(conn: sqlite3.Connection):
    """Un pivot, une cible, deux paires d'unités, un run d'origine qui les a liées."""
    p, t = _doc(conn, "FR", "fr"), _doc(conn, "EN", "en")
    pu1, pu2 = _unit(conn, p, 1), _unit(conn, p, 2)
    tu1, tu2 = _unit(conn, t, 1), _unit(conn, t, 2)
    _run(conn, "run-old", "2024-01-01T10:00:00Z")
    l1 = _link(conn, "run-old", p, t, pu1, tu1, ext=1)
    l2 = _link(conn, "run-old", p, t, pu2, tu2, ext=2)
    conn.commit()
    return p, t, (pu1, pu2), (tu1, tu2), (l1, l2)


def _links(conn: sqlite3.Connection) -> list[tuple]:
    return [tuple(r) for r in conn.execute(
        "SELECT link_id, run_id, pivot_unit_id, target_unit_id, external_id, status"
        " FROM alignment_links ORDER BY link_id")]


# --- le cycle nominal -----------------------------------------------------------

def test_revert_restores_the_previous_generation_identically(db: sqlite3.Connection) -> None:
    p, t, (pu1, pu2), (tu1, tu2), _ = _fixture(db)
    before = _links(db)

    # Un nouveau run remplace tout.
    _run(db, "run-new", "2024-01-02T10:00:00Z")
    _archive_run_purge(db, "run-new", p, t, keep_accepted=False)
    db.execute("DELETE FROM alignment_links WHERE pivot_doc_id=? AND target_doc_id=?", (p, t))
    _link(db, "run-new", p, t, pu1, tu2, ext=9)   # appariement décalé
    db.commit()
    assert len(_links(db)) == 1

    out = undo_alignment_run(db, "run-new")
    assert out["links_deleted"] == 1
    assert out["links_restored"] == 2
    assert out["links_not_restored"] == 0
    # link_id ET run_id d'origine rendus : c'est une restitution, pas une re-création.
    assert _links(db) == before
    # l'archive est consommée — un second undo ne peut pas ressusciter la génération
    assert db.execute("SELECT COUNT(*) FROM align_run_purge").fetchone()[0] == 0


def test_an_additive_run_archives_nothing_and_reverts_by_deletion(db: sqlite3.Connection) -> None:
    """Les 38 runs « compléter » sur 53 : rien de détruit, donc rien à stocker."""
    p, t, (pu1, pu2), (tu1, tu2), _ = _fixture(db)
    before = _links(db)
    _run(db, "run-add", "2024-01-02T10:00:00Z")
    _link(db, "run-add", p, t, pu1, tu2, ext=9)   # ajout, aucune purge
    db.commit()
    assert db.execute("SELECT COUNT(*) FROM align_run_purge").fetchone()[0] == 0

    out = undo_alignment_run(db, "run-add")
    assert (out["links_deleted"], out["links_restored"]) == (1, 0)
    assert _links(db) == before


# --- la décision humaine prime, et elle est dite --------------------------------

def test_a_reviewed_link_is_kept_and_reported(db: sqlite3.Connection) -> None:
    """§11.6 : refuser tout l'undo pour un lien revu serait disproportionné (mesuré :
    2 runs sur 9, portant 2 et 1 liens sur 1226). On garde, on saute, on le dit."""
    p, t, (pu1, pu2), (tu1, tu2), _ = _fixture(db)
    _run(db, "run-new", "2024-01-02T10:00:00Z")
    _archive_run_purge(db, "run-new", p, t, keep_accepted=False)
    db.execute("DELETE FROM alignment_links WHERE pivot_doc_id=? AND target_doc_id=?", (p, t))
    _link(db, "run-new", p, t, pu1, tu1, ext=9, status="accepted")  # revu APRÈS le run
    _link(db, "run-new", p, t, pu2, tu2, ext=8)
    db.commit()

    out = undo_alignment_run(db, "run-new")
    assert out["links_kept"] == 1        # le lien validé survit
    assert out["links_deleted"] == 1     # l'autre est retiré
    # Le lien gardé occupe encore la paire (pu1,tu1) : la restitution correspondante
    # se saute d'elle-même et est comptée. Les deux mécaniques se composent.
    assert out["links_restored"] == 1
    assert out["links_not_restored"] == 1
    rows = _links(db)
    assert any(r[5] == "accepted" for r in rows)
    assert len(rows) == 2


# --- les gardes -----------------------------------------------------------------

def test_a_later_run_on_the_same_pair_blocks_the_revert(db: sqlite3.Connection) -> None:
    """Le coeur d'ALI-17 : restituer par-dessus une génération plus récente
    SUPERPOSERAIT une couche — exactement l'accumulation que le constat décrit."""
    p, t, (pu1, pu2), (tu1, tu2), _ = _fixture(db)
    _run(db, "run-a", "2024-01-02T10:00:00Z")
    _archive_run_purge(db, "run-a", p, t, keep_accepted=False)
    db.execute("DELETE FROM alignment_links WHERE pivot_doc_id=? AND target_doc_id=?", (p, t))
    _link(db, "run-a", p, t, pu1, tu1, ext=9)
    db.commit()
    _run(db, "run-b", "2024-01-03T10:00:00Z")
    _archive_run_purge(db, "run-b", p, t, keep_accepted=False)
    db.execute("DELETE FROM alignment_links WHERE pivot_doc_id=? AND target_doc_id=?", (p, t))
    _link(db, "run-b", p, t, pu2, tu2, ext=8)
    db.commit()

    with pytest.raises(AlignRunUndoError) as e:
        undo_alignment_run(db, "run-a")
    assert e.value.code == "superseded"
    assert "run-b" in e.value.message
    # rien n'a bougé
    assert len(_links(db)) == 1

    # …et le run le plus récent, lui, s'annule.
    out = undo_alignment_run(db, "run-b")
    assert out["links_restored"] == 1


def test_unknown_run_and_wrong_kind_are_refused(db: sqlite3.Connection) -> None:
    _fixture(db)
    with pytest.raises(AlignRunUndoError) as e:
        undo_alignment_run(db, "nope")
    assert e.value.code == "unknown_run"

    _run(db, "run-q", "2024-01-02T10:00:00Z", kind="query")
    db.commit()
    with pytest.raises(AlignRunUndoError) as e:
        undo_alignment_run(db, "run-q")
    assert e.value.code == "not_an_align_run"


def test_a_run_already_reverted_says_so(db: sqlite3.Connection) -> None:
    p, t, (pu1, _), (tu1, _), _ = _fixture(db)
    _run(db, "run-new", "2024-01-02T10:00:00Z")
    _archive_run_purge(db, "run-new", p, t, keep_accepted=False)
    db.execute("DELETE FROM alignment_links WHERE pivot_doc_id=? AND target_doc_id=?", (p, t))
    _link(db, "run-new", p, t, pu1, tu1, ext=9)
    db.commit()
    undo_alignment_run(db, "run-new")

    with pytest.raises(AlignRunUndoError) as e:
        undo_alignment_run(db, "run-new")
    assert e.value.code == "nothing_to_revert"


def test_a_link_whose_unit_vanished_is_skipped_not_fatal(db: sqlite3.Connection) -> None:
    """Même piège qu'à la passe de vérification : OR IGNORE enjambe l'unicité mais pas
    une clé étrangère. Une resegmentation entre le run et son annulation doit faire
    sauter le lien, pas mourir l'annulation."""
    p, t, (pu1, pu2), (tu1, tu2), _ = _fixture(db)
    _run(db, "run-new", "2024-01-02T10:00:00Z")
    _archive_run_purge(db, "run-new", p, t, keep_accepted=False)
    db.execute("DELETE FROM alignment_links WHERE pivot_doc_id=? AND target_doc_id=?", (p, t))
    db.commit()
    db.execute("DELETE FROM units WHERE unit_id=?", (tu2,))   # la cible disparaît
    db.commit()

    out = undo_alignment_run(db, "run-new")
    assert out["links_restored"] == 1
    assert out["links_not_restored"] == 1
    assert len(_links(db)) == 1


def test_preserve_accepted_archives_exactly_what_it_deletes(db: sqlite3.Connection) -> None:
    """Une archive plus large que la suppression ressusciterait des liens que le run
    n'a jamais touchés."""
    p, t, (pu1, pu2), (tu1, tu2), _ = _fixture(db)
    db.execute("UPDATE alignment_links SET status='accepted' WHERE pivot_unit_id=?", (pu1,))
    db.commit()
    n = _archive_run_purge(db, "run-new", p, t, keep_accepted=True)
    assert n == 1   # seul le lien NON accepté est archivé
    kept = db.execute(
        "SELECT pivot_unit_id FROM align_run_purge WHERE run_id='run-new'").fetchall()
    assert [r[0] for r in kept] == [pu2]
