"""CoNLL-U importer.

Imports a CoNLL-U file into:
- `documents` / `units` (one sentence block -> one `line` unit)
- `tokens` (one row per real token, skipping multiword ranges and empty nodes)
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

from ..unicode_policy import normalize
from .docx_numbered_lines import ImportReport, _analyze_external_ids
from .import_guard import assert_not_duplicate_import

logger = logging.getLogger(__name__)


def _compute_file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _clean_field(value: str) -> str | None:
    value = value.strip()
    if not value or value == "_":
        return None
    return value


def _parse_conllu(text: str) -> tuple[list[dict], dict[str, int]]:
    sentences: list[dict] = []
    stats = {
        "multiword_ranges": 0,
        "empty_nodes": 0,
        "token_rows": 0,
    }

    comments: list[str] = []
    tokens: list[tuple[int, str, str | None, str | None, str | None, str | None, str | None]] = []

    def finalize_sentence() -> None:
        nonlocal comments, tokens
        if not tokens:
            comments = []
            return

        sent_id_raw: str | None = None
        text_raw: str | None = None
        for c in comments:
            if c.startswith("# sent_id ="):
                sent_id_raw = c.split("=", 1)[1].strip()
            elif c.startswith("# text ="):
                text_raw = c.split("=", 1)[1].strip()

        if not text_raw:
            text_raw = " ".join(tok[1] for tok in tokens if tok[1])

        sentences.append(
            {
                "sent_id_raw": sent_id_raw,
                "text_raw": text_raw or "",
                "tokens": tokens,
            }
        )
        comments = []
        tokens = []

    for line_no, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            finalize_sentence()
            continue
        if line.startswith("#"):
            comments.append(line)
            continue

        cols = raw_line.split("\t")
        if len(cols) != 10:
            raise ValueError(
                f"Invalid CoNLL-U line {line_no}: expected 10 tab-separated columns, got {len(cols)}"
            )

        token_id = cols[0].strip()
        if "-" in token_id:
            # Multiword token range (e.g. 1-2 du): lexical decomposition rows follow.
            stats["multiword_ranges"] += 1
            continue
        if "." in token_id:
            # Empty node (enhanced dependencies): ignored for Sprint A storage.
            stats["empty_nodes"] += 1
            continue
        try:
            token_index = int(token_id)
        except ValueError as exc:
            raise ValueError(
                f"Invalid CoNLL-U token id on line {line_no}: {token_id!r}"
            ) from exc

        word = cols[1].strip()
        lemma = _clean_field(cols[2])
        upos = _clean_field(cols[3])
        xpos = _clean_field(cols[4])
        feats = _clean_field(cols[5])
        misc = _clean_field(cols[9])

        tokens.append((token_index, word, lemma, upos, xpos, feats, misc))
        stats["token_rows"] += 1

    finalize_sentence()
    return sentences, stats


def import_conllu(
    conn: sqlite3.Connection,
    path: str | Path,
    language: str,
    title: Optional[str] = None,
    doc_role: str = "standalone",
    resource_type: Optional[str] = None,
    run_id: Optional[str] = None,
    run_logger: Optional[logging.Logger] = None,
    check_filename: bool = False,
) -> ImportReport:
    """Import a CoNLL-U file.

    Current Sprint A policy:
    - one sentence block => one `units` row (`unit_type='line'`)
    - `tokens.sent_id` is set to 1 within each unit (unit already represents one sentence)
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"CoNLL-U file not found: {path}")

    log = run_logger or logger
    log.info("Starting import of %s (mode=conllu)", path)

    _MAX_FILE_BYTES = 512 * 1024 * 1024  # 512 MiB
    if path.stat().st_size > _MAX_FILE_BYTES:
        raise ValueError(f"CoNLL-U file too large (max {_MAX_FILE_BYTES // (1024 * 1024)} MiB)")
    source_hash = _compute_file_hash(path)
    assert_not_duplicate_import(conn, path, source_hash, check_filename=check_filename)

    raw_bytes = path.read_bytes()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError(f"CoNLL-U file must be UTF-8 encoded: {path}") from exc

    sentences, parse_stats = _parse_conllu(text)
    if not sentences:
        raise ValueError("No token sentences found in CoNLL-U file")

    doc_title = title or path.stem
    utcnow = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    doc_meta = {
        "import_mode": "conllu",
        "sentences": len(sentences),
        "token_rows": parse_stats["token_rows"],
    }
    cur = conn.execute(
        """
        INSERT INTO documents
            (title, language, doc_role, resource_type, meta_json, source_path, source_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            doc_title,
            language,
            doc_role,
            resource_type,
            json.dumps(doc_meta, ensure_ascii=False),
            str(path),
            source_hash,
            utcnow,
        ),
    )
    doc_id = cur.lastrowid

    external_ids: list[int] = []
    token_rows_total = 0
    try:
        for n, sentence in enumerate(sentences, start=1):
            sent_id_raw = sentence.get("sent_id_raw")
            if isinstance(sent_id_raw, str) and sent_id_raw.isdigit():
                external_id = int(sent_id_raw)
            else:
                external_id = n
            external_ids.append(external_id)

            unit_meta: dict[str, str] | None = None
            if isinstance(sent_id_raw, str) and sent_id_raw:
                unit_meta = {"conllu_sent_id": sent_id_raw}

            text_raw = str(sentence.get("text_raw", ""))
            text_norm = normalize(text_raw)
            cur_unit = conn.execute(
                """
                INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)
                VALUES (?, 'line', ?, ?, ?, ?, ?)
                """,
                (
                    doc_id,
                    n,
                    external_id,
                    text_raw,
                    text_norm,
                    json.dumps(unit_meta, ensure_ascii=False) if unit_meta else None,
                ),
            )
            unit_id = cur_unit.lastrowid

            token_inserts: list[tuple[int, int, int, str, str | None, str | None, str | None, str | None, str | None]] = []
            for position, tok in enumerate(sentence["tokens"], start=1):
                _, word, lemma, upos, xpos, feats, misc = tok
                token_inserts.append(
                    (unit_id, 1, position, word, lemma, upos, xpos, feats, misc)
                )

            conn.executemany(
                """
                INSERT INTO tokens
                    (unit_id, sent_id, position, word, lemma, upos, xpos, feats, misc)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                token_inserts,
            )
            token_rows_total += len(token_inserts)

        conn.commit()
    except Exception:
        conn.rollback()
        raise

    duplicates, holes, non_monotonic = _analyze_external_ids(external_ids)
    report = ImportReport(
        doc_id=doc_id,
        units_total=len(sentences),
        units_line=len(sentences),
        units_structure=0,
        duplicates=duplicates,
        holes=holes,
        non_monotonic=non_monotonic,
    )

    if parse_stats["multiword_ranges"] > 0:
        report.warnings.append(
            f"Skipped {parse_stats['multiword_ranges']} multiword token range row(s)."
        )
    if parse_stats["empty_nodes"] > 0:
        report.warnings.append(
            f"Skipped {parse_stats['empty_nodes']} empty node row(s)."
        )
    if duplicates:
        report.warnings.append(f"Duplicate external_id(s) found: {duplicates}")
    if holes:
        report.warnings.append(f"Holes in external_id sequence: {holes}")
    if non_monotonic:
        report.warnings.append(f"Non-monotonic external_id(s): {non_monotonic}")

    log.info(
        "Import complete: doc_id=%d, units=%d, tokens=%d",
        doc_id,
        len(sentences),
        token_rows_total,
    )
    return report

