"""Tests for the alignment engine (Increment 2)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from tests.conftest import make_docx


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def bilingual_corpus(db_conn: sqlite3.Connection, tmp_path: Path):
    """Create a bilingual corpus: FR pivot (doc 1) + EN target (doc 2).

    Shared external_ids: 1, 2, 3
    FR only: 4
    EN only: 5
    """
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.indexer import build_index

    fr_paras = [
        "[1] Bonjour le monde.",
        "[2] Il fait beau aujourd'hui.",
        "[3] Le chat et le chien jouent.",
        "[4] Seulement en français.",
    ]
    en_paras = [
        "[1] Hello world.",
        "[2] The weather is nice today.",
        "[3] The cat and the dog are playing.",
        "[5] Only in English.",
    ]

    fr_path = tmp_path / "fr.docx"
    fr_path.write_bytes(make_docx(fr_paras))
    en_path = tmp_path / "en.docx"
    en_path.write_bytes(make_docx(en_paras))

    fr_report = import_docx_numbered_lines(
        conn=db_conn, path=fr_path, language="fr", title="FR Doc", doc_role="original"
    )
    en_report = import_docx_numbered_lines(
        conn=db_conn, path=en_path, language="en", title="EN Doc", doc_role="translation"
    )
    build_index(db_conn)

    return {"fr_doc_id": fr_report.doc_id, "en_doc_id": en_report.doc_id}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_align_creates_links(
    db_conn: sqlite3.Connection,
    bilingual_corpus: dict,
) -> None:
    """align_by_external_id must create links for matching external_ids."""
    from multicorpus_engine.aligner import align_by_external_id

    reports = align_by_external_id(
        conn=db_conn,
        pivot_doc_id=bilingual_corpus["fr_doc_id"],
        target_doc_ids=[bilingual_corpus["en_doc_id"]],
        run_id="test-run-001",
    )

    assert len(reports) == 1
    report = reports[0]

    # 3 shared external_ids: 1, 2, 3
    assert report.links_created == 3
    assert sorted(report.matched) == [1, 2, 3]

    # Verify rows exist in DB
    rows = db_conn.execute("SELECT COUNT(*) FROM alignment_links").fetchone()[0]
    assert rows == 3


def test_align_coverage_report(
    db_conn: sqlite3.Connection,
    bilingual_corpus: dict,
) -> None:
    """Coverage report must show matched, missing_in_target, missing_in_pivot."""
    from multicorpus_engine.aligner import align_by_external_id

    reports = align_by_external_id(
        conn=db_conn,
        pivot_doc_id=bilingual_corpus["fr_doc_id"],
        target_doc_ids=[bilingual_corpus["en_doc_id"]],
        run_id="test-run-002",
    )
    report = reports[0]

    assert report.pivot_line_count == 4   # FR has 4 lines
    assert report.target_line_count == 4  # EN has 4 lines
    assert report.links_created == 3
    assert report.coverage_pct == 75.0    # 3/4

    assert report.missing_in_target == [4]  # external_id 4 only in FR
    assert report.missing_in_pivot == [5]   # external_id 5 only in EN


def test_align_missing_ids_in_warnings(
    db_conn: sqlite3.Connection,
    bilingual_corpus: dict,
) -> None:
    """Missing ids must generate warnings in the report."""
    from multicorpus_engine.aligner import align_by_external_id

    reports = align_by_external_id(
        conn=db_conn,
        pivot_doc_id=bilingual_corpus["fr_doc_id"],
        target_doc_ids=[bilingual_corpus["en_doc_id"]],
        run_id="test-run-003",
    )
    report = reports[0]

    # At least one warning about missing ids
    assert len(report.warnings) >= 1
    warning_text = " ".join(report.warnings)
    assert "missing" in warning_text.lower()


def test_align_duplicate_external_ids(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
    docx_with_duplicates: Path,
) -> None:
    """Duplicate external_ids in a doc are reported; first occurrence is used for linking."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id

    # Import a doc with dup external_id=2 as pivot
    pivot_report = import_docx_numbered_lines(
        conn=db_conn, path=docx_with_duplicates, language="fr", title="Dupes"
    )

    # Target: clean doc with [1], [2]
    target_path = tmp_path / "target.docx"
    target_path.write_bytes(make_docx(["[1] Un.", "[2] Deux."]))
    target_report = import_docx_numbered_lines(
        conn=db_conn, path=target_path, language="en", title="Clean"
    )

    reports = align_by_external_id(
        conn=db_conn,
        pivot_doc_id=pivot_report.doc_id,
        target_doc_ids=[target_report.doc_id],
        run_id="test-run-004",
    )
    report = reports[0]

    # dup external_id=2 in pivot must be reported
    assert 2 in report.duplicates_pivot
    # Still creates a link for external_id 2 (using first occurrence)
    assert 2 in report.matched

    # Warning about duplicates
    assert any("Duplicate" in w or "duplicate" in w for w in report.warnings)


def test_align_multiple_targets(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """align_by_external_id must handle multiple target documents."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id

    pivot_path = tmp_path / "pivot.docx"
    pivot_path.write_bytes(make_docx(["[1] Un.", "[2] Deux.", "[3] Trois."]))
    t1_path = tmp_path / "t1.docx"
    t1_path.write_bytes(make_docx(["[1] One.", "[2] Two."]))
    t2_path = tmp_path / "t2.docx"
    t2_path.write_bytes(make_docx(["[1] Uno.", "[3] Tres."]))

    pivot = import_docx_numbered_lines(conn=db_conn, path=pivot_path, language="fr")
    t1 = import_docx_numbered_lines(conn=db_conn, path=t1_path, language="en")
    t2 = import_docx_numbered_lines(conn=db_conn, path=t2_path, language="es")

    reports = align_by_external_id(
        conn=db_conn,
        pivot_doc_id=pivot.doc_id,
        target_doc_ids=[t1.doc_id, t2.doc_id],
        run_id="test-run-005",
    )

    assert len(reports) == 2
    r1 = next(r for r in reports if r.target_doc_id == t1.doc_id)
    r2 = next(r for r in reports if r.target_doc_id == t2.doc_id)

    assert r1.links_created == 2   # [1, 2] shared with t1
    assert r2.links_created == 2   # [1, 3] shared with t2

    total_links = db_conn.execute("SELECT COUNT(*) FROM alignment_links").fetchone()[0]
    assert total_links == 4  # 2 + 2


def test_query_include_aligned(
    db_conn: sqlite3.Connection,
    bilingual_corpus: dict,
) -> None:
    """query with include_aligned=True must attach aligned units to each hit."""
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.query import run_query

    align_by_external_id(
        conn=db_conn,
        pivot_doc_id=bilingual_corpus["fr_doc_id"],
        target_doc_ids=[bilingual_corpus["en_doc_id"]],
        run_id="test-run-006",
    )

    # Query FR doc for "Bonjour" with include_aligned
    hits = run_query(
        db_conn,
        q="Bonjour",
        mode="segment",
        language="fr",
        include_aligned=True,
    )

    assert len(hits) == 1
    hit = hits[0]

    assert "aligned" in hit
    aligned = hit["aligned"]
    assert len(aligned) == 1
    assert aligned[0]["language"] == "en"
    assert "Hello" in aligned[0]["text_norm"]


def test_doc_relations_created(
    db_conn: sqlite3.Connection,
    bilingual_corpus: dict,
) -> None:
    """add_doc_relation must persist a doc_relations row."""
    from multicorpus_engine.aligner import add_doc_relation

    row_id = add_doc_relation(
        conn=db_conn,
        doc_id=bilingual_corpus["en_doc_id"],
        relation_type="translation_of",
        target_doc_id=bilingual_corpus["fr_doc_id"],
        note="English translation of the French pivot",
    )
    assert row_id is not None and row_id > 0

    row = db_conn.execute(
        "SELECT * FROM doc_relations WHERE id = ?", (row_id,)
    ).fetchone()
    assert row["relation_type"] == "translation_of"
    assert row["doc_id"] == bilingual_corpus["en_doc_id"]
    assert row["target_doc_id"] == bilingual_corpus["fr_doc_id"]
