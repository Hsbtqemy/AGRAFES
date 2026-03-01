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


def main() -> int:
    args = _parse_args()
    packs = _pack_list(args.packs)
    fixtures_path = args.fixtures
    output_path = args.output or _default_output_path()
    markdown_path = args.markdown

    cases = load_cases(fixtures_path)
    result = evaluate_cases(cases, packs)
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    payload = {
        "generated_at": generated_at,
        "dataset_path": str(fixtures_path),
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        **result,
    }

    _ensure_parent(output_path)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote JSON report: {output_path}")

    if str(markdown_path) != "-":
        markdown = (
            f"Generated at: {generated_at}\n\n"
            + build_markdown_report(result)
        )
        _ensure_parent(markdown_path)
        markdown_path.write_text(markdown, encoding="utf-8")
        print(f"Wrote Markdown report: {markdown_path}")

    _print_summary(result, packs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
