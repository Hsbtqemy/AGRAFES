"""Tests for the DOCX numbered-lines importer."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


def test_import_docx_numbered_lines_extracts_external_id(
    db_conn: sqlite3.Connection,
    simple_docx: Path,
) -> None:
    """external_id must be extracted correctly from [n] prefixes."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines

    report = import_docx_numbered_lines(
        conn=db_conn,
        path=simple_docx,
        language="fr",
        title="Test Doc",
    )

    assert report.doc_id == 1
    assert report.units_line == 5  # [1]..[5]
    assert report.units_structure == 2  # "Introduction" and "Section 2"

    # Verify external_ids in DB
    rows = db_conn.execute(
        "SELECT external_id FROM units WHERE unit_type='line' ORDER BY n"
    ).fetchall()
    external_ids = [r[0] for r in rows]
    assert external_ids == [1, 2, 3, 4, 5]


def test_import_keeps_sep_in_raw_and_removes_in_norm(
    db_conn: sqlite3.Connection,
    simple_docx: Path,
) -> None:
    """¤ must be preserved in text_raw and replaced by space in text_norm."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines

    import_docx_numbered_lines(
        conn=db_conn,
        path=simple_docx,
        language="fr",
    )

    # Line 3 has ¤
    row = db_conn.execute(
        "SELECT text_raw, text_norm FROM units WHERE external_id = 3"
    ).fetchone()
    assert row is not None, "Unit with external_id=3 not found"

    text_raw = row["text_raw"]
    text_norm = row["text_norm"]

    assert "\u00a4" in text_raw, "¤ must be kept in text_raw"
    assert "\u00a4" not in text_norm, "¤ must be removed from text_norm"
    # ¤ replaced by space, so adjacent words are separated
    assert " " in text_norm


def test_structure_paragraphs_not_indexed(
    db_conn: sqlite3.Connection,
    simple_docx: Path,
) -> None:
    """Structure paragraphs must not appear in the FTS index."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.indexer import build_index

    import_docx_numbered_lines(conn=db_conn, path=simple_docx, language="fr")
    build_index(db_conn)

    # Verify structure units are in units table
    struct_count = db_conn.execute(
        "SELECT COUNT(*) FROM units WHERE unit_type='structure'"
    ).fetchone()[0]
    assert struct_count == 2

    # Verify structure unit text is NOT findable via FTS
    # "Introduction" is a structure paragraph
    hits = db_conn.execute(
        "SELECT rowid FROM fts_units WHERE fts_units MATCH 'Introduction'"
    ).fetchall()
    assert len(hits) == 0, "Structure paragraphs must not be in the FTS index"

    # Verify line units ARE findable
    hits_line = db_conn.execute(
        "SELECT rowid FROM fts_units WHERE fts_units MATCH 'Bonjour'"
    ).fetchall()
    assert len(hits_line) > 0, "Line units must be in the FTS index"


def test_import_detects_holes(
    db_conn: sqlite3.Connection,
    docx_with_holes: Path,
) -> None:
    """Importer must detect and report holes in external_id sequence."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines

    report = import_docx_numbered_lines(
        conn=db_conn, path=docx_with_holes, language="fr"
    )
    assert 3 in report.holes
    assert 4 in report.holes
    assert any("Holes" in w for w in report.warnings)


def test_import_detects_duplicates(
    db_conn: sqlite3.Connection,
    docx_with_duplicates: Path,
) -> None:
    """Importer must detect and report duplicate external_ids."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines

    report = import_docx_numbered_lines(
        conn=db_conn, path=docx_with_duplicates, language="fr"
    )
    assert 2 in report.duplicates
    assert any("Duplicate" in w for w in report.warnings)
