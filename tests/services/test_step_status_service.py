"""La couche manuelle du statut par étape (ACT-01, migration 038).

Ce qui se joue ici n'est pas le stockage — un upsert sur deux colonnes — mais la
**péremption**. Un `[X]` qui survit au travail qui le dément est un mensonge silencieux,
et la mesure du 31 août estime qu'environ une coche sur trois finirait dans ce cas. Deux
signaux sont donc figés à la pose et comparés à la lecture ; aucun ne couvre seul, et
c'est ce que ces tests épinglent.
"""

from __future__ import annotations

import json
import sqlite3

import pytest

from multicorpus_engine.services.errors import BadRequestError, NotFoundError
from multicorpus_engine.services.step_status_service import (
    ACTIONS_BY_STEP,
    STEPS,
    clear_step_status,
    set_step_status,
    step_status_map,
)


def _doc(conn: sqlite3.Connection, title: str = "D") -> int:
    return int(conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES (?, 'fr', 'standalone', datetime('now'))", (title,)
    ).lastrowid)


def _unit(conn: sqlite3.Connection, doc_id: int, n: int, text: str = "x") -> int:
    return int(conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (?, 'line', ?, ?, ?)", (doc_id, n, text, text)
    ).lastrowid)


def _action(conn: sqlite3.Connection, doc_id: int, kind: str, reverted: int = 0) -> int:
    return int(conn.execute(
        "INSERT INTO prep_action_history (doc_id, action_type, performed_at, description, reverted)"
        " VALUES (?, ?, datetime('now'), 'test', ?)", (doc_id, kind, reverted)
    ).lastrowid)


def _state(conn: sqlite3.Connection, doc_id: int, step: str) -> dict:
    return step_status_map(conn)[doc_id][step]


# --- pose et retrait ------------------------------------------------------------
def test_poser_une_coche_la_rend_lisible(db_conn: sqlite3.Connection) -> None:
    doc_id = _doc(db_conn)
    _unit(db_conn, doc_id, 1)
    db_conn.commit()

    out = set_step_status(db_conn, {"doc_id": doc_id, "step": "segmentation"})
    assert out["step"] == "segmentation"
    assert out["validated_at"]

    etat = _state(db_conn, doc_id, "segmentation")
    assert etat["stale"] is False
    assert etat["stale_reason"] is None


def test_reposer_rafraichit_au_lieu_de_dupliquer(db_conn: sqlite3.Connection) -> None:
    """« Je reconfirme après avoir retravaillé » : la coche se repose, elle ne s'empile pas."""
    doc_id = _doc(db_conn)
    _unit(db_conn, doc_id, 1)
    db_conn.commit()
    set_step_status(db_conn, {"doc_id": doc_id, "step": "curation"})
    _action(db_conn, doc_id, "curation_apply")
    db_conn.commit()
    assert _state(db_conn, doc_id, "curation")["stale"] is True

    set_step_status(db_conn, {"doc_id": doc_id, "step": "curation"})
    assert _state(db_conn, doc_id, "curation")["stale"] is False
    n = db_conn.execute("SELECT COUNT(*) FROM doc_step_status WHERE doc_id = ?", (doc_id,)).fetchone()[0]
    assert n == 1


def test_retirer_une_coche_absente_n_est_pas_une_erreur(db_conn: sqlite3.Connection) -> None:
    doc_id = _doc(db_conn)
    db_conn.commit()
    assert clear_step_status(db_conn, {"doc_id": doc_id, "step": "annotation"})["cleared"] is False
    set_step_status(db_conn, {"doc_id": doc_id, "step": "annotation"})
    assert clear_step_status(db_conn, {"doc_id": doc_id, "step": "annotation"})["cleared"] is True
    assert step_status_map(db_conn).get(doc_id, {}) == {}


@pytest.mark.parametrize("body", [
    {"step": "curation"},                       # doc_id manquant
    {"doc_id": "x", "step": "curation"},        # doc_id non entier
    {"doc_id": 1, "step": "relecture"},         # capacité inconnue
    {"doc_id": 1},                              # step manquant
])
def test_entrees_invalides(db_conn: sqlite3.Connection, body: dict) -> None:
    with pytest.raises(BadRequestError):
        set_step_status(db_conn, body)


def test_document_inexistant(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        set_step_status(db_conn, {"doc_id": 99999, "step": "curation"})


# --- péremption par l'historique, SCOPÉE par capacité ---------------------------
def test_une_action_de_la_meme_capacite_perime_la_coche(db_conn: sqlite3.Connection) -> None:
    doc_id = _doc(db_conn)
    _unit(db_conn, doc_id, 1)
    _action(db_conn, doc_id, "curation_apply")   # une passe AVANT la coche
    db_conn.commit()
    set_step_status(db_conn, {"doc_id": doc_id, "step": "curation"})
    assert _state(db_conn, doc_id, "curation")["stale"] is False

    _action(db_conn, doc_id, "update_text")      # une retouche APRÈS
    db_conn.commit()
    etat = _state(db_conn, doc_id, "curation")
    assert etat["stale"] is True
    assert etat["stale_reason"] == "update_text"


def test_set_role_ne_perime_rien(db_conn: sqlite3.Connection) -> None:
    """Le sur-déclenchement que la règle naïve produisait, épinglé.

    `set_role` compte 11 actions sur la base de travail et ne concerne AUCUNE des quatre
    capacités. Sous « toute action postérieure périme », renommer un rôle annulerait tout
    ce qui était validé sur le document — les quatre coches d'un coup.
    """
    doc_id = _doc(db_conn)
    _unit(db_conn, doc_id, 1)
    db_conn.commit()
    for step in STEPS:
        set_step_status(db_conn, {"doc_id": doc_id, "step": step})

    _action(db_conn, doc_id, "set_role")
    db_conn.commit()

    etats = step_status_map(db_conn)[doc_id]
    assert [etats[s]["stale"] for s in STEPS] == [False, False, False, False]


def test_une_action_annulee_ne_perime_pas(db_conn: sqlite3.Connection) -> None:
    """`reverted = 1` : le travail a été défait, il ne dément plus rien."""
    doc_id = _doc(db_conn)
    _unit(db_conn, doc_id, 1)
    db_conn.commit()
    set_step_status(db_conn, {"doc_id": doc_id, "step": "segmentation"})
    _action(db_conn, doc_id, "resegment", reverted=1)
    db_conn.commit()
    assert _state(db_conn, doc_id, "segmentation")["stale"] is False


def test_une_action_d_une_autre_capacite_ne_perime_pas_celle_ci(
    db_conn: sqlite3.Connection,
) -> None:
    doc_id = _doc(db_conn)
    _unit(db_conn, doc_id, 1)
    db_conn.commit()
    set_step_status(db_conn, {"doc_id": doc_id, "step": "curation"})
    set_step_status(db_conn, {"doc_id": doc_id, "step": "segmentation"})

    _action(db_conn, doc_id, "set_paragraph")   # segmentation seule
    db_conn.commit()
    etats = step_status_map(db_conn)[doc_id]
    assert etats["segmentation"]["stale"] is True
    assert etats["curation"]["stale"] is False


# --- péremption par l'état dérivé, pour les documents sans historique -----------
def test_le_signal_derive_rattrape_ce_que_l_historique_ignore(
    db_conn: sqlite3.Connection,
) -> None:
    """36 documents sur 58 n'ont AUCUNE action enregistrée.

    Sur eux, une signature fondée sur le seul historique ne pourrait jamais rien périmer :
    le `[X]` y serait définitif faute de preuve du contraire.
    """
    doc_id = _doc(db_conn)
    _unit(db_conn, doc_id, 1)
    db_conn.commit()
    set_step_status(db_conn, {"doc_id": doc_id, "step": "segmentation"})
    etat = _state(db_conn, doc_id, "segmentation")
    assert etat["basis"] == "derived"     # aucun historique à la pose, la coche le dit
    assert etat["stale"] is False

    _unit(db_conn, doc_id, 2)             # le découpage change, sans passer par l'historique
    db_conn.commit()
    etat = _state(db_conn, doc_id, "segmentation")
    assert etat["stale"] is True
    assert etat["stale_reason"] == "derived:unit_count"


def test_basis_history_quand_une_trace_existe(db_conn: sqlite3.Connection) -> None:
    doc_id = _doc(db_conn)
    _unit(db_conn, doc_id, 1)
    _action(db_conn, doc_id, "resegment")
    db_conn.commit()
    set_step_status(db_conn, {"doc_id": doc_id, "step": "segmentation"})
    assert _state(db_conn, doc_id, "segmentation")["basis"] == "history"


def test_un_document_sans_trace_qui_en_gagne_une_perime(db_conn: sqlite3.Connection) -> None:
    """Le cas de bascule : coche posée sans historique, action enregistrée ensuite.

    `last_action_id` vaut alors NULL, et toute action de la capacité lui est postérieure.
    C'est ce qui fait que le repli dérivé peut disparaître sans réécrire les coches.
    """
    doc_id = _doc(db_conn)
    _unit(db_conn, doc_id, 1)
    db_conn.commit()
    set_step_status(db_conn, {"doc_id": doc_id, "step": "annotation"})
    assert _state(db_conn, doc_id, "annotation")["basis"] == "derived"

    _action(db_conn, doc_id, "merge_units")
    db_conn.commit()
    etat = _state(db_conn, doc_id, "annotation")
    assert etat["stale"] is True
    assert etat["stale_reason"] == "merge_units"


# --- la table de correspondance elle-même ---------------------------------------
def test_la_correspondance_ne_nomme_que_des_types_d_action_reels() -> None:
    """Une faute de frappe y serait muette : la capacité ne périmerait plus jamais."""
    from multicorpus_engine.action_history import ALLOWED_ACTION_TYPES

    for step, kinds in ACTIONS_BY_STEP.items():
        inconnus = kinds - set(ALLOWED_ACTION_TYPES)
        assert not inconnus, f"{step} nomme des types inexistants : {sorted(inconnus)}"


def test_les_quatre_capacites_ont_une_correspondance() -> None:
    assert set(ACTIONS_BY_STEP) == set(STEPS)
    assert all(ACTIONS_BY_STEP[s] for s in STEPS), "une capacité sans action ne périme jamais"


def test_set_role_n_est_dans_aucune_capacite() -> None:
    for step, kinds in ACTIONS_BY_STEP.items():
        assert "set_role" not in kinds, f"{step} périmerait sur un renommage de rôle"


# --- robustesse -----------------------------------------------------------------
def test_une_capacite_retiree_dort_sans_faire_echouer_la_lecture(
    db_conn: sqlite3.Connection,
) -> None:
    """`step` n'a pas de CHECK SQL : une ligne d'une capacité disparue ne doit rien casser."""
    doc_id = _doc(db_conn)
    db_conn.execute(
        "INSERT INTO doc_step_status (doc_id, step, validated_at, derived_json)"
        " VALUES (?, 'relecture', '2026-08-31T00:00:00Z', '{}')", (doc_id,)
    )
    db_conn.commit()
    assert step_status_map(db_conn).get(doc_id, {}) == {}


def test_derived_json_illisible_ne_fait_pas_echouer_la_lecture(
    db_conn: sqlite3.Connection,
) -> None:
    doc_id = _doc(db_conn)
    db_conn.execute(
        "INSERT INTO doc_step_status (doc_id, step, validated_at, derived_json)"
        " VALUES (?, 'curation', '2026-08-31T00:00:00Z', 'pas du json')", (doc_id,)
    )
    db_conn.commit()
    assert _state(db_conn, doc_id, "curation")["stale"] is False


def test_l_instantane_derive_porte_les_quatre_sources(db_conn: sqlite3.Connection) -> None:
    """Les quatre valeurs dont `[ ]`/`[/]` se dérivent doivent toutes être figées.

    En oublier une rendrait la coche aveugle à cette dimension-là, sans que rien ne le
    dise.
    """
    doc_id = _doc(db_conn)
    _unit(db_conn, doc_id, 1)
    db_conn.commit()
    set_step_status(db_conn, {"doc_id": doc_id, "step": "curation"})
    raw = db_conn.execute(
        "SELECT derived_json FROM doc_step_status WHERE doc_id = ?", (doc_id,)
    ).fetchone()[0]
    assert set(json.loads(raw)) == {"unit_count", "token_count", "aligned_count", "curated_at"}
