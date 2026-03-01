"""Tests for TEI publication package manifest enrichment (Sprint 3 — FAIR)."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest


def _make_package(db_conn: sqlite3.Connection, tmp_path: Path) -> tuple[Path, dict]:
    """Helper: import a doc, export a package, return (zip_path, manifest_dict)."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.exporters.tei_package import export_tei_package

    txt = tmp_path / "doc.txt"
    txt.write_text("[1] Bonjour.\n[2] Au revoir.\n", encoding="utf-8")
    import_txt_numbered_lines(db_conn, txt, language="fr", title="Manifest test doc")

    out_zip = tmp_path / "pub.zip"
    export_tei_package(db_conn, output_path=out_zip)

    with zipfile.ZipFile(out_zip, "r") as zf:
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))

    return out_zip, manifest


# ── Manifest field presence ───────────────────────────────────────────────────

def test_manifest_has_engine_version(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """manifest.json must include engine_version matching multicorpus_engine.__version__."""
    from multicorpus_engine import __version__

    _, manifest = _make_package(db_conn, tmp_path)
    assert "engine_version" in manifest, "engine_version missing from manifest"
    assert manifest["engine_version"] == __version__, \
        f"engine_version mismatch: {manifest['engine_version']!r} != {__version__!r}"


def test_manifest_has_contract_version(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """manifest.json must include contract_version matching CONTRACT_VERSION."""
    from multicorpus_engine.sidecar_contract import CONTRACT_VERSION

    _, manifest = _make_package(db_conn, tmp_path)
    assert "contract_version" in manifest, "contract_version missing from manifest"
    assert manifest["contract_version"] == CONTRACT_VERSION, \
        f"contract_version mismatch: {manifest['contract_version']!r} != {CONTRACT_VERSION!r}"


def test_manifest_has_created_at(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """manifest.json must include created_at ISO-8601 UTC timestamp."""
    _, manifest = _make_package(db_conn, tmp_path)
    assert "created_at" in manifest
    # ISO-8601 format: "2026-03-01T12:34:56Z"
    ts = manifest["created_at"]
    assert isinstance(ts, str) and "T" in ts and ts.endswith("Z"), \
        f"created_at is not ISO-8601 UTC: {ts!r}"


def test_manifest_has_export_options(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """manifest.json must include export_options with all expected keys."""
    _, manifest = _make_package(db_conn, tmp_path)
    assert "export_options" in manifest
    opts = manifest["export_options"]
    for key in ("include_structure", "include_alignment", "status_filter", "doc_ids", "doc_count"):
        assert key in opts, f"export_options missing key: {key!r}"
    assert isinstance(opts["doc_ids"], list)
    assert isinstance(opts["doc_count"], int)
    assert opts["doc_count"] == len(opts["doc_ids"])


def test_manifest_export_options_values(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """export_options values must match what was passed to export_tei_package."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.exporters.tei_package import export_tei_package

    txt = tmp_path / "v.txt"
    txt.write_text("[1] Test.\n", encoding="utf-8")
    report = import_txt_numbered_lines(db_conn, txt, language="en", title="Options test")

    out_zip = tmp_path / "opts.zip"
    export_tei_package(
        db_conn,
        doc_ids=[report.doc_id],
        output_path=out_zip,
        include_structure=True,
        include_alignment=False,
        status_filter=["accepted", "unreviewed"],
    )

    with zipfile.ZipFile(out_zip, "r") as zf:
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))

    opts = manifest["export_options"]
    assert opts["include_structure"] is True
    assert opts["include_alignment"] is False
    assert opts["status_filter"] == ["accepted", "unreviewed"]
    assert opts["doc_ids"] == [report.doc_id]
    assert opts["doc_count"] == 1


def test_manifest_has_documents(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """manifest.json documents array must list exported docs with required fields."""
    _, manifest = _make_package(db_conn, tmp_path)
    assert "documents" in manifest
    docs = manifest["documents"]
    assert len(docs) >= 1
    for doc in docs:
        for field in ("doc_id", "title", "language", "doc_role", "tei_file"):
            assert field in doc, f"documents[] entry missing field: {field!r}"
        assert doc["tei_file"].startswith("tei/"), f"tei_file should be under tei/: {doc['tei_file']!r}"


def test_manifest_db_basename_no_full_path(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """manifest.json db_basename must not contain path separators (privacy)."""
    _, manifest = _make_package(db_conn, tmp_path)
    if "db_basename" in manifest:
        # Must be a simple filename, not a full path
        basename = manifest["db_basename"]
        assert "/" not in basename and "\\" not in basename, \
            f"db_basename must not contain path separators: {basename!r}"
        assert basename.endswith(".db") or "." in basename, \
            f"db_basename should look like a filename: {basename!r}"


def test_manifest_db_file_size_is_positive_int(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """If db_file_size is present, it must be a positive integer."""
    _, manifest = _make_package(db_conn, tmp_path)
    if "db_file_size" in manifest:
        size = manifest["db_file_size"]
        assert isinstance(size, int) and size > 0, \
            f"db_file_size must be a positive int, got: {size!r}"


# ── Checksum integrity (regression — must still pass) ─────────────────────────

def test_manifest_checksums_still_valid(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Checksums in the ZIP must match file contents (regression after manifest change)."""
    out_zip, _ = _make_package(db_conn, tmp_path)

    with zipfile.ZipFile(out_zip, "r") as zf:
        checksums_raw = zf.read("checksums.txt").decode("utf-8")
        for line in checksums_raw.splitlines():
            if not line.strip():
                continue
            parts = line.split(None, 1)
            assert len(parts) == 2, f"Unexpected checksum line: {line!r}"
            expected_hash, filename = parts
            actual_data = zf.read(filename)
            actual_hash = hashlib.sha256(actual_data).hexdigest()
            assert actual_hash == expected_hash, \
                f"Checksum mismatch for {filename}: expected {expected_hash}, got {actual_hash}"


# ── README field documentation ─────────────────────────────────────────────────

def test_readme_documents_manifest_fields(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """README.md must mention manifest field names for FAIR discoverability."""
    out_zip, _ = _make_package(db_conn, tmp_path)

    with zipfile.ZipFile(out_zip, "r") as zf:
        readme = zf.read("README.md").decode("utf-8")

    for key in ("engine_version", "contract_version", "export_options", "db_basename"):
        assert key in readme, f"README.md does not mention manifest field: {key!r}"
