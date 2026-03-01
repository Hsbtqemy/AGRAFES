# Status — Concordancier (tauri-app) V0 → V1

**Last updated:** 2026-03-01 (V1.1: query builder guards + parallel KWIC + virtualised hits)

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

### V1.1 — Query builder + Parallel KWIC (Sprints 2.2/2.3)

- [x] Filter drawer: language/doc_role/resource_type dropdowns from `GET /documents`
- [x] Query builder: "✏ Requête" button → modes simple/phrase/and/or/near; `buildFtsQuery(raw)` → FTS5
- [x] Safety guards: `isSimpleInput(raw)` bypasses transformation if AND/OR/NOT/NEAR/" detected
  NEAR guard: requires ≥2 tokens; phrase: escapes internal `"` → `'`; `#builder-warn` div (4s)
- [x] JS tests: `tauri-app/scripts/test_buildFtsQuery.mjs` (26 tests, node-only)
- [x] Parallel KWIC: "Parallèle" toggle (visible only when Alignés=ON)
  `renderParallelHit()`: 2-column grid (pivot left, aligned right); collapse >5 → "Voir plus"

### V2.4 — Virtualised Hits List (Sprint 2.4)

- [x] CSS layer: `content-visibility: auto; contain-intrinsic-size: auto 160px;` on `.result-card`
  Browser-native virtualization: skips layout/paint for off-screen cards, zero JS cost
- [x] JS DOM cap: `VIRT_DOM_CAP = 150` — `renderResults()` keeps at most 150 cards in DOM
  When `hits.length > cap`, a `.virt-top-info` banner shows "▲ N résultats précédents non affichés"
  `state.hits` retains full list; IntersectionObserver + "Charger plus" unchanged

## Confirmed green

- [x] npm build: green (tauri-app bundle ~43 kB)
- [x] JS unit tests: 26/26 passing (`node tauri-app/scripts/test_buildFtsQuery.mjs`)

## Next tasks (V1.x)

1. Concordancier V1: metadata panel (doc title/lang/role/resource_type/units side panel)
2. Concordancier V1: demo corpus (bundled small multilingual corpus on first run)
3. Concordancier V1: accessible keyboard navigation + ARIA labels

---

## Tests

No automated frontend tests (plain TS, no test harness).
Validated by manual smoke + sidecar fixture CI.
