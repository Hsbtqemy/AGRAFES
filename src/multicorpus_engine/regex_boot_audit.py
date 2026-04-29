"""Lightweight boot-time audit of persisted curation regex patterns.

Pendant scriptal de scripts/validate_regex_migration.py — la version full
(avec sample diff sur text_norm) reste réservée à l'audit pré-migration,
trop coûteuse à exécuter au boot.

Cette version compile-only :
  - parse corpus_info.meta_json pour extraire les patterns custom
  - tente `re.compile()` et `regex.compile(.., regex.V0)`
  - détecte la syntaxe POSIX/Unicode property classes
  - retourne la liste des audits non-OK (jamais raise)

Appelée au démarrage de CorpusServer ; les audits non-OK sont loggés en
WARN. Boot continue normalement quoi qu'il arrive (defensive — ne doit
JAMAIS bloquer le démarrage du sidecar).

Cf. HANDOFF_PREP § 7 « F5 — Validation regex au boot du sidecar ».
"""
from __future__ import annotations

import json
import re as stdlib_re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import regex as third_party_regex  # type: ignore[import]
except ImportError:  # pragma: no cover — packaging guarantee
    third_party_regex = None  # type: ignore[assignment]


_POSIX_OR_UNICODE_SIGNALS = ("[[:", r"\p{", r"\P{", r"\X")


@dataclass(frozen=True)
class PatternAudit:
    """Result of compile-checking one persisted curation pattern."""

    pattern: str
    description: str
    path: str
    flags: str
    status: str  # "OK" | "BOTH_FAIL" | "RE_ONLY_FAIL" | "REGEX_ONLY_FAIL" | "POSIX_USAGE"
    posix_signals: tuple[str, ...] = field(default_factory=tuple)
    re_compile_error: str | None = None
    regex_compile_error: str | None = None

    @property
    def is_clean(self) -> bool:
        return self.status == "OK"


def _has_posix_or_unicode_class(pattern: str) -> tuple[str, ...]:
    return tuple(s for s in _POSIX_OR_UNICODE_SIGNALS if s in pattern)


def _flags_from_str(flags_str: str) -> tuple[int, int]:
    """Convert flag string ('i', 'm', 's', etc.) → (re_flags, regex_flags)."""
    re_flags = 0
    rx_flags = third_party_regex.V0 if third_party_regex else 0
    if "i" in flags_str:
        re_flags |= stdlib_re.IGNORECASE
        if third_party_regex:
            rx_flags |= third_party_regex.IGNORECASE
    if "m" in flags_str:
        re_flags |= stdlib_re.MULTILINE
        if third_party_regex:
            rx_flags |= third_party_regex.MULTILINE
    if "s" in flags_str:
        re_flags |= stdlib_re.DOTALL
        if third_party_regex:
            rx_flags |= third_party_regex.DOTALL
    return re_flags, rx_flags


def extract_patterns_from_meta(meta: Any) -> list[dict]:
    """Walk a meta_json structure looking for curation rules. Pure.

    Heuristic : any dict with both 'pattern' and 'replacement' keys is a rule.
    """
    patterns: list[dict] = []

    def _walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            if "pattern" in node and "replacement" in node:
                patterns.append({
                    "pattern": str(node["pattern"]),
                    "replacement": str(node["replacement"]),
                    "flags": str(node.get("flags") or ""),
                    "description": str(node.get("description") or ""),
                    "path": path,
                })
            for k, v in node.items():
                _walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, item in enumerate(node):
                _walk(item, f"{path}[{i}]")

    _walk(meta, "meta")
    return patterns


def audit_pattern(rule: dict) -> PatternAudit:
    """Compile-check one rule. Pure. No sample diff. Never raises."""
    pattern = rule.get("pattern", "")
    description = rule.get("description", "")
    path = rule.get("path", "")
    flags = rule.get("flags", "")

    posix = _has_posix_or_unicode_class(pattern)
    re_flags, rx_flags = _flags_from_str(flags)

    try:
        stdlib_re.compile(pattern, re_flags)
        re_err: str | None = None
    except stdlib_re.error as e:
        re_err = str(e)

    rx_err: str | None = None
    if third_party_regex is not None:
        try:
            third_party_regex.compile(pattern, rx_flags)
        except third_party_regex.error as e:  # type: ignore[attr-defined]
            rx_err = str(e)

    if re_err and rx_err:
        status = "BOTH_FAIL"
    elif re_err and not rx_err:
        status = "RE_ONLY_FAIL"
    elif rx_err and not re_err:
        status = "REGEX_ONLY_FAIL"
    elif posix:
        status = "POSIX_USAGE"
    else:
        status = "OK"

    return PatternAudit(
        pattern=pattern,
        description=description,
        path=path,
        flags=flags,
        status=status,
        posix_signals=posix,
        re_compile_error=re_err,
        regex_compile_error=rx_err,
    )


def audit_persisted_patterns(db_path: Path | str) -> list[PatternAudit]:
    """Read corpus_info.meta_json from db, return non-clean audits. Never raises.

    Empty list = clean (no patterns OR all OK). Caller logs WARN otherwise.
    """
    try:
        path = Path(db_path)
        if not path.exists():
            return []
        # Read-only mode — never mutates the DB.
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            rows = conn.execute(
                "SELECT meta_json FROM corpus_info WHERE meta_json IS NOT NULL"
            ).fetchall()
        finally:
            conn.close()
    except (sqlite3.Error, OSError):
        return []

    issues: list[PatternAudit] = []
    for (meta_json,) in rows:
        if not meta_json:
            continue
        try:
            meta = json.loads(meta_json)
        except (json.JSONDecodeError, TypeError):
            continue
        for rule in extract_patterns_from_meta(meta):
            audit = audit_pattern(rule)
            if not audit.is_clean:
                issues.append(audit)
    return issues


def format_audit_warning(audits: list[PatternAudit]) -> str:
    """Format non-clean audits as a single multi-line WARN log message. Pure."""
    if not audits:
        return ""
    lines = [
        f"Regex boot audit : {len(audits)} pattern(s) custom à réviser avant prochaine migration."
    ]
    for a in audits:
        head = f"  [{a.status}] {a.path or '<root>'}"
        if a.description:
            head += f" — {a.description}"
        lines.append(head)
        lines.append(f"    pattern: {a.pattern!r} flags={a.flags!r}")
        if a.posix_signals:
            lines.append(f"    POSIX/Unicode tokens: {list(a.posix_signals)}")
        if a.re_compile_error:
            lines.append(f"    re.compile FAIL: {a.re_compile_error}")
        if a.regex_compile_error:
            lines.append(f"    regex.compile FAIL: {a.regex_compile_error}")
    lines.append(
        "  → audit complet : python scripts/validate_regex_migration.py <db>"
    )
    return "\n".join(lines)
