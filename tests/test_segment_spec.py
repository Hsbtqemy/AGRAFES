"""R5.4a — SegmentSpec (segmentation configurable), fonctions pures.

Filet back-compat (le découpage historique reste byte-identique) + nouveaux modes
(mots, marqueurs, accumulation de terminateurs) + l'interaction terminateurs ⇄
require_uppercase_after (les 3 cas canoniques du ticket).
"""

from __future__ import annotations

import pytest

from multicorpus_engine.segmenter import (
    SegmentSpec,
    _MARKERS_SPEC,
    resegment_document,
    resolve_preset,
    segment_text,
    split_unit_text,
)


# --- Back-compat : segment_text inchangé (préréglage « phrases ») ------------


def test_segment_text_backcompat_default() -> None:
    text = "First sentence. Second one! Third?"
    assert segment_text(text, lang="en") == ["First sentence.", "Second one!", "Third?"]


def test_segment_text_backcompat_abbrev_and_decimal() -> None:
    # M. protégé (base), décimales protégées — aucune coupe erronée.
    assert segment_text("M. Dupont arrive. Pi vaut 3.14 ici. Fin.", lang="fr") == [
        "M. Dupont arrive.",
        "Pi vaut 3.14 ici.",
        "Fin.",
    ]


# --- Préréglages -------------------------------------------------------------


def test_resolve_preset_phrases_carries_lang_abbreviations() -> None:
    fr = resolve_preset("phrases", "fr")
    assert fr.kind == "terminator"
    assert "chap" in fr.protect_abbreviations
    assert fr.label == "fr_strict"
    de = resolve_preset("phrases", "de")
    assert de.protect_abbreviations == ()
    assert de.label == "default"


def test_resolve_preset_mots_and_balises() -> None:
    assert resolve_preset("mots").kind == "whitespace"
    assert resolve_preset("balises").kind == "markers"


def test_resolve_preset_rejects_unknown() -> None:
    with pytest.raises(ValueError):
        resolve_preset("verlan")


# --- split_unit_text : les kinds ---------------------------------------------


def test_split_words_whitespace() -> None:
    segs = split_unit_text("le chat  noir", resolve_preset("mots"))
    assert segs == [(None, "le"), (None, "chat"), (None, "noir")]


def test_split_markers_external_ids() -> None:
    segs = split_unit_text("[1] Bonjour [2] Monde", resolve_preset("balises"))
    assert segs == [(1, "Bonjour"), (2, "Monde")]


# --- Accumulation de terminateurs × require_uppercase_after ------------------
# Les 3 cas canoniques du ticket.

_CLAUSE = "Il pleut ; il fait froid : rentrons. La suite."


def test_accumulation_case1_phrases_default() -> None:
    # (1) .!? + majuscule exigée = comportement actuel — ne coupe pas sur ; ni :
    spec = SegmentSpec(kind="terminator", terminators=".!?", require_uppercase_after=True)
    segs = [s for _, s in split_unit_text(_CLAUSE, spec)]
    assert segs == ["Il pleut ; il fait froid : rentrons.", "La suite."]


def test_accumulation_case2_clauses_split_when_uppercase_off() -> None:
    # (2) .!?;: + majuscule OFF → coupe bien sur ; et :
    spec = SegmentSpec(kind="terminator", terminators=".!?;:", require_uppercase_after=False)
    segs = [s for _, s in split_unit_text(_CLAUSE, spec)]
    assert segs == ["Il pleut ;", "il fait froid :", "rentrons.", "La suite."]


def test_accumulation_case3_clauses_suppressed_by_uppercase() -> None:
    # (3) le MÊME .!?;: mais majuscule exigée → ne coupe PAS sur ; : (minuscule après)
    spec = SegmentSpec(kind="terminator", terminators=".!?;:", require_uppercase_after=True)
    segs = [s for _, s in split_unit_text(_CLAUSE, spec)]
    assert segs == ["Il pleut ; il fait froid : rentrons.", "La suite."]


# --- Robustesse (passe adverse) ----------------------------------------------


def test_terminator_empty_is_single_segment_no_crash() -> None:
    # Aucun caractère de coupe → un seul segment (pas de classe regex vide `[]`).
    spec = SegmentSpec(kind="terminator", terminators="")
    assert split_unit_text("Bonjour. Salut.", spec) == [(None, "Bonjour. Salut.")]


def test_resegment_document_rejects_markers_spec() -> None:
    # Le garde-fou se déclenche avant de toucher la connexion (conn=None ici).
    with pytest.raises(ValueError):
        resegment_document(None, 1, spec=_MARKERS_SPEC)
