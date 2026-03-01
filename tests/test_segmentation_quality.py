"""Tests for segmentation quality fixture scoring helpers."""

from __future__ import annotations

from pathlib import Path

from multicorpus_engine.segmentation_quality import (
    boundary_positions,
    evaluate_cases,
    load_cases,
    score_case,
)


def test_boundary_positions_uses_canonical_spacing() -> None:
    boundaries = boundary_positions(["A.", "B.", "C."])
    # "A. B. C." -> boundaries after "A." and "A. B."
    assert boundaries == {2, 5}


def test_score_case_detects_extra_boundary() -> None:
    gold = ["Voir chap. Introduction.", "Suite."]
    pred = ["Voir chap.", "Introduction.", "Suite."]
    scored = score_case(gold, pred)
    assert scored["exact_match"] is False
    assert scored["f1"] < 1.0
    assert scored["precision"] < 1.0


def test_fixture_file_loads_fr_and_en_cases() -> None:
    cases = load_cases(Path("bench/fixtures/segmentation_quality_cases.json"))
    langs = {c.lang for c in cases}
    assert "fr" in langs
    assert "en" in langs
    assert len(cases) >= 8


def test_fr_strict_beats_default_on_fr_abbrev_cases() -> None:
    cases = load_cases(Path("bench/fixtures/segmentation_quality_cases.json"))
    subset = [c for c in cases if c.case_id in {"fr_chap_anchor", "fr_etc_anchor", "fr_env_anchor"}]
    report = evaluate_cases(subset, ["default", "fr_strict", "auto"])
    by_pack = report["summary_by_pack"]
    assert isinstance(by_pack, dict)
    default_f1 = float(by_pack["default"]["f1_mean"])  # type: ignore[index]
    strict_f1 = float(by_pack["fr_strict"]["f1_mean"])  # type: ignore[index]
    auto_f1 = float(by_pack["auto"]["f1_mean"])  # type: ignore[index]
    assert strict_f1 > default_f1
    # auto resolves to fr_strict for fr* languages, so scores should match.
    assert auto_f1 == strict_f1
