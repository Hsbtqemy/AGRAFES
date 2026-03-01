"""Unit tests for segmentation pack resolution and behavior."""

from __future__ import annotations

import pytest

from multicorpus_engine.segmenter import resolve_segment_pack, segment_text


def test_resolve_segment_pack_auto_by_language() -> None:
    assert resolve_segment_pack("auto", "fr") == "fr_strict"
    assert resolve_segment_pack("auto", "en") == "en_strict"
    assert resolve_segment_pack("auto", "de") == "default"
    assert resolve_segment_pack(None, "fr") == "fr_strict"


def test_resolve_segment_pack_rejects_unknown_value() -> None:
    with pytest.raises(ValueError):
        resolve_segment_pack("unknown-pack", "fr")


def test_fr_strict_pack_protects_extra_abbreviations() -> None:
    text = "Voir chap. Introduction. Suite."
    default_out = segment_text(text, lang="fr", pack="default")
    strict_out = segment_text(text, lang="fr", pack="fr_strict")

    assert default_out == ["Voir chap.", "Introduction.", "Suite."]
    assert strict_out == ["Voir chap. Introduction.", "Suite."]


def test_en_strict_pack_handles_uppercase_abbreviations() -> None:
    text = "Approx. Values are listed. End."
    default_out = segment_text(text, lang="en", pack="default")
    strict_out = segment_text(text, lang="en", pack="en_strict")

    assert default_out == ["Approx.", "Values are listed.", "End."]
    assert strict_out == ["Approx. Values are listed.", "End."]
