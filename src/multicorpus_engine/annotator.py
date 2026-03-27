"""spaCy annotation pipeline for AGRAFES.

Populates the ``tokens`` table from existing ``units.text_norm`` content.

Usage
-----
::

    from multicorpus_engine.annotator import annotate_document
    report = annotate_document(conn, doc_id=3, model_name="fr_core_news_lg")

The module keeps a per-process model cache so the heavy spaCy model is loaded
once and reused across calls (lazy loading on first request).

spaCy is an *optional* dependency — import errors are caught and surfaced as
a clear ``RuntimeError``.  Install with::

    pip install "multicorpus_engine[nlp]"
"""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# ─── Lazy model cache ────────────────────────────────────────────────────────

_model_cache: dict[str, object] = {}   # model_name → spacy.Language


def _load_model(model_name: str) -> object:
    """Load (or return cached) a spaCy model.

    Raises RuntimeError if spaCy is not installed or the model is missing.
    """
    if model_name in _model_cache:
        return _model_cache[model_name]

    try:
        import spacy  # type: ignore[import]
    except ImportError as exc:
        raise RuntimeError(
            "spaCy is not installed. "
            "Install it with: pip install 'multicorpus_engine[nlp]' "
            "then download a model, e.g.: python -m spacy download fr_core_news_lg"
        ) from exc

    try:
        nlp = spacy.load(model_name)
    except OSError as exc:
        raise RuntimeError(
            f"spaCy model '{model_name}' not found. "
            f"Download it with: python -m spacy download {model_name}"
        ) from exc

    _model_cache[model_name] = nlp
    logger.info("spaCy model '%s' loaded and cached", model_name)
    return nlp


# ─── Report ──────────────────────────────────────────────────────────────────


@dataclass
class AnnotationReport:
    doc_id: int = 0
    units_annotated: int = 0
    tokens_total: int = 0
    tokens_replaced: int = 0   # tokens deleted before re-annotation
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "units_annotated": self.units_annotated,
            "tokens_total": self.tokens_total,
            "tokens_replaced": self.tokens_replaced,
            "warnings": self.warnings,
        }


# ─── Core annotation function ─────────────────────────────────────────────────


def annotate_document(
    conn: sqlite3.Connection,
    doc_id: int,
    model_name: str,
    replace: bool = True,
) -> AnnotationReport:
    """Annotate all ``line``-type units of *doc_id* with *model_name*.

    Parameters
    ----------
    conn:
        Open SQLite connection (write access required).
    doc_id:
        Document to annotate.
    model_name:
        spaCy model name, e.g. ``"fr_core_news_lg"``.
    replace:
        If True (default), delete existing tokens for the doc before
        writing new ones.  Set to False to skip units that already have tokens.
    """
    report = AnnotationReport(doc_id=doc_id)
    nlp = _load_model(model_name)

    # Verify the doc exists
    row = conn.execute("SELECT doc_id FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
    if row is None:
        raise ValueError(f"Document {doc_id} not found")

    # Fetch units to annotate (line-type only; structure units have no useful text)
    units = conn.execute(
        """
        SELECT unit_id, text_norm
        FROM units
        WHERE doc_id = ? AND unit_type = 'line'
        ORDER BY position
        """,
        (doc_id,),
    ).fetchall()

    if not units:
        report.warnings.append(f"No annotatable units found in document {doc_id}")
        return report

    if replace:
        # Delete all existing tokens for this document's units in one query
        deleted = conn.execute(
            """
            DELETE FROM tokens
            WHERE unit_id IN (
                SELECT unit_id FROM units WHERE doc_id = ?
            )
            """,
            (doc_id,),
        ).rowcount
        report.tokens_replaced = deleted

    cur = conn.cursor()

    for unit_id, text_norm in units:
        if not text_norm:
            continue

        # Run spaCy NLP pipeline
        doc = nlp(text_norm)  # type: ignore[operator]

        sent_id = 0
        for sent in doc.sents:
            position = 0
            for token in sent:
                # Skip purely whitespace pseudo-tokens
                if token.is_space:
                    continue

                feats = str(token.morph) if token.morph else None
                misc = f"SpaceAfter={'No' if not token.whitespace_ else 'Yes'}"

                cur.execute(
                    """
                    INSERT INTO tokens
                        (unit_id, sent_id, position, word, lemma, upos, xpos, feats, misc)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        unit_id,
                        sent_id,
                        position,
                        token.text,
                        token.lemma_,
                        token.pos_,   # Universal POS
                        token.tag_,   # language-specific POS
                        feats or None,
                        misc,
                    ),
                )
                report.tokens_total += 1
                position += 1

            sent_id += 1

        report.units_annotated += 1

    conn.commit()

    logger.info(
        "Annotation complete: doc_id=%d, model=%s, units=%d, tokens=%d",
        doc_id, model_name, report.units_annotated, report.tokens_total,
    )
    return report


def annotate_corpus(
    conn: sqlite3.Connection,
    model_name: str,
    doc_ids: Optional[list[int]] = None,
    replace: bool = True,
    progress_cb=None,
) -> dict:
    """Annotate multiple (or all) documents.

    Parameters
    ----------
    doc_ids:
        If None, annotate all documents in the corpus.
    progress_cb:
        Optional callable(pct: int, msg: str) for progress reporting.
    """
    if doc_ids is None:
        rows = conn.execute("SELECT doc_id FROM documents ORDER BY doc_id").fetchall()
        doc_ids = [r[0] for r in rows]

    if not doc_ids:
        return {"docs_annotated": 0, "tokens_total": 0, "warnings": []}

    total = len(doc_ids)
    docs_annotated = 0
    tokens_total = 0
    all_warnings: list[str] = []

    for i, doc_id in enumerate(doc_ids):
        if progress_cb:
            pct = int(5 + 90 * i / total)
            progress_cb(pct, f"Annotating document {doc_id} ({i + 1}/{total})")
        try:
            rep = annotate_document(conn, doc_id=doc_id, model_name=model_name, replace=replace)
            docs_annotated += 1
            tokens_total += rep.tokens_total
            all_warnings.extend(rep.warnings)
        except Exception as exc:
            msg = f"doc {doc_id}: {exc}"
            all_warnings.append(msg)
            logger.warning("Annotation failed for %s", msg)

    if progress_cb:
        progress_cb(100, "Annotation completed")

    return {
        "docs_annotated": docs_annotated,
        "tokens_total": tokens_total,
        "warnings": all_warnings,
    }
