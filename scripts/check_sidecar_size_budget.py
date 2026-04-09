#!/usr/bin/env python3
"""Enforce sidecar artifact size budgets from a JSON policy file."""

from __future__ import annotations

import argparse
import json
import platform
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "tauri" / "src-tauri" / "binaries" / "sidecar-manifest.json"
DEFAULT_BUDGET_FILE = REPO_ROOT / "bench" / "fixtures" / "sidecar_size_budget.json"


def _path_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    if path.is_dir():
        return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
    raise FileNotFoundError(f"Artifact path not found: {path}")


def _resolve_os_label(target_triple: str | None) -> str:
    if target_triple:
        low = target_triple.lower()
        if "apple-darwin" in low:
            return "macos"
        if "windows" in low:
            return "windows"
        if "linux" in low:
            return "linux"
    runtime = platform.system().lower()
    if runtime == "darwin":
        return "macos"
    return runtime


def _load_json(path: Path, label: str) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"{label} must be a JSON object: {path}")
    return payload


def _size_from_manifest(manifest: dict[str, Any], field: str) -> int:
    raw = manifest.get(field)
    if isinstance(raw, (int, float)):
        return int(raw)
    artifact_path = manifest.get("artifact_path")
    if isinstance(artifact_path, str) and artifact_path:
        p = Path(artifact_path)
        if not p.is_absolute():
            p = REPO_ROOT / p
        return _path_size(p)
    raise RuntimeError(
        f"Manifest has no usable `{field}` and no resolvable artifact_path."
    )


def _resolve_limit_mb(
    budget_payload: dict[str, Any],
    *,
    os_label: str,
    package_format: str,
) -> float:
    limits = budget_payload.get("limits_mb")
    if isinstance(limits, dict):
        os_limits = limits.get(os_label)
        if isinstance(os_limits, dict):
            raw = os_limits.get(package_format)
            if isinstance(raw, (int, float)):
                return float(raw)
    default_limit = budget_payload.get("default_limit_mb")
    if isinstance(default_limit, (int, float)):
        return float(default_limit)
    raise RuntimeError(
        f"No budget configured for os={os_label!r}, format={package_format!r} "
        "and no `default_limit_mb` fallback found."
    )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--manifest",
        default=str(DEFAULT_MANIFEST),
        help=f"Path to sidecar-manifest.json (default: {DEFAULT_MANIFEST})",
    )
    p.add_argument(
        "--budget-file",
        default=str(DEFAULT_BUDGET_FILE),
        help=f"Path to budget JSON (default: {DEFAULT_BUDGET_FILE})",
    )
    p.add_argument(
        "--size-field",
        choices=("artifact_size_bytes", "executable_size_bytes"),
        default="artifact_size_bytes",
        help="Manifest size field to enforce (default: artifact_size_bytes).",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest)
    budget_path = Path(args.budget_file)
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    if not budget_path.exists():
        raise FileNotFoundError(f"Budget file not found: {budget_path}")

    manifest = _load_json(manifest_path, "manifest")
    budget = _load_json(budget_path, "budget")

    package_format = str(manifest.get("format", "")).lower().strip()
    if package_format not in {"onefile", "onedir"}:
        raise RuntimeError(
            f"Invalid or missing `format` in manifest: {manifest.get('format')!r}"
        )

    os_label = _resolve_os_label(
        str(manifest.get("target_triple")) if manifest.get("target_triple") else None
    )
    size_bytes = _size_from_manifest(manifest, args.size_field)
    size_mb = size_bytes / (1024.0 * 1024.0)
    limit_mb = _resolve_limit_mb(
        budget,
        os_label=os_label,
        package_format=package_format,
    )

    ratio = (size_mb / limit_mb) if limit_mb > 0 else 999.0
    print(
        "[size-budget] "
        f"os={os_label} format={package_format} "
        f"{args.size_field}={size_mb:.3f}MB "
        f"limit={limit_mb:.3f}MB ({ratio * 100:.1f}%)"
    )

    if size_mb > limit_mb:
        print(
            "[size-budget] FAIL: sidecar size exceeds configured budget.",
            file=sys.stderr,
        )
        return 1

    print("[size-budget] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
