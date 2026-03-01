"""Alignment engine — external_id / position / similarity strategies.

Creates unit-level 1-1 links between a pivot document and one or more target
documents, matching on shared external_id values.

See docs/DECISIONS.md ADR-007.
Charter section 9: align_by_external_id.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


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
    """Load all line units for a doc.

    Returns:
        (ext_id_to_unit_ids, duplicate_ext_ids)
        ext_id_to_unit_ids: {external_id: [unit_id, ...]}  (list because dups possible)
        duplicate_ext_ids: external_ids that appear more than once
    """
    rows = conn.execute(
        """
        SELECT unit_id, external_id
        FROM units
        WHERE doc_id = ? AND unit_type = 'line' AND external_id IS NOT NULL
        ORDER BY n
        """,
        (doc_id,),
    ).fetchall()

    ext_map: dict[int, list[int]] = {}
    for row in rows:
        uid = row["unit_id"]
        eid = row["external_id"]
        ext_map.setdefault(eid, []).append(uid)

    duplicates = [eid for eid, uids in ext_map.items() if len(uids) > 1]
    return ext_map, duplicates


def _load_doc_line_rows(conn: sqlite3.Connection, doc_id: int) -> list[sqlite3.Row]:
    """Load all line units for a doc with unit_id, n, external_id."""
    return conn.execute(
        """
        SELECT unit_id, n, external_id
        FROM units
        WHERE doc_id = ? AND unit_type = 'line'
        ORDER BY n
        """,
        (doc_id,),
    ).fetchall()


def _get_doc_title(conn: sqlite3.Connection, doc_id: int) -> str:
    row = conn.execute(
        "SELECT title FROM documents WHERE doc_id = ?", (doc_id,)
    ).fetchone()
    return row["title"] if row else f"doc_{doc_id}"


def align_pair(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_id: int,
    run_id: str,
    debug: bool = False,
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
        "Aligning pivot=%d (%s) → target=%d (%s)",
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
    sample_links: list[dict[str, Any]] = []
    for eid in common:
        pivot_uid = pivot_map[eid][0]
        target_uid = target_map[eid][0]
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

    conn.executemany(
        """
        INSERT INTO alignment_links
            (run_id, pivot_unit_id, target_unit_id, external_id,
             pivot_doc_id, target_doc_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        links,
    )
    conn.commit()

    report.links_created = len(links)
    if debug:
        report.debug = {
            "strategy": "external_id",
            "link_sources": {"external_id": len(links)},
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
            run_logger=run_logger,
        )
        reports.append(report)
    return reports


def align_pair_external_id_then_position(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_id: int,
    run_id: str,
    debug: bool = False,
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
    links: list[tuple] = []
    sample_links: list[dict[str, Any]] = []
    external_id_links = 0

    # Phase 1: explicit anchor links.
    for eid in common_ext:
        pivot_uid = pivot_ext_map[eid][0]
        target_uid = target_ext_map[eid][0]
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
        conn.executemany(
            """
            INSERT INTO alignment_links
                (run_id, pivot_unit_id, target_unit_id, external_id,
                 pivot_doc_id, target_doc_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            links,
        )
        conn.commit()

    if common_pos:
        msg = f"Position fallback created {len(common_pos)} link(s)"
        report.warnings.append(msg)
        log.info(msg)

    report.links_created = len(links)
    if debug:
        report.debug = {
            "strategy": "external_id_then_position",
            "link_sources": {
                "external_id": external_id_links,
                "position": position_links,
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
            run_logger=run_logger,
        )
        reports.append(report)
    return reports


def _load_doc_lines_by_position(
    conn: sqlite3.Connection, doc_id: int
) -> dict[int, int]:
    """Load line units for a doc keyed by position n.

    Returns {n: unit_id} for all unit_type='line' rows.
    Used for monotone fallback alignment (ADR-013).
    """
    rows = conn.execute(
        """
        SELECT unit_id, n
        FROM units
        WHERE doc_id = ? AND unit_type = 'line'
        ORDER BY n
        """,
        (doc_id,),
    ).fetchall()
    return {row["n"]: row["unit_id"] for row in rows}


def align_pair_by_position(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_id: int,
    run_id: str,
    debug: bool = False,
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
        "Aligning by position: pivot=%d (%s) → target=%d (%s)",
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
    sample_links: list[dict[str, Any]] = []
    for n in common:
        pivot_uid = pivot_pos[n]
        target_uid = target_pos[n]
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

    conn.executemany(
        """
        INSERT INTO alignment_links
            (run_id, pivot_unit_id, target_unit_id, external_id,
             pivot_doc_id, target_doc_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        links,
    )
    conn.commit()

    report.links_created = len(links)
    if debug:
        report.debug = {
            "strategy": "position",
            "link_sources": {"position": len(links)},
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
        "Aligning by similarity (threshold=%.2f): pivot=%d (%s) → target=%d (%s)",
        threshold, pivot_doc_id, pivot_title, target_doc_id, target_title,
    )

    pivot_rows = conn.execute(
        "SELECT unit_id, n, text_norm FROM units WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
        (pivot_doc_id,),
    ).fetchall()

    target_rows = conn.execute(
        "SELECT unit_id, text_norm FROM units WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
        (target_doc_id,),
    ).fetchall()

    report = AlignmentReport(
        pivot_doc_id=pivot_doc_id,
        target_doc_id=target_doc_id,
        pivot_title=pivot_title,
        target_title=target_title,
        pivot_line_count=len(pivot_rows),
        target_line_count=len(target_rows),
    )

    used_target: set[int] = set()
    links: list[tuple] = []
    sample_links: list[dict[str, Any]] = []
    matched_scores: list[float] = []

    for p_row in pivot_rows:
        p_uid = p_row["unit_id"]
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
        conn.executemany(
            """
            INSERT INTO alignment_links
                (run_id, pivot_unit_id, target_unit_id, external_id,
                 pivot_doc_id, target_doc_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            links,
        )
        conn.commit()

    report.links_created = len(links)
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
            "link_sources": {"similarity": len(links)},
            "similarity_stats": similarity_stats,
            "sample_links": sample_links,
        }

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
