# FTS Performance Profile

Generated at: 2026-04-09T15:25:07+02:00
- Platform: `macOS-26.3-arm64-arm-64bit-Mach-O`
- Python: `3.13.9`

## Benchmark protocol

- Datasets (line units): 25000, 100000, 250000
- Profiles: baseline, throughput
- Index runs per dataset/profile: 3
- Query runs per query: 8
- Query limit: 50
- Queries: alpha, "alpha beta", NEAR(alpha beta, 5), alignment AND corpus, translation

## Summary table

| Units | Profile | Insert ms | Index median ms | Index p95 ms | Query median ms | Query p95 ms | DB size MB |
|------:|---------|----------:|----------------:|-------------:|----------------:|-------------:|-----------:|
| 25000 | baseline | 133.4 | 114.9 | 124.7 | 3.5 | 6.7 | 15.2 |
| 25000 | throughput | 112.4 | 102.8 | 225.5 | 1.9 | 2.5 | 15.2 |
| 100000 | baseline | 669.2 | 551.6 | 696.0 | 17.8 | 24.0 | 63.8 |
| 100000 | throughput | 621.7 | 487.1 | 533.4 | 12.5 | 15.2 | 63.8 |
| 250000 | baseline | 1427.2 | 1675.4 | 1737.0 | 37.8 | 73.7 | 142.3 |
| 250000 | throughput | 1678.7 | 1358.5 | 1461.4 | 22.7 | 32.2 | 142.3 |

## Recommended profile

- Profile: `throughput`
- Rationale: Best combined rebuild/query speedup against baseline (index x1.16, query x1.66).

Recommended PRAGMA set for large rebuild/query sessions:

```sql
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA cache_size=-65536;
PRAGMA mmap_size=268435456;
PRAGMA wal_autocheckpoint=1000;
```

## Maintenance cadence

- Keep `journal_mode=WAL` (already default in the connection factory).
- Run `ANALYZE` after large batch imports/resegmentation + rebuilds.
- Run `PRAGMA optimize` at shutdown or periodic maintenance.
- Run `VACUUM` after major deletions/compaction windows (off hot path).

Raw JSON report path:
- `bench/results/fts_profile_20260409.json`
