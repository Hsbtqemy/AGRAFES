"""TEI Publication Package exporter.

Produces a ZIP archive containing:
- tei/{doc_id}.tei.xml  — one TEI file per document
- manifest.json         — document list + export parameters + FAIR metadata
- checksums.txt         — SHA-256 per file (space-separated: hash filename)
- README.md             — human-readable summary with manifest field descriptions

No stderr output (all warnings go to returned dict).
See docs/TEI_PROFILE.md §6.

manifest.json FAIR fields (Sprint 3):
- created_at         ISO-8601 UTC timestamp
- engine_version     multicorpus_engine.__version__
- contract_version   sidecar CONTRACT_VERSION
- export_options     {include_structure, include_alignment, status_filter, doc_ids, doc_count}
- db_basename        basename of the SQLite DB file (never full path)
- db_file_size       DB file size in bytes (if accessible via conn.execute PRAGMA)
- documents          [{doc_id, title, language, doc_role, source_path, tei_file}]
"""

from __future__ import annotations

import datetime
import hashlib
import json
import sqlite3
import zipfile
from pathlib import Path
from typing import Optional

from .tei import export_tei


def _get_db_info(conn: sqlite3.Connection) -> dict:
    """Return non-sensitive DB info: basename and file size."""
    info: dict = {}
    try:
        # Get the DB file path from PRAGMA database_list
        rows = conn.execute("PRAGMA database_list").fetchall()
        for row in rows:
            db_file = row[2] if len(row) > 2 else ""
            if db_file and db_file != ":memory:":
                p = Path(db_file)
                info["db_basename"] = p.name
                try:
                    info["db_file_size"] = p.stat().st_size
                except OSError:
                    pass
                break
    except Exception:
        pass
    return info


def export_tei_package(
    conn: sqlite3.Connection,
    output_path: str | Path,
    doc_ids: Optional[list[int]] = None,
    include_structure: bool = False,
    include_alignment: bool = False,
    status_filter: Optional[list[str]] = None,
) -> dict:
    """Export a publication package ZIP.

    Args:
        conn: SQLite connection.
        output_path: Destination .zip path.
        doc_ids: List of doc_ids to include (None = all documents).
        include_structure: Forward to export_tei.
        include_alignment: Forward to export_tei.
        status_filter: Forward to export_tei (alignment status filter).

    Returns:
        Dict with keys: zip_path (str), doc_count (int), warnings (list[dict]).
    """
    from multicorpus_engine import __version__ as engine_version
    from multicorpus_engine.sidecar_contract import CONTRACT_VERSION

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if doc_ids is None:
        doc_ids = [
            row[0]
            for row in conn.execute("SELECT doc_id FROM documents ORDER BY doc_id")
        ]

    if status_filter is None:
        status_filter = ["accepted"]

    created_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    all_warnings: list[dict] = []

    # Build TEI files via temp files, then collect bytes
    tei_files: dict[str, bytes] = {}  # zip_name → bytes

    for doc_id in doc_ids:
        tmp_path_obj = output_path.parent / f"_tmp_doc_{doc_id}.tei.xml"
        try:
            out_path, warns = export_tei(
                conn=conn,
                doc_id=doc_id,
                output_path=tmp_path_obj,
                include_structure=include_structure,
                include_alignment=include_alignment,
                status_filter=status_filter,
            )
            all_warnings.extend(warns)
            tei_content = tmp_path_obj.read_bytes()
        finally:
            if tmp_path_obj.exists():
                tmp_path_obj.unlink()

        zip_name = f"tei/doc_{doc_id}.tei.xml"
        tei_files[zip_name] = tei_content

    # Document metadata rows
    doc_rows = conn.execute(
        "SELECT doc_id, title, language, doc_role, source_path, created_at FROM documents WHERE doc_id IN ({})".format(
            ",".join("?" * len(doc_ids))
        ),
        doc_ids,
    ).fetchall()

    db_info = _get_db_info(conn)

    # Build manifest (FAIR-enriched)
    manifest = {
        "created_at": created_at,
        "tool": "multicorpus_engine",
        "engine_version": engine_version,
        "contract_version": CONTRACT_VERSION,
        "export_options": {
            "doc_ids": doc_ids,
            "doc_count": len(doc_ids),
            "include_structure": include_structure,
            "include_alignment": include_alignment,
            "status_filter": status_filter,
        },
        **db_info,
        "documents": [
            {
                "doc_id": row["doc_id"],
                "title": row["title"],
                "language": row["language"],
                "doc_role": row["doc_role"],
                "source_path": row["source_path"],
                "tei_file": f"tei/doc_{row['doc_id']}.tei.xml",
            }
            for row in doc_rows
        ],
    }
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")

    # Build README with manifest field docs
    doc_list_md = "\n".join(
        f"- `tei/doc_{row['doc_id']}.tei.xml` — {row['title']} ({row['language']})"
        for row in doc_rows
    )
    readme_content = f"""# AGRAFES Publication Package

Generated: {created_at}  
Tool: multicorpus_engine {engine_version} (contract {CONTRACT_VERSION})

## Files

{doc_list_md}

- `manifest.json` — structured metadata for this package (see below)
- `checksums.txt` — SHA-256 checksums for all TEI files and manifest.json
- `README.md` — this file

## Using the TEI files

Import `tei/*.tei.xml` into your target platform (ParCoLab, TXM, Oxygen, etc.).
Verify file integrity with `checksums.txt`:

```
sha256sum -c checksums.txt
```

## manifest.json fields

| Field | Description |
|-------|-------------|
| `created_at` | Export timestamp (ISO-8601 UTC) |
| `tool` | Tool name (`multicorpus_engine`) |
| `engine_version` | multicorpus_engine package version |
| `contract_version` | Sidecar API contract version |
| `export_options.include_structure` | Whether `<head>` elements were included |
| `export_options.include_alignment` | Whether `<linkGrp>` alignment was included |
| `export_options.status_filter` | Alignment link statuses included |
| `export_options.doc_ids` | List of exported doc_ids |
| `db_basename` | Basename of the source SQLite database (no full path) |
| `db_file_size` | Source database file size in bytes (if accessible) |
| `documents` | Array of document metadata records |

## TEI Profile

This package conforms to the AGRAFES TEI Profile (docs/TEI_PROFILE.md).
Each file contains a `<teiHeader>` with title, language, and source information.
"""
    readme_bytes = readme_content.encode("utf-8")

    # Build checksums (TEI files + manifest)
    all_file_bytes: dict[str, bytes] = {**tei_files, "manifest.json": manifest_bytes}
    checksums_lines = []
    for fname, data in sorted(all_file_bytes.items()):
        h = hashlib.sha256(data).hexdigest()
        checksums_lines.append(f"{h}  {fname}")
    checksums_bytes = ("\n".join(checksums_lines) + "\n").encode("utf-8")

    # Write ZIP
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for zip_name, data in tei_files.items():
            zf.writestr(zip_name, data)
        zf.writestr("manifest.json", manifest_bytes)
        zf.writestr("checksums.txt", checksums_bytes)
        zf.writestr("README.md", readme_bytes)

    return {
        "zip_path": str(output_path),
        "doc_count": len(doc_ids),
        "warnings": all_warnings,
    }
