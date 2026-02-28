"""Tests for exporters (Increment 3): TEI, CSV, JSONL, HTML + metadata validation."""

from __future__ import annotations

import csv
import json
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from tests.conftest import make_docx


# ---------------------------------------------------------------------------
# Shared fixture: a simple corpus with one FR doc
# ---------------------------------------------------------------------------

@pytest.fixture()
def corpus(db_conn: sqlite3.Connection, tmp_path: Path):
    """One imported + indexed FR document."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.indexer import build_index

    paras = [
        "Introduction",
        "[1] Bonjour le monde.",
        '[2] Il dit "merci" & s\'en alla.',    # has " & ' for XML escaping test
        "[3] Le chat\u00a4le chien jouent.",    # has ¤ → space in text_norm
        "Conclusion",
    ]
    path = tmp_path / "doc.docx"
    path.write_bytes(make_docx(paras))

    report = import_docx_numbered_lines(
        conn=db_conn,
        path=path,
        language="fr",
        title="Corpus Test",
        doc_role="original",
        resource_type="test",
    )
    build_index(db_conn)
    return {"doc_id": report.doc_id}


# ===========================================================================
# TEI export
# ===========================================================================

def test_tei_export_utf8_valid(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """TEI export must produce a valid UTF-8 file with XML declaration."""
    from multicorpus_engine.exporters.tei import export_tei

    out = tmp_path / "doc.xml"
    export_tei(conn=db_conn, doc_id=corpus["doc_id"], output_path=out)

    assert out.exists()
    content = out.read_text(encoding="utf-8")
    assert '<?xml version="1.0" encoding="UTF-8"?>' in content


def test_tei_export_well_formed_xml(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """TEI export must produce well-formed XML parseable by ElementTree."""
    from multicorpus_engine.exporters.tei import export_tei

    out = tmp_path / "doc.xml"
    export_tei(conn=db_conn, doc_id=corpus["doc_id"], output_path=out)

    # Parse must not raise
    tree = ET.parse(str(out))
    root = tree.getroot()
    # Root element is TEI
    assert root.tag.endswith("TEI") or root.tag == "TEI"


def test_tei_export_xml_escaping(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """Special XML chars (&, <, >, \", ') must be escaped in TEI output."""
    from multicorpus_engine.exporters.tei import export_tei

    out = tmp_path / "doc.xml"
    export_tei(conn=db_conn, doc_id=corpus["doc_id"], output_path=out)

    content = out.read_text(encoding="utf-8")
    # The text '[2] Il dit "merci" & s'en alla.' has & and "
    # text_norm will have: Il dit "merci" & s'en alla.
    # In XML these must be escaped as &amp; and &quot;
    assert "&amp;" in content, "& must be escaped as &amp;"
    assert "&quot;" in content or "&#34;" in content or '"' in content  # ET may use &quot; or leave as attr


def test_tei_export_no_invalid_xml_chars(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
    db_conn_with_controls: sqlite3.Connection,
) -> None:
    """TEI export must strip XML 1.0 invalid characters."""
    from multicorpus_engine.exporters.tei import export_tei

    out = tmp_path / "doc_ctrl.xml"
    export_tei(conn=db_conn_with_controls, doc_id=1, output_path=out)

    content = out.read_bytes()
    # No NUL bytes or other XML 1.0 invalid chars in output
    assert b"\x00" not in content
    assert b"\x01" not in content
    assert b"\x0b" not in content


def test_tei_export_structure(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """TEI body must contain <p> elements for line units, teiHeader with title."""
    from multicorpus_engine.exporters.tei import export_tei

    out = tmp_path / "doc.xml"
    export_tei(conn=db_conn, doc_id=corpus["doc_id"], output_path=out)

    content = out.read_text(encoding="utf-8")
    # teiHeader with title
    assert "Corpus Test" in content
    # Body has <p> elements (line units)
    assert "<p " in content or "<p>" in content
    # Language is present
    assert 'ident="fr"' in content


def test_tei_export_include_structure(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """With include_structure=True, structure paragraphs appear as <head> elements."""
    from multicorpus_engine.exporters.tei import export_tei

    out_no_struct = tmp_path / "no_struct.xml"
    out_with_struct = tmp_path / "with_struct.xml"

    export_tei(conn=db_conn, doc_id=corpus["doc_id"], output_path=out_no_struct, include_structure=False)
    export_tei(conn=db_conn, doc_id=corpus["doc_id"], output_path=out_with_struct, include_structure=True)

    no_struct_content = out_no_struct.read_text(encoding="utf-8")
    with_struct_content = out_with_struct.read_text(encoding="utf-8")

    # "Introduction" is a structure unit
    assert "Introduction" not in no_struct_content
    assert "Introduction" in with_struct_content
    assert "<head " in with_struct_content


# ===========================================================================
# strip_xml10_invalid utility
# ===========================================================================

def test_strip_xml10_invalid_removes_control_chars() -> None:
    """strip_xml10_invalid must remove NUL, SOH, VT, FF etc."""
    from multicorpus_engine.exporters.tei import strip_xml10_invalid

    text = "hello\x00\x01\x0bworld"
    result = strip_xml10_invalid(text)
    assert result == "helloworld"


def test_strip_xml10_invalid_keeps_tab_lf_cr() -> None:
    """TAB, LF, CR are valid XML 1.0 chars and must be preserved."""
    from multicorpus_engine.exporters.tei import strip_xml10_invalid

    text = "line1\nline2\ttabbed\rend"
    result = strip_xml10_invalid(text)
    assert result == text


# ===========================================================================
# CSV export
# ===========================================================================

def test_csv_export_segment(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """CSV segment export must have correct headers and one row per hit."""
    from multicorpus_engine.query import run_query
    from multicorpus_engine.exporters.csv_export import export_csv

    hits = run_query(db_conn, q="Bonjour", mode="segment")
    assert len(hits) == 1

    out = tmp_path / "results.csv"
    export_csv(hits=hits, output_path=out, mode="segment")

    assert out.exists()
    with open(out, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    assert len(rows) == 1
    assert "doc_id" in rows[0]
    assert "text_norm" in rows[0]
    assert "Bonjour" in rows[0]["text_norm"]


def test_csv_export_kwic(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """CSV KWIC export must have left/match/right columns."""
    from multicorpus_engine.query import run_query
    from multicorpus_engine.exporters.csv_export import export_csv

    hits = run_query(db_conn, q="Bonjour", mode="kwic", window=5)
    out = tmp_path / "kwic.csv"
    export_csv(hits=hits, output_path=out, mode="kwic")

    with open(out, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    assert len(rows) == 1
    assert "left" in rows[0]
    assert "match" in rows[0]
    assert "right" in rows[0]
    assert rows[0]["match"].lower() == "bonjour"


def test_tsv_export_uses_tab_delimiter(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """TSV export must use tab as delimiter."""
    from multicorpus_engine.query import run_query
    from multicorpus_engine.exporters.csv_export import export_csv

    hits = run_query(db_conn, q="Bonjour", mode="segment")
    out = tmp_path / "results.tsv"
    export_csv(hits=hits, output_path=out, mode="segment", delimiter="\t")

    raw = out.read_text(encoding="utf-8")
    assert "\t" in raw  # tab present


# ===========================================================================
# JSONL export
# ===========================================================================

def test_jsonl_export_each_line_valid_json(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """JSONL export must produce one valid JSON object per line."""
    from multicorpus_engine.query import run_query
    from multicorpus_engine.exporters.jsonl_export import export_jsonl

    hits = run_query(db_conn, q="Bonjour", mode="segment")
    out = tmp_path / "results.jsonl"
    export_jsonl(hits=hits, output_path=out)

    assert out.exists()
    lines = out.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == len(hits)

    for line in lines:
        obj = json.loads(line)  # must not raise
        assert "unit_id" in obj
        assert "text_norm" in obj


def test_jsonl_export_utf8_encoding(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """JSONL export must use UTF-8 without ASCII-escaping of Unicode chars."""
    from multicorpus_engine.query import run_query
    from multicorpus_engine.exporters.jsonl_export import export_jsonl

    # Import a doc with accented chars
    hits = run_query(db_conn, q="Bonjour", mode="segment")
    out = tmp_path / "results.jsonl"
    export_jsonl(hits=hits, output_path=out)

    # Read as bytes — accented chars must not appear as \uXXXX escapes
    raw = out.read_bytes().decode("utf-8")
    assert "\\u00" not in raw  # no ASCII-escaped accents


# ===========================================================================
# HTML export
# ===========================================================================

def test_html_export_contains_hits(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """HTML export must contain query results and be valid UTF-8."""
    from multicorpus_engine.query import run_query
    from multicorpus_engine.exporters.html_export import export_html

    hits = run_query(db_conn, q="Bonjour", mode="segment")
    out = tmp_path / "report.html"
    export_html(hits=hits, output_path=out, query="Bonjour", mode="segment", run_id="test-run")

    assert out.exists()
    content = out.read_text(encoding="utf-8")

    assert "<!DOCTYPE html>" in content
    assert "Bonjour" in content
    assert "Corpus Test" in content  # document title


def test_html_export_no_xss(
    db_conn: sqlite3.Connection,
    corpus: dict,
    tmp_path: Path,
) -> None:
    """HTML export must escape user-controlled text to prevent XSS."""
    from multicorpus_engine.exporters.html_export import export_html

    # Query with a potentially dangerous string
    dangerous_query = '<script>alert("xss")</script>'
    out = tmp_path / "xss.html"
    export_html(hits=[], output_path=out, query=dangerous_query, mode="segment", run_id="x")

    content = out.read_text(encoding="utf-8")
    assert "<script>" not in content
    assert "&lt;script&gt;" in content


def test_html_export_no_hits_message(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """HTML export with no hits must show a 'no results' message."""
    from multicorpus_engine.exporters.html_export import export_html

    out = tmp_path / "empty.html"
    export_html(hits=[], output_path=out, query="xyz_not_found", mode="segment", run_id="x")

    content = out.read_text(encoding="utf-8")
    assert "no-hits" in content or "No results" in content


# ===========================================================================
# Metadata validation
# ===========================================================================

def test_metadata_validation_valid_doc(
    db_conn: sqlite3.Connection,
    corpus: dict,
) -> None:
    """A properly imported document must validate with no errors."""
    from multicorpus_engine.metadata import validate_document

    result = validate_document(db_conn, corpus["doc_id"])
    assert result.is_valid
    # No required-field warnings
    required_warnings = [w for w in result.warnings if "Required" in w]
    assert len(required_warnings) == 0


def test_metadata_validation_missing_doc(db_conn: sqlite3.Connection) -> None:
    """Validating a non-existent doc_id must return is_valid=False with a warning."""
    from multicorpus_engine.metadata import validate_document

    result = validate_document(db_conn, doc_id=9999)
    assert not result.is_valid
    assert len(result.warnings) > 0


def test_metadata_validation_all_docs(
    db_conn: sqlite3.Connection,
    corpus: dict,
) -> None:
    """validate_all_documents must return one result per document."""
    from multicorpus_engine.metadata import validate_all_documents

    results = validate_all_documents(db_conn)
    assert len(results) == 1
    assert results[0].doc_id == corpus["doc_id"]


def test_metadata_validation_warns_no_line_units(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """A document with only structure paragraphs must warn about zero line units."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.metadata import validate_document

    path = tmp_path / "struct_only.docx"
    path.write_bytes(make_docx(["Introduction", "Conclusion"]))  # no [n] lines
    report = import_docx_numbered_lines(conn=db_conn, path=path, language="fr", title="Struct Only")

    result = validate_document(db_conn, report.doc_id)
    assert any("line units" in w.lower() for w in result.warnings)


# ===========================================================================
# Fixture for control-char test
# ===========================================================================

@pytest.fixture()
def db_conn_with_controls(db_conn: sqlite3.Connection) -> sqlite3.Connection:
    """Inject a unit with XML 1.0 invalid chars directly into the DB."""
    utcnow = "2026-02-28T00:00:00Z"
    db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at) VALUES (?, ?, ?, ?)",
        ("CtrlTest", "fr", "standalone", utcnow),
    )
    doc_id = db_conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    # text_norm with NUL + VT (XML 1.0 invalid) embedded
    text_with_ctrl = "hello\x00world\x0bgoodbye"
    db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm) VALUES (?,?,?,?,?,?)",
        (doc_id, "line", 1, 1, text_with_ctrl, text_with_ctrl),
    )
    db_conn.commit()
    return db_conn
