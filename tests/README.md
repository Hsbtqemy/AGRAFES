# Test Suite Notes

## Naming conventions in this repository

- `test_v2.py`: regression coverage for **V2.0** features
  - TXT importer (`txt_numbered_lines`)
  - DOCX paragraphs importer
  - position-based alignment
  - KWIC `--all-occurrences`
- `test_v21.py`: regression coverage for **V2.1** features
  - TEI importer
  - curation engine
  - proximity query helper

These files are kept as milestone regression packs. New tests can be added either:
- in feature-focused files (`test_import.py`, `test_query.py`, ...), or
- in a new milestone pack when introducing a major increment.
