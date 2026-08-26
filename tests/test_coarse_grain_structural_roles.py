"""The structural-role set comes from the corpus catalogue, not from a constant.

``unit_roles`` is per-corpus and user-editable (migration 013, ``category`` added by
018). Hard-coding ``{"intertitre"}`` meant a corpus whose section headings carry a
*custom* role saw none of them classed as headings, while a role the user deliberately
moved out of the structural category kept behaving as one. R2.2 micro-écart.
"""

from __future__ import annotations

import json
import sqlite3

from multicorpus_engine.coarse_grain import (
    STRUCTURAL_ROLES,
    coarse_blocks_for_doc,
    structural_roles_for,
)


def _add_role(conn: sqlite3.Connection, name: str, category: str) -> None:
    conn.execute(
        "INSERT INTO unit_roles (name, label, category) VALUES (?, ?, ?)",
        (name, name.capitalize(), category),
    )


def _add_doc(conn: sqlite3.Connection, title: str = "doc") -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES (?, 'fr', 'standalone', '2026-08-26T00:00:00Z')",
        (title,),
    )
    return int(cur.lastrowid)


def _add_unit(conn, doc_id, n, text, unit_role=None, parent_n=None, unit_type="line"):
    meta = json.dumps({"parent_n": parent_n}) if parent_n is not None else None
    conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm, unit_role, meta_json)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (doc_id, unit_type, n, text, text, unit_role, meta),
    )


# ─── the catalogue read ─────────────────────────────────────────────────────


def test_custom_structural_role_is_read_from_the_catalogue(db_conn) -> None:
    _add_role(db_conn, "chapeau", "structure")
    _add_role(db_conn, "traduction", "text")

    assert structural_roles_for(db_conn) == frozenset({"chapeau"})


def test_role_moved_out_of_the_structure_category_stops_counting(db_conn) -> None:
    """``intertitre`` is structural only because the catalogue says so."""
    _add_role(db_conn, "intertitre", "text")

    assert structural_roles_for(db_conn) == frozenset()


def test_missing_catalogue_falls_back_to_the_builtin_set() -> None:
    """A DB older than migrations 013/018 has no table (or no ``category``)."""
    conn = sqlite3.connect(":memory:")

    assert structural_roles_for(conn) == STRUCTURAL_ROLES


# ─── what it changes downstream ─────────────────────────────────────────────


def test_custom_role_heading_is_classed_as_a_heading_block(db_conn) -> None:
    """End to end: a ``chapeau``-role line becomes ``kind='heading'``.

    Before the fix the hard-coded set knew only ``intertitre``, so this line was
    classed as ordinary content and merged into the reading flow.
    """
    _add_role(db_conn, "chapeau", "structure")
    doc_id = _add_doc(db_conn)
    _add_unit(db_conn, doc_id, 1, "Première partie", unit_role="chapeau")
    _add_unit(db_conn, doc_id, 2, "Le texte courant commence ici.")
    db_conn.commit()

    blocks = coarse_blocks_for_doc(db_conn, doc_id)

    assert [(b["kind"], b["role"]) for b in blocks] == [
        ("heading", "chapeau"),
        ("line", None),
    ]


def test_intertitre_out_of_category_is_no_longer_a_heading(db_conn) -> None:
    """The mirror case: the catalogue demotes ``intertitre`` and the derivation follows."""
    _add_role(db_conn, "intertitre", "text")
    doc_id = _add_doc(db_conn)
    _add_unit(db_conn, doc_id, 1, "Un titre qui n'en est plus un", unit_role="intertitre")
    db_conn.commit()

    blocks = coarse_blocks_for_doc(db_conn, doc_id)

    assert [b["kind"] for b in blocks] == ["line"]
