"""R2.2 (refonte deux-grains) — derive the coarse grain from pluggable indices.

Voie A: the coarse grain is ``meta_json.parent_n``. :func:`derive_coarse_blocks`
groups by it when the doc is fine-segmented, and otherwise falls back to one coarse
block per line — classifying heading lines / structure units and detecting composite
``¤`` lines, **without** folding several paragraphs into a section (2-grain stays 2).
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.coarse_grain import (
    coarse_blocks_for_doc,
    derive_coarse_blocks,
)

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


def _line(n: int, text: str = "x", *, role: str | None = None, meta: dict | None = None) -> dict:
    return {
        "n": n, "unit_type": "line", "unit_role": role,
        "meta_json": json.dumps(meta) if meta else None, "text_raw": text,
    }


# --- derived regime (no parent_n) ------------------------------------------------

def test_docx_paragraphs_one_line_one_block() -> None:
    blocks = derive_coarse_blocks([_line(1), _line(2), _line(3)])
    assert [b["anchor_n"] for b in blocks] == [1, 2, 3]
    assert all(b["kind"] == "line" and b["fine_count"] == 1 for b in blocks)
    assert all(b["member_ns"] == [b["anchor_n"]] for b in blocks)


def test_composite_line_detected_from_sep() -> None:
    # One paragraph joined by ¤ (ADR-002) → a single composite coarse block whose fine
    # cardinality is already known, no resegmentation needed.
    block = derive_coarse_blocks([_line(1, "Un¤Deux¤Trois")])[0]
    assert block["kind"] == "composite"
    assert block["fine_count"] == 3
    assert block["member_ns"] == [1]


def test_intertitre_line_is_heading_block() -> None:
    blocks = derive_coarse_blocks([_line(1, "Titre", role="intertitre"), _line(2, "corps")])
    assert blocks[0]["kind"] == "heading" and blocks[0]["role"] == "intertitre"
    assert blocks[0]["member_ns"] == [1]          # heading line is its own coarse block
    assert blocks[1]["kind"] == "line"


def test_structure_unit_is_headless_heading() -> None:
    struct = {"n": 1, "unit_type": "structure", "unit_role": "section",
              "meta_json": None, "text_raw": "Chapitre I"}
    blocks = derive_coarse_blocks([struct, _line(2, "corps")])
    assert blocks[0]["kind"] == "heading" and blocks[0]["member_ns"] == []
    assert blocks[1]["member_ns"] == [2]          # section does NOT absorb the body line


def test_structure_does_not_merge_multiple_body_lines() -> None:
    # A section with several paragraphs stays several coarse blocks (not one).
    struct = {"n": 1, "unit_type": "structure", "unit_role": None,
              "meta_json": None, "text_raw": "H"}
    blocks = derive_coarse_blocks([struct, _line(2), _line(3), _line(4)])
    assert len([b for b in blocks if b["kind"] == "line"]) == 3


# --- anchored regime (parent_n present) ------------------------------------------

def test_anchored_groups_sentences_by_parent() -> None:
    units = [
        _line(1, meta={"parent_n": 1}),   # ¶1 → 2 sentences
        _line(2, meta={"parent_n": 1}),
        _line(3, meta={"parent_n": 2}),   # ¶2 → 1 sentence
    ]
    blocks = derive_coarse_blocks(units)
    assert [b["anchor_n"] for b in blocks] == [1, 2]
    assert blocks[0]["kind"] == "sentence-grouped" and blocks[0]["member_ns"] == [1, 2]
    assert blocks[0]["fine_count"] == 2
    # a paragraph that produced a single sentence reads as a plain line, not "grouped"
    assert blocks[1]["kind"] == "line" and blocks[1]["member_ns"] == [3]


def test_unsorted_input_is_normalised() -> None:
    blocks = derive_coarse_blocks([_line(3), _line(1), _line(2)])
    assert [b["anchor_n"] for b in blocks] == [1, 2, 3]


# --- integration: real resegmentation, via conn ----------------------------------

@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "test.db")
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _doc(conn: sqlite3.Connection) -> int:
    cur = conn.execute(
        "INSERT INTO documents (title, language, source_path, source_hash, created_at)"
        " VALUES ('Doc', 'fr', 'x.txt', 'abc', '2024-01-01T00:00:00')",
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def test_coarse_blocks_for_doc_after_resegment(db: sqlite3.Connection) -> None:
    from multicorpus_engine.segmenter import resegment_document

    doc = _doc(db)
    for i, text in enumerate(["Première phrase. Deuxième phrase.", "Seule phrase ici."], start=1):
        db.execute(
            "INSERT INTO units (doc_id, unit_type, n, text_raw, text_norm)"
            " VALUES (?, 'line', ?, ?, ?)",
            (doc, i, text, text),
        )
    db.commit()

    # before: not segmented → 2 singleton coarse blocks (one per source paragraph)
    before = coarse_blocks_for_doc(db, doc)
    assert [b["anchor_n"] for b in before] == [1, 2]
    assert all(b["kind"] == "line" for b in before)

    resegment_document(db, doc, lang="fr")

    # after: 3 sentence-lines regroup into the same 2 coarse blocks via parent_n
    after = coarse_blocks_for_doc(db, doc)
    assert [b["anchor_n"] for b in after] == [1, 2]
    assert after[0]["kind"] == "sentence-grouped" and after[0]["fine_count"] == 2
    assert after[1]["kind"] == "line" and after[1]["fine_count"] == 1
