# Sidecar API Contract (v1.0.0)

This document defines the stable HTTP contract for `multicorpus_engine` sidecar.

## Versioning

- Contract version field in payloads: `api_version`
- Current value: `1.0.0`

## Response envelope

### Success

```json
{
  "api_version": "1.0.0",
  "status": "ok",
  "...": "route-specific fields"
}
```

`status` may be `"warnings"` for non-fatal validation outcomes.
For async submission endpoints, `status` may be `"accepted"`.

### Error

```json
{
  "api_version": "1.0.0",
  "status": "error",
  "error": "human readable message",
  "error_code": "MACHINE_READABLE_CODE",
  "error_details": {}
}
```

`error_details` is optional.

## Standard error codes

- `BAD_REQUEST`: invalid JSON or malformed request payload
- `NOT_FOUND`: unknown HTTP route
- `VALIDATION_ERROR`: semantic validation failure (reserved)
- `INTERNAL_ERROR`: unexpected runtime/server error

## Endpoints

- `GET /health`
- `GET /openapi.json`
- `POST /query`
- `POST /index`
- `POST /curate`
- `POST /validate-meta`
- `POST /segment`
- `GET /jobs`
- `POST /jobs`
- `GET /jobs/{job_id}`

## Async Jobs

`POST /jobs` payload:

```json
{
  "kind": "index|curate|validate-meta|segment",
  "params": {}
}
```

Accepted response (`HTTP 202`) contains a `job` object:

- `job_id`
- `status`: `queued|running|done|error`
- `progress_pct`: `0..100`
- `progress_message`
- `params`, `result`, `error`, `error_code`
- `created_at`, `started_at`, `finished_at`

## OpenAPI

Machine-readable schema is exposed at runtime:

- `GET /openapi.json`

and generated from:

- `src/multicorpus_engine/sidecar_contract.py`
