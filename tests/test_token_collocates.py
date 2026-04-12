"""Unit tests for token_collocates.run_token_collocates.

Uses an in-memory SQLite DB seeded with minimal CoNLL-U-style token data
(no importer — tokens inserted directly) to stay fast and dependency-free.
"""

from __future__ import annotations

import math
import sqlite3
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).parent.parent
_MIGRATIONS_DIR = _REPO_ROOT / "migrations"


# ── fixtures ──────────────────────────────────────────────────────────────────

def _make_conn() -> sqlite3.Connection:
    """Fresh in-memory DB with all migrations applied."""
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _seed(conn: sqlite3.Connection) -> None:
    """Insert two documents with token sequences.

    Doc 1 (FR): "le chat mange le poisson rouge"  ×2 repetitions
    Doc 2 (FR): "le poisson nage dans l'eau"

    CQL [lemma="manger"] should produce 2 hits (doc1, unit 1 and 2).
    Expected collocates around "mange":
      - left:  le(2), chat(2)
      - right: le(2), poisson(2), rouge(2)
    """
    conn.execute(
        """INSERT INTO documents (doc_id, title, language, source_hash, workflow_status, created_at)
           VALUES (1, 'Doc FR 1', 'fr', 'hash1', 'draft', '2026-01-01'),
                  (2, 'Doc FR 2', 'fr', 'hash2', 'draft', '2026-01-01')"""
    )
    # Unit 1 (doc 1): "le chat mange le poisson rouge"
    conn.execute(
        """INSERT INTO units (unit_id, doc_id, unit_type, n, text_norm, text_raw)
           VALUES (1, 1, 'line', 1, 'le chat mange le poisson rouge', 'le chat mange le poisson rouge'),
                  (2, 1, 'line', 2, 'le chat mange le poisson rouge', 'le chat mange le poisson rouge'),
                  (3, 2, 'line', 1, 'le poisson nage dans eau', 'le poisson nage dans eau')"""
    )
    # Tokens for unit 1
    tokens_u1 = [
        (1, 1, 0, "le",      "le",      "DET",  None),
        (1, 1, 1, "chat",    "chat",    "NOUN", None),
        (1, 1, 2, "mange",   "manger",  "VERB", None),
        (1, 1, 3, "le",      "le",      "DET",  None),
        (1, 1, 4, "poisson", "poisson", "NOUN", None),
        (1, 1, 5, "rouge",   "rouge",   "ADJ",  None),
    ]
    # Tokens for unit 2 (same sentence, different unit)
    tokens_u2 = [
        (2, 1, 0, "le",      "le",      "DET",  None),
        (2, 1, 1, "chat",    "chat",    "NOUN", None),
        (2, 1, 2, "mange",   "manger",  "VERB", None),
        (2, 1, 3, "le",      "le",      "DET", None),
        (2, 1, 4, "poisson", "poisson", "NOUN", None),
        (2, 1, 5, "rouge",   "rouge",   "ADJ",  None),
    ]
    # Tokens for unit 3 (doc 2): "le poisson nage dans eau"
    tokens_u3 = [
        (3, 1, 0, "le",      "le",      "DET",  None),
        (3, 1, 1, "poisson", "poisson", "NOUN", None),
        (3, 1, 2, "nage",    "nager",   "VERB", None),
        (3, 1, 3, "dans",    "dans",    "PREP", None),
        (3, 1, 4, "eau",     "eau",     "NOUN", None),
    ]
    for (uid, sid, pos, word, lemma, upos, feats) in tokens_u1 + tokens_u2 + tokens_u3:
        conn.execute(
            "INSERT INTO tokens (unit_id, sent_id, position, word, lemma, upos, feats) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (uid, sid, pos, word, lemma, upos, feats),
        )
    conn.commit()


@pytest.fixture()
def seeded_conn() -> sqlite3.Connection:
    conn = _make_conn()
    _seed(conn)
    return conn


# ── tests ─────────────────────────────────────────────────────────────────────

class TestRunTokenCollocates:

    def test_basic_lemma_collocates(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
        )

        assert result["total_hits"] == 2
        values = {r["value"] for r in result["rows"]}
        # "le", "chat" on left; "le", "poisson", "rouge" on right
        assert "le" in values
        assert "chat" in values
        assert "poisson" in values
        assert "rouge" in values
        # "manger" itself should NOT appear (excluded as pivot span)
        assert "manger" not in values

    def test_left_right_split(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
        )
        by_value = {r["value"]: r for r in result["rows"]}

        chat = by_value["chat"]
        assert chat["left_freq"] == 2   # "le chat | mange"
        assert chat["right_freq"] == 0

        rouge = by_value["rouge"]
        assert rouge["left_freq"] == 0
        assert rouge["right_freq"] == 2  # "mange … rouge"

    def test_min_freq_filter(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result_2 = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=2,
        )
        result_1 = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
        )
        # min_freq=2 should yield same or fewer rows
        assert len(result_2["rows"]) <= len(result_1["rows"])
        # every row in result_2 has freq >= 2
        assert all(r["freq"] >= 2 for r in result_2["rows"])

    def test_window_clipping(self, seeded_conn: sqlite3.Connection) -> None:
        """Window=1 should only include immediately adjacent tokens."""
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=1,
            by="lemma",
            min_freq=1,
        )
        values = {r["value"] for r in result["rows"]}
        assert "chat" in values   # immediately left
        assert "le" in values     # immediately right (first "le" after mange)
        # "rouge" is 3 positions to the right — should be excluded
        assert "rouge" not in values

    def test_pmi_scores_positive_for_strong_collocates(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
        )
        by_value = {r["value"]: r for r in result["rows"]}
        # "chat" only appears next to "manger" — should have high PMI
        assert by_value["chat"]["pmi"] > 0

    def test_ll_scores_non_negative(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
        )
        assert all(r["ll"] >= 0 for r in result["rows"])

    def test_sort_by_freq(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
            sort_by="freq",
        )
        freqs = [r["freq"] for r in result["rows"]]
        assert freqs == sorted(freqs, reverse=True)

    def test_sort_by_ll(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
            sort_by="ll",
        )
        ll_scores = [r["ll"] for r in result["rows"]]
        assert ll_scores == sorted(ll_scores, reverse=True)

    def test_no_hits_returns_empty(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="xyz_nonexistent"]',
            window=5,
            by="lemma",
            min_freq=1,
        )
        assert result["total_hits"] == 0
        assert result["rows"] == []

    def test_by_upos(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="upos",
            min_freq=1,
        )
        values = {r["value"] for r in result["rows"]}
        assert "DET" in values
        assert "NOUN" in values

    def test_limit_respected(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
            limit=2,
        )
        assert len(result["rows"]) <= 2

    def test_corpus_size_in_result(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        result = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
        )
        # 17 tokens total: 6 + 6 + 5
        assert result["corpus_size"] == 17

    def test_doc_ids_filter(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        # Only doc 1 has "manger"
        result_all = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
        )
        result_doc2 = run_token_collocates(
            seeded_conn,
            cql='[lemma="manger"]',
            window=5,
            by="lemma",
            min_freq=1,
            doc_ids=[2],
        )
        assert result_all["total_hits"] == 2
        assert result_doc2["total_hits"] == 0

    def test_validation_bad_cql(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        with pytest.raises(Exception):
            run_token_collocates(seeded_conn, cql="", window=5, by="lemma")

    def test_validation_bad_window(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        with pytest.raises(ValueError, match="window"):
            run_token_collocates(seeded_conn, cql='[lemma="manger"]', window=0, by="lemma")

    def test_validation_bad_by(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        with pytest.raises(ValueError, match="by"):
            run_token_collocates(seeded_conn, cql='[lemma="manger"]', window=5, by="feats")

    def test_validation_bad_sort_by(self, seeded_conn: sqlite3.Connection) -> None:
        from multicorpus_engine.token_collocates import run_token_collocates

        with pytest.raises(ValueError, match="sort_by"):
            run_token_collocates(
                seeded_conn, cql='[lemma="manger"]', window=5, by="lemma", sort_by="tfidf"
            )
