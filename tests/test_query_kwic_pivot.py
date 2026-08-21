"""Le pivot KWIC doit retrouver ce que FTS a apparié, pas une chaîne littérale.

Mesuré le 2026-08-21 sur le corpus de travail, sur 25 lignes trouvées par requête :
``dit-il`` rendait 25 pivots vides sur 25, ``peut-être`` 25 sur 25, ``c'est-à-dire``
18 sur 18, ``libr*`` 25 sur 25. Autrement dit, toutes les capacités avancées de la
recherche avaient une concordance sans centre — et le mode Segment, lui, surlignait.
Le partage venait de ce que le surlignage cherche des MOTS quand le pivot cherchait
la chaîne brute de la requête assainie.

Le pivot vide n'était pas une colonne blanche : ``_kwic_windows`` retournait alors
``(texte, "", "")``, soit l'unité entière versée dans la colonne gauche. Le corpus
porte 12 documents stockés en une seule unité, dont un de 110 786 caractères.
"""

from multicorpus_engine.query import (
    _all_kwic_windows,
    _highlight_segment,
    _kwic_windows,
    sanitize_fts_query,
)

_TEXTE = "Bonjour, dit - il, le monde est peut - être libre."


def _pivot(saisie: str, texte: str = _TEXTE, window: int = 4) -> str:
    return _kwic_windows(texte, sanitize_fts_query(saisie), window)[1]


def test_le_trait_dunion_espace_du_corpus_donne_un_pivot() -> None:
    """48 documents portent « dit - il » ; la requête, elle, s'écrit « dit-il »."""
    assert _pivot("dit-il") == "dit - il"
    assert _pivot("peut-être") == "peut - être"


def test_le_pivot_couvre_la_locution_entiere() -> None:
    """Une concordance doit centrer sur ce qu'on a cherché, pas sur son premier mot.

    Le contexte droit reprend APRÈS la locution : découper à `début + 1` aurait
    répété « - il » dans la colonne de droite.
    """
    gauche, pivot, droite = _kwic_windows(_TEXTE, sanitize_fts_query("dit-il"), 3)
    assert pivot == "dit - il"
    assert "il" not in droite.split()
    assert droite.startswith("le monde")
    assert gauche == "Bonjour,"


def test_le_prefixe_reste_un_prefixe() -> None:
    r"""`libr*` était échappé en `libr\*` et cherché avec son astérisque."""
    assert _pivot("libr*") == "libre"


def test_les_operateurs_ne_sont_pas_des_termes() -> None:
    """`homme OR femme` centrait la concordance sur le « or » français."""
    assert _pivot("monde AND libre") == "monde"
    assert _pivot("NEAR(monde libre, 5)") == "monde"
    texte = "or, il advint que le monde changea"
    assert _kwic_windows(texte, sanitize_fts_query("monde OR ciel"), 3)[1] == "monde"


def test_lelision_ne_surligne_plus_toutes_les_lettres() -> None:
    r"""`\w+` sur « l'homme » produit l'article élidé comme terme d'une lettre.

    Sans borne de mot, l'alternance `(l|homme)` marquait tous les `l` du texte :
    ``<<l>>'<<homme>> <<l>>ibre par<<l>>e``. L'élision est partout en français.
    """
    texte = "l'homme libre parle : le cheval galope, elle l'a vu."
    marque = _highlight_segment(texte, sanitize_fts_query("l'homme"))
    assert marque == "<<l'homme>> libre parle : le cheval galope, elle l'a vu."


def test_lapostrophe_courbe_cesse_detre_un_cas_a_part() -> None:
    """La locution sépare ses mots par du non-mot : `'` et `’` s'y valent."""
    assert _pivot("l'homme", "voici l’homme et son chien") == "l’homme"


def test_le_repli_est_borne() -> None:
    """Le repli historique versait le texte ENTIER dans la colonne gauche."""
    texte = " ".join(f"mot{i}" for i in range(5_000))
    gauche, pivot, droite = _kwic_windows(texte, sanitize_fts_query("absent"), 6)
    assert pivot == "" and droite == ""
    assert len(gauche.split()) == 12
    assert len(gauche) < len(texte) / 100


def test_le_repli_borne_aussi_une_ecriture_sans_espaces() -> None:
    r"""Compter les tokens ne borne rien quand le texte n'en a qu'un.

    Trouvé en passe adverse sur mon propre correctif : `\S+` rend UN token sur du
    chinois, donc « douze tokens » y valaient 80 000 caractères là où le même texte
    latin en valait 47 — la borne manquait exactement les écritures que la passe de QA
    sur la ponctuation cherche à protéger.
    """
    chinois = "你好世界" * 20_000
    gauche, pivot, droite = _kwic_windows(chinois, sanitize_fts_query("absent"), 6)
    assert (pivot, droite) == ("", "")
    assert len(gauche) == 500
    # Un texte court n'est pas tronqué pour autant.
    assert _kwic_windows("un texte court", sanitize_fts_query("absent"), 6)[0] == (
        "un texte court"
    )


def test_la_requete_sans_aucun_mot_ne_rend_pas_le_texte_entier() -> None:
    """Branche « aucun terme » : que des opérateurs, ou que de la ponctuation.

    INATTEIGNABLE par `/query` — sans mot dans la requête, FTS n'apparie rien non plus :
    il refuse la syntaxe (`AND`) ou rend zéro ligne (`« »`, `—`, `،`), et KWIC n'est
    alors jamais appelé. Elle rendait le texte entier dans le PIVOT ; j'avais borné
    l'autre repli et laissé celle-ci intacte.
    """
    texte = "un texte de deux cents mots " * 40
    gauche, pivot, droite = _kwic_windows(texte, "« »", 5)
    assert pivot == "" and droite == ""
    assert len(gauche) <= 500


def test_toutes_occurrences_ne_perd_jamais_lunite() -> None:
    """Une liste vide faisait disparaître l'unité des résultats.

    `_build_hits_core` itère sur les occurrences : zéro occurrence, zéro hit ajouté,
    alors que FTS avait apparié la ligne et que le total la comptait. La variante
    regex avait ce repli, la variante FTS ne l'avait pas.
    """
    assert _all_kwic_windows("rien ici", sanitize_fts_query("absent"), 3) == [
        ("rien ici", "", "")
    ]
    toutes = _all_kwic_windows(_TEXTE, sanitize_fts_query("dit-il"), 3)
    assert [m for _, m, _ in toutes] == ["dit - il"]


def test_le_mot_simple_ne_regresse_pas() -> None:
    assert _pivot("monde") == "monde"
    gauche, pivot, droite = _kwic_windows(_TEXTE, sanitize_fts_query("monde"), 2)
    assert (gauche, pivot, droite) == ("il, le", "monde", "est peut")
