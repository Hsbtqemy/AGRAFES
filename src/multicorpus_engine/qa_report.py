"""Corpus QA Report generator.

Produces a structured report (dict → JSON or HTML) covering:
1. Import integrity: external_id holes/duplicates per document
2. Unit quality: empty units, suspicious unicode, long lines
3. Alignment QA: coverage/orphans/collision counts per pivot-target pair
4. TEI readiness: missing required metadata fields + relations sanity

CLI usage (see cli.py):
    multicorpus qa-report --db corpus.db --out report.json --format json
    multicorpus qa-report --db corpus.db --out report.html --format html

Zero stderr output. All findings returned as structured data.
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from pathlib import Path
from typing import Optional


# ── Constants ─────────────────────────────────────────────────────────────────

LONG_LINE_THRESHOLD = 2000       # characters; flags suspiciously long units
SUSPICIOUS_UNICODE_PATTERN = re.compile(
    r"[\ufffd\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]"
)
REQUIRED_META_FIELDS = ("title", "language")


# ── Checks ────────────────────────────────────────────────────────────────────

def _check_import_integrity(conn: sqlite3.Connection, doc_id: int) -> dict:
    """Return hole/duplicate/empty-unit diagnostics for one document."""
    from multicorpus_engine.importers.docx_numbered_lines import _analyze_external_ids

    rows = conn.execute(
        "SELECT external_id, text_norm FROM units WHERE doc_id=? AND unit_type='line' ORDER BY n",
        (doc_id,),
    ).fetchall()

    external_ids = [r[0] for r in rows if r[0] is not None]
    duplicates, holes, non_monotonic = _analyze_external_ids(external_ids) if external_ids else ([], [], [])

    empty_units = [r[0] for r in rows if not (r[1] or "").strip()]
    long_units = [r[0] for r in rows if len(r[1] or "") > LONG_LINE_THRESHOLD]
    suspicious = [r[0] for r in rows if SUSPICIOUS_UNICODE_PATTERN.search(r[1] or "")]

    severity = "ok"
    if duplicates or empty_units:
        severity = "warning"
    if len(holes) > len(external_ids) * 0.2 and holes:  # >20% holes → error
        severity = "error"

    return {
        "doc_id": doc_id,
        "line_unit_count": len(rows),
        "external_id_holes": holes[:50],        # cap for readability
        "external_id_duplicates": duplicates,
        "non_monotonic_ids": non_monotonic[:10],
        "empty_unit_ext_ids": empty_units[:20],
        "long_unit_ext_ids": long_units[:10],
        "suspicious_unicode_ext_ids": suspicious[:10],
        "severity": severity,
    }


def _check_metadata_readiness(conn: sqlite3.Connection, doc_id: int) -> dict:
    """Check required metadata fields for TEI export readiness."""
    row = conn.execute(
        "SELECT title, language, doc_role, resource_type, meta_json FROM documents WHERE doc_id=?",
        (doc_id,),
    ).fetchone()
    if row is None:
        return {"doc_id": doc_id, "missing": ["doc_id not found"], "severity": "error"}

    missing = []
    if not (row["title"] or "").strip():
        missing.append("title")
    if not (row["language"] or "").strip():
        missing.append("language")

    warnings = []
    if not (row["doc_role"] or "").strip() or row["doc_role"] == "standalone":
        warnings.append("doc_role is 'standalone' (may be intentional)")
    if not (row["resource_type"] or "").strip():
        warnings.append("resource_type not set")

    # Check relations sanity: target_doc_id must exist
    relation_issues = []
    rels = conn.execute(
        "SELECT id, relation_type, target_doc_id FROM doc_relations WHERE doc_id=?",
        (doc_id,),
    ).fetchall()
    for rel in rels:
        tgt = conn.execute("SELECT 1 FROM documents WHERE doc_id=?", (rel[2],)).fetchone()
        if tgt is None:
            relation_issues.append(f"target_doc_id={rel[2]} (relation {rel[1]}) does not exist")

    severity = "ok"
    if missing:
        severity = "error"
    elif warnings or relation_issues:
        severity = "warning"

    return {
        "doc_id": doc_id,
        "title": row["title"],
        "language": row["language"],
        "doc_role": row["doc_role"],
        "resource_type": row["resource_type"],
        "missing_fields": missing,
        "warnings": warnings,
        "relation_issues": relation_issues,
        "severity": severity,
    }


def _check_alignment_pairs(conn: sqlite3.Connection) -> list[dict]:
    """Aggregate QA for each pivot-target alignment pair."""
    try:
        pairs = conn.execute(
            """
            SELECT pivot_doc_id, target_doc_id, COUNT(*) AS total_links,
                   COUNT(DISTINCT pivot_unit_id) AS covered_pivot,
                   COUNT(DISTINCT target_unit_id) AS covered_target,
                   SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS n_accepted,
                   SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS n_rejected,
                   SUM(CASE WHEN status IS NULL THEN 1 ELSE 0 END) AS n_unreviewed
            FROM alignment_links
            GROUP BY pivot_doc_id, target_doc_id
            """,
        ).fetchall()
    except Exception:
        return []

    results = []
    for row in pairs:
        piv_id, tgt_id = row[0], row[1]
        total = row[2]

        # Count pivot line units
        piv_total = conn.execute(
            "SELECT COUNT(*) FROM units WHERE doc_id=? AND unit_type='line'",
            (piv_id,),
        ).fetchone()[0] or 0
        tgt_total = conn.execute(
            "SELECT COUNT(*) FROM units WHERE doc_id=? AND unit_type='line'",
            (tgt_id,),
        ).fetchone()[0] or 0

        coverage_pivot = round(row[3] / piv_total * 100, 1) if piv_total else 0.0
        coverage_target = round(row[4] / tgt_total * 100, 1) if tgt_total else 0.0

        orphan_pivot = piv_total - row[3]
        orphan_target = tgt_total - row[4]

        # Collision count: pivot units linked to >1 target
        try:
            collisions = conn.execute(
                """SELECT COUNT(*) FROM (
                    SELECT pivot_unit_id FROM alignment_links
                    WHERE pivot_doc_id=? AND target_doc_id=?
                    GROUP BY pivot_unit_id HAVING COUNT(*)>1)""",
                (piv_id, tgt_id),
            ).fetchone()[0] or 0
        except Exception:
            collisions = 0

        severity = "ok"
        if collisions > 0:
            severity = "warning"
        if coverage_pivot < 50.0 and piv_total > 0:
            severity = "error"

        results.append({
            "pivot_doc_id": piv_id,
            "target_doc_id": tgt_id,
            "total_links": total,
            "n_accepted": row[5] or 0,
            "n_rejected": row[6] or 0,
            "n_unreviewed": row[7] or 0,
            "covered_pivot": row[3],
            "covered_target": row[4],
            "orphan_pivot_units": orphan_pivot,
            "orphan_target_units": orphan_target,
            "coverage_pivot_pct": coverage_pivot,
            "coverage_target_pct": coverage_target,
            "collisions": collisions,
            "severity": severity,
        })
    return results


# ── Report assembly ───────────────────────────────────────────────────────────

def generate_qa_report(
    conn: sqlite3.Connection,
    doc_ids: Optional[list[int]] = None,
) -> dict:
    """Generate a QA report for the corpus or a subset of documents.

    Returns:
        Structured dict with:
        - summary: {total_docs, docs_ok, docs_warning, docs_error, align_pairs_checked}
        - import_integrity: list of per-doc checks
        - metadata_readiness: list of per-doc checks
        - alignment_qa: list of per-pair checks
        - gates: {blocking, warnings} — for UI traffic-light display
    """
    import datetime

    if doc_ids is None:
        doc_ids = [
            r[0] for r in conn.execute("SELECT doc_id FROM documents ORDER BY doc_id")
        ]

    import_checks = [_check_import_integrity(conn, d) for d in doc_ids]
    meta_checks = [_check_metadata_readiness(conn, d) for d in doc_ids]
    align_checks = _check_alignment_pairs(conn)

    # Summary
    docs_ok = sum(1 for c in import_checks if c["severity"] == "ok")
    docs_warning = sum(1 for c in import_checks if c["severity"] == "warning")
    docs_error = sum(1 for c in import_checks if c["severity"] == "error")

    meta_ok = sum(1 for c in meta_checks if c["severity"] == "ok")
    meta_warning = sum(1 for c in meta_checks if c["severity"] == "warning")
    meta_error = sum(1 for c in meta_checks if c["severity"] == "error")

    align_warning = sum(1 for a in align_checks if a["severity"] == "warning")
    align_error = sum(1 for a in align_checks if a["severity"] == "error")

    # Gate categories
    blocking: list[str] = []
    warnings_gate: list[str] = []

    if docs_error > 0:
        blocking.append(f"{docs_error} document(s) with import integrity errors")
    if meta_error > 0:
        blocking.append(f"{meta_error} document(s) missing required metadata (title/language)")
    if align_error > 0:
        blocking.append(f"{align_error} alignment pair(s) with <50% coverage")

    if docs_warning > 0:
        warnings_gate.append(f"{docs_warning} document(s) with import warnings (holes/duplicates)")
    if meta_warning > 0:
        warnings_gate.append(f"{meta_warning} document(s) with optional metadata missing")
    if align_warning > 0:
        warnings_gate.append(f"{align_warning} alignment pair(s) with collisions")

    gate_status = "ok" if not blocking and not warnings_gate else (
        "blocking" if blocking else "warning"
    )

    return {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "doc_count": len(doc_ids),
        "summary": {
            "import_ok": docs_ok,
            "import_warning": docs_warning,
            "import_error": docs_error,
            "meta_ok": meta_ok,
            "meta_warning": meta_warning,
            "meta_error": meta_error,
            "align_pairs_checked": len(align_checks),
            "align_warning": align_warning,
            "align_error": align_error,
        },
        "gates": {
            "status": gate_status,
            "blocking": blocking,
            "warnings": warnings_gate,
        },
        "import_integrity": import_checks,
        "metadata_readiness": meta_checks,
        "alignment_qa": align_checks,
    }


# ── HTML renderer ─────────────────────────────────────────────────────────────

def render_qa_report_html(report: dict) -> str:
    """Render a QA report dict as a self-contained HTML document."""

    def _severity_badge(sev: str) -> str:
        colors = {"ok": ("#1a7f4e", "#d1fae5"), "warning": ("#b8590a", "#fff3cd"), "error": ("#c0392b", "#fde8e8")}
        icons = {"ok": "✓", "warning": "⚠", "error": "✗"}
        fg, bg = colors.get(sev, ("#6c757d", "#f8f9fa"))
        return f'<span style="background:{bg};color:{fg};padding:2px 8px;border-radius:10px;font-size:0.78rem;font-weight:600">{icons.get(sev,"?")} {sev}</span>'

    gates = report.get("gates", {})
    gate_status = gates.get("status", "ok")
    gate_color = {"ok": "#1a7f4e", "warning": "#b8590a", "blocking": "#c0392b"}.get(gate_status, "#6c757d")
    gate_bg = {"ok": "#d1fae5", "warning": "#fff3cd", "blocking": "#fde8e8"}.get(gate_status, "#f8f9fa")
    gate_icon = {"ok": "🟢", "warning": "🟡", "blocking": "🔴"}.get(gate_status, "⚪")
    gate_label = {"ok": "Prêt pour publication", "warning": "Avertissements — vérifier avant publication", "blocking": "Bloquant — corrections requises"}.get(gate_status, gate_status)

    blocking_html = "".join(f"<li style='color:#c0392b'>{b}</li>" for b in gates.get("blocking", []))
    warnings_html = "".join(f"<li style='color:#b8590a'>{w}</li>" for w in gates.get("warnings", []))

    summary = report.get("summary", {})

    def _import_rows() -> str:
        rows = ""
        for c in report.get("import_integrity", []):
            rows += f"""<tr>
              <td>#{c['doc_id']}</td>
              <td>{c['line_unit_count']}</td>
              <td>{len(c.get('external_id_holes',[]))}</td>
              <td>{len(c.get('external_id_duplicates',[]))}</td>
              <td>{len(c.get('empty_unit_ext_ids',[]))}</td>
              <td>{len(c.get('long_unit_ext_ids',[]))}</td>
              <td>{_severity_badge(c['severity'])}</td>
            </tr>"""
        return rows

    def _meta_rows() -> str:
        rows = ""
        for c in report.get("metadata_readiness", []):
            rows += f"""<tr>
              <td>#{c['doc_id']}</td>
              <td>{c.get('title','')[:40] or '<em style="color:#c0392b">manquant</em>'}</td>
              <td>{c.get('language','') or '<em style="color:#c0392b">manquant</em>'}</td>
              <td>{', '.join(c.get('missing_fields',[])) or '—'}</td>
              <td>{_severity_badge(c['severity'])}</td>
            </tr>"""
        return rows

    def _align_rows() -> str:
        rows = ""
        for a in report.get("alignment_qa", []):
            rows += f"""<tr>
              <td>#{a['pivot_doc_id']}</td>
              <td>#{a['target_doc_id']}</td>
              <td>{a['total_links']}</td>
              <td>{a['coverage_pivot_pct']}%</td>
              <td>{a['coverage_target_pct']}%</td>
              <td>{a['orphan_pivot_units']}</td>
              <td>{a['collisions']}</td>
              <td>{a['n_accepted']}/{a['n_unreviewed']}/{a['n_rejected']}</td>
              <td>{_severity_badge(a['severity'])}</td>
            </tr>"""
        return rows or "<tr><td colspan='9' style='color:#6c757d;font-style:italic'>Aucun alignement trouvé</td></tr>"

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>AGRAFES — Rapport QA Corpus</title>
<style>
  body {{ font-family: system-ui, -apple-system, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; color: #1a1a2e; }}
  h1 {{ font-size: 1.5rem; margin: 0 0 0.5rem; }}
  h2 {{ font-size: 1.1rem; margin: 2rem 0 0.75rem; border-bottom: 2px solid #dde1e8; padding-bottom: 0.3rem; }}
  .gate-banner {{ background:{gate_bg};border:1px solid;border-radius:8px;padding:1rem 1.25rem;margin:1rem 0;display:flex;align-items:center;gap:0.75rem;font-weight:600 }}
  table {{ width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-bottom: 1rem; }}
  th {{ background: #f0f2f5; text-align: left; padding: 6px 8px; border-bottom: 2px solid #dde1e8; font-weight: 600; }}
  td {{ padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: middle; }}
  tr:hover td {{ background: #f8f9fa; }}
  .stat {{ display:inline-block;background:#f0f2f5;border-radius:4px;padding:4px 10px;margin:2px;font-size:0.82rem }}
</style>
</head>
<body>
<h1>📋 Rapport QA Corpus — AGRAFES</h1>
<p style="color:#6c757d;font-size:0.85rem">Généré: {report.get('generated_at','')} · {report.get('doc_count',0)} document(s)</p>

<div class="gate-banner" style="border-color:{gate_color};color:{gate_color}">
  <span style="font-size:1.5rem">{gate_icon}</span>
  <div>
    <div>{gate_label}</div>
    {'<ul style="margin:0.5rem 0 0 1rem;font-weight:400">' + blocking_html + warnings_html + '</ul>' if blocking_html or warnings_html else ''}
  </div>
</div>

<h2>Résumé</h2>
<div>
  <span class="stat">Import OK: {summary.get('import_ok',0)}</span>
  <span class="stat">Import ⚠: {summary.get('import_warning',0)}</span>
  <span class="stat">Import ✗: {summary.get('import_error',0)}</span>
  <span class="stat">Méta OK: {summary.get('meta_ok',0)}</span>
  <span class="stat">Méta ⚠: {summary.get('meta_warning',0)}</span>
  <span class="stat">Méta ✗: {summary.get('meta_error',0)}</span>
  <span class="stat">Paires align: {summary.get('align_pairs_checked',0)}</span>
</div>

<h2>Intégrité import</h2>
<table>
  <thead><tr><th>Doc</th><th>Unités</th><th>Trous</th><th>Doublons</th><th>Vides</th><th>Longues</th><th>Statut</th></tr></thead>
  <tbody>{_import_rows()}</tbody>
</table>

<h2>Préparation TEI (métadonnées)</h2>
<table>
  <thead><tr><th>Doc</th><th>Titre</th><th>Langue</th><th>Champs manquants</th><th>Statut</th></tr></thead>
  <tbody>{_meta_rows()}</tbody>
</table>

<h2>Qualité des alignements</h2>
<table>
  <thead><tr><th>Pivot</th><th>Cible</th><th>Liens</th><th>Couv. pivot</th><th>Couv. cible</th><th>Orphelins</th><th>Collisions</th><th>A/NR/R</th><th>Statut</th></tr></thead>
  <tbody>{_align_rows()}</tbody>
</table>
</body>
</html>"""


# ── File output ────────────────────────────────────────────────────────────────

def write_qa_report(
    conn: sqlite3.Connection,
    output_path: str | Path,
    fmt: str = "json",
    doc_ids: Optional[list[int]] = None,
) -> dict:
    """Generate and write a QA report to a file.

    Args:
        conn: SQLite connection.
        output_path: Destination file path.
        fmt: "json" or "html".
        doc_ids: Subset of doc_ids (None = all).

    Returns:
        The report dict.
    """
    import json as _json

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    report = generate_qa_report(conn, doc_ids=doc_ids)

    if fmt == "html":
        output_path.write_text(render_qa_report_html(report), encoding="utf-8")
    else:
        output_path.write_text(
            _json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    return report
