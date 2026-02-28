#!/usr/bin/env python3
"""Benchmark sidecar HTTP vs direct core calls on the same corpus DB."""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter, sleep
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


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
from multicorpus_engine.sidecar import CorpusServer


@dataclass
class OpSample:
    op: str
    repeat: int
    duration_s: float
    hits_or_units: int | None = None


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


def _http_json(method: str, url: str, payload: dict | None = None, timeout_s: float = 30.0) -> dict:
    data: bytes | None = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = Request(url, method=method, data=data, headers=headers)
    try:
        with urlopen(req, timeout=timeout_s) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} on {url}: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error on {url}: {exc}") from exc


def _wait_health(base_url: str, retries: int = 50, delay_s: float = 0.05) -> None:
    for _ in range(retries):
        try:
            data = _http_json("GET", f"{base_url}/health")
            if data.get("status") == "ok":
                return
        except Exception:
            pass
        sleep(delay_s)
    raise RuntimeError("Sidecar /health did not become ready")


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    rank = int(math.ceil((p / 100.0) * len(sorted_vals))) - 1
    rank = max(0, min(rank, len(sorted_vals) - 1))
    return sorted_vals[rank]


def _aggregate(samples: list[OpSample]) -> list[dict[str, Any]]:
    grouped: dict[str, list[OpSample]] = defaultdict(list)
    for sample in samples:
        grouped[sample.op].append(sample)

    rows: list[dict[str, Any]] = []
    for op, group in sorted(grouped.items()):
        vals = [s.duration_s for s in group]
        rows.append(
            {
                "op": op,
                "n": len(vals),
                "avg_s": round(statistics.mean(vals), 6),
                "min_s": round(min(vals), 6),
                "p50_s": round(_percentile(vals, 50), 6),
                "p95_s": round(_percentile(vals, 95), 6),
                "max_s": round(max(vals), 6),
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
    print("op,n,avg_ms,p50_ms,p95_ms,max_ms")
    for row in aggregates:
        print(
            ",".join(
                [
                    str(row["op"]),
                    str(row["n"]),
                    str(round(float(row["avg_s"]) * 1000.0, 3)),
                    str(round(float(row["p50_s"]) * 1000.0, 3)),
                    str(round(float(row["p95_s"]) * 1000.0, 3)),
                    str(round(float(row["max_s"]) * 1000.0, 3)),
                ]
            )
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_sidecar_bench.py",
        description="Compare sidecar HTTP latency with direct Python API calls.",
    )
    parser.add_argument(
        "--mode",
        default="txt_numbered_lines",
        choices=["txt_numbered_lines", "docx_numbered_lines"],
        help="Importer mode for synthetic corpus generation.",
    )
    parser.add_argument("--size", type=int, default=10000, help="Numbered lines to generate.")
    parser.add_argument("--language", default="fr", help="Language for import.")
    parser.add_argument("--query", default="needle", help="Query term to benchmark.")
    parser.add_argument("--query-every", type=int, default=10, help="Inject query term every N lines.")
    parser.add_argument("--query-repeats", type=int, default=30, help="Repeats for query benchmarking.")
    parser.add_argument("--index-repeats", type=int, default=5, help="Repeats for index benchmarking.")
    parser.add_argument("--health-repeats", type=int, default=30, help="Repeats for /health benchmarking.")
    parser.add_argument("--warmup", type=int, default=3, help="Warm-up calls before timing.")
    parser.add_argument(
        "--out-dir",
        default=str(_REPO_ROOT / "bench" / "runs_sidecar" / _now_tag()),
        help="Output directory for artifacts and reports.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.size <= 0:
        print("error: --size must be > 0", file=sys.stderr)
        return 2
    for name in ("query_repeats", "index_repeats", "health_repeats", "warmup", "query_every"):
        if int(getattr(args, name)) <= 0:
            print(f"error: --{name.replace('_', '-')} must be > 0", file=sys.stderr)
            return 2

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    db_path = out_dir / "corpus.db"
    source_path = out_dir / ("source.txt" if args.mode == "txt_numbered_lines" else "source.docx")

    t_gen = perf_counter()
    if args.mode == "txt_numbered_lines":
        _generate_txt(source_path, args.size, args.query, args.query_every)
    else:
        _generate_docx(source_path, args.size, args.query, args.query_every)
    generate_s = perf_counter() - t_gen

    conn = get_connection(db_path)
    apply_migrations(conn)

    t_import = perf_counter()
    if args.mode == "txt_numbered_lines":
        report = import_txt_numbered_lines(
            conn=conn,
            path=source_path,
            language=args.language,
            title=f"{args.mode}_{args.size}",
        )
    else:
        report = import_docx_numbered_lines(
            conn=conn,
            path=source_path,
            language=args.language,
            title=f"{args.mode}_{args.size}",
        )
    import_s = perf_counter() - t_import

    t_boot_index = perf_counter()
    build_index(conn)
    initial_index_s = perf_counter() - t_boot_index

    server = CorpusServer(db_path=db_path, host="127.0.0.1", port=0)
    samples: list[OpSample] = []
    try:
        server.start()
        base_url = f"http://127.0.0.1:{server.actual_port}"
        _wait_health(base_url)

        for _ in range(args.warmup):
            run_query(conn, q=args.query, mode="segment")
            _http_json("POST", f"{base_url}/query", {"q": args.query, "mode": "segment"})
            build_index(conn)
            _http_json("POST", f"{base_url}/index", {})
            _http_json("GET", f"{base_url}/health")

        for i in range(1, args.query_repeats + 1):
            t0 = perf_counter()
            direct_hits = run_query(conn, q=args.query, mode="segment")
            direct_query_s = perf_counter() - t0
            samples.append(
                OpSample(
                    op="direct_query",
                    repeat=i,
                    duration_s=direct_query_s,
                    hits_or_units=len(direct_hits),
                )
            )

            t1 = perf_counter()
            sidecar_query = _http_json(
                "POST",
                f"{base_url}/query",
                {"q": args.query, "mode": "segment"},
            )
            sidecar_query_s = perf_counter() - t1
            samples.append(
                OpSample(
                    op="sidecar_query",
                    repeat=i,
                    duration_s=sidecar_query_s,
                    hits_or_units=int(sidecar_query.get("count", 0)),
                )
            )

        for i in range(1, args.index_repeats + 1):
            t0 = perf_counter()
            direct_units = build_index(conn)
            direct_index_s = perf_counter() - t0
            samples.append(
                OpSample(
                    op="direct_index",
                    repeat=i,
                    duration_s=direct_index_s,
                    hits_or_units=int(direct_units),
                )
            )

            t1 = perf_counter()
            sidecar_index = _http_json("POST", f"{base_url}/index", {})
            sidecar_index_s = perf_counter() - t1
            samples.append(
                OpSample(
                    op="sidecar_index",
                    repeat=i,
                    duration_s=sidecar_index_s,
                    hits_or_units=int(sidecar_index.get("units_indexed", 0)),
                )
            )

        for i in range(1, args.health_repeats + 1):
            t0 = perf_counter()
            _http_json("GET", f"{base_url}/health")
            health_s = perf_counter() - t0
            samples.append(OpSample(op="sidecar_health", repeat=i, duration_s=health_s))

    finally:
        server.shutdown()
        conn.close()

    sample_rows = [asdict(s) for s in samples]
    aggregates = _aggregate(samples)

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "config": {
            "mode": args.mode,
            "size": args.size,
            "query": args.query,
            "query_every": args.query_every,
            "query_repeats": args.query_repeats,
            "index_repeats": args.index_repeats,
            "health_repeats": args.health_repeats,
            "warmup": args.warmup,
            "out_dir": str(out_dir),
        },
        "bootstrap": {
            "generate_s": round(generate_s, 6),
            "import_s": round(import_s, 6),
            "initial_index_s": round(initial_index_s, 6),
            "units_line": report.units_line,
            "units_total": report.units_total,
            "source_path": str(source_path),
            "db_path": str(db_path),
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
