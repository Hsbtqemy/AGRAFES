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
    spec_from_dict,
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


# --- spec_from_dict : porte d'entrée des endpoints ---------------------------


def test_spec_from_dict_full_terminator() -> None:
    spec = spec_from_dict({
        "kind": "terminator",
        "terminators": ".!?;:",
        "require_uppercase_after": False,
        "protect_abbreviations": ["cf", "etc"],
        "label": "clauses",
    })
    assert spec == SegmentSpec(
        kind="terminator",
        terminators=".!?;:",
        require_uppercase_after=False,
        protect_abbreviations=("cf", "etc"),
        label="clauses",
    )


def test_spec_from_dict_defaults_and_coercion() -> None:
    # Minimal payload → the SegmentSpec defaults; abbrevs coerced to a str tuple.
    spec = spec_from_dict({"kind": "whitespace"})
    assert spec.kind == "whitespace"
    assert spec.terminators == ".!?" and spec.require_uppercase_after is True
    assert spec.protect_abbreviations == () and spec.label == "custom"


def test_spec_from_dict_null_terminators_falls_back_not_stringified() -> None:
    # Explicit null → default (NOT the literal "None"); explicit "" is preserved.
    assert spec_from_dict({"kind": "terminator", "terminators": None}).terminators == ".!?"
    assert spec_from_dict({"kind": "terminator", "require_uppercase_after": None}).require_uppercase_after is True
    assert spec_from_dict({"kind": "terminator", "terminators": ""}).terminators == ""


def test_spec_from_dict_rejects_bad_kind_and_shape() -> None:
    with pytest.raises(ValueError):
        spec_from_dict({"kind": "verlan"})
    with pytest.raises(ValueError):
        spec_from_dict({"protect_abbreviations": "cf"})  # must be a list
    with pytest.raises(ValueError):
        spec_from_dict("nope")  # must be an object
