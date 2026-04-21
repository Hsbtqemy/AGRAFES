# Sidecar Localhost Security Posture

Last updated: 2026-04-21

## Scope

This document defines the security posture for the persistent localhost sidecar
started with:

```bash
multicorpus serve --db <path> --host 127.0.0.1 --port 0 --token auto
```

It complements:
- `docs/SIDECAR_API_CONTRACT.md` (wire contract),
- `docs/DECISIONS.md` ADR-023 (token + restart policy),
- `docs/INTEGRATION_TAURI.md` (wrapper integration).

## Threat model (desktop localhost)

### Assets to protect
- Write endpoints (`/import`, `/index`, `/shutdown`, `/jobs/enqueue`, ...).
- Project DB integrity (content, metadata, alignment links, runs).
- Sidecar token stored in `.agrafes_sidecar.json`.

### In-scope threats
- Untrusted local process sending write requests to sidecar.
- Stale portfile causing wrong endpoint/token reuse.
- Token leakage via logs/clipboard/crash traces.
- Wrapper launching sidecar with insecure defaults (`--token off`, non-local host).

### Out-of-scope threats
- Full host compromise / malware running as the same user.
- OS-level privilege escalation and filesystem bypass.
- Network exposure outside localhost (must be blocked by wrapper defaults).

## Security controls (current)

- Binding to localhost by default (`127.0.0.1`).
- Token guard for write endpoints via `X-Agrafes-Token` when token is active.
- Token comparison via `hmac.compare_digest` (timing-attack safe) — v0.1.31.
- Random token generation with `--token auto`.
- Portfile `chmod 0o600` — lisible uniquement par l'utilisateur courant — v0.1.31.
- Stale portfile recovery (`status=running|stale|missing` + `/health` probe).
- Read endpoints remain open by design (`/health`, `/query`, `/openapi.json`, ...).
- `MAX_BODY_SIZE` 64 MiB cap sur les requêtes entrantes — v0.1.31.
- `defusedxml` remplace `stdlib ET` pour le parsing TEI (XXE/billion-laughs) — v0.1.31.
- Rust `read_text_file_raw` restreint à `.agrafes_sidecar.json` uniquement — v0.1.31.
- Path traversal bloqué sur tous les handlers d'export via `_resolve_export_path()` — v0.1.31.
- Atomicité SQLite : tous les importeurs et `aligner.py` wrappés dans `try/except/rollback` — v0.1.31.
- Plafond 512 MiB sur tous les importeurs (DOCX, TEI, ODT, TXT, CoNLL-U) — v0.1.31.

## Audit externe (2026-04-19 — 33 findings)

Un audit externe a été conduit le 2026-04-19 et a identifié 33 vulnérabilités (C-01 à F-05).
Toutes ont été corrigées dans les commits `audit-3` à `audit-14` et livrées en v0.1.31.
Référence : `docs/AUDIT_2026-04-19.md`. Tous les tickets GitHub associés sont fermés.

## Token lifecycle policy

### Generation
- Wrappers must use `--token auto` by default.
- Wrappers must not use a hard-coded token in production flows.

### Rotation
- Rotate token on every sidecar process restart (automatic with `--token auto`).
- Force rotation when:
  - switching active DB,
  - recovering from stale portfile/crash,
  - explicit "reset connection" action in wrapper.

### Expiry
- Token validity is process-bound: it expires when sidecar exits.
- Wrapper policy (recommended):
  - treat token as expired after 8 hours of continuous session,
  - restart sidecar to issue a fresh token.

### Storage and handling
- Token is read from `.agrafes_sidecar.json` and kept in memory only.
- Do not persist token in app settings, telemetry, or crash exports.
- Do not display token in UI, logs, or clipboard flows.

## Wrapper secure defaults (Tauri / shell)

- Always spawn with:
  - `--host 127.0.0.1`
  - `--port 0`
  - `--token auto`
- Always send `X-Agrafes-Token` to write endpoints.
- Never send token to read endpoints unless harmlessly centralized by a common client.
- On `401 UNAUTHORIZED`:
  1. re-read sidecar state (`multicorpus status --db ...`),
  2. if stale/missing, restart sidecar,
  3. retry once with refreshed token.
- On logout/profile switch (if applicable), restart sidecar to clear runtime token.

## Operational guidance

- Prefer one sidecar per DB path.
- If suspicious behavior is detected:
  - stop sidecar (`/shutdown` or `multicorpus shutdown --db ...`),
  - remove stale portfile if needed,
  - relaunch with `--token auto`.
- Keep this posture aligned with OpenAPI/contract tests when token-protected
  endpoints evolve.

## Future hardening backlog (explicitly not in current scope)

- Per-endpoint scope tokens.
- Time-based token expiry enforced server-side.
- Optional loopback mTLS / OS credential-bound auth.
- Audit trail enrichment for rejected token attempts.
