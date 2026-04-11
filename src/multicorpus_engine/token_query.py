"""Token-level query engine for CQL (Sprint C + Sprint D)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional
import re
import sqlite3

from .cql_parser import CqlQuery, CqlTokenSpec, parse_cql_query


@dataclass(frozen=True)
class _CompiledTokenSpec:
    wildcard: bool
    min_repeat: int
    max_repeat: int
    predicates: tuple[tuple[str, re.Pattern[str]], ...]


@dataclass(frozen=True)
class _TokenMatch:
    start: int
    end: int  # exclusive
    indices: tuple[int, ...]


def _compile_specs(query: CqlQuery) -> list[_CompiledTokenSpec]:
    out: list[_CompiledTokenSpec] = []
    for spec in query.token_specs:
        preds: list[tuple[str, re.Pattern[str]]] = []
        for pred in spec.predicates:
            flags = re.IGNORECASE if pred.case_insensitive else 0
            preds.append((pred.normalized_attr, re.compile(pred.pattern, flags)))
        out.append(
            _CompiledTokenSpec(
                wildcard=spec.wildcard,
                min_repeat=spec.min_repeat,
                max_repeat=spec.max_repeat,
                predicates=tuple(preds),
            )
        )
    return out


def _token_matches(token: dict[str, Any], spec: _CompiledTokenSpec) -> bool:
    if spec.wildcard:
        return True
    for attr, pat in spec.predicates:
        raw = token.get(attr)
        value = raw if isinstance(raw, str) else ""
        if pat.fullmatch(value) is None:
            return False
    return True


def _find_matches(
    tokens: list[dict[str, Any]],
    specs: list[_CompiledTokenSpec],
) -> list[_TokenMatch]:
    """Sliding-window/backtracking matcher for quantifiers and wildcards."""
    matches: list[_TokenMatch] = []
    seen: set[tuple[int, int, tuple[int, ...]]] = set()

    def rec(pattern_idx: int, cursor: int, matched_idx: tuple[int, ...]) -> None:
        if pattern_idx >= len(specs):
            if not matched_idx:
                return
            key = (matched_idx[0], matched_idx[-1] + 1, matched_idx)
            if key in seen:
                return
            seen.add(key)
            matches.append(_TokenMatch(start=key[0], end=key[1], indices=matched_idx))
            return

        spec = specs[pattern_idx]
        max_rep = min(spec.max_repeat, len(tokens) - cursor)
        if max_rep < spec.min_repeat:
            return

        for rep in range(spec.min_repeat, max_rep + 1):
            if rep == 0:
                rec(pattern_idx + 1, cursor, matched_idx)
                continue

            ok = True
            for j in range(rep):
                if not _token_matches(tokens[cursor + j], spec):
                    ok = False
                    break
            if not ok:
                continue

            next_idx = matched_idx + tuple(range(cursor, cursor + rep))
            rec(pattern_idx + 1, cursor + rep, next_idx)

    for start in range(len(tokens)):
        rec(0, start, tuple())

    matches.sort(key=lambda m: (m.start, m.end))
    return matches


def _token_public(tok: dict[str, Any]) -> dict[str, Any]:
    return {
        "token_id": int(tok["token_id"]),
        "position": int(tok["position"]),
        "word": tok.get("word"),
        "lemma": tok.get("lemma"),
        "upos": tok.get("upos"),
        "xpos": tok.get("xpos"),
        "feats": tok.get("feats"),
    }


def _build_hit(
    *,
    mode: str,
    window: int,
    meta: dict[str, Any],
    stream_tokens: list[dict[str, Any]],
    match: _TokenMatch,
) -> dict[str, Any]:
    matched_tokens = [_token_public(stream_tokens[i]) for i in match.indices]
    start_tok = stream_tokens[match.start]
    end_tok = stream_tokens[match.end - 1]

    ctx_start = max(0, match.start - window)
    ctx_end = min(len(stream_tokens), match.end + window)
    context_tokens = [_token_public(tok) for tok in stream_tokens[ctx_start:ctx_end]]

    sent_id = int(start_tok["sent_id"])
    end_sent_id = int(end_tok["sent_id"])
    start_pos = int(start_tok["position"])
    end_pos = int(end_tok["position"])
    text_norm = meta.get("text_norm") or ""

    base_hit: dict[str, Any] = {
        "doc_id": int(meta["doc_id"]),
        "unit_id": int(meta["unit_id"]),
        "external_id": meta["external_id"],
        "language": meta["language"],
        "title": meta["title"],
        "text_norm": text_norm,
        "sent_id": sent_id,
        "start_position": start_pos,
        "end_position": end_pos,
        "tokens": matched_tokens,
        "context_tokens": context_tokens,
    }
    if end_sent_id != sent_id:
        base_hit["end_sent_id"] = end_sent_id

    if mode == "segment":
        base_hit["text"] = text_norm
        return base_hit

    if mode == "kwic":
        left_words = [
            str(tok["word"] or "")
            for tok in stream_tokens[ctx_start:match.start]
            if tok.get("word") is not None
        ]
        match_words = [
            str(tok["word"] or "")
            for tok in stream_tokens[match.start:match.end]
            if tok.get("word") is not None
        ]
        right_words = [
            str(tok["word"] or "")
            for tok in stream_tokens[match.end:ctx_end]
            if tok.get("word") is not None
        ]
        base_hit["left"] = " ".join(left_words).strip()
        base_hit["match"] = " ".join(match_words).strip()
        base_hit["right"] = " ".join(right_words).strip()
        return base_hit

    raise ValueError(f"Unknown token_query mode: {mode!r}. Expected 'segment' or 'kwic'.")


def _stream_groups(
    conn: sqlite3.Connection,
    *,
    within_sentence: bool,
    language: Optional[str],
    doc_ids: Optional[list[int]],
) -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    filters = ["u.unit_type = 'line'"]
    params: list[Any] = []
    if language:
        filters.append("d.language = ?")
        params.append(language)
    if doc_ids:
        placeholders = ",".join("?" * len(doc_ids))
        filters.append(f"u.doc_id IN ({placeholders})")
        params.extend(doc_ids)

    sql = f"""
        SELECT
            u.doc_id,
            u.unit_id,
            u.external_id,
            u.text_norm,
            u.text_raw,
            u.n AS unit_n,
            d.language,
            d.title,
            t.sent_id,
            t.position,
            t.token_id,
            t.word,
            t.lemma,
            t.upos,
            t.xpos,
            t.feats
        FROM tokens t
        JOIN units u ON u.unit_id = t.unit_id
        JOIN documents d ON d.doc_id = u.doc_id
        WHERE {" AND ".join(filters)}
        ORDER BY u.doc_id, u.n, t.sent_id, t.position
    """
    rows = conn.execute(sql, params).fetchall()

    groups: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    current_key: tuple[int, int] | tuple[int] | None = None
    current_meta: dict[str, Any] | None = None
    current_tokens: list[dict[str, Any]] = []

    for row in rows:
        key: tuple[int, int] | tuple[int]
        if within_sentence:
            key = (int(row["unit_id"]), int(row["sent_id"]))
        else:
            key = (int(row["unit_id"]),)

        if key != current_key:
            if current_meta is not None:
                groups.append((current_meta, current_tokens))
            current_key = key
            current_meta = {
                "doc_id": int(row["doc_id"]),
                "unit_id": int(row["unit_id"]),
                "external_id": row["external_id"],
                "text_norm": row["text_norm"] or "",
                "text_raw": row["text_raw"] or "",
                "language": row["language"],
                "title": row["title"],
            }
            current_tokens = []

        current_tokens.append(
            {
                "token_id": int(row["token_id"]),
                "sent_id": int(row["sent_id"]),
                "position": int(row["position"]),
                "word": row["word"],
                "lemma": row["lemma"],
                "upos": row["upos"],
                "xpos": row["xpos"],
                "feats": row["feats"],
            }
        )

    if current_meta is not None:
        groups.append((current_meta, current_tokens))

    return groups


def _fetch_aligned(
    conn: sqlite3.Connection,
    unit_ids: list[int],
) -> dict[int, list[dict[str, Any]]]:
    """Return aligned units keyed by hit unit_id.

    For each unit in *unit_ids*, looks up ``alignment_links`` (in both
    directions) and returns metadata for every partner unit found.
    """
    if not unit_ids:
        return {}

    unit_ids_set = set(unit_ids)
    ph = ",".join("?" * len(unit_ids))

    rows = conn.execute(
        f"""
        SELECT al.pivot_unit_id, al.target_unit_id, al.status
        FROM alignment_links al
        WHERE al.pivot_unit_id IN ({ph}) OR al.target_unit_id IN ({ph})
        """,
        unit_ids * 2,
    ).fetchall()

    if not rows:
        return {}

    # Map each hit unit → list of (partner_unit_id, status)
    hit_to_partners: dict[int, list[tuple[int, str | None]]] = {}
    for row in rows:
        src = int(row["pivot_unit_id"])
        tgt = int(row["target_unit_id"])
        status: str | None = row["status"]
        if src in unit_ids_set:
            hit_to_partners.setdefault(src, []).append((tgt, status))
        if tgt in unit_ids_set:
            hit_to_partners.setdefault(tgt, []).append((src, status))

    # Batch-fetch all partner unit details
    partner_ids = list({uid for pairs in hit_to_partners.values() for uid, _ in pairs})
    if not partner_ids:
        return {}

    pph = ",".join("?" * len(partner_ids))
    partner_rows = conn.execute(
        f"""
        SELECT u.unit_id, u.text_norm, d.doc_id, d.title, d.language
        FROM units u
        JOIN documents d ON d.doc_id = u.doc_id
        WHERE u.unit_id IN ({pph})
        """,
        partner_ids,
    ).fetchall()

    partner_map: dict[int, dict[str, Any]] = {
        int(r["unit_id"]): {
            "unit_id": int(r["unit_id"]),
            "doc_id": int(r["doc_id"]),
            "title": r["title"],
            "language": r["language"],
            "text_norm": r["text_norm"] or "",
        }
        for r in partner_rows
    }

    result: dict[int, list[dict[str, Any]]] = {}
    for hit_uid, pairs in hit_to_partners.items():
        seen_partners: set[int] = set()
        aligned = []
        for partner_uid, status in pairs:
            if partner_uid in partner_map and partner_uid not in seen_partners:
                seen_partners.add(partner_uid)
                entry = dict(partner_map[partner_uid])
                entry["status"] = status
                aligned.append(entry)
        if aligned:
            result[hit_uid] = aligned

    return result


def run_token_query_page(
    conn: sqlite3.Connection,
    *,
    cql: str,
    mode: str = "kwic",
    window: int = 10,
    language: Optional[str] = None,
    doc_ids: Optional[list[int]] = None,
    limit: int = 50,
    offset: int = 0,
    include_aligned: bool = False,
) -> dict[str, Any]:
    """Run a token-level CQL query with pagination."""
    if mode not in {"segment", "kwic"}:
        raise ValueError("mode must be 'segment' or 'kwic'")
    if window < 0:
        raise ValueError("window must be >= 0")
    if limit < 1 or limit > 200:
        raise ValueError("limit must be in [1, 200]")
    if offset < 0:
        raise ValueError("offset must be >= 0")

    query = parse_cql_query(cql)
    compiled_specs = _compile_specs(query)

    grouped_streams = _stream_groups(
        conn,
        within_sentence=query.within_sentence,
        language=language,
        doc_ids=doc_ids,
    )

    all_matches: list[tuple[dict[str, Any], list[dict[str, Any]], _TokenMatch]] = []
    for meta, stream_tokens in grouped_streams:
        if not stream_tokens:
            continue
        matches = _find_matches(stream_tokens, compiled_specs)
        for m in matches:
            all_matches.append((meta, stream_tokens, m))

    total = len(all_matches)
    page_matches = all_matches[offset : offset + limit]
    has_more = offset + limit < total
    next_offset = offset + limit if has_more else None

    hits: list[dict[str, Any]] = []
    for meta, stream_tokens, m in page_matches:
        hits.append(
            _build_hit(
                mode=mode,
                window=window,
                meta=meta,
                stream_tokens=stream_tokens,
                match=m,
            )
        )

    if include_aligned and hits:
        page_unit_ids = [h["unit_id"] for h in hits]
        aligned_map = _fetch_aligned(conn, page_unit_ids)
        for hit in hits:
            hit["aligned"] = aligned_map.get(hit["unit_id"], [])

    return {
        "hits": hits,
        "limit": limit,
        "offset": offset,
        "next_offset": next_offset,
        "has_more": has_more,
        "total": total,
    }

