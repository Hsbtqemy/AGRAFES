"""Marker lift (refonte R4.2) — turn inline peritext markers into structured axes.

A post-import, idempotent pass that reads a document's line units and, for each
unit whose ``text_norm`` still carries an allowlisted trailing marker, derives the
peritext ``unit_role`` and/or translation ``unit_status`` (R4.1), strips the marker
from ``text_norm`` (clean FTS) while leaving ``text_raw`` verbatim (ADR-043).

Design: docs/DESIGN_R4_2_marker_lift.md. Key decisions:
- **Allowlist only** (never a greedy ``\\[...\\]``): the corpus carries editorial
  glosses in mid-text brackets (``[the biro manufacturer]``…) that a greedy regex
  would corrupt. Only the known markers below, and only **trailing** the line.
- **Case-insensitive** (``[Non traduit]`` == ``[non traduit]``).
- **Idempotent + never clobbers manual edits**: the trigger is "a marker is still
  present in ``text_norm``"; once lifted, ``text_norm`` is clean so a re-run skips
  the unit. On apply, role/status are filled **only where currently NULL** — a
  manual value is preserved (and reported as a conflict).
"""

from __future__ import annotations

import logging
import re
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# ── Allowlist (data-backed, docs/DESIGN_R4_2 §6). Keys are casefolded inner text. ──
_ROLE_MARKERS: dict[str, str] = {
    "t": "titre",
    "ch": "chapeau",
    "intert": "intertitre",
    # "p" / "s" are reserved (0 occurrence in the reference corpus) — not guessed.
}
_STATUS_MARKERS: dict[str, str] = {
    "non traduit": "non_traduit",
    "+": "ajout",
}

# unit_roles rows the lift ensures exist (INSERT OR IGNORE) before assigning.
# (name, label, color, icon, sort_order, category) — mirrors the importer seed.
_ROLE_SEED: dict[str, tuple] = {
    "titre":      ("titre", "Titre", "#2563eb", "T", 1, "structure"),
    "chapeau":    ("chapeau", "Chapeau", "#0891b2", "C", 2, "structure"),
    "intertitre": ("intertitre", "Intertitre", "#9333ea", "§", 0, "structure"),
}

# One trailing bracketed token at the very end of the string. Bounded inner length
# so a stray unmatched "[" never triggers a pathological scan.
_TRAILING_MARKER_RE = re.compile(r"\s*\[([^\[\]]{1,24})\]\s*$")


def parse_markers(text: str) -> tuple[Optional[str], Optional[str], str, bool]:
    """Strip allowlisted **trailing** markers from *text*; derive role + status.

    Returns ``(role, status, cleaned, matched)``. ``matched`` is True iff at least
    one allowlisted marker was found. A trailing bracket that is NOT in the allowlist
    (e.g. an editorial gloss) stops the scan and is left untouched — so mid-text and
    unknown brackets are never stripped. Repeated trailing markers are all consumed
    (``… [non traduit] [Ch]`` → role=chapeau, status=non_traduit, cleaned="…").
    The rightmost marker of an axis wins (first encountered scanning from the end).
    """
    role: Optional[str] = None
    status: Optional[str] = None
    matched = False
    s = (text or "").rstrip()
    while True:
        m = _TRAILING_MARKER_RE.search(s)
        if not m:
            break
        inner = m.group(1).strip().casefold()
        if inner in _ROLE_MARKERS:
            if role is None:
                role = _ROLE_MARKERS[inner]
        elif inner in _STATUS_MARKERS:
            if status is None:
                status = _STATUS_MARKERS[inner]
        else:
            break  # trailing bracket outside the allowlist → stop, never strip it
        matched = True
        s = s[: m.start()].rstrip()
    return role, status, s, matched


@dataclass
class LiftReport:
    """Diagnostics for one lift pass over a document."""

    doc_id: int
    dry_run: bool
    units_scanned: int = 0
    units_affected: int = 0
    roles_set: int = 0
    statuses_set: int = 0
    cleaned: int = 0  # units whose text_norm changed
    roles_created: list[str] = field(default_factory=list)
    conflicts: list[dict[str, Any]] = field(default_factory=list)
    changes: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "dry_run": self.dry_run,
            "units_scanned": self.units_scanned,
            "units_affected": self.units_affected,
            "roles_set": self.roles_set,
            "statuses_set": self.statuses_set,
            "cleaned": self.cleaned,
            "roles_created": self.roles_created,
            "conflicts": self.conflicts,
            "changes": self.changes,
        }


# record_action(before: list[dict]) -> action_id | None  (prep undo hook, like resegment)
LiftActionRecorder = Callable[[list[dict[str, Any]]], Optional[int]]


def lift_document_markers(
    conn: sqlite3.Connection,
    doc_id: int,
    *,
    dry_run: bool = True,
    run_logger: Optional[logging.Logger] = None,
    record_action: Optional[LiftActionRecorder] = None,
) -> LiftReport:
    """Lift inline markers of one document's line units into role/status.

    ``dry_run=True`` (default) computes and reports the changes without writing.
    On apply, role/status are set **only where currently NULL** (manual values are
    preserved and reported in ``conflicts``); ``text_norm`` is always cleaned and the
    unit reindexed in FTS. Idempotent: a unit already cleaned carries no marker in
    ``text_norm`` and is skipped.
    """
    log = run_logger or logger
    report = LiftReport(doc_id=doc_id, dry_run=dry_run)

    rows = conn.execute(
        "SELECT unit_id, n, unit_role, unit_status, text_norm"
        " FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
        (doc_id,),
    ).fetchall()
    report.units_scanned = len(rows)

    before_snapshot: list[dict[str, Any]] = []
    roles_needed: set[str] = set()
    pending: list[dict[str, Any]] = []

    for r in rows:
        role, status, cleaned, matched = parse_markers(r["text_norm"] or "")
        if not matched:
            continue  # no allowlisted marker → not liftable (or already lifted)
        report.units_affected += 1

        existing_role = r["unit_role"]
        existing_status = r["unit_status"]
        # Fill only where NULL (human wins); flag a real divergence as a conflict.
        set_role = role if (role is not None and existing_role is None) else None
        set_status = status if (status is not None and existing_status is None) else None
        if role is not None and existing_role is not None and existing_role != role:
            report.conflicts.append({"n": r["n"], "field": "unit_role", "existing": existing_role, "marker": role})
        if status is not None and existing_status is not None and existing_status != status:
            report.conflicts.append({"n": r["n"], "field": "unit_status", "existing": existing_status, "marker": status})

        if set_role:
            report.roles_set += 1
            roles_needed.add(set_role)
        if set_status:
            report.statuses_set += 1
        if cleaned != (r["text_norm"] or ""):
            report.cleaned += 1

        report.changes.append({
            "n": r["n"], "unit_id": r["unit_id"],
            "role": set_role, "status": set_status,
            "text_norm_before": r["text_norm"], "text_norm_after": cleaned,
        })
        pending.append({
            "unit_id": r["unit_id"], "set_role": set_role, "set_status": set_status,
            "text_norm": cleaned,
            "before": {"unit_id": r["unit_id"], "n": r["n"], "unit_role": existing_role,
                       "unit_status": existing_status, "text_norm": r["text_norm"]},
        })

    if dry_run or not pending:
        log.info("lift-markers (dry_run=%s) doc_id=%d: %d/%d units would change",
                 dry_run, doc_id, report.units_affected, report.units_scanned)
        return report

    # ── apply ──
    for role_name in sorted(roles_needed):
        seed = _ROLE_SEED.get(role_name)
        if seed is None:
            continue
        cur = conn.execute(
            "INSERT OR IGNORE INTO unit_roles (name, label, color, icon, sort_order, category)"
            " VALUES (?, ?, ?, ?, ?, ?)", seed,
        )
        if cur.rowcount > 0:
            report.roles_created.append(role_name)

    for p in pending:
        sets: list[str] = ["text_norm = ?"]
        params: list[Any] = [p["text_norm"]]
        if p["set_role"] is not None:
            sets.append("unit_role = ?")
            params.append(p["set_role"])
        if p["set_status"] is not None:
            sets.append("unit_status = ?")
            params.append(p["set_status"])
        params.append(p["unit_id"])
        conn.execute(f"UPDATE units SET {', '.join(sets)} WHERE unit_id = ?", params)
        # Reindex FTS: clear the row, reinsert only if there is still text to index
        # (a pure placeholder → text_norm="" → stays out of the index, ENG-04).
        try:
            conn.execute("DELETE FROM fts_units WHERE rowid = ?", (p["unit_id"],))
            if p["text_norm"]:
                conn.execute("INSERT INTO fts_units(rowid, text_norm) VALUES (?, ?)",
                             (p["unit_id"], p["text_norm"]))
        except Exception:
            pass  # FTS update is best-effort (mirrors update_unit_text)
        before_snapshot.append(p["before"])

    if record_action is not None and before_snapshot:
        record_action(before_snapshot)

    conn.commit()
    log.info("lift-markers applied doc_id=%d: %d units changed (%d roles, %d statuses, %d cleaned)",
             doc_id, report.units_affected, report.roles_set, report.statuses_set, report.cleaned)
    return report
