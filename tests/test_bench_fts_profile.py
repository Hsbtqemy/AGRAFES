from scripts.bench_fts_profile import _build_markdown, _parse_int_list, _recommend_profile


def test_parse_int_list_accepts_csv() -> None:
    assert _parse_int_list("1000, 2000,3000") == [1000, 2000, 3000]


def test_parse_int_list_rejects_empty_or_non_positive() -> None:
    try:
        _parse_int_list("")
    except ValueError as exc:
        assert "At least one integer value is required" in str(exc)
    else:
        raise AssertionError("Expected ValueError for empty list")

    try:
        _parse_int_list("100,0")
    except ValueError as exc:
        assert "All values must be > 0" in str(exc)
    else:
        raise AssertionError("Expected ValueError for non-positive list")


def test_recommend_profile_prefers_faster_candidate() -> None:
    results = [
        {
            "profile": "baseline",
            "unit_count": 10_000,
            "index_stats_ms": {"median": 200.0},
            "query_overall_stats_ms": {"median": 20.0},
        },
        {
            "profile": "throughput",
            "unit_count": 10_000,
            "index_stats_ms": {"median": 100.0},
            "query_overall_stats_ms": {"median": 10.0},
        },
    ]
    rec = _recommend_profile(results, ["baseline", "throughput"])
    assert rec["profile"] == "throughput"
    assert float(rec["speedup_index_median_vs_baseline"]) == 2.0
    assert float(rec["speedup_query_median_vs_baseline"]) == 2.0


def test_build_markdown_contains_recommended_pragmas() -> None:
    payload = {
        "generated_at": "2026-04-09T10:00:00+00:00",
        "platform": "test-platform",
        "python_version": "3.11.0",
        "sizes": [10_000],
        "profiles": ["baseline", "throughput"],
        "queries": ["alpha"],
        "index_runs": 3,
        "query_runs": 5,
        "query_limit": 50,
        "output_path": "bench/results/fts_profile_20260409.json",
        "results": [
            {
                "profile": "baseline",
                "unit_count": 10_000,
                "insert_ms": 100.0,
                "index_stats_ms": {"median": 50.0, "p95": 60.0},
                "query_overall_stats_ms": {"median": 4.0, "p95": 6.0},
                "db_size_after_index_mb": 3.2,
            }
        ],
        "recommendation": {
            "profile": "throughput",
            "reason": "test reason",
            "speedup_index_median_vs_baseline": 1.4,
            "speedup_query_median_vs_baseline": 1.2,
            "pragmas": {
                "synchronous": "NORMAL",
                "temp_store": "MEMORY",
            },
        },
    }
    md = _build_markdown(payload)
    assert "## Recommended profile" in md
    assert "PRAGMA synchronous=NORMAL;" in md
    assert "PRAGMA temp_store=MEMORY;" in md
