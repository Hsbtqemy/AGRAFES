"""CQL (Corpus Query Language) parser — Sprint C + D.

Supported syntax (Sprint C)
---------------------------
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

Sprint D extensions
-------------------
Wildcard token:
    []                        matches any single token

Repetition quantifiers (applied to a token or wildcard):
    [tok]{n}                  exactly n times
    [tok]{m,n}                between m and n times (m ≤ n, n ≤ 50)
    []{0,4}                   between 0 and 4 tokens, any content

within constraint (appended after the token sequence):
    within s                  all matched tokens must share the same sent_id

Grammar (Sprint D)
------------------
    query      ::= token_item+ ('within' scope)?
    token_item ::= (token | wildcard) quantifier?
    token      ::= '[' expr ']'
    wildcard   ::= '[' ']'
    quantifier ::= '{' INT '}'  |  '{' INT ',' INT '}'
    scope      ::= 's'          (sentence boundary)
    expr       ::= and_expr ('|' and_expr)*
    and_expr   ::= primary ('&' primary)*
    primary    ::= IDENT '=' '"' VALUE '"' ('%c')?

Valid attributes: word, lemma, upos, xpos, feats, misc
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
    """A concrete token constraint with a boolean expression."""
    expr: BoolExpr


@dataclass
class WildcardToken:
    """An unconstrained token — matches any single token."""


# A PatternElement is either a concrete constraint or a wildcard,
# optionally decorated with a repetition range.
@dataclass
class RepeatToken:
    """A token (or wildcard) repeated between min and max times."""
    inner: Union[TokenConstraint, WildcardToken]
    min: int   # 0 ≤ min ≤ max
    max: int   # max ≤ 50 (hard cap to prevent runaway queries)


#: The union of all pattern elements that can appear in a query.
PatternElement = Union[TokenConstraint, WildcardToken, RepeatToken]


@dataclass
class CQLQuery:
    tokens: list[PatternElement] = field(default_factory=list)
    within_s: bool = False   # True → all matched tokens must share sent_id


# ─── Exceptions ───────────────────────────────────────────────────────────────

class CQLSyntaxError(ValueError):
    """Raised when the CQL text cannot be parsed."""


# ─── Lexer ────────────────────────────────────────────────────────────────────

_T_LBRACKET = "["
_T_RBRACKET = "]"
_T_LBRACE   = "{"
_T_RBRACE   = "}"
_T_COMMA    = ","
_T_EQ       = "="
_T_AND      = "&"
_T_OR       = "|"
_T_IDENT    = "IDENT"
_T_STR      = "STR"
_T_FLAG_C   = "FLAG_C"
_T_INT      = "INT"
_T_EOF      = "EOF"

# Single compiled pattern; groups:
#   1 — quoted string
#   2 — %c
#   3 — single-char operators/brackets
#   4 — integer literal
#   5 — identifier
_LEX_RE = re.compile(
    r'\s*(?:'
    r'("(?:[^"\\]|\\.)*")'             # group 1 — quoted string
    r'|(%c)'                            # group 2 — case flag
    r'|([&|=\[\]{}|,])'                # group 3 — single-char token (incl. braces/comma)
    r'|(\d+)'                           # group 4 — integer
    r'|([A-Za-z_][A-Za-z0-9_]*)'       # group 5 — identifier (incl. "within", "s")
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
            mapping = {
                "[": _T_LBRACKET, "]": _T_RBRACKET,
                "{": _T_LBRACE,   "}": _T_RBRACE,
                ",": _T_COMMA,
                "=": _T_EQ, "&": _T_AND, "|": _T_OR,
            }
            tokens.append((mapping[ch], ch))
        elif m.group(4):
            tokens.append((_T_INT, m.group(4)))
        elif m.group(5):
            tokens.append((_T_IDENT, m.group(5)))
    tokens.append((_T_EOF, ""))
    return tokens


# ─── Parser ───────────────────────────────────────────────────────────────────

_VALID_ATTRS = frozenset({"word", "lemma", "upos", "xpos", "feats", "misc"})
_MAX_REPEAT  = 50   # hard cap on repetition upper-bound


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
        """query ::= token_item+ ('within' scope)?"""
        items: list[PatternElement] = []

        while self._peek()[0] == _T_LBRACKET:
            items.append(self._parse_token_item())

        if not items:
            raise CQLSyntaxError("Empty query — at least one token constraint is required")

        within_s = False
        if self._peek() == (_T_IDENT, "within"):
            self._consume(_T_IDENT)  # consume "within"
            scope_tok = self._peek()
            if scope_tok == (_T_IDENT, "s"):
                self._consume(_T_IDENT)
                within_s = True
            else:
                raise CQLSyntaxError(
                    f"Expected 'within s', got 'within {scope_tok[1]}'"
                )

        if self._peek()[0] != _T_EOF:
            raise CQLSyntaxError(f"Unexpected token: {self._peek()[1]!r}")

        return CQLQuery(tokens=items, within_s=within_s)

    def _parse_token_item(self) -> PatternElement:
        """token_item ::= (token | wildcard) quantifier?"""
        # Peek ahead: if '[' immediately followed by ']' → wildcard
        if (self._peek()[0] == _T_LBRACKET
                and self._pos + 1 < len(self._tokens)
                and self._tokens[self._pos + 1][0] == _T_RBRACKET):
            self._consume(_T_LBRACKET)
            self._consume(_T_RBRACKET)
            inner: Union[TokenConstraint, WildcardToken] = WildcardToken()
        else:
            inner = self._parse_token()

        # Optional quantifier
        if self._peek()[0] == _T_LBRACE:
            return self._parse_quantifier(inner)

        return inner

    def _parse_token(self) -> TokenConstraint:
        """token ::= '[' expr ']'"""
        self._consume(_T_LBRACKET)
        expr = self._parse_expr()
        self._consume(_T_RBRACKET)
        return TokenConstraint(expr=expr)

    def _parse_quantifier(self, inner: Union[TokenConstraint, WildcardToken]) -> RepeatToken:
        """{n} or {m,n}"""
        self._consume(_T_LBRACE)
        _, v1 = self._consume(_T_INT)
        n1 = int(v1)

        if self._peek()[0] == _T_COMMA:
            self._consume(_T_COMMA)
            _, v2 = self._consume(_T_INT)
            n2 = int(v2)
            lo, hi = n1, n2
        else:
            lo = hi = n1

        self._consume(_T_RBRACE)

        if lo < 0:
            raise CQLSyntaxError(f"Repeat minimum must be ≥ 0, got {lo}")
        if hi < lo:
            raise CQLSyntaxError(f"Repeat maximum ({hi}) must be ≥ minimum ({lo})")
        if hi > _MAX_REPEAT:
            raise CQLSyntaxError(
                f"Repeat maximum {hi} exceeds the hard cap of {_MAX_REPEAT}"
            )

        return RepeatToken(inner=inner, min=lo, max=hi)

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
        Raw CQL query string, e.g.:

        ``'[lemma="manger" & upos="VERB"][upos="ADV"]'``
        ``'[lemma="it" %c][]{0,3}[word="that" %c] within s'``

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
