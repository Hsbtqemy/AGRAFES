#!/usr/bin/env python3
"""Export the sidecar OpenAPI spec to docs/openapi.json.

Usage:
    python scripts/export_openapi.py [--out PATH]

Generates a deterministically ordered JSON file (keys sorted) so that diffs
are stable and the snapshot tests can reliably compare path lists.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Ensure package is importable from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from multicorpus_engine.sidecar_contract import CONTRACT_VERSION, openapi_spec


def main() -> None:
    parser = argparse.ArgumentParser(description="Export sidecar OpenAPI spec to JSON")
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "docs" / "openapi.json"),
        help="Output file path (default: docs/openapi.json)",
    )
    args = parser.parse_args()

    spec = openapi_spec()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    paths = sorted(spec.get("paths", {}).keys())
    print(f"Wrote {out_path} — contract v{CONTRACT_VERSION}, {len(paths)} paths:")
    for p in paths:
        methods = ", ".join(spec["paths"][p].keys()).upper()
        print(f"  {methods:10s} {p}")


if __name__ == "__main__":
    main()
