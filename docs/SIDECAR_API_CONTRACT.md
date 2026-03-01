# Sidecar API Contract (v1.1.0)

This document defines the persistent localhost HTTP contract for
`multicorpus_engine` sidecar.

## Runtime model

- One long-lived process started with:
  - `multicorpus serve --db <path> --host 127.0.0.1 --port 0|NNNN --token auto|off|<value>`
- `--port 0` asks OS for a free port.
- Discovery file is written next to DB:
  - `<db_dir>/.agrafes_sidecar.json`
  - payload: `{ host, port, pid, started_at, db_path, token? }`
- Helper commands:
  - `multicorpus status --db <path>`: returns lifecycle state (`running|stale|missing`)
  - `multicorpus shutdown --db <path>`: shutdown using portfile discovery

## Restart policy (stale portfile recovery)

When `multicorpus serve` starts and a portfile already exists:

1. If PID is alive **and** `GET /health` succeeds on stored `host/port`:
   - do not start a second process
   - return startup JSON with `status="already_running"` and existing endpoint info
2. Otherwise:
   - treat as stale
   - remove stale portfile
   - start a new sidecar and write a fresh portfile

## Versioning

- `api_version`: sidecar API contract version (`1.1.0`)
- `version`: engine version

## Response envelope

### Success

```json
{
  "ok": true,
  "api_version": "1.1.0",
  "version": "0.6.1",
  "status": "ok"
}
```

### Error

```json
{
  "ok": false,
  "api_version": "1.1.0",
  "version": "0.6.1",
  "status": "error",
  "error": {
    "type": "VALIDATION_ERROR",
    "message": "human readable message",
    "details": {}
  },
  "error_code": "VALIDATION_ERROR",
  "error_details": {}
}
```

`error_details` remains for compatibility.

## Standard error codes

- `BAD_REQUEST`: invalid JSON body / malformed request
- `NOT_FOUND`: unknown route or unknown resource
- `VALIDATION_ERROR`: semantic validation failure
- `UNAUTHORIZED`: missing or invalid `X-Agrafes-Token`
- `INTERNAL_ERROR`: unexpected runtime/server failure

## Token policy (optional localhost guard)

- Serve token modes:
  - `--token auto` (default): generates a random token, persisted in portfile
  - `--token off`: disables token check (compat mode)
  - `--token <value>`: explicit fixed token
- Header:
  - `X-Agrafes-Token: <token>`
- Token-protected write endpoints:
  - `POST /import`
  - `POST /index`
  - `POST /shutdown`
- Read endpoints (`/health`, `/query`, `/openapi.json`) do not require token.

## Required endpoints (persistent UX baseline)

- `GET /health`
  - returns `ok/status/version/pid/started_at/host/port/portfile/token_required`
- `POST /query`
  - same search semantics as CLI query
  - request body (all optional except `q`):
    - `q: string`
    - `mode: "segment"|"kwic"` (default `segment`)
    - `window: int` (default `10`, KWIC only)
    - `language`, `doc_id`, `resource_type`, `doc_role`
    - `include_aligned: bool` (default `false`)
    - `aligned_limit: int|null` (default `20` in sidecar; ignored when `include_aligned=false`)
    - `all_occurrences: bool` (default `false`, KWIC only)
    - `limit: int` (default `50`, min `1`, max `200`)
    - `offset: int` (default `0`, min `0`)
  - response:
    - `run_id`, `count`, `hits`
    - pagination fields:
      - `limit: int`
      - `offset: int`
      - `next_offset: int|null`
      - `has_more: bool`
      - `total: int|null` (V0.2 policy: currently `null`)
    - if `include_aligned=true`, each hit includes `aligned: []` (possibly empty)
      with items shaped as:
      - `doc_id`, `unit_id`, `language`, `title`, `external_id`, `text`, `text_norm`

### Pagination policy (V0.2)

- Sidecar computes pagination with `LIMIT limit+1` to derive `has_more` without a full `COUNT(*)`.
- `total` is intentionally `null` in V0.2 (no expensive global count query by default).
- `include_aligned` enrichment is applied only to the current page hits.
- `POST /index`
  - rebuilds FTS index
  - returns `run_id`, `units_indexed`
  - returns `401` if token is active and header is missing/invalid
- `POST /import`
  - JSON body:
    - `mode`: `docx_numbered_lines|txt_numbered_lines|docx_paragraphs|tei`
    - `path`: source file path
    - `language` required except TEI mode
    - optional: `title`, `doc_role`, `resource_type`, `tei_unit`
  - returns `run_id` + importer report (`doc_id`, unit counts, warnings, etc.)
  - returns `401` if token is active and header is missing/invalid
- `POST /shutdown`
  - graceful server stop
  - returns `shutting_down: true`
  - returns `401` if token is active and header is missing/invalid

## Additional endpoints (already available)

- `GET /openapi.json`
- `GET /documents`
- `GET /doc_relations?doc_id=N`
- `POST /curate`
- `POST /curate/preview`
- `POST /align`
  - body: `{ pivot_doc_id, target_doc_ids, strategy?, sim_threshold?, debug_align?, run_id? }`
  - `strategy` values: `external_id` (default), `position`, `similarity`, `external_id_then_position` (hybrid)
  - `sim_threshold` only applies to `similarity` (range `[0.0, 1.0]`)
  - `debug_align` (bool, default false) adds optional `report.debug` diagnostics payload
  - response now includes `run_id` and `total_links_created`
  - each report includes `links_created` and `links_skipped`
  - align responses are persisted in `runs` (`kind=align`, stats include `strategy`, `pairs`, debug payload when enabled)
- `POST /align/audit`
- `POST /align/quality`
- `POST /align/link/update_status`
- `POST /align/link/delete`
- `POST /align/link/retarget`
- `POST /documents/update`
- `POST /documents/bulk_update`
- `POST /doc_relations/set`
- `POST /doc_relations/delete`
- `POST /export/tei`
- `POST /export/align_csv`
- `POST /export/run_report`
- `POST /validate-meta`
- `POST /segment`
  - body: `{ doc_id, lang?, pack? }`
  - `pack` values: `auto` (default), `default`, `fr_strict`, `en_strict`
  - response includes `segment_pack` (resolved pack actually used)
- `GET /jobs`
- `POST /jobs`
- `GET /jobs/{job_id}`
- `POST /jobs/enqueue` (token required)
- `POST /jobs/{job_id}/cancel` (token required)

### V0.5 — Job enqueue + cancel

#### `POST /jobs/enqueue` (token required)

Enqueue an async job supporting all operation kinds (including import, align, exports).

Request:
```json
{
  "kind": "index|curate|validate-meta|segment|import|align|export_tei|export_align_csv|export_run_report",
  "params": {}
}
```

Response (HTTP 202):
```json
{ "ok": true, "status": "accepted", "job": { "job_id": "...", "kind": "...", "status": "queued", "..." } }
```

Supported `kind` values and required `params`:
- `index` — no params required
- `curate` — `params.rules` (array, required)
- `validate-meta` — `params.doc_id?`
- `segment` — `params.doc_id` (required), optional `params.lang`, optional `params.pack` (`auto|default|fr_strict|en_strict`)
- `import` — `params.mode` + `params.path` required; optional: `language`, `title`, `doc_role`, `resource_type`, `tei_unit`
- `align` — `params.pivot_doc_id` + `params.target_doc_ids` required; optional: `strategy`, `sim_threshold`, `debug_align`, `run_id`
  - `strategy`: `external_id|position|similarity|external_id_then_position`
  - job result includes `run_id`; this run can be exported via `export_run_report` with `params.run_id`
- `export_tei` — `params.out_dir` required; optional: `params.doc_ids`
- `export_align_csv` — `params.out_path` required; optional: `pivot_doc_id`, `target_doc_id`, `delimiter`
- `export_run_report` — `params.out_path` required; optional: `run_id`, `format` (`jsonl`|`html`)

Token enforcement: `X-Agrafes-Token` required when token is active.

#### `POST /jobs/{job_id}/cancel` (token required)

Cancel a queued or running job. Best-effort: if already running, marks status as `canceled`
immediately; the background thread may finish but result will not overwrite `canceled` status.
Idempotent for terminal states (`done`, `error`, `canceled`).

Response:
```json
{ "ok": true, "status": "ok", "job_id": "...", "status": "canceled" }
```

Returns `404` if `job_id` unknown. Returns `200` idempotently if job already terminal.

#### `GET /jobs` (extended)

Now supports query params:
- `?status=queued|running|done|error|canceled` — filter by status
- `?limit=N` (default 100, max 200)
- `?offset=N` (default 0)

Response now includes pagination fields: `total`, `limit`, `offset`, `has_more`, `next_offset`.

### V0.4A — Metadata panel (token required for writes)

- `GET /doc_relations?doc_id=N` — list relations for a document (no token)
- `POST /documents/update` — update title/language/doc_role/resource_type for one doc
  - body: `{ doc_id, title?, language?, doc_role?, resource_type? }`
  - returns: `{ updated: int, doc: DocumentRecord }`
- `POST /documents/bulk_update` — update multiple docs at once
  - body: `{ updates: [{doc_id, title?, language?, doc_role?, resource_type?}, …] }`
  - returns: `{ updated: int }`
- `POST /doc_relations/set` — upsert a doc_relation
  - body: `{ doc_id, relation_type, target_doc_id, note? }`
  - returns: `{ action: "created"|"updated", id, doc_id, relation_type, target_doc_id }`
- `POST /doc_relations/delete` — delete a doc_relation by `id`
  - body: `{ id: int }`
  - returns: `{ deleted: int }`

### V0.4B — Exports (token required)

- `POST /export/tei` — export documents as TEI XML (server-side disk write)
  - body: `{ out_dir, doc_ids?: int[] }` (null = all docs)
  - returns: `{ files_created: string[], count }`
- `POST /export/align_csv` — export alignment links as CSV/TSV
  - body: `{ out_path, pivot_doc_id?, target_doc_id?, delimiter? }`
  - returns: `{ out_path, rows_written }`
- `POST /export/run_report` — export run history
  - body: `{ out_path, run_id?, format: "jsonl"|"html" }`
  - returns: `{ out_path, runs_exported, format }`

### V0.4C — Alignment link editing (token required)

- `POST /align/link/update_status` — set link status (`"accepted"`, `"rejected"`, or `null`)
  - body: `{ link_id, status }`; validates: status ∈ {accepted, rejected, null}
  - returns: `{ link_id, status, updated: 1 }`
- `POST /align/link/delete` — permanently delete an alignment link
  - body: `{ link_id }`; returns: `{ link_id, deleted }`
- `POST /align/link/retarget` — change target unit of a link
  - body: `{ link_id, new_target_unit_id }`; validates: unit must exist
  - returns: `{ link_id, new_target_unit_id, updated: 1 }`

`/align/audit` extended (backward-compatible):
- Each link in response now includes `"status": null|"accepted"|"rejected"`
- Optional request field `"status"`: `"unreviewed"` (NULL), `"accepted"`, `"rejected"`

### POST /curate/preview (V0.3 — read-only)

Simulates curation rules without writing to DB. No token required.

Request:
```json
{ "doc_id": 1, "rules": [{"pattern": "foo", "replacement": "bar", "flags": "i"}], "limit_examples": 10 }
```

Response:
```json
{
  "ok": true, "status": "ok",
  "doc_id": 1,
  "stats": { "units_total": 42, "units_changed": 5, "replacements_total": 7 },
  "examples": [
    { "unit_id": 3, "external_id": 3, "before": "foo bar", "after": "bar bar" }
  ],
  "fts_stale": false
}
```

### POST /align/audit (V0.3 — read-only, paginated)

Lists alignment links for a pivot↔target pair. No token required.

Request:
```json
{ "pivot_doc_id": 1, "target_doc_id": 2, "limit": 50, "offset": 0, "external_id": null }
```

Response:
```json
{
  "ok": true, "status": "ok",
  "pivot_doc_id": 1, "target_doc_id": 2,
  "limit": 50, "offset": 0, "has_more": false, "next_offset": null,
  "stats": { "links_returned": 12 },
  "links": [
    { "link_id": 1, "external_id": 1, "pivot_unit_id": 10, "target_unit_id": 20,
      "pivot_text": "Bonjour monde.", "target_text": "Hello world." }
  ]
}
```

### POST /align/quality (V1.1 — read-only, no token required)

Returns alignment quality metrics for a pivot↔target doc pair. Useful for
a pre-flight check after an alignment run and for the quality panel UI.

Request:
```json
{ "pivot_doc_id": 1, "target_doc_id": 2, "run_id": null }
```
- `run_id` (optional) — restrict metrics to links from a specific align run.

Response:
```json
{
  "ok": true, "status": "ok",
  "pivot_doc_id": 1, "target_doc_id": 2, "run_id": null,
  "stats": {
    "total_pivot_units": 50,
    "total_target_units": 48,
    "total_links": 47,
    "covered_pivot_units": 47,
    "covered_target_units": 47,
    "coverage_pct": 94.0,
    "orphan_pivot_count": 3,
    "orphan_target_count": 1,
    "collision_count": 0,
    "status_counts": { "unreviewed": 40, "accepted": 5, "rejected": 2 }
  },
  "sample_orphan_pivot": [
    { "unit_id": 12, "external_id": 12, "text": "Texte sans correspondance." }
  ],
  "sample_orphan_target": []
}
```

Fields:
- `coverage_pct` = `covered_pivot_units / total_pivot_units * 100`
- `orphan_pivot_count` = pivot units with no outgoing link
- `orphan_target_count` = target units with no incoming link
- `collision_count` = pivot units appearing in more than one link for this pair
- `sample_orphan_pivot` / `sample_orphan_target` — up to 5 examples each

## Shutdown semantics

- `/shutdown` triggers graceful server shutdown.
- Sidecar closes HTTP socket, closes DB connection, and removes
  `.agrafes_sidecar.json`.
- If sidecar is already down, discovery file may be absent/stale.
