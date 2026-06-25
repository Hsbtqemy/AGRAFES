"""Unit tests for run_token_stats group_by="year" (F2 — diachronic distribution).

In-memory DB seeded directly with tokens + heterogeneous free-text doc_date
values (migration 010 format: "1850" / "1850-03" / "1900-12-31" / NULL).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from multicorpus_engine.token_stats import run_token_stats

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


def _make_conn() -> sqlite3.Connection:
    from multicorpus_engine.db.migrations import apply_migrations

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _seed(conn: sqlite3.Connection) -> None:
    """4 docs, one line-unit each, lemma 'chat' once per unit.

    doc_date covers the three documented formats + NULL:
      doc1 "1850"        — 3 tokens
      doc2 "1850-03"     — 3 tokens   (same year bucket as doc1)
      doc3 "1900-12-31"  — 2 tokens
      doc4 NULL          — 2 tokens   → "(sans date)" bucket
    """
    conn.execute(
        """INSERT INTO documents (doc_id, title, language, source_hash, doc_date, created_at)
           VALUES (1, 'D1', 'fr', 'h1', '1850',       '2026-01-01'),
                  (2, 'D2', 'fr', 'h2', '1850-03',    '2026-01-01'),
                  (3, 'D3', 'fr', 'h3', '1900-12-31', '2026-01-01'),
                  (4, 'D4', 'fr', 'h4', NULL,         '2026-01-01')"""
    )
    conn.execute(
        """INSERT INTO units (unit_id, doc_id, unit_type, n, text_norm, text_raw)
           VALUES (1, 1, 'line', 1, 'le chat dort',  'le chat dort'),
                  (2, 2, 'line', 1, 'le chat mange', 'le chat mange'),
                  (3, 3, 'line', 1, 'un chat',       'un chat'),
                  (4, 4, 'line', 1, 'le chat',       'le chat')"""
    )
    tokens = [
        # unit 1 (1850): 3 tokens
        (1, 1, 0, "le", "le", "DET"), (1, 1, 1, "chat", "chat", "NOUN"), (1, 1, 2, "dort", "dormir", "VERB"),
        # unit 2 (1850-03): 3 tokens
        (2, 1, 0, "le", "le", "DET"), (2, 1, 1, "chat", "chat", "NOUN"), (2, 1, 2, "mange", "manger", "VERB"),
        # unit 3 (1900-12-31): 2 tokens
        (3, 1, 0, "un", "un", "DET"), (3, 1, 1, "chat", "chat", "NOUN"),
        # unit 4 (undated): 2 tokens
        (4, 1, 0, "le", "le", "DET"), (4, 1, 1, "chat", "chat", "NOUN"),
    ]
    for uid, sid, pos, word, lemma, upos in tokens:
        conn.execute(
            "INSERT INTO tokens (unit_id, sent_id, position, word, lemma, upos) VALUES (?, ?, ?, ?, ?, ?)",
            (uid, sid, pos, word, lemma, upos),
        )
    conn.commit()


@pytest.fixture()
def conn() -> sqlite3.Connection:
    c = _make_conn()
    _seed(c)
    return c


def test_year_buckets_count_per_hit_chronological(conn: sqlite3.Connection) -> None:
    out = run_token_stats(conn, cql='[lemma="chat"]', group_by="year")
    assert out["group_by"] == "year"
    assert out["total_hits"] == 4  # one 'chat' per unit
    # Chronological order; undated bucket last. "1850" and "1850-03" merge into 1850.
    assert [r["value"] for r in out["rows"]] == ["1850", "1900", "(sans date)"]
    counts = {r["value"]: r["count"] for r in out["rows"]}
    assert counts == {"1850": 2, "1900": 1, "(sans date)": 1}


def test_year_normalised_frequency_and_denominator(conn: sqlite3.Connection) -> None:
    rows = {r["value"]: r for r in run_token_stats(conn, cql='[lemma="chat"]', group_by="year")["rows"]}
    # Denominator = all tokens in scope for that year (free, from the streams).
    assert rows["1850"]["tokens_in_period"] == 6   # 3 + 3
    assert rows["1900"]["tokens_in_period"] == 2
    assert rows["(sans date)"]["tokens_in_period"] == 2
    # freq_per_10k = hits / tokens_in_period * 10000
    assert rows["1850"]["freq_per_10k"] == round(2 / 6 * 10000, 2)
    assert rows["1900"]["freq_per_10k"] == 5000.0
    # pct = share of hits (count / total_hits)
    assert rows["1850"]["pct"] == 50.0


def test_year_attribute_branch_unaffected(conn: sqlite3.Connection) -> None:
    # The default token-attribute path must keep its per-token counting + fields.
    out = run_token_stats(conn, cql='[lemma="chat"]', group_by="lemma")
    assert out["rows"][0]["value"] == "chat"
    assert out["rows"][0]["count"] == 4
    assert "tokens_in_period" not in out["rows"][0]  # year-only field


def test_year_rejects_unknown_group_by(conn: sqlite3.Connection) -> None:
    with pytest.raises(ValueError):
        run_token_stats(conn, cql='[lemma="chat"]', group_by="decade")
