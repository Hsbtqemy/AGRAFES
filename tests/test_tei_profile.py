"""Tests for TEI export profile preset (Sprint 3 — V1.5.2).

Covers:
1. Generic profile unchanged (backward-compat)
2. parcolab_like: <publisher> present from meta_json
3. parcolab_like: <pubPlace> present from meta_json
4. parcolab_like: <date> present from meta_json
5. parcolab_like: <author> present from meta_json
6. parcolab_like: <respStmt>/<name> present for translator
7. parcolab_like: <textClass>/<keywords>/<term type="domain"> present
8. parcolab_like: warnings emitted when fields missing (publisher)
9. parcolab_like: subtitle emitted as <title type="sub">
10. export_tei_package: tei_profile forwarded to manifest
"""

from __future__ import annotations

import json
import sqlite3
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest


NS = {"tei": "http://www.tei-c.org/ns/1.0"}


def _import_doc(conn: sqlite3.Connection, meta: dict | None = None) -> int:
    """Create a minimal doc with optional meta_json and return doc_id."""
    meta_str = json.dumps(meta) if meta else None
    conn.execute(
        "INSERT INTO documents (title, language, doc_role, created_at, meta_json) VALUES (?,?,?,datetime('now'),?)",
        ("Test Doc", "fr", "source", meta_str),
    )
    conn.commit()
    doc_id: int = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.execute(
        "INSERT INTO units (doc_id, n, unit_type, external_id, text_raw, text_norm) VALUES (?,?,?,?,?,?)",
        (doc_id, 1, "line", 1, "Bonjour monde.", "Bonjour monde."),
    )
    conn.commit()
    return doc_id


def _export_and_parse(
    conn: sqlite3.Connection, doc_id: int, tmp_path: Path, profile: str = "generic"
) -> ET.Element:
    from multicorpus_engine.exporters.tei import export_tei

    out = tmp_path / f"doc_{doc_id}_{profile}.tei.xml"
    export_tei(conn, doc_id=doc_id, output_path=out, tei_profile=profile)
    return ET.parse(str(out)).getroot()


# ── Test 1: generic profile unchanged ────────────────────────────────────────

def test_generic_profile_no_publisher(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Generic profile should NOT add publisher even when meta_json has it."""
    meta = {"publisher": "Éditions Test", "author": "Jean Dupont"}
    doc_id = _import_doc(db_conn, meta)
    root = _export_and_parse(db_conn, doc_id, tmp_path, profile="generic")
    # Generic profile: no <publisher> in publicationStmt
    pub_stmts = root.findall(".//tei:publicationStmt/tei:publisher", NS)
    assert len(pub_stmts) == 0, "Generic profile should not add publisher element"


# ── Test 2: parcolab_like — publisher ────────────────────────────────────────

def test_parcolab_publisher(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    meta = {"publisher": "Éditions Corpus"}
    doc_id = _import_doc(db_conn, meta)
    root = _export_and_parse(db_conn, doc_id, tmp_path, profile="parcolab_like")
    pubs = root.findall(".//tei:publicationStmt/tei:publisher", NS)
    assert len(pubs) == 1
    assert pubs[0].text == "Éditions Corpus"


# ── Test 3: parcolab_like — pubPlace ─────────────────────────────────────────

def test_parcolab_pub_place(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    meta = {"publisher": "Ed. X", "pubPlace": "Paris"}
    doc_id = _import_doc(db_conn, meta)
    root = _export_and_parse(db_conn, doc_id, tmp_path, profile="parcolab_like")
    places = root.findall(".//tei:publicationStmt/tei:pubPlace", NS)
    assert any(p.text == "Paris" for p in places)


# ── Test 4: parcolab_like — date ─────────────────────────────────────────────

def test_parcolab_date(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    meta = {"date": "2024"}
    doc_id = _import_doc(db_conn, meta)
    root = _export_and_parse(db_conn, doc_id, tmp_path, profile="parcolab_like")
    dates = root.findall(".//tei:publicationStmt/tei:date", NS)
    assert any(d.text == "2024" for d in dates)


# ── Test 5: parcolab_like — author ───────────────────────────────────────────

def test_parcolab_author(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    meta = {"author": "Marie Curie"}
    doc_id = _import_doc(db_conn, meta)
    root = _export_and_parse(db_conn, doc_id, tmp_path, profile="parcolab_like")
    authors = root.findall(".//tei:titleStmt/tei:author", NS)
    assert any(a.text == "Marie Curie" for a in authors)


# ── Test 6: parcolab_like — translator → respStmt ────────────────────────────

def test_parcolab_translator(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    meta = {"translator": "Pierre Martin"}
    doc_id = _import_doc(db_conn, meta)
    root = _export_and_parse(db_conn, doc_id, tmp_path, profile="parcolab_like")
    resp_names = root.findall(".//tei:titleStmt/tei:respStmt/tei:name", NS)
    assert any(n.text == "Pierre Martin" for n in resp_names)


# ── Test 7: parcolab_like — domain textClass keyword ─────────────────────────

def test_parcolab_domain_keyword(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    meta = {"domain": "literature", "genre": "novel"}
    doc_id = _import_doc(db_conn, meta)
    root = _export_and_parse(db_conn, doc_id, tmp_path, profile="parcolab_like")
    terms = root.findall(".//tei:profileDesc/tei:textClass/tei:keywords/tei:term", NS)
    types = {t.get("type"): t.text for t in terms}
    assert types.get("domain") == "literature"
    assert types.get("genre") == "novel"


# ── Test 8: parcolab_like — warning for missing publisher ────────────────────

def test_parcolab_warning_missing_publisher(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    from multicorpus_engine.exporters.tei import export_tei

    doc_id = _import_doc(db_conn, meta=None)  # no meta_json → missing publisher
    out = tmp_path / "warn_test.tei.xml"
    _, warnings = export_tei(db_conn, doc_id=doc_id, output_path=out, tei_profile="parcolab_like")
    warn_fields = [w.get("field", "") for w in warnings if w.get("profile") == "parcolab_like"]
    assert "publisher" in warn_fields


# ── Test 9: parcolab_like — subtitle ─────────────────────────────────────────

def test_parcolab_subtitle(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    meta = {"subtitle": "Une introduction au corpus"}
    doc_id = _import_doc(db_conn, meta)
    root = _export_and_parse(db_conn, doc_id, tmp_path, profile="parcolab_like")
    subtitles = root.findall(".//tei:titleStmt/tei:title[@type='sub']", NS)
    assert any(s.text == "Une introduction au corpus" for s in subtitles)


# ── Test 10: export_tei_package forwards tei_profile to manifest ─────────────

def test_package_tei_profile_in_manifest(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    from multicorpus_engine.exporters.tei_package import export_tei_package
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    import os, tempfile

    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False, mode="w", encoding="utf-8") as f:
        f.write("[1] Bonjour.\n[2] Au revoir.\n")
        tmpf = f.name
    try:
        import_txt_numbered_lines(db_conn, tmpf, language="fr", title="Profile test")
    finally:
        os.unlink(tmpf)

    out_zip = tmp_path / "profile_pub.zip"
    export_tei_package(db_conn, output_path=out_zip, tei_profile="parcolab_like")

    with zipfile.ZipFile(out_zip, "r") as zf:
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))

    assert manifest["export_options"]["tei_profile"] == "parcolab_like"
