"""Service tests for matrix_export_service — the source-anchored aligned matrix (R3.3 §D7).

Projects a family (hub + translations) into a hub-anchored multilingual matrix,
exercising the core cell cases: cut slice, N-M bead concatenation, omission (empty),
and the paragraphe (parent_n) column. Local (db_conn), no sidecar.
"""
from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.errors import NotFoundError
from multicorpus_engine.services.matrix_export_service import build_alignment_matrix


def _setup_family(conn: sqlite3.Connection) -> None:
    # docs: 1 = FR hub (original), 2 = EN, 3 = RO (translations of 1)
    for title, lang, role in (("FR", "fr", "original"), ("EN", "en", "translation"), ("RO", "ro", "translation")):
        conn.execute(
            "INSERT INTO documents (title, language, doc_role, created_at) VALUES (?,?,?,datetime('now'))",
            (title, lang, role),
        )
    conn.execute("INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at) VALUES (2,'translation_of',1,datetime('now'))")
    conn.execute("INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, created_at) VALUES (3,'translation_of',1,datetime('now'))")
    # hub FR units (both in ¶1): unit_ids 1, 2
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm,meta_json) VALUES (1,'line',1,'Le matin.','le matin.','{\"parent_n\":1}')")
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm,meta_json) VALUES (1,'line',2,'Le soir.','le soir.','{\"parent_n\":1}')")
    # EN: one fused unit "morning evening" (unit_id 3) — will be cut across the two FR
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (2,'line',1,'morning evening','morning evening')")
    # RO: two units (4,5) — a 1-2 for FR u1; nothing for FR u2 (omission)
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (3,'line',1,'buna','buna')")
    conn.execute("INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm) VALUES (3,'line',2,'ziua','ziua')")
    conn.commit()
    # FR→EN: cut the fused EN unit — u1 keeps [0:8]="morning ", u2 keeps [8:15]="evening"
    conn.execute("INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,target_doc_id,created_at,bead_id,target_char_start,target_char_end) VALUES ('r',1,3,1,1,2,datetime('now'),1,0,8)")
    conn.execute("INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,target_doc_id,created_at,bead_id,target_char_start,target_char_end) VALUES ('r',2,3,2,1,2,datetime('now'),1,8,15)")
    # FR→RO: FR u1 ↔ r1 + r2 (1-2 bead, concatenated); FR u2 has no RO link (omission)
    conn.execute("INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,target_doc_id,created_at,bead_id) VALUES ('r',1,4,1,1,3,datetime('now'),2)")
    conn.execute("INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,target_doc_id,created_at,bead_id) VALUES ('r',1,5,1,1,3,datetime('now'),2)")
    conn.commit()


def test_matrix_projection_cut_concat_and_omission(db_conn: sqlite3.Connection) -> None:
    _setup_family(db_conn)
    m = build_alignment_matrix(db_conn, 1)

    assert m["headers"] == ["paragraphe", "segment", "fr", "en", "ro"]
    assert m["languages"] == ["fr", "en", "ro"]
    # row 1: FR u1 → EN cut slice "morning" ; RO 1-2 concat "buna ziua"
    assert m["rows"][0] == [1, 1, "Le matin.", "morning", "buna ziua"]
    # row 2: FR u2 → EN cut slice "evening" ; RO omission = empty cell
    assert m["rows"][1] == [1, 2, "Le soir.", "evening", ""]
    # tranche 3a — identifiers for grid gestures: hub unit per row, doc per language column
    assert m["hub_unit_ids"] == [1, 2]
    assert m["language_doc_ids"] == [1, 2, 3]  # hub(1) + EN(2) + RO(3)


def test_matrix_cell_links_identifiers(db_conn: sqlite3.Connection) -> None:
    """A2 (revue 3b) — cell_links[i][j] maps each cell to its links, ∥ rows × translations."""
    _setup_family(db_conn)
    m = build_alignment_matrix(db_conn, 1)

    assert len(m["cell_links"]) == len(m["rows"]) == 2
    assert all(len(row) == 2 for row in m["cell_links"])  # EN, RO columns
    # EN row 1: the cut link (u1→unit 3, slice [0:8]) with its verbatim raw.
    en_r1 = m["cell_links"][0][0]
    assert [lk["link_id"] for lk in en_r1] == [1]
    assert en_r1[0]["target_unit_id"] == 3
    assert (en_r1[0]["char_start"], en_r1[0]["char_end"]) == (0, 8)
    assert en_r1[0]["target_text_raw"] == "morning evening"
    # RO row 1: the 1-2 bead, in the cell's concatenation order; RO row 2: omission = [].
    assert [lk["link_id"] for lk in m["cell_links"][0][1]] == [3, 4]
    assert m["cell_links"][1][1] == []


def test_matrix_excludes_rejected_links(db_conn: sqlite3.Connection) -> None:
    """F8 (revue 3b) — rejected links are dead (ALN-03): out of the projection AND cell_links."""
    _setup_family(db_conn)
    db_conn.execute("UPDATE alignment_links SET status='rejected' WHERE link_id=4")  # RO 'ziua'
    db_conn.execute("UPDATE alignment_links SET status='accepted' WHERE link_id=3")  # RO 'buna'
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)

    # The cell shows only the live links ('ziua' gone, accepted 'buna' stays)…
    assert m["rows"][0][4] == "buna"
    # …and cell_links matches exactly what the cell displays.
    assert [lk["link_id"] for lk in m["cell_links"][0][1]] == [3]


def test_matrix_hub_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        build_alignment_matrix(db_conn, 999)
