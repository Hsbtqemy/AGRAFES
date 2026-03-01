#!/usr/bin/env bash
# prepare_sidecar.sh — Build the multicorpus sidecar and copy it into
# tauri-app/src-tauri/binaries/ following ADR-025 (macOS=onefile,
# Linux=onedir, Windows=onedir).
#
# Usage (from repo root):
#   bash tauri-app/scripts/prepare_sidecar.sh [--preset tauri]
#
# The script calls scripts/build_sidecar.py (existing build tool) with the
# correct format for the current OS, then copies/links the output into the
# Tauri binaries directory expected by tauri.conf.json (externalBin).
#
# Output layout expected by Tauri:
#   macOS/Linux onefile:
#     src-tauri/binaries/multicorpus-<target-triple>
#   Windows onedir:
#     src-tauri/binaries/multicorpus-<target-triple>/  (directory)
#   (Tauri bundles the onedir directory when externalBin is a directory)
#
# Prerequisites:
#   pip install -e ".[packaging]"   (PyInstaller)
#   rustc --print host-tuple        (for target triple detection)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BINARIES_DIR="$REPO_ROOT/tauri-app/src-tauri/binaries"
BUILD_SCRIPT="$REPO_ROOT/scripts/build_sidecar.py"

OS_NAME="$(uname -s)"

# Determine format per ADR-025
if [[ "$OS_NAME" == "Darwin" ]]; then
  FORMAT="onefile"
else
  FORMAT="onedir"
fi

PRESET="${1:-tauri}"

echo "==> Building sidecar (format=$FORMAT, preset=$PRESET) on $OS_NAME"
python "$BUILD_SCRIPT" --format "$FORMAT" --preset "$PRESET"

# Detect target triple for naming
TARGET_TRIPLE="$(rustc --print host-tuple 2>/dev/null || echo "unknown")"
echo "==> Target triple: $TARGET_TRIPLE"

SRC_BINARY="$REPO_ROOT/tauri/src-tauri/binaries/multicorpus-$TARGET_TRIPLE"

if [[ "$FORMAT" == "onefile" ]]; then
  if [[ ! -f "$SRC_BINARY" ]]; then
    echo "ERROR: Expected onefile binary at $SRC_BINARY" >&2
    exit 1
  fi
  cp -v "$SRC_BINARY" "$BINARIES_DIR/multicorpus-$TARGET_TRIPLE"
  chmod +x "$BINARIES_DIR/multicorpus-$TARGET_TRIPLE"
  echo "==> Copied onefile binary to $BINARIES_DIR/multicorpus-$TARGET_TRIPLE"
else
  # onedir: copy whole directory
  SRC_DIR="${SRC_BINARY}"
  if [[ ! -d "$SRC_DIR" ]]; then
    echo "ERROR: Expected onedir directory at $SRC_DIR" >&2
    exit 1
  fi
  DEST_DIR="$BINARIES_DIR/multicorpus-$TARGET_TRIPLE"
  rm -rf "$DEST_DIR"
  cp -rv "$SRC_DIR" "$DEST_DIR"
  chmod +x "$DEST_DIR/multicorpus"
  echo "==> Copied onedir to $DEST_DIR"
fi

echo "==> Done. Sidecar ready in tauri-app/src-tauri/binaries/"
