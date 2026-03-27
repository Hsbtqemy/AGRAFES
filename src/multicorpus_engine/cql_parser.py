"""CQL (Corpus Query Language) parser — Sprint C.

Supported syntax
----------------
Single token:
    [attr="value"]
    [attr="regex.*"]          value is treated as a Python regex
    [attr="value" %c]         case-insensitive flag

Boolean operators (within one token):
    [a="x" & b="y"]           AND
    [a="x" | b="y"]           OR
    [a="x" & b="y" | c="z"]   mixed (& binds tighter than |)

Sequences:
    [tok1][tok2][tok3]

Valid attributes: word, lemma, upos, xpos, feats, misc

Grammar
-------
    query    ::= token+
    token    ::= '[' expr ']'
    expr     ::= and_expr ('|' and_expr)*
    and_expr ::= primary ('&' primary)*
    primary  ::= IDENT '=' '"' VALUE '"' ('%c')?
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Union


# ─── AST ─────────────────────────────────────────────────────────────────────

@dataclass
class AttrTest:
    """Single attribute test: attr="value" [%c]."""
    attr: str
    value: str
    case_insensitive: bool = False


@dataclass
class AndExpr:
    left: "BoolExpr"
    right: "BoolExpr"


@dataclass
class OrExpr:
    left: "BoolExpr"
    right: "BoolExpr"


BoolExpr = Union[AttrTest, AndExpr, OrExpr]


@dataclass
class TokenConstraint:
    expr: BoolExpr


@dataclass
class CQLQuery:
    tokens: list[TokenConstraint] = field(default_factory=list)


# ─── Exceptions ───────────────────────────────────────────────────────────────

class CQLSyntaxError(ValueError):
    """Raised when the CQL text cannot be parsed."""


# ─── Lexer ────────────────────────────────────────────────────────────────────

_T_LBRACKET = "["
_T_RBRACKET = "]"
_T_EQ       = "="
_T_AND      = "&"
_T_OR       = "|"
_T_IDENT    = "IDENT"
_T_STR      = "STR"
_T_FLAG_C   = "FLAG_C"
_T_EOF      = "EOF"

# Single compiled pattern; groups: quoted_str | %c | operator/bracket | identifier
_LEX_RE = re.compile(
    r'\s*(?:'
    r'("(?:[^"\\]|\\.)*")'           # group 1 — quoted string
    r'|(%c)'                          # group 2 — case flag
    r'|([&|=\[\]])'                   # group 3 — single-char token
    r'|([A-Za-z_][A-Za-z0-9_]*)'     # group 4 — identifier
    r')\s*'
)


def _lex(text: str) -> list[tuple[str, str]]:
    """Return a list of (token_type, value) pairs."""
    tokens: list[tuple[str, str]] = []
    pos = 0
    while pos < len(text):
        m = _LEX_RE.match(text, pos)
        if not m:
            if text[pos].isspace():
                pos += 1
                continue
            raise CQLSyntaxError(
                f"Unexpected character at position {pos}: {text[pos]!r}"
            )
        pos = m.end()
        if m.group(1):
            raw = m.group(1)[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            tokens.append((_T_STR, raw))
        elif m.group(2):
            tokens.append((_T_FLAG_C, "%c"))
        elif m.group(3):
            ch = m.group(3)
            mapping = {"[": _T_LBRACKET, "]": _T_RBRACKET,
                       "=": _T_EQ, "&": _T_AND, "|": _T_OR}
            tokens.append((mapping[ch], ch))
        elif m.group(4):
            tokens.append((_T_IDENT, m.group(4)))
    tokens.append((_T_EOF, ""))
    return tokens


# ─── Parser ───────────────────────────────────────────────────────────────────

_VALID_ATTRS = frozenset({"word", "lemma", "upos", "xpos", "feats", "misc"})


class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self._tokens = tokens
        self._pos = 0

    # ── helpers ──────────────────────────────────────────────────────────────

    def _peek(self) -> tuple[str, str]:
        return self._tokens[self._pos]

    def _consume(self, expected: str | None = None) -> tuple[str, str]:
        tok = self._tokens[self._pos]
        if expected is not None and tok[0] != expected:
            raise CQLSyntaxError(
                f"Expected {expected!r}, got {tok[0]!r} ({tok[1]!r})"
            )
        self._pos += 1
        return tok

    # ── grammar rules ────────────────────────────────────────────────────────

    def parse_query(self) -> CQLQuery:
        token_list: list[TokenConstraint] = []
        while self._peek()[0] == _T_LBRACKET:
            token_list.append(self._parse_token())
        if self._peek()[0] != _T_EOF:
            raise CQLSyntaxError(f"Unexpected token: {self._peek()[1]!r}")
        if not token_list:
            raise CQLSyntaxError("Empty query — at least one token constraint is required")
        return CQLQuery(tokens=token_list)

    def _parse_token(self) -> TokenConstraint:
        self._consume(_T_LBRACKET)
        expr = self._parse_expr()
        self._consume(_T_RBRACKET)
        return TokenConstraint(expr=expr)

    def _parse_expr(self) -> BoolExpr:
        """expr ::= and_expr ('|' and_expr)*"""
        left = self._parse_and_expr()
        while self._peek()[0] == _T_OR:
            self._consume(_T_OR)
            right = self._parse_and_expr()
            left = OrExpr(left=left, right=right)
        return left

    def _parse_and_expr(self) -> BoolExpr:
        """and_expr ::= primary ('&' primary)*"""
        left = self._parse_primary()
        while self._peek()[0] == _T_AND:
            self._consume(_T_AND)
            right = self._parse_primary()
            left = AndExpr(left=left, right=right)
        return left

    def _parse_primary(self) -> BoolExpr:
        """primary ::= IDENT '=' '"' VALUE '"' ('%c')?"""
        _, attr = self._consume(_T_IDENT)
        if attr not in _VALID_ATTRS:
            raise CQLSyntaxError(
                f"Unknown attribute {attr!r}. "
                f"Valid attributes: {', '.join(sorted(_VALID_ATTRS))}"
            )
        self._consume(_T_EQ)
        _, value = self._consume(_T_STR)
        ci = False
        if self._peek()[0] == _T_FLAG_C:
            self._consume(_T_FLAG_C)
            ci = True
        return AttrTest(attr=attr, value=value, case_insensitive=ci)


# ─── Public API ───────────────────────────────────────────────────────────────

def parse_cql(text: str) -> CQLQuery:
    """Parse a CQL query string into a :class:`CQLQuery` AST.

    Parameters
    ----------
    text:
        Raw CQL query, e.g. ``'[lemma="manger" & upos="VERB"][upos="ADV"]'``.

    Returns
    -------
    CQLQuery
        The parsed AST.

    Raises
    ------
    CQLSyntaxError
        If the text is not valid CQL.
    """
    tokens = _lex(text.strip())
    return _Parser(tokens).parse_query()
