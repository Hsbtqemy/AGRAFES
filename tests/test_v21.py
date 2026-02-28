"""Tests for V2.1 features: TEI importer, curation engine, proximity query."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


# ===========================================================================
# TEI importer helpers
# ===========================================================================


def _make_tei_p(paragraphs: list[tuple[str, str]], lang: str = "fr") -> str:
    """Build a minimal TEI XML string with <p> elements.

    paragraphs: list of (xml_id, text) tuples.
    """
    units = "\n".join(
        f'        <p xml:id="{pid}">{text}</p>'
        for pid, text in paragraphs
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>TEI Test Doc</title></titleStmt>
    </fileDesc>
  </teiHeader>
  <text xml:lang="{lang}">
    <body>
      <div>
{units}
      </div>
    </body>
  </text>
</TEI>"""


def _make_tei_s(sentences: list[tuple[str, str]], lang: str = "fr") -> str:
    """Build a minimal TEI XML string with <s> elements."""
    units = "\n".join(
        f'        <s xml:id="{sid}">{text}</s>'
        for sid, text in sentences
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>TEI Sentences</title></titleStmt>
    </fileDesc>
  </teiHeader>
  <text xml:lang="{lang}">
    <body>
      <div>
{units}
      </div>
    </body>
  </text>
</TEI>"""


# ===========================================================================
# TEI importer — <p> elements
# ===========================================================================


def test_tei_import_p_elements(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """TEI importer must create one line unit per <p> element."""
    from multicorpus_engine.importers.tei_importer import import_tei

    xml = _make_tei_p([("p1", "Bonjour le monde."), ("p2", "Au revoir."), ("p3", "Merci.")])
    path = tmp_path / "doc.xml"
    path.write_text(xml, encoding="utf-8")

    report = import_tei(conn=db_conn, path=path, unit_element="p")

    assert report.doc_id > 0
    assert report.units_line == 3
    assert report.units_structure == 0
    assert report.units_total == 3


def test_tei_import_s_elements(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """TEI importer with unit_element='s' must extract <s> elements."""
    from multicorpus_engine.importers.tei_importer import import_tei

    xml = _make_tei_s([("s1", "Première phrase."), ("s2", "Deuxième phrase.")])
    path = tmp_path / "doc.xml"
    path.write_text(xml, encoding="utf-8")

    report = import_tei(conn=db_conn, path=path, unit_element="s")

    assert report.units_line == 2

    row = db_conn.execute(
        "SELECT text_raw FROM units WHERE doc_id = ? AND unit_type = 'line' ORDER BY n LIMIT 1",
        (report.doc_id,)
    ).fetchone()
    assert "Première" in row["text_raw"]


def test_tei_import_xmlid_as_external_id(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """Trailing integer from xml:id must be used as external_id."""
    from multicorpus_engine.importers.tei_importer import import_tei

    xml = _make_tei_p([("p10", "Dixième."), ("p20", "Vingtième."), ("p30", "Trentième.")])
    path = tmp_path / "doc.xml"
    path.write_text(xml, encoding="utf-8")

    report = import_tei(conn=db_conn, path=path, unit_element="p")

    rows = db_conn.execute(
        "SELECT external_id FROM units WHERE doc_id = ? ORDER BY n",
        (report.doc_id,)
    ).fetchall()

    ext_ids = [r["external_id"] for r in rows]
    assert ext_ids == [10, 20, 30]


def test_tei_import_language_from_xml_lang(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """Language must be inferred from xml:lang on <text> when not supplied."""
    from multicorpus_engine.importers.tei_importer import import_tei

    xml = _make_tei_p([("p1", "Hello world.")], lang="en")
    path = tmp_path / "doc.xml"
    path.write_text(xml, encoding="utf-8")

    report = import_tei(conn=db_conn, path=path, unit_element="p")  # no language arg

    row = db_conn.execute(
        "SELECT language FROM documents WHERE doc_id = ?", (report.doc_id,)
    ).fetchone()
    assert row["language"] == "en"


def test_tei_import_title_from_header(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """Title must be inferred from teiHeader//title when not supplied."""
    from multicorpus_engine.importers.tei_importer import import_tei

    xml = _make_tei_p([("p1", "Text.")])
    path = tmp_path / "doc.xml"
    path.write_text(xml, encoding="utf-8")

    report = import_tei(conn=db_conn, path=path)

    row = db_conn.execute(
        "SELECT title FROM documents WHERE doc_id = ?", (report.doc_id,)
    ).fetchone()
    assert row["title"] == "TEI Test Doc"


def test_tei_import_fts_searchable(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """TEI units must be FTS-indexed and queryable after build_index."""
    from multicorpus_engine.importers.tei_importer import import_tei
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.query import run_query

    xml = _make_tei_p([("p1", "Bonjour le monde."), ("p2", "Le chat dort.")])
    path = tmp_path / "doc.xml"
    path.write_text(xml, encoding="utf-8")

    import_tei(conn=db_conn, path=path, language="fr")
    build_index(db_conn)

    hits = run_query(db_conn, q="Bonjour", mode="segment")
    assert len(hits) == 1
    assert "Bonjour" in hits[0]["text_norm"]


def test_tei_import_file_not_found(db_conn: sqlite3.Connection) -> None:
    """TEI importer must raise FileNotFoundError for missing files."""
    from multicorpus_engine.importers.tei_importer import import_tei

    with pytest.raises(FileNotFoundError):
        import_tei(conn=db_conn, path="/nonexistent/doc.xml")


# ===========================================================================
# Curation engine
# ===========================================================================


@pytest.fixture()
def curation_corpus(db_conn: sqlite3.Connection, tmp_path: Path):
    """A small corpus with known text for curation tests."""
    from multicorpus_engine.importers.tei_importer import import_tei
    from multicorpus_engine.indexer import build_index

    xml = _make_tei_p([
        ("p1", "St. Jean baptise dans la rivière."),
        ("p2", "Le Sgt. commande la troupe."),
        ("p3", "Une phrase normale sans abréviations."),
    ])
    path = tmp_path / "doc.xml"
    path.write_text(xml, encoding="utf-8")
    report = import_tei(conn=db_conn, path=path, language="fr")
    build_index(db_conn)
    return {"doc_id": report.doc_id}


def test_apply_rules_basic(curation_corpus: dict) -> None:
    """apply_rules must modify text matching the pattern."""
    from multicorpus_engine.curation import CurationRule, apply_rules

    rules = [CurationRule(pattern=r"\bSt\.", replacement="Saint", flags=0)]
    result = apply_rules("St. Jean est là.", rules)
    assert result == "Saint Jean est là."


def test_apply_rules_case_insensitive(curation_corpus: dict) -> None:
    """apply_rules with IGNORECASE must match regardless of case."""
    import re
    from multicorpus_engine.curation import CurationRule, apply_rules

    rules = [CurationRule(pattern=r"\bsaint\b", replacement="Saint", flags=re.IGNORECASE)]
    result = apply_rules("le SAINT Jean", rules)
    assert result == "le Saint Jean"


def test_curate_document_modifies_text_norm(
    db_conn: sqlite3.Connection,
    curation_corpus: dict,
) -> None:
    """curate_document must update text_norm in the DB for matching units."""
    from multicorpus_engine.curation import CurationRule, curate_document

    rules = [CurationRule(pattern=r"\bSt\.", replacement="Saint", flags=0)]
    report = curate_document(db_conn, curation_corpus["doc_id"], rules)

    assert report.units_modified >= 1

    # Check DB was updated
    rows = db_conn.execute(
        "SELECT text_norm FROM units WHERE doc_id = ? AND unit_type = 'line'",
        (curation_corpus["doc_id"],)
    ).fetchall()
    texts = [r["text_norm"] for r in rows]
    assert any("Saint" in t for t in texts)


def test_curate_document_report_counts(
    db_conn: sqlite3.Connection,
    curation_corpus: dict,
) -> None:
    """CurationReport must accurately count total and modified units."""
    from multicorpus_engine.curation import CurationRule, curate_document

    # Match only the first two paragraphs
    rules = [CurationRule(pattern=r"\bSgt\.", replacement="Sergent", flags=0)]
    report = curate_document(db_conn, curation_corpus["doc_id"], rules)

    assert report.units_total == 3
    assert report.units_modified == 1  # only "Le Sgt. commande..." matches


def test_curate_document_unmodified_unit_unchanged(
    db_conn: sqlite3.Connection,
    curation_corpus: dict,
) -> None:
    """Units that do not match any rule must remain unchanged."""
    from multicorpus_engine.curation import CurationRule, curate_document

    # Get original text of the last unit
    original = db_conn.execute(
        "SELECT text_norm FROM units WHERE doc_id = ? ORDER BY n DESC LIMIT 1",
        (curation_corpus["doc_id"],)
    ).fetchone()["text_norm"]

    rules = [CurationRule(pattern=r"\bSt\.", replacement="Saint", flags=0)]
    curate_document(db_conn, curation_corpus["doc_id"], rules)

    after = db_conn.execute(
        "SELECT text_norm FROM units WHERE doc_id = ? ORDER BY n DESC LIMIT 1",
        (curation_corpus["doc_id"],)
    ).fetchone()["text_norm"]

    assert after == original  # "Une phrase normale..." is unchanged


def test_rules_from_list_builds_rules() -> None:
    """rules_from_list must parse a JSON-like dict list into CurationRule objects."""
    import re
    from multicorpus_engine.curation import rules_from_list

    data = [
        {"pattern": r"\bSt\.", "replacement": "Saint", "flags": "i", "description": "expand St."},
        {"pattern": r"\d+", "replacement": "NUM"},
    ]
    rules = rules_from_list(data)
    assert len(rules) == 2
    assert rules[0].flags == re.IGNORECASE
    assert rules[0].description == "expand St."
    assert rules[1].flags == 0


def test_rules_from_list_invalid_pattern() -> None:
    """rules_from_list must raise ValueError for an invalid regex."""
    from multicorpus_engine.curation import rules_from_list

    with pytest.raises(ValueError, match="Invalid regex"):
        rules_from_list([{"pattern": r"[unclosed", "replacement": "x"}])


# ===========================================================================
# proximity_query helper
# ===========================================================================


def test_proximity_query_builder() -> None:
    """proximity_query must produce a valid FTS5 NEAR() string."""
    from multicorpus_engine.query import proximity_query

    q = proximity_query(["chat", "chien"], distance=3)
    assert q == "NEAR(chat chien, 3)"


def test_proximity_query_requires_two_terms() -> None:
    """proximity_query must raise ValueError if fewer than 2 terms."""
    from multicorpus_engine.query import proximity_query

    with pytest.raises(ValueError):
        proximity_query(["chat"])


def test_proximity_query_finds_close_terms(
    db_conn: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    """A NEAR() query via run_query must match units with terms close together."""
    from multicorpus_engine.importers.tei_importer import import_tei
    from multicorpus_engine.indexer import build_index
    from multicorpus_engine.query import run_query, proximity_query

    xml = _make_tei_p([
        ("p1", "Le chat dort près du chien."),      # chat and chien close (≤5 tokens)
        ("p2", "Le chat est dans le grenier loin du chien endormi."),  # further apart
        ("p3", "Bonjour le monde."),  # neither term
    ])
    path = tmp_path / "doc.xml"
    path.write_text(xml, encoding="utf-8")

    import_tei(conn=db_conn, path=path, language="fr")
    build_index(db_conn)

    q = proximity_query(["chat", "chien"], distance=5)
    hits = run_query(db_conn, q=q, mode="segment")
    # At least the first unit must match (chat ... chien within 5 tokens)
    assert len(hits) >= 1
    assert any("chat" in h["text_norm"] and "chien" in h["text_norm"] for h in hits)
