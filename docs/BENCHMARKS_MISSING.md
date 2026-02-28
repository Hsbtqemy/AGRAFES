# Bench Dataset Missing (ADR-025)

Generated at: 2026-02-28 (Europe/Paris)

## Rule applied

ADR-025 is finalized only with a complete 3-OS benchmark dataset:
- OS: `macos`, `linux`, `windows`
- Formats per OS: `onefile`, `onedir`
- Required fields: `size_bytes`, `time_to_ready_ms_mean`, `query_ms_mean`

## Collection attempt

### Local dataset

`bench/results/` currently contains:
- `20260228_macos_aarch64_onefile.json`
- `20260228_macos_aarch64_onedir.json`
- `20260228_compare_macos.json`
- `20260228_compare_darwin.json`

### CI artifact retrieval via GitHub CLI

- `gh` is available (`gh version 2.87.3`)
- Repository remote: `Hsbtqemy/AGRAFES`
- `gh run list --workflow bench-sidecar.yml` returned no run to download.
- `gh run list` returned no workflow runs.

Result: no CI artifacts could be fetched into `bench/results/ci/`.

## Programmatic coverage check

Coverage by OS/format (from JSON files):
- `macos`: `onefile`=1, `onedir`=1
- `linux`: `onefile`=0, `onedir`=0
- `windows`: `onefile`=0, `onedir`=0

Field completeness:
- Missing required metric fields in present records: `0`

## Decision status

- ADR-025 remains **Pending**.
- No default-format change is applied to scripts/workflows.

## Missing inputs to proceed

Need benchmark JSON artifacts for:
- Linux: `onefile` + `onedir`
- Windows: `onefile` + `onedir`

Place them in `bench/results/` (or `bench/results/ci/`) then rerun:

```bash
python scripts/aggregate_bench_results.py --input bench/results --output docs/BENCHMARKS.md
```

