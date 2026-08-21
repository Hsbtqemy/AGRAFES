# Sidecar API Contract (v1.6.29)

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

Three **independent** version fields surface in sidecar responses — do not conflate them
(all but the engine version are defined in `sidecar_contract.py`):

| Field | Backed by | Meaning | Where it appears |
|---|---|---|---|
| `api_version` | `API_VERSION` | Runtime version of the sidecar **API implementation**. | every response envelope; `/openapi.json` → `info.version`; TMX export provenance |
| `version` (envelope) | `API_VERSION` | In the **generic envelope**, identical to `api_version`. **Exception:** on `/health` it is overridden with the **engine package version** (`ENGINE_VERSION` = `multicorpus_engine.__version__`). | response envelope; `/health` (engine version) |
| `contract_version` / `x-contract-version` | `CONTRACT_VERSION` | Semver of the **API contract surface** (endpoints + payload shapes). Bumped on any contract change, enforced by the contract-freeze CI gate, and carries a per-version changelog in `sidecar_contract.py`. | `/health` (`contract_version`); `/openapi.json` (`x-contract-version`); TEI package provenance |

**Source of truth for "which contract does this build speak" = `CONTRACT_VERSION`.**

> ⚠️ **Known drift (D-06).** `API_VERSION` (`1.6.23`) lags `CONTRACT_VERSION` (`1.6.27`):
> the `API_VERSION` bump was skipped for the contract changes 1.6.24–1.6.27. The two
> share a numbering scheme and were historically bumped together. Until reconciled, rely
> on `CONTRACT_VERSION` for contract identity; `api_version` is the loosely-maintained
> implementation version. Reconciliation options (separate ticket — touches the response
> envelope ⇒ requires `export_openapi.py` regen + contract-freeze): bump both in lockstep,
> or derive `api_version` from `CONTRACT_VERSION` (single source).

## Response envelope

### Success

```json
{
  "ok": true,
  "api_version": "1.6.23",
  "version": "1.6.23",
  "status": "ok"
}
```

### Error

```json
{
  "ok": false,
  "api_version": "1.6.23",
  "version": "1.6.23",
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
- Wrapper baseline:
  - spawn sidecar with `--host 127.0.0.1 --port 0 --token auto`
  - keep token in memory only (no long-term persistence)
  - rotate token by restarting sidecar on DB switch/recovery
- Token-protected write endpoints:
  - `POST /import`
  - `POST /import-remote`
  - `POST /annotate`
  - `POST /index`
  - `POST /db/backup`
  - `POST /corpus/info`
  - `POST /tokens/update`
  - `POST /models/download`
  - `POST /models/remove`
  - `POST /shutdown`
- Read endpoints (`/health`, `/query`, `/token_query`, `/token_stats`, `/token_collocates`, `/webdav/list`, `/models`, `/openapi.json`) do not require token.
- Threat model and operational policy: `docs/SIDECAR_SECURITY_POSTURE.md`.

## Required endpoints (persistent UX baseline)

- `GET /health`
  - returns `ok/status/version/contract_version/pid/started_at/host/port/portfile/token_required`
- `POST /query`
  - same search semantics as CLI query
  - request body (all optional except `q`):
    - `q: string`
    - `mode: "segment"|"kwic"` (default `segment`)
    - `window: int` (default `10`, KWIC only)
    - `language`, `doc_id`, `resource_type`, `doc_role`
    - `db_paths: string[]` (optional, fédération multi-DB dans une seule requête)
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
    - if `db_paths` is provided:
      - response includes `federated: true`, `db_paths`, `db_count`
      - each hit includes provenance fields:
        - `source_db_path`, `source_db_name`, `source_db_index`
- `POST /token_query`
  - token-level query with CQL parser (Sprint C + D backend):
    - fixed sequence of token clauses: `[...][...]`
    - wildcard token: `[]`
    - quantifiers: `[]{0,N}`, `[token]{m,n}`, `[token]{k}`
    - trailing sentence constraint: `within s`
    - terminal `;` accepted (optional)
    - supported attrs: `word`, `lemma`, `pos` (`upos`)
    - regex values supported (`"liv.*"`)
    - case-insensitive flag per predicate: `%c`
    - boolean `&` inside one token clause
  - request body:
    - `cql: string` (required)
    - `mode: "kwic"|"segment"` (default `kwic`)
    - `window: int` (default `10`, min `0`)
    - `language?: string`
    - `doc_ids?: int[]`
    - `limit: int` (default `50`, min `1`, max `200`)
    - `offset: int` (default `0`, min `0`)
    - `include_context_segments: bool` (default `false`) — if `true`, each hit includes `prev_segment` and `next_segment`
  - response:
    - same pagination envelope as `/query`: `run_id`, `count`, `hits`, `limit`, `offset`, `next_offset`, `has_more`, `total`
    - each hit includes:
      - parent unit metadata (`doc_id`, `unit_id`, `unit_n`, `external_id`, `language`, `title`)
      - token span metadata (`sent_id`, `start_position`, `end_position`)
      - `tokens[]` (matched token sequence)
      - `context_tokens[]` (windowed neighboring tokens)
      - `kwic`: `left/match/right` when `mode=kwic`
      - `segment`: `text` + `text_norm` when `mode=segment`
      - `prev_segment?`: `{ unit_id, external_id, text_norm }` — segment preceding the hit unit (only if `include_context_segments=true` and exists)
      - `next_segment?`: `{ unit_id, external_id, text_norm }` — segment following the hit unit (only if `include_context_segments=true` and exists)

- `POST /token_stats`
  - frequency distribution of a token attribute over CQL hits; no auth token required
  - request body:
    - `cql: string` (required) — same CQL syntax as `/token_query`
    - `group_by: "lemma"|"upos"|"xpos"|"word"|"feats"` (default `"lemma"`)
    - `language?: string`
    - `doc_ids?: int[]`
    - `limit: int` (default `50`, max `200`) — max rows returned
  - response:
    - `total_hits: int` — number of matched token sequences
    - `total_pivot_tokens: int` — total tokens across all pivot spans
    - `group_by: string` — echoed
    - `rows[]` — sorted descending by count:
      - `value: string`
      - `count: int`
      - `pct: float` — percentage of total_pivot_tokens (0–100)

- `POST /token_collocates`
  - collocation analysis for a CQL query; no auth token required
  - request body:
    - `cql: string` (required)
    - `window: int` (default `5`, range 1–20) — context window on each side of pivot
    - `by: "lemma"|"word"|"upos"|"xpos"` (default `"lemma"`)
    - `language?: string`
    - `doc_ids?: int[]`
    - `limit: int` (default `50`, max `200`)
    - `min_freq: int` (default `2`) — minimum observed frequency to include a collocate
    - `sort_by: "pmi"|"ll"|"freq"` (default `"pmi"`)
  - response:
    - `total_hits: int` — number of CQL matches processed
    - `total_window_tokens: int` — total collocate tokens collected across all windows
    - `corpus_size: int` — total tokens in corpus (baseline for PMI/G²)
    - `window: int` — echoed
    - `by: string` — echoed
    - `rows[]` — sorted by `sort_by`:
      - `value: string`
      - `freq: int` — observed collocate frequency across all windows
      - `left_freq: int` — occurrences in left window
      - `right_freq: int` — occurrences in right window
      - `corpus_freq: int` — corpus-wide frequency of the collocate
      - `pmi: float` — Pointwise Mutual Information (log₂)
      - `ll: float` — Log-likelihood G² score

### Pagination policy (V0.2)

- Sidecar computes pagination with `LIMIT limit+1` to derive `has_more` without a full `COUNT(*)`.
- `total` is intentionally `null` in V0.2 (no expensive global count query by default).
- `include_aligned` enrichment is applied only to the current page hits.
- `POST /index`
  - full rebuild by default; optional incremental mode with body `{ "incremental": true }`
  - full mode returns: `run_id`, `units_indexed`, `incremental=false`
  - incremental mode returns: `run_id`, `units_indexed`, `incremental=true`, `inserted`, `refreshed`, `deleted`
  - returns `401` if token is active and header is missing/invalid
- `POST /import`
  - JSON body:
    - `mode`: `docx_numbered_lines|txt_numbered_lines|docx_paragraphs|odt_paragraphs|odt_numbered_lines|tei|conllu`
    - `path`: source file path
    - `language` required except TEI mode
    - optional: `title`, `doc_role`, `resource_type`, `tei_unit`
    - optional `column_index` (integer ≥ 1) — **`mode=docx_numbered_lines` only**. Extracts the cell at this column (1-based) of every table in the body, paragraphs flattened. Default null = tables ignored (legacy). Ignored silently for other modes.
  - returns `run_id` + importer report (`doc_id`, unit counts, warnings, plus `tables_processed`/`rows_skipped_short`/`nested_tables_skipped` when `column_index` was set)
  - returns `401` if token is active and header is missing/invalid
- `POST /import/preview`
  - read-only: parses source file without writing to DB
  - JSON body: `path`, `mode`, optional `limit` (default 100)
  - `mode=conllu` → returns `conllu_stats` (sentence/token counts + sample rows)
  - `mode=txt_numbered_lines|docx_numbered_lines|docx_paragraphs|odt_numbered_lines|odt_paragraphs|tei` → returns `units` (array of `{n, external_id, unit_type, text_raw}`), `units_total`, `truncated`
  - no token required
- `POST /webdav/list` — browse a WebDAV folder (ShareDocs ingestion, Phase 2)
  - read-only PROPFIND (`Depth: 1`); **no token**, dispatched **lock-free** (never blocks DB writes)
  - body: `{ url, auth?: { mode: anonymous|basic|bearer, user?, password?, token? } }`
  - response: `{ entries: [{ name, href, is_dir, size, modified, content_type }] }` (the folder's own self entry is excluded)
  - errors: `401` WebDAV auth failed · `404` folder not found · `502` upstream network/protocol error
  - **credentials are loopback-only and never persisted** (not in DB / runs.params / logs / telemetry)
- `POST /import-remote` (token required) — batch-ingest a WebDAV folder (ShareDocs ingestion, Phase 2)
  - **asynchronous**: enqueues a `JobManager` job and returns `{ job }` (202); poll `GET /jobs/<id>` for per-file progress + the final batch report
  - body: `{ url, mode, language?, include?, hrefs?, auth?, doc_role?, resource_type?, max_file_mb? }` (`mode` = same values as `/import`)
  - `language` is **required for every mode except `tei`** (rejected with `400` otherwise — mirrors the CLI `import-remote` guard); `max_file_mb` null/absent → default 200 MiB cap
  - `hrefs?` (array, P4C, since 1.6.29) — explicit file selection: the batch is restricted to these hrefs, **intersected with the folder PROPFIND listing** (an unlisted href is ignored, never fetched) and **bypasses the `include` glob**. When provided it must be a **non-empty** array of strings (else `400`). Omit to import the whole folder.
  - per file the *download* runs outside the write-lock; only the DB section (dedup + import + provenance) is serialized under it
  - batch report per file: `status ∈ {imported, skipped-duplicate, skipped-filtered, skipped-oversize, error}`, `source_url`, `doc_id`, `run_id`, `source_hash`, counts
  - **credentials (`auth`) are NEVER placed in the job params** (which `/jobs/<id>` exposes) nor persisted anywhere — captured in the runner closure, memory only
  - returns `401` if token is active and header is missing/invalid
- spaCy model management (on-demand download, Phase 2)
  - `GET /models` (`?language=`) — catalog of the supported models + availability (**no token**; filesystem-only → dispatched **lock-free**, never blocks DB writes). The catalogue is the static extended set (sm/md/lg per language); optional `?language=` filters to one base code. Each item carries a tri-state `source` ∈ `bundled` (embedded in the app binary, read-only) / `downloaded` (in the user models dir, removable) / `absent` (offered for download), plus `genre` / `size_class` / `approx_size_mb` parsed from the name; `installed` (== downloaded) is kept for back-compat. The **install** allowlist (`/models/download`) is the live `compatibility.json` catalogue + a strict name regex (offline fallback = pinned set).
  - `POST /models/download` (token required) — **asynchronous**: enqueues a `JobManager` job and returns `{ job }` (202); poll `GET /jobs/<id>` for progress. Body `{ model }` (name restricted to a fixed **allowlist**, else `400`). Downloads the wheel from the official Explosion GitHub releases (https) into the shared user models dir.
  - `POST /models/remove` (token required) — body `{ model }`; `404` if the model is not installed, `400` if it is a bundled (read-only) model
  - `POST /models/active` (token required) — body `{ language, model }`; sets the active model for a base language **in the current corpus** (`corpus_info.meta_json`). The model must be for that language (or multilingual `xx`) and available (bundled/downloaded), else `400`. Annotation uses it unless `/annotate` is given an explicit `model`. Writes the DB → dispatched under the write lock.
- `POST /shutdown`
  - graceful server stop
  - returns `shutting_down: true`
  - returns `401` if token is active and header is missing/invalid
- `POST /telemetry` (no token — fire-and-forget local-only)
  - body: `{ event: <string>, ...payload }` — `event` required and non-empty.
  - appends `{ts, event, ...payload}` à `<db_dir>/.agrafes_telemetry.ndjson`. Reserved keys (`ts`, `event`, `db_path`, `event_name`) stripped from payload before persistence.
  - returns `204 No Content` toujours, même en cas d'échec d'écriture (telemetry ne doit jamais bloquer le caller).
  - **non token-protected** par design : loopback-only + impact maximal d'un attaquant local = polluer le NDJSON. Cf. note de sécurité dans `_handle_telemetry`.

## Additional endpoints (already available)

- `GET /openapi.json`
- `GET /documents`
- `GET /documents/preview?doc_id=N&limit=M`
- `GET /documents/stats?doc_id=N`
  - per-doc stage stats for the canvas state strip (refonte R1.2): `line_count`, `structure_count`, `external_id_count`, `parent_count` (from `meta_json.parent_n`), `aligned_count`, `max_text_len`, `avg_text_len`.
  - `doc_id` required. Read-only; no auth token required. 400 on bad/missing `doc_id`, 404 on unknown document.
- `GET /units?doc_id=N[&unit_type=line]`
  - returns all units for a document: `unit_id`, `n`, `text_norm`, `unit_type`, `unit_role` (nullable).
  - `doc_id` required, `unit_type` optional filter. Read-only; no auth token required.
- `GET /tokens?doc_id=N&unit_id=M&limit=L&offset=O`
  - returns token rows for manual annotation edits.
  - `doc_id` required, `unit_id` optional (restrict to one unit).
  - response: `tokens[]`, `count`, `total`, `limit`, `offset`, `next_offset`, `has_more`.
- `POST /tokens/update`
  - body: `{ token_id, word?, lemma?, upos?, xpos?, feats?, misc? }` (token required)
  - updates one token row and returns `{ updated: 1, token }`.
- `GET /unit/context?unit_id=N` — (Sprint I) Returns local document context around a line unit: `doc_id`, `unit_id`, `unit_index` (1-based), `total_units`, `prev` / `current` / `next` (each `{ unit_id, text }` or `null`). Read-only; 404 if unit not found or not a line unit.
- `GET /doc_relations?doc_id=N`
- `POST /curate`
- `POST /curate/preview`
- `POST /align`
  - body: `{ pivot_doc_id, target_doc_ids, strategy?, sim_threshold?, debug_align?, replace_existing?, preserve_accepted?, run_id? }`
  - `strategy` values: `external_id` (default), `position`, `similarity`, `external_id_then_position` (hybrid), `length_bounded` (two-tier Gale–Church, R3.2)
  - `sim_threshold` only applies to `similarity` (range `[0.0, 1.0]`)
  - `debug_align` (bool, default false) adds optional `report.debug` diagnostics payload
  - `replace_existing` (bool, default `false`): clear previous links for the same pivot/target scope before running.
  - `preserve_accepted` (bool, default `true`): with `replace_existing=true`, keep `status='accepted'` links and protect them from being rewritten.
  - response includes `run_id`, `total_links_created`, and when recalc is used:
    - `deleted_before`, `preserved_before`, `total_effective_links`
  - each report includes `links_created` and `links_skipped`
  - align responses are persisted in `runs` (`kind=align`, stats include `strategy`, `pairs`, debug payload when enabled)
- `POST /align/audit`
- `POST /align/matrix` — matrice multilingue ancrée-source **en JSON** (même projection que `/export/matrix` mais renvoyée dans la réponse — `{ headers, rows, languages, hub_doc_id }` — pour l'affichage de la grille d'alignement, au lieu d'écrire un CSV). Read-only, no token. (contrat 1.6.53) Champs additifs non schématisés : `hub_unit_ids`/`language_doc_ids` (3a), `cell_links` (1.6.54, liens rejetés exclus), puis (1.6.56, D-W8/D8/D-W14) `hub_unit_statuses` + `cell_statuses` (les deux axes de statut ; cellule omise = token `[non traduit]`), `addition_rows` (unités `unit_status='ajout'` tissées en lignes de flux — aussi dans le CSV `/export/matrix`) et `uncovered` (par colonne, unités cible sans lien actif ni statut — le panneau « ＋ Ajout »), puis (1.6.67) `hub_text_norms` (∥ `rows`, `null` sur une ligne d'ajout) et `target_text_norm` dans chaque item de `cell_links`, puis (1.6.69) `text_norm` dans les items d'`uncovered`. **Depuis 1.6.69 la projection EST `text_norm`** — `rows`, les cellules, les lignes d'ajout et les tranches de coupe viennent toutes du plan que l'aligneur, la FTS et la curation utilisent (ALI-01) ; les offsets de coupe indexent ce même plan. `target_text_raw` demeure dans la charge utile comme **plan verbatim d'origine** (provenance, D-C1), il n'est plus ni affiché ni tranché. `hub_text_norms` reste l'**espace d'édition** explicite dont le stylo s'amorce — redondant avec `rows` par construction, et volontairement : c'est leur confusion qui avait laissé une seconde correction écraser la première.
- `POST /align/run/undo` (token required) — **ALI-17** revert one alignment run. Body: `{ run_id }`. Drops the links the run created (`alignment_links.run_id`, indexed by migration 036) and restores the ones it purged from `align_run_purge`, **identical** (original `link_id` and `src_run_id` archived). Links the run created but a human reviewed since (`status` set) are **kept**, not deleted, and reported: a blanket refusal was disproportionate (measured 2 runs out of 9, over 2 and 1 links out of 1226). A kept link keeps occupying its `(pivot_unit_id, target_unit_id)` pair, so the matching restitution skips itself and is counted. Response: `{ run_id, links_deleted, links_kept, links_restored, links_not_restored, reason }`. `404` unknown run; `400` not an align run / nothing to revert; **`409` superseded** — a later run already replaced that pair's links, restoring would superpose a generation (the very accumulation ALI-17 describes): revert that one first. Only `replace_existing=true` runs archive anything; a « compléter » run costs zero storage. Migration 036.
- `POST /align/quality`
- `GET /align/source_changed_summary` — résumé global des liens dont la source pivot a changé depuis l'alignement (`source_changed_at` non nul). Réponse : `{ total, docs: [{target_doc_id, target_title, count}] }`. Read-only, no token. Alimente la bannière d'accueil d'AlignPanel.
- `POST /align/link/create` — accepte `op_id` / `label` et les rend (D-3, 1.6.70)
- `POST /align/link/update_status` — archivé et annulable ; accepte `op_id` / `label` et les rend (D-3, 1.6.70)
- `POST /align/link/delete` — archive le lien avant de le détruire ; accepte `op_id` / `label` et les rend (D-3, 1.6.70)
- `POST /align/link/retarget` — archivé et annulable ; accepte `op_id` / `label` et les rend (D-3, 1.6.70)
- `POST /align/link/acknowledge_source_change`
- `POST /align/links/batch_update`
- `POST /align/links/batch_undo` — annule un geste de lot archivé (D-3, 1.6.70 ; token requis, détail ci-dessous)
- `POST /align/cell_status` — statut par cellule « non traduit » sur la paire (unité moyeu × doc cible) (1.6.56, D-W8 ; token requis, détail ci-dessous)
- `POST /align/retarget_candidates`
- `POST /align/collisions`
- `POST /align/collisions/resolve`
- `POST /documents/update`
- `POST /documents/bulk_update`
- `POST /documents/delete`
  - body: `{ doc_ids: int[] }` (non-empty list, token required)
  - suppression en cascade : alignment_links → units → doc_relations → units_fts → documents
  - response: `{ ok: true, deleted: int, doc_ids: int[] }`
- `POST /doc_relations/set`
- `POST /doc_relations/delete`
- `POST /export/tei`
  - body: `{ out_dir, doc_ids?: int[], include_structure?: bool }` (token required)
  - `include_structure` (default `false`): if `true`, emits `<head>` elements for structure units
  - CONTRACT_VERSION 1.3.1: added `include_structure` optional boolean field (backward-compatible)
- `POST /export/conllu`
  - body: `{ out_path, doc_ids?: int[] }` (token required)
- `POST /export/token_query_csv`
  - body: `{ out_path, cql, mode?, window?, language?, doc_ids?, delimiter?, max_hits? }` (token required)
- `POST /export/ske`
  - body: `{ out_path, doc_ids?: int[] }` (token required)
- `POST /export/align_csv`
- `POST /export/matrix` — matrice multilingue ancrée-source (une ligne par segment hub, une colonne par langue ; coupes + concat des beads appliqués) (token required)
  - **1.6.56** : le CSV écrit `rows` verbatim et hérite donc de la projection — une cellule omise volontairement porte le token `[non traduit]` (D10, au lieu d'une cellule vide), et une unité de traduction `unit_status='ajout'` **non liée** ajoute une **ligne de flux** à sa position de lecture (colonnes `paragraphe`/`segment` vides, `[ajout]` dans la colonne moyeu, son texte dans sa colonne de langue — D8). Une ligne du CSV n'est donc plus forcément un segment moyeu, et la colonne `segment` n'est plus toujours un entier.
- `POST /export/run_report`
- `POST /db/backup`
  - body: `{ out_dir?: string, out_path?: string }` — `out_dir` and `out_path` are mutually exclusive
  - without `out_path`: creates a timestamped backup file (`<db_stem>_<YYYYMMDD_HHMMSS><db_suffix>.bak`) in `out_dir` (default: DB directory); appends `_<n>` on collision
  - with `out_path`: writes to the exact path given (e.g. `corpus.db`); returns 409 if file already exists
  - returns `source_db_path`, `backup_path`, `file_size_bytes`, `created_at`
- `GET /corpus/info`
  - returns `corpus`: `{ title?, description?, meta? (object), updated_at? }` — métadonnées de la base (une ligne par DB)
- `POST /corpus/info` (token required when enabled)
  - body (partiel): `{ title?, description?, meta? }` — seuls les champs présents sont mis à jour ; `meta` remplace l’objet entier si fourni
- `GET /corpus/audit`
  - returns a health report for the corpus (no params needed):
    - `total_docs` — total number of documents
    - `total_issues` — sum of all detected issues
    - `missing_fields` — list of `{ doc_id, title, missing: string[] }` where `missing` contains any of `title`, `language`, `doc_role`
    - `empty_documents` — list of `{ doc_id, title }` for documents with 0 imported units
    - `duplicate_hashes` — list of `{ hash_prefix, doc_ids }` grouping documents with identical content
    - `duplicate_filenames` — list of `{ filename, doc_ids }` grouping documents with the same source filename (case-insensitive)
    - `duplicate_titles` — list of `{ title, doc_ids }` grouping documents with the same title (case-insensitive)
- `POST /validate-meta`
- `POST /segment`
  - body: `{ doc_id, lang?, pack?, preset?, spec? }`
  - `pack` values: `auto` (default), `default`, `fr_strict`, `en_strict`
  - **R5.4a — configurable segmentation** (additive, optional): `preset` ∈ `{phrases, mots, balises}` or `spec` (a `SegmentSpecInput` — `{ kind: terminator|whitespace|markers, terminators?, require_uppercase_after?, protect_abbreviations?, label? }`) override the legacy `lang`/`pack` path. `spec` wins over `preset`; absent → byte-identical historical sentence split. A `markers`-kind spec resegments on `[N]` markers (no undo, as the marker path elsewhere). Engine: `segmenter.SegmentSpec` / `split_unit_text` / `spec_from_dict`. No persistence/migration.
  - response includes `segment_pack` (resolved pack, or the spec's `label`, actually used)
- `POST /segment/coarse` (token required) — **R5.4c** ascendant coarse regrouping (non-destructive): relabel `meta_json.parent_n` on the doc's line units by a coarse boundary. Body: `{ doc_id, preset?, pattern? }` — `preset` ∈ `{tours}` (a line opening with a dialogue dash `—`/`–` starts a coarse block) or a custom line-start `pattern` regex (e.g. a speaker label); `pattern` wins over `preset` (default `tours`). No resegmentation → the fine units, `alignment_links` and FTS are untouched; idempotent, **undoable** (Mode A, `action_type=set_paragraph` — same key moved, same undo path as the per-segment gesture; the action's description carries the scope). Response: `{ doc_id, blocks, units_grouped, units_changed, action_id }` (`action_id` null when nothing changed). No migration (`parent_n` in `meta_json`).
- `POST /segment/paragraph_boundary` (token required) — **R6** manual paragraph boundary: toggle one line segment as a paragraph start (or remove it when it already heads a multi-segment block). Body: `{ doc_id, unit_id }` (identified by `unit_id`, not the position-based `n`). Relabels `meta_json.parent_n` a block at a time — designating a segment regroups the run since the previous boundary **and** absorbs the tail up to the next one (a single gesture); re-toggling a real boundary merges its block upward. Text-scope only (paratext `n < text_start_n` excluded); non-destructive (only `parent_n` moves), idempotent, undoable (Mode A, `action_type=set_paragraph`). Response: `{ doc_id, unit_id, unit_n, units_changed, blocks, action_id }` (`action_id` null when nothing changed). No migration (`parent_n` in `meta_json`).
- `POST /units/merge` — merge two adjacent units into one; body: `{ doc_id, n1, n2 }` (n2 must be n1+1). Réponse : `{ doc_id, merged_n, deleted_n, text, fts_stale, action_id, links_archived }` — `links_archived` (1.6.68) est le nombre de liens d'alignement que le geste a détruits **et archivés** (migration 035, donc rendus par `/prep/undo`). Compté après coup, pas confirmé avant : une confirmation fondée sur l'`aligned_count` du document annoncerait une perte qui n'est pas celle qui va avoir lieu.
- `POST /units/split` — split one unit into two; body: `{ doc_id, unit_n, text_a, text_b }`. Réponse : `{ doc_id, unit_n, new_unit_n, text_a, text_b, fts_stale, action_id, links_archived }` (`links_archived` : voir `/units/merge`).
- `POST /prep/undo/eligibility` (read-only, no token) — return the latest undo-able action for a doc; body: `{ doc_id }`. Response: `{ eligible, reason?, action_id?, action_type?, description?, performed_at?, warnings? }`. `action_type` ∈ `{curation_apply, merge_units, split_unit, resegment, update_text, set_role, set_paragraph}` (the CHECK of migration 034 also allows `undo`, which is never returned as eligible). `reason` ∈ `{no_action, no_snapshots, structural_dependency, unit_diverged, latest_already_reverted}`.
- `POST /prep/undo` (token required) — atomically revert the latest undo-able action of a doc; body: `{ doc_id }`. Response: `{ undo_action_id, reverted_action_id, reverted_action_type, units_restored, alignments_reflagged, alignments_restored, alignments_restore_skipped, fts_stale }` — `alignments_restored` are links put back from the action's archive (migration 035, ALI-03); `alignments_restore_skipped` are archived links whose `(pivot_unit_id, target_unit_id)` pair was re-occupied since (a re-align between the action and its undo): they are left alone and counted, never clobbered. Returns 409 with `code=BAD_REQUEST` and message `Undo not eligible: <reason>` when ineligible. Forward-only — actions recorded before migration 019 are not undo-able.
- `POST /units/set_role` (token required) — assign a convention role to one unit; body: `{ doc_id, unit_n, role }` (role=null to clear)
- `POST /units/bulk_set_role` (token required) — batch assign a convention role; body: `{ doc_id, unit_ns, role }`
- `POST /units/set_status` (token required) — set the translation status of one unit (R4.1); body: `{ doc_id, unit_n, status }` where `status` ∈ `{non_traduit, ajout}` or null to clear. Orthogonal to `unit_role`.
- `POST /units/bulk_set_status` (token required) — batch set translation status; body: `{ doc_id, unit_ns, status }` or `{ unit_ids, status }`
- `POST /units/update_text` (token required) — update text_raw and/or text_norm for one unit; body: `{ unit_id, text_raw?, text_norm? }` (if only text_raw given, text_norm is mirrored; FTS updated automatically) Réponse : `{ unit_id, doc_id, n, external_id, text_raw, text_norm, cut_spans_cleared }` — `cut_spans_cleared` (1.6.69, décision D-1) est le nombre de fenêtres de coupe que la correction a dissoutes : les offsets indexent `text_norm`, que l'édition réécrit. La portée est l'**unité** (une coupe répartit une phrase sur plusieurs lignes moyeu), donc la valeur peut dépasser 1 ; 0 dans le cas courant.
- `POST /lift/markers` (token required) — lift a document's inline peritext markers (`[T]`/`[Ch]`/`[InterT]`/`[non traduit]`/`[+]`) into `unit_role`/`unit_status`, stripping them from `text_norm` (R4.2); body: `{ doc_id, dry_run? }` (`dry_run` defaults true → report only). Returns a lift report (units_affected, roles_set, statuses_set, cleaned, conflicts, changes).
- `GET /conventions` — list convention roles for this corpus
- `POST /conventions` (token required) — create a role; body: `{ name, label, color?, icon?, sort_order? }`
- `PUT /conventions/{name}` (token required) — update a role; body: `{ label?, color?, icon?, sort_order? }`
- `POST /conventions/delete` (token required) — delete a role; body: `{ name }` (assigned units become NULL)
- `GET /tags` — **R6.2** list document tags (namespaced N-N labels); `?doc_id=N` → that document's `{kind,value}` tags (Prep picker); without → distinct `{kind,value}` across the corpus (filter autocomplete). Read-only.
- `POST /documents/tags/add` (token required) — **R6.2** attach a label to a document; body: `{ doc_id, kind, value }` (idempotent, `INSERT OR IGNORE`).
- `POST /documents/tags/remove` (token required) — **R6.2** remove a label; body: `{ doc_id, kind, value }`; returns `{ deleted }` (absent → 0). Also: `POST /query` + `POST /query/facets` gain an additive `tags` filter (`[{kind,value}]`; a doc matches ANY pair — OR).
- `POST /documents/set_text_start` (token required) — set paratextual boundary; body: `{ doc_id, text_start_n }` (null to clear)
- `POST /segment/preview` — in-memory segmentation preview, no DB writes
  - body: `{ doc_id, mode?, lang?, pack?, limit?, calibrate_to?, preset?, spec? }`
  - `mode` values: `sentences` (default), `markers` ([N] marker-based split)
  - **R5.4a** (additive, optional): `preset` ∈ `{phrases, mots, balises}` or `spec` (`SegmentSpecInput`, see `POST /segment`) override `mode`/`lang`/`pack`; `spec` wins over `preset`; absent → byte-identical. The response `mode` stays `sentences|markers` (a spec maps to `markers` only for its `markers` kind), and `segment_pack` echoes the spec's `label`.
  - `calibrate_to` (optionnel, mode `sentences`) : `doc_id` de référence pour calculer l’écart de volume
  - response includes segments list with `external_id` field when mode=markers
  - response may include `calibrate_to` + `calibrate_ratio_pct` (écart en % vs document de référence)
- `POST /segment/detect_markers` — detect [N] markers in existing units (read-only)
  - body: `{ doc_id }`
  - response: `{ detected, total_units, marked_units, marker_ratio, sample, first_markers }`
- `POST /segment/structure_sections` — return structure section lists for two documents
  - body: `{ doc_id, reference_doc_id }`
  - response: `{ ref_sections, target_sections }` — each as `[{ n, text, role, line_count }]`
- `POST /segment/structure_diff` — compare structure units between two documents
  - body: `{ doc_id, reference_doc_id }`
  - response: sections with `status` (matched/missing_in_target/extra_in_target), line counts, delta
- `POST /segment/propagate_preview` — section-aware segmentation preview (no DB writes)
  - body: `{ doc_id, reference_doc_id, lang?, pack?, section_mapping? }`
  - `section_mapping` — optional `[[ref_idx, tgt_idx], …]` explicit pairing; default is positional
  - response: `{ sections: [{ status, header_text, header_role, ref_count, result_count, raw_count, adjusted, delta, segments }], total_segments, warnings, segment_pack }`
- `POST /segment/zone_lines` — return raw line units in a zone
  - body: `{ doc_id, from_n?, to_n? }` — bounds are exclusive
  - response: `{ lines: [{ n, text }] }`
- `POST /segment/insert_structure_unit` (token required) — insert a structure unit before a given position
  - body: `{ doc_id, before_n, text, role? }` — shifts all units with n ≥ before_n
  - response: `{ inserted_n, text }`
- `POST /segment/apply_propagated` (token required) — write pre-computed segmentation to DB
  - body: `{ doc_id, units: [{ type: "line"|"structure", text, role? }] }`
  - respects `text_start_n` (paratext preserved); deletes stale alignment_links
  - response: `{ units_written, fts_stale: true, action_id, links_archived }`
  - **annulable depuis 1.6.71** (ALI-10, reliquat). Ce chemin ne passe par aucune des deux
    fonctions de resegmentation — il reconstruit le document depuis la liste d'unités fournie,
    avec son propre `DELETE` — et D-2 ne l'avait donc pas couvert. Il enregistre désormais une
    action Mode A (`action_type = resegment`) et archive les liens détruits (migration 035) ;
    `action_id` est la poignée pour `POST /prep/undo`, `links_archived` dit ce que le geste a
    coûté. La lecture d'archive utilise **exactement** les prédicats des deux `DELETE`, borne
    de paratexte comprise : une archive plus large ressusciterait des unités jamais touchées.
  - deux conséquences hors de cette route, car l'annulation aurait menti sans elles : le type
    d'unité est désormais **restauré** et non plus supposé `line` (ce chemin détruit aussi des
    `structure`, qui seraient revenues converties en lignes), et `text_source` est **porté par
    le recorder** — il ne l'était pas, si bien que toute annulation de resegmentation, chemin
    interactif compris, rendait l'unité sans sa provenance d'import.
- `GET /jobs`
- `POST /jobs`
- `GET /jobs/{job_id}`
- `GET /runs` — historique persistant des runs (`import`, `align`, `index`, ...)
  - query: `kind?`, `limit?` (1..200, défaut 50)
- `POST /jobs/enqueue` (token required)
- `POST /jobs/{job_id}/cancel` (token required)
- `POST /annotate` (token required)

### V0.5 — Job enqueue + cancel

#### `POST /jobs/enqueue` (token required)

Enqueue an async job supporting all operation kinds (including import, align, exports).

Request:
```json
{
  "kind": "index|curate|validate-meta|segment|import|align|export_tei|export_align_csv|export_run_report|export_tei_package|export_readable_text|qa_report|annotate",
  "params": {}
}
```

Response (HTTP 202):
```json
{ "ok": true, "status": "accepted", "job": { "job_id": "...", "kind": "...", "status": "queued", "..." } }
```

Supported `kind` values and required `params`:
- `index` — no params required; optional `params.incremental` (bool) for incremental FTS sync
- `curate` — `params.rules` (array, required)
- `validate-meta` — `params.doc_id?`
- `segment` — `params.doc_id` (required), optional `params.lang`, optional `params.pack` (`auto|default|fr_strict|en_strict`)
- `import` — `params.mode` + `params.path` required; optional: `language`, `title`, `doc_role`, `resource_type`, `tei_unit`
  - `mode`: `docx_numbered_lines|txt_numbered_lines|docx_paragraphs|odt_paragraphs|odt_numbered_lines|tei|conllu`
- `align` — `params.pivot_doc_id` + `params.target_doc_ids` required; optional: `strategy`, `sim_threshold`, `debug_align`, `replace_existing`, `preserve_accepted`, `run_id`
  - `strategy`: `external_id|position|similarity|external_id_then_position|length_bounded`
  - `replace_existing=true` + `preserve_accepted=true` is the recommended "global recalculation" mode for keeping manually accepted links stable
  - job result includes `run_id`; this run can be exported via `export_run_report` with `params.run_id`
- `export_tei` — `params.out_dir` required; optional: `params.doc_ids`, `params.include_structure` (bool, default false)
- `export_align_csv` — `params.out_path` required; optional: `pivot_doc_id`, `target_doc_id`, `delimiter`
- `export_run_report` — `params.out_path` required; optional: `run_id`, `format` (`jsonl`|`html`)
- `export_readable_text` — `params.out_dir` required; optional: `doc_ids` (array d'entiers positifs), `format` (`txt`|`docx`), `include_structure` (bool), `include_external_id` (bool), `source_field` (`text_norm`|`text_raw`)
- `export_tei_package` — `params.out_path` required; optional: `doc_ids`, `include_structure`, `include_alignment`, `status_filter`, `tei_profile`
- `qa_report` — `params.out_path` required; optional: `doc_ids`, `format` (`json`|`html`), `policy` (`lenient`|`strict`)
- `annotate` — `params.doc_id` required (or `params.all_docs=true`); optional: `params.model`

#### `POST /annotate` (token required)

Enqueue a spaCy annotation job without going through the generic `/jobs/enqueue` endpoint.

Request:
```json
{ "doc_id": 1, "model": "fr_core_news_md" }
```
or
```json
{ "all_docs": true, "model": "fr_core_news_md" }
```

Response (HTTP 202):
```json
{ "ok": true, "status": "accepted", "job": { "job_id": "...", "kind": "annotate", "status": "queued" } }
```

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
- `GET /doc_relations/all` — all doc_relations in the corpus (for hierarchy view, no token)
- `GET /families` — list all document families (parent + children + completion stats, no token)
- `GET /families/{family_root_id}/curation_status` — curation status for all docs in a family (no token)
- `POST /families/{family_root_id}/segment` — segment all docs in a family (token required)
  - body: `{ pack?, force?, lang_map? }` — `force=true` re-segments already-segmented docs
  - Returns `{ results: [{doc_id, status, units_input, units_output, warnings, calibrate_ratio_pct?}], summary }`
  - `status` per doc: `"segmented"` | `"skipped"` (already done, force=false) | `"error"`
  - Adds ratio warning when child segment count differs > 15 % from parent
- `POST /segment` — body now accepts optional `calibrate_to: int` (reference doc_id for ratio check)
- `POST /export/tmx` — export paires alignées au format TMX 1.4 (token required)
  - body: `{ pivot_doc_id, target_doc_id }` OU `{ family_id }` pour toute la famille + `out_path|out_dir`
  - retourne `{ out_path, tu_count, pairs }`
- `POST /export/bilingual` — export bilingue entrelacé HTML ou TXT (token required)
  - body: `{ pivot_doc_id, target_doc_id, format?, out_path?, preview_only?, preview_limit? }`
  - `preview_only=true` retourne `{ preview: [{pivot_text, target_text}], pair_count }` sans fichier
- `GET /corpus/audit?ratio_threshold_pct=15` — now returns a `families` section with:
  - `orphan_docs`: children whose parent is absent from the corpus
  - `unsegmented_children`: children (or their parents) with 0 line units
  - `unaligned_pairs`: segmented pairs with no alignment links
  - `ratio_warnings`: pairs where `|child_segs - parent_segs| / parent_segs > threshold`
  - `ratio_threshold_pct` configurable via query param (default 15)
- `POST /families/{family_root_id}/align` — align all parent↔child pairs in a family (token required)
  - body: `{ strategy?, sim_threshold?, replace_existing?, preserve_accepted?, skip_unready? }`
  - default strategy: `"position"` (best for calibrated translations)
  - if any child not segmented and `skip_unready=false` (default): returns 400 with `unready_doc_ids`
  - Returns `{ results: [FamilyAlignPairResult], summary: {aligned, skipped, conflicts, errors, total_links_created} }`
  - Returns `families[]` with `family_id`, `parent`, `children[]`, `stats` per family
  - `stats` : `total_docs`, `segmented_docs`, `aligned_pairs`, `total_pairs`, `validated_docs`, `completion_pct`, `ratio_warnings[]`
- `GET /documents` — document list now includes workflow fields:
  - `workflow_status`: `draft|review|validated`
  - `validated_at`: string|null
  - `validated_run_id`: string|null
  - `author_lastname`: string|null — nom de famille de l'auteur principal (optionnel)
  - `author_firstname`: string|null — prénom de l'auteur principal (optionnel)
  - `doc_date`: string|null — date du document en texte libre, ex. "2024" ou "2024-03-15" (optionnel)
  - `token_count`: integer — nombre de tokens annotés pour ce document
  - `annotation_status`: `missing|annotated`
- `GET /documents/preview?doc_id=N&limit=M` — mini aperçu du contenu (read-only)
  - `limit` optionnel, défaut `6`, bornes `1..5000` (aligné convention preview v0.1.40)
  - retourne les premières unités `line` triées par `n`:
    - `lines: [{ unit_id, n, external_id|null, text }]`
    - `count`, `total_lines`, `limit`
- `POST /documents/update` — update one document metadata + workflow status
  - body: `{ doc_id, title?, language?, doc_role?, resource_type?, workflow_status?, validated_run_id?, author_lastname?, author_firstname?, doc_date? }`
  - returns: `{ updated: int, doc: DocumentRecord }`
- `POST /documents/bulk_update` — update multiple docs at once
  - body: `{ updates: [{doc_id, title?, language?, doc_role?, resource_type?, workflow_status?}, …] }`
  - returns: `{ updated: int }`
- `POST /doc_relations/set` — upsert a doc_relation
  - body: `{ doc_id, relation_type, target_doc_id, note? }`
  - returns: `{ action: "created"|"updated", id, doc_id, relation_type, target_doc_id }`
- `POST /doc_relations/delete` — delete a doc_relation by `id`
  - body: `{ id: int }`
  - returns: `{ deleted: int }`

Workflow status semantics:
- `workflow_status="validated"`: `validated_at` is auto-filled by server if absent.
- `workflow_status="draft"` or `"review"`: `validated_at` and `validated_run_id` are cleared.

### V0.4B — Exports (token required)

- `POST /export/tei` — export documents as TEI XML (server-side disk write)
  - body: `{ out_dir, doc_ids?: int[] }` (null = all docs)
  - returns: `{ files_created: string[], count }`
- `POST /export/conllu` — export token annotations as CoNLL-U
  - body: `{ out_path, doc_ids?: int[] }` (null = all docs)
  - returns: `{ out_path, docs_written, sentences_written, tokens_written }`
- `POST /export/token_query_csv` — export CQL hits as CSV/TSV tabular rows
  - body: `{ out_path, cql, mode?: "kwic"|"segment", window?: int, language?: str, doc_ids?: int[], delimiter?: ","|"\\t", max_hits?: int }`
  - returns: `{ out_path, rows_written, mode, delimiter, max_hits }`
- `POST /export/ske` — export corpus tokens as Sketch Engine-style vertical `.ske`
  - body: `{ out_path, doc_ids?: int[] }` (null = all docs)
  - returns: `{ out_path, docs_written, sentences_written, tokens_written }`
- `POST /export/align_csv` — export alignment links as CSV/TSV
  - body: `{ out_path, pivot_doc_id?, target_doc_id?, delimiter? }`
  - returns: `{ out_path, rows_written }`
- `POST /export/run_report` — export run history
  - body: `{ out_path, run_id?, format: "jsonl"|"html" }`
  - returns: `{ out_path, runs_exported, format }`

### V0.4C — Alignment link editing (token required)

- `POST /align/link/create` — manually create an alignment link between two units
  - body: `{ pivot_unit_id, target_unit_id, status?, external_id? }`; validates: both units must exist; status ∈ {accepted, rejected, null}; external_id (1.6.55, optional) = non-negative pair number to inherit (a gesture-created link passes its sibling's so audit views sort it next to its family; default = the pivot unit's external_id, else 0)
  - returns: `{ link_id, pivot_unit_id, target_unit_id, pivot_doc_id, target_doc_id, status, created: 1 }`
  - 404 if either unit does not exist; 409 if a link between those units already exists
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

### POST /align/links/batch_update (V1.3 — token required)

Apply a batch of `set_status` or `delete` operations on alignment links in a single request.
By default, partial errors are tolerated — valid actions are applied and errors are reported in
the response. With `"atomic": true` (1.6.54) the batch is all-or-nothing: on any action error the
whole batch is rolled back (`applied`/`deleted` = 0, `rolled_back` = true). Compound gestures
(e.g. two complementary `set_target_span`) should pass `atomic`.

Request:
```json
{
  "actions": [
    { "action": "set_status", "link_id": 10, "status": "accepted" },
    { "action": "set_status", "link_id": 11, "status": "rejected" },
    { "action": "set_status", "link_id": 12, "status": null },
    { "action": "delete", "link_id": 13 }
  ],
  "atomic": false
}
```
- `action`: `"set_status"`, `"delete"`, `"set_target_span"`, `"clear_target_span"`, `"set_bead"`, `"clear_bead"` ou `"set_pivot"`
- `link_id`: integer (required for all actions)
- `status`: `"accepted"`, `"rejected"`, or `null` (unreviewed) — required for `set_status`
- `char_start` / `char_end`: required for `set_target_span` (coupe ancrée-source, offsets en points de code dans le `text_norm` de la cible depuis **1.6.69** (ALI-01 tranche 2) : c'est le plan que la matrice projette et que l'aligneur calcule. Ils indexaient `text_raw`, choisi pour son immutabilité ; l'invariant est désormais tenu par l'autre bout, une correction au stylo effaçant les coupes des liens qui visent l'unité (décision D-1) ; `clear_target_span` remet le lien sur l'unité entière)
- `set_bead` / `clear_bead` (**1.6.57**, D-W16) : regroupe (ou dégroupe) le lien dans le bead de **sa cellule**. Le `bead_uid` est **dérivé au serveur** de la paire (`pivot_unit_id`, `target_doc_id`) du lien — aucun identifiant n'est fourni par le client. Une cellule qui porte plusieurs liens est **un** bead (1 segment moyeu ↔ N phrases cibles), et non une collision : c'est ce qui empêche les gestes (coupe à cheval, ⭙ Fusionner) de faire apparaître de fausses collisions dans Qualité / Révision fine. `clear_bead` remet `bead_uid` à `NULL` (bead singleton).
- `new_pivot_unit_id`: required for `set_pivot` (**1.6.60**, RA-D1 — ré-ancrer le lien sur un **autre segment moyeu/pivot**, symétrique du retarget côté cible). Seul `pivot_unit_id` bouge : `status`, la cible et la coupe (`target_char_start/end`) sont **préservés**, et le `bead_uid` dérivé (désormais périmé) est remis à `NULL`. Le nouveau pivot doit **exister**, être une unité `line` et appartenir au **doc moyeu** du lien ; un lien identique (même pivot + même cible) déjà présent est refusé (`CONFLICT`).
- `atomic`: optional boolean (default `false`) — all-or-nothing semantics (see above)
- `label`: optional string — libellé du geste, affiché tel quel par le bandeau d'annulation. Un serveur qui ne le reçoit pas dérive un libellé du type d'action et du nombre de liens (1.6.70)

Response:
```json
{ "ok": true, "status": "ok", "applied": 3, "deleted": 1, "errors": [], "rolled_back": false, "op_id": 42 }
```
- `applied` — number of NON-delete operations that succeeded (`set_status`, `set_target_span`, `clear_target_span` depuis 1.6.54, `set_bead`/`clear_bead` depuis 1.6.57)
- `deleted` — number of `delete` operations that succeeded
- `errors` — array of `{ index, link_id, error }` for individual failures (not found, invalid action, etc.)
- `rolled_back` — `true` when `atomic` was set and an error rolled the whole batch back
- `op_id` (**1.6.70**, D-3) — poignée d'annulation à passer à `/align/links/batch_undo`, ou `null` quand il n'y a rien à annuler : lot intégralement en erreur, `rolled_back`, ou aucun `link_id` existant. L'archive est prise **avant** l'application, puisque six verbes sur sept mutent une ligne qui survit et qu'après coup il n'y a plus rien à lire

### POST /align/links/batch_undo (1.6.70 — token required)

Défait un geste de lot archivé — décision **D-3**, migration **037**. Les sept verbes de
`batch_update` et les quatre de `collisions/resolve` touchent des liens **sans toucher une seule
unité** : l'historique de préparation, linéaire *par document*, n'a rien à quoi les rattacher, et
`align_run_purge` est clé par run. D'où une troisième archive, `align_op` + `align_op_link_snapshots`.

Request : `{ "op_id": 42 }` — l'`op_id` rendu par le geste.

Response :
```json
{ "ok": true, "status": "ok", "op_id": 42, "description": "coupe — 2 liens",
  "updated": 2, "reinserted": 0, "deleted": 0, "skipped": 0 }
```
- `updated` — liens qui avaient **survécu** au geste et retrouvent leurs colonnes. C'est le cas
  courant : six verbes sur sept mutent (`status`, span, `bead_uid`, `pivot_unit_id`) sans détruire.
  La restitution est donc UPDATE-si-présent / INSERT-si-absent, et **non** l'`INSERT OR IGNORE` des
  deux autres archives, qui laisserait la mutation en place tout en rapportant « restauré ».
- `reinserted` — liens que `delete` avait détruits, remis avec leur `link_id` d'origine
  (AUTOINCREMENT ne recycle pas un rowid libéré : la restitution est identique, pas approchée).
- `deleted` — liens que l'opération avait **créés** : les défaire, c'est les supprimer. L'annulation
  les retire **avant** de restituer les autres — sans cet ordre, un lien à rendre buterait sur la
  paire `(pivot, target)` qu'une création de la même opération occupe encore (unicité, migration 008)
  et serait compté « skipped » alors que la place se libère une ligne plus bas.
- `skipped` — ce qui n'a pas pu revenir, compté et jamais avalé : une unité disparue depuis, ou la
  paire `(pivot, target)` réoccupée par un lien plus jeune qu'on préfère laisser vivre.

Refus :
- **`404`** — `op_id` inconnu : déjà annulé, ou sorti de la **pile bornée**. Seules les 50 dernières
  opérations sont conservées (`ALIGN_OP_KEEP`). Cette archive écrit à chaque geste, « accepter »
  compris, donc elle croîtrait avec l'usage normal et non avec les accidents — ce qu'aucune des
  deux autres ne fait, puisqu'elles n'écrivent que sur une destruction.
- **`409`** — un geste **postérieur** porte sur l'un de ces liens. L'annuler l'écraserait sans le
  dire : même discipline qu'ALI-03, on ne défait pas par surprise une décision humaine ultérieure.

L'opération est **consommée** par son annulation : la garder laisserait un second undo ressusciter
la même génération par-dessus celle qu'on vient de restituer.

**Une opération peut s'étendre sur plusieurs requêtes.** La coupe à cheval et le rattachement au
voisin appellent `POST /align/link/create` **puis** `batch_update`. Une archive par requête offrirait
un « Annuler » qui ressusciterait le lien supprimé en laissant le lien créé — le doublon d'ALI-22,
sous une commande qui a l'air complète. Les deux routes `/align/link/create` et `/align/link/delete`
acceptent donc `op_id` (et `label`) et le **rendent** : le premier appel du geste ouvre l'opération,
les suivants la rejoignent en la passant. Un `op_id` inconnu n'est pas une erreur — on en ouvre une
neuve, car un geste ne doit jamais échouer à cause de sa propre comptabilité d'annulation. Et si deux
requêtes du même geste touchent le même lien, c'est le **premier** instantané qui vaut : celui d'avant
le geste, pas l'état intermédiaire.

**Quatre routes à un lien** portent la même mécanique, pour la même raison : `create`, `delete`,
`update_status` et `retarget`. Le bouton « rattacher » de la matrice a deux branches — `create` quand
la cellule est vide, `retarget` quand elle porte déjà un lien — et n'archiver que l'une rendrait le
même geste annulable une fois sur deux. Idem pour le statut, réglable depuis la matrice (par lot) et
depuis le panneau (à l'unité). Reste **hors** de cette pile : `POST /align/cell_status`, qui écrit
dans `alignment_cell_statuses` et non dans `alignment_links` — un autre objet, une autre archive à
concevoir si le besoin se présente. Conséquence concrète, énoncée plutôt que tue : `create` efface
la marque « ∅ non traduit » que le nouveau lien contredit (`purge_contradicted_cell_statuses`), et
l'annulation **ne la rend pas** — la cellule revient au « à faire », pas au « ∅ ». Mesuré avant de
laisser ouvert : 0 marque de cellule sur le corpus de travail.

### POST /align/cell_status (1.6.56 — token required)

Set or clear the per-cell « non traduit » status on a (hub unit × target document) pair
(matrix gesture « ∅ Non traduit », D-W8 résolu — table `alignment_cell_statuses`, migration 028).
Distinct from the **global** `units.unit_status` axis (marker-lift, whole row): the matrix
projection reads both; a marked cell displays the `[non traduit]` token (D10) and counts as
done (D-W5).

Request:
```json
{ "pivot_unit_id": 3, "target_doc_id": 2, "status": "non_traduit" }
```
- `pivot_unit_id`: hub (matrix row) **line** unit — a `structure` unit is a 400
- `target_doc_id`: must be a `translation_of`/`excerpt_of` of the pivot's document (else 400)
- `status`: `"non_traduit"` to mark; `null`/`""`/absent to clear (clearing an unmarked cell is a no-op)

Response:
```json
{ "ok": true, "status": "ok", "pivot_unit_id": 3, "target_doc_id": 2, "cell_status": "non_traduit" }
```
- `cell_status` (not `status` — taken by the response envelope): the stored value, `null` after a clear
- 404 if the pivot unit or target document does not exist
- 409 (`CONFLICT`) when marking a cell that still has **active** (non-rejected) links —
  « non traduit » on a translated cell is contradictory; un-align first (↺ cellule)

### POST /align/retarget_candidates (V1.4 — read-only, no token)

Return candidate target units for retargeting an alignment link.
Uses two heuristics in priority order: exact external_id match (score=1.0),
then ±window neighbours from the current anchor (score=1/(1+Δ)).

Request:
```json
{ "pivot_unit_id": 3, "target_doc_id": 2, "limit": 10, "window": 5 }
```
- `limit`: max candidates returned (1–50, default 10)
- `window`: neighbour search range around anchor (1–20, default 5)

Response:
```json
{
  "ok": true, "status": "ok",
  "pivot": { "unit_id": 3, "external_id": 3, "text": "Trois." },
  "candidates": [
    { "target_unit_id": 8, "external_id": 3, "target_text": "Three.", "score": 1.0, "reason": "external_id_match" },
    { "target_unit_id": 7, "external_id": 2, "target_text": "Two.",   "score": 0.5,  "reason": "neighbor (Δ1)" }
  ]
}
```
- Returns 404 if `pivot_unit_id` does not exist.

### POST /align/collisions (V1.5 — read-only, no token)

List pivot units with more than one alignment link to the same target document (collisions),
paginated. Useful for detecting and then resolving many-to-one alignment issues.

Request:
```json
{ "pivot_doc_id": 1, "target_doc_id": 2, "limit": 20, "offset": 0 }
```

Response:
```json
{
  "ok": true, "status": "ok",
  "total_collisions": 2,
  "collisions": [
    {
      "pivot_unit_id": 5, "pivot_external_id": 5, "pivot_text": "Cinq.",
      "links": [
        { "link_id": 10, "target_unit_id": 5, "target_external_id": 5, "target_text": "Five.", "status": null },
        { "link_id": 11, "target_unit_id": 6, "target_external_id": 6, "target_text": "Six.",  "status": null }
      ]
    }
  ],
  "has_more": false,
  "next_offset": 1
}
```
- `total_collisions` — count of pivot units with >1 links to target doc
- `limit` max 100, default 20
- Returns empty list (not 404) if docs exist but have no collisions

### POST /align/collisions/resolve (V1.5 — write, token required)

Batch-resolve collision links. Each action targets a specific `link_id`.

Request:
```json
{
  "actions": [
    { "action": "keep",       "link_id": 10 },
    { "action": "delete",     "link_id": 11 },
    { "action": "reject",     "link_id": 12 },
    { "action": "unreviewed", "link_id": 13 }
  ]
}
```
- `keep` → set status = "accepted"
- `delete` → DELETE the alignment_links row
- `reject` → set status = "rejected"
- `unreviewed` → set status = NULL

Response:
```json
{ "ok": true, "applied": 2, "deleted": 1, "errors": [], "op_id": 43 }
```
- Partial failures tolerated: failed items go to `errors: [{ index, link_id, error }]`
- Non-existent link_ids are reported as errors, not 404
- `op_id` (**1.6.70**, D-3) — même archive et même annulation que `batch_update` : à passer à
  `/align/links/batch_undo`, `null` quand rien n'a changé. Cet endpoint est le huitième verbe de la
  même famille (il supprime des liens et modifie des statuts sans toucher une unité) et il était
  muet lui aussi ; l'audit ne l'avait pas compté parmi « les sept verbes ».

## GET /unit/context (Sprint I)

Read-only. No token required.

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `unit_id` | integer ≥ 1 | Yes | ID of the target unit (`unit_type = 'line'`) |

### Success response (200)

```json
{
  "ok": true,
  "doc_id": 12,
  "unit_id": 847,
  "unit_index": 54,
  "total_units": 1200,
  "prev": { "unit_id": 846, "text": "Texte de l'unité précédente." },
  "current": { "unit_id": 847, "text": "Texte de l'unité courante." },
  "next": { "unit_id": 848, "text": "Texte de l'unité suivante." }
}
```

`prev` and `next` are `null` at document boundaries.  
`unit_index` is 1-based, counting only `unit_type = 'line'` units within the document.

### Error cases

| Condition | HTTP | `code` |
|---|---|---|
| Missing `unit_id` | 400 | `BAD_REQUEST` |
| `unit_id` not an integer | 400 | `BAD_REQUEST` |
| Unit not found or not a line unit | 404 | `NOT_FOUND` |

### SQL implementation (read-only, 4 targeted queries)

```sql
-- 1. Fetch target unit
SELECT unit_id, doc_id, n, external_id, text_norm FROM units WHERE unit_id = ? AND unit_type = 'line';
-- 2. Total units in document
SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line';
-- 3. 1-based index (count of line units with n ≤ n_cur)
SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line' AND n <= ?;
-- 4. Prev unit
SELECT unit_id, text_norm FROM units WHERE doc_id = ? AND unit_type = 'line' AND n < ? ORDER BY n DESC LIMIT 1;
-- 5. Next unit
SELECT unit_id, text_norm FROM units WHERE doc_id = ? AND unit_type = 'line' AND n > ? ORDER BY n ASC LIMIT 1;
```

## Curation exceptions, apply-history, stats & facets (SID-06 — documentation)

Routes servies de longue date par le sidecar mais qui manquaient à l'OpenAPI/au
contrat. Schémas req/resp détaillés dans `docs/openapi.json` ; résumé ici.

**Exceptions de curation** (`curation_exceptions`)
- `GET /curate/exceptions` (query `doc_id?`) / `POST /curate/exceptions` (body `doc_id?`) — **lecture** : liste les exceptions (jointes aux unités/documents), filtrables par document.
- `POST /curate/exceptions/set` — **écriture (token)** : crée/remplace (upsert sur `unit_id`) une exception. Body `unit_id`, `kind` (`ignore`|`override`), `override_text` (requis si `override`), `note?`.
- `POST /curate/exceptions/delete` — **écriture (token)** : supprime l'exception d'un `unit_id`.
- `POST /curate/exceptions/export` — **écriture (token)** : exporte les exceptions vers un fichier `json`/`csv` (`out_path`, `format?`, `doc_id?`).

**Historique d'application de curation** (`curation_apply_history`)
- `GET /curate/apply-history` (query `doc_id?`, `limit?`) / `POST /curate/apply-history` (body `doc_id?`, `scope?`, `limit?`) — **lecture** : derniers événements d'application.
- `POST /curate/apply-history/record` — **écriture (token)** : insère un événement (champs de stats fournis par le front).
- `POST /curate/apply-history/export` — **écriture (token)** : exporte l'historique (≤1000) vers `json`/`csv`.

**Statistiques lexicales & facettes** (lecture, sans token)
- `POST /query/facets` — résumé de facettes d'une requête (compteurs + top docs, sans contenu des hits).

> **Le pivot KWIC (1.6.74).** En mode `kwic`, `POST /query` rend `left` / `match` / `right`.
> `match` était cherché en découpant la requête **assainie** sur l'espace, donc comme une chaîne
> littérale : il cherchait `dit-il` dans un texte qui porte `dit - il`, `libr\*` avec son
> astérisque, et prenait `AND`, `OR`, `NEAR(` et la distance de proximité pour des termes.
> Mesuré sur 25 lignes trouvées par requête : `dit-il` **25 pivots vides sur 25**, `peut-être`
> 25/25, `c'est-à-dire` 18/18, `libr*` 25/25, `NEAR(homme monde, 10)` 3/3 — et `homme OR femme`
> centrait la concordance sur le « or » français. Seul le mot simple fonctionnait.
>
> Un pivot vide n'était pas une colonne blanche : la fonction retournait `(texte, "", "")`,
> soit l'unité **entière** dans la colonne gauche. Le corpus de travail porte 12 documents
> stockés en une seule unité, dont un de 110 786 caractères.
>
> **Un terme est désormais une suite ordonnée de mots** séparés par du non-mot — `dit\W+il` —
> ce qui est la sémantique même d'une phrase FTS5, dont les tokens doivent être adjacents. Le
> pivot couvre donc la **locution entière** (`dit - il`), ce qu'une concordance doit montrer, et
> le contexte droit reprend après elle. Un préfixe reste un préfixe (`libr\w*`). L'apostrophe
> courbe cesse d'être un cas à part, `’` n'étant qu'un séparateur de plus.
>
> Le même mécanisme corrige le **mode segment**, où `\w+` faisait de l'article élidé de `l'homme`
> un terme d'une seule lettre : sans borne de mot, tous les `l` du texte étaient surlignés.
>
> Enfin, `all_occurrences=true` pouvait faire **disparaître une unité** des résultats — aucune
> occurrence retrouvée, aucun hit ajouté, alors que le total la comptait. Le repli existe des deux
> côtés, y compris pour une requête sans aucun mot, et il porte **deux bornes** : la largeur de
> contexte demandée, et 500 caractères. La seconde n'est pas redondante — compter les tokens ne
> borne rien sur une écriture sans espaces, où `\S+` rend un seul token : le même repli valait
> 47 caractères en latin et 80 000 en chinois. Sur les 46 648 unités du corpus de travail, la
> médiane est à 56 caractères et 0,20 % dépassent 500. Aucune signature ne change : `match` cesse
> d'être vide.

> **Assainissement de la requête FTS5 (1.6.72, complété en 1.6.73).** `POST /query` et
> `POST /query/facets` reçoivent la saisie de l'utilisateur, dont une partie de la ponctuation est
> de la **syntaxe** pour FTS5. Chaque mot nu contenant de la ponctuation **ASCII** est donc mis
> entre guillemets avant d'atteindre le moteur — il devient une phrase, ce que veut précisément
> quelqu'un qui colle une ligne du concordancier. Le cas qui l'a révélé : « Mi - ar face plăcere. »
> (roumain) rendait `no such column: ar`, FTS5 lisant `- ar` comme un filtre de colonne négatif.
>
> **Trois caractères sont ambigus** — `,` `(` `)` — parce qu'ils appartiennent à la fois à la
> syntaxe et à la prose. Deux règles les départagent, sans rien parser : une **virgule** n'est de la
> syntaxe que dans un `NEAR(…)`, et seulement celle qui porte la distance ; une **parenthèse** ne
> l'est que si la requête porte un opérateur — FTS5 ne les accepte qu'en **capitales**, ce qui
> suffit à distinguer `(chat OR chien)` d'une parenthèse de prose. Personne n'y perd : `(chat)`
> levait une erreur et rend désormais une recherche littérale.
>
> Dans un `NEAR(…)`, la **structure** est préservée à l'octet près, mais les **termes** sont
> assainis comme partout ailleurs. C'est ce qui fait marcher le mode NEAR du concordancier, qui
> construit `NEAR(<mots collés à l'espace>, N)` sans rien assainir. *(Cette note disait « il
> tombait sur `peut-être` et `l'homme` » : **faux**, vérifié en 1.6.74 en rejouant l'assainisseur
> de 1.6.72 sur le corpus — ces deux-là rendaient déjà 3 et 10 lignes. Le seul cas réellement
> cassé était la **virgule** : `NEAR(dit, puis, 5)` levait `fts5: syntax error near ","`. Traiter
> le groupe en bloc opaque, lui, les aurait cassés — c'est ce constat-là qui était juste.)*
>
> **Ampleur, mesurée sur des requêtes entières.** 47,9 % des lignes du corpus de travail portent une
> virgule, 48,3 % une virgule ou une parenthèse : coller une ligne du concordancier échouait une
> fois sur **deux**. (La mesure de 1.6.72 — « sept caractères », « une fois sur sept » — était
> fausse : elle avait été faite sur des tokens découpés à l'espace, ce qui excluait par construction
> les trois délimiteurs du balayage.)
>
> **Le périmètre reste confiné à l'ASCII**, et c'est ce qui rend la règle tenable en multilingue :
> **tous** les scripts non latins passent — arabe, chinois, japonais, coréen, grec, cyrillique,
> hébreu, devanagari — ponctuation non-ASCII comprise (`« »`, `，。`, le maqaf `־`, l'apostrophe
> courbe `’`). La règle ne connaît aucune langue, et des tests verrouillent qu'elle ne s'y mette
> pas. Restent intactes : les phrases `"…"`, la troncature `mot*`, l'ancre `^mot`, `NEAR(…)`,
> `AND`/`OR`/`NOT` et les parenthèses de groupement.
>
> Une syntaxe FTS5 **réellement** fautive (un `NEAR()` vide, un `NEAR(a (b), 3)`) n'est pas
> rattrapable, et ne doit pas l'être : les deux routes rendent **`400`** « Requête de recherche
> invalide », là où elles rendaient un `500` avec pile d'appel. C'est pour ces cas qu'on n'assainit
> **pas** en repli après échec — cela ferait passer une intention mal écrite pour une recherche
> littérale rendant zéro.
- `POST /stats/lexical` — stats de fréquence lexicale pour un *slot* (jeu de filtres).
- `POST /stats/compare` — comparaison des distributions de deux slots A et B.

**Segmentation**
- `POST /segment/delete_structure_unit` — **écriture (token)** : supprime l'unité `structure` à la position `n` d'un document et décale les suivantes.

## Shutdown semantics

- `/shutdown` triggers graceful server shutdown.
- Sidecar closes HTTP socket, closes DB connection, and removes
  `.agrafes_sidecar.json`.
- If sidecar is already down, discovery file may be absent/stale.
