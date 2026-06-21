"""Declarative structural validator for sidecar / service inputs (audit A-03).

Stdlib only — no pydantic / jsonschema (the engine stays near stdlib, cf.
CLAUDE.md). Replaces the ad-hoc ``if not isinstance(...): raise / _send_error``
blocks scattered across ``sidecar.py`` handlers and ``services/*.py`` with
declarative :class:`Field` schemas.

Scope = **structural** validation: presence, type, enum membership,
numeric / length bounds, ``int`` coercion, defaults. It raises the typed errors
from :mod:`services.errors` (``ValidationError`` by default, ``BadRequestError``
when an endpoint historically returned that shape code) and **never** an HTTP /
wire code — the caller maps the typed error to the historical wire code per
endpoint:

* **service**  — the raise propagates to the A-01 adapter, which already maps it;
* **handler**  — wrap in ``try/except ValidationError -> self._send_error(code=...)``
  (the established pattern, e.g. ``_handle_import``).

Out of scope (stays inline / in the services): **semantic** checks (existence
-> ``NotFoundError``, conflicts -> ``ConflictError``, DB-dependent rules) and
**format / pattern** rules (e.g. an alnum name).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .errors import ServiceError, ValidationError

_UNSET: Any = object()

_TYPE_NAMES: dict[type, str] = {
    bool: "boolean",
    str: "string",
    int: "integer",
    float: "number",
    dict: "object",
    list: "array",
}


def _type_label(t: type | tuple[type, ...]) -> str:
    types = t if isinstance(t, tuple) else (t,)
    return " or ".join(_TYPE_NAMES.get(x, getattr(x, "__name__", str(x))) for x in types)


def _with_article(label: str) -> str:
    return ("an " if label[:1].lower() in "aeiou" else "a ") + label


def _fmt_num(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else str(n)


@dataclass(frozen=True)
class Field:
    """One declarative input field.

    type     accepted python type(s): ``str`` / ``int`` / ``bool`` /
             ``(int, float)`` … (``object`` = no type check).
    required missing — or blank, for ``strip``ped strings — yields
             ``"<name> is required"``.
    enum     if set, value must be a member: ``"<name> must be one of: …"``.
    min/max  numeric bound on the value, or — for ``str`` — a length bound.
    default  value injected when the field is absent and not required.
    coerce   ``int(value)`` coercion; failure yields ``"<name> must be an integer"``.
    strip    strip ``str`` values (and, when ``required``, treat blank as missing).
    error    typed error class to raise (``ValidationError`` or ``BadRequestError``).
    """

    name: str
    type: type | tuple[type, ...] = object
    required: bool = True
    enum: tuple[Any, ...] | None = None
    min: float | None = None
    max: float | None = None
    default: Any = _UNSET
    coerce: bool = False
    strip: bool = False
    error: type[ServiceError] = ValidationError


def validate(
    body: Mapping[str, Any],
    schema: Sequence[Field],
    *,
    where: str = "body",
) -> dict[str, Any]:
    """Validate / coerce ``body`` against ``schema``; raise on the **first** failure.

    Returns a dict of the validated fields (coerced / stripped values, plus
    defaults for absent optional fields that declare one). Non-schema keys are
    not copied — the caller reads any extra fields from ``body`` directly.

    ``where`` names the validated container in the top-level "not an object"
    message; per-field messages stay field-scoped (``"<name> …"``) to remain
    byte-identical with the legacy inline blocks.
    """
    if not isinstance(body, Mapping):
        raise ValidationError(f"{where} must be an object")

    out: dict[str, Any] = {}
    for f in schema:
        # An ABSENT key triggers required-miss / default. A *present* key whose
        # value is ``null`` is NOT absent — it is handled below as a value
        # (type-checked), EXCEPT for a required field, where ``null`` is treated
        # as missing ("<name> is required") to match the legacy
        # ``(body.get(x) or "")`` idiom. This split keeps both legacy shapes
        # byte-identical: an optional ``isinstance``-guarded field rejects a
        # present ``null`` (it is not its type), while a default only fills in for
        # a genuinely absent key.
        if f.name not in body:
            if f.required:
                raise f.error(f"{f.name} is required")
            if f.default is not _UNSET:
                out[f.name] = f.default
            continue

        value = body.get(f.name)
        if value is None and f.required:
            raise f.error(f"{f.name} is required")

        if f.strip and isinstance(value, str):
            value = value.strip()
            if f.required and value == "":
                raise f.error(f"{f.name} is required")

        if f.coerce:
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise f.error(f"{f.name} must be an integer") from None
        elif f.type is not object and not isinstance(value, f.type):
            raise f.error(f"{f.name} must be {_with_article(_type_label(f.type))}")

        if f.enum is not None and value not in f.enum:
            raise f.error(f"{f.name} must be one of: {', '.join(str(x) for x in f.enum)}")

        if f.min is not None or f.max is not None:
            is_str = isinstance(value, str)
            measure = len(value) if is_str else value
            unit = " characters" if is_str else ""
            if f.min is not None and measure < f.min:
                raise f.error(f"{f.name} must be >= {_fmt_num(f.min)}{unit}")
            if f.max is not None and measure > f.max:
                raise f.error(f"{f.name} must be <= {_fmt_num(f.max)}{unit}")

        out[f.name] = value

    return out
