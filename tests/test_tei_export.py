"""Tests for TEI export: import → export baseline (Sprint 1) + alignments (Sprint 2) + relations (Sprint 3)."""

from __future__ import annotations

import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

_TEI_NS = "http://www.tei-c.org/ns/1.0"
_XML_NS = "http://www.w3.org/XML/1998/namespace"


def _ns(tag: str) -> str:
    return f"{{{_TEI_NS}}}{tag}"


def _xml(attr: str) -> str:
    return f"{{{_XML_NS}}}{attr}"


def _load_tei(path: Path) -> ET.Element:
    tree = ET.parse(path)
    return tree.getroot()


# ──────────────────────────────────────────────────────────────────────────────
# Sprint 1 — Import → Export baseline
# ──────────────────────────────────────────────────────────────────────────────

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "tei"


def test_tei_export_teiheader_minimal(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Export TEI must include a minimal teiHeader with title and language."""
    from multicorpus_engine.importers.tei_importer import import_tei
    from multicorpus_engine.exporters.tei import export_tei

    report = import_tei(
        conn=db_conn,
        path=FIXTURES_DIR / "tei_simple_div_p_s.xml",
        language="fr",
    )
    assert report.doc_id > 0

    out = tmp_path / "out.tei.xml"
    export_tei(db_conn, doc_id=report.doc_id, output_path=out)

    assert out.exists()
    root = _load_tei(out)

    # teiHeader must be present
    header = root.find(_ns("teiHeader"))
    assert header is not None, "<teiHeader> missing"

    # title
    title_el = header.find(f".//{_ns('title')}")
    assert title_el is not None, "<title> missing"
    assert title_el.text, "<title> is empty"

    # language
    lang_el = header.find(f".//{_ns('language')}")
    assert lang_el is not None, "<language> missing"
    assert lang_el.get("ident"), "<language ident> missing"


def test_tei_export_external_id_preserved(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """export_tei must preserve external_id as @n attribute on <p> elements."""
    from multicorpus_engine.importers.tei_importer import import_tei
    from multicorpus_engine.exporters.tei import export_tei

    report = import_tei(
        conn=db_conn,
        path=FIXTURES_DIR / "tei_simple_div_p_s.xml",
        language="fr",
    )
    out = tmp_path / "extid.tei.xml"
    export_tei(db_conn, doc_id=report.doc_id, output_path=out)

    root = _load_tei(out)
    body = root.find(f".//{_ns('body')}")
    assert body is not None, "<body> missing"
    p_elements = body.findall(f".//{_ns('p')}")
    assert len(p_elements) >= 3, "Expected ≥3 <p> elements in body"

    # @n must be present and be a digit
    for p in p_elements:
        n_val = p.get("n")
        assert n_val is not None, "<p> missing @n"
        assert n_val.isdigit(), f"@n is not a digit: {n_val!r}"

    # xml:id must be present and start with 'u'
    for p in p_elements:
        xmlid = p.get(_xml("id"))
        assert xmlid is not None, "<p> missing xml:id"
        assert xmlid.startswith("u"), f"xml:id does not start with 'u': {xmlid!r}"


def test_tei_export_include_structure(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """include_structure=True must add <head> elements for structure units."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.exporters.tei import export_tei

    txt_path = tmp_path / "doc.txt"
    txt_path.write_text(
        "Introduction\n[1] First line.\n[2] Second line.\nConclusion\n",
        encoding="utf-8",
    )
    report = import_txt_numbered_lines(
        conn=db_conn, path=txt_path, language="en", title="Struct test"
    )

    # Without structure
    out_no_struct = tmp_path / "no_struct.tei.xml"
    export_tei(db_conn, doc_id=report.doc_id, output_path=out_no_struct, include_structure=False)
    root_ns = _load_tei(out_no_struct)
    heads_ns = root_ns.findall(f".//{_ns('head')}")
    assert heads_ns == [], f"Expected no <head> without include_structure, got {len(heads_ns)}"

    # With structure
    out_struct = tmp_path / "struct.tei.xml"
    export_tei(db_conn, doc_id=report.doc_id, output_path=out_struct, include_structure=True)
    root_s = _load_tei(out_struct)
    heads = root_s.findall(f".//{_ns('head')}")
    assert len(heads) >= 2, f"Expected ≥2 <head> with include_structure, got {len(heads)}"
    # <head> must have xml:id
    for h in heads:
        assert h.get(_xml("id")), "<head> missing xml:id"


def test_tei_export_from_fixture_with_head(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Import TEI fixture with head elements, export and verify p elements preserved."""
    from multicorpus_engine.importers.tei_importer import import_tei
    from multicorpus_engine.exporters.tei import export_tei

    report = import_tei(
        conn=db_conn,
        path=FIXTURES_DIR / "tei_with_head_and_xmlid.xml",
        language="en",
    )
    assert report.units_line == 4, f"Expected 4 line units, got {report.units_line}"

    out = tmp_path / "head.tei.xml"
    export_tei(db_conn, doc_id=report.doc_id, output_path=out)

    root = _load_tei(out)
    body = root.find(f".//{_ns('body')}")
    assert body is not None, "<body> missing"
    p_elements = body.findall(f".//{_ns('p')}")
    assert len(p_elements) == 4, f"Expected 4 <p> in body of export, got {len(p_elements)}"


# ──────────────────────────────────────────────────────────────────────────────
# Sprint 2 — Alignments in TEI export (linkGrp)
# ──────────────────────────────────────────────────────────────────────────────

def _make_aligned_db(db_conn: sqlite3.Connection, tmp_path: Path) -> tuple[int, int]:
    """Helper: import pivot + target docs, create alignment links, return (pivot_id, target_id)."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.runs import create_run

    pivot_txt = tmp_path / "pivot.txt"
    pivot_txt.write_text("[1] Le prince régnait.\n[2] La mer était calme.\n[3] Un navire apparut.\n", encoding="utf-8")
    target_txt = tmp_path / "target.txt"
    target_txt.write_text("[1] The prince reigned.\n[2] The sea was calm.\n[3] A ship appeared.\n", encoding="utf-8")

    rp = import_txt_numbered_lines(db_conn, pivot_txt, language="fr", title="Pivot FR")
    rt = import_txt_numbered_lines(db_conn, target_txt, language="en", title="Target EN")

    # Retrieve unit_ids for pivot/target by external_id
    pivot_units = {
        row[0]: row[1]
        for row in db_conn.execute(
            "SELECT external_id, unit_id FROM units WHERE doc_id=? AND unit_type='line'",
            (rp.doc_id,)
        )
    }
    target_units = {
        row[0]: row[1]
        for row in db_conn.execute(
            "SELECT external_id, unit_id FROM units WHERE doc_id=? AND unit_type='line'",
            (rt.doc_id,)
        )
    }

    import datetime, uuid
    run_id = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    create_run(db_conn, "align", {"mode": "test"}, run_id=run_id)

    for ext_id in [1, 2, 3]:
        p_uid = pivot_units[ext_id]
        t_uid = target_units[ext_id]
        db_conn.execute(
            """INSERT INTO alignment_links
               (run_id, pivot_unit_id, target_unit_id, external_id, pivot_doc_id, target_doc_id, created_at, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted')""",
            (run_id, p_uid, t_uid, ext_id, rp.doc_id, rt.doc_id, now),
        )
    db_conn.commit()

    return rp.doc_id, rt.doc_id


def test_tei_export_with_alignment_linkgrp(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """include_alignment=True must produce <linkGrp> with <link> elements."""
    from multicorpus_engine.exporters.tei import export_tei

    pivot_id, target_id = _make_aligned_db(db_conn, tmp_path)

    out = tmp_path / "with_align.tei.xml"
    export_tei(
        db_conn, doc_id=pivot_id, output_path=out,
        include_alignment=True, target_doc_id=target_id,
    )

    root = _load_tei(out)
    linkgrp = root.find(f".//{_ns('linkGrp')}")
    assert linkgrp is not None, "<linkGrp> missing in TEI with include_alignment=True"
    assert linkgrp.get("type") == "alignment", "<linkGrp type> must be 'alignment'"

    links = linkgrp.findall(_ns("link"))
    assert len(links) == 3, f"Expected 3 <link>, got {len(links)}"

    for link in links:
        target_attr = link.get("target")
        assert target_attr, "<link target> missing"
        parts = target_attr.split()
        assert len(parts) == 2, f"<link target> must have 2 values: {target_attr!r}"
        # Pivot ref: internal fragment (#uN)
        assert parts[0].startswith("#u"), f"pivot ref must start with '#u': {parts[0]!r}"
        # Target ref: cross-document URI (doc_N.tei.xml#uM) — TEI P5 cross-doc form
        assert ".tei.xml#u" in parts[1], f"target ref must be a cross-doc URI (*.tei.xml#uN): {parts[1]!r}"


def test_tei_export_alignment_status_filter(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """status_filter controls which alignment links are included."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.exporters.tei import export_tei
    from multicorpus_engine.runs import create_run

    import datetime, uuid

    pivot_txt = tmp_path / "pv2.txt"
    pivot_txt.write_text("[1] Un.\n[2] Deux.\n", encoding="utf-8")
    target_txt = tmp_path / "tg2.txt"
    target_txt.write_text("[1] One.\n[2] Two.\n", encoding="utf-8")

    rp = import_txt_numbered_lines(db_conn, pivot_txt, language="fr", title="Pv2")
    rt = import_txt_numbered_lines(db_conn, target_txt, language="en", title="Tg2")

    pivot_units = {r[0]: r[1] for r in db_conn.execute(
        "SELECT external_id, unit_id FROM units WHERE doc_id=? AND unit_type='line'", (rp.doc_id,)
    )}
    target_units = {r[0]: r[1] for r in db_conn.execute(
        "SELECT external_id, unit_id FROM units WHERE doc_id=? AND unit_type='line'", (rt.doc_id,)
    )}

    run_id = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    create_run(db_conn, "align", {}, run_id=run_id)

    # link 1: accepted, link 2: unreviewed (NULL)
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,target_doc_id,created_at,status) VALUES (?,?,?,?,?,?,?,'accepted')",
        (run_id, pivot_units[1], target_units[1], 1, rp.doc_id, rt.doc_id, now),
    )
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,target_doc_id,created_at,status) VALUES (?,?,?,?,?,?,?,NULL)",
        (run_id, pivot_units[2], target_units[2], 2, rp.doc_id, rt.doc_id, now),
    )
    db_conn.commit()

    # accepted only (default)
    out_acc = tmp_path / "acc.tei.xml"
    export_tei(db_conn, doc_id=rp.doc_id, output_path=out_acc, include_alignment=True, target_doc_id=rt.doc_id)
    linkgrp_acc = _load_tei(out_acc).find(f".//{_ns('linkGrp')}")
    assert linkgrp_acc is not None
    assert len(linkgrp_acc.findall(_ns("link"))) == 1, "Only accepted link expected"

    # accepted + unreviewed
    out_all = tmp_path / "all.tei.xml"
    export_tei(
        db_conn, doc_id=rp.doc_id, output_path=out_all,
        include_alignment=True, target_doc_id=rt.doc_id,
        status_filter=["accepted", "unreviewed"],
    )
    linkgrp_all = _load_tei(out_all).find(f".//{_ns('linkGrp')}")
    assert linkgrp_all is not None
    assert len(linkgrp_all.findall(_ns("link"))) == 2, "Both links expected"


# ──────────────────────────────────────────────────────────────────────────────
# Sprint 3 — teiHeader enrichi + relations + warnings
# ──────────────────────────────────────────────────────────────────────────────

def test_tei_export_header_enriched(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """export_tei with enrich_header=True adds textClass (doc_role, resource_type)."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.exporters.tei import export_tei

    txt = tmp_path / "enrich.txt"
    txt.write_text("[1] Bonjour.\n", encoding="utf-8")

    report = import_txt_numbered_lines(
        db_conn, txt, language="fr", title="Enrichi",
        doc_role="translation", resource_type="article",
    )

    out = tmp_path / "enriched.tei.xml"
    export_tei(db_conn, doc_id=report.doc_id, output_path=out, enrich_header=True)

    content = out.read_text(encoding="utf-8")
    assert "textClass" in content or "doc_role" in content or "translation" in content, \
        "enrich_header should include doc_role information"


def test_tei_export_doc_relation(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """export_tei must include <listRelation> when doc_relations exist for the doc."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.exporters.tei import export_tei

    txt_pv = tmp_path / "pv_rel.txt"
    txt_pv.write_text("[1] Original.\n", encoding="utf-8")
    txt_tg = tmp_path / "tg_rel.txt"
    txt_tg.write_text("[1] Traduction.\n", encoding="utf-8")

    rp = import_txt_numbered_lines(db_conn, txt_pv, language="fr", title="Original")
    rt = import_txt_numbered_lines(db_conn, txt_tg, language="fr", title="Traduction")

    import datetime
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    db_conn.execute(
        "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, note, created_at) VALUES (?,?,?,?,?)",
        (rt.doc_id, "translation_of", rp.doc_id, None, now),
    )
    db_conn.commit()

    out = tmp_path / "relation.tei.xml"
    export_tei(db_conn, doc_id=rt.doc_id, output_path=out)

    content = out.read_text(encoding="utf-8")
    assert "listRelation" in content, "<listRelation> expected when doc_relations exist"
    assert "translation_of" in content, "relation_type 'translation_of' must appear in TEI"


def test_tei_export_missing_title_warning(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """export_tei must include a warning in returned stats if title is empty."""
    from multicorpus_engine.exporters.tei import export_tei

    # Insert a document with empty title directly
    now = "2026-01-01T00:00:00Z"
    cur = db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, meta_json, source_path, source_hash, created_at) VALUES (?,?,?,?,?,?,?)",
        ("", "fr", "standalone", None, None, None, now),
    )
    doc_id = cur.lastrowid
    db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm) VALUES (?,?,?,?,?,?)",
        (doc_id, "line", 1, 1, "Hello.", "Hello."),
    )
    db_conn.commit()

    out = tmp_path / "notitle.tei.xml"
    _, warnings = export_tei(db_conn, doc_id=doc_id, output_path=out)

    assert out.exists()
    missing = [w for w in warnings if isinstance(w, dict) and w.get("field") == "title"]
    assert missing, f"Expected warning for missing title, got {warnings}"


# ──────────────────────────────────────────────────────────────────────────────
# Sprint 4 — Publication Package ZIP
# ──────────────────────────────────────────────────────────────────────────────

def test_tei_publication_package_contents(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """export_tei_package must produce a ZIP with tei/*.xml, manifest.json, checksums.txt, README.md."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.exporters.tei_package import export_tei_package
    import zipfile

    txt = tmp_path / "pkg.txt"
    txt.write_text("[1] Bonjour.\n[2] Au revoir.\n", encoding="utf-8")
    report = import_txt_numbered_lines(db_conn, txt, language="fr", title="Package doc")

    out_zip = tmp_path / "pub.zip"
    result = export_tei_package(db_conn, doc_ids=[report.doc_id], output_path=out_zip)

    assert out_zip.exists(), "ZIP file not created"
    assert result["doc_count"] == 1
    assert result["zip_path"] == str(out_zip)

    with zipfile.ZipFile(out_zip, "r") as zf:
        names = zf.namelist()
        # Must contain TEI file
        tei_files = [n for n in names if n.startswith("tei/") and n.endswith(".xml")]
        assert len(tei_files) == 1, f"Expected 1 tei/*.xml, got {tei_files}"
        # Must contain manifest, checksums, README
        assert "manifest.json" in names, f"manifest.json missing; got {names}"
        assert "checksums.txt" in names, f"checksums.txt missing; got {names}"
        assert "README.md" in names, f"README.md missing; got {names}"

        # Validate manifest structure
        import json
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert "documents" in manifest
        assert "created_at" in manifest


def test_tei_publication_package_checksums(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """Checksums in the ZIP must match the actual TEI file contents."""
    from multicorpus_engine.importers.txt import import_txt_numbered_lines
    from multicorpus_engine.exporters.tei_package import export_tei_package
    import hashlib, zipfile

    txt = tmp_path / "chk.txt"
    txt.write_text("[1] Hello.\n", encoding="utf-8")
    report = import_txt_numbered_lines(db_conn, txt, language="en", title="Checksum test")

    out_zip = tmp_path / "chk.zip"
    export_tei_package(db_conn, doc_ids=[report.doc_id], output_path=out_zip)

    with zipfile.ZipFile(out_zip, "r") as zf:
        checksums_raw = zf.read("checksums.txt").decode("utf-8")
        for line in checksums_raw.splitlines():
            if not line.strip():
                continue
            parts = line.split(None, 1)
            assert len(parts) == 2, f"Unexpected checksum line format: {line!r}"
            expected_hash, filename = parts
            actual_data = zf.read(filename)
            actual_hash = hashlib.sha256(actual_data).hexdigest()
            assert actual_hash == expected_hash, \
                f"Checksum mismatch for {filename}: expected {expected_hash}, got {actual_hash}"


# ──────────────────────────────────────────────────────────────────────────────
# Rich text / inline <hi> markup propagation
# ──────────────────────────────────────────────────────────────────────────────

def _insert_unit_with_raw(
    db_conn: sqlite3.Connection,
    text_raw: str,
    text_norm: str | None = None,
) -> int:
    """Helper: create a minimal document + one line unit with the given text_raw.

    Returns the new doc_id.
    """
    now = "2026-01-01T00:00:00Z"
    cur = db_conn.execute(
        "INSERT INTO documents (title, language, doc_role, meta_json, source_path, source_hash, created_at)"
        " VALUES (?,?,?,?,?,?,?)",
        ("Rich text doc", "fr", "standalone", None, None, None, now),
    )
    doc_id = cur.lastrowid
    db_conn.execute(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm)"
        " VALUES (?,?,?,?,?,?)",
        (doc_id, "line", 1, 1, text_raw, text_norm or text_raw),
    )
    db_conn.commit()
    return doc_id


def _body_p_elements(root: ET.Element) -> list[ET.Element]:
    """Return <p> elements inside body/div (excludes teiHeader <p> elements)."""
    body = root.find(f".//{_ns('body')}")
    if body is None:
        return []
    return body.findall(f".//{_ns('p')}")


def test_tei_export_hi_italic(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """A unit with <hi rend="italic"> in text_raw must produce <hi rend="italic"> in <p>."""
    from multicorpus_engine.exporters.tei import export_tei

    text_raw = 'un <hi rend="italic">titre</hi> important'
    doc_id = _insert_unit_with_raw(db_conn, text_raw, text_norm="un titre important")

    out = tmp_path / "hi_italic.tei.xml"
    export_tei(db_conn, doc_id=doc_id, output_path=out)

    root = _load_tei(out)
    p_elements = _body_p_elements(root)
    assert p_elements, "Expected at least one <p> in output"
    p = p_elements[0]

    # <p> text before <hi>
    assert p.text and "un" in p.text, f"Expected 'un' in p.text, got {p.text!r}"

    # <hi rend="italic"> child
    hi_elements = p.findall(_ns("hi"))
    assert len(hi_elements) == 1, f"Expected 1 <hi>, got {len(hi_elements)}"
    hi = hi_elements[0]
    assert hi.get("rend") == "italic", f"Expected rend='italic', got {hi.get('rend')!r}"
    assert hi.text == "titre", f"Expected hi.text='titre', got {hi.text!r}"

    # tail after <hi>
    assert hi.tail and "important" in hi.tail, f"Expected 'important' in hi.tail, got {hi.tail!r}"


def test_tei_export_no_hi_regression(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """A unit without <hi> markup must export exactly as before (plain text in <p>)."""
    from multicorpus_engine.exporters.tei import export_tei

    text_raw = "Texte ordinaire sans balisage."
    doc_id = _insert_unit_with_raw(db_conn, text_raw)

    out = tmp_path / "no_hi.tei.xml"
    export_tei(db_conn, doc_id=doc_id, output_path=out)

    root = _load_tei(out)
    p_elements = _body_p_elements(root)
    assert p_elements, "Expected at least one <p> in output"
    p = p_elements[0]

    # No <hi> children
    assert p.findall(_ns("hi")) == [], "Expected no <hi> children for plain text"
    # Text content matches
    assert p.text == text_raw, f"Expected p.text={text_raw!r}, got {p.text!r}"


def test_tei_export_hi_bold_italic(db_conn: sqlite3.Connection, tmp_path: Path) -> None:
    """A unit with <hi rend="bold italic"> must produce correct rend attribute."""
    from multicorpus_engine.exporters.tei import export_tei

    text_raw = 'Début <hi rend="bold italic">texte important</hi> fin.'
    doc_id = _insert_unit_with_raw(db_conn, text_raw, text_norm="Début texte important fin.")

    out = tmp_path / "hi_bold_italic.tei.xml"
    export_tei(db_conn, doc_id=doc_id, output_path=out)

    root = _load_tei(out)
    p_elements = _body_p_elements(root)
    assert p_elements, "Expected at least one <p> in output"
    p = p_elements[0]

    hi_elements = p.findall(_ns("hi"))
    assert len(hi_elements) == 1, f"Expected 1 <hi>, got {len(hi_elements)}"
    hi = hi_elements[0]
    assert hi.get("rend") == "bold italic", f"Expected rend='bold italic', got {hi.get('rend')!r}"
    assert hi.text == "texte important", f"Expected hi.text='texte important', got {hi.text!r}"
    assert p.text and "Début" in p.text, f"Expected 'Début' in p.text, got {p.text!r}"
    assert hi.tail and "fin." in hi.tail, f"Expected 'fin.' in hi.tail, got {hi.tail!r}"
