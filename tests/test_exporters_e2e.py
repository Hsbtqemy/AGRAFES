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
