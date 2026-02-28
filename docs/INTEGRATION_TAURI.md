# Integration Guide — Tauri + multicorpus_engine

Last updated: 2026-02-28

## Integration modes

- **Mode A (recommended baseline): CLI spawn**
  - Stable and required.
  - Tauri starts `multicorpus ...` and parses stdout JSON.
- **Mode B (optional): sidecar HTTP API**
  - Available for lower-latency/local API workflows.
  - Contract described in `docs/SIDECAR_API_CONTRACT.md`.

CLI usage must remain functional even when sidecar is not used.

## CLI contract (strict)

For each command invocation:
- stdout = **exactly one JSON object**.
- stderr = not part of the contract for machine parsing.
- exit code = `0` on success, `1` on error.

### Success envelope

```json
{
  "status": "ok",
  "run_id": "uuid-if-applicable",
  "...": "command specific fields"
}
```

`status` may be:
- `ok`
- `warnings` (non-fatal validation outcomes)
- `listening` (for `serve` startup)

### Error envelope

```json
{
  "status": "error",
  "error": "human readable message",
  "run_id": "uuid-if-available",
  "created_at": "2026-02-28T12:00:00Z"
}
```

## Commands used by Tauri

- `init-project --db ...`
- `import --db ... --mode docx_numbered_lines|txt_numbered_lines|docx_paragraphs|tei ...`
- `index --db ...`
- `query --db ... --q ... --mode segment|kwic [--output path --output-format jsonl|csv|tsv|html]`
- `align --db ... --pivot-doc-id ... --target-doc-id ... [--strategy external_id|position|similarity]`
- `export --db ... --format tei|csv|tsv|jsonl|html --output ...`
- `validate-meta --db ...`
- `curate --db ... --rules rules.json [--doc-id ...]`
- `segment --db ... --doc-id ... [--lang ...]`
- `serve --db ... [--host ... --port ...]`

## Sidecar API (optional)

When enabled via `multicorpus serve`:
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

Payload envelope, error codes, and OpenAPI details are defined in:
- `docs/SIDECAR_API_CONTRACT.md`

## Run logs

CLI commands persist run logs in:

```text
<db_directory>/runs/<run_id>/run.log
```

Use these logs for diagnostics; keep stdout reserved for machine parsing.
