"""Tests for ODT importers."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


def test_odt_paragraphs_all_units_are_lines(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.importers.odt_paragraphs import import_odt_paragraphs

    from tests.support_odt import make_odt_bytes

    path = tmp_path / "p.odt"
    path.write_bytes(make_odt_bytes(["Alpha", "Bravo", "Charlie"]))

    report = import_odt_paragraphs(conn=db_conn, path=path, language="en", title="Para Test")

    assert report.units_line == 3
    assert report.units_structure == 0
    rows = db_conn.execute(
        "SELECT unit_type FROM units WHERE doc_id = ? ORDER BY n",
        (report.doc_id,),
    ).fetchall()
    assert [r[0] for r in rows] == ["line", "line", "line"]


def test_odt_numbered_lines_extracts_external_id(
    db_conn: sqlite3.Connection,
    simple_odt: Path,
) -> None:
    from multicorpus_engine.importers.odt_numbered_lines import import_odt_numbered_lines

    report = import_odt_numbered_lines(
        conn=db_conn,
        path=simple_odt,
        language="fr",
        title="Test ODT",
    )

    assert report.doc_id == 1
    assert report.units_line == 5
    assert report.units_structure == 2

    rows = db_conn.execute(
        "SELECT external_id FROM units WHERE unit_type='line' ORDER BY n"
    ).fetchall()
    external_ids = [r[0] for r in rows]
    assert external_ids == [1, 2, 3, 4, 5]


def test_odt_invalid_zip_raises(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    from multicorpus_engine.importers.odt_paragraphs import import_odt_paragraphs

    bad = tmp_path / "x.odt"
    bad.write_bytes(b"not a zip")
    with pytest.raises(ValueError, match="valid"):
        import_odt_paragraphs(conn=db_conn, path=bad, language="fr")
