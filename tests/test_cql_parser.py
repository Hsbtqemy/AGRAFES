"""Tests for minimal CQL parser (Sprint C)."""

from __future__ import annotations

import pytest


def test_parse_simple_sequence() -> None:
    from multicorpus_engine.cql_parser import parse_cql

    specs = parse_cql('[pos = "DET"][lemma = "liv.*" %c]')
    assert len(specs) == 2
    assert len(specs[0].predicates) == 1
    assert specs[0].predicates[0].normalized_attr == "upos"
    assert specs[1].predicates[0].normalized_attr == "lemma"
    assert specs[1].predicates[0].case_insensitive is True


def test_parse_predicate_and_operator() -> None:
    from multicorpus_engine.cql_parser import parse_cql

    specs = parse_cql('[pos = "NOUN" & lemma = "liv.*" %c]')
    assert len(specs) == 1
    preds = specs[0].predicates
    assert len(preds) == 2
    attrs = {p.normalized_attr for p in preds}
    assert attrs == {"upos", "lemma"}


def test_parse_rejects_unclosed_clause() -> None:
    from multicorpus_engine.cql_parser import parse_cql

    with pytest.raises(ValueError, match="Unclosed token clause"):
        parse_cql('[lemma = "chat"')


def test_parse_rejects_invalid_predicate() -> None:
    from multicorpus_engine.cql_parser import parse_cql

    with pytest.raises(ValueError, match="Invalid predicate syntax"):
        parse_cql('[foo = "bar"]')


def test_parse_quantifier_and_wildcard() -> None:
    from multicorpus_engine.cql_parser import parse_cql

    specs = parse_cql('[]{0,2}[lemma = "liv.*"]{1,3}')
    assert len(specs) == 2
    assert specs[0].wildcard is True
    assert specs[0].min_repeat == 0
    assert specs[0].max_repeat == 2
    assert specs[1].wildcard is False
    assert specs[1].min_repeat == 1
    assert specs[1].max_repeat == 3


def test_parse_within_sentence_constraint() -> None:
    from multicorpus_engine.cql_parser import parse_cql_query

    q = parse_cql_query('[pos = "DET"][lemma = "liv.*"] within s')
    assert q.within_sentence is True
    assert len(q.token_specs) == 2


def test_parse_within_sentence_constraint_accepts_terminal_semicolon() -> None:
    from multicorpus_engine.cql_parser import parse_cql_query

    q = parse_cql_query('[pos = "DET"][lemma = "liv.*"] within s;')
    assert q.within_sentence is True
    assert len(q.token_specs) == 2


def test_parse_rejects_invalid_quantifier_bounds() -> None:
    from multicorpus_engine.cql_parser import parse_cql

    with pytest.raises(ValueError, match="max < min"):
        parse_cql('[lemma = "liv.*"]{3,1}')


def test_parse_xpos_and_feats_attributes() -> None:
    from multicorpus_engine.cql_parser import parse_cql

    specs = parse_cql('[xpos = "VBC"][feats = ".*Tense=Past.*"]')
    assert len(specs) == 2
    assert specs[0].predicates[0].attr == "xpos"
    assert specs[1].predicates[0].attr == "feats"


def test_parse_rejects_unknown_attribute() -> None:
    from multicorpus_engine.cql_parser import parse_cql

    with pytest.raises(ValueError, match="Invalid predicate syntax"):
        parse_cql('[form = "chat"]')
