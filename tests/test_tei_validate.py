"""Tests for TEI consumer validation (Sprint 1) — xml:id referential integrity."""

from __future__ import annotations

import sqlite3
import zipfile
from pathlib import Path

import pytest

from multicorpus_engine.utils.tei_validate import validate_tei_ids, validate_tei_package


# ── Helpers ───────────────────────────────────────────────────────────────────

def _write_tei(path: Path, content: str) -> Path:
    path.write_text(content, encoding="utf-8")
    return path


_VALID_TEI = """\
<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Test</title></titleStmt>
      <publicationStmt><p>Test</p></publicationStmt>
      <sourceDesc><p>Test</p></sourceDesc>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
        <p xml:id="u1" n="1">First.</p>
        <p xml:id="u2" n="2">Second.</p>
      </div>
    </body>
    <linkGrp type="alignment">
      <link target="#u1 #u2"/>
    </linkGrp>
  </text>
</TEI>
"""

_BROKEN_TEI = """\
<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Test</title></titleStmt>
      <publicationStmt><p>Test</p></publicationStmt>
      <sourceDesc><p>Test</p></sourceDesc>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
        <p xml:id="u1" n="1">First.</p>
      </div>
    </body>
    <linkGrp type="alignment">
      <link target="#u1 #u999"/>
    </linkGrp>
  </text>
</TEI>
"""

_NO_LINKS_TEI = """\
<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <body>
      <div>
        <p xml:id="u1" n="1">Only line.</p>
      </div>
    </body>
  </text>
</TEI>
"""


# ── Unit tests for validate_tei_ids ──────────────────────────────────────────

def test_validate_tei_ids_valid(tmp_path: Path) -> None:
    """A TEI with link targets matching declared xml:ids returns no errors."""
    f = _write_tei(tmp_path / "valid.tei.xml", _VALID_TEI)
    errors = validate_tei_ids(f)
    assert errors == [], f"Expected no errors, got: {errors}"


def test_validate_tei_ids_broken_target(tmp_path: Path) -> None:
    """A broken <link target> referencing a non-existent xml:id returns an error."""
    f = _write_tei(tmp_path / "broken.tei.xml", _BROKEN_TEI)
    errors = validate_tei_ids(f)
    assert len(errors) == 1, f"Expected 1 error, got {errors}"
    err = errors[0]
    assert err["type"] == "broken_link_target"
    assert err["ref"] == "u999"
    assert "u999" in err["target"]


def test_validate_tei_ids_no_links(tmp_path: Path) -> None:
    """A TEI without <link> elements is always valid (no targets to check)."""
    f = _write_tei(tmp_path / "nolinks.tei.xml", _NO_LINKS_TEI)
    errors = validate_tei_ids(f)
    assert errors == []


def test_validate_tei_ids_multiple_broken(tmp_path: Path) -> None:
    """Multiple broken targets are all reported."""
    content = """\
<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <body><div><p xml:id="u1" n="1">A.</p></div></body>
    <linkGrp type="alignment">
      <link target="#u999 #u888"/>
    </linkGrp>
  </text>
</TEI>
"""
    f = _write_tei(tmp_path / "multi.tei.xml", content)
    errors = validate_tei_ids(f)
    assert len(errors) == 2
    refs = {e["ref"] for e in errors}
    assert refs == {"u999", "u888"}


def test_validate_tei_ids_bare_target(tmp_path: Path) -> None:
    """Bare id (without #) in @target is also supported."""
    content = """\
<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <body><div><p xml:id="u1" n="1">A.</p><p xml:id="u2" n="2">B.</p></div></body>
    <linkGrp type="alignment">
      <link target="u1 u2"/>
    </linkGrp>
  </text>
</TEI>
"""
    f = _write_tei(tmp_path / "bare.tei.xml", content)
    errors = validate_tei_ids(f)
    assert errors == [], f"Bare-id targets should be valid: {errors}"


def test_validate_tei_ids_parse_error(tmp_path: Path) -> None:
    """Malformed XML returns a parse_error, not an exception."""
    f = tmp_path / "bad.tei.xml"
    f.write_text("<TEI>not closed", encoding="utf-8")
    errors = validate_tei_ids(f)
    assert len(errors) == 1
    assert errors[0]["type"] == "parse_error"


def test_validate_tei_ids_missing_file(tmp_path: Path) -> None:
    """Missing file returns a parse_error (FileNotFoundError wrapped)."""
    f = tmp_path / "nonexistent.tei.xml"
    errors = validate_tei_ids(f)
    assert len(errors) == 1
    assert errors[0]["type"] == "parse_error"


# ── Regression test: package ZIP ─────────────────────────────────────────────

def test_validate_tei_package_from_export(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Generated publication package must produce valid TEI (no broken link targets)."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.exporters.tei_package import export_tei_package

    txt = tmp_path / "pkg.txt"
    txt.write_text("[1] Le prince régnait.\n[2] La mer était calme.\n", encoding="utf-8")
    report = import_txt_numbered_lines(db_conn, txt, language="fr", title="Validation pkg")

    out_zip = tmp_path / "pub.zip"
    export_tei_package(db_conn, doc_ids=[report.doc_id], output_path=out_zip)

    results = validate_tei_package(out_zip)
    assert results, "Expected at least one TEI file checked"
    for name, errors in results.items():
        assert errors == [], f"Validation errors in {name}: {errors}"


def test_validate_tei_package_with_alignment(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Package with alignment linkGrp must still be valid (all link targets declared)."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.exporters.tei_package import export_tei_package
    from multicorpus_engine.runs import create_run
    import datetime, uuid

    pivot_txt = tmp_path / "pv.txt"
    pivot_txt.write_text("[1] Un.\n[2] Deux.\n", encoding="utf-8")
    target_txt = tmp_path / "tg.txt"
    target_txt.write_text("[1] One.\n[2] Two.\n", encoding="utf-8")

    rp = import_txt_numbered_lines(db_conn, pivot_txt, language="fr", title="Pivot")
    rt = import_txt_numbered_lines(db_conn, target_txt, language="en", title="Target")

    pivot_units = {r[0]: r[1] for r in db_conn.execute(
        "SELECT external_id, unit_id FROM units WHERE doc_id=? AND unit_type='line'", (rp.doc_id,)
    )}
    target_units = {r[0]: r[1] for r in db_conn.execute(
        "SELECT external_id, unit_id FROM units WHERE doc_id=? AND unit_type='line'", (rt.doc_id,)
    )}

    run_id = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    create_run(db_conn, "align", {}, run_id=run_id)
    for ext_id in [1, 2]:
        db_conn.execute(
            "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,target_doc_id,created_at,status) VALUES (?,?,?,?,?,?,?,'accepted')",
            (run_id, pivot_units[ext_id], target_units[ext_id], ext_id, rp.doc_id, rt.doc_id, now),
        )
    db_conn.commit()

    out_zip = tmp_path / "aligned_pkg.zip"
    export_tei_package(
        db_conn,
        doc_ids=[rp.doc_id],
        output_path=out_zip,
        include_alignment=True,
    )

    results = validate_tei_package(out_zip)
    for name, errors in results.items():
        assert errors == [], f"Broken link targets in {name}: {errors}"


def test_validate_tei_package_empty_zip(tmp_path: Path) -> None:
    """An empty ZIP (no tei/ files) returns an empty result dict."""
    empty_zip = tmp_path / "empty.zip"
    with zipfile.ZipFile(empty_zip, "w") as zf:
        zf.writestr("manifest.json", "{}")
    results = validate_tei_package(empty_zip)
    assert results == {}
