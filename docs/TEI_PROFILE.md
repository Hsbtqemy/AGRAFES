# TEI Export Profiles

## Overview

AGRAFES supports two TEI export profiles that control the richness of `teiHeader` metadata:

| Profile | Key | Description |
|---------|-----|-------------|
| **Generic** | `"generic"` | Minimal header (title, language, source, listRelation if applicable). Default. |
| **ParCoLab-like** | `"parcolab_like"` | Enriched header with full bibliographic metadata from `meta_json`. |

## Generic Profile

The default profile emits:
- `titleStmt/title` (from `documents.title`)
- `publicationStmt/p` (generated timestamp)
- `sourceDesc/p` (source file path)
- `profileDesc/langUsage/language` (from `documents.language`)
- `profileDesc/listRelation` (from `doc_relations`, if any)
- Optional: `profileDesc/textClass` (when `enrich_header=True`)

## ParCoLab-like Profile

The `parcolab_like` profile enriches the `teiHeader` using values from `documents.meta_json`. Fields are read from the JSON object stored in the `meta_json` column.

### Metadata mapping

| TEI element | `meta_json` key(s) | Notes |
|------------|-------------------|-------|
| `titleStmt/title` | _(from `documents.title`)_ | Always present |
| `titleStmt/title[@type='sub']` | `subtitle` | Emitted only if present |
| `titleStmt/author` | `author` or `authors` | Semicolon-separated string or list |
| `titleStmt/respStmt/name` | `translator` or `translators` | Emits `<resp>Traduction</resp>` |
| `publicationStmt/publisher` | `publisher` | Warning if absent |
| `publicationStmt/pubPlace` | `pubPlace` or `pub_place` | Warning if absent |
| `publicationStmt/date` | `date` or `year` | Warning if absent |
| `profileDesc/langUsage/language` | `language_ori` or `language_original` | Original language if different from translation language |
| `profileDesc/textClass/keywords/term[@type='domain']` | `domain` | |
| `profileDesc/textClass/keywords/term[@type='genre']` | `genre` | |
| `profileDesc/textClass/keywords/term[@type='derivation']` | `derivation` or `doc_role` | Falls back to `documents.doc_role` |

### Warnings

When fields expected by the `parcolab_like` profile are missing, warnings are added to the export result:

```json
{"type": "tei_missing_field", "field": "publisher", "doc_id": 3, "severity": "warning", "profile": "parcolab_like"}
```

Missing fields: `author`, `publisher`, `pubPlace`, `date`, `domain/genre`.

### Example `meta_json`

```json
{
  "author": "Niccolò Machiavelli",
  "translator": "Jean Vincent Périès",
  "publisher": "Firmin Didot Frères",
  "pubPlace": "Paris",
  "date": "1825",
  "subtitle": "Avec notes et commentaires",
  "language_ori": "it",
  "domain": "political science",
  "genre": "political treatise"
}
```

## How to Set the Profile

### Via CLI (package export)

The CLI currently exposes `tei_profile` indirectly through the sidecar job params. Use the UI or the `export_tei_package` Python API directly:

```python
from multicorpus_engine.exporters.tei_package import export_tei_package
export_tei_package(conn, "output.zip", tei_profile="parcolab_like")
```

### Via UI (Constituer — ExportsScreen)

In the "Package publication" card, select "ParCoLab-like (enrichi)" in the "Profil TEI" dropdown before exporting.

### Via Publication Wizard (Shell)

In step 3 (Options), select the desired "Profil TEI" value in the dropdown.

## Compatibility

The `tei_profile` parameter is additive and backward-compatible:
- Default value `"generic"` preserves all existing behavior
- No `CONTRACT_VERSION` bump required (parameter added as optional)
- Stored in `manifest.json` under `export_options.tei_profile` for reproducibility

## Profil `parcolab_strict` (expert, V1.6.2)

Profil le plus strict, destiné aux plateformes exigeant un en-tête TEI complet et validé.

### Comportement vs `parcolab_like`

| Feature | parcolab_like | parcolab_strict |
|---|---|---|
| Enrichissement header | ✓ | ✓ (identique) |
| `<encodingDesc>` | ✗ | ✓ (avec `<appInfo>`) |
| Missing title | warning | **error** |
| Missing language | warning | **error** |
| Missing date | warning | **error** |
| Missing language_ori (translation) | — | **error** |
| manifest.validation_summary | — | ✓ (via export_tei_package) |

### Champs escaladés à `severity="error"`

- `title` : doit être non vide
- `language` : doit être non vide
- `date` : doit être présent dans `meta_json` (keys: `date` ou `year`)
- `language_ori` : requis si `doc_role` contient "translation" ou vaut "target"

### Intégration QA

Quand la **politique QA est "strict"**, les `meta_error` bloquent la gate.
Combiné avec `parcolab_strict`, tout champ manquant bloque la publication.

### Recommandation UI

Le dropdown "Profil TEI" affiche une notice ⚠ et suggère d'activer la politique QA Strict.

### Exemple

```bash
multicorpus export-tei-package --db corpus.db --out pkg.zip --tei-profile parcolab_strict
```
