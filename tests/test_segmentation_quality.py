"""Tests for segmentation quality fixture scoring helpers."""

from __future__ import annotations

import json
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
    assert len(cases) >= 16


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


def test_en_strict_beats_default_on_en_abbrev_cases() -> None:
    cases = load_cases(Path("bench/fixtures/segmentation_quality_cases.json"))
    subset = [
        c
        for c in cases
        if c.case_id in {"en_approx_anchor", "en_dept_anchor", "en_misc_anchor", "en_mixed_lang_anchor"}
    ]
    report = evaluate_cases(subset, ["default", "en_strict", "auto"])
    by_pack = report["summary_by_pack"]
    assert isinstance(by_pack, dict)
    default_f1 = float(by_pack["default"]["f1_mean"])  # type: ignore[index]
    strict_f1 = float(by_pack["en_strict"]["f1_mean"])  # type: ignore[index]
    auto_f1 = float(by_pack["auto"]["f1_mean"])  # type: ignore[index]
    assert strict_f1 > default_f1
    # auto resolves to en_strict for en* languages, so scores should match.
    assert auto_f1 == strict_f1


def test_auto_pack_meets_language_thresholds() -> None:
    cases = load_cases(Path("bench/fixtures/segmentation_quality_cases.json"))
    thresholds = json.loads(
        Path("bench/fixtures/segmentation_quality_thresholds.json").read_text(encoding="utf-8")
    )
    report = evaluate_cases(cases, ["auto"])
    by_pack_lang = report["summary_by_pack_lang"]
    assert isinstance(by_pack_lang, dict)
    auto_by_lang = by_pack_lang["auto"]  # type: ignore[index]
    for lang, expected in thresholds["auto"].items():
        summary = auto_by_lang[lang]
        f1 = float(summary["f1_mean"])
        exact = float(summary["exact_match_rate"])
        assert f1 >= float(expected["f1_min"]), (
            f"auto/{lang} f1 too low: {f1:.3f} < {float(expected['f1_min']):.3f}"
        )
        assert exact >= float(expected["exact_match_min"]), (
            f"auto/{lang} exact too low: {exact:.3f} < {float(expected['exact_match_min']):.3f}"
        )
