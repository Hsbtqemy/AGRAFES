"""Tests for the query engine (segment + KWIC modes)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


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
