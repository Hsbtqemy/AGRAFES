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


# ── R4.1: unit_status filter ──────────────────────────────────────────────────
def _mk_indexed_status_doc(db_conn: sqlite3.Connection) -> int:
    """Three FTS-indexed line units all containing 'mot'; caller sets statuses."""
    from multicorpus_engine.indexer import build_index

    cur = db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('D', 'fr', 'standalone', datetime('now'))"
    )
    doc_id = cur.lastrowid
    for i in range(1, 4):
        db_conn.execute(
            "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm)"
            " VALUES (?, 'line', ?, ?, ?, ?)",
            (doc_id, i, i, f"mot {i}", f"mot {i}"),
        )
    db_conn.commit()
    build_index(db_conn)
    return doc_id


def test_query_filters_by_unit_status_fts(db_conn: sqlite3.Connection) -> None:
    """R4.1 — the FTS path restricts hits to units of the given translation status."""
    from multicorpus_engine.query import run_query_page

    doc_id = _mk_indexed_status_doc(db_conn)
    db_conn.execute("UPDATE units SET unit_status='non_traduit' WHERE doc_id=? AND n=1", (doc_id,))
    db_conn.execute("UPDATE units SET unit_status='ajout' WHERE doc_id=? AND n=2", (doc_id,))
    db_conn.commit()

    assert len(run_query_page(db_conn, q="mot")["hits"]) == 3  # unfiltered
    nt = run_query_page(db_conn, q="mot", unit_status="non_traduit")["hits"]
    assert len(nt) == 1 and nt[0]["external_id"] == 1
    aj = run_query_page(db_conn, q="mot", unit_status="ajout")["hits"]
    assert len(aj) == 1 and aj[0]["external_id"] == 2


def test_query_filters_by_unit_status_regex(db_conn: sqlite3.Connection) -> None:
    """R4.1 — the regex (full-scan) path applies the same unit_status filter."""
    from multicorpus_engine.query import run_query_page

    doc_id = _mk_indexed_status_doc(db_conn)
    db_conn.execute("UPDATE units SET unit_status='non_traduit' WHERE doc_id=? AND n=1", (doc_id,))
    db_conn.commit()

    res = run_query_page(db_conn, q="", regex_pattern="mot", unit_status="non_traduit")["hits"]
    assert len(res) == 1 and res[0]["external_id"] == 1


# ── R4.3: hits (and aligned units) carry unit_role + unit_status ───────────────
def _seed_role(db_conn: sqlite3.Connection, name: str = "titre") -> None:
    """Ensure a structure role exists (unit_role FK → unit_roles(name))."""
    db_conn.execute(
        "INSERT OR IGNORE INTO unit_roles (name, label, color, sort_order, category)"
        " VALUES (?, ?, '#2563eb', 1, 'structure')",
        (name, name.capitalize()),
    )


def test_facets_filter_by_unit_status(db_conn: sqlite3.Connection) -> None:
    """FE-01 — facet counts (total/top-docs) honour the unit_status filter; without it
    the filtered hit list would show unfiltered totals."""
    from multicorpus_engine.query import run_query_facets

    doc_id = _mk_indexed_status_doc(db_conn)
    db_conn.execute("UPDATE units SET unit_status='non_traduit' WHERE doc_id=? AND n=1", (doc_id,))
    db_conn.commit()

    assert run_query_facets(db_conn, q="mot")["total_hits"] == 3  # unfiltered
    nt = run_query_facets(db_conn, q="mot", unit_status="non_traduit")
    assert nt["total_hits"] == 1 and nt["distinct_docs"] == 1
    assert nt["top_docs"][0]["count"] == 1


def test_query_hits_carry_role_and_status_fts(db_conn: sqlite3.Connection) -> None:
    """R4.3 — segment/FTS hits expose unit_role + unit_status (null when unset)."""
    from multicorpus_engine.query import run_query_page

    doc_id = _mk_indexed_status_doc(db_conn)
    _seed_role(db_conn, "titre")
    db_conn.execute("UPDATE units SET unit_role='titre', unit_status='non_traduit' WHERE doc_id=? AND n=1", (doc_id,))
    db_conn.commit()

    by_ext = {h["external_id"]: h for h in run_query_page(db_conn, q="mot")["hits"]}
    assert by_ext[1]["unit_role"] == "titre" and by_ext[1]["unit_status"] == "non_traduit"
    assert by_ext[2]["unit_role"] is None and by_ext[2]["unit_status"] is None  # unset → null


def test_query_hits_carry_role_and_status_kwic(db_conn: sqlite3.Connection) -> None:
    """R4.3 — kwic occurrences carry the same fields without losing the kwic shape."""
    from multicorpus_engine.query import run_query_page

    doc_id = _mk_indexed_status_doc(db_conn)
    _seed_role(db_conn, "chapeau")
    db_conn.execute("UPDATE units SET unit_role='chapeau', unit_status='ajout' WHERE doc_id=? AND n=3", (doc_id,))
    db_conn.commit()

    h3 = next(h for h in run_query_page(db_conn, q="mot", mode="kwic")["hits"] if h["external_id"] == 3)
    assert h3["unit_role"] == "chapeau" and h3["unit_status"] == "ajout"
    assert "left" in h3 and "match" in h3  # kwic shape intact


def test_query_hits_carry_role_and_status_regex(db_conn: sqlite3.Connection) -> None:
    """R4.3 — the regex (full-scan) path also exposes role + status."""
    from multicorpus_engine.query import run_query_page

    doc_id = _mk_indexed_status_doc(db_conn)
    _seed_role(db_conn, "titre")
    db_conn.execute("UPDATE units SET unit_role='titre', unit_status='non_traduit' WHERE doc_id=? AND n=1", (doc_id,))
    db_conn.commit()

    by_ext = {h["external_id"]: h for h in run_query_page(db_conn, q="", regex_pattern="mot")["hits"]}
    assert by_ext[1]["unit_role"] == "titre" and by_ext[1]["unit_status"] == "non_traduit"
    assert by_ext[2]["unit_status"] is None


def _mk_aligned_pair(db_conn: sqlite3.Connection) -> tuple[int, int]:
    """A fr pivot ('mot pivot') aligned to an en target ('word target'), indexed.

    Returns (pivot_unit_id, target_unit_id). Pivot status=ajout ; target role=titre,
    status=non_traduit — so both directions of _fetch_aligned_units can be asserted.
    """
    from multicorpus_engine.indexer import build_index

    p = db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('P', 'fr', 'source', datetime('now'))"
    ).lastrowid
    t = db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at)"
        " VALUES ('T', 'en', 'translation', datetime('now'))"
    ).lastrowid
    pu = db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm)"
        " VALUES (?, 'line', 1, 1, 'mot pivot', 'mot pivot')", (p,)
    ).lastrowid
    tu = db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm)"
        " VALUES (?, 'line', 1, 1, 'word target', 'word target')", (t,)
    ).lastrowid
    _seed_role(db_conn, "titre")
    db_conn.execute("UPDATE units SET unit_status='ajout' WHERE unit_id=?", (pu,))
    db_conn.execute("UPDATE units SET unit_role='titre', unit_status='non_traduit' WHERE unit_id=?", (tu,))
    db_conn.execute(
        "INSERT INTO alignment_links (run_id, pivot_unit_id, target_unit_id, external_id,"
        " pivot_doc_id, target_doc_id, created_at)"
        " VALUES ('r', ?, ?, 1, ?, ?, datetime('now'))", (pu, tu, p, t)
    )
    db_conn.commit()
    build_index(db_conn)
    return pu, tu


def test_aligned_units_carry_role_and_status_forward(db_conn: sqlite3.Connection) -> None:
    """R4.3 — forward aligned lookup (query the pivot) carries target role + status."""
    from multicorpus_engine.query import run_query_page

    _mk_aligned_pair(db_conn)
    hits = run_query_page(db_conn, q="pivot", include_aligned=True)["hits"]
    assert len(hits) == 1
    aligned = hits[0]["aligned"]
    assert len(aligned) == 1
    assert aligned[0]["unit_role"] == "titre" and aligned[0]["unit_status"] == "non_traduit"


def test_aligned_units_carry_role_and_status_reverse(db_conn: sqlite3.Connection) -> None:
    """R4.3 — reverse aligned lookup (query the target) carries the pivot's role + status.

    Exercises the siblings UNION-ALL branch of _fetch_aligned_units, distinct from
    the forward branch.
    """
    from multicorpus_engine.query import run_query_page

    _mk_aligned_pair(db_conn)
    hits = run_query_page(db_conn, q="word", include_aligned=True)["hits"]
    assert len(hits) == 1
    aligned = hits[0]["aligned"]
    assert len(aligned) == 1  # the pivot (returned via the siblings query)
    assert aligned[0]["unit_status"] == "ajout" and aligned[0]["unit_role"] is None
