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
  - returns `run_id`, `count`, `hits`
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
- `POST /curate`
- `POST /validate-meta`
- `POST /segment`
- `GET /jobs`
- `POST /jobs`
- `GET /jobs/{job_id}`

## Shutdown semantics

- `/shutdown` triggers graceful server shutdown.
- Sidecar closes HTTP socket, closes DB connection, and removes
  `.agrafes_sidecar.json`.
- If sidecar is already down, discovery file may be absent/stale.
