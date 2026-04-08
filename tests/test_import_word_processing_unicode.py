"""Unicode parity checks for word-processing importers (DOCX/ODT)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from tests.conftest import make_docx
from tests.support_odt import make_odt_bytes


def test_word_processing_paragraphs_unicode_parity(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """DOCX paragraphs and ODT paragraphs must normalize Unicode the same way."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs
    from multicorpus_engine.importers.odt_paragraphs import import_odt_paragraphs

    paragraphs = [
        "Voix\u00a0active",       # NBSP -> space
        "fine\u202fspace",        # NNBSP -> space
        "e\u0301nergie et c\u0327a",  # NFD -> NFC
        "mot\u200bcolle",        # ZWSP removed
        "alpha\u00a4beta",       # ¤ -> space
    ]

    docx_path = tmp_path / "unicode_paragraphs.docx"
    odt_path = tmp_path / "unicode_paragraphs.odt"
    docx_path.write_bytes(make_docx(paragraphs))
    odt_path.write_bytes(make_odt_bytes(paragraphs))

    docx_report = import_docx_paragraphs(conn=db_conn, path=docx_path, language="fr", title="DOCX")
    odt_report = import_odt_paragraphs(conn=db_conn, path=odt_path, language="fr", title="ODT")

    docx_norm = [
        r[0]
        for r in db_conn.execute(
            "SELECT text_norm FROM units WHERE doc_id = ? ORDER BY n",
            (docx_report.doc_id,),
        ).fetchall()
    ]
    odt_norm = [
        r[0]
        for r in db_conn.execute(
            "SELECT text_norm FROM units WHERE doc_id = ? ORDER BY n",
            (odt_report.doc_id,),
        ).fetchall()
    ]

    assert docx_norm == odt_norm
    assert docx_norm == [
        "Voix active",
        "fine space",
        "énergie et ça",
        "motcolle",
        "alpha beta",
    ]


def test_word_processing_numbered_unicode_parity(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """DOCX/ODT numbered-line imports must keep parity on external_id + text_norm."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.importers.odt_numbered_lines import import_odt_numbered_lines

    paragraphs = [
        "Introduction",
        "[1] Voix\u00a0active",
        "[2] fine\u202fspace",
        "[3] mot\u200bcolle",
        "[4] alpha\u00a4beta",
        "[5] e\u0301nergie",
    ]

    docx_path = tmp_path / "unicode_numbered.docx"
    odt_path = tmp_path / "unicode_numbered.odt"
    docx_path.write_bytes(make_docx(paragraphs))
    odt_path.write_bytes(make_odt_bytes(paragraphs))

    docx_report = import_docx_numbered_lines(conn=db_conn, path=docx_path, language="fr", title="DOCX")
    odt_report = import_odt_numbered_lines(conn=db_conn, path=odt_path, language="fr", title="ODT")

    docx_lines = db_conn.execute(
        "SELECT external_id, text_norm FROM units WHERE doc_id = ? AND unit_type = 'line' ORDER BY external_id",
        (docx_report.doc_id,),
    ).fetchall()
    odt_lines = db_conn.execute(
        "SELECT external_id, text_norm FROM units WHERE doc_id = ? AND unit_type = 'line' ORDER BY external_id",
        (odt_report.doc_id,),
    ).fetchall()

    assert docx_lines == odt_lines
    assert [row[1] for row in docx_lines] == [
        "Voix active",
        "fine space",
        "motcolle",
        "alpha beta",
        "énergie",
    ]

    docx_struct = db_conn.execute(
        "SELECT text_norm FROM units WHERE doc_id = ? AND unit_type = 'structure' ORDER BY n",
        (docx_report.doc_id,),
    ).fetchall()
    odt_struct = db_conn.execute(
        "SELECT text_norm FROM units WHERE doc_id = ? AND unit_type = 'structure' ORDER BY n",
        (odt_report.doc_id,),
    ).fetchall()

    assert docx_struct == odt_struct
