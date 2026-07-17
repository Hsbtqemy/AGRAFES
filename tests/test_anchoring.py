"""Ancrage amont (chantier 1, DESIGN_upstream_anchoring §2/§4) — ``anchor_status`` classe
comment un document est *ancré* pour l'alignement (value / paragraph / position / aucune),
afin que la barre « Aligner » PRÉVIENNE avant un run qui dériverait (cas Beigbeder EN).

Fonction pure ``anchor_status`` + mince aller-retour ``conn`` ``anchor_status_for_doc``.
Ce module est neuf : la RED-sur-ancien est l'``ImportError`` (le module n'existait pas) ;
la garde de non-régression du classifieur réutilisé vit dans test_coarse_grain.
"""
from __future__ import annotations

import json
import sqlite3

from multicorpus_engine.anchoring import (
    _external_id_anchor,
    anchor_status,
    anchor_status_for_doc,
)

_ABSENT = "__absent__"


def _line(n: int, *, ext: object = None, parent_n: object = _ABSENT, utype: str = "line") -> dict:
    meta = None if parent_n == _ABSENT else json.dumps({"parent_n": parent_n})
    return {"n": n, "unit_type": utype, "external_id": ext, "meta_json": meta}


# --- les trois familles d'ancre (§2) --------------------------------------------

def test_value_anchor_numbered_markers() -> None:
    """[3],[7],[9] — marqueurs non séquentiels : external_id ≠ n → ancre valeur (forte)."""
    st = anchor_status([_line(1, ext=3), _line(2, ext=7), _line(3, ext=9)])
    assert st == {"anchored": True, "kind": "value", "line_count": 3}


def test_position_anchor_paragraphs() -> None:
    """docx/odt_paragraphs (ADR-012) : external_id == n → ancre position."""
    st = anchor_status([_line(1, ext=1), _line(2, ext=2), _line(3, ext=3)])
    assert st == {"anchored": True, "kind": "position", "line_count": 3}


def test_paragraph_anchor_parent_n() -> None:
    """parent_n posé (resegmentation R2.1 / regroupement R5.4c) → ancre paragraphe."""
    st = anchor_status([_line(1, parent_n=1), _line(2, parent_n=1), _line(3, parent_n=2)])
    assert st == {"anchored": True, "kind": "paragraph", "line_count": 3}


# --- précédence value > paragraph > position (ANCHOR_PRECEDENCE) -----------------

def test_value_outranks_paragraph() -> None:
    """Un doc numéroté ([N]) puis resegmenté porte value ET paragraph → on rapporte value."""
    st = anchor_status([_line(1, ext=5, parent_n=1), _line(2, ext=8, parent_n=1)])
    assert st["kind"] == "value"


def test_paragraph_outranks_position() -> None:
    """Un docx_paragraphs resegmenté porte position ET paragraph → on rapporte paragraph."""
    st = anchor_status([_line(1, ext=1, parent_n=1), _line(2, ext=2, parent_n=1)])
    assert st["kind"] == "paragraph"


# --- aucune ancre → dérive (le cœur de la prévention) ---------------------------

def test_no_anchor_multiline_drifts() -> None:
    """Multi-lignes sans [N] ni parent_n : le cas Beigbeder EN → dérive déterministe."""
    st = anchor_status([_line(1), _line(2), _line(3)])
    assert st == {"anchored": False, "kind": None, "line_count": 3}


def test_no_anchor_blob_single_unit() -> None:
    """Blob = 1 unité, non ancrée : line_count=1 oriente vers le remède « extraire » (§5)."""
    st = anchor_status([_line(1)])
    assert st == {"anchored": False, "kind": None, "line_count": 1}


def test_explicit_null_parent_n_not_anchored() -> None:
    """{"parent_n": null} n'est PAS une ancre (miroir is_anchored_regime / FE-02)."""
    st = anchor_status([_line(1, parent_n=None), _line(2, parent_n=None)])
    assert st == {"anchored": False, "kind": None, "line_count": 2}


def test_structure_units_ignored() -> None:
    """Les unités structure ne comptent ni pour line_count ni pour l'ancre."""
    st = anchor_status([_line(1, ext=1), _line(2, utype="structure")])
    assert st == {"anchored": True, "kind": "position", "line_count": 1}


# --- inférence value vs position (§9 Q3) ----------------------------------------

def test_external_id_non_int_is_value() -> None:
    assert _external_id_anchor([{"n": 1, "external_id": "1a"}]) == "value"


def test_external_id_absent_everywhere_is_none() -> None:
    assert _external_id_anchor([{"n": 1, "external_id": None}]) is None


def test_partial_external_id_mismatch_is_value() -> None:
    """Un seul external_id ≠ n suffit à classer marqueur (value), pas position."""
    assert _external_id_anchor([{"n": 1, "external_id": 1}, {"n": 2, "external_id": 99}]) == "value"


# --- aller-retour conn ----------------------------------------------------------

def test_anchor_status_for_doc(db_conn: sqlite3.Connection) -> None:
    db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at) VALUES ('T','fr','original',datetime('now'))"
    )
    db_conn.execute("INSERT INTO units (doc_id,unit_type,n,external_id,text_raw,text_norm) VALUES (1,'line',1,10,'a','a')")
    db_conn.execute("INSERT INTO units (doc_id,unit_type,n,external_id,text_raw,text_norm) VALUES (1,'line',2,20,'b','b')")
    db_conn.commit()
    assert anchor_status_for_doc(db_conn, 1) == {"anchored": True, "kind": "value", "line_count": 2}
