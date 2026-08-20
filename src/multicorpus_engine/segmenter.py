"""Sentence segmenter — rule-based block → sentence-level units.

Splits a document's stored line units into sentence-level units using regex
rules. Protects known abbreviations and decimal numbers from false boundary
detection. After resegmentation the FTS index is stale (rebuild via `index`).
Stale alignment_links for the document are deleted automatically.

See docs/DECISIONS.md ADR-017.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


def _get_text_start_n(conn: sqlite3.Connection, doc_id: int) -> int | None:
    """Return text_start_n for *doc_id*, or None if not set.

    Units with n < text_start_n are paratextual (title page, notes, etc.) and
    must be excluded from segmentation so their content and unit_role are
    preserved intact.
    """
    row = conn.execute(
        "SELECT text_start_n FROM documents WHERE doc_id = ?", (doc_id,)
    ).fetchone()
    return row[0] if row and row[0] is not None else None


# ---------------------------------------------------------------------------
# Abbreviation protection
# ---------------------------------------------------------------------------

# Pattern that matches tokens that should NOT be treated as sentence ends.
_BASE_ABBREV_PATTERN = (
    r"\b(?:M|Mme|Mmes|Dr|Prof|St|Sgt|Cdt|Lt|Cpt|Mlle|Mlles|No|Nos|Mr|Mrs|Ms)\."
    r"|\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\."
    r"|\b(?:p|pp|vol|ed|eds|fig|tab|art|sect|cf|vs|ibid|loc|op|cit)\."
    r"|\d+\.\d+"  # decimal numbers: 3.14, 1.000
)

# Split on sentence-ending punctuation followed by whitespace then a capital
# letter or opening quote/parenthesis. Does not split mid-abbreviation because
# abbreviations are protected before this regex is applied.
_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-ZÀ-Ÿ\"\u2018\u2019\u201C\u201D(])")


_PACK_EXTRA_ABBREVIATIONS: dict[str, tuple[str, ...]] = {
    "default": (),
    # Keeps common French abbreviations from triggering sentence breaks.
    "fr_strict": ("ann", "chap", "env", "etc", "par"),
    # Keeps common English abbreviations from triggering sentence breaks.
    "en_strict": ("approx", "dept", "misc", "chap"),
}


def _compile_abbrev_regex_from_list(extras: tuple[str, ...]) -> re.Pattern:
    """Compile the abbreviation-protection regex: the shared base pattern plus an
    optional list of extra abbreviations (each protected from a false sentence break)."""
    if not extras:
        return re.compile(_BASE_ABBREV_PATTERN, flags=re.IGNORECASE)
    escaped = "|".join(re.escape(token) for token in extras)
    pattern = f"{_BASE_ABBREV_PATTERN}|\\b(?:{escaped})\\."
    return re.compile(pattern, flags=re.IGNORECASE)


def _compile_abbrev_regex(pack: str) -> re.Pattern:
    extras = _PACK_EXTRA_ABBREVIATIONS.get(pack)
    if extras is None:
        raise ValueError(f"Unknown segmentation pack: {pack!r}")
    return _compile_abbrev_regex_from_list(extras)


_ABBREV_RE_BY_PACK: dict[str, re.Pattern] = {
    name: _compile_abbrev_regex(name) for name in _PACK_EXTRA_ABBREVIATIONS
}


def resolve_segment_pack(pack: str | None, lang: str = "und") -> str:
    """Resolve a user-facing pack name to an internal segmentation pack key."""
    raw_pack = (pack or "").strip().lower()
    if not raw_pack or raw_pack == "auto":
        norm_lang = (lang or "und").strip().lower()
        if norm_lang.startswith("fr"):
            return "fr_strict"
        if norm_lang.startswith("en"):
            return "en_strict"
        return "default"
    if raw_pack not in _ABBREV_RE_BY_PACK:
        supported = ", ".join(sorted(_ABBREV_RE_BY_PACK))
        raise ValueError(
            f"Unknown segmentation pack: {raw_pack!r}. "
            f"Use auto or one of: {supported}"
        )
    return raw_pack


# ---------------------------------------------------------------------------
# Configurable segmentation spec (R5.4)
# ---------------------------------------------------------------------------

# The "capital letter / opening quote" class a terminator must be followed by *when*
# ``require_uppercase_after`` is on. The "phrases" preset no longer requires it (R5.4b) —
# this set now serves the Personnalisé "majuscule après" refinement.
_UPPER_FOLLOW = "A-ZÀ-Ÿ\"‘’“”("

# Closing punctuation that may sit *between* a sentence terminator and the whitespace,
# e.g. « … pasado.» Eso → the '.' is hidden behind the closing guillemet, but the sentence
# still ends there. We let one such mark precede the split. stdlib re requires fixed-width
# lookbehind, so _compile_terminator_re alternates a bare branch and a +1-closer branch.
_CLOSE_PUNCT = "\"')]}»›’”"


@dataclass(frozen=True)
class SegmentSpec:
    """A configurable segmentation boundary (R5.4).

    ``kind``:
      - ``"terminator"`` — split *after* any char in ``terminators`` at the
        following whitespace. ``require_uppercase_after`` gates on a capital/quote
        following (robust for sentences; **turn OFF** for clause ``;:`` or word
        splitting, which are followed by lowercase). ``protect_abbreviations``
        shields listed abbreviations (``M.``, ``etc.``…) from false breaks.
      - ``"whitespace"`` — split on whitespace runs (each token a segment) → words.
      - ``"markers"`` — split on embedded ``[N]`` markers (external_id semantics).

    (``"pattern"`` — line-anchored boundaries for verse / speech turns — is R5.4c;
    it needs the original line structure, not the normalized ``text_norm``.)
    """

    kind: str = "terminator"
    terminators: str = ".!?"
    require_uppercase_after: bool = True
    protect_abbreviations: tuple[str, ...] = ()
    label: str = "phrases"


_MARKERS_SPEC = SegmentSpec(kind="markers", label="markers")


def resolve_preset(name: str | None, lang: str = "und", pack: str | None = None) -> SegmentSpec:
    """Resolve a built-in preset name to a :class:`SegmentSpec`.

    ``"phrases"`` = terminators ``.!?`` (+ a closing quote/bracket) with the language's
    abbreviation pack, but **without** a capital-after condition (R5.4b: a terminator ends
    a segment regardless of the following case — so Phrases also cuts before a ``[N]`` marker
    or a lowercase word; the capital-after refinement lives in Personnalisé). ``"mots"`` =
    whitespace (words) ; ``"balises"`` = ``[N]`` markers.
    """
    key = (name or "phrases").strip().lower()
    if key == "phrases":
        resolved_pack = resolve_segment_pack(pack, lang)
        return SegmentSpec(
            kind="terminator",
            terminators=".!?",
            require_uppercase_after=False,
            protect_abbreviations=_PACK_EXTRA_ABBREVIATIONS[resolved_pack],
            label=resolved_pack,
        )
    if key in ("mots", "words"):
        return SegmentSpec(kind="whitespace", label="mots")
    if key in ("balises", "markers"):
        return _MARKERS_SPEC
    raise ValueError(
        f"Unknown segmentation preset: {name!r}. Use one of: phrases, mots, balises."
    )


_SPEC_KINDS = ("terminator", "whitespace", "markers")


def spec_from_dict(d: dict) -> SegmentSpec:
    """Build a validated :class:`SegmentSpec` from a request payload (the ``spec``
    object of ``/segment(/preview)``). Keeps spec parsing/validation in the engine
    so the sidecar handler stays a thin adapter (growth-gate). Raises ``ValueError``
    on a bad shape — the handler maps it to the endpoint's 400."""
    if not isinstance(d, dict):
        raise ValueError("spec must be an object.")
    kind = str(d.get("kind") or "terminator").strip().lower()
    if kind not in _SPEC_KINDS:
        raise ValueError(f"Unknown spec kind: {kind!r}. Use one of: {', '.join(_SPEC_KINDS)}.")
    abbrevs = d.get("protect_abbreviations") or ()
    if not isinstance(abbrevs, (list, tuple)):
        raise ValueError("protect_abbreviations must be a list of strings.")
    # Explicit JSON null → the documented default (NOT str(None)=="None", which
    # would become a bogus [None] char class). An explicit "" is preserved (the
    # intentional "no boundary → single segment" case).
    terminators = d.get("terminators")
    require_uc = d.get("require_uppercase_after")
    return SegmentSpec(
        kind=kind,
        terminators=".!?" if terminators is None else str(terminators),
        require_uppercase_after=True if require_uc is None else bool(require_uc),
        protect_abbreviations=tuple(str(a) for a in abbrevs),
        label=str(d.get("label") or "custom"),
    )


def _compile_terminator_re(spec: SegmentSpec) -> re.Pattern:
    """Split regex for a terminator spec: split at the whitespace *after* any
    terminator char (optionally wrapped by one closing quote/bracket, e.g. ``.»``),
    optionally requiring a capital/quote to follow."""
    cls = "".join(re.escape(c) for c in spec.terminators)
    close = "".join(re.escape(c) for c in _CLOSE_PUNCT)
    # A closing mark may sit between the terminator and the space. stdlib re needs a
    # fixed-width lookbehind, so alternate a bare-terminator branch (width 1) and a
    # terminator+closer branch (width 2).
    behind = rf"(?:(?<=[{cls}])|(?<=[{cls}][{close}]))"
    if spec.require_uppercase_after:
        return re.compile(rf"{behind}\s+(?=[{_UPPER_FOLLOW}])")
    return re.compile(rf"{behind}\s+")


def _split_terminator(text: str, spec: SegmentSpec) -> list[str]:
    """Terminator-based split — generalises the historical ``segment_text`` body:
    protect abbreviations → split on the boundary regex → restore. Byte-identical
    to the old code when ``spec`` is the ``phrases`` preset."""
    if not text or not text.strip():
        return [text] if text else []
    if not spec.terminators:
        # No boundary characters → single segment (guards against an invalid empty
        # `[]` regex class when a custom spec supplies no terminators).
        return [text.strip()]

    abbrev_re = _compile_abbrev_regex_from_list(spec.protect_abbreviations)
    split_re = _compile_terminator_re(spec)

    counter = 0
    placeholders: dict[str, str] = {}

    def _protect(m: re.Match) -> str:
        nonlocal counter
        ph = f"\x00A{counter}\x00"
        placeholders[ph] = m.group(0)
        counter += 1
        return ph

    protected = abbrev_re.sub(_protect, text)
    raw_sentences = split_re.split(protected)

    result: list[str] = []
    for fragment in raw_sentences:
        restored = fragment
        for ph, original in placeholders.items():
            restored = restored.replace(ph, original)
        stripped = restored.strip()
        if stripped:
            result.append(stripped)
    return result if result else [text.strip()]


def split_unit_text(text: str, spec: SegmentSpec) -> list[tuple[int | None, str]]:
    """The single split primitive shared by both resegmentation paths (R5.4).

    Returns ``(external_id | None, segment)`` tuples — ``external_id`` is only set
    by the ``markers`` kind (from ``[N]``); ``None`` for terminator/whitespace.
    """
    if spec.kind == "markers":
        return segment_text_markers(text)
    if spec.kind == "whitespace":
        return [(None, tok) for tok in re.split(r"\s+", (text or "").strip()) if tok]
    return [(None, seg) for seg in _split_terminator(text, spec)]


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def segment_text(text: str, lang: str = "und", pack: str | None = None) -> list[str]:
    """Split *text* into sentence strings (rule-based).

    Thin wrapper over the ``phrases`` preset (R5.4) — protect abbreviations, split
    on ``(?<=[.!?])\\s+(?=[A-ZÀ-Ÿ…])``, restore. Kept for the many existing callers;
    byte-identical to the historical splitter.

    Args:
        text: Text to segment (already normalized, e.g. text_norm).
        lang: ISO language code.
        pack: Optional quality pack ("auto", "default", "fr_strict", "en_strict").
    """
    return _split_terminator(text, resolve_preset("phrases", lang, pack))


# ---------------------------------------------------------------------------
# Marker-based segmentation  ([1], [2], [14]… embedded in text)
# ---------------------------------------------------------------------------

# Detects [N] anywhere in a text (for scanning units).
# Captures the first number found.
_MARKER_ANYWHERE_RE = re.compile(r"\[\s*(\d+)\s*\]")

# Splits text on [N] occurrences that can appear:
#   - at the start of the unit              "[1] text"
#   - in the middle of a paragraph          "text. [15] Next sentence"
#   - after a newline                       "\n[3] text"
# The marker may be preceded by whitespace or end-of-sentence punctuation + space.
_MARKER_SPLIT_RE = re.compile(r"\[\s*(\d+)\s*\]\s*")


def detect_markers_in_units(
    conn: sqlite3.Connection,
    doc_id: int,
    *,
    min_ratio: float = 0.3,
) -> dict:
    """Scan existing line units for embedded [N] marker patterns.

    Detects markers appearing anywhere in the text — at the start, in the middle
    of a paragraph, or after a newline.  A unit is considered "marked" if it
    contains at least one [N] pattern.

    Returns a detection report dict:
        {
            "detected": bool,          # True when marker_ratio > min_ratio
            "total_units": int,
            "marked_units": int,
            "marker_ratio": float,     # marked / total
            "sample": list[dict],      # first 5 marked units
            "first_markers": list[int] # up to 10 extracted marker IDs
        }
    """
    rows = conn.execute(
        "SELECT n, text_norm FROM units WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
        (doc_id,),
    ).fetchall()

    total = len(rows)
    marked = []
    first_markers: list[int] = []

    for n, text in rows:
        if not text:
            continue
        m = _MARKER_ANYWHERE_RE.search(text)
        if m:
            marked.append({"n": n, "text": (text or "")[:120]})
            if len(first_markers) < 10:
                first_markers.append(int(m.group(1)))

    ratio = len(marked) / total if total else 0.0
    return {
        "detected": ratio >= min_ratio,
        "total_units": total,
        "marked_units": len(marked),
        "marker_ratio": round(ratio, 3),
        "sample": marked[:5],
        "first_markers": first_markers,
    }


def segment_text_markers(text: str) -> list[tuple[int | None, str]]:
    """Split *text* by embedded [N] markers.

    Handles all placement patterns:
    - "[N] text"          — marker at start of unit
    - "text. [N] text"    — marker mid-paragraph (after a sentence)
    - "text\\n[N] text"   — marker after newline

    Returns a list of (external_id_or_None, segment_text) tuples.
    Text appearing before the first marker gets external_id=None.
    If no markers found, returns [(None, stripped_text)].
    """
    text = (text or "").strip()
    if not text:
        return []

    # Split on [N] wherever it occurs; re.split with a capturing group gives:
    #   [text_before_first_match, id1, text1, id2, text2, ...]
    parts = _MARKER_SPLIT_RE.split(text)
    result: list[tuple[int | None, str]] = []

    prefix = (parts[0] or "").strip()
    if prefix:
        result.append((None, prefix))

    i = 1
    while i + 1 < len(parts):
        ext_id = int(parts[i])
        seg = (parts[i + 1] or "").strip()
        if seg:
            result.append((ext_id, seg))
        i += 2

    return result if result else [(None, text)]


def resegment_document_markers(
    conn: sqlite3.Connection,
    doc_id: int,
    run_logger: Optional[logging.Logger] = None,
    record_action: Optional[ResegmentActionRecorder] = None,
) -> SegmentationReport:
    """Re-segment a document using embedded [N] markers.

    Each stored unit whose text_norm contains [N] patterns is split at the
    markers.  The marker number is stored as external_id so that
    alignment strategy=external_id can match units across documents.

    Units without any marker are kept with external_id=NULL.

    Clears existing alignment_links (same as resegment_document).
    FTS index is NOT rebuilt — caller must do it.
    """
    log = run_logger or logger

    # Respect paratextual boundary: units with n < text_start_n are kept as-is.
    text_start_n = _get_text_start_n(conn, doc_id)
    if text_start_n is not None:
        rows = conn.execute(
            "SELECT unit_id, n, text_raw, text_norm, text_source, external_id, meta_json"
            " FROM units"
            " WHERE doc_id = ? AND unit_type = 'line' AND n >= ? ORDER BY n",
            (doc_id, text_start_n),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT unit_id, n, text_raw, text_norm, text_source, external_id, meta_json"
            " FROM units"
            " WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
            (doc_id,),
        ).fetchall()

    if not rows:
        return SegmentationReport(
            doc_id=doc_id,
            units_input=0,
            units_output=0,
            segment_pack="markers",
            warnings=[f"No line units found for doc_id={doc_id}"],
        )

    # Snapshot convention roles before deletion — single query, O(1) round-trips.
    ns = [row["n"] for row in rows]
    placeholders = ",".join("?" * len(ns))
    role_map: dict[int, str] = {
        r["n"]: r["unit_role"]
        for r in conn.execute(
            f"SELECT n, unit_role FROM units"
            f" WHERE doc_id = ? AND n IN ({placeholders}) AND unit_role IS NOT NULL",
            [doc_id, *ns],
        ).fetchall()
    }

    # (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json, text_source)
    new_units: list[tuple] = []
    first_seg_n: dict[int, int] = {}
    global_n = text_start_n if text_start_n is not None else 1
    units_without_marker = 0

    for row in rows:
        text_norm = row["text_norm"] or ""
        # text_source propagated from the parent line (ADR-043 P2) — its original import
        # text, or text_raw when the parent has none captured (legacy).
        src = row["text_source"] if row["text_source"] is not None else (row["text_raw"] or "")
        # R2.1 — persist the coarse anchor (parent_n = source ordinal), same as
        # resegment_document. Meaningful when source units are paragraphs; trivial
        # (all share one parent) when splitting a single blob — a better coarse grain
        # from ¤/blank-line cues comes with R2.2.
        parent_meta = json.dumps({"parent_n": row["n"]})
        segments = split_unit_text(text_norm, _MARKERS_SPEC)  # == segment_text_markers (R5.4)
        first_seg_n[row["n"]] = global_n
        for ext_id, seg_text in segments:
            if ext_id is None:
                units_without_marker += 1
            new_units.append((doc_id, "line", global_n, ext_id, seg_text, seg_text, parent_meta, src))
            global_n += 1

    warnings: list[str] = []
    # ALI-10 / D-2 — meme motif que resegment_document : lire les liens ici, les
    # supprimer, poser l'archive une fois l'action creee (plus bas). Sans recorder il
    # n'y a rien a quoi la rattacher, et la destruction reste irreversible.
    action_id: Optional[int] = None
    archived_links: list[tuple] = []
    if record_action is not None:
        from multicorpus_engine.action_history import collect_links_for_document

        archived_links = collect_links_for_document(conn, doc_id)

    # Delete stale alignment links
    deleted_links = conn.execute(
        "DELETE FROM alignment_links WHERE pivot_doc_id = ? OR target_doc_id = ?",
        (doc_id, doc_id),
    ).rowcount
    if deleted_links:
        w = f"Deleted {deleted_links} alignment_link(s) for doc_id={doc_id} (stale after resegmentation)"
        log.warning(w)
        warnings.append(w)

    if units_without_marker:
        warnings.append(
            f"{units_without_marker} unit(s) had no [N] marker — external_id left as NULL."
        )

    # Delete only text units (n >= text_start_n) — paratext units are preserved
    if text_start_n is not None:
        conn.execute(
            "DELETE FROM units WHERE doc_id = ? AND unit_type = 'line' AND n >= ?",
            (doc_id, text_start_n),
        )
    else:
        conn.execute("DELETE FROM units WHERE doc_id = ? AND unit_type = 'line'", (doc_id,))
    conn.executemany(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json, text_source)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        new_units,
    )

    # Re-apply convention roles on the first segment of each original unit
    roles_reapplied = 0
    for old_n, role in role_map.items():
        new_n = first_seg_n.get(old_n)
        if new_n is not None:
            conn.execute(
                "UPDATE units SET unit_role = ? WHERE doc_id = ? AND n = ?",
                (role, doc_id, new_n),
            )
            roles_reapplied += 1
    if roles_reapplied:
        log.info(
            "resegment_document_markers doc_id=%d: re-applied %d convention role(s)",
            doc_id, roles_reapplied,
        )

    # Mode A — meme forme que resegment_document : l'action et ses instantanes
    # partagent la transaction de la mutation, ils tombent ou tiennent ensemble.
    if record_action is not None and new_units:
        new_rows = conn.execute(
            "SELECT unit_id, n FROM units WHERE doc_id = ? AND unit_type = 'line'"
            + (" AND n >= ?" if text_start_n is not None else "")
            + " ORDER BY n",
            (doc_id, text_start_n) if text_start_n is not None else (doc_id,),
        ).fetchall()
        action_id = record_action({
            "doc_id":            doc_id,
            "pack":              "markers",
            "lang":              "und",
            "text_start_n":      text_start_n,
            "units_before":      [
                {
                    "unit_id":     int(r["unit_id"]),
                    "n":           int(r["n"]),
                    "external_id": r["external_id"],
                    "text_raw":    r["text_raw"],
                    "text_norm":   r["text_norm"],
                    "unit_role":   role_map.get(r["n"]),
                    "meta_json":   r["meta_json"],
                    "text_source": r["text_source"],
                }
                for r in rows
            ],
            "created_unit_ids":  [int(r["unit_id"]) for r in new_rows],
            "new_units_n":       [int(r["n"]) for r in new_rows],
        })
        if action_id is not None and archived_links:
            from multicorpus_engine.action_history import insert_link_snapshots

            insert_link_snapshots(int(action_id), archived_links, conn=conn)

    conn.commit()

    log.info(
        "Marker resegment doc_id=%d: %d units → %d segments (%d with external_id)",
        doc_id, len(rows), len(new_units), len(new_units) - units_without_marker,
    )
    return SegmentationReport(
        doc_id=doc_id,
        units_input=len(rows),
        units_output=len(new_units),
        segment_pack="markers",
        warnings=warnings,
        roles_reapplied=roles_reapplied,
        action_id=action_id,
    )


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


@dataclass
class SegmentationReport:
    """Result of segmenting one document."""

    doc_id: int
    units_input: int    # Line units before segmentation
    units_output: int   # Sentence-level units after segmentation
    segment_pack: str
    warnings: list[str] = field(default_factory=list)
    roles_reapplied: int = 0  # Convention roles re-applied (best-effort) after resegmentation
    action_id: Optional[int] = None  # set when a Mode-A undo recorder ran

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "units_input": self.units_input,
            "units_output": self.units_output,
            "segment_pack": self.segment_pack,
            "warnings": self.warnings,
            "roles_reapplied": self.roles_reapplied,
            "action_id": self.action_id,
        }


# Callback signature for the Mode-A undo recorder. Invoked inside
# resegment_document's transaction, *after* the DELETE/INSERT but *before*
# commit. The payload dict carries:
#   doc_id           : int
#   pack             : str (resolved)
#   lang             : str
#   text_start_n     : int | None
#   units_before     : list[dict] — pre-mutation snapshot of every text unit
#                      that was deleted; each has unit_id, n, external_id,
#                      text_raw, text_norm, unit_role, meta_json
#   created_unit_ids : list[int] — newly inserted unit_ids in n-order
#   new_units_n      : list[int] — n values matching created_unit_ids
# Must return action_id (int) or None to skip recording.
ResegmentActionRecorder = Callable[[dict[str, Any]], Optional[int]]


# ---------------------------------------------------------------------------
# DB operation
# ---------------------------------------------------------------------------


def resegment_document(
    conn: sqlite3.Connection,
    doc_id: int,
    lang: str = "und",
    pack: str | None = None,
    run_logger: Optional[logging.Logger] = None,
    record_action: Optional[ResegmentActionRecorder] = None,
    spec: Optional[SegmentSpec] = None,
) -> SegmentationReport:
    """Replace line units in *doc_id* with segments per a :class:`SegmentSpec`.

    ``spec=None`` reproduces the historical sentence segmentation (``phrases``
    preset from ``lang``/``pack``) **byte-identically**; a caller may pass any
    terminator/whitespace spec (markers go through ``resegment_document_markers``).

    Steps:
    1. Load all line units (text_norm) ordered by n.
    2. Segment each unit into sentences via segment_text().
    3. Delete stale alignment_links that referenced this document.
    4. Delete old line units.
    5. Insert new sentence-level line units (n = 1, 2, 3, … globally).
    6. Commit.

    **FTS index is NOT rebuilt** — caller must run build_index() afterwards.
    alignment_links are deleted automatically with a warning.

    Returns SegmentationReport with unit counts.
    """
    log = run_logger or logger
    resolved_pack = resolve_segment_pack(pack, lang)
    # R5.4 — resolve the boundary spec. spec=None → the historical "phrases" preset
    # (byte-identical). report_pack labels the output in the report/undo payload.
    seg_spec = spec if spec is not None else resolve_preset("phrases", lang, pack)
    report_pack = resolved_pack if spec is None else (seg_spec.label or "custom")
    if seg_spec.kind == "markers":
        # Markers carry external_id semantics + their own warnings/no-undo path.
        raise ValueError(
            "resegment_document handles terminator/whitespace specs only; "
            "route markers specs through resegment_document_markers."
        )

    # Respect paratextual boundary: units with n < text_start_n are kept as-is.
    # We grab full unit fields here so the Mode A undo recorder can rebuild
    # the deleted units identically on undo (text_raw, external_id, role, meta).
    text_start_n = _get_text_start_n(conn, doc_id)
    if text_start_n is not None:
        rows = conn.execute(
            "SELECT unit_id, n, external_id, text_raw, text_norm, unit_role, meta_json, text_source"
            " FROM units"
            " WHERE doc_id = ? AND unit_type = 'line' AND n >= ? ORDER BY n",
            (doc_id, text_start_n),
        ).fetchall()
        paratext_count = conn.execute(
            "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line' AND n < ?",
            (doc_id, text_start_n),
        ).fetchone()[0]
    else:
        rows = conn.execute(
            "SELECT unit_id, n, external_id, text_raw, text_norm, unit_role, meta_json, text_source"
            " FROM units"
            " WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
            (doc_id,),
        ).fetchall()
        paratext_count = 0

    if not rows:
        log.warning("resegment_document: no text units for doc_id=%d (paratext: %d)", doc_id, paratext_count)
        return SegmentationReport(
            doc_id=doc_id,
            units_input=0,
            units_output=0,
            segment_pack=report_pack,
            warnings=[f"No text units found for doc_id={doc_id} (paratextual boundary: n≥{text_start_n})"],
        )

    # Snapshot convention roles before deletion — single query, O(1) round-trips.
    # Maps old n → role name for units that have a non-null unit_role.
    ns = [row["n"] for row in rows]
    placeholders = ",".join("?" * len(ns))
    role_map: dict[int, str] = {
        r["n"]: r["unit_role"]
        for r in conn.execute(
            f"SELECT n, unit_role FROM units"
            f" WHERE doc_id = ? AND n IN ({placeholders}) AND unit_role IS NOT NULL",
            [doc_id, *ns],
        ).fetchall()
    }

    # Collect new sentence-level unit tuples — n values start after paratext.
    # Also track which new n receives the first sentence of each original unit
    # so roles can be re-applied (one original line → potentially N sentences,
    # role assigned to the first segment only).
    # (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json, text_source)
    new_units: list[tuple] = []
    # Maps old_n → new_n of its first produced segment (for role reapplication)
    first_seg_n: dict[int, int] = {}
    global_n = text_start_n if text_start_n is not None else 1

    for row in rows:
        text_norm = row["text_norm"] or ""
        # text_source propagated from the parent line (ADR-043 P2): its original import
        # text, or text_raw when none was captured (legacy).
        src = row["text_source"] if row["text_source"] is not None else (row["text_raw"] or "")
        # R2.1 (refonte deux-grains) — persist the coarse anchor: every sentence born
        # from this source line records its parent's ordinal (parent_n = the source n).
        # It's a *logical* key, not a FK — the source unit is deleted below, so we keep
        # the position, not the unit_id. Enables two-level (paragraph ⊃ sentence)
        # grouping + the bounded aligner (R3) without a migration. Undo is unaffected:
        # the snapshot restores the pre-resegment units with their original meta_json.
        parent_meta = json.dumps({"parent_n": row["n"]})
        segs = split_unit_text(text_norm, seg_spec)
        first_seg_n[row["n"]] = global_n
        for ext_id, sent in segs:
            new_units.append((doc_id, "line", global_n, ext_id, sent, sent, parent_meta, src))
            global_n += 1

    # ALI-10 — archive the links BEFORE destroying them, when this call is undoable.
    # The action does not exist yet (record_action runs after the writes, below), so
    # this is the read half of the collect/insert pair: read now, delete, insert once
    # the action_id is known — the same shape as _handle_units_split.
    # Without a recorder there is no action to hang an archive from: those callers
    # (family segment, async job, markers) destroy irreversibly, see audit §11.14.
    archived_links: list[tuple] = []
    if record_action is not None:
        from multicorpus_engine.action_history import collect_links_for_document

        archived_links = collect_links_for_document(conn, doc_id)

    # Delete stale alignment_links
    deleted_links = conn.execute(
        "DELETE FROM alignment_links WHERE pivot_doc_id = ? OR target_doc_id = ?",
        (doc_id, doc_id),
    ).rowcount
    # Two audiences, two sentences. The log keeps the doc_id and stays technical; the
    # report's warning is read by the user in the segmentation pane (SegmentPane.ts:715
    # renders report.warnings verbatim), so it says what happened AND whether it can be
    # taken back — the archive only exists on the recorded path (audit §11.14).
    log.warning(
        "Deleted %d alignment_link(s) for doc_id=%d (stale after resegmentation, %s)",
        deleted_links, doc_id,
        f"{len(archived_links)} archived for undo" if record_action is not None else "no archive",
    )
    plural = "s" if deleted_links > 1 else ""
    warn = (
        f"{deleted_links} lien{plural} d'alignement supprimé{plural} — "
        + (
            "annulable" + plural + " tant que cette resegmentation reste la dernière "
            "action du document."
            if record_action is not None
            else "définitif" + plural + " : cette opération n'est pas annulable."
        )
    )

    # Delete only text units (n >= text_start_n) — paratext units are preserved
    if text_start_n is not None:
        conn.execute(
            "DELETE FROM units WHERE doc_id = ? AND unit_type = 'line' AND n >= ?",
            (doc_id, text_start_n),
        )
    else:
        conn.execute("DELETE FROM units WHERE doc_id = ? AND unit_type = 'line'", (doc_id,))

    # Insert new units
    conn.executemany(
        "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json, text_source)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        new_units,
    )

    # Re-apply convention roles on the first segment produced by each old unit
    roles_reapplied = 0
    for old_n, role in role_map.items():
        new_n = first_seg_n.get(old_n)
        if new_n is not None:
            conn.execute(
                "UPDATE units SET unit_role = ? WHERE doc_id = ? AND n = ?",
                (role, doc_id, new_n),
            )
            roles_reapplied += 1
    if roles_reapplied:
        log.info(
            "resegment_document doc_id=%d: re-applied %d convention role(s) "
            "(best-effort, on first segment of each original unit)",
            doc_id, roles_reapplied,
        )

    # Mode A undo recorder: invoked before commit so snapshot + mutation share
    # one transaction. We re-query the freshly-inserted units to get their
    # unit_ids (executemany doesn't expose lastrowid per row).
    action_id: Optional[int] = None
    if record_action is not None and len(new_units) > 0:
        if text_start_n is not None:
            new_rows = conn.execute(
                "SELECT unit_id, n FROM units"
                " WHERE doc_id = ? AND unit_type = 'line' AND n >= ? ORDER BY n",
                (doc_id, text_start_n),
            ).fetchall()
        else:
            new_rows = conn.execute(
                "SELECT unit_id, n FROM units"
                " WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
                (doc_id,),
            ).fetchall()
        units_before_payload = [
            {
                "unit_id":     int(r["unit_id"]),
                "n":           int(r["n"]),
                "external_id": r["external_id"],
                "text_raw":    r["text_raw"],
                "text_norm":   r["text_norm"],
                "unit_role":   r["unit_role"],
                "meta_json":   r["meta_json"],
                "text_source": r["text_source"],  # restored on undo (ADR-043 P2)
            }
            for r in rows
        ]
        action_id = record_action({
            "doc_id":            doc_id,
            "pack":              report_pack,
            "lang":              lang,
            "text_start_n":      text_start_n,
            "units_before":      units_before_payload,
            "created_unit_ids":  [int(r["unit_id"]) for r in new_rows],
            "new_units_n":       [int(r["n"]) for r in new_rows],
        })
        # The action exists now: the archive can be attached. Same transaction as the
        # DELETE above, so snapshot and destruction land or roll back together.
        if action_id is not None and archived_links:
            from multicorpus_engine.action_history import insert_link_snapshots

            insert_link_snapshots(int(action_id), archived_links, conn=conn)

    conn.commit()

    if paratext_count:
        log.info(
            "Resegmented doc_id=%d: %d text units → %d sentence units (%d paratext units preserved)",
            doc_id, len(rows), len(new_units), paratext_count,
        )
    else:
        log.info(
            "Resegmented doc_id=%d: %d line units → %d sentence units",
            doc_id, len(rows), len(new_units),
        )
    return SegmentationReport(
        doc_id=doc_id,
        units_input=len(rows),
        units_output=len(new_units),
        segment_pack=report_pack,
        warnings=[warn] if deleted_links > 0 else [],
        roles_reapplied=roles_reapplied,
        action_id=action_id,
    )
