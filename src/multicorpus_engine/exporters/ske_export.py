"""Sketch Engine-style vertical exporter (.ske).

This exporter writes token-annotated documents to a simple vertical format that
is interoperable with common corpus tooling expecting one token per line with
tab-separated attributes.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def _attr_escape(value: object) -> str:
    text = "" if value is None else str(value)
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("\r", " ")
        .replace("\n", " ")
    )


def _col(value: object) -> str:
    if value is None:
        return "_"
    txt = str(value).strip()
    return txt if txt else "_"


def export_ske(
    conn: sqlite3.Connection,
    output_path: str | Path,
    *,
    doc_ids: list[int] | None = None,
) -> dict[str, object]:
    """Export token rows as a SKE-like vertical file.

    Output profile:
    - `<doc ...>` and `<s ...>` structural tags
    - one token per line with 5 tab-separated columns:
      `word<TAB>lemma<TAB>upos<TAB>xpos<TAB>feats`
    """

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    params: list[object] = []
    where = ""
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
        where = f"WHERE d.doc_id IN ({placeholders})"
        params.extend(doc_ids)

    docs = conn.execute(
        f"""
        SELECT d.doc_id, d.title, d.language
        FROM documents d
        {where}
        ORDER BY d.doc_id
        """,
        params,
    ).fetchall()

    lines: list[str] = []
    docs_written = 0
    sentences_written = 0
    tokens_written = 0

    for doc_row in docs:
        doc_id = int(doc_row[0])
        title = _attr_escape(doc_row[1] or f"doc-{doc_id}")
        lang = _attr_escape(doc_row[2] or "und")

        token_rows = conn.execute(
            """
            SELECT
              u.unit_id,
              u.n AS unit_n,
              u.external_id,
              t.sent_id,
              t.position,
              t.word,
              t.lemma,
              t.upos,
              t.xpos,
              t.feats
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
        lines.append(f'<doc id="{doc_id}" lang="{lang}" title="{title}">')

        current_sent: tuple[int, int] | None = None
        for row in token_rows:
            unit_id = int(row[0])
            unit_n = int(row[1])
            external_id = row[2]
            sent_id = int(row[3])

            sent_key = (unit_id, sent_id)
            if sent_key != current_sent:
                if current_sent is not None:
                    lines.append("</s>")
                    lines.append("")
                current_sent = sent_key
                sentences_written += 1
                ext_attr = f' external_id="{_attr_escape(external_id)}"' if external_id is not None else ""
                lines.append(
                    f'<s id="{unit_id}.{sent_id}" unit_id="{unit_id}" unit_n="{unit_n}"{ext_attr}>'
                )

            word = _col(row[5])
            lemma = _col(row[6])
            upos = _col(row[7])
            xpos = _col(row[8])
            feats = _col(row[9])
            lines.append("\t".join((word, lemma, upos, xpos, feats)))
            tokens_written += 1

        if current_sent is not None:
            lines.append("</s>")
        lines.append("</doc>")
        lines.append("")

    out.write_text("\n".join(lines).rstrip() + ("\n" if lines else ""), encoding="utf-8")
    return {
        "out_path": str(out),
        "docs_written": docs_written,
        "sentences_written": sentences_written,
        "tokens_written": tokens_written,
    }

