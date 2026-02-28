#!/usr/bin/env python3
"""Benchmark harness for import/index/query pipeline.

Creates synthetic corpora, runs:
1) import
2) FTS rebuild
3) query

Outputs per-run samples + aggregated metrics as JSON and CSV.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any


_REPO_ROOT = Path(__file__).resolve().parent.parent
_SRC = _REPO_ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from multicorpus_engine.db.connection import get_connection
from multicorpus_engine.db.migrations import apply_migrations
from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
from multicorpus_engine.importers.txt import import_txt_numbered_lines
from multicorpus_engine.indexer import build_index
from multicorpus_engine.query import run_query


@dataclass
class Sample:
    mode: str
    size: int
    repeat: int
    db_path: str
    source_path: str
    generate_s: float
    import_s: float
    index_s: float
    query_s: float
    units_line: int
    units_total: int
    hits: int


def _parse_sizes(value: str) -> list[int]:
    parts = [p.strip() for p in value.split(",") if p.strip()]
    if not parts:
        raise argparse.ArgumentTypeError("sizes cannot be empty")
    sizes: list[int] = []
    for part in parts:
        try:
            n = int(part)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(f"invalid size: {part!r}") from exc
        if n <= 0:
            raise argparse.ArgumentTypeError("sizes must be > 0")
        sizes.append(n)
    return sizes


def _now_tag() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _build_line(i: int, query_token: str, query_every: int) -> str:
    base = f"Ligne synthétique {i} alpha{i % 97} beta{i % 41} gamma{i % 13}"
    if i % query_every == 0:
        base += f" {query_token}"
    return base


def _generate_txt(path: Path, size: int, query_token: str, query_every: int) -> None:
    lines = [f"[{i}] {_build_line(i, query_token, query_every)}" for i in range(1, size + 1)]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _generate_docx(path: Path, size: int, query_token: str, query_every: int) -> None:
    try:
        import docx  # python-docx
    except ImportError as exc:
        raise RuntimeError("python-docx is required for docx benchmarks") from exc

    document = docx.Document()
    for i in range(1, size + 1):
        document.add_paragraph(f"[{i}] {_build_line(i, query_token, query_every)}")
    document.save(str(path))


def _run_one(
    out_dir: Path,
    mode: str,
    size: int,
    repeat: int,
    language: str,
    query: str,
    query_every: int,
) -> Sample:
    case_dir = out_dir / f"{mode}-n{size}-r{repeat}"
    case_dir.mkdir(parents=True, exist_ok=True)

    db_path = case_dir / "corpus.db"
    source_path = case_dir / ("source.txt" if mode == "txt_numbered_lines" else "source.docx")

    t0 = perf_counter()
    if mode == "txt_numbered_lines":
        _generate_txt(source_path, size=size, query_token=query, query_every=query_every)
    elif mode == "docx_numbered_lines":
        _generate_docx(source_path, size=size, query_token=query, query_every=query_every)
    else:
        raise ValueError(f"unsupported mode: {mode}")
    generate_s = perf_counter() - t0

    conn = get_connection(db_path)
    apply_migrations(conn)

    t1 = perf_counter()
    if mode == "txt_numbered_lines":
        report = import_txt_numbered_lines(
            conn=conn,
            path=source_path,
            language=language,
            title=f"{mode}_{size}",
        )
    else:
        report = import_docx_numbered_lines(
            conn=conn,
            path=source_path,
            language=language,
            title=f"{mode}_{size}",
        )
    import_s = perf_counter() - t1

    t2 = perf_counter()
    build_index(conn)
    index_s = perf_counter() - t2

    t3 = perf_counter()
    hits = run_query(conn, q=query, mode="segment")
    query_s = perf_counter() - t3

    conn.close()

    return Sample(
        mode=mode,
        size=size,
        repeat=repeat,
        db_path=str(db_path),
        source_path=str(source_path),
        generate_s=generate_s,
        import_s=import_s,
        index_s=index_s,
        query_s=query_s,
        units_line=report.units_line,
        units_total=report.units_total,
        hits=len(hits),
    )


def _aggregate(samples: list[Sample]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, int], list[Sample]] = defaultdict(list)
    for sample in samples:
        grouped[(sample.mode, sample.size)].append(sample)

    rows: list[dict[str, Any]] = []
    for (mode, size), group in sorted(grouped.items()):
        import_vals = [s.import_s for s in group]
        index_vals = [s.index_s for s in group]
        query_vals = [s.query_s for s in group]
        hits_vals = [s.hits for s in group]

        import_avg = statistics.mean(import_vals)
        index_avg = statistics.mean(index_vals)
        query_avg = statistics.mean(query_vals)

        rows.append(
            {
                "mode": mode,
                "size": size,
                "repeats": len(group),
                "import_avg_s": round(import_avg, 6),
                "import_min_s": round(min(import_vals), 6),
                "import_max_s": round(max(import_vals), 6),
                "index_avg_s": round(index_avg, 6),
                "index_min_s": round(min(index_vals), 6),
                "index_max_s": round(max(index_vals), 6),
                "query_avg_s": round(query_avg, 6),
                "query_min_s": round(min(query_vals), 6),
                "query_max_s": round(max(query_vals), 6),
                "hits_avg": round(statistics.mean(hits_vals), 2),
                "import_units_per_s": round(size / import_avg, 2) if import_avg > 0 else None,
                "index_units_per_s": round(size / index_avg, 2) if index_avg > 0 else None,
            }
        )
    return rows


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return

    fields = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _print_summary(aggregates: list[dict[str, Any]]) -> None:
    if not aggregates:
        print("No benchmark results.")
        return

    print("mode,size,repeats,import_avg_s,index_avg_s,query_avg_ms,import_u/s,index_u/s")
    for row in aggregates:
        query_ms = round(float(row["query_avg_s"]) * 1000.0, 3)
        print(
            ",".join(
                [
                    str(row["mode"]),
                    str(row["size"]),
                    str(row["repeats"]),
                    str(row["import_avg_s"]),
                    str(row["index_avg_s"]),
                    str(query_ms),
                    str(row["import_units_per_s"]),
                    str(row["index_units_per_s"]),
                ]
            )
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_bench.py",
        description="Benchmark import/index/query on synthetic corpus sizes.",
    )
    parser.add_argument(
        "--mode",
        default="txt_numbered_lines",
        choices=["txt_numbered_lines", "docx_numbered_lines"],
        help="Importer mode to benchmark.",
    )
    parser.add_argument(
        "--sizes",
        type=_parse_sizes,
        default=_parse_sizes("1000,5000,10000"),
        help="Comma-separated corpus sizes, e.g. 1000,5000,10000",
    )
    parser.add_argument(
        "--repeats",
        type=int,
        default=3,
        help="Number of runs per size.",
    )
    parser.add_argument(
        "--query",
        default="needle",
        help="Query token to inject and benchmark.",
    )
    parser.add_argument(
        "--query-every",
        type=int,
        default=10,
        help="Inject query token every N lines.",
    )
    parser.add_argument(
        "--language",
        default="fr",
        help="Language code used at import.",
    )
    parser.add_argument(
        "--out-dir",
        default=str(_REPO_ROOT / "bench" / "runs" / _now_tag()),
        help="Output directory for DB/source artifacts and reports.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.repeats <= 0:
        print("error: --repeats must be > 0", file=sys.stderr)
        return 2
    if args.query_every <= 0:
        print("error: --query-every must be > 0", file=sys.stderr)
        return 2

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    samples: list[Sample] = []
    for size in args.sizes:
        for repeat in range(1, args.repeats + 1):
            sample = _run_one(
                out_dir=out_dir,
                mode=args.mode,
                size=size,
                repeat=repeat,
                language=args.language,
                query=args.query,
                query_every=args.query_every,
            )
            samples.append(sample)

    sample_rows = [asdict(s) for s in samples]
    aggregates = _aggregate(samples)

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "config": {
            "mode": args.mode,
            "sizes": args.sizes,
            "repeats": args.repeats,
            "query": args.query,
            "query_every": args.query_every,
            "language": args.language,
            "out_dir": str(out_dir),
        },
        "samples": sample_rows,
        "aggregates": aggregates,
    }

    json_path = out_dir / "report.json"
    samples_csv = out_dir / "samples.csv"
    agg_csv = out_dir / "aggregates.csv"

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    _write_csv(samples_csv, sample_rows)
    _write_csv(agg_csv, aggregates)

    _print_summary(aggregates)
    print(f"\nreport_json={json_path}")
    print(f"samples_csv={samples_csv}")
    print(f"aggregates_csv={agg_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

