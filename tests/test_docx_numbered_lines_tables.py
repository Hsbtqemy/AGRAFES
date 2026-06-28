"""Tests for the DOCX numbered-lines importer's column_index support.

Covers the 5 pathological cases listed in the design ticket
(docs/TICKET_DOCX_TABLES.md) plus regression on the legacy
column_index=None path.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

# python-docx is a hard dep of the importer.
docx = pytest.importorskip("docx")


# ─── ENG-02: [n] prefix stripped from rich, not by the plain offset ──────────
def test_paragraph_to_unit_strips_marker_despite_leading_whitespace(monkeypatch) -> None:
    """ENG-02: leading whitespace (or any normalize length change) shifts the
    plain-text offset; slicing the rich text by it leaks the closing ']'. The
    marker must be re-matched on rich.lstrip()."""
    from multicorpus_engine.importers import docx_numbered_lines as mod

    # rich has two leading spaces → plain ("[1] hello") offset 4 would slice
    # rich="  [1] hello" at "] hello" (marker leakage). The fix yields "hello".
    monkeypatch.setattr(mod, "para_to_rich_text", lambda para: "  [1] hello")
    result = mod._paragraph_to_unit(object(), 1)
    assert result is not None
    unit_type, _n, ext_id, text_raw, _text_norm, _meta = result
    assert (unit_type, ext_id, text_raw) == ("line", 1, "hello")


# ─── Fixtures: synthetic DOCX builders ──────────────────────────────────────


def _new_doc():
    return docx.Document()


def _add_para(doc, text: str) -> None:
    doc.add_paragraph(text)


def _add_table_2col(doc, rows: list[tuple[str | list[str], str | list[str]]]):
    """Add a 2-column table. Each row tuple is (col1, col2).
    Each cell value can be a string (one paragraph) or a list (multi-paragraph).
    Returns the Table for further mutation (e.g., merging).
    """
    table = doc.add_table(rows=len(rows), cols=2)
    for i, (c1, c2) in enumerate(rows):
        cell_a = table.cell(i, 0)
        cell_b = table.cell(i, 1)
        _set_cell(cell_a, c1)
        _set_cell(cell_b, c2)
    return table


def _add_table_1col(doc, rows: list[str | list[str]]):
    table = doc.add_table(rows=len(rows), cols=1)
    for i, val in enumerate(rows):
        _set_cell(table.cell(i, 0), val)
    return table


def _set_cell(cell, value: str | list[str]) -> None:
    """python-docx creates one default empty paragraph per cell. Replace it."""
    # Clear default paragraph
    paragraph = cell.paragraphs[0]
    if isinstance(value, list):
        paragraph.text = value[0] if value else ""
        for extra in value[1:]:
            cell.add_paragraph(extra)
    else:
        paragraph.text = value


def _save(doc, path: Path) -> Path:
    doc.save(str(path))
    return path


@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    """Fresh DB with migrations applied."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    db_path = tmp_path / "test.db"
    conn = get_connection(db_path)
    apply_migrations(
        conn,
        migrations_dir=Path(__file__).resolve().parent.parent / "migrations",
    )
    return conn


# ─── Case 1: 2-col table, column_index=1 then =2 ────────────────────────────


def test_extract_column_1_from_2col_table(db, tmp_path):
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = _new_doc()
    _add_table_2col(doc, [
        ("[1] La phrase originale.", "[1] The original sentence."),
        ("[2] Deuxième phrase.",     "[2] Second sentence."),
    ])
    path = _save(doc, tmp_path / "bilingual.docx")
    report = import_docx_numbered_lines(db, path, language="fr", column_index=1)

    assert report.units_line == 2
    assert report.tables_processed == 1
    assert report.rows_skipped_short == 0
    rows = db.execute(
        "SELECT external_id, text_norm FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
        (report.doc_id,),
    ).fetchall()
    assert [r["external_id"] for r in rows] == [1, 2]
    assert "originale" in rows[0]["text_norm"]


def test_extract_column_2_from_2col_table(db, tmp_path):
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = _new_doc()
    _add_table_2col(doc, [
        ("[1] La phrase originale.", "[1] The original sentence."),
        ("[2] Deuxième phrase.",     "[2] Second sentence."),
    ])
    path = _save(doc, tmp_path / "bilingual.docx")
    report = import_docx_numbered_lines(db, path, language="en", column_index=2)

    assert report.units_line == 2
    rows = db.execute(
        "SELECT text_norm FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
        (report.doc_id,),
    ).fetchall()
    assert "original sentence" in rows[0]["text_norm"]
    assert "Second sentence" in rows[1]["text_norm"]


# ─── Case 2: column_index out of range (table too narrow) ───────────────────


def test_column_index_2_on_1col_table_warns_and_extracts_zero(db, tmp_path):
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = _new_doc()
    _add_table_1col(doc, ["[1] Solo", "[2] Solo encore"])
    path = _save(doc, tmp_path / "narrow.docx")
    report = import_docx_numbered_lines(db, path, language="fr", column_index=2)

    assert report.units_line == 0
    assert report.tables_processed == 1
    assert report.rows_skipped_short == 2
    # The "0 line units" warning must be present so the user knows.
    assert any("0 unité ligne" in w for w in report.warnings)


# ─── Case 3: horizontally merged cell (col 1 spans into col 2) ──────────────


def test_horizontally_merged_cell_dedup(db, tmp_path):
    """When row.cells[0] is row.cells[1] (horizontal merge), column_index=2
    should NOT duplicate the content from col 1. The merge means col 2 has
    no own content for this row."""
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = _new_doc()
    table = _add_table_2col(doc, [
        ("[1] Une ligne merge", "ignored"),
        ("[2] Pure col 1",      "[2] Pure col 2"),
    ])
    # Merge row 0's two cells horizontally so col1 == col2 cell object.
    table.cell(0, 0).merge(table.cell(0, 1))
    path = _save(doc, tmp_path / "merged.docx")

    # column_index=2: row 0 is a merge from col 1 → must be skipped.
    # row 1 still has its own col 2 content.
    report = import_docx_numbered_lines(db, path, language="en", column_index=2)
    assert report.units_line == 1
    assert report.rows_skipped_short == 1
    rows = db.execute(
        "SELECT external_id, text_norm FROM units WHERE doc_id=? AND unit_type='line'",
        (report.doc_id,),
    ).fetchall()
    assert [r["external_id"] for r in rows] == [2]
    assert "col 2" in rows[0]["text_norm"]


# ─── Case 4: nested table inside a cell ─────────────────────────────────────


def test_nested_table_skipped_with_warning(db, tmp_path):
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = _new_doc()
    table = _add_table_2col(doc, [
        ("[1] Outer cell", "[1] Outer target"),
        ("[2] Just one paragraph", "[2] Target two"),
    ])
    # Add a nested table inside row 0, col 1 (the target for column_index=2).
    target_cell = table.cell(0, 1)
    nested = target_cell.add_table(rows=1, cols=1)
    nested.cell(0, 0).text = "[999] should-not-be-imported"
    path = _save(doc, tmp_path / "nested.docx")

    report = import_docx_numbered_lines(db, path, language="en", column_index=2)
    # Outer cells produce 2 line units. The nested cell content is skipped.
    assert report.units_line == 2
    assert report.nested_tables_skipped >= 1
    ext_ids = [
        r["external_id"]
        for r in db.execute(
            "SELECT external_id FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
            (report.doc_id,),
        )
    ]
    assert 999 not in ext_ids
    assert ext_ids == [1, 2]


# ─── Case 5: column dominated by un-numbered paragraphs ────────────────────


def test_column_mostly_unnumbered_triggers_warning(db, tmp_path):
    """User probably picked the wrong column — surface a hint."""
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = _new_doc()
    # 6 rows: only 1 has [N] in col 1; the rest are pure narrative text.
    rows = [
        (f"random row {i} no marker", f"[{i}] target {i}")
        for i in range(1, 7)
    ]
    # First row is the only one with [N] in col 1.
    rows[0] = ("[1] yes marker", "[1] target")
    _add_table_2col(doc, rows)
    path = _save(doc, tmp_path / "wrong_col.docx")

    report = import_docx_numbered_lines(db, path, language="fr", column_index=1)
    # 1 line, 5 structure → 5/6 ≈ 83% unnumbered → warning.
    assert report.units_line == 1
    assert any(
        "n'a pas de numérotation" in w or "% des paragraphes" in w
        for w in report.warnings
    )


# ─── Case 6: column_index=None regression ──────────────────────────────────


def test_column_index_none_is_legacy_behavior(db, tmp_path):
    """Tables must be ignored when column_index=None (backward compat)."""
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = _new_doc()
    _add_para(doc, "[1] Top-level paragraph")
    _add_table_2col(doc, [("[99] in-table ignored", "[99] also ignored")])
    _add_para(doc, "[2] Another top-level")
    path = _save(doc, tmp_path / "mixed.docx")

    report = import_docx_numbered_lines(db, path, language="fr")  # default None
    assert report.units_line == 2  # only top-level
    assert report.tables_processed == 0
    assert report.rows_skipped_short == 0
    ext_ids = [
        r["external_id"]
        for r in db.execute(
            "SELECT external_id FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
            (report.doc_id,),
        )
    ]
    assert ext_ids == [1, 2]
    assert 99 not in ext_ids


# ─── Case 7: mixed top-level paragraphs + table in document order ──────────


def test_mixed_paragraphs_and_table_in_document_order(db, tmp_path):
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = _new_doc()
    _add_para(doc, "[1] First top-level")
    _add_table_2col(doc, [
        ("[2] In-table col 1", "[2] In-table col 2"),
        ("[3] Second row col 1", "[3] Second row col 2"),
    ])
    _add_para(doc, "[4] After-table top-level")
    path = _save(doc, tmp_path / "mixed.docx")

    report = import_docx_numbered_lines(db, path, language="fr", column_index=1)
    assert report.units_line == 4
    ext_ids = [
        r["external_id"]
        for r in db.execute(
            "SELECT external_id FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
            (report.doc_id,),
        )
    ]
    assert ext_ids == [1, 2, 3, 4]


# ─── Case 8: column_index < 1 → ValueError ─────────────────────────────────


def test_column_index_below_one_raises(db, tmp_path):
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = _new_doc()
    _add_para(doc, "[1] anything")
    path = _save(doc, tmp_path / "x.docx")
    with pytest.raises(ValueError, match="column_index"):
        import_docx_numbered_lines(db, path, language="fr", column_index=0)


# ─── Case 9: vertical merge dedup ──────────────────────────────────────────


def test_vertical_merge_dedup_does_not_duplicate(db, tmp_path):
    """When the target column has a vertically merged cell spanning 2 rows,
    python-docx returns the same Cell object on both rows. We must dedup
    by id(cell) to avoid importing the same content twice."""
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = _new_doc()
    table = _add_table_2col(doc, [
        ("[1] left A", "[1] right merged top"),
        ("[2] left B", "[2] right merged continues"),
        ("[3] left C", "[3] right own cell"),
    ])
    # Vertically merge col 2 rows 0-1 via python-docx's cell.merge API
    # (which works for vertical merges too).
    table.cell(0, 1).merge(table.cell(1, 1))
    path = _save(doc, tmp_path / "vmerge.docx")

    # column_index=2: rows 0+1 share the merged cell. We import ONE copy of
    # row 0's content, skip row 1 (same Cell object), import row 2.
    report = import_docx_numbered_lines(db, path, language="en", column_index=2)
    ext_ids = [
        r["external_id"]
        for r in db.execute(
            "SELECT external_id FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
            (report.doc_id,),
        )
    ]
    # Expected: row 0 content (ext_id=1 from merged cell) + row 2 (ext_id=3).
    # Row 1 is skipped because same Cell object as row 0.
    assert 1 in ext_ids
    assert 3 in ext_ids
    # row 1's "[2] right merged continues" should NOT have been imported
    # twice — it's the same Cell content as row 0.
    line_count = sum(1 for _ in db.execute(
        "SELECT 1 FROM units WHERE doc_id=? AND unit_type='line'",
        (report.doc_id,),
    ))
    # Row 0 cell may contain both paragraphs after merge (python-docx behavior).
    # The key assertion: no duplicate of the same line content across rows.
    assert report.rows_skipped_short >= 1, \
        "Expected at least 1 row skipped due to vertical merge dedup"
    # Make sure row 2's content was extracted (it's a distinct Cell).
    assert line_count >= 2
