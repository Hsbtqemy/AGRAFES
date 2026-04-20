"""Minimal/advanced CQL parser for token-level queries (Sprint C+D).

Supported syntax:
- token clauses: ``[lemma = "liv.*"]``, ``[word = "Maison" %c]``, ``[pos = "NOUN"]``
- boolean AND inside one token: ``[pos = "DET" & lemma = "le"]``
- fixed token sequences: ``[...][...][...]``
- wildcard token: ``[]``
- repetition: ``[]{0,3}``, ``[lemma = "liv.*"]{1,2}``, ``[pos = "DET"]{2}``
- sentence constraint suffix: ``within s``
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from .query import _validate_user_regex


_VALID_ATTRS = {"word", "lemma", "pos", "upos", "xpos", "feats"}


@dataclass(frozen=True)
class CqlPredicate:
    """One atomic condition inside a token clause."""

    attr: str
    pattern: str
    case_insensitive: bool = False

    @property
    def normalized_attr(self) -> str:
        # Expose a single name for POS so the query layer can map directly to
        # the tokens.upos column.
        return "upos" if self.attr == "pos" else self.attr


@dataclass(frozen=True)
class CqlTokenSpec:
    """A token clause with one-or-more AND-ed predicates.

    Wildcard clauses (`[]`) have ``wildcard=True`` and no predicates.
    ``min_repeat`` / ``max_repeat`` come from an optional `{m,n}` quantifier.
    """

    predicates: tuple[CqlPredicate, ...]
    wildcard: bool = False
    min_repeat: int = 1
    max_repeat: int = 1


@dataclass(frozen=True)
class CqlQuery:
    """Top-level parsed query object."""

    token_specs: tuple[CqlTokenSpec, ...]
    within_sentence: bool = False


def _find_token_end(src: str, start: int) -> int:
    """Return index of matching `]` for token clause starting at `[`."""
    in_string = False
    escaped = False
    i = start + 1
    while i < len(src):
        ch = src[i]
        if escaped:
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == '"':
            in_string = not in_string
        elif ch == "]" and not in_string:
            return i
        i += 1
    raise ValueError("Unclosed token clause: missing ']'")


def _split_top_level_and(expr: str) -> list[str]:
    """Split an expression on top-level `&` operators (outside quotes)."""
    parts: list[str] = []
    cur: list[str] = []
    in_string = False
    escaped = False
    for ch in expr:
        if escaped:
            cur.append(ch)
            escaped = False
            continue
        if ch == "\\":
            cur.append(ch)
            escaped = True
            continue
        if ch == '"':
            in_string = not in_string
            cur.append(ch)
            continue
        if ch == "&" and not in_string:
            part = "".join(cur).strip()
            if not part:
                raise ValueError("Empty predicate around '&' in CQL token clause")
            parts.append(part)
            cur = []
            continue
        cur.append(ch)
    tail = "".join(cur).strip()
    if not tail:
        raise ValueError("Trailing '&' in CQL token clause")
    parts.append(tail)
    return parts


_PRED_RE = re.compile(
    r"""
    ^\s*
    (?P<attr>word|lemma|pos|upos|xpos|feats)
    \s*=\s*
    "
    (?P<value>(?:\\.|[^"\\])*)
    "
    \s*(?P<flag>%c)?
    \s*$
    """,
    re.VERBOSE | re.IGNORECASE,
)


def _unescape_quoted(value: str) -> str:
    # Keep escaping rules minimal and predictable.
    return value.replace(r"\\", "\\").replace(r"\"", '"')


_QUANT_RE = re.compile(
    r"""
    ^
    \{
      \s*(?P<m>\d+)\s*
      (?:,\s*(?P<n>\d+)\s*)?
    \}
    """,
    re.VERBOSE,
)


def _parse_quantifier(src: str, index: int) -> tuple[int, int, int]:
    """Parse optional quantifier at ``src[index:]``.

    Returns ``(min_repeat, max_repeat, consumed_chars)``.
    """
    m = _QUANT_RE.match(src[index:])
    if not m:
        return (1, 1, 0)
    _MAX_REPEAT = 1000
    min_repeat = int(m.group("m"))
    max_repeat = int(m.group("n")) if m.group("n") is not None else min_repeat
    if min_repeat < 0 or max_repeat < 0:
        raise ValueError("Quantifier bounds must be >= 0")
    if max_repeat < min_repeat:
        raise ValueError("Invalid quantifier: max < min")
    if max_repeat > _MAX_REPEAT:
        raise ValueError(f"Quantifier too large: {max_repeat} (max {_MAX_REPEAT})")
    consumed = m.end()
    return (min_repeat, max_repeat, consumed)


def _parse_token_clause(raw_expr: str) -> tuple[tuple[CqlPredicate, ...], bool]:
    """Parse one token clause body (inside `[...]`)."""
    if not raw_expr:
        # Wildcard token []
        return (tuple(), True)

    pred_texts = _split_top_level_and(raw_expr)
    predicates: list[CqlPredicate] = []
    for pred_text in pred_texts:
        m = _PRED_RE.match(pred_text)
        if not m:
            raise ValueError(
                f"Invalid predicate syntax in token clause: {pred_text!r}"
            )
        attr = m.group("attr").lower()
        if attr not in _VALID_ATTRS:
            raise ValueError(f"Unsupported CQL attribute: {attr!r}")
        value = _unescape_quoted(m.group("value"))
        flag = bool(m.group("flag"))
        # Validate regex early so errors are returned as BAD_REQUEST.
        _validate_user_regex(value)
        try:
            re.compile(value, re.IGNORECASE if flag else 0)
        except re.error as exc:
            raise ValueError(
                f"Invalid regex in predicate {pred_text!r}: {exc}"
            ) from exc
        predicates.append(
            CqlPredicate(attr=attr, pattern=value, case_insensitive=flag)
        )

    return (tuple(predicates), False)


def parse_cql_query(cql: str) -> CqlQuery:
    """Parse CQL query with optional quantifiers and `within s`."""
    if not isinstance(cql, str) or not cql.strip():
        raise ValueError("cql must be a non-empty string")

    src = cql.strip()
    # Accept optional terminal semicolon (common in CQL examples).
    if src.endswith(";"):
        src = src[:-1].rstrip()
    i = 0
    specs: list[CqlTokenSpec] = []

    while i < len(src):
        while i < len(src) and src[i].isspace():
            i += 1
        if i >= len(src):
            break

        # Optional top-level suffix.
        rem = src[i:]
        if rem.lower().startswith("within"):
            break

        if src[i] != "[":
            raise ValueError(f"Expected '[' at position {i}")

        end = _find_token_end(src, i)
        raw_expr = src[i + 1 : end].strip()
        predicates, wildcard = _parse_token_clause(raw_expr)

        i = end + 1
        while i < len(src) and src[i].isspace():
            i += 1
        min_rep, max_rep, consumed = _parse_quantifier(src, i)
        if consumed:
            i += consumed

        specs.append(
            CqlTokenSpec(
                predicates=predicates,
                wildcard=wildcard,
                min_repeat=min_rep,
                max_repeat=max_rep,
            )
        )

    if not specs:
        raise ValueError("No token clause found in CQL query")

    while i < len(src) and src[i].isspace():
        i += 1

    within_sentence = False
    if i < len(src):
        suffix = src[i:].strip()
        if suffix.lower() == "within s":
            within_sentence = True
        else:
            raise ValueError(f"Unsupported trailing CQL constraint: {suffix!r}")

    return CqlQuery(token_specs=tuple(specs), within_sentence=within_sentence)


def parse_cql(cql: str) -> list[CqlTokenSpec]:
    """Backward-compatible alias returning only token specs."""
    return list(parse_cql_query(cql).token_specs)
