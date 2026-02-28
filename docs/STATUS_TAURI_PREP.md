# Status — Concordancier Prep (tauri-prep) V0

**Last updated:** 2026-02-28

---

## Done

- [x] `GET /documents` added to sidecar (lists all docs with unit_count)
- [x] `POST /align` added to sidecar (strategies: external_id / position / similarity)
- [x] OpenAPI spec updated (DocumentRecord, DocumentsResponse, AlignRequest, AlignResponse)
- [x] 5 new tests for /documents and /align (contract + error cases)
- [x] `docs/CHARTER_TAURI_PREP_AGENT.md` created
- [x] `docs/BACKLOG.md` updated with tauri-prep V0/V0.1/V1 items
- [x] `tauri-prep/` scaffold created (package.json, vite.config.ts, tsconfig.json, index.html)
- [x] `tauri-prep/src/lib/sidecarClient.ts` — Conn, ensureRunning, all API calls
- [x] `tauri-prep/src/lib/db.ts` — getOrCreateDefaultDbPath, current DB path helpers
- [x] `tauri-prep/src/screens/ProjectScreen.ts` — DB open/create, sidecar status, shutdown
- [x] `tauri-prep/src/screens/ImportScreen.ts` — batch import (2 concurrent), index button, log
- [x] `tauri-prep/src/screens/ActionsScreen.ts` — curate/segment/align with confirmation + doc selector
- [x] `tauri-prep/src/app.ts` — tab nav (Project | Import | Actions)
- [x] `tauri-prep/src/main.ts` — entry point
- [x] `tauri-prep/src-tauri/` — tauri.conf.json, Cargo.toml, build.rs, src/main.rs, capabilities/default.json
- [x] `tauri-prep/src-tauri/binaries/.gitkeep`
- [x] `tauri-prep/scripts/prepare_sidecar.sh` + `.ps1`
- [x] `tauri-prep/README.md` — dev launch instructions
- [x] Open in Concordancier helpers (copy DB path + workflow instructions modal)

## Confirmed green

- [x] pytest: **118 tests passing**, 0 failures (1 test fixed: `relation_type` not accepted by `align_by_external_id`)

## Next 3 tasks (V0.1)

1. Job polling in ImportScreen — poll `GET /jobs/<id>` for async index jobs
2. Progress bar on batch import — track n/total imported
3. Alignment audit view in ActionsScreen — show aligned pairs table after align

---

## Tests count

| Milestone | Tests |
|-----------|-------|
| V2.1 (entry this session) | 114 |
| After /documents + /align | +4 → 118 (confirmed) |
