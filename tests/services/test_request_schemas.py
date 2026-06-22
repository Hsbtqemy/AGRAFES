"""Unit tests for the ``Field → JSON Schema`` generator (audit A-03B).

Pure unit tests — no sidecar subprocess, no DB. Two concerns:

1. **Pilot byte-identity**: deriving ``IndexRequest`` from ``INDEX_SCHEMA`` must
   reproduce the historical hand-written schema exactly (the contract-freeze gate).
2. **Generator facets**: every mapping rule (type / required / enum / bounds /
   items / nullable / default toggle / description / additionalProperties 3-state)
   maps a ``Field`` to the expected JSON Schema fragment.

Plus: ``Field.description`` is pure metadata — ``validate()`` must ignore it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from multicorpus_engine.services.errors import ValidationError
from multicorpus_engine.services.request_schemas import (
    INDEX_SCHEMA,
    field_schema_to_openapi,
)
from multicorpus_engine.services.validation import Field, validate


# ─── Pilot: /index byte-identity ──────────────────────────────────────────────

EXPECTED_INDEX_REQUEST = {
    "type": "object",
    "properties": {
        "incremental": {
            "type": "boolean",
            "description": (
                "If true, runs incremental FTS sync (insert/refresh/prune) "
                "instead of full rebuild."
            ),
        },
    },
    "additionalProperties": False,
}


def test_index_schema_derives_historical_index_request():
    derived = field_schema_to_openapi(
        INDEX_SCHEMA, additional_properties=False, include_default=False
    )
    assert derived == EXPECTED_INDEX_REQUEST


def test_derived_index_request_matches_live_spec():
    from multicorpus_engine.sidecar_contract import openapi_spec

    spec = openapi_spec()
    assert spec["components"]["schemas"]["IndexRequest"] == EXPECTED_INDEX_REQUEST


def test_derived_index_request_matches_committed_openapi_json():
    """The frozen docs/openapi.json must carry exactly the derived schema."""
    repo_root = Path(__file__).resolve().parents[2]
    committed = json.loads((repo_root / "docs" / "openapi.json").read_text(encoding="utf-8"))
    assert committed["components"]["schemas"]["IndexRequest"] == EXPECTED_INDEX_REQUEST


# ─── type mapping ─────────────────────────────────────────────────────────────

def test_scalar_types_map_to_json_names():
    schema = (
        Field("b", bool, required=False),
        Field("s", str, required=False),
        Field("i", int, required=False),
        Field("f", float, required=False),
        Field("d", dict, required=False),
        Field("a", list, required=False),
    )
    props = field_schema_to_openapi(schema)["properties"]
    assert props["b"] == {"type": "boolean"}
    assert props["s"] == {"type": "string"}
    assert props["i"] == {"type": "integer"}
    assert props["f"] == {"type": "number"}
    assert props["d"] == {"type": "object"}
    assert props["a"] == {"type": "array"}


def test_object_sentinel_emits_no_type_key():
    # ``object`` is the validator's "no type check" default → presence-only field.
    props = field_schema_to_openapi((Field("x", required=False),))["properties"]
    assert props["x"] == {}
    assert "type" not in props["x"]


def test_tuple_type_emits_oneof_union():
    props = field_schema_to_openapi(
        (Field("x", (int, float), required=False),)
    )["properties"]
    assert props["x"] == {"oneOf": [{"type": "integer"}, {"type": "number"}]}


def test_tuple_type_collapsing_to_one_known_name_is_bare_type():
    # A tuple where only one member is a known JSON type collapses to a plain type.
    props = field_schema_to_openapi(
        (Field("x", (str, object), required=False),)
    )["properties"]
    assert props["x"] == {"type": "string"}


# ─── required ─────────────────────────────────────────────────────────────────

def test_required_fields_listed_optionals_excluded():
    schema = (
        Field("a", str, required=True),
        Field("b", str, required=False),
        Field("c", int, required=True),
    )
    out = field_schema_to_openapi(schema)
    assert out["required"] == ["a", "c"]


def test_empty_required_array_is_omitted():
    out = field_schema_to_openapi((Field("a", str, required=False),))
    assert "required" not in out


# ─── enum / bounds / items / nullable ─────────────────────────────────────────

def test_enum_emitted_as_list():
    props = field_schema_to_openapi(
        (Field("mode", str, required=False, enum=("kwic", "segment")),)
    )["properties"]
    assert props["mode"]["enum"] == ["kwic", "segment"]


def test_numeric_bounds_map_to_minimum_maximum():
    props = field_schema_to_openapi(
        (Field("n", int, required=False, min=1, max=200),)
    )["properties"]
    assert props["n"]["minimum"] == 1
    assert props["n"]["maximum"] == 200
    assert "minLength" not in props["n"]


def test_string_bounds_map_to_min_max_length():
    props = field_schema_to_openapi(
        (Field("s", str, required=False, min=1, max=64),)
    )["properties"]
    assert props["s"]["minLength"] == 1
    assert props["s"]["maxLength"] == 64
    assert "minimum" not in props["s"]


def test_list_bounds_map_to_min_max_items():
    props = field_schema_to_openapi(
        (Field("xs", list, required=False, min=1, max=10),)
    )["properties"]
    assert props["xs"]["minItems"] == 1
    assert props["xs"]["maxItems"] == 10


def test_dict_bounds_map_to_min_max_properties():
    props = field_schema_to_openapi(
        (Field("m", dict, required=False, min=1),)
    )["properties"]
    assert props["m"]["minProperties"] == 1


def test_items_element_type_emitted():
    props = field_schema_to_openapi(
        (Field("ids", list, required=False, items=int),)
    )["properties"]
    assert props["ids"]["items"] == {"type": "integer"}


def test_nullable_emits_nullable_true():
    props = field_schema_to_openapi(
        (Field("note", str, required=False, nullable=True),)
    )["properties"]
    assert props["note"]["nullable"] is True


# ─── default toggle ───────────────────────────────────────────────────────────

def test_default_dropped_when_include_default_false():
    props = field_schema_to_openapi(
        (Field("x", bool, required=False, default=False),)
    )["properties"]
    assert "default" not in props["x"]


def test_default_emitted_when_include_default_true():
    props = field_schema_to_openapi(
        (Field("x", bool, required=False, default=False),),
        include_default=True,
    )["properties"]
    assert props["x"]["default"] is False


def test_default_not_emitted_when_unset_even_if_toggled():
    # A Field that declares no default stays default-less even with the toggle on.
    props = field_schema_to_openapi(
        (Field("x", bool, required=False),),
        include_default=True,
    )["properties"]
    assert "default" not in props["x"]


# ─── description ──────────────────────────────────────────────────────────────

def test_description_emitted_when_set():
    props = field_schema_to_openapi(
        (Field("x", bool, required=False, description="hello"),)
    )["properties"]
    assert props["x"]["description"] == "hello"


def test_description_omitted_when_none():
    props = field_schema_to_openapi((Field("x", bool, required=False),))["properties"]
    assert "description" not in props["x"]


# ─── additionalProperties — 3-state author choice ─────────────────────────────

def test_additional_properties_false_emitted():
    out = field_schema_to_openapi((Field("x", str, required=False),), additional_properties=False)
    assert out["additionalProperties"] is False


def test_additional_properties_true_emitted():
    out = field_schema_to_openapi((Field("x", str, required=False),), additional_properties=True)
    assert out["additionalProperties"] is True


def test_additional_properties_none_omits_key():
    out = field_schema_to_openapi((Field("x", str, required=False),), additional_properties=None)
    assert "additionalProperties" not in out


# ─── Field.description is pure metadata (validate ignores it) ──────────────────

def test_description_does_not_affect_validation_success():
    plain = validate({"x": True}, (Field("x", bool, required=False),))
    described = validate(
        {"x": True}, (Field("x", bool, required=False, description="doc"),)
    )
    assert plain == described == {"x": True}


def test_description_does_not_affect_validation_error():
    with pytest.raises(ValidationError) as e:
        validate({"x": "no"}, (Field("x", bool, required=False, description="doc"),))
    assert e.value.message == "x must be a boolean"
