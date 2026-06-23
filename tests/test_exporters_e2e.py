"""End-to-end coverage for the under-tested exporter modules.

`test_exporters.py` covers tei / csv / jsonl / html. This file fills the
gap : ske_export, conllu_export, readable_text — exercised against a real
corpus with tokens inserted directly (no spaCy dependency).

Vérification déclenchée par un doute utilisateur (« certains exports ne
sont pas fonctionnels ») — ces 3 modules n'avaient aucun test direct.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from tests.conftest import make_docx


@pytest.fixture()
def annotated_corpus(db_conn: sqlite3.Connection, tmp_path: Path) -> dict:
    """One FR doc, indexed, with tokens inserted directly into the tokens table.

    Tokens are inserted by hand (no spaCy) so the token-level exporters
    (ske, conllu) have real data to serialize.
    """
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
    from multicorpus_engine.indexer import build_index

    path = tmp_path / "doc.docx"
    path.write_bytes(make_docx(["[1] Le chat dort.", "[2] Il pleut."]))
    report = import_docx_numbered_lines(
        conn=db_conn, path=path, language="fr", title="Corpus E2E", doc_role="original",
    )
    build_index(db_conn)

    line_units = db_conn.execute(
        "SELECT unit_id, n FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
        (report.doc_id,),
    ).fetchall()
    # Insert a few tokens per unit: sent_id=0, positions 1..N.
    fake = {
        line_units[0]["unit_id"]: [
            ("Le", "le", "DET"), ("chat", "chat", "NOUN"), ("dort", "dormir", "VERB"),
        ],
        line_units[1]["unit_id"]: [
            ("Il", "il", "PRON"), ("pleut", "pleuvoir", "VERB"),
        ],
    }
    for unit_id, toks in fake.items():
        for pos, (word, lemma, upos) in enumerate(toks, start=1):
            db_conn.execute(
                "INSERT INTO tokens (unit_id, sent_id, position, word, lemma, upos,"
                " xpos, feats, misc) VALUES (?, 0, ?, ?, ?, ?, NULL, NULL, NULL)",
                (unit_id, pos, word, lemma, upos),
            )
    db_conn.commit()
    return {"doc_id": report.doc_id, "token_total": 5}


# ─── ske_export ─────────────────────────────────────────────────────────────


def test_ske_export_produces_tokens(annotated_corpus, db_conn, tmp_path):
    from multicorpus_engine.exporters.ske_export import export_ske

    out = tmp_path / "corpus.ske"
    summary = export_ske(db_conn, out, doc_ids=None)

    assert out.exists()
    assert summary["docs_written"] == 1
    assert summary["sentences_written"] == 2
    assert summary["tokens_written"] == 5
    content = out.read_text(encoding="utf-8")
    assert "<doc" in content and "<s " in content
    # Vertical format: word<TAB>lemma<TAB>upos...
    assert "chat\tchat\tNOUN" in content
    assert "dort\tdormir\tVERB" in content


def test_ske_export_empty_corpus_is_graceful(db_conn, tmp_path):
    """No tokens → empty file, zero counts, no exception (legit edge case)."""
    from multicorpus_engine.exporters.ske_export import export_ske

    out = tmp_path / "empty.ske"
    summary = export_ske(db_conn, out, doc_ids=None)
    assert out.exists()
    assert summary["tokens_written"] == 0


# ─── conllu_export ──────────────────────────────────────────────────────────


def test_conllu_export_produces_valid_format(annotated_corpus, db_conn, tmp_path):
    from multicorpus_engine.exporters.conllu_export import export_conllu

    out = tmp_path / "corpus.conllu"
    summary = export_conllu(db_conn, out, doc_ids=None)

    assert out.exists()
    assert summary["tokens_written"] == 5
    content = out.read_text(encoding="utf-8")
    # CoNLL-U : 10 tab-separated columns per token line ; ID starts at 1.
    token_lines = [
        ln for ln in content.splitlines()
        if ln and not ln.startswith("#")
    ]
    assert token_lines, "CoNLL-U output has no token lines"
    for ln in token_lines:
        cols = ln.split("\t")
        assert len(cols) == 10, f"CoNLL-U line must have 10 columns: {ln!r}"
    # First token of first sentence: ID=1, FORM=Le, LEMMA=le, UPOS=DET
    first = token_lines[0].split("\t")
    assert first[0] == "1"
    assert first[1] == "Le"
    assert first[2] == "le"
    assert first[3] == "DET"


# ─── readable_text ──────────────────────────────────────────────────────────


def test_readable_text_export_txt(annotated_corpus, db_conn, tmp_path):
    from multicorpus_engine.exporters.readable_text import export_readable_text

    out_dir = tmp_path / "readable"
    summary = export_readable_text(db_conn, out_dir=out_dir, doc_ids=None, fmt="txt")

    assert summary["count"] == 1
    assert summary["format"] == "txt"
    files = list(out_dir.glob("*.txt"))
    assert len(files) == 1
    body = files[0].read_text(encoding="utf-8")
    assert "chat" in body and "pleut" in body


def test_readable_text_export_docx(annotated_corpus, db_conn, tmp_path):
    from multicorpus_engine.exporters.readable_text import export_readable_text

    out_dir = tmp_path / "readable_docx"
    summary = export_readable_text(db_conn, out_dir=out_dir, doc_ids=None, fmt="docx")

    assert summary["count"] == 1
    assert summary["format"] == "docx"
    files = list(out_dir.glob("*.docx"))
    assert len(files) == 1
    # The .docx must be a valid zip openable by python-docx.
    import docx as _docx
    d = _docx.Document(str(files[0]))
    full = "\n".join(p.text for p in d.paragraphs)
    assert "chat" in full and "pleut" in full


def test_readable_text_export_odt(annotated_corpus, db_conn, tmp_path):
    import zipfile

    from multicorpus_engine.exporters.readable_text import export_readable_text
    from multicorpus_engine.importers.odt_common import read_odt_paragraph_lines

    out_dir = tmp_path / "readable_odt"
    summary = export_readable_text(db_conn, out_dir=out_dir, doc_ids=None, fmt="odt")

    assert summary["count"] == 1
    assert summary["format"] == "odt"
    files = list(out_dir.glob("*.odt"))
    assert len(files) == 1

    # Valid ODF package: `mimetype` first/stored, content.xml present.
    with zipfile.ZipFile(files[0]) as zf:
        names = zf.namelist()
        assert names[0] == "mimetype"
        assert zf.read("mimetype").decode("ascii") == "application/vnd.oasis.opendocument.text"
        assert zf.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
        assert "content.xml" in names and "META-INF/manifest.xml" in names

    # Round-trips through the ODT importer (heading + line units).
    lines = read_odt_paragraph_lines(files[0])
    assert lines[0] == "Corpus E2E [fr]"  # title heading
    body = "\n".join(lines)
    assert "chat" in body and "pleut" in body


def test_readable_text_export_odt_escapes_xml(db_conn, tmp_path):
    """Title/lines with XML metacharacters must not break content.xml."""
    from multicorpus_engine.exporters.readable_text import export_readable_text
    from multicorpus_engine.importers.odt_common import read_odt_paragraph_lines

    db_conn.execute(
        "INSERT INTO documents (doc_id, title, language, created_at) VALUES (1, ?, 'fr', '2026-01-01')",
        ("A & B <tag>",),
    )
    db_conn.execute(
        "INSERT INTO units (doc_id, n, unit_type, external_id, text_raw, text_norm) "
        "VALUES (1, 1, 'line', 1, ?, ?)",
        ("x < y & z", "x < y & z"),
    )
    db_conn.commit()

    out_dir = tmp_path / "odt_escape"
    export_readable_text(db_conn, out_dir=out_dir, doc_ids=[1], fmt="odt", include_external_id=False)
    f = next(out_dir.glob("*.odt"))
    lines = read_odt_paragraph_lines(f)  # parses content.xml — fails if escaping is wrong
    assert lines[0] == "A & B <tag> [fr]"
    assert "x < y & z" in lines


def test_readable_text_export_odt_strips_control_chars(db_conn, tmp_path):
    """Control chars illegal in XML 1.0 are dropped so content.xml stays well-formed."""
    from multicorpus_engine.exporters.readable_text import export_readable_text
    from multicorpus_engine.importers.odt_common import read_odt_paragraph_lines

    bad = "a" + chr(0) + "b" + chr(7) + "c"  # NUL + BEL — illegal in XML 1.0
    db_conn.execute(
        "INSERT INTO documents (doc_id, title, language, created_at) VALUES (1, 'T', 'fr', '2026-01-01')"
    )
    db_conn.execute(
        "INSERT INTO units (doc_id, n, unit_type, external_id, text_raw, text_norm) "
        "VALUES (1, 1, 'line', 1, ?, ?)",
        (bad, bad),
    )
    db_conn.commit()

    out_dir = tmp_path / "odt_ctrl"
    export_readable_text(db_conn, out_dir=out_dir, doc_ids=[1], fmt="odt", include_external_id=False)
    f = next(out_dir.glob("*.odt"))
    lines = read_odt_paragraph_lines(f)  # raises if content.xml is ill-formed
    assert lines[0] == "T [fr]"
    assert "abc" in lines  # control chars dropped, surrounding text kept


# ─── TMX builder (sidecar inline export) ────────────────────────────────────


def test_build_tmx_produces_valid_tmx() -> None:
    """Regression : _build_tmx référençait `SidecarHandler` (classe renommée
    `_CorpusHandler`) → NameError silencieux sur tout export TMX. Ce test
    appelle la staticmethod directement, sans serveur."""
    from multicorpus_engine.sidecar import _CorpusHandler

    tu_list = [
        [("fr", "Bonjour le monde."), ("en", "Hello world.")],
        [("fr", "Le chat dort."), ("en", "The cat sleeps.")],
    ]
    tmx = _CorpusHandler._build_tmx(tu_list, "fr", "1.6.27")

    assert tmx.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    assert '<tmx version="1.4">' in tmx
    assert tmx.count("<tu tuid=") == 2
    assert '<tuv xml:lang="fr">' in tmx
    assert '<tuv xml:lang="en">' in tmx
    assert "<seg>Hello world.</seg>" in tmx
    assert tmx.rstrip().endswith("</tmx>")


def test_build_tmx_escapes_xml_special_chars() -> None:
    """Le contenu des segments doit être échappé (pas de TMX malformé)."""
    from multicorpus_engine.sidecar import _CorpusHandler

    tu_list = [[("fr", 'Il dit "<bonjour>" & partit'), ("en", "x")]]
    tmx = _CorpusHandler._build_tmx(tu_list, "fr", "1.0")
    assert "&amp;" in tmx
    assert "&lt;bonjour&gt;" in tmx
    assert "&quot;" in tmx
    assert "<bonjour>" not in tmx  # raw angle brackets must not leak


def test_build_tmx_strips_control_chars() -> None:
    """Control chars illegal in XML 1.0 must be stripped → TMX stays well-formed."""
    import xml.etree.ElementTree as ET

    from multicorpus_engine.sidecar import _CorpusHandler

    tu_list = [[("fr", "a" + chr(0x00) + "b"), ("en", "c" + chr(0x07) + "d")]]
    tmx = _CorpusHandler._build_tmx(tu_list, "fr", "1.0")
    ET.fromstring(tmx)  # raises if the document is malformed
    assert chr(0x00) not in tmx and chr(0x07) not in tmx
    assert "<seg>ab</seg>" in tmx and "<seg>cd</seg>" in tmx
