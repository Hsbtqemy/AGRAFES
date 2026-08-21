"""La requête de flux est au grain TOKEN : elle ne doit porter aucun texte d'unité.

Trouvé le 2026-08-21 en cherchant pourquoi la recherche grammaticale figeait toute
l'application. `_stream_groups` sélectionnait `u.text_norm` ET `u.text_raw` sur une
jointure au grain token : le texte du segment était donc recopié une fois par mot
qu'il contient — un coût quadratique en longueur d'unité.

Mesuré sur le corpus de travail (87 300 tokens), où un document avait été importé en
une seule unité de 110 788 caractères portant 24 902 tokens :

    avec text_norm + text_raw    81,05 s    11 127 Mo
    avec text_norm seul          25,00 s     5 592 Mo
    sans texte d'unité            0,63 s        41 Mo

`text_raw` n'était lu par aucun des trois consommateurs de `_stream_groups`
(`token_query`, `token_stats`, `token_collocates`) ; `text_norm` ne l'est que par
`run_token_query_page`, et seulement pour les unités de la page rendue.

**Le piège de ces tests.** Le gaspillage est INVISIBLE dans la valeur de retour :
`_stream_groups` ne garde le texte qu'une fois par groupe. Les gigaoctets vivaient
dans le jeu de lignes intermédiaire, jeté à la ligne suivante. Un test sur le
résultat ne peut donc rien voir — il faut regarder le SQL émis (test A) ou la
mémoire consommée pendant l'appel (test D).
"""
from __future__ import annotations

import sqlite3
import tracemalloc
from pathlib import Path

import pytest

_MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


def _make_conn() -> sqlite3.Connection:
    from multicorpus_engine.db.migrations import apply_migrations

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    apply_migrations(conn, migrations_dir=_MIGRATIONS_DIR)
    return conn


def _seed_normal(conn: sqlite3.Connection) -> None:
    """Un cas ordinaire : une unité, un texte court, six tokens."""
    conn.execute(
        "INSERT INTO documents (doc_id, title, language, source_hash, workflow_status, created_at) "
        "VALUES (1, 'Doc FR', 'fr', 'h1', 'draft', '2026-01-01')"
    )
    conn.execute(
        "INSERT INTO units (unit_id, doc_id, unit_type, n, text_norm, text_raw) "
        "VALUES (1, 1, 'line', 1, 'le chat mange le poisson rouge', 'Le chat mange le poisson rouge.')"
    )
    for pos, (word, lemma, upos) in enumerate([
        ("le", "le", "DET"), ("chat", "chat", "NOUN"), ("mange", "manger", "VERB"),
        ("le", "le", "DET"), ("poisson", "poisson", "NOUN"), ("rouge", "rouge", "ADJ"),
    ]):
        conn.execute(
            "INSERT INTO tokens (unit_id, sent_id, position, word, lemma, upos) VALUES (1, 1, ?, ?, ?, ?)",
            (pos, word, lemma, upos),
        )
    conn.commit()


#: Le cas réel — un document entier resté en une seule unité — en modèle réduit.
#: Le BOM en tête n'est pas un ornement : `é` tient dans latin-1 et Python le stocke
#: sur 1 octet, alors que U+FEFF fait basculer la chaîne ENTIÈRE en UCS-2 et double
#: donc le coût. Le corpus réel portait exactement ce BOM en tête de l'unité géante.
_GEANT_TEXTE = "﻿" + "é" * 20_000
_GEANT_TOKENS = 400


def _seed_geant(conn: sqlite3.Connection) -> None:
    texte = _GEANT_TEXTE
    conn.execute(
        "INSERT INTO documents (doc_id, title, language, source_hash, workflow_status, created_at) "
        "VALUES (1, 'Roman non segmenté', 'fr', 'h1', 'draft', '2026-01-01')"
    )
    conn.execute(
        "INSERT INTO units (unit_id, doc_id, unit_type, n, text_norm, text_raw) VALUES (1, 1, 'line', 1, ?, ?)",
        (texte, texte),
    )
    conn.executemany(
        "INSERT INTO tokens (unit_id, sent_id, position, word, lemma, upos) VALUES (1, 1, ?, ?, ?, 'NOUN')",
        [(pos, f"mot{pos}", f"mot{pos}") for pos in range(_GEANT_TOKENS)],
    )
    conn.commit()


# --- A. l'invariant, celui qui ne doit jamais revenir ---------------------------

def test_la_requete_de_flux_ne_selectionne_aucun_texte_d_unite() -> None:
    """RED sur l'ancien code : il sélectionnait `u.text_norm` et `u.text_raw`.

    C'est le seul endroit où le défaut est observable de façon déterministe — la
    valeur de retour, elle, ne porte le texte qu'une fois par groupe et paraît donc
    innocente. On lit le SQL réellement émis.
    """
    from multicorpus_engine.token_query import _stream_groups

    conn = _make_conn()
    _seed_normal(conn)

    emis: list[str] = []
    conn.set_trace_callback(emis.append)
    _stream_groups(conn, within_sentence=False, language=None, doc_ids=None)
    conn.set_trace_callback(None)

    sql = " ".join(emis)
    assert "u.text_raw" not in sql, "text_raw n'est lu par personne : le sélectionner coûte 5,5 Go"
    assert "u.text_norm" not in sql, "text_norm ne sert qu'aux unités de la page, pas à tout le corpus"


def test_le_meta_des_flux_ne_porte_plus_de_texte() -> None:
    """Le contrat interne offert à `token_stats` et `token_collocates`.

    Ni l'un ni l'autre n'a jamais lu de texte ici ; `doc_date` reste, car
    `token_stats` en tire l'année et c'est du texte court.
    """
    from multicorpus_engine.token_query import _stream_groups

    conn = _make_conn()
    _seed_normal(conn)
    (meta, _tokens), = _stream_groups(conn, within_sentence=False, language=None, doc_ids=None)

    assert "text_norm" not in meta and "text_raw" not in meta
    assert set(meta) == {"doc_id", "unit_id", "unit_n", "external_id", "language", "title", "doc_date"}


# --- B. ce que le correctif ne doit surtout pas casser --------------------------

def test_le_texte_du_segment_est_toujours_rendu() -> None:
    """Le vrai risque du correctif : vider `text_norm` de tous les résultats.

    Aucun test ne couvrait ce champ avant celui-ci — la régression serait passée.
    """
    from multicorpus_engine.token_query import run_token_query_page

    conn = _make_conn()
    _seed_normal(conn)
    page = run_token_query_page(conn, cql='[lemma="manger"]', mode="segment")

    assert page["total"] == 1
    hit = page["hits"][0]
    assert hit["text_norm"] == "le chat mange le poisson rouge"
    assert hit["text"] == "le chat mange le poisson rouge"


def test_le_kwic_reste_intact() -> None:
    from multicorpus_engine.token_query import run_token_query_page

    conn = _make_conn()
    _seed_normal(conn)
    hit = run_token_query_page(conn, cql='[lemma="manger"]', mode="kwic", window=2)["hits"][0]

    assert hit["left"] == "le chat"
    assert hit["match"] == "mange"
    assert hit["right"] == "le poisson"
    assert hit["text_norm"] == "le chat mange le poisson rouge"


def test_le_texte_suit_la_bonne_unite_quand_la_page_en_melange_plusieurs() -> None:
    """Le texte n'arrive plus avec le flux : il est recollé par `unit_id`. Un
    recollage faux donnerait le texte d'un autre segment — silencieusement."""
    from multicorpus_engine.token_query import run_token_query_page

    conn = _make_conn()
    _seed_normal(conn)
    conn.execute(
        "INSERT INTO units (unit_id, doc_id, unit_type, n, text_norm, text_raw) "
        "VALUES (2, 1, 'line', 2, 'le chien mange une pomme', 'Le chien mange une pomme.')"
    )
    for pos, (word, lemma, upos) in enumerate([
        ("le", "le", "DET"), ("chien", "chien", "NOUN"), ("mange", "manger", "VERB"),
        ("une", "un", "DET"), ("pomme", "pomme", "NOUN"),
    ]):
        conn.execute(
            "INSERT INTO tokens (unit_id, sent_id, position, word, lemma, upos) VALUES (2, 1, ?, ?, ?, ?)",
            (pos, word, lemma, upos),
        )
    conn.commit()

    hits = run_token_query_page(conn, cql='[lemma="manger"]', mode="segment")["hits"]
    par_unite = {h["unit_id"]: h["text_norm"] for h in hits}
    assert par_unite == {1: "le chat mange le poisson rouge", 2: "le chien mange une pomme"}


# --- C. la propriété elle-même, indépendante de l'implémentation -----------------

def test_le_cout_ne_croit_plus_avec_le_produit_texte_x_tokens() -> None:
    """RED sur l'ancien code, et pour la bonne raison.

    Une unité de 20 001 caractères portant 400 tokens faisait transporter
    400 × 2 × 20 001 caractères en UCS-2. Mesuré : **32,4 Mo** sur l'ancien code,
    **0,31 Mo** sur le nouveau. Le seuil de 8 Mo est donc à 25× au-dessus du coût
    réel des tokens seuls et à 4× en dessous de l'ancien — large des deux côtés,
    donc stable, tout en restant incapable de passer si le texte revient.

    Ce test survit à une réécriture du SQL, là où le test A pin le SQL lui-même.
    """
    from multicorpus_engine.token_query import _stream_groups

    conn = _make_conn()
    _seed_geant(conn)

    tracemalloc.start()
    try:
        groupes = _stream_groups(conn, within_sentence=False, language=None, doc_ids=None)
        _, pic = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert len(groupes[0][1]) == _GEANT_TOKENS
    assert pic < 8_000_000, f"{pic / 1e6:.1f} Mo pour {_GEANT_TOKENS} tokens : le texte d'unité est revenu"


def test_une_unite_geante_rend_quand_meme_son_texte() -> None:
    """Le pendant du précédent : économiser ne doit pas amputer le résultat."""
    from multicorpus_engine.token_query import run_token_query_page

    conn = _make_conn()
    _seed_geant(conn)
    hit = run_token_query_page(conn, cql='[word="mot7"]', mode="segment")["hits"][0]

    assert hit["text_norm"] == _GEANT_TEXTE


@pytest.mark.parametrize("within", [True, False])
def test_les_deux_grains_de_regroupement_survivent(within: bool) -> None:
    """`within_sentence` regroupe par (unit_id, sent_id) plutôt que par unit_id ;
    le recollage du texte se fait par `unit_id` dans les deux cas."""
    from multicorpus_engine.token_query import run_token_query_page

    conn = _make_conn()
    _seed_normal(conn)
    cql = '[lemma="manger"] within s' if within else '[lemma="manger"]'
    hits = run_token_query_page(conn, cql=cql, mode="segment")["hits"]

    assert len(hits) == 1
    assert hits[0]["text_norm"] == "le chat mange le poisson rouge"
