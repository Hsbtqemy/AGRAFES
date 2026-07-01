"""R3.2 (refonte deux-grains) — the two-tier length-bounded (Gale–Church) aligner.

Paragraph tier (coarse blocks by total length) → sentence tier (within each 1-1 ¶
bead). N-M sentence beads are materialised as several 1-1 links sharing a bead_id;
gaps stay orphans; degrades to line grain when a doc is not fine-segmented.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.aligner import align_pair_by_length

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "test.db")
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _doc(conn: sqlite3.Connection, title: str, lang: str) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, source_path, source_hash, created_at)"
        " VALUES (?, ?, ?, ?, '2024-01-01T00:00:00')",
        (title, lang, f"{title}.txt", f"hash-{title}"),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def _sent(conn: sqlite3.Connection, doc_id: int, n: int, length: int, parent_n: int | None) -> int:
    """Insert a sentence line unit of a given character length (parent_n optional)."""
    text = "x" * length
    meta = json.dumps({"parent_n": parent_n}) if parent_n is not None else None
    cur = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm, meta_json)"
        " VALUES (?, 'line', ?, ?, ?, ?)",
        (doc_id, n, text, text, meta),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def test_length_bounded_basic_and_split(db: sqlite3.Connection) -> None:
    piv = _doc(db, "Pivot", "fr")
    tgt = _doc(db, "Target", "en")
    # pivot: ¶1 A(20), ¶2 B(30)
    a = _sent(db, piv, 1, 20, 1)
    b = _sent(db, piv, 2, 30, 2)
    # target: ¶1 A'(20) ; ¶2 split into B1'(15) + B2'(15)  → 1-2 with pivot B
    _a2 = _sent(db, tgt, 1, 20, 1)
    b1 = _sent(db, tgt, 2, 15, 2)
    b2 = _sent(db, tgt, 3, 15, 2)

    report = align_pair_by_length(db, piv, tgt, "run-test")
    assert report.links_created == 3

    rows = db.execute(
        "SELECT pivot_unit_id, target_unit_id, bead_id, external_id FROM alignment_links"
    ).fetchall()
    # A↔A' : plain 1-1 → bead_id NULL, external_id = pivot n = 1
    a_links = [r for r in rows if r["pivot_unit_id"] == a]
    assert len(a_links) == 1
    assert a_links[0]["bead_id"] is None
    assert a_links[0]["external_id"] == 1
    # B↔B1', B↔B2' : split → 2 links sharing a non-null bead_id
    b_links = [r for r in rows if r["pivot_unit_id"] == b]
    assert len(b_links) == 2
    assert b_links[0]["bead_id"] is not None
    assert b_links[0]["bead_id"] == b_links[1]["bead_id"]
    assert {r["target_unit_id"] for r in b_links} == {b1, b2}


def test_length_bounded_warns_when_not_fine_segmented(db: sqlite3.Connection) -> None:
    piv = _doc(db, "P", "fr")
    tgt = _doc(db, "T", "en")
    _sent(db, piv, 1, 20, None)  # no parent_n
    _sent(db, tgt, 1, 20, None)

    report = align_pair_by_length(db, piv, tgt, "run")
    assert report.links_created == 1  # degrades to line grain, still aligns
    assert any("paragraph grain" in w for w in report.warnings)


def _sent_text(conn: sqlite3.Connection, doc_id: int, n: int, text: str, parent_n: int) -> int:
    cur = conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm, meta_json)"
        " VALUES (?, 'line', ?, ?, ?, ?)",
        (doc_id, n, text, text, json.dumps({"parent_n": parent_n})),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def test_length_bounded_on_realistic_prose(db: sqlite3.Connection) -> None:
    """End-to-end on prose-shaped lengths: a FR sentence split into two EN sentences
    aligns as a 1-2 bead, its neighbours as plain 1-1 — the validated real-prose case."""
    piv = _doc(db, "FR", "fr")
    tgt = _doc(db, "EN", "en")
    _sent_text(db, piv, 1, "Le soleil se levait sur la ville endormie.", 1)
    s2 = _sent_text(db, piv, 2, "Les rues etaient encore desertes et silencieuses.", 1)
    _sent_text(db, piv, 3, "Il marcha longtemps sans but precis.", 2)
    _sent_text(db, tgt, 1, "The sun was rising over the sleeping city.", 1)
    t2 = _sent_text(db, tgt, 2, "The streets were still deserted.", 1)     # s2 split →
    t3 = _sent_text(db, tgt, 3, "and utterly silent.", 1)                  # → t2 + t3
    _sent_text(db, tgt, 4, "He walked for a long time with no particular aim.", 2)

    report = align_pair_by_length(db, piv, tgt, "run-prose")
    assert report.links_created == 4

    rows = db.execute(
        "SELECT pivot_unit_id, target_unit_id, bead_id FROM alignment_links"
    ).fetchall()
    s2_links = [r for r in rows if r["pivot_unit_id"] == s2]
    assert len(s2_links) == 2                                     # the 1-2 split
    assert s2_links[0]["bead_id"] is not None
    assert s2_links[0]["bead_id"] == s2_links[1]["bead_id"]       # one bead
    assert {r["target_unit_id"] for r in s2_links} == {t2, t3}
    # the two neighbours are plain 1-1 (no bead)
    assert sum(1 for r in rows if r["bead_id"] is None) == 2


def test_length_bounded_preserves_protected(db: sqlite3.Connection) -> None:
    piv = _doc(db, "P", "fr")
    tgt = _doc(db, "T", "en")
    a = _sent(db, piv, 1, 20, 1)
    a2 = _sent(db, tgt, 1, 20, 1)

    report = align_pair_by_length(db, piv, tgt, "run", protected_pairs={(a, a2)})
    assert report.links_created == 0                       # the only candidate is protected
    assert any("protégé" in w for w in report.warnings)
