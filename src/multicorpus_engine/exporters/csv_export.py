"""CSV/TSV exporter for query results (segment and KWIC modes)."""

from __future__ import annotations

import csv
from pathlib import Path


_SEGMENT_FIELDS = ["doc_id", "unit_id", "external_id", "language", "title", "text_norm", "text"]
_KWIC_FIELDS = ["doc_id", "unit_id", "external_id", "language", "title", "left", "match", "right", "text_norm"]

# CSV/TSV formula-injection triggers (audit QRY-02). A cell beginning with one of
# these is interpreted as a formula by Excel/LibreOffice; prefixing a single quote
# forces it to be read as text. Only ASCII triggers are neutralised — typographic
# dashes (— –) and ordinary content are left byte-for-byte untouched.
_FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r", "\n")


def _neutralize_formula(value: object) -> object:
    """Return *value* with a leading ``'`` if a spreadsheet would treat it as a formula."""
    if isinstance(value, str) and value and value[0] in _FORMULA_TRIGGERS:
        return "'" + value
    return value


def export_csv(
    hits: list[dict],
    output_path: str | Path,
    mode: str = "segment",
    delimiter: str = ",",
) -> Path:
    """Write query hits to a CSV (or TSV) file.

    Args:
        hits: List of hit dicts from run_query().
        output_path: Destination file path.
        mode: 'segment' or 'kwic' — determines columns.
        delimiter: ',' for CSV, '\\t' for TSV.

    Returns:
        The resolved output path.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    fields = _KWIC_FIELDS if mode == "kwic" else _SEGMENT_FIELDS

    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=fields,
            delimiter=delimiter,
            extrasaction="ignore",
        )
        writer.writeheader()
        for hit in hits:
            writer.writerow({k: _neutralize_formula(v) for k, v in hit.items()})

    return output_path
