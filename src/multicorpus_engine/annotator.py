"""spaCy-based document annotation helpers.

This module is intentionally optional at runtime:
- AGRAFES can run without spaCy installed.
- Annotation endpoints/jobs surface a clear error when NLP extras are missing.
"""

from __future__ import annotations

from functools import lru_cache
import sqlite3
import threading


_DEFAULT_MODEL_BY_LANG: dict[str, str] = {
    "fr": "fr_core_news_md",
    "en": "en_core_web_md",
    "de": "de_core_news_md",
    "es": "es_core_news_md",
    "it": "it_core_news_md",
    "sv": "sv_core_news_sm",
    "ro": "ro_core_news_md",
    "el": "el_core_news_sm",
    # Generic multilingual fallback.
    "und": "xx_ent_wiki_sm",
}


def _model_for_language(lang: str | None) -> str:
    if not lang:
        return _DEFAULT_MODEL_BY_LANG["und"]
    key = lang.strip().lower()
    if not key:
        return _DEFAULT_MODEL_BY_LANG["und"]
    if key in _DEFAULT_MODEL_BY_LANG:
        return _DEFAULT_MODEL_BY_LANG[key]
    # Keep region tags deterministic (e.g. "fr-FR" -> "fr").
    if "-" in key:
        base = key.split("-", 1)[0]
        if base in _DEFAULT_MODEL_BY_LANG:
            return _DEFAULT_MODEL_BY_LANG[base]
    if "_" in key:
        base = key.split("_", 1)[0]
        if base in _DEFAULT_MODEL_BY_LANG:
            return _DEFAULT_MODEL_BY_LANG[base]
    return _DEFAULT_MODEL_BY_LANG["und"]


@lru_cache(maxsize=8)
def _load_model(model_name: str):
    try:
        import spacy  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - depends on local extras
        raise RuntimeError(
            "spaCy is not installed. Install NLP extras with "
            "`pip install .[nlp]`."
        ) from exc

    try:
        return spacy.load(model_name)
    except Exception as exc:  # pragma: no cover - model availability depends on env
        raise RuntimeError(
            f"spaCy model not available: {model_name!r}. "
            f"Install it with `python -m spacy download {model_name}`."
        ) from exc


def annotate_document(
    conn: sqlite3.Connection,
    doc_id: int,
    model_name: str | None = None,
    lock: threading.Lock | None = None,
) -> dict[str, object]:
    """Annotate a single document and populate ``tokens``.

    Strategy to avoid "database is locked":
      1. Read unit rows under lock (fast).
      2. Run spaCy inference with NO lock held (slow, CPU-bound).
      3. Write all token rows under lock in a single executemany (fast).

    Existing token rows for the document are replaced.
    """

    def _with_lock(fn):
        if lock is not None:
            with lock:
                return fn()
        return fn()

    # ── Phase 1: read metadata + unit rows (under lock, fast) ────────────────
    def _read():
        row = conn.execute(
            "SELECT doc_id, language FROM documents WHERE doc_id = ?",
            (doc_id,),
        ).fetchone()
        if row is None:
            raise ValueError(f"Document not found: doc_id={doc_id}")
        # Exclude paratextual units (n < text_start_n) — they contain titles,
        # headers, or front matter that should not generate token rows.
        tsn_row = conn.execute(
            "SELECT text_start_n FROM documents WHERE doc_id = ?", (doc_id,)
        ).fetchone()
        tsn = int(tsn_row[0]) if tsn_row and tsn_row[0] is not None else 1
        unit_rows = conn.execute(
            """
            SELECT unit_id, COALESCE(text_norm, text_raw, '') AS text
            FROM units
            WHERE doc_id = ? AND unit_type = 'line' AND n >= ?
            ORDER BY n
            """,
            (doc_id, tsn),
        ).fetchall()
        return row, unit_rows

    row, unit_rows = _with_lock(_read)

    resolved_model = (
        model_name.strip()
        if isinstance(model_name, str) and model_name.strip()
        else _model_for_language(row[1])
    )

    # ── Phase 2: spaCy inference (NO lock held) ───────────────────────────────
    nlp = _load_model(resolved_model)

    units_annotated = 0
    sentences_written = 0
    tokens_written = 0
    pending_rows: list[tuple] = []

    for unit_id, text in unit_rows:
        if not isinstance(text, str):
            text = ""
        stripped = text.strip()
        if not stripped:
            continue

        doc = nlp(stripped)
        units_annotated += 1

        sent_id = 0
        wrote_in_sent_mode = False
        try:
            sent_iter = list(doc.sents)
        except Exception:
            sent_iter = []

        if sent_iter:
            for sent in sent_iter:
                sent_tokens = [tok for tok in sent if not tok.is_space]
                if not sent_tokens:
                    continue
                sent_id += 1
                sentences_written += 1
                position = 0
                for tok in sent_tokens:
                    position += 1
                    tokens_written += 1
                    pending_rows.append((
                        int(unit_id), sent_id, position,
                        tok.text, tok.lemma_ or None, tok.pos_ or None,
                        tok.tag_ or None,
                        str(tok.morph) if str(tok.morph) else None,
                        None,
                    ))
                wrote_in_sent_mode = True

        if not wrote_in_sent_mode:
            sent_id = 1
            position = 0
            has_token = False
            for tok in doc:
                if tok.is_space:
                    continue
                has_token = True
                position += 1
                tokens_written += 1
                pending_rows.append((
                    int(unit_id), sent_id, position,
                    tok.text, tok.lemma_ or None, tok.pos_ or None,
                    tok.tag_ or None,
                    str(tok.morph) if str(tok.morph) else None,
                    None,
                ))
            if has_token:
                sentences_written += 1

    # ── Phase 3: write token rows (under lock, fast batch INSERT) ─────────────
    def _write():
        conn.execute(
            "DELETE FROM tokens WHERE unit_id IN "
            "(SELECT unit_id FROM units WHERE doc_id = ?)",
            (doc_id,),
        )
        conn.executemany(
            """
            INSERT INTO tokens
                (unit_id, sent_id, position, word, lemma, upos, xpos, feats, misc)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            pending_rows,
        )
        conn.commit()

    _with_lock(_write)

    return {
        "doc_id": int(doc_id),
        "model": resolved_model,
        "units_total": len(unit_rows),
        "units_annotated": units_annotated,
        "sentences_written": sentences_written,
        "tokens_written": tokens_written,
    }
