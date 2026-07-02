"""R4.2 — marker lift: inline peritext markers → unit_role / unit_status.

Covers the pure parser (allowlist, case-insensitivity, gloss/mid-text protection,
placeholder) and the document pass (dry-run vs apply, text_norm cleaning + FTS
removal, idempotence, manual-value preservation + conflict flagging).
"""
from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.marker_lift import lift_document_markers, parse_markers


# ── parse_markers (pure) ────────────────────────────────────────────────────────
def test_parse_role_trailing() -> None:
    assert parse_markers("David Goldblatt [T]") == ("titre", None, "David Goldblatt", True)


def test_parse_placeholder_status_plus_role() -> None:
    # "[non traduit] [Ch]" → chapô non traduit; whole line is markers → cleaned empty
    role, status, cleaned, matched = parse_markers("[non traduit] [Ch]")
    assert role == "chapeau" and status == "non_traduit" and cleaned == "" and matched


def test_parse_case_insensitive() -> None:
    assert parse_markers("[Non traduit]")[1] == "non_traduit"   # capital N variant (40× in corpus)
    assert parse_markers("Une section [INTERT]")[0] == "intertitre"


def test_parse_ajout() -> None:
    assert parse_markers("[+]") == (None, "ajout", "", True)


@pytest.mark.parametrize("text", [
    "the biro manufacturer [benefits]",   # trailing bracket NOT in allowlist (gloss)
    "some [aux États-Unis] mid text",     # mid-text bracket
    "plain text no marker",
])
def test_parse_gloss_and_plain_untouched(text: str) -> None:
    role, status, cleaned, matched = parse_markers(text)
    assert not matched and role is None and status is None and cleaned == text.rstrip()


def test_parse_stops_at_trailing_gloss_before_real_marker() -> None:
    # Trailing token is a gloss → stop; the [T] further left is left in place too.
    assert parse_markers("text [T] [gloss]") == (None, None, "text [T] [gloss]", False)


# ── lift_document_markers (db) ──────────────────────────────────────────────────
def _doc(conn: sqlite3.Connection) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('D', 'fr', 'standalone', datetime('now'))"
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def _unit(conn: sqlite3.Connection, doc_id: int, n: int, text: str) -> int:
    cur = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
        " VALUES (?, 'line', ?, ?, ?)",
        (doc_id, n, text, text),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def test_lift_dry_run_writes_nothing(db_conn: sqlite3.Connection) -> None:
    doc = _doc(db_conn)
    uid = _unit(db_conn, doc, 1, "Titre [T]")
    rep = lift_document_markers(db_conn, doc, dry_run=True)
    assert rep.units_affected == 1 and rep.dry_run
    row = db_conn.execute("SELECT unit_role, text_norm FROM units WHERE unit_id=?", (uid,)).fetchone()
    assert row["unit_role"] is None and row["text_norm"] == "Titre [T]"  # unchanged


def test_lift_apply_sets_role_cleans_norm_keeps_raw(db_conn: sqlite3.Connection) -> None:
    doc = _doc(db_conn)
    uid = _unit(db_conn, doc, 1, "Titre du texte [T]")
    rep = lift_document_markers(db_conn, doc, dry_run=False)
    assert rep.roles_set == 1 and "titre" in rep.roles_created
    row = db_conn.execute(
        "SELECT unit_role, text_norm, text_raw FROM units WHERE unit_id=?", (uid,)
    ).fetchone()
    assert row["unit_role"] == "titre"
    assert row["text_norm"] == "Titre du texte"          # cleaned
    assert row["text_raw"] == "Titre du texte [T]"        # verbatim preserved (ADR-043)


def test_lift_placeholder_leaves_fts(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.indexer import build_index
    doc = _doc(db_conn)
    uid = _unit(db_conn, doc, 1, "[non traduit] [Ch]")
    build_index(db_conn)
    assert db_conn.execute("SELECT COUNT(*) FROM fts_units WHERE rowid=?", (uid,)).fetchone()[0] == 1
    lift_document_markers(db_conn, doc, dry_run=False)
    row = db_conn.execute("SELECT unit_role, unit_status, text_norm FROM units WHERE unit_id=?", (uid,)).fetchone()
    assert row["unit_role"] == "chapeau" and row["unit_status"] == "non_traduit" and row["text_norm"] == ""
    assert db_conn.execute("SELECT COUNT(*) FROM fts_units WHERE rowid=?", (uid,)).fetchone()[0] == 0


def test_lift_idempotent_rerun_skips(db_conn: sqlite3.Connection) -> None:
    doc = _doc(db_conn)
    _unit(db_conn, doc, 1, "Titre [T]")
    lift_document_markers(db_conn, doc, dry_run=False)
    rep2 = lift_document_markers(db_conn, doc, dry_run=False)
    assert rep2.units_affected == 0  # text_norm already cleaned → nothing to lift


def test_lift_preserves_manual_role_and_flags_conflict(db_conn: sqlite3.Connection) -> None:
    doc = _doc(db_conn)
    uid = _unit(db_conn, doc, 1, "Titre [Ch]")  # marker says chapeau
    # A manual override to 'titre' (role must exist first — FK on unit_role).
    db_conn.execute(
        "INSERT OR IGNORE INTO unit_roles (name, label, color, sort_order, category)"
        " VALUES ('titre', 'Titre', '#2563eb', 1, 'structure')"
    )
    db_conn.execute("UPDATE units SET unit_role='titre' WHERE unit_id=?", (uid,))
    db_conn.commit()
    rep = lift_document_markers(db_conn, doc, dry_run=False)
    row = db_conn.execute("SELECT unit_role, text_norm FROM units WHERE unit_id=?", (uid,)).fetchone()
    assert row["unit_role"] == "titre"    # manual value preserved (fill-only-if-NULL)
    assert row["text_norm"] == "Titre"    # still cleaned
    assert any(c["field"] == "unit_role" and c["existing"] == "titre" and c["marker"] == "chapeau"
               for c in rep.conflicts)


def test_lift_ignores_gloss_unit(db_conn: sqlite3.Connection) -> None:
    doc = _doc(db_conn)
    uid = _unit(db_conn, doc, 1, "Las Vegas [la ville du péché]")  # trailing gloss, not a marker
    rep = lift_document_markers(db_conn, doc, dry_run=False)
    assert rep.units_affected == 0
    row = db_conn.execute("SELECT text_norm, unit_role FROM units WHERE unit_id=?", (uid,)).fetchone()
    assert row["text_norm"] == "Las Vegas [la ville du péché]" and row["unit_role"] is None
