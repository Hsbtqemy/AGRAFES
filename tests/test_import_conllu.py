"""Tests for the CoNLL-U importer."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


def _write_conllu(path: Path, content: str) -> Path:
    path.write_text(content, encoding="utf-8")
    return path


def test_import_conllu_creates_units_and_tokens(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.importers.conllu import import_conllu

    conllu = _write_conllu(
        tmp_path / "sample.conllu",
        (
            "# sent_id = 1\n"
            "# text = Du calme.\n"
            "1-2\tDu\t_\t_\t_\t_\t_\t_\t_\t_\n"
            "1\tDe\tde\tADP\t_\t_\t0\troot\t_\t_\n"
            "2\tle\tle\tDET\t_\t_\t1\tdet\t_\t_\n"
            "3\tcalme\tcalme\tNOUN\t_\t_\t1\tobj\t_\t_\n"
            "\n"
            "# sent_id = 2\n"
            "# text = Il vient.\n"
            "1\tIl\til\tPRON\t_\t_\t0\tnsubj\t_\t_\n"
            "2\tvient\tvenir\tVERB\t_\t_\t0\troot\t_\t_\n"
            "\n"
        ),
    )

    report = import_conllu(
        conn=db_conn,
        path=conllu,
        language="fr",
        title="CoNLL-U sample",
    )

    assert report.doc_id == 1
    assert report.units_total == 2
    assert report.units_line == 2
    assert report.units_structure == 0
    assert any("multiword token range" in str(w) for w in report.warnings)

    unit_rows = db_conn.execute(
        "SELECT n, external_id, text_raw FROM units WHERE doc_id = ? ORDER BY n",
        (report.doc_id,),
    ).fetchall()
    assert [r["external_id"] for r in unit_rows] == [1, 2]
    assert unit_rows[0]["text_raw"] == "Du calme."

    token_rows = db_conn.execute(
        """
        SELECT u.n AS unit_n, t.sent_id, t.position, t.word, t.lemma, t.upos
        FROM tokens t
        JOIN units u ON u.unit_id = t.unit_id
        WHERE u.doc_id = ?
        ORDER BY u.n, t.position
        """,
        (report.doc_id,),
    ).fetchall()
    assert len(token_rows) == 5
    assert [r["word"] for r in token_rows[:3]] == ["De", "le", "calme"]
    assert all(r["sent_id"] == 1 for r in token_rows)


def test_import_conllu_rejects_invalid_line_shape(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.importers.conllu import import_conllu

    bad = _write_conllu(
        tmp_path / "bad.conllu",
        (
            "# sent_id = 1\n"
            "1\tWord\tlemma\tNOUN\n"
        ),
    )

    with pytest.raises(ValueError, match="expected 10 tab-separated columns"):
        import_conllu(conn=db_conn, path=bad, language="fr")


# ── empty nodes ───────────────────────────────────────────────────────────────

def test_import_conllu_skips_empty_nodes(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.importers.conllu import import_conllu

    conllu = _write_conllu(
        tmp_path / "empty_nodes.conllu",
        (
            "# sent_id = 1\n"
            "# text = They buy.\n"
            "1\tThey\tthey\tPRON\t_\t_\t2\tnsubj\t_\t_\n"
            "1.1\tbuy\tbuy\tVERB\t_\t_\t_\t_\t_\t_\n"
            "2\tbuy\tbuy\tVERB\t_\t_\t0\troot\t_\t_\n"
            "\n"
        ),
    )

    report = import_conllu(conn=db_conn, path=conllu, language="en")

    assert report.units_total == 1
    token_rows = db_conn.execute(
        "SELECT word FROM tokens ORDER BY position"
    ).fetchall()
    assert [r["word"] for r in token_rows] == ["They", "buy"]
    assert any("empty node" in w for w in report.warnings)


# ── non-numeric sent_id ───────────────────────────────────────────────────────

def test_import_conllu_non_numeric_sent_id_falls_back_to_n(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.importers.conllu import import_conllu

    conllu = _write_conllu(
        tmp_path / "alphasent.conllu",
        (
            "# sent_id = wsj_0001\n"
            "# text = Hello world.\n"
            "1\tHello\thello\tINTJ\t_\t_\t0\troot\t_\t_\n"
            "\n"
            "# sent_id = wsj_0002\n"
            "# text = Bye.\n"
            "1\tBye\tbye\tINTJ\t_\t_\t0\troot\t_\t_\n"
            "\n"
        ),
    )

    report = import_conllu(conn=db_conn, path=conllu, language="en")

    rows = db_conn.execute(
        "SELECT external_id, meta_json FROM units ORDER BY n"
    ).fetchall()
    # non-numeric sent_id → external_id fallback = n (1-based)
    assert [r["external_id"] for r in rows] == [1, 2]
    # original sent_id stored in meta_json
    import json
    assert json.loads(rows[0]["meta_json"])["conllu_sent_id"] == "wsj_0001"


# ── file not found ────────────────────────────────────────────────────────────

def test_import_conllu_file_not_found(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.importers.conllu import import_conllu

    with pytest.raises(FileNotFoundError):
        import_conllu(conn=db_conn, path=tmp_path / "missing.conllu", language="fr")


# ── empty file / no sentences ─────────────────────────────────────────────────

def test_import_conllu_empty_file_raises(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.importers.conllu import import_conllu

    empty = _write_conllu(tmp_path / "empty.conllu", "# just a comment\n\n")

    with pytest.raises(ValueError, match="No token sentences"):
        import_conllu(conn=db_conn, path=empty, language="fr")


# ── UTF-8 BOM ─────────────────────────────────────────────────────────────────

def test_import_conllu_utf8_bom_accepted(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.importers.conllu import import_conllu

    bom_file = tmp_path / "bom.conllu"
    content = (
        "# sent_id = 1\n"
        "# text = Bonjour.\n"
        "1\tBonjour\tbonjour\tINTJ\t_\t_\t0\troot\t_\t_\n"
        "\n"
    )
    bom_file.write_bytes(b"\xef\xbb\xbf" + content.encode("utf-8"))

    report = import_conllu(conn=db_conn, path=bom_file, language="fr")
    assert report.units_total == 1
    row = db_conn.execute("SELECT text_raw FROM units").fetchone()
    assert "Bonjour" in row["text_raw"]


# ── underscore fields → None ──────────────────────────────────────────────────

def test_import_conllu_underscore_fields_stored_as_none(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.importers.conllu import import_conllu

    conllu = _write_conllu(
        tmp_path / "nullfields.conllu",
        (
            "# sent_id = 1\n"
            "# text = X.\n"
            "1\tX\t_\t_\t_\t_\t0\troot\t_\t_\n"
            "\n"
        ),
    )

    import_conllu(conn=db_conn, path=conllu, language="en")

    row = db_conn.execute(
        "SELECT lemma, upos, xpos, feats, misc FROM tokens"
    ).fetchone()
    assert row["lemma"] is None
    assert row["upos"] is None
    assert row["xpos"] is None
    assert row["feats"] is None
    assert row["misc"] is None


# ── duplicate import detection ────────────────────────────────────────────────

def test_import_conllu_rejects_duplicate(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.importers.conllu import import_conllu

    conllu = _write_conllu(
        tmp_path / "dup.conllu",
        (
            "# sent_id = 1\n"
            "1\tHello\thello\tINTJ\t_\t_\t0\troot\t_\t_\n"
            "\n"
        ),
    )

    import_conllu(conn=db_conn, path=conllu, language="en")
    with pytest.raises(ValueError, match="déjà présent|source_hash"):
        import_conllu(conn=db_conn, path=conllu, language="en")
