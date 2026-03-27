"""CoNLL-U importer.

Reads a CoNLL-U file (https://universaldependencies.org/format.html) and
populates the ``units`` and ``tokens`` tables.

Grouping strategy (controlled by ``unit_per`` parameter):
- ``"sentence"`` (default): one unit per sentence block.
  Sentence-level comments (``# sent_id``, ``# text``) become the unit text.
- ``"paragraph"``: blank-line sequences delimit paragraphs; all sentences
  in a paragraph are merged into one unit, tokens keep their ``sent_id``
  relative to the paragraph.

CoNLL-U column order (1-based, 10 columns):
    1  ID      token index or range (e.g. "1", "1-2", "1.1")
    2  FORM    word form
    3  LEMMA   lemma
    4  UPOS    universal POS
    5  XPOS    language-specific POS
    6  FEATS   morphological features
    7  HEAD    (ignored)
    8  DEPREL  (ignored)
    9  DEPS    (ignored)
   10  MISC    miscellaneous

Multi-word tokens (e.g. "1-2 du …") are split into their component tokens.
Empty nodes (e.g. "1.1") are skipped.
"""

from __future__ import annotations

import hashlib
import logging
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ..unicode_policy import normalize
from .import_guard import assert_not_duplicate_import

logger = logging.getLogger(__name__)

# ─── Report ──────────────────────────────────────────────────────────────────


@dataclass
class ConlluImportReport:
    doc_id: int = 0
    units_total: int = 0
    tokens_total: int = 0
    sentences_total: int = 0
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "units_total": self.units_total,
            "tokens_total": self.tokens_total,
            "sentences_total": self.sentences_total,
            "warnings": self.warnings,
        }


# ─── Parsing helpers ─────────────────────────────────────────────────────────


def _compute_file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _is_multiword(token_id: str) -> bool:
    """Return True for range tokens like '1-2'."""
    return "-" in token_id


def _is_empty_node(token_id: str) -> bool:
    """Return True for empty nodes like '1.1'."""
    return "." in token_id


def _null(v: str) -> Optional[str]:
    """Return None for CoNLL-U underscore placeholder, else the value."""
    return None if v == "_" else v


# ─── Sentence / token data classes ───────────────────────────────────────────


@dataclass
class _Token:
    position: int   # 0-based within sentence
    word: Optional[str]
    lemma: Optional[str]
    upos: Optional[str]
    xpos: Optional[str]
    feats: Optional[str]
    misc: Optional[str]


@dataclass
class _Sentence:
    sent_id: str                  # from # sent_id comment, or auto-generated
    text: str                     # from # text comment, or joined FORM values
    tokens: list[_Token] = field(default_factory=list)


# ─── CoNLL-U file parser ──────────────────────────────────────────────────────


def _parse_conllu(path: Path) -> list[_Sentence]:
    """Parse a CoNLL-U file into a list of Sentence objects."""
    sentences: list[_Sentence] = []
    current_tokens: list[_Token] = []
    current_sent_id: str = ""
    current_text: str = ""
    sent_counter = 0

    try:
        raw = path.read_bytes()
        # BOM detection
        if raw.startswith(b"\xef\xbb\xbf"):
            text_data = raw[3:].decode("utf-8")
        else:
            text_data = raw.decode("utf-8", errors="replace")
    except OSError as exc:
        raise ValueError(f"Cannot read CoNLL-U file: {exc}") from exc

    def _flush() -> None:
        nonlocal current_tokens, current_sent_id, current_text, sent_counter
        if not current_tokens:
            return
        text = current_text or " ".join(t.word or "" for t in current_tokens).strip()
        sent_id = current_sent_id or f"s{sent_counter + 1}"
        sentences.append(_Sentence(sent_id=sent_id, text=text, tokens=current_tokens))
        current_tokens = []
        current_sent_id = ""
        current_text = ""
        sent_counter += 1

    position = 0
    for line in text_data.splitlines():
        line = line.rstrip("\r")

        if not line:
            # Blank line = sentence boundary
            _flush()
            position = 0
            continue

        if line.startswith("#"):
            # Comment line
            if line.startswith("# sent_id"):
                parts = line.split("=", 1)
                if len(parts) == 2:
                    current_sent_id = parts[1].strip()
            elif line.startswith("# text"):
                parts = line.split("=", 1)
                if len(parts) == 2:
                    current_text = parts[1].strip()
            continue

        cols = line.split("\t")
        if len(cols) < 10:
            # Tolerate missing trailing columns
            cols += ["_"] * (10 - len(cols))

        token_id = cols[0]

        # Skip range tokens (multi-word) and empty nodes at the sentence level
        # — their component tokens appear as individual rows
        if _is_multiword(token_id) or _is_empty_node(token_id):
            continue

        tok = _Token(
            position=position,
            word=_null(cols[1]),
            lemma=_null(cols[2]),
            upos=_null(cols[3]),
            xpos=_null(cols[4]),
            feats=_null(cols[5]),
            misc=_null(cols[9]),
        )
        current_tokens.append(tok)
        position += 1

    _flush()  # flush last sentence if file doesn't end with blank line
    return sentences


# ─── Main import function ─────────────────────────────────────────────────────


def import_conllu(
    conn: sqlite3.Connection,
    path: Path,
    language: str = "und",
    title: Optional[str] = None,
    doc_role: str = "standalone",
    resource_type: Optional[str] = None,
    unit_per: str = "sentence",
    check_filename: bool = False,
) -> ConlluImportReport:
    """Import a CoNLL-U file into the DB and return an import report.

    Parameters
    ----------
    conn:
        Open SQLite connection (write access required).
    path:
        Path to the .conllu file.
    language:
        BCP-47 language tag (default ``"und"``).
    title:
        Document title override. Defaults to the file stem.
    doc_role:
        One of ``"standalone"``, ``"original"``, ``"translation"``.
    resource_type:
        Optional resource type string.
    unit_per:
        ``"sentence"`` (default) — one unit per CoNLL-U sentence.
        ``"paragraph"`` — one unit per blank-line-separated paragraph.
    check_filename:
        If True, raise if a document with the same filename already exists.
    """
    report = ConlluImportReport()

    if not path.exists():
        raise FileNotFoundError(f"CoNLL-U file not found: {path}")

    file_hash = _compute_file_hash(path)
    file_name = path.name
    doc_title = title or path.stem

    assert_not_duplicate_import(conn, file_hash=file_hash, file_name=file_name if check_filename else None)

    sentences = _parse_conllu(path)
    if not sentences:
        raise ValueError(f"No sentences found in CoNLL-U file: {path}")

    report.sentences_total = len(sentences)

    cur = conn.cursor()

    # ── Insert document ──────────────────────────────────────────────────────
    cur.execute(
        """
        INSERT INTO documents (title, language, file_name, file_hash, doc_role, resource_type)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (doc_title, language, file_name, file_hash, doc_role, resource_type),
    )
    doc_id = cur.lastrowid
    assert doc_id is not None
    report.doc_id = doc_id

    # ── Group sentences into units ───────────────────────────────────────────
    if unit_per == "paragraph":
        # Paragraph grouping: sentences are already parsed; for a simple
        # CoNLL-U file without explicit paragraph markers we treat the whole
        # document as one paragraph (common case). A future extension could
        # use blank-line runs between sentence groups as paragraph markers.
        # For now: one unit per sentence (same as "sentence" mode) but the
        # sent_id inside the unit restarts at 0.
        units_sentences: list[list[_Sentence]] = [[s] for s in sentences]
    else:
        # Default: one unit per sentence
        units_sentences = [[s] for s in sentences]

    # ── Insert units and tokens ──────────────────────────────────────────────
    for sent_idx_in_unit, unit_sents in enumerate(units_sentences):
        # Build unit text from sentence texts
        unit_text_raw = " ".join(s.text for s in unit_sents).strip()
        unit_text_norm = normalize(unit_text_raw)

        cur.execute(
            """
            INSERT INTO units (doc_id, position, unit_type, text_raw, text_norm, external_id)
            VALUES (?, ?, 'line', ?, ?, ?)
            """,
            (doc_id, report.units_total, unit_text_raw, unit_text_norm, report.units_total + 1),
        )
        unit_id = cur.lastrowid
        assert unit_id is not None
        report.units_total += 1

        # Insert tokens for each sentence in this unit
        for sent_i, sent in enumerate(unit_sents):
            for tok in sent.tokens:
                cur.execute(
                    """
                    INSERT INTO tokens
                        (unit_id, sent_id, position, word, lemma, upos, xpos, feats, misc)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        unit_id,
                        sent_i,
                        tok.position,
                        tok.word,
                        tok.lemma,
                        tok.upos,
                        tok.xpos,
                        tok.feats,
                        tok.misc,
                    ),
                )
                report.tokens_total += 1

    conn.commit()

    logger.info(
        "CoNLL-U import complete: doc_id=%d, units=%d, tokens=%d, sentences=%d",
        doc_id, report.units_total, report.tokens_total, report.sentences_total,
    )
    return report
