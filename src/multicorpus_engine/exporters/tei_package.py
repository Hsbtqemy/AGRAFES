"""TEI Publication Package exporter.

Produces a ZIP archive containing:
- tei/{doc_id}.tei.xml  — one TEI file per document
- manifest.json         — document list + export parameters
- checksums.txt         — SHA-256 per file (space-separated: hash filename)
- README.md             — human-readable summary

No stderr output (all warnings go to returned dict).
See docs/TEI_PROFILE.md §6.
"""

from __future__ import annotations

import datetime
import hashlib
import io
import json
import sqlite3
import zipfile
from pathlib import Path
from typing import Optional

from .tei import export_tei


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

    # Build TEI files in-memory, then ZIP
    tei_files: dict[str, bytes] = {}  # zip_name → bytes

    for doc_id in doc_ids:
        buf = io.BytesIO()
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

    # Build manifest
    doc_rows = conn.execute(
        "SELECT doc_id, title, language, doc_role, source_path, created_at FROM documents WHERE doc_id IN ({})".format(
            ",".join("?" * len(doc_ids))
        ),
        doc_ids,
    ).fetchall()

    manifest = {
        "created_at": created_at,
        "tool": "multicorpus_engine",
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
        "export_options": {
            "include_structure": include_structure,
            "include_alignment": include_alignment,
            "status_filter": status_filter,
        },
    }
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")

    # Build README
    doc_list_md = "\n".join(
        f"- `tei/doc_{row['doc_id']}.tei.xml` — {row['title']} ({row['language']})"
        for row in doc_rows
    )
    readme_content = f"""# AGRAFES Publication Package

Generated: {created_at}

## Contents

{doc_list_md}

- `manifest.json` — document list and export parameters
- `checksums.txt` — SHA-256 checksums for all TEI files
- `README.md` — this file

## Usage

Import the TEI files into your target platform.
Verify file integrity with `checksums.txt` (SHA-256).
"""
    readme_bytes = readme_content.encode("utf-8")

    # Build checksums
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
