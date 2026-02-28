#!/usr/bin/env python3
"""Aggregate sidecar benchmark JSON files into a Markdown summary."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = REPO_ROOT / "bench" / "results"
DEFAULT_OUTPUT = REPO_ROOT / "docs" / "BENCHMARKS.md"
REQUIRED_OS = {"macos", "linux", "windows"}


def _safe_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _target_os_arch(target_triple: str | None, fallback_os: str = "unknown", fallback_arch: str = "unknown") -> tuple[str, str]:
    if not target_triple:
        return fallback_os, fallback_arch
    parts = target_triple.split("-")
    arch = parts[0] if parts else fallback_arch
    triple = target_triple
    if "apple-darwin" in triple:
        return "macos", arch
    if "windows" in triple:
        return "windows", arch
    if "linux" in triple:
        return "linux", arch
    return fallback_os, arch


def _record_from_result_entry(payload: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    target = entry.get("target", {})
    if not isinstance(target, dict):
        target = {}
    triple = target.get("target_triple")
    triple_s = str(triple) if isinstance(triple, str) else None
    os_label, arch = _target_os_arch(triple_s)
    artifact_size = int(target.get("artifact_size_bytes", 0))
    persistent = entry.get("persistent", {})
    if not isinstance(persistent, dict):
        persistent = {}
    ttr = persistent.get("time_to_ready_ms", {})
    qlat = persistent.get("query_latency_ms", {})
    return {
        "created_at": payload.get("created_at"),
        "source_file": payload.get("_source_file"),
        "os": os_label,
        "arch": arch,
        "target_triple": triple_s,
        "format": target.get("format"),
        "version": target.get("version"),
        "size_bytes": artifact_size,
        "size_mb": round(artifact_size / (1024 * 1024), 3),
        "time_to_ready_ms_mean": _safe_float(ttr.get("mean_ms")) if isinstance(ttr, dict) else None,
        "query_ms_mean": _safe_float(qlat.get("mean_ms")) if isinstance(qlat, dict) else None,
        "mode": entry.get("mode"),
        "runs": payload.get("runs"),
        "query_runs": payload.get("query_runs"),
        "notes": "",
    }


def _normalize_payload(path: Path, payload: dict[str, Any]) -> list[dict[str, Any]]:
    payload["_source_file"] = str(path)
    records: list[dict[str, Any]] = []

    if isinstance(payload.get("results"), list):
        for entry in payload["results"]:
            if isinstance(entry, dict):
                records.append(_record_from_result_entry(payload, entry))
        return records

    if {"os", "arch", "format", "size_bytes"}.issubset(payload.keys()):
        rec = {
            "created_at": payload.get("created_at"),
            "source_file": str(path),
            "os": payload.get("os"),
            "arch": payload.get("arch"),
            "target_triple": payload.get("target_triple"),
            "format": payload.get("format"),
            "version": payload.get("version"),
            "size_bytes": int(payload.get("size_bytes", 0)),
            "size_mb": round(int(payload.get("size_bytes", 0)) / (1024 * 1024), 3),
            "time_to_ready_ms_mean": _safe_float(payload.get("time_to_ready_ms_mean")),
            "query_ms_mean": _safe_float(payload.get("query_ms_mean")),
            "mode": payload.get("mode"),
            "runs": payload.get("runs"),
            "query_runs": payload.get("query_runs"),
            "notes": "",
        }
        records.append(rec)
        return records

    return records


def _load_records(input_dir: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in sorted(input_dir.rglob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        records.extend(_normalize_payload(path, payload))
    return records


def _created_at_sort_key(value: Any) -> str:
    if isinstance(value, str):
        return value
    return ""


def _latest_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[tuple[str, str, str], dict[str, Any]] = {}
    for rec in records:
        key = (str(rec.get("os")), str(rec.get("arch")), str(rec.get("format")))
        existing = best.get(key)
        if existing is None or _created_at_sort_key(rec.get("created_at")) >= _created_at_sort_key(existing.get("created_at")):
            best[key] = rec
    return sorted(best.values(), key=lambda r: (str(r.get("os")), str(r.get("arch")), str(r.get("format"))))


def _fmt_num(value: Any, digits: int = 2) -> str:
    f = _safe_float(value)
    if f is None:
        return "n/a"
    return f"{f:.{digits}f}"


def _decide_for_os(rows: list[dict[str, Any]]) -> tuple[str, str]:
    onefile = next((r for r in rows if r.get("format") == "onefile"), None)
    onedir = next((r for r in rows if r.get("format") == "onedir"), None)
    if onefile is None or onedir is None:
        return "insufficient", "missing onefile or onedir measurement"

    ttr_of = _safe_float(onefile.get("time_to_ready_ms_mean"))
    ttr_od = _safe_float(onedir.get("time_to_ready_ms_mean"))
    q_of = _safe_float(onefile.get("query_ms_mean"))
    q_od = _safe_float(onedir.get("query_ms_mean"))
    size_of = _safe_float(onefile.get("size_bytes"))
    size_od = _safe_float(onedir.get("size_bytes"))
    if None in {ttr_of, ttr_od, q_of, q_od, size_of, size_od}:
        return "insufficient", "missing metrics fields"

    # Heuristic: prefer onedir if startup improves by >=20%, query regression <=15%,
    # and artifact size growth <=3x.
    startup_gain = (ttr_of - ttr_od) / ttr_of if ttr_of and ttr_of > 0 else 0.0
    query_regression = (q_od - q_of) / q_of if q_of and q_of > 0 else 0.0
    size_growth = size_od / size_of if size_of and size_of > 0 else 999.0

    if startup_gain >= 0.20 and query_regression <= 0.15 and size_growth <= 3.0:
        note = (
            f"startup_gain={startup_gain*100:.1f}% "
            f"query_regression={query_regression*100:.1f}% "
            f"size_growth={size_growth:.2f}x"
        )
        return "onedir", note

    note = (
        f"startup_gain={startup_gain*100:.1f}% "
        f"query_regression={query_regression*100:.1f}% "
        f"size_growth={size_growth:.2f}x"
    )
    return "onefile", note


def _recommendation(latest: list[dict[str, Any]]) -> dict[str, Any]:
    by_os: dict[str, list[dict[str, Any]]] = {}
    for rec in latest:
        os_label = str(rec.get("os"))
        by_os.setdefault(os_label, []).append(rec)

    coverage = {k: {str(r.get("format")) for r in rows} for k, rows in by_os.items()}
    missing_os = sorted(os_name for os_name in REQUIRED_OS if os_name not in coverage)
    missing_formats = sorted(
        os_name for os_name, fmts in coverage.items() if not {"onefile", "onedir"}.issubset(fmts)
    )

    if missing_os or missing_formats:
        return {
            "status": "insufficient_data",
            "reason": "multi-OS benchmark dataset incomplete",
            "missing_os": missing_os,
            "missing_formats": missing_formats,
            "per_os": {},
        }

    per_os: dict[str, dict[str, str]] = {}
    for os_name in sorted(REQUIRED_OS):
        choice, note = _decide_for_os(by_os.get(os_name, []))
        if choice == "insufficient":
            return {
                "status": "insufficient_data",
                "reason": f"incomplete metrics for {os_name}",
                "missing_os": [],
                "missing_formats": [os_name],
                "per_os": per_os,
            }
        per_os[os_name] = {"format": choice, "note": note}

    chosen = {v["format"] for v in per_os.values()}
    if len(chosen) == 1:
        return {
            "status": "decided",
            "scope": "global",
            "default_format": next(iter(chosen)),
            "per_os": per_os,
        }

    return {
        "status": "decided",
        "scope": "per_os",
        "default_format": None,
        "per_os": per_os,
    }


def _markdown(records: list[dict[str, Any]], latest: list[dict[str, Any]], recommendation: dict[str, Any]) -> str:
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines: list[str] = []
    lines.append("# Sidecar Benchmarks")
    lines.append("")
    lines.append(f"Generated at: {now}")
    lines.append("")
    lines.append("## Latest measurements per OS/arch/format")
    lines.append("")
    lines.append("| OS | Arch | Format | Size MB | Time-to-ready ms (mean) | Query ms (mean) | Version | Source |")
    lines.append("|----|------|--------|--------:|-------------------------:|----------------:|---------|--------|")
    for rec in latest:
        lines.append(
            "| {os} | {arch} | {fmt} | {size} | {ttr} | {q} | {ver} | `{src}` |".format(
                os=rec.get("os"),
                arch=rec.get("arch"),
                fmt=rec.get("format"),
                size=_fmt_num(rec.get("size_mb"), 3),
                ttr=_fmt_num(rec.get("time_to_ready_ms_mean"), 2),
                q=_fmt_num(rec.get("query_ms_mean"), 3),
                ver=rec.get("version") or "n/a",
                src=Path(str(rec.get("source_file"))).name,
            )
        )
    lines.append("")
    lines.append("## Recommendation")
    lines.append("")
    status = recommendation.get("status")
    if status == "insufficient_data":
        lines.append("- Status: **insufficient data**")
        lines.append(f"- Reason: {recommendation.get('reason')}")
        missing_os = recommendation.get("missing_os") or []
        missing_formats = recommendation.get("missing_formats") or []
        lines.append(f"- Missing OS: {', '.join(missing_os) if missing_os else 'none'}")
        lines.append(f"- Missing format pairs: {', '.join(missing_formats) if missing_formats else 'none'}")
        lines.append("- Decision: ADR remains **Pending** until full matrix data exists.")
    else:
        scope = recommendation.get("scope")
        lines.append("- Status: **decided**")
        lines.append(f"- Scope: `{scope}`")
        default_fmt = recommendation.get("default_format")
        if default_fmt:
            lines.append(f"- Default format: `{default_fmt}`")
        lines.append("- Per-OS choice:")
        for os_name, info in sorted((recommendation.get("per_os") or {}).items()):
            lines.append(f"  - `{os_name}` -> `{info.get('format')}` ({info.get('note')})")
    lines.append("")
    lines.append("## Raw dataset")
    lines.append("")
    lines.append(f"- Parsed records: {len(records)}")
    lines.append(f"- Latest records used for recommendation: {len(latest)}")
    lines.append("")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aggregate AGRAFES sidecar bench JSON results.")
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT),
        help="Input directory containing benchmark JSON files (default: bench/results).",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Output Markdown path (default: docs/BENCHMARKS.md).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_dir = Path(args.input)
    if not input_dir.is_absolute():
        input_dir = REPO_ROOT / input_dir
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = REPO_ROOT / output_path

    records = _load_records(input_dir)
    latest = _latest_records(records)
    recommendation = _recommendation(latest)
    md = _markdown(records, latest, recommendation)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(md, encoding="utf-8")
    print(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
