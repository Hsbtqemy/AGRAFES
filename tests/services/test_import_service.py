"""Direct unit tests for the import service (audit P0-1 / T-02).

These exercise the extracted import logic without any HTTP server — the whole
point of the service-layer extraction. (The sidecar contract tests still cover
the HTTP adapter end-to-end.)
"""

from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.errors import NotFoundError, ValidationError
from multicorpus_engine.services.import_service import import_document


def _txt(tmp_path, name="doc.txt", body="[1] Bonjour.\n[2] Le monde.\n"):
    p = tmp_path / name
    p.write_text(body, encoding="utf-8")
    return str(p)


def test_import_txt_numbered_lines(db_conn: sqlite3.Connection, tmp_path) -> None:
    result = import_document(
        db_conn,
        {"mode": "txt_numbered_lines", "path": _txt(tmp_path), "language": "fr"},
    )
    assert result["mode"] == "txt_numbered_lines"
    assert isinstance(result["run_id"], str) and result["run_id"]
    assert isinstance(result["doc_id"], int)
    assert result["units_line"] == 2
    assert result["relation_created"] is False
    # the run was recorded
    n = db_conn.execute(
        "SELECT COUNT(*) FROM runs WHERE run_id = ?", (result["run_id"],)
    ).fetchone()[0]
    assert n == 1


def test_mode_normalised(db_conn: sqlite3.Connection, tmp_path) -> None:
    result = import_document(
        db_conn,
        {"mode": "  TXT-Numbered Lines ", "path": _txt(tmp_path), "language": "fr"},
    )
    assert result["mode"] == "txt_numbered_lines"


@pytest.mark.parametrize(
    "body, msg",
    [
        ({"path": "/x.txt", "language": "fr"}, "mode is required"),
        ({"mode": "txt_numbered_lines", "language": "fr"}, "path is required"),
        ({"mode": "txt_numbered_lines", "path": "/x.txt"}, "language is required"),
        ({"mode": "nope", "path": "/x.txt", "language": "fr"}, "Unsupported import mode"),
        ({"mode": "docx_numbered_lines", "path": "/x.docx", "language": "fr",
          "column_index": 0}, "column_index must be >= 1"),
        ({"mode": "docx_numbered_lines", "path": "/x.docx", "language": "fr",
          "column_index": "x"}, "column_index must be an integer"),
        ({"mode": "txt_numbered_lines", "path": "/x.txt", "language": "fr",
          "family_root_doc_id": "x"}, "family_root_doc_id must be an integer"),
    ],
)
def test_validation_errors(db_conn, body, msg) -> None:
    with pytest.raises(ValidationError) as exc:
        import_document(db_conn, body)
    assert msg in str(exc.value)


def test_tei_does_not_require_language(db_conn: sqlite3.Connection, tmp_path) -> None:
    # No language + a missing TEI file should fail on the FILE (ValidationError
    # from the importer), proving the language guard was skipped for TEI.
    with pytest.raises(ValidationError):
        import_document(db_conn, {"mode": "tei", "path": str(tmp_path / "missing.xml")})


def test_family_relation_parent_missing(db_conn: sqlite3.Connection, tmp_path) -> None:
    with pytest.raises(NotFoundError) as exc:
        import_document(
            db_conn,
            {"mode": "txt_numbered_lines", "path": _txt(tmp_path), "language": "fr",
             "family_root_doc_id": 99999},
        )
    assert "99999" in str(exc.value)


def test_family_relation_created(db_conn: sqlite3.Connection, tmp_path) -> None:
    parent = import_document(
        db_conn,
        {"mode": "txt_numbered_lines", "path": _txt(tmp_path, "parent.txt"), "language": "fr"},
    )
    child = import_document(
        db_conn,
        {"mode": "txt_numbered_lines",
         "path": _txt(tmp_path, "child.txt", body="[1] Hello.\n[2] The world.\n"),
         "language": "en", "family_root_doc_id": parent["doc_id"]},
    )
    assert child["relation_created"] is True
    assert isinstance(child["relation_id"], int)
    rel = db_conn.execute(
        "SELECT relation_type, target_doc_id FROM doc_relations WHERE doc_id = ?",
        (child["doc_id"],),
    ).fetchone()
    assert rel["relation_type"] == "translation_of"
    assert rel["target_doc_id"] == parent["doc_id"]
