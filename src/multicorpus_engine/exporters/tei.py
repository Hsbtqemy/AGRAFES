"""TEI "analyse" exporter.

Produces a well-formed, UTF-8 encoded TEI XML file from a document's units.
All text is XML-escaped. Characters invalid in XML 1.0 are stripped.
See docs/DECISIONS.md ADR-009 and docs/TEI_PROFILE.md.

Supported options:
- include_structure: bool (default False) — emit <head> for structure units
- include_alignment: bool (default False) — emit <linkGrp> with alignment links
- target_doc_id: int | None — restrict alignment links to this target doc
- status_filter: list[str] (default ["accepted"]) — which link statuses to include
  ("accepted", "unreviewed", "rejected", "all")
- enrich_header: bool (default False) — add textClass (doc_role, resource_type)
  and listRelation from doc_relations table

Returns:
- Path to the output file (always)
- warnings list (may be empty) — structured dicts for missing/invalid fields
"""

from __future__ import annotations

import json as _json
import re
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional


# Characters invalid in XML 1.0 (as a compiled pattern to strip)
_XML10_INVALID = re.compile(
    r"[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\U00010000-\U0010FFFF]"
)

_STATUS_NULL_ALIASES = {"unreviewed", "null", None}


def strip_xml10_invalid(text: str) -> str:
    """Remove characters that are illegal in XML 1.0."""
    return _XML10_INVALID.sub("", text)


def xml_escape(text: str) -> str:
    """Escape XML special characters and strip XML 1.0 invalid chars."""
    text = strip_xml10_invalid(text)
    text = text.replace("&", "&amp;")
    text = text.replace("<", "&lt;")
    text = text.replace(">", "&gt;")
    text = text.replace('"', "&quot;")
    text = text.replace("'", "&apos;")
    return text


def _get_document(conn: sqlite3.Connection, doc_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM documents WHERE doc_id = ?", (doc_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"Document not found: doc_id={doc_id}")
    return row


def _get_units(conn: sqlite3.Connection, doc_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT unit_id, unit_type, n, external_id, text_norm, meta_json
        FROM units
        WHERE doc_id = ?
        ORDER BY n
        """,
        (doc_id,),
    ).fetchall()


def _get_alignment_links(
    conn: sqlite3.Connection,
    pivot_doc_id: int,
    target_doc_id: Optional[int],
    status_filter: list[str],
) -> list[sqlite3.Row]:
    """Return alignment links from pivot_doc_id optionally restricted to target_doc_id."""
    where_clauses = ["al.pivot_doc_id = ?"]
    params: list = [pivot_doc_id]

    if target_doc_id is not None:
        where_clauses.append("al.target_doc_id = ?")
        params.append(target_doc_id)

    # Status filter
    if "all" not in status_filter:
        status_conditions = []
        for s in status_filter:
            if s in ("unreviewed", "null"):
                status_conditions.append("al.status IS NULL")
            else:
                status_conditions.append("al.status = ?")
                params.append(s)
        if status_conditions:
            where_clauses.append(f"({' OR '.join(status_conditions)})")

    where = " AND ".join(where_clauses)
    return conn.execute(
        f"""
        SELECT al.link_id, al.pivot_unit_id, al.target_unit_id, al.external_id,
               al.pivot_doc_id, al.target_doc_id, al.status
        FROM alignment_links al
        WHERE {where}
        ORDER BY al.external_id
        """,
        params,
    ).fetchall()


def _get_doc_relations(
    conn: sqlite3.Connection,
    doc_id: int,
) -> list[sqlite3.Row]:
    """Return doc_relations for this document."""
    try:
        return conn.execute(
            "SELECT id, doc_id, relation_type, target_doc_id, note, created_at FROM doc_relations WHERE doc_id = ?",
            (doc_id,),
        ).fetchall()
    except Exception:
        return []


def _build_parcolab_header(
    header: ET.Element,
    file_desc: ET.Element,
    profile: ET.Element,
    doc: sqlite3.Row,
    meta: dict,
    doc_id: int,
    warnings: list[dict],
) -> None:
    """Enrich teiHeader for ParCoLab-like export profile.

    Adds:
    - titleStmt: title, subtitle, author(s), translator(s)
    - publicationStmt: publisher, pubPlace, date (from meta_json or defaults)
    - profileDesc/langUsage: pivot + original language if available
    - profileDesc/textClass: domain, genre as keywords
    - profileDesc/listRelation: derivation, doc_role relation
    """
    title_stmt = file_desc.find("titleStmt")
    if title_stmt is None:
        title_stmt = ET.SubElement(file_desc, "titleStmt")

    title_el = title_stmt.find("title")
    if title_el is None:
        title_el = ET.SubElement(title_stmt, "title")
    title_el.text = strip_xml10_invalid(doc["title"] or f"Document {doc_id}")

    subtitle = meta.get("subtitle", "")
    if subtitle:
        sub_el = ET.SubElement(title_stmt, "title", {"type": "sub"})
        sub_el.text = strip_xml10_invalid(subtitle)

    # Authors
    authors = meta.get("author") or meta.get("authors") or ""
    if isinstance(authors, str):
        authors = [a.strip() for a in authors.split(";") if a.strip()]
    elif isinstance(authors, list):
        authors = [str(a) for a in authors]
    for author in authors:
        ET.SubElement(title_stmt, "author").text = strip_xml10_invalid(author)

    # Translators
    translators = meta.get("translator") or meta.get("translators") or ""
    if isinstance(translators, str):
        translators = [t.strip() for t in translators.split(";") if t.strip()]
    elif isinstance(translators, list):
        translators = [str(t) for t in translators]
    for trans in translators:
        resp = ET.SubElement(title_stmt, "respStmt")
        ET.SubElement(resp, "resp").text = "Traduction"
        ET.SubElement(resp, "name").text = strip_xml10_invalid(trans)

    # Required: at least warn if no author
    if not authors:
        warnings.append({"type": "tei_missing_field", "field": "author", "doc_id": doc_id,
                         "severity": "warning", "profile": "parcolab_like"})

    # publicationStmt
    pub_stmt = file_desc.find("publicationStmt")
    if pub_stmt is not None:
        # Remove generic <p> text
        for p in list(pub_stmt.findall("p")):
            pub_stmt.remove(p)

    publisher = meta.get("publisher", "")
    if publisher:
        ET.SubElement(pub_stmt, "publisher").text = strip_xml10_invalid(publisher)
    else:
        warnings.append({"type": "tei_missing_field", "field": "publisher", "doc_id": doc_id,
                         "severity": "warning", "profile": "parcolab_like"})

    pub_place = meta.get("pubPlace", "") or meta.get("pub_place", "")
    if pub_place:
        ET.SubElement(pub_stmt, "pubPlace").text = strip_xml10_invalid(pub_place)
    else:
        warnings.append({"type": "tei_missing_field", "field": "pubPlace", "doc_id": doc_id,
                         "severity": "warning", "profile": "parcolab_like"})

    date_val = meta.get("date", "") or meta.get("year", "")
    date_str = str(date_val).strip() if date_val else ""
    if date_str:
        ET.SubElement(pub_stmt, "date").text = strip_xml10_invalid(date_str)
    else:
        warnings.append({"type": "tei_missing_field", "field": "date", "doc_id": doc_id,
                         "severity": "warning", "profile": "parcolab_like"})

    # language_ori (original language, if different from doc language)
    lang_ori = meta.get("language_ori", "") or meta.get("language_original", "")
    if lang_ori:
        lang_usage = profile.find("langUsage")
        if lang_usage is None:
            lang_usage = ET.SubElement(profile, "langUsage")
        ori_el = ET.SubElement(lang_usage, "language", {"ident": strip_xml10_invalid(lang_ori)})
        ori_el.text = strip_xml10_invalid(lang_ori)

    # textClass: domain, genre, derivation
    domain = meta.get("domain", "")
    genre = meta.get("genre", "")
    try:
        _doc_role = doc["doc_role"] or ""
    except (IndexError, KeyError):
        _doc_role = ""
    derivation = meta.get("derivation", "") or _doc_role or ""

    text_class = ET.SubElement(profile, "textClass")
    kws = ET.SubElement(text_class, "keywords")
    if domain:
        kw = ET.SubElement(kws, "term", {"type": "domain"})
        kw.text = strip_xml10_invalid(domain)
    if genre:
        kw2 = ET.SubElement(kws, "term", {"type": "genre"})
        kw2.text = strip_xml10_invalid(genre)
    if derivation:
        kw3 = ET.SubElement(kws, "term", {"type": "derivation"})
        kw3.text = strip_xml10_invalid(derivation)
    if not domain and not genre:
        warnings.append({"type": "tei_missing_field", "field": "domain/genre", "doc_id": doc_id,
                         "severity": "warning", "profile": "parcolab_like"})


def _apply_strict_validation(
    header: ET.Element,
    profile: ET.Element,
    doc: sqlite3.Row,
    meta: dict,
    doc_id: int,
    warnings: list[dict],
) -> None:
    """Add encodingDesc and escalate missing fields to severity='error' for parcolab_strict.

    Fields escalated to error (not just warning):
    - title (must be non-empty)
    - language (must be non-empty)
    - date (must be present in meta_json)
    - language_ori required if doc_role starts with 'translation'
    """
    # encodingDesc: declare the profile used
    enc_desc = ET.SubElement(header, "encodingDesc")
    app_info = ET.SubElement(enc_desc, "appInfo")
    app = ET.SubElement(app_info, "application", {"ident": "agrafes", "version": "parcolab_strict"})
    ET.SubElement(app, "label").text = "AGRAFES — ParCoLab strict TEI export"

    # Escalate missing title to error
    title_val = strip_xml10_invalid(doc["title"] or "")
    if not title_val.strip():
        # Update existing warning or add new one with severity=error
        _escalate_or_add_warning(warnings, "title", doc_id, "parcolab_strict")

    # Escalate missing language to error
    lang_val = strip_xml10_invalid(doc["language"] or "")
    if not lang_val.strip():
        _escalate_or_add_warning(warnings, "language", doc_id, "parcolab_strict")

    # Date: escalate to error if missing
    date_val = str(meta.get("date", "") or meta.get("year", "") or "").strip()
    if not date_val:
        _escalate_or_add_warning(warnings, "date", doc_id, "parcolab_strict")

    # language_ori required if doc_role suggests translation
    try:
        doc_role = (doc["doc_role"] or "").lower()
    except (IndexError, KeyError):
        doc_role = ""
    if "translation" in doc_role or doc_role == "target":
        lang_ori = (meta.get("language_ori") or meta.get("language_original") or "").strip()
        if not lang_ori:
            warnings.append({
                "type": "tei_missing_field",
                "field": "language_ori",
                "doc_id": doc_id,
                "severity": "error",
                "profile": "parcolab_strict",
                "message": "language_ori required when doc_role indicates a translation",
            })


def _escalate_or_add_warning(
    warnings: list[dict],
    field: str,
    doc_id: int,
    profile: str,
) -> None:
    """Escalate an existing warning for `field` to severity='error', or add new one."""
    for w in warnings:
        if w.get("field") == field and w.get("doc_id") == doc_id:
            w["severity"] = "error"
            w["profile"] = profile
            return
    warnings.append({
        "type": "tei_missing_field",
        "field": field,
        "doc_id": doc_id,
        "severity": "error",
        "profile": profile,
    })


def export_tei(
    conn: sqlite3.Connection,
    doc_id: int,
    output_path: str | Path,
    include_structure: bool = False,
    include_alignment: bool = False,
    target_doc_id: Optional[int] = None,
    status_filter: Optional[list[str]] = None,
    enrich_header: bool = False,
    tei_profile: str = "generic",
) -> tuple[Path, list[dict]]:
    """Export a document as TEI XML.

    Args:
        conn: SQLite connection.
        doc_id: Document to export.
        output_path: Destination file path (.xml).
        include_structure: If True, also emit <head> elements for structure units.
        include_alignment: If True, emit <linkGrp> with alignment links.
        target_doc_id: If given, restrict alignment links to this target doc.
        status_filter: List of statuses to include in alignment export.
                       Default ["accepted"]. Use ["all"] for no filter.
        enrich_header: If True, add textClass (doc_role, resource_type) and
                       listRelation from doc_relations.
        tei_profile: Export profile: "generic" (default) or "parcolab_like".
                     "parcolab_like" enriches teiHeader with publisher, pubPlace,
                     date, author, translator, domain, genre from meta_json.

    Returns:
        Tuple of (resolved_output_path, warnings_list).
        warnings_list contains dicts like {"type": "tei_missing_field", "field": ..., "doc_id": ...}.
    """
    if status_filter is None:
        status_filter = ["accepted"]

    output_path = Path(output_path)
    doc = _get_document(conn, doc_id)
    units = _get_units(conn, doc_id)

    warnings: list[dict] = []

    title = strip_xml10_invalid(doc["title"] or "")
    language = strip_xml10_invalid(doc["language"] or "")
    source_path = strip_xml10_invalid(doc["source_path"] or "")
    created_at = strip_xml10_invalid(doc["created_at"] or "")
    doc_role = strip_xml10_invalid(doc["doc_role"] or "")
    resource_type_raw = doc["resource_type"]
    resource_type = strip_xml10_invalid(resource_type_raw or "") if resource_type_raw else ""

    if not title:
        warnings.append({"type": "tei_missing_field", "field": "title", "doc_id": doc_id})
    if not language:
        warnings.append({"type": "tei_missing_field", "field": "language", "doc_id": doc_id})

    # Build XML using ElementTree so escaping is automatic
    ET.register_namespace("", "http://www.tei-c.org/ns/1.0")
    tei = ET.Element("TEI", {"xmlns": "http://www.tei-c.org/ns/1.0"})

    # ── teiHeader ──────────────────────────────────────────────────────────────
    header = ET.SubElement(tei, "teiHeader")

    file_desc = ET.SubElement(header, "fileDesc")

    title_stmt = ET.SubElement(file_desc, "titleStmt")
    title_el = ET.SubElement(title_stmt, "title")
    title_el.text = title or f"Document {doc_id}"

    pub_stmt = ET.SubElement(file_desc, "publicationStmt")
    pub_p = ET.SubElement(pub_stmt, "p")
    pub_p.text = f"Generated by multicorpus_engine on {created_at}"

    source_desc = ET.SubElement(file_desc, "sourceDesc")
    source_p = ET.SubElement(source_desc, "p")
    source_p.text = source_path or "unknown"

    profile = ET.SubElement(header, "profileDesc")
    lang_usage = ET.SubElement(profile, "langUsage")
    lang_el = ET.SubElement(lang_usage, "language", {"ident": language or "und"})
    lang_el.text = language or "und"

    if enrich_header:
        # textClass with doc_role and resource_type
        text_class = ET.SubElement(profile, "textClass")
        if doc_role and doc_role != "standalone":
            terms = ET.SubElement(text_class, "keywords")
            kw_doc_role = ET.SubElement(terms, "term", {"type": "doc_role"})
            kw_doc_role.text = doc_role
        if resource_type:
            terms2 = ET.SubElement(text_class, "keywords")
            kw_rt = ET.SubElement(terms2, "term", {"type": "resource_type"})
            kw_rt.text = resource_type

    # ParCoLab-like or parcolab_strict profile: enrich header
    if tei_profile in ("parcolab_like", "parcolab_strict"):
        try:
            meta: dict = _json.loads(doc["meta_json"] or "{}") if doc["meta_json"] else {}
        except (_json.JSONDecodeError, TypeError):
            meta = {}
        _build_parcolab_header(header, file_desc, profile, doc, meta, doc_id, warnings)

        if tei_profile == "parcolab_strict":
            _apply_strict_validation(header, profile, doc, meta, doc_id, warnings)

    # listRelation from doc_relations — always emitted when relations exist
    relations = _get_doc_relations(conn, doc_id)
    if relations:
        list_rel = ET.SubElement(profile, "listRelation")
        for rel in relations:
            rel_type = rel["relation_type"] if "relation_type" in rel.keys() else rel[2]
            tgt_doc_id_rel = rel["target_doc_id"] if "target_doc_id" in rel.keys() else rel[3]
            ET.SubElement(list_rel, "relation", {
                "type": rel_type,
                "active": "#this",
                "passive": f"#doc_{tgt_doc_id_rel}",
            })

    # ── text / body ────────────────────────────────────────────────────────────
    text_el = ET.SubElement(tei, "text")
    body = ET.SubElement(text_el, "body")
    div = ET.SubElement(body, "div")

    for unit in units:
        unit_type = unit["unit_type"]
        unit_id = unit["unit_id"]
        n = unit["n"]
        ext_id = unit["external_id"]
        text_norm = strip_xml10_invalid(unit["text_norm"] or "")

        if unit_type == "line":
            attrs: dict[str, str] = {
                "xml:id": f"u{unit_id}",
                "n": str(ext_id if ext_id is not None else n),
            }
            p = ET.SubElement(div, "p", attrs)
            p.text = text_norm
        elif unit_type == "structure" and include_structure:
            head = ET.SubElement(div, "head", {"xml:id": f"s{unit_id}"})
            head.text = text_norm

    # ── Alignment linkGrp (Sprint 2) ───────────────────────────────────────────
    if include_alignment:
        links_data = _get_alignment_links(conn, doc_id, target_doc_id, status_filter)
        if links_data:
            linkgrp_attrs: dict[str, str] = {"type": "alignment"}
            if target_doc_id is not None:
                linkgrp_attrs["corresp"] = f"doc_{target_doc_id}.tei.xml"
            linkgrp = ET.SubElement(text_el, "linkGrp", linkgrp_attrs)
            for link_row in links_data:
                p_uid = link_row["pivot_unit_id"] if "pivot_unit_id" in link_row.keys() else link_row[1]
                t_uid = link_row["target_unit_id"] if "target_unit_id" in link_row.keys() else link_row[2]
                tgt_doc = link_row["target_doc_id"] if "target_doc_id" in link_row.keys() else link_row[5]
                # pivot ref: internal (#uN); target ref: cross-document URI (TEI P5)
                target_ref = f"#u{p_uid} doc_{tgt_doc}.tei.xml#u{t_uid}"
                ET.SubElement(linkgrp, "link", {"target": target_ref})

    # ── Serialize with UTF-8 declaration ──────────────────────────────────────
    output_path.parent.mkdir(parents=True, exist_ok=True)

    tree = ET.ElementTree(tei)
    ET.indent(tree, space="  ")  # pretty-print (Python 3.9+)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        tree.write(f, encoding="unicode", xml_declaration=False)
        f.write("\n")

    return output_path, warnings
