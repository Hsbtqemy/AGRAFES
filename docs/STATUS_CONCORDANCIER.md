# Status — Concordancier (tauri-app) V0 → V1

**Last updated:** 2026-03-01 (V1.0: virtualisation auto-scroll Sprint 2.1)

---

## Done

### V0 — Search-first concordancier

- [x] `tauri-app/` scaffold (Tauri v2, Vite+TS, port 1420)
- [x] Sidecar auto-start on DB open (`ensureRunning`, portfile discovery)
- [x] Search bar: segment / KWIC toggle + window slider
- [x] Filter drawer: language, doc_role, doc_id
- [x] Aligned / parallel view (`include_aligned=true`) with per-hit toggle
- [x] Aligned groups rendered by doc (language + title header)
- [x] Import modal: file picker, mode, language, title
- [x] "Open DB…" button (switches corpus, restarts sidecar)
- [x] Status dot (idle / starting / ready / error)
- [x] Status bar (DB path + sidecar state)

### V0.2 — Pagination

- [x] `/query` supports `limit` / `offset` / `has_more` / `next_offset`
- [x] "Charger plus" button for subsequent pages
- [x] Page limits: 50 (segment) / 20 (aligned mode)

### V1.0 — Virtualisation / IntersectionObserver (Sprint 2.1)

- [x] Sentinel element at bottom of results area
- [x] `IntersectionObserver` triggers `doLoadMore()` when sentinel enters viewport
- [x] Guard: no duplicate fetch while `loadingMore` or when `!hasMore`
- [x] "Charger plus" button retained as manual fallback
- [x] Sentinel hidden when no more pages (prevents spurious triggers)

## Confirmed green

- [x] npm build: green (tauri-app bundle ~34 kB)

## Next tasks (V1.x)

1. Metadata panel (doc-level info: title, language, role, resource_type, unit count)
2. Advanced search UI (phrase, AND/OR, NEAR, wildcard)
3. Parallel KWIC "clean" (stack pivot + aligned in KWIC mode)
4. Corpus demo dataset (bundled fixture for first-run onboarding)

---

## Tests

No automated frontend tests (plain TS, no test harness).
Validated by manual smoke + sidecar fixture CI.
