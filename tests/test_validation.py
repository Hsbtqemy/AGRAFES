"""Unit tests for the declarative structural validator (audit A-03, phase 1).

Pure unit tests — no sidecar subprocess, no DB. Cover every Field facet:
presence/required, type, enum, numeric & length bounds, int coercion, defaults,
strip, error-class selection, fail-fast, and the two proof-endpoint schemas.
"""

from __future__ import annotations

import pytest

from multicorpus_engine.services.errors import BadRequestError, ValidationError
from multicorpus_engine.services.validation import Field, validate


# ─── required / presence ──────────────────────────────────────────────────────

def test_required_missing_message():
    with pytest.raises(ValidationError) as e:
        validate({}, (Field("name", str),))
    assert e.value.message == "name is required"


def test_required_present_ok():
    assert validate({"name": "x"}, (Field("name", str),)) == {"name": "x"}


def test_required_null_is_treated_as_missing():
    with pytest.raises(ValidationError) as e:
        validate({"name": None}, (Field("name", str),))
    assert e.value.message == "name is required"


def test_optional_absent_no_default_is_omitted():
    assert validate({}, (Field("x", str, required=False),)) == {}


def test_optional_absent_with_default_injects_default():
    assert validate({}, (Field("x", bool, required=False, default=False),)) == {"x": False}


def test_optional_present_overrides_default():
    assert validate({"x": True}, (Field("x", bool, required=False, default=False),)) == {"x": True}


def test_optional_present_null_is_type_checked():
    # Regression (A-03 review): a *present* null on an optional field is NOT
    # "absent" — it is type-checked and rejected, matching the legacy
    # `if "x" in body and not isinstance(...)` guard (e.g. /index incremental).
    with pytest.raises(ValidationError) as e:
        validate(
            {"incremental": None},
            (Field("incremental", bool, required=False, default=False),),
        )
    assert e.value.message == "incremental must be a boolean"


# ─── strip (required non-blank string) ────────────────────────────────────────

def test_strip_trims_value():
    assert validate({"name": "  x  "}, (Field("name", str, strip=True),)) == {"name": "x"}


def test_strip_blank_required_is_required():
    with pytest.raises(ValidationError) as e:
        validate({"name": "   "}, (Field("name", str, strip=True),))
    assert e.value.message == "name is required"


def test_no_strip_keeps_whitespace():
    assert validate({"name": "  x  "}, (Field("name", str),)) == {"name": "  x  "}


# ─── type ─────────────────────────────────────────────────────────────────────

def test_type_bool_rejects_string():
    with pytest.raises(ValidationError) as e:
        validate({"incremental": "yes"}, (Field("incremental", bool),))
    assert e.value.message == "incremental must be a boolean"


def test_type_str_rejects_int():
    with pytest.raises(ValidationError) as e:
        validate({"name": 123}, (Field("name", str),))
    assert e.value.message == "name must be a string"


def test_type_int_rejects_string():
    with pytest.raises(ValidationError) as e:
        validate({"n": "x"}, (Field("n", int),))
    assert e.value.message == "n must be an integer"


def test_type_int_accepts_bool_like_isinstance():
    # bool is a subclass of int — matches the legacy `isinstance(x, int)` behavior.
    assert validate({"n": True}, (Field("n", int),)) == {"n": True}


def test_type_bool_rejects_int():
    with pytest.raises(ValidationError) as e:
        validate({"b": 1}, (Field("b", bool),))
    assert e.value.message == "b must be a boolean"


def test_type_tuple_accepts_either():
    assert validate({"n": 1.5}, (Field("n", (int, float)),)) == {"n": 1.5}
    assert validate({"n": 3}, (Field("n", (int, float)),)) == {"n": 3}


def test_type_object_skips_check():
    assert validate({"x": [1, 2]}, (Field("x"),)) == {"x": [1, 2]}


# ─── enum ─────────────────────────────────────────────────────────────────────

def test_enum_member_ok():
    assert validate({"s": "a"}, (Field("s", str, enum=("a", "b")),)) == {"s": "a"}


def test_enum_non_member_rejected():
    with pytest.raises(ValidationError) as e:
        validate({"s": "z"}, (Field("s", str, enum=("a", "b")),))
    assert e.value.message == "s must be one of: a, b"


# ─── numeric bounds ───────────────────────────────────────────────────────────

def test_numeric_within_bounds():
    assert validate({"n": 5}, (Field("n", int, min=1, max=10),)) == {"n": 5}


def test_numeric_below_min():
    with pytest.raises(ValidationError) as e:
        validate({"n": 0}, (Field("n", int, min=1),))
    assert e.value.message == "n must be >= 1"


def test_numeric_above_max():
    with pytest.raises(ValidationError) as e:
        validate({"n": 11}, (Field("n", int, max=10),))
    assert e.value.message == "n must be <= 10"


# ─── string length bounds ─────────────────────────────────────────────────────

def test_str_length_within():
    assert validate({"s": "abc"}, (Field("s", str, min=2, max=5),)) == {"s": "abc"}


def test_str_too_short():
    with pytest.raises(ValidationError) as e:
        validate({"s": "a"}, (Field("s", str, min=2),))
    assert e.value.message == "s must be >= 2 characters"


def test_str_too_long():
    with pytest.raises(ValidationError) as e:
        validate({"s": "abcdef"}, (Field("s", str, max=5),))
    assert e.value.message == "s must be <= 5 characters"


# ─── coercion ─────────────────────────────────────────────────────────────────

def test_coerce_string_to_int():
    assert validate({"id": "5"}, (Field("id", int, coerce=True),)) == {"id": 5}


def test_coerce_passthrough_int():
    assert validate({"id": 5}, (Field("id", int, coerce=True),)) == {"id": 5}


def test_coerce_invalid_message():
    with pytest.raises(ValidationError) as e:
        validate({"id": "abc"}, (Field("id", int, coerce=True),))
    assert e.value.message == "id must be an integer"


def test_coerce_then_bounds():
    assert validate({"id": "5"}, (Field("id", int, coerce=True, min=1, max=10),)) == {"id": 5}
    with pytest.raises(ValidationError) as e:
        validate({"id": "0"}, (Field("id", int, coerce=True, min=1),))
    assert e.value.message == "id must be >= 1"


# ─── error-class selection ────────────────────────────────────────────────────

def test_error_class_bad_request():
    with pytest.raises(BadRequestError) as e:
        validate({}, (Field("x", str, error=BadRequestError),))
    assert e.value.message == "x is required"
    # BadRequestError is NOT a ValidationError subclass.
    assert not isinstance(e.value, ValidationError)


# ─── body shape / fail-fast / projection ──────────────────────────────────────

def test_body_not_a_mapping():
    with pytest.raises(ValidationError) as e:
        validate([1, 2], (Field("a"),))  # type: ignore[arg-type]
    assert e.value.message == "body must be an object"


def test_where_in_not_a_mapping_message():
    with pytest.raises(ValidationError) as e:
        validate("nope", (Field("a"),), where="query")  # type: ignore[arg-type]
    assert e.value.message == "query must be an object"


def test_fail_fast_first_field():
    with pytest.raises(ValidationError) as e:
        validate({}, (Field("a", str), Field("b", str)))
    assert e.value.message == "a is required"


def test_non_schema_keys_not_copied():
    assert validate({"a": "x", "extra": 1}, (Field("a", str),)) == {"a": "x"}


# ─── proof-endpoint schemas (phase 1) ─────────────────────────────────────────

_INDEX_SCHEMA = (Field("incremental", bool, required=False, default=False),)


def test_proof_index_default():
    assert validate({}, _INDEX_SCHEMA) == {"incremental": False}


def test_proof_index_explicit():
    assert validate({"incremental": True}, _INDEX_SCHEMA) == {"incremental": True}


def test_proof_index_bad_type():
    with pytest.raises(ValidationError):
        validate({"incremental": "yes"}, _INDEX_SCHEMA)


def test_proof_index_explicit_null_rejected():
    # Byte-identical with the legacy handler: {"incremental": null} -> error.
    with pytest.raises(ValidationError):
        validate({"incremental": None}, _INDEX_SCHEMA)


_CONV_SCHEMA = (Field("name", str, strip=True), Field("label", str, strip=True))


def test_proof_conventions_ok():
    assert validate({"name": "x", "label": "y"}, _CONV_SCHEMA) == {"name": "x", "label": "y"}


def test_proof_conventions_missing_name():
    with pytest.raises(ValidationError) as e:
        validate({"label": "y"}, _CONV_SCHEMA)
    assert e.value.message == "name is required"
