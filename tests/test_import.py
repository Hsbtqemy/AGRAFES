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


def test_analyze_external_ids_caps_holes_on_wide_span() -> None:
    """IMP-01: a wide external_id gap yields a TRUNCATED (non-empty) holes list, never the
    full range — which would hang the loop and OOM the list on a big span."""
    from multicorpus_engine.importers.docx_numbered_lines import (
        _MAX_HOLES,
        _analyze_external_ids,
    )
    _, holes, _ = _analyze_external_ids([1, 5000])  # 4998 gaps if uncapped
    assert len(holes) == _MAX_HOLES  # capped, not 4998
    assert holes[0] == 2  # still a real signal — starts at the first gap


def test_analyze_external_ids_pathological_span_is_bounded() -> None:
    """IMP-01: the actual DoS trigger ([1, 1e9]) completes instantly instead of
    hanging/OOMing (this test would never return on the pre-fix code)."""
    from multicorpus_engine.importers.docx_numbered_lines import (
        _MAX_HOLES,
        _analyze_external_ids,
    )
    dups, holes, non_mono = _analyze_external_ids([1, 10**9])
    assert len(holes) == _MAX_HOLES  # bounded — no billion-int list
    assert dups == [] and non_mono == []


def test_analyze_external_ids_small_gaps_unchanged() -> None:
    """Regression: ordinary small gaps are still enumerated exactly (not truncated)."""
    from multicorpus_engine.importers.docx_numbered_lines import _analyze_external_ids
    dups, holes, non_mono = _analyze_external_ids([1, 2, 5, 6])
    assert holes == [3, 4]
    assert dups == [] and non_mono == []


def test_insert_units_rejects_empty(db_conn: sqlite3.Connection) -> None:
    """IMP-02: the shared write path refuses 0 units (was a silent success → ghost doc)."""
    from multicorpus_engine.importers.parsed import insert_units
    with pytest.raises(ValueError):
        insert_units(db_conn, doc_id=1, units=[])


def test_import_empty_txt_raises_and_leaves_no_ghost_doc(
    db_conn: sqlite3.Connection, tmp_path: Path
) -> None:
    """IMP-02: an empty file is rejected AND the document row is rolled back (no ghost doc)."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    empty = tmp_path / "empty.txt"
    empty.write_text("", encoding="utf-8")
    with pytest.raises(ValueError):
        import_txt_numbered_lines(conn=db_conn, path=empty, language="fr")
    assert db_conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 0


def test_detect_encoding_survives_charset_normalizer_crash(monkeypatch) -> None:
    """IMP-04b: a runtime error inside charset-normalizer must not crash the import — it
    falls through to the deterministic cp1252/latin-1 fallback (was `except ImportError` only)."""
    pytest.importorskip("charset_normalizer")
    from multicorpus_engine.importers.txt import _detect_encoding

    def _boom(_data):
        raise RuntimeError("charset-normalizer internal error")

    monkeypatch.setattr("charset_normalizer.from_bytes", _boom)
    encoding, method = _detect_encoding(b"[1] plain ascii text")  # no BOM → hits from_bytes
    assert method in ("cp1252-fallback", "latin-1-fallback")
    assert encoding in ("cp1252", "latin-1")


def test_import_txt_flags_undecodable_bytes(
    db_conn: sqlite3.Connection, tmp_path: Path
) -> None:
    """IMP-04a: errors='replace' mojibake (U+FFFD) is surfaced as a warning, not silent —
    even on the BOM path that the enc_method fallback warning misses."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    p = tmp_path / "bad.txt"
    # UTF-8 BOM → detected utf-8-sig; a lone 0xE9 is invalid UTF-8 → decoded as U+FFFD.
    p.write_bytes(b"\xef\xbb\xbf[1] cafe\xe9 x\n[2] ok\n")
    report = import_txt_numbered_lines(conn=db_conn, path=p, language="fr")
    assert any("U+FFFD" in str(w) for w in report.warnings)


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


def test_import_rejects_duplicate_corpus_entry(
    db_conn: sqlite3.Connection,
    simple_docx: Path,
) -> None:
    """Re-importing the same file must raise (same path / same hash)."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines

    import_docx_numbered_lines(conn=db_conn, path=simple_docx, language="fr")
    with pytest.raises(ValueError, match=r"doc_id=.*reason=source_hash"):
        import_docx_numbered_lines(conn=db_conn, path=simple_docx, language="fr")


def test_import_rejects_duplicate_when_paths_differ_only_by_separators(
    db_conn: sqlite3.Connection,
    simple_docx: Path,
) -> None:
    """Same file on disk: stored path may use / while importer receives \\ (Windows)."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines

    import_docx_numbered_lines(conn=db_conn, path=simple_docx, language="fr")
    p = str(simple_docx)
    if "\\" not in p:
        pytest.skip("needs backslash path to build a posix variant")
    posix = p.replace("\\", "/")
    # Force path-only match branch (hash column would hide the regression)
    db_conn.execute(
        "UPDATE documents SET source_hash = ?, source_path = ? WHERE doc_id = 1",
        ("wrong_hash_not_in_file", posix),
    )
    db_conn.commit()
    with pytest.raises(ValueError, match=r"doc_id=.*reason=source_path_"):
        import_docx_numbered_lines(conn=db_conn, path=simple_docx, language="fr")


def test_import_rejects_duplicate_by_filename_when_enabled(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """Filename guard should reject same basename from another directory."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines

    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    dir_a.mkdir()
    dir_b.mkdir()
    file_a = dir_a / "same-name.txt"
    file_b = dir_b / "same-name.txt"

    file_a.write_text("[1] Alpha.\n", encoding="utf-8")
    file_b.write_text("[1] Beta.\n", encoding="utf-8")

    import_txt_numbered_lines(
        conn=db_conn,
        path=file_a,
        language="fr",
        check_filename=True,
    )
    with pytest.raises(ValueError, match=r"doc_id=.*reason=filename.*filename=same-name.txt"):
        import_txt_numbered_lines(
            conn=db_conn,
            path=file_b,
            language="fr",
            check_filename=True,
        )
