"""Tests for the query engine (segment + KWIC modes)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from multicorpus_engine.query import _apply_doc_filters


# ── QRY-07: source_ext LIKE escaping ──────────────────────────────────────────
def _filters_for_ext(ext: str) -> tuple[list[str], list]:
    filters: list[str] = []
    params: list = []
    _apply_doc_filters(
        filters, params,
        language=None, doc_id=None, doc_ids=None, resource_type=None,
        doc_role=None, author=None, title_search=None,
        doc_date_from=None, doc_date_to=None, source_ext=ext,
    )
    return filters, params


def test_source_ext_filter_uses_escape_clause() -> None:
    """QRY-07: the source_ext LIKE clause carries an ESCAPE, like author/title."""
    filters, params = _filters_for_ext("docx")
    assert filters == ["d.source_path LIKE ? ESCAPE '\\'"]
    assert params == ["%.docx"]


def test_source_ext_filter_escapes_like_wildcards() -> None:
    """QRY-07: % and _ in the extension are escaped so they match literally."""
    _, params = _filters_for_ext("a_b%c")
    # leading '.' is prepended; the wildcards are backslash-escaped
    assert params == ["%.a\\_b\\%c"]


def _setup_corpus(db_conn: sqlite3.Connection, simple_docx: Path) -> None:
    """Helper: import a DOCX and build the FTS index."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.indexer import build_index

    import_docx_numbered_lines(conn=db_conn, path=simple_docx, language="fr")
    build_index(db_conn)


def test_query_segment_returns_hits(
    db_conn: sqlite3.Connection,
    simple_docx: Path,
) -> None:
    """Segment mode must return hits with << >> highlight markers."""
    from multicorpus_engine.query import run_query

    _setup_corpus(db_conn, simple_docx)

    hits = run_query(db_conn, q="Bonjour", mode="segment")

    assert len(hits) == 1
    hit = hits[0]

    # Required fields present
    assert "doc_id" in hit
    assert "unit_id" in hit
    assert "external_id" in hit
    assert "language" in hit
    assert "title" in hit
    assert "text" in hit

    # Highlight markers present in the text field
    assert "<<" in hit["text"], "Segment hit must contain << highlight marker"
    assert ">>" in hit["text"], "Segment hit must contain >> highlight marker"

    # external_id must be 1 (the [1] line)
    assert hit["external_id"] == 1


def test_query_kwic_returns_left_match_right(
    db_conn: sqlite3.Connection,
    simple_docx: Path,
) -> None:
    """KWIC mode must return left, match, and right fields."""
    from multicorpus_engine.query import run_query

    _setup_corpus(db_conn, simple_docx)

    hits = run_query(db_conn, q="beau", mode="kwic", window=5)

    assert len(hits) == 1
    hit = hits[0]

    # Required KWIC fields
    assert "left" in hit
    assert "match" in hit
    assert "right" in hit
    assert "text_norm" in hit

    # Match field should contain the query term (case-insensitive)
    assert hit["match"].lower() == "beau"

    # The full sentence is "[2] Il fait beau aujourd'hui."
    # left should have "Il fait", right should have "aujourd'hui."
    assert "Il" in hit["left"] or "fait" in hit["left"]
    assert "aujourd" in hit["right"]


def test_query_kwic_window_size(
    db_conn: sqlite3.Connection,
    simple_docx: Path,
) -> None:
    """KWIC window parameter must limit the number of context tokens."""
    from multicorpus_engine.query import run_query

    _setup_corpus(db_conn, simple_docx)

    # Window of 1 should give at most 1 token left and 1 token right
    hits = run_query(db_conn, q="beau", mode="kwic", window=1)
    assert len(hits) == 1
    hit = hits[0]

    left_tokens = hit["left"].split() if hit["left"] else []
    right_tokens = hit["right"].split() if hit["right"] else []

    assert len(left_tokens) <= 1
    assert len(right_tokens) <= 1


def test_query_no_hits(
    db_conn: sqlite3.Connection,
    simple_docx: Path,
) -> None:
    """Query for a term not in the corpus must return an empty list."""
    from multicorpus_engine.query import run_query

    _setup_corpus(db_conn, simple_docx)

    hits = run_query(db_conn, q="xyzzy_not_in_corpus", mode="segment")
    assert hits == []


def test_query_language_filter(
    db_conn: sqlite3.Connection,
    simple_docx: Path,
) -> None:
    """Language filter must restrict results to matching documents."""
    from multicorpus_engine.query import run_query

    _setup_corpus(db_conn, simple_docx)

    # Querying with correct language returns hits
    hits_fr = run_query(db_conn, q="Bonjour", mode="segment", language="fr")
    assert len(hits_fr) == 1

    # Querying with wrong language returns no hits
    hits_en = run_query(db_conn, q="Bonjour", mode="segment", language="en")
    assert len(hits_en) == 0


def test_query_validate_user_regex_rejects_double_nested_group() -> None:
    # QRY-06: query.py carries its own copy of the ReDoS guard (kept in sync with
    # curation.py) — it must also reject ((a)*)* yet allow disjoint alternation.
    import pytest

    from multicorpus_engine.query import _validate_user_regex

    with pytest.raises(ValueError, match="nested quantifiers"):
        _validate_user_regex("((a)*)*")
    _validate_user_regex("(a|b)*")  # legitimate → must not raise
