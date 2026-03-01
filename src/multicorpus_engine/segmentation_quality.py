"""Segmentation quality fixture scoring helpers.

This module provides deterministic utilities to score sentence segmentation
packs against a small JSON fixture set.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from statistics import mean
from typing import Iterable

from multicorpus_engine.segmenter import resolve_segment_pack, segment_text


@dataclass(frozen=True)
class SegmentationCase:
    """One segmentation evaluation case."""

    case_id: str
    lang: str
    text: str
    gold_sentences: tuple[str, ...]
    note: str = ""


def _normalize_sentences(sentences: Iterable[str]) -> tuple[str, ...]:
    return tuple(part.strip() for part in sentences if part and part.strip())


def boundary_positions(sentences: Iterable[str]) -> set[int]:
    """Return sentence boundary positions on a canonical joined string."""
    normalized = _normalize_sentences(sentences)
    boundaries: set[int] = set()
    pos = 0
    last = len(normalized) - 1
    for i, sentence in enumerate(normalized):
        pos += len(sentence)
        if i < last:
            boundaries.add(pos)
            pos += 1  # canonical single space between sentences
    return boundaries


def score_case(gold_sentences: Iterable[str], pred_sentences: Iterable[str]) -> dict[str, float | bool | int]:
    """Compute boundary precision/recall/f1 and exact sentence match."""
    gold = _normalize_sentences(gold_sentences)
    pred = _normalize_sentences(pred_sentences)
    gold_b = boundary_positions(gold)
    pred_b = boundary_positions(pred)

    tp = len(gold_b & pred_b)
    pred_count = len(pred_b)
    gold_count = len(gold_b)

    precision = tp / pred_count if pred_count else (1.0 if gold_count == 0 else 0.0)
    recall = tp / gold_count if gold_count else (1.0 if pred_count == 0 else 0.0)
    f1 = 0.0 if (precision + recall) == 0 else 2 * precision * recall / (precision + recall)

    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "exact_match": pred == gold,
        "tp": tp,
        "pred_boundaries": pred_count,
        "gold_boundaries": gold_count,
    }


def load_cases(path: Path) -> list[SegmentationCase]:
    """Load fixture cases from JSON."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("Segmentation fixture must be a list of cases")

    cases: list[SegmentationCase] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Invalid fixture entry (expected object)")
        case_id = str(item.get("case_id", "")).strip()
        lang = str(item.get("lang", "")).strip()
        text = str(item.get("text", ""))
        gold = item.get("gold_sentences")
        if not case_id:
            raise ValueError("Fixture case missing case_id")
        if not lang:
            raise ValueError(f"Fixture case {case_id} missing lang")
        if not isinstance(gold, list) or not gold:
            raise ValueError(f"Fixture case {case_id} must define non-empty gold_sentences")
        cases.append(
            SegmentationCase(
                case_id=case_id,
                lang=lang,
                text=text,
                gold_sentences=_normalize_sentences(str(part) for part in gold),
                note=str(item.get("note", "")),
            )
        )
    return cases


def evaluate_cases(
    cases: list[SegmentationCase],
    packs: Iterable[str],
) -> dict[str, object]:
    """Evaluate segmentation packs on all provided cases."""
    pack_list = [p.strip() for p in packs if p.strip()]
    if not pack_list:
        raise ValueError("At least one pack is required")

    per_case: list[dict[str, object]] = []
    for case in cases:
        for requested_pack in pack_list:
            resolved_pack = resolve_segment_pack(requested_pack, case.lang)
            predicted = segment_text(case.text, lang=case.lang, pack=requested_pack)
            scores = score_case(case.gold_sentences, predicted)
            per_case.append(
                {
                    "case_id": case.case_id,
                    "lang": case.lang,
                    "requested_pack": requested_pack,
                    "resolved_pack": resolved_pack,
                    "exact_match": scores["exact_match"],
                    "precision": scores["precision"],
                    "recall": scores["recall"],
                    "f1": scores["f1"],
                    "pred_sentence_count": len(_normalize_sentences(predicted)),
                    "gold_sentence_count": len(case.gold_sentences),
                    "pred_sentences": list(_normalize_sentences(predicted)),
                    "gold_sentences": list(case.gold_sentences),
                }
            )

    summary_by_pack: dict[str, dict[str, float | int]] = {}
    summary_by_pack_lang: dict[str, dict[str, dict[str, float | int]]] = {}
    for requested_pack in pack_list:
        rows = [row for row in per_case if row["requested_pack"] == requested_pack]
        summary_by_pack[requested_pack] = _aggregate_rows(rows)

        lang_map: dict[str, dict[str, float | int]] = {}
        langs = sorted({str(r["lang"]) for r in rows})
        for lang in langs:
            lang_rows = [row for row in rows if row["lang"] == lang]
            lang_map[lang] = _aggregate_rows(lang_rows)
        summary_by_pack_lang[requested_pack] = lang_map

    return {
        "case_count": len(cases),
        "packs": pack_list,
        "summary_by_pack": summary_by_pack,
        "summary_by_pack_lang": summary_by_pack_lang,
        "per_case": per_case,
    }


def _aggregate_rows(rows: list[dict[str, object]]) -> dict[str, float | int]:
    if not rows:
        return {
            "case_count": 0,
            "exact_match_rate": 0.0,
            "precision_mean": 0.0,
            "recall_mean": 0.0,
            "f1_mean": 0.0,
        }
    return {
        "case_count": len(rows),
        "exact_match_rate": mean(float(bool(row["exact_match"])) for row in rows),
        "precision_mean": mean(float(row["precision"]) for row in rows),
        "recall_mean": mean(float(row["recall"]) for row in rows),
        "f1_mean": mean(float(row["f1"]) for row in rows),
    }


def build_markdown_report(report: dict[str, object]) -> str:
    """Build a compact markdown report from evaluate_cases() output."""
    lines: list[str] = []
    lines.append("# Segmentation Quality Benchmarks")
    lines.append("")
    lines.append(
        f"Dataset cases: **{int(report['case_count'])}** "
        f"(packs: {', '.join(str(p) for p in report['packs'])})"
    )
    lines.append("")
    lines.append("## Global summary")
    lines.append("")
    lines.append("| Pack | Cases | Exact match | Precision | Recall | F1 |")
    lines.append("|------|------:|------------:|----------:|-------:|---:|")
    by_pack = report["summary_by_pack"]
    assert isinstance(by_pack, dict)
    for pack in report["packs"]:
        metrics = by_pack[str(pack)]
        assert isinstance(metrics, dict)
        lines.append(
            "| "
            + f"{pack} | {int(metrics['case_count'])} | "
            + f"{float(metrics['exact_match_rate']):.3f} | "
            + f"{float(metrics['precision_mean']):.3f} | "
            + f"{float(metrics['recall_mean']):.3f} | "
            + f"{float(metrics['f1_mean']):.3f} |"
        )

    lines.append("")
    lines.append("## Per-language summary")
    lines.append("")
    by_pack_lang = report["summary_by_pack_lang"]
    assert isinstance(by_pack_lang, dict)
    for pack in report["packs"]:
        lines.append(f"### {pack}")
        lines.append("")
        lines.append("| Lang | Cases | Exact match | Precision | Recall | F1 |")
        lines.append("|------|------:|------------:|----------:|-------:|---:|")
        lang_map = by_pack_lang[str(pack)]
        assert isinstance(lang_map, dict)
        for lang in sorted(lang_map):
            metrics = lang_map[lang]
            lines.append(
                "| "
                + f"{lang} | {int(metrics['case_count'])} | "
                + f"{float(metrics['exact_match_rate']):.3f} | "
                + f"{float(metrics['precision_mean']):.3f} | "
                + f"{float(metrics['recall_mean']):.3f} | "
                + f"{float(metrics['f1_mean']):.3f} |"
            )
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
