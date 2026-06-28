"""Guard tests for the CQL matcher complexity cap (audit QRY-01).

A handful of unbounded quantified wildcards (``[]{0,30}[]{0,30}…``) made the
backtracking matcher explode combinatorially — measured at ~114 s on a 100-token
unit, all while holding the sidecar's global write-lock. The cap aborts such a
query quickly with a typed :class:`CqlComplexityError` instead of hanging.
"""

from __future__ import annotations

import time

import pytest

from multicorpus_engine.cql_parser import parse_cql_query
from multicorpus_engine.token_query import (
    CqlComplexityError,
    _compile_specs,
    _find_matches,
)


def _tokens(n: int) -> list[dict]:
    return [
        {
            "word": "x", "lemma": "x", "upos": "X", "xpos": None, "feats": None,
            "token_id": i, "position": i, "sent_id": 1,
        }
        for i in range(n)
    ]


def test_pathological_cql_aborts_fast() -> None:
    specs = _compile_specs(parse_cql_query("[]{0,30}[]{0,30}[]{0,30}[]{0,30}"))
    start = time.monotonic()
    with pytest.raises(CqlComplexityError):
        _find_matches(_tokens(100), specs)
    # Was ~114 s before the cap; the budget aborts well under a second.
    assert time.monotonic() - start < 5.0


def test_complexity_error_is_value_error() -> None:
    # Subclassing ValueError lets it flow through the existing CQL error handling
    # (sidecar → HTTP 400, CLI → error envelope).
    assert issubclass(CqlComplexityError, ValueError)


def test_normal_cql_still_matches() -> None:
    specs = _compile_specs(parse_cql_query('[word="x"]'))
    matches = _find_matches(_tokens(5), specs)
    assert len(matches) == 5
