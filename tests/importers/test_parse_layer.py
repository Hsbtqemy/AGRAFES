"""Direct tests for the shared parse layer (audit P0-1 / A-02).

These test parse_<mode>() in isolation — the single parsing logic now shared by
the importers (write path) and the sidecar /import/preview. Grows one block per
importer as the parse/write split is rolled out.
"""

from __future__ import annotations

from multicorpus_engine.importers.parsed import ParsedDoc, to_preview
from multicorpus_engine.importers.txt import parse_txt_numbered_lines


def test_parse_txt_numbered_lines(tmp_path) -> None:
    p = tmp_path / "doc.txt"
    p.write_text("[1] Bonjour.\nIntertitre\n[2] Le monde.\n\n", encoding="utf-8")

    parsed = parse_txt_numbered_lines(p)
    assert isinstance(parsed, ParsedDoc)
    assert parsed.doc_meta["encoding"] in ("utf-8", "ascii", "cp1252")  # detector choice
    assert parsed.source_hash and len(parsed.source_hash) == 64

    kinds = [(u.n, u.unit_type, u.external_id, u.text_raw) for u in parsed.units]
    assert kinds == [
        (1, "line", 1, "Bonjour."),
        (2, "structure", None, "Intertitre"),
        (3, "line", 2, "Le monde."),
    ]
    # structure unit gets the intertitre role; blank line skipped
    assert parsed.units[1].unit_role == "intertitre"


def test_to_preview_projection(tmp_path) -> None:
    p = tmp_path / "doc.txt"
    p.write_text("[1] one\n[2] two\n[3] three\n", encoding="utf-8")
    parsed = parse_txt_numbered_lines(p)
    preview, total = to_preview(parsed.units, limit=2)
    assert total == 3
    assert preview == [
        {"n": 1, "external_id": 1, "unit_type": "line", "text_raw": "one"},
        {"n": 2, "external_id": 2, "unit_type": "line", "text_raw": "two"},
    ]
