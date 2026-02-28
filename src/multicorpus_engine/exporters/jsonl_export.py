"""JSONL exporter for query results.

Each line is a valid JSON object (one hit per line).
Output is UTF-8 encoded and suitable for streaming or replay.
"""

from __future__ import annotations

import json
from pathlib import Path


def export_jsonl(
    hits: list[dict],
    output_path: str | Path,
) -> Path:
    """Write query hits to a JSONL file (one JSON object per line).

    Args:
        hits: List of hit dicts from run_query().
        output_path: Destination file path (.jsonl).

    Returns:
        The resolved output path.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        for hit in hits:
            f.write(json.dumps(hit, ensure_ascii=False))
            f.write("\n")

    return output_path
