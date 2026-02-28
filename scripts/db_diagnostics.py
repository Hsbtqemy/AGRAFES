#!/usr/bin/env python3
"""Inspect a multicorpus SQLite project DB and print JSON diagnostics."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


# Allow running the script without installing the package.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_SRC = _REPO_ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from multicorpus_engine.db import apply_migrations, collect_diagnostics, get_connection


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="db_diagnostics.py",
        description="Collect operational diagnostics for a multicorpus SQLite DB",
    )
    parser.add_argument("--db", required=True, help="Path to SQLite DB file")
    parser.add_argument(
        "--strict",
        action="store_true",
        default=False,
        help="Exit with code 1 when status != ok",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        default=False,
        help="Print compact JSON instead of pretty-printed JSON",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    db_path = Path(args.db)
    if not db_path.exists():
        print(json.dumps({"status": "error", "error": f"DB not found: {db_path}"}))
        return 1

    conn = get_connection(db_path)
    apply_migrations(conn)
    report = collect_diagnostics(conn)

    if args.compact:
        print(json.dumps(report, ensure_ascii=False))
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))

    if args.strict and report.get("status") != "ok":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

