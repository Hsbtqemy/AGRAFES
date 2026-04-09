"""CoNLL-U exporter for token-annotated corpora.

Exports selected documents (or all documents) to a single CoNLL-U file using
the token rows stored in ``tokens``.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def _safe_comment_value(value: object) -> str:
    text = "" if value is None else str(value)
    return text.replace("\r", " ").replace("\n", " ").strip()


def _conllu_field(value: object) -> str:
    if value is None:
        return "_"
    txt = str(value).strip()
    return txt if txt else "_"


def export_conllu(
    conn: sqlite3.Connection,
    output_path: str | Path,
    *,
    doc_ids: list[int] | None = None,
) -> dict[str, object]:
    """Export token annotations as CoNLL-U.

    Args:
        conn: Open SQLite connection.
        output_path: Destination ``.conllu`` file path.
        doc_ids: Optional list of document ids to export. ``None`` means all docs.

    Returns:
        Export summary with counters.
    """
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    doc_params: list[object] = []
    doc_where = ""
    if doc_ids is not None:
        if len(doc_ids) == 0:
            out.write_text("", encoding="utf-8")
            return {
                "out_path": str(out),
                "docs_written": 0,
                "sentences_written": 0,
                "tokens_written": 0,
            }
        placeholders = ",".join("?" * len(doc_ids))
        doc_where = f"WHERE d.doc_id IN ({placeholders})"
        doc_params.extend(doc_ids)

    doc_rows = conn.execute(
        f"""
        SELECT d.doc_id, d.title, d.language
        FROM documents d
        {doc_where}
        ORDER BY d.doc_id
        """,
        doc_params,
    ).fetchall()

    lines: list[str] = []
    docs_written = 0
    sentences_written = 0
    tokens_written = 0

    for doc_row in doc_rows:
        doc_id = int(doc_row[0])
        title = _safe_comment_value(doc_row[1])
        language = _safe_comment_value(doc_row[2]) or "und"

        token_rows = conn.execute(
            """
            SELECT
                u.unit_id,
                u.n AS unit_n,
                u.external_id,
                COALESCE(u.text_raw, u.text_norm, '') AS unit_text,
                t.sent_id,
                t.position,
                t.word,
                t.lemma,
                t.upos,
                t.xpos,
                t.feats,
                t.misc
            FROM units u
            JOIN tokens t ON t.unit_id = u.unit_id
            WHERE u.doc_id = ? AND u.unit_type = 'line'
            ORDER BY u.n, t.sent_id, t.position
            """,
            (doc_id,),
        ).fetchall()

        if not token_rows:
            continue

        docs_written += 1
        lines.append(f"# newdoc id = {doc_id}")
        lines.append(f"# doc_title = {title}")
        lines.append(f"# doc_language = {language}")

        current_key: tuple[int, int] | None = None
        for row in token_rows:
            unit_id = int(row[0])
            unit_n = int(row[1])
            external_id = row[2]
            unit_text = _safe_comment_value(row[3])
            sent_id = int(row[4])
            position = int(row[5])

            key = (unit_id, sent_id)
            if key != current_key:
                if current_key is not None:
                    lines.append("")
                current_key = key
                sentences_written += 1
                lines.append(f"# sent_id = {unit_id}.{sent_id}")
                lines.append(f"# unit_n = {unit_n}")
                if external_id is not None:
                    lines.append(f"# external_id = {external_id}")
                if unit_text:
                    lines.append(f"# text = {unit_text}")

            fields = [
                str(position),
                _conllu_field(row[6]),   # word / FORM
                _conllu_field(row[7]),   # lemma
                _conllu_field(row[8]),   # upos
                _conllu_field(row[9]),   # xpos
                _conllu_field(row[10]),  # feats
                "_",                     # head (not stored)
                "_",                     # deprel (not stored)
                "_",                     # deps (not stored)
                _conllu_field(row[11]),  # misc
            ]
            lines.append("\t".join(fields))
            tokens_written += 1

        lines.append("")
        lines.append("")

    out.write_text("\n".join(lines).rstrip() + ("\n" if lines else ""), encoding="utf-8")
    return {
        "out_path": str(out),
        "docs_written": docs_written,
        "sentences_written": sentences_written,
        "tokens_written": tokens_written,
    }

