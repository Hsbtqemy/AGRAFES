"""Service tests for matrix_export_service — the source-anchored aligned matrix (R3.3 §D7).

Projects a family (hub + translations) into a hub-anchored multilingual matrix,
exercising the core cell cases: cut slice, N-M bead concatenation, omission (empty),
and the paragraphe (parent_n) column. Local (db_conn), no sidecar.
"""
from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.services.errors import NotFoundError, ValidationError
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
    # ALI-01 tranche 2 : la grille projette ``text_norm`` (« le matin. »), le plan que
    # l'aligneur, la FTS et la curation utilisent — plus ``text_raw`` (« Le matin. »).
    assert m["rows"][0] == [1, 1, "le matin.", "morning", "buna ziua"]
    # row 2: FR u2 → EN cut slice "evening" ; RO omission = empty cell
    assert m["rows"][1] == [1, 2, "le soir.", "evening", ""]
    # tranche 3a — identifiers for grid gestures: hub unit per row, doc per language column
    assert m["hub_unit_ids"] == [1, 2]
    assert m["language_doc_ids"] == [1, 2, 3]  # hub(1) + EN(2) + RO(3)


def test_paragraph_column_is_sequential_not_anchor(db_conn: sqlite3.Connection) -> None:
    """The « paragraphe » column is a 1-based sequential index (1,2,3…), NOT the parent_n
    anchor: consecutive segments sharing a parent_n share a number; paratext (n<text_start_n)
    is blank; an ungrouped segment is its own paragraph."""
    conn = db_conn
    conn.execute(
        "INSERT INTO documents (title,language,doc_role,text_start_n,created_at)"
        " VALUES ('FR','fr','original',3,datetime('now'))"
    )
    doc_id = conn.execute("SELECT doc_id FROM documents WHERE title='FR'").fetchone()[0]
    # n=1,2 paratext ; ¶ anchored at 3 (n=3,4) then at 5 (n=5,6) ; n=7 singleton ; n=8 no parent_n
    rows = [
        (1, "Titre", None), (2, "Note", None),
        (3, "A.", '{"parent_n":3}'), (4, "B.", '{"parent_n":3}'),
        (5, "C.", '{"parent_n":5}'), (6, "D.", '{"parent_n":5}'),
        (7, "E.", '{"parent_n":7}'), (8, "F.", None),
    ]
    for n, txt, meta in rows:
        conn.execute(
            "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm,meta_json)"
            " VALUES (?,'line',?,?,?,?)",
            (doc_id, n, txt, txt.lower(), meta),
        )
    conn.commit()
    m = build_alignment_matrix(conn, doc_id)
    # (paragraphe, segment): paratext blank, then 1,1,2,2,3,4 — sequential, not the anchor 3/5/7.
    assert [(r[0], r[1]) for r in m["rows"]] == [
        ("", 1), ("", 2), (1, 3), (1, 4), (2, 5), (2, 6), (3, 7), (4, 8),
    ]


def test_intertitre_line_carries_no_paragraph_number(db_conn: sqlite3.Connection) -> None:
    """An intertitre-role line is a section heading, not a paragraph: blank ¶, and it does not
    advance the sequential counter — so the grid shows no ¶ toggle on it (blank ¶ → no button),
    consistent with the engine rejecting a paragraph toggle on a section wall."""
    conn = db_conn
    conn.execute(
        "INSERT INTO documents (title,language,doc_role,text_start_n,created_at)"
        " VALUES ('FR','fr','original',1,datetime('now'))"
    )
    doc_id = conn.execute("SELECT doc_id FROM documents WHERE title='FR'").fetchone()[0]
    conn.execute(  # units.unit_role is an FK to unit_roles(name) — seed the convention first
        # category='structure' is what makes the role a section wall — the structural
        # set is read from this catalogue, not hard-coded (R2.2). Migration 018 back-fills
        # it for the known names; a role created through the API must ask for it.
        "INSERT INTO unit_roles (name,label,category)"
        " VALUES ('intertitre','Intertitre','structure')"
    )
    rows = [
        (1, "Para un.", None),
        (2, "Chapitre I", "intertitre"),  # section heading (line + role, not a structure unit)
        (3, "Para deux.", None),
    ]
    for n, txt, role in rows:
        conn.execute(
            "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm,unit_role)"
            " VALUES (?,'line',?,?,?,?)",
            (doc_id, n, txt, txt.lower(), role),
        )
    conn.commit()
    m = build_alignment_matrix(conn, doc_id)
    # n=1 → ¶1 ; intertitre → blank ¶ ; n=3 → ¶2 (the heading did NOT advance the counter).
    assert [(r[0], r[1]) for r in m["rows"]] == [(1, 1), ("", 2), (2, 3)]


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
    # D-W13: pair number + manual marker travel with each link (run 'r' ≠ manual).
    assert en_r1[0]["external_id"] == 1
    assert en_r1[0]["manual"] is False
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


def test_matrix_cell_concat_follows_reading_order(db_conn: sqlite3.Connection) -> None:
    """A late-created link (D-W12 straddle) lands where it READS (target n, cut offset),
    not where it was created (link_id)."""
    _setup_family(db_conn)
    # Straddle shape on RO: FR u2's cell gains the TAIL of RO unit 4 ('buna' [2:4]='na'),
    # created AFTER its existing link to RO unit 5 ('ziua'). Reading order: unit 4 < unit 5.
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,target_doc_id,created_at) VALUES ('r',2,5,0,1,3,datetime('now'))")
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,pivot_doc_id,target_doc_id,created_at,target_char_start,target_char_end) VALUES ('manual',2,4,0,1,3,datetime('now'),2,4)")
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)

    # FR u2 × RO reads "na ziua" (unit 4's slice first), despite 'ziua' having the older link.
    assert m["rows"][1][4] == "na ziua"
    assert [lk["target_unit_id"] for lk in m["cell_links"][1][1]] == [4, 5]
    # The gesture-created link is flagged manual (run_id='manual') — the cell ↺ deletes it.
    assert [lk["manual"] for lk in m["cell_links"][1][1]] == [True, False]


def test_matrix_link_count_includes_rejected(db_conn: sqlite3.Connection) -> None:
    """1.6.58 — `link_count` counts EVERY link of the family, rejected ones included.

    The projection excludes rejected links (F8), but the aligner does not: its
    INSERT OR IGNORE dedupes on the unique (pivot_unit_id, target_unit_id) index, which a
    rejected row still occupies. A family whose links were all rejected therefore
    re-aligns to NOTHING — the « déjà aligné ? » gate of the Aligner bar must see them.
    """
    _setup_family(db_conn)
    m = build_alignment_matrix(db_conn, 1)
    assert m["link_count"] == 4  # 2 EN (cut pair) + 2 RO (bead)

    db_conn.execute("UPDATE alignment_links SET status='rejected'")
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)
    # Nothing is projected any more…
    assert all(cell == "" for row in m["rows"] for cell in row[3:])
    # …but the links are still there, and still block a plain re-align.
    assert m["link_count"] == 4


def test_matrix_hub_not_found(db_conn: sqlite3.Connection) -> None:
    with pytest.raises(NotFoundError):
        build_alignment_matrix(db_conn, 999)


def test_matrix_status_fields_default_empty(db_conn: sqlite3.Connection) -> None:
    """The status fields (D-W8/D8/D-W14) are present and empty on a status-free family."""
    _setup_family(db_conn)
    m = build_alignment_matrix(db_conn, 1)

    assert m["hub_unit_statuses"] == [None, None]
    assert m["cell_statuses"] == [[None, None], [None, None]]
    assert m["addition_rows"] == []
    assert m["uncovered"] == [[], []]


def test_matrix_non_traduit_token_both_axes(db_conn: sqlite3.Connection) -> None:
    """D10 token from BOTH axes: per-cell (D-W8, mig 028) marks one cell; the global
    unit_status (marker-lift) marks the whole row — but never over real aligned text."""
    _setup_family(db_conn)
    # Per-cell: FR u2 × RO (the empty cell of the base fixture).
    db_conn.execute(
        "INSERT INTO alignment_cell_statuses (pivot_unit_id, target_doc_id, status, created_at)"
        " VALUES (2, 3, 'non_traduit', datetime('now'))"
    )
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)
    assert m["rows"][1][4] == "[non traduit]"
    assert m["cell_statuses"] == [[None, None], [None, "non_traduit"]]
    assert m["hub_unit_statuses"] == [None, None]

    # Global axis: FR u2 non_traduit everywhere. Its EN cell HAS a link (cut slice
    # "evening") — real text wins over the contradictory status; RO keeps the token.
    db_conn.execute("DELETE FROM alignment_cell_statuses")
    db_conn.execute("UPDATE units SET unit_status='non_traduit' WHERE unit_id=2")
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)
    assert m["rows"][1][3] == "evening"
    assert m["rows"][1][4] == "[non traduit]"
    assert m["hub_unit_statuses"] == [None, "non_traduit"]
    assert m["cell_statuses"] == [[None, None], [None, None]]


def test_matrix_addition_rows_woven_in_flux(db_conn: sqlite3.Connection) -> None:
    """D8 projection (a): an ajout unit becomes a flux row at its reading position —
    after the hub row of the nearest covered target unit before it; before the first
    row when nothing precedes it. Parallel arrays stay aligned (None hub ids)."""
    _setup_family(db_conn)
    # RO unit n=3 'extra' — nearest covered RO unit is n=2 ('ziua', shown on hub row 0).
    db_conn.execute(
        "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm,unit_status)"
        " VALUES (3,'line',3,'extra','extra','ajout')"
    )
    # EN unit n=0 'intro' — precedes every covered EN unit → woven before the first row.
    db_conn.execute(
        "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm,unit_status)"
        " VALUES (2,'line',0,'intro','intro','ajout')"
    )
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)

    assert [r[2] for r in m["rows"]] == ["[ajout]", "le matin.", "[ajout]", "le soir."]
    assert m["rows"][0] == ["", "", "[ajout]", "intro", ""]
    assert m["rows"][2] == ["", "", "[ajout]", "", "extra"]
    assert m["hub_unit_ids"] == [None, 1, None, 2]
    assert m["hub_unit_statuses"] == [None, None, None, None]
    assert m["cell_links"][0] == [[], []] and m["cell_links"][2] == [[], []]
    assert m["addition_rows"] == [
        {"row": 0, "doc_id": 2, "unit_id": 7, "n": 0},
        {"row": 2, "doc_id": 3, "unit_id": 6, "n": 3},
    ]
    # An ajout unit is accounted for — it is NOT uncovered (D-W14).
    assert m["uncovered"] == [[], []]


def test_matrix_linked_ajout_unit_is_not_woven_twice(db_conn: sqlite3.Connection) -> None:
    """R2 (revue 2026-07-13) — an ajout unit carrying an ACTIVE link is projected by its
    cell; weaving it as a flux row too would print the same sentence twice (grid AND the
    CSV export, which writes `rows` verbatim). A rejected link does not cover it."""
    _setup_family(db_conn)
    # RO unit 5 ('ziua') is actively linked to FR u1 (the 1-2 bead of the fixture).
    db_conn.execute("UPDATE units SET unit_status='ajout' WHERE unit_id=5")
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)

    assert m["addition_rows"] == []
    assert [r[2] for r in m["rows"]] == ["le matin.", "le soir."]
    assert m["rows"][0][4] == "buna ziua"  # projected once, by its cell
    # Kill the link: the unit is no longer covered → it becomes a legitimate flux row.
    db_conn.execute("UPDATE alignment_links SET status='rejected' WHERE target_unit_id=5")
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)
    assert [a["unit_id"] for a in m["addition_rows"]] == [5]
    assert m["rows"][0][4] == "buna"


def test_matrix_addition_anchor_follows_row_order_not_max_n(db_conn: sqlite3.Connection) -> None:
    """R5 — anchor on the last ROW displaying a covered unit at or before n_a, not on the
    row of the largest such n: a re-anchored (⇲) target makes the two differ, and only the
    row order is the matrix's reading order."""
    _setup_family(db_conn)
    # Non-monotone RO: unit 4 (n=1) is re-anchored to FR u2 (row 1), unit 5 (n=2) to FR
    # u1 (row 0). max(n)=2 → row 0 (wrong: row 1 also shows RO content ≤ n=2).
    db_conn.execute("DELETE FROM alignment_links WHERE target_doc_id=3")
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at) VALUES ('r',2,4,0,1,3,datetime('now'))")
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at) VALUES ('r',1,5,0,1,3,datetime('now'))")
    db_conn.execute(
        "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm,unit_status)"
        " VALUES (3,'line',3,'extra','extra','ajout')")
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)

    # The ajout (n=3) follows both covered units in reading order → it must land AFTER
    # the last row showing any of them (row 1), i.e. last. Anchoring on max(n)=2's row
    # (row 0) would insert it between the two hub rows.
    assert [r[2] for r in m["rows"]] == ["le matin.", "le soir.", "[ajout]"]
    assert m["addition_rows"] == [{"row": 2, "doc_id": 3, "unit_id": 6, "n": 3}]


def test_matrix_uncovered_units_per_column(db_conn: sqlite3.Connection) -> None:
    """D-W14: a target unit with no active link in this family and no status is
    invisible in the grid — surfaced per column so « ＋ Ajout » can act on it.
    A rejected link does not cover; a status (ajout/non_traduit) removes it."""
    _setup_family(db_conn)
    db_conn.execute(
        "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm)"
        " VALUES (3,'line',3,'orphan','orphan')"
    )
    db_conn.execute("UPDATE alignment_links SET status='rejected' WHERE link_id=4")  # RO 'ziua'
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)

    assert m["uncovered"][0] == []  # EN fully covered
    assert m["uncovered"][1] == [
        {"unit_id": 5, "n": 2, "text_raw": "ziua", "text_norm": "ziua"},
        {"unit_id": 6, "n": 3, "text_raw": "orphan", "text_norm": "orphan"},
    ]

    db_conn.execute("UPDATE units SET unit_status='ajout' WHERE unit_id=6")
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)
    assert [u["unit_id"] for u in m["uncovered"][1]] == [5]


def test_matrix_anchor_status_parallel_to_languages(db_conn: sqlite3.Connection) -> None:
    """1.6.59 (DESIGN_upstream_anchoring §4) — anchor_status ∥ languages (index 0 = hub).
    RED on the pre-1.6.59 payload (no anchor_status key)."""
    _setup_family(db_conn)
    m = build_alignment_matrix(db_conn, 1)
    assert len(m["anchor_status"]) == len(m["languages"]) == 3
    # hub FR: both units carry parent_n=1 → paragraph anchor.
    assert m["anchor_status"][0]["kind"] == "paragraph"
    # EN, RO: no external_id, no parent_n → unanchored (the aligner would drift).
    assert m["anchor_status"][1] == {"anchored": False, "kind": None, "line_count": 1}
    assert m["anchor_status"][2] == {"anchored": False, "kind": None, "line_count": 2}


def test_matrix_carries_both_text_planes(db_conn: sqlite3.Connection) -> None:
    """1.6.69 — la grille projette le plan que le système utilise, et le dit deux fois.

    Depuis la tranche 2, ``rows[i][2]`` EST ``text_norm`` : la surface de contrôle est
    la surface de calcul (ALI-01). ``hub_text_norms`` reste néanmoins dans la charge
    utile, et cette redondance est voulue — le stylo s'amorce sur un « espace d'édition »
    explicite plutôt que sur « ce que la grille affiche ». C'est leur confusion qui avait
    laissé une seconde correction écraser la première (§11.12) ; un champ dédié rend
    l'invariant vérifiable même si la projection rebasculait un jour.
    """
    _setup_family(db_conn)
    m = build_alignment_matrix(db_conn, 1)

    # La fixture fait diverger les deux plans ("Le matin." / "le matin.") : sans cela le
    # test ne saurait pas distinguer les deux colonnes.
    assert m["rows"][0][2] == "le matin."
    assert m["hub_text_norms"][0] == "le matin."
    assert len(m["hub_text_norms"]) == len(m["rows"])

    # Same on the translation side, per link.
    ro_links = m["cell_links"][0][1]
    assert [lk["target_text_norm"] for lk in ro_links] == ["buna", "ziua"]
    assert all("target_text_raw" in lk for lk in ro_links)


def test_matrix_hub_text_norm_is_none_on_addition_row(db_conn: sqlite3.Connection) -> None:
    """An ajout row has no hub segment: its norm slot must be None, not "" — the front
    reads it to decide whether the stylo can open at all."""
    _setup_family(db_conn)
    db_conn.execute(
        "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm,unit_status)"
        " VALUES (2,'line',9,'Added by the translator','added by the translator','ajout')"
    )
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)

    add_rows = [a["row"] for a in m["addition_rows"]]
    assert add_rows, "the ajout unit should have been woven in"
    for i in add_rows:
        assert m["hub_unit_ids"][i] is None
        assert m["hub_text_norms"][i] is None
    # …and a real hub row still carries its norm.
    hub_rows = [i for i in range(len(m["rows"])) if m["hub_unit_ids"][i] is not None]
    assert all(m["hub_text_norms"][i] is not None for i in hub_rows)


def test_matrix_cut_slice_comes_from_the_normalised_plane(db_conn: sqlite3.Connection) -> None:
    """ALI-01 tranche 2 — la tranche de coupe est prélevée dans ``text_norm``.

    Le cas est construit pour que les deux plans n'aient pas la même LONGUEUR : couper
    aux mêmes offsets dans l'un ou dans l'autre donne alors deux textes différents, et
    le test sait dire lequel a servi. Tant que les offsets indexaient ``text_raw``, la
    grille affichait une tranche du texte que l'aligneur n'utilise pas.
    """
    _setup_family(db_conn)
    # « ¤ » est un déchet d'import que la normalisation remplace par une espace ; ici on
    # va plus loin (le raw est plus long de 4 signes) pour rendre l'écart visible.
    db_conn.execute(
        "UPDATE units SET text_raw='<hi>morning</hi> evening', text_norm='morning evening'"
        " WHERE unit_id=3"
    )
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)

    # Les liens coupent [0:8] et [8:15] — dans « morning evening » cela donne
    # « morning » / « evening » ; dans le raw balisé, « <hi>morn » / « ing</hi> ».
    assert m["rows"][0][3] == "morning"
    assert m["rows"][1][3] == "evening"
    assert "<hi>" not in m["rows"][0][3]


def test_matrix_uncovered_carries_both_planes(db_conn: sqlite3.Connection) -> None:
    """Le panneau « ＋ Ajout » doit montrer le plan de la grille où l'unité atterrira."""
    _setup_family(db_conn)
    db_conn.execute(
        "INSERT INTO units (doc_id,unit_type,n,text_raw,text_norm)"
        " VALUES (3,'line',3,'ORPHAN brut','orphan normalisé')"
    )
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)

    orphan = [u for u in m["uncovered"][1] if u["n"] == 3]
    assert orphan, m["uncovered"]
    assert orphan[0]["text_norm"] == "orphan normalisé"
    assert orphan[0]["text_raw"] == "ORPHAN brut"  # clé historique conservée


# ─── Colonnes visibles : target_doc_ids (1.6.77, ALI-18 correctif 2) ────────────


def test_matrix_scoped_to_one_translation_column(db_conn: sqlite3.Connection) -> None:
    """`target_doc_ids` ne projette que les colonnes demandées — et TOUT ce qui est
    parallèle aux langues suit : headers, languages, language_doc_ids, cells, cell_links,
    cell_statuses, uncovered, anchor_status. Une seule de ces listes qui resterait à
    l'échelle famille désindexerait tous les gestes de la grille (ils adressent la
    cellule par `col`, un rang dans `translationLangs`)."""
    _setup_family(db_conn)
    m = build_alignment_matrix(db_conn, 1, [3])  # RO seulement

    assert m["headers"] == ["paragraphe", "segment", "fr", "ro"]
    assert m["languages"] == ["fr", "ro"]
    assert m["language_doc_ids"] == [1, 3]
    # La colonne EN a disparu de la ligne : le 1-2 roumain reste, la tranche « morning » non.
    assert m["rows"][0] == [1, 1, "le matin.", "buna ziua"]
    assert m["rows"][1] == [1, 2, "le soir.", ""]
    # Les tableaux ∥ langues ont tous un seul rang de traduction.
    assert all(len(r) == 1 for r in m["cell_links"])
    assert all(len(r) == 1 for r in m["cell_statuses"])
    assert len(m["uncovered"]) == 1
    assert len(m["anchor_status"]) == 2  # moyeu + RO


def test_matrix_scope_keeps_family_column_order(db_conn: sqlite3.Connection) -> None:
    """L'ordre des colonnes reste celui de la famille, pas celui de la requête : masquer
    puis réafficher une langue ne doit pas rebattre la grille sous les yeux."""
    _setup_family(db_conn)
    m = build_alignment_matrix(db_conn, 1, [3, 2])  # demandé RO puis EN
    assert m["languages"] == ["fr", "en", "ro"]


def test_matrix_scope_omitted_projects_every_language(db_conn: sqlite3.Connection) -> None:
    """Le défaut est inchangé — c'est ce que continue d'utiliser l'export CSV, qui
    n'expose pas le paramètre."""
    _setup_family(db_conn)
    assert build_alignment_matrix(db_conn, 1)["languages"] == ["fr", "en", "ro"]
    assert build_alignment_matrix(db_conn, 1, None)["languages"] == ["fr", "en", "ro"]


def test_matrix_scope_rejects_a_doc_outside_the_family(db_conn: sqlite3.Connection) -> None:
    """Un id étranger est refusé, pas ignoré : une colonne vide serait indiscernable
    d'une traduction non alignée."""
    _setup_family(db_conn)
    db_conn.execute(
        "INSERT INTO documents (title,language,doc_role,created_at)"
        " VALUES ('ES','es','translation',datetime('now'))"
    )
    db_conn.commit()
    other = db_conn.execute("SELECT doc_id FROM documents WHERE title='ES'").fetchone()[0]
    with pytest.raises(ValidationError) as exc:
        build_alignment_matrix(db_conn, 1, [other])
    assert exc.value.details["unknown_doc_ids"] == [other]


def test_matrix_scope_empty_list_projects_the_hub_alone(db_conn: sqlite3.Connection) -> None:
    """Liste vide ≠ omis : c'est « aucune traduction », le moyeu seul. La distinction
    compte — `None` doit rester le seul chemin vers « toutes les langues »."""
    _setup_family(db_conn)
    m = build_alignment_matrix(db_conn, 1, [])
    assert m["languages"] == ["fr"]
    assert m["rows"][0] == [1, 1, "le matin."]


def test_matrix_link_counts_are_per_column_and_include_rejected(db_conn: sqlite3.Connection) -> None:
    """`link_counts` est l'échelle qu'une relance scopée doit annoncer. Rejetés compris,
    comme `link_count` — c'est ce que voit l'index unique de l'aligneur. `manual` isole
    les liens que `preserve_accepted` ne protège PAS (ALI-15)."""
    _setup_family(db_conn)
    # un lien rejeté et un lien manuel sur la colonne RO
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at,status) VALUES ('r',2,4,2,1,3,datetime('now'),'rejected')"
    )
    db_conn.execute(
        "INSERT INTO alignment_links (run_id,pivot_unit_id,target_unit_id,external_id,"
        "pivot_doc_id,target_doc_id,created_at) VALUES ('manual',2,5,2,1,3,datetime('now'))"
    )
    db_conn.commit()
    m = build_alignment_matrix(db_conn, 1)
    by_doc = {c["target_doc_id"]: c for c in m["link_counts"]}
    assert by_doc[2] == {"target_doc_id": 2, "links": 2, "manual": 0}
    assert by_doc[3] == {"target_doc_id": 3, "links": 4, "manual": 1}  # 2 + rejeté + manuel
    # Scopé : la liste suit les colonnes projetées, `link_count` reste famille-entière.
    scoped = build_alignment_matrix(db_conn, 1, [3])
    assert [c["target_doc_id"] for c in scoped["link_counts"]] == [3]
    assert scoped["link_count"] == m["link_count"] == 6
