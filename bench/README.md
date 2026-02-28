# Benchmark Harness

Synthetic performance harness for the `import -> index -> query` pipeline.

## Quickstart

Run TXT benchmark (default mode):

```bash
PYTHONPATH=src python bench/run_bench.py --sizes 1000,5000 --repeats 2
```

Run DOCX benchmark:

```bash
PYTHONPATH=src python bench/run_bench.py \
  --mode docx_numbered_lines \
  --sizes 1000,3000 \
  --repeats 2
```

## Outputs

Each run writes artifacts under `bench/runs/<timestamp>/`:

- `report.json` - full config + raw samples + aggregates
- `samples.csv` - one row per benchmark repetition
- `aggregates.csv` - grouped metrics by `(mode, size)`
- case folders with generated `source.*` and `corpus.db`

Console output also prints a compact summary table.

## Main options

- `--mode txt_numbered_lines|docx_numbered_lines`
- `--sizes 1000,5000,10000`
- `--repeats 3`
- `--query needle`
- `--query-every 10` (inject query term every N lines)
- `--out-dir <path>`

## Sidecar vs Core

Compare HTTP sidecar calls with direct Python API calls:

```bash
PYTHONPATH=src python bench/run_sidecar_bench.py \
  --mode txt_numbered_lines \
  --size 10000 \
  --query needle \
  --query-repeats 30 \
  --index-repeats 5 \
  --health-repeats 30
```

Sidecar benchmark outputs are written under `bench/runs_sidecar/<timestamp>/`
with the same files: `report.json`, `samples.csv`, `aggregates.csv`.
