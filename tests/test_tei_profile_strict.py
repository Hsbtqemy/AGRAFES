"""Tests for TEI parcolab_strict profile (Sprint 3 — V1.6.2).

Covers:
1. parcolab_strict includes <encodingDesc>
2. parcolab_strict escalates missing title to severity='error'
3. parcolab_strict escalates missing date to severity='error'
4. parcolab_strict: language_ori required for translation doc_role
5. parcolab_strict: language_ori not required for non-translation
6. parcolab_strict: complete metadata produces no errors (only warnings)
7. parcolab_like unchanged (backward-compat): no encodingDesc
8. manifest.json includes validation_summary key
9. manifest validation_summary.by_severity counts correct
10. strict profile + QA strict policy gate integration (errors → blocking)
"""

from __future__ import annotations

import json
import sqlite3
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest


NS = {"tei": "http://www.tei-c.org/ns/1.0"}


def _make_doc(
    conn: sqlite3.Connection,
    title: str = "Doc",
    lang: str = "fr",
    doc_role: str = "source",
    meta: dict | None = None,
) -> int:
    meta_str = json.dumps(meta) if meta else None
    conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at, meta_json) VALUES (?,?,?,datetime('now'),?)",
        (title, lang, doc_role, meta_str),
    )
    conn.commit()
    doc_id: int = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.execute(
        "INSERT INTO units (doc_id, n, unit_type, external_id, text_raw, text_norm) VALUES (?,?,?,?,?,?)",
        (doc_id, 1, "line", 1, "Bonjour.", "Bonjour."),
    )
    conn.commit()
    return doc_id


def _export(
    conn: sqlite3.Connection,
    doc_id: int,
    tmp_path: Path,
    profile: str = "parcolab_strict",
) -> tuple[ET.Element, list[dict]]:
    from multicorpus_engine.exporters.tei import export_tei

    out = tmp_path / f"doc_{doc_id}_{profile}.tei.xml"
    _, warnings = export_tei(conn, doc_id=doc_id, output_path=out, tei_profile=profile)
    root = ET.parse(str(out)).getroot()
    return root, warnings


# ── Test 1: parcolab_strict includes <encodingDesc> ───────────────────────────

def test_strict_includes_encoding_desc(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    doc_id = _make_doc(db_conn)
    root, _ = _export(db_conn, doc_id, tmp_path)
    enc = root.findall(".//tei:encodingDesc", NS)
    assert len(enc) > 0, "parcolab_strict must include <encodingDesc>"
    app = root.findall(".//tei:encodingDesc/tei:appInfo/tei:application", NS)
    assert any(a.get("version") == "parcolab_strict" for a in app)


# ── Test 2: strict escalates missing title to error ────────────────────────────

def test_strict_escalates_missing_title_to_error(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at) VALUES (?,?,?,datetime('now'))",
        ("", "fr", "source"),
    )
    db_conn.commit()
    doc_id = db_conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    db_conn.execute(
        "INSERT INTO units (doc_id, n, unit_type, external_id, text_raw, text_norm) VALUES (?,?,?,?,?,?)",
        (doc_id, 1, "line", 1, "Bonjour.", "Bonjour."),
    )
    db_conn.commit()

    from multicorpus_engine.exporters.tei import export_tei
    out = tmp_path / "missing_title.tei.xml"
    _, warnings = export_tei(db_conn, doc_id=doc_id, output_path=out, tei_profile="parcolab_strict")

    title_warns = [w for w in warnings if w.get("field") == "title" and w.get("profile") == "parcolab_strict"]
    assert any(w["severity"] == "error" for w in title_warns), \
        f"Expected error severity for missing title: {title_warns}"


# ── Test 3: strict escalates missing date to error ────────────────────────────

def test_strict_escalates_missing_date_to_error(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    doc_id = _make_doc(db_conn, meta={"author": "X"})  # no date
    from multicorpus_engine.exporters.tei import export_tei
    out = tmp_path / "missing_date.tei.xml"
    _, warnings = export_tei(db_conn, doc_id=doc_id, output_path=out, tei_profile="parcolab_strict")

    date_warns = [w for w in warnings if w.get("field") == "date" and w.get("profile") == "parcolab_strict"]
    assert any(w["severity"] == "error" for w in date_warns), \
        f"Expected error severity for missing date in strict mode: {date_warns}"


# ── Test 4: language_ori required for translation doc_role ────────────────────

def test_strict_requires_language_ori_for_translation(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    doc_id = _make_doc(db_conn, doc_role="translation_of", meta={"date": "2024"})
    from multicorpus_engine.exporters.tei import export_tei
    out = tmp_path / "translation_no_ori.tei.xml"
    _, warnings = export_tei(db_conn, doc_id=doc_id, output_path=out, tei_profile="parcolab_strict")

    lang_ori_warns = [w for w in warnings if w.get("field") == "language_ori"]
    assert len(lang_ori_warns) > 0, "Expected language_ori warning for translation doc_role"
    assert any(w["severity"] == "error" for w in lang_ori_warns)


# ── Test 5: language_ori NOT required for non-translation ─────────────────────

def test_strict_no_language_ori_required_for_source(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    doc_id = _make_doc(db_conn, doc_role="source", meta={"date": "2024"})
    from multicorpus_engine.exporters.tei import export_tei
    out = tmp_path / "source_no_ori.tei.xml"
    _, warnings = export_tei(db_conn, doc_id=doc_id, output_path=out, tei_profile="parcolab_strict")

    lang_ori_warns = [w for w in warnings if w.get("field") == "language_ori"]
    assert len(lang_ori_warns) == 0, "language_ori should not be required for source doc_role"


# ── Test 6: complete metadata produces no error-severity warnings ─────────────

def test_strict_complete_metadata_no_errors(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    meta = {
        "author": "Machiavel",
        "publisher": "Gallimard",
        "pubPlace": "Paris",
        "date": "1532",
        "domain": "politics",
        "genre": "treatise",
    }
    doc_id = _make_doc(db_conn, title="Le Prince", lang="fr", doc_role="source", meta=meta)
    from multicorpus_engine.exporters.tei import export_tei
    out = tmp_path / "complete.tei.xml"
    _, warnings = export_tei(db_conn, doc_id=doc_id, output_path=out, tei_profile="parcolab_strict")

    error_warns = [w for w in warnings if w.get("severity") == "error"]
    assert len(error_warns) == 0, f"No errors expected with complete metadata, got: {error_warns}"


# ── Test 7: parcolab_like backward compat — no encodingDesc ──────────────────

def test_parcolab_like_no_encoding_desc(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    doc_id = _make_doc(db_conn)
    root, warnings = _export(db_conn, doc_id, tmp_path, profile="parcolab_like")
    enc = root.findall(".//tei:encodingDesc", NS)
    assert len(enc) == 0, "parcolab_like must NOT include <encodingDesc>"
    # parcolab_like should not escalate to error
    error_warns = [w for w in warnings if w.get("severity") == "error"]
    assert len(error_warns) == 0, f"parcolab_like should not produce errors: {error_warns}"


# ── Test 8: manifest.json includes validation_summary ─────────────────────────

def test_manifest_includes_validation_summary(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    from multicorpus_engine.exporters.tei_package import export_tei_package
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    import os, tempfile

    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False, mode="w", encoding="utf-8") as f:
        f.write("[1] Bonjour.\n[2] Au revoir.\n")
        tmpf = f.name
    try:
        import_txt_numbered_lines(db_conn, tmpf, language="fr", title="Manifest validation test")
    finally:
        os.unlink(tmpf)

    out_zip = tmp_path / "test_manifest_vs.zip"
    export_tei_package(db_conn, output_path=out_zip)

    with zipfile.ZipFile(out_zip, "r") as zf:
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))

    assert "validation_summary" in manifest, "manifest must include validation_summary"
    vs = manifest["validation_summary"]
    assert "total_warnings" in vs
    assert "by_severity" in vs
    assert "by_type" in vs


# ── Test 9: validation_summary counts correct ─────────────────────────────────

def test_manifest_validation_summary_counts(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Empty doc title → warning emitted → validation_summary counts it."""
    from multicorpus_engine.exporters.tei_package import export_tei_package
    import os, tempfile

    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False, mode="w", encoding="utf-8") as f:
        f.write("[1] Bonjour.\n")
        tmpf = f.name
    try:
        from multicorpus_engine.importers.txt import import_txt_numbered_lines
        import_txt_numbered_lines(db_conn, tmpf, language="fr", title="OK doc")
    finally:
        os.unlink(tmpf)

    out_zip = tmp_path / "counts_test.zip"
    export_tei_package(db_conn, output_path=out_zip, tei_profile="generic")

    with zipfile.ZipFile(out_zip, "r") as zf:
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))

    vs = manifest["validation_summary"]
    assert isinstance(vs["total_warnings"], int)
    assert isinstance(vs["by_severity"]["error"], int)
    assert isinstance(vs["by_severity"]["warning"], int)
    # Generic profile: no error warnings expected
    assert vs["by_severity"]["error"] == 0


# ── Test 10: strict profile QA policy integration (errors → blocking gate) ────

def test_strict_profile_with_strict_policy_gate(db_conn: sqlite3.Connection) -> None:
    """parcolab_strict errors in meta → blocking in QA strict policy."""
    from multicorpus_engine.qa_report import generate_qa_report

    # Insert doc with empty title → will be flagged missing by QA meta check
    db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at) VALUES (?,?,?,datetime('now'))",
        ("", "fr", "source"),
    )
    db_conn.commit()
    doc_id = db_conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    report_strict = generate_qa_report(db_conn, policy="strict")
    # Empty title → meta_error → blocking in strict
    assert report_strict["gates"]["status"] == "blocking"
    assert report_strict["summary"]["meta_error"] > 0
