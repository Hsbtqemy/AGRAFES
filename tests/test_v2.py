"""Tests for V2.0 features: TXT importer, DOCX paragraphs, monotone alignment, multi-KWIC."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from tests.conftest import make_docx


# ===========================================================================
# TXT importer — txt_numbered_lines
# ===========================================================================


def _write_txt(path: Path, lines: list[str], encoding: str = "utf-8") -> Path:
    """Helper: write a list of lines to a .txt file."""
    path.write_bytes("\n".join(lines).encode(encoding))
    return path


def test_txt_import_numbered_lines(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """TXT importer must extract [n] lines as line units."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.indexer import build_index

    path = _write_txt(tmp_path / "doc.txt", [
        "Introduction",
        "[1] Bonjour le monde.",
        "[2] Il fait beau.",
        "[3] Au revoir.",
        "Conclusion",
    ])
    report = import_txt_numbered_lines(conn=db_conn, path=path, language="fr", title="TXT Test")

    assert report.doc_id > 0
    assert report.units_line == 3
    assert report.units_structure == 2
    assert report.units_total == 5
    assert report.holes == []
    assert report.duplicates == []


def test_txt_import_indexes_in_fts(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """TXT line units must be searchable via FTS after build_index."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.query import run_query

    path = _write_txt(tmp_path / "doc.txt", [
        "[1] Bonjour le monde.",
        "[2] Il fait beau.",
    ])
    import_txt_numbered_lines(conn=db_conn, path=path, language="fr")
    build_index(db_conn)

    hits = run_query(db_conn, q="Bonjour", mode="segment")
    assert len(hits) == 1
    assert "Bonjour" in hits[0]["text_norm"]


def test_txt_import_utf8_bom(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """TXT importer must detect UTF-8 BOM and decode correctly."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines

    content = "[1] Café au lait.\n[2] Naïve résumé."
    bom_bytes = b"\xef\xbb\xbf" + content.encode("utf-8")
    path = tmp_path / "bom.txt"
    path.write_bytes(bom_bytes)

    report = import_txt_numbered_lines(conn=db_conn, path=path, language="fr")
    assert report.units_line == 2

    row = db_conn.execute(
        "SELECT text_raw FROM units WHERE doc_id = ? AND unit_type = 'line' ORDER BY n LIMIT 1",
        (report.doc_id,)
    ).fetchone()
    assert "Café" in row["text_raw"]


def test_txt_import_holes_and_duplicates(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """TXT importer must detect holes and duplicates in the [n] sequence."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines

    path = _write_txt(tmp_path / "doc.txt", [
        "[1] Premier.",
        "[2] Deuxième.",
        "[2] Doublon.",   # duplicate
        "[5] Cinquième.", # holes at 3, 4
    ])
    report = import_txt_numbered_lines(conn=db_conn, path=path, language="fr")

    assert 2 in report.duplicates
    assert 3 in report.holes
    assert 4 in report.holes


def test_txt_import_file_not_found(db_conn: sqlite3.Connection) -> None:
    """TXT importer must raise FileNotFoundError for missing file."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines

    with pytest.raises(FileNotFoundError):
        import_txt_numbered_lines(conn=db_conn, path="/nonexistent/path.txt", language="fr")


# ===========================================================================
# DOCX paragraphs importer
# ===========================================================================


def test_docx_paragraphs_all_units_are_lines(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """DOCX paragraphs importer must import all non-empty paragraphs as line units."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    paragraphs = ["Introduction", "First paragraph.", "Second paragraph.", "Conclusion"]
    path = tmp_path / "doc.docx"
    path.write_bytes(make_docx(paragraphs))

    report = import_docx_paragraphs(conn=db_conn, path=path, language="en", title="Para Test")

    assert report.doc_id > 0
    assert report.units_line == 4
    assert report.units_structure == 0
    assert report.units_total == 4
    assert report.duplicates == []
    assert report.holes == []


def test_docx_paragraphs_external_id_equals_n(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """DOCX paragraphs importer must set external_id = n (sequential, no gaps)."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    paragraphs = ["Alpha", "Beta", "Gamma"]
    path = tmp_path / "doc.docx"
    path.write_bytes(make_docx(paragraphs))

    report = import_docx_paragraphs(conn=db_conn, path=path, language="en")

    rows = db_conn.execute(
        "SELECT n, external_id FROM units WHERE doc_id = ? ORDER BY n",
        (report.doc_id,),
    ).fetchall()

    for i, row in enumerate(rows, 1):
        assert row["n"] == i
        assert row["external_id"] == i


def test_docx_paragraphs_skips_blank_paragraphs(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """DOCX paragraphs importer must skip empty paragraphs."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    paragraphs = ["First.", "", "Third.", "   ", "Fifth."]
    path = tmp_path / "doc.docx"
    path.write_bytes(make_docx(paragraphs))

    report = import_docx_paragraphs(conn=db_conn, path=path, language="en")
    assert report.units_line == 3  # only "First.", "Third.", "Fifth."


def test_docx_paragraphs_searchable(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """DOCX paragraphs units must be FTS-indexed and queryable."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.query import run_query

    paragraphs = ["The quick brown fox.", "A lazy dog slept."]
    path = tmp_path / "doc.docx"
    path.write_bytes(make_docx(paragraphs))

    import_docx_paragraphs(conn=db_conn, path=path, language="en")
    build_index(db_conn)

    hits = run_query(db_conn, q="fox", mode="segment")
    assert len(hits) == 1
    assert "fox" in hits[0]["text_norm"]


# ===========================================================================
# Monotone fallback alignment (align_by_position)
# ===========================================================================


@pytest.fixture()
def two_para_docs(db_conn: sqlite3.Connection, tmp_path: Path):
    """Two DOCX paragraphs docs (FR + EN) with matching positions."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs
    from multicorpus_engine.indexer import build_index

    fr_path = tmp_path / "fr.docx"
    en_path = tmp_path / "en.docx"
    fr_path.write_bytes(make_docx(["Bonjour.", "Au revoir.", "Merci."]))
    en_path.write_bytes(make_docx(["Hello.", "Goodbye.", "Thank you."]))

    fr = import_docx_paragraphs(conn=db_conn, path=fr_path, language="fr", title="FR")
    en = import_docx_paragraphs(conn=db_conn, path=en_path, language="en", title="EN")
    build_index(db_conn)
    return {"fr_id": fr.doc_id, "en_id": en.doc_id}


def test_align_by_position_creates_links(
    db_conn: sqlite3.Connection,
    two_para_docs: dict,
) -> None:
    """align_by_position must create one link per matched position."""
    from multicorpus_engine.aligner import align_by_position

    reports = align_by_position(
        conn=db_conn,
        pivot_doc_id=two_para_docs["fr_id"],
        target_doc_ids=[two_para_docs["en_id"]],
        run_id="test-run",
    )

    assert len(reports) == 1
    report = reports[0]
    assert report.links_created == 3
    assert report.coverage_pct == 100.0
    assert report.matched == [1, 2, 3]


def test_align_by_position_partial_match(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """align_by_position must report missing positions when doc sizes differ."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs
    from multicorpus_engine.aligner import align_by_position

    fr_path = tmp_path / "fr.docx"
    en_path = tmp_path / "en.docx"
    fr_path.write_bytes(make_docx(["Un.", "Deux.", "Trois."]))
    en_path.write_bytes(make_docx(["One.", "Two."]))  # only 2 paragraphs

    fr = import_docx_paragraphs(conn=db_conn, path=fr_path, language="fr")
    en = import_docx_paragraphs(conn=db_conn, path=en_path, language="en")

    reports = align_by_position(
        conn=db_conn,
        pivot_doc_id=fr.doc_id,
        target_doc_ids=[en.doc_id],
        run_id="test-run",
    )

    report = reports[0]
    assert report.links_created == 2
    assert 3 in report.missing_in_target
    assert len(report.warnings) > 0


def test_align_by_position_parallel_view(
    db_conn: sqlite3.Connection,
    two_para_docs: dict,
) -> None:
    """After position alignment, --include-aligned must return target units."""
    from multicorpus_engine.aligner import align_by_position
    from multicorpus_engine.query import run_query

    align_by_position(
        conn=db_conn,
        pivot_doc_id=two_para_docs["fr_id"],
        target_doc_ids=[two_para_docs["en_id"]],
        run_id="test-run",
    )

    hits = run_query(
        db_conn,
        q="Bonjour",
        mode="segment",
        include_aligned=True,
    )
    assert len(hits) == 1
    assert "aligned" in hits[0]
    aligned = hits[0]["aligned"]
    assert len(aligned) == 1
    assert aligned[0]["language"] == "en"
    assert "Hello" in aligned[0]["text_norm"]


# ===========================================================================
# Multi-occurrence KWIC (all_occurrences=True)
# ===========================================================================


@pytest.fixture()
def repeated_term_corpus(db_conn: sqlite3.Connection, tmp_path: Path):
    """Import a doc with a line containing the search term multiple times."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.indexer import build_index

    paragraphs = [
        "[1] Le chat voit le chien et le chat s'enfuit.",  # 'le' appears 3 times, 'chat' 2 times
        "[2] Simple phrase.",
    ]
    path = tmp_path / "repeated.docx"
    path.write_bytes(make_docx(paragraphs))

    report = import_docx_numbered_lines(conn=db_conn, path=path, language="fr", title="Repeated")
    build_index(db_conn)
    return {"doc_id": report.doc_id}


def test_multi_kwic_returns_multiple_hits_per_unit(
    db_conn: sqlite3.Connection,
    repeated_term_corpus: dict,
) -> None:
    """With all_occurrences=True, run_query must return one KWIC hit per occurrence."""
    from multicorpus_engine.query import run_query

    hits_single = run_query(db_conn, q="chat", mode="kwic", all_occurrences=False)
    hits_multi = run_query(db_conn, q="chat", mode="kwic", all_occurrences=True)

    # Single: one hit per unit (one unit matches)
    assert len(hits_single) == 1
    # Multi: two occurrences of 'chat' in unit 1
    assert len(hits_multi) == 2
    for hit in hits_multi:
        assert hit["match"].lower() == "chat"


def test_multi_kwic_default_is_single_occurrence(
    db_conn: sqlite3.Connection,
    repeated_term_corpus: dict,
) -> None:
    """Default behaviour (all_occurrences=False) must remain one hit per unit."""
    from multicorpus_engine.query import run_query

    hits = run_query(db_conn, q="chat", mode="kwic")
    assert len(hits) == 1  # one unit matches → one hit


def test_multi_kwic_segment_mode_unaffected(
    db_conn: sqlite3.Connection,
    repeated_term_corpus: dict,
) -> None:
    """all_occurrences flag must have no effect on segment mode (one hit per unit)."""
    from multicorpus_engine.query import run_query

    hits = run_query(db_conn, q="chat", mode="segment", all_occurrences=True)
    assert len(hits) == 1  # segment: always one hit per unit
