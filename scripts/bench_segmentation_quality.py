#!/usr/bin/env python3
"""Run segmentation quality fixtures for available packs.

Writes a JSON report and (optionally) a Markdown summary.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
import platform
import sys
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from multicorpus_engine.segmentation_quality import (  # noqa: E402
    build_markdown_report,
    evaluate_cases,
    load_cases,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Segmentation quality benchmark (fixtures FR/EN).")
    parser.add_argument(
        "--fixtures",
        type=Path,
        default=Path("bench/fixtures/segmentation_quality_cases.json"),
        help="Path to JSON fixture file.",
    )
    parser.add_argument(
        "--packs",
        default="auto,default,fr_strict,en_strict",
        help="Comma-separated pack list.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="JSON output path (default: bench/results/segmentation_quality_YYYYMMDD.json).",
    )
    parser.add_argument(
        "--markdown",
        type=Path,
        default=Path("docs/SEGMENTATION_BENCHMARKS.md"),
        help="Markdown output path (use '-' to skip writing markdown).",
    )
    parser.add_argument(
        "--thresholds",
        type=Path,
        default=Path("bench/fixtures/segmentation_quality_thresholds.json"),
        help="JSON thresholds path (use '-' to skip threshold checks).",
    )
    return parser.parse_args()


def _pack_list(raw: str) -> list[str]:
    packs = [part.strip() for part in raw.split(",") if part.strip()]
    if not packs:
        raise ValueError("No packs provided")
    return packs


def _default_output_path() -> Path:
    stamp = datetime.now().strftime("%Y%m%d")
    return Path("bench/results") / f"segmentation_quality_{stamp}.json"


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _print_summary(report: dict[str, object], packs: Iterable[str]) -> None:
    summary = report["summary_by_pack"]
    assert isinstance(summary, dict)
    print("Pack summary:")
    for pack in packs:
        metrics = summary[str(pack)]
        assert isinstance(metrics, dict)
        print(
            f"  - {pack:>10} | "
            f"exact={float(metrics['exact_match_rate']):.3f} "
            f"p={float(metrics['precision_mean']):.3f} "
            f"r={float(metrics['recall_mean']):.3f} "
            f"f1={float(metrics['f1_mean']):.3f}"
        )


def _load_thresholds(path: Path) -> dict[str, dict[str, dict[str, float]]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Thresholds JSON must be an object")
    out: dict[str, dict[str, dict[str, float]]] = {}
    for pack, langs in raw.items():
        if not isinstance(langs, dict):
            raise ValueError(f"Thresholds for pack {pack!r} must be an object")
        lang_map: dict[str, dict[str, float]] = {}
        for lang, metrics in langs.items():
            if not isinstance(metrics, dict):
                raise ValueError(f"Threshold metrics for {pack}/{lang} must be an object")
            f1_min = float(metrics.get("f1_min", 0.0))
            exact_min = float(metrics.get("exact_match_min", 0.0))
            lang_map[str(lang)] = {"f1_min": f1_min, "exact_match_min": exact_min}
        out[str(pack)] = lang_map
    return out


def _evaluate_thresholds(
    report: dict[str, object],
    thresholds: dict[str, dict[str, dict[str, float]]],
) -> list[dict[str, object]]:
    checks: list[dict[str, object]] = []
    by_pack_lang = report["summary_by_pack_lang"]
    assert isinstance(by_pack_lang, dict)

    for pack, lang_cfg in thresholds.items():
        summary_lang = by_pack_lang.get(pack)
        if not isinstance(summary_lang, dict):
            checks.append(
                {
                    "pack": pack,
                    "lang": "*",
                    "status": "missing_pack",
                    "ok": False,
                }
            )
            continue
        for lang, metrics in lang_cfg.items():
            got = summary_lang.get(lang)
            if not isinstance(got, dict):
                checks.append(
                    {
                        "pack": pack,
                        "lang": lang,
                        "status": "missing_lang",
                        "ok": False,
                    }
                )
                continue

            f1 = float(got.get("f1_mean", 0.0))
            exact = float(got.get("exact_match_rate", 0.0))
            f1_min = float(metrics.get("f1_min", 0.0))
            exact_min = float(metrics.get("exact_match_min", 0.0))
            ok = f1 >= f1_min and exact >= exact_min
            checks.append(
                {
                    "pack": pack,
                    "lang": lang,
                    "f1": f1,
                    "exact_match": exact,
                    "f1_min": f1_min,
                    "exact_match_min": exact_min,
                    "ok": ok,
                    "status": "ok" if ok else "failed",
                }
            )
    return checks


def _threshold_markdown(checks: list[dict[str, object]]) -> str:
    lines = [
        "## Threshold checks",
        "",
        "| Pack | Lang | F1 | F1 target | Exact | Exact target | Status |",
        "|------|------|---:|----------:|------:|-------------:|--------|",
    ]
    for row in checks:
        status = "OK" if bool(row.get("ok")) else f"FAIL ({row.get('status')})"
        if "f1" in row:
            lines.append(
                "| "
                + f"{row['pack']} | {row['lang']} | "
                + f"{float(row['f1']):.3f} | {float(row['f1_min']):.3f} | "
                + f"{float(row['exact_match']):.3f} | {float(row['exact_match_min']):.3f} | "
                + f"{status} |"
            )
        else:
            lines.append(f"| {row['pack']} | {row['lang']} | — | — | — | — | {status} |")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = _parse_args()
    packs = _pack_list(args.packs)
    fixtures_path = args.fixtures
    output_path = args.output or _default_output_path()
    markdown_path = args.markdown
    thresholds_path = args.thresholds

    cases = load_cases(fixtures_path)
    result = evaluate_cases(cases, packs)
    threshold_checks: list[dict[str, object]] = []
    thresholds_cfg: dict[str, dict[str, dict[str, float]]] | None = None
    if str(thresholds_path) != "-" and thresholds_path.exists():
        thresholds_cfg = _load_thresholds(thresholds_path)
        threshold_checks = _evaluate_thresholds(result, thresholds_cfg)

    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    payload = {
        "generated_at": generated_at,
        "dataset_path": str(fixtures_path),
        "thresholds_path": str(thresholds_path) if str(thresholds_path) != "-" else None,
        "thresholds": thresholds_cfg,
        "threshold_checks": threshold_checks,
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        **result,
    }

    _ensure_parent(output_path)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote JSON report: {output_path}")

    if str(markdown_path) != "-":
        markdown = f"Generated at: {generated_at}\n\n" + build_markdown_report(result)
        if threshold_checks:
            markdown += "\n" + _threshold_markdown(threshold_checks)
        _ensure_parent(markdown_path)
        markdown_path.write_text(markdown, encoding="utf-8")
        print(f"Wrote Markdown report: {markdown_path}")

    _print_summary(result, packs)
    if threshold_checks:
        failed = [row for row in threshold_checks if not bool(row.get("ok"))]
        if failed:
            print(f"Threshold checks: {len(failed)} failure(s)")
            for row in failed:
                print(f"  - {row.get('pack')}/{row.get('lang')} -> {row.get('status')}")
        else:
            print("Threshold checks: all passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
