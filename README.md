# multicorpus_engine

UI-independent Python core engine for multilingual corpus import, indexing, querying, alignment, export, and optional sidecar integration (Tauri-ready).

## Environnement

Créer un environnement virtuel (recommandé) puis installer le projet en mode éditable avec les dépendances de dev :

```bash
python3 -m venv .venv
source .venv/bin/activate   # macOS/Linux — à faire dans chaque nouveau terminal
# sous Windows : .venv\Scripts\activate
pip install -e ".[dev]"
```

Quand le venv est activé, l’invite affiche `(.venv)` au début de la ligne.

## Quickstart

Une fois l’environnement activé et le projet installé (voir ci-dessus) :

```bash
multicorpus init-project --db my_corpus.db
multicorpus import --db my_corpus.db --mode docx_numbered_lines --language fr --path document.docx
multicorpus index --db my_corpus.db
multicorpus query --db my_corpus.db --q "bonjour" --mode segment
```

### Rien ne se lance / `multicorpus` introuvable

- **Activer le venv** dans ce terminal : `source .venv/bin/activate` (puis réessayer `multicorpus --help`).
- **Sans activer**, appeler explicitement :
  ```bash
  .venv/bin/multicorpus --help
  # ou
  .venv/bin/python -m multicorpus_engine.cli --help
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

## Sidecar persistent (HTTP)

Start one persistent sidecar process:

```bash
multicorpus serve --db /tmp/agrafes.db --host 127.0.0.1 --port 0 --token auto
```

Discovery file (written next to DB):
- `.agrafes_sidecar.json` with `host`, `port`, `pid`, `started_at`, `db_path`, and optional `token`.

With `--token auto`, write endpoints require header `X-Agrafes-Token`.

```bash
DB=/tmp/agrafes.db
PORTFILE="$(dirname "$DB")/.agrafes_sidecar.json"
HOST="$(python -c 'import json,sys;print(json.load(open(sys.argv[1]))["host"])' "$PORTFILE")"
PORT="$(python -c 'import json,sys;print(json.load(open(sys.argv[1]))["port"])' "$PORTFILE")"
TOKEN="$(python -c 'import json,sys;print(json.load(open(sys.argv[1])).get("token",""))' "$PORTFILE")"
curl -sS -X POST "http://$HOST:$PORT/import" -H "Content-Type: application/json" -H "X-Agrafes-Token: ${TOKEN}" -d '{"mode":"txt_numbered_lines","path":"/tmp/doc.txt","language":"fr"}'
curl -sS -X POST "http://$HOST:$PORT/index" -H "Content-Type: application/json" -H "X-Agrafes-Token: ${TOKEN}" -d '{}'
curl -sS -X POST "http://$HOST:$PORT/query" -H "Content-Type: application/json" -d '{"q":"needle","mode":"segment"}'
curl -sS -X POST "http://$HOST:$PORT/shutdown" -H "Content-Type: application/json" -H "X-Agrafes-Token: ${TOKEN}" -d '{}'
```

Useful helper:

```bash
multicorpus status --db /tmp/agrafes.db
```

References:
- `docs/SIDECAR_API_CONTRACT.md`
- `docs/INTEGRATION_TAURI.md`

## Packaging sidecar

Install packaging extra and build PyInstaller sidecar:

```bash
pip install -e ".[packaging]"
python scripts/build_sidecar.py --preset tauri --format onefile
python scripts/build_sidecar.py --preset tauri --format onedir
python scripts/build_sidecar.py --preset fixture --format onefile
```

Equivalent explicit output path:

```bash
python scripts/build_sidecar.py --out tauri/src-tauri/binaries --format onefile
python scripts/build_sidecar.py --out tauri-fixture/src-tauri/binaries --format onefile
```

CI artifacts are produced by:
- `.github/workflows/build-sidecar.yml`
- `.github/workflows/tauri-e2e-fixture.yml`

Distribution/signing/notarization details:
- `docs/DISTRIBUTION.md`
- `docs/BENCHMARKS.md` (format benchmark summary)

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
