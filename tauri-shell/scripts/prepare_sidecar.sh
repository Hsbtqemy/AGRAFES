#!/usr/bin/env bash
# prepare_sidecar.sh — Build the multicorpus sidecar for tauri-shell.
#
# Reads sidecar-manifest.json (written by build_sidecar.py) to locate the
# executable — works with both onefile (macOS) and onedir (Linux/Windows)
# outputs, without relying on target-triple heuristics.
#
# Usage (from repo root OR from tauri-shell/):
#   bash tauri-shell/scripts/prepare_sidecar.sh
#
# Prerequisites:
#   pip install -e ".[packaging]"   (PyInstaller + project)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_SCRIPT="$REPO_ROOT/scripts/build_sidecar.py"
PRESET="shell"

# Prefer an explicit PYTHON env var; fall back to python3 (avoids conda/venv conflicts).
PYTHON="${PYTHON:-python3}"

# ── Kill any running sidecar process ──────────────────────────────────────────
# The sidecar runs in the background; without an explicit kill the old binary
# stays in memory even after a rebuild, masking the new version.
_SIDECAR_PIDS=$(pgrep -f "multicorpus serve" 2>/dev/null || true)
if [[ -n "$_SIDECAR_PIDS" ]]; then
  echo "==> Killing running sidecar process(es): $_SIDECAR_PIDS"
  echo "$_SIDECAR_PIDS" | xargs kill 2>/dev/null || true
  sleep 0.5  # give it a moment to release the port
else
  echo "==> No running sidecar found."
fi

# ── Remove stale portfiles ─────────────────────────────────────────────────────
# If the sidecar was killed above, its portfile still points to the old port.
# Remove all known portfiles so the next Tauri launch spawns a fresh sidecar
# rather than trying to reconnect to the dead process.
find "$HOME/Library/Application Support/com.agrafes.shell" \
     "$REPO_ROOT/tauri-shell/public" \
     -maxdepth 3 -name ".agrafes_sidecar.json" 2>/dev/null \
  | while IFS= read -r pf; do
      echo "==> Removing stale portfile: $pf"
      rm -f "$pf"
    done

echo "==> Building sidecar (preset=$PRESET) …"
"$PYTHON" "$BUILD_SCRIPT" --preset "$PRESET"

# ── Read manifest ──────────────────────────────────────────────────────────────
MANIFEST=$("$PYTHON" - <<EOF
import json, sys, pathlib
manifest_path = pathlib.Path("$REPO_ROOT/tauri-shell/src-tauri/binaries/sidecar-manifest.json")
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
  INNER_EXE="$MANIFEST/$(basename "$MANIFEST")"
  [[ -f "$INNER_EXE" ]] || INNER_EXE="$MANIFEST/multicorpus"
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

echo "==> Done. Sidecar ready for tauri-shell."
