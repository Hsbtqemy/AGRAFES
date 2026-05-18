"""Tests for aligner.source_changed_summary — global « source modifiée »
summary that drives the AlignPanel landing banner (HANDOFF_PREP Tier A #6).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from tests.conftest import make_docx


@pytest.fixture()
def aligned_corpus(db_conn: sqlite3.Connection, tmp_path: Path) -> dict:
    """Pivot FR aligned to two targets (EN, DE) on shared external_id."""
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.aligner import align_by_external_id

    piv = tmp_path / "fr.docx"
    piv.write_bytes(make_docx(["[1] Bonjour le monde.", "[2] Le chat dort."]))
    en = tmp_path / "en.docx"
    en.write_bytes(make_docx(["[1] Hello world.", "[2] The cat sleeps."]))
    de = tmp_path / "de.docx"
    de.write_bytes(make_docx(["[1] Hallo Welt.", "[2] Die Katze schläft."]))

    rp = import_docx_numbered_lines(conn=db_conn, path=piv, language="fr", title="Pivot")
    re = import_docx_numbered_lines(conn=db_conn, path=en, language="en", title="Target EN")
    rd = import_docx_numbered_lines(conn=db_conn, path=de, language="de", title="Target DE")

    align_by_external_id(
        db_conn, pivot_doc_id=rp.doc_id,
        target_doc_ids=[re.doc_id, rd.doc_id], run_id="r-test",
    )
    return {"pivot": rp.doc_id, "en": re.doc_id, "de": rd.doc_id}


def test_summary_empty_when_no_source_changed(aligned_corpus, db_conn):
    """Fresh alignment → no link has source_changed_at → total 0."""
    from multicorpus_engine.aligner import source_changed_summary

    summary = source_changed_summary(db_conn)
    assert summary == {"total": 0, "docs": []}


def test_summary_counts_changed_links_per_target(aligned_corpus, db_conn):
    from multicorpus_engine.aligner import source_changed_summary

    # Flag both EN links + one DE link as source-changed.
    db_conn.execute(
        "UPDATE alignment_links SET source_changed_at = '2026-05-18T10:00:00Z'"
        " WHERE target_doc_id = ?",
        (aligned_corpus["en"],),
    )
    db_conn.execute(
        "UPDATE alignment_links SET source_changed_at = '2026-05-18T10:00:00Z'"
        " WHERE target_doc_id = ? AND external_id = 1",
        (aligned_corpus["de"],),
    )
    db_conn.commit()

    summary = source_changed_summary(db_conn)
    assert summary["total"] == 3
    # docs sorted by descending count → EN (2) before DE (1).
    assert [d["target_doc_id"] for d in summary["docs"]] == [
        aligned_corpus["en"], aligned_corpus["de"],
    ]
    assert summary["docs"][0]["count"] == 2
    assert summary["docs"][0]["target_title"] == "Target EN"
    assert summary["docs"][1]["count"] == 1


def test_summary_clears_after_acknowledge(aligned_corpus, db_conn):
    """Acknowledging (source_changed_at = NULL) removes the link from the summary."""
    from multicorpus_engine.aligner import source_changed_summary

    db_conn.execute(
        "UPDATE alignment_links SET source_changed_at = '2026-05-18T10:00:00Z'"
        " WHERE target_doc_id = ?",
        (aligned_corpus["en"],),
    )
    db_conn.commit()
    assert source_changed_summary(db_conn)["total"] == 2

    # Simulate acknowledge.
    db_conn.execute(
        "UPDATE alignment_links SET source_changed_at = NULL WHERE target_doc_id = ?",
        (aligned_corpus["en"],),
    )
    db_conn.commit()
    assert source_changed_summary(db_conn) == {"total": 0, "docs": []}
