"""TEI consumer validation utility.

Validates a TEI XML file for internal referential integrity:
- Collects all xml:id values declared in the document.
- Detects duplicate xml:id declarations.
- Verifies that every <link target="..."> references only declared xml:ids.
- Supports both "#id" and bare "id" target syntax.
- Returns structured errors (no stderr output).

Usage::

    from multicorpus_engine.utils.tei_validate import validate_tei_ids
    errors = validate_tei_ids(Path("doc.tei.xml"))
    # errors is a list of dicts:
    # {"type": "broken_link_target", "target": "#u999", "ref": "u999", "link_index": 0}

Design:
- Uses stdlib xml.etree.ElementTree by default (no lxml dependency required).
- Falls back to lxml if available (for namespace handling edge cases).
- No stderr output ever; errors are returned as structured data.
"""

from __future__ import annotations

from collections import Counter
import defusedxml.ElementTree as ET
from pathlib import Path

_TEI_NS = "http://www.tei-c.org/ns/1.0"
_XML_NS = "http://www.w3.org/XML/1998/namespace"
_ATTR_XMLID = f"{{{_XML_NS}}}id"


def _collect_xmlid_occurrences(root: ET.Element) -> dict[str, list[dict]]:
    """Walk the tree and collect xml:id occurrences with lightweight location info."""
    occ: dict[str, list[dict]] = {}
    for i, elem in enumerate(root.iter()):
        # xml:id stored as {ns}id by ElementTree when namespace-aware
        val = elem.get(_ATTR_XMLID)
        if val is None:
            # Also check plain "xml:id" for non-namespace-aware docs
            val = elem.get("xml:id")
        if not val:
            continue
        tag = elem.tag.split("}", 1)[1] if "}" in elem.tag else elem.tag
        occ.setdefault(val, []).append({
            "element_index": i,
            "tag": tag,
        })
    return occ


def _collect_link_targets(root: ET.Element) -> list[tuple[int, str]]:
    """Collect (index, target_attr) for all <link> elements in the tree."""
    results: list[tuple[int, str]] = []
    link_tag_ns = f"{{{_TEI_NS}}}link"
    link_tag_plain = "link"
    for i, elem in enumerate(root.iter()):
        if elem.tag in (link_tag_ns, link_tag_plain):
            target = elem.get("target")
            if target:
                results.append((i, target))
    return results


def _refs_from_target(target: str) -> list[str]:
    """Parse a @target attribute into a list of bare ids for *internal* references only.

    Internal refs: "#id" (fragment only) or bare "id" (no URI component).
    External / cross-document refs are skipped:
    - "some_file.xml#id" → skipped (has URI before #)
    - "http://...#id"    → skipped
    """
    refs = []
    for part in target.split():
        part = part.strip()
        if part.startswith("#"):
            # Pure fragment — internal reference
            bare = part[1:]
            if bare:
                refs.append(bare)
        elif "#" in part:
            # Cross-document URI (e.g. "doc_2.tei.xml#u3") — skip
            pass
        elif part:
            # Bare id without # — treat as internal reference
            refs.append(part)
    return refs


def validate_tei_tree(
    root: ET.Element,
    *,
    source_path: str,
    check_link_targets: bool = True,
) -> list[dict]:
    """Validate an already-parsed TEI element tree.

    This avoids reparsing when callers already hold an Element root.
    """
    errors: list[dict] = []

    occ = _collect_xmlid_occurrences(root)
    declared_ids = set(occ.keys())

    # Duplicate xml:id declarations (warning-level, non-blocking).
    for xml_id, items in occ.items():
        if len(items) <= 1:
            continue
        errors.append({
            "type": "duplicate_xml_id",
            "xml_id": xml_id,
            "occurrences": len(items),
            "elements": items,
            "path": source_path,
            "severity": "warning",
            "blocking": False,
        })

    if not check_link_targets:
        return errors

    for link_index, target_attr in _collect_link_targets(root):
        for ref in _refs_from_target(target_attr):
            if ref not in declared_ids:
                errors.append({
                    "type": "broken_link_target",
                    "target": target_attr,
                    "ref": ref,
                    "link_index": link_index,
                    "path": source_path,
                    "severity": "warning",
                    "blocking": False,
                })

    return errors


def validate_tei_ids(
    path: str | Path,
    *,
    check_link_targets: bool = True,
) -> list[dict]:
    """Validate a TEI XML file for xml:id referential integrity.

    Args:
        path: Path to a TEI XML file.
        check_link_targets: If True (default), verify each <link target> references
                            declared xml:ids.

    Returns:
        List of error dicts. Empty list means valid.
        Error dict shape:
            {
                "type": "broken_link_target",
                "target": "#u999 #u42",   # raw @target value
                "ref": "u999",            # the offending ref
                "link_index": 0,          # index within root.iter()
                "path": "/abs/path.xml",  # source file
                "severity": "warning",
                "blocking": False,
            }
        Or:
            {
                "type": "duplicate_xml_id",
                "xml_id": "u1",
                "occurrences": 2,
                "elements": [{"element_index": 12, "tag": "p"}, ...],
                "path": "/abs/path.xml",
                "severity": "warning",
                "blocking": False,
            }
        Or:
            {
                "type": "parse_error",
                "message": "...",
                "path": "/abs/path.xml",
                "severity": "error",
                "blocking": True,
            }
    """
    path = Path(path)
    errors: list[dict] = []

    try:
        tree = ET.parse(str(path))
    except (ET.ParseError, FileNotFoundError, OSError) as exc:
        return [{
            "type": "parse_error",
            "message": str(exc),
            "path": str(path),
            "severity": "error",
            "blocking": True,
        }]

    root = tree.getroot()
    return validate_tei_tree(
        root,
        source_path=str(path),
        check_link_targets=check_link_targets,
    )


def summarize_tei_validation(errors: list[dict]) -> dict:
    """Return compact counters for TEI validation reporting."""
    type_counts = Counter(str(e.get("type", "unknown")) for e in errors)
    severity_counts = Counter(str(e.get("severity", "warning")) for e in errors)
    blocking = sum(1 for e in errors if bool(e.get("blocking")))
    return {
        "total": len(errors),
        "blocking": blocking,
        "by_type": dict(type_counts),
        "by_severity": dict(severity_counts),
    }


def validate_tei_package(zip_path: str | Path) -> dict[str, list[dict]]:
    """Validate all TEI files inside a publication package ZIP.

    Args:
        zip_path: Path to a .zip produced by export_tei_package.

    Returns:
        Dict mapping zip_member_name → list[error_dict].
        An empty list for a member means it is valid.
        Members that are not TEI (.xml) files are skipped.
    """
    import zipfile
    import tempfile
    import os

    zip_path = Path(zip_path)
    results: dict[str, list[dict]] = {}

    with zipfile.ZipFile(zip_path, "r") as zf:
        tei_names = [n for n in zf.namelist() if n.startswith("tei/") and n.endswith(".xml")]
        with tempfile.TemporaryDirectory() as tmp:
            for name in tei_names:
                dest = Path(tmp) / os.path.basename(name)
                dest.write_bytes(zf.read(name))
                errors = validate_tei_ids(dest)
                results[name] = errors

    return results
