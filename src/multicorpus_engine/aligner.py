"""Alignment engine â€” external_id / position / similarity strategies.

Creates unit-level 1-1 links between a pivot document and one or more target
documents, matching on shared external_id values.

See docs/DECISIONS.md ADR-007.
Charter section 9: align_by_external_id.
"""

from __future__ import annotations

import datetime
import logging
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Optional

from .coarse_grain import derive_coarse_blocks
from .gale_church import gale_church_beads

logger = logging.getLogger(__name__)

# M-08: cap similarity alignment to prevent O(P*T) DoS on pathologically large docs
_MAX_SIMILARITY_UNITS = 5_000

# R3.2 — above this fraction of unpaired paragraphs the length aligner warns that the
# two docs may not be translations. Advisory only (mirrors sidecar's
# SEGMENT_RATIO_WARN_THRESHOLD = 0.15); never blocks (design D4).
_PARA_UNPAIRED_WARN = 0.15


def _get_text_start_n(conn: sqlite3.Connection, doc_id: int) -> int:
    """Return the first text unit n for *doc_id* (1 if no paratextual boundary set).

    Units with n < text_start_n are paratextual and must be excluded from
    alignment so paratext is never linked to translational text.
    """
    row = conn.execute(
        "SELECT text_start_n FROM documents WHERE doc_id = ?", (doc_id,)
    ).fetchone()
    val = row[0] if row and row[0] is not None else None
    return int(val) if val is not None else 1


@dataclass
class AlignmentReport:
    """Coverage and diagnostic report for one (pivot, target) pair."""

    pivot_doc_id: int
    target_doc_id: int
    pivot_title: str
    target_title: str

    # Counts
    pivot_line_count: int = 0
    target_line_count: int = 0
    links_created: int = 0

    # Diagnostic sets (external_ids)
    matched: list[int] = field(default_factory=list)
    missing_in_target: list[int] = field(default_factory=list)   # pivot has, target lacks
    missing_in_pivot: list[int] = field(default_factory=list)    # target has, pivot lacks
    duplicates_pivot: list[int] = field(default_factory=list)    # dup ext_id in pivot
    duplicates_target: list[int] = field(default_factory=list)   # dup ext_id in target

    warnings: list[str] = field(default_factory=list)
    debug: dict[str, Any] | None = None

    @property
    def coverage_pct(self) -> float:
        if self.pivot_line_count == 0:
            return 0.0
        return round(self.links_created / self.pivot_line_count * 100, 2)

    def to_dict(self) -> dict:
        payload = {
            "pivot_doc_id": self.pivot_doc_id,
            "target_doc_id": self.target_doc_id,
            "pivot_title": self.pivot_title,
            "target_title": self.target_title,
            "pivot_line_count": self.pivot_line_count,
            "target_line_count": self.target_line_count,
            "links_created": self.links_created,
            "links_skipped": max(self.pivot_line_count - self.links_created, 0),
            "coverage_pct": self.coverage_pct,
            "matched": self.matched,
            "missing_in_target": self.missing_in_target,
            "missing_in_pivot": self.missing_in_pivot,
            "duplicates_pivot": self.duplicates_pivot,
            "duplicates_target": self.duplicates_target,
            "warnings": self.warnings,
        }
        if self.debug is not None:
            payload["debug"] = self.debug
        return payload


def _load_doc_lines(
    conn: sqlite3.Connection, doc_id: int
) -> tuple[dict[int, list[int]], list[int]]:
    """Load text line units for a doc (excludes paratextual units).

    Returns:
        (ext_id_to_unit_ids, duplicate_ext_ids)
        ext_id_to_unit_ids: {external_id: [unit_id, ...]}  (list because dups possible)
        duplicate_ext_ids: external_ids that appear more than once
    """
    tsn = _get_text_start_n(conn, doc_id)
    rows = conn.execute(
        """
        SELECT unit_id, external_id
        FROM units
        WHERE doc_id = ? AND unit_type = 'line' AND external_id IS NOT NULL AND n >= ?
        ORDER BY n
        """,
        (doc_id, tsn),
    ).fetchall()

    ext_map: dict[int, list[int]] = {}
    for row in rows:
        uid = row["unit_id"]
        eid = row["external_id"]
        ext_map.setdefault(eid, []).append(uid)

    duplicates = [eid for eid, uids in ext_map.items() if len(uids) > 1]
    return ext_map, duplicates


def _load_doc_line_rows(conn: sqlite3.Connection, doc_id: int) -> list[sqlite3.Row]:
    """Load text line units for a doc with unit_id, n, external_id.

    Paratextual units (n < text_start_n) are excluded so alignment links are
    never created between paratext and translational text.
    """
    tsn = _get_text_start_n(conn, doc_id)
    return conn.execute(
        """
        SELECT unit_id, n, external_id
        FROM units
        WHERE doc_id = ? AND unit_type = 'line' AND n >= ?
        ORDER BY n
        """,
        (doc_id, tsn),
    ).fetchall()


def _get_doc_title(conn: sqlite3.Connection, doc_id: int) -> str:
    row = conn.execute(
        "SELECT title FROM documents WHERE doc_id = ?", (doc_id,)
    ).fetchone()
    return row["title"] if row else f"doc_{doc_id}"


def source_changed_summary(conn: sqlite3.Connection) -> dict[str, Any]:
    """Global summary of alignment links whose pivot source changed.

    A link carries ``source_changed_at`` (non-null) when the text of its
    pivot unit changed after the link was created — typically by a curation
    apply or a Mode A undo. The aligned translation may then need review.

    Returns ``{ "total": int, "docs": [{target_doc_id, target_title, count}] }``
    with ``docs`` sorted by descending count. Pure read ; no mutation.
    """
    rows = conn.execute(
        """
        SELECT al.target_doc_id, d.title AS target_title, COUNT(*) AS cnt
        FROM alignment_links al
        LEFT JOIN documents d ON d.doc_id = al.target_doc_id
        WHERE al.source_changed_at IS NOT NULL
        GROUP BY al.target_doc_id
        ORDER BY cnt DESC, al.target_doc_id
        """
    ).fetchall()
    docs = [
        {
            "target_doc_id": r["target_doc_id"],
            "target_title": r["target_title"],
            "count": int(r["cnt"]),
        }
        for r in rows
    ]
    return {"total": sum(d["count"] for d in docs), "docs": docs}


def align_pair(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_id: int,
    run_id: str,
    debug: bool = False,
    protected_pairs: set[tuple[int, int]] | None = None,
    run_logger: Optional[logging.Logger] = None,
) -> AlignmentReport:
    """Align a single (pivot, target) document pair by external_id.

    For each external_id present in both documents (using the first unit_id when
    duplicates exist), create one row in alignment_links.

    Returns an AlignmentReport with coverage stats and diagnostics.
    """
    log = run_logger or logger
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    pivot_title = _get_doc_title(conn, pivot_doc_id)
    target_title = _get_doc_title(conn, target_doc_id)

    log.info(
        "Aligning pivot=%d (%s) â†’ target=%d (%s)",
        pivot_doc_id, pivot_title, target_doc_id, target_title,
    )

    pivot_map, pivot_dups = _load_doc_lines(conn, pivot_doc_id)
    target_map, target_dups = _load_doc_lines(conn, target_doc_id)

    pivot_ids = set(pivot_map.keys())
    target_ids = set(target_map.keys())
    common = sorted(pivot_ids & target_ids)

    report = AlignmentReport(
        pivot_doc_id=pivot_doc_id,
        target_doc_id=target_doc_id,
        pivot_title=pivot_title,
        target_title=target_title,
        pivot_line_count=len(pivot_ids),
        target_line_count=len(target_ids),
        matched=common,
        missing_in_target=sorted(pivot_ids - target_ids),
        missing_in_pivot=sorted(target_ids - pivot_ids),
        duplicates_pivot=sorted(pivot_dups),
        duplicates_target=sorted(target_dups),
    )

    # Warn about duplicates
    if pivot_dups:
        msg = f"Duplicate external_id(s) in pivot doc {pivot_doc_id}: {sorted(pivot_dups)}"
        report.warnings.append(msg)
        log.warning(msg)
    if target_dups:
        msg = f"Duplicate external_id(s) in target doc {target_doc_id}: {sorted(target_dups)}"
        report.warnings.append(msg)
        log.warning(msg)
    if report.missing_in_target:
        msg = (
            f"{len(report.missing_in_target)} external_id(s) in pivot missing from target"
        )
        report.warnings.append(msg)
        log.warning(msg)
    if report.missing_in_pivot:
        msg = (
            f"{len(report.missing_in_pivot)} external_id(s) in target missing from pivot"
        )
        report.warnings.append(msg)
        log.warning(msg)

    # Create alignment links for matched external_ids
    # When duplicates exist on either side, use the first unit_id (lowest n)
    links: list[tuple] = []
    used_pivot: set[int] = set()
    used_target: set[int] = set()
    if protected_pairs:
        for pivot_uid, target_uid in protected_pairs:
            used_pivot.add(pivot_uid)
            used_target.add(target_uid)
    protected_skipped = 0
    sample_links: list[dict[str, Any]] = []
    for eid in common:
        pivot_uid = pivot_map[eid][0]
        target_uid = target_map[eid][0]
        if pivot_uid in used_pivot or target_uid in used_target:
            protected_skipped += 1
            continue
        used_pivot.add(pivot_uid)
        used_target.add(target_uid)
        links.append((run_id, pivot_uid, target_uid, eid, pivot_doc_id, target_doc_id, utcnow))
        if debug and len(sample_links) < 20:
            sample_links.append(
                {
                    "phase": "external_id",
                    "pivot_unit_id": pivot_uid,
                    "target_unit_id": target_uid,
                    "external_id": eid,
                }
            )

    try:
        cur = conn.executemany(
            """
            INSERT OR IGNORE INTO alignment_links
                (run_id, pivot_unit_id, target_unit_id, external_id,
                 pivot_doc_id, target_doc_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            links,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    # INSERT OR IGNORE silently drops duplicate (pivot,target) pairs; count the
    # rows actually inserted, not the candidates, so a re-align without purge
    # does not report phantom links (and links_skipped stays consistent).
    report.links_created = max(int(cur.rowcount or 0), 0) if links else 0
    if protected_skipped:
        msg = f"{protected_skipped} lien(s) protÃ©gÃ©(s) ignorÃ©(s) pendant l'alignement"
        report.warnings.append(msg)
        log.info(msg)
    if debug:
        report.debug = {
            "strategy": "external_id",
            "link_sources": {"external_id": len(links), "protected_skipped": protected_skipped},
            "sample_links": sample_links,
        }
    log.info(
        "Alignment complete: %d links created (%.1f%% coverage)",
        report.links_created,
        report.coverage_pct,
    )
    return report


def align_by_external_id(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_ids: list[int],
    run_id: str,
    debug: bool = False,
    protected_pairs_by_target: dict[int, set[tuple[int, int]]] | None = None,
    run_logger: Optional[logging.Logger] = None,
) -> list[AlignmentReport]:
    """Align pivot document against one or more target documents.

    Returns a list of AlignmentReport, one per (pivot, target) pair.
    """
    reports: list[AlignmentReport] = []
    for target_doc_id in target_doc_ids:
        report = align_pair(
            conn=conn,
            pivot_doc_id=pivot_doc_id,
            target_doc_id=target_doc_id,
            run_id=run_id,
            debug=debug,
            protected_pairs=(protected_pairs_by_target or {}).get(target_doc_id),
            run_logger=run_logger,
        )
        reports.append(report)
    return reports


# ── Length-bounded (Gale–Church) strategy — R3.2 (refonte deux-grains) ─────────

def _load_length_blocks(
    conn: sqlite3.Connection, doc_id: int
) -> list[list[tuple[int, int, int]]]:
    """Ordered coarse blocks of a doc for length alignment.

    Each block is the list of its ``(unit_id, n, char_len)`` line members, paratext
    excluded. Grouping reuses ``coarse_grain.derive_coarse_blocks`` (group by
    ``parent_n`` when fine-segmented, else one line = one block), so a doc that was
    never fine-segmented degrades to line-grain blocks of a single sentence.
    Structure units contribute no line member and are dropped.
    """
    tsn = _get_text_start_n(conn, doc_id)
    rows = conn.execute(
        """
        SELECT unit_id, n, unit_type, unit_role, meta_json, text_norm
        FROM units WHERE doc_id = ? AND n >= ? ORDER BY n
        """,
        (doc_id, tsn),
    ).fetchall()
    by_n = {
        r["n"]: (r["unit_id"], r["n"], len(r["text_norm"] or ""))
        for r in rows if r["unit_type"] == "line"
    }
    units = [
        {
            "n": r["n"], "unit_type": r["unit_type"], "unit_role": r["unit_role"],
            "meta_json": r["meta_json"], "text_raw": r["text_norm"],
        }
        for r in rows
    ]
    blocks: list[list[tuple[int, int, int]]] = []
    for b in derive_coarse_blocks(units):
        members = [by_n[n] for n in b["member_ns"] if n in by_n]
        if members:
            blocks.append(members)
    return blocks


def _doc_is_fine_segmented(conn: sqlite3.Connection, doc_id: int) -> bool:
    return conn.execute(
        "SELECT 1 FROM units WHERE doc_id = ? AND unit_type = 'line'"
        " AND meta_json LIKE '%\"parent_n\"%' LIMIT 1",
        (doc_id,),
    ).fetchone() is not None


def align_pair_by_length(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_id: int,
    run_id: str,
    debug: bool = False,
    protected_pairs: set[tuple[int, int]] | None = None,
    run_logger: Optional[logging.Logger] = None,
) -> AlignmentReport:
    """Align a pair by the two-tier length-bounded (Gale–Church) strategy (R3.2).

    Paragraph tier aligns coarse blocks by total character length; the sentence tier
    then aligns the sentences *within* each 1-1 paragraph bead. An N-M sentence bead
    (1-2/2-1/2-2) is materialised as several 1-1 links sharing a ``bead_id``; ¶ and
    sentence gaps (1-0/0-1) stay orphans (no link). ``external_id`` records the pivot
    sentence's position ``n`` (design D3). Degrades to line grain when a doc is not
    fine-segmented. Honours ``protected_pairs`` (accepted links preserved).
    """
    log = run_logger or logger
    utcnow = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    pivot_title = _get_doc_title(conn, pivot_doc_id)
    target_title = _get_doc_title(conn, target_doc_id)

    pivot_blocks = _load_length_blocks(conn, pivot_doc_id)
    target_blocks = _load_length_blocks(conn, target_doc_id)

    report = AlignmentReport(
        pivot_doc_id=pivot_doc_id,
        target_doc_id=target_doc_id,
        pivot_title=pivot_title,
        target_title=target_title,
        pivot_line_count=sum(len(b) for b in pivot_blocks),
        target_line_count=sum(len(b) for b in target_blocks),
    )

    if not _doc_is_fine_segmented(conn, pivot_doc_id) or not _doc_is_fine_segmented(conn, target_doc_id):
        report.warnings.append(
            "Alignment at paragraph grain: a document is not fine-segmented "
            "(resegment to sentences for finer links)."
        )

    protected_pivots = {p for (p, _t) in protected_pairs} if protected_pairs else set()
    protected_targets = {t for (_p, t) in protected_pairs} if protected_pairs else set()

    # ── Paragraph tier ──
    para_beads = gale_church_beads(
        [sum(m[2] for m in blk) for blk in pivot_blocks],
        [sum(m[2] for m in blk) for blk in target_blocks],
    )
    para_gaps = sum(1 for pb in para_beads if not pb["a"] or not pb["b"])
    denom = max(len(pivot_blocks), len(target_blocks), 1)
    if para_gaps / denom > _PARA_UNPAIRED_WARN:
        report.warnings.append(
            f"{para_gaps}/{denom} paragraph(s) unpaired ({round(para_gaps / denom * 100)}%) — "
            "verify the two documents are translations of each other."
        )

    # ── Sentence tier (within each paragraph bead) ──
    links: list[tuple] = []
    bead_counter = 0
    protected_skipped = 0
    sample_links: list[dict[str, Any]] = []
    for pb in para_beads:
        p_sents = [s for i in pb["a"] for s in pivot_blocks[i]]
        t_sents = [s for j in pb["b"] for s in target_blocks[j]]
        if not p_sents or not t_sents:
            continue  # paragraph gap → whole side orphaned
        for sb in gale_church_beads([m[2] for m in p_sents], [m[2] for m in t_sents]):
            p_units = [p_sents[i] for i in sb["a"]]
            t_units = [t_sents[j] for j in sb["b"]]
            if not p_units or not t_units:
                continue  # sentence gap → orphan
            bead_counter += 1
            multi = len(p_units) > 1 or len(t_units) > 1
            bid = bead_counter if multi else None
            npu, ntu = len(p_units), len(t_units)
            # Materialise an N-M bead as 1-1 links: pair positionally, repeating the
            # shorter side's last unit (1-2 → p↔t1,p↔t2 ; 2-1 → p1↔t,p2↔t ; 2-2 → p1↔t1,p2↔t2).
            for k in range(max(npu, ntu)):
                pu_id, pu_n, _pl = p_units[min(k, npu - 1)]
                tu_id = t_units[min(k, ntu - 1)][0]
                if pu_id in protected_pivots or tu_id in protected_targets:
                    protected_skipped += 1
                    continue
                links.append(
                    (run_id, pu_id, tu_id, pu_n, pivot_doc_id, target_doc_id, utcnow, bid)
                )
                if debug and len(sample_links) < 20:
                    sample_links.append({
                        "phase": "length_bounded", "pivot_unit_id": pu_id,
                        "target_unit_id": tu_id, "external_id": pu_n, "bead_id": bid,
                    })

    try:
        cur = conn.executemany(
            """
            INSERT OR IGNORE INTO alignment_links
                (run_id, pivot_unit_id, target_unit_id, external_id,
                 pivot_doc_id, target_doc_id, created_at, bead_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            links,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    report.links_created = max(int(cur.rowcount or 0), 0) if links else 0
    if protected_skipped:
        msg = f"{protected_skipped} lien(s) protégé(s) ignoré(s) pendant l'alignement"
        report.warnings.append(msg)
        log.info(msg)
    if debug:
        report.debug = {
            "strategy": "length_bounded",
            "paragraph_beads": len(para_beads),
            "paragraph_gaps": para_gaps,
            "sentence_beads": bead_counter,
            "sample_links": sample_links,
        }
    log.info(
        "Length alignment complete: %d links created (%.1f%% coverage)",
        report.links_created, report.coverage_pct,
    )
    return report


def align_by_length_bounded(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_ids: list[int],
    run_id: str,
    debug: bool = False,
    protected_pairs_by_target: dict[int, set[tuple[int, int]]] | None = None,
    run_logger: Optional[logging.Logger] = None,
) -> list[AlignmentReport]:
    """Align pivot against one or more targets with the length-bounded strategy."""
    reports: list[AlignmentReport] = []
    for target_doc_id in target_doc_ids:
        reports.append(align_pair_by_length(
            conn=conn,
            pivot_doc_id=pivot_doc_id,
            target_doc_id=target_doc_id,
            run_id=run_id,
            debug=debug,
            protected_pairs=(protected_pairs_by_target or {}).get(target_doc_id),
            run_logger=run_logger,
        ))
    return reports


def align_pair_external_id_then_position(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_id: int,
    run_id: str,
    debug: bool = False,
    protected_pairs: set[tuple[int, int]] | None = None,
    run_logger: Optional[logging.Logger] = None,
) -> AlignmentReport:
    """Align by external_id first, then fill remaining lines by shared position n."""
    log = run_logger or logger
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    pivot_title = _get_doc_title(conn, pivot_doc_id)
    target_title = _get_doc_title(conn, target_doc_id)

    log.info(
        "Aligning by external_id_then_position: pivot=%d (%s) -> target=%d (%s)",
        pivot_doc_id,
        pivot_title,
        target_doc_id,
        target_title,
    )

    pivot_rows = _load_doc_line_rows(conn, pivot_doc_id)
    target_rows = _load_doc_line_rows(conn, target_doc_id)

    pivot_ext_map: dict[int, list[int]] = {}
    target_ext_map: dict[int, list[int]] = {}
    for row in pivot_rows:
        eid = row["external_id"]
        if eid is not None:
            pivot_ext_map.setdefault(eid, []).append(row["unit_id"])
    for row in target_rows:
        eid = row["external_id"]
        if eid is not None:
            target_ext_map.setdefault(eid, []).append(row["unit_id"])

    pivot_dups = sorted(eid for eid, vals in pivot_ext_map.items() if len(vals) > 1)
    target_dups = sorted(eid for eid, vals in target_ext_map.items() if len(vals) > 1)
    pivot_ext_ids = set(pivot_ext_map.keys())
    target_ext_ids = set(target_ext_map.keys())
    common_ext = sorted(pivot_ext_ids & target_ext_ids)

    report = AlignmentReport(
        pivot_doc_id=pivot_doc_id,
        target_doc_id=target_doc_id,
        pivot_title=pivot_title,
        target_title=target_title,
        pivot_line_count=len(pivot_rows),
        target_line_count=len(target_rows),
        matched=common_ext,
        missing_in_target=sorted(pivot_ext_ids - target_ext_ids),
        missing_in_pivot=sorted(target_ext_ids - pivot_ext_ids),
        duplicates_pivot=pivot_dups,
        duplicates_target=target_dups,
    )

    if pivot_dups:
        msg = f"Duplicate external_id(s) in pivot doc {pivot_doc_id}: {pivot_dups}"
        report.warnings.append(msg)
        log.warning(msg)
    if target_dups:
        msg = f"Duplicate external_id(s) in target doc {target_doc_id}: {target_dups}"
        report.warnings.append(msg)
        log.warning(msg)
    if report.missing_in_target:
        msg = f"{len(report.missing_in_target)} external_id(s) in pivot missing from target"
        report.warnings.append(msg)
        log.warning(msg)
    if report.missing_in_pivot:
        msg = f"{len(report.missing_in_pivot)} external_id(s) in target missing from pivot"
        report.warnings.append(msg)
        log.warning(msg)

    used_pivot: set[int] = set()
    used_target: set[int] = set()
    if protected_pairs:
        for pivot_uid, target_uid in protected_pairs:
            used_pivot.add(pivot_uid)
            used_target.add(target_uid)
    links: list[tuple] = []
    sample_links: list[dict[str, Any]] = []
    external_id_links = 0
    protected_skipped = 0

    # Phase 1: explicit anchor links.
    for eid in common_ext:
        pivot_uid = pivot_ext_map[eid][0]
        target_uid = target_ext_map[eid][0]
        if pivot_uid in used_pivot or target_uid in used_target:
            protected_skipped += 1
            continue
        used_pivot.add(pivot_uid)
        used_target.add(target_uid)
        links.append((run_id, pivot_uid, target_uid, eid, pivot_doc_id, target_doc_id, utcnow))
        external_id_links += 1
        if debug and len(sample_links) < 20:
            sample_links.append(
                {
                    "phase": "external_id",
                    "pivot_unit_id": pivot_uid,
                    "target_unit_id": target_uid,
                    "external_id": eid,
                }
            )

    # Phase 2: monotone position fallback for remaining lines.
    pivot_remaining = {
        row["n"]: row["unit_id"]
        for row in pivot_rows
        if row["unit_id"] not in used_pivot
    }
    target_remaining = {
        row["n"]: row["unit_id"]
        for row in target_rows
        if row["unit_id"] not in used_target
    }
    common_pos = sorted(set(pivot_remaining.keys()) & set(target_remaining.keys()))
    position_links = 0
    for n in common_pos:
        pivot_uid = pivot_remaining[n]
        target_uid = target_remaining[n]
        if pivot_uid in used_pivot or target_uid in used_target:
            protected_skipped += 1
            continue
        used_pivot.add(pivot_uid)
        used_target.add(target_uid)
        links.append((run_id, pivot_uid, target_uid, n, pivot_doc_id, target_doc_id, utcnow))
        position_links += 1
        if debug and len(sample_links) < 20:
            sample_links.append(
                {
                    "phase": "position",
                    "pivot_unit_id": pivot_uid,
                    "target_unit_id": target_uid,
                    "position": n,
                }
            )

    if links:
        try:
            cur = conn.executemany(
                """
                INSERT OR IGNORE INTO alignment_links
                    (run_id, pivot_unit_id, target_unit_id, external_id,
                     pivot_doc_id, target_doc_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                links,
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    if common_pos:
        msg = f"Position fallback created {len(common_pos)} link(s)"
        report.warnings.append(msg)
        log.info(msg)
    if protected_skipped:
        msg = f"{protected_skipped} lien(s) protÃ©gÃ©(s) ignorÃ©(s) pendant l'alignement"
        report.warnings.append(msg)
        log.info(msg)

    # INSERT OR IGNORE silently drops duplicate (pivot,target) pairs; count the
    # rows actually inserted, not the candidates, so a re-align without purge
    # does not report phantom links (and links_skipped stays consistent).
    report.links_created = max(int(cur.rowcount or 0), 0) if links else 0
    if debug:
        report.debug = {
            "strategy": "external_id_then_position",
            "link_sources": {
                "external_id": external_id_links,
                "position": position_links,
                "protected_skipped": protected_skipped,
            },
            "sample_links": sample_links,
        }
    log.info(
        "Hybrid alignment complete: %d links created (%.1f%% coverage)",
        report.links_created,
        report.coverage_pct,
    )
    return report


def align_by_external_id_then_position(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_ids: list[int],
    run_id: str,
    debug: bool = False,
    protected_pairs_by_target: dict[int, set[tuple[int, int]]] | None = None,
    run_logger: Optional[logging.Logger] = None,
) -> list[AlignmentReport]:
    """Align pivot against targets with external_id first, then position fallback."""
    reports: list[AlignmentReport] = []
    for target_doc_id in target_doc_ids:
        report = align_pair_external_id_then_position(
            conn=conn,
            pivot_doc_id=pivot_doc_id,
            target_doc_id=target_doc_id,
            run_id=run_id,
            debug=debug,
            protected_pairs=(protected_pairs_by_target or {}).get(target_doc_id),
            run_logger=run_logger,
        )
        reports.append(report)
    return reports


def _load_doc_lines_by_position(
    conn: sqlite3.Connection, doc_id: int
) -> dict[int, int]:
    """Load text line units for a doc keyed by position n.

    Returns {n: unit_id} for text units only (n >= text_start_n).
    Used for monotone fallback alignment (ADR-013).
    """
    tsn = _get_text_start_n(conn, doc_id)
    rows = conn.execute(
        """
        SELECT unit_id, n
        FROM units
        WHERE doc_id = ? AND unit_type = 'line' AND n >= ?
        ORDER BY n
        """,
        (doc_id, tsn),
    ).fetchall()
    return {row["n"]: row["unit_id"] for row in rows}


def align_pair_by_position(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_id: int,
    run_id: str,
    debug: bool = False,
    protected_pairs: set[tuple[int, int]] | None = None,
    run_logger: Optional[logging.Logger] = None,
) -> AlignmentReport:
    """Align a single (pivot, target) pair by paragraph position (n).

    Matches line units that share the same sequential position n, regardless
    of their external_id. Useful for docx_paragraphs imports where no [n]
    numbering exists, or as a fallback when external_ids don't match.

    See docs/DECISIONS.md ADR-013.
    """
    log = run_logger or logger
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    pivot_title = _get_doc_title(conn, pivot_doc_id)
    target_title = _get_doc_title(conn, target_doc_id)

    log.info(
        "Aligning by position: pivot=%d (%s) â†’ target=%d (%s)",
        pivot_doc_id, pivot_title, target_doc_id, target_title,
    )

    pivot_pos = _load_doc_lines_by_position(conn, pivot_doc_id)
    target_pos = _load_doc_lines_by_position(conn, target_doc_id)

    pivot_ns = set(pivot_pos.keys())
    target_ns = set(target_pos.keys())
    common = sorted(pivot_ns & target_ns)

    report = AlignmentReport(
        pivot_doc_id=pivot_doc_id,
        target_doc_id=target_doc_id,
        pivot_title=pivot_title,
        target_title=target_title,
        pivot_line_count=len(pivot_ns),
        target_line_count=len(target_ns),
        matched=common,
        missing_in_target=sorted(pivot_ns - target_ns),
        missing_in_pivot=sorted(target_ns - pivot_ns),
    )

    if report.missing_in_target:
        msg = f"{len(report.missing_in_target)} position(s) in pivot missing from target"
        report.warnings.append(msg)
        log.warning(msg)
    if report.missing_in_pivot:
        msg = f"{len(report.missing_in_pivot)} position(s) in target missing from pivot"
        report.warnings.append(msg)
        log.warning(msg)

    links: list[tuple] = []
    used_pivot: set[int] = set()
    used_target: set[int] = set()
    if protected_pairs:
        for pivot_uid, target_uid in protected_pairs:
            used_pivot.add(pivot_uid)
            used_target.add(target_uid)
    protected_skipped = 0
    sample_links: list[dict[str, Any]] = []
    for n in common:
        pivot_uid = pivot_pos[n]
        target_uid = target_pos[n]
        if pivot_uid in used_pivot or target_uid in used_target:
            protected_skipped += 1
            continue
        used_pivot.add(pivot_uid)
        used_target.add(target_uid)
        links.append((run_id, pivot_uid, target_uid, n, pivot_doc_id, target_doc_id, utcnow))
        if debug and len(sample_links) < 20:
            sample_links.append(
                {
                    "phase": "position",
                    "pivot_unit_id": pivot_uid,
                    "target_unit_id": target_uid,
                    "position": n,
                }
            )

    try:
        cur = conn.executemany(
            """
            INSERT OR IGNORE INTO alignment_links
                (run_id, pivot_unit_id, target_unit_id, external_id,
                 pivot_doc_id, target_doc_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            links,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    # INSERT OR IGNORE silently drops duplicate (pivot,target) pairs; count the
    # rows actually inserted, not the candidates, so a re-align without purge
    # does not report phantom links (and links_skipped stays consistent).
    report.links_created = max(int(cur.rowcount or 0), 0) if links else 0
    if protected_skipped:
        msg = f"{protected_skipped} lien(s) protÃ©gÃ©(s) ignorÃ©(s) pendant l'alignement"
        report.warnings.append(msg)
        log.info(msg)
    if debug:
        report.debug = {
            "strategy": "position",
            "link_sources": {"position": len(links), "protected_skipped": protected_skipped},
            "sample_links": sample_links,
        }
    log.info(
        "Position alignment complete: %d links created (%.1f%% coverage)",
        report.links_created, report.coverage_pct,
    )
    return report


def align_by_position(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_ids: list[int],
    run_id: str,
    debug: bool = False,
    protected_pairs_by_target: dict[int, set[tuple[int, int]]] | None = None,
    run_logger: Optional[logging.Logger] = None,
) -> list[AlignmentReport]:
    """Align pivot document against targets by paragraph position (n).

    Returns a list of AlignmentReport, one per (pivot, target) pair.
    """
    reports: list[AlignmentReport] = []
    for target_doc_id in target_doc_ids:
        report = align_pair_by_position(
            conn=conn,
            pivot_doc_id=pivot_doc_id,
            target_doc_id=target_doc_id,
            run_id=run_id,
            debug=debug,
            protected_pairs=(protected_pairs_by_target or {}).get(target_doc_id),
            run_logger=run_logger,
        )
        reports.append(report)
    return reports


def _edit_distance(s1: str, s2: str) -> int:
    """Compute Levenshtein edit distance between two strings (pure Python DP).

    Space-optimised to O(min(len(s1), len(s2))) extra memory.
    """
    if len(s1) < len(s2):
        s1, s2 = s2, s1
    if not s2:
        return len(s1)
    prev = list(range(len(s2) + 1))
    for c1 in s1:
        curr = [prev[0] + 1]
        for j, c2 in enumerate(s2):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (c1 != c2)))
        prev = curr
    return prev[-1]


def _similarity(s1: str, s2: str) -> float:
    """Normalised similarity in [0, 1]: ``1 - edit_distance / max(len(s1), len(s2))``.

    Returns 1.0 for identical strings, 0.0 for completely different strings of
    the same length.  Empty-string pairs return 1.0.
    """
    max_len = max(len(s1), len(s2))
    if max_len == 0:
        return 1.0
    return 1.0 - _edit_distance(s1, s2) / max_len


def align_pair_by_similarity(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_id: int,
    run_id: str,
    threshold: float = 0.8,
    debug: bool = False,
    protected_pairs: set[tuple[int, int]] | None = None,
    run_logger: Optional[logging.Logger] = None,
) -> AlignmentReport:
    """Align a (pivot, target) pair using character-level edit-distance similarity.

    Greedy O(P * T) matching: for each pivot line unit (in order), find the
    unmatched target unit with the highest similarity.  If the best score is
    >= *threshold*, create one alignment_link; otherwise the pivot unit is
    recorded as unmatched.

    Each target unit can only be matched once (first-come, first-served).

    See docs/DECISIONS.md ADR-018.
    """
    log = run_logger or logger
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    pivot_title = _get_doc_title(conn, pivot_doc_id)
    target_title = _get_doc_title(conn, target_doc_id)

    log.info(
        "Aligning by similarity (threshold=%.2f): pivot=%d (%s) â†’ target=%d (%s)",
        threshold, pivot_doc_id, pivot_title, target_doc_id, target_title,
    )

    pivot_tsn = _get_text_start_n(conn, pivot_doc_id)
    target_tsn = _get_text_start_n(conn, target_doc_id)

    pivot_rows = conn.execute(
        "SELECT unit_id, n, text_norm FROM units"
        " WHERE doc_id = ? AND unit_type = 'line' AND n >= ? ORDER BY n",
        (pivot_doc_id, pivot_tsn),
    ).fetchall()

    target_rows = conn.execute(
        "SELECT unit_id, text_norm FROM units"
        " WHERE doc_id = ? AND unit_type = 'line' AND n >= ? ORDER BY n",
        (target_doc_id, target_tsn),
    ).fetchall()

    if len(pivot_rows) > _MAX_SIMILARITY_UNITS or len(target_rows) > _MAX_SIMILARITY_UNITS:
        raise ValueError(
            f"align_pair_by_similarity: document too large for similarity alignment "
            f"(pivot={len(pivot_rows)}, target={len(target_rows)}, max={_MAX_SIMILARITY_UNITS}). "
            "Use position-based or external-id alignment instead."
        )

    report = AlignmentReport(
        pivot_doc_id=pivot_doc_id,
        target_doc_id=target_doc_id,
        pivot_title=pivot_title,
        target_title=target_title,
        pivot_line_count=len(pivot_rows),
        target_line_count=len(target_rows),
    )

    used_target: set[int] = set()
    protected_pivot: set[int] = set()
    if protected_pairs:
        for pivot_uid, target_uid in protected_pairs:
            protected_pivot.add(pivot_uid)
            used_target.add(target_uid)
    protected_skipped = 0
    links: list[tuple] = []
    sample_links: list[dict[str, Any]] = []
    matched_scores: list[float] = []

    for p_row in pivot_rows:
        p_uid = p_row["unit_id"]
        if p_uid in protected_pivot:
            protected_skipped += 1
            continue
        p_text = p_row["text_norm"] or ""
        best_score = -1.0
        best_t_uid: Optional[int] = None

        for t_row in target_rows:
            t_uid = t_row["unit_id"]
            if t_uid in used_target:
                continue
            t_text = t_row["text_norm"] or ""
            score = _similarity(p_text, t_text)
            if score > best_score:
                best_score = score
                best_t_uid = t_uid

        if best_t_uid is not None and best_score >= threshold:
            used_target.add(best_t_uid)
            links.append(
                (run_id, p_uid, best_t_uid, p_row["n"], pivot_doc_id, target_doc_id, utcnow)
            )
            report.matched.append(p_uid)
            matched_scores.append(best_score)
            if debug and len(sample_links) < 20:
                sample_links.append(
                    {
                        "phase": "similarity",
                        "pivot_unit_id": p_uid,
                        "target_unit_id": best_t_uid,
                        "score": round(best_score, 4),
                    }
                )
        else:
            report.missing_in_target.append(p_uid)

    if links:
        try:
            cur = conn.executemany(
                """
                INSERT OR IGNORE INTO alignment_links
                    (run_id, pivot_unit_id, target_unit_id, external_id,
                     pivot_doc_id, target_doc_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                links,
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    # INSERT OR IGNORE silently drops duplicate (pivot,target) pairs; count the
    # rows actually inserted, not the candidates, so a re-align without purge
    # does not report phantom links (and links_skipped stays consistent).
    report.links_created = max(int(cur.rowcount or 0), 0) if links else 0
    if report.missing_in_target:
        msg = (
            f"{len(report.missing_in_target)} pivot unit(s) unmatched"
            f" (similarity < {threshold})"
        )
        report.warnings.append(msg)
        log.warning(msg)
    if debug:
        if matched_scores:
            score_min = min(matched_scores)
            score_max = max(matched_scores)
            score_mean = sum(matched_scores) / len(matched_scores)
            similarity_stats: dict[str, Any] = {
                "matched_count": len(matched_scores),
                "score_min": round(score_min, 4),
                "score_max": round(score_max, 4),
                "score_mean": round(score_mean, 4),
            }
        else:
            similarity_stats = {"matched_count": 0}
        report.debug = {
            "strategy": "similarity",
            "threshold": threshold,
            "link_sources": {"similarity": len(links), "protected_skipped": protected_skipped},
            "similarity_stats": similarity_stats,
            "sample_links": sample_links,
        }
    if protected_skipped:
        msg = f"{protected_skipped} lien(s) protÃ©gÃ©(s) ignorÃ©(s) pendant l'alignement"
        report.warnings.append(msg)
        log.info(msg)

    log.info(
        "Similarity alignment complete: %d links created (%.1f%% coverage)",
        report.links_created,
        report.coverage_pct,
    )
    return report


def align_by_similarity(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_ids: list[int],
    run_id: str,
    threshold: float = 0.8,
    debug: bool = False,
    protected_pairs_by_target: dict[int, set[tuple[int, int]]] | None = None,
    run_logger: Optional[logging.Logger] = None,
) -> list[AlignmentReport]:
    """Align pivot against one or more targets using edit-distance similarity.

    Returns one AlignmentReport per (pivot, target) pair.
    """
    reports: list[AlignmentReport] = []
    for target_doc_id in target_doc_ids:
        report = align_pair_by_similarity(
            conn=conn,
            pivot_doc_id=pivot_doc_id,
            target_doc_id=target_doc_id,
            run_id=run_id,
            threshold=threshold,
            debug=debug,
            protected_pairs=(protected_pairs_by_target or {}).get(target_doc_id),
            run_logger=run_logger,
        )
        reports.append(report)
    return reports


def add_doc_relation(
    conn: sqlite3.Connection,
    doc_id: int,
    relation_type: str,
    target_doc_id: int,
    note: Optional[str] = None,
) -> int:
    """Insert a doc_relations row and return its id."""
    allowed = {"translation_of", "excerpt_of"}
    if relation_type not in allowed:
        raise ValueError(
            f"relation_type must be one of {allowed}, got {relation_type!r}"
        )
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    cur = conn.execute(
        """
        INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, note, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (doc_id, relation_type, target_doc_id, note, utcnow),
    )
    conn.commit()
    return cur.lastrowid

