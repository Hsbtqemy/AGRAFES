"""TEI consumer validation utility.

Validates a TEI XML file for internal referential integrity:
- Collects all xml:id values declared in the document.
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

import xml.etree.ElementTree as ET
from pathlib import Path

_TEI_NS = "http://www.tei-c.org/ns/1.0"
_XML_NS = "http://www.w3.org/XML/1998/namespace"
_ATTR_XMLID = f"{{{_XML_NS}}}id"


def _collect_xmlids(root: ET.Element) -> set[str]:
    """Walk the tree and collect all xml:id attribute values."""
    ids: set[str] = set()
    for elem in root.iter():
        # xml:id stored as {ns}id by ElementTree when namespace-aware
        val = elem.get(_ATTR_XMLID)
        if val:
            ids.add(val)
        # Also check plain "xml:id" for non-namespace-aware docs
        val2 = elem.get("xml:id")
        if val2:
            ids.add(val2)
    return ids


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
            }
        Or:
            {
                "type": "parse_error",
                "message": "...",
                "path": "/abs/path.xml",
            }
    """
    path = Path(path)
    errors: list[dict] = []

    try:
        tree = ET.parse(str(path))
    except (ET.ParseError, FileNotFoundError, OSError) as exc:
        return [{"type": "parse_error", "message": str(exc), "path": str(path)}]

    root = tree.getroot()
    declared_ids = _collect_xmlids(root)

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
                    "path": str(path),
                })

    return errors


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
