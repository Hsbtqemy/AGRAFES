# multicorpus_engine

UI-independent Python core engine for multilingual corpus import, indexing, querying, alignment, export, and optional sidecar integration (Tauri-ready).

## Quickstart

```bash
pip install -e ".[dev]"
```

```bash
multicorpus init-project --db my_corpus.db
multicorpus import --db my_corpus.db --mode docx_numbered_lines --language fr --path document.docx
multicorpus index --db my_corpus.db
multicorpus query --db my_corpus.db --q "bonjour" --mode segment
```

## Implemented capabilities

- Importers: `docx_numbered_lines`, `txt_numbered_lines`, `docx_paragraphs`, `tei`
- Query: `segment`, `kwic`, `--all-occurrences`, filters, aligned view
- Alignment: `external_id`, `position`, `similarity`
- Export: `tei`, `csv`, `tsv`, `jsonl`, `html`
- Curation and segmentation commands
- Optional sidecar API with OpenAPI endpoint and async jobs

## JSON contract

- CLI stdout emits exactly one JSON object per command.
- Exit code `0` on success, `1` on error.
- Run logs are written to `<db_dir>/runs/<run_id>/run.log`.

See:
- `docs/INTEGRATION_TAURI.md`
- `docs/SIDECAR_API_CONTRACT.md`

## Tests

```bash
PYTHONPATH=src pytest
```

## Project docs

- `docs/ROADMAP.md`
- `docs/BACKLOG.md`
- `docs/DECISIONS.md`
- `docs/INTEGRATION_TAURI.md`
- `CHANGELOG.md`
