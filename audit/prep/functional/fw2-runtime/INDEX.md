# FW-2 Runtime Audit — Index

**Date:** 2026-03-10 | **Sidecar:** 1.4.6

| Scenario | Status | Key evidence |
|----------|--------|-------------|
| A — `GET /documents/preview` | ✅ validated | `ok=True`, 3 lines, `total_lines=3` |
| B — Segmentation job | ✅ validated | `job_status=done`, units stable pre/post |
| C — Dropzone drag-drop | 🔒 blocked | Tauri WebView native required; code verified correct |
| D — Batch role update | ✅ validated | `updated=2`, roles match expected |
| E — `exceptions_only` CSV | ✅ validated | `rows_all=3`, `rows_exceptions_only=1`, filter effective |
| F — TEI `relation_type` | ✅ validated | `listRelation` present iff `translation_of`, absent for `none` |

## Bugs

| ID | Severity | Location | Status |
|----|----------|----------|--------|
| BUG-FW2-01 | High | `sidecar.py` ~line 3010 — `tei_unit=` should be `unit_element=` | Open |

## Artifacts

| File | Description |
|------|-------------|
| `fw2_smoke.py` | Smoke test script (Python, no dependencies beyond stdlib + repo src) |
| `fw2_results.json` | Full machine-readable results |
| `scenario_e_export_all.csv` | CSV export — all 3 alignment links |
| `scenario_e_export_exceptions.csv` | CSV export — rejected links only (1 row) |
| `scenario_f_tei_none.xml` | TEI export with `relation_type=none` (no `<listRelation>`) |
| `scenario_f_tei_translation_of.xml` | TEI export with `relation_type=translation_of` (has `<listRelation>`) |
| `FW2_RUNTIME_REPORT.md` | Full narrative report |
