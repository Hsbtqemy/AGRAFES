# Test Suite Notes

## Layout

- **`tests/`** (root) — feature/domain-focused tests (`test_import.py`, `test_query.py`, `test_curation.py`, …) and the live contract-freeze checks (`test_contract_openapi_snapshot.py`, `test_cli_contract.py`, …).
- **`tests/contracts/`** — **API-freeze / milestone regression packs**, named by *increment* rather than domain: `test_v2.py`, `test_v21.py`, `test_sidecar_v03…v15.py`, `test_sidecar_jobs_v05.py`, `test_sidecar_hardening_v141.py`. They pin the behaviour of a given sidecar-API / engine milestone (isolated here under T-03). Auto-discovered by pytest (`testpaths = ["tests"]`); shared fixtures come from the root `tests/conftest.py`.
- **`tests/importers/`**, **`tests/services/`** — domain test groups.
- **`tests/fixtures/`**, **`tests/snapshots/`** — sample inputs + frozen contract snapshots.

## Naming conventions

- `test_v2.py`: regression coverage for **V2.0** features (TXT `txt_numbered_lines` + DOCX paragraph importers, position-based alignment, KWIC `--all-occurrences`).
- `test_v21.py`: regression coverage for **V2.1** features (TEI importer, curation engine, proximity query helper).
- `test_sidecar_vNN.py` / `test_sidecar_*_vNN.py`: API-freeze packs pinning a sidecar contract milestone.

New tests can be added either:
- in feature-focused files at the `tests/` root (`test_import.py`, `test_query.py`, …), or
- in `tests/contracts/` when introducing/pinning a new API or engine milestone.
