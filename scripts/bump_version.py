#!/usr/bin/env python3
"""
bump_version.py — Met à jour les versions dans tous les fichiers du projet.

Usage:
    python scripts/bump_version.py --engine 0.8.4 --shell 0.1.34
    python scripts/bump_version.py --engine 0.8.4          # shell inchangé
    python scripts/bump_version.py --shell 0.1.34          # engine inchangé
    python scripts/bump_version.py --dry-run --engine 0.8.4 --shell 0.1.34

Fichiers mis à jour :
    Engine (--engine) :
        pyproject.toml                          version = "X.Y.Z"
        src/multicorpus_engine/__init__.py      __version__ = "X.Y.Z"

    Shell (--shell) :
        tauri-shell/src-tauri/tauri.conf.json   "version": "X.Y.Z"
        tauri-shell/src/shell.ts                let APP_VERSION = "X.Y.Z"
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def _replace(path: Path, pattern: str, replacement: str, dry_run: bool) -> bool:
    text = path.read_text(encoding="utf-8")
    new_text, n = re.subn(pattern, replacement, text)
    if n == 0:
        print(f"  ⚠  Aucune correspondance : {path.relative_to(ROOT)}")
        return False
    if dry_run:
        print(f"  ~  {path.relative_to(ROOT)}  (dry-run, {n} remplacement(s))")
    else:
        path.write_text(new_text, encoding="utf-8")
        print(f"  ✓  {path.relative_to(ROOT)}")
    return True


def bump_engine(version: str, dry_run: bool) -> None:
    print(f"\nEngine → {version}")
    _replace(
        ROOT / "pyproject.toml",
        r'(?m)^version = "[^"]+"',
        f'version = "{version}"',
        dry_run,
    )
    _replace(
        ROOT / "src/multicorpus_engine/__init__.py",
        r'__version__ = "[^"]+"',
        f'__version__ = "{version}"',
        dry_run,
    )


def bump_shell(version: str, dry_run: bool) -> None:
    print(f"\nShell → {version}")
    _replace(
        ROOT / "tauri-shell/src-tauri/tauri.conf.json",
        r'"version": "[^"]+"',
        f'"version": "{version}"',
        dry_run,
    )
    _replace(
        ROOT / "tauri-shell/src/shell.ts",
        r'let APP_VERSION = "[^"]+"',
        f'let APP_VERSION = "{version}"',
        dry_run,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Bumpe les versions du projet AGRAFES.")
    parser.add_argument("--engine", metavar="X.Y.Z", help="Nouvelle version engine (pyproject + __init__)")
    parser.add_argument("--shell", metavar="X.Y.Z", help="Nouvelle version shell (tauri.conf.json + shell.ts)")
    parser.add_argument("--dry-run", action="store_true", help="Affiche les changements sans écrire")
    args = parser.parse_args()

    if not args.engine and not args.shell:
        parser.print_help()
        sys.exit(1)

    semver = re.compile(r"^\d+\.\d+\.\d+$")
    for label, val in [("--engine", args.engine), ("--shell", args.shell)]:
        if val and not semver.match(val):
            print(f"Erreur : {label} '{val}' n'est pas un semver valide (X.Y.Z)")
            sys.exit(1)

    if args.dry_run:
        print("Mode dry-run — aucun fichier modifié")

    if args.engine:
        bump_engine(args.engine, args.dry_run)
    if args.shell:
        bump_shell(args.shell, args.dry_run)

    print("\nFait." + (" (dry-run)" if args.dry_run else " Pense à rebuilder le sidecar si --engine a changé."))


if __name__ == "__main__":
    main()
