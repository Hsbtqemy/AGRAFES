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

Ampleur mesurée sur le corpus de travail : 14,7 % des lignes portent un trait d'union
espacé (21,5 % en français, 29,8 % en roumain) — **et 47,9 % une virgule**. Ce second
chiffre est arrivé plus tard : la première mesure avait été faite sur des tokens découpés
à l'espace, ce qui excluait par construction `,` `(` `)`, délimiteurs du balayage. D'où
les deux vagues de correctif que ce fichier couvre, et la leçon : mesurer un
assainissement de requête sur des **requêtes entières**, jamais sur ses propres tokens.
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
    #
    # Depuis le 2026-08-21 (correctif du pivot KWIC), il marque la LOCUTION entière
    # plutôt que chaque mot séparément : une phrase FTS5 exige des tokens adjacents,
    # donc `mi-ar` désigne bien la suite « mi » puis « ar » et non deux mots
    # indépendants. L'assertion disait `<<Mi>>` ; elle dit maintenant la portée.
    assert _highlight_segment(texte, "mi-ar") == "<<Mi - ar>> face plăcere."


def test_le_surlignage_ne_prend_aucune_ponctuation_pour_un_terme() -> None:
    r"""Vaut pour toutes les écritures : `\w+` est unicode, la ponctuation d'où qu'elle
    vienne n'est jamais un terme."""
    from multicorpus_engine.query import _highlight_segment

    for texte, q in [("你好，世界。", "你好，世界。"), ("שלום, עולם", "שלום, עולם")]:
        marque = _highlight_segment(texte, q)
        assert "<<,>>" not in marque and "<<，>>" not in marque and "<<。>>" not in marque


# --- les trois caractères ambigus : syntaxe ici, texte là ------------------------
#
# Trou trouvé le 2026-08-21, en préparant une passe de QA sur les écritures non
# latines : `κόσμε,` levait `fts5: syntax error near ","`. Le correctif du 2026-08-20
# ne fermait que sept caractères — la mesure avait été faite sur des tokens découpés à
# l'espace, ce qui excluait par construction `,` `(` `)`, délimiteurs du balayage.
#
# Portée réelle mesurée sur le corpus de travail : 47,9 % des lignes portent une
# virgule, 48,3 % une virgule ou une parenthèse. Coller une ligne du concordancier —
# le geste même qui avait révélé le défaut d'origine — échouait donc une fois sur deux.

@pytest.mark.parametrize("q", [
    "bonjour, le monde",       # prose française
    "il dit, puis se tut",     # une ligne collée du concordancier
    "18,5",                    # un nombre décimal
    "κόσμε,",                  # la même chose en grec
    "chat, chien",
    "le chat (noir) dort",     # parenthèse de prose
    "trois)",                  # parenthèse orpheline
    "(((",                     # rien de cherchable
])
def test_la_virgule_et_la_parenthese_de_prose_ne_font_plus_tomber_la_recherche(
    fts: sqlite3.Connection, q: str
) -> None:
    """RED sur le code du 2026-08-20 : chacun de ces cas levait une OperationalError."""
    _cherche(fts, q)  # ne lève pas


def test_la_virgule_de_prose_reste_cherchable(fts: sqlite3.Connection) -> None:
    """Ne pas lever ne suffit pas : la ligne doit encore être trouvée.

    Le mot porteur devient une phrase — `"Mi,"` — et `unicode61` écarte la ponctuation
    à l'indexation, donc la phrase se réduit au mot. C'est ce qui rend le geste « je
    colle ce que je vois » fidèle.
    """
    assert sanitize_fts_query("Mi, ar face") == '"Mi," ar face'
    assert _cherche(fts, "Mi, ar") == 1


def test_la_virgule_reste_de_la_syntaxe_dans_un_NEAR() -> None:
    """La règle : une virgule n'est syntaxe QUE dans un `NEAR(...)` — et seulement
    celle qui porte la distance.

    La STRUCTURE du groupe est préservée à l'octet près ; ses TERMES, eux, sont
    assainis comme n'importe quel mot (cf. le mode proximité, plus bas).
    """
    assert sanitize_fts_query("NEAR(chat chien, 3)") == "NEAR(chat chien, 3)"
    # …et une virgule de prose à côté d'un NEAR reste, elle, du texte.
    assert sanitize_fts_query("NEAR(a b, 3) AND mot,") == 'NEAR(a b, 3) AND "mot,"'


def test_les_parentheses_restent_de_la_syntaxe_quand_il_y_a_un_operateur() -> None:
    """La règle : une parenthèse n'est syntaxe que si la requête porte un opérateur.

    FTS5 n'accepte les opérateurs qu'en capitales ; c'est ce qui permet de distinguer
    `(chat OR chien)` d'une parenthèse de prose sans rien parser.
    """
    assert sanitize_fts_query("(chat OR chien) AND noir") == "(chat OR chien) AND noir"
    assert sanitize_fts_query("le chat (noir) dort") == 'le chat "(noir)" dort'
    # « or » en minuscules est un mot français, pas un opérateur.
    assert sanitize_fts_query("(chat or chien)") == '"(chat" or "chien)"'


def test_un_NEAR_fautif_remonte_toujours_en_erreur(fts: sqlite3.Connection) -> None:
    """Choix délibéré, et c'est pour lui qu'on n'a PAS pris la voie du repli.

    Assainir après échec aurait tout fait passer, y compris les syntaxes que
    l'utilisateur voulait écrire et a mal écrites : `NEAR()` serait devenu une
    recherche littérale rendant zéro, au lieu d'un message qui parle de la requête.
    """
    with pytest.raises(sqlite3.OperationalError):
        _cherche(fts, "NEAR()")


# --- le mode « proximité » du concordancier -------------------------------------
#
# Trouvé le 2026-08-21 en passe adverse, en cherchant qui d'autre fabrique une requête
# FTS. `tauri-app/src/features/search.ts` en fabrique : le mode proximité construit
# `NEAR(<mots collés à l'espace>, N)` à partir de la saisie brute, sans rien assainir.
# Tant que le moteur traitait un `NEAR(...)` comme un bloc opaque, ce mode tombait sur
# `peut-être` et `l'homme` — deux mots français des plus courants.
#
# Le correctif tient dans la distinction structure/termes : le front n'a pas eu à
# changer, et tout autre client (CLI, script) en profite du même coup.

@pytest.mark.parametrize("saisie", [
    "dit, puis",        # une virgule dans un terme
    "peut-être bien",   # un trait d'union
    "l'homme libre",    # une apostrophe
    "18:30 heures",     # deux-points
    "chat chien",       # le cas déjà sain, qui ne doit pas bouger
])
def test_le_mode_proximite_survit_a_la_ponctuation(
    fts: sqlite3.Connection, saisie: str
) -> None:
    """RED sur le code du matin : chacun levait une OperationalError.

    On reconstruit ici exactement ce que le front envoie — `tokens.join(" ")` entre
    `NEAR(` et `, N)` — plutôt que d'imaginer la requête.
    """
    _cherche(fts, f"NEAR({' '.join(saisie.split())}, 2)")  # ne lève pas


def test_le_mode_proximite_trouve_vraiment(fts: sqlite3.Connection) -> None:
    """Ne pas lever ne suffit pas : le terme ponctué doit rester cherchable."""
    assert sanitize_fts_query("NEAR(Mi, ar, 3)") == 'NEAR("Mi," ar, 3)'
    assert _cherche(fts, "NEAR(Mi, ar, 3)") == 1


def test_la_borne_de_distance_ne_bouge_pas() -> None:
    """La seule virgule de syntaxe d'un groupe est celle qui porte la distance ; et
    un `NEAR(...)` sans distance est une forme valide qu'il ne faut pas mutiler."""
    assert sanitize_fts_query("NEAR(chat chien, 3)") == "NEAR(chat chien, 3)"
    assert sanitize_fts_query("NEAR(chat chien)") == "NEAR(chat chien)"
    assert sanitize_fts_query("NEAR(a b, 2) OR NEAR(c d, 2)") == "NEAR(a b, 2) OR NEAR(c d, 2)"


@pytest.mark.parametrize("q", ["near(the door)", "Near(the door)"])
def test_near_en_minuscules_est_un_mot_et_non_un_operateur(
    fts: sqlite3.Connection, q: str
) -> None:
    """FTS5 n'accepte ses opérateurs qu'en capitales, et `near` est un mot anglais
    courant. Le reconnaître sans tenir compte de la casse faisait tomber la recherche
    — le défaut même que ce module ferme."""
    _cherche(fts, q)  # ne lève pas
    assert sanitize_fts_query(q).startswith('"')


def test_un_groupe_que_le_motif_ne_reconnait_pas_reste_une_erreur(
    fts: sqlite3.Connection,
) -> None:
    """`NEAR(a (b), 3)` n'est pas une forme valide ; la faire passer en la réécrivant
    masquerait une intention mal écrite au lieu de la signaler."""
    with pytest.raises(sqlite3.OperationalError):
        _cherche(fts, "NEAR(a (b), 3)")


def test_les_operateurs_ne_sont_pas_surlignes_comme_des_termes() -> None:
    """Défaut antérieur, trouvé en passe adverse le 2026-08-21.

    Il ne se voyait guère en français — « and », « or », « near » n'y sont pas des
    mots — et crevait les yeux en anglais : chaque « and » du segment était marqué
    comme un résultat, et le chiffre de la distance `NEAR(…, 3)` avec.
    """
    from multicorpus_engine.query import _highlight_segment

    texte = "the cat and the dog, near the door"
    assert _highlight_segment(texte, "cat AND dog") == "the <<cat>> and the <<dog>>, near the door"
    assert _highlight_segment(texte, "NEAR(cat dog, 3)") == "the <<cat>> and the <<dog>>, near the door"
    # …et la distance ne doit pas marquer les chiffres du texte.
    assert "<<2>>" not in _highlight_segment("il y a 2 chats", "NEAR(chat chien, 2)")


def test_le_surlignage_reconnait_les_operateurs_en_CAPITALES_seulement() -> None:
    """Sinon on n'affiche plus les résultats d'une recherche sur le mot « or » ou
    « near », qui sont des mots ordinaires en français comme en anglais."""
    from multicorpus_engine.query import _highlight_segment

    assert _highlight_segment("l'or et l'argent", "or") == "l'<<or>> et l'argent"
    assert _highlight_segment("he sat near me", "near") == "he sat <<near>> me"
