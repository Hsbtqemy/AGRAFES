# Incremental Indexing Strategy (FTS5)

Last updated: 2026-04-09

## Scope

This note documents the explicit incremental FTS strategy introduced for large corpora.
It complements full rebuild mode, and does not replace it.

## Modes

- Full rebuild (default):
  - CLI: `index --db <path>`
  - Sidecar: `POST /index {}` (or empty body)
  - Behavior: clear + repopulate `fts_units` from all `units` where `unit_type='line'`.

- Incremental sync (explicit gate):
  - CLI: `index --db <path> --incremental`
  - Sidecar: `POST /index {"incremental": true}`
  - Async jobs: `POST /jobs/enqueue {"kind":"index","params":{"incremental":true}}`

## Incremental algorithm

In order:

1. Optional stale-row pruning:
   - remove FTS rows whose `rowid` no longer maps to a `units.unit_id` line row.
2. Refresh changed lines:
   - detect rows where `fts_units.text_norm != units.text_norm`,
   - delete and reinsert those rows.
3. Insert missing lines:
   - add line units present in `units` but not in `fts_units`.

Returned counters:

- `units_indexed`: total line units after sync
- `inserted`: newly indexed rows
- `refreshed`: rows reindexed due to changed `text_norm`
- `deleted`: stale FTS rows removed

## Guardrails

- Incremental mode is opt-in only (`--incremental` / `incremental=true`).
- Default remains full rebuild for deterministic, simple behavior.
- If `fts_units` is missing/corrupted, sidecar recreates it before syncing.
- For major schema/mass operations, full rebuild remains the safest baseline.

## Recommended ops policy

- Use incremental mode for frequent medium-size updates (import/curation/segment loops).
- Run full rebuild periodically (or before release/export milestones) as a safety sweep.
- Keep WAL enabled and run maintenance cadence from `docs/FTS_PERFORMANCE_PROFILE.md`:
  - `ANALYZE` after major batch updates
  - `PRAGMA optimize` periodically
  - `VACUUM` off hot path after large deletions
