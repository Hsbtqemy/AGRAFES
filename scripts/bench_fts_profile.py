#!/usr/bin/env python3
"""Benchmark FTS rebuild/query performance and emit a tuning profile report."""

from __future__ import annotations

import argparse
import json
import platform
import sqlite3
import sys
import tempfile
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from multicorpus_engine.db.connection import get_connection  # noqa: E402
from multicorpus_engine.db.migrations import apply_migrations  # noqa: E402
from multicorpus_engine.indexer import build_index  # noqa: E402
from multicorpus_engine.query import run_query_page  # noqa: E402


PROFILE_PRAGMAS: dict[str, dict[str, str]] = {
    "baseline": {},
    "throughput": {
        "synchronous": "NORMAL",
        "temp_store": "MEMORY",
        "cache_size": "-65536",
        "mmap_size": "268435456",
        "wal_autocheckpoint": "1000",
    },
}

SYNC_MAP = {0: "OFF", 1: "NORMAL", 2: "FULL", 3: "EXTRA"}
TEMP_STORE_MAP = {0: "DEFAULT", 1: "FILE", 2: "MEMORY"}
DEFAULT_QUERIES = [
    "alpha",
    '"alpha beta"',
    "NEAR(alpha beta, 5)",
    "alignment AND corpus",
    "translation",
]

# Deterministic vocabulary with frequent repeated terms for stable hit rates.
VOCAB = [
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "zeta",
    "theta",
    "lambda",
    "corpus",
    "document",
    "segment",
    "alignment",
    "translation",
    "query",
    "search",
    "context",
    "parallel",
    "token",
    "index",
    "vector",
    "window",
    "sample",
    "benchmark",
    "quality",
    "frequency",
    "analysis",
    "linguistic",
    "run",
    "result",
    "profile",
]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run FTS rebuild/query performance profile benchmarks.")
    parser.add_argument(
        "--sizes",
        default="25000,100000,250000",
        help="Comma-separated unit counts to benchmark.",
    )
    parser.add_argument(
        "--profiles",
        default="baseline,throughput",
        help=f"Comma-separated profile names ({','.join(sorted(PROFILE_PRAGMAS))}).",
    )
    parser.add_argument(
        "--queries",
        default=";".join(DEFAULT_QUERIES),
        help="Semicolon-separated FTS query strings to measure.",
    )
    parser.add_argument(
        "--index-runs",
        type=int,
        default=3,
        help="Rebuild repetitions per dataset/profile (default: 3).",
    )
    parser.add_argument(
        "--query-runs",
        type=int,
        default=8,
        help="Repetitions per query (default: 8).",
    )
    parser.add_argument(
        "--query-limit",
        type=int,
        default=50,
        help="Result limit for measured queries (default: 50).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="JSON output path (default: bench/results/fts_profile_YYYYMMDD.json).",
    )
    parser.add_argument(
        "--markdown",
        type=Path,
        default=Path("docs/FTS_PERFORMANCE_PROFILE.md"),
        help="Markdown output path (use '-' to skip markdown).",
    )
    return parser.parse_args()


def _default_output_path() -> Path:
    stamp = datetime.now().strftime("%Y%m%d")
    return Path("bench/results") / f"fts_profile_{stamp}.json"


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _parse_int_list(raw: str) -> list[int]:
    vals = [part.strip() for part in raw.split(",") if part.strip()]
    out = [int(v) for v in vals]
    if not out:
        raise ValueError("At least one integer value is required")
    if any(v <= 0 for v in out):
        raise ValueError("All values must be > 0")
    return out


def _parse_str_list(raw: str) -> list[str]:
    out = [part.strip() for part in raw.split(",") if part.strip()]
    if not out:
        raise ValueError("At least one value is required")
    return out


def _parse_queries(raw: str) -> list[str]:
    out = [part.strip() for part in raw.split(";") if part.strip()]
    if not out:
        raise ValueError("At least one query is required")
    return out


def _percentile(samples: list[float], p: float) -> float:
    if not samples:
        return 0.0
    if len(samples) == 1:
        return samples[0]
    ordered = sorted(samples)
    rank = (len(ordered) - 1) * p
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    frac = rank - low
    return ordered[low] + (ordered[high] - ordered[low]) * frac


def _stats(samples: list[float]) -> dict[str, float]:
    if not samples:
        return {"count": 0.0, "min": 0.0, "max": 0.0, "mean": 0.0, "median": 0.0, "p95": 0.0}
    return {
        "count": float(len(samples)),
        "min": min(samples),
        "max": max(samples),
        "mean": sum(samples) / len(samples),
        "median": _percentile(samples, 0.5),
        "p95": _percentile(samples, 0.95),
    }


def _bytes_to_mb(n: int) -> float:
    return float(n) / (1024.0 * 1024.0)


def _db_total_size_bytes(db_path: Path) -> int:
    total = 0
    for suffix in ("", "-wal", "-shm"):
        p = Path(str(db_path) + suffix)
        if p.exists():
            total += p.stat().st_size
    return total


def _apply_profile(conn: sqlite3.Connection, profile: str) -> None:
    pragmas = PROFILE_PRAGMAS[profile]
    for key, value in pragmas.items():
        conn.execute(f"PRAGMA {key}={value}")


def _read_effective_pragmas(conn: sqlite3.Connection) -> dict[str, Any]:
    journal_mode = str(conn.execute("PRAGMA journal_mode").fetchone()[0]).upper()
    synchronous_raw = int(conn.execute("PRAGMA synchronous").fetchone()[0])
    temp_store_raw = int(conn.execute("PRAGMA temp_store").fetchone()[0])
    cache_size = int(conn.execute("PRAGMA cache_size").fetchone()[0])
    mmap_size = int(conn.execute("PRAGMA mmap_size").fetchone()[0])
    wal_autocheckpoint = int(conn.execute("PRAGMA wal_autocheckpoint").fetchone()[0])
    return {
        "journal_mode": journal_mode,
        "synchronous": SYNC_MAP.get(synchronous_raw, str(synchronous_raw)),
        "temp_store": TEMP_STORE_MAP.get(temp_store_raw, str(temp_store_raw)),
        "cache_size": cache_size,
        "mmap_size": mmap_size,
        "wal_autocheckpoint": wal_autocheckpoint,
    }


def _insert_documents(conn: sqlite3.Connection, doc_count: int) -> list[int]:
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    languages = ["fr", "en", "de", "es", "it", "ro", "sv", "el"]
    doc_ids: list[int] = []
    for idx in range(doc_count):
        cur = conn.execute(
            """
            INSERT INTO documents (
                title, language, doc_role, resource_type, meta_json, source_path, source_hash, created_at
            )
            VALUES (?, ?, 'standalone', 'literary', NULL, NULL, NULL, ?)
            """,
            (f"Bench doc {idx + 1}", languages[idx % len(languages)], created_at),
        )
        doc_ids.append(int(cur.lastrowid))
    return doc_ids


def _make_line(global_idx: int, doc_idx: int) -> str:
    tokens = [VOCAB[(global_idx + (step * 5) + (doc_idx * 7)) % len(VOCAB)] for step in range(20)]
    if global_idx % 6 == 0:
        tokens[1:1] = ["alpha", "beta"]
    if global_idx % 9 == 0:
        tokens.append("translation")
    if global_idx % 11 == 0:
        tokens.append("alignment")
    if global_idx % 13 == 0:
        tokens.append("corpus")
    return " ".join(tokens)


def _seed_units(conn: sqlite3.Connection, total_units: int, doc_ids: list[int], batch_size: int = 2000) -> None:
    doc_positions = {doc_id: 0 for doc_id in doc_ids}
    rows: list[tuple[int, str, int, int, str, str, None]] = []

    for idx in range(total_units):
        doc_id = doc_ids[idx % len(doc_ids)]
        doc_positions[doc_id] += 1
        n = doc_positions[doc_id]
        text = _make_line(idx + 1, idx % len(doc_ids))
        rows.append((doc_id, "line", n, idx + 1, text, text, None))
        if len(rows) >= batch_size:
            conn.executemany(
                """
                INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            rows.clear()

    if rows:
        conn.executemany(
            """
            INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
    conn.commit()


def _ms_since(start: float) -> float:
    return (time.perf_counter() - start) * 1000.0


def _bench_one(
    profile: str,
    unit_count: int,
    index_runs: int,
    query_runs: int,
    query_limit: int,
    queries: list[str],
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix=f"agrafes-fts-{profile}-{unit_count}-") as td:
        db_path = Path(td) / "bench.db"
        conn = get_connection(db_path)
        apply_migrations(conn)
        _apply_profile(conn, profile)

        doc_count = min(12, max(4, unit_count // 25000))

        t_insert = time.perf_counter()
        doc_ids = _insert_documents(conn, doc_count)
        _seed_units(conn, unit_count, doc_ids)
        insert_ms = _ms_since(t_insert)
        db_size_before = _db_total_size_bytes(db_path)

        index_samples: list[float] = []
        indexed_rows = 0
        for _ in range(index_runs):
            t = time.perf_counter()
            indexed_rows = build_index(conn)
            index_samples.append(_ms_since(t))

        # Warm-up pass before measuring query samples.
        for q in queries:
            run_query_page(conn, q=q, mode="segment", limit=query_limit, offset=0)

        query_samples_by_query: dict[str, list[float]] = {}
        query_hits_by_query: dict[str, int] = {}
        all_query_samples: list[float] = []

        for q in queries:
            samples: list[float] = []
            hits = 0
            for _ in range(query_runs):
                t = time.perf_counter()
                payload = run_query_page(conn, q=q, mode="segment", limit=query_limit, offset=0)
                samples.append(_ms_since(t))
                hits = max(hits, len(payload.get("hits", [])))
            query_samples_by_query[q] = samples
            query_hits_by_query[q] = hits
            all_query_samples.extend(samples)

        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.commit()
        db_size_after = _db_total_size_bytes(db_path)
        pragmas = _read_effective_pragmas(conn)
        conn.close()

    per_query = {
        q: {
            "hits_max": query_hits_by_query[q],
            "timings_ms": query_samples_by_query[q],
            "stats_ms": _stats(query_samples_by_query[q]),
        }
        for q in queries
    }
    return {
        "profile": profile,
        "unit_count": unit_count,
        "doc_count": doc_count,
        "insert_ms": insert_ms,
        "index_runs": index_runs,
        "indexed_rows": indexed_rows,
        "index_timings_ms": index_samples,
        "index_stats_ms": _stats(index_samples),
        "query_runs": query_runs,
        "query_limit": query_limit,
        "query_overall_stats_ms": _stats(all_query_samples),
        "query_by_string": per_query,
        "db_size_before_index_bytes": db_size_before,
        "db_size_after_index_bytes": db_size_after,
        "db_size_after_index_mb": _bytes_to_mb(db_size_after),
        "effective_pragmas": pragmas,
    }


def _recommend_profile(results: list[dict[str, Any]], profiles: list[str]) -> dict[str, Any]:
    grouped: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in results:
        grouped[int(row["unit_count"])][str(row["profile"])] = row

    candidates = [p for p in profiles if p != "baseline"]
    if not candidates:
        return {
            "profile": "baseline",
            "reason": "No alternative profile benchmarked",
            "speedup_index_median_vs_baseline": 1.0,
            "speedup_query_median_vs_baseline": 1.0,
            "pragmas": PROFILE_PRAGMAS["baseline"],
        }

    best_profile = candidates[0]
    best_score = -1.0
    best_index_speedup = 1.0
    best_query_speedup = 1.0

    for candidate in candidates:
        index_speedups: list[float] = []
        query_speedups: list[float] = []
        for _unit_count, rows in grouped.items():
            baseline = rows.get("baseline")
            cand = rows.get(candidate)
            if not baseline or not cand:
                continue
            b_index = float(baseline["index_stats_ms"]["median"])
            c_index = float(cand["index_stats_ms"]["median"])
            b_query = float(baseline["query_overall_stats_ms"]["median"])
            c_query = float(cand["query_overall_stats_ms"]["median"])
            if c_index > 0 and c_query > 0:
                index_speedups.append(b_index / c_index)
                query_speedups.append(b_query / c_query)

        if not index_speedups or not query_speedups:
            continue

        index_mean = sum(index_speedups) / len(index_speedups)
        query_mean = sum(query_speedups) / len(query_speedups)
        score = index_mean * query_mean
        if score > best_score:
            best_score = score
            best_profile = candidate
            best_index_speedup = index_mean
            best_query_speedup = query_mean

    reason = (
        "Best combined rebuild/query speedup against baseline "
        f"(index x{best_index_speedup:.2f}, query x{best_query_speedup:.2f})."
    )
    return {
        "profile": best_profile,
        "reason": reason,
        "speedup_index_median_vs_baseline": best_index_speedup,
        "speedup_query_median_vs_baseline": best_query_speedup,
        "pragmas": PROFILE_PRAGMAS[best_profile],
    }


def _build_markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# FTS Performance Profile",
        "",
        f"Generated at: {payload['generated_at']}",
        f"- Platform: `{payload['platform']}`",
        f"- Python: `{payload['python_version']}`",
        "",
        "## Benchmark protocol",
        "",
        f"- Datasets (line units): {', '.join(str(v) for v in payload['sizes'])}",
        f"- Profiles: {', '.join(payload['profiles'])}",
        f"- Index runs per dataset/profile: {payload['index_runs']}",
        f"- Query runs per query: {payload['query_runs']}",
        f"- Query limit: {payload['query_limit']}",
        f"- Queries: {', '.join(payload['queries'])}",
        "",
        "## Summary table",
        "",
        "| Units | Profile | Insert ms | Index median ms | Index p95 ms | Query median ms | Query p95 ms | DB size MB |",
        "|------:|---------|----------:|----------------:|-------------:|----------------:|-------------:|-----------:|",
    ]

    rows = sorted(payload["results"], key=lambda row: (int(row["unit_count"]), str(row["profile"])))
    for row in rows:
        lines.append(
            "| "
            + f"{int(row['unit_count'])} | {row['profile']} | "
            + f"{float(row['insert_ms']):.1f} | "
            + f"{float(row['index_stats_ms']['median']):.1f} | "
            + f"{float(row['index_stats_ms']['p95']):.1f} | "
            + f"{float(row['query_overall_stats_ms']['median']):.1f} | "
            + f"{float(row['query_overall_stats_ms']['p95']):.1f} | "
            + f"{float(row['db_size_after_index_mb']):.1f} |"
        )

    rec = payload["recommendation"]
    lines.extend(
        [
            "",
            "## Recommended profile",
            "",
            f"- Profile: `{rec['profile']}`",
            f"- Rationale: {rec['reason']}",
            "",
            "Recommended PRAGMA set for large rebuild/query sessions:",
            "",
            "```sql",
        ]
    )
    for key, value in rec["pragmas"].items():
        lines.append(f"PRAGMA {key}={value};")
    lines.extend(
        [
            "```",
            "",
            "## Maintenance cadence",
            "",
            "- Keep `journal_mode=WAL` (already default in the connection factory).",
            "- Run `ANALYZE` after large batch imports/resegmentation + rebuilds.",
            "- Run `PRAGMA optimize` at shutdown or periodic maintenance.",
            "- Run `VACUUM` after major deletions/compaction windows (off hot path).",
            "",
            "Raw JSON report path:",
            f"- `{payload['output_path']}`",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    args = _parse_args()
    sizes = _parse_int_list(args.sizes)
    profiles = _parse_str_list(args.profiles)
    unknown_profiles = [p for p in profiles if p not in PROFILE_PRAGMAS]
    if unknown_profiles:
        raise ValueError(
            f"Unknown profile(s): {', '.join(unknown_profiles)}. "
            f"Available: {', '.join(sorted(PROFILE_PRAGMAS))}"
        )
    queries = _parse_queries(args.queries)
    output_path = args.output or _default_output_path()

    if args.index_runs <= 0:
        raise ValueError("--index-runs must be > 0")
    if args.query_runs <= 0:
        raise ValueError("--query-runs must be > 0")
    if args.query_limit <= 0:
        raise ValueError("--query-limit must be > 0")

    results: list[dict[str, Any]] = []
    for unit_count in sizes:
        for profile in profiles:
            print(f"[bench] profile={profile} units={unit_count}")
            result = _bench_one(
                profile=profile,
                unit_count=unit_count,
                index_runs=args.index_runs,
                query_runs=args.query_runs,
                query_limit=args.query_limit,
                queries=queries,
            )
            results.append(result)

    payload: dict[str, Any] = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "sizes": sizes,
        "profiles": profiles,
        "queries": queries,
        "index_runs": args.index_runs,
        "query_runs": args.query_runs,
        "query_limit": args.query_limit,
        "results": results,
    }
    payload["recommendation"] = _recommend_profile(results, profiles)
    payload["output_path"] = str(output_path)

    _ensure_parent(output_path)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote JSON report: {output_path}")

    if str(args.markdown) != "-":
        markdown_path: Path = args.markdown
        _ensure_parent(markdown_path)
        markdown_path.write_text(_build_markdown(payload), encoding="utf-8")
        print(f"Wrote Markdown report: {markdown_path}")

    rec = payload["recommendation"]
    print(
        "Recommended profile: "
        + f"{rec['profile']} "
        + f"(index x{float(rec['speedup_index_median_vs_baseline']):.2f}, "
        + f"query x{float(rec['speedup_query_median_vs_baseline']):.2f})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
