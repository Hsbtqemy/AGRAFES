#!/usr/bin/env python3
"""Read a single field from a sidecar-manifest.json.

Usage: python scripts/read_manifest_field.py <manifest_path> <field_name>
Prints the value to stdout. Used in CI to avoid shell quote-escaping issues.
"""
import json
import sys
from pathlib import Path

if len(sys.argv) != 3:
    print(f"Usage: {sys.argv[0]} <manifest_path> <field_name>", file=sys.stderr)
    sys.exit(1)

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(manifest[sys.argv[2]])
