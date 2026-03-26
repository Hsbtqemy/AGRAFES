"""Lexical statistics engine.

Computes word frequency distributions over a configurable sub-corpus
(slot).  The slot is defined by optional filters on document metadata
(doc_ids, language, doc_role, resource_type, family_id).

API:
    compute_lexical_stats(conn, slot) -> StatsResult
    compute_stats_compare(conn, slot_a, slot_b) -> StatsCompareResult
"""

from __future__ import annotations

import re
import sqlite3
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Optional

_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class StatsSlot:
    """Defines a sub-corpus over which to compute statistics."""
    doc_ids: Optional[list[int]] = None       # None = all documents
    language: Optional[str] = None
    doc_role: Optional[str] = None
    resource_type: Optional[str] = None
    family_id: Optional[int] = None           # include parent + children
    top_n: int = 50
    min_length: int = 2


@dataclass
class StatsWord:
    word: str
    count: int
    freq_pct: float   # percentage of total tokens


@dataclass
class StatsResult:
    label: str
    total_tokens: int
    vocabulary_size: int
    total_units: int
    total_docs: int
    avg_tokens_per_unit: float
    top_words: list[StatsWord]
    rare_words: list[StatsWord]


@dataclass
class StatsCompareWord:
    word: str
    count_a: int
    count_b: int
    freq_a: float   # % of corpus A
    freq_b: float   # % of corpus B
    ratio: float    # freq_a / freq_b (0 if freq_b == 0; -1 means only in B)


@dataclass
class StatsCompareResult:
    label_a: str
    label_b: str
    summary_a: StatsResult
    summary_b: StatsResult
    comparison: list[StatsCompareWord]   # union of top words from A and B


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _tokenize(text: str, min_length: int = 2) -> list[str]:
    return [w.lower() for w in _WORD_RE.findall(text) if len(w) >= min_length]


def _slot_to_doc_ids(conn: sqlite3.Connection, slot: StatsSlot) -> list[int] | None:
    """Resolve slot filters to a concrete list of doc_ids (or None = all)."""
    # Family expansion: parent + all children
    if slot.family_id is not None:
        child_rows = conn.execute(
            "SELECT doc_id FROM doc_relations"
            " WHERE target_doc_id = ? AND relation_type IN ('translation_of', 'excerpt_of')",
            [slot.family_id],
        ).fetchall()
        family_ids = [slot.family_id] + [r[0] for r in child_rows]
        # Intersect with any explicit doc_ids filter
        if slot.doc_ids is not None:
            return [d for d in family_ids if d in set(slot.doc_ids)]
        return family_ids

    return slot.doc_ids  # may be None (= all)


def _fetch_texts(conn: sqlite3.Connection, slot: StatsSlot) -> tuple[list[str], int, int]:
    """Fetch text_norm for units matching the slot.

    Returns (texts, unit_count, doc_count).
    """
    effective_doc_ids = _slot_to_doc_ids(conn, slot)

    filters: list[str] = ["u.unit_type = 'line'"]
    params: list[Any] = []

    if slot.language:
        filters.append("d.language = ?")
        params.append(slot.language)
    if slot.doc_role:
        filters.append("d.doc_role = ?")
        params.append(slot.doc_role)
    if slot.resource_type:
        filters.append("d.resource_type = ?")
        params.append(slot.resource_type)
    if effective_doc_ids is not None:
        if not effective_doc_ids:
            return [], 0, 0
        placeholders = ",".join("?" * len(effective_doc_ids))
        filters.append(f"u.doc_id IN ({placeholders})")
        params.extend(effective_doc_ids)

    where = " AND ".join(filters)
    rows = conn.execute(
        f"""
        SELECT u.text_norm, u.doc_id
        FROM units u
        JOIN documents d ON d.doc_id = u.doc_id
        WHERE {where}
        ORDER BY u.doc_id, u.n
        """,
        params,
    ).fetchall()

    texts = [row[0] or "" for row in rows]
    doc_count = len({row[1] for row in rows})
    return texts, len(texts), doc_count


def _compute_from_texts(
    texts: list[str],
    unit_count: int,
    doc_count: int,
    label: str,
    top_n: int,
    min_length: int,
) -> StatsResult:
    counter: Counter[str] = Counter()
    for text in texts:
        counter.update(_tokenize(text, min_length))

    total_tokens = sum(counter.values())
    vocabulary_size = len(counter)
    avg = total_tokens / unit_count if unit_count else 0.0

    def _pct(count: int) -> float:
        return round(count / total_tokens * 100, 3) if total_tokens else 0.0

    top_words = [
        StatsWord(word=w, count=c, freq_pct=_pct(c))
        for w, c in counter.most_common(top_n)
    ]
    rare_words = [
        StatsWord(word=w, count=c, freq_pct=_pct(c))
        for w, c in reversed(counter.most_common())
    ][:top_n]

    return StatsResult(
        label=label,
        total_tokens=total_tokens,
        vocabulary_size=vocabulary_size,
        total_units=unit_count,
        total_docs=doc_count,
        avg_tokens_per_unit=round(avg, 2),
        top_words=top_words,
        rare_words=rare_words,
    )


# ─── Public API ───────────────────────────────────────────────────────────────

def compute_lexical_stats(
    conn: sqlite3.Connection,
    slot: StatsSlot,
    label: str = "",
) -> StatsResult:
    """Compute lexical frequency statistics for a sub-corpus slot."""
    texts, unit_count, doc_count = _fetch_texts(conn, slot)
    return _compute_from_texts(texts, unit_count, doc_count, label, slot.top_n, slot.min_length)


def compute_stats_compare(
    conn: sqlite3.Connection,
    slot_a: StatsSlot,
    slot_b: StatsSlot,
    label_a: str = "A",
    label_b: str = "B",
) -> StatsCompareResult:
    """Compare frequency distributions of two sub-corpus slots."""
    texts_a, unit_a, doc_a = _fetch_texts(conn, slot_a)
    texts_b, unit_b, doc_b = _fetch_texts(conn, slot_b)

    summary_a = _compute_from_texts(texts_a, unit_a, doc_a, label_a, slot_a.top_n, slot_a.min_length)
    summary_b = _compute_from_texts(texts_b, unit_b, doc_b, label_b, slot_b.top_n, slot_b.min_length)

    # Union of words appearing in top or rare of either side
    words_a = {w.word: w.count for w in summary_a.top_words + summary_a.rare_words}
    words_b = {w.word: w.count for w in summary_b.top_words + summary_b.rare_words}
    all_words = sorted(set(words_a) | set(words_b))

    total_a = summary_a.total_tokens or 1
    total_b = summary_b.total_tokens or 1

    comparison: list[StatsCompareWord] = []
    for word in all_words:
        ca = words_a.get(word, 0)
        cb = words_b.get(word, 0)
        fa = round(ca / total_a * 100, 4)
        fb = round(cb / total_b * 100, 4)
        if fb == 0:
            ratio = 0.0 if ca == 0 else float("inf")
        else:
            ratio = round(fa / fb, 3)
        comparison.append(StatsCompareWord(
            word=word, count_a=ca, count_b=cb,
            freq_a=fa, freq_b=fb, ratio=ratio,
        ))

    # Sort by sum of frequencies descending
    comparison.sort(key=lambda x: x.freq_a + x.freq_b, reverse=True)

    return StatsCompareResult(
        label_a=label_a,
        label_b=label_b,
        summary_a=summary_a,
        summary_b=summary_b,
        comparison=comparison,
    )


# ─── Serialisation ────────────────────────────────────────────────────────────

def stats_result_to_dict(r: StatsResult) -> dict:
    return {
        "label": r.label,
        "total_tokens": r.total_tokens,
        "vocabulary_size": r.vocabulary_size,
        "total_units": r.total_units,
        "total_docs": r.total_docs,
        "avg_tokens_per_unit": r.avg_tokens_per_unit,
        "top_words": [{"word": w.word, "count": w.count, "freq_pct": w.freq_pct} for w in r.top_words],
        "rare_words": [{"word": w.word, "count": w.count, "freq_pct": w.freq_pct} for w in r.rare_words],
    }


def stats_compare_result_to_dict(r: StatsCompareResult) -> dict:
    return {
        "label_a": r.label_a,
        "label_b": r.label_b,
        "summary_a": stats_result_to_dict(r.summary_a),
        "summary_b": stats_result_to_dict(r.summary_b),
        "comparison": [
            {
                "word": c.word,
                "count_a": c.count_a,
                "count_b": c.count_b,
                "freq_a": c.freq_a,
                "freq_b": c.freq_b,
                "ratio": c.ratio if c.ratio != float("inf") else None,
            }
            for c in r.comparison
        ],
    }
