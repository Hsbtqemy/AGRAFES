"""CoNLL-U (and vertical/Sketch Engine) exporter.

CQL Sprint E — Export et interopérabilité
==========================================

This module reads annotated tokens from the ``tokens`` table and reconstructs
standard interchange formats:

CoNLL-U
-------
https://universaldependencies.org/format.html

Columns: ID FORM LEMMA UPOS XPOS FEATS HEAD DEPREL DEPS MISC

Since HEAD, DEPREL and DEPS are not stored by AGRAFES (the annotator only
provides shallow surface-level annotations), those columns are output as ``_``.
This produces a valid CoNLL-U file that can be loaded by any UD-compatible tool.

The output is one ``.conllu`` file per document by default, or all documents
concatenated into a single file when ``doc_ids=None`` and a single path is given.

Sentence boundary comments:
    ``# sent_id = <unit_id>_<sent_id>``
    ``# text = <surface tokens joined by space>``

Sketch Engine Vertical
-----------------------
Also known as the "CQL vertical" or "IMS Open Corpus Workbench" format.

Structure:
    <doc id="<doc_id>" title="...">
    <s>
    word<TAB>upos<TAB>lemma
    …
    </s>
    </doc>

This is the simplest format accepted by Sketch Engine, NoSketchEngine, and CWB
when building a corpus with a ``word``, ``tag``, and ``lemma`` attribute.

Public API
----------
::

    from multicorpus_engine.conllu_export import export_conllu, export_vertical
    from multicorpus_engine.conllu_export import ExportConlluReport

    report = export_conllu(conn, doc_ids=[1, 2], out_path="/tmp/corpus.conllu")
    report = export_vertical(conn, doc_ids=None, out_path="/tmp/corpus.vert")
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# ─── Report ──────────────────────────────────────────────────────────────────

@dataclass
class ExportConlluReport:
    docs_exported: int = 0
    units_exported: int = 0
    tokens_exported: int = 0
    sentences_exported: int = 0
    skipped_unannotated: list[int] = field(default_factory=list)
    out_path: str = ""

    def to_dict(self) -> dict:
        return {
            "docs_exported":      self.docs_exported,
            "units_exported":     self.units_exported,
            "tokens_exported":    self.tokens_exported,
            "sentences_exported": self.sentences_exported,
            "skipped_unannotated": self.skipped_unannotated,
            "out_path":           self.out_path,
        }


# ─── DB helpers ───────────────────────────────────────────────────────────────

def _placeholder(val: Optional[str]) -> str:
    """Return ``_`` for None/empty, else the value."""
    return val if val else "_"


def _get_docs(
    conn: sqlite3.Connection,
    doc_ids: Optional[list[int]],
) -> list[tuple[int, str, str]]:
    """Return [(doc_id, title, language)] for the requested documents."""
    if doc_ids:
        ph = ",".join("?" * len(doc_ids))
        rows = conn.execute(
            f"SELECT doc_id, title, language FROM documents WHERE doc_id IN ({ph}) ORDER BY doc_id",
            doc_ids,
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT doc_id, title, language FROM documents ORDER BY doc_id"
        ).fetchall()
    return [(r[0], r[1] or f"doc_{r[0]}", r[2] or "und") for r in rows]


def _has_tokens(conn: sqlite3.Connection, doc_id: int) -> bool:
    """Return True if at least one token is stored for this document."""
    row = conn.execute(
        """
        SELECT 1 FROM tokens t
        JOIN units u ON u.unit_id = t.unit_id
        WHERE u.doc_id = ?
        LIMIT 1
        """,
        (doc_id,),
    ).fetchone()
    return row is not None


def _iter_sentences(
    conn: sqlite3.Connection,
    doc_id: int,
):
    """Yield (unit_id, unit_position, sent_id, tokens_list) for each sentence.

    ``tokens_list`` is a list of
    ``(position, word, lemma, upos, xpos, feats, misc)`` tuples ordered by
    position.
    """
    # Get all (unit_id, position) for this doc, ordered
    units = conn.execute(
        """
        SELECT DISTINCT u.unit_id, u.position
        FROM units u
        JOIN tokens t ON t.unit_id = u.unit_id
        WHERE u.doc_id = ?
        ORDER BY u.position
        """,
        (doc_id,),
    ).fetchall()

    for unit_id, unit_pos in units:
        # Get all sent_ids in this unit
        sent_ids = [
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT sent_id FROM tokens WHERE unit_id = ? ORDER BY sent_id",
                (unit_id,),
            ).fetchall()
        ]
        for sent_id in sent_ids:
            tok_rows = conn.execute(
                """
                SELECT position, word, lemma, upos, xpos, feats, misc
                FROM tokens
                WHERE unit_id = ? AND sent_id = ?
                ORDER BY position
                """,
                (unit_id, sent_id),
            ).fetchall()
            if tok_rows:
                yield unit_id, unit_pos, sent_id, tok_rows


# ─── CoNLL-U export ───────────────────────────────────────────────────────────

def _sentence_to_conllu(
    unit_id: int,
    sent_id: int,
    tok_rows: list[tuple],
) -> list[str]:
    """Return lines for one CoNLL-U sentence block (including trailing blank line)."""
    surface = " ".join(r[1] or "" for r in tok_rows).strip()
    lines = [
        f"# sent_id = {unit_id}_{sent_id}",
        f"# text = {surface}",
    ]
    for i, (pos, word, lemma, upos, xpos, feats, misc) in enumerate(tok_rows, start=1):
        row = "\t".join([
            str(i),                  # ID  (1-based within sentence)
            _placeholder(word),      # FORM
            _placeholder(lemma),     # LEMMA
            _placeholder(upos),      # UPOS
            _placeholder(xpos),      # XPOS
            _placeholder(feats),     # FEATS
            "_",                     # HEAD  (not stored)
            "_",                     # DEPREL (not stored)
            "_",                     # DEPS   (not stored)
            _placeholder(misc),      # MISC
        ])
        lines.append(row)
    lines.append("")   # blank line = sentence boundary
    return lines


def export_conllu(
    conn: sqlite3.Connection,
    doc_ids: Optional[list[int]],
    out_path: str,
) -> ExportConlluReport:
    """Export annotated tokens to a CoNLL-U file.

    Parameters
    ----------
    conn:
        Open SQLite connection.
    doc_ids:
        List of document IDs to export, or ``None`` to export all.
    out_path:
        Absolute path for the output ``.conllu`` file.

    Returns
    -------
    ExportConlluReport
    """
    report = ExportConlluReport(out_path=out_path)
    docs = _get_docs(conn, doc_ids)

    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for doc_id, title, language in docs:
            if not _has_tokens(conn, doc_id):
                report.skipped_unannotated.append(doc_id)
                continue

            # Document-level comment block
            fh.write(f"# newdoc id = {doc_id}\n")
            fh.write(f"# doc_title = {title}\n")
            fh.write(f"# doc_language = {language}\n")

            doc_sents = 0
            doc_toks  = 0

            for unit_id, _unit_pos, sent_id, tok_rows in _iter_sentences(conn, doc_id):
                lines = _sentence_to_conllu(unit_id, sent_id, tok_rows)
                fh.write("\n".join(lines) + "\n")
                doc_sents += 1
                doc_toks  += len(tok_rows)

            # Count distinct units for this doc (use separate query for accuracy)
            unit_count = conn.execute(
                """
                SELECT COUNT(DISTINCT u.unit_id)
                FROM units u
                JOIN tokens t ON t.unit_id = u.unit_id
                WHERE u.doc_id = ?
                """,
                (doc_id,),
            ).fetchone()[0]

            report.docs_exported      += 1
            report.units_exported     += unit_count
            report.sentences_exported += doc_sents
            report.tokens_exported    += doc_toks

    return report


# ─── Sketch Engine vertical export ───────────────────────────────────────────

_SKE_HEADER = """\
<?xml version="1.0" encoding="UTF-8"?>
<!-- AGRAFES corpus export — Sketch Engine / NoSketchEngine vertical format -->
<!-- Attributes: word | upos | lemma -->
<!-- Compile with: compilecorp --recompile-corpus <registry_file> -->
<corpus>
"""

_SKE_FOOTER = "</corpus>\n"


def export_vertical(
    conn: sqlite3.Connection,
    doc_ids: Optional[list[int]],
    out_path: str,
) -> ExportConlluReport:
    """Export annotated tokens to Sketch Engine vertical format.

    The output is a UTF-8 text file with one token per line (word TAB upos TAB
    lemma) and XML-like sentence (``<s>``) and document (``<doc>``) tags.
    This is the minimal format accepted by Sketch Engine, NoSketchEngine and
    the IMS Open Corpus Workbench (CWB).

    Parameters
    ----------
    conn:
        Open SQLite connection.
    doc_ids:
        List of document IDs to export, or ``None`` to export all.
    out_path:
        Absolute path for the output ``.vert`` file.
    """
    report = ExportConlluReport(out_path=out_path)
    docs = _get_docs(conn, doc_ids)

    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(_SKE_HEADER)

        for doc_id, title, language in docs:
            if not _has_tokens(conn, doc_id):
                report.skipped_unannotated.append(doc_id)
                continue

            # Escape XML special characters in attribute value
            safe_title = (
                title
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace('"', "&quot;")
            )
            fh.write(f'<doc id="{doc_id}" title="{safe_title}" lang="{language}">\n')

            doc_sents = 0
            doc_toks  = 0

            for unit_id, _unit_pos, sent_id, tok_rows in _iter_sentences(conn, doc_id):
                fh.write("<s>\n")
                for _pos, word, lemma, upos, *_ in tok_rows:
                    form = _placeholder(word)
                    tag  = _placeholder(upos)
                    lem  = _placeholder(lemma)
                    fh.write(f"{form}\t{tag}\t{lem}\n")
                fh.write("</s>\n")
                doc_sents += 1
                doc_toks  += len(tok_rows)

            fh.write("</doc>\n")

            unit_count = conn.execute(
                """
                SELECT COUNT(DISTINCT u.unit_id)
                FROM units u
                JOIN tokens t ON t.unit_id = u.unit_id
                WHERE u.doc_id = ?
                """,
                (doc_id,),
            ).fetchone()[0]

            report.docs_exported      += 1
            report.units_exported     += unit_count
            report.sentences_exported += doc_sents
            report.tokens_exported    += doc_toks

        fh.write(_SKE_FOOTER)

    return report
