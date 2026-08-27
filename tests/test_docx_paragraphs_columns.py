"""IMPO-01 — extraction par colonne en mode « paragraphes ».

Un bitexte en tableau à deux colonnes n'avait **aucun mode d'import valide** :
``column_index`` n'était honoré que par ``docx_numbered_lines``, qui exige un
marqueur ``[n]`` que ces documents ne portent pas ; et ``docx_paragraphs``, qui
n'en exige aucun, ne voyait pas les tables (``Document.paragraphs`` les saute).
Le premier rendait donc un document entièrement ``structure`` — hors index — et
le second zéro unité, donc une levée du garde IMP-02.

Forme réelle visée, mesurée sur ``2021_Texte1_CI-OrEnTrFr-2021_Aligné-Tableau.docx``
le 27 août 2026 : **une seule ligne de tableau**, deux colonnes, chaque cellule
portant les 48 mêmes paragraphes en regard, sans aucune numérotation. ADR-012
faisant de la position l'``external_id``, les deux colonnes s'alignent par ancre
dès l'import.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

docx = pytest.importorskip("docx")


# ─── Fixtures ────────────────────────────────────────────────────────────────


def _set_cell(cell, value: str | list[str]) -> None:
    """python-docx crée un paragraphe vide par défaut dans chaque cellule."""
    paragraphs = value if isinstance(value, list) else [value]
    cell.paragraphs[0].text = paragraphs[0]
    for extra in paragraphs[1:]:
        cell.add_paragraph(extra)


def _bitext_doc(col1: list[str], col2: list[str], lead: list[str] | None = None):
    """Un document de la forme réelle : une ligne, deux colonnes multi-paragraphes."""
    doc = docx.Document()
    for text in (lead or []):
        doc.add_paragraph(text)
    table = doc.add_table(rows=1, cols=2)
    _set_cell(table.cell(0, 0), col1)
    _set_cell(table.cell(0, 1), col2)
    return doc


def _save(doc, path: Path) -> Path:
    doc.save(str(path))
    return path


@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    from multicorpus_engine.db.connection import get_connection
    from multicorpus_engine.db.migrations import apply_migrations

    conn = get_connection(tmp_path / "test.db")
    apply_migrations(
        conn,
        migrations_dir=Path(__file__).resolve().parent.parent / "migrations",
    )
    return conn


def _texts(conn: sqlite3.Connection, doc_id: int) -> list[str]:
    return [
        r["text_norm"]
        for r in conn.execute(
            "SELECT text_norm FROM units WHERE doc_id=? ORDER BY n", (doc_id,)
        ).fetchall()
    ]


# ─── La capacité manquante ───────────────────────────────────────────────────


def test_column_extraction_reads_a_two_column_bitext(db, tmp_path):
    """Chaque colonne devient un document de lignes indexables, sans marqueur."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = _bitext_doc(
        ["Texte 1", "The Observer view on the vaccine dispute.", "Making a scapegoat."],
        ["Texte 1", "Vaccins : l'UE a perdu les pédales.", "Faire de la Grande-Bretagne."],
    )
    path = _save(doc, tmp_path / "bitexte.docx")

    report = import_docx_paragraphs(db, path, language="en", column_index=1)

    assert report.units_line == 3
    assert report.units_structure == 0
    assert report.tables_processed == 1
    rows = db.execute(
        "SELECT external_id, unit_type FROM units WHERE doc_id=? ORDER BY n",
        (report.doc_id,),
    ).fetchall()
    assert [r["external_id"] for r in rows] == [1, 2, 3]
    assert {r["unit_type"] for r in rows} == {"line"}
    assert "Observer" in _texts(db, report.doc_id)[1]


def test_the_two_columns_align_by_position(db, tmp_path):
    """Le gain réel : mêmes external_id des deux côtés, donc alignement par ancre."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = _bitext_doc(["Un.", "Deux.", "Trois."], ["One.", "Two.", "Three."])
    path = _save(doc, tmp_path / "bitexte.docx")

    fr = import_docx_paragraphs(db, path, language="fr", title="FR", column_index=1)
    en = import_docx_paragraphs(db, path, language="en", title="EN", column_index=2)

    def ids(doc_id):
        return [
            r[0] for r in db.execute(
                "SELECT external_id FROM units WHERE doc_id=? ORDER BY n", (doc_id,)
            )
        ]

    assert ids(fr.doc_id) == ids(en.doc_id) == [1, 2, 3]
    assert _texts(db, fr.doc_id) == ["Un.", "Deux.", "Trois."]
    assert _texts(db, en.doc_id) == ["One.", "Two.", "Three."]


def test_top_level_paragraphs_and_table_stay_in_document_order(db, tmp_path):
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = _bitext_doc(["Dans la cellule."], ["In the cell."], lead=["Avant le tableau."])
    path = _save(doc, tmp_path / "mixte.docx")

    report = import_docx_paragraphs(db, path, language="fr", column_index=1)
    assert _texts(db, report.doc_id) == ["Avant le tableau.", "Dans la cellule."]


def test_a_heading_inside_a_cell_still_becomes_an_intertitre(db, tmp_path):
    """Le repérage des styles Heading d'ADR-012 vaut aussi dans une cellule."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = docx.Document()
    table = doc.add_table(rows=1, cols=2)
    cell = table.cell(0, 0)
    cell.paragraphs[0].text = "Chapitre premier"
    cell.paragraphs[0].style = doc.styles["Heading 1"]
    cell.add_paragraph("Le texte du chapitre.")
    _set_cell(table.cell(0, 1), ["Chapter one", "The chapter text."])
    path = _save(doc, tmp_path / "titre.docx")

    report = import_docx_paragraphs(db, path, language="fr", column_index=1)
    roles = [
        r[0] for r in db.execute(
            "SELECT unit_role FROM units WHERE doc_id=? ORDER BY n", (report.doc_id,)
        )
    ]
    assert roles == ["intertitre", None]


def test_a_row_without_the_target_column_is_skipped_and_counted(db, tmp_path):
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = docx.Document()
    narrow = doc.add_table(rows=1, cols=1)
    _set_cell(narrow.cell(0, 0), "Une seule colonne.")
    wide = doc.add_table(rows=1, cols=2)
    _set_cell(wide.cell(0, 0), "Gauche.")
    _set_cell(wide.cell(0, 1), "Droite.")
    path = _save(doc, tmp_path / "etroit.docx")

    report = import_docx_paragraphs(db, path, language="fr", column_index=2)
    assert report.tables_processed == 2
    assert report.rows_skipped_short == 1
    assert _texts(db, report.doc_id) == ["Droite."]


def test_column_index_below_one_is_refused(db, tmp_path):
    from multicorpus_engine.importers.docx_paragraphs import parse_docx_paragraphs

    doc = _bitext_doc(["Un."], ["One."])
    path = _save(doc, tmp_path / "bitexte.docx")

    with pytest.raises(ValueError, match="column_index"):
        parse_docx_paragraphs(path, column_index=0)


# ─── Non-régression : le mode sans colonne ne bouge pas ──────────────────────


def test_without_column_index_a_table_document_still_yields_nothing(db, tmp_path):
    """ADR-012 inchangé : sans column_index, Document.paragraphs ignore les tables.

    Le garde IMP-02 lève alors plutôt que d'écrire un document fantôme — c'est le
    comportement d'aujourd'hui, et il reste le bon quand l'utilisateur n'a pas
    demandé de colonne.
    """
    from multicorpus_engine.importers.docx_paragraphs import (
        import_docx_paragraphs,
        parse_docx_paragraphs,
    )

    doc = _bitext_doc(["Un.", "Deux."], ["One.", "Two."])
    path = _save(doc, tmp_path / "bitexte.docx")

    assert parse_docx_paragraphs(path).units == []
    with pytest.raises(ValueError, match="No units to import"):
        import_docx_paragraphs(db, path, language="fr")


def test_a_plain_document_is_untouched_by_the_new_parameter(db, tmp_path):
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = docx.Document()
    doc.add_paragraph("Premier paragraphe.")
    doc.add_paragraph("Second paragraphe.")
    path = _save(doc, tmp_path / "simple.docx")

    report = import_docx_paragraphs(db, path, language="fr")
    assert report.units_line == 2
    assert report.tables_processed == 0
    assert _texts(db, report.doc_id) == ["Premier paragraphe.", "Second paragraphe."]


# ─── Le dispatch central transmet bien le paramètre ──────────────────────────


def test_dispatch_forwards_column_index_to_docx_paragraphs(db, tmp_path):
    from multicorpus_engine.importers.dispatch import dispatch_import

    doc = _bitext_doc(["Gauche."], ["Droite."])
    path = _save(doc, tmp_path / "bitexte.docx")

    report = dispatch_import(
        db, mode="docx_paragraphs", path=path, language="fr", column_index=2
    )
    assert _texts(db, report.doc_id) == ["Droite."]


# ─── L'identité d'un document extrait, c'est (fichier, colonne) ───────────────
#
# Le garde de doublon compare le hash du fichier ENTIER et son chemin. Un bitexte
# en tableau est un seul fichier qui doit produire deux documents : sans colonne
# dans l'identité, la seconde colonne était refusée comme un doublon de la
# première — et le mode numéroté portait le même défaut depuis toujours, ses deux
# tests de colonne utilisant chacun une base neuve.


def test_re_importing_the_same_column_is_still_refused(db, tmp_path):
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = _bitext_doc(["Un.", "Deux."], ["One.", "Two."])
    path = _save(doc, tmp_path / "bitexte.docx")

    import_docx_paragraphs(db, path, language="fr", column_index=1)
    with pytest.raises(ValueError, match="déjà présent"):
        import_docx_paragraphs(db, path, language="fr", column_index=1)


def test_numbered_mode_also_takes_both_columns_of_one_file(db, tmp_path):
    from multicorpus_engine.importers.docx_numbered_lines import (
        import_docx_numbered_lines,
    )

    doc = docx.Document()
    table = doc.add_table(rows=1, cols=2)
    _set_cell(table.cell(0, 0), ["[1] La phrase.", "[2] Deuxième."])
    _set_cell(table.cell(0, 1), ["[1] The sentence.", "[2] Second."])
    path = _save(doc, tmp_path / "numerote.docx")

    fr = import_docx_numbered_lines(db, path, language="fr", column_index=1)
    en = import_docx_numbered_lines(db, path, language="en", column_index=2)
    assert fr.doc_id != en.doc_id
    assert _texts(db, fr.doc_id) == ["La phrase.", "Deuxième."]
    assert _texts(db, en.doc_id) == ["The sentence.", "Second."]


def test_a_whole_file_import_still_blocks_a_second_whole_file_import(db, tmp_path):
    """Le garde d'origine est intact quand aucune colonne n'est demandée."""
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = docx.Document()
    doc.add_paragraph("Un paragraphe.")
    path = _save(doc, tmp_path / "simple.docx")

    import_docx_paragraphs(db, path, language="fr")
    with pytest.raises(ValueError, match="déjà présent"):
        import_docx_paragraphs(db, path, language="fr")


# ─── Une perte de données ne doit jamais être muette ─────────────────────────
#
# Le mode numéroté avertit quand une ligne est ignorée faute de colonne ou qu'une
# sous-table est sautée — « edge cases produce warnings + counters, never silent
# data loss », dit son commentaire. Donner le parcours au mode paragraphes sans
# ces avertissements y rendait la perte silencieuse : le compteur montait, le
# rapport ne disait rien.


def test_a_skipped_row_is_reported_not_only_counted(db, tmp_path):
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = docx.Document()
    narrow = doc.add_table(rows=1, cols=1)
    _set_cell(narrow.cell(0, 0), "Une seule colonne.")
    wide = doc.add_table(rows=1, cols=2)
    _set_cell(wide.cell(0, 0), "Gauche.")
    _set_cell(wide.cell(0, 1), "Droite.")
    path = _save(doc, tmp_path / "etroit.docx")

    report = import_docx_paragraphs(db, path, language="fr", column_index=2)
    assert report.rows_skipped_short == 1
    assert any("ignorée" in w for w in report.warnings), report.warnings


def test_a_skipped_nested_table_is_reported(db, tmp_path):
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = docx.Document()
    table = doc.add_table(rows=1, cols=2)
    _set_cell(table.cell(0, 0), "Gauche.")
    cell = table.cell(0, 1)
    cell.paragraphs[0].text = "Droite."
    cell.add_table(rows=1, cols=1)
    path = _save(doc, tmp_path / "imbrique.docx")

    report = import_docx_paragraphs(db, path, language="fr", column_index=2)
    assert report.nested_tables_skipped == 1
    assert any("imbriquée" in w for w in report.warnings), report.warnings


def test_a_clean_column_import_carries_no_warning(db, tmp_path):
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = _bitext_doc(["Un.", "Deux."], ["One.", "Two."])
    path = _save(doc, tmp_path / "bitexte.docx")

    report = import_docx_paragraphs(db, path, language="fr", column_index=1)
    assert report.warnings == []


# ─── Décision assumée : le fichier entier puis une colonne ───────────────────


def test_importing_the_whole_file_then_a_column_is_allowed(db, tmp_path):
    """Relâchement délibéré, et le seul possible.

    Pour qu'un fichier produise plusieurs documents, le contrôle par chemin doit
    céder quand une colonne est demandée — les deux colonnes ont le même chemin.
    Conséquence : importer le fichier entier **puis** une colonne devient permis,
    là où c'était refusé. C'est l'échappatoire dont on a besoin quand un tableau a
    d'abord été importé en bloc (48 unités `structure` inutilisables) et qu'on veut
    le reprendre colonne par colonne sans le supprimer d'abord. Le doublon reste
    visible : `GET /corpus/audit` groupe par nom de fichier. Mesuré le 27 août —
    aucun document du corpus ne vient d'un fichier « Tableau », donc ce choix ne
    rattrape aucune donnée existante, il n'engage que la suite.

    Le document porte un paragraphe **hors** du tableau : un fichier entièrement en
    tableau ne peut pas s'importer « en entier » du tout, les deux modes sautant les
    tables sans `column_index` — le garde IMP-02 lèverait avant celui du doublon.
    """
    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs

    doc = _bitext_doc(["Un.", "Deux."], ["One.", "Two."], lead=["Avant le tableau."])
    path = _save(doc, tmp_path / "bitexte.docx")

    entier = import_docx_paragraphs(db, path, language="fr", title="brut")
    colonne = import_docx_paragraphs(db, path, language="fr", title="col1", column_index=1)
    assert entier.doc_id != colonne.doc_id
    assert _texts(db, entier.doc_id) == ["Avant le tableau."]
    assert _texts(db, colonne.doc_id) == ["Avant le tableau.", "Un.", "Deux."]
