"""Tests for DB diagnostics tooling."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from pathlib import Path

from tests.conftest import make_docx


def _import_doc(db_conn: sqlite3.Connection, tmp_path: Path, name: str = "doc.docx") -> int:
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines

    paragraphs = ["[1] Bonjour le monde.", "[2] Salut à tous."]
    path = tmp_path / name
    path.write_bytes(make_docx(paragraphs))
    report = import_docx_numbered_lines(conn=db_conn, path=path, language="fr", title="Doc")
    return report.doc_id


def test_collect_diagnostics_fresh_db_ok(db_conn: sqlite3.Connection) -> None:
    from multicorpus_engine.db.diagnostics import collect_diagnostics

    report = collect_diagnostics(db_conn)
    assert report["status"] == "ok"
    assert report["integrity"]["ok"] is True
    assert report["counts"]["documents"] == 0
    assert report["fts"]["stale"] is False


def test_collect_diagnostics_detects_fts_stale_before_index(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.db.diagnostics import collect_diagnostics

    _import_doc(db_conn, tmp_path)
    report = collect_diagnostics(db_conn)
    assert report["status"] == "warning"
    assert report["fts"]["stale"] is True
    assert report["fts"]["missing_line_units"] > 0


def test_collect_diagnostics_after_index_is_consistent(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.db.diagnostics import collect_diagnostics
    from multicorpus_engine.indexer import build_index

    _import_doc(db_conn, tmp_path)
    build_index(db_conn)
    report = collect_diagnostics(db_conn)
    assert report["status"] == "ok"
    assert report["fts"]["stale"] is False
    assert report["fts"]["row_delta_vs_line_units"] == 0


def test_collect_diagnostics_detects_orphan_fts_rows(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.db.diagnostics import collect_diagnostics
    from multicorpus_engine.indexer import build_index

    _import_doc(db_conn, tmp_path)
    build_index(db_conn)
    db_conn.execute(
        "INSERT INTO fts_units(rowid, text_norm) VALUES (?, ?)",
        (99999, "ghost row"),
    )
    db_conn.commit()

    report = collect_diagnostics(db_conn)
    assert report["status"] == "warning"
    assert report["fts"]["orphan_rows"] >= 1
    assert report["fts"]["stale"] is True


def test_collect_diagnostics_detects_alignment_doc_mismatch(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    from multicorpus_engine.aligner import align_by_external_id
    from multicorpus_engine.db.diagnostics import collect_diagnostics

    # Build two aligned docs
    p1 = tmp_path / "fr.docx"
    p2 = tmp_path / "en.docx"
    p1.write_bytes(make_docx(["[1] Bonjour."]))
    p2.write_bytes(make_docx(["[1] Hello."]))

    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines

    fr = import_docx_numbered_lines(db_conn, p1, language="fr", title="FR")
    en = import_docx_numbered_lines(db_conn, p2, language="en", title="EN")
    align_by_external_id(db_conn, fr.doc_id, [en.doc_id], run_id="diag-align")

    # Corrupt doc_id metadata while keeping valid unit FKs.
    db_conn.execute(
        "UPDATE alignment_links SET pivot_doc_id = ?",
        (999999,),
    )
    db_conn.commit()

    report = collect_diagnostics(db_conn)
    assert report["status"] == "warning"
    assert report["alignment"]["pivot_doc_mismatch"] >= 1


def test_db_diagnostics_script_strict_exit_code(
    tmp_path: Path,
) -> None:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations
    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines

    db_path = tmp_path / "diag.db"
    conn = get_connection(db_path)
    apply_migrations(conn)

    # Create FTS-stale situation: import without index.
    source = tmp_path / "doc.docx"
    source.write_bytes(make_docx(["[1] Bonjour."]))
    import_docx_numbered_lines(conn, source, language="fr", title="Diag")

    script = Path(__file__).parent.parent / "scripts" / "db_diagnostics.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--db", str(db_path), "--strict", "--compact"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode == 1
    payload = json.loads(proc.stdout)
    assert payload["status"] == "warning"
    assert payload["fts"]["stale"] is True

