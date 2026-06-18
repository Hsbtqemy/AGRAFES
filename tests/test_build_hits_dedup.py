"""Q-02: _build_hits (exact) and _build_hits_regex (regex) now share one core.

These exercise BOTH variants directly — the regex path previously had no test —
and the two behavioural flags the core preserves (text_norm coercion; mode
dispatch). conn is only touched when include_aligned=True, so None is fine here.
"""

from __future__ import annotations

import re

import pytest

from multicorpus_engine.query import _build_hits, _build_hits_regex


def _row(text_norm: str | None = "le chat est beau", **over) -> dict:
    base = {
        "unit_id": 1, "doc_id": 7, "external_id": 3,
        "text_norm": text_norm, "language": "fr", "title": "T",
    }
    base.update(over)
    return base


_SEG_KEYS = {"doc_id", "unit_id", "external_id", "language", "title", "text", "text_norm"}
_KWIC_KEYS = {"doc_id", "unit_id", "external_id", "language", "title",
              "left", "match", "right", "text_norm"}


def _exact(rows, **kw):
    base = dict(q="beau", mode="segment", window=10, include_aligned=False,
                aligned_limit=None, all_occurrences=False)
    base.update(kw)
    return _build_hits(None, rows, **base)


def _regex(rows, **kw):
    base = dict(compiled=re.compile("beau"), mode="segment", window=10,
                include_aligned=False, aligned_limit=None, all_occurrences=False)
    base.update(kw)
    return _build_hits_regex(None, rows, **base)


# --- exact variant --------------------------------------------------------------
def test_exact_segment() -> None:
    hits = _exact([_row()])
    assert len(hits) == 1
    assert set(hits[0]) == _SEG_KEYS
    assert hits[0]["text_norm"] == "le chat est beau"
    assert hits[0]["doc_id"] == 7 and hits[0]["unit_id"] == 1


def test_exact_kwic() -> None:
    hits = _exact([_row()], mode="kwic", window=2)
    assert len(hits) == 1
    assert set(hits[0]) == _KWIC_KEYS


def test_exact_all_occurrences_yields_more() -> None:
    rows = [_row(text_norm="beau et beau")]
    one = _exact(rows, mode="kwic", window=1, all_occurrences=False)
    many = _exact(rows, mode="kwic", window=1, all_occurrences=True)
    assert len(one) == 1
    assert len(many) >= 2  # all occurrences expanded


# --- regex variant (previously untested) ----------------------------------------
def test_regex_segment() -> None:
    hits = _regex([_row()])
    assert len(hits) == 1 and set(hits[0]) == _SEG_KEYS
    assert hits[0]["text_norm"] == "le chat est beau"


def test_regex_kwic() -> None:
    hits = _regex([_row()], mode="kwic", window=2)
    assert len(hits) == 1 and set(hits[0]) == _KWIC_KEYS


def test_regex_coerces_null_text_norm() -> None:
    # coerce_text_norm=True in the regex variant: NULL -> "" (no crash).
    hits = _regex([_row(text_norm=None)], compiled=re.compile("x"))
    assert hits[0]["text_norm"] == ""


# --- shared core behaviour ------------------------------------------------------
def test_unknown_mode_raises_both() -> None:
    with pytest.raises(ValueError):
        _exact([_row()], mode="bogus")
    with pytest.raises(ValueError):
        _regex([_row()], mode="bogus")
