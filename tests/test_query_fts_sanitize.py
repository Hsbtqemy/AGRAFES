"""La ponctuation d'une requête ne doit pas faire tomber la recherche.

FTS5 recevait la saisie brute, et une partie de la ponctuation y est de la SYNTAXE.
Trouvé le 2026-08-20 sur une requête roumaine réelle — « Mi - ar face plăcere. » —
qui rendait `sqlite3.OperationalError: no such column: ar` : FTS5 lit `- ar` comme un
filtre de colonne négatif.

**Le périmètre est confiné à la ponctuation ASCII**, et c'est ce qui rend la règle
tenable pour un corpus multilingue : mesuré, tous les scripts non latins passent — arabe,
chinois, japonais, coréen, grec, cyrillique, hébreu, devanagari — ponctuation non-ASCII
comprise (« », ，。, le maqaf hébreu, l'apostrophe courbe). Ces tests le verrouillent :
si quelqu'un durcit la règle jusqu'à toucher au non-ASCII, ils tombent.

Ampleur mesurée sur le corpus de travail avant correctif : 14,7 % des lignes contenaient
une séquence qui fait échouer la requête (21,5 % en français, 29,8 % en roumain).
"""
from __future__ import annotations

import sqlite3

import pytest

from multicorpus_engine.query import sanitize_fts_query


@pytest.fixture()
def fts() -> sqlite3.Connection:
    """Un index FTS5 minimal — c'est le moteur lui-même qu'on teste, pas un modèle."""
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE VIRTUAL TABLE fts_units USING fts5(text_norm)")
    conn.executemany(
        "INSERT INTO fts_units(text_norm) VALUES (?)",
        [("Mi - ar face plăcere.",), ("bonjour le monde",), ("le chat et le chien",),
         ("السلام عليكم",), ("你好，世界。",), ("rendez-vous à 18:30",)],
    )
    conn.commit()
    return conn


def _cherche(conn: sqlite3.Connection, q: str) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM fts_units WHERE fts_units MATCH ?", (sanitize_fts_query(q),)
    ).fetchone()[0]


# --- le cas qui l'a révélé ------------------------------------------------------

def test_la_requete_roumaine_qui_faisait_tomber_la_recherche(fts: sqlite3.Connection) -> None:
    """Coller une ligne du concordancier pour la retrouver doit marcher.

    Le document roumain porte des traits d'union espacés (« Mi - ar »), un artefact
    d'import : l'orthographe est « Mi-ar ». L'utilisateur copie ce qu'il voit.
    """
    assert _cherche(fts, "Mi - ar face plăcere.") == 1


def test_la_saisie_brute_faisait_bien_echouer_fts(fts: sqlite3.Connection) -> None:
    """La preuve que le correctif corrige quelque chose : sans lui, ça lève."""
    with pytest.raises(sqlite3.OperationalError, match="no such column: ar"):
        fts.execute(
            "SELECT COUNT(*) FROM fts_units WHERE fts_units MATCH ?",
            ("Mi - ar face plăcere.",),
        ).fetchone()


@pytest.mark.parametrize("q", [
    "mi-ar",           # trait d'union collé
    "Mi - ar",         # trait d'union espacé
    "plăcere.",        # point final
    "l'homme",         # apostrophe droite
    "18:30",           # deux-points
    "C++",             # plus
    "R&D",             # esperluette
    "et/ou",           # barre oblique
])
def test_les_sept_caracteres_ascii_qui_cassaient(fts: sqlite3.Connection, q: str) -> None:
    """Aucun ne doit plus lever, quel que soit le résultat trouvé."""
    _cherche(fts, q)  # ne lève pas


# --- ce qui ne doit PAS être touché : les langues -------------------------------

@pytest.mark.parametrize("q", [
    "السلام عليكم",       # arabe
    "你好，世界。",          # chinois + ponctuation CJK
    "こんにちは世界",        # japonais
    "안녕하세요",            # coréen
    "καλημέρα",           # grec
    "здравствуйте",       # cyrillique
    "בת־שבע",             # hébreu avec maqaf (U+05BE)
    "नमस्ते",              # devanagari
    "l’homme",            # apostrophe courbe
    "« bonjour »",        # guillemets français
])
def test_le_non_ascii_traverse_intact(q: str) -> None:
    """La règle ne connaît aucune langue, et ne doit pas se mettre à en connaître.

    Si ce test tombe, c'est que quelqu'un a élargi l'assainissement au non-ASCII — ce
    qui abîmerait des écritures entières pour un problème qui n'existe que en ASCII.
    """
    assert sanitize_fts_query(q) == q


# --- ce qui ne doit PAS être touché : la syntaxe promise ------------------------

@pytest.mark.parametrize("q", [
    "bonjour monde",
    '"phrase exacte"',
    "bonj*",
    "^bonjour",
    "NEAR(chat chien, 3)",
    "chat AND chien",
    "chat OR chien NOT souris",
    "(chat OR chien) AND noir",
    '"phrase exacte" AND mot',
])
def test_la_syntaxe_fts5_traverse_intacte(q: str) -> None:
    """L'écran promet cette syntaxe ; l'assainissement ne doit pas la manger.

    `NEAR(chat chien, 3)` est le cas qui a fait rejeter une première implémentation :
    elle découpait sur les espaces et rendait `"NEAR(chat" chien, 3)`.
    """
    assert sanitize_fts_query(q) == q


def test_une_phrase_deja_quotee_n_est_pas_requotee(fts: sqlite3.Connection) -> None:
    """FTS5 accepte toute ponctuation dans une phrase : c'est la porte de sortie que
    l'utilisateur averti emploie déjà, et elle doit rester ouverte."""
    assert sanitize_fts_query('"Mi - ar face"') == '"Mi - ar face"'
    assert _cherche(fts, '"Mi - ar face"') == 1


# --- les deux pièges de l'implémentation ----------------------------------------

def test_un_token_de_pure_ponctuation_est_ecarte_et_non_quote(fts: sqlite3.Connection) -> None:
    """Le piège qui aurait transformé un plantage en zéro résultat silencieux.

    FTS5 ACCEPTE `"-"` mais ne le fait correspondre à rien. Quoter le tiret isolé de
    « Mi - ar » aurait donc rendu 0 résultat sans erreur — l'utilisateur aurait conclu
    que sa phrase est absente du corpus.
    """
    assert '"-"' not in sanitize_fts_query("Mi - ar")
    assert _cherche(fts, "Mi - ar") == 1


def test_l_ancre_et_la_troncature_restent_hors_des_guillemets() -> None:
    """Les enfermer dans la phrase en ferait des caractères littéraux, donc une
    recherche vide. Les deux formes `^"mot"` et `"mot"*` sont acceptées par FTS5."""
    assert sanitize_fts_query("^mi-ar") == '^"mi-ar"'
    assert sanitize_fts_query("mi-ar*") == '"mi-ar"*'


def test_une_requete_sans_aucun_mot_rend_une_phrase_vide(fts: sqlite3.Connection) -> None:
    """« --- » ne contient rien de cherchable. Rendre la saisie brute relancerait
    l'erreur qu'on vient d'éviter ; zéro résultat est la réponse exacte."""
    assert sanitize_fts_query("---") == '""'
    assert _cherche(fts, "---") == 0


def test_un_guillemet_isole_ne_casse_pas_la_requete(fts: sqlite3.Connection) -> None:
    """Une saisie déséquilibrée ne doit pas lever non plus."""
    for q in ['mot"', '"mot', 'a " b']:
        _cherche(fts, q)  # ne lève pas


def test_une_requete_vide_traverse_telle_quelle() -> None:
    """Les appelants ont leur propre court-circuit sur la requête vide ; on ne le double
    pas, et surtout on ne rend pas `'""'` là où ils attendent une chaîne vide."""
    assert sanitize_fts_query("") == ""
    assert sanitize_fts_query("   ") == "   "


# --- ce que l'assainissement ne peut pas rattraper -------------------------------

def test_le_surlignage_suit_les_mots_et_non_les_tokens_bruts() -> None:
    """Défaut rendu VISIBLE par le correctif, pas causé par lui.

    Tant que ces requêtes plantaient, personne ne voyait leur surlignage. Découpé sur
    l'espace, il marquait le tiret isolé comme un résultat — `<<Mi>> <<->> <<ar>>` — et
    « mi-ar » ne marquait RIEN, le texte portant « mi - ar » : un résultat sans
    surlignage se lit comme un faux positif.
    """
    from multicorpus_engine.query import _highlight_segment

    texte = "Mi - ar face plăcere."
    marque = _highlight_segment(texte, "Mi - ar face plăcere.")
    assert "<<->>" not in marque
    assert "<<Mi>>" in marque and "<<plăcere>>" in marque
    # La recherche trouve la ligne via une phrase de deux tokens ; le surlignage doit
    # marquer ces deux mots-là plutôt que de ne rien marquer.
    assert "<<Mi>>" in _highlight_segment(texte, "mi-ar")


def test_le_surlignage_ne_prend_aucune_ponctuation_pour_un_terme() -> None:
    r"""Vaut pour toutes les écritures : `\w+` est unicode, la ponctuation d'où qu'elle
    vienne n'est jamais un terme."""
    from multicorpus_engine.query import _highlight_segment

    for texte, q in [("你好，世界。", "你好，世界。"), ("שלום, עולם", "שלום, עולם")]:
        marque = _highlight_segment(texte, q)
        assert "<<,>>" not in marque and "<<，>>" not in marque and "<<。>>" not in marque
