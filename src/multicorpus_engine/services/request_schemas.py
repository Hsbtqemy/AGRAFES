"""Canonical request schemas + ``Field → JSON Schema`` generator (audit A-03B).

A **single source** for both the structural validator and the OpenAPI contract.
A request schema is declared once as a tuple of :class:`~.validation.Field`; the
handler feeds it to :func:`~.validation.validate` while ``sidecar_contract`` feeds
it to :func:`field_schema_to_openapi` to build the ``requestBody`` JSON Schema —
so validation and documentation can never drift.

Coupling is **unidirectional**: ``sidecar_contract`` (contract) depends on this
module, which depends on ``validation`` (the validator). The validator never
imports the contract — no cycle. ``_TYPE_NAMES`` / ``_UNSET`` are reused from
``validation`` on purpose (they are the validator's authoritative type map and
"absent" sentinel).

Scope = **pilot** (A-03B): only ``/index`` is derived today. Extending to other
endpoints is explicitly gated on first **completing + typing** their ``Field``
schemas — a derivation only stays byte-identical when the ``Field`` carries the
*complete* field list and a *concrete* type (a presence-only / partial schema
would silently drop ``type`` or whole properties from the contract). See the
ticket ``docs/TICKET_A03B_OPENAPI_FROM_FIELD.md`` §4.
"""

from __future__ import annotations

from typing import Any, Sequence

from .validation import _TYPE_NAMES, _UNSET, Field


def _apply_type(prop: dict[str, Any], t: type | tuple[type, ...]) -> None:
    """Emit the OpenAPI ``type`` (or ``oneOf`` union) for a Field's declared type.

    ``object`` is the validator's "no type check" sentinel — it emits no ``type``
    key (matching hand-written schemas that omit it for presence-only fields).
    A single python type maps via ``_TYPE_NAMES``; a tuple becomes ``oneOf`` (or a
    bare ``type`` when it collapses to one known name) since OpenAPI 3.0 has no
    type-array.
    """
    if isinstance(t, tuple):
        names = [name for name in (_TYPE_NAMES.get(x) for x in t) if name]
        if len(names) == 1:
            prop["type"] = names[0]
        elif names:
            prop["oneOf"] = [{"type": name} for name in names]
        return
    if t is object:
        return
    name = _TYPE_NAMES.get(t)
    if name is not None:
        prop["type"] = name


def _bounds_keys(t: type | tuple[type, ...]) -> tuple[str, str]:
    """``(min_key, max_key)`` chosen by the Field's declared type.

    Mirrors how ``validate()`` interprets ``min``/``max`` at runtime: a length
    bound for ``str``, a size bound for ``list``/``dict``, else a numeric bound.
    """
    if t is str:
        return "minLength", "maxLength"
    if t is list or (isinstance(t, tuple) and list in t):
        return "minItems", "maxItems"
    if t is dict:
        return "minProperties", "maxProperties"
    return "minimum", "maximum"


def field_schema_to_openapi(
    schema: Sequence[Field],
    *,
    additional_properties: bool | None = False,
    include_default: bool = False,
) -> dict[str, Any]:
    """Build an OpenAPI ``object`` JSON Schema from a ``Field`` tuple.

    ``additional_properties`` is a **3-state author choice**, NOT derived from the
    validator's (permissive) semantics: ``False``/``True`` emit the key, ``None``
    omits it — so the output can match either a strict (``additionalProperties:
    false``) or a key-omitting hand-written schema byte-for-byte.

    ``include_default`` toggles emission of ``default`` (when the Field declares
    one): off by default because several existing schemas document the field
    without a ``default`` and must stay byte-identical; turn it on to document the
    default and regenerate the freeze.
    """
    properties: dict[str, Any] = {}
    required: list[str] = []
    for f in schema:
        prop: dict[str, Any] = {}
        _apply_type(prop, f.type)
        if f.enum is not None:
            prop["enum"] = list(f.enum)
        if f.min is not None or f.max is not None:
            min_key, max_key = _bounds_keys(f.type)
            if f.min is not None:
                prop[min_key] = f.min
            if f.max is not None:
                prop[max_key] = f.max
        if f.items is not None:
            item_name = None if isinstance(f.items, tuple) else _TYPE_NAMES.get(f.items)
            prop["items"] = {"type": item_name} if item_name else {}
        if f.nullable:
            prop["nullable"] = True
        if include_default and f.default is not _UNSET:
            prop["default"] = f.default
        if f.description is not None:
            prop["description"] = f.description
        properties[f.name] = prop
        if f.required:
            required.append(f.name)

    out: dict[str, Any] = {"type": "object", "properties": properties}
    if required:  # omit the empty array to match the existing hand-written schemas
        out["required"] = required
    if additional_properties is not None:
        out["additionalProperties"] = additional_properties
    return out


# ─── Canonical request schemas (single source: handler + contract) ────────────

# POST /index — the A-03B pilot. The lone field is fully typed (``bool``) and the
# schema is complete, so `field_schema_to_openapi(INDEX_SCHEMA,
# additional_properties=False, include_default=False)` reproduces the historical
# `IndexRequest` byte-for-byte (default dropped via the toggle; description carried
# on the Field). `_handle_index` validates against this exact same tuple.
INDEX_SCHEMA: tuple[Field, ...] = (
    Field(
        "incremental",
        bool,
        required=False,
        default=False,
        description=(
            "If true, runs incremental FTS sync (insert/refresh/prune) "
            "instead of full rebuild."
        ),
    ),
)
