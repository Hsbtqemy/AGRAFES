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
