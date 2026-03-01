#!/usr/bin/env bash
# prepare_sidecar.sh — Build the multicorpus sidecar and copy it into tauri-prep/src-tauri/binaries/.
#
# Usage: bash tauri-prep/scripts/prepare_sidecar.sh [--debug]
#   Run from the repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAURI_DIR="$REPO_ROOT/tauri-prep/src-tauri"
BINARIES_DIR="$TAURI_DIR/binaries"

# Detect OS → format
case "$(uname -s)" in
  Darwin) FORMAT="onefile" ;;
  Linux)  FORMAT="onedir" ;;
  *)      FORMAT="onefile" ;;
esac

echo "==> Building multicorpus sidecar (format=$FORMAT)..."
cd "$REPO_ROOT"
python scripts/build_sidecar.py --format "$FORMAT" --preset tauri

# Detect target triple
TARGET_TRIPLE="$(rustc --print host-tuple 2>/dev/null | tr -d '[:space:]')"
if [ -z "$TARGET_TRIPLE" ]; then
  echo "ERROR: could not determine target triple from rustc --print host-tuple" >&2
  exit 1
fi
echo "==> Target triple: $TARGET_TRIPLE"

# build_sidecar.py --preset tauri writes to tauri/src-tauri/binaries/
SRC_ROOT="$REPO_ROOT/tauri/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

if [ "$FORMAT" = "onefile" ]; then
  SRC="$SRC_ROOT/multicorpus-$TARGET_TRIPLE"
  DEST="$BINARIES_DIR/multicorpus-$TARGET_TRIPLE"
  if [ ! -f "$SRC" ]; then
    echo "ERROR: expected onefile binary at $SRC" >&2
    exit 1
  fi
  cp "$SRC" "$DEST"
  chmod +x "$DEST"
  echo "==> Copied $SRC -> $DEST"
else
  SRC_DIR="$SRC_ROOT/multicorpus-$TARGET_TRIPLE"
  DEST_DIR="$BINARIES_DIR/multicorpus-$TARGET_TRIPLE"
  if [ ! -d "$SRC_DIR" ]; then
    echo "ERROR: expected onedir bundle at $SRC_DIR" >&2
    exit 1
  fi
  rm -rf "$DEST_DIR"
  cp -r "$SRC_DIR" "$DEST_DIR"
  echo "==> Copied $SRC_DIR -> $DEST_DIR"
fi

echo "==> Sidecar ready in $BINARIES_DIR"
