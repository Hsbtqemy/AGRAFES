"""Direct tests for the shared parse layer (audit P0-1 / A-02).

These test parse_<mode>() in isolation — the single parsing logic now shared by
the importers (write path) and the sidecar /import/preview — plus the core A-02
guarantee: ``to_preview(parse_<mode>(f).units)`` must equal exactly what
``import_<mode>(f)`` writes to the DB. If a future change makes the preview
diverge from the import again, these break.
"""

from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.importers.parsed import ParsedDoc, ParsedUnit, insert_units, to_preview
from multicorpus_engine.importers.txt import (
    import_txt_numbered_lines,
    parse_txt_numbered_lines,
)
from multicorpus_engine.importers.docx_numbered_lines import (
    import_docx_numbered_lines,
    parse_docx_numbered_lines,
)
from multicorpus_engine.importers.docx_paragraphs import (
    import_docx_paragraphs,
    parse_docx_paragraphs,
)
from multicorpus_engine.importers.odt_numbered_lines import (
    import_odt_numbered_lines,
    parse_odt_numbered_lines,
)
from multicorpus_engine.importers.odt_paragraphs import (
    import_odt_paragraphs,
    parse_odt_paragraphs,
)
from multicorpus_engine.importers.tei_importer import import_tei, parse_tei
from multicorpus_engine.importers.conllu import import_conllu, preview_conllu

from tests.conftest import make_docx
from tests.support_odt import make_odt_bytes


# --------------------------------------------------------------------------- #
# parse_<mode> in isolation
# --------------------------------------------------------------------------- #
def test_parse_txt_numbered_lines(tmp_path) -> None:
    p = tmp_path / "doc.txt"
    p.write_text("[1] Bonjour.\nIntertitre\n[2] Le monde.\n\n", encoding="utf-8")

    parsed = parse_txt_numbered_lines(p)
    assert isinstance(parsed, ParsedDoc)
    assert parsed.doc_meta["encoding"] in ("utf-8", "ascii", "cp1252")  # detector choice
    assert parsed.source_hash and len(parsed.source_hash) == 64

    kinds = [(u.n, u.unit_type, u.external_id, u.text_raw) for u in parsed.units]
    assert kinds == [
        (1, "line", 1, "Bonjour."),
        (2, "structure", None, "Intertitre"),
        (3, "line", 2, "Le monde."),
    ]
    # structure unit gets the intertitre role; blank line skipped
    assert parsed.units[1].unit_role == "intertitre"


def test_to_preview_projection(tmp_path) -> None:
    p = tmp_path / "doc.txt"
    p.write_text("[1] one\n[2] two\n[3] three\n", encoding="utf-8")
    parsed = parse_txt_numbered_lines(p)
    preview, total = to_preview(parsed.units, limit=2)
    assert total == 3
    assert preview == [
        {"n": 1, "external_id": 1, "unit_type": "line", "text_raw": "one"},
        {"n": 2, "external_id": 2, "unit_type": "line", "text_raw": "two"},
    ]


def test_parse_odt_numbered_lines(tmp_path) -> None:
    p = tmp_path / "doc.odt"
    p.write_bytes(make_odt_bytes(["[1] Bonjour.", "Intertitre", "[2] Le monde."]))

    parsed = parse_odt_numbered_lines(p)
    assert parsed.source_hash and len(parsed.source_hash) == 64
    kinds = [(u.n, u.unit_type, u.external_id, u.text_raw) for u in parsed.units]
    assert kinds == [
        (1, "line", 1, "Bonjour."),
        (2, "structure", None, "Intertitre"),
        (3, "line", 2, "Le monde."),
    ]
    # ODT numbered-lines does NOT tag structure units with a role (unlike txt).
    assert parsed.units[1].unit_role is None


def test_parse_odt_paragraphs(tmp_path) -> None:
    p = tmp_path / "doc.odt"
    p.write_bytes(make_odt_bytes(["Premier.", "Deuxième."]))

    parsed = parse_odt_paragraphs(p)
    # Every non-empty paragraph is a line; position is both n and external_id.
    kinds = [(u.n, u.unit_type, u.external_id, u.text_raw) for u in parsed.units]
    assert kinds == [
        (1, "line", 1, "Premier."),
        (2, "line", 2, "Deuxième."),
    ]


def _tei_bytes() -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<TEI xmlns="http://www.tei-c.org/ns/1.0">\n'
        "  <teiHeader><fileDesc><titleStmt>"
        "<title>Mon titre</title></titleStmt></fileDesc></teiHeader>\n"
        '  <text xml:lang="fr"><body>\n'
        '    <p xml:id="p5">Premier paragraphe.</p>\n'
        "    <p>Deuxième sans id.</p>\n"
        "  </body></text>\n"
        "</TEI>\n"
    ).encode("utf-8")


def test_parse_tei_xmlid_and_fallback(tmp_path) -> None:
    p = tmp_path / "doc.xml"
    p.write_bytes(_tei_bytes())

    parsed = parse_tei(p)
    kinds = [(u.n, u.unit_type, u.external_id, u.text_raw) for u in parsed.units]
    assert kinds == [
        (1, "line", 5, "Premier paragraphe."),   # external_id from xml:id "p5"
        (2, "line", 2, "Deuxième sans id."),      # FIX: falls back to n (was None in preview)
    ]
    # Header-derived metadata is carried in stats for the writer to apply.
    assert parsed.stats["header_title"] == "Mon titre"
    assert parsed.stats["header_lang"] == "fr"
    assert isinstance(parsed.stats["validation_issues"], list)
    assert parsed.doc_meta == {"tei_unit": "p"}


def test_parse_tei_nested_same_tag_not_double_counted(tmp_path) -> None:
    """ENG-05: a <p> nested inside another <p> must yield exactly ONE unit. The
    outer element's itertext() already includes the inner text, so emitting the
    inner element as its own unit would duplicate that text."""
    p = tmp_path / "nested.xml"
    p.write_bytes(
        (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<TEI xmlns="http://www.tei-c.org/ns/1.0">\n'
            '  <text xml:lang="fr"><body>\n'
            "    <p>Outer start <p>inner</p> outer end.</p>\n"
            "    <p>Standalone.</p>\n"
            "  </body></text>\n"
            "</TEI>\n"
        ).encode("utf-8")
    )
    parsed = parse_tei(p)
    texts = [u.text_raw for u in parsed.units]
    # Only the two OUTERMOST <p> become units; the inner <p> is not emitted again.
    assert texts == ["Outer start inner outer end.", "Standalone."]


# --------------------------------------------------------------------------- #
# A-02 core guarantee: preview projection == what import writes to the DB
# --------------------------------------------------------------------------- #
def _db_units(conn: sqlite3.Connection, doc_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT n, external_id, unit_type, text_raw FROM units WHERE doc_id = ? ORDER BY n",
        (doc_id,),
    ).fetchall()
    return [
        {"n": r["n"], "external_id": r["external_id"],
         "unit_type": r["unit_type"], "text_raw": r["text_raw"]}
        for r in rows
    ]


def _assert_preview_equals_import(conn, path, import_fn, parse_fn, **import_kw) -> None:
    report = import_fn(conn=conn, path=path, **import_kw)
    preview, total = to_preview(parse_fn(path).units, limit=10_000)
    assert preview == _db_units(conn, report.doc_id)
    assert total == len(preview)


def test_preview_matches_import_txt(db_conn, tmp_path) -> None:
    p = tmp_path / "d.txt"
    p.write_text("[1] alpha\nTitre\n[2] beta\n", encoding="utf-8")
    _assert_preview_equals_import(
        db_conn, p, import_txt_numbered_lines, parse_txt_numbered_lines, language="fr"
    )


def test_preview_matches_import_docx_numbered(db_conn, tmp_path) -> None:
    p = tmp_path / "d.docx"
    p.write_bytes(make_docx(["Intro", "[1] Bonjour.", "[2] Le chat¤le chien."]))
    _assert_preview_equals_import(
        db_conn, p, import_docx_numbered_lines, parse_docx_numbered_lines, language="fr"
    )


def test_preview_matches_import_docx_paragraphs(db_conn, tmp_path) -> None:
    p = tmp_path / "d.docx"
    p.write_bytes(make_docx(["Premier para.", "Deuxième para."]))
    _assert_preview_equals_import(
        db_conn, p, import_docx_paragraphs, parse_docx_paragraphs, language="fr"
    )


def test_preview_matches_import_odt_numbered(db_conn, tmp_path) -> None:
    p = tmp_path / "d.odt"
    p.write_bytes(make_odt_bytes(["Intro", "[1] Bonjour.", "[2] Le monde."]))
    _assert_preview_equals_import(
        db_conn, p, import_odt_numbered_lines, parse_odt_numbered_lines, language="fr"
    )


def test_preview_matches_import_odt_paragraphs(db_conn, tmp_path) -> None:
    # Regression: the old sidecar ODT preview iterated (rich, level) tuples and
    # passed them to normalize() — it 500'd. Going through parse_odt_paragraphs fixes it.
    p = tmp_path / "d.odt"
    p.write_bytes(make_odt_bytes(["Premier.", "Deuxième."]))
    _assert_preview_equals_import(
        db_conn, p, import_odt_paragraphs, parse_odt_paragraphs, language="fr"
    )


def test_preview_matches_import_tei(db_conn, tmp_path) -> None:
    p = tmp_path / "d.xml"
    p.write_bytes(_tei_bytes())
    # language=None so the importer uses the header-derived lang, like the preview.
    _assert_preview_equals_import(db_conn, p, import_tei, parse_tei)


# --------------------------------------------------------------------------- #
# CoNLL-U: lenient preview vs strict import
# --------------------------------------------------------------------------- #
_MALFORMED_CONLLU = (
    "# sent_id = 1\n"
    "# text = Du calme.\n"
    "1\tDe\tde\tADP\t_\t_\t0\troot\t_\t_\n"
    "2\tle\tle\tDET\t_\t_\t1\tdet\t_\t_\n"
    "BADLINE_WITHOUT_TABS\n"
    "3\tcalme\tcalme\tNOUN\t_\t_\t1\tobj\t_\t_\n"
    "\n"
)


def test_preview_conllu_is_lenient(tmp_path) -> None:
    p = tmp_path / "d.conllu"
    p.write_text(_MALFORMED_CONLLU, encoding="utf-8")

    stats = preview_conllu(p, limit=100)
    assert stats["sentences"] == 1
    assert stats["tokens"] == 3
    assert stats["malformed_lines"] == 1   # counted, NOT raised
    assert stats["skipped_ranges"] == 0
    assert stats["sample_rows"][0] == {
        "sent": 1, "id": "1", "form": "De", "lemma": "de", "upos": "ADP",
    }


def test_import_conllu_is_strict_on_same_file(db_conn, tmp_path) -> None:
    # The strict importer rejects what the lenient preview merely counts.
    p = tmp_path / "d.conllu"
    p.write_text(_MALFORMED_CONLLU, encoding="utf-8")
    with pytest.raises(ValueError):
        import_conllu(conn=db_conn, path=p, language="fr")


def test_preview_conllu_sample_limit(tmp_path) -> None:
    p = tmp_path / "d.conllu"
    p.write_text(_MALFORMED_CONLLU, encoding="utf-8")
    stats = preview_conllu(p, limit=2)
    assert len(stats["sample_rows"]) == 2   # capped at limit
    assert stats["tokens"] == 3             # counts are unaffected by the sample cap


# --------------------------------------------------------------------------- #
# insert_units: shared units write path (P0 — single source of truth, ADR-043)
# --------------------------------------------------------------------------- #
def test_insert_units_writes_all_columns(db_conn) -> None:
    cur = db_conn.execute(
        "INSERT INTO documents (title, language, created_at) VALUES ('T', 'fr', '2026-01-01')"
    )
    doc_id = cur.lastrowid
    # unit_role has an FK to unit_roles(name) — the role must exist first (as the
    # *_paragraphs/txt importers do via INSERT OR IGNORE before inserting units).
    db_conn.execute(
        "INSERT INTO unit_roles (name, label, color, icon, sort_order, category)"
        " VALUES ('intertitre', 'Intertitre', '#9333ea', '§', 0, 'structure')"
    )
    insert_units(
        db_conn,
        doc_id,
        [
            ParsedUnit(n=1, unit_type="line", text_raw="a", text_norm="a",
                       external_id=10, meta_json='{"k":1}', unit_role="intertitre"),
            ParsedUnit(n=2, unit_type="line", text_raw="b", text_norm="b"),  # defaults None
        ],
    )
    db_conn.commit()
    rows = db_conn.execute(
        "SELECT n, unit_type, external_id, text_raw, text_norm, meta_json, unit_role, text_source"
        " FROM units WHERE doc_id = ? ORDER BY n",
        (doc_id,),
    ).fetchall()
    # text_source is set to text_raw at import (ADR-043, P1).
    assert [tuple(r) for r in rows] == [
        (1, "line", 10, "a", "a", '{"k":1}', "intertitre", "a"),
        (2, "line", None, "b", "b", None, None, "b"),  # unit_role NULL (parity), text_source = text_raw
    ]


def test_text_source_equals_text_raw_at_import_docx(db_conn, tmp_path) -> None:
    """ParsedDoc importer path (via insert_units): text_source captured = text_raw."""
    p = tmp_path / "d.docx"
    p.write_bytes(make_docx(["[1] Le chat dort.", "[2] Il pleut."]))
    import_docx_numbered_lines(conn=db_conn, path=p, language="fr", title="D")
    rows = db_conn.execute(
        "SELECT text_raw, text_source FROM units WHERE unit_type = 'line' ORDER BY n"
    ).fetchall()
    assert rows
    assert all(r["text_source"] == r["text_raw"] for r in rows)


def test_text_source_equals_text_raw_at_import_conllu(db_conn, tmp_path) -> None:
    """CoNLL-U importer path (bespoke per-row insert): text_source captured = text_raw."""
    p = tmp_path / "d.conllu"
    p.write_text(
        "# sent_id = 1\n# text = Bonjour.\n1\tBonjour\tbonjour\tINTJ\t_\t_\t0\troot\t_\t_\n\n",
        encoding="utf-8",
    )
    import_conllu(conn=db_conn, path=p, language="fr")
    rows = db_conn.execute(
        "SELECT text_raw, text_source FROM units WHERE unit_type = 'line' ORDER BY n"
    ).fetchall()
    assert rows
    assert all(r["text_source"] == r["text_raw"] for r in rows)
