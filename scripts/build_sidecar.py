#!/usr/bin/env python3
"""Build a Tauri-ready sidecar binary from the Python CLI using PyInstaller.

Output naming follows Tauri external binary conventions:
  multicorpus-<target_triple>[.exe]
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import tomllib  # type: ignore[attr-defined]
except ModuleNotFoundError:  # pragma: no cover (Python <3.11 fallback)
    tomllib = None  # type: ignore[assignment]


REPO_ROOT = Path(__file__).resolve().parents[1]
ENTRYPOINT = REPO_ROOT / "scripts" / "sidecar_entry.py"
PRESET_OUT = {
    "tauri": Path("tauri/src-tauri/binaries"),
    "fixture": Path("tauri-fixture/src-tauri/binaries"),
}


def _run(cmd: list[str], *, cwd: Path | None = None) -> str:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "Command failed with exit code "
            f"{proc.returncode}: {' '.join(cmd)}\n"
            f"stdout:\n{proc.stdout}\n"
            f"stderr:\n{proc.stderr}"
        )
    return proc.stdout.strip()


def _normalized_arch(machine: str) -> str:
    value = machine.lower()
    if value in ("x86_64", "amd64", "x64"):
        return "x86_64"
    if value in ("arm64", "aarch64"):
        return "aarch64"
    raise RuntimeError(f"Unsupported architecture for fallback mapping: {machine!r}")


def detect_target_triple() -> str:
    """Detect target triple from rustc when available, otherwise fallback map."""
    try:
        host = _run(["rustc", "--print", "host-tuple"])
        if host:
            return host
    except (FileNotFoundError, RuntimeError):
        pass

    system = platform.system().lower()
    arch = _normalized_arch(platform.machine())

    if system == "darwin":
        if arch == "aarch64":
            return "aarch64-apple-darwin"
        if arch == "x86_64":
            return "x86_64-apple-darwin"
    elif system == "linux":
        if arch == "x86_64":
            return "x86_64-unknown-linux-gnu"
        if arch == "aarch64":
            return "aarch64-unknown-linux-gnu"
    elif system == "windows":
        if arch == "x86_64":
            return "x86_64-pc-windows-msvc"
        if arch == "aarch64":
            return "aarch64-pc-windows-msvc"

    raise RuntimeError(
        "Unsupported OS/arch combination for fallback mapping: "
        f"system={system!r} arch={arch!r}"
    )


def _project_version() -> str:
    pyproject = REPO_ROOT / "pyproject.toml"
    if not pyproject.exists():
        return "0.0.0"

    raw = pyproject.read_text(encoding="utf-8")
    if tomllib is not None:
        try:
            data = tomllib.loads(raw)
            return str(data.get("project", {}).get("version", "0.0.0"))
        except Exception:
            return "0.0.0"

    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("version ="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return "0.0.0"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _size_bytes(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            total += p.stat().st_size
    return total


def _out_dir_from_arg(raw: str) -> Path:
    p = Path(raw)
    if not p.is_absolute():
        p = REPO_ROOT / p
    return p


def _out_dir_from_preset(preset: str) -> Path:
    raw = PRESET_OUT.get(preset)
    if raw is None:
        raise RuntimeError(f"Unsupported preset: {preset!r}")
    return REPO_ROOT / raw


def build_sidecar(
    out_dir: Path,
    base_name: str = "multicorpus",
    clean: bool = True,
    package_format: str = "onefile",
) -> dict:
    if not ENTRYPOINT.exists():
        raise FileNotFoundError(f"Missing entrypoint script: {ENTRYPOINT}")
    if package_format not in {"onefile", "onedir"}:
        raise ValueError(f"Unsupported package format: {package_format!r}")

    target_triple = detect_target_triple()
    is_windows = target_triple.endswith("windows-msvc")

    build_root = REPO_ROOT / "build" / "sidecar_pyinstaller"
    dist_dir = build_root / "dist"
    work_dir = build_root / "work"
    spec_dir = build_root / "spec"
    migrations_dir = REPO_ROOT / "migrations"

    if clean and build_root.exists():
        shutil.rmtree(build_root)
    dist_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    spec_dir.mkdir(parents=True, exist_ok=True)

    pyinstaller_cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        f"--{package_format}",
        "--add-data",
        f"{migrations_dir}{';' if os.name == 'nt' else ':'}migrations",
        "--name",
        base_name,
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(spec_dir),
        str(ENTRYPOINT),
    ]
    _run(pyinstaller_cmd, cwd=REPO_ROOT)

    out_dir.mkdir(parents=True, exist_ok=True)
    final_stem = f"{base_name}-{target_triple}"

    artifact_type: str
    artifact_path: Path
    executable_path: Path

    if package_format == "onefile":
        produced_name = f"{base_name}.exe" if is_windows else base_name
        produced = dist_dir / produced_name
        if not produced.exists():
            raise FileNotFoundError(f"PyInstaller output not found: {produced}")
        final_name = f"{final_stem}.exe" if is_windows else final_stem
        artifact_path = out_dir / final_name
        shutil.copy2(produced, artifact_path)
        executable_path = artifact_path
        artifact_type = "file"
    else:
        produced_dir = dist_dir / base_name
        if not produced_dir.exists() or not produced_dir.is_dir():
            raise FileNotFoundError(f"PyInstaller onedir output not found: {produced_dir}")
        artifact_path = out_dir / f"{final_stem}-onedir"
        if artifact_path.exists():
            if artifact_path.is_dir():
                shutil.rmtree(artifact_path)
            else:
                artifact_path.unlink()
        shutil.copytree(produced_dir, artifact_path)

        produced_exec = artifact_path / (f"{base_name}.exe" if is_windows else base_name)
        if not produced_exec.exists():
            raise FileNotFoundError(f"PyInstaller onedir executable not found: {produced_exec}")

        final_exec_name = f"{final_stem}.exe" if is_windows else final_stem
        executable_path = artifact_path / final_exec_name
        produced_exec.rename(executable_path)
        artifact_type = "directory"

    artifact_size = _size_bytes(artifact_path)
    executable_size = _size_bytes(executable_path)

    manifest = {
        "name": base_name,
        "target_triple": target_triple,
        "version": _project_version(),
        "format": package_format,
        "artifact_type": artifact_type,
        "artifact_path": str(artifact_path),
        "artifact_size_bytes": artifact_size,
        "artifact_size_mb": round(artifact_size / (1024 * 1024), 3),
        "executable_path": str(executable_path),
        "executable_size_bytes": executable_size,
        "executable_size_mb": round(executable_size / (1024 * 1024), 3),
        "sha256": _sha256(executable_path),
        "build_time": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (out_dir / "sidecar-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Tauri sidecar binary with PyInstaller.")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument(
        "--out",
        help="Output directory for binaries.",
    )
    target.add_argument(
        "--preset",
        choices=sorted(PRESET_OUT.keys()),
        help="Output preset: tauri -> tauri/src-tauri/binaries, fixture -> tauri-fixture/src-tauri/binaries.",
    )
    parser.add_argument(
        "--name",
        default="multicorpus",
        help="Base binary name before target-triple suffix (default: multicorpus).",
    )
    parser.add_argument(
        "--format",
        dest="package_format",
        choices=["onefile", "onedir"],
        default="onefile",
        help="PyInstaller output format (default: onefile).",
    )
    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="Keep previous PyInstaller build cache.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.out:
        out_dir = _out_dir_from_arg(args.out)
    else:
        out_dir = _out_dir_from_preset(args.preset)
    manifest = build_sidecar(
        out_dir=out_dir,
        base_name=args.name,
        clean=not args.no_clean,
        package_format=args.package_format,
    )
    print(f"Built sidecar artifact: {manifest['artifact_path']}")
    print(f"Executable: {manifest['executable_path']}")
    print(f"Format: {manifest['format']}")
    print(f"Manifest: {out_dir / 'sidecar-manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
