"""Database diagnostics helpers.

Collects operational health signals from a project SQLite DB without mutating
domain data. Intended for local debugging and CI sanity checks.
"""

from __future__ import annotations

import sqlite3


def _count(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> int:
    row = conn.execute(sql, params).fetchone()
    return int(row[0]) if row is not None else 0


def collect_diagnostics(conn: sqlite3.Connection) -> dict:
    """Return a JSON-serialisable diagnostics report for a corpus DB."""
    integrity_row = conn.execute("PRAGMA integrity_check").fetchone()
    integrity = str(integrity_row[0]) if integrity_row is not None else "unknown"

    versions = [
        int(row["version"])
        for row in conn.execute("SELECT version FROM schema_migrations ORDER BY version")
    ]

    documents_count = _count(conn, "SELECT COUNT(*) FROM documents")
    units_count = _count(conn, "SELECT COUNT(*) FROM units")
    line_units = _count(conn, "SELECT COUNT(*) FROM units WHERE unit_type = 'line'")
    structure_units = _count(conn, "SELECT COUNT(*) FROM units WHERE unit_type = 'structure'")
    runs_count = _count(conn, "SELECT COUNT(*) FROM runs")
    alignment_links = _count(conn, "SELECT COUNT(*) FROM alignment_links")
    fts_rows = _count(conn, "SELECT COUNT(*) FROM fts_units")

    missing_line_units = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM units u
        LEFT JOIN fts_units f ON f.rowid = u.unit_id
        WHERE u.unit_type = 'line' AND f.rowid IS NULL
        """,
    )
    orphan_fts_rows = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM fts_units f
        LEFT JOIN units u ON u.unit_id = f.rowid
        WHERE u.unit_id IS NULL OR u.unit_type != 'line'
        """,
    )
    fts_row_delta = fts_rows - line_units
    fts_stale = (
        missing_line_units > 0
        or orphan_fts_rows > 0
        or fts_row_delta != 0
    )

    runs_without_stats = _count(
        conn,
        "SELECT COUNT(*) FROM runs WHERE stats_json IS NULL OR TRIM(stats_json) = ''",
    )
    runs_by_kind = {
        str(row["kind"]): int(row["n"])
        for row in conn.execute(
            "SELECT kind, COUNT(*) AS n FROM runs GROUP BY kind ORDER BY kind"
        ).fetchall()
    }

    pivot_dangling = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM alignment_links a
        LEFT JOIN units u ON u.unit_id = a.pivot_unit_id
        WHERE u.unit_id IS NULL
        """,
    )
    target_dangling = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM alignment_links a
        LEFT JOIN units u ON u.unit_id = a.target_unit_id
        WHERE u.unit_id IS NULL
        """,
    )
    pivot_doc_mismatch = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM alignment_links a
        JOIN units u ON u.unit_id = a.pivot_unit_id
        WHERE u.doc_id != a.pivot_doc_id
        """,
    )
    target_doc_mismatch = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM alignment_links a
        JOIN units u ON u.unit_id = a.target_unit_id
        WHERE u.doc_id != a.target_doc_id
        """,
    )
    self_links = _count(
        conn,
        "SELECT COUNT(*) FROM alignment_links WHERE pivot_doc_id = target_doc_id",
    )

    missing_required_fields = _count(
        conn,
        "SELECT COUNT(*) FROM documents WHERE TRIM(title) = '' OR TRIM(language) = ''",
    )
    docs_without_line_units = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM documents d
        WHERE NOT EXISTS (
            SELECT 1 FROM units u
            WHERE u.doc_id = d.doc_id AND u.unit_type = 'line'
        )
        """,
    )

    issues: list[str] = []
    if integrity != "ok":
        issues.append(f"SQLite integrity_check returned: {integrity}")
    if fts_stale:
        issues.append("FTS appears stale or inconsistent with line units")
    if runs_without_stats > 0:
        issues.append(f"{runs_without_stats} run(s) have empty stats_json")
    if pivot_dangling > 0 or target_dangling > 0:
        issues.append(
            f"Dangling alignment links found (pivot={pivot_dangling}, target={target_dangling})"
        )
    if pivot_doc_mismatch > 0 or target_doc_mismatch > 0:
        issues.append(
            "Alignment link doc_id mismatch found "
            f"(pivot={pivot_doc_mismatch}, target={target_doc_mismatch})"
        )
    if self_links > 0:
        issues.append(f"{self_links} self-link(s) detected in alignment_links")
    if missing_required_fields > 0:
        issues.append(
            f"{missing_required_fields} document(s) have missing required title/language"
        )
    if docs_without_line_units > 0:
        issues.append(f"{docs_without_line_units} document(s) have no line units")

    status = "ok"
    if integrity != "ok":
        status = "error"
    elif issues:
        status = "warning"

    return {
        "status": status,
        "issues": issues,
        "integrity": {"ok": integrity == "ok", "value": integrity},
        "schema": {
            "versions_applied": versions,
            "current_version": versions[-1] if versions else None,
        },
        "counts": {
            "documents": documents_count,
            "units_total": units_count,
            "line_units": line_units,
            "structure_units": structure_units,
            "runs": runs_count,
            "alignment_links": alignment_links,
            "fts_rows": fts_rows,
        },
        "fts": {
            "row_delta_vs_line_units": fts_row_delta,
            "missing_line_units": missing_line_units,
            "orphan_rows": orphan_fts_rows,
            "stale": fts_stale,
        },
        "runs": {
            "by_kind": runs_by_kind,
            "without_stats": runs_without_stats,
        },
        "alignment": {
            "dangling_pivot_units": pivot_dangling,
            "dangling_target_units": target_dangling,
            "pivot_doc_mismatch": pivot_doc_mismatch,
            "target_doc_mismatch": target_doc_mismatch,
            "self_links": self_links,
        },
        "metadata": {
            "missing_required_fields": missing_required_fields,
            "docs_without_line_units": docs_without_line_units,
        },
    }

