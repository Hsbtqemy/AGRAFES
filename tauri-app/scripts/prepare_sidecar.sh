#!/usr/bin/env bash
# prepare_sidecar.sh — Build the multicorpus sidecar for tauri-app.
#
# Reads sidecar-manifest.json (written by build_sidecar.py) to locate the
# executable — works with both onefile (macOS) and onedir (Linux/Windows)
# outputs, regardless of target-triple or filename heuristics.
#
# Usage (from repo root OR from tauri-app/):
#   bash tauri-app/scripts/prepare_sidecar.sh [--preset tauri]
#
# Prerequisites:
#   pip install -e ".[packaging]"   (PyInstaller + project)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_SCRIPT="$REPO_ROOT/scripts/build_sidecar.py"

PRESET="tauri"
for arg in "$@"; do
  case "$arg" in
    --preset=*) PRESET="${arg#--preset=}" ;;
    --preset)   shift; PRESET="$1" ;;
  esac
done

echo "==> Building sidecar (preset=$PRESET) …"
python "$BUILD_SCRIPT" --preset "$PRESET"

# ── Read manifest ──────────────────────────────────────────────────────────────
# build_sidecar.py writes sidecar-manifest.json into the preset's out directory.
# We locate it by asking Python for the preset's out path.
MANIFEST=$(python - <<EOF
import json, sys, pathlib
sys.path.insert(0, "$REPO_ROOT/scripts")
# build_sidecar defines PRESET_OUT; we re-derive the manifest path here.
preset = "$PRESET"
presets = {
    "tauri":   "tauri/src-tauri/binaries",
    "fixture": "tauri-fixture/src-tauri/binaries",
    "shell":   "tauri-shell/src-tauri/binaries",
}
out_rel = presets.get(preset)
if not out_rel:
    print(f"ERROR: unknown preset {preset!r}", file=sys.stderr)
    sys.exit(1)
manifest_path = pathlib.Path("$REPO_ROOT") / out_rel / "sidecar-manifest.json"
if not manifest_path.exists():
    print(f"ERROR: manifest not found at {manifest_path}", file=sys.stderr)
    sys.exit(1)
m = json.loads(manifest_path.read_text())
print(m["executable_path"])
EOF
)

if [[ -z "$MANIFEST" ]]; then
  echo "ERROR: could not read executable_path from manifest" >&2
  exit 1
fi

echo "==> Manifest executable_path: $MANIFEST"

# ── Verify the executable exists ──────────────────────────────────────────────
if [[ -f "$MANIFEST" ]]; then
  echo "==> ✓ Sidecar binary (onefile): $MANIFEST"
elif [[ -d "$MANIFEST" ]]; then
  # onedir: the directory itself is the artifact; find the inner executable
  INNER_EXE="$MANIFEST/$(basename "$MANIFEST")"
  if [[ ! -f "$INNER_EXE" ]]; then
    # Fallback: look for any executable named "multicorpus" in the dir
    INNER_EXE="$MANIFEST/multicorpus"
  fi
  if [[ -f "$INNER_EXE" ]]; then
    echo "==> ✓ Sidecar binary (onedir): $INNER_EXE"
  else
    echo "ERROR: onedir present at $MANIFEST but could not find inner executable" >&2
    exit 1
  fi
else
  echo "ERROR: executable_path does not exist: $MANIFEST" >&2
  exit 1
fi

echo "==> Done. Sidecar ready."
